use rig::client::CompletionClient;
use rig::completion::TypedPrompt;
use rig::providers::anthropic;
use serde::de::DeserializeOwned;

use crate::config;
use crate::models::AnalysisOutput;

pub const MODEL_HAIKU: &str = "claude-haiku-4-5-20251001";
pub const MODEL_SONNET: &str = "claude-sonnet-4-5-20250929";

/// Build an Anthropic client that authenticates with an OAuth Bearer token.
///
/// Claude Code stores an OAuth access token (`sk-ant-oat01-…`) which must be
/// sent as `Authorization: Bearer <token>` with the beta header
/// `anthropic-beta: oauth-2025-04-20`.  Rig's built-in Anthropic provider
/// hardcodes `x-api-key`, so we use a reqwest-middleware layer to swap the
/// header on every outgoing request.
fn build_oauth_client(
    token: &str,
) -> Result<anthropic::Client<reqwest_middleware::ClientWithMiddleware>, String> {
    let mw_client = reqwest_middleware::ClientBuilder::new(reqwest::Client::new())
        .with(OAuthHeaderMiddleware)
        .build();

    anthropic::Client::builder()
        .http_client(mw_client)
        .api_key(token)
        .anthropic_beta("oauth-2025-04-20")
        .build()
        .map_err(|e| format!("Failed to build Anthropic client: {e}"))
}

/// Analyze observations using the Anthropic API via Rig.
pub async fn analyze_observations(prompt: &str, model: &str) -> Result<AnalysisOutput, String> {
    let token = config::read_access_token()?;
    let client = build_oauth_client(&token)?;

    let agent = client
        .agent(model)
        .preamble(
            "You are a behavioral pattern analyzer for Claude Code tool-use observations. \
             Respond with structured JSON matching the provided schema.",
        )
        .max_tokens(4096)
        .build();

    let result: AnalysisOutput = agent
        .prompt_typed(prompt)
        .await
        .map_err(|e| format!("Anthropic API error: {e}"))?;

    Ok(result)
}

/// Generic typed analysis using the Anthropic API via Rig.
/// Like `analyze_observations` but accepts any JsonSchema-compatible output type.
pub async fn analyze_typed<T>(
    prompt: &str,
    preamble: &str,
    model: &str,
    max_tokens: u64,
) -> Result<T, String>
where
    T: DeserializeOwned + schemars::JsonSchema + Send + Sync + 'static,
{
    let token = config::read_access_token()?;
    let client = build_oauth_client(&token)?;

    let agent = client
        .agent(model)
        .preamble(preamble)
        .max_tokens(max_tokens)
        .build();

    let result: T = agent
        .prompt_typed(prompt)
        .await
        .map_err(|e| format!("Anthropic API error: {e}"))?;

    Ok(result)
}

// ---------------------------------------------------------------------------
// Middleware: swap `x-api-key` → `Authorization: Bearer` for OAuth tokens
// ---------------------------------------------------------------------------

struct OAuthHeaderMiddleware;

impl reqwest_middleware::Middleware for OAuthHeaderMiddleware {
    fn handle<'life0, 'life1, 'life2, 'async_trait>(
        &'life0 self,
        mut req: reqwest::Request,
        extensions: &'life1 mut http::Extensions,
        next: reqwest_middleware::Next<'life2>,
    ) -> std::pin::Pin<
        Box<
            dyn std::future::Future<Output = reqwest_middleware::Result<reqwest::Response>>
                + Send
                + 'async_trait,
        >,
    >
    where
        'life0: 'async_trait,
        'life1: 'async_trait,
        'life2: 'async_trait,
        Self: 'async_trait,
    {
        // Rig sets the OAuth token as x-api-key; move it to Authorization: Bearer.
        if let Some(key) = req.headers_mut().remove("x-api-key") {
            let bearer = format!("Bearer {}", key.to_str().unwrap_or_default());
            if let Ok(val) = http::HeaderValue::from_str(&bearer) {
                req.headers_mut().insert(http::header::AUTHORIZATION, val);
            }
        }
        Box::pin(async move { next.run(req, extensions).await })
    }
}
