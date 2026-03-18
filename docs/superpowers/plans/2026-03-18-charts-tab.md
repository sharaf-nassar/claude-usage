# Charts Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Charts" tab to the analytics view with 4 synchronized time-series charts (Utilization, Tokens, Code Changes, Cache Efficiency) using the Grafana-style stacked monitoring pattern.

**Architecture:** Extract the existing chart from the Now tab into a new Charts tab. Add 3 new chart types using data from existing hooks. Charts share a crosshair context for synchronized hover and a unified tooltip. Each chart is wrapped in a `MiniChart` shell that handles label, current value, empty/loading states, and crosshair overlay.

**Tech Stack:** React, Recharts, Tauri IPC (existing hooks), CSS (existing dark theme conventions)

**Spec:** `docs/superpowers/specs/2026-03-18-charts-tab-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/components/analytics/ChartsTab.tsx` | Tab container: range selector, 4 chart instances, shared axis |
| `src/components/analytics/MiniChart.tsx` | Reusable wrapper: label, value, skeleton, empty state, crosshair overlay |
| `src/components/analytics/ChartCrosshairContext.tsx` | React context: ref-based pub-sub for hover X-percent (avoids re-renders) |
| `src/hooks/useCacheEfficiency.ts` | Derives cache hit-rate time series from `useTokenData` output |
| `src/utils/chartHelpers.ts` | Extracted from UsageChart.tsx: `formatTime`, `dedupeTickLabels`, `anchorToNow`, `getAreaColor` |

### Modified Files
| File | Change |
|------|--------|
| `src/types.ts:249` | Add `"charts"` to `AnalyticsTab` union |
| `src/components/analytics/TabBar.tsx:8-11` | Add Charts entry to TABS array |
| `src/components/analytics/AnalyticsView.tsx:14-91` | Add `chartsRange` state, render `ChartsTab`, update localStorage validation |
| `src/hooks/useCodeStats.ts` | Expose `error` field (matching useTokenData pattern) |
| `src/components/analytics/NowTab.tsx` | Remove UsageChart, TogglePills, chart-section, visibility state |
| `src/styles/index.css` | Add mini-chart, crosshair, unified-tooltip, shared-axis styles |

### Deleted Files
| File | Reason |
|------|--------|
| `src/components/analytics/UsageChart.tsx` | Replaced by ChartsTab; helpers extracted to chartHelpers.ts |
| `src/components/analytics/TogglePills.tsx` | Only used in NowTab chart section which is removed |

---

## Chunk 1: Infrastructure + NowTab Cleanup

### Task 1: Extract chart helpers to shared utility

**Files:**
- Create: `src/utils/chartHelpers.ts`

- [ ] **Step 1: Create chartHelpers.ts with functions extracted from UsageChart.tsx**

```typescript
// src/utils/chartHelpers.ts
import type { RangeType } from "../types";

export function formatTime(timestamp: string, range: RangeType): string {
	const d = new Date(timestamp);
	if (range === "1h" || range === "24h") {
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
	if (range === "7d") {
		return d.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
	}
	return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface TimestampedRecord {
	timestamp: string;
}

export function dedupeTickLabels(
	data: TimestampedRecord[],
	formatter: (v: string) => string,
): Set<number> {
	const seen = new Set<string>();
	const allowed = new Set<number>();
	for (let i = 0; i < data.length; i++) {
		const label = formatter(data[i].timestamp);
		if (!seen.has(label)) {
			seen.add(label);
			allowed.add(i);
		}
	}
	return allowed;
}

/** Minimum gap (ms) before we append a "now" anchor to extend the X-axis */
const NOW_ANCHOR_THRESHOLD_MS = 2 * 60 * 1000;

export function anchorToNow<T extends { timestamp: string }>(
	points: T[],
	defaults: Omit<T, "timestamp">,
): T[] {
	if (points.length === 0) return points;

	const lastTs = new Date(points[points.length - 1].timestamp).getTime();
	const now = Date.now();

	if (now - lastTs > NOW_ANCHOR_THRESHOLD_MS) {
		return [
			...points,
			{ ...defaults, timestamp: new Date(now).toISOString() } as T,
		];
	}
	return points;
}

export function getAreaColor(data: { utilization: number }[]): string {
	if (!data || data.length === 0) return "#34d399";
	const latest = data[data.length - 1].utilization;
	if (latest >= 80) return "#f87171";
	if (latest >= 50) return "#fbbf24";
	return "#34d399";
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/chartHelpers.ts
git commit -m "refactor: extract chart helpers to shared utility"
```

---

### Task 2: Update type + tab infrastructure

