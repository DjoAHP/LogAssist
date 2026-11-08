//! Connecteur MCP Streamable HTTP générique et sécurisé via le SDK `rmcp`.
//! L'adaptateur TinyFish historique reste temporairement isolé en fin de module.

use std::collections::HashMap;
use std::error::Error as StdError;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use http::HeaderValue;
use rmcp::RoleClient;
use rmcp::model::{
    CallToolRequestParams, ErrorCode, ErrorData, JsonObject, PaginatedRequestParams,
    ProtocolVersion,
};
use rmcp::service::{
    ClientInitializeError, ClientLifecycleMode, ClientServiceExt, RunningService,
    RunningServiceCancellationToken, ServiceError, ServiceExt,
};
use rmcp::transport::streamable_http_client::{
    AuthRequiredError, HttpStatusError, InsufficientScopeError,
    StreamableHttpClientTransportConfig, StreamableHttpError,
};
use rmcp::transport::{DynamicTransportError, StreamableHttpClientTransport};
use serde_json::{Value, json};
use tokio::sync::Mutex as AsyncMutex;
use url::{Host, Url};

use super::client::TinyfishExecutor;
use super::security::{
    MAX_SSE_EVENT_BYTES, server_definition, validate_api_key_header, validate_endpoint_static,
    validate_public_ip, validate_public_web_url,
};
use super::types::{
    McpAuthConfig, McpErrorKind, McpErrorPayload, McpRuntimeServer, McpServerId, WebSource,
    WebToolRequest, WebToolResult,
};

const SEARCH_RESULT_LIMIT: u32 = 5;
const SEARCH_LANGUAGE: &str = "fr";
const SEARCH_DOMAIN_TYPE: &str = "web";
const FETCH_FORMAT: &str = "markdown";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CONTROL_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SESSION_RECOVERY_TIMEOUT: Duration = Duration::from_secs(5);

fn public_error_message(kind: McpErrorKind) -> &'static str {
    match kind {
        McpErrorKind::Auth => "Authentification MCP refusée",
        McpErrorKind::RateLimit => "Limite de requêtes MCP atteinte",
        McpErrorKind::Timeout => "Délai d'attente MCP dépassé",
        McpErrorKind::ToolNotFound => "Outil MCP introuvable",
        McpErrorKind::Protocol => "Protocole MCP incompatible",
        McpErrorKind::Offline => "Serveur MCP indisponible",
        McpErrorKind::Cancelled => "Appel MCP annulé",
        _ => "Erreur MCP",
    }
}

fn has_semantic_prefix(normalized: &str, prefix: &str) -> bool {
    let Some(remainder) = normalized.strip_prefix(prefix) else {
        return false;
    };
    remainder.is_empty()
        || remainder
            .chars()
            .next()
            .is_some_and(|separator| matches!(separator, ' ' | ':' | '('))
}

fn classify_semantic_error(detail: &str, is_tool_call: bool) -> Option<McpErrorKind> {
    let normalized = detail.trim().to_ascii_lowercase();
    if [
        "auth required",
        "authorization required",
        "insufficient scope",
        "unauthorized",
        "forbidden",
    ]
    .iter()
    .any(|prefix| has_semantic_prefix(&normalized, prefix))
    {
        Some(McpErrorKind::Auth)
    } else if ["rate limit", "too many requests"]
        .iter()
        .any(|prefix| has_semantic_prefix(&normalized, prefix))
    {
        Some(McpErrorKind::RateLimit)
    } else if is_tool_call
        && [
            "method not found",
            "json-rpc method not found",
            "json rpc method not found",
            "jsonrpc method not found",
        ]
        .iter()
        .any(|prefix| has_semantic_prefix(&normalized, prefix))
    {
        Some(McpErrorKind::ToolNotFound)
    } else if [
        "protocol",
        "json-rpc",
        "json rpc",
        "jsonrpc",
        "initialize",
        "initialization",
    ]
    .iter()
    .any(|prefix| has_semantic_prefix(&normalized, prefix))
    {
        Some(McpErrorKind::Protocol)
    } else {
        None
    }
}

fn classify_reqwest_error(error: &reqwest::Error) -> Option<McpErrorKind> {
    if error.is_timeout() {
        return Some(McpErrorKind::Timeout);
    }
    match error.status().map(|status| status.as_u16()) {
        Some(401 | 403) => Some(McpErrorKind::Auth),
        Some(429) => Some(McpErrorKind::RateLimit),
        _ => None,
    }
}

fn classify_http_status(status: u16) -> Option<McpErrorKind> {
    match status {
        401 | 403 => Some(McpErrorKind::Auth),
        429 => Some(McpErrorKind::RateLimit),
        _ => None,
    }
}

fn classify_error_data(error: &ErrorData, is_tool_call: bool) -> McpErrorKind {
    if is_tool_call && error.code == ErrorCode::METHOD_NOT_FOUND {
        McpErrorKind::ToolNotFound
    } else {
        McpErrorKind::Protocol
    }
}

fn classify_unexpected_server_response(detail: &str) -> McpErrorKind {
    if detail == "invalid www-authenticate header value" {
        return McpErrorKind::Auth;
    }
    let bytes = detail.as_bytes();
    if bytes.len() < 9 || &bytes[..5] != b"HTTP " || !bytes[5..8].iter().all(u8::is_ascii_digit) {
        return McpErrorKind::Protocol;
    }
    let valid_separator = match bytes[8] {
        b':' => true,
        b' ' => detail[9..]
            .split_once(':')
            .is_some_and(|(reason, _)| !reason.trim().is_empty()),
        _ => false,
    };
    if !valid_separator {
        return McpErrorKind::Protocol;
    }
    let status = u16::from(bytes[5] - b'0') * 100
        + u16::from(bytes[6] - b'0') * 10
        + u16::from(bytes[7] - b'0');
    classify_http_status(status).unwrap_or(McpErrorKind::Protocol)
}

fn classify_streamable_http_error(
    error: &StreamableHttpError<reqwest::Error>,
    is_tool_call: bool,
) -> Option<McpErrorKind> {
    match error {
        StreamableHttpError::Client(error) => {
            Some(classify_reqwest_error(error).unwrap_or(McpErrorKind::Offline))
        }
        StreamableHttpError::HttpStatus(error) => {
            Some(classify_http_status(error.status).unwrap_or(McpErrorKind::Offline))
        }
        StreamableHttpError::AuthRequired(_) | StreamableHttpError::InsufficientScope(_) => {
            Some(McpErrorKind::Auth)
        }
        StreamableHttpError::ControlRequestTimeout
        | StreamableHttpError::SessionRecoveryTimeout => Some(McpErrorKind::Timeout),
        StreamableHttpError::ReinitializationFailed(error) => {
            Some(classify_error_data(error, is_tool_call))
        }
        StreamableHttpError::UnexpectedServerResponse(detail) => {
            Some(classify_unexpected_server_response(detail))
        }
        StreamableHttpError::Sse(_)
        | StreamableHttpError::UnexpectedContentType(_)
        | StreamableHttpError::ServerDoesNotSupportSse
        | StreamableHttpError::MissingSessionIdInResponse
        | StreamableHttpError::Deserialize(_) => Some(McpErrorKind::Protocol),
        _ => Some(McpErrorKind::Offline),
    }
}

