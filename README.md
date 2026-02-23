# Claude Plan Usage Widget

A cross-platform desktop widget that displays your Claude AI plan usage in a compact, always-on-top floating window. Built with Tauri + React.

## Features

- Displays per-5-hour and per-7-day usage with progress bars
- Per-model breakdown (Sonnet, Opus, Code, OAuth)
- Color-coded percentages that transition green → yellow → red as usage increases
- Countdown timers showing time until usage resets
- Three time display modes (pace marker, dual bars, background fill)
- Analytics view with historical charts and per-bucket stats
- **Token tracking** — per-turn input/output/cache token counts via Claude Code hook
- **Multi-host support** — remote Claude Code instances can report usage over the network
- Token sparkline in the live view and dual-axis chart overlay in analytics
- Always-on-top floating window with semi-transparent dark theme
- Custom titlebar with drag-to-move
- Remembers window position and size across restarts
- Auto-refreshes every 60 seconds
- Automatically refreshes expired OAuth tokens

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and logged in (`claude /login`)

### For development

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 18+
- System dependencies for Tauri (Linux):
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
  ```

## Installation

### From releases

Download the latest release for your platform from the [Releases](../../releases) page:
- Linux: `.deb` or `.AppImage`
- Windows: `.msi` or `.exe`
- macOS: `.dmg`

### From source

```bash
git clone https://github.com/sharaf-nassar/claude-usage.git
cd claude-usage
npm install
cargo tauri build
```

The built binary will be in `src-tauri/target/release/`.

## Setup

The widget reads OAuth tokens from Claude Code's credentials file (`~/.claude/.credentials.json`). Make sure you are logged in:

```bash
claude /login
```

No additional configuration is needed — the widget starts tracking utilization immediately.

## Token Tracking (Optional)

The widget includes an HTTP server (port `19876`) that receives per-turn token usage data from Claude Code via a Stop hook. This enables the token sparkline in the live view and the token overlay on the analytics chart.

### Install the hook (Claude Code plugin)

1. Add the marketplace:

```
/plugin marketplace add sharaf-nassar/claude-usage
```

2. Install the plugin:

```
/plugin install claude-usage-hook@sharaf-nassar/claude-usage
```

3. **Restart** Claude Code, then run the setup skill:

```
/claude-usage-hook:setup
```

The setup skill will ask where the widget is running (this machine or a remote IP) and save the config. After setup, every Claude Code turn will report token counts to the widget.

### Manual install (alternative)

```bash
curl -fsSL https://raw.githubusercontent.com/sharaf-nassar/claude-usage/main/hooks/install.sh | bash
```

With a remote widget host:

```bash
curl -fsSL https://raw.githubusercontent.com/sharaf-nassar/claude-usage/main/hooks/install.sh | bash -s -- --url http://<widget-ip>:19876 --hostname my-server
```

### Multi-host setup

Multiple machines can report to a single widget. Install the plugin on each machine and point them to the same widget IP during setup. Each machine's hostname appears in the widget for filtering.

### Verify

```bash
# Check the server is running
curl http://localhost:19876/api/v1/health

# Send a test payload
curl -X POST http://localhost:19876/api/v1/tokens \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"test","hostname":"dev","input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":10,"cache_read_input_tokens":5}'
```

## Development

```bash
npm install
cargo tauri dev
```

## Controls

- **Drag the title bar** to move the window
- **Drag any edge or corner** to resize
- **Right-click** for a context menu (Refresh / Quit)
- **Gear icon** to switch between time display modes

## Project structure

```
src/                          # React frontend
  main.jsx                    # Entry point
  App.jsx                     # Main app component
  components/
    TitleBar.jsx              # Custom minimal titlebar (drag + close)
    UsageRow.jsx              # Usage row with progress bar + token sparkline
    UsageDisplay.jsx          # Container for all rows
    analytics/
      AnalyticsView.jsx       # Analytics tab with charts and stats
      UsageChart.jsx          # Dual-axis chart (utilization + tokens)
      StatsPanel.jsx          # Bucket statistics cards
      BucketOverview.jsx      # All-buckets summary with sparklines
  hooks/
    useAnalyticsData.js       # Fetches utilization history and stats
    useTokenData.js           # Fetches token history, stats, hostnames
  utils/
    tokens.js                 # Token count formatting (1.2k, 1.5M)
  styles/
    index.css                 # Global styles + dark theme
src-tauri/                    # Rust backend
  src/
    main.rs                   # Tauri entry point
    lib.rs                    # IPC commands and server startup
    config.rs                 # Credential loading and token refresh
    fetcher.rs                # Usage API calls with retry logic
    models.rs                 # Data models (usage buckets + token types)
    storage.rs                # SQLite storage with aggregation
    server.rs                 # axum HTTP server for token reporting
  tauri.conf.json             # Tauri window and build configuration
plugin/                       # Claude Code plugin (hook + setup skill)
  .claude-plugin/
    plugin.json               # Plugin manifest
  hooks/
    hooks.json                # Stop hook configuration
  scripts/
    report-tokens.sh          # Extracts tokens from transcript, POSTs to widget
  skills/
    setup/
      SKILL.md                # Interactive setup wizard
hooks/                        # Standalone hook scripts (non-plugin)
  claude-usage-hook.sh        # Standalone Stop hook
  install.sh                  # curl-pipe installer
```

## License

MIT
