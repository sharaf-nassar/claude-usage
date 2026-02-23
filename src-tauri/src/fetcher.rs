use crate::config::{read_access_token, refresh_access_token};
use crate::models::{UsageBucket, UsageData};
use std::sync::OnceLock;

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

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(reqwest::Client::new)
}

async fn do_fetch(token: &str) -> Result<reqwest::Response, reqwest::Error> {
    http_client()
        .get(USAGE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
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
            if let Some(util) = entry.get("utilization").and_then(|v| v.as_f64()).and_then(validate_utilization) {
                buckets.push(UsageBucket {
                    label: label.into(),
                    utilization: util,
                    resets_at: None,
                });
            }
            continue;
        }

        let Some(util) = entry.get("utilization").and_then(|v| v.as_f64()).and_then(validate_utilization) else {
            continue;
        };

        let resets_at = entry.get("resets_at")
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
        Err(e) => return UsageData { buckets: vec![], error: Some(e) },
    };

    let resp = match do_fetch(&token).await {
        Ok(r) => r,
        Err(e) => return UsageData { buckets: vec![], error: Some(format!("Request failed: {e}")) },
    };

    // On 401, try refreshing the token and retry once
    if resp.status() == reqwest::StatusCode::UNAUTHORIZED {
        match refresh_access_token().await {
            Ok(new_token) => {
                match do_fetch(&new_token).await {
                    Ok(r) => {
                        if !r.status().is_success() {
                            return UsageData {
                                buckets: vec![],
                                error: Some(format!("API error: {}", r.status())),
                            };
                        }
                        match r.json::<serde_json::Value>().await {
                            Ok(data) => UsageData { buckets: parse_buckets(&data), error: None },
                            Err(e) => UsageData { buckets: vec![], error: Some(format!("Parse error: {e}")) },
                        }
                    }
                    Err(e) => UsageData { buckets: vec![], error: Some(format!("Retry failed: {e}")) },
                }
            }
            Err(e) => UsageData { buckets: vec![], error: Some(format!("Token refresh failed: {e}")) },
        }
    } else if !resp.status().is_success() {
        UsageData {
            buckets: vec![],
            error: Some(format!("API error: {}", resp.status())),
        }
    } else {
        match resp.json::<serde_json::Value>().await {
            Ok(data) => UsageData { buckets: parse_buckets(&data), error: None },
            Err(e) => UsageData { buckets: vec![], error: Some(format!("Parse error: {e}")) },
        }
    }
}
