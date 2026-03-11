use rig::client::CompletionClient;
use rig::completion::TypedPrompt;
use rig::providers::anthropic;

use crate::config;
use crate::models::AnalysisOutput;

const MODEL: &str = "claude-haiku-4-5-20251001";

/// Analyze observations using the Anthropic API via Rig.
///
/// Sends the prompt to Haiku with `prompt_typed` to guarantee a valid
/// `AnalysisOutput` JSON response. On 401 auth errors, refreshes the
/// OAuth token and retries once.
pub async fn analyze_observations(prompt: &str) -> Result<AnalysisOutput, String> {
    match try_analyze(prompt).await {
        Ok(result) => Ok(result),
        Err(e) if is_auth_error(&e) => {
            log::info!("Auth error, refreshing token and retrying");
            config::refresh_access_token().await?;
            try_analyze(prompt).await
        }
        Err(e) => Err(e),
    }
}

async fn try_analyze(prompt: &str) -> Result<AnalysisOutput, String> {
    let token = config::read_access_token()?;

    let client = anthropic::Client::new(&token)
        .map_err(|e| format!("Failed to build Anthropic client: {e}"))?;

    let agent = client
        .agent(MODEL)
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

fn is_auth_error(error: &str) -> bool {
    error.contains("401")
        || error.contains("authentication_error")
        || error.contains("Unauthorized")
        || error.contains("invalid x-api-key")
}
