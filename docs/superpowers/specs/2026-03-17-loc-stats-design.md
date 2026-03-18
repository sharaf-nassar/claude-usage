# LOC Change Stats in Quill Analytics

## Purpose

Surface lines-of-code change statistics throughout the Quill app — giving users visibility into how much code Claude is writing across sessions, what languages are changing, and how productivity trends over time.

## Data Source

All LOC metrics are derived from the existing `tool_actions` table in `usage.db`:

- **Edit operations** (`category = "code_change"`, `tool_name = "Edit"`): parse `full_input` JSON to extract `old_string` and `new_string`. Lines removed = line count of `old_string`, lines added = line count of `new_string`.
- **Write operations** (`category = "code_change"`, `tool_name = "Write"`): parse `full_input` JSON to extract `content`. All lines count as added. If the file already existed (overwrite), this is still counted as pure addition since we don't have the previous content.
- **Language detection**: infer from `file_path` extension using a hardcoded mapping:

| Extension(s) | Language |
|---|---|
| `.ts`, `.tsx` | TypeScript |
| `.js`, `.jsx` | JavaScript |
| `.rs` | Rust |
| `.py` | Python |
| `.css`, `.scss` | CSS |
| `.html` | HTML |
| `.json` | JSON |
| `.toml` | TOML |
| `.yaml`, `.yml` | YAML |
| `.md` | Markdown |
| `.sql` | SQL |
| `.go` | Go |
| `.sh` | Shell |
| (unrecognized) | Other |

No schema changes are required. All computation is on-demand from existing stored data.

### Performance

Parsing `full_input` JSON on every request is acceptable for v1. The `tool_actions` table is indexed on `category` and `timestamp`, so the query narrows quickly. For a heavy user (~10,000 code change rows over 30 days), parsing 10K small JSON blobs is expected to complete in <500ms on the Tauri backend. If this proves too slow, a future optimization would add precomputed `lines_added` / `lines_removed` columns to `tool_actions` (populated on insert in the indexer).

### Truncated `full_input` Handling

The `full_input` field is character-limited (~10,240 chars). Truncation cuts the serialized JSON object, which means the JSON may be incomplete mid-field. The parser must:
1. Attempt `serde_json::from_str` on the full string.
2. If that fails, skip the row entirely (don't count it, don't error).
3. If parsing succeeds but a required field (`old_string`, `new_string`, or `content`) is missing, skip the row.

## Components

### 1. Analytics Split Layout

**Current state**: The analytics chart section is a single column — a section title, then a full-width chart. Stats (Avg, Peak, In, Out, Cache) are inline in the controls bar above.

**New state**: Split into a two-column layout:

```
+---------------------+--------------------------------------+
| Stats Panel (200px) |  Chart (flex)                        |
|                     |                                      |
| ┌─ Rate Limit ────┐ |                                      |
| │ Avg    Peak     │ |       (existing UsageChart,          |
| │ 2.2%   6.0%    │ |        now with LOC overlay)         |
| │ ▲ trending up   │ |                                      |
| └─────────────────┘ |                                      |
|                     |                                      |
| ┌─ Tokens ────────┐ |                                      |
| │ In     Out      │ |                                      |
| │ 4.0k   93.1k   │ |                                      |
| │ Cache: 100%     │ |                                      |
| └─────────────────┘ |                                      |
|                     |                                      |
| ┌─ Code Changes ──┐ |                                      |
| │ Added  Removed  │ |                                      |
| │ +1,247 -382     │ |                                      |
| │ Net    Avg/Sess │ |                                      |
| │ +865   108      │ |                                      |
| │                 │ |                                      |
| │ By Language     │ |                                      |
| │ ■ TypeScript 62%│ |                                      |
| │ ■ Rust       28%│ |                                      |
| │ ■ CSS        10%│ |                                      |
| └─────────────────┘ |                                      |
+---------------------+--------------------------------------+
```

