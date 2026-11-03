//! Transport MCP réel vers TinyFish via le SDK `rmcp` (Streamable HTTP).
//! Une session par opération (initialize → list_tools/call_tool → cancel) :
//! simple, sans état partagé, suffisant pour la V1 à deux outils en lecture.

use rmcp::RoleClient;
use rmcp::model::{CallToolRequestParams, JsonObject};
use rmcp::service::{RunningService, ServiceExt};
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use serde_json::{Value, json};

use super::client::TinyfishExecutor;
use super::security::{server_definition, validate_public_web_url};
use super::types::{
    McpErrorKind, McpErrorPayload, McpServerId, WebSource, WebToolRequest, WebToolResult,
};

const SEARCH_RESULT_LIMIT: u32 = 5;
const SEARCH_LANGUAGE: &str = "fr";
const SEARCH_DOMAIN_TYPE: &str = "web";
const FETCH_FORMAT: &str = "markdown";

fn map_connect_error(e: impl std::fmt::Display) -> McpErrorPayload {
    let message = e.to_string();
    let lower = message.to_ascii_lowercase();
    let kind = if lower.contains("401") || lower.contains("403") {
        McpErrorKind::Auth
    } else if lower.contains("timeout") || lower.contains("timed out") {
        McpErrorKind::Timeout
    } else {
        McpErrorKind::Network
    };
    McpErrorPayload {
        kind,
        message: format!("Connexion MCP impossible : {message}"),
    }
}

fn transport_config(api_key: &str) -> StreamableHttpClientTransportConfig {
    let definition = server_definition(McpServerId::Tinyfish);
    StreamableHttpClientTransportConfig::with_uri(definition.endpoint).auth_header(api_key)
}

async fn connect(api_key: &str) -> Result<RunningService<RoleClient, ()>, McpErrorPayload> {
    let config = transport_config(api_key);
    let transport = StreamableHttpClientTransport::from_config(config);
    ().serve(transport).await.map_err(map_connect_error)
}

fn tool_display_name(name: &rmcp::model::Tool) -> String {
    name.name.to_string()
}

fn ensure_required_tools(names: &[&str]) -> Result<(), McpErrorPayload> {
    for required in ["search", "fetch_content"] {
        if !names.contains(&required) {
            return Err(McpErrorPayload {
                kind: McpErrorKind::InvalidResponse,
                message: format!("Outil MCP requis absent du serveur : {required}"),
            });
        }
    }
    Ok(())
}

async fn require_tools(session: &RunningService<RoleClient, ()>) -> Result<(), McpErrorPayload> {
    let listed = session
        .list_tools(Default::default())
        .await
        .map_err(map_connect_error)?;
    let names: Vec<String> = listed.tools.iter().map(tool_display_name).collect();
    let names: Vec<&str> = names.iter().map(String::as_str).collect();
    ensure_required_tools(&names)
}

fn arguments_for(request: &WebToolRequest) -> JsonObject {
    let value: Value = match request {
        WebToolRequest::Search { query, purpose } => {
            let mut args = json!({
                "query": query,
                "result_limit": SEARCH_RESULT_LIMIT,
                "language": SEARCH_LANGUAGE,
                "domain_type": SEARCH_DOMAIN_TYPE,
            });
            if let Some(purpose) = purpose {
                args["purpose"] = json!(purpose);
            }
            args
        }
        WebToolRequest::FetchContent { urls, purpose } => {
            let mut args = json!({
                "urls": urls,
                "format": FETCH_FORMAT,
                "links": true,
                "image_links": false,
                "iframe_links": false,
                "page_metadata": false,
            });
            if let Some(purpose) = purpose {
                args["purpose"] = json!(purpose);
            }
            args
        }
    };
    value.as_object().cloned().unwrap_or_default()
}

fn map_call_error(e: impl std::fmt::Display) -> McpErrorPayload {
    let message = e.to_string();
    let lower = message.to_ascii_lowercase();
    let kind = if lower.contains("401") || lower.contains("403") {
        McpErrorKind::Auth
    } else if lower.contains("429") || lower.contains("rate") {
        McpErrorKind::RateLimit
    } else if lower.contains("timeout") || lower.contains("timed out") {
        McpErrorKind::Timeout
    } else {
        McpErrorKind::Network
    };
    McpErrorPayload {
        kind,
        message: format!("Appel MCP impossible : {message}"),
    }
}

