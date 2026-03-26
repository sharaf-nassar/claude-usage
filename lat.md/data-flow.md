# Data Flow

The system has five primary data pipelines connecting hook scripts, the HTTP server, the database, and the frontend.

## Token Reporting Pipeline

Hook scripts capture token usage from Claude Code sessions and report it to the widget for real-time tracking.

1. Claude Code session produces a transcript with token counts
2. Hook script (`report-tokens.sh`) extracts tokens and POSTs to `POST /api/v1/tokens` with Bearer auth
3. [[src-tauri/src/server.rs]] validates, rate-limits, and inserts into `token_snapshots` table
4. Server emits `tokens-updated` Tauri event
5. Frontend hooks (`useTokenData`, `useAnalyticsData`) receive event and refresh via IPC
6. Hourly cleanup task aggregates snapshots into `token_hourly` for historical queries

### Data Shape

The `TokenReportPayload` carries: session_id, hostname, timestamp, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, and cwd (project path). This enables per-host, per-project, and per-session breakdowns.

## Learning Analysis Pipeline

Tool-use observations and git history are analyzed by LLMs to discover reusable behavioral patterns.

1. Hook script (`observe.cjs`) captures PreToolUse/PostToolUse events
2. POSTs observation to `POST /api/v1/learning/observations`
3. Observations stored in `observations` table, marked unanalyzed
4. Trigger fires (on-demand, session-end, or periodic timer)
5. [[src-tauri/src/learning.rs]] spawns async analysis task
6. **Stream A**: Fetch up to 100 unanalyzed observations, compress for LLM context
7. **Stream B**: Fetch git history for project via [[src-tauri/src/git_analysis.rs]] (cached by HEAD hash)
8. Haiku extracts patterns from each stream independently
9. Sonnet synthesizes combined findings and applies verdicts on existing rules
10. New rules stored in `learned_rules` table and written to `~/.claude/rules/learned/`
11. Existing rule confidence updated using Wilson lower-bound scoring with freshness decay
12. `learning-updated` event emitted; real-time `learning-log` events stream progress to UI

### Observation Compression

Observations are compressed for LLM context using [[src-tauri/src/prompt_utils.rs]]: errors prioritized, then file paths, then outcomes. UTF-8 boundary-aware truncation fits within token budgets.

## Session Indexing Pipeline

Session transcripts are indexed for full-text search with enriched metadata.

1. Claude Code writes session JSONL files to `~/.claude/projects/`
2. On app startup, [[src-tauri/src/sessions.rs]] scans for new files (incremental by mtime)
3. Alternatively, hook script posts `POST /api/v1/sessions/notify` with JSONL path
4. Or direct message ingestion via `POST /api/v1/sessions/messages`
5. Messages parsed and enriched: extract tools_used, files_modified, code_changes, commands_run
6. Indexed into Tantivy with fields: message_id, session_id, content, role, project, host, timestamp, git_branch, plus enriched metadata
7. Tool action details stored in `tool_actions` SQLite table for deep inspection via MCP
8. Frontend search queries use TF-IDF weighted scoring with snippet generation
9. Faceted search pre-aggregates project, host, and branch counts

### Enrichment

Each message is enriched during indexing by parsing tool call inputs and outputs.

Edit/Write tool calls become `code_changes` (file path + change summary). Bash calls become `commands_run`. Read/Grep/Glob calls become `tool_details` with paths and queries. All enriched fields are full-text searchable.

## Memory Optimization Pipeline

LLM analyzes project memory files to suggest consolidation, cleanup, and improvements.

1. Frontend triggers optimization for a specific project path
2. [[src-tauri/src/memory_optimizer.rs]] scans project directory recursively for memory files
3. Filters: exclude denylisted directories, minified/compiled files, oversized content
4. Compute dynamic budget allocation based on available section types
5. Assemble LLM prompt: memory file contents + project CLAUDE.md + learned rules + instinct sections
6. Call Haiku to generate structured optimization suggestions
7. Suggestions stored in `optimization_suggestions` with status=pending
8. `memory-optimizer-updated` event notifies frontend
9. User reviews suggestions in the Memories panel
10. On approve: execute action (write/delete/merge file), store backup in `backup_data` column, set status=executed
11. On deny: set status=denied (can be un-denied later)
12. On undo: restore from backup_data, set status=reverted
13. `memory-files-updated` event triggers UI refresh

### Suggestion Types

Five action types that the LLM can propose for memory files.

- **Delete**: Remove redundant or stale memory files
- **Update**: Rewrite content for clarity or accuracy
- **Merge**: Combine related memory files into one (tracks merge_sources)
- **Create**: Add missing memory documentation
- **Flag**: Mark for human review (no automated action)

## Plugin Management Pipeline

Plugin lifecycle operations through marketplace git repositories and the Claude CLI.

1. Marketplaces registered in `~/.claude/plugins/known_marketplaces.json` (git repos)
2. Each marketplace exposes a plugin manifest
3. [[src-tauri/src/plugins.rs]] enumerates installed from `~/.claude/plugins/installed_plugins.json`
4. Background task checks for updates every 4 hours (lenient semver comparison)
5. `plugin-updates-available` event updates TitleBar badge count
6. Install/update/remove delegate to `claude plugin` CLI subprocess
7. Enable/disable toggle a blocklist and emit `plugin-changed`
8. Bulk updates emit per-plugin `plugin-bulk-progress` events
9. Marketplace refresh: git pull to sync latest manifests

## Usage Bucket Fetching

The main window polls Claude API usage limits to display real-time rate limit status.

1. [[src-tauri/src/fetcher.rs]] calls the Anthropic API with OAuth Bearer token
2. Parses response into usage buckets: 5-hour, 7-day, model-specific, extra usage, OAuth apps
3. Validates: finite utilization values, valid RFC3339 timestamps
4. Returns `UsageData` to frontend via `fetch_usage_data()` IPC command
5. Raw snapshots stored in `usage_snapshots` table
6. Hourly cleanup aggregates into `usage_hourly` for trend analysis
