use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static CLAUDE_VERSION: OnceLock<String> = OnceLock::new();
static SHELL_PATH: OnceLock<String> = OnceLock::new();

pub fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

pub fn claude_user_agent() -> &'static str {
    CLAUDE_VERSION.get_or_init(|| {
        std::process::Command::new("claude")
            .arg("--version")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .and_then(|s| {
                let ver = s.split_whitespace().next()?.to_string();
                if ver.contains('.') {
                    Some(format!("claude-code/{ver}"))
                } else {
                    None
                }
            })
            .unwrap_or_else(|| "claude-code/0.0.0".into())
    })
}

/// Resolve the user's login-shell PATH so spawned processes (e.g. `claude`)
/// can find `node` and other tools that aren't in the Tauri app's PATH.
/// Uses $SHELL (respecting the user's configured login shell) instead of
/// hard-coding bash, since macOS defaults to zsh since Catalina.
pub fn shell_path() -> &'static str {
    SHELL_PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "bash".into());
        std::process::Command::new(&shell)
            .args(["-lc", "echo $PATH"])
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
    })
}

fn credentials_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join(".credentials.json"))
}

/// Read credentials JSON from the platform-appropriate store.
/// On macOS, reads from Keychain first; falls back to file on all platforms.
fn read_credentials() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        match read_keychain_credentials() {
            Ok(raw) => {
                return serde_json::from_str(&raw)
                    .map_err(|e| format!("Failed to parse Keychain credentials: {e}"));
            }
            Err(e) => log::debug!("Keychain read failed, falling back to file: {e}"),
        }
    }

    let path = credentials_path().ok_or("Cannot determine home directory")?;
    if !path.exists() {
        return Err("Credentials file not found. Run: claude /login".into());
    }
    let contents =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read credentials: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse credentials: {e}"))
}

// -- macOS Keychain helpers --------------------------------------------------

#[cfg(target_os = "macos")]
fn find_keychain_service() -> Result<String, String> {
    const BASE_SERVICE: &str = "Claude Code-credentials";

    // Try exact match first (older Claude Code versions)
    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", BASE_SERVICE, "-w"])
        .output()
        .map_err(|e| format!("Failed to run security command: {e}"))?;

    if output.status.success() {
        return Ok(BASE_SERVICE.to_string());
    }

    // Search for hash-suffixed variants (Claude Code v2.1.52+)
    let output = std::process::Command::new("bash")
        .args([
            "-c",
            r#"security dump-keychain 2>/dev/null | awk -F'"' '/svce.*<blob>="Claude Code-credentials/{print $4; exit}'"#,
        ])
        .output()
        .map_err(|e| format!("Failed to search keychain: {e}"))?;

    let service = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !service.is_empty() {
        return Ok(service);
    }

    Err("No Claude Code credentials found in Keychain. Run: claude /login".into())
}

#[cfg(target_os = "macos")]
fn read_keychain_credentials() -> Result<String, String> {
    let service = find_keychain_service()?;

    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", &service, "-w"])
        .output()
        .map_err(|e| format!("Failed to read from Keychain: {e}"))?;

    if !output.status.success() {
        return Err("Failed to read credentials from Keychain".into());
    }

    let data = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if data.is_empty() {
        return Err("Empty credentials in Keychain".into());
    }

    Ok(data)
}

// -- Public API --------------------------------------------------------------

pub fn read_access_token() -> Result<String, String> {
    let data = read_credentials()?;
    data["claudeAiOauth"]["accessToken"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| "No access token found in credentials".into())
}