fn classify_dynamic_transport_error(
    error: &DynamicTransportError,
    is_tool_call: bool,
) -> Option<McpErrorKind> {
    Some(classify_error(error.error.as_ref(), is_tool_call))
}

fn classify_service_error(error: &ServiceError, is_tool_call: bool) -> Option<McpErrorKind> {
    match error {
        ServiceError::McpError(error) => Some(classify_error_data(error, is_tool_call)),
        ServiceError::TransportSend(error) => classify_dynamic_transport_error(error, is_tool_call),
        ServiceError::Timeout { .. } => Some(McpErrorKind::Timeout),
        ServiceError::Cancelled { .. } => Some(McpErrorKind::Cancelled),
        ServiceError::UnexpectedResponse | ServiceError::InputRequiredRoundsExceeded { .. } => {
            Some(McpErrorKind::Protocol)
        }
        _ => Some(McpErrorKind::Offline),
    }
}

fn classify_initialize_error(
    error: &ClientInitializeError,
    is_tool_call: bool,
) -> Option<McpErrorKind> {
    match error {
        ClientInitializeError::TransportError { error, .. } => {
            classify_dynamic_transport_error(error, is_tool_call)
        }
        ClientInitializeError::LegacyFallbackFailed { discover, fallback } => {
            classify_typed_error_chain(fallback.as_ref(), is_tool_call)
                .or_else(|| classify_typed_error_chain(discover.as_ref(), is_tool_call))
                .or(Some(McpErrorKind::Protocol))
        }
        ClientInitializeError::ExpectedInitResponse(_)
        | ClientInitializeError::ExpectedInitResult(_)
        | ClientInitializeError::ConflictInitResponseId(_, _)
        | ClientInitializeError::UncorrelatedErrorResponse { .. }
        | ClientInitializeError::JsonRpcError(_)
        | ClientInitializeError::NoCompatibleProtocolVersion { .. }
        | ClientInitializeError::NoPreferredProtocolVersion => Some(McpErrorKind::Protocol),
        ClientInitializeError::Cancelled => Some(McpErrorKind::Cancelled),
        _ => Some(McpErrorKind::Offline),
    }
}

