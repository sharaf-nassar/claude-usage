# Architecture

Quill is a cross-platform desktop companion for Claude Code, built with Tauri (Rust) and React (TypeScript). It tracks token usage, provides analytics, discovers behavioral patterns, manages plugins, and indexes session history.

## Tech Stack

The application pairs a Rust backend with a React frontend communicating over Tauri IPC.

- **Frontend**: React 19, TypeScript, Recharts, pure CSS dark theme
- **Backend**: Rust (edition 2024), Tauri 2, Axum HTTP server, SQLite (rusqlite), Tantivy full-text search
- **AI**: Anthropic API via rig-core SDK for pattern extraction and memory optimization
- **Build**: Vite (ES2020), Cargo, GitHub Actions CI/CD across Linux/macOS/Windows

## Multi-Window Design

Each major feature runs in its own Tauri window, routed via URL query parameter in [[src/main.tsx]].

The main window hosts a split-pane layout with the [[features#Live Usage View]] and [[features#Analytics Dashboard]]. Secondary windows open for [[features#Session Search]], [[features#Learning System]], [[features#Plugin Manager]], and [[features#Restart Orchestrator]].

### Window Configuration

Windows are defined in `src-tauri/tauri.conf.json` with IDs: `main`, `runs`, `sessions`, `learning`, `plugins`, `restart`. The main window defaults to 280x340px (compact widget), borderless and transparent, with a custom titlebar in [[src/components/TitleBar.tsx]].

## Module Map

The Rust backend in [[src-tauri/src/lib.rs]] registers 64 Tauri commands and starts background tasks on launch.

### Backend Modules

Rust modules under `src-tauri/src/` organized by domain responsibility.

| Module | File | Purpose |
|--------|------|---------|
| Entry point | [[src-tauri/src/lib.rs]] | IPC commands, tray, auto-updater, background tasks |
| HTTP server | [[src-tauri/src/server.rs]] | Axum API on port 19876 for hook data ingestion |
| Storage | [[src-tauri/src/storage.rs]] | SQLite schema, migrations, queries, aggregation |
| Sessions | [[src-tauri/src/sessions.rs]] | Tantivy full-text indexing of session transcripts |
| Learning | [[src-tauri/src/learning.rs]] | Two-stream LLM analysis for behavioral pattern discovery |
| Memory optimizer | [[src-tauri/src/memory_optimizer.rs]] | LLM-driven memory file optimization |
| Plugins | [[src-tauri/src/plugins.rs]] | Plugin and marketplace management |
| Restart | [[src-tauri/src/restart.rs]] | Claude Code instance discovery and restart orchestration |
| Models | [[src-tauri/src/models.rs]] | All shared data structures and serde types |
| AI client | [[src-tauri/src/ai_client.rs]] | Anthropic API integration via rig-core |
| Git analysis | [[src-tauri/src/git_analysis.rs]] | Commit pattern extraction and hotspot analysis |
| Fetcher | [[src-tauri/src/fetcher.rs]] | Claude API usage bucket fetching |
| Auth | [[src-tauri/src/auth.rs]] | Bearer token generation and storage |
| Config | [[src-tauri/src/config.rs]] | Credential reading and HTTP client setup |
| Claude setup | [[src-tauri/src/claude_setup.rs]] | Hook and MCP server auto-deployment |
| Prompt utils | [[src-tauri/src/prompt_utils.rs]] | LLM input sanitization and compression |

### Frontend Structure

React and TypeScript sources organized by feature domain under `src/`.

| Directory | Purpose |
|-----------|---------|
| [[src/App.tsx]] | Main window: split-pane live + analytics layout |
| `src/components/` | UI components organized by feature domain |
| `src/hooks/` | 15+ custom hooks for Tauri IPC data fetching |
| `src/windows/` | Secondary window entry points |
| `src/utils/` | Formatting helpers (time, tokens, charts) |
| `src/styles/` | Pure CSS stylesheets (dark theme) |
| [[src/types.ts]] | All TypeScript type definitions (434 lines) |

## Communication Layers

Data flows through three communication channels between the system's components.

### Tauri IPC

The primary frontend-backend channel. React hooks call `invoke()` for request-response and `listen()` for push events. See [[data-flow]] for specific flows.

### HTTP API

An Axum server on port 19876 (configurable via `QUILL_PORT`) receives data from external hook scripts. Bearer token authentication with constant-time comparison. Rate-limited per endpoint type. See [[backend#HTTP API Server]].

### Tauri Events

Backend pushes real-time updates to the frontend via `emit()`. Events include `tokens-updated`, `learning-updated`, `learning-log`, `plugin-changed`, `restart-status-changed`, `memory-optimizer-updated`, and `memory-files-updated`.

## Background Tasks

Several background tasks start on app launch in [[src-tauri/src/lib.rs]].

- **Hourly cleanup**: Aggregates snapshots into hourly tables, prunes old data, compresses observations
- **Learning periodic timer**: Runs behavioral analysis every N minutes if configured
- **Plugin update checker**: Polls marketplaces every 4 hours for available updates
- **Session index scan**: Ingests new JSONL session files on startup
- **Claude setup**: Deploys hooks and MCP server to `~/.config/quill/` on first run

## Local vs Remote Architecture

Quill supports both local single-machine and distributed multi-host setups.

### Local Setup

On startup, [[src-tauri/src/claude_setup.rs]] auto-deploys hook scripts and an MCP server. Hooks report token usage, tool observations, and session events to the local HTTP server. No user configuration needed.

### Remote Setup

A plugin (`plugin/`) can be installed on remote hosts via the marketplace. Running `/quill:setup` on the remote configures hooks to report back to the desktop widget's IP. The remote MCP server (`plugin/mcp/server.py`) provides session query tools.
