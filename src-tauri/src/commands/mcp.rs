//! Commandes Tauri MCP : pont fin entre React et la couche service.
//! Toute validation et tout accès au Credential Manager restent côté Rust.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::mcp::client::McpService;
pub use crate::mcp::client::SecretStore;
use crate::mcp::registry::{CallScope, RegistrySyncResult};
use crate::mcp::security::validate_server_config;
use crate::mcp::transport::McpConnectionPool;
use crate::mcp::types::{
    McpAuthStatus, McpErrorKind, McpErrorPayload, McpRuntimeServer, McpToolDescriptor,
    McpToolResult,
};

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

/// Service branché sur le Credential Manager Windows : l'instance gérée par
/// Tauri partage le registre et le pool de connexions de la fenêtre.
pub type ProductionMcpService = McpService<CredentialStore>;

/// Valide la forme serveur (endpoint, auth, timeouts, outillage) et l'unicité
/// des identifiants, sans toucher au réseau ni au registre.
#[tauri::command]
pub fn mcp_validate_configs(servers: Vec<McpRuntimeServer>) -> Result<(), McpErrorPayload> {
    let mut ids = std::collections::HashSet::new();
    for server in &servers {
        validate_server_config(server)?;
        if !ids.insert(server.id.as_str()) {
            return Err(McpErrorPayload::new(
                McpErrorKind::InvalidConfig,
                "Identifiant MCP dupliqué",
            ));
        }
    }
    Ok(())
}

/// Publie la liste courante des serveurs MCP et coupe les sessions dont la
/// liaison a changé. La révision est gérée côté Rust (compteur interne).
#[tauri::command]
pub async fn mcp_sync_registry(
    service: State<'_, ProductionMcpService>,
    servers: Vec<McpRuntimeServer>,
) -> Result<RegistrySyncResult, McpErrorPayload> {
    service.sync_registry(servers).await
}

/// Statut d'authentification du serveur : lecture du coffre uniquement.
#[tauri::command]
pub fn mcp_auth_status(
    service: State<'_, ProductionMcpService>,
    server_id: String,
) -> Result<McpAuthStatus, McpErrorPayload> {
    service.auth_status(&server_id)
}

/// Teste une clé candidate EN MÉMOIRE avant remplacement transactionnel.
#[tauri::command]
pub async fn mcp_configure_auth(
    service: State<'_, ProductionMcpService>,
    server_id: String,
    secret: String,
) -> Result<Vec<McpToolDescriptor>, McpErrorPayload> {
    service.configure_auth(&server_id, &secret).await
}

/// Connecte (ou réutilise) la session du serveur et liste ses outils.
#[tauri::command]
pub async fn mcp_connect_and_list_tools(
    service: State<'_, ProductionMcpService>,
    server_id: String,
) -> Result<Vec<McpToolDescriptor>, McpErrorPayload> {
    service.discover(&server_id).await
}

/// Appel d'outil dans le scope assistant : allowlist du registre appliquée.
#[tauri::command]
pub async fn mcp_call_tool(
    service: State<'_, ProductionMcpService>,
    server_id: String,
    turn_id: String,
    call_id: String,
    native_name: String,
    arguments: Value,
) -> Result<McpToolResult, McpErrorPayload> {
    service
        .call_tool(
            &server_id,
            &turn_id,
            &call_id,
            &native_name,
            arguments,
            CallScope::Assistant,
        )
        .await
}

/// Appel d'outil manuel (réglages), tour dédié `manual:{call_id}` : les outils
/// désactivés restent testables par l'utilisateur.
#[tauri::command]
pub async fn mcp_test_tool(
    service: State<'_, ProductionMcpService>,
    server_id: String,
    call_id: String,
    native_name: String,
    arguments: Value,
) -> Result<McpToolResult, McpErrorPayload> {
    service
        .call_tool(
            &server_id,
            &format!("manual:{call_id}"),
            &call_id,
            &native_name,
            arguments,
            CallScope::Manual,
        )
        .await
}

/// Annule tous les appels en cours du tour ; idempotent si le tour est inconnu.
#[tauri::command]
pub fn mcp_cancel_turn(
    service: State<'_, ProductionMcpService>,
    turn_id: String,
) -> Result<(), McpErrorPayload> {
    service.cancel_turn(&turn_id)
}

/// Libère le tour à la fin de chaque tour de chat (budget registre
/// restitué) ; idempotent si le tour est inconnu ou déjà terminé.
#[tauri::command]
pub fn mcp_finish_turn(
    service: State<'_, ProductionMcpService>,
    turn_id: String,
) -> Result<(), McpErrorPayload> {
    service.finish_turn(&turn_id)
}

/// Ferme explicitement la session du serveur (réglages, diagnostique).
#[tauri::command]
pub async fn mcp_disconnect(
    pool: State<'_, Arc<McpConnectionPool>>,
    server_id: String,
) -> Result<(), McpErrorPayload> {
    pool.disconnect(&server_id).await;
    Ok(())
}

/// Coupe la session et efface le secret du coffre.
#[tauri::command]
pub async fn mcp_delete_secret(
    service: State<'_, ProductionMcpService>,
    server_id: String,
) -> Result<(), McpErrorPayload> {
    service.delete_secret(&server_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::registry::McpState;
    use crate::mcp::types::McpTransportKind;

    fn runtime_server(id: &str) -> McpRuntimeServer {
        McpRuntimeServer {
            id: id.to_owned(),
            name: "Serveur de test".to_owned(),
            endpoint: "https://mcp.example.com/mcp".to_owned(),
            transport: McpTransportKind::StreamableHttp,
            auth: crate::mcp::types::McpAuthConfig::None,
            timeout_ms: 15_000,
            enabled: true,
            builtin: false,
            tools: Vec::new(),
        }
    }

    #[test]
    fn validate_configs_accepts_a_coherent_list() {
        mcp_validate_configs(vec![runtime_server("docs"), runtime_server("other")])
            .expect("liste cohérente");
    }

    #[test]
    fn validate_configs_rejects_duplicate_ids() {
        let error = mcp_validate_configs(vec![runtime_server("docs"), runtime_server("docs")])
            .expect_err("doublon refusé");
        assert_eq!(error.kind, McpErrorKind::InvalidConfig);
    }

    #[test]
    fn production_service_binds_the_real_credential_store() {
        let service = McpService::new(
            Arc::new(McpState::default()),
            Arc::new(McpConnectionPool::production()),
            Arc::new(CredentialStore),
        );
        let _typed: ProductionMcpService = service;
    }
}
