# quill

Claude Code plugin for reporting token usage, tool observations, and session data to a remote [Quill](https://github.com/sharaf-nassar/quill) desktop widget over the network.

> **Local setup?** If the Quill app runs on the same machine as Claude Code, you don't need this plugin — the app automatically configures hooks, MCP, and config on startup. This plugin is only needed when Claude Code runs on a **different machine** than the Quill app.

## Install

```
/plugin marketplace add sharaf-nassar/quill
/plugin install quill@sharaf-nassar/quill
/quill:setup
```

The setup skill will ask for:
1. The IP address of the machine running the Quill app
2. The bearer secret from that machine
3. What hostname label this machine should report as

Configuration is saved to `~/.config/quill/config.json`.

## Remote setup

Point the plugin to the machine running the Quill app:

```json
{
  "url": "http://192.168.1.50:19876",
  "hostname": "my-server",
  "secret": "<bearer secret from the widget machine>"
}
```

The bearer secret can be found on the machine running Quill at:
- **macOS**: `~/Library/Application Support/com.quilltoolkit.app/auth_secret`
- **Linux**: `~/.local/share/com.quilltoolkit.app/auth_secret`

## Multi-host setup

Multiple remote machines can report to a single Quill app. Install the plugin on each remote machine and point them to the same widget IP during setup. Each machine's hostname appears in the widget for filtering.

## Requirements

- `python3` and `curl` available on PATH
- `uv` for the MCP server (`curl -LsSf https://astral.sh/uv/install.sh | sh`)
- The Quill app running on the target machine (provides the HTTP server on port 19876)

## How it works

The plugin registers hooks that fire during Claude Code sessions:

- **PreToolUse / PostToolUse** — `observe.js` captures tool observations and POSTs them to the widget
- **Stop** — `report-tokens.sh` extracts token counts from the JSONL transcript and POSTs them
- **Stop** — `session-sync.js` syncs session messages to the widget for indexing
- **Stop** — `session-end-learn.js` triggers learning analysis

All data is sent to the configured URL with bearer-token authentication. No data is sent until you run `/quill:setup`.

## MCP server

The plugin includes an MCP server providing 12 tools for querying session history, searching past conversations, and analyzing usage patterns. The MCP server starts automatically with Claude Code after setup.

## Build skill

The `/quill:build` command orchestrates multi-agent feature implementation. Give it a feature description and it will:

1. Explore the codebase with parallel agents
2. Create an implementation plan organized into waves of parallel tasks
3. Dispatch implementor, verifier, and UI designer agents to build it
4. Verify each wave and produce a final report

```
/quill:build add a dark mode toggle to the settings page
```
