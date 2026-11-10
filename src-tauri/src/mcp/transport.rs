//! Connecteur MCP Streamable HTTP générique et sécurisé via le SDK `rmcp`,
//! plus le pool de sessions par serveur. Les helpers TinyFish (sources,
//! arguments canoniques, normalisation) restent isolés en fin de module.

use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::error::Error as StdError;
use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use futures::stream::BoxStream;
use futures::{StreamExt, stream};
use http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use reqwest::header::{ACCEPT, CONTENT_TYPE, RETRY_AFTER, WWW_AUTHENTICATE};
use rmcp::RoleClient;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, ClientJsonRpcMessage, ClientRequest, ContentBlock,
    ErrorCode, ErrorData, JsonObject, JsonRpcMessage, PaginatedRequestParams, ProtocolVersion,
    ResourceContents, ServerJsonRpcMessage,
};
use rmcp::service::{
    ClientInitializeError, ClientLifecycleMode, ClientServiceExt, RunningService,
    RunningServiceCancellationToken, ServiceError,
};
use rmcp::transport::common::http_header::{
    EVENT_STREAM_MIME_TYPE, HEADER_LAST_EVENT_ID, HEADER_MCP_PROTOCOL_VERSION, HEADER_SESSION_ID,
    JSON_MIME_TYPE,
};
use rmcp::transport::streamable_http_client::{
    AuthRequiredError, HttpStatusError, InsufficientScopeError, SseError, StreamableHttpClient,
    StreamableHttpClientTransportConfig, StreamableHttpError, StreamableHttpPostResponse,
};
use rmcp::transport::{DynamicTransportError, StreamableHttpClientTransport};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sse_stream::{Sse, SseStream};
use tokio::sync::Mutex as AsyncMutex;
use url::{Host, Url};

use super::credentials::binding_fingerprint;
use super::security::{
    MAX_CATALOG_BYTES, MAX_MEDIA_PER_RESULT, MAX_RESULT_CHARS, MAX_SSE_EVENT_BYTES,
    MAX_TOOLS_PER_SERVER, MediaRefusal, validate_api_key_header, validate_endpoint_static,
    validate_media_block, validate_public_ip, validate_public_web_url, validate_tool_schema,
};
use super::types::{
    McpAuthConfig, McpErrorKind, McpErrorPayload, McpMedia, McpResourceLink, McpRuntimeServer,
    McpToolDescriptor, McpToolResult, WebSource, WebToolName,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const CONTROL_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const SESSION_RECOVERY_TIMEOUT: Duration = Duration::from_secs(5);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_DISCOVERY_PAGES: usize = 32;
const MAX_TOOL_NAME_CHARS: usize = 128;
const MAX_LABEL_CHARS: usize = 500;
const MAX_RESOURCE_URI_CHARS: usize = 2_048;
const MAX_RESOURCE_LINKS: usize = 20;
const OMITTED_BINARY_MARKER: &str = "[Contenu binaire omis]";
const OMITTED_STRUCTURED_MARKER: &str = "[Contenu structuré omis]";
// Le catalogue normalisé peut atteindre 1 Mio ; la marge couvre l'enveloppe
// JSON-RPC, les curseurs et les champs MCP qui ne sont pas persistés localement.
const MCP_JSON_ENVELOPE_MARGIN_BYTES: usize = 64 * 1024;
const MAX_MCP_JSON_BODY_BYTES: usize = MAX_CATALOG_BYTES + MCP_JSON_ENVELOPE_MARGIN_BYTES;
const MCP_RESPONSE_TOO_LARGE_MESSAGE: &str = "Réponse HTTP MCP trop volumineuse";
const MCP_INVALID_JSON_MESSAGE: &str = "Réponse JSON MCP invalide";
const MCP_UNEXPECTED_HTTP_MESSAGE: &str = "Réponse HTTP MCP inattendue";
const MAX_RETRY_AFTER_BYTES: usize = 128;

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

#[derive(Debug)]
enum BoundedSseBodyError {
    Source(reqwest::Error),
    EventTooLarge { max_size: usize },
}

impl std::fmt::Display for BoundedSseBodyError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Source(error) => write!(formatter, "{error}"),
            Self::EventTooLarge { max_size } => {
                write!(
                    formatter,
                    "SSE event exceeded the maximum size of {max_size} bytes"
                )
            }
        }
    }
}

impl StdError for BoundedSseBodyError {
    fn source(&self) -> Option<&(dyn StdError + 'static)> {
        match self {
            Self::Source(error) => Some(error),
            Self::EventTooLarge { .. } => None,
        }
    }
}

#[derive(Debug)]
struct SseEventSizeLimiter {
    max_size: usize,
    retained_size: usize,
    line_size: usize,
    line_is_comment: bool,
    previous_was_cr: bool,
}

impl SseEventSizeLimiter {
    fn new(max_size: usize) -> Self {
        Self {
            max_size,
            retained_size: 0,
            line_size: 0,
            line_is_comment: false,
            previous_was_cr: false,
        }
    }

    fn observe(&mut self, chunk: &[u8]) -> Result<(), ()> {
        for &byte in chunk {
            if self.previous_was_cr {
                self.previous_was_cr = false;
                if byte == b'\n' {
                    continue;
                }
            }
            match byte {
                b'\r' => {
                    self.finish_line()?;
                    self.previous_was_cr = true;
                }
                b'\n' => self.finish_line()?,
                _ => {
                    if self.line_size == 0 {
                        self.line_is_comment = byte == b':';
                    }
                    self.line_size = self.line_size.saturating_add(1);
                    self.check_limit()?;
                }
            }
        }
        Ok(())
    }

    fn finish_line(&mut self) -> Result<(), ()> {
        if self.line_size == 0 {
            self.retained_size = 0;
        } else if !self.line_is_comment {
            self.retained_size = self
                .retained_size
                .saturating_add(self.line_size)
                .saturating_add(1);
        }
        self.line_size = 0;
        self.line_is_comment = false;
        self.check_limit()
    }

    fn check_limit(&self) -> Result<(), ()> {
        if self.retained_size.saturating_add(self.line_size) > self.max_size {
            Err(())
        } else {
            Ok(())
        }
    }
}

fn bounded_sse_response(
    response: reqwest::Response,
    max_event_size: usize,
) -> BoxStream<'static, Result<Sse, SseError>> {
    // Même comptage par événement que l'adaptateur reqwest RMCP 3.8 : la
    // réponse reste streamée et n'entre jamais dans la borne des corps JSON.
    let bytes = stream::try_unfold(
        (response, SseEventSizeLimiter::new(max_event_size)),
        |(mut response, mut limiter)| async move {
            let Some(chunk) = response
                .chunk()
                .await
                .map_err(BoundedSseBodyError::Source)?
            else {
                return Result::<_, BoundedSseBodyError>::Ok(None);
            };
            limiter
                .observe(&chunk)
                .map_err(|()| BoundedSseBodyError::EventTooLarge {
                    max_size: limiter.max_size,
                })?;
            Ok(Some((chunk, (response, limiter))))
        },
    );
    SseStream::from_bytes_stream(bytes).boxed()
}

fn response_too_large() -> StreamableHttpError<reqwest::Error> {
    StreamableHttpError::UnexpectedServerResponse(Cow::Borrowed(MCP_RESPONSE_TOO_LARGE_MESSAGE))
}

