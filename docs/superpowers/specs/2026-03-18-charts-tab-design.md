# Charts Tab — Synchronized Stack Design

**Date:** 2026-03-18
**Status:** Draft

## Problem

The Now tab in the analytics view is too busy — insight cards, compact stats, the main chart, toggle pills, and the breakdown panel all compete for attention in a ~400-600px sidebar. The chart needs its own dedicated space, and with a dedicated tab we can expose additional time-series visualizations that were previously impossible.

## Solution

Add a third "Charts" tab (key: `"charts"`) to the analytics view with a synchronized stack of 4 full-width time-series charts. Each chart is ~80px tall with a synced crosshair and shared X-axis — the standard monitoring dashboard pattern (Grafana/Datadog).

## Tab Structure

The analytics view changes from 2 tabs to 3:

| Tab | Key | Color | Contents | Purpose |
|-----|-----|-------|----------|---------|
| **Now** | `"now"` | blue | Insight cards, compact stats, breakdown panel | Numbers and drill-down |
| **Trends** | `"trends"` | purple | Session health, heatmap, project focus, learning | Patterns over time |
| **Charts** | `"charts"` | green `#34d399` | 4 synchronized time-series charts | Visual cockpit |

Update `AnalyticsTab` type in `types.ts` to `"now" | "trends" | "charts"`. Update `TabBar.tsx` TABS array with the new entry. Update `AnalyticsView.tsx` localStorage validation to accept `"charts"`.

The existing chart and TogglePills are removed from the Now tab entirely.

## Charts Tab Layout

```
┌─────────────────────────────────┐
│  Now │ Trends │ [Charts]        │  ← Tab bar (existing)
├─────────────────────────────────┤
│  [1H] [24H] [7D] [30D]         │  ← Shared range selector
├─────────────────────────────────┤
│  UTILIZATION              42%   │
│  ▁▂▃▄▃▅▆▅▆▇▅▆▇           ~80px │  ← Area chart (threshold colors)
├─────────────────────────────────┤
│  TOKENS                 24.3k   │
│  ░▒▓█▓██▓███             ~80px │  ← Stacked area (input + output)
├─────────────────────────────────┤
│  CODE                    +142   │
│  █▄█▃███▅ / ▂▁▂▁▂▁▂▁   ~100px │  ← Diverging bars (added/removed)
├─────────────────────────────────┤
│  CACHE                    68%   │
│  ▁▂▃▅▆▇▇▆▇▇             ~80px │  ← Area chart (hit rate)
├─────────────────────────────────┤
│  00:00    06:00    12:00   Now  │  ← Shared X-axis (rendered once)
└─────────────────────────────────┘
```

A vertical crosshair line syncs across all 4 charts on hover, with a unified tooltip showing all values at that timestamp.

## Chart Specifications

### 1. Utilization %

