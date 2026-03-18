# Analytics Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat analytics panel with a two-tab dashboard ("Now" + "Trends") that surfaces actionable productivity and workflow insights.

**Architecture:** Refactor `AnalyticsView` into a tab container with `NowTab` (existing chart/breakdown + new insight cards) and `TrendsTab` (session health, activity heatmap, project focus, learning progress). Five new hooks compute derived metrics from existing data. One small Rust backend change removes the LIMIT 10 cap for session aggregation.

**Tech Stack:** React + TypeScript, Tauri (Rust backend), Recharts, CSS

**Spec:** `docs/superpowers/specs/2026-03-18-analytics-redesign-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/components/analytics/TabBar.tsx` | Tab navigation (Now / Trends) |
| `src/components/analytics/NowTab.tsx` | "Now" tab: insight cards + chart + breakdown |
| `src/components/analytics/TrendsTab.tsx` | "Trends" tab: session health, heatmap, projects, learning |
| `src/components/analytics/InsightCard.tsx` | Reusable stat card with headline, trend badge, sparkline |
| `src/components/analytics/CompactStatsRow.tsx` | Compact inline tokens + code changes row |
| `src/components/analytics/SessionHealthCard.tsx` | Session health with period comparison |
| `src/components/analytics/ActivityHeatmap.tsx` | 24-hour activity heatmap |
| `src/components/analytics/ProjectFocusCard.tsx` | Horizontal bar chart of project token distribution |
| `src/components/analytics/LearningProgressCard.tsx` | Rule counts + confidence histogram |
| `src/hooks/useEfficiencyStats.ts` | Computes tokens/LOC + trend + sparkline |
| `src/hooks/useVelocityStats.ts` | Computes LOC/hour + trend + sparkline |
| `src/hooks/useSessionHealth.ts` | Computes avg session duration/tokens/frequency |
| `src/hooks/useActivityPattern.ts` | Groups token data by hour-of-day |
| `src/hooks/useLearningStats.ts` | Groups learned rules by state + confidence |

### Modified Files
| File | Change |
|------|--------|
| `src/components/analytics/AnalyticsView.tsx` | Refactor to tab container (delegates to NowTab/TrendsTab) |
| `src/styles/index.css` | Add CSS for tabs, insight cards, heatmap, trends cards |
| `src/types.ts` | Add `AnalyticsTab`, `InsightTrend`, `SessionHealthStats`, `ActivityPatternData`, `LearningStatsData` types |
| `src-tauri/src/storage.rs` | Add `get_session_stats` method (unlimited session aggregation) |
| `src-tauri/src/lib.rs` | Add `get_session_stats` Tauri command + register it |

### Deleted Files
| File | Reason |
|------|--------|
| `src/components/analytics/StatsPanel.tsx` | Replaced by InsightCard + CompactStatsRow |

---

## Chunk 1: Backend + Types + Utility Hooks

### Task 1: Add `get_session_stats` Tauri command

The existing `get_session_breakdown` has `LIMIT 10` which caps session health averages. We need an unlimited variant for aggregate computation.

**Files:**
- Modify: `src-tauri/src/models.rs` (add SessionStats struct)
- Modify: `src-tauri/src/storage.rs` (add method near line 1089)
- Modify: `src-tauri/src/lib.rs` (add command + register + import)

- [ ] **Step 1: Add `SessionStats` struct to models**