**Files:**
- Modify: `src/types.ts:249`
- Modify: `src/components/analytics/TabBar.tsx:8-11`
- Modify: `src/components/analytics/AnalyticsView.tsx:15-89`

- [ ] **Step 1: Add `"charts"` to AnalyticsTab union**

In `src/types.ts`, change line 249 from:
```typescript
export type AnalyticsTab = "now" | "trends";
```
to:
```typescript
export type AnalyticsTab = "now" | "trends" | "charts";
```

- [ ] **Step 2: Add Charts tab to TabBar TABS array**

In `src/components/analytics/TabBar.tsx`, change the TABS array (lines 8-11) from:
```typescript
const TABS: { key: AnalyticsTab; label: string; color: string }[] = [
	{ key: "now", label: "Now", color: "#58a6ff" },
	{ key: "trends", label: "Trends", color: "#a78bfa" },
];
```
to:
```typescript
const TABS: { key: AnalyticsTab; label: string; color: string }[] = [
	{ key: "now", label: "Now", color: "#58a6ff" },
	{ key: "trends", label: "Trends", color: "#a78bfa" },
	{ key: "charts", label: "Charts", color: "#34d399" },
];
```

- [ ] **Step 3: Update AnalyticsView to support Charts tab**

In `src/components/analytics/AnalyticsView.tsx`:

Add import at top:
```typescript
import ChartsTab from "./ChartsTab";
```

Update localStorage validation (line 18) from:
```typescript
if (saved === "now" || saved === "trends") return saved;
```
to:
```typescript
if (saved === "now" || saved === "trends" || saved === "charts") return saved;
```

Add `chartsRange` state after `trendsRange` (after line 23):
```typescript
const [chartsRange, setChartsRange] = useState<RangeType>(() => {
	try {
		const saved = localStorage.getItem("quill-charts-range");
		if (saved === "1h" || saved === "24h" || saved === "7d" || saved === "30d") return saved as RangeType;
	} catch { /* ignore */ }
	return "24h";
});

const handleChartsRangeChange = (r: RangeType) => {
	setChartsRange(r);
	try {
		localStorage.setItem("quill-charts-range", r);
	} catch { /* ignore */ }
};
```

Replace the conditional rendering block (lines 78-89) from:
```typescript
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
```
to:
```typescript
{activeTab === "now" && (
	<NowTab
		range={nowRange}
		onRangeChange={setNowRange}
		currentBuckets={currentBuckets}
	/>
)}
{activeTab === "trends" && (
	<TrendsTab
		range={trendsRange}
		onRangeChange={setTrendsRange}
	/>
)}
{activeTab === "charts" && (
	<ChartsTab
		range={chartsRange}
		onRangeChange={handleChartsRangeChange}
		currentBuckets={currentBuckets}
	/>
)}
```

**Note:** The `ChartsTab` import will cause a build error until Task 6 creates the file. That's expected — create a placeholder if you want to verify intermediate builds:
```typescript
// Temporary placeholder — src/components/analytics/ChartsTab.tsx
import type { RangeType, UsageBucket } from "../../types";
interface ChartsTabProps { range: RangeType; onRangeChange: (r: RangeType) => void; currentBuckets: UsageBucket[]; }
function ChartsTab(_props: ChartsTabProps) { return <div>Charts coming soon</div>; }
export default ChartsTab;
```

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/components/analytics/TabBar.tsx src/components/analytics/AnalyticsView.tsx src/components/analytics/ChartsTab.tsx
git commit -m "feat: add Charts tab infrastructure to analytics view"
```

---

### Task 3: Strip chart from NowTab

**Files:**
- Modify: `src/components/analytics/NowTab.tsx`

- [ ] **Step 1: Remove chart-related imports**

Remove these imports from the top of `NowTab.tsx`:
```typescript
import UsageChart from "./UsageChart";
import TogglePills from "./TogglePills";
```

Remove `ChartSeriesVisibility` from the type import:
```typescript
import type {
	RangeType,
	UsageBucket,
	BreakdownSelection,
	ChartSeriesVisibility,  // ← remove this
} from "../../types";
```

- [ ] **Step 2: Remove chart visibility state**

Remove the `VISIBILITY_KEY` constant (line 38):
```typescript
const VISIBILITY_KEY = "quill-chart-series-visibility";
```

Remove the `seriesVisibility` state and `handleVisibilityChange` handler (lines 103-116):
```typescript
const [seriesVisibility, setSeriesVisibility] = useState<ChartSeriesVisibility>(() => {
	try {
		const saved = localStorage.getItem(VISIBILITY_KEY);
		if (saved) return JSON.parse(saved);
	} catch { /* ignore */ }
	return { utilization: true, tokens: true };
});

