#!/usr/bin/env node
"use strict";

const path = require("path");

const APP_ID = "com.quilltoolkit.app";

/**
 * Platform-aware Quill app data directory.
 * Mirrors the Rust backend's use of dirs::data_local_dir().
 *
 * Linux:  ~/.local/share/com.quilltoolkit.app
 * macOS:  ~/Library/Application Support/com.quilltoolkit.app
 */
function getAppDataDir() {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (process.platform === "darwin") {
		return path.join(home, "Library", "Application Support", APP_ID);
	}
	return path.join(home, ".local", "share", APP_ID);
}

/**
 * Plugin config directory (platform-agnostic, our own convention).
 */
function getConfigDir() {
	const home = process.env.HOME || process.env.USERPROFILE;
	return path.join(home, ".config", "quill");
}

module.exports = { APP_ID, getAppDataDir, getConfigDir };
