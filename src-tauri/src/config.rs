use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const OAUTH_TOKEN_URL: &str = "https://console.anthropic.com/v1/oauth/token";
const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

pub fn read_access_token() -> Result<String, String> {
    let path = credentials_path().ok_or("Cannot determine home directory")?;
    if !path.exists() {
        return Err("Credentials file not found. Run: claude /login".into());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read credentials: {e}"))?;
    let data: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse credentials: {e}"))?;

    data["claudeAiOauth"]["accessToken"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "No access token found in credentials".into())
}

pub async fn refresh_access_token() -> Result<String, String> {
    let path = credentials_path().ok_or("Cannot determine home directory")?;
    if !path.exists() {
        return Err("Credentials file not found".into());
    }

    let contents = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read credentials: {e}"))?;
    let mut data: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse credentials: {e}"))?;

    let refresh_token = data["claudeAiOauth"]["refreshToken"]
        .as_str()
        .ok_or("No refresh token found")?
        .to_string();

    let client = reqwest::Client::new();
    let resp = client
        .post(OAUTH_TOKEN_URL)
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": OAUTH_CLIENT_ID,
        }))
        .send()
        .await
        .map_err(|e| format!("Token refresh request failed: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Token refresh failed with status: {}", resp.status()));
    }

    let tokens: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse refresh response: {e}"))?;

    let new_access = tokens["access_token"]
        .as_str()
        .ok_or("No access_token in refresh response")?
        .to_string();

    // Update credentials file
    if let Some(new_refresh) = tokens["refresh_token"].as_str() {
        data["claudeAiOauth"]["refreshToken"] = serde_json::Value::String(new_refresh.into());
    }
    data["claudeAiOauth"]["accessToken"] = serde_json::Value::String(new_access.clone());

    let expires_in = tokens["expires_in"].as_u64().unwrap_or(86400);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    data["claudeAiOauth"]["expiresAt"] =
        serde_json::Value::Number((now_ms + expires_in * 1000).into());

    let updated = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize credentials: {e}"))?;
    fs::write(&path, updated)
        .map_err(|e| format!("Failed to write credentials: {e}"))?;

    Ok(new_access)
}