const handleVisibilityChange = (v: ChartSeriesVisibility) => {
	setSeriesVisibility(v);
	try {
		localStorage.setItem(VISIBILITY_KEY, JSON.stringify(v));
	} catch { /* ignore */ }
};
```

- [ ] **Step 3: Remove the chart section JSX**

Remove the entire chart section block (lines 255-291):
```tsx
{/* Chart */}
<div className="chart-section">
	<div className="chart-section-header">
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
		<TogglePills
			visibility={seriesVisibility}
			onChange={handleVisibilityChange}
			hasTokenData={tokenHistory.length > 0}
		/>
	</div>
	<UsageChart
		data={history}
		range={range}
		bucket={selectedBucket}
		tokenData={tokenHistory}
		locData={[]}
		visibility={seriesVisibility}
	/>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/analytics/NowTab.tsx
git commit -m "refactor: remove chart section from NowTab"
```

---

## Chunk 2: New Components + Hook

### Task 4: Create useCacheEfficiency hook

**Files:**
- Create: `src/hooks/useCacheEfficiency.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/hooks/useCacheEfficiency.ts
import { useMemo } from "react";
import type { TokenDataPoint } from "../types";

export interface CacheEfficiencyPoint {
	timestamp: string;
	hitRate: number;
}

export function useCacheEfficiency(tokenHistory: TokenDataPoint[]): CacheEfficiencyPoint[] {
	return useMemo(() => {
		return tokenHistory.map((point) => {
			const denominator =
				point.input_tokens +
				point.cache_creation_input_tokens +
				point.cache_read_input_tokens;
			const hitRate = denominator > 0
				? (point.cache_read_input_tokens / denominator) * 100
				: 0;
			return {
				timestamp: point.timestamp,
				hitRate: Math.round(hitRate * 10) / 10,
			};
		});
	}, [tokenHistory]);
}
```

- [ ] **Step 2: Commit**

- [ ] **Step 2b: Update useCodeStats to expose error field**

In `src/hooks/useCodeStats.ts`, add `error` state matching the `useTokenData` pattern:

Add state after `loading` state (after line 8):
```typescript
const [error, setError] = useState<string | null>(null);
```

Add `setError(null)` at the start of `fetchData` (after the loading check) and `setError(String(e))` in the catch block (replace `console.error` line). Update the return statement to include `error`:
```typescript
return { stats, history, loading, error, refresh: fetchData };
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useCacheEfficiency.ts src/hooks/useCodeStats.ts
git commit -m "feat: add useCacheEfficiency hook, expose error from useCodeStats"
```

---

### Task 5: Create ChartCrosshairContext (ref-based, no re-renders)

**Files:**
- Create: `src/components/analytics/ChartCrosshairContext.tsx`

The crosshair context uses refs + a pub-sub pattern to avoid triggering React re-renders on every mouse move across 4 charts. Subscribers (MiniChart instances) update their crosshair DOM elements directly via `requestAnimationFrame`.

- [ ] **Step 1: Create crosshair context and provider**

```tsx
// src/components/analytics/ChartCrosshairContext.tsx
import { createContext, useContext, useRef, useCallback, useEffect } from "react";

type Subscriber = (xPct: number | null) => void;

interface CrosshairValue {
	subscribe: (fn: Subscriber) => () => void;
	setHover: (xPct: number | null) => void;
	getXPercent: () => number | null;
}

export const CrosshairContext = createContext<CrosshairValue>({
	subscribe: () => () => {},
	setHover: () => {},
	getXPercent: () => null,
});

interface CrosshairProviderProps {
	children: React.ReactNode;
}

export function CrosshairProvider({ children }: CrosshairProviderProps) {
	const xPercentRef = useRef<number | null>(null);
	const subscribersRef = useRef(new Set<Subscriber>());

	const subscribe = useCallback((fn: Subscriber) => {
		subscribersRef.current.add(fn);
		return () => {
			subscribersRef.current.delete(fn);
		};
	}, []);

	const setHover = useCallback((pct: number | null) => {
		xPercentRef.current = pct;
		for (const fn of subscribersRef.current) {
			fn(pct);
		}
	}, []);

	const getXPercent = useCallback(() => xPercentRef.current, []);

	return (
		<CrosshairContext.Provider value={{ subscribe, setHover, getXPercent }}>
			{children}
		</CrosshairContext.Provider>
	);
}

