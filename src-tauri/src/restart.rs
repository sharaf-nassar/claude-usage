use nix::sys::signal::{kill, Signal};
use nix::unistd::Pid;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::Emitter;

// ── State file deserialization (from hook script JSON) ──

#[derive(Deserialize, Clone, Debug)]
pub struct StateFileEntry {
	pub pid: u32,
	pub session_id: String,
	pub cwd: String,
	pub tty: String,
	pub status: String,
	pub timestamp: String,
}

// ── Types sent to frontend via Tauri commands ──

#[derive(Serialize, Clone, Debug)]
pub struct ClaudeInstance {
	pub pid: u32,
	pub session_id: Option<String>,
	pub cwd: String,
	pub tty: String,
	pub terminal_type: TerminalType,
	pub status: InstanceStatus,
	pub last_seen: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum TerminalType {
	Tmux { target: String },
	Plain,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub enum InstanceStatus {
	Idle,
	Processing,
	Unknown,
	Restarting,
	Exited,
	RestartFailed { error: String },
}

#[derive(Serialize, Clone, Debug)]
pub struct RestartStatus {
	pub phase: RestartPhase,
	pub instances: Vec<ClaudeInstance>,
	pub waiting_on: usize,
	pub elapsed_seconds: u64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub enum RestartPhase {
	Idle,
	WaitingForIdle,
	Restarting,
	Complete,
	Cancelled,
	TimedOut,
}

// ── Managed state for the orchestrator ──

pub struct RestartState {
	pub running: AtomicBool,
	pub phase: parking_lot::Mutex<RestartPhase>,
	pub instances: parking_lot::Mutex<Vec<ClaudeInstance>>,
	pub started_at: parking_lot::Mutex<Option<std::time::Instant>>,
}

impl RestartState {
	pub fn new() -> Self {
		Self {
			running: AtomicBool::new(false),
			phase: parking_lot::Mutex::new(RestartPhase::Idle),
			instances: parking_lot::Mutex::new(Vec::new()),
			started_at: parking_lot::Mutex::new(None),
		}
	}
}

// ── Path helpers ──

/// Returns the state directory: $XDG_CACHE_HOME/quill/claude-state/ (or ~/.cache/quill/claude-state/)
pub fn state_dir() -> PathBuf {
	dirs::cache_dir()
		.unwrap_or_else(|| {
			dirs::home_dir()
				.map(|h| h.join(".cache"))
				.unwrap_or_else(|| PathBuf::from("/tmp"))
		})
		.join("quill")
		.join("claude-state")
}

/// Returns the restart flag file path
pub fn restart_flag_path() -> PathBuf {
	dirs::cache_dir()
		.unwrap_or_else(|| {
			dirs::home_dir()
				.map(|h| h.join(".cache"))
				.unwrap_or_else(|| PathBuf::from("/tmp"))
		})
		.join("quill")
		.join("claude-restart-requested")
}

/// Returns the hook script install path
pub fn hook_script_path() -> PathBuf {
	dirs::cache_dir()
		.unwrap_or_else(|| {
			dirs::home_dir()
				.map(|h| h.join(".cache"))
				.unwrap_or_else(|| PathBuf::from("/tmp"))
		})
		.join("quill")
		.join("claude-restart-hook.sh")
}

fn map_status(s: &str) -> InstanceStatus {
	match s {
		"idle" => InstanceStatus::Idle,
		"processing" => InstanceStatus::Processing,
		"exited" => InstanceStatus::Exited,
		_ => InstanceStatus::Unknown,
	}
}

// ── State file reading ──

/// Read all state files and return valid entries, cleaning up stale ones.
pub fn read_state_files() -> Vec<(StateFileEntry, PathBuf)> {
	let dir = state_dir();
	let entries = match fs::read_dir(&dir) {
		Ok(e) => e,
		Err(_) => return Vec::new(),
	};

	let mut results = Vec::new();
	let now = chrono::Utc::now();

	for entry in entries.flatten() {
		let path = entry.path();
		if path.extension().is_some_and(|e| e == "json")
			&& !path.to_string_lossy().ends_with(".tmp")
		{
			let content = match fs::read_to_string(&path) {
				Ok(c) => c,
				Err(_) => {
					let _ = fs::remove_file(&path);
					continue;
				}
			};
			let state: StateFileEntry = match serde_json::from_str(&content) {
				Ok(s) => s,
				Err(_) => {
					let _ = fs::remove_file(&path);
					continue;
				}
			};

			// Check if process is alive
			let proc_path = PathBuf::from(format!("/proc/{}", state.pid));
			if !proc_path.exists() {
				let _ = fs::remove_file(&path);
				continue;
			}

			// Clean up exited state files older than 60 seconds
			if state.status == "exited" {
				if let Ok(ts) = chrono::DateTime::parse_from_rfc3339(&state.timestamp) {
					if now.signed_duration_since(ts).num_seconds() > 60 {
						let _ = fs::remove_file(&path);
						continue;
					}
				}
			}

			results.push((state, path));
		}
	}

	results
}

/// Scan /proc for Claude Code processes not already tracked by state files.
/// Returns (pid, cwd, tty) tuples.
pub fn scan_proc_for_claude(known_pids: &[u32]) -> Vec<(u32, String, String)> {
	let mut found = Vec::new();
	let proc_dir = match fs::read_dir("/proc") {
		Ok(d) => d,
		Err(_) => return found,
	};

	for entry in proc_dir.flatten() {
		let pid: u32 = match entry.file_name().to_string_lossy().parse() {
			Ok(p) => p,
			Err(_) => continue,
		};

		if known_pids.contains(&pid) {
			continue;
		}

		// Read cmdline to check if this is a Claude process
		let cmdline_path = format!("/proc/{pid}/cmdline");
		let cmdline = match fs::read_to_string(&cmdline_path) {
			Ok(c) => c,
			Err(_) => continue,
		};

		let is_claude = cmdline.split('\0').any(|arg| {
			arg.ends_with("/claude") || arg == "claude"
		}) || cmdline.contains("@anthropic-ai/claude-code");

		if !is_claude {
			continue;
		}

		let cwd = fs::read_link(format!("/proc/{pid}/cwd"))
			.map(|p| p.to_string_lossy().to_string())
			.unwrap_or_else(|_| "unknown".to_string());

		let tty = fs::read_link(format!("/proc/{pid}/fd/0"))
			.map(|p| p.to_string_lossy().to_string())
			.unwrap_or_else(|_| "unknown".to_string());

		found.push((pid, cwd, tty));
	}

	found
}

/// Query tmux for all pane TTYs and their targets.
/// Returns a map of TTY path -> tmux target string (e.g., "main:0.1").
pub fn detect_tmux_panes() -> HashMap<String, String> {
	let output = Command::new("tmux")
		.args(["list-panes", "-a", "-F", "#{pane_tty} #{session_name}:#{window_index}.#{pane_index}"])
		.output();

	let mut map = HashMap::new();
	if let Ok(out) = output {
		if out.status.success() {
			let stdout = String::from_utf8_lossy(&out.stdout);
			for line in stdout.lines() {
				if let Some((tty, target)) = line.split_once(' ') {
					map.insert(tty.to_string(), target.to_string());
				}
			}
		}
	}
	map
}

/// Discover all running Claude Code instances from state files and /proc scan.
pub fn discover_instances() -> Vec<ClaudeInstance> {
	let state_entries = read_state_files();
	let known_pids: Vec<u32> = state_entries.iter().map(|(s, _)| s.pid).collect();
	let extra_procs = scan_proc_for_claude(&known_pids);
	let tmux_panes = detect_tmux_panes();

	let mut instances: Vec<ClaudeInstance> = state_entries
		.into_iter()
		.map(|(entry, _path)| {
			let terminal_type = match tmux_panes.get(&entry.tty) {
				Some(target) => TerminalType::Tmux { target: target.clone() },
				None => TerminalType::Plain,
			};
			ClaudeInstance {
				pid: entry.pid,
				session_id: if entry.session_id.is_empty() { None } else { Some(entry.session_id) },
				cwd: entry.cwd,
				tty: entry.tty,
				terminal_type,
				status: map_status(&entry.status),
				last_seen: entry.timestamp,
			}
		})
		.collect();

	// Add instances found via /proc scan that don't have state files
	for (pid, cwd, tty) in extra_procs {
		let terminal_type = match tmux_panes.get(&tty) {
			Some(target) => TerminalType::Tmux { target: target.clone() },
			None => TerminalType::Plain,
		};
		instances.push(ClaudeInstance {
			pid,
			session_id: None,
			cwd,
			tty,
			terminal_type,
			status: InstanceStatus::Unknown,
			last_seen: String::new(),
		});
	}

	instances
}

// ── Hook script installation ──

const HOOK_SCRIPT: &str = r##"#!/usr/bin/env bash
# Quill state-tracking hook for Claude Code
# This script ONLY writes state files. Restart orchestration is handled by
# the Quill Rust backend.

STATE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/quill/claude-state"
mkdir -p "$STATE_DIR"

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null)
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Find the actual Claude process PID.
# $PPID is the bash shell that runs this hook, so we need its parent (Claude).
HOOK_SHELL_PID=$PPID
CLAUDE_PID=$(awk '/^PPid:/ {print $2}' "/proc/$HOOK_SHELL_PID/status" 2>/dev/null)
if [ -z "$CLAUDE_PID" ] || [ "$CLAUDE_PID" = "1" ]; then
	CLAUDE_PID=$HOOK_SHELL_PID
fi

TTY_PATH=$(readlink "/proc/$CLAUDE_PID/fd/0" 2>/dev/null || echo "unknown")
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

write_state() {
	local status="$1"
	local tmp="$STATE_DIR/$CLAUDE_PID.json.tmp"
	if command -v jq >/dev/null 2>&1; then
		jq -n --argjson pid "$CLAUDE_PID" \
			--arg sid "$SESSION_ID" \
			--arg cwd "$CWD" \
			--arg tty "$TTY_PATH" \
			--arg status "$status" \
			--arg ts "$TIMESTAMP" \
			'{pid: $pid, session_id: $sid, cwd: $cwd, tty: $tty, status: $status, timestamp: $ts}' \
			> "$tmp"
	else
		printf '{"pid":%d,"session_id":"%s","cwd":"%s","tty":"%s","status":"%s","timestamp":"%s"}\n' \
			"$CLAUDE_PID" "$SESSION_ID" "$CWD" "$TTY_PATH" "$status" "$TIMESTAMP" > "$tmp"
	fi
	mv -f "$tmp" "$STATE_DIR/$CLAUDE_PID.json"
}

case "$EVENT" in
	UserPromptSubmit|PreToolUse)
		write_state "processing"
		;;

