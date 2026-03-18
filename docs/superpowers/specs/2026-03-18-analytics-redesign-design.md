# Analytics Redesign: Tabbed Insight Dashboard

**Date:** 2026-03-18
**Status:** Draft

## Problem

The current analytics panel displays raw aggregates (avg utilization, token counts, lines added/removed) without telling users anything meaningful about their productivity or workflow. Users see numbers but can't answer questions like "Am I being efficient?" or "Where am I spending my time?"

## Design Goals

1. Analytics should answer real questions a user would have, not just display raw numbers
2. Frequently-checked metrics belong on the default tab; slower-changing trends go on a separate tab
3. Metrics derive from data already collected — one small backend change is needed (see Session Health)
4. Preserve existing functionality (chart, breakdown, drill-down filtering)

## Solution: Two-Tab Analytics

Replace the flat analytics layout with a tabbed interface:

- **"Now" tab** (default) — metrics that change every session, checked frequently
- **"Trends" tab** — patterns that shift over days/weeks, checked periodically

### Tab 1: "Now"

**Top stats row** (3 cards, equal width):

| Card | Headline | Subtitle | Trend Badge | Sparkline |
|------|----------|----------|-------------|-----------|
| Efficiency | `284` | tokens per line of code | `↓ 12%` (green = improving) | 7-bar mini chart of recent values |
| Velocity | `42` | lines changed per hour | `→ steady` (gray) | 7-bar mini chart |
| Rate Limit | `62%` avg / `87%` peak | time above 80%: 1h 23m | `↑ rising` (red = worsening) | — |

**Efficiency** = `total_tokens / (lines_added + lines_removed)` for the selected range. Lower is better — it means Claude is producing more code per token spent. The trend compares against the previous equivalent period (e.g., current 24h vs prior 24h).

**Velocity** = `(lines_added + lines_removed) / hours_elapsed` for the selected range. Higher is better. Computed from `CodeStatsHistoryPoint` timestamps.

**Rate Limit** = existing `BucketStats` data (avg, peak, time_above_80, trend), reshuffled into the new card layout. No computation changes. No sparkline — `BucketStats` provides only aggregate values, not a time series suitable for bar charts.

**Sparkline bucketing strategy:** Both Efficiency and Velocity sparklines always show 7 equal-width time buckets spanning the selected range. For each bucket, sum the tokens and LOC from data points falling within that bucket's time window, then compute the metric per bucket (efficiency = tokens/LOC, velocity = LOC/hours). If a bucket has no data, it renders as height 0. This produces consistent 7-bar charts regardless of the underlying data granularity.

**Second stats row** (2 compact inline cards):

| Card | Content |
|------|---------|
| Tokens | In: `2.4M` / Out: `892K` / Cache: `67%` |
| Code Changes | Added: `+1.2k` / Removed: `-340` / Net: `+860` |

These are the existing `TokenStats` and `CodeStats` values, reformatted into a more compact horizontal layout.

**Chart section:** The existing `UsageChart` with toggle pills (Utilization / Tokens / LOC). No changes to chart behavior.

**NowTab header layout:** Left side: tab bar (Now / Trends). Right side: range selector (1H / 24H / 7D / 30D), then toggle pills, then bucket dropdown. This preserves the existing control arrangement, just nested inside the tab.

**Breakdown section:** The existing collapsible `BreakdownPanel` (Hosts / Projects / Sessions) with drill-down filtering. No changes to behavior.

### Tab 2: "Trends"

**Range selector:** Only 7D and 30D ranges — shorter ranges don't produce meaningful trends.

**Session Health card** (full width):

| Metric | Display |
|--------|---------|
| Avg Duration | `38 min` with comparison: "was 33 min last week" |
| Avg Tokens/Session | `185K` with comparison |
| Sessions/Day | `4.2` with comparison |
| Status badge | e.g., "sessions growing longer" (orange) |
| Mini trend chart | 7-bar chart of avg session duration over the period |

**Backend change required:** The existing `get_session_breakdown` Tauri command has a `LIMIT 10` in its SQL query (storage.rs ~line 1116). For Session Health, we need all sessions in the range to compute accurate averages. Add a new Tauri command `get_session_stats` that returns aggregate stats (avg duration, avg tokens, session count) without the row limit. Alternatively, add an optional `limit` parameter to `get_session_breakdown` where `null` means no limit.