/** Hook for MiniChart to subscribe to crosshair updates via direct DOM manipulation */
export function useCrosshairLine(lineRef: React.RefObject<HTMLDivElement | null>) {
	const { subscribe } = useContext(CrosshairContext);

	useEffect(() => {
		return subscribe((xPct) => {
			const el = lineRef.current;
			if (!el) return;
			if (xPct === null) {
				el.style.display = "none";
			} else {
				el.style.display = "";
				el.style.left = `${xPct * 100}%`;
			}
		});
	}, [subscribe, lineRef]);
}

export function useCrosshair() {
	return useContext(CrosshairContext);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/ChartCrosshairContext.tsx
git commit -m "feat: add ref-based ChartCrosshairContext for synced hover"
```

---

### Task 6: Create MiniChart wrapper component

**Files:**
- Create: `src/components/analytics/MiniChart.tsx`

- [ ] **Step 1: Create MiniChart**

```tsx
// src/components/analytics/MiniChart.tsx
import { useRef, useCallback } from "react";
import { useCrosshair, useCrosshairLine } from "./ChartCrosshairContext";

interface MiniChartProps {
	label: string;
	currentValue: string;
	color: string;
	height?: number;
	emptyText?: string;
	isEmpty?: boolean;
	error?: string | null;
	children: React.ReactNode;
}

function MiniChart({
	label,
	currentValue,
	color,
	height = 80,
	emptyText = "No data",
	isEmpty = false,
	error = null,
	children,
}: MiniChartProps) {
	const crosshairLineRef = useRef<HTMLDivElement>(null);
	const { setHover } = useCrosshair();
	useCrosshairLine(crosshairLineRef);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const rect = e.currentTarget.getBoundingClientRect();
			const pct = (e.clientX - rect.left) / rect.width;
			setHover(Math.max(0, Math.min(1, pct)));
		},
		[setHover],
	);

	const handleMouseLeave = useCallback(() => {
		setHover(null);
	}, [setHover]);

	if (error) {
		return (
			<div className="mini-chart mini-chart--empty" style={{ height }}>
				<span className="mini-chart-label" style={{ color: `${color}b3` }}>
					{label}
				</span>
				<span className="analytics-error" role="alert" style={{ fontSize: 10, padding: "4px 8px" }}>
					Failed to load {label.toLowerCase()}
				</span>
			</div>
		);
	}

	if (isEmpty) {
		return (
			<div
				className="mini-chart mini-chart--empty"
				style={{ height }}
				role="img"
				aria-label={`${label} chart: ${emptyText}`}
			>
				<span className="mini-chart-label" style={{ color: `${color}b3` }}>
					{label}
				</span>
				<span className="mini-chart-empty-text">{emptyText}</span>
			</div>
		);
	}

	return (
		<div
			className="mini-chart"
			style={{ height }}
			onMouseMove={handleMouseMove}
			onMouseLeave={handleMouseLeave}
			role="img"
			aria-label={`${label} chart: current value ${currentValue}`}
		>
			<span className="mini-chart-label" style={{ color: `${color}b3` }}>
				{label}
			</span>
			<span className="mini-chart-value" style={{ color }}>
				{currentValue}
			</span>
			{/* Crosshair line — positioned via ref, no re-renders */}
			<div
				ref={crosshairLineRef}
				className="mini-chart-crosshair"
				style={{ display: "none" }}
			/>
			<div className="mini-chart-body">{children}</div>
		</div>
	);
}

export default MiniChart;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/analytics/MiniChart.tsx
git commit -m "feat: add MiniChart wrapper component with error states"
```

---

## Chunk 3: ChartsTab + CSS

### Task 7: Create ChartsTab with all 4 charts

**Files:**
- Create (replace placeholder): `src/components/analytics/ChartsTab.tsx`

This is the largest task. The ChartsTab wires together the range selector, 4 MiniChart instances with their respective Recharts charts, the crosshair provider, and the shared X-axis.

- [ ] **Step 1: Create ChartsTab**

```tsx
// src/components/analytics/ChartsTab.tsx
import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import {
	AreaChart,
	Area,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	ReferenceLine,
	ResponsiveContainer,
} from "recharts";
import { useAnalyticsData } from "../../hooks/useAnalyticsData";
import { useTokenData } from "../../hooks/useTokenData";
import { useCodeStats } from "../../hooks/useCodeStats";
import { useCacheEfficiency } from "../../hooks/useCacheEfficiency";
import { formatTokenCount } from "../../utils/tokens";
import {
	formatTime,
	dedupeTickLabels,
	anchorToNow,
	getAreaColor,
} from "../../utils/chartHelpers";
import { CrosshairProvider, useCrosshair } from "./ChartCrosshairContext";
import MiniChart from "./MiniChart";
import type { RangeType, UsageBucket } from "../../types";