**Stats panel cards**:
- **Rate Limit**: avg utilization, peak utilization, TrendArrow (all moved from inline stats). The existing `TrendArrow` component moves here.
- **Tokens**: input tokens, output tokens, cache hit rate (moved from inline stats)
- **Code Changes** (new): lines added, lines removed, net change, avg lines per session, language breakdown by percentage

The existing `inline-stats` and `token-stats` divs in the controls bar are **fully removed**. The controls bar retains only: range tabs, toggle pills, and bucket dropdown.

**`avg_per_session`** = total lines changed (added + removed) / number of sessions with at least one code change in the range. This measures total churn per session, not net change.

All cards respond to the selected time range (1H / 24H / 7D / 30D) and bucket.

**Styling**: The Code Changes card has a purple accent border (`rgba(139, 92, 246, 0.2)`) to distinguish it as the new feature. Rate Limit and Tokens cards use the standard border (`rgba(255, 255, 255, 0.06)`).

**Responsive behavior**: At panel widths below 450px, the stats panel and chart stack vertically (stats on top, chart below) instead of side-by-side. The stats panel switches from fixed 200px to full width when stacked.

### 2. Chart Overlay with Toggle Pills

LOC data is rendered as an additional line on the existing `UsageChart` composed chart.

**Toggle pills** in the controls bar allow users to show/hide each data series:

```
[1H] [24H] [7D] [30D]   ● Utilization  ● Tokens  ● LOC   [5 hours ▾]
```

- Each pill shows a colored dot matching its line color
- Active = filled dot + full opacity text
- Inactive = outline dot + dimmed text
- Clicking a pill toggles that series on/off
- Default state: Utilization ON, Tokens ON, LOC ON
- Persist toggle state in `localStorage` under key `quill-chart-series-visibility` as JSON: `{"utilization": true, "tokens": true, "loc": true}`

**LOC line**:
- Color: `#a78bfa` (purple, matching the Code Changes card accent)
- Shares the right Y-axis with tokens. When both are visible, the axis auto-scales to the max of either series. When only one is visible, it scales to that series alone. When neither is visible, the right axis is hidden.
- Data represents total lines changed (added + removed) per time bucket
- Tooltip includes LOC value when hovering

**Y-axis behavior by toggle state**:
- Utilization OFF + Tokens OFF + LOC OFF: empty chart with just the grid
- Only left-axis series visible: hide right Y-axis
- Only right-axis series visible: hide left Y-axis
- Mixed: show both axes

**`MergedDataPoint` type** gains a new field: `total_lines_changed: number | null`. The merge logic in `UsageChart.tsx` extends to incorporate LOC time series using the same closest-timestamp matching approach used for token data.

### 3. Session-Level Stats on Result Cards

Each session result card in the Sessions window gets LOC stats:

**Net change pill** (header row, right-aligned):
- Green pill for net positive: `+104`
- Red pill for net negative: `-23`
- Background: `rgba(34, 197, 94, 0.15)` for positive, `rgba(248, 113, 113, 0.15)` for negative

**Inline breakdown** (metadata row):
- Appended after the existing metadata: `quill · mamba-desktop · main · 2h ago · +142 -38`
- Green for additions, red for removals
- Only shown if the session has code changes (skip for sessions with zero edits)

## Backend (Tauri Commands)

### `get_code_stats`

```
Input:  { range: "1h" | "24h" | "7d" | "30d" }
Output: {
  lines_added: number,
  lines_removed: number,
  net_change: number,
  session_count: number,
  avg_per_session: number,
  by_language: Array<{ language: string, lines: number, percentage: number }>
}
```

Queries `tool_actions` where `category = "code_change"` within the time range. Parses `full_input` JSON for each row to compute line counts. Groups by file extension for language breakdown.

Time range calculation:
- `"1h"`: last 60 minutes from now
- `"24h"`: last 24 hours from now
- `"7d"`: last 7 days from now
- `"30d"`: last 30 days from now

