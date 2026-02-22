# Claude Usage Widget

A cross-platform desktop widget that displays your Claude AI subscription usage in a compact, always-on-top floating window. Built with Tauri + React.

## Features

- Displays per-5-hour and per-7-day usage with progress bars
- Per-model breakdown (Sonnet, Opus, Code, OAuth)
- Color-coded percentages that transition green → yellow → red as usage increases
- Countdown timers showing time until usage resets
- Always-on-top floating window
- Semi-transparent dark theme
- Custom titlebar with drag-to-move
- Remembers window position and size across restarts
- Auto-refreshes every 60 seconds
- Automatically refreshes expired OAuth tokens
- Right-click context menu (Refresh / Quit)

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
git clone <repo-url> claude-usage
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

No additional configuration is needed.

## Development

```bash
npm install
cargo tauri dev
```

## Controls

- **Drag the title bar** to move the window
- **Drag any edge or corner** to resize
- **Right-click** for a context menu (Refresh / Quit)

## Project structure

```
src/                      # React frontend
  main.jsx                # Entry point
  App.jsx                 # Main app component
  components/
    TitleBar.jsx          # Custom minimal titlebar (drag + close)
    UsageRow.jsx          # Single usage bucket row with progress bar
    UsageDisplay.jsx      # Container for all rows
  styles/
    index.css             # Global styles + dark theme
src-tauri/                # Rust backend
  src/
    main.rs               # Tauri entry point
    lib.rs                # Plugin registration and commands
    config.rs             # Credential loading and token refresh
    fetcher.rs            # Usage API calls with retry logic
    models.rs             # Data models (UsageBucket, UsageData)
  tauri.conf.json         # Tauri window and build configuration
  capabilities/
    default.json          # Window permissions
```

## License

MIT