const RANGES: RangeType[] = ["1h", "24h", "7d", "30d"];
const RANGE_LABELS: Record<RangeType, string> = {
	"1h": "1H",
	"24h": "24H",
	"7d": "7D",
	"30d": "30D",
};

/**
 * Unified tooltip that reads crosshair position and shows all 4 values.
 *
 * Note: This component intentionally uses useState (not refs) because the
 * tooltip content changes on every mouse move and must trigger a re-render.
 * Only this component re-renders on hover — the 4 chart MiniCharts use
 * ref-based DOM updates and do NOT re-render.
 *
 * Spec note: Colored dots at the data line intersection are deferred to a
 * follow-up — they require accessing Recharts' internal coordinate mapping
 * which adds significant complexity for a cosmetic enhancement.
 */
interface UnifiedTooltipProps {
	utilData: { timestamp: string; utilization: number }[];
	tokenData: { timestamp: string; total_tokens: number }[];
	codeData: { timestamp: string; lines_added: number; lines_removed: number }[];
	cacheData: { timestamp: string; hitRate: number }[];
}

function UnifiedTooltip({ utilData, tokenData, codeData, cacheData }: UnifiedTooltipProps) {
	const { subscribe } = useCrosshair();
	const [values, setValues] = useState<{
		time: string; util: string; tokens: string; code: string; cache: string;
	} | null>(null);
	const [xPct, setXPct] = useState<number | null>(null);

	const getValueAtPct = useCallback(
		(pct: number) => {
			const idx = (arr: { timestamp: string }[]) =>
				arr.length > 0 ? Math.round(pct * (arr.length - 1)) : -1;

			const ui = idx(utilData);
			const ti = idx(tokenData);
			const ci = idx(codeData);
			const ki = idx(cacheData);

			const ts = utilData[ui]?.timestamp ?? tokenData[ti]?.timestamp ?? "";
			return {
				time: ts ? new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "",
				util: ui >= 0 ? `${utilData[ui].utilization.toFixed(0)}%` : "—",
				tokens: ti >= 0 ? formatTokenCount(tokenData[ti].total_tokens) : "—",
				code: ci >= 0 ? `+${codeData[ci].lines_added} / -${codeData[ci].lines_removed}` : "—",
				cache: ki >= 0 ? `${cacheData[ki].hitRate.toFixed(0)}%` : "—",
			};
		},
		[utilData, tokenData, codeData, cacheData],
	);

	useEffect(() => {
		return subscribe((pct) => {
			if (pct === null) {
				setXPct(null);
				setValues(null);
			} else {
				setXPct(pct);
				setValues(getValueAtPct(pct));
			}
		});
	}, [subscribe, getValueAtPct]);

	if (!values || xPct === null) return null;

	return (
		<div
			className="charts-unified-tooltip chart-tooltip"
			style={{ left: `${xPct * 100}%` }}
		>
			<div className="chart-tooltip-time">{values.time}</div>
			<div className="chart-tooltip-value" style={{ color: "#34d399" }}>Util {values.util}</div>
			<div className="chart-tooltip-value" style={{ color: "#60a5fa" }}>Tokens {values.tokens}</div>
			<div className="chart-tooltip-value" style={{ color: "#a78bfa" }}>Code {values.code}</div>
			<div className="chart-tooltip-value" style={{ color: "#fbbf24" }}>Cache {values.cache}</div>
		</div>
	);
}

interface ChartsTabProps {
	range: RangeType;
	onRangeChange: (r: RangeType) => void;
	currentBuckets: UsageBucket[];
}