async fn collect_bounded_body(
    mut response: reqwest::Response,
) -> Result<Vec<u8>, StreamableHttpError<reqwest::Error>> {
    // Content-Length permet de refuser avant allocation ; le compteur checked
    // reste l'autorité pour les réponses chunked ou les longueurs mensongères.
    if response
        .content_length()
        .is_some_and(|length| length > MAX_MCP_JSON_BODY_BYTES as u64)
    {
        return Err(response_too_large());
    }
    let capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or_default()
        .min(MAX_MCP_JSON_BODY_BYTES);
    let mut body = Vec::with_capacity(capacity);
    let mut received = 0_usize;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(StreamableHttpError::Client)?
    {
        received = received
            .checked_add(chunk.len())
            .ok_or_else(response_too_large)?;
        if received > MAX_MCP_JSON_BODY_BYTES {
            return Err(response_too_large());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn is_content_type(headers: &HeaderMap, expected: &str) -> bool {
    headers
        .get(CONTENT_TYPE)
        .is_some_and(|value| value.as_bytes().starts_with(expected.as_bytes()))
}

fn validate_transport_header(name: &HeaderName) -> Result<(), String> {
    let reserved = [
        "accept",
        HEADER_SESSION_ID,
        HEADER_MCP_PROTOCOL_VERSION,
        HEADER_LAST_EVENT_ID,
    ];
    if reserved
        .iter()
        .any(|reserved| name.as_str().eq_ignore_ascii_case(reserved))
        && !name
            .as_str()
            .eq_ignore_ascii_case(HEADER_MCP_PROTOCOL_VERSION)
    {
        Err(name.to_string())
    } else {
        Ok(())
    }
}

fn apply_transport_headers(
    mut request: reqwest::RequestBuilder,
    custom_headers: HashMap<HeaderName, HeaderValue>,
) -> Result<reqwest::RequestBuilder, StreamableHttpError<reqwest::Error>> {
    for (name, value) in custom_headers {
        validate_transport_header(&name).map_err(StreamableHttpError::ReservedHeaderConflict)?;
        request = request.header(name, value);
    }
    Ok(request)
}

fn extract_auth_scope(header: &str) -> Option<String> {
    let normalized = header.to_ascii_lowercase();
    let position = normalized.find("scope=")?;
    let value = &header[position + "scope=".len()..];
    if let Some(quoted) = value.strip_prefix('"') {
        return quoted.find('"').map(|end| quoted[..end].to_owned());
    }
    let end = value
        .find(|character: char| character == ',' || character == ';' || character.is_whitespace())
        .unwrap_or(value.len());
    (end > 0).then(|| value[..end].to_owned())
}

enum PendingAuthError {
    Required(String),
    InsufficientScope(String, Option<String>),
}

fn pending_auth_error(
    status: StatusCode,
    headers: &HeaderMap,
) -> Result<Option<PendingAuthError>, StreamableHttpError<reqwest::Error>> {
    let Some(header) = headers.get(WWW_AUTHENTICATE) else {
        return Ok(None);
    };
    let header = header.to_str().map_err(|_| {
        StreamableHttpError::UnexpectedServerResponse(Cow::Borrowed(
            "invalid www-authenticate header value",
        ))
    })?;
    Ok(match status {
        StatusCode::UNAUTHORIZED => Some(PendingAuthError::Required(header.to_owned())),
        StatusCode::FORBIDDEN => Some(PendingAuthError::InsufficientScope(
            header.to_owned(),
            extract_auth_scope(header),
        )),
        _ => None,
    })
}

fn status_error(status: StatusCode, headers: &HeaderMap) -> Option<HttpStatusError> {
    if status != StatusCode::TOO_MANY_REQUESTS && !status.is_server_error() {
        return None;
    }
    let retry_after = headers
        .get(RETRY_AFTER)
        .filter(|value| value.as_bytes().len() <= MAX_RETRY_AFTER_BYTES)
        .and_then(|value| std::str::from_utf8(value.as_bytes()).ok())
        .map(str::to_owned);
    Some(HttpStatusError::new(status.as_u16(), retry_after))
}

fn parse_json_rpc_error(body: &[u8]) -> Option<ServerJsonRpcMessage> {
    match serde_json::from_slice::<ServerJsonRpcMessage>(body) {
        Ok(message @ JsonRpcMessage::Error(_)) => Some(message),
        _ => None,
    }
}

fn legacy_discover_response(
    message: &ClientJsonRpcMessage,
    session_was_attached: bool,
    status: StatusCode,
    body: &[u8],
) -> Option<StreamableHttpPostResponse> {
    if session_was_attached
        || !status.is_client_error()
        || matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
    {
        return None;
    }
    let ClientJsonRpcMessage::Request(request) = message else {
        return None;
    };
    if !matches!(request.request, ClientRequest::DiscoverRequest(_)) {
        return None;
    }
    let error = match serde_json::from_slice::<ServerJsonRpcMessage>(body) {
        Ok(ServerJsonRpcMessage::Error(error)) => error.error,
        _ => ErrorData::invalid_request("Découverte MCP legacy refusée", None),
    };
    Some(StreamableHttpPostResponse::Json(
        ServerJsonRpcMessage::error(error, Some(request.id.clone())),
        None,
    ))
}

#[derive(Clone)]
struct BoundedReqwestClient {
    inner: reqwest::Client,
}

impl BoundedReqwestClient {
    fn new(inner: reqwest::Client) -> Self {
        Self { inner }
    }

    async fn post_bounded(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
        max_sse_event_size: usize,
    ) -> Result<StreamableHttpPostResponse, StreamableHttpError<reqwest::Error>> {
        // Ce POST unique reprend la sémantique RMCP. Déléguer après réception
        // rejouerait le message JSON-RPC et pourrait dupliquer un effet outil.
        let mut request = self
            .inner
            .post(uri.as_ref())
            .header(ACCEPT, [EVENT_STREAM_MIME_TYPE, JSON_MIME_TYPE].join(", "));
        if let Some(auth_header) = auth_header {
            request = request.bearer_auth(auth_header);
        }
        request = apply_transport_headers(request, custom_headers)?;
        let session_was_attached = session_id.is_some();
        if let Some(session_id) = session_id {
            request = request.header(HEADER_SESSION_ID, session_id.as_ref());
        }

        let response = request
            .json(&message)
            .send()
            .await
            .map_err(StreamableHttpError::Client)?;
        let status = response.status();
        if matches!(status, StatusCode::ACCEPTED | StatusCode::NO_CONTENT) {
            return Ok(StreamableHttpPostResponse::Accepted);
        }
        let session_expired = status == StatusCode::NOT_FOUND && session_was_attached;

        let is_json = is_content_type(response.headers(), JSON_MIME_TYPE);
        let is_sse = is_content_type(response.headers(), EVENT_STREAM_MIME_TYPE);
        let auth_error = pending_auth_error(status, response.headers())?;
        let http_status_error = status_error(status, response.headers());
        let content_length = response.content_length();
        let response_session_id = response
            .headers()
            .get(HEADER_SESSION_ID)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);

        if status.is_success()
            && content_length == Some(0)
            && matches!(
                message,
                ClientJsonRpcMessage::Notification(_)
                    | ClientJsonRpcMessage::Response(_)
                    | ClientJsonRpcMessage::Error(_)
            )
        {
            return Ok(StreamableHttpPostResponse::Accepted);
        }

        if !status.is_success() {
            let body = collect_bounded_body(response).await?;
            if session_expired {
                return Err(StreamableHttpError::SessionExpired);
            }
            if let Some(response) =
                legacy_discover_response(&message, session_was_attached, status, &body)
            {
                return Ok(response);
            }
            match auth_error {
                Some(PendingAuthError::Required(header)) => {
                    return Err(StreamableHttpError::AuthRequired(AuthRequiredError::new(
                        header,
                    )));
                }
                Some(PendingAuthError::InsufficientScope(header, scope)) => {
                    return Err(StreamableHttpError::InsufficientScope(
                        InsufficientScopeError::new(header, scope),
                    ));
                }
                None => {}
            }
            if matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN) {
                return Err(HttpStatusError::new(status.as_u16(), None).into());
            }
            if status == StatusCode::TOO_MANY_REQUESTS {
                return Err(http_status_error
                    .unwrap_or_else(|| HttpStatusError::new(status.as_u16(), None))
                    .into());
            }
            if is_json && let Some(message) = parse_json_rpc_error(&body) {
                return Ok(StreamableHttpPostResponse::Json(
                    message,
                    response_session_id,
                ));
            }
            if let Some(error) = http_status_error {
                return Err(error.into());
            }
            return Err(StreamableHttpError::UnexpectedServerResponse(
                Cow::Borrowed(MCP_UNEXPECTED_HTTP_MESSAGE),
            ));
        }

        if is_sse {
            return Ok(StreamableHttpPostResponse::Sse(
                bounded_sse_response(response, max_sse_event_size),
                response_session_id,
            ));
        }
        if is_json {
            let body = collect_bounded_body(response).await?;
            return match serde_json::from_slice::<ServerJsonRpcMessage>(&body) {
                Ok(parsed) => Ok(StreamableHttpPostResponse::Json(
                    parsed,
                    response_session_id,
                )),
                Err(_)
                    if matches!(
                        message,
                        ClientJsonRpcMessage::Notification(_)
                            | ClientJsonRpcMessage::Response(_)
                            | ClientJsonRpcMessage::Error(_)
                    ) =>
                {
                    Ok(StreamableHttpPostResponse::Accepted)
                }
                Err(_) => Err(StreamableHttpError::UnexpectedServerResponse(
                    Cow::Borrowed(MCP_INVALID_JSON_MESSAGE),
                )),
            };
        }
        Err(StreamableHttpError::UnexpectedContentType(None))
    }
}

impl StreamableHttpClient for BoundedReqwestClient {
    type Error = reqwest::Error;

    async fn post_message(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<StreamableHttpPostResponse, StreamableHttpError<Self::Error>> {
        self.post_bounded(
            uri,
            message,
            session_id,
            auth_header,
            custom_headers,
            MAX_SSE_EVENT_BYTES,
        )
        .await
    }

    async fn post_message_with_max_sse_event_size(
        &self,
        uri: Arc<str>,
        message: ClientJsonRpcMessage,
        session_id: Option<Arc<str>>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
        max_sse_event_size: usize,
    ) -> Result<StreamableHttpPostResponse, StreamableHttpError<Self::Error>> {
        self.post_bounded(
            uri,
            message,
            session_id,
            auth_header,
            custom_headers,
            max_sse_event_size,
        )
        .await
    }

    async fn delete_session(
        &self,
        uri: Arc<str>,
        session_id: Arc<str>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<(), StreamableHttpError<Self::Error>> {
        self.inner
            .delete_session(uri, session_id, auth_header, custom_headers)
            .await
    }

    async fn get_stream(
        &self,
        uri: Arc<str>,
        session_id: Option<Arc<str>>,
        last_event_id: Option<String>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
    ) -> Result<BoxStream<'static, Result<Sse, SseError>>, StreamableHttpError<Self::Error>> {
        self.inner
            .get_stream(uri, session_id, last_event_id, auth_header, custom_headers)
            .await
    }

    async fn get_stream_with_max_sse_event_size(
        &self,
        uri: Arc<str>,
        session_id: Option<Arc<str>>,
        last_event_id: Option<String>,
        auth_header: Option<String>,
        custom_headers: HashMap<HeaderName, HeaderValue>,
        max_sse_event_size: usize,
    ) -> Result<BoxStream<'static, Result<Sse, SseError>>, StreamableHttpError<Self::Error>> {
        self.inner
            .get_stream_with_max_sse_event_size(
                uri,
                session_id,
                last_event_id,
                auth_header,
                custom_headers,
                max_sse_event_size,
            )
            .await
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
    let client = BoundedReqwestClient::new(reqwest_client(&prepared)?);
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

fn invalid_discovery_response() -> McpErrorPayload {
    McpErrorPayload::new(
        McpErrorKind::InvalidResponse,
        "Réponse de découverte MCP invalide",
    )
}

/// Nettoie une étiquette distante avant de l'exposer à l'interface. Les
/// contrôles deviennent des espaces afin de ne pas fusionner deux mots, puis
/// la valeur est tronquée en caractères Unicode et débarrassée de ses marges.
fn clean_label(value: &str) -> Option<String> {
    let mut cleaned = String::new();
    for character in value.chars().take(MAX_LABEL_CHARS) {
        if character.is_control() {
            if !cleaned.ends_with(' ') {
                cleaned.push(' ');
            }
        } else {
            cleaned.push(character);
        }
    }
    let cleaned = cleaned.trim();
    (!cleaned.is_empty()).then(|| cleaned.to_owned())
}

fn schema_value(schema: &JsonObject) -> Result<Value, McpErrorPayload> {
    let value = Value::Object(schema.clone());
    validate_tool_schema(&value).map_err(|_| invalid_discovery_response())?;
    Ok(value)
}

#[derive(serde::Serialize)]
struct ToolContractHashEnvelope<'a> {
    native_name: &'a str,
    input_schema: &'a Value,
    output_schema: &'a Option<Value>,
    annotations: &'a Option<Value>,
}

fn tool_contract_hash(
    native_name: &str,
    input_schema: &Value,
    output_schema: &Option<Value>,
    annotations: &Option<Value>,
) -> Result<String, McpErrorPayload> {
    let envelope = ToolContractHashEnvelope {
        native_name,
        input_schema,
        output_schema,
        annotations,
    };
    let serialized = serde_json::to_vec(&envelope).map_err(|_| invalid_discovery_response())?;
    let digest = Sha256::digest(serialized);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity("sha256:".len() + digest.len() * 2);
    encoded.push_str("sha256:");
    for byte in digest {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(encoded)
}

fn descriptor_from_tool(tool: rmcp::model::Tool) -> Result<McpToolDescriptor, McpErrorPayload> {
    let native_name = tool.name.into_owned();
    let name_chars = native_name.chars().count();
    if name_chars == 0
        || name_chars > MAX_TOOL_NAME_CHARS
        || native_name.trim().is_empty()
        || native_name.chars().any(char::is_control)
    {
        return Err(invalid_discovery_response());
    }

    let input_schema = schema_value(tool.input_schema.as_ref())?;
    let output_schema = tool
        .output_schema
        .as_ref()
        .map(|schema| schema_value(schema.as_ref()))
        .transpose()?;
    let annotations = tool
        .annotations
        .map(|mut annotations| {
            annotations.title = annotations.title.as_deref().and_then(clean_label);
            serde_json::to_value(annotations).map_err(|_| invalid_discovery_response())
        })
        .transpose()?;
    let schema_hash =
        tool_contract_hash(&native_name, &input_schema, &output_schema, &annotations)?;

    Ok(McpToolDescriptor {
        native_name,
        title: tool.title.as_deref().and_then(clean_label),
        description: tool.description.as_deref().and_then(clean_label),
        schema_hash,
        input_schema,
        output_schema,
        annotations,
    })
}

fn append_discovered_tool(
    descriptors: &mut Vec<McpToolDescriptor>,
    names: &mut HashSet<String>,
    catalog_bytes: &mut usize,
    tool: rmcp::model::Tool,
) -> Result<(), McpErrorPayload> {
    let descriptor = descriptor_from_tool(tool)?;
    if !names.insert(descriptor.native_name.clone()) {
        return Err(invalid_discovery_response());
    }

    let descriptor_bytes = serde_json::to_vec(&descriptor)
        .map_err(|_| invalid_discovery_response())?
        .len();
    let separator_bytes = usize::from(!descriptors.is_empty());
    *catalog_bytes = catalog_bytes
        .checked_add(separator_bytes)
        .and_then(|size| size.checked_add(descriptor_bytes))
        .ok_or_else(invalid_discovery_response)?;
    if *catalog_bytes > MAX_CATALOG_BYTES {
        return Err(invalid_discovery_response());
    }
    descriptors.push(descriptor);
    Ok(())
}

/// Découvre l'intégralité du catalogue MCP sans faire confiance aux bornes du
/// serveur. `catalog_bytes` commence à deux pour compter exactement `[]`; une
/// virgule est ensuite ajoutée entre chaque enveloppe de descripteur.
pub async fn discover_tools(
    session: &dyn McpSession,
) -> Result<Vec<McpToolDescriptor>, McpErrorPayload> {
    let mut descriptors = Vec::new();
    let mut names = HashSet::new();
    let mut cursors = HashSet::new();
    let mut cursor = None;
    let mut catalog_bytes = 2_usize;

    for page_index in 0..MAX_DISCOVERY_PAGES {
        let (tools, next_cursor) = session.list_tools_page(cursor.clone()).await?;
        if descriptors
            .len()
            .checked_add(tools.len())
            .is_none_or(|count| count > MAX_TOOLS_PER_SERVER)
        {
            return Err(invalid_discovery_response());
        }
        for tool in tools {
            append_discovered_tool(&mut descriptors, &mut names, &mut catalog_bytes, tool)?;
        }

        let Some(next_cursor) = next_cursor else {
            return Ok(descriptors);
        };
        if page_index + 1 == MAX_DISCOVERY_PAGES || !cursors.insert(next_cursor.clone()) {
            return Err(invalid_discovery_response());
        }
        cursor = Some(next_cursor);
    }

    Err(invalid_discovery_response())
}

pub async fn discover_tools_bounded(
    session: &dyn McpSession,
) -> Result<Vec<McpToolDescriptor>, McpErrorPayload> {
    tokio::time::timeout(DISCOVERY_TIMEOUT, discover_tools(session))
        .await
        .map_err(|_| connect_timeout_error())?
}

/// Empreinte d'un slot de connexion : une session est réutilisée tant que la
/// liaison serveur (id, endpoint, auth) est inchangée.
pub struct McpConnectionPool {
    connector: Arc<dyn McpConnector>,
    slots: AsyncMutex<HashMap<String, Arc<ConnectionSlot>>>,
}

struct ConnectionSlot {
    fingerprint: String,
    session: AsyncMutex<Option<Arc<dyn McpSession>>>,
}

impl McpConnectionPool {
    /// Construction de production : connecteur rmcp réel.
    pub fn production() -> Self {
        Self::new(Arc::new(RmcpConnector))
    }

    pub fn new(connector: Arc<dyn McpConnector>) -> Self {
        Self {
            connector,
            slots: AsyncMutex::new(HashMap::new()),
        }
    }

    async fn close_session_in_slot(slot: &ConnectionSlot) {
        if let Some(session) = slot.session.lock().await.take() {
            session.close().await;
        }
    }

    async fn close_optional(previous: Option<Arc<ConnectionSlot>>) {
        if let Some(slot) = previous {
            Self::close_session_in_slot(&slot).await;
        }
    }

    /// Retourne la session installée pour la liaison courante, ou en ouvre une.
    /// Un slot dont l'empreinte a changé est fermé et remplacé.
    pub async fn session(
        &self,
        server: &McpRuntimeServer,
        secret: Option<&str>,
    ) -> Result<Arc<dyn McpSession>, McpErrorPayload> {
        let fingerprint = binding_fingerprint(server);
        let (slot, stale) = {
            let mut slots = self.slots.lock().await;
            let must_replace = slots
                .get(&server.id)
                .is_some_and(|slot| slot.fingerprint != fingerprint);
            let stale = if must_replace {
                slots.remove(&server.id)
            } else {
                None
            };
            let slot = slots
                .entry(server.id.clone())
                .or_insert_with(|| {
                    Arc::new(ConnectionSlot {
                        fingerprint: fingerprint.clone(),
                        session: AsyncMutex::new(None),
                    })
                })
                .clone();
            (slot, stale)
        };
        Self::close_optional(stale).await;
        let mut current = slot.session.lock().await;
        if let Some(session) = current.as_ref() {
            return Ok(session.clone());
        }
        let session = self.connector.connect(server, secret).await?;
        *current = Some(session.clone());
        Ok(session)
    }

    /// Teste un candidate en externe : la session créée n'entre pas dans le
    /// pool tant qu'elle n'a pas été installée explicitement.
    pub async fn connect_candidate(
        &self,
        server: &McpRuntimeServer,
        secret: &str,
    ) -> Result<Arc<dyn McpSession>, McpErrorPayload> {
        self.connector.connect(server, Some(secret)).await
    }

    /// Remplace le slot du serveur par une session déjà validée (clé testée),
    /// en fermant proprement la session précédente le cas échéant.
    pub async fn install(&self, server_id: &str, fingerprint: &str, session: Arc<dyn McpSession>) {
        let previous = self.slots.lock().await.insert(
            server_id.to_owned(),
            Arc::new(ConnectionSlot {
                fingerprint: fingerprint.to_owned(),
                session: AsyncMutex::new(Some(session)),
            }),
        );
        Self::close_optional(previous).await;
    }

    /// Ferme et retire le slot du serveur. Idempotent : id inconnu = no-op.
    pub async fn disconnect(&self, server_id: &str) {
        let slot = self.slots.lock().await.remove(server_id);
        Self::close_optional(slot).await;
    }

    /// Purge plusieurs slots (sync du registre, serveur supprimé ou modifié).
    pub async fn disconnect_many(&self, server_ids: &[String]) {
        for server_id in server_ids {
            self.disconnect(server_id).await;
        }
    }
}

fn extract_tinyfish_sources(structured: Option<&Value>, origin: WebToolName) -> Vec<WebSource> {
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
                    .and_then(clean_label),
                origin,
            })
        })
        .take(20)
        .collect()
}