	Stop)
		write_state "idle"
		;;

	SessionEnd)
		write_state "exited"
		;;

	*)
		;;
esac

echo '{}'
exit 0
"##;

const HOOK_MARKER: &str = "claude-restart-hook.sh";

/// Install the hook script to the cache directory.
pub fn install_hook_script() -> Result<(), String> {
	let path = hook_script_path();
	if let Some(parent) = path.parent() {
		fs::create_dir_all(parent).map_err(|e| format!("Failed to create hook dir: {e}"))?;
	}
	fs::write(&path, HOOK_SCRIPT).map_err(|e| format!("Failed to write hook script: {e}"))?;

	// Make executable
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		let perms = fs::Permissions::from_mode(0o755);
		fs::set_permissions(&path, perms)
			.map_err(|e| format!("Failed to set hook permissions: {e}"))?;
	}

	Ok(())
}

/// Merge Quill hook entries into ~/.claude/settings.json without overwriting existing hooks.
pub fn merge_hooks_into_settings() -> Result<(), String> {
	let settings_path = dirs::home_dir()
		.ok_or("Cannot determine home directory")?
		.join(".claude")
		.join("settings.json");

	let mut settings: serde_json::Value = if settings_path.exists() {
		let content = fs::read_to_string(&settings_path)
			.map_err(|e| format!("Failed to read settings.json: {e}"))?;
		match serde_json::from_str(&content) {
			Ok(v) => v,
			Err(_) => {
				// Back up malformed file
				let backup = settings_path.with_extension("json.bak");
				let _ = fs::copy(&settings_path, &backup);
				serde_json::json!({})
			}
		}
	} else {
		if let Some(parent) = settings_path.parent() {
			let _ = fs::create_dir_all(parent);
		}
		serde_json::json!({})
	};

	let hooks = settings
		.as_object_mut()
		.ok_or("settings.json root is not an object")?
		.entry("hooks")
		.or_insert_with(|| serde_json::json!({}));

	let hook_script = hook_script_path();
	let command = format!("bash {}", hook_script.to_string_lossy());

	let hook_entry = serde_json::json!({
		"hooks": [{"type": "command", "command": command}]
	});

	let events = ["UserPromptSubmit", "PreToolUse", "Stop", "SessionEnd"];

	let hooks_obj = hooks
		.as_object_mut()
		.ok_or("hooks field is not an object")?;

	for event in &events {
		let arr = hooks_obj
			.entry(*event)
			.or_insert_with(|| serde_json::json!([]));

		let arr = arr.as_array_mut().ok_or(format!("{event} is not an array"))?;

		// Check if our hook already exists
		let already_exists = arr.iter().any(|entry| {
			entry.to_string().contains(HOOK_MARKER)
		});

		if !already_exists {
			arr.push(hook_entry.clone());
		}
	}

	let content = serde_json::to_string_pretty(&settings)
		.map_err(|e| format!("Failed to serialize settings: {e}"))?;
	fs::write(&settings_path, content)
		.map_err(|e| format!("Failed to write settings.json: {e}"))?;

	Ok(())
}