Computed from session data: duration = `last_active - first_seen` per session, averaged. Tokens/session = `total_tokens` averaged. Sessions/day = count / days in range.

**Activity Patterns card** (full width):

A 24-slot horizontal heatmap showing activity by hour of day. Each slot is colored on a green intensity scale (GitHub contribution style) based on total tokens consumed during that hour across all days in the range.

- Peak hours annotated (e.g., "Peak: 9am - 1pm")
- Hour labels at 12a, 3a, 6a, 9a, 12p, 3p, 6p, 9p

Computed from `TokenDataPoint` history: group by `hour(timestamp)`, sum `total_tokens` per hour bucket. Note: for 30D range, `get_token_history` returns pre-aggregated `token_hourly` rows where the timestamp IS the hour boundary, so `new Date(timestamp).getHours()` works correctly for grouping in both raw and pre-aggregated cases. Activity Patterns shows data across all hosts/projects/sessions — it does not respect breakdown filters (which live on the "Now" tab).

**Bottom row** (2 cards, equal width):

**Project Focus:**
- Horizontal bar chart showing each project's share of total tokens
- Each bar shows: project name, percentage, absolute token count
- Sorted by token consumption descending
- Top 5 projects, rest grouped as "Other"

Computed from existing `ProjectBreakdown` data. Note: `ProjectBreakdown` groups by `(project, hostname)`, so the same project on different hosts appears as separate rows. Merge rows by project path (summing `total_tokens` across hosts) before computing percentages.

**Learning Progress:**
- Headline numbers: total rules, emerging count, confirmed count
- Confidence distribution: 5-bar histogram (0-20%, 20-40%, 40-60%, 60-80%, 80-100%)
- Growth indicator: "+3 new rules this week"

Computed from existing `get_learned_rules` Tauri command: group by `state`, bucket `confidence` values. "New this week" = rules where `created_at` is within the last 7 days (rolling window, not calendar week).

## Component Architecture

### New Components

```
src/components/analytics/
  AnalyticsView.tsx        (modified — becomes tab container)
  NowTab.tsx               (new — "Now" tab content)
  TrendsTab.tsx            (new — "Trends" tab content)
  InsightCard.tsx          (new — reusable stat card with headline + trend + sparkline)
  CompactStatsRow.tsx      (new — inline tokens/code row)
  SessionHealthCard.tsx    (new — session health with comparisons)
  ActivityHeatmap.tsx      (new — 24-hour heatmap)
  ProjectFocusCard.tsx     (new — horizontal bar chart)
  LearningProgressCard.tsx (new — rule counts + confidence histogram)
  TabBar.tsx               (new — tab navigation)
```

### Modified Components

- `AnalyticsView.tsx` — refactored to render `TabBar` + active tab component. Range selector and bucket dropdown move inside `NowTab`. Existing chart/breakdown logic moves to `NowTab`.
- `StatsPanel.tsx` — replaced by `InsightCard` instances in `NowTab` + `CompactStatsRow`

### Unchanged Components

- `UsageChart.tsx` — no changes, rendered inside `NowTab`
- `BreakdownPanel.tsx` — no changes, rendered inside `NowTab`
- `TogglePills.tsx` — no changes, rendered inside `NowTab`
- `shared.tsx` — no changes (TrendArrow, getColor still used)

### New Hooks

```
src/hooks/
  useEfficiencyStats.ts    (new)
  useVelocityStats.ts      (new)
  useSessionHealth.ts      (new)
  useActivityPattern.ts    (new)
  useLearningStats.ts      (new)
```

**`useEfficiencyStats(range)`** — calls existing `useTokenData` + `useCodeStats` internally, returns `{ tokensPerLoc, trend, sparklineData }`. Fetches 2x the range to compute trend comparison (e.g., for 24H range, fetches 48h of data and partitions into current vs previous 24h windows). Sparkline = 7 equal-width time buckets from the current period.

**`useVelocityStats(range)`** — uses `useCodeStats` history data, returns `{ locPerHour, trend, sparklineData }`. Divides total LOC by hours elapsed in the range. Same 2x fetch strategy for trend comparison. Sparkline = 7 equal-width time buckets.

**`useSessionHealth(days)`** — calls the new `get_session_stats` Tauri command (or unlimited `get_session_breakdown`), computes avg duration / avg tokens / sessions per day. Fetches `days * 2` and partitions by timestamp to produce current period + previous period for comparison.

