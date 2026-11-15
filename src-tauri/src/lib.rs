mod commands;
pub mod mcp;
pub mod connectors;

use std::sync::Arc;

use commands::{
    applock_configured, connector_github_cancel_turn, connector_github_call_tool,
    connector_github_configure, connector_github_delete, connector_github_list_branches,
    connector_github_list_repos, connector_github_status, delete_secret, execute_transaction,
    get_secret, mcp_auth_status, mcp_call_tool, mcp_cancel_turn, mcp_configure_auth,
    mcp_connect_and_list_tools, mcp_delete_secret, mcp_disconnect, mcp_finish_turn,
    mcp_sync_registry, mcp_test_tool, mcp_validate_configs, remove_applock_secret,
    set_applock_secret, set_secret, verify_applock_secret,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Neuf états construits une seule fois : registre, pool et service MCP
    // partagent la même instance pour toute la fenêtre.
    let mcp_state = Arc::new(mcp::registry::McpState::default());
    let mcp_pool = Arc::new(mcp::transport::McpConnectionPool::production());
    let mcp_service = commands::ProductionMcpService::new(
        mcp_state.clone(),
        mcp_pool.clone(),
        Arc::new(commands::CredentialStore),
    );
    let connector_github_service = crate::connectors::service::ConnectorGithubService::new();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(mcp_state)
        .manage(mcp_pool)
        .manage(mcp_service)
        .manage(connector_github_service)
        .invoke_handler(tauri::generate_handler![
            set_secret,
            get_secret,
            delete_secret,
            mcp_validate_configs,
            mcp_sync_registry,
            mcp_auth_status,
            mcp_configure_auth,
            mcp_connect_and_list_tools,
            mcp_delete_secret,
            mcp_call_tool,
            mcp_test_tool,
            mcp_cancel_turn,
            mcp_finish_turn,
            mcp_disconnect,
            execute_transaction,
            set_applock_secret,
            verify_applock_secret,
            applock_configured,
            remove_applock_secret,
            connector_github_configure,
            connector_github_status,
            connector_github_delete,
            connector_github_list_repos,
            connector_github_list_branches,
            connector_github_call_tool,
            connector_github_cancel_turn
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