/// Check if Quill restart hooks are installed in ~/.claude/settings.json.
pub fn hooks_installed() -> bool {
	let settings_path = match dirs::home_dir() {
		Some(h) => h.join(".claude").join("settings.json"),
		None => return false,
	};

	let content = match fs::read_to_string(&settings_path) {
		Ok(c) => c,
		Err(_) => return false,
	};

	let settings: serde_json::Value = match serde_json::from_str(&content) {
		Ok(v) => v,
		Err(_) => return false,
	};

	let events = ["UserPromptSubmit", "PreToolUse", "Stop", "SessionEnd"];
	events.iter().all(|event| {
		settings
			.get("hooks")
			.and_then(|h| h.get(event))
			.and_then(|a| a.as_array())
			.is_some_and(|arr| arr.iter().any(|e| e.to_string().contains(HOOK_MARKER)))
	})
}

// ── Orchestration ──

/// Clean up stale restart flag and orphaned state files on Quill startup.
pub fn startup_cleanup() {
	// Remove stale restart flag
	let flag = restart_flag_path();
	if flag.exists() {
		log::info!("Removing stale restart flag from previous session");
		let _ = fs::remove_file(&flag);
	}

	// Remove orphaned state files
	let dir = state_dir();
	if let Ok(entries) = fs::read_dir(&dir) {
		for entry in entries.flatten() {
			let path = entry.path();
			if path.extension().is_some_and(|e| e == "json")
				&& !path.to_string_lossy().ends_with(".tmp")
			{
				if let Ok(content) = fs::read_to_string(&path) {
					if let Ok(state) = serde_json::from_str::<StateFileEntry>(&content) {
						if !PathBuf::from(format!("/proc/{}", state.pid)).exists() {
							log::info!("Cleaning up orphaned state file for PID {}", state.pid);
							let _ = fs::remove_file(&path);
						}
					}
				}
			}
		}
	}
}

