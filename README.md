# ghostbus

`ghostbus` is a small tmux-backed bus for visible local coding agents.

This repo is the first extraction of the working local prototype. It is intentionally still
small and a little rigid: the default workspace is a four-pane tmux session with `dev`,
`orange`, `cicd`, and `bohr` panes. The next step is to replace those defaults with a profile
config.

## What Works

- `ghostbus` starts and manages a visible tmux workspace.
- `ghostbus-mcp` exposes MCP tools that let agents list panes, read pane output, and send
  requests to each other.
- Sends use unique tmux buffers, exit copy mode before paste, and submit with `Enter` or
  queue with `Tab` when Codex appears busy.

## Try It Locally

From the repo where you want the panes to open:

```bash
GHOSTBUS_WORKDIR="$PWD" ~/Code/jesse/ghostbus/bin/ghostbus start
```

In another shell:

```bash
~/Code/jesse/ghostbus/bin/ghostbus status
~/Code/jesse/ghostbus/bin/ghostbus doctor
```

Run the MCP server directly:

```bash
node ~/Code/jesse/ghostbus/src/server.cjs --selftest
```

## Codex MCP Config

For this extracted repo, the MCP command is:

```toml
[mcp_servers.ghostbus]
command = "node"
args = ["/Users/jesserichard/Code/jesse/ghostbus/src/server.cjs"]
```

The current live setup may still point at `~/.tooling/ghostbus/src/server.cjs`. Do not switch
that until you are ready to restart the running agents.

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
session = "ghostbus"
workdir = "."

[[panes]]
name = "dev"
command = "$SHELL"

[[panes]]
name = "reviewer"
command = "codex"
```

Until then, this repo is a clean place to evolve the prototype away from `~/.tooling`.