### `get_code_stats_history`

```
Input:  { range: "1h" | "24h" | "7d" | "30d" }
Output: Array<{
  timestamp: string,
  lines_added: number,
  lines_removed: number,
  total_changed: number
}>
```

Returns time-bucketed LOC data for the chart overlay. Bucketing intervals:
- `"1h"`: 1-minute buckets (60 points max)
- `"24h"`: 15-minute buckets (96 points max)
- `"7d"`: 1-hour buckets (168 points max)
- `"30d"`: 1-day buckets (30 points max)

Each bucket sums all `lines_added`, `lines_removed`, and `total_changed` for tool actions whose timestamp falls within that bucket. Empty buckets are included with zero values to maintain a continuous time series.

### `get_batch_session_code_stats`

```
Input:  { session_ids: Array<string> }
Output: Record<string, {
  lines_added: number,
  lines_removed: number,
  net_change: number
}>
```

Returns LOC stats for multiple sessions in a single query. The frontend calls this once when search results load, passing all visible session IDs. Results are cached in the `useSessionCodeStats` hook keyed by session ID to avoid re-fetching on re-renders.

Sessions with no code changes are omitted from the response (absence = zero changes).

## Frontend Changes

### Files Modified
- `src/components/analytics/AnalyticsView.tsx` — split layout, remove inline stats from controls bar, add toggle pills, wire up code stats data
- `src/components/analytics/UsageChart.tsx` — accept LOC data series, add `total_lines_changed` to merge logic, render additional line, handle Y-axis visibility based on toggles
- `src/components/sessions/ResultCard.tsx` — add LOC pill and inline breakdown
- `src/types.ts` — add `CodeStats`, `CodeStatsHistory`, `SessionCodeStats` types; extend `MergedDataPoint` with `total_lines_changed: number | null`
- `src/hooks/useAnalyticsData.ts` — no changes needed (utilization data unchanged)

### Files Added
- `src/components/analytics/StatsPanel.tsx` — the left-column stats cards (Rate Limit, Tokens, Code Changes)
- `src/components/analytics/TogglePills.tsx` — series toggle UI in controls bar
- `src/hooks/useCodeStats.ts` — hook for `get_code_stats` and `get_code_stats_history`
- `src/hooks/useSessionCodeStats.ts` — hook for `get_batch_session_code_stats` with per-session-id caching

### Files Modified (Backend)
- `src-tauri/src/storage.rs` — new query functions for code stats
- `src-tauri/src/lib.rs` — register new Tauri commands

## Interaction with BreakdownPanel

The BreakdownPanel filtering (by host/project/session) does **not** filter Code Changes stats or the LOC chart line in v1. LOC stats always reflect the full range regardless of breakdown selection. This avoids adding filter parameters to the new commands and keeps the scope manageable. A future iteration could add `host`, `project`, and `session_id` filter params to `get_code_stats` and `get_code_stats_history`.

## Edge Cases

- **Empty data**: If no code changes exist for the selected range, the Code Changes card shows all zeros and the LOC chart line is hidden.
- **Large writes**: A Write of a 10,000-line file counts as +10,000. This is technically correct but may skew averages. Accept this for v1.
- **Truncated `full_input`**: See "Truncated `full_input` Handling" in Data Source section.
- **Unknown extensions**: Files without a recognized extension go into an "Other" language bucket.
- **Session cards without changes**: Sessions with zero code changes show no pill and no inline LOC in metadata.

## Out of Scope (v1)

- Most-edited files / churn hotspots (could be added later as a breakdown sub-panel)
- Per-file LOC detail view
- Diffstat visualization (bar charts of +/- per file like `git diff --stat`)
- Real deletion tracking for Write operations (would need before-content)
- BreakdownPanel filtering for LOC data (host/project/session filters)
- Precomputed LOC columns on `tool_actions` (performance optimization if needed)
