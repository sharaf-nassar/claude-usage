use serde::{Deserialize, Serialize};

// Payload received from hook scripts via HTTP API
#[derive(Deserialize, Clone, Debug)]
pub struct TokenReportPayload {
    pub session_id: String,
    pub hostname: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
    #[serde(default)]
    pub cwd: Option<String>,
}

// Time-series point for token charts
#[derive(Serialize, Clone, Debug)]
pub struct TokenDataPoint {
    pub timestamp: String,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_input_tokens: i64,
    pub cache_read_input_tokens: i64,
    pub total_tokens: i64,
}

// Aggregate stats for token stats panel
#[derive(Serialize, Clone, Debug)]
pub struct TokenStats {
    pub total_input: i64,
    pub total_output: i64,
    pub total_cache_creation: i64,
    pub total_cache_read: i64,
    pub total_tokens: i64,
    pub turn_count: i64,
    pub avg_input_per_turn: f64,
    pub avg_output_per_turn: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UsageBucket {
    pub label: String,
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct UsageData {
    pub buckets: Vec<UsageBucket>,
    pub error: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct DataPoint {
    pub timestamp: String,
    pub utilization: f64,
}

// Host-level token breakdown
#[derive(Serialize, Clone, Debug)]
pub struct HostBreakdown {
    pub hostname: String,
    pub total_tokens: i64,
    pub turn_count: i64,
    pub last_active: String,
}

// Session-level token breakdown
#[derive(Serialize, Clone, Debug)]
pub struct SessionBreakdown {
    pub session_id: String,
    pub hostname: String,
    pub total_tokens: i64,
    pub turn_count: i64,
    pub first_seen: String,
    pub last_active: String,
    pub project: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub struct BucketStats {
    pub label: String,
    pub current: f64,
    pub avg: f64,
    pub max: f64,
    pub min: f64,
    pub time_above_80: f64,
    pub trend: String,
    pub sample_count: i64,
}
