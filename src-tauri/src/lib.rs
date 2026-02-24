mod auth;
mod config;
mod fetcher;
mod models;
mod server;
mod storage;

use models::{BucketStats, DataPoint, HostBreakdown, SessionBreakdown, TokenDataPoint, TokenStats, UsageData};
use rand::RngCore;
use storage::Storage;
use std::sync::{Mutex, OnceLock};
use tauri::{Manager, PhysicalPosition};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

static STORAGE: OnceLock<Storage> = OnceLock::new();
static LAST_POSITION: Mutex<Option<PhysicalPosition<i32>>> = Mutex::new(None);

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        if let Ok(mut lock) = LAST_POSITION.lock() {
            if let Some(pos) = lock.take() {
                let _ = w.set_position(pos);
            }
        }
        let _ = w.set_focus();
    }
}

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

#[tauri::command]
async fn get_token_history(
    range: String,
    hostname: Option<String>,
    session_id: Option<String>,
) -> Result<Vec<TokenDataPoint>, String> {
    let storage = get_storage()?;
    storage.get_token_history(&range, hostname.as_deref(), session_id.as_deref())
}

#[tauri::command]
async fn get_token_stats(
    days: i32,
    hostname: Option<String>,
) -> Result<TokenStats, String> {
    let storage = get_storage()?;
    storage.get_token_stats(days, hostname.as_deref())
}

#[tauri::command]
async fn get_token_hostnames() -> Result<Vec<String>, String> {
    let storage = get_storage()?;
    storage.get_token_hostnames()
}

#[tauri::command]
async fn get_host_breakdown(days: i32) -> Result<Vec<HostBreakdown>, String> {
    let storage = get_storage()?;
    storage.get_host_breakdown(days)
}

#[tauri::command]
async fn get_session_breakdown(
    days: i32,
    hostname: Option<String>,
) -> Result<Vec<SessionBreakdown>, String> {
    let storage = get_storage()?;
    storage.get_session_breakdown(days, hostname.as_deref())
}

#[tauri::command]
async fn hide_window(window: tauri::WebviewWindow) {
    if let Ok(pos) = window.outer_position() {
        if let Ok(mut lock) = LAST_POSITION.lock() {
            *lock = Some(pos);
        }
    }
    let _ = window.hide();
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
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

    // Load or generate the auth secret for the HTTP server
    let secret = match auth::load_or_create_secret() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Warning: failed to load auth secret, generating ephemeral: {e}");
            let mut bytes = [0u8; 32];
            rand::rngs::OsRng.fill_bytes(&mut bytes);
            hex::encode(bytes)
        }
    };

    // Spawn the HTTP token reporting server
    if let Some(storage) = STORAGE.get() {
        tauri::async_runtime::spawn(server::start_server(storage, secret));
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show Widget", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Claude Usage")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "show" => show_main_window(app),
                        "quit" => app.exit(0),
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_usage_data,
            get_usage_history,
            get_usage_stats,
            get_all_bucket_stats,
            get_snapshot_count,
            get_token_history,
            get_token_stats,
            get_token_hostnames,
            get_host_breakdown,
            get_session_breakdown,
            hide_window,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