fn tinyfish_origin(server_id: &str, native_name: &str) -> Option<WebToolName> {
    // Identifiant interne figé du serveur intégré TinyFish.
    if server_id != "tinyfish" {
        return None;
    }
    match native_name {
        "search" => Some(WebToolName::Search),
        "fetch_content" => Some(WebToolName::FetchContent),
        _ => None,
    }
}

fn append_result_text(target: &mut String, target_chars: &mut usize, value: &str) {
    if value.is_empty() || *target_chars >= MAX_RESULT_CHARS {
        return;
    }
    if !target.is_empty() {
        target.push('\n');
        *target_chars += 1;
    }
    let remaining = MAX_RESULT_CHARS.saturating_sub(*target_chars);
    for character in value.chars().take(remaining) {
        target.push(character);
        *target_chars += 1;
    }
}

fn normalize_resource_link(resource: rmcp::model::Resource) -> Option<McpResourceLink> {
    if resource.uri.chars().count() > MAX_RESOURCE_URI_CHARS
        || validate_public_web_url(&resource.uri).is_err()
    {
        return None;
    }
    Some(McpResourceLink {
        uri: resource.uri,
        name: clean_label(&resource.name),
        description: resource.description.as_deref().and_then(clean_label),
        mime_type: resource.mime_type.as_deref().and_then(clean_label),
    })
}

fn bounded_structured_content(value: Option<Value>) -> (Option<Value>, bool) {
    let Some(candidate) = value else {
        return (None, false);
    };
    let retained = serde_json::to_string(&candidate).is_ok_and(|serialized| {
        serialized.chars().take(MAX_RESULT_CHARS + 1).count() <= MAX_RESULT_CHARS
    });
    if retained {
        (Some(candidate), false)
    } else {
        (None, true)
    }
}

fn media_refusal_marker(reason: MediaRefusal) -> &'static str {
    match reason {
        MediaRefusal::DisallowedMime | MediaRefusal::InvalidBase64 => OMITTED_BINARY_MARKER,
        MediaRefusal::TooLarge => "[Média omis : trop grand]",
    }
}

/// Pousse un média accepté, sinon dépose le marqueur de refus. Le type du
/// média est déduit du bloc d'origine : un serveur mentant (Image avec MIME
/// audio) est refusé par la validation elle-même, pas reclassé.
fn push_media(
    media: &mut Vec<McpMedia>,
    content: &mut String,
    content_chars: &mut usize,
    expected_kind: &str,
    mime_type: &str,
    base64: &str,
) {
    match validate_media_block(expected_kind, mime_type, base64) {
        Ok(()) => {
            if media.len() >= MAX_MEDIA_PER_RESULT {
                append_result_text(content, content_chars, OMITTED_BINARY_MARKER);
                return;
            }
            media.push(match expected_kind {
                "image" => McpMedia::Image {
                    mime_type: mime_type.to_owned(),
                    base64: base64.to_owned(),
                },
                _ => McpMedia::Audio {
                    mime_type: mime_type.to_owned(),
                    base64: base64.to_owned(),
                },
            });
        }
        Err(reason) => append_result_text(content, content_chars, media_refusal_marker(reason)),
    }
}