function ChartsTab({ range, onRangeChange, currentBuckets }: ChartsTabProps) {
	const defaultBucket = currentBuckets?.[0]?.label ?? "7 days";

	const { history: utilHistory, loading: utilLoading, error: utilError } = useAnalyticsData(
		defaultBucket,
		range,
		currentBuckets,
	);

	const { history: tokenHistory, loading: tokenLoading, error: tokenError } = useTokenData(
		range,
		null,
		null,
		null,
	);

	const { history: codeHistory, loading: codeLoading, error: codeError } = useCodeStats(range);

	const cacheData = useCacheEfficiency(tokenHistory);

	// Anchor data to "now" so idle gaps are visible
	const anchoredUtil = useMemo(
		() => anchorToNow(utilHistory, { utilization: 0 }),
		[utilHistory],
	);

	const anchoredTokens = useMemo(
		() =>
			anchorToNow(tokenHistory, {
				input_tokens: 0,
				output_tokens: 0,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				total_tokens: 0,
			}),
		[tokenHistory],
	);

	const anchoredCode = useMemo(() => {
		const anchored = anchorToNow(codeHistory, {
			lines_added: 0,
			lines_removed: 0,
			total_changed: 0,
		});
		// Negate lines_removed for diverging bar chart
		return anchored.map((d) => ({
			...d,
			lines_removed_neg: -d.lines_removed,
		}));
	}, [codeHistory]);

	const anchoredCache = useMemo(
		() => anchorToNow(cacheData, { hitRate: 0 }),
		[cacheData],
	);

	// Current values for display
	const utilColor = getAreaColor(anchoredUtil);
	const utilValue =
		anchoredUtil.length > 0
			? `${anchoredUtil[anchoredUtil.length - 1].utilization.toFixed(0)}%`
			: "—";

	const tokenValue =
		tokenHistory.length > 0
			? formatTokenCount(
					tokenHistory.reduce((sum, d) => sum + d.total_tokens, 0),
				)
			: "—";

	const codeNet =
		codeHistory.length > 0
			? codeHistory.reduce((sum, d) => sum + d.lines_added - d.lines_removed, 0)
			: 0;
	const codeValue =
		codeHistory.length > 0
			? `${codeNet >= 0 ? "+" : ""}${codeNet}`
			: "—";

	const cacheValue =
		cacheData.length > 0
			? `${cacheData[cacheData.length - 1].hitRate.toFixed(0)}%`
			: "—";

	// Shared axis formatting
	const formatter = (v: string) => formatTime(v, range);

	// Compute ticks from the longest dataset for the shared axis
	const longestData = [anchoredUtil, anchoredTokens, anchoredCode, anchoredCache]
		.reduce((a, b) => (a.length >= b.length ? a : b), []);
	const axisTicks = dedupeTickLabels(longestData, formatter);
	const axisTimestamps = longestData
		.filter((_, i) => axisTicks.has(i))
		.map((d) => d.timestamp);

	const isLoading = utilLoading || tokenLoading || codeLoading;

	// Chart grid config — shared across all charts
	const gridProps = {
		strokeDasharray: "3 3",
		stroke: "rgba(255,255,255,0.06)",
		vertical: false,
	};

	const xAxisProps = {
		dataKey: "timestamp" as const,
		tickFormatter: formatter,
		stroke: "rgba(255,255,255,0.2)",
		fontSize: 9,
		tickLine: false,
		axisLine: false,
		minTickGap: 50,
		hide: true, // hidden on individual charts; rendered once at bottom
	};

	return (
		<>
			<div className="analytics-controls">
				<div className="range-tabs">
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
			</div>

			{isLoading ? (
				<div className="charts-stack">
					<div className="chart-skeleton" style={{ height: 80 }} />
					<div className="chart-skeleton" style={{ height: 80 }} />
					<div className="chart-skeleton" style={{ height: 100 }} />
					<div className="chart-skeleton" style={{ height: 80 }} />
				</div>
			) : (
				<CrosshairProvider>
					<div className="charts-stack">
						{/* 1. Utilization */}
						<MiniChart
							label="Utilization"
							currentValue={utilValue}
							color={utilColor}
							height={80}
							isEmpty={anchoredUtil.length === 0}
							emptyText="No utilization data"
							error={utilError}
						>
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart
									data={anchoredUtil}
									margin={{ top: 16, right: 4, left: -20, bottom: 0 }}
								>
									<defs>
										<linearGradient id="grad-util" x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor={utilColor} stopOpacity={0.15} />
											<stop offset="95%" stopColor={utilColor} stopOpacity={0.01} />
										</linearGradient>
									</defs>
									<CartesianGrid {...gridProps} />
									<XAxis {...xAxisProps} />
									<YAxis
										domain={[0, 100]}
										ticks={[0, 50, 100]}
										stroke="rgba(255,255,255,0.2)"
										fontSize={9}
										tickLine={false}
										axisLine={false}
										tickFormatter={(v) => `${v}%`}
										hide
									/>
									<ReferenceLine y={80} stroke="rgba(248,113,113,0.3)" strokeDasharray="4 4" />
									<ReferenceLine y={50} stroke="rgba(251,191,36,0.2)" strokeDasharray="4 4" />
									<Area
										type="monotone"
										dataKey="utilization"
										stroke={utilColor}
										strokeWidth={1.5}
										fill="url(#grad-util)"
										dot={false}
										isAnimationActive={false}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</MiniChart>

						{/* 2. Token Breakdown */}
						<MiniChart
							label="Tokens"
							currentValue={tokenValue}
							color="#60a5fa"
							height={80}
							isEmpty={anchoredTokens.length === 0}
							emptyText="No token data"
							error={tokenError}
						>
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart
									data={anchoredTokens}
									margin={{ top: 16, right: 4, left: -20, bottom: 0 }}
									stackOffset="none"
								>
									<defs>
										<linearGradient id="grad-tok-out" x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor="#60a5fa" stopOpacity={0.2} />
											<stop offset="95%" stopColor="#60a5fa" stopOpacity={0.02} />
										</linearGradient>
										<linearGradient id="grad-tok-in" x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor="#818cf8" stopOpacity={0.15} />
											<stop offset="95%" stopColor="#818cf8" stopOpacity={0.02} />
										</linearGradient>
									</defs>
									<CartesianGrid {...gridProps} />
									<XAxis {...xAxisProps} />
									<YAxis hide />
									<Area
										type="monotone"
										dataKey="output_tokens"
										stackId="tokens"
										stroke="#60a5fa"
										strokeWidth={1.2}
										fill="url(#grad-tok-out)"
										dot={false}
										isAnimationActive={false}
									/>
									<Area
										type="monotone"
										dataKey="input_tokens"
										stackId="tokens"
										stroke="#818cf8"
										strokeWidth={1.2}
										fill="url(#grad-tok-in)"
										dot={false}
										isAnimationActive={false}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</MiniChart>

						{/* 3. Code Changes */}
						<MiniChart
							label="Code"
							currentValue={codeValue}
							color="#a78bfa"
							height={100}
							isEmpty={anchoredCode.length === 0}
							emptyText="No code changes"
							error={codeError}
						>
							<ResponsiveContainer width="100%" height="100%">
								<BarChart
									data={anchoredCode}
									margin={{ top: 16, right: 4, left: -20, bottom: 0 }}
								>
									<CartesianGrid {...gridProps} />
									<XAxis {...xAxisProps} />
									<YAxis hide />
									<ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
									<Bar
										dataKey="lines_added"
										fill="rgba(52,211,153,0.4)"
										stroke="rgba(52,211,153,0.6)"
										strokeWidth={0.5}
										radius={[2, 2, 0, 0]}
										isAnimationActive={false}
									/>
									<Bar
										dataKey="lines_removed_neg"
										fill="rgba(248,113,113,0.3)"
										stroke="rgba(248,113,113,0.5)"
										strokeWidth={0.5}
										radius={[0, 0, 2, 2]}
										isAnimationActive={false}
									/>
								</BarChart>
							</ResponsiveContainer>
						</MiniChart>

						{/* 4. Cache Efficiency (derives from token data, shares its error state) */}
						<MiniChart
							label="Cache"
							currentValue={cacheValue}
							color="#fbbf24"
							height={80}
							isEmpty={anchoredCache.length === 0}
							emptyText="No cache data"
							error={tokenError}
						>
							<ResponsiveContainer width="100%" height="100%">
								<AreaChart
									data={anchoredCache}
									margin={{ top: 16, right: 4, left: -20, bottom: 0 }}
								>
									<defs>
										<linearGradient id="grad-cache" x1="0" y1="0" x2="0" y2="1">
											<stop offset="5%" stopColor="#fbbf24" stopOpacity={0.15} />
											<stop offset="95%" stopColor="#fbbf24" stopOpacity={0.01} />
										</linearGradient>
									</defs>
									<CartesianGrid {...gridProps} />
									<XAxis {...xAxisProps} />
									<YAxis domain={[0, 100]} hide />
									<Area
										type="monotone"
										dataKey="hitRate"
										stroke="#fbbf24"
										strokeWidth={1.5}
										fill="url(#grad-cache)"
										dot={false}
										isAnimationActive={false}
									/>
								</AreaChart>
							</ResponsiveContainer>
						</MiniChart>

						{/* Shared X-axis */}
						<div className="charts-shared-axis">
							{axisTimestamps.map((ts) => (
								<span key={ts}>{formatter(ts)}</span>
							))}
						</div>

						{/* Unified tooltip — inside charts-stack for correct absolute positioning */}
						<UnifiedTooltip
							utilData={anchoredUtil}
							tokenData={anchoredTokens}
							codeData={anchoredCode}
							cacheData={anchoredCache}
						/>
					</div>
				</CrosshairProvider>
			)}
		</>
	);
}