In `src-tauri/src/models.rs`, find the `SessionBreakdown` struct. Add a new struct nearby:

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct SessionStats {
    pub avg_duration_seconds: f64,
    pub avg_tokens: f64,
    pub session_count: i64,
    pub total_tokens: i64,
}
```

- [ ] **Step 2: Add storage method**

In `src-tauri/src/storage.rs`, add a new method to the `Storage` impl block, near the existing `get_session_breakdown` method (~line 1089):

```rust
pub fn get_session_stats(&self, days: i32) -> Result<SessionStats, String> {
    let conn = self.conn.lock().map_err(|e| e.to_string())?;
    let cutoff = chrono::Utc::now() - chrono::Duration::days(days as i64);
    let cutoff_str = cutoff.to_rfc3339();

    let mut stmt = conn
        .prepare(
            "SELECT
                AVG(duration_seconds) as avg_duration_seconds,
                AVG(total_tokens) as avg_tokens,
                COUNT(*) as session_count,
                SUM(total_tokens) as total_tokens
            FROM (
                SELECT
                    session_id,
                    (strftime('%s', MAX(timestamp)) - strftime('%s', MIN(timestamp))) as duration_seconds,
                    SUM(input_tokens + output_tokens + cache_creation_input_tokens + cache_read_input_tokens) as total_tokens
                FROM token_snapshots
                WHERE timestamp >= ?1
                GROUP BY session_id
                HAVING COUNT(*) > 1
            )",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_row(rusqlite::params![cutoff_str], |row| {
            Ok(SessionStats {
                avg_duration_seconds: row.get::<_, Option<f64>>(0)?.unwrap_or(0.0),
                avg_tokens: row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                session_count: row.get::<_, Option<i64>>(2)?.unwrap_or(0),
                total_tokens: row.get::<_, Option<i64>>(3)?.unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(result)
}
```

- [ ] **Step 3: Add Tauri command in lib.rs**

In `src-tauri/src/lib.rs`, add a new command near the existing `get_session_breakdown` command (~line 179). Follow the existing pattern (note: `run_blocking` takes a closure, no `.await`):

```rust
#[tauri::command]
async fn get_session_stats(days: i32) -> Result<SessionStats, String> {
    let storage = get_storage()?;
    run_blocking(move || storage.get_session_stats(days))
}
```

Also add `SessionStats` to the import at the top of `lib.rs` (~line 14):

```rust
use models::{
    BucketStats, CodeStats, CodeStatsHistoryPoint, DataPoint, HostBreakdown, LearnedRule,
    LearningRun, LearningSettings, ProjectBreakdown, SessionBreakdown, SessionCodeStats,
    SessionStats, TokenDataPoint, TokenStats, ToolCount, UsageData,
};
```

- [ ] **Step 4: Register the command**

In `src-tauri/src/lib.rs`, find the `tauri::generate_handler![]` block (~line 828) and add `get_session_stats` after `get_session_breakdown`:

```rust
get_session_breakdown,
get_session_stats,
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/storage.rs src-tauri/src/lib.rs src-tauri/src/models.rs
git commit -m "feat: add get_session_stats command for unlimited session aggregation"
```

---

### Task 2: Add TypeScript types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add new types at the end of `src/types.ts`**

```typescript
// Analytics redesign types

export type AnalyticsTab = "now" | "trends";

export interface InsightTrend {
	direction: "up" | "down" | "flat";
	percentage: number;
	/** Whether "up" is good (true) or bad (false). Null = neutral. */
	upIsGood: boolean | null;
}

export interface SparklinePoint {
	value: number;
}

export interface SessionHealthStats {
	avgDurationSeconds: number;
	avgTokens: number;
	sessionsPerDay: number;
	sessionCount: number;
	prev: {
		avgDurationSeconds: number;
		avgTokens: number;
		sessionsPerDay: number;
		sessionCount: number;
	};
}

export interface ActivityPatternData {
	/** 24 values, index 0 = midnight, index 23 = 11pm */
	hourlyTokens: number[];
	peakStart: number;
	peakEnd: number;
}

export interface LearningStatsData {
	total: number;
	emerging: number;
	confirmed: number;
	/** 5 buckets: [0-20%, 20-40%, 40-60%, 60-80%, 80-100%] */
	confidenceBuckets: number[];
	newThisWeek: number;
}

export interface SessionStatsRaw {
	avg_duration_seconds: number;
	avg_tokens: number;
	session_count: number;
	total_tokens: number;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add analytics redesign TypeScript types"
```

---

### Task 3: Create `useEfficiencyStats` hook

This hook computes tokens per line of code, with a trend comparison and 7-point sparkline.

**Files:**
- Create: `src/hooks/useEfficiencyStats.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
	RangeType,
	TokenDataPoint,
	CodeStatsHistoryPoint,
	InsightTrend,
	SparklinePoint,
} from "../types";

interface EfficiencyStats {
	tokensPerLoc: number | null;
	trend: InsightTrend | null;
	sparkline: SparklinePoint[];
	loading: boolean;
}

const SPARKLINE_BUCKETS = 7;

export function getRangeMs(range: RangeType): number {
	switch (range) {
		case "1h": return 60 * 60 * 1000;
		case "24h": return 24 * 60 * 60 * 1000;
		case "7d": return 7 * 24 * 60 * 60 * 1000;
		case "30d": return 30 * 24 * 60 * 60 * 1000;
	}
}

/** Map a range to the next-larger range for 2x fetch (to get previous period data) */
function doubledRange(range: RangeType): string {
	switch (range) {
		case "1h": return "24h"; // fetches 24h, plenty for 2x 1h
		case "24h": return "7d";
		case "7d": return "30d";
		case "30d": return "30d"; // can't go larger, trend will be limited
	}
}

function computeEfficiency(tokens: number, loc: number): number | null {
	if (loc === 0) return null;
	return Math.round(tokens / loc);
}

function computeTrend(
	current: number | null,
	previous: number | null,
): InsightTrend | null {
	if (current === null || previous === null || previous === 0) return null;
	const pct = Math.round(((current - previous) / previous) * 100);
	if (Math.abs(pct) < 3) return { direction: "flat", percentage: 0, upIsGood: false };
	return {
		direction: pct > 0 ? "up" : "down",
		percentage: Math.abs(pct),
		upIsGood: false, // Lower efficiency = better
	};
}

export function useEfficiencyStats(range: RangeType): EfficiencyStats {
	const [result, setResult] = useState<EfficiencyStats>({
		tokensPerLoc: null, trend: null, sparkline: [], loading: true,
	});

	const fetchData = useCallback(async () => {
		try {
			// Fetch 2x range for trend comparison
			const fetchRange = doubledRange(range);
			const [tokenHistory, codeHistory] = await Promise.all([
				invoke<TokenDataPoint[]>("get_token_history", {
					range: fetchRange, hostname: null, sessionId: null, cwd: null,
				}),
				invoke<CodeStatsHistoryPoint[]>("get_code_stats_history", {
					range: fetchRange,
				}),
			]);

			if (tokenHistory.length === 0 || codeHistory.length === 0) {
				setResult({ tokensPerLoc: null, trend: null, sparkline: [], loading: false });
				return;
			}

			const now = Date.now();
			const rangeMs = getRangeMs(range);
			const currentStart = now - rangeMs;
			const prevStart = currentStart - rangeMs;

			let currentTokens = 0;
			let prevTokens = 0;
			for (const point of tokenHistory) {
				const ts = new Date(point.timestamp).getTime();
				if (ts >= currentStart) currentTokens += point.total_tokens;
				else if (ts >= prevStart) prevTokens += point.total_tokens;
			}

			let currentLoc = 0;
			let prevLoc = 0;
			for (const point of codeHistory) {
				const ts = new Date(point.timestamp).getTime();
				if (ts >= currentStart) currentLoc += point.total_changed;
				else if (ts >= prevStart) prevLoc += point.total_changed;
			}

			const tokensPerLoc = computeEfficiency(currentTokens, currentLoc);
			const prevEfficiency = computeEfficiency(prevTokens, prevLoc);
			const trend = computeTrend(tokensPerLoc, prevEfficiency);

			// 7-bucket sparkline over current period
			const bucketMs = rangeMs / SPARKLINE_BUCKETS;
			const sparkline: SparklinePoint[] = [];
			for (let i = 0; i < SPARKLINE_BUCKETS; i++) {
				const bucketStart = currentStart + i * bucketMs;
				const bucketEnd = bucketStart + bucketMs;
				let bTok = 0;
				for (const p of tokenHistory) {
					const ts = new Date(p.timestamp).getTime();
					if (ts >= bucketStart && ts < bucketEnd) bTok += p.total_tokens;
				}
				let bLoc = 0;
				for (const p of codeHistory) {
					const ts = new Date(p.timestamp).getTime();
					if (ts >= bucketStart && ts < bucketEnd) bLoc += p.total_changed;
				}
				sparkline.push({ value: bLoc > 0 ? Math.round(bTok / bLoc) : 0 });
			}

			setResult({ tokensPerLoc, trend, sparkline, loading: false });
		} catch (e) {
			console.error("Efficiency stats error:", e);
			setResult({ tokensPerLoc: null, trend: null, sparkline: [], loading: false });
		}
	}, [range]);

	useEffect(() => { fetchData(); }, [fetchData]);
	useEffect(() => {
		const interval = setInterval(fetchData, 60_000);
		return () => clearInterval(interval);
	}, [fetchData]);

	return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useEfficiencyStats.ts
git commit -m "feat: add useEfficiencyStats hook"
```

---

### Task 4: Create `useVelocityStats` hook

**Files:**
- Create: `src/hooks/useVelocityStats.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getRangeMs } from "./useEfficiencyStats";
import type {
	RangeType,
	CodeStatsHistoryPoint,
	InsightTrend,
	SparklinePoint,
} from "../types";

interface VelocityStats {
	locPerHour: number | null;
	trend: InsightTrend | null;
	sparkline: SparklinePoint[];
	loading: boolean;
}

const SPARKLINE_BUCKETS = 7;

function doubledRange(range: RangeType): string {
	switch (range) {
		case "1h": return "24h";
		case "24h": return "7d";
		case "7d": return "30d";
		case "30d": return "30d";
	}
}

function computeVelocity(loc: number, ms: number): number | null {
	const hours = ms / (60 * 60 * 1000);
	if (hours === 0) return null;
	return Math.round(loc / hours);
}

export function useVelocityStats(range: RangeType): VelocityStats {
	const [result, setResult] = useState<VelocityStats>({
		locPerHour: null, trend: null, sparkline: [], loading: true,
	});

	const fetchData = useCallback(async () => {
		try {
			const fetchRange = doubledRange(range);
			const codeHistory = await invoke<CodeStatsHistoryPoint[]>(
				"get_code_stats_history", { range: fetchRange },
			);

			if (codeHistory.length === 0) {
				setResult({ locPerHour: null, trend: null, sparkline: [], loading: false });
				return;
			}

			const now = Date.now();
			const rangeMs = getRangeMs(range);
			const currentStart = now - rangeMs;
			const prevStart = currentStart - rangeMs;

			let currentLoc = 0;
			let prevLoc = 0;
			for (const point of codeHistory) {
				const ts = new Date(point.timestamp).getTime();
				if (ts >= currentStart) currentLoc += point.total_changed;
				else if (ts >= prevStart) prevLoc += point.total_changed;
			}

			const locPerHour = computeVelocity(currentLoc, rangeMs);
			const prevVelocity = computeVelocity(prevLoc, rangeMs);

			let trend: InsightTrend | null = null;
			if (locPerHour !== null && prevVelocity !== null && prevVelocity > 0) {
				const pct = Math.round(((locPerHour - prevVelocity) / prevVelocity) * 100);
				if (Math.abs(pct) < 3) {
					trend = { direction: "flat", percentage: 0, upIsGood: true };
				} else {
					trend = {
						direction: pct > 0 ? "up" : "down",
						percentage: Math.abs(pct),
						upIsGood: true,
					};
				}
			}

			const bucketMs = rangeMs / SPARKLINE_BUCKETS;
			const sparkline: SparklinePoint[] = [];
			for (let i = 0; i < SPARKLINE_BUCKETS; i++) {
				const bucketStart = currentStart + i * bucketMs;
				const bucketEnd = bucketStart + bucketMs;
				let bucketLoc = 0;
				for (const p of codeHistory) {
					const ts = new Date(p.timestamp).getTime();
					if (ts >= bucketStart && ts < bucketEnd) bucketLoc += p.total_changed;
				}
				const bucketHours = bucketMs / (60 * 60 * 1000);
				sparkline.push({ value: bucketHours > 0 ? Math.round(bucketLoc / bucketHours) : 0 });
			}

			setResult({ locPerHour, trend, sparkline, loading: false });
		} catch (e) {
			console.error("Velocity stats error:", e);
			setResult({ locPerHour: null, trend: null, sparkline: [], loading: false });
		}
	}, [range]);

	useEffect(() => { fetchData(); }, [fetchData]);
	useEffect(() => {
		const interval = setInterval(fetchData, 60_000);
		return () => clearInterval(interval);
	}, [fetchData]);

	return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useVelocityStats.ts
git commit -m "feat: add useVelocityStats hook"
```

---

### Task 5: Create `useSessionHealth` hook

**Files:**
- Create: `src/hooks/useSessionHealth.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionHealthStats, SessionStatsRaw } from "../types";

export function useSessionHealth(days: number): {
	stats: SessionHealthStats | null;
	loading: boolean;
} {
	const [stats, setStats] = useState<SessionHealthStats | null>(null);
	const [loading, setLoading] = useState(true);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			// Fetch 2x the range to get current + previous period
			const [current, previous] = await Promise.all([
				invoke<SessionStatsRaw>("get_session_stats", { days }),
				invoke<SessionStatsRaw>("get_session_stats", { days: days * 2 }),
			]);

			// Previous period = (2x range totals) - (current range totals)
			const prevSessionCount = previous.session_count - current.session_count;
			const prevTotalTokens = previous.total_tokens - current.total_tokens;

			setStats({
				avgDurationSeconds: current.avg_duration_seconds,
				avgTokens: current.avg_tokens,
				sessionsPerDay: days > 0 ? current.session_count / days : 0,
				sessionCount: current.session_count,
				prev: {
					avgDurationSeconds:
						prevSessionCount > 0
							? (previous.avg_duration_seconds * previous.session_count -
									current.avg_duration_seconds * current.session_count) /
								prevSessionCount
							: 0,
					avgTokens:
						prevSessionCount > 0 ? prevTotalTokens / prevSessionCount : 0,
					sessionsPerDay: days > 0 ? prevSessionCount / days : 0,
					sessionCount: prevSessionCount,
				},
			});
		} catch (e) {
			console.error("Session health fetch error:", e);
			setStats(null);
		} finally {
			setLoading(false);
		}
	}, [days]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	useEffect(() => {
		const interval = setInterval(fetchData, 60_000);
		return () => clearInterval(interval);
	}, [fetchData]);

	return { stats, loading };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useSessionHealth.ts
git commit -m "feat: add useSessionHealth hook"
```

---

### Task 6: Create `useActivityPattern` hook

**Files:**
- Create: `src/hooks/useActivityPattern.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TokenDataPoint, ActivityPatternData } from "../types";

const RANGE_MAP: Record<number, string> = {
	7: "7d",
	30: "30d",
};

export function useActivityPattern(days: number): {
	data: ActivityPatternData | null;
	loading: boolean;
} {
	const [data, setData] = useState<ActivityPatternData | null>(null);
	const [loading, setLoading] = useState(true);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const range = RANGE_MAP[days] ?? "7d";
			const history = await invoke<TokenDataPoint[]>("get_token_history", {
				range,
				hostname: null,
				sessionId: null,
				cwd: null,
			});

			// Group by hour of day
			const hourlyTokens = new Array(24).fill(0);
			for (const point of history) {
				const hour = new Date(point.timestamp).getHours();
				hourlyTokens[hour] += point.total_tokens;
			}

			// Find peak contiguous window (at least 2 hours)
			let maxSum = 0;
			let peakStart = 0;
			let peakEnd = 0;

			for (let start = 0; start < 24; start++) {
				let sum = 0;
				for (let len = 1; len <= 6; len++) {
					const idx = (start + len - 1) % 24;
					sum += hourlyTokens[idx];
					if (len >= 2 && sum > maxSum) {
						maxSum = sum;
						peakStart = start;
						peakEnd = (start + len - 1) % 24;
					}
				}
			}

			setData({ hourlyTokens, peakStart, peakEnd });
		} catch (e) {
			console.error("Activity pattern fetch error:", e);
			setData(null);
		} finally {
			setLoading(false);
		}
	}, [days]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	return { data, loading };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useActivityPattern.ts
