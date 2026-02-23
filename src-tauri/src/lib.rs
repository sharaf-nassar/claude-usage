mod config;
mod fetcher;
mod models;
mod storage;

use models::{BucketStats, DataPoint, UsageData};
use storage::Storage;
use std::sync::OnceLock;

static STORAGE: OnceLock<Storage> = OnceLock::new();

fn get_storage() -> Result<&'static Storage, String> {
    STORAGE
        .get()
        .ok_or_else(|| "Storage not initialized".to_string())
}

#[tauri::command]
async fn fetch_usage_data() -> Result<UsageData, String> {
    let data = fetcher::fetch_usage().await;

    if data.error.is_none() && !data.buckets.is_empty() {
        if let Ok(storage) = get_storage() {
            if let Err(e) = storage.store_snapshot(&data.buckets) {
                eprintln!("Warning: failed to store snapshot: {e}");
            }
        }
    }

    Ok(data)
}

#[tauri::command]
async fn get_usage_history(bucket: String, range: String) -> Result<Vec<DataPoint>, String> {
    let storage = get_storage()?;
    storage.get_usage_history(&bucket, &range)
}

#[tauri::command]
async fn get_usage_stats(bucket: String, days: i32) -> Result<BucketStats, String> {
    let storage = get_storage()?;
    storage.get_usage_stats(&bucket, days)
}

#[tauri::command]
async fn get_all_bucket_stats(buckets_json: String, days: i32) -> Result<Vec<BucketStats>, String> {
    let storage = get_storage()?;
    let buckets: Vec<models::UsageBucket> = serde_json::from_str(&buckets_json)
        .map_err(|e| format!("Failed to parse buckets: {e}"))?;
    storage.get_all_bucket_stats(&buckets, days)
}

#[tauri::command]
async fn get_snapshot_count() -> Result<i64, String> {
    let storage = get_storage()?;
    storage.get_snapshot_count()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    match Storage::init() {
        Ok(s) => {
            if STORAGE.set(s).is_err() {
                eprintln!("BUG: STORAGE was already initialized");
            }
        }
        Err(e) => eprintln!("Warning: failed to initialize storage: {e}"),
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            fetch_usage_data,
            get_usage_history,
            get_usage_stats,
            get_all_bucket_stats,
            get_snapshot_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
