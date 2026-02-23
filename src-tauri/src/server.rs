use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tokio::net::TcpListener;

use crate::models::TokenReportPayload;
use crate::storage::Storage;

struct ServerState {
    storage: &'static Storage,
}

const DEFAULT_PORT: u16 = 19876;

pub async fn start_server(storage: &'static Storage) {
    let port: u16 = std::env::var("CLAUDE_USAGE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    let state = Arc::new(ServerState { storage });

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
    Json(payload): Json<TokenReportPayload>,
) -> impl IntoResponse {
    if payload.session_id.is_empty() {
        return (StatusCode::BAD_REQUEST, "session_id is required".to_string());
    }
    if payload.hostname.is_empty() {
        return (StatusCode::BAD_REQUEST, "hostname is required".to_string());
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
        Ok(()) => (StatusCode::OK, "ok".to_string()),
        Err(e) => {
            eprintln!("Failed to store token snapshot: {e}");
            (StatusCode::INTERNAL_SERVER_ERROR, format!("store error: {e}"))
        }
    }
}
