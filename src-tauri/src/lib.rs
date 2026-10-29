mod commands;

use commands::{delete_secret, get_secret, set_secret};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![set_secret, get_secret, delete_secret])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
