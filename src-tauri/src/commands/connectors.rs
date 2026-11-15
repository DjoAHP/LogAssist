// Commandes Tauri pour le connecteur GitHub.
// Les erreurs sont converties en ConnectorErrorPayload pour Tauri.

use crate::connectors::service::{
    CallToolArgs, CallToolResult, ConnectorGithubService, ConfigureResult, ListReposResult, StatusResult,
};
use crate::connectors::error::{ConnectorError, ConnectorErrorPayload};
use tauri::State;

fn to_payload(err: ConnectorError) -> ConnectorErrorPayload {
    err.into()
}

#[tauri::command]
pub async fn connector_github_configure(
    service: State<'_, ConnectorGithubService>,
    token: String,
) -> Result<ConfigureResult, ConnectorErrorPayload> {
    service.configure(token).await.map_err(to_payload)
}

#[tauri::command]
pub async fn connector_github_status(
    service: State<'_, ConnectorGithubService>,
) -> Result<StatusResult, ConnectorErrorPayload> {
    service.status().await.map_err(to_payload)
}

#[tauri::command]
pub async fn connector_github_delete(
    service: State<'_, ConnectorGithubService>,
) -> Result<(), ConnectorErrorPayload> {
    service.delete().await.map_err(to_payload)
}

#[tauri::command]
pub async fn connector_github_list_repos(
    service: State<'_, ConnectorGithubService>,
    page: u32,
) -> Result<ListReposResult, ConnectorErrorPayload> {
    service.list_repos(page).await.map_err(to_payload)
}

#[tauri::command]
pub async fn connector_github_list_branches(
    service: State<'_, ConnectorGithubService>,
    owner: String,
    name: String,
) -> Result<Vec<String>, ConnectorErrorPayload> {
    service.list_branches(owner, name).await.map_err(to_payload)
}

#[tauri::command]
pub async fn connector_github_call_tool(
    service: State<'_, ConnectorGithubService>,
    args: CallToolArgs,
) -> Result<CallToolResult, ConnectorErrorPayload> {
    service.call_tool(args).await.map_err(to_payload)
}

#[tauri::command]
pub fn connector_github_cancel_turn(
    service: State<'_, ConnectorGithubService>,
    turn_id: String,
) -> Result<(), ConnectorErrorPayload> {
    service.cancel_turn(&turn_id);
    Ok(())
}