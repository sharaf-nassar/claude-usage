mod config;
mod fetcher;
mod models;

use models::UsageData;

#[tauri::command]
async fn fetch_usage_data() -> Result<UsageData, String> {
    Ok(fetcher::fetch_usage().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![fetch_usage_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
