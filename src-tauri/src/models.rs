use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
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
