---
name: setup
description: Configure the Claude Usage widget connection. Run this after installing the plugin to set the widget IP address.
---

You are configuring the Claude Usage widget hook. This hook reports token usage from each Claude Code turn to the Claude Usage desktop widget over HTTP.

Follow these steps exactly:

1. Use AskUserQuestion to ask the user for the widget address:
   - Question: "Where is the Claude Usage widget running?"
   - Options:
     - "This machine" — description: "The widget app is running on this same machine (localhost)"
     - "Another machine on my network" — description: "The widget is running on a different machine — you'll provide the IP address"

2. If they choose "This machine", set the URL to `http://localhost:19876`.

3. If they choose "Another machine on my network", use AskUserQuestion to ask:
   - "What is the IP address (or hostname) of the machine running the widget?"
   - This should be a free-text response (provide reasonable example options like "192.168.1.100" with descriptions, but they'll likely type their own)
   - Construct the URL as `http://<their-input>:19876`

4. Then ask for an optional hostname label:
   - "What name should this machine report as in the widget?"
   - Options:
     - Use the system hostname (run `hostname -s` via Bash to get it and show it as the option label)
     - "Custom name" — description: "Choose a custom label for this machine"

5. Write the config file to `~/.config/claude-usage/config.json` with this structure:
   ```json
   {
     "url": "http://<address>:19876",
     "hostname": "<hostname>"
   }
   ```
   Create the `~/.config/claude-usage/` directory if it doesn't exist.

6. Verify connectivity by running: `curl -s -m 3 <url>/api/v1/health`
   - If it returns "ok", tell the user setup is complete and the hook will now report token usage after each turn.
   - If it fails, warn the user that the widget doesn't seem reachable at that address, but the config has been saved and will work once the widget is running. They can re-run `/claude-usage-hook:setup` anytime to change it.
