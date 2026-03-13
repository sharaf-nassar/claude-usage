use rig::client::CompletionClient;
use rig::completion::TypedPrompt;
use rig::providers::anthropic;
use serde::de::DeserializeOwned;

use crate::config;
use crate::models::AnalysisOutput;

pub const MODEL_HAIKU: &str = "claude-haiku-4-5-20251001";
pub const MODEL_SONNET: &str = "claude-sonnet-4-5-20250929";

/// Analyze observations using the Anthropic API via Rig.
///
/// Uses the specified model with `prompt_typed` to guarantee a valid
/// `AnalysisOutput` JSON response. Reads the current access token from
/// Claude Code's credentials — never refreshes it (Claude Code owns the
/// token lifecycle).
pub async fn analyze_observations(prompt: &str, model: &str) -> Result<AnalysisOutput, String> {
    let token = config::read_access_token()?;

    let client = anthropic::Client::new(&token)
        .map_err(|e| format!("Failed to build Anthropic client: {e}"))?;

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

    let client = anthropic::Client::new(&token)
        .map_err(|e| format!("Failed to build Anthropic client: {e}"))?;

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
