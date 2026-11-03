//! Commandes Tauri MCP : pont fin entre React et la couche service.
//! Toute validation et tout accès au Credential Manager restent côté Rust.

use std::sync::Arc;

use tauri::State;
use tokio::time::Duration;
use tokio_util::sync::CancellationToken;

use crate::mcp::client::{McpService, McpState, SecretStore, TinyfishExecutor, secret_ref_for};
use crate::mcp::transport::RmcpTinyfishClient;
use crate::mcp::types::{
    McpErrorKind, McpErrorPayload, McpServerId, WebToolRequest, WebToolResult,
};

const SEARCH_TIMEOUT: Duration = Duration::from_secs(15);
const FETCH_TIMEOUT: Duration = Duration::from_secs(120);

/// Coffre réel : délègue aux helpers Credential Manager internes.
pub struct CredentialStore;

impl SecretStore for CredentialStore {
    fn get(&self, secret_ref: &str) -> Result<Option<String>, String> {
        crate::commands::secrets::read_secret(secret_ref)
    }
    fn set(&self, secret_ref: &str, value: &str) -> Result<(), String> {
        crate::commands::secrets::write_secret(secret_ref, value)
    }
    fn delete(&self, secret_ref: &str) -> Result<(), String> {
        crate::commands::secrets::remove_secret(secret_ref)
    }
}

/// Exécuteur neutre : les commandes qui ne touchent pas le réseau n'en ont pas.
struct NullExecutor;

#[async_trait::async_trait]
impl TinyfishExecutor for NullExecutor {
    async fn verify(&self, _api_key: &str) -> Result<(), McpErrorPayload> {
        Err(McpErrorPayload::unknown("Vérification non disponible"))
    }
    async fn call(&self, _request: &WebToolRequest) -> Result<WebToolResult, McpErrorPayload> {
        Err(McpErrorPayload::unknown("Appel non disponible"))
    }
}

fn service_with(
    executor: Arc<dyn TinyfishExecutor>,
) -> McpService<dyn TinyfishExecutor, CredentialStore> {
    McpService::new(executor, Arc::new(CredentialStore))
}

/// Retire l'entrée d'annulation à la fin de la portée (succès ou erreur).
struct CancelGuard<'a> {
    state: &'a McpState,
    request_id: String,
}

impl Drop for CancelGuard<'_> {
    fn drop(&mut self) {
        self.state.remove(&self.request_id);
    }
}

fn register_request<'a>(
    state: &'a McpState,
    request_id: &str,
) -> (CancellationToken, CancelGuard<'a>) {
    let token = state.register(request_id);
    let guard = CancelGuard {
        state,
        request_id: request_id.to_owned(),
    };
    (token, guard)
}

#[tauri::command]
pub fn mcp_has_secret(server_id: McpServerId) -> Result<bool, McpErrorPayload> {
    service_with(Arc::new(NullExecutor)).has_secret(server_id)
}

#[tauri::command]
pub async fn mcp_configure(server_id: McpServerId, api_key: String) -> Result<(), McpErrorPayload> {
    let service = service_with(Arc::new(RmcpTinyfishClient {
        api_key: api_key.clone(),
    }));
    service.configure(server_id, &api_key).await
}

#[tauri::command]
pub fn mcp_delete_secret(server_id: McpServerId) -> Result<(), McpErrorPayload> {
    service_with(Arc::new(NullExecutor)).delete_secret(server_id)
}

#[tauri::command]
pub async fn mcp_call(
    state: State<'_, McpState>,
    server_id: McpServerId,
    request_id: String,
    request: WebToolRequest,
) -> Result<WebToolResult, McpErrorPayload> {
    // L'enregistrement précède tout accès au coffre : une annulation concurrente
    // reste observable même si le Credential Manager Windows bloque brièvement.
    let (token, _guard) = register_request(&state, &request_id);

    let key = CredentialStore
        .get(&secret_ref_for(server_id))
        .map_err(McpErrorPayload::unknown)?
        .ok_or(McpErrorPayload {
            kind: McpErrorKind::NotConfigured,
            message: format!("Serveur MCP non configuré : {}", server_id.as_str()),
        })?;

    let service = service_with(Arc::new(RmcpTinyfishClient { api_key: key }));
    let timeout = match &request {
        WebToolRequest::Search { .. } => SEARCH_TIMEOUT,
        WebToolRequest::FetchContent { .. } => FETCH_TIMEOUT,
    };
    match tokio::time::timeout(timeout, service.call(server_id, &token, &request)).await {
        Ok(outcome) => outcome,
        Err(_) => Err(McpErrorPayload {
            kind: McpErrorKind::Timeout,
            message: "Le serveur MCP n'a pas répondu à temps".to_owned(),
        }),
    }
}

#[tauri::command]
pub fn mcp_cancel(state: State<'_, McpState>, request_id: String) -> Result<(), McpErrorPayload> {
    state.cancel(&request_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeouts_match_the_spec() {
        assert_eq!(SEARCH_TIMEOUT, Duration::from_secs(15));
        assert_eq!(FETCH_TIMEOUT, Duration::from_secs(120));
    }

    #[test]
    fn cancel_guard_removes_the_entry_on_drop() {
        let state = McpState::default();
        {
            let _guard = CancelGuard {
                state: &state,
                request_id: "r1".to_owned(),
            };
            let _token = state.register("r1");
        }
        // Après drop, une nouvelle inscription ne doit pas annuler l'ancien jeton :
        // l'entrée a été retirée.
        let token = state.register("r1");
        assert!(!token.is_cancelled());
    }

    #[test]
    fn secret_ref_uses_the_generic_convention() {
        assert_eq!(
            secret_ref_for(McpServerId::Tinyfish),
            "logassist/mcp/tinyfish"
        );
    }

    #[test]
    fn request_registration_is_cancellable_before_credentials_are_read() {
        let state = McpState::default();
        let (token, _guard) = register_request(&state, "early");
        state.cancel("early");
        assert!(token.is_cancelled());
    }
}
