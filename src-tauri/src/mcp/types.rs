use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type JsonObject = Map<String, Value>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpServerId {
    Tinyfish,
}

impl McpServerId {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Tinyfish => "tinyfish",
        }
    }
}

#[derive(Debug)]
pub struct McpServerDefinition {
    pub id: McpServerId,
    pub endpoint: &'static str,
    pub allowed_tools: &'static [WebToolName],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WebToolName {
    Search,
    FetchContent,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "tool", content = "arguments", rename_all = "snake_case")]
pub enum WebToolRequest {
    Search {
        query: String,
        purpose: Option<String>,
    },
    FetchContent {
        urls: Vec<String>,
        purpose: Option<String>,
    },
}

impl WebToolRequest {
    pub const fn tool_name(&self) -> WebToolName {
        match self {
            Self::Search { .. } => WebToolName::Search,
            Self::FetchContent { .. } => WebToolName::FetchContent,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct WebSource {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub origin: WebToolName,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct WebToolResult {
    pub content: String,
    pub sources: Vec<WebSource>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpTransportKind {
    StreamableHttp,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpAuthConfig {
    None,
    Bearer,
    ApiKey { header: String },
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRuntimeTool {
    pub native_name: String,
    pub input_schema: Value,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpRuntimeServer {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub transport: McpTransportKind,
    pub auth: McpAuthConfig,
    pub timeout_ms: u64,
    pub enabled: bool,
    pub builtin: bool,
    pub tools: Vec<McpRuntimeTool>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub native_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<Value>,
    pub schema_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpAuthStatus {
    NotRequired,
    Missing,
    Configured,
    Stale,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpResourceLink {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolResult {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub structured_content: Option<Value>,
    pub resource_links: Vec<McpResourceLink>,
    pub sources: Vec<WebSource>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpErrorKind {
    NotConfigured,
    InvalidConfig,
    Auth,
    Offline,
    Timeout,
    RateLimit,
    ToolNotFound,
    ToolDenied,
    InvalidArguments,
    Protocol,
    InvalidResponse,
    Cancelled,
    Unknown,
    Network,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct McpErrorPayload {
    pub kind: McpErrorKind,
    pub message: String,
}

impl McpErrorPayload {
    pub fn new(kind: McpErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn tool_denied(message: impl Into<String>) -> Self {
        Self::new(McpErrorKind::ToolDenied, message)
    }

    pub fn auth(message: impl Into<String>) -> Self {
        Self::new(McpErrorKind::Auth, message)
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self::new(McpErrorKind::Unknown, message)
    }

    pub fn cancelled() -> Self {
        Self::new(McpErrorKind::Cancelled, "Requête MCP annulée")
    }

    /// Rédige un secret qui aurait fuité dans le message d'erreur.
    pub fn redact(self, secret: &str) -> Self {
        if secret.is_empty() {
            return self;
        }
        Self {
            kind: self.kind,
            message: self.message.replace(secret, "[rédigé]"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn runtime_server_deserializes_camel_case_fields_with_snake_case_api_key_auth() {
        let server: McpRuntimeServer = serde_json::from_value(json!({
            "id": "remote-docs",
            "name": "Documentation distante",
            "endpoint": "https://mcp.example.com",
            "transport": "streamable_http",
            "auth": {
                "type": "api_key",
                "header": "X-API-Key"
            },
            "timeoutMs": 15_000,
            "enabled": true,
            "builtin": false,
            "tools": []
        }))
        .expect("serveur valide");

        assert_eq!(server.timeout_ms, 15_000);
        assert_eq!(
            server.auth,
            McpAuthConfig::ApiKey {
                header: "X-API-Key".to_owned()
            }
        );
    }

    #[test]
    fn auth_and_transport_round_trip_with_protocol_names() {
        let auth_cases = [
            (McpAuthConfig::None, json!({ "type": "none" })),
            (McpAuthConfig::Bearer, json!({ "type": "bearer" })),
            (
                McpAuthConfig::ApiKey {
                    header: "X-API-Key".to_owned(),
                },
                json!({ "type": "api_key", "header": "X-API-Key" }),
            ),
        ];

        for (auth, expected) in auth_cases {
            let serialized = serde_json::to_value(&auth).expect("auth sérialisable");
            assert_eq!(serialized, expected);
            assert_eq!(
                serde_json::from_value::<McpAuthConfig>(serialized).expect("auth désérialisable"),
                auth
            );
        }

        let transport = McpTransportKind::StreamableHttp;
        let serialized = serde_json::to_value(&transport).expect("transport sérialisable");
        assert_eq!(serialized, json!("streamable_http"));
        assert_eq!(
            serde_json::from_value::<McpTransportKind>(serialized)
                .expect("transport désérialisable"),
            transport
        );
    }

    #[test]
    fn runtime_tool_and_server_round_trip_with_input_schema() {
        let input_schema = json!({
            "type": "object",
            "properties": {
                "query": { "type": "string" }
            },
            "required": ["query"]
        });
        let server = McpRuntimeServer {
            id: "remote-docs".to_owned(),
            name: "Documentation distante".to_owned(),
            endpoint: "https://mcp.example.com".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth: McpAuthConfig::Bearer,
            timeout_ms: 20_000,
            enabled: true,
            builtin: false,
            tools: vec![McpRuntimeTool {
                native_name: "search".to_owned(),
                input_schema: input_schema.clone(),
                enabled: true,
            }],
        };

        let serialized = serde_json::to_value(&server).expect("serveur sérialisable");
        assert_eq!(serialized["tools"][0]["inputSchema"], input_schema);
        assert_eq!(
            serde_json::from_value::<McpRuntimeServer>(serialized).expect("serveur désérialisable"),
            server
        );
    }

    #[test]
    fn descriptor_serializes_with_camel_case_fields() {
        let descriptor = McpToolDescriptor {
            native_name: "search".to_owned(),
            title: Some("Recherche".to_owned()),
            description: Some("Recherche documentaire".to_owned()),
            input_schema: json!({ "type": "object" }),
            output_schema: Some(json!({ "type": "object" })),
            annotations: Some(json!({ "readOnlyHint": true })),
            schema_hash: "sha256:test".to_owned(),
        };

        let serialized = serde_json::to_value(&descriptor).expect("descripteur sérialisable");
        assert_eq!(
            serialized,
            json!({
                "nativeName": "search",
                "title": "Recherche",
                "description": "Recherche documentaire",
                "inputSchema": { "type": "object" },
                "outputSchema": { "type": "object" },
                "annotations": { "readOnlyHint": true },
                "schemaHash": "sha256:test"
            })
        );
        assert_eq!(
            serde_json::from_value::<McpToolDescriptor>(serialized)
                .expect("descripteur désérialisable"),
            descriptor
        );
    }

    #[test]
    fn descriptor_omits_absent_optional_fields() {
        let descriptor = McpToolDescriptor {
            native_name: "search".to_owned(),
            title: None,
            description: None,
            input_schema: json!({ "type": "object" }),
            output_schema: None,
            annotations: None,
            schema_hash: "sha256:test".to_owned(),
        };

        let serialized = serde_json::to_value(descriptor).expect("descripteur sérialisable");
        let object = serialized.as_object().expect("objet JSON");

        for key in ["title", "description", "outputSchema", "annotations"] {
            assert!(!object.contains_key(key), "la clé {key} doit être absente");
        }
    }

    #[test]
    fn resource_and_result_serialize_with_camel_case_fields() {
        let result = McpToolResult {
            content: "Résultat".to_owned(),
            structured_content: Some(json!({ "matches": 1 })),
            resource_links: vec![McpResourceLink {
                uri: "https://example.com/doc".to_owned(),
                name: Some("Documentation".to_owned()),
                description: Some("Guide MCP".to_owned()),
                mime_type: Some("text/html".to_owned()),
            }],
            sources: vec![WebSource {
                url: "https://example.com/doc".to_owned(),
                title: Some("Documentation".to_owned()),
                origin: WebToolName::Search,
            }],
            is_error: false,
        };

        let serialized = serde_json::to_value(&result).expect("résultat sérialisable");
        assert_eq!(
            serialized,
            json!({
                "content": "Résultat",
                "structuredContent": { "matches": 1 },
                "resourceLinks": [{
                    "uri": "https://example.com/doc",
                    "name": "Documentation",
                    "description": "Guide MCP",
                    "mimeType": "text/html"
                }],
                "sources": [{
                    "url": "https://example.com/doc",
                    "title": "Documentation",
                    "origin": "search"
                }],
                "isError": false
            })
        );
        assert_eq!(
            serde_json::from_value::<McpToolResult>(serialized).expect("résultat désérialisable"),
            result
        );
    }

    #[test]
    fn resource_link_omits_absent_optional_fields() {
        let link = McpResourceLink {
            uri: "https://example.com/doc".to_owned(),
            name: None,
            description: None,
            mime_type: None,
        };

        let serialized = serde_json::to_value(link).expect("lien sérialisable");
        let object = serialized.as_object().expect("objet JSON");

        for key in ["name", "description", "mimeType"] {
            assert!(!object.contains_key(key), "la clé {key} doit être absente");
        }
    }

    #[test]
    fn tool_result_omits_absent_structured_content() {
        let result = McpToolResult {
            content: "Résultat".to_owned(),
            structured_content: None,
            resource_links: Vec::new(),
            sources: Vec::new(),
            is_error: false,
        };

        let serialized = serde_json::to_value(result).expect("résultat sérialisable");
        let object = serialized.as_object().expect("objet JSON");

        assert!(!object.contains_key("structuredContent"));
    }

    #[test]
    fn web_source_omits_absent_title() {
        let source = WebSource {
            url: "https://example.com/doc".to_owned(),
            title: None,
            origin: WebToolName::Search,
        };

        let serialized = serde_json::to_value(source).expect("source sérialisable");
        let object = serialized.as_object().expect("objet JSON");

        assert!(!object.contains_key("title"));
    }

    #[test]
    fn auth_status_uses_all_snake_case_names() {
        let cases = [
            (McpAuthStatus::NotRequired, "not_required"),
            (McpAuthStatus::Missing, "missing"),
            (McpAuthStatus::Configured, "configured"),
            (McpAuthStatus::Stale, "stale"),
        ];

        for (status, expected) in cases {
            assert_eq!(
                serde_json::to_value(status).expect("statut sérialisable"),
                json!(expected)
            );
        }
    }

    #[test]
    fn every_error_kind_uses_the_typescript_contract_name() {
        let cases = [
            (McpErrorKind::NotConfigured, "not_configured"),
            (McpErrorKind::InvalidConfig, "invalid_config"),
            (McpErrorKind::Auth, "auth"),
            (McpErrorKind::Offline, "offline"),
            (McpErrorKind::Timeout, "timeout"),
            (McpErrorKind::RateLimit, "rate_limit"),
            (McpErrorKind::ToolNotFound, "tool_not_found"),
            (McpErrorKind::ToolDenied, "tool_denied"),
            (McpErrorKind::InvalidArguments, "invalid_arguments"),
            (McpErrorKind::Protocol, "protocol"),
            (McpErrorKind::InvalidResponse, "invalid_response"),
            (McpErrorKind::Cancelled, "cancelled"),
            (McpErrorKind::Unknown, "unknown"),
            (McpErrorKind::Network, "network"),
        ];

        for (kind, expected) in cases {
            assert_eq!(
                serde_json::to_value(kind).expect("type d'erreur sérialisable"),
                json!(expected)
            );
        }
    }

    #[test]
    fn new_builds_an_error_with_the_requested_kind_and_message() {
        let error = McpErrorPayload::new(McpErrorKind::Protocol, "trame invalide");

        assert_eq!(error.kind, McpErrorKind::Protocol);
        assert_eq!(error.message, "trame invalide");
    }

    #[test]
    fn cancelled_uses_the_dedicated_error_kind() {
        assert_eq!(McpErrorPayload::cancelled().kind, McpErrorKind::Cancelled);
    }

    #[test]
    fn redact_replaces_every_exact_secret_occurrence() {
        let error = McpErrorPayload::new(
            McpErrorKind::Auth,
            "jeton sk-SECRET refusé; sk-secret diffère; sk-SECRET expiré",
        )
        .redact("sk-SECRET");

        assert_eq!(
            error.message,
            "jeton [rédigé] refusé; sk-secret diffère; [rédigé] expiré"
        );
    }

    #[test]
    fn redact_leaves_the_payload_unchanged_for_an_empty_secret() {
        let error = McpErrorPayload::new(McpErrorKind::Auth, "message sensible");

        assert_eq!(error.clone().redact(""), error);
    }

    #[test]
    fn redact_preserves_the_error_kind() {
        let error = McpErrorPayload::new(McpErrorKind::InvalidArguments, "secret");

        assert_eq!(error.redact("secret").kind, McpErrorKind::InvalidArguments);
    }

    #[test]
    fn json_object_alias_accepts_serde_json_maps() {
        let mut object = JsonObject::new();
        object.insert("enabled".to_owned(), json!(true));

        assert_eq!(object["enabled"], json!(true));
    }

    #[test]
    fn legacy_server_and_tool_names_keep_their_serde_contracts() {
        assert_eq!(
            serde_json::from_value::<McpServerId>(json!("tinyfish")).expect("serveur connu"),
            McpServerId::Tinyfish
        );
        assert_eq!(
            serde_json::from_value::<WebToolName>(json!("fetch_content")).expect("outil connu"),
            WebToolName::FetchContent
        );
        assert!(serde_json::from_value::<McpServerId>(json!("other")).is_err());
        assert!(serde_json::from_value::<WebToolName>(json!("delete_all")).is_err());
    }

    #[test]
    fn legacy_web_tool_request_and_result_keep_their_serde_contracts() {
        let request = WebToolRequest::Search {
            query: "documentation".to_owned(),
            purpose: Some("apprendre".to_owned()),
        };
        let request_json = serde_json::to_value(&request).expect("requête sérialisable");
        assert_eq!(
            request_json,
            json!({
                "tool": "search",
                "arguments": {
                    "query": "documentation",
                    "purpose": "apprendre"
                }
            })
        );
        assert_eq!(
            serde_json::from_value::<WebToolRequest>(request_json)
                .expect("requête désérialisable")
                .tool_name(),
            WebToolName::Search
        );
        assert!(
            serde_json::from_value::<WebToolRequest>(json!({
                "tool": "delete_all",
                "arguments": {}
            }))
            .is_err()
        );

        let result = WebToolResult {
            content: "contenu".to_owned(),
            sources: vec![WebSource {
                url: "https://example.com".to_owned(),
                title: None,
                origin: WebToolName::FetchContent,
            }],
        };
        assert_eq!(
            serde_json::from_value::<WebToolResult>(
                serde_json::to_value(&result).expect("résultat sérialisable")
            )
            .expect("résultat désérialisable"),
            result
        );
    }
}
