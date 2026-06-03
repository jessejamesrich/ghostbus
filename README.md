# ghostbus

`ghostbus` is a small tmux-backed bus for visible local coding agents.

This repo is the first extraction of the working local prototype. It is intentionally still
small and a little rigid: the current CLI still creates a four-pane tmux session. The next
step is to replace those defaults with a profile config.

Local config and role prompts should stay untracked. Use [config.example.toml](./config.example.toml)
and the `prompts/*.example.txt` files as templates.

## What Works

- `ghostbus` starts and manages a visible tmux workspace.
- `ghostbus-mcp` exposes MCP tools that let agents list panes, read pane output, and send
  requests to each other.
- Sends use unique tmux buffers, exit copy mode before paste, and submit with `Enter` or
  queue with `Tab` when Codex appears busy.

## Try It Locally

From the repo where you want the panes to open:

```bash
GHOSTBUS_WORKDIR="$PWD" /path/to/ghostbus/bin/ghostbus start
```

In another shell:

```bash
/path/to/ghostbus/bin/ghostbus status
/path/to/ghostbus/bin/ghostbus doctor
```

Run the MCP server directly:

```bash
node /path/to/ghostbus/src/server.cjs --selftest
```

## Codex MCP Config

For this extracted repo, the MCP command is:

```toml
[mcp_servers.ghostbus]
command = "node"
args = ["/path/to/ghostbus/src/server.cjs"]
```

Restart existing agent processes after changing MCP config.

## Current Tools

```text
list_agents()
read_pane(session_id, max_bytes?, lines?)
message_agent(session_id, text, submit?)
ask_agent(session_id, text, reply_to?, from?, submit?)
ask_agents(session_ids, text, reply_to?, from?, submit?)
wait_for_reply(request_id, session_id?, reply_to?, timeout_ms?)
broadcast_agents(session_ids, text, submit?)
```

## Next Shape

The public version should make the panes configurable:

```toml
default_profile = "example"

[profiles.example]
session = "ghostbus"
workdir = "."

[[profiles.example.panes]]
name = "dev"
command = "$SHELL"

[[profiles.example.panes]]
name = "reviewer"
command = "codex"
prompt = "prompts/reviewer.example.txt"
```

Until then, this repo is a clean place to evolve the prototype.
