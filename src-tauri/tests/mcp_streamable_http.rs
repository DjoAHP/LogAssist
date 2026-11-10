//! Tests d'intégration du transport MCP distant contre un serveur Streamable
//! HTTP local (axum + rmcp). Invariants couverts :
//! 1. discovery + appel d'outil avec les trois modes d'authentification (None,
//!    Bearer, ApiKey) ;
//! 2. une réponse 401 est classée `Auth` ;
//! 3. un endpoint injoignable est classé `Offline` ;
//! 4. le timeout externe interrompt un outil lent sans second appel : la
//!    charge du rejeu reste dans McpService (couvert par les tests factices),
//!    le connecteur HTTP n'amortit jamais lui-même une requête.

use std::{sync::Arc, time::Duration};

use axum::{
    Router,
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Response},
};
use logassist_lib::mcp::transport::{McpConnector, RmcpConnector, discover_tools};
use logassist_lib::mcp::types::{McpAuthConfig, McpErrorKind, McpRuntimeServer, McpTransportKind};
use rmcp::{
    ErrorData,
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock, JsonObject},
    tool, tool_router,
    transport::streamable_http_server::{
        StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
    },
};
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
struct TestServer;

#[tool_router(server_handler)]
impl TestServer {
    #[tool(description = "Echo arguments")]
    fn echo(
        &self,
        Parameters(arguments): Parameters<JsonObject>,
    ) -> Result<CallToolResult, ErrorData> {
        Ok(CallToolResult::structured(serde_json::Value::Object(
            arguments,
        )))
    }

    #[tool(description = "Slow tool")]
    async fn slow(&self) -> Result<CallToolResult, ErrorData> {
        tokio::time::sleep(Duration::from_secs(2)).await;
        Ok(CallToolResult::success(vec![ContentBlock::text("done")]))
    }
}

/// En-tête attendu par le faux serveur : (None, None) accepte tout, un couple
/// complet exige l'extraction exacte et un couple incomplet refuse tout.
#[derive(Clone)]
struct ExpectedHeader {
    name: Option<String>,
    value: Option<String>,
}

async fn check_auth(
    State(expected): State<ExpectedHeader>,
    request: Request,
    next: Next,
) -> Response {
    let accepted = match (&expected.name, &expected.value) {
        (None, None) => true,
        (Some(name), Some(value)) => {
            request
                .headers()
                .get(name)
                .and_then(|header| header.to_str().ok())
                == Some(value.as_str())
        }
        _ => false,
    };
    if accepted {
        next.run(request).await
    } else {
        StatusCode::UNAUTHORIZED.into_response()
    }
}

async fn spawn_server(expected: ExpectedHeader) -> (String, CancellationToken) {
    let cancellation = CancellationToken::new();
    let service = StreamableHttpService::new(
        || Ok(TestServer),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default().with_cancellation_token(cancellation.child_token()),
    );
    let router = Router::new()
        .nest_service("/mcp", service)
        .layer(middleware::from_fn_with_state(expected, check_auth));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("port local disponible");
    let address = listener.local_addr().expect("adresse locale");
    let stop = cancellation.clone();
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(stop.cancelled_owned())
            .await;
    });
    (format!("http://{address}/mcp"), cancellation)
}

fn runtime_server(endpoint: String, auth: McpAuthConfig) -> McpRuntimeServer {
    McpRuntimeServer {
        id: "test".into(),
        name: "Test".into(),
        endpoint,
        transport: McpTransportKind::StreamableHttp,
        auth,
        timeout_ms: 5_000,
        enabled: true,
        builtin: false,
        tools: Vec::new(),
    }
}

#[tokio::test]
async fn discovers_and_calls_none_bearer_and_api_key_servers() {
    let cases = [
        (
            McpAuthConfig::None,
            ExpectedHeader {
                name: None,
                value: None,
            },
            None,
        ),
        (
            McpAuthConfig::Bearer,
            ExpectedHeader {
                name: Some("authorization".into()),
                value: Some("Bearer token".into()),
            },
            Some("token"),
        ),
        (
            McpAuthConfig::ApiKey {
                header: "X-API-Key".into(),
            },
            ExpectedHeader {
                name: Some("x-api-key".into()),
                value: Some("token".into()),
            },
            Some("token"),
        ),
    ];
    for (auth, expected, secret) in cases {
        let (endpoint, stop) = spawn_server(expected).await;
        let server = runtime_server(endpoint, auth);
        let connector = RmcpConnector;
        let session = connector
            .connect(&server, secret)
            .await
            .expect("connexion au serveur factice");
        let tools = discover_tools(session.as_ref())
            .await
            .expect("découverte du catalogue");
        assert!(tools.iter().any(|tool| tool.native_name == "echo"));
        let result = session
            .call_tool(
                "echo",
                serde_json::Map::from_iter([("text".into(), serde_json::json!("bonjour"))]),
            )
            .await
            .expect("appel de l'outil echo");
        assert_eq!(
            result.structured_content,
            Some(serde_json::json!({"text":"bonjour"}))
        );
        session.close().await;
        stop.cancel();
    }
}

#[tokio::test]
async fn maps_wrong_bearer_to_auth() {
    let expected = ExpectedHeader {
        name: Some("authorization".into()),
        value: Some("Bearer right".into()),
    };
    let (endpoint, stop) = spawn_server(expected).await;
    let connector = RmcpConnector;
    let server = runtime_server(endpoint, McpAuthConfig::Bearer);
    let error = match connector.connect(&server, Some("wrong")).await {
        Ok(_) => panic!("401 attendu avec un jeton erroné"),
        Err(error) => error,
    };
    assert_eq!(error.kind, McpErrorKind::Auth);
    stop.cancel();
}

#[tokio::test]
async fn offline_endpoint_is_classified() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("port local disponible");
    let address = listener.local_addr().expect("adresse locale");
    // On relâche le port : plus personne ne répond sur ce socket.
    drop(listener);
    let connector = RmcpConnector;
    let server = runtime_server(format!("http://{address}/mcp"), McpAuthConfig::None);
    let error = match connector.connect(&server, None).await {
        Ok(_) => panic!("serveur hors ligne attendu"),
        Err(error) => error,
    };
    assert_eq!(error.kind, McpErrorKind::Offline);
}

#[tokio::test]
async fn slow_tool_respects_external_timeout_without_second_call() {
    let (endpoint, stop) = spawn_server(ExpectedHeader {
        name: None,
        value: None,
    })
    .await;
    let connector = RmcpConnector;
    let server = runtime_server(endpoint, McpAuthConfig::None);
    let session = connector
        .connect(&server, None)
        .await
        .expect("connexion au serveur factice");
    let result = tokio::time::timeout(
        Duration::from_millis(50),
        session.call_tool("slow", serde_json::Map::new()),
    )
    .await;
    assert!(result.is_err(), "l'outil lent de 2 s doit être interrompu");
    session.close().await;
    stop.cancel();
}