/// Inject restart command into a tmux pane via send-keys.
fn restart_via_tmux(target: &str, session_id: &str) -> Result<(), String> {
	let cmd = format!("claude --resume \"{session_id}\"");
	let output = Command::new("tmux")
		.args(["send-keys", "-t", target, &cmd, "Enter"])
		.output()
		.map_err(|e| format!("Failed to run tmux send-keys: {e}"))?;

	if !output.status.success() {
		let stderr = String::from_utf8_lossy(&output.stderr);
		return Err(format!("tmux send-keys failed: {stderr}"));
	}
	Ok(())
}

/// Inject restart command into a plain terminal via PTY device write.
fn restart_via_pty(tty_path: &str, session_id: &str) -> Result<(), String> {
	let cmd = format!("claude --resume \"{session_id}\"\r");
	let mut file = fs::OpenOptions::new()
		.write(true)
		.open(tty_path)
		.map_err(|e| format!("Failed to open PTY {tty_path}: {e}"))?;

	file.write_all(cmd.as_bytes())
		.map_err(|e| format!("Failed to write to PTY {tty_path}: {e}"))?;

	Ok(())
}

const TIMEOUT_SECS: u64 = 300; // 5 minutes

/// Spawn the background orchestrator task.
/// `force`: if true, skip waiting for idle and SIGTERM immediately.
pub fn spawn_orchestrator(
	state: Arc<RestartState>,
	app: tauri::AppHandle,
	force: bool,
) {
	tauri::async_runtime::spawn(async move {
		let start = std::time::Instant::now();
		*state.started_at.lock() = Some(start);
		*state.phase.lock() = RestartPhase::WaitingForIdle;

		// Phase 1: Wait for all instances to become idle (skip if force)
		if !force {
			loop {
				// Check if cancelled
				if !restart_flag_path().exists() {
					*state.phase.lock() = RestartPhase::Cancelled;
					state.running.store(false, Ordering::SeqCst);
					let _ = app.emit("restart-status-changed", ());
					return;
				}

				// Check timeout
				if start.elapsed().as_secs() >= TIMEOUT_SECS {
					*state.phase.lock() = RestartPhase::TimedOut;
					state.running.store(false, Ordering::SeqCst);
					let _ = app.emit("restart-status-changed", ());
					return;
				}

				let instances = discover_instances();
				let waiting = instances
					.iter()
					.filter(|i| i.status == InstanceStatus::Processing || i.status == InstanceStatus::Unknown)
					.count();

				*state.instances.lock() = instances;

				if waiting == 0 {
					break;
				}

				let _ = app.emit("restart-status-changed", ());
				tokio::time::sleep(Duration::from_secs(1)).await;
			}
		}

		// Phase 2: Kill all instances
		*state.phase.lock() = RestartPhase::Restarting;
		let instances = discover_instances();

		let mut restart_targets: Vec<(ClaudeInstance, bool)> = Vec::new();

		for instance in &instances {
			if instance.status == InstanceStatus::Exited {
				continue; // Already exited, skip
			}

			let pid = Pid::from_raw(instance.pid as i32);
			match kill(pid, Signal::SIGTERM) {
				Ok(()) => {
					log::info!("Sent SIGTERM to Claude PID {}", instance.pid);
					restart_targets.push((instance.clone(), true));
				}
				Err(e) => {
					log::error!("Failed to SIGTERM PID {}: {e}", instance.pid);
					restart_targets.push((instance.clone(), false));
				}
			}
		}

		// Wait for processes to exit (up to 5 seconds)
		for _ in 0..10 {
			let all_dead = restart_targets.iter().all(|(inst, _)| {
				!PathBuf::from(format!("/proc/{}", inst.pid)).exists()
			});
			if all_dead {
				break;
			}
			tokio::time::sleep(Duration::from_millis(500)).await;
		}

		// Brief delay for shell to re-render prompt
		tokio::time::sleep(Duration::from_millis(500)).await;

		// Phase 3: Inject restart commands
		let mut final_instances: Vec<ClaudeInstance> = Vec::new();

		for (mut instance, kill_ok) in restart_targets {
			if !kill_ok {
				instance.status = InstanceStatus::RestartFailed {
					error: "Failed to send SIGTERM".to_string(),
				};
				final_instances.push(instance);
				continue;
			}

			let session_id = match &instance.session_id {
				Some(id) if !id.is_empty() => id.clone(),
				_ => {
					instance.status = InstanceStatus::RestartFailed {
						error: "No session ID available".to_string(),
					};
					final_instances.push(instance);
					continue;
				}
			};

			let result = match &instance.terminal_type {
				TerminalType::Tmux { target } => restart_via_tmux(target, &session_id),
				TerminalType::Plain => restart_via_pty(&instance.tty, &session_id),
			};

			match result {
				Ok(()) => {
					instance.status = InstanceStatus::Restarting;
				}
				Err(e) => {
					log::error!("Restart injection failed for PID {}: {e}", instance.pid);
					instance.status = InstanceStatus::RestartFailed { error: e };
				}
			}
			final_instances.push(instance);
		}

		*state.instances.lock() = final_instances;
		*state.phase.lock() = RestartPhase::Complete;
		state.running.store(false, Ordering::SeqCst);

		// Clean up restart flag
		let _ = fs::remove_file(restart_flag_path());

		let _ = app.emit("restart-status-changed", ());
	});
}

