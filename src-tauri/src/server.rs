use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tokio::net::TcpListener;

use tauri::Emitter;

use crate::models::TokenReportPayload;
use crate::storage::Storage;

const DEFAULT_PORT: u16 = 19876;
const MAX_REQUESTS: usize = 100;
const RATE_WINDOW_SECS: u64 = 60;
const MAX_STRING_LEN: usize = 256;
const MAX_CWD_LEN: usize = 4096;

struct ServerState {
    storage: &'static Storage,
    secret: String,
    rate_limiter: Mutex<VecDeque<Instant>>,
    app_handle: tauri::AppHandle,
}

fn check_auth(headers: &HeaderMap, secret: &str) -> bool {
    let token = match headers.get("authorization").and_then(|v| v.to_str().ok()) {
        Some(v) if v.starts_with("Bearer ") => &v[7..],
        _ => return false,
    };

    if token.len() != secret.len() {
        return false;
    }

    // Constant-time comparison via XOR-fold
    let equal = token
        .as_bytes()
        .iter()
        .zip(secret.as_bytes().iter())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b));

    equal == 0
}

fn check_rate_limit(rate_limiter: &Mutex<VecDeque<Instant>>) -> bool {
    let mut window = match rate_limiter.lock() {
        Ok(w) => w,
        Err(_) => return false,
    };

    let now = Instant::now();
    let cutoff = now - std::time::Duration::from_secs(RATE_WINDOW_SECS);

    // Remove expired entries from the front
    while window.front().is_some_and(|t| *t < cutoff) {
        window.pop_front();
    }

    if window.len() >= MAX_REQUESTS {
        return false;
    }

    window.push_back(now);
    true
}

pub async fn start_server(
    storage: &'static Storage,
    secret: String,
    app_handle: tauri::AppHandle,
) {
    let port: u16 = std::env::var("CLAUDE_USAGE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    let state = Arc::new(ServerState {
        storage,
        secret,
        rate_limiter: Mutex::new(VecDeque::new()),
        app_handle,
    });

    let app = Router::new()
        .route("/api/v1/health", get(health))
        .route("/api/v1/tokens", post(report_tokens))
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind token server on {addr}: {e}");
            return;
        }
    };

    eprintln!("Token server listening on {addr}");

    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("Token server error: {e}");
    }
}

async fn health() -> &'static str {
    "ok"
}

async fn report_tokens(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(payload): Json<TokenReportPayload>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state.secret) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized".to_string());
    }

    if !check_rate_limit(&state.rate_limiter) {
        return (StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded".to_string());
    }

    if payload.session_id.is_empty() {
        return (StatusCode::BAD_REQUEST, "session_id is required".to_string());
    }
    if payload.hostname.is_empty() {
        return (StatusCode::BAD_REQUEST, "hostname is required".to_string());
    }
    if payload.session_id.len() > MAX_STRING_LEN {
        return (StatusCode::BAD_REQUEST, "session_id too long".to_string());
    }
    if payload.hostname.len() > MAX_STRING_LEN {
        return (StatusCode::BAD_REQUEST, "hostname too long".to_string());
    }
    if payload.cwd.as_ref().is_some_and(|c| c.len() > MAX_CWD_LEN) {
        return (StatusCode::BAD_REQUEST, "cwd too long".to_string());
    }
    if payload.input_tokens < 0
        || payload.output_tokens < 0
        || payload.cache_creation_input_tokens < 0
        || payload.cache_read_input_tokens < 0
    {
        return (
            StatusCode::BAD_REQUEST,
            "token counts must be non-negative".to_string(),
        );
    }

    match state.storage.store_token_snapshot(&payload) {
        Ok(()) => {
            let _ = state.app_handle.emit("tokens-updated", ());
            (StatusCode::OK, "ok".to_string())
        }
        Err(e) => {
            eprintln!("Failed to store token snapshot: {e}");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal server error".to_string(),
            )
        }
    }
}
