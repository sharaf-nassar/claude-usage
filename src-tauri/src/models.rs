use serde::{Deserialize, Serialize};

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
