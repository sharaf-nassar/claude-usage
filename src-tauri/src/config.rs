use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

const OAUTH_TOKEN_URL: &str = "https://console.anthropic.com/v1/oauth/token";
// Public OAuth client ID for the native desktop flow (not a secret).
const OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

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

    let resp = http_client()
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

    // Atomic write: write to temp file, set permissions, then rename
    let tmp_path = path.with_extension("json.tmp");
    let mut tmp = fs::File::create(&tmp_path)
        .map_err(|e| format!("Failed to create temp file: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tmp.set_permissions(fs::Permissions::from_mode(0o600));
    }

    tmp.write_all(updated.as_bytes())
        .map_err(|e| format!("Failed to write temp file: {e}"))?;
    tmp.flush()
        .map_err(|e| format!("Failed to flush temp file: {e}"))?;
    drop(tmp);

    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename credentials file: {e}"))?;

    Ok(new_access)
}