**`useActivityPattern(days)`** — calls `invoke("get_token_history", { range })`, groups by hour-of-day, returns `{ hourlyData: number[], peakStart: number, peakEnd: number }`.

**`useLearningStats()`** — calls `invoke("get_learned_rules")`, groups by state and confidence buckets. Returns `{ total, emerging, confirmed, confidenceBuckets, newThisWeek }`.

## Data Flow

All metrics are computed from existing data sources:

```
TokenStats ──────────┐
                     ├── useEfficiencyStats → InsightCard (Efficiency)
CodeStats ───────────┤
                     ├── useVelocityStats → InsightCard (Velocity)
CodeStatsHistory ────┘

BucketStats ─────────── (direct) → InsightCard (Rate Limit)

TokenStats ──────────── (direct) → CompactStatsRow (Tokens)
CodeStats ───────────── (direct) → CompactStatsRow (Code Changes)

SessionBreakdown ────── useSessionHealth → SessionHealthCard
TokenDataPoint[] ────── useActivityPattern → ActivityHeatmap
ProjectBreakdown ────── (direct) → ProjectFocusCard
LearnedRule[] ──────── useLearningStats → LearningProgressCard
```

One new Tauri command is needed: `get_session_stats` (or an unlimited variant of `get_session_breakdown`) to support Session Health computation without the LIMIT 10 cap. All other data is already available via existing hooks and `invoke()` commands.

## Interaction & State

### Tab Persistence

Active tab stored in `localStorage` under key `quill-analytics-tab`. Default: `"now"`.

### Range Selector

- "Now" tab: all 4 ranges (1H, 24H, 7D, 30D)
- "Trends" tab: only 7D and 30D
- Each tab stores its range independently in state (not localStorage — resets on reload is fine)

### Trend Comparison Logic

Each trend badge compares the current range against the previous equivalent period:
- 1H range: current hour vs previous hour
- 24H range: current 24h vs prior 24h
- 7D range: current 7 days vs prior 7 days
- 30D range: current 30 days vs prior 30 days

Direction semantics are metric-specific:
- Efficiency: **lower is better** (fewer tokens per line)
- Velocity: **higher is better** (more lines per hour)
- Rate Limit: **lower is better** (less utilization pressure)
- Session Duration: **lower is better** (shorter, focused sessions)
- Sessions/Day: **neutral** (just informational)

### Preserved Behaviors

- Breakdown selection filters the chart (stays on "Now" tab)
- Bucket dropdown selects which rate limit bucket to show (stays on "Now" tab)
- Chart toggle pills control overlay visibility (stays on "Now" tab)
- Breakdown collapse state persists in localStorage

## Visual Design

Follows existing Quill design language:
- Dark theme: `#0d1117` background, `#161b22` card backgrounds, `#21262d` borders
- Color semantics: green (#3fb950, #22c55e) = good/improving, red (#f85149, #f87171) = warning/worsening, gray (#8b949e) = neutral, blue (#58a6ff) = primary accent, purple (#a78bfa) = secondary
- Card border-radius: 8px
- Font sizes: 20px headlines, 9px labels, 8px sublabels
- Sparklines: 7-bar mini charts, 20px height
- Trend badges: small pills with colored background (e.g., green text on dark green bg)

### Tab Bar

- Left-aligned tabs with bottom border indicator
- Active tab: white text, colored bottom border (blue for Now, purple for Trends)
- Inactive tab: gray text (#484f58), no border
- Range selector right-aligned in the same row as tabs

## Error Handling

- If any individual metric fails to compute (e.g., no code stats data), show "—" placeholder instead of the card
- If a hook returns zero data, show the card with "No data yet" in a muted style
- Division by zero guards: if `lines_added + lines_removed = 0`, efficiency shows "—"; if `hours_elapsed = 0`, velocity shows "—"
- Token/code stats may lag behind rate limit data — cards render independently as data arrives
- Each Trends tab card shows a skeleton placeholder matching its final dimensions while data loads. Cards render independently as their data arrives.

## Out of Scope

- New database tables (existing tables are sufficient)
- Major backend refactoring
- Cost estimation (requires pricing data we don't have)
- Tool usage distribution (user did not select this)
- Cache health trends (user did not select this)
- IO ratio metrics (user did not select this)