fn classify_typed_error(
    error: &(dyn StdError + 'static),
    is_tool_call: bool,
) -> Option<McpErrorKind> {
    if error.is::<tokio::time::error::Elapsed>() {
        return Some(McpErrorKind::Timeout);
    }
    if let Some(error) = error.downcast_ref::<reqwest::Error>() {
        return Some(classify_reqwest_error(error).unwrap_or(McpErrorKind::Offline));
    }
    if let Some(error) = error.downcast_ref::<HttpStatusError>() {
        return Some(classify_http_status(error.status).unwrap_or(McpErrorKind::Offline));
    }
    if error.is::<AuthRequiredError>() || error.is::<InsufficientScopeError>() {
        return Some(McpErrorKind::Auth);
    }
    if let Some(error) = error.downcast_ref::<StreamableHttpError<reqwest::Error>>() {
        return classify_streamable_http_error(error, is_tool_call);
    }
    if let Some(error) = error.downcast_ref::<DynamicTransportError>() {
        return classify_dynamic_transport_error(error, is_tool_call);
    }
    if let Some(error) = error.downcast_ref::<ServiceError>() {
        return classify_service_error(error, is_tool_call);
    }
    if let Some(error) = error.downcast_ref::<ClientInitializeError>() {
        return classify_initialize_error(error, is_tool_call);
    }
    if let Some(error) = error.downcast_ref::<ErrorData>() {
        return Some(classify_error_data(error, is_tool_call));
    }
    None
}

fn classify_typed_error_chain(
    error: &(dyn StdError + 'static),
    is_tool_call: bool,
) -> Option<McpErrorKind> {
    let mut current = Some(error);
    while let Some(candidate) = current {
        if let Some(kind) = classify_typed_error(candidate, is_tool_call) {
            return Some(kind);
        }
        current = candidate.source();
    }
    None
}

fn classify_error(error: &(dyn StdError + 'static), is_tool_call: bool) -> McpErrorKind {
    if let Some(kind) = classify_typed_error_chain(error, is_tool_call) {
        return kind;
    }

    let mut current = Some(error);
    while let Some(candidate) = current {
        if let Some(kind) = classify_semantic_error(&candidate.to_string(), is_tool_call) {
            return kind;
        }
        current = candidate.source();
    }
    McpErrorKind::Offline
}

fn map_connect_error<E>(error: E) -> McpErrorPayload
where
    E: StdError + 'static,
{
    let kind = classify_error(&error, false);
    McpErrorPayload::new(kind, public_error_message(kind))
}

fn map_call_error<E>(error: E) -> McpErrorPayload
where
    E: StdError + 'static,
{
    let kind = classify_error(&error, true);
    McpErrorPayload::new(kind, public_error_message(kind))
}

fn invalid_transport_config() -> McpErrorPayload {
    McpErrorPayload::new(
        McpErrorKind::InvalidConfig,
        "Configuration du transport MCP invalide",
    )
}

fn missing_transport_secret() -> McpErrorPayload {
    McpErrorPayload::new(
        McpErrorKind::NotConfigured,
        "Secret du serveur MCP non configuré",
    )
}

fn offline_error() -> McpErrorPayload {
    McpErrorPayload::new(
        McpErrorKind::Offline,
        public_error_message(McpErrorKind::Offline),
    )
}

fn required_secret(secret: Option<&str>) -> Result<&str, McpErrorPayload> {
    secret
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(missing_transport_secret)
}

fn transport_config(
    server: &McpRuntimeServer,
    secret: Option<&str>,
) -> Result<StreamableHttpClientTransportConfig, McpErrorPayload> {
    let mut config = StreamableHttpClientTransportConfig::with_uri(server.endpoint.clone())
        .reinit_on_expired_session(false)
        .max_concurrent_requests(1)
        .control_request_timeout(CONTROL_REQUEST_TIMEOUT)
        .session_recovery_timeout(SESSION_RECOVERY_TIMEOUT)
        .max_sse_event_size(MAX_SSE_EVENT_BYTES);
    // rmcp 3.8 expose ce réglage comme champ public, sans builder dédié.
    config.allow_stateless = true;

    match (&server.auth, secret) {
        (McpAuthConfig::None, None) => Ok(config),
        (McpAuthConfig::None, Some(_)) => Err(invalid_transport_config()),
        (McpAuthConfig::Bearer, candidate) => {
            let token = required_secret(candidate)?;
            HeaderValue::from_str(&format!("Bearer {token}"))
                .map_err(|_| invalid_transport_config())?;
            Ok(config.auth_header(token))
        }
        (McpAuthConfig::ApiKey { header }, candidate) => {
            let token = required_secret(candidate)?;
            let name = validate_api_key_header(header).map_err(|_| invalid_transport_config())?;
            let mut value = HeaderValue::from_str(token).map_err(|_| invalid_transport_config())?;
            value.set_sensitive(true);
            let mut headers = HashMap::new();
            headers.insert(name, value);
            Ok(config.custom_headers(headers))
        }
    }
}

#[derive(Debug)]
enum PreparedEndpoint {
    PinnedDomain {
        domain: String,
        addresses: Vec<SocketAddr>,
    },
    Literal,
}

fn endpoint_port(endpoint: &Url) -> Result<u16, McpErrorPayload> {
    endpoint
        .port_or_known_default()
        .ok_or_else(invalid_transport_config)
}

fn validate_resolved_addresses(
    local: bool,
    addresses: &[SocketAddr],
) -> Result<(), McpErrorPayload> {
    if addresses.is_empty() {
        return Err(offline_error());
    }
    if local {
        if addresses.iter().all(|address| address.ip().is_loopback()) {
            return Ok(());
        }
        return Err(invalid_transport_config());
    }
    if addresses
        .iter()
        .all(|address| validate_public_ip(address.ip()).is_ok())
    {
        Ok(())
    } else {
        Err(invalid_transport_config())
    }
}

fn prepare_endpoint_with_resolution(
    endpoint: &Url,
    resolved: Option<Vec<SocketAddr>>,
) -> Result<PreparedEndpoint, McpErrorPayload> {
    let port = endpoint_port(endpoint)?;
    match endpoint.host().ok_or_else(invalid_transport_config)? {
        Host::Domain(domain) => {
            let addresses = resolved.ok_or_else(offline_error)?;
            let local = domain.eq_ignore_ascii_case("localhost");
            validate_resolved_addresses(local, &addresses)?;
            Ok(PreparedEndpoint::PinnedDomain {
                domain: domain.to_owned(),
                addresses,
            })
        }
        Host::Ipv4(ip) => {
            let address = SocketAddr::new(IpAddr::V4(ip), port);
            validate_resolved_addresses(ip.is_loopback(), std::slice::from_ref(&address))?;
            Ok(PreparedEndpoint::Literal)
        }
        Host::Ipv6(ip) => {
            let address = SocketAddr::new(IpAddr::V6(ip), port);
            validate_resolved_addresses(ip.is_loopback(), std::slice::from_ref(&address))?;
            Ok(PreparedEndpoint::Literal)
        }
    }
}

async fn prepare_endpoint(endpoint: &Url) -> Result<PreparedEndpoint, McpErrorPayload> {
    match endpoint.host().ok_or_else(invalid_transport_config)? {
        Host::Domain(domain) => {
            let domain = domain.to_owned();
            let port = endpoint_port(endpoint)?;
            let addresses = tokio::net::lookup_host((domain.as_str(), port))
                .await
                .map_err(|_| offline_error())?
                .collect();
            prepare_endpoint_with_resolution(endpoint, Some(addresses))
        }
        Host::Ipv4(_) | Host::Ipv6(_) => prepare_endpoint_with_resolution(endpoint, None),
    }
}

fn reqwest_client(endpoint: &PreparedEndpoint) -> Result<reqwest::Client, McpErrorPayload> {
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .connect_timeout(CONNECT_TIMEOUT);
    if let PreparedEndpoint::PinnedDomain { domain, addresses } = endpoint {
        builder = builder.resolve_to_addrs(domain, addresses);
    }
    builder.build().map_err(map_connect_error)
}

fn lifecycle_mode() -> ClientLifecycleMode {
    ClientLifecycleMode::Auto {
        preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        legacy_version: Some(ProtocolVersion::V_2025_11_25),
    }
}

#[async_trait::async_trait]
pub trait McpSession: Send + Sync {
    async fn list_tools_page(
        &self,
        cursor: Option<String>,
    ) -> Result<(Vec<rmcp::model::Tool>, Option<String>), McpErrorPayload>;
    async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Map<String, Value>,
    ) -> Result<rmcp::model::CallToolResult, McpErrorPayload>;
    async fn close(&self);
}

pub struct RmcpSession {
    service: AsyncMutex<Option<RunningService<RoleClient, ()>>>,
    cancellation: StdMutex<Option<RunningServiceCancellationToken>>,
    closing: AtomicBool,
}

fn closed_session_error() -> McpErrorPayload {
    McpErrorPayload::new(
        McpErrorKind::Offline,
        public_error_message(McpErrorKind::Offline),
    )
}

fn ensure_session_open(closing: &AtomicBool) -> Result<(), McpErrorPayload> {
    if closing.load(Ordering::Acquire) {
        Err(closed_session_error())
    } else {
        Ok(())
    }
}

fn begin_session_close<C>(
    closing: &AtomicBool,
    cancellation: &StdMutex<Option<C>>,
    cancel: impl FnOnce(C),
) -> bool {
    if closing.swap(true, Ordering::AcqRel) {
        return false;
    }
    let token = cancellation
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(token) = token {
        cancel(token);
    }
    true
}

#[async_trait::async_trait]
impl McpSession for RmcpSession {
    async fn list_tools_page(
        &self,
        cursor: Option<String>,
    ) -> Result<(Vec<rmcp::model::Tool>, Option<String>), McpErrorPayload> {
        ensure_session_open(&self.closing)?;
        let guard = self.service.lock().await;
        ensure_session_open(&self.closing)?;
        let session = guard.as_ref().ok_or_else(closed_session_error)?;
        let params = cursor.map(|value| PaginatedRequestParams::default().with_cursor(Some(value)));
        let result = session.list_tools(params).await.map_err(map_call_error)?;
        Ok((result.tools, result.next_cursor))
    }

    async fn call_tool(
        &self,
        name: &str,
        arguments: serde_json::Map<String, Value>,
    ) -> Result<rmcp::model::CallToolResult, McpErrorPayload> {
        ensure_session_open(&self.closing)?;
        let guard = self.service.lock().await;
        ensure_session_open(&self.closing)?;
        let session = guard.as_ref().ok_or_else(closed_session_error)?;
        session
            .call_tool(CallToolRequestParams::new(name.to_owned()).with_arguments(arguments))
            .await
            .map_err(map_call_error)
    }

    async fn close(&self) {
        if !begin_session_close(&self.closing, &self.cancellation, |token| token.cancel()) {
            return;
        }
        let service = {
            let mut guard = self.service.lock().await;
            guard.take()
        };
        if let Some(mut service) = service {
            let _ = service.close().await;
        }
    }
}

#[async_trait::async_trait]
pub trait McpConnector: Send + Sync {
    async fn connect(
        &self,
        server: &McpRuntimeServer,
        secret: Option<&str>,
    ) -> Result<Arc<dyn McpSession>, McpErrorPayload>;
}

#[derive(Default)]
pub struct RmcpConnector;

fn connect_timeout_error() -> McpErrorPayload {
    McpErrorPayload::new(
        McpErrorKind::Timeout,
        public_error_message(McpErrorKind::Timeout),
    )
}

async fn connect_inner<R, F>(
    server: &McpRuntimeServer,
    secret: Option<&str>,
    resolver: R,
) -> Result<Arc<dyn McpSession>, McpErrorPayload>
where
    R: FnOnce(Url) -> F,
    F: Future<Output = Result<PreparedEndpoint, McpErrorPayload>>,
{
    let endpoint = validate_endpoint_static(&server.endpoint)?;
    let mut config = transport_config(server, secret)?;
    config.uri = endpoint.as_str().to_owned().into();
    let prepared = resolver(endpoint).await?;
    let client = reqwest_client(&prepared)?;
    let transport = StreamableHttpClientTransport::with_client(client, config);
    let service =
        ().serve_with_lifecycle(transport, lifecycle_mode())
            .await
            .map_err(map_connect_error)?;
    let cancellation = service.cancellation_token();

    Ok(Arc::new(RmcpSession {
        service: AsyncMutex::new(Some(service)),
        cancellation: StdMutex::new(Some(cancellation)),
        closing: AtomicBool::new(false),
    }))
}

async fn connect_with_resolver<R, F>(
    server: &McpRuntimeServer,
    secret: Option<&str>,
    resolver: R,
) -> Result<Arc<dyn McpSession>, McpErrorPayload>
where
    R: FnOnce(Url) -> F,
    F: Future<Output = Result<PreparedEndpoint, McpErrorPayload>>,
{
    tokio::time::timeout(CONNECT_TIMEOUT, connect_inner(server, secret, resolver))
        .await
        .map_err(|_| connect_timeout_error())?
}

#[async_trait::async_trait]
impl McpConnector for RmcpConnector {
    async fn connect(
        &self,
        server: &McpRuntimeServer,
        secret: Option<&str>,
    ) -> Result<Arc<dyn McpSession>, McpErrorPayload> {
        connect_with_resolver(server, secret, |endpoint| async move {
            prepare_endpoint(&endpoint).await
        })
        .await
    }
}

fn map_tinyfish_connect_error(e: impl std::fmt::Display) -> McpErrorPayload {
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

fn tinyfish_transport_config(api_key: &str) -> StreamableHttpClientTransportConfig {
    let definition = server_definition(McpServerId::Tinyfish);
    StreamableHttpClientTransportConfig::with_uri(definition.endpoint).auth_header(api_key)
}

async fn connect_tinyfish(
    api_key: &str,
) -> Result<RunningService<RoleClient, ()>, McpErrorPayload> {
    let config = tinyfish_transport_config(api_key);
    let transport = StreamableHttpClientTransport::from_config(config);
    ().serve(transport)
        .await
        .map_err(map_tinyfish_connect_error)
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
        .map_err(map_tinyfish_connect_error)?;
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

fn map_tinyfish_call_error(e: impl std::fmt::Display) -> McpErrorPayload {
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
        let session = connect_tinyfish(&self.api_key).await?;
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
        let session = connect_tinyfish(&self.api_key).await?;
        let outcome = session
            .call_tool(params)
            .await
            .map_err(map_tinyfish_call_error)
            .and_then(|result| result_to_web_tool_result(result, origin));
        let _ = session.cancel().await;
        outcome
    }
}

#[cfg(test)]
mod tests {
    use std::error::Error as StdError;
    use std::fmt;
    use std::io::{Read, Write};
    use std::net::SocketAddr;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::thread;
    use std::time::Duration;

    use http::{HeaderName, StatusCode};
    use rmcp::model::{ErrorCode, ErrorData, ProtocolVersion};
    use rmcp::service::{ClientInitializeError, ClientLifecycleMode, ServiceError};
    use rmcp::transport::DynamicTransportError;
    use rmcp::transport::streamable_http_client::{
        AuthRequiredError, HttpStatusError, InsufficientScopeError, StreamableHttpError,
    };

    use super::*;
    use crate::mcp::security::{MAX_SSE_EVENT_BYTES, validate_endpoint_static};
    use crate::mcp::types::{McpAuthConfig, McpRuntimeServer, McpTransportKind};

    fn remote_server(auth: McpAuthConfig) -> McpRuntimeServer {
        McpRuntimeServer {
            id: "remote-docs".to_owned(),
            name: "Documentation distante".to_owned(),
            endpoint: "https://mcp.example.com/rpc".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth,
            timeout_ms: 42_000,
            enabled: true,
            builtin: false,
            tools: Vec::new(),
        }
    }

    fn socket(value: &str) -> SocketAddr {
        value.parse().expect("adresse de test valide")
    }

    #[derive(Debug)]
    struct TestError {
        detail: String,
        source: Option<Box<dyn StdError + Send + Sync>>,
    }

    impl TestError {
        fn plain(detail: impl Into<String>) -> Self {
            Self {
                detail: detail.into(),
                source: None,
            }
        }

        fn with_source(
            detail: impl Into<String>,
            source: impl StdError + Send + Sync + 'static,
        ) -> Self {
            Self {
                detail: detail.into(),
                source: Some(Box::new(source)),
            }
        }
    }

    impl fmt::Display for TestError {
        fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str(&self.detail)
        }
    }

    impl StdError for TestError {
        fn source(&self) -> Option<&(dyn StdError + 'static)> {
            self.source
                .as_deref()
                .map(|source| source as &(dyn StdError + 'static))
        }
    }

    fn dynamic_error(error: impl StdError + Send + Sync + 'static) -> DynamicTransportError {
        DynamicTransportError::from_parts(
            "transport-test",
            std::any::TypeId::of::<()>(),
            Box::new(error),
        )
    }

    fn stream_http_status(status: u16) -> StreamableHttpError<reqwest::Error> {
        StreamableHttpError::HttpStatus(HttpStatusError::new(status, None))
    }

    fn initialize_transport_error(
        error: impl StdError + Send + Sync + 'static,
    ) -> ClientInitializeError {
        ClientInitializeError::TransportError {
            error: dynamic_error(error),
            context: "initialize".into(),
        }
    }

    fn spawn_delayed_chunked_response(delay: Duration) -> (String, thread::JoinHandle<()>) {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("listener HTTP local disponible");
        let address = listener.local_addr().expect("adresse locale disponible");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connexion HTTP reçue");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("timeout de lecture configurable");
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\nB\r\ndata: one\n\n\r\n",
                )
                .expect("premier événement envoyé");
            stream.flush().expect("premier événement flushé");
            thread::sleep(delay);
            let _ = stream.write_all(b"B\r\ndata: two\n\n\r\n0\r\n\r\n");
            let _ = stream.flush();
        });
        (format!("http://{address}/events"), handle)
    }

    fn spawn_status_response(status: &'static str) -> (String, thread::JoinHandle<()>) {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("listener HTTP local disponible");
        let address = listener.local_addr().expect("adresse locale disponible");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connexion HTTP reçue");
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            write!(
                stream,
                "HTTP/1.1 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
            .expect("statut HTTP envoyé");
            stream.flush().expect("statut HTTP flushé");
        });
        (format!("http://{address}/status"), handle)
    }

    #[test]
    fn generic_transport_config_supports_none_bearer_and_sensitive_api_key() {
        let none = transport_config(&remote_server(McpAuthConfig::None), None)
            .expect("authentification absente valide");
        assert!(none.auth_header.is_none());
        assert!(none.custom_headers.is_empty());

        let bearer = transport_config(&remote_server(McpAuthConfig::Bearer), Some("raw-token"))
            .expect("bearer valide");
        assert_eq!(bearer.auth_header.as_deref(), Some("raw-token"));
        assert!(bearer.custom_headers.is_empty());

        let api_key = transport_config(
            &remote_server(McpAuthConfig::ApiKey {
                header: "X-API-Key".to_owned(),
            }),
            Some("key-value"),
        )
        .expect("API Key valide");
        assert!(api_key.auth_header.is_none());
        let value = api_key
            .custom_headers
            .get(&HeaderName::from_static("x-api-key"))
            .expect("en-tête API Key présent");
        assert_eq!(value.as_bytes(), b"key-value");
        assert!(value.is_sensitive());
    }

    #[test]
    fn generic_transport_config_rejects_incoherent_secret_combinations() {
        let extra = transport_config(&remote_server(McpAuthConfig::None), Some("unexpected"))
            .expect_err("un secret est interdit avec auth none");
        assert_eq!(extra.kind, McpErrorKind::InvalidConfig);

        for auth in [
            McpAuthConfig::Bearer,
            McpAuthConfig::ApiKey {
                header: "X-API-Key".to_owned(),
            },
        ] {
            let missing = transport_config(&remote_server(auth), None)
                .expect_err("le secret est obligatoire");
            assert_eq!(missing.kind, McpErrorKind::NotConfigured);
        }
    }

    #[test]
    fn generic_transport_config_rejects_crlf_in_every_secret_header() {
        for auth in [
            McpAuthConfig::Bearer,
            McpAuthConfig::ApiKey {
                header: "X-API-Key".to_owned(),
            },
        ] {
            let error = transport_config(&remote_server(auth), Some("secret\r\ninjected: true"))
                .expect_err("CRLF doit être refusé");
            assert_eq!(error.kind, McpErrorKind::InvalidConfig);
            assert!(!error.message.contains("secret"));
            assert!(!error.message.contains("injected"));
        }
    }

    #[test]
    fn generic_transport_config_disables_replay_and_bounds_requests() {
        let config = transport_config(&remote_server(McpAuthConfig::None), None)
            .expect("configuration valide");

        assert!(config.allow_stateless);
        assert!(!config.reinit_on_expired_session);
        assert_eq!(config.max_concurrent_requests, 1);
        assert_eq!(config.control_request_timeout, Duration::from_secs(5));
        assert_eq!(config.session_recovery_timeout, Duration::from_secs(5));
        assert_eq!(config.max_sse_event_size, MAX_SSE_EVENT_BYTES);
    }

    #[tokio::test]
    async fn reqwest_client_does_not_expire_a_shared_sse_body_at_server_timeout() {
        let delay = Duration::from_millis(200);
        let (endpoint, server_thread) = spawn_delayed_chunked_response(delay);
        let parsed = validate_endpoint_static(&endpoint).expect("endpoint local valide");
        let prepared =
            prepare_endpoint_with_resolution(&parsed, None).expect("IP locale littérale valide");
        let client = reqwest_client(&prepared).expect("client reqwest valide");

        let mut response = client
            .get(endpoint)
            .send()
            .await
            .expect("en-têtes SSE reçus");
        assert!(
            response
                .chunk()
                .await
                .expect("premier chunk valide")
                .is_some()
        );
        let second = response.chunk().await;

        server_thread.join().expect("serveur local terminé");
        assert!(second.expect("aucun timeout total reqwest").is_some());
    }

    #[test]
    fn prepared_domain_pins_every_public_ipv4_and_ipv6_address() {
        let endpoint = validate_endpoint_static("https://mcp.example.com/rpc")
            .expect("endpoint distant valide");
        let addresses = vec![socket("8.8.8.8:443"), socket("[2606:4700:4700::1111]:443")];

        let prepared = prepare_endpoint_with_resolution(&endpoint, Some(addresses.clone()))
            .expect("résolution publique valide");

        match prepared {
            PreparedEndpoint::PinnedDomain {
                domain,
                addresses: pinned,
            } => {
                assert_eq!(domain, "mcp.example.com");
                assert_eq!(pinned, addresses);
            }
            PreparedEndpoint::Literal => panic!("un domaine doit rester épinglé"),
        }
    }

    #[test]
    fn prepared_domain_rejects_empty_and_mixed_private_resolutions() {
        let endpoint = validate_endpoint_static("https://mcp.example.com/rpc")
            .expect("endpoint distant valide");

        let empty = prepare_endpoint_with_resolution(&endpoint, Some(Vec::new()))
            .expect_err("une résolution vide doit être hors ligne");
        assert_eq!(empty.kind, McpErrorKind::Offline);

        let mixed = prepare_endpoint_with_resolution(
            &endpoint,
            Some(vec![socket("8.8.8.8:443"), socket("10.0.0.8:443")]),
        )
        .expect_err("une seule adresse privée invalide tout le lot");
        assert_eq!(mixed.kind, McpErrorKind::InvalidConfig);
        assert!(!mixed.message.contains("10.0.0.8"));
        assert!(!mixed.message.contains("mcp.example.com"));
    }

    #[test]
    fn prepared_localhost_requires_an_all_loopback_resolution() {
        let endpoint =
            validate_endpoint_static("http://localhost:3000/mcp").expect("localhost valide");
        let all_loopback = vec![socket("127.0.0.1:3000"), socket("[::1]:3000")];

        let prepared = prepare_endpoint_with_resolution(&endpoint, Some(all_loopback.clone()))
            .expect("toutes les adresses sont de bouclage");
        match prepared {
            PreparedEndpoint::PinnedDomain { addresses, .. } => {
                assert_eq!(addresses, all_loopback)
            }
            PreparedEndpoint::Literal => panic!("localhost reste un domaine épinglé"),
        }

        let mixed = prepare_endpoint_with_resolution(
            &endpoint,
            Some(vec![socket("127.0.0.1:3000"), socket("8.8.8.8:3000")]),
        )
        .expect_err("localhost ne peut pas sortir du bouclage");
        assert_eq!(mixed.kind, McpErrorKind::InvalidConfig);

        let lookalike = validate_endpoint_static("https://api.localhost/mcp")
            .expect("forme statique HTTPS valide");
        let error =
            prepare_endpoint_with_resolution(&lookalike, Some(vec![socket("127.0.0.1:443")]))
                .expect_err("seul le hostname exact localhost est local");
        assert_eq!(error.kind, McpErrorKind::InvalidConfig);
    }

    #[test]
    fn prepared_ip_literals_skip_domain_pinning_for_both_families_and_loopback() {
        for raw in [
            "https://8.8.8.8/mcp",
            "https://[2606:4700:4700::1111]/mcp",
            "http://127.0.0.1:3000/mcp",
            "http://[::1]:3000/mcp",
        ] {
            let endpoint = validate_endpoint_static(raw).expect("IP littérale valide");
            let prepared = prepare_endpoint_with_resolution(&endpoint, None)
                .expect("aucune résolution DNS requise");
            match prepared {
                PreparedEndpoint::Literal => {}
                PreparedEndpoint::PinnedDomain { .. } => {
                    panic!("une IP littérale ne doit jamais être épinglée comme domaine")
                }
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn connector_deadline_includes_a_pending_dns_resolution() {
        let server = remote_server(McpAuthConfig::None);
        let started_at = tokio::time::Instant::now();

        let result = connect_with_resolver(&server, None, |_| async {
            std::future::pending::<Result<PreparedEndpoint, McpErrorPayload>>().await
        })
        .await;

        let error = match result {
            Ok(_) => panic!("la résolution DNS bloquée ne doit jamais réussir"),
            Err(error) => error,
        };
        assert_eq!(error.kind, McpErrorKind::Timeout);
        assert_eq!(started_at.elapsed(), CONNECT_TIMEOUT);
    }

    #[test]
    fn connector_error_mapping_is_fixed_and_never_exposes_raw_details() {
        let cases = [
            ("Auth required super-secret", McpErrorKind::Auth),
            ("Insufficient scope super-secret", McpErrorKind::Auth),
            ("rate limit super-secret", McpErrorKind::RateLimit),
            ("too many requests super-secret", McpErrorKind::RateLimit),
            ("protocol negotiation super-secret", McpErrorKind::Protocol),
            ("JSON-RPC malformed super-secret", McpErrorKind::Protocol),
            ("initialize failed super-secret", McpErrorKind::Protocol),
            ("connection refused super-secret", McpErrorKind::Offline),
        ];

        for (detail, expected) in cases {
            let error = map_connect_error(TestError::plain(detail));
            assert_eq!(error.kind, expected, "{detail}");
            assert_eq!(error.message, public_error_message(expected));
            assert!(!error.message.contains("super-secret"));
            assert!(!error.message.contains(detail));
        }
    }

    #[test]
    fn call_error_mapping_adds_method_not_found_without_leaking_details() {
        let method = map_call_error(TestError::plain("JSON-RPC method not found: super-secret"));
        assert_eq!(method.kind, McpErrorKind::ToolNotFound);
        assert_eq!(
            method.message,
            public_error_message(McpErrorKind::ToolNotFound)
        );
        assert!(!method.message.contains("super-secret"));

        let offline = map_call_error(TestError::plain("socket closed: super-secret"));
        assert_eq!(offline.kind, McpErrorKind::Offline);
        assert!(!offline.message.contains("super-secret"));
    }

    #[test]
    fn numeric_display_fragments_never_define_the_error_kind() {
        for detail in [
            "connection refused on localhost:401",
            "resource path /429 unavailable",
            "RPC error -32601 without semantic label",
        ] {
            assert_eq!(
                map_connect_error(TestError::plain(detail)).kind,
                McpErrorKind::Offline,
                "{detail}"
            );
            assert_eq!(
                map_call_error(TestError::plain(detail)).kind,
                McpErrorKind::Offline,
                "{detail}"
            );
        }
    }

    #[test]
    fn semantic_error_sources_are_classified_through_opaque_wrappers() {
        let cases = [
            ("auth required", McpErrorKind::Auth),
            ("insufficient scope", McpErrorKind::Auth),
            ("rate limit", McpErrorKind::RateLimit),
            ("method not found", McpErrorKind::ToolNotFound),
            ("protocol negotiation", McpErrorKind::Protocol),
            ("JSON-RPC malformed", McpErrorKind::Protocol),
            ("initialize failed", McpErrorKind::Protocol),
        ];

        for (detail, expected) in cases {
            let source = TestError::plain(format!("{detail}: super-secret"));
            let wrapped = TestError::with_source("opaque wrapper", source);
            let error = map_call_error(wrapped);
            assert_eq!(error.kind, expected, "{detail}");
            assert_eq!(error.message, public_error_message(expected));
            assert!(!error.message.contains("super-secret"));
        }
    }

    #[tokio::test]
    async fn typed_reqwest_status_and_timeout_are_found_through_source_chain() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client de test valide");
        for (status, expected) in [
            ("401 Unauthorized", McpErrorKind::Auth),
            ("403 Forbidden", McpErrorKind::Auth),
            ("429 Too Many Requests", McpErrorKind::RateLimit),
        ] {
            let (endpoint, server_thread) = spawn_status_response(status);
            let response = client
                .get(endpoint)
                .send()
                .await
                .expect("réponse HTTP reçue");
            let reqwest_error = response
                .error_for_status()
                .expect_err("le statut doit produire une erreur");
            assert_eq!(classify_reqwest_error(&reqwest_error), Some(expected));
            let mapped = map_connect_error(TestError::with_source("opaque wrapper", reqwest_error));
            server_thread.join().expect("serveur local terminé");
            assert_eq!(mapped.kind, expected, "{status}");
        }

        let (endpoint, server_thread) = spawn_delayed_chunked_response(Duration::from_millis(200));
        let timeout_client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_millis(50))
            .build()
            .expect("client avec timeout valide");
        let mut response = timeout_client
            .get(endpoint)
            .send()
            .await
            .expect("en-têtes reçus avant timeout");
        assert!(
            response
                .chunk()
                .await
                .expect("premier chunk valide")
                .is_some()
        );
        let reqwest_error = response
            .chunk()
            .await
            .expect_err("le corps retardé doit expirer");
        assert!(reqwest_error.is_timeout());
        assert_eq!(
            classify_reqwest_error(&reqwest_error),
            Some(McpErrorKind::Timeout)
        );
        let mapped = map_connect_error(TestError::with_source("opaque wrapper", reqwest_error));
        server_thread.join().expect("serveur local terminé");
        assert_eq!(mapped.kind, McpErrorKind::Timeout);
    }

    #[test]
    fn typed_service_errors_classify_timeout_protocol_and_method_not_found() {
        let timeout = ServiceError::Timeout {
            timeout: Duration::from_secs(3),
        };
        assert_eq!(map_call_error(timeout).kind, McpErrorKind::Timeout);

        let method_not_found =
            ErrorData::new(ErrorCode::METHOD_NOT_FOUND, "opaque remote failure", None);
        assert_eq!(
            map_call_error(ServiceError::McpError(method_not_found.clone())).kind,
            McpErrorKind::ToolNotFound
        );
        assert_eq!(
            map_connect_error(ServiceError::McpError(method_not_found)).kind,
            McpErrorKind::Protocol
        );

        let invalid_request =
            ErrorData::new(ErrorCode::INVALID_REQUEST, "opaque remote failure", None);
        assert_eq!(
            map_call_error(ServiceError::McpError(invalid_request)).kind,
            McpErrorKind::Protocol
        );
    }

    #[test]
    fn typed_streamable_http_errors_classify_direct_and_wrapped_failures() {
        for status in [401, 403] {
            assert_eq!(
                map_connect_error(HttpStatusError::new(status, None)).kind,
                McpErrorKind::Auth
            );
            assert_eq!(
                map_connect_error(stream_http_status(status)).kind,
                McpErrorKind::Auth
            );
        }
        assert_eq!(
            map_connect_error(HttpStatusError::new(429, None)).kind,
            McpErrorKind::RateLimit
        );
        assert_eq!(
            map_connect_error(stream_http_status(429)).kind,
            McpErrorKind::RateLimit
        );
        assert_eq!(
            map_call_error(ServiceError::TransportSend(dynamic_error(
                stream_http_status(429)
            )))
            .kind,
            McpErrorKind::RateLimit
        );

        assert_eq!(
            map_connect_error(StreamableHttpError::<reqwest::Error>::AuthRequired(
                AuthRequiredError::new("Bearer realm=remote".to_owned())
            ))
            .kind,
            McpErrorKind::Auth
        );
        assert_eq!(
            map_connect_error(StreamableHttpError::<reqwest::Error>::InsufficientScope(
                InsufficientScopeError::new(
                    "Bearer scope=tools".to_owned(),
                    Some("tools".to_owned()),
                )
            ))
            .kind,
            McpErrorKind::Auth
        );
        for error in [
            StreamableHttpError::<reqwest::Error>::ControlRequestTimeout,
            StreamableHttpError::<reqwest::Error>::SessionRecoveryTimeout,
        ] {
            assert_eq!(map_call_error(error).kind, McpErrorKind::Timeout);
        }
    }

    #[test]
    fn unexpected_server_response_parses_only_the_strict_internal_http_status_prefix() {
        for (status, expected) in [
            (StatusCode::UNAUTHORIZED, McpErrorKind::Auth),
            (StatusCode::FORBIDDEN, McpErrorKind::Auth),
            (StatusCode::TOO_MANY_REQUESTS, McpErrorKind::RateLimit),
        ] {
            let error = StreamableHttpError::<reqwest::Error>::UnexpectedServerResponse(
                format!("HTTP {status}: denied").into(),
            );
            let mapped = map_connect_error(error);
            assert_eq!(mapped.kind, expected, "{status}");
            assert_eq!(mapped.message, public_error_message(expected));
            assert!(!mapped.message.contains("denied"));
        }

        let invalid_header = StreamableHttpError::<reqwest::Error>::UnexpectedServerResponse(
            "invalid www-authenticate header value".into(),
        );
        assert_eq!(map_connect_error(invalid_header).kind, McpErrorKind::Auth);

        for detail in [
            "opaque response without HTTP prefix",
            "empty sse stream",
            "could not parse JSON response as ServerJsonRpcMessage: malformed body",
            "expect initialized, accepted",
            "HTTP 500 Internal Server Error: denied",
            "/HTTP 401 Unauthorized: body",
            "https://example.test/path/HTTP 401 Unauthorized: body",
            "HTTP 40: body",
            "HTTP 401 body",
            "HTTP 4010: body",
            "HTTP 401 : body",
            "HTTP 401Unauthorized: body",
            "HTTP 401 Unauthorized body",
            "http 401: body",
        ] {
            let error = StreamableHttpError::<reqwest::Error>::UnexpectedServerResponse(
                detail.to_owned().into(),
            );
            assert_eq!(
                map_connect_error(error).kind,
                McpErrorKind::Protocol,
                "{detail}"
            );
        }
    }

    #[test]
    fn typed_initialize_errors_preserve_transport_and_protocol_kinds() {
        assert_eq!(
            map_connect_error(initialize_transport_error(stream_http_status(429))).kind,
            McpErrorKind::RateLimit
        );
        assert_eq!(
            map_connect_error(initialize_transport_error(StreamableHttpError::<
                reqwest::Error,
            >::AuthRequired(
                AuthRequiredError::new("Bearer realm=remote".to_owned(),)
            )))
            .kind,
            McpErrorKind::Auth
        );
        assert_eq!(
            map_connect_error(initialize_transport_error(
                StreamableHttpError::<reqwest::Error>::ControlRequestTimeout
            ))
            .kind,
            McpErrorKind::Timeout
        );

        let negotiation = ClientInitializeError::NoCompatibleProtocolVersion {
            client_supported: vec![ProtocolVersion::V_2026_07_28],
            server_supported: vec![ProtocolVersion::V_2025_11_25],
        };
        assert_eq!(map_connect_error(negotiation).kind, McpErrorKind::Protocol);
        let json_rpc = ClientInitializeError::JsonRpcError(ErrorData::new(
            ErrorCode::INVALID_REQUEST,
            "opaque remote failure",
            None,
        ));
        assert_eq!(map_connect_error(json_rpc).kind, McpErrorKind::Protocol);
    }

    #[test]
    fn legacy_fallback_prefers_actionable_fallback_over_protocol_discovery() {
        let fallbacks = vec![
            (
                initialize_transport_error(StreamableHttpError::<reqwest::Error>::AuthRequired(
                    AuthRequiredError::new("Bearer realm=remote".to_owned()),
                )),
                McpErrorKind::Auth,
            ),
            (
                initialize_transport_error(stream_http_status(429)),
                McpErrorKind::RateLimit,
            ),
            (
                initialize_transport_error(
                    StreamableHttpError::<reqwest::Error>::ControlRequestTimeout,
                ),
                McpErrorKind::Timeout,
            ),
        ];

        for (fallback, expected) in fallbacks {
            let discover = ClientInitializeError::NoCompatibleProtocolVersion {
                client_supported: vec![ProtocolVersion::V_2026_07_28],
                server_supported: vec![ProtocolVersion::V_2025_11_25],
            };
            let wrapped = ClientInitializeError::LegacyFallbackFailed {
                discover: Box::new(discover),
                fallback: Box::new(fallback),
            };
            assert_eq!(map_connect_error(wrapped).kind, expected);
        }
    }

    #[test]
    fn legacy_fallback_uses_the_final_failure_before_discovery_context() {
        let actionable_discover =
            initialize_transport_error(StreamableHttpError::<reqwest::Error>::AuthRequired(
                AuthRequiredError::new("Bearer realm=remote".to_owned()),
            ));
        let protocol_fallback = ClientInitializeError::JsonRpcError(ErrorData::new(
            ErrorCode::INVALID_REQUEST,
            "opaque remote failure",
            None,
        ));
        let wrapped = ClientInitializeError::LegacyFallbackFailed {
            discover: Box::new(actionable_discover),
            fallback: Box::new(protocol_fallback),
        };
        assert_eq!(map_connect_error(wrapped).kind, McpErrorKind::Protocol);

        let protocol_discover = ClientInitializeError::NoCompatibleProtocolVersion {
            client_supported: vec![ProtocolVersion::V_2026_07_28],
            server_supported: vec![ProtocolVersion::V_2025_11_25],
        };
        let offline_fallback = ClientInitializeError::ConnectionClosed("offline".to_owned());
        let wrapped = ClientInitializeError::LegacyFallbackFailed {
            discover: Box::new(protocol_discover),
            fallback: Box::new(offline_fallback),
        };
        assert_eq!(map_connect_error(wrapped).kind, McpErrorKind::Offline);
    }

    #[test]
    fn typed_cancelled_errors_use_the_cancelled_kind_and_fixed_message() {
        let service = map_call_error(ServiceError::Cancelled {
            reason: Some("raw-sensitive-reason".to_owned()),
        });
        assert_eq!(service.kind, McpErrorKind::Cancelled);
        assert_eq!(service.message, "Appel MCP annulé");
        assert!(!service.message.contains("raw-sensitive-reason"));

        let initialize = map_connect_error(ClientInitializeError::Cancelled);
        assert_eq!(initialize.kind, McpErrorKind::Cancelled);
        assert_eq!(initialize.message, "Appel MCP annulé");
    }

    #[tokio::test(start_paused = true)]
    async fn typed_tokio_elapsed_is_a_timeout() {
        let elapsed = tokio::time::timeout(Duration::from_secs(1), std::future::pending::<()>())
            .await
            .expect_err("la future doit dépasser la deadline");

        assert_eq!(map_connect_error(elapsed).kind, McpErrorKind::Timeout);
    }

    #[test]
    fn textual_fallback_never_matches_url_paths_hosts_or_arbitrary_substrings() {
        for detail in [
            "GET https://example.test/unauthorized",
            "GET https://example.test/rate-limit",
            "GET https://example.test/initialize",
            "connection to unauthorized.example failed",
            "prefix unauthorized suffix",
            "preinitialize failure",
        ] {
            assert_eq!(
                map_connect_error(TestError::plain(detail)).kind,
                McpErrorKind::Offline,
                "{detail}"
            );
            assert_eq!(
                map_call_error(TestError::plain(detail)).kind,
                McpErrorKind::Offline,
                "{detail}"
            );
        }
    }

    #[test]
    fn session_closing_state_is_idempotent_and_refuses_new_work() {
        let closing = AtomicBool::new(false);
        let cancellation = StdMutex::new(Some(()));
        let cancellations = AtomicUsize::new(0);
        assert!(ensure_session_open(&closing).is_ok());

        assert!(begin_session_close(&closing, &cancellation, |_| {
            cancellations.fetch_add(1, Ordering::SeqCst);
        }));
        assert!(!begin_session_close(&closing, &cancellation, |_| {
            cancellations.fetch_add(1, Ordering::SeqCst);
        }));

        assert_eq!(cancellations.load(Ordering::SeqCst), 1);
        assert_eq!(
            ensure_session_open(&closing).unwrap_err().kind,
            McpErrorKind::Offline
        );
    }

    #[tokio::test]
    async fn queued_work_rechecks_closing_after_acquiring_the_service_lock() {
        let closing = Arc::new(AtomicBool::new(false));
        let cancellation = StdMutex::new(Some(()));
        let gate = Arc::new(tokio::sync::Mutex::new(()));
        let held = gate.lock().await;
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let task_closing = closing.clone();
        let task_gate = gate.clone();
        let queued = tokio::spawn(async move {
            ensure_session_open(&task_closing)?;
            let _ = ready_tx.send(());
            let _guard = task_gate.lock().await;
            ensure_session_open(&task_closing)
        });
        ready_rx.await.expect("travail placé en file");

        assert!(begin_session_close(&closing, &cancellation, |_| {}));
        drop(held);

        assert_eq!(
            queued
                .await
                .expect("tâche jointe")
                .expect_err("travail en file refusé")
                .kind,
            McpErrorKind::Offline
        );
        assert!(ensure_session_open(&closing).is_err());
    }

    #[tokio::test]
    async fn close_cancels_before_waiting_for_the_service_lock() {
        let closing = Arc::new(AtomicBool::new(false));
        let cancelled = Arc::new(AtomicBool::new(false));
        let cancellation = Arc::new(StdMutex::new(Some(cancelled.clone())));
        let gate = Arc::new(tokio::sync::Mutex::new(()));
        let held = gate.lock().await;
        let task_closing = closing.clone();
        let task_cancellation = cancellation.clone();
        let task_gate = gate.clone();
        let closer = tokio::spawn(async move {
            if begin_session_close(&task_closing, &task_cancellation, |signal| {
                signal.store(true, Ordering::SeqCst);
            }) {
                let _guard = task_gate.lock().await;
            }
        });
        tokio::task::yield_now().await;

        assert!(cancelled.load(Ordering::SeqCst));
        assert!(!closer.is_finished());

        drop(held);
        closer.await.expect("fermeture terminée");
    }

    #[test]
    fn connector_uses_only_the_modern_and_requested_legacy_protocol_versions() {
        match lifecycle_mode() {
            ClientLifecycleMode::Auto {
                preferred_versions,
                legacy_version,
            } => {
                assert_eq!(preferred_versions, vec![ProtocolVersion::V_2026_07_28]);
                assert_eq!(legacy_version, Some(ProtocolVersion::V_2025_11_25));
            }
            other => panic!("cycle de vie inattendu : {other:?}"),
        }
    }

    #[test]
    fn rmcp_connector_implements_the_public_connector_contract() {
        fn assert_connector<T: McpConnector + Default>() {}
        assert_connector::<RmcpConnector>();
    }

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
        let config = tinyfish_transport_config("tf-secret");
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