/// Convertit un résultat MCP distant en un contrat local borné. Les blocs
/// image/audio respectant la liste fermée de MIME et la borne de taille sont
/// retenus dans `media` ; le repli « binaire omis » reste actif pour tout le
/// reste : aucun payload non validé ne franchit le pont Rust→React.
pub fn normalize_tool_result(
    server_id: &str,
    native_name: &str,
    result: CallToolResult,
) -> McpToolResult {
    let sources = tinyfish_origin(server_id, native_name)
        .map(|origin| extract_tinyfish_sources(result.structured_content.as_ref(), origin))
        .unwrap_or_default();
    let (structured_content, structured_omitted) =
        bounded_structured_content(result.structured_content);
    let mut content = String::new();
    let mut content_chars = 0;
    let mut media = Vec::new();
    let mut resource_links = Vec::new();
    if structured_omitted {
        append_result_text(&mut content, &mut content_chars, OMITTED_STRUCTURED_MARKER);
    }

    for block in result.content {
        match block {
            ContentBlock::Text(text) => {
                append_result_text(&mut content, &mut content_chars, &text.text);
            }
            ContentBlock::Image(image) => {
                push_media(
                    &mut media,
                    &mut content,
                    &mut content_chars,
                    "image",
                    &image.mime_type,
                    &image.data,
                );
            }
            ContentBlock::Audio(audio) => {
                push_media(
                    &mut media,
                    &mut content,
                    &mut content_chars,
                    "audio",
                    &audio.mime_type,
                    &audio.data,
                );
            }
            ContentBlock::Resource(resource) => match resource.resource {
                ResourceContents::TextResourceContents { text, .. } => {
                    append_result_text(&mut content, &mut content_chars, &text);
                }
                ResourceContents::BlobResourceContents { mime_type, blob, .. } => {
                    // Un blob ne porte pas son genre : le MIME seul décide
                    // (image/* → image, audio/* → audio, sinon marqueur).
                    let mime = mime_type.as_deref().unwrap_or("");
                    let kind = if mime.starts_with("image/") {
                        "image"
                    } else if mime.starts_with("audio/") {
                        "audio"
                    } else {
                        ""
                    };
                    if kind.is_empty() {
                        append_result_text(&mut content, &mut content_chars, OMITTED_BINARY_MARKER);
                    } else {
                        push_media(&mut media, &mut content, &mut content_chars, kind, mime, &blob);
                    }
                }
                _ => {
                    append_result_text(&mut content, &mut content_chars, OMITTED_BINARY_MARKER);
                }
            },
            ContentBlock::ResourceLink(resource) => {
                if resource_links.len() < MAX_RESOURCE_LINKS
                    && let Some(link) = normalize_resource_link(resource)
                {
                    resource_links.push(link);
                }
            }
            _ => append_result_text(&mut content, &mut content_chars, OMITTED_BINARY_MARKER),
        }
    }

    McpToolResult {
        content,
        structured_content,
        media,
        resource_links,
        sources,
        is_error: result.is_error.unwrap_or(false),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::error::Error as StdError;
    use std::fmt;
    use std::io::{Read, Write};
    use std::net::SocketAddr;
    use std::sync::Arc;
    use std::sync::Mutex as StdMutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::thread;
    use std::time::Duration;

    use http::{HeaderName, StatusCode};
    use rmcp::model::{
        CallToolResult, ClientJsonRpcMessage, ClientRequest, ContentBlock, ErrorCode, ErrorData,
        PingRequest, ProtocolVersion, RequestId, Resource, ResourceContents, Tool, ToolAnnotations,
    };
    use rmcp::service::{ClientInitializeError, ClientLifecycleMode, ServiceError};
    use rmcp::transport::DynamicTransportError;
    use rmcp::transport::streamable_http_client::{
        AuthRequiredError, HttpStatusError, InsufficientScopeError, StreamableHttpClient,
        StreamableHttpError, StreamableHttpPostResponse,
    };

    use super::*;
    use crate::mcp::security::{
        MAX_CATALOG_BYTES, MAX_MEDIA_BASE64_CHARS, MAX_RESULT_CHARS, MAX_SSE_EVENT_BYTES,
        MAX_TOOLS_PER_SERVER, validate_endpoint_static,
    };
    use crate::mcp::types::{McpAuthConfig, McpMedia, McpRuntimeServer, McpTransportKind};
    use serde_json::json;

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

    enum TestHttpBody {
        ContentLength { declared: usize, body: Vec<u8> },
        Chunked(Vec<Vec<u8>>),
    }

    fn spawn_json_response(
        status: &'static str,
        body: TestHttpBody,
    ) -> (String, thread::JoinHandle<usize>) {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").expect("listener HTTP local disponible");
        let address = listener.local_addr().expect("adresse locale disponible");
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("connexion HTTP reçue");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("timeout de lecture configurable");
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .expect("timeout d'écriture configurable");
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request);
            let mut sent = 0;
            match body {
                TestHttpBody::ContentLength { declared, body } => {
                    write!(
                        stream,
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {declared}\r\nConnection: close\r\n\r\n"
                    )
                    .expect("en-têtes HTTP envoyés");
                    if stream.write_all(&body).is_ok() {
                        sent = body.len();
                    }
                }
                TestHttpBody::Chunked(chunks) => {
                    write!(
                        stream,
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                    )
                    .expect("en-têtes chunked envoyés");
                    for chunk in chunks {
                        if write!(stream, "{:X}\r\n", chunk.len()).is_err()
                            || stream.write_all(&chunk).is_err()
                            || stream.write_all(b"\r\n").is_err()
                            || stream.flush().is_err()
                        {
                            break;
                        }
                        sent += chunk.len();
                    }
                    let _ = stream.write_all(b"0\r\n\r\n");
                }
            }
            let _ = stream.flush();
            sent
        });
        (format!("http://{address}/mcp"), handle)
    }

    fn padded_json_response(size: usize) -> Vec<u8> {
        let mut body = br#"{"jsonrpc":"2.0","id":1,"result":{}}"#.to_vec();
        assert!(body.len() <= size, "taille JSON de test suffisante");
        body.resize(size, b' ');
        body
    }

    fn ping_message() -> ClientJsonRpcMessage {
        ClientJsonRpcMessage::request(
            ClientRequest::PingRequest(PingRequest::default()),
            RequestId::Number(1),
        )
    }

    fn bounded_test_client() -> BoundedReqwestClient {
        let inner = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .expect("client reqwest de test");
        BoundedReqwestClient::new(inner)
    }

    fn assert_fixed_body_limit_error(error: StreamableHttpError<reqwest::Error>, endpoint: &str) {
        match &error {
            StreamableHttpError::UnexpectedServerResponse(message) => {
                assert_eq!(message.as_ref(), MCP_RESPONSE_TOO_LARGE_MESSAGE);
            }
            other => panic!("erreur de taille attendue, reçu {other:?}"),
        }
        let rendered = error.to_string();
        assert!(!rendered.contains(endpoint));
        assert!(!rendered.contains("EXTERNAL-BODY-SECRET"));
    }

    fn schema_with_padding(length: usize) -> Arc<JsonObject> {
        Arc::new(
            json!({ "type": "object", "padding": "x".repeat(length) })
                .as_object()
                .expect("schéma objet")
                .clone(),
        )
    }

    fn remote_tool(name: impl Into<String>) -> Tool {
        Tool::new(name.into(), "Description distante", schema_with_padding(0))
    }

    type ToolPage = Result<(Vec<Tool>, Option<String>), McpErrorPayload>;

    enum FakePages {
        Ready(StdMutex<VecDeque<ToolPage>>),
        Pending,
    }

    struct FakeSession {
        pages: FakePages,
        cursors: StdMutex<Vec<Option<String>>>,
    }

    impl FakeSession {
        fn new(pages: Vec<ToolPage>) -> Self {
            Self {
                pages: FakePages::Ready(StdMutex::new(pages.into())),
                cursors: StdMutex::new(Vec::new()),
            }
        }

        fn pending() -> Self {
            Self {
                pages: FakePages::Pending,
                cursors: StdMutex::new(Vec::new()),
            }
        }

        fn requested_cursors(&self) -> Vec<Option<String>> {
            self.cursors.lock().expect("cursors").clone()
        }
    }

    #[async_trait::async_trait]
    impl McpSession for FakeSession {
        async fn list_tools_page(
            &self,
            cursor: Option<String>,
        ) -> Result<(Vec<Tool>, Option<String>), McpErrorPayload> {
            self.cursors.lock().expect("cursors").push(cursor);
            match &self.pages {
                FakePages::Ready(pages) => pages
                    .lock()
                    .expect("pages")
                    .pop_front()
                    .expect("page de test disponible"),
                FakePages::Pending => std::future::pending().await,
            }
        }

        async fn call_tool(
            &self,
            _name: &str,
            _arguments: serde_json::Map<String, Value>,
        ) -> Result<rmcp::model::CallToolResult, McpErrorPayload> {
            panic!("aucun appel d'outil attendu pendant la découverte")
        }

        async fn close(&self) {}
    }

    fn assert_generic_invalid_response(error: &McpErrorPayload, external: &str) {
        assert_eq!(error.kind, McpErrorKind::InvalidResponse);
        if !external.is_empty() {
            assert!(!error.message.contains(external));
        }
    }

    fn expected_descriptor(tool: &Tool) -> super::super::types::McpToolDescriptor {
        super::super::types::McpToolDescriptor {
            native_name: tool.name.to_string(),
            title: tool.title.clone(),
            description: tool.description.as_ref().map(ToString::to_string),
            input_schema: Value::Object(tool.input_schema.as_ref().clone()),
            output_schema: tool
                .output_schema
                .as_ref()
                .map(|schema| Value::Object(schema.as_ref().clone())),
            annotations: tool
                .annotations
                .as_ref()
                .map(|annotations| serde_json::to_value(annotations).expect("annotations")),
            // Le contenu du digest n'affecte pas la taille JSON : uniquement sa longueur fixe.
            schema_hash: format!("sha256:{}", "0".repeat(64)),
        }
    }

    fn serialized_descriptor_catalog_size(tools: &[Tool]) -> usize {
        let descriptors: Vec<_> = tools.iter().map(expected_descriptor).collect();
        serde_json::to_vec(&descriptors)
            .expect("catalogue attendu sérialisable")
            .len()
    }

    fn call_result(
        content: Vec<ContentBlock>,
        structured_content: Option<Value>,
        is_error: Option<bool>,
    ) -> CallToolResult {
        let mut result = CallToolResult::default();
        result.content = content;
        result.structured_content = structured_content;
        result.is_error = is_error;
        result
    }

    fn web_resource(uri: impl Into<String>, name: impl Into<String>) -> ContentBlock {
        ContentBlock::resource_link(Resource::new(uri, name))
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
    async fn bounded_client_rejects_json_content_length_before_reading_the_body() {
        let (endpoint, server_thread) = spawn_json_response(
            "200 OK",
            TestHttpBody::ContentLength {
                declared: MAX_MCP_JSON_BODY_BYTES + 1,
                body: b"EXTERNAL-BODY-SECRET".to_vec(),
            },
        );

        let error = bounded_test_client()
            .post_message(
                Arc::from(endpoint.as_str()),
                ping_message(),
                None,
                None,
                HashMap::new(),
            )
            .await
            .expect_err("Content-Length dépasse la limite");

        server_thread.join().expect("serveur local terminé");
        assert_fixed_body_limit_error(error, &endpoint);
    }

    #[tokio::test]
    async fn bounded_client_stops_a_chunked_json_body_at_the_limit() {
        let mut body = b"EXTERNAL-BODY-SECRET".to_vec();
        body.resize(MAX_MCP_JSON_BODY_BYTES + 1, b'x');
        let chunks = body.chunks(16 * 1024).map(<[u8]>::to_vec).collect();
        let (endpoint, server_thread) =
            spawn_json_response("200 OK", TestHttpBody::Chunked(chunks));

        let error = bounded_test_client()
            .post_message(
                Arc::from(endpoint.as_str()),
                ping_message(),
                None,
                None,
                HashMap::new(),
            )
            .await
            .expect_err("le compteur chunked dépasse la limite");

        let sent = server_thread.join().expect("serveur local terminé");
        assert!(sent >= MAX_MCP_JSON_BODY_BYTES);
        assert_fixed_body_limit_error(error, &endpoint);
    }

    #[tokio::test]
    async fn bounded_client_accepts_the_exact_json_limit_and_decodes_a_normal_response() {
        for body in [
            padded_json_response(MAX_MCP_JSON_BODY_BYTES),
            padded_json_response(256),
        ] {
            let declared = body.len();
            let (endpoint, server_thread) =
                spawn_json_response("200 OK", TestHttpBody::ContentLength { declared, body });

            let response = bounded_test_client()
                .post_message(
                    Arc::from(endpoint.as_str()),
                    ping_message(),
                    None,
                    None,
                    HashMap::new(),
                )
                .await
                .expect("JSON borné décodé");

            server_thread.join().expect("serveur local terminé");
            assert!(matches!(response, StreamableHttpPostResponse::Json(..)));
        }
    }

    #[tokio::test]
    async fn bounded_client_rejects_oversized_http_errors_without_body_or_url() {
        for (status, session_id) in [
            ("400 Bad Request", None),
            ("401 Unauthorized", None),
            ("403 Forbidden", None),
            ("404 Not Found", Some(Arc::<str>::from("session-1"))),
            ("429 Too Many Requests", None),
            ("500 Internal Server Error", None),
        ] {
            let (endpoint, server_thread) = spawn_json_response(
                status,
                TestHttpBody::ContentLength {
                    declared: MAX_MCP_JSON_BODY_BYTES + 1,
                    body: b"EXTERNAL-BODY-SECRET".to_vec(),
                },
            );

            let error = bounded_test_client()
                .post_message(
                    Arc::from(endpoint.as_str()),
                    ping_message(),
                    session_id,
                    None,
                    HashMap::new(),
                )
                .await
                .expect_err("erreur HTTP surdimensionnée refusée");

            server_thread.join().expect("serveur local terminé");
            assert_fixed_body_limit_error(error, &endpoint);
        }
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

    #[tokio::test]
    async fn discovery_follows_every_cursor_and_preserves_page_order() {
        let session = FakeSession::new(vec![
            Ok((vec![remote_tool("alpha")], Some("page-2".to_owned()))),
            Ok((vec![remote_tool("beta")], Some("page-3".to_owned()))),
            Ok((vec![remote_tool("gamma")], None)),
        ]);

        let tools = discover_tools(&session).await.expect("découverte valide");

        assert_eq!(
            tools
                .iter()
                .map(|tool| tool.native_name.as_str())
                .collect::<Vec<_>>(),
            ["alpha", "beta", "gamma"]
        );
        assert_eq!(
            session.requested_cursors(),
            [None, Some("page-2".to_owned()), Some("page-3".to_owned())]
        );
    }

    #[tokio::test]
    async fn discovery_accepts_exact_page_and_tool_limits() {
        let pages = (0..32)
            .map(|page| {
                let tools = (0..8)
                    .map(|index| remote_tool(format!("tool-{page}-{index}")))
                    .collect();
                let cursor = (page < 31).then(|| format!("page-{}", page + 2));
                Ok((tools, cursor))
            })
            .collect();
        let session = FakeSession::new(pages);

        let tools = discover_tools(&session)
            .await
            .expect("32 pages et 256 outils sont permis");

        assert_eq!(tools.len(), MAX_TOOLS_PER_SERVER);
        assert_eq!(session.requested_cursors().len(), 32);
    }

    #[tokio::test]
    async fn discovery_rejects_a_page_beyond_the_limit_without_requesting_it() {
        let pages = (0..33)
            .map(|page| {
                let cursor = (page < 32).then(|| format!("cursor-{page}"));
                Ok((Vec::new(), cursor))
            })
            .collect();
        let session = FakeSession::new(pages);

        let error = discover_tools(&session)
            .await
            .expect_err("une 33e page est interdite");

        assert_generic_invalid_response(&error, "cursor-31");
        assert_eq!(session.requested_cursors().len(), 32);
    }

    #[tokio::test]
    async fn discovery_rejects_repeated_cursors_and_tool_overflow() {
        let looped = FakeSession::new(vec![
            Ok((Vec::new(), Some("same-cursor".to_owned()))),
            Ok((Vec::new(), Some("same-cursor".to_owned()))),
        ]);
        let loop_error = discover_tools(&looped)
            .await
            .expect_err("un curseur répété forme une boucle");
        assert_generic_invalid_response(&loop_error, "same-cursor");

        let overflow = FakeSession::new(vec![Ok((
            (0..=MAX_TOOLS_PER_SERVER)
                .map(|index| remote_tool(format!("tool-{index}")))
                .collect(),
            None,
        ))]);
        let overflow_error = discover_tools(&overflow)
            .await
            .expect_err("257 outils sont interdits");
        assert_generic_invalid_response(&overflow_error, "tool-256");
    }

    #[tokio::test]
    async fn discovery_rejects_duplicate_empty_long_and_control_names() {
        let cases = vec![
            vec![remote_tool("duplicate"), remote_tool("duplicate")],
            vec![remote_tool("")],
            vec![remote_tool("   ")],
            vec![remote_tool("x".repeat(129))],
            vec![remote_tool("unsafe\nname")],
        ];

        for tools in cases {
            let external = tools[0].name.to_string();
            let session = FakeSession::new(vec![Ok((tools, None))]);
            let error = discover_tools(&session)
                .await
                .expect_err("nom distant invalide");
            assert_generic_invalid_response(&error, &external);
        }
    }

    #[tokio::test]
    async fn discovery_validates_both_input_and_output_schemas() {
        fn too_deep_schema() -> Arc<JsonObject> {
            let mut nested = json!({ "type": "string" });
            for _ in 0..40 {
                nested = json!({ "items": nested });
            }
            Arc::new(nested.as_object().expect("schéma objet").clone())
        }

        let mut invalid_input = remote_tool("invalid-input");
        invalid_input.input_schema = too_deep_schema();
        let mut invalid_output = remote_tool("invalid-output");
        invalid_output.output_schema = Some(too_deep_schema());

        for (tool, external) in [
            (invalid_input, "invalid-input"),
            (invalid_output, "invalid-output"),
        ] {
            let session = FakeSession::new(vec![Ok((vec![tool], None))]);
            let error = discover_tools(&session)
                .await
                .expect_err("schéma distant invalide");
            assert_generic_invalid_response(&error, external);
        }
    }

    #[tokio::test]
    async fn discovery_cleans_and_bounds_untrusted_labels_and_annotations() {
        let mut tool = remote_tool("labels");
        tool.title = Some(format!("  Titre\n{}  ", "t".repeat(700)));
        tool.description = Some(format!("  Description\r{}  ", "d".repeat(700)).into());
        tool.annotations = Some(ToolAnnotations::with_title(format!(
            "  Annotation\t{}  ",
            "a".repeat(700)
        )));
        let original = tool.clone();
        let session = FakeSession::new(vec![Ok((vec![tool], None))]);

        let descriptors = discover_tools(&session).await.expect("outil nettoyé");
        let descriptor = &descriptors[0];

        for label in [
            descriptor.title.as_ref().expect("titre"),
            descriptor.description.as_ref().expect("description"),
            descriptor.annotations.as_ref().expect("annotations")["title"]
                .as_str()
                .expect("titre d'annotation"),
        ] {
            assert!(label.chars().count() <= 500);
            assert!(!label.chars().any(char::is_control));
            assert_eq!(label, label.trim());
        }
        assert_eq!(
            original.title.as_deref(),
            Some(format!("  Titre\n{}  ", "t".repeat(700)).as_str())
        );
    }

    #[tokio::test]
    async fn discovery_hash_covers_the_complete_contract_and_has_a_known_digest() {
        async fn hash(tool: Tool) -> String {
            let session = FakeSession::new(vec![Ok((vec![tool], None))]);
            discover_tools(&session).await.expect("hash calculé")[0]
                .schema_hash
                .clone()
        }

        let base = remote_tool("known");
        let repeated = base.clone();
        let renamed = remote_tool("renamed");
        let mut changed_input = base.clone();
        changed_input.input_schema = schema_with_padding(1);
        let mut changed_output = base.clone();
        changed_output.output_schema = Some(schema_with_padding(1));
        let mut changed_annotations = base.clone();
        changed_annotations.annotations = Some(ToolAnnotations::new().read_only(true));

        let base_hash = hash(base).await;
        let variants = [
            hash(renamed).await,
            hash(changed_input).await,
            hash(changed_output).await,
            hash(changed_annotations).await,
        ];

        assert_eq!(base_hash, hash(repeated).await);
        assert!(variants.iter().all(|variant| variant != &base_hash));
        assert_eq!(
            base_hash,
            "sha256:07acd62f7cc123c25a109e94110e9e4d049ba93510a0921813b5337234bad5b6"
        );
    }

    #[tokio::test]
    async fn discovery_counts_the_exact_serialized_catalog_envelope() {
        let mut tools: Vec<_> = (0..9)
            .map(|index| {
                let mut tool = remote_tool(format!("catalog-{index}"));
                tool.output_schema = Some(schema_with_padding(0));
                tool
            })
            .collect();
        let initial_size = serialized_descriptor_catalog_size(&tools);
        let mut remaining = MAX_CATALOG_BYTES - initial_size;
        for index in 0..(tools.len() * 2) {
            let padding = remaining.min(60_000);
            if index % 2 == 0 {
                tools[index / 2].input_schema = schema_with_padding(padding);
            } else {
                tools[index / 2].output_schema = Some(schema_with_padding(padding));
            }
            remaining -= padding;
        }
        assert_eq!(remaining, 0, "capacité suffisante pour atteindre 1 Mio");
        assert_eq!(
            serialized_descriptor_catalog_size(&tools),
            MAX_CATALOG_BYTES
        );

        let exact = FakeSession::new(vec![Ok((tools.clone(), None))]);
        assert_eq!(
            discover_tools(&exact)
                .await
                .expect("catalogue exact accepté")
                .len(),
            tools.len()
        );

        match Arc::make_mut(&mut tools[0].input_schema).get_mut("padding") {
            Some(Value::String(padding)) => padding.push('x'),
            _ => panic!("padding de schéma disponible"),
        }
        assert_eq!(
            serialized_descriptor_catalog_size(&tools),
            MAX_CATALOG_BYTES + 1
        );
        let oversized = FakeSession::new(vec![Ok((tools, None))]);
        let error = discover_tools(&oversized)
            .await
            .expect_err("un seul octet au-delà est interdit");
        assert_generic_invalid_response(&error, "catalog-0");
    }

    #[tokio::test(start_paused = true)]
    async fn bounded_discovery_has_a_fixed_fifteen_second_deadline() {
        let session = FakeSession::pending();
        let started_at = tokio::time::Instant::now();

        let error = discover_tools_bounded(&session)
            .await
            .expect_err("la découverte bloquée doit expirer");

        assert_eq!(error.kind, McpErrorKind::Timeout);
        assert_eq!(error.message, public_error_message(McpErrorKind::Timeout));
        assert_eq!(started_at.elapsed(), Duration::from_secs(15));
    }

    #[test]
    fn normalization_preserves_text_structured_json_and_error_state_without_mutation() {
        let raw = call_result(
            vec![ContentBlock::text("premier"), ContentBlock::text("second")],
            Some(json!({ "matches": [1, 2, 3] })),
            Some(true),
        );
        let untouched = raw.clone();

        let normalized = normalize_tool_result("remote-docs", "lookup", raw.clone());

        assert_eq!(raw, untouched);
        assert_eq!(normalized.content, "premier\nsecond");
        assert_eq!(
            normalized.structured_content,
            Some(json!({ "matches": [1, 2, 3] }))
        );
        assert!(normalized.resource_links.is_empty());
        assert!(normalized.sources.is_empty());
        assert!(normalized.media.is_empty());
        assert!(normalized.is_error);
    }

    #[test]
    fn normalization_accepts_bounded_media_and_keeps_markers_for_the_rest() {
        let raw = call_result(
            vec![
                ContentBlock::text("avant"),
                // Longueur multiple de 4 : le base64 doit être VALIDE pour que
                // le test démontre que le payload accepté ne fuit jamais dans
                // le texte injecté au LLM.
                ContentBlock::image("IMAGE-BASE64", "image/png"),
                ContentBlock::audio("AUDIO-BASE64", "audio/wav"),
                ContentBlock::resource(ResourceContents::blob(
                    "RESOURCE-BASE64-SECRET",
                    "https://example.com/blob",
                )),
                ContentBlock::resource(ResourceContents::text(
                    "ressource textuelle",
                    "https://example.com/text",
                )),
                ContentBlock::text("après"),
            ],
            None,
            None,
        );

        let normalized = normalize_tool_result("remote-docs", "lookup", raw);

        // Aucun payload binaire ne fuit dans le contenu textuel injecté au LLM.
        for secret in ["IMAGE-BASE64", "AUDIO-BASE64", "RESOURCE-BASE64-SECRET"] {
            assert!(!normalized.content.contains(secret));
        }
        assert!(normalized.content.contains("avant"));
        assert!(normalized.content.contains("ressource textuelle"));
        assert!(normalized.content.contains("après"));
        // Uniquement le blob sans MIME reste omis.
        assert_eq!(
            normalized.content.matches("[Contenu binaire omis]").count(),
            1
        );

        // Les médias valides sont portés par le champ dédié.
        assert_eq!(normalized.media.len(), 2);
        assert_eq!(
            normalized.media[0],
            McpMedia::Image {
                mime_type: "image/png".to_owned(),
                base64: "IMAGE-BASE64".to_owned(),
            }
        );
        assert_eq!(
            normalized.media[1],
            McpMedia::Audio {
                mime_type: "audio/wav".to_owned(),
                base64: "AUDIO-BASE64".to_owned(),
            }
        );
        assert!(!normalized.is_error);
    }

    #[test]
    fn normalization_refuses_lying_oversized_and_invalid_medias() {
        let oversized = "A".repeat(MAX_MEDIA_BASE64_CHARS + 4);
        let raw = call_result(
            vec![
                ContentBlock::text("texte conservé"),
                // Bloc Image « menteur » portant un MIME audio.
                ContentBlock::image("AAEB", "audio/mpeg"),
                // Base64 valide mais au-delà de la borne.
                ContentBlock::image(oversized.as_str(), "image/png"),
                // Longueur non multiple de 4.
                ContentBlock::image("AAA", "image/png"),
            ],
            None,
            None,
        );

        let normalized = normalize_tool_result("remote-docs", "lookup", raw);

        // Aucun média n'est retenu ; les marqueurs décrivent les refus sans
        // jamais livrer le base64.
        assert_eq!(normalized.media.len(), 0);
        assert_eq!(
            normalized.content.matches("[Contenu binaire omis]").count(),
            2
        );
        assert!(normalized.content.contains("[Média omis : trop grand]"));
        assert!(normalized.content.contains("texte conservé"));
    }

    #[test]
    fn normalization_caps_media_at_the_quota_of_eight() {
        // Payloads de 4 caractères : multiple de 4, alphabet standard.
        let raw = call_result(
            (0..9)
                .map(|index| ContentBlock::image(format!("AAE{index}"), "image/png"))
                .collect::<Vec<_>>(),
            None,
            None,
        );

        let normalized = normalize_tool_result("remote-docs", "lookup", raw);

        assert_eq!(normalized.media.len(), 8);
        assert_eq!(
            normalized.content.matches("[Contenu binaire omis]").count(),
            1
        );
    }

    #[test]
    fn normalization_keeps_only_safe_bounded_resource_links_and_twenty_valid_items() {
        let exact_uri = format!(
            "https://example.com/{}",
            "a".repeat(2_048 - "https://example.com/".len())
        );
        let oversized_uri = format!("{exact_uri}x");
        let mut content = vec![
            web_resource("javascript:alert(1)", "script"),
            web_resource("file:///etc/passwd", "file"),
            web_resource("http://127.0.0.1/private", "private"),
            web_resource(oversized_uri, "oversized"),
            ContentBlock::resource_link(
                Resource::new(&exact_uri, format!("  Nom\n{}  ", "n".repeat(700)))
                    .with_description(format!("  Description\r{}  ", "d".repeat(700)))
                    .with_mime_type(format!("  text/plain\t{}  ", "m".repeat(700))),
            ),
        ];
        content.extend(
            (0..25).map(|index| web_resource(format!("https://example.com/{index}"), "doc")),
        );

        let normalized =
            normalize_tool_result("remote-docs", "lookup", call_result(content, None, None));

        assert_eq!(normalized.resource_links.len(), 20);
        let exact = &normalized.resource_links[0];
        assert_eq!(exact.uri, exact_uri);
        for metadata in [
            exact.name.as_deref().expect("nom"),
            exact.description.as_deref().expect("description"),
            exact.mime_type.as_deref().expect("type MIME"),
        ] {
            assert!(metadata.chars().count() <= 500);
            assert!(!metadata.chars().any(char::is_control));
            assert_eq!(metadata, metadata.trim());
        }
        assert!(
            normalized
                .resource_links
                .iter()
                .all(|link| link.uri.starts_with("https://example.com/"))
        );
    }

    #[test]
    fn normalization_accepts_exact_result_limits_and_bounds_overflows() {
        let exact_text = "é".repeat(MAX_RESULT_CHARS);
        let exact_json = Value::String("x".repeat(MAX_RESULT_CHARS - 2));
        assert_eq!(exact_json.to_string().chars().count(), MAX_RESULT_CHARS);
        let exact = normalize_tool_result(
            "remote-docs",
            "lookup",
            call_result(
                vec![ContentBlock::text(exact_text.clone())],
                Some(exact_json.clone()),
                None,
            ),
        );
        assert_eq!(exact.content, exact_text);
        assert_eq!(exact.structured_content, Some(exact_json));

        let overflow = normalize_tool_result(
            "remote-docs",
            "lookup",
            call_result(
                vec![ContentBlock::text("é".repeat(MAX_RESULT_CHARS + 1))],
                Some(Value::String("x".repeat(MAX_RESULT_CHARS - 1))),
                None,
            ),
        );
        assert_eq!(overflow.content.chars().count(), MAX_RESULT_CHARS);
        assert!(overflow.structured_content.is_none());
    }

    #[test]
    fn normalization_marks_an_omitted_structured_result_even_without_text() {
        let normalized = normalize_tool_result(
            "remote-docs",
            "lookup",
            call_result(
                Vec::new(),
                Some(Value::String("x".repeat(MAX_RESULT_CHARS))),
                None,
            ),
        );

        assert!(normalized.structured_content.is_none());
        assert_eq!(normalized.content, "[Contenu structuré omis]");
        assert!(normalized.content.chars().count() <= MAX_RESULT_CHARS);
    }

    #[test]
    fn normalization_extracts_sources_only_for_exact_tinyfish_tool_mappings() {
        let structured = json!({
            "results": [{
                "url": "https://example.com/doc",
                "title": "Documentation"
            }]
        });
        let cases = [
            (
                "tinyfish",
                "search",
                Some(super::super::types::WebToolName::Search),
            ),
            (
                "tinyfish",
                "fetch_content",
                Some(super::super::types::WebToolName::FetchContent),
            ),
            ("tinyfish", "other", None),
            ("remote-docs", "search", None),
            ("TinyFish", "search", None),
        ];

        for (server_id, native_name, expected_origin) in cases {
            let normalized = normalize_tool_result(
                server_id,
                native_name,
                call_result(Vec::new(), Some(structured.clone()), None),
            );
            match expected_origin {
                Some(origin) => {
                    assert_eq!(normalized.sources.len(), 1);
                    assert_eq!(normalized.sources[0].origin, origin);
                    assert_eq!(normalized.sources[0].url, "https://example.com/doc");
                }
                None => assert!(normalized.sources.is_empty()),
            }
        }
    }

    #[test]
    fn extracted_sources_reject_unsafe_urls_and_bound_metadata() {
        let structured = json!({
            "results": [
                { "url": "javascript:alert(1)", "title": "danger" },
                { "url": "file:///etc/passwd", "title": "local" },
                {
                    "url": "https://example.com",
                    "title": format!("  Documentation\n{}  ", "x".repeat(700))
                }
            ]
        });
        let sources =
            extract_tinyfish_sources(Some(&structured), super::super::types::WebToolName::Search);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].url, "https://example.com");
        let title = sources[0].title.as_ref().expect("title");
        assert!(title.chars().count() <= 500);
        assert_eq!(title, title.trim());
        assert!(!title.chars().any(char::is_control));
    }
}
