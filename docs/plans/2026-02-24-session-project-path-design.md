# Session Project Path Display

## Goal

Display the project directory (working directory) for each session in the Sessions breakdown view, to the left of the hostname badge.

## Data Flow

```
Claude Code Stop Hook (cwd in stdin JSON)
  -> Hook script extracts cwd
  -> HTTP POST payload includes cwd field
  -> Rust server validates & stores in token_snapshots
  -> SessionBreakdown query aggregates project per session
  -> Frontend displays last dir name + tooltip with full path
```

## Implementation Steps

### 1. Hook script (`hooks/claude-usage-hook.sh`)
- Extract `cwd` from hook input JSON alongside `session_id` and `transcript_path`
- Include `cwd` in the payload sent to the widget server

### 2. Rust model (`src-tauri/src/models.rs`)
- Add `cwd: Option<String>` to `TokenReportPayload`
- Add `project: Option<String>` to `SessionBreakdown`

### 3. Server validation (`src-tauri/src/server.rs`)
- Add length validation for `cwd` (max 512 chars)

### 4. Database & storage (`src-tauri/src/storage.rs`)
- Add migration: `ALTER TABLE token_snapshots ADD COLUMN cwd TEXT DEFAULT NULL`
- Store `cwd` in insert statement
- Query: select the latest `cwd` per session_id for `SessionBreakdown`

### 5. Frontend (`src/components/analytics/BreakdownPanel.jsx`)
- Display project name (last path segment) as a tag to the left of hostname
- Full path shown via `title` attribute (tooltip)
- Style the project tag in `src/styles/index.css`

## Display Format

- Show: last directory name only (e.g., "claude-usage")
- Tooltip: full path (e.g., "/home/mamba/work/claude-usage")
- Position: to the left of the hostname tag in each session row

## Backward Compatibility

`cwd` is `Option<String>` - older hooks that don't send it will still work. Sessions without `cwd` data simply won't show a project tag.
