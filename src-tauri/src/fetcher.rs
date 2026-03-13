use crate::config::{claude_user_agent, http_client, read_access_token};
use crate::models::{UsageBucket, UsageData};

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";

const BUCKET_KEYS: &[(&str, &str)] = &[
    ("five_hour", "5 hours"),
    ("seven_day", "7 days"),
    ("seven_day_sonnet", "Sonnet"),
    ("seven_day_opus", "Opus"),
    ("seven_day_cowork", "Code"),
    ("seven_day_oauth_apps", "OAuth"),
    ("extra_usage", "Extra"),
];

async fn do_fetch(token: &str) -> Result<reqwest::Response, reqwest::Error> {
    http_client()
        .get(USAGE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .header("User-Agent", claude_user_agent())
        .header("Authorization", format!("Bearer {token}"))
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
}

fn validate_utilization(val: f64) -> Option<f64> {
    if val.is_finite() && val >= 0.0 {
        Some(val)
    } else {
        None
    }
}

fn validate_resets_at(val: &str) -> Option<String> {
    if chrono::DateTime::parse_from_rfc3339(val).is_ok() {
        Some(val.to_string())
    } else {
        None
    }
}

fn parse_buckets(data: &serde_json::Value) -> Vec<UsageBucket> {
    let mut buckets = Vec::new();

    for &(key, label) in BUCKET_KEYS {
        let Some(entry) = data.get(key) else {
            continue;
        };

        if key == "extra_usage" {
            if entry.get("is_enabled").and_then(|v| v.as_bool()) != Some(true) {
                continue;
            }
            if let Some(util) = entry
                .get("utilization")
                .and_then(|v| v.as_f64())
                .and_then(validate_utilization)
            {
                buckets.push(UsageBucket {
                    label: label.into(),
                    utilization: util,
                    resets_at: None,
                });
            }
            continue;
        }

        let Some(util) = entry
            .get("utilization")
            .and_then(|v| v.as_f64())
            .and_then(validate_utilization)
        else {
            continue;
        };

        let resets_at = entry
            .get("resets_at")
            .and_then(|v| v.as_str())
            .and_then(validate_resets_at);

        buckets.push(UsageBucket {
            label: label.into(),
            utilization: util,
            resets_at,
        });
    }

    buckets
}

pub async fn fetch_usage() -> UsageData {
    let token = match read_access_token() {
        Ok(t) => t,
        Err(e) => {
            return UsageData {
                buckets: vec![],
                error: Some(e),
            };
        }
    };

    let resp = match do_fetch(&token).await {
        Ok(r) => r,
        Err(e) => {
            return UsageData {
                buckets: vec![],
                error: Some(format!("Request failed: {e}")),
            };
        }
    };

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        UsageData {
            buckets: vec![],
            error: Some("Token expired or revoked. Please run: claude /login".into()),
        }
    } else if !resp.status().is_success() {
        UsageData {
            buckets: vec![],
            error: Some(format!("API error: {}", resp.status())),
        }
    } else {
        match resp.json::<serde_json::Value>().await {
            Ok(data) => UsageData {
                buckets: parse_buckets(&data),
                error: None,
            },
            Err(e) => UsageData {
                buckets: vec![],
                error: Some(format!("Parse error: {e}")),
            },
        }
    }
}