git commit -m "feat: add useActivityPattern hook"
```

---

### Task 7: Create `useLearningStats` hook

**Files:**
- Create: `src/hooks/useLearningStats.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { LearnedRule, LearningStatsData } from "../types";

export function useLearningStats(): {
	stats: LearningStatsData | null;
	loading: boolean;
} {
	const [stats, setStats] = useState<LearningStatsData | null>(null);
	const [loading, setLoading] = useState(true);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const rules = await invoke<LearnedRule[]>("get_learned_rules");

			let emerging = 0;
			let confirmed = 0;
			const confidenceBuckets = [0, 0, 0, 0, 0]; // 0-20, 20-40, 40-60, 60-80, 80-100
			const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
			let newThisWeek = 0;

			for (const rule of rules) {
				if (rule.state === "emerging") emerging++;
				else if (rule.state === "confirmed") confirmed++;

				const conf = rule.confidence;
				const bucketIdx = Math.min(Math.floor(conf * 5), 4);
				confidenceBuckets[bucketIdx]++;

				if (new Date(rule.created_at).getTime() >= weekAgo) {
					newThisWeek++;
				}
			}

			setStats({
				total: rules.length,
				emerging,
				confirmed,
				confidenceBuckets,
				newThisWeek,
			});
		} catch (e) {
			console.error("Learning stats fetch error:", e);
			setStats(null);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// Refresh every 60s
	useEffect(() => {
		const interval = setInterval(fetchData, 60_000);
		return () => clearInterval(interval);
	}, [fetchData]);

	return { stats, loading };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useLearningStats.ts
git commit -m "feat: add useLearningStats hook"
```

---

## Chunk 2: UI Components — "Now" Tab

### Task 8: Create `TabBar` component

**Files:**
- Create: `src/components/analytics/TabBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { AnalyticsTab } from "../../types";

interface TabBarProps {
	activeTab: AnalyticsTab;
	onTabChange: (tab: AnalyticsTab) => void;
}

const TABS: { key: AnalyticsTab; label: string; color: string }[] = [
	{ key: "now", label: "Now", color: "#58a6ff" },
	{ key: "trends", label: "Trends", color: "#a78bfa" },
];

function TabBar({ activeTab, onTabChange }: TabBarProps) {
	return (
		<div className="analytics-tab-bar">
			{TABS.map((tab) => (
				<button
					key={tab.key}
					className={`analytics-tab${activeTab === tab.key ? " active" : ""}`}
					style={
						activeTab === tab.key
							? { borderBottomColor: tab.color }
							: undefined
					}
					onClick={() => onTabChange(tab.key)}
					aria-pressed={activeTab === tab.key}
				>
					{tab.label}
				</button>
			))}
		</div>
	);
}

export default TabBar;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/TabBar.tsx
git commit -m "feat: add TabBar component"
```

---

### Task 9: Create `InsightCard` component

**Files:**
- Create: `src/components/analytics/InsightCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { InsightTrend, SparklinePoint } from "../../types";

interface InsightCardProps {
	label: string;
	value: string | null;
	subtitle: string;
	trend: InsightTrend | null;
	sparkline?: SparklinePoint[];
	accentColor?: string;
}

function trendColor(trend: InsightTrend): string {
	if (trend.direction === "flat") return "#8b949e";
	const isGood =
		trend.upIsGood === null
			? null
			: trend.direction === "up"
				? trend.upIsGood
				: !trend.upIsGood;
	if (isGood === null) return "#8b949e";
	return isGood ? "#3fb950" : "#f85149";
}

function trendBgColor(trend: InsightTrend): string {
	if (trend.direction === "flat") return "#21262d";
	const isGood =
		trend.upIsGood === null
			? null
			: trend.direction === "up"
				? trend.upIsGood
				: !trend.upIsGood;
	if (isGood === null) return "#21262d";
	return isGood ? "#0d2818" : "#3d1a1a";
}

function trendLabel(trend: InsightTrend): string {
	if (trend.direction === "flat") return "\u2192 steady";
	const arrow = trend.direction === "up" ? "\u25B2" : "\u25BC";
	return `${arrow} ${trend.percentage}%`;
}

function InsightCard({
	label,
	value,
	subtitle,
	trend,
	sparkline,
	accentColor = "#58a6ff",
}: InsightCardProps) {
	const maxVal = sparkline
		? Math.max(...sparkline.map((p) => p.value), 1)
		: 1;

	return (
		<div className="insight-card">
			<div className="insight-card-header">
				<span className="insight-card-label">{label}</span>
				{trend && (
					<span
						className="insight-card-trend"
						style={{
							color: trendColor(trend),
							background: trendBgColor(trend),
						}}
					>
						{trendLabel(trend)}
					</span>
				)}
			</div>
			<div className="insight-card-value" style={{ color: value ? accentColor : "#484f58" }}>
				{value ?? "\u2014"}
			</div>
			<div className="insight-card-subtitle">{subtitle}</div>
			{sparkline && sparkline.length > 0 && (
				<div className="insight-card-sparkline">
					{sparkline.map((point, i) => (
						<div
							key={i}
							className="insight-card-sparkline-bar"
							style={{
								height: `${(point.value / maxVal) * 100}%`,
								background:
									i === sparkline.length - 1
										? accentColor
										: `${accentColor}33`,
							}}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export default InsightCard;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/InsightCard.tsx
git commit -m "feat: add InsightCard component"
```

---

### Task 10: Create `CompactStatsRow` component

**Files:**
- Create: `src/components/analytics/CompactStatsRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { formatTokenCount } from "../../utils/tokens";
import type { TokenStats, CodeStats } from "../../types";

interface CompactStatsRowProps {
	tokenStats: TokenStats | null;
	codeStats: CodeStats | null;
}

function formatNumber(n: number): string {
	if (Math.abs(n) >= 1000) {
		return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
	}
	return String(n);
}

function CompactStatsRow({ tokenStats, codeStats }: CompactStatsRowProps) {
	return (
		<div className="compact-stats-row">
			{tokenStats && tokenStats.total_tokens > 0 && (
				<div className="compact-stats-card">
					<div className="compact-stat">
						<span className="compact-stat-label">In</span>
						<span className="compact-stat-value">
							{formatTokenCount(tokenStats.total_input)}
						</span>
					</div>
					<div className="compact-stat">
						<span className="compact-stat-label">Out</span>
						<span className="compact-stat-value">
							{formatTokenCount(tokenStats.total_output)}
						</span>
					</div>
					{tokenStats.total_input + tokenStats.total_cache_read > 0 && (
						<div className="compact-stat">
							<span className="compact-stat-label">Cache</span>
							<span
								className="compact-stat-value"
								style={{
									color:
										tokenStats.total_cache_read /
											(tokenStats.total_input + tokenStats.total_cache_read) >=
										0.6
											? "#22C55E"
											: tokenStats.total_cache_read /
														(tokenStats.total_input +
															tokenStats.total_cache_read) >=
												0.3
												? "#EAB308"
												: "#EF4444",
								}}
							>
								{Math.round(
									(tokenStats.total_cache_read /
										(tokenStats.total_input + tokenStats.total_cache_read)) *
										100,
								)}
								%
							</span>
						</div>
					)}
				</div>
			)}
			{codeStats && (
				<div className="compact-stats-card">
					<div className="compact-stat">
						<span className="compact-stat-label">Added</span>
						<span className="compact-stat-value" style={{ color: "#22c55e" }}>
							+{formatNumber(codeStats.lines_added)}
						</span>
					</div>
					<div className="compact-stat">
						<span className="compact-stat-label">Removed</span>
						<span className="compact-stat-value" style={{ color: "#f87171" }}>
							-{formatNumber(codeStats.lines_removed)}
						</span>
					</div>
					<div className="compact-stat">
						<span className="compact-stat-label">Net</span>
						<span
							className="compact-stat-value"
							style={{
								color: codeStats.net_change >= 0 ? "#22c55e" : "#f87171",
							}}
						>
							{codeStats.net_change >= 0 ? "+" : ""}
							{formatNumber(codeStats.net_change)}
						</span>
					</div>
				</div>
			)}
		</div>
	);
}

export default CompactStatsRow;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/CompactStatsRow.tsx
git commit -m "feat: add CompactStatsRow component"
```

---

### Task 11: Create `NowTab` component

This moves existing chart/breakdown logic from `AnalyticsView` into a dedicated tab, and adds the new insight cards.

**Files:**
- Create: `src/components/analytics/NowTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useMemo } from "react";
import { useAnalyticsData } from "../../hooks/useAnalyticsData";
import { useTokenData } from "../../hooks/useTokenData";
import { useCodeStats } from "../../hooks/useCodeStats";
import { useEfficiencyStats } from "../../hooks/useEfficiencyStats";
import { useVelocityStats } from "../../hooks/useVelocityStats";
import InsightCard from "./InsightCard";
import CompactStatsRow from "./CompactStatsRow";
import UsageChart from "./UsageChart";
import BreakdownPanel from "./BreakdownPanel";
import TogglePills from "./TogglePills";
import type {
	RangeType,
	UsageBucket,
	BreakdownSelection,
	ChartSeriesVisibility,
} from "../../types";

const RANGES: RangeType[] = ["1h", "24h", "7d", "30d"];
const RANGE_LABELS: Record<RangeType, string> = {
	"1h": "1H",
	"24h": "24H",
	"7d": "7D",
	"30d": "30D",
};
const RANGE_DAYS: Record<RangeType, number> = {
	"1h": 1,
	"24h": 1,
	"7d": 7,
	"30d": 30,
};
const DAYS_TO_RANGE: Record<number, RangeType> = {
	1: "24h",
	7: "7d",
	30: "30d",
};

const VISIBILITY_KEY = "quill-chart-series-visibility";
const BREAKDOWN_COLLAPSED_KEY = "quill-breakdown-collapsed";

interface BucketDropdownProps {
	value: string;
	options: string[];
	onChange: (value: string) => void;
}

function BucketDropdown({ value, options, onChange }: BucketDropdownProps) {
	const [open, setOpen] = useState(false);

	return (
		<div className="bucket-dropdown-wrap">
			<button
				className="bucket-dropdown-trigger"
				onClick={() => setOpen((v) => !v)}
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-label={`Select bucket: ${value}`}
			>
				{value}
				<span className="bucket-dropdown-arrow">&#9662;</span>
			</button>
			{open && (
				<div className="bucket-dropdown-menu" role="listbox" aria-label="Usage buckets">
					{options.map((opt) => (
						<button
							key={opt}
							className={`bucket-dropdown-item${opt === value ? " active" : ""}`}
							role="option"
							aria-selected={opt === value}
							onClick={() => {
								onChange(opt);
								setOpen(false);
							}}
						>
							{opt}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

interface NowTabProps {
	range: RangeType;
	onRangeChange: (r: RangeType) => void;
	currentBuckets: UsageBucket[];
}

function NowTab({ range, onRangeChange, currentBuckets }: NowTabProps) {
	const [selectedBucket, setSelectedBucket] = useState(
		() => currentBuckets?.[0]?.label ?? "7 days",
	);
	const [breakdownSelection, setBreakdownSelection] =
		useState<BreakdownSelection | null>(null);
	const [breakdownCollapsed, setBreakdownCollapsed] = useState(() => {
		try {
			return localStorage.getItem(BREAKDOWN_COLLAPSED_KEY) === "true";
		} catch {
			return false;
		}
	});
	const [seriesVisibility, setSeriesVisibility] = useState<ChartSeriesVisibility>(() => {
		try {
			const saved = localStorage.getItem(VISIBILITY_KEY);
			if (saved) return JSON.parse(saved);
		} catch { /* ignore */ }
		return { utilization: true, tokens: true, loc: true };
	});

	const handleVisibilityChange = (v: ChartSeriesVisibility) => {
		setSeriesVisibility(v);
		try {
			localStorage.setItem(VISIBILITY_KEY, JSON.stringify(v));
		} catch { /* ignore */ }
	};

	const breakdownDays = RANGE_DAYS[range] ?? 1;
	const hasSelection = breakdownSelection !== null;
	const tokenRange: RangeType = hasSelection
		? (DAYS_TO_RANGE[breakdownDays] ?? "24h")
		: range;

	const bucketsKey = (currentBuckets ?? [])
		.map((b) => `${b.label}:${b.utilization}:${b.resets_at ?? ""}`)
		.join(",");
	const stableBuckets = useMemo(() => currentBuckets, [bucketsKey]);

	const { history, stats, loading, error } = useAnalyticsData(
		selectedBucket,
		range,
		stableBuckets,
	);

	const tokenHostname =
		breakdownSelection?.type === "host" ? breakdownSelection.key : null;
	const tokenSessionId =
		breakdownSelection?.type === "session" ? breakdownSelection.key : null;
	const tokenCwd =
		breakdownSelection?.type === "project" ? breakdownSelection.key : null;
	const { history: tokenHistory, stats: tokenStats } = useTokenData(
		tokenRange,
		tokenHostname,
		tokenSessionId,
		tokenCwd,
	);

	const { stats: codeStats, history: codeHistory } = useCodeStats(range);

	// Efficiency and velocity hooks fetch their own 2x data for trend comparison
	const efficiencyStats = useEfficiencyStats(range);
	const velocityStats = useVelocityStats(range);

	return (
		<>
			<div className="analytics-controls">
				<div className={`range-tabs${hasSelection ? " dimmed" : ""}`}>
					{RANGES.map((r) => (
						<button
							key={r}
							className={`range-tab${range === r ? " active" : ""}`}
							aria-pressed={range === r}
							onClick={() => onRangeChange(r)}
						>
							{RANGE_LABELS[r]}
						</button>
					))}
				</div>
				<TogglePills
					visibility={seriesVisibility}
					onChange={handleVisibilityChange}
					hasTokenData={tokenHistory.length > 0}
					hasLocData={codeHistory.length > 0}
				/>
				<BucketDropdown
					value={selectedBucket}
					options={(currentBuckets ?? []).map((b) => b.label)}
					onChange={setSelectedBucket}
				/>
			</div>

			{error && (
				<div className="analytics-error" role="alert">
					Failed to load analytics
				</div>
			)}

			{loading ? (
				<>
					<div className="chart-skeleton" />
					<div className="breakdown-skeleton">
						<div className="breakdown-skeleton-row" />
						<div className="breakdown-skeleton-row" />
						<div className="breakdown-skeleton-row" />
					</div>
				</>
			) : (
				<>
					{/* Insight cards row */}
					<div className="insight-cards-row">
						<InsightCard
							label="Efficiency"
							value={
								efficiencyStats.tokensPerLoc !== null
									? String(efficiencyStats.tokensPerLoc)
									: null
							}
							subtitle="tokens per line of code"
							trend={efficiencyStats.trend}
							sparkline={efficiencyStats.sparkline}
							accentColor="#58a6ff"
						/>
						<InsightCard
							label="Velocity"
							value={
								velocityStats.locPerHour !== null
									? String(velocityStats.locPerHour)
									: null
							}
							subtitle="lines changed per hour"
							trend={velocityStats.trend}
							sparkline={velocityStats.sparkline}
							accentColor="#a78bfa"
						/>
						<InsightCard
							label="Rate Limit"
							value={
								stats
									? `${stats.avg.toFixed(0)}%`
									: null
							}
							subtitle={
								stats
									? `peak ${stats.max.toFixed(0)}% · ${Math.round(stats.time_above_80)}m above 80%`
									: "no data"
							}
							trend={
								stats
									? {
											direction: stats.trend === "up" ? "up" : stats.trend === "down" ? "down" : "flat",
											percentage: 0,
											upIsGood: false,
										}
									: null
							}
							accentColor={
								stats
									? stats.avg >= 80
										? "#f87171"
										: stats.avg >= 50
											? "#fbbf24"
											: "#34d399"
									: "#8b949e"
							}
						/>
					</div>

					{/* Compact tokens + code row */}
					<CompactStatsRow tokenStats={tokenStats} codeStats={codeStats} />

					{/* Chart — no analytics-split wrapper since StatsPanel is removed */}
					<div className="chart-section">
						<div className="section-title">
							{selectedBucket} Usage
								{hasSelection && breakdownSelection && (
									<span className="filter-badge">
										{breakdownSelection.type === "host"
											? breakdownSelection.key
											: breakdownSelection.type === "project"
												? breakdownSelection.key.split("/").filter(Boolean).pop()
												: breakdownSelection.key.slice(0, 8)}
										<button
											className="filter-badge-clear"
											onClick={() => setBreakdownSelection(null)}
											aria-label="Clear filter"
										>
											&#10005;
										</button>
									</span>
								)}
							</div>
							<UsageChart
								data={history}
								range={range}
								bucket={selectedBucket}
								tokenData={tokenHistory}
								locData={codeHistory}
								visibility={seriesVisibility}
							/>
					</div>

					{/* Breakdown */}
					<div className="breakdown-collapsible">
						<button
							className="breakdown-collapse-toggle"
							onClick={() => {
								const next = !breakdownCollapsed;
								setBreakdownCollapsed(next);
								try {
									localStorage.setItem(BREAKDOWN_COLLAPSED_KEY, String(next));
								} catch { /* ignore */ }
							}}
							aria-expanded={!breakdownCollapsed}
							aria-label={breakdownCollapsed ? "Show breakdown" : "Hide breakdown"}
						>
							<span className="breakdown-collapse-chevron">
								{breakdownCollapsed ? "\u25B8" : "\u25BE"}
							</span>
							<span className="section-title" style={{ marginBottom: 0 }}>Breakdown</span>
						</button>
						{!breakdownCollapsed && (
							<BreakdownPanel
								days={RANGE_DAYS[range] ?? 1}
								selection={breakdownSelection}
								onSelect={setBreakdownSelection}
							/>
						)}
					</div>
				</>
			)}
		</>
	);
}

export default NowTab;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/NowTab.tsx
git commit -m "feat: add NowTab component"
```

---

## Chunk 3: UI Components — "Trends" Tab

### Task 12: Create `SessionHealthCard` component

**Files:**
- Create: `src/components/analytics/SessionHealthCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { formatTokenCount } from "../../utils/tokens";
import type { SessionHealthStats } from "../../types";

interface SessionHealthCardProps {
	stats: SessionHealthStats;
}

function formatDuration(seconds: number): string {
	if (seconds < 60) return "< 1 min";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function comparisonText(current: number, previous: number, formatter: (n: number) => string): string | null {
	if (previous === 0) return null;
	return `was ${formatter(previous)} last period`;
}

function statusBadge(stats: SessionHealthStats): { label: string; color: string; bg: string } | null {
	if (stats.prev.avgDurationSeconds === 0) return null;
	const durationChange =
		(stats.avgDurationSeconds - stats.prev.avgDurationSeconds) /
		stats.prev.avgDurationSeconds;

	if (durationChange > 0.15) {
		return { label: "sessions growing longer", color: "#f0883e", bg: "#3d2a1a" };
	}
	if (durationChange < -0.15) {
		return { label: "sessions getting shorter", color: "#3fb950", bg: "#0d2818" };
	}
	return { label: "session length stable", color: "#8b949e", bg: "#21262d" };
}

function SessionHealthCard({ stats }: SessionHealthCardProps) {
	const badge = statusBadge(stats);
	const durationComparison = comparisonText(
		stats.avgDurationSeconds,
		stats.prev.avgDurationSeconds,
		(s) => formatDuration(s),
	);
	const tokensComparison = comparisonText(
		stats.avgTokens,
		stats.prev.avgTokens,
		(t) => formatTokenCount(Math.round(t)),
	);

	return (
		<div className="trends-card">
			<div className="trends-card-header">
				<span className="trends-card-title">Session Health</span>
				{badge && (
					<span
						className="trends-card-badge"
						style={{ color: badge.color, background: badge.bg }}
					>
						{badge.label}
					</span>
				)}
			</div>
			<div className="session-health-metrics">
				<div className="session-health-metric">
					<div className="session-health-label">Avg Duration</div>
					<div className="session-health-value" style={{ color: "#f0883e" }}>
						{formatDuration(stats.avgDurationSeconds)}
					</div>
					{durationComparison && (
						<div className="session-health-comparison">{durationComparison}</div>
					)}
				</div>
				<div className="session-health-metric">
					<div className="session-health-label">Avg Tokens/Session</div>
					<div className="session-health-value">
						{formatTokenCount(Math.round(stats.avgTokens))}
					</div>
					{tokensComparison && (
						<div className="session-health-comparison">{tokensComparison}</div>
					)}
				</div>
				<div className="session-health-metric">
					<div className="session-health-label">Sessions/Day</div>
					<div className="session-health-value">
						{stats.sessionsPerDay.toFixed(1)}
					</div>
					{stats.prev.sessionsPerDay > 0 && (
						<div className="session-health-comparison">
							was {stats.prev.sessionsPerDay.toFixed(1)} last period
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export default SessionHealthCard;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/SessionHealthCard.tsx
git commit -m "feat: add SessionHealthCard component"
```

---

### Task 13: Create `ActivityHeatmap` component

**Files:**
- Create: `src/components/analytics/ActivityHeatmap.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { ActivityPatternData } from "../../types";

interface ActivityHeatmapProps {
	data: ActivityPatternData;
}

const HOUR_LABELS: Record<number, string> = {
	0: "12a",
	3: "3a",
	6: "6a",
	9: "9a",
	12: "12p",
	15: "3p",
	18: "6p",
	21: "9p",
};

function intensityColor(value: number, max: number): string {
	if (max === 0 || value === 0) return "rgba(255,255,255,0.03)";
	const ratio = value / max;
	if (ratio > 0.75) return "#39d353";
	if (ratio > 0.5) return "#26a641";
	if (ratio > 0.25) return "#006d32";
	return "#0e4429";
}

function formatPeakHours(start: number, end: number): string {
	const fmt = (h: number) => {
		if (h === 0) return "12am";
		if (h === 12) return "12pm";
		return h < 12 ? `${h}am` : `${h - 12}pm`;
	};
	return `Peak: ${fmt(start)} - ${fmt((end + 1) % 24)}`;
}

function ActivityHeatmap({ data }: ActivityHeatmapProps) {
	const max = Math.max(...data.hourlyTokens);

	return (
		<div className="trends-card">
			<div className="trends-card-header">
				<span className="trends-card-title">Activity Patterns</span>
				<span className="trends-card-subtitle">
					{formatPeakHours(data.peakStart, data.peakEnd)}
				</span>
			</div>
			<div className="activity-heatmap">
				{data.hourlyTokens.map((tokens, hour) => (
					<div key={hour} className="activity-heatmap-slot">
						{HOUR_LABELS[hour] !== undefined && (
							<div className="activity-heatmap-label">{HOUR_LABELS[hour]}</div>
						)}
						<div
							className="activity-heatmap-cell"
							style={{ background: intensityColor(tokens, max) }}
							title={`${hour}:00 — ${tokens.toLocaleString()} tokens`}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

export default ActivityHeatmap;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/ActivityHeatmap.tsx
git commit -m "feat: add ActivityHeatmap component"
```

---

### Task 14: Create `ProjectFocusCard` component

**Files:**
- Create: `src/components/analytics/ProjectFocusCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { formatTokenCount } from "../../utils/tokens";
import type { ProjectBreakdown } from "../../types";

interface ProjectFocusCardProps {
	data: ProjectBreakdown[];
}

const BAR_COLORS = ["#58a6ff", "#a78bfa", "#f0883e", "#3fb950", "#f87171"];

function projectName(path: string): string {
	const segments = path.split("/").filter(Boolean);
	return segments.length > 0 ? segments[segments.length - 1] : path;
}

function ProjectFocusCard({ data }: ProjectFocusCardProps) {
	// Merge by project path across hosts
	const merged = new Map<string, number>();
	for (const row of data) {
		merged.set(row.project, (merged.get(row.project) ?? 0) + row.total_tokens);
	}

	// Sort descending, take top 5, group rest as "Other"
	const sorted = [...merged.entries()].sort((a, b) => b[1] - a[1]);
	const total = sorted.reduce((sum, [, tokens]) => sum + tokens, 0);
	const top5 = sorted.slice(0, 5);
	const otherTokens = sorted.slice(5).reduce((sum, [, tokens]) => sum + tokens, 0);

	const items = [
		...top5.map(([project, tokens]) => ({ name: projectName(project), tokens })),
		...(otherTokens > 0 ? [{ name: "Other", tokens: otherTokens }] : []),
	];

	return (
		<div className="trends-card">
			<span className="trends-card-title">Project Focus</span>
			<div className="project-focus-bars">
				{items.map((item, i) => {
					const pct = total > 0 ? (item.tokens / total) * 100 : 0;
					return (
						<div key={item.name} className="project-focus-item">
							<div className="project-focus-row">
								<span className="project-focus-name">{item.name}</span>
								<span className="project-focus-stats">
									{Math.round(pct)}% &middot; {formatTokenCount(item.tokens)}
								</span>
							</div>
							<div className="project-focus-bar-bg">
								<div
									className="project-focus-bar-fill"
									style={{
										width: `${pct}%`,
										background: BAR_COLORS[i % BAR_COLORS.length],
									}}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export default ProjectFocusCard;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/ProjectFocusCard.tsx
git commit -m "feat: add ProjectFocusCard component"
```

---

### Task 15: Create `LearningProgressCard` component

**Files:**
- Create: `src/components/analytics/LearningProgressCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import type { LearningStatsData } from "../../types";

interface LearningProgressCardProps {
	stats: LearningStatsData;
}

const BUCKET_COLORS = ["#f85149", "#f0883e", "#d29922", "#3fb950", "#3fb950"];

function LearningProgressCard({ stats }: LearningProgressCardProps) {
	const maxBucket = Math.max(...stats.confidenceBuckets, 1);

	return (
		<div className="trends-card">
			<span className="trends-card-title">Learning</span>
			<div className="learning-stats-row">
				<div className="learning-stat">
					<div className="learning-stat-value" style={{ color: "#3fb950" }}>
						{stats.total}
					</div>
					<div className="learning-stat-label">rules</div>
				</div>
				<div className="learning-stat">
					<div className="learning-stat-value" style={{ color: "#d29922" }}>
						{stats.emerging}
					</div>
					<div className="learning-stat-label">emerging</div>
				</div>
				<div className="learning-stat">
					<div className="learning-stat-value" style={{ color: "#3fb950" }}>
						{stats.confirmed}
					</div>
					<div className="learning-stat-label">confirmed</div>
				</div>
			</div>
			<div className="learning-confidence-label">Confidence distribution</div>
			<div className="learning-confidence-chart">
				{stats.confidenceBuckets.map((count, i) => (
					<div
						key={i}
						className="learning-confidence-bar"
						style={{
							height: `${(count / maxBucket) * 100}%`,
							background: BUCKET_COLORS[i],
						}}
						title={`${i * 20}-${(i + 1) * 20}%: ${count} rules`}
					/>
				))}
			</div>
			<div className="learning-confidence-axis">
				<span>Low</span>
				<span>High</span>
			</div>
			{stats.newThisWeek > 0 && (
				<div className="learning-growth" style={{ color: "#3fb950" }}>
					+{stats.newThisWeek} new rules this week
				</div>
			)}
		</div>
	);
}

export default LearningProgressCard;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/LearningProgressCard.tsx
git commit -m "feat: add LearningProgressCard component"
```

---

### Task 16: Create `TrendsTab` component

**Files:**
- Create: `src/components/analytics/TrendsTab.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useSessionHealth } from "../../hooks/useSessionHealth";
import { useActivityPattern } from "../../hooks/useActivityPattern";
import { useLearningStats } from "../../hooks/useLearningStats";
import { useBreakdownData } from "../../hooks/useBreakdownData";
import SessionHealthCard from "./SessionHealthCard";
import ActivityHeatmap from "./ActivityHeatmap";
import ProjectFocusCard from "./ProjectFocusCard";
import LearningProgressCard from "./LearningProgressCard";
import type { RangeType, ProjectBreakdown } from "../../types";

const TREND_RANGES: RangeType[] = ["7d", "30d"];
const RANGE_LABELS: Record<string, string> = { "7d": "7D", "30d": "30D" };
const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30 };

interface TrendsTabProps {
	range: RangeType;
	onRangeChange: (r: RangeType) => void;
}

function TrendsTab({ range, onRangeChange }: TrendsTabProps) {
	const days = RANGE_DAYS[range] ?? 7;

	const { stats: sessionHealth, loading: sessionLoading } = useSessionHealth(days);
	const { data: activityPattern, loading: activityLoading } = useActivityPattern(days);
	const { stats: learningStats, loading: learningLoading } = useLearningStats();
	const { data: projectData, loading: projectLoading } = useBreakdownData("projects", days);

	return (
		<>
			<div className="analytics-controls">
				<div className="range-tabs">
					{TREND_RANGES.map((r) => (
						<button
							key={r}
							className={`range-tab${range === r ? " active" : ""}`}
							aria-pressed={range === r}
							onClick={() => onRangeChange(r)}
						>
							{RANGE_LABELS[r]}
						</button>
					))}
				</div>
			</div>

			{/* Session Health */}
			{sessionLoading ? (
				<div className="trends-card-skeleton" />
			) : sessionHealth && sessionHealth.sessionCount > 0 ? (
				<SessionHealthCard stats={sessionHealth} />
			) : (
				<div className="trends-card trends-card-empty">No session data yet</div>
			)}

			{/* Activity Patterns */}
			{activityLoading ? (
				<div className="trends-card-skeleton" />
			) : activityPattern ? (
				<ActivityHeatmap data={activityPattern} />
			) : (
				<div className="trends-card trends-card-empty">No activity data yet</div>
			)}

			{/* Bottom row: Project Focus + Learning */}
			<div className="trends-bottom-row">
				{projectLoading ? (
					<div className="trends-card-skeleton" />
				) : projectData.length > 0 ? (
					<ProjectFocusCard data={projectData as ProjectBreakdown[]} />
				) : (
					<div className="trends-card trends-card-empty">No project data yet</div>
				)}

				{learningLoading ? (
					<div className="trends-card-skeleton" />
				) : learningStats && learningStats.total > 0 ? (
					<LearningProgressCard stats={learningStats} />
				) : (
					<div className="trends-card trends-card-empty">No learned rules yet</div>
				)}
			</div>
		</>
	);
}

export default TrendsTab;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/TrendsTab.tsx
git commit -m "feat: add TrendsTab component"
```

---

## Chunk 4: Refactor AnalyticsView + CSS + Cleanup

### Task 17: Refactor `AnalyticsView` into tab container

**Files:**
- Modify: `src/components/analytics/AnalyticsView.tsx`

- [ ] **Step 1: Replace the contents of AnalyticsView.tsx**

Replace the entire file. The new version is a thin container that renders `TabBar` + the active tab:

```tsx
import { useState, useMemo } from "react";
import { useAnalyticsData } from "../../hooks/useAnalyticsData";
import TabBar from "./TabBar";
import NowTab from "./NowTab";
import TrendsTab from "./TrendsTab";
import type { RangeType, UsageBucket, AnalyticsTab } from "../../types";

const TAB_KEY = "quill-analytics-tab";

interface AnalyticsViewProps {
	currentBuckets: UsageBucket[];
}

function AnalyticsView({ currentBuckets }: AnalyticsViewProps) {
	const [activeTab, setActiveTab] = useState<AnalyticsTab>(() => {
		try {
			const saved = localStorage.getItem(TAB_KEY);
			if (saved === "now" || saved === "trends") return saved;
		} catch { /* ignore */ }
		return "now";
	});
	const [nowRange, setNowRange] = useState<RangeType>("24h");
	const [trendsRange, setTrendsRange] = useState<RangeType>("7d");

	const handleTabChange = (tab: AnalyticsTab) => {
		setActiveTab(tab);
		try {
			localStorage.setItem(TAB_KEY, tab);
		} catch { /* ignore */ }
	};

	const bucketsKey = (currentBuckets ?? [])
		.map((b) => `${b.label}:${b.utilization}:${b.resets_at ?? ""}`)
		.join(",");
	const stableBuckets = useMemo(() => currentBuckets, [bucketsKey]);

	// Check if we have any snapshot data to show the empty state
	const { snapshotCount, loading } = useAnalyticsData(
		currentBuckets?.[0]?.label ?? "7 days",
		"24h",
		stableBuckets,
	);

	if (snapshotCount === 0 && !loading) {
		return (
			<div className="analytics-view">
				<div className="analytics-empty-state">
					<svg
						className="analytics-empty-icon"
						width="32"
						height="32"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="10" />
						<polyline points="12 6 12 12 16 14" />
					</svg>
					<div className="analytics-empty-title">
						{"Collecting usage data\u2026"}
					</div>
					<div className="analytics-empty-desc">
						Analytics will appear here once enough data has been recorded. Data
						is captured every 60 seconds.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="analytics-view">
			<TabBar activeTab={activeTab} onTabChange={handleTabChange} />
			{activeTab === "now" ? (
				<NowTab
					range={nowRange}
					onRangeChange={setNowRange}
					currentBuckets={currentBuckets}
				/>
			) : (
				<TrendsTab
					range={trendsRange}
					onRangeChange={setTrendsRange}
				/>
			)}
		</div>
	);
}

export default AnalyticsView;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/AnalyticsView.tsx
git commit -m "refactor: convert AnalyticsView to tab container"
```

---

### Task 18: Delete `StatsPanel.tsx`

**Files:**
- Delete: `src/components/analytics/StatsPanel.tsx`

- [ ] **Step 1: Delete the file**

```bash
rm src/components/analytics/StatsPanel.tsx
```

- [ ] **Step 2: Verify no remaining imports**

Run: `grep -r "StatsPanel" src/ --include="*.tsx" --include="*.ts"`
Expected: no results (NowTab uses InsightCard + CompactStatsRow instead)

- [ ] **Step 3: Commit**

```bash
git add -u src/components/analytics/StatsPanel.tsx
git commit -m "refactor: remove StatsPanel (replaced by InsightCard + CompactStatsRow)"
```

---

### Task 19: Add CSS for new components

**Files:**
- Modify: `src/styles/index.css`

- [ ] **Step 1: Add CSS at the end of `src/styles/index.css`**

Append the following CSS after the existing analytics styles:

```css
/* ─── Analytics tabs ─── */
.analytics-tab-bar {
	display: flex;
	gap: 0;
	flex-shrink: 0;
}

.analytics-tab {
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	color: #484f58;
	font-size: 11px;
	font-weight: 600;
	padding: 5px 14px;
	cursor: pointer;
	transition: color 0.15s ease;
}

.analytics-tab:hover {
	color: rgba(255, 255, 255, 0.7);
}

.analytics-tab.active {
	color: #e6edf3;
}

/* ─── Insight cards ─── */
.insight-cards-row {
	display: grid;
	grid-template-columns: 1fr 1fr 1fr;
	gap: 8px;
}

@container (max-width: 500px) {
	.insight-cards-row {
		grid-template-columns: 1fr;
	}
}

.insight-card {
	background: #161b22;
	border-radius: 8px;
	padding: 10px;
	border: 1px solid #21262d;
}

.insight-card-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 4px;
}

.insight-card-label {
	font-size: 9px;
	color: #8b949e;
	text-transform: uppercase;
	letter-spacing: 0.5px;
}

.insight-card-trend {
	font-size: 8px;
	padding: 1px 6px;
	border-radius: 8px;
}

.insight-card-value {
	font-size: 20px;
	font-weight: 700;
	line-height: 1;
}

.insight-card-subtitle {
	font-size: 9px;
	color: #484f58;
	margin-top: 2px;
}

.insight-card-sparkline {
	margin-top: 6px;
	display: flex;
	align-items: flex-end;
	gap: 2px;
	height: 20px;
}

.insight-card-sparkline-bar {
	flex: 1;
	border-radius: 1px;
	min-height: 1px;
	transition: height 0.3s ease;
}

/* ─── Compact stats row ─── */
.compact-stats-row {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}

.compact-stats-card {
	background: #161b22;
	border-radius: 8px;
	padding: 8px 10px;
	border: 1px solid #21262d;
	display: flex;
	gap: 16px;
	align-items: center;
}

.compact-stat-label {
	font-size: 8px;
	color: #8b949e;
	display: block;
}

.compact-stat-value {
	font-size: 12px;
	color: #e6edf3;
	font-weight: 600;
}

/* ─── Trends tab cards ─── */
.trends-card {
	background: #161b22;
	border-radius: 8px;
	padding: 10px;
	border: 1px solid #21262d;
}

.trends-card-empty {
	color: #484f58;
	font-size: 11px;
	text-align: center;
	padding: 20px;
}

.trends-card-skeleton {
	background: #161b22;
	border-radius: 8px;
	border: 1px solid #21262d;
	height: 80px;
	animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
	0%, 100% { opacity: 0.4; }
	50% { opacity: 0.7; }
}

.trends-card-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 8px;
}

.trends-card-title {
	font-size: 10px;
	color: #e6edf3;
	font-weight: 600;
	display: block;
	margin-bottom: 8px;
}

.trends-card-header .trends-card-title {
	margin-bottom: 0;
}

.trends-card-badge {
	font-size: 8px;
	padding: 1px 6px;
	border-radius: 8px;
}

.trends-card-subtitle {
	font-size: 9px;
	color: #8b949e;
}

.trends-bottom-row {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 8px;
}

@container (max-width: 500px) {
	.trends-bottom-row {
		grid-template-columns: 1fr;
	}
}

/* ─── Session health ─── */
.session-health-metrics {
	display: flex;
	gap: 20px;
}

.session-health-label {
	font-size: 8px;
	color: #8b949e;
}

.session-health-value {
	font-size: 16px;
	color: #e6edf3;
	font-weight: 700;
}

.session-health-comparison {
	font-size: 8px;
	color: #8b949e;
	margin-top: 2px;
}

/* ─── Activity heatmap ─── */
.activity-heatmap {
	display: flex;
	gap: 1px;
	margin-bottom: 4px;
}

.activity-heatmap-slot {
	flex: 1;
	text-align: center;
}

.activity-heatmap-label {
	font-size: 6px;
	color: #484f58;
	margin-bottom: 2px;
	height: 10px;
}

.activity-heatmap-cell {
	height: 18px;
	border-radius: 2px;
}

/* ─── Project focus ─── */
.project-focus-bars {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.project-focus-row {
	display: flex;
	justify-content: space-between;
	font-size: 8px;
	margin-bottom: 2px;
}

.project-focus-name {
	color: #e6edf3;
}

.project-focus-stats {
	color: #8b949e;
}

.project-focus-bar-bg {
	height: 6px;
	background: #21262d;
	border-radius: 3px;
	overflow: hidden;
}

.project-focus-bar-fill {
	height: 100%;
	border-radius: 3px;
	transition: width 0.3s ease;
}

/* ─── Learning progress ─── */
.learning-stats-row {
	display: flex;
	gap: 12px;
	margin-bottom: 8px;
}

.learning-stat-value {
	font-size: 18px;
	font-weight: 700;
}

.learning-stat-label {
	font-size: 8px;
	color: #8b949e;
}

.learning-confidence-label {
	font-size: 8px;
	color: #8b949e;
	margin-bottom: 4px;
}

.learning-confidence-chart {
	display: flex;
	gap: 1px;
	height: 20px;
	align-items: flex-end;
}

.learning-confidence-bar {
	flex: 1;
	border-radius: 1px;
	min-height: 1px;
	transition: height 0.3s ease;
}

.learning-confidence-axis {
	display: flex;
	justify-content: space-between;
	font-size: 6px;
	color: #484f58;
	margin-top: 2px;
}

.learning-growth {
	font-size: 8px;
	margin-top: 6px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/index.css
git commit -m "feat: add CSS for analytics redesign components"
```

---

### Task 20: Verify the build

- [ ] **Step 1: Run TypeScript check**

Run: `npx tsc --noEmit 2>&1 | tail -20`
Expected: no errors

- [ ] **Step 2: Run linter**

Run: `npx eslint src/components/analytics/ src/hooks/useEfficiencyStats.ts src/hooks/useVelocityStats.ts src/hooks/useSessionHealth.ts src/hooks/useActivityPattern.ts src/hooks/useLearningStats.ts 2>&1 | tail -20`
Expected: no errors (or only pre-existing warnings)

- [ ] **Step 3: Run the dev server**

Run: `npm run tauri dev`
Verify: App opens, analytics panel shows tab bar, "Now" tab renders insight cards + chart + breakdown, "Trends" tab renders session health + heatmap + project focus + learning progress.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve build issues from analytics redesign"
```
