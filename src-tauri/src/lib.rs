mod commands;
pub mod mcp;

use commands::{
    delete_secret, execute_transaction, get_secret, mcp_call, mcp_cancel, mcp_configure,
    mcp_delete_secret, mcp_has_secret, set_secret,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(mcp::client::McpState::default())
        .invoke_handler(tauri::generate_handler![
            set_secret,
            get_secret,
            delete_secret,
            mcp_has_secret,
            mcp_configure,
            mcp_delete_secret,
            mcp_call,
            mcp_cancel,
            execute_transaction
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
