#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { getAppDataDir, getConfigDir } = require("./paths.cjs");

const PLUGIN_VERSION = "1.11.0";
const VERSION_MARKER = `<!-- quill-v${PLUGIN_VERSION} -->`;

function main() {
	try {
		const raw = fs.readFileSync(0, "utf8");
		// Parse hook input (SessionStart command hook)
		JSON.parse(raw);

		const home = process.env.HOME || process.env.USERPROFILE;
		const configDir = getConfigDir();
		const configPath = path.join(configDir, "config.json");
		const authSecretPath = path.join(getAppDataDir(), "auth_secret");
		const claudeMdPath = path.join(home, ".claude", "CLAUDE.md");
		const flagPath = path.join(configDir, ".claudemd-update-needed");

		const hasLocalWidget = fs.existsSync(authSecretPath);
		const hasConfig = fs.existsSync(configPath);

		// --- Config setup ---
		if (hasLocalWidget) {
			const secret = fs.readFileSync(authSecretPath, "utf8").trim();
			if (!secret) return; // Empty secret file — widget not fully initialized

			const defaults = {
				url: "http://localhost:19876",
				hostname: os.hostname(),
			};

			fs.mkdirSync(configDir, { recursive: true });

			if (!hasConfig) {
				// No config exists: create fresh
				const config = Object.assign({}, defaults, { secret: secret });
				fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
			} else {
				// Config exists: check if it's a localhost config
				const existing = JSON.parse(fs.readFileSync(configPath, "utf8"));
				const url = existing.url || "";
				const isLocal = url.includes("localhost") || url.includes("127.0.0.1");

				if (isLocal) {
					// Merge: defaults seed missing fields, existing preserves overrides, secret refreshed
					const updated = Object.assign({}, defaults, existing, { secret: secret });
					fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n");
				}
				// Non-localhost (remote): do not touch
			}
		}
		// No local widget AND no config: exit silently (handled by falling through)

		// --- CLAUDE.md version check ---
		fs.mkdirSync(configDir, { recursive: true });

		let claudeMdContent = "";
		try {
			claudeMdContent = fs.readFileSync(claudeMdPath, "utf8");
		} catch (_) {
			// CLAUDE.md doesn't exist — needs update
			fs.writeFileSync(flagPath, PLUGIN_VERSION);
			return;
		}

		if (claudeMdContent.includes(VERSION_MARKER)) {
			// Version matches — remove stale flag if present
			try {
				fs.unlinkSync(flagPath);
			} catch (_) {
				// Flag didn't exist, that's fine
			}
		} else {
			// Missing or outdated version marker
			fs.writeFileSync(flagPath, PLUGIN_VERSION);
		}
	} catch (err) {
		if (process.env.QUILL_DEBUG) console.error("auto-setup: error:", err.message);
	}
}

main();
