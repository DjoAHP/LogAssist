use serde::{Deserialize, Serialize};

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
    pub title: Option<String>,
    pub origin: WebToolName,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct WebToolResult {
    pub content: String,
    pub sources: Vec<WebSource>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpErrorKind {
    NotConfigured,
    Auth,
    RateLimit,
    Timeout,
    Network,
    ToolDenied,
    InvalidResponse,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct McpErrorPayload {
    pub kind: McpErrorKind,
    pub message: String,
}

impl McpErrorPayload {
    pub fn tool_denied(message: impl Into<String>) -> Self {
        Self {
            kind: McpErrorKind::ToolDenied,
            message: message.into(),
        }
    }

    pub fn auth(message: impl Into<String>) -> Self {
        Self {
            kind: McpErrorKind::Auth,
            message: message.into(),
        }
    }

    pub fn unknown(message: impl Into<String>) -> Self {
        Self {
            kind: McpErrorKind::Unknown,
            message: message.into(),
        }
    }

    pub fn cancelled() -> Self {
        Self {
            kind: McpErrorKind::Unknown,
            message: "Requête MCP annulée".to_owned(),
        }
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