export default ChartsTab;
```

- [ ] **Step 2: Verify build compiles**

Run: `npm run build` (or `pnpm build` / `yarn build`)
Expected: Compiles with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/analytics/ChartsTab.tsx
git commit -m "feat: add ChartsTab with 4 synchronized charts"
```

---

### Task 8: Add CSS styles

**Files:**
- Modify: `src/styles/index.css`

- [ ] **Step 1: Add mini-chart and charts-stack styles**

Append at the very end of `src/styles/index.css` (after the last rule, line 2041):

```css
/* ─── Charts tab: synchronized stack ─── */
.charts-stack {
	display: flex;
	flex-direction: column;
	gap: 4px;
	flex: 1;
	min-height: 0;
	position: relative;
}

/* Override chart-skeleton min-height when inside charts-stack */
.charts-stack .chart-skeleton {
	min-height: 0;
	flex: none;
}

.mini-chart {
	position: relative;
	background: rgba(255, 255, 255, 0.02);
	border: 1px solid rgba(255, 255, 255, 0.04);
	border-radius: 6px;
	overflow: hidden;
	flex-shrink: 0;
}

.mini-chart--empty {
	display: flex;
	align-items: center;
	justify-content: center;
}

.mini-chart-label {
	position: absolute;
	top: 4px;
	left: 8px;
	font-size: 8px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.5px;
	z-index: 2;
	pointer-events: none;
}

.mini-chart-value {
	position: absolute;
	top: 3px;
	right: 8px;
	font-size: 11px;
	font-weight: 700;
	z-index: 2;
	pointer-events: none;
}

.mini-chart-empty-text {
	color: rgba(255, 255, 255, 0.35);
	font-size: 11px;
}

.mini-chart-body {
	width: 100%;
	height: 100%;
}

.mini-chart-crosshair {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 1px;
	background: rgba(255, 255, 255, 0.25);
	z-index: 3;
	pointer-events: none;
	transform: translateX(-0.5px);
}

.charts-shared-axis {
	display: flex;
	justify-content: space-between;
	padding: 2px 8px;
	font-size: 8px;
	color: rgba(255, 255, 255, 0.25);
	flex-shrink: 0;
}

/* ─── Unified tooltip ─── */
.charts-unified-tooltip {
	position: absolute;
	top: 0;
	z-index: 10;
	transform: translateX(-50%);
	pointer-events: none;
	white-space: nowrap;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/index.css
git commit -m "feat: add CSS for charts stack and mini-chart"
```

