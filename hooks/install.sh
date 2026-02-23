#!/usr/bin/env bash
# Install the Claude Usage widget hook into Claude Code.
#
# Preferred: Use the plugin instead:
#   /plugin marketplace add sharaf-nassar/claude-usage
#   /plugin install claude-usage-hook@sharaf-nassar/claude-usage
#   /claude-usage-hook:setup
#
# Manual install (this script):
#   curl -fsSL https://raw.githubusercontent.com/sharaf-nassar/claude-usage/main/hooks/install.sh | bash
#
# With options:
#   ... | bash -s -- --url http://<widget-ip>:19876 --hostname my-server --secret <bearer-secret>

set -euo pipefail

HOOK_URL="https://raw.githubusercontent.com/sharaf-nassar/claude-usage/main/hooks/claude-usage-hook.sh"
INSTALL_DIR="${HOME}/.claude/hooks"
HOOK_PATH="${INSTALL_DIR}/claude-usage-hook.sh"
SETTINGS_FILE="${HOME}/.claude/settings.json"
CONFIG_DIR="${HOME}/.config/claude-usage"
CONFIG_FILE="${CONFIG_DIR}/config.json"
USAGE_URL=""
HOSTNAME_LABEL=""
SECRET=""
SECRET_FILE="${HOME}/.local/share/com.claude.usage-widget/auth_secret"

while [[ $# -gt 0 ]]; do
    case $1 in
        --url) USAGE_URL="$2"; shift 2 ;;
        --hostname) HOSTNAME_LABEL="$2"; shift 2 ;;
        --secret) SECRET="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Auto-detect secret for localhost URLs if not explicitly provided
if [ -z "$SECRET" ]; then
    RESOLVED_URL="${USAGE_URL:-http://localhost:19876}"
    if echo "$RESOLVED_URL" | grep -qE '(localhost|127\.0\.0\.1)'; then
        if [ -f "$SECRET_FILE" ]; then
            SECRET=$(cat "$SECRET_FILE" 2>/dev/null || true)
            if [ -n "$SECRET" ]; then
                echo "  Auto-detected auth secret from local widget installation"
            fi
        fi
    fi
fi

echo "Installing Claude Usage hook..."

# Download hook script
mkdir -p "$INSTALL_DIR"
curl -fsSL "$HOOK_URL" -o "$HOOK_PATH"
chmod +x "$HOOK_PATH"
echo "  Downloaded hook to $HOOK_PATH"

# Write config file
mkdir -p "$CONFIG_DIR"
python3 - "$CONFIG_FILE" "${USAGE_URL:-http://localhost:19876}" "${HOSTNAME_LABEL:-$(hostname -s 2>/dev/null || echo local)}" "$SECRET" <<'PYEOF'
import json, sys

config_path = sys.argv[1]
url = sys.argv[2]
hostname = sys.argv[3]
secret = sys.argv[4]

config = {"url": url, "hostname": hostname}
if secret:
    config["secret"] = secret

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")

print(f"  Config written to {config_path}")
print(f"    url: {url}")
print(f"    hostname: {hostname}")
if secret:
    print(f"    secret: {'*' * 8}...{secret[-4:]}")
else:
    print("    secret: (none — requests will be unauthenticated)")
PYEOF

# Merge hook into settings.json
python3 - "$SETTINGS_FILE" "$HOOK_PATH" <<'PYEOF'
import json, sys, os

settings_path = sys.argv[1]
hook_cmd = sys.argv[2]

if os.path.exists(settings_path):
    with open(settings_path) as f:
        settings = json.load(f)
else:
    os.makedirs(os.path.dirname(settings_path), exist_ok=True)
    settings = {}

hooks = settings.setdefault("hooks", {})
stop_hooks = hooks.setdefault("Stop", [])

already_installed = any(
    any("claude-usage-hook" in h.get("command", "") for h in entry.get("hooks", []))
    for entry in stop_hooks
)

if already_installed:
    for entry in stop_hooks:
        for h in entry.get("hooks", []):
            if "claude-usage-hook" in h.get("command", ""):
                h["command"] = hook_cmd
    print("  Updated existing hook in settings.json")
else:
    stop_hooks.append({
        "matcher": "",
        "hooks": [{"type": "command", "command": hook_cmd}]
    })
    print("  Added hook to settings.json")

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")
PYEOF

echo ""
echo "Done! The hook will report token usage after each Claude Code turn."
echo ""
echo "To verify: curl ${USAGE_URL:-http://localhost:19876}/api/v1/health"
echo "To reconfigure: re-run this script with --url and --hostname"
echo "To uninstall: rm $HOOK_PATH $CONFIG_FILE && edit $SETTINGS_FILE"