// ── Tauri Commands ──

#[tauri::command]
pub async fn discover_claude_instances() -> Vec<ClaudeInstance> {
	tokio::task::block_in_place(discover_instances)
}

#[tauri::command]
pub async fn request_restart(
	force: bool,
	app: tauri::AppHandle,
	state: tauri::State<'_, Arc<RestartState>>,
) -> Result<(), String> {
	if state.running.load(Ordering::SeqCst) {
		return Ok(()); // Already running
	}

	// Write restart flag
	let flag = restart_flag_path();
	if let Some(parent) = flag.parent() {
		fs::create_dir_all(parent)
			.map_err(|e| format!("Failed to create flag directory: {e}"))?;
	}
	fs::write(&flag, "").map_err(|e| format!("Failed to write restart flag: {e}"))?;

	state.running.store(true, Ordering::SeqCst);
	spawn_orchestrator(Arc::clone(&state), app, force);
	Ok(())
}

#[tauri::command]
pub async fn cancel_restart(
	state: tauri::State<'_, Arc<RestartState>>,
) -> Result<(), String> {
	let flag = restart_flag_path();
	let _ = fs::remove_file(&flag);
	// Reset phase to Idle so the UI is immediately usable again
	*state.phase.lock() = RestartPhase::Idle;
	*state.started_at.lock() = None;
	Ok(())
}

#[tauri::command]
pub async fn get_restart_status(
	state: tauri::State<'_, Arc<RestartState>>,
) -> Result<RestartStatus, String> {
	let phase = state.phase.lock().clone();
	let instances = if state.running.load(Ordering::SeqCst) || phase == RestartPhase::Complete {
		state.instances.lock().clone()
	} else {
		tokio::task::block_in_place(discover_instances)
	};

	let waiting_on = instances
		.iter()
		.filter(|i| i.status == InstanceStatus::Processing || i.status == InstanceStatus::Unknown)
		.count();

	let elapsed_seconds = state
		.started_at
		.lock()
		.map(|s| s.elapsed().as_secs())
		.unwrap_or(0);

	Ok(RestartStatus {
		phase,
		instances,
		waiting_on,
		elapsed_seconds,
	})
}

#[tauri::command]
pub async fn install_restart_hooks() -> Result<(), String> {
	install_hook_script()?;
	merge_hooks_into_settings()
}

#[tauri::command]
pub async fn check_restart_hooks_installed() -> bool {
	hooks_installed()
}