---

## Chunk 4: Cleanup + Verification

### Task 9: Delete dead code

**Files:**
- Delete: `src/components/analytics/UsageChart.tsx`
- Delete: `src/components/analytics/TogglePills.tsx`

- [ ] **Step 1: Delete UsageChart.tsx and TogglePills.tsx**

```bash
rm src/components/analytics/UsageChart.tsx
rm src/components/analytics/TogglePills.tsx
```

- [ ] **Step 2: Verify no other files import them**

Search for imports of UsageChart and TogglePills across the codebase. After Task 3, NowTab no longer imports them. No other file should.

Run: `grep -r "UsageChart\|TogglePills" src/ --include="*.tsx" --include="*.ts"`
Expected: No results (or only this plan file if it's in the source tree).

- [ ] **Step 3: Remove the `ChartSeriesVisibility` type from types.ts if unused**

Check if `ChartSeriesVisibility` (line 140-143 in `types.ts`) is still imported anywhere:

Run: `grep -r "ChartSeriesVisibility" src/ --include="*.tsx" --include="*.ts"`

If no results, remove the type definition from `src/types.ts`:
```typescript
export interface ChartSeriesVisibility {
	utilization: boolean;
	tokens: boolean;
}
```

Also remove `MergedDataPoint` (line 103-108) if unused — it was only used in UsageChart:
```typescript
export interface MergedDataPoint {
	timestamp: string;
	utilization: number | null;
	total_tokens: number | null;
	total_lines_changed: number | null;
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete UsageChart, TogglePills, and unused types"
```

---

### Task 10: Build verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Compiles with zero errors and zero warnings.

- [ ] **Step 2: Run the app and verify**

```bash
npm run tauri dev
```

Manual verification checklist:
1. Analytics view shows 3 tabs: Now, Trends, Charts
2. Now tab no longer has a chart — just insight cards, stats, breakdown
3. Charts tab shows 4 stacked charts with range selector
4. Hovering a chart shows a crosshair line synchronized across all 4
5. Range pills (1H/24H/7D/30D) work and persist on tab switch
6. Empty state renders correctly when a data source has no data
7. Charts tab loads without errors in the console

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address build or runtime issues from charts tab"
```