- **Type:** Area chart with gradient fill
- **Data:** `get_usage_history(bucket, range)` → `DataPoint[]`
  - `ChartsTab` receives `currentBuckets` as a prop and uses `currentBuckets[0]?.label ?? "7 days"` as the default bucket (matching NowTab's initialization pattern)
- **Y-axis:** 0–100% (hidden label, inferred from value display)
- **Color:** Threshold-based on latest value — green #34d399 (<50%), yellow #fbbf24 (50-80%), red #f87171 (>80%). The entire chart area uses a single color based on the latest data point (matching the existing `getAreaColor()` pattern in UsageChart.tsx).
- **Reference lines:** Dashed lines at 50% and 80% thresholds
- **Current value:** Latest utilization shown top-right
- **Empty state:** Centered text "No utilization data" in muted color

### 2. Token Breakdown

- **Type:** Stacked area chart (2 series)
- **Data:** `get_token_history(range, null, null, null)` → `TokenDataPoint[]` (no hostname/session/cwd filters)
- **Series:**
  - Output tokens — solid area, blue #60a5fa with 20% opacity fill (bottom layer)
  - Input tokens — solid area, indigo #818cf8 with 15% opacity fill (top layer, stacked)
- **Current value:** Total tokens (formatted: "24.3k") shown top-right
- **Note:** Cache tokens are visualized in chart 4, not here
- **Empty state:** Centered text "No token data" in muted color

### 3. Code Changes

- **Type:** Diverging bar chart
- **Data:** `get_code_stats_history(range)` → `CodeStatsHistoryPoint[]`
  - Data must be transformed before rendering: negate `lines_removed` values (e.g., `data.map(d => ({...d, lines_removed: -d.lines_removed}))`)
- **Height:** ~100px (slightly taller than other charts to accommodate diverging bars)
- **Series:**
  - Lines added — green bars above baseline #34d399
  - Lines removed — red bars below baseline #f87171
- **Current value:** Net change with sign ("+142") shown top-right
- **Bar width:** Proportional to time bucket width
- **Empty state:** Centered text "No code changes" in muted color

### 4. Cache Efficiency

- **Type:** Area chart with gradient fill
- **Data:** Derived from `get_token_history(range, null, null, null)` → `TokenDataPoint[]`
  - Formula: `cache_read_input_tokens / (input_tokens + cache_creation_input_tokens + cache_read_input_tokens) * 100`
  - Calculated per data point to produce a time series
  - Guard against division by zero (denominator === 0 → 0%)
- **Y-axis:** 0–100%
- **Color:** Amber #fbbf24
- **Current value:** Latest cache hit rate percentage shown top-right
- **Empty state:** Centered text "No cache data" in muted color

## Synced Crosshair

- A React context (`ChartCrosshairContext`) holds the hovered timestamp as a ref (not state, to avoid re-renders)
- Each chart subscribes to the context and renders a vertical line at the corresponding X position
- Each chart also renders a small colored dot where the crosshair intersects the data line
- Disable Recharts' built-in `<Tooltip>` on individual charts. Render a single portal-based tooltip positioned relative to the chart stack container, reading all four values from context at the hovered timestamp:
  ```
  Mar 18, 14:32
  Utilization  42%
  Tokens       24.3k
  Code         +18 / -3
  Cache        68%
  ```
- Mouse leave on any chart clears the crosshair for all

## Shared Range Selector

- Same range tabs as Now tab: 1H, 24H, 7D, 30D
- Range state is persisted in localStorage via key `quill-charts-range` (Charts tab persists range because it serves as a monitoring dashboard that should remember the user's preferred time window across visits)
- The bucket dropdown from Now tab is NOT included — Charts tab uses the first available bucket as default (see Utilization chart spec above)

## Loading & Error States

- **Loading:** Each chart slot renders a skeleton placeholder (matching the existing `chart-skeleton` CSS class pattern — shimmer animation, same height as the chart)
- **Per-chart empty:** When a specific data source returns an empty array, that chart shows centered muted text (e.g., "No utilization data"). Other charts render normally.
- **Error:** If a data fetch fails, show an inline error message within that chart slot using the existing `analytics-error` CSS class pattern. Other charts are unaffected.

## Now Tab Changes

Remove from Now tab:
- `UsageChart` component and its import
- `TogglePills` component and its import
- `chart-section` wrapper and header
- `ChartSeriesVisibility` state and localStorage logic
- LOC data prop (`locData={[]}` is already empty)

Delete files that become dead code:
- `UsageChart.tsx` — only used in NowTab
- `TogglePills.tsx` — only used in NowTab

The Now tab retains: insight cards, compact stats row, collapsible breakdown panel.

## New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `ChartsTab.tsx` | `src/components/analytics/` | Tab container with range selector and chart stack |
| `MiniChart.tsx` | `src/components/analytics/` | Reusable chart wrapper (label, value, crosshair subscription) |
| `ChartCrosshairContext.tsx` | `src/components/analytics/` | Shared hover timestamp context + unified tooltip |
| `useCacheEfficiency.ts` | `src/hooks/` | Derives cache hit rate from token history |

### MiniChart Props

```typescript
interface MiniChartProps {
  label: string;
  currentValue: string;
  color: string;
  height?: number; // default 80
  emptyText?: string; // shown when no data
  isEmpty?: boolean;
  children: React.ReactNode; // The actual Recharts chart
}
```

## Modified Components

| Component | Change |
|-----------|--------|
| `AnalyticsView.tsx` | Add "Charts" tab, render `ChartsTab`, pass `currentBuckets` prop |
| `NowTab.tsx` | Remove `UsageChart`, `TogglePills`, chart section, visibility state |
| `TabBar.tsx` | Add `{ key: "charts", label: "Charts", color: "#34d399" }` to TABS |
| `types.ts` | Update `AnalyticsTab` to `"now" \| "trends" \| "charts"` |

## No Backend Changes

All data comes from existing Tauri commands:
- `get_usage_history(bucket, range)` — utilization data
- `get_token_history(range, hostname?, sessionId?, cwd?)` — token breakdown + cache efficiency derivation
- `get_code_stats_history(range)` — code change data

## CSS

New styles follow existing conventions:
- Chart containers: `background: rgba(255,255,255,0.02)`, `border: 1px solid rgba(255,255,255,0.04)`, `border-radius: 6px`
- Labels: 8px uppercase, 0.5px letter-spacing, color at 70% opacity of chart color
- Values: 11px bold, full chart color
- Shared axis: 8px, `rgba(255,255,255,0.25)`
- Skeletons: reuse existing `chart-skeleton` pattern with shimmer animation

## Accessibility

- Crosshair tooltip provides text alternatives for all chart values
- Charts respect `prefers-reduced-motion`: set `isAnimationActive={false}` on all Recharts components when `prefers-reduced-motion: reduce` matches, using a `useReducedMotion()` hook
- Focus-visible outlines on range tabs
- ARIA labels on chart regions (`role="img"` with `aria-label` describing the chart)
