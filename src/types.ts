// Shared TypeScript interfaces matching Rust models in src-tauri/src/models.rs

export interface UsageBucket {
  label: string;
  utilization: number;
  resets_at: string | null;
}

export interface UsageData {
  buckets: UsageBucket[];
  error: string | null;
}

export interface DataPoint {
  timestamp: string;
  utilization: number;
}

export interface TokenDataPoint {
  timestamp: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  total_tokens: number;
}

export interface TokenStats {
  total_input: number;
  total_output: number;
  total_cache_creation: number;
  total_cache_read: number;
  total_tokens: number;
  turn_count: number;
  avg_input_per_turn: number;
  avg_output_per_turn: number;
}

export interface BucketStats {
  label: string;
  current: number;
  avg: number;
  max: number;
  min: number;
  time_above_80: number;
  trend: TrendType;
  sample_count: number;
}

export interface HostBreakdown {
  hostname: string;
  total_tokens: number;
  turn_count: number;
  last_active: string;
}

export interface SessionBreakdown {
  session_id: string;
  hostname: string;
  total_tokens: number;
  turn_count: number;
  first_seen: string;
  last_active: string;
  project: string | null;
}

export interface ProjectBreakdown {
  project: string;
  hostname: string;
  total_tokens: number;
  turn_count: number;
  session_count: number;
  last_active: string;
}

export type TimeMode = "marker" | "dual" | "background";

export type RangeType = "1h" | "24h" | "7d" | "30d";

export type TrendType = "up" | "down" | "flat" | "unknown";

export type BreakdownMode = "hosts" | "projects" | "sessions";

export interface BreakdownSelection {
  type: "host" | "project" | "session";
  key: string;
  firstSeen: string;
  lastActive: string;
}

export interface PendingUpdate {
  version: string;
  downloadAndInstall: () => Promise<void>;
}

export interface MergedDataPoint {
  timestamp: string;
  utilization: number | null;
  total_tokens: number | null;
}