fn extract_sources(
    structured: Option<&Value>,
    origin: super::types::WebToolName,
) -> Vec<WebSource> {
    let Some(items) = structured
        .and_then(|v| v.get("results"))
        .and_then(|r| r.as_array())
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let url = item.get("url")?.as_str()?.to_owned();
            if url.chars().count() > 2_048 || validate_public_web_url(&url).is_err() {
                return None;
            }
            Some(WebSource {
                url,
                title: item
                    .get("title")
                    .and_then(|t| t.as_str())
                    .map(|title| title.chars().take(500).collect()),
                origin,
            })
        })
        .take(20)
        .collect()
}

fn result_to_web_tool_result(
    result: rmcp::model::CallToolResult,
    origin: super::types::WebToolName,
) -> Result<WebToolResult, McpErrorPayload> {
    if result.is_error.unwrap_or(false) {
        return Err(McpErrorPayload {
            kind: McpErrorKind::InvalidResponse,
            message: "L'outil MCP a signalé une erreur".to_owned(),
        });
    }
    let mut content = String::new();
    for block in &result.content {
        if let Some(text) = block.as_text() {
            content.push_str(&text.text);
            content.push('\n');
        }
    }
    let trimmed = content.trim().to_owned();
    if trimmed.is_empty() {
        return Err(McpErrorPayload {
            kind: McpErrorKind::InvalidResponse,
            message: "Réponse MCP vide".to_owned(),
        });
    }
    Ok(WebToolResult {
        content: trimmed,
        sources: extract_sources(result.structured_content.as_ref(), origin),
    })
}

pub struct RmcpTinyfishClient {
    pub api_key: String,
}

#[async_trait::async_trait]
impl TinyfishExecutor for RmcpTinyfishClient {
    async fn verify(&self, _api_key: &str) -> Result<(), McpErrorPayload> {
        // La clé testée est celle portée par l'exécuteur (construction dédiée).
        let session = connect(&self.api_key).await?;
        let outcome = require_tools(&session).await;
        let _ = session.cancel().await;
        outcome
    }

    async fn call(&self, request: &WebToolRequest) -> Result<WebToolResult, McpErrorPayload> {
        let origin = request.tool_name();
        let tool_name = match origin {
            super::types::WebToolName::Search => "search",
            super::types::WebToolName::FetchContent => "fetch_content",
        };
        let params = CallToolRequestParams::new(tool_name).with_arguments(arguments_for(request));
        let session = connect(&self.api_key).await?;
        let outcome = session
            .call_tool(params)
            .await
            .map_err(map_call_error)
            .and_then(|result| result_to_web_tool_result(result, origin));
        let _ = session.cancel().await;
        outcome
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_validation_requires_both_allowed_tools() {
        assert!(ensure_required_tools(&["search", "fetch_content"]).is_ok());
        assert_eq!(
            ensure_required_tools(&["search"]).unwrap_err().kind,
            McpErrorKind::InvalidResponse
        );
        assert_eq!(
            ensure_required_tools(&["fetch_content"]).unwrap_err().kind,
            McpErrorKind::InvalidResponse
        );
    }

    #[test]
    fn transport_config_stores_a_raw_bearer_token() {
        let config = transport_config("tf-secret");
        assert_eq!(config.auth_header.as_deref(), Some("tf-secret"));
    }

    #[test]
    fn extracted_sources_reject_unsafe_urls_and_bound_metadata() {
        let structured = json!({
            "results": [
                { "url": "javascript:alert(1)", "title": "danger" },
                { "url": "file:///etc/passwd", "title": "local" },
                { "url": "https://example.com", "title": "x".repeat(700) }
            ]
        });
        let sources = extract_sources(Some(&structured), super::super::types::WebToolName::Search);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].url, "https://example.com");
        assert_eq!(
            sources[0].title.as_ref().expect("title").chars().count(),
            500
        );
    }
}
