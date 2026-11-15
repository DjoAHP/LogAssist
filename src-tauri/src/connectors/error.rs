// Erreurs publiques du connecteur — jamais de corps HTTP, URL, headers, jeton.

use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub struct ConnectorErrorPayload {
    pub kind: ConnectorErrorKind,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorErrorKind {
    NotConfigured,
    Auth,
    Forbidden,
    RateLimit,
    NotFound,
    TooLarge,
    Binary,
    DeniedPath,
    Offline,
    Timeout,
    InvalidArguments,
    Unknown,
}

impl std::fmt::Display for ConnectorErrorKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::error::Error for ConnectorErrorKind {}

#[derive(Debug, Error)]
pub enum ConnectorError {
    #[error("Non configuré: {0}")]
    NotConfigured(String),
    #[error("Authentification refusée: {0}")]
    Auth(String),
    #[error("Accès interdit: {0}")]
    Forbidden(String),
    #[error("Limite de débit: {0}")]
    RateLimit(String),
    #[error("Non trouvé: {0}")]
    NotFound(String),
    #[error("Trop volumineux: {0}")]
    TooLarge(String),
    #[error("Binaire: {0}")]
    Binary(String),
    #[error("Chemin refusé: {0}")]
    DeniedPath(String),
    #[error("Hors ligne: {0}")]
    Offline(String),
    #[error("Timeout: {0}")]
    Timeout(String),
    #[error("Arguments invalides: {0}")]
    InvalidArguments(String),
    #[error("Erreur inconnue: {0}")]
    Unknown(String),
}

impl From<ConnectorError> for ConnectorErrorPayload {
    fn from(err: ConnectorError) -> Self {
        let (kind, message) = match err {
            ConnectorError::NotConfigured(m) => (ConnectorErrorKind::NotConfigured, m),
            ConnectorError::Auth(m) => (ConnectorErrorKind::Auth, m),
            ConnectorError::Forbidden(m) => (ConnectorErrorKind::Forbidden, m),
            ConnectorError::RateLimit(m) => (ConnectorErrorKind::RateLimit, m),
            ConnectorError::NotFound(m) => (ConnectorErrorKind::NotFound, m),
            ConnectorError::TooLarge(m) => (ConnectorErrorKind::TooLarge, m),
            ConnectorError::Binary(m) => (ConnectorErrorKind::Binary, m),
            ConnectorError::DeniedPath(m) => (ConnectorErrorKind::DeniedPath, m),
            ConnectorError::Offline(m) => (ConnectorErrorKind::Offline, m),
            ConnectorError::Timeout(m) => (ConnectorErrorKind::Timeout, m),
            ConnectorError::InvalidArguments(m) => (ConnectorErrorKind::InvalidArguments, m),
            ConnectorError::Unknown(m) => (ConnectorErrorKind::Unknown, m),
        };
        Self { kind, message }
    }
}

// Classification d'erreurs reqwest/http vers ConnectorErrorKind
pub fn classify_reqwest_error(err: &reqwest::Error) -> ConnectorErrorKind {
    if err.is_timeout() {
        return ConnectorErrorKind::Timeout;
    }
    if err.is_connect() || err.is_request() {
        return ConnectorErrorKind::Offline;
    }
    if let Some(status) = err.status() {
        match status.as_u16() {
            401 => ConnectorErrorKind::Auth,
            403 => ConnectorErrorKind::Forbidden,
            404 => ConnectorErrorKind::NotFound,
            429 => ConnectorErrorKind::RateLimit,
            413 => ConnectorErrorKind::TooLarge,
            500..=599 => ConnectorErrorKind::Offline,
            _ => ConnectorErrorKind::Unknown,
        }
    } else {
        ConnectorErrorKind::Unknown
    }
}