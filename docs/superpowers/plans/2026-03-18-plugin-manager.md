# Plugin Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Plugin Manager window to Quill for managing Claude Code plugins, browsing marketplaces, and applying updates.

**Architecture:** New `plugins.rs` Rust module reads plugin JSON files directly from `~/.claude/plugins/` and shells out to `claude plugin` CLI for mutations. Frontend uses the existing standalone window pattern (`?view=plugins`) with 4 tabbed views. Background update checker runs on a tokio interval and emits events for badge updates.

**Tech Stack:** Rust (Tauri 2, tokio, serde_json), React 19, TypeScript, pure CSS (BEM naming)

**Spec:** `docs/superpowers/specs/2026-03-18-plugin-manager-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src-tauri/src/plugins.rs` | All plugin/marketplace read + mutation logic, background update checker |
| `src/windows/PluginsWindowView.tsx` | Window shell (titlebar, drag region, close, tab routing) |
| `src/components/plugins/PluginsTabs.tsx` | Tab bar with active state and update badge |
| `src/components/plugins/InstalledTab.tsx` | Installed plugin list with search, enable/disable/remove |
| `src/components/plugins/BrowseTab.tsx` | Marketplace browser with search, category filter, install |
| `src/components/plugins/MarketplacesTab.tsx` | Marketplace source management (add/remove/refresh) |
| `src/components/plugins/UpdatesTab.tsx` | Available updates with individual + bulk update |
| `src/hooks/usePluginData.ts` | Data fetching hooks for all plugin operations |
| `src/styles/plugins.css` | All plugin manager styles |

### Modified Files
| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `mod plugins;`, register ~15 new Tauri commands, spawn background update checker |
| `src/main.tsx` | Add `plugins` case to view router |
| `src/components/TitleBar.tsx` | Add Plugins button with update badge |
| `src/types.ts` | Add plugin-related TypeScript interfaces |
| `src/styles/index.css` | Import plugins.css, add plugins button styles to titlebar |

---

## Task 1: TypeScript Data Models

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add plugin type interfaces to types.ts**

Add the following interfaces at the bottom of `src/types.ts`, after the existing analytics types:

```typescript
// Plugin manager types

export type PluginsTab = "installed" | "browse" | "marketplaces" | "updates";

export interface InstalledPlugin {
	name: string;
	marketplace: string;
	version: string;
	scope: string;
	enabled: boolean;
	description: string | null;
	author: string | null;
	installed_at: string;
	last_updated: string;
	git_commit_sha: string | null;
}

export interface MarketplacePlugin {
	name: string;
	description: string | null;
	version: string;
	author: string | null;
	category: string | null;
	source_path: string;
	installed: boolean;
}

export interface Marketplace {
	name: string;
	source_type: string;
	repo: string;
	install_location: string;
	last_updated: string | null;
	plugins: MarketplacePlugin[];
}

export interface PluginUpdate {
	name: string;
	marketplace: string;
	current_version: string;
	available_version: string;
}

export interface UpdateCheckResult {
	plugin_updates: PluginUpdate[];
	last_checked: string | null;
	next_check: string | null;
}

export interface BulkUpdateProgress {
	total: number;
	completed: number;
	current_plugin: string | null;
	results: BulkUpdateItem[];
}

export interface BulkUpdateItem {
	name: string;
	status: string;
	error: string | null;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /home/mamba/work/quill && npx tsc --noEmit src/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(plugins): add TypeScript interfaces for plugin manager"
```

---

## Task 2: Rust Plugin Module — Data Structures and Read Functions

**Files:**
- Create: `src-tauri/src/plugins.rs`

- [ ] **Step 1: Create plugins.rs with data structures and read functions**

Create `src-tauri/src/plugins.rs` with:

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ── Data Structures ──

#[derive(Debug, Clone, Serialize)]
pub struct InstalledPlugin {
    pub name: String,
    pub marketplace: String,
    pub version: String,
    pub scope: String,
    pub enabled: bool,
    pub description: Option<String>,
    pub author: Option<String>,
    pub installed_at: String,
    pub last_updated: String,
    pub git_commit_sha: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MarketplacePlugin {
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub author: Option<String>,
    pub category: Option<String>,
    pub source_path: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Marketplace {
    pub name: String,
    pub source_type: String,
    pub repo: String,
    pub install_location: String,
    pub last_updated: Option<String>,
    pub plugins: Vec<MarketplacePlugin>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginUpdate {
    pub name: String,
    pub marketplace: String,
    pub current_version: String,
    pub available_version: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheckResult {
    pub plugin_updates: Vec<PluginUpdate>,
    pub last_checked: Option<String>,
    pub next_check: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkUpdateProgress {
    pub total: u32,
    pub completed: u32,
    pub current_plugin: Option<String>,
    pub results: Vec<BulkUpdateItem>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkUpdateItem {
    pub name: String,
    pub status: String,
    pub error: Option<String>,
}

// ── Internal JSON deserialization shapes ──

#[derive(Deserialize)]
struct InstalledPluginsFile {
    #[allow(dead_code)]
    version: u32,
    plugins: std::collections::HashMap<String, Vec<InstallationRecord>>,
}

#[derive(Deserialize)]
struct InstallationRecord {
    scope: String,
    #[serde(rename = "installPath")]
    install_path: String,
    version: String,
    #[serde(rename = "installedAt")]
    installed_at: String,
    #[serde(rename = "lastUpdated")]
    last_updated: String,
    #[serde(rename = "gitCommitSha")]
    git_commit_sha: Option<String>,
}

#[derive(Deserialize)]
struct MarketplaceSource {
    source: SourceInfo,
    #[serde(rename = "installLocation")]
    install_location: String,
    #[serde(rename = "lastUpdated")]
    last_updated: Option<String>,
}

#[derive(Deserialize)]
struct SourceInfo {
    source: String,
    repo: String,
}

#[derive(Deserialize)]
struct PluginJson {
    name: Option<String>,
    description: Option<String>,
    version: Option<String>,
    author: Option<AuthorField>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum AuthorField {
    Str(String),
    Obj { name: String },
}

impl AuthorField {
    fn name(&self) -> &str {
        match self {
            AuthorField::Str(s) => s,
            AuthorField::Obj { name } => name,
        }
    }
}

#[derive(Deserialize)]
struct MarketplaceManifest {
    plugins: Option<Vec<MarketplacePluginEntry>>,
}

#[derive(Deserialize)]
struct MarketplacePluginEntry {
    name: String,
    description: Option<String>,
    version: Option<String>,
    author: Option<AuthorField>,
    source: Option<String>,
    category: Option<String>,
}

#[derive(Deserialize)]
struct BlocklistEntry {
    plugin: String,
}

// ── Helpers ──

fn plugins_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join(".claude")
        .join("plugins")
}

fn read_json_file<T: serde::de::DeserializeOwned>(path: &std::path::Path) -> Result<T, String> {
    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse {}: {e}", path.display()))
}

fn read_blocklist() -> std::collections::HashSet<String> {
    let path = plugins_dir().join("blocklist.json");
    if !path.exists() {
        return std::collections::HashSet::new();
    }
    let entries: Vec<BlocklistEntry> = match read_json_file(&path) {
        Ok(e) => e,
        Err(_) => return std::collections::HashSet::new(),
    };
    entries.into_iter().map(|e| e.plugin).collect()
}

fn read_plugin_json(install_path: &str) -> Option<PluginJson> {
    let path = PathBuf::from(install_path)
        .join(".claude-plugin")
        .join("plugin.json");
    read_json_file(&path).ok()
}

// ── Read Functions ──

pub fn get_installed_plugins() -> Result<Vec<InstalledPlugin>, String> {
    let path = plugins_dir().join("installed_plugins.json");
    if !path.exists() {
        return Ok(Vec::new());
    }

    let file: InstalledPluginsFile = read_json_file(&path)?;
    let blocklist = read_blocklist();
    let mut plugins = Vec::new();

    for (key, records) in &file.plugins {
        // Key format: "pluginName@marketplace"
        let parts: Vec<&str> = key.splitn(2, '@').collect();
        let (plugin_name, marketplace_name) = if parts.len() == 2 {
            (parts[0].to_string(), parts[1].to_string())
        } else {
            (key.clone(), "unknown".to_string())
        };

        for record in records {
            let meta = read_plugin_json(&record.install_path);
            let enabled = !blocklist.contains(key);

            plugins.push(InstalledPlugin {
                name: plugin_name.clone(),
                marketplace: marketplace_name.clone(),
                version: record.version.clone(),
                scope: record.scope.clone(),
                enabled,
                description: meta.as_ref().and_then(|m| m.description.clone()),
                author: meta.as_ref().and_then(|m| m.author.as_ref().map(|a| a.name().to_string())),
                installed_at: record.installed_at.clone(),
                last_updated: record.last_updated.clone(),
                git_commit_sha: record.git_commit_sha.clone(),
            });
        }
    }

    plugins.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(plugins)
}

pub fn get_marketplaces() -> Result<Vec<Marketplace>, String> {
    let path = plugins_dir().join("known_marketplaces.json");
    if !path.exists() {
        return Ok(Vec::new());
    }

    let sources: std::collections::HashMap<String, MarketplaceSource> = read_json_file(&path)?;
    let installed = get_installed_plugins().unwrap_or_default();
    let installed_set: std::collections::HashSet<String> = installed
        .iter()
        .map(|p| format!("{}@{}", p.name, p.marketplace))
        .collect();

    let mut marketplaces = Vec::new();

    for (name, src) in &sources {
        let marketplace_json_path = PathBuf::from(&src.install_location)
            .join(".claude-plugin")
            .join("marketplace.json");

        let mut plugins = Vec::new();
        if let Ok(manifest) = read_json_file::<MarketplaceManifest>(&marketplace_json_path) {
            if let Some(entries) = manifest.plugins {
                for entry in entries {
                    let key = format!("{}@{}", entry.name, name);
                    plugins.push(MarketplacePlugin {
                        name: entry.name,
                        description: entry.description,
                        version: entry.version.unwrap_or_else(|| "0.0.0".to_string()),
                        author: entry.author.map(|a| a.name().to_string()),
                        category: entry.category,
                        source_path: entry.source.unwrap_or_default(),
                        installed: installed_set.contains(&key),
                    });
                }
            }
        }

        marketplaces.push(Marketplace {
            name: name.clone(),
            source_type: src.source.source.clone(),
            repo: src.source.repo.clone(),
            install_location: src.install_location.clone(),
            last_updated: src.last_updated.clone(),
            plugins,
        });
    }

    marketplaces.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(marketplaces)
}

pub fn get_available_updates() -> Result<Vec<PluginUpdate>, String> {
    let installed = get_installed_plugins()?;
    let marketplaces = get_marketplaces()?;
    let mut updates = Vec::new();

    for plugin in &installed {
        for marketplace in &marketplaces {
            if marketplace.name != plugin.marketplace {
                continue;
            }
            for mp in &marketplace.plugins {
                if mp.name == plugin.name && mp.version != plugin.version {
                    updates.push(PluginUpdate {
                        name: plugin.name.clone(),
                        marketplace: plugin.marketplace.clone(),
                        current_version: plugin.version.clone(),
                        available_version: mp.version.clone(),
                    });
                }
            }
        }
    }

    Ok(updates)
}
```

- [ ] **Step 2: Add `mod plugins;` to lib.rs**

Add `mod plugins;` after the existing module declarations at the top of `src-tauri/src/lib.rs` (after `mod storage;`).

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/mamba/work/quill/src-tauri && cargo check`
Expected: Compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/plugins.rs src-tauri/src/lib.rs
git commit -m "feat(plugins): add Rust plugin module with data models and read functions"
```

---

## Task 3: Rust Plugin Module — Mutation Functions

**Files:**
- Modify: `src-tauri/src/plugins.rs`

- [ ] **Step 1: Add mutation functions to plugins.rs**

Append the following to the bottom of `src-tauri/src/plugins.rs`:

```rust
// ── Mutation Functions (CLI subprocess) ──

fn run_claude_command(args: &[&str]) -> Result<String, String> {
    let output = std::process::Command::new("claude")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to run `claude {}`: {e}", args.join(" ")))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!(
            "Command `claude {}` failed: {}{}",
            args.join(" "),
            stderr.trim(),
            if !stdout.trim().is_empty() {
                format!("\n{}", stdout.trim())
            } else {
                String::new()
            }
        ))
    }
}

pub fn install_plugin(name: &str, marketplace: &str) -> Result<String, String> {
    let qualified = format!("{name}@{marketplace}");
    run_claude_command(&["plugin", "install", &qualified])
}

pub fn remove_plugin(name: &str) -> Result<String, String> {
    run_claude_command(&["plugin", "uninstall", name])
}

pub fn enable_plugin(name: &str) -> Result<String, String> {
    run_claude_command(&["plugin", "enable", name])
}

pub fn disable_plugin(name: &str) -> Result<String, String> {
    run_claude_command(&["plugin", "disable", name])
}

pub fn update_plugin(name: &str, marketplace: &str) -> Result<String, String> {
    let qualified = format!("{name}@{marketplace}");
    run_claude_command(&["plugin", "update", &qualified])
}

pub fn add_marketplace(repo: &str) -> Result<String, String> {
    run_claude_command(&["plugin", "marketplace", "add", repo])
}

pub fn remove_marketplace(name: &str) -> Result<String, String> {
    run_claude_command(&["plugin", "marketplace", "remove", name])
}

pub fn refresh_marketplace(name: &str) -> Result<String, String> {
    let marketplaces = get_marketplaces()?;
    let marketplace = marketplaces
        .iter()
        .find(|m| m.name == name)
        .ok_or_else(|| format!("Marketplace '{name}' not found"))?;

    let location = &marketplace.install_location;
    let output = std::process::Command::new("git")
        .args(["pull", "--ff-only"])
        .current_dir(location)
        .output()
        .map_err(|e| format!("Failed to git pull {name}: {e}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "git pull failed for {name}: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

pub fn refresh_all_marketplaces() -> Result<Vec<(String, Result<String, String>)>, String> {
    let marketplaces = get_marketplaces()?;
    let results: Vec<_> = marketplaces
        .iter()
        .map(|m| (m.name.clone(), refresh_marketplace(&m.name)))
        .collect();
    Ok(results)
}

pub fn bulk_update_plugins(
    updates: &[PluginUpdate],
    app: &tauri::AppHandle,
) -> BulkUpdateProgress {
    let total = updates.len() as u32;
    let mut progress = BulkUpdateProgress {
        total,
        completed: 0,
        current_plugin: None,
        results: Vec::new(),
    };

    for update in updates {
        progress.current_plugin = Some(update.name.clone());
        let _ = app.emit("plugin-bulk-progress", &progress);

        let result = update_plugin(&update.name, &update.marketplace);
        progress.results.push(BulkUpdateItem {
            name: update.name.clone(),
            status: if result.is_ok() {
                "success".to_string()
            } else {
                "error".to_string()
            },
            error: result.err(),
        });
        progress.completed += 1;
    }

    progress.current_plugin = None;
    let _ = app.emit("plugin-bulk-progress", &progress);
    progress
}
```

- [ ] **Step 2: Add `use tauri::Emitter;` at the top of plugins.rs**

Add after the existing use statements:
```rust
use tauri::Emitter;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/mamba/work/quill/src-tauri && cargo check`
Expected: Compiles with no errors

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/plugins.rs
git commit -m "feat(plugins): add CLI mutation functions for install/remove/enable/disable/update"
```

---

## Task 4: Rust Plugin Module — Background Update Checker

**Files:**
- Modify: `src-tauri/src/plugins.rs`

- [ ] **Step 1: Add background update checker to plugins.rs**

Append the following to `src-tauri/src/plugins.rs`:

```rust
// ── Background Update Checker ──

use parking_lot::Mutex;
use std::sync::Arc;

pub struct UpdateCheckerState {
    pub last_result: Mutex<UpdateCheckResult>,
}

impl UpdateCheckerState {
    pub fn new() -> Self {
        Self {
            last_result: Mutex::new(UpdateCheckResult {
                plugin_updates: Vec::new(),
                last_checked: None,
                next_check: None,
            }),
        }
    }
}

pub fn spawn_update_checker(state: Arc<UpdateCheckerState>, app: tauri::AppHandle) {
    let interval_secs: u64 = 4 * 60 * 60; // 4 hours

    tauri::async_runtime::spawn(async move {
        let mut last_count: usize = 0;
        loop {
            // Check for updates
            let result = tokio::task::block_in_place(|| get_available_updates());

            if let Ok(updates) = result {
                let count = updates.len();
                let now = chrono::Utc::now().to_rfc3339();
                let next = (chrono::Utc::now()
                    + chrono::Duration::seconds(interval_secs as i64))
                .to_rfc3339();

                let check_result = UpdateCheckResult {
                    plugin_updates: updates,
                    last_checked: Some(now),
                    next_check: Some(next),
                };

                *state.last_result.lock() = check_result;

                // Only emit event when count changes
                if count != last_count {
                    let _ = app.emit("plugin-updates-available", count);
                    last_count = count;
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;
        }
    });
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/mamba/work/quill/src-tauri && cargo check`
Expected: Compiles with no errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/plugins.rs
git commit -m "feat(plugins): add background update checker with event emission"
```

---

## Task 5: Wire Up Tauri Commands in lib.rs

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add Tauri command functions for plugins**

Add the following command functions in `src-tauri/src/lib.rs`, before the `hide_window` command (around line 524). Add them after a `// --- Plugin IPC commands ---` comment:

```rust
// --- Plugin IPC commands ---

#[tauri::command]
async fn get_installed_plugins() -> Result<Vec<plugins::InstalledPlugin>, String> {
    tokio::task::block_in_place(plugins::get_installed_plugins)
}

#[tauri::command]
async fn get_marketplaces() -> Result<Vec<plugins::Marketplace>, String> {
    tokio::task::block_in_place(plugins::get_marketplaces)
}

#[tauri::command]
async fn get_available_updates(
    app: tauri::AppHandle,
) -> Result<plugins::UpdateCheckResult, String> {
    let state = app
        .try_state::<std::sync::Arc<plugins::UpdateCheckerState>>()
        .map(|s| s.inner().clone());

    if let Some(state) = state {
        Ok(state.last_result.lock().clone())
    } else {
        // Fallback: compute directly
        let updates = tokio::task::block_in_place(plugins::get_available_updates)?;
        Ok(plugins::UpdateCheckResult {
            plugin_updates: updates,
            last_checked: None,
            next_check: None,
        })
    }
}

#[tauri::command]
async fn check_updates_now(
    app: tauri::AppHandle,
) -> Result<plugins::UpdateCheckResult, String> {
    let updates = tokio::task::block_in_place(plugins::get_available_updates)?;
    let now = chrono::Utc::now().to_rfc3339();

    let result = plugins::UpdateCheckResult {
        plugin_updates: updates,
        last_checked: Some(now),
        next_check: None,
    };

    if let Some(state) = app
        .try_state::<std::sync::Arc<plugins::UpdateCheckerState>>()
        .map(|s| s.inner().clone())
    {
        *state.last_result.lock() = result.clone();
        let _ = app.emit("plugin-updates-available", result.plugin_updates.len());
    }

    Ok(result)
}

#[tauri::command]
async fn install_plugin(name: String, marketplace: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::install_plugin(&name, &marketplace))
}

#[tauri::command]
async fn remove_plugin(name: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::remove_plugin(&name))
}

#[tauri::command]
async fn enable_plugin(name: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::enable_plugin(&name))
}

#[tauri::command]
async fn disable_plugin(name: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::disable_plugin(&name))
}

#[tauri::command]
async fn update_plugin(name: String, marketplace: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::update_plugin(&name, &marketplace))
}

#[tauri::command]
async fn update_all_plugins(app: tauri::AppHandle) -> Result<plugins::BulkUpdateProgress, String> {
    let updates = tokio::task::block_in_place(plugins::get_available_updates)?;
    let progress = tokio::task::block_in_place(|| plugins::bulk_update_plugins(&updates, &app));
    let _ = app.emit("plugin-changed", ());
    Ok(progress)
}

#[tauri::command]
async fn add_marketplace(repo: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::add_marketplace(&repo))
}

#[tauri::command]
async fn remove_marketplace(name: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::remove_marketplace(&name))
}

#[tauri::command]
async fn refresh_marketplace(name: String) -> Result<String, String> {
    tokio::task::block_in_place(|| plugins::refresh_marketplace(&name))
}

#[tauri::command]
async fn refresh_all_marketplaces() -> Result<Vec<(String, Result<String, String>)>, String> {
    tokio::task::block_in_place(plugins::refresh_all_marketplaces)
}
```

- [ ] **Step 2: Register commands in the invoke_handler**

Add the new commands to the `tauri::generate_handler![]` macro in the `.invoke_handler()` call. Add them before `hide_window`:

```rust
get_installed_plugins,
get_marketplaces,
get_available_updates,
check_updates_now,
install_plugin,
remove_plugin,
enable_plugin,
disable_plugin,
update_plugin,
update_all_plugins,
add_marketplace,
remove_marketplace,
refresh_marketplace,
refresh_all_marketplaces,
```

- [ ] **Step 3: Spawn the background update checker in setup**

In the `.setup()` closure, after the existing periodic aggregation/cleanup spawn, add:

```rust
// Plugin update checker (every 4 hours)
{
    let update_state = std::sync::Arc::new(plugins::UpdateCheckerState::new());
    app.manage(update_state.clone());
    let update_handle = app.handle().clone();
    plugins::spawn_update_checker(update_state, update_handle);
}
```

- [ ] **Step 4: Add missing import if needed**

Ensure `use tauri::Emitter;` is present in `lib.rs` (it already is, just verify).

- [ ] **Step 5: Verify it compiles**

Run: `cd /home/mamba/work/quill/src-tauri && cargo check`
Expected: Compiles with no errors

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(plugins): wire up Tauri commands and background update checker"
```

---

## Task 6: Frontend Data Hooks

**Files:**
- Create: `src/hooks/usePluginData.ts`

- [ ] **Step 1: Create usePluginData.ts**

Create `src/hooks/usePluginData.ts`:

```typescript
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
	InstalledPlugin,
	Marketplace,
	UpdateCheckResult,
	BulkUpdateProgress,
} from "../types";

export function useInstalledPlugins() {
	const [plugins, setPlugins] = useState<InstalledPlugin[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const data = await invoke<InstalledPlugin[]>("get_installed_plugins");
			setPlugins(data);
			setError(null);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useEffect(() => {
		const unlisten = listen("plugin-changed", () => {
			refresh();
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [refresh]);

	return { plugins, loading, error, refresh };
}

export function useMarketplaces() {
	const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const data = await invoke<Marketplace[]>("get_marketplaces");
			setMarketplaces(data);
			setError(null);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useEffect(() => {
		const unlisten = listen("plugin-changed", () => {
			refresh();
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [refresh]);

	return { marketplaces, loading, error, refresh };
}

export function useAvailableUpdates() {
	const [result, setResult] = useState<UpdateCheckResult>({
		plugin_updates: [],
		last_checked: null,
		next_check: null,
	});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const data = await invoke<UpdateCheckResult>("get_available_updates");
			setResult(data);
			setError(null);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	const checkNow = useCallback(async () => {
		setLoading(true);
		try {
			const data = await invoke<UpdateCheckResult>("check_updates_now");
			setResult(data);
			setError(null);
		} catch (e) {
			setError(String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	useEffect(() => {
		const unlisten = listen("plugin-changed", () => {
			refresh();
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [refresh]);

	useEffect(() => {
		const unlisten = listen<number>("plugin-updates-available", () => {
			refresh();
		});
		return () => {
			unlisten.then((fn) => fn());
		};
	}, [refresh]);

	return { result, loading, error, refresh, checkNow };
}

export function usePluginOperations() {
	const [inProgress, setInProgress] = useState<Set<string>>(new Set());

	const withOperation = useCallback(
		async (pluginName: string, operation: () => Promise<unknown>) => {
			setInProgress((prev) => new Set(prev).add(pluginName));
			try {
				await operation();
			} finally {
				setInProgress((prev) => {
					const next = new Set(prev);
					next.delete(pluginName);
					return next;
				});
			}
		},
		[],
	);

	const installPlugin = useCallback(
		async (name: string, marketplace: string) => {
			await withOperation(name, async () => {
				await invoke("install_plugin", { name, marketplace });
			});
		},
		[withOperation],
	);

	const removePlugin = useCallback(
		async (name: string) => {
			await withOperation(name, async () => {
				await invoke("remove_plugin", { name });
			});
		},
		[withOperation],
	);

	const enablePlugin = useCallback(
		async (name: string) => {
			await withOperation(name, async () => {
				await invoke("enable_plugin", { name });
			});
		},
		[withOperation],
	);

	const disablePlugin = useCallback(
		async (name: string) => {
			await withOperation(name, async () => {
				await invoke("disable_plugin", { name });
			});
		},
		[withOperation],
	);

	const updatePlugin = useCallback(
		async (name: string, marketplace: string) => {
			await withOperation(name, async () => {
				await invoke("update_plugin", { name, marketplace });
			});
		},
		[withOperation],
	);

	return {
		inProgress,
		installPlugin,
		removePlugin,
		enablePlugin,
		disablePlugin,
		updatePlugin,
	};
}

export function useBulkUpdate() {
	const [progress, setProgress] = useState<BulkUpdateProgress | null>(null);
	const [running, setRunning] = useState(false);

	useEffect(() => {
		const unlisten = listen<BulkUpdateProgress>(
			"plugin-bulk-progress",
			(event) => {
				setProgress(event.payload);
			},
		);
		return () => {
			unlisten.then((fn) => fn());
		};
	}, []);

	const updateAll = useCallback(async () => {
		setRunning(true);
		try {
			const result = await invoke<BulkUpdateProgress>("update_all_plugins");
			setProgress(result);
		} finally {
			setRunning(false);
		}
	}, []);

	const reset = useCallback(() => {
		setProgress(null);
	}, []);

	return { progress, running, updateAll, reset };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/mamba/work/quill && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePluginData.ts
git commit -m "feat(plugins): add frontend data hooks for plugin operations"
```

---

## Task 7: View Routing and Window Shell

**Files:**
- Modify: `src/main.tsx`
- Create: `src/windows/PluginsWindowView.tsx`

- [ ] **Step 1: Add plugins view to main.tsx router**

In `src/main.tsx`, add the lazy import and route case:

After the existing lazy imports (around line 12), add:
```typescript
const PluginsWindowView = React.lazy(
  () => import("./windows/PluginsWindowView"),
);
```

In the render JSX, add a new case before the default `<App />`:
```typescript
) : view === "plugins" ? (
  <PluginsWindowView />
```

- [ ] **Step 2: Create PluginsWindowView.tsx**

Create `src/windows/PluginsWindowView.tsx`:

```typescript
import { useState, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
	useInstalledPlugins,
	useMarketplaces,
	useAvailableUpdates,
	usePluginOperations,
	useBulkUpdate,
} from "../hooks/usePluginData";
import PluginsTabs from "../components/plugins/PluginsTabs";
import InstalledTab from "../components/plugins/InstalledTab";
import BrowseTab from "../components/plugins/BrowseTab";
import MarketplacesTab from "../components/plugins/MarketplacesTab";
import UpdatesTab from "../components/plugins/UpdatesTab";
import type { PluginsTab } from "../types";
import "../styles/plugins.css";

function PluginsWindowView() {
	const [activeTab, setActiveTab] = useState<PluginsTab>("installed");
	const installed = useInstalledPlugins();
	const marketplaces = useMarketplaces();
	const updates = useAvailableUpdates();
	const operations = usePluginOperations();
	const bulkUpdate = useBulkUpdate();

	const handleClose = async () => {
		await getCurrentWindow().close();
	};

	const handlePluginChanged = useCallback(() => {
		installed.refresh();
		marketplaces.refresh();
		updates.refresh();
	}, [installed.refresh, marketplaces.refresh, updates.refresh]);

	const handleAddMarketplace = useCallback(
		async (repo: string) => {
			await invoke("add_marketplace", { repo });
			handlePluginChanged();
		},
		[handlePluginChanged],
	);

	const handleRemoveMarketplace = useCallback(
		async (name: string) => {
			await invoke("remove_marketplace", { name });
			handlePluginChanged();
		},
		[handlePluginChanged],
	);

	const handleRefreshMarketplace = useCallback(
		async (name: string) => {
			await invoke("refresh_marketplace", { name });
			handlePluginChanged();
		},
		[handlePluginChanged],
	);

	const handleRefreshAllMarketplaces = useCallback(async () => {
		await invoke("refresh_all_marketplaces");
		handlePluginChanged();
	}, [handlePluginChanged]);

	if (installed.loading && marketplaces.loading) {
		return (
			<div className="plugins-window">
				<div className="plugins-window-titlebar" data-tauri-drag-region>
					<span className="plugins-window-title" data-tauri-drag-region>
						Plugin Manager
					</span>
					<button
						className="plugins-window-close"
						onClick={handleClose}
						aria-label="Close"
					>
						&times;
					</button>
				</div>
				<div className="plugins-body">
					<div className="plugins-loading">Loading...</div>
				</div>
			</div>
		);
	}

	return (
		<div className="plugins-window">
			<div className="plugins-window-titlebar" data-tauri-drag-region>
				<span className="plugins-window-title" data-tauri-drag-region>
					Plugin Manager
				</span>
				<button
					className="plugins-window-close"
					onClick={handleClose}
					aria-label="Close"
				>
					&times;
				</button>
			</div>
			<div className="plugins-body">
				<PluginsTabs
					activeTab={activeTab}
					onTabChange={setActiveTab}
					updateCount={updates.result.plugin_updates.length}
				/>
				{activeTab === "installed" && (
					<InstalledTab
						plugins={installed.plugins}
						operations={operations}
						onChanged={handlePluginChanged}
					/>
				)}
				{activeTab === "browse" && (
					<BrowseTab
						marketplaces={marketplaces.marketplaces}
						operations={operations}
						onChanged={handlePluginChanged}
					/>
				)}
				{activeTab === "marketplaces" && (
					<MarketplacesTab
						marketplaces={marketplaces.marketplaces}
						onAdd={handleAddMarketplace}
						onRemove={handleRemoveMarketplace}
						onRefresh={handleRefreshMarketplace}
						onRefreshAll={handleRefreshAllMarketplaces}
					/>
				)}
				{activeTab === "updates" && (
					<UpdatesTab
						updates={updates}
						operations={operations}
						bulkUpdate={bulkUpdate}
						onChanged={handlePluginChanged}
					/>
				)}
			</div>
		</div>
	);
}

export default PluginsWindowView;
```

- [ ] **Step 3: Commit**

```bash
git add src/main.tsx src/windows/PluginsWindowView.tsx
git commit -m "feat(plugins): add view routing and window shell component"
```

---

## Task 8: Tab Bar Component

**Files:**
- Create: `src/components/plugins/PluginsTabs.tsx`

- [ ] **Step 1: Create PluginsTabs.tsx**

Create `src/components/plugins/PluginsTabs.tsx`:

```typescript
import type { PluginsTab } from "../../types";

const TABS: { id: PluginsTab; label: string }[] = [
	{ id: "installed", label: "Installed" },
	{ id: "browse", label: "Browse" },
	{ id: "marketplaces", label: "Marketplaces" },
	{ id: "updates", label: "Updates" },
];

interface PluginsTabsProps {
	activeTab: PluginsTab;
	onTabChange: (tab: PluginsTab) => void;
	updateCount: number;
}

function PluginsTabs({ activeTab, onTabChange, updateCount }: PluginsTabsProps) {
	return (
		<div className="plugins-tab-bar">
			{TABS.map((tab) => (
				<button
					key={tab.id}
					className={`plugins-tab-bar__tab${activeTab === tab.id ? " plugins-tab-bar__tab--active" : ""}`}
					onClick={() => onTabChange(tab.id)}
				>
					{tab.label}
					{tab.id === "updates" && updateCount > 0 && (
						<span className="plugins-tab-bar__badge">{updateCount}</span>
					)}
				</button>
			))}
		</div>
	);
}

export default PluginsTabs;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/plugins/PluginsTabs.tsx
git commit -m "feat(plugins): add tab bar component"
```

---

## Task 9: Installed Tab Component

**Files:**
- Create: `src/components/plugins/InstalledTab.tsx`

- [ ] **Step 1: Create InstalledTab.tsx**

Create `src/components/plugins/InstalledTab.tsx`:

```typescript
import { useState, useMemo, useCallback } from "react";
import type { InstalledPlugin } from "../../types";

interface InstalledTabProps {
	plugins: InstalledPlugin[];
	operations: {
		inProgress: Set<string>;
		enablePlugin: (name: string) => Promise<void>;
		disablePlugin: (name: string) => Promise<void>;
		removePlugin: (name: string) => Promise<void>;
	};
	onChanged: () => void;
}

function InstalledTab({ plugins, operations, onChanged }: InstalledTabProps) {
	const [search, setSearch] = useState("");

	const filtered = useMemo(() => {
		if (!search.trim()) return plugins;
		const q = search.toLowerCase();
		return plugins.filter(
			(p) =>
				p.name.toLowerCase().includes(q) ||
				(p.description?.toLowerCase().includes(q) ?? false),
		);
	}, [plugins, search]);

	const enabledCount = plugins.filter((p) => p.enabled).length;
	const disabledCount = plugins.length - enabledCount;

	const handleToggle = useCallback(
		async (plugin: InstalledPlugin) => {
			if (plugin.enabled) {
				await operations.disablePlugin(plugin.name);
			} else {
				await operations.enablePlugin(plugin.name);
			}
			onChanged();
		},
		[operations, onChanged],
	);

	const handleRemove = useCallback(
		async (plugin: InstalledPlugin) => {
			await operations.removePlugin(plugin.name);
			onChanged();
		},
		[operations, onChanged],
	);

	return (
		<div className="plugins-tab-content">
			<div className="plugins-search-bar">
				<input
					type="text"
					className="plugins-search-input"
					placeholder="Search installed plugins..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
			</div>
			<div className="plugins-list">
				{filtered.map((plugin) => {
					const busy = operations.inProgress.has(plugin.name);
					return (
						<div
							key={`${plugin.name}@${plugin.marketplace}`}
							className={`plugins-row${!plugin.enabled ? " plugins-row--disabled" : ""}`}
						>
							<div className="plugins-row__info">
								<div className="plugins-row__header">
									<span className="plugins-row__name">{plugin.name}</span>
									<span className="plugins-row__version">{plugin.version}</span>
									<span
										className={`plugins-row__status${plugin.enabled ? " plugins-row__status--enabled" : " plugins-row__status--disabled"}`}
									>
										{plugin.enabled ? "enabled" : "disabled"}
									</span>
								</div>
								{plugin.description && (
									<div className="plugins-row__description">
										{plugin.description}
									</div>
								)}
								<div className="plugins-row__meta">
									{plugin.marketplace} &middot; {plugin.scope} scope
								</div>
							</div>
							<div className="plugins-row__actions">
								{busy ? (
									<div className="plugins-spinner-wrap">
										<div className="plugins-spinner" />
										<span className="plugins-spinner-text">Working...</span>
									</div>
								) : (
									<>
										<button
											className={`plugins-btn${plugin.enabled ? " plugins-btn--secondary" : " plugins-btn--enable"}`}
											onClick={() => handleToggle(plugin)}
										>
											{plugin.enabled ? "Disable" : "Enable"}
										</button>
										<button
											className="plugins-btn plugins-btn--danger"
											onClick={() => handleRemove(plugin)}
										>
											Remove
										</button>
									</>
								)}
							</div>
						</div>
					);
				})}
			</div>
			<div className="plugins-footer">
				{plugins.length} plugin{plugins.length !== 1 ? "s" : ""} installed
				&middot; {enabledCount} enabled &middot; {disabledCount} disabled
			</div>
		</div>
	);
}

export default InstalledTab;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/plugins/InstalledTab.tsx
git commit -m "feat(plugins): add Installed tab component"
```

---

## Task 10: Browse Tab Component

**Files:**
- Create: `src/components/plugins/BrowseTab.tsx`

- [ ] **Step 1: Create BrowseTab.tsx**

Create `src/components/plugins/BrowseTab.tsx`:

```typescript
import { useState, useMemo, useCallback } from "react";
import type { Marketplace } from "../../types";

interface BrowseTabProps {
	marketplaces: Marketplace[];
	operations: {
		inProgress: Set<string>;
		installPlugin: (name: string, marketplace: string) => Promise<void>;
	};
	onChanged: () => void;
}

function BrowseTab({ marketplaces, operations, onChanged }: BrowseTabProps) {
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("all");
	const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

	const categories = useMemo(() => {
		const cats = new Set<string>();
		for (const m of marketplaces) {
			for (const p of m.plugins) {
				if (p.category) cats.add(p.category);
			}
		}
		return ["all", ...Array.from(cats).sort()];
	}, [marketplaces]);

	const filteredMarketplaces = useMemo(() => {
		const q = search.toLowerCase();
		return marketplaces
			.map((m) => ({
				...m,
				plugins: m.plugins.filter((p) => {
					const matchesSearch =
						!q ||
						p.name.toLowerCase().includes(q) ||
						(p.description?.toLowerCase().includes(q) ?? false);
					const matchesCategory =
						category === "all" || p.category === category;
					return matchesSearch && matchesCategory;
				}),
			}))
			.filter((m) => m.plugins.length > 0);
	}, [marketplaces, search, category]);

	const totalPlugins = marketplaces.reduce((n, m) => n + m.plugins.length, 0);
	const installedCount = marketplaces.reduce(
		(n, m) => n + m.plugins.filter((p) => p.installed).length,
		0,
	);

	const toggleCollapse = useCallback((name: string) => {
		setCollapsed((prev) => {
			const next = new Set(prev);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
	}, []);

	const handleInstall = useCallback(
		async (pluginName: string, marketplace: string) => {
			await operations.installPlugin(pluginName, marketplace);
			onChanged();
		},
		[operations, onChanged],
	);

	return (
		<div className="plugins-tab-content">
			<div className="plugins-search-bar">
				<input
					type="text"
					className="plugins-search-input"
					placeholder="Search all marketplaces..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
				/>
				<select
					className="plugins-filter-select"
					value={category}
					onChange={(e) => setCategory(e.target.value)}
				>
					{categories.map((c) => (
						<option key={c} value={c}>
							{c === "all" ? "Category: All" : c}
						</option>
					))}
				</select>
			</div>
			<div className="plugins-list">
				{filteredMarketplaces.map((marketplace) => (
					<div key={marketplace.name} className="plugins-marketplace-group">
						<button
							className="plugins-marketplace-group__header"
							onClick={() => toggleCollapse(marketplace.name)}
						>
							<span className="plugins-marketplace-group__name">
								{marketplace.name}
							</span>
							<span className="plugins-marketplace-group__count">
								{marketplace.plugins.length} plugin
								{marketplace.plugins.length !== 1 ? "s" : ""}
							</span>
							<span className="plugins-marketplace-group__toggle">
								{collapsed.has(marketplace.name) ? "\u25BE" : "\u25B4"}
							</span>
						</button>
						{!collapsed.has(marketplace.name) &&
							marketplace.plugins.map((plugin) => {
								const busy = operations.inProgress.has(plugin.name);
								return (
									<div
										key={plugin.name}
										className={`plugins-row${plugin.installed ? " plugins-row--installed" : ""}`}
									>
										<div className="plugins-row__info">
											<div className="plugins-row__header">
												<span className="plugins-row__name">
													{plugin.name}
												</span>
												<span className="plugins-row__version">
													{plugin.version}
												</span>
												{plugin.category && (
													<span className="plugins-row__category">
														{plugin.category}
													</span>
												)}
												{plugin.installed && (
													<span className="plugins-row__installed-badge">
														installed
													</span>
												)}
											</div>
											{plugin.description && (
												<div className="plugins-row__description">
													{plugin.description}
												</div>
											)}
											{plugin.author && (
												<div className="plugins-row__meta">
													by {plugin.author}
												</div>
											)}
										</div>
										<div className="plugins-row__actions">
											{plugin.installed ? (
												<span className="plugins-installed-check">
													Installed &#10003;
												</span>
											) : busy ? (
												<div className="plugins-spinner-wrap">
													<div className="plugins-spinner" />
													<span className="plugins-spinner-text">
														Installing...
													</span>
												</div>
											) : (
												<button
													className="plugins-btn plugins-btn--install"
													onClick={() =>
														handleInstall(plugin.name, marketplace.name)
													}
												>
													Install
												</button>
											)}
										</div>
									</div>
								);
							})}
					</div>
				))}
			</div>
			<div className="plugins-footer">
				{totalPlugins} plugin{totalPlugins !== 1 ? "s" : ""} across{" "}
				{marketplaces.length} marketplace
				{marketplaces.length !== 1 ? "s" : ""} &middot; {installedCount}{" "}
				installed
			</div>
		</div>
	);
}

export default BrowseTab;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/plugins/BrowseTab.tsx
git commit -m "feat(plugins): add Browse tab component"
```

---

## Task 11: Marketplaces Tab Component

**Files:**
- Create: `src/components/plugins/MarketplacesTab.tsx`

- [ ] **Step 1: Create MarketplacesTab.tsx**

Create `src/components/plugins/MarketplacesTab.tsx`:

```typescript
import { useState, useCallback } from "react";
import type { Marketplace } from "../../types";

interface MarketplacesTabProps {
	marketplaces: Marketplace[];
	onAdd: (repo: string) => Promise<void>;
	onRemove: (name: string) => Promise<void>;
	onRefresh: (name: string) => Promise<void>;
	onRefreshAll: () => Promise<void>;
}

function MarketplacesTab({
	marketplaces,
	onAdd,
	onRemove,
	onRefresh,
	onRefreshAll,
}: MarketplacesTabProps) {
	const [addInput, setAddInput] = useState("");
	const [adding, setAdding] = useState(false);
	const [refreshing, setRefreshing] = useState<Set<string>>(new Set());
	const [refreshingAll, setRefreshingAll] = useState(false);

	const handleAdd = useCallback(async () => {
		if (!addInput.trim()) return;
		setAdding(true);
		try {
			await onAdd(addInput.trim());
			setAddInput("");
		} finally {
			setAdding(false);
		}
	}, [addInput, onAdd]);

	const handleRefresh = useCallback(
		async (name: string) => {
			setRefreshing((prev) => new Set(prev).add(name));
			try {
				await onRefresh(name);
			} finally {
				setRefreshing((prev) => {
					const next = new Set(prev);
					next.delete(name);
					return next;
				});
			}
		},
		[onRefresh],
	);

	const handleRefreshAll = useCallback(async () => {
		setRefreshingAll(true);
		try {
			await onRefreshAll();
		} finally {
			setRefreshingAll(false);
		}
	}, [onRefreshAll]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") handleAdd();
		},
		[handleAdd],
	);

	const formatLastUpdated = (ts: string | null): string => {
		if (!ts) return "Never";
		const date = new Date(ts);
		const diff = Date.now() - date.getTime();
		const hours = Math.floor(diff / 3_600_000);
		if (hours < 1) return "< 1h ago";
		if (hours < 24) return `${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `${days}d ago`;
	};

	return (
		<div className="plugins-tab-content">
			<div className="plugins-search-bar">
				<input
					type="text"
					className="plugins-search-input"
					placeholder="GitHub repo (e.g., org/marketplace-repo)..."
					value={addInput}
					onChange={(e) => setAddInput(e.target.value)}
					onKeyDown={handleKeyDown}
					disabled={adding}
				/>
				<button
					className="plugins-btn plugins-btn--install"
					onClick={handleAdd}
					disabled={adding || !addInput.trim()}
				>
					{adding ? "Adding..." : "+ Add"}
				</button>
			</div>
			<div className="plugins-list">
				{marketplaces.map((marketplace) => {
					const busy = refreshing.has(marketplace.name);
					const installedCount = marketplace.plugins.filter(
						(p) => p.installed,
					).length;
					return (
						<div
							key={marketplace.name}
							className="plugins-marketplace-card"
						>
							<div className="plugins-marketplace-card__header">
								<div className="plugins-marketplace-card__info">
									<div className="plugins-marketplace-card__name-row">
										<span className="plugins-marketplace-card__name">
											{marketplace.name}
										</span>
										<span className="plugins-marketplace-card__source">
											{marketplace.source_type}
										</span>
									</div>
									<div className="plugins-marketplace-card__repo">
										{marketplace.repo}
									</div>
								</div>
								<div className="plugins-marketplace-card__actions">
									<span className="plugins-marketplace-card__updated">
										Updated {formatLastUpdated(marketplace.last_updated)}
									</span>
									{busy ? (
										<div className="plugins-spinner-wrap">
											<div className="plugins-spinner" />
											<span className="plugins-spinner-text">
												Refreshing...
											</span>
										</div>
									) : (
										<>
											<button
												className="plugins-btn plugins-btn--secondary"
												onClick={() => handleRefresh(marketplace.name)}
											>
												Refresh
											</button>
											<button
												className="plugins-btn plugins-btn--danger"
												onClick={() => onRemove(marketplace.name)}
											>
												Remove
											</button>
										</>
									)}
								</div>
							</div>
							<div className="plugins-marketplace-card__stats">
								<span>{marketplace.plugins.length} plugins</span>
								<span>{installedCount} installed</span>
							</div>
						</div>
					);
				})}
			</div>
			<div className="plugins-footer">
				<span>
					{marketplaces.length} marketplace
					{marketplaces.length !== 1 ? "s" : ""} configured
				</span>
				<button
					className="plugins-btn-link"
					onClick={handleRefreshAll}
					disabled={refreshingAll}
				>
					{refreshingAll ? "Refreshing..." : "Refresh All"}
				</button>
			</div>
		</div>
	);
}

export default MarketplacesTab;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/plugins/MarketplacesTab.tsx
git commit -m "feat(plugins): add Marketplaces tab component"
```

---

## Task 12: Updates Tab Component

**Files:**
- Create: `src/components/plugins/UpdatesTab.tsx`

- [ ] **Step 1: Create UpdatesTab.tsx**

Create `src/components/plugins/UpdatesTab.tsx`:

```typescript
import { useCallback } from "react";
import type { UpdateCheckResult, BulkUpdateProgress } from "../../types";

interface UpdatesTabProps {
	updates: {
		result: UpdateCheckResult;
		loading: boolean;
		checkNow: () => Promise<void>;
	};
	operations: {
		inProgress: Set<string>;
		updatePlugin: (name: string, marketplace: string) => Promise<void>;
	};
	bulkUpdate: {
		progress: BulkUpdateProgress | null;
		running: boolean;
		updateAll: () => Promise<void>;
		reset: () => void;
	};
	onChanged: () => void;
}

function UpdatesTab({
	updates,
	operations,
	bulkUpdate,
	onChanged,
}: UpdatesTabProps) {
	const { result, loading } = updates;
	const { progress, running } = bulkUpdate;

	const handleUpdate = useCallback(
		async (name: string, marketplace: string) => {
			await operations.updatePlugin(name, marketplace);
			onChanged();
		},
		[operations, onChanged],
	);

	const handleUpdateAll = useCallback(async () => {
		await bulkUpdate.updateAll();
		onChanged();
	}, [bulkUpdate, onChanged]);

	const formatTime = (ts: string | null): string => {
		if (!ts) return "Never";
		const date = new Date(ts);
		const diff = Date.now() - date.getTime();
		const mins = Math.floor(diff / 60_000);
		if (mins < 1) return "Just now";
		if (mins < 60) return `${mins} min ago`;
		const hours = Math.floor(mins / 60);
		return `${hours}h ago`;
	};

	return (
		<div className="plugins-tab-content">
			<div className="plugins-updates-header">
				<div className="plugins-updates-header__info">
					<span className="plugins-updates-header__count">
						{result.plugin_updates.length} update
						{result.plugin_updates.length !== 1 ? "s" : ""} available
					</span>
					<span className="plugins-updates-header__time">
						Last checked {formatTime(result.last_checked)}
					</span>
				</div>
				<div className="plugins-updates-header__actions">
					<button
						className="plugins-btn plugins-btn--secondary"
						onClick={updates.checkNow}
						disabled={loading}
					>
						{loading ? "Checking..." : "Check Now"}
					</button>
					<button
						className="plugins-btn plugins-btn--install"
						onClick={handleUpdateAll}
						disabled={running || result.plugin_updates.length === 0}
					>
						{running ? "Updating..." : "Update All"}
					</button>
				</div>
			</div>

			{progress && running && (
				<div className="plugins-bulk-progress">
					<div className="plugins-bulk-progress__header">
						<span>Updating plugins...</span>
						<span className="plugins-bulk-progress__count">
							{progress.completed} / {progress.total}
						</span>
					</div>
					<div className="plugins-progress-bar">
						<div
							className="plugins-progress-bar__fill"
							style={{
								width: `${(progress.completed / progress.total) * 100}%`,
							}}
						/>
					</div>
					<div className="plugins-bulk-progress__items">
						{progress.results.map((item) => (
							<div
								key={item.name}
								className={`plugins-bulk-progress__item plugins-bulk-progress__item--${item.status}`}
							>
								{item.status === "success" ? "\u2713" : "\u2717"}{" "}
								{item.name}
								{item.error && (
									<span className="plugins-bulk-progress__error">
										{item.error}
									</span>
								)}
							</div>
						))}
						{progress.current_plugin && (
							<div className="plugins-bulk-progress__item plugins-bulk-progress__item--active">
								<div className="plugins-spinner plugins-spinner--small" />{" "}
								{progress.current_plugin}
							</div>
						)}
					</div>
				</div>
			)}

			<div className="plugins-list">
				{result.plugin_updates.length === 0 && !running && (
					<div className="plugins-empty">All plugins are up to date &#10003;</div>
				)}
				{result.plugin_updates.map((update) => {
					const busy =
						running || operations.inProgress.has(update.name);
					return (
						<div key={update.name} className="plugins-row">
							<div className="plugins-row__info">
								<div className="plugins-row__header">
									<span className="plugins-row__name">{update.name}</span>
									<span className="plugins-row__version">
										{update.current_version}
									</span>
									<span className="plugins-row__arrow">&rarr;</span>
									<span className="plugins-row__new-version">
										{update.available_version}
									</span>
								</div>
								<div className="plugins-row__meta">
									{update.marketplace}
								</div>
							</div>
							<div className="plugins-row__actions">
								{busy ? (
									<div className="plugins-spinner-wrap">
										<div className="plugins-spinner" />
										<span className="plugins-spinner-text">
											Updating...
										</span>
									</div>
								) : (
									<button
										className="plugins-btn plugins-btn--install"
										onClick={() =>
											handleUpdate(update.name, update.marketplace)
										}
									>
										Update
									</button>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export default UpdatesTab;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/plugins/UpdatesTab.tsx
git commit -m "feat(plugins): add Updates tab component"
```

---

## Task 13: Main Widget Integration — Plugins Button with Badge

**Files:**
- Modify: `src/components/TitleBar.tsx`

- [ ] **Step 1: Add plugins button to TitleBar**

In `src/components/TitleBar.tsx`:

1. Add a state for update count and a listener for the background checker event. Add these imports and state inside the `TitleBar` function:

```typescript
import { listen } from "@tauri-apps/api/event";
```

Add state:
```typescript
const [pluginUpdateCount, setPluginUpdateCount] = useState(0);
```

Add effect to listen for update events:
```typescript
useEffect(() => {
	const unlisten = listen<number>("plugin-updates-available", (event) => {
		setPluginUpdateCount(event.payload);
	});
	return () => {
		unlisten.then((fn) => fn());
	};
}, []);
```

2. Add the `handleOpenPlugins` callback (following the exact pattern of `handleOpenSessions` and `handleOpenLearning`):

```typescript
const handleOpenPlugins = useCallback(async () => {
	const existing = await WebviewWindow.getByLabel("plugins");
	if (existing) {
		await existing.show();
		await existing.setFocus();
		return;
	}
	new WebviewWindow("plugins", {
		url: "/?view=plugins",
		title: "Plugin Manager",
		width: 700,
		height: 550,
		minWidth: 500,
		minHeight: 400,
		decorations: false,
		transparent: true,
		resizable: true,
	});
}, []);
```

3. Add the plugins button in the JSX, after the search button (after the `&#8981;` button):

```tsx
<button
	className="view-tab view-tab--plugins"
	onClick={handleOpenPlugins}
	aria-label="Plugin Manager"
	title="Plugin Manager"
>
	&#9881;
	{pluginUpdateCount > 0 && (
		<span className="plugins-update-badge">{pluginUpdateCount}</span>
	)}
</button>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/TitleBar.tsx
git commit -m "feat(plugins): add plugin manager button with update badge to titlebar"
```

---

## Task 14: CSS Styles

**Files:**
- Create: `src/styles/plugins.css`
- Modify: `src/styles/index.css`

- [ ] **Step 1: Create plugins.css**

Create `src/styles/plugins.css` with the full plugin manager styles. Match the existing dark theme (background `#121216`, text `#d4d4d4`, accents from existing CSS). Follow BEM naming. Key elements:

- Window shell: `.plugins-window`, `.plugins-window-titlebar`, `.plugins-window-close`
- Tab bar: `.plugins-tab-bar`, `.plugins-tab-bar__tab`, `.plugins-tab-bar__tab--active`, `.plugins-tab-bar__badge`
- Content: `.plugins-body`, `.plugins-tab-content`, `.plugins-list`, `.plugins-footer`
- Search: `.plugins-search-bar`, `.plugins-search-input`, `.plugins-filter-select`
- Plugin rows: `.plugins-row`, `.plugins-row--disabled`, `.plugins-row--installed`, `.plugins-row__info`, `.plugins-row__header`, `.plugins-row__name`, `.plugins-row__version`, `.plugins-row__status`, `.plugins-row__description`, `.plugins-row__meta`, `.plugins-row__actions`, `.plugins-row__category`, `.plugins-row__installed-badge`, `.plugins-row__arrow`, `.plugins-row__new-version`
- Buttons: `.plugins-btn`, `.plugins-btn--secondary`, `.plugins-btn--danger`, `.plugins-btn--install`, `.plugins-btn--enable`, `.plugins-btn-link`
- Spinners: `.plugins-spinner`, `.plugins-spinner-wrap`, `.plugins-spinner-text`, `.plugins-spinner--small`
- Marketplace groups: `.plugins-marketplace-group`, `.plugins-marketplace-group__header`, `.plugins-marketplace-group__name`, `.plugins-marketplace-group__count`, `.plugins-marketplace-group__toggle`
- Marketplace cards: `.plugins-marketplace-card`, `.plugins-marketplace-card__header`, `.plugins-marketplace-card__info`, `.plugins-marketplace-card__name`, `.plugins-marketplace-card__source`, `.plugins-marketplace-card__repo`, `.plugins-marketplace-card__actions`, `.plugins-marketplace-card__updated`, `.plugins-marketplace-card__stats`
- Updates: `.plugins-updates-header`, `.plugins-updates-header__info`, `.plugins-updates-header__count`, `.plugins-updates-header__time`, `.plugins-updates-header__actions`
- Bulk progress: `.plugins-bulk-progress`, `.plugins-bulk-progress__header`, `.plugins-bulk-progress__count`, `.plugins-bulk-progress__items`, `.plugins-bulk-progress__item`, `.plugins-bulk-progress__item--success`, `.plugins-bulk-progress__item--error`, `.plugins-bulk-progress__item--active`, `.plugins-bulk-progress__error`
- Progress bar: `.plugins-progress-bar`, `.plugins-progress-bar__fill`
- States: `.plugins-loading`, `.plugins-empty`, `.plugins-installed-check`
- Badge: `.plugins-update-badge` (for TitleBar)

Reference the mockup designs from the brainstorming session for exact visual treatment. Match colors and spacing from `src/styles/learning.css` and `src/styles/sessions.css`.

`★ Implementation note:` The implementing agent should read `src/styles/learning.css` and `src/styles/sessions.css` first to copy the exact color values, border radii, font sizes, and spacing patterns used by the existing windows.

- [ ] **Step 2: Import plugins.css in index.css**

Add `@import "./plugins.css";` to `src/styles/index.css` alongside the existing imports.

- [ ] **Step 3: Add titlebar badge styles to index.css**

Add styles for the `.plugins-update-badge` class and `.view-tab--plugins` in `src/styles/index.css` near the existing `.view-tab--search` and `.view-tab--learning` styles.

- [ ] **Step 4: Verify it builds**

Run: `cd /home/mamba/work/quill && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/styles/plugins.css src/styles/index.css
git commit -m "feat(plugins): add CSS styles for plugin manager window"
```

---

## Task 15: Integration Verification

- [ ] **Step 1: Full build check**

Run: `cd /home/mamba/work/quill/src-tauri && cargo build`
Expected: Compiles with no errors

- [ ] **Step 2: Frontend build check**

Run: `cd /home/mamba/work/quill && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run dev mode and verify**

Run: `cd /home/mamba/work/quill && npm run tauri dev`
Expected: App launches, plugins button visible in titlebar, clicking opens Plugin Manager window with 4 working tabs

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(plugins): address integration issues from verification"
```
