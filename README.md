# ghostbus

`ghostbus` is a tiny tmux-backed bus for visible local coding agents.

It gives you a terminal workspace where multiple agents can run in separate panes, read each
other's pane output, and send messages through a local MCP server. It is meant for people who
like working in a real terminal and want to watch agents think, stall, recover, coordinate, or
fail in plain sight.

This is a hobby project. It is not a company product, not a platform, and not a supported
tool. Use it if it is useful. Fork it if you want something different.

## Pairs with EDD

ghostbus is the live wire — it moves messages between agents while they work, and forgets
everything once the panes close.

[EDD](https://github.com/jessejamesrich/edd) is the other half: a file-based way to record what
an investigation found, so the next agent session picks up where the last one left off. Bus for
now, files for memory. They're independent — use either alone — but they compose well.

## Status

Prototype, extracted from a working personal setup.

What works today:

- Start a four-pane tmux workspace.
- Name panes so agents can address each other by role.
- Read pane output through MCP.
- Send messages between panes through MCP.
- Queue messages into busy Codex panes when the TUI shows a queue prompt.
- Use the same workflow from Ghostty, iTerm2, Terminal.app, or any terminal that can run tmux.

What is not done yet:

- Configurable pane profiles are only sketched, not implemented.
- The default pane layout is still hardcoded.
- This is not a scheduler.
- This is not a task manager.
- This is not a reliable agent API.
- There is no hosted service, account system, telemetry, UI, sync, or cloud component.

## Why This Exists

Agent CLIs are useful, but a single chat transcript hides too much.

When agents work for more than a minute or two, you often need to see:

- which agent is busy
- which one is waiting for input
- which command is still running
- whether output is changing
- whether a message got queued or just pasted into the prompt
- whether an auditor actually replied or merely worked in its own pane

Desktop agent-grid tools prove that visible multi-agent workspaces can be useful, but they
also introduce another GUI surface. That was the wrong tradeoff for this project. The point
was to keep the work inside Ghostty, using the terminal as the interface instead of opening
another desktop app.

`ghostbus` started as a local experiment to keep the terminal surface while preserving the
useful part of those tools: independent panes with a local bus between them.

The design goal is deliberately small:

```text
tmux panes + readable scrollback + write handles + MCP adapter
```

That is it.

## How It Works

`ghostbus` has two pieces:

1. `bin/ghostbus`
   A shell CLI around tmux. It starts the workspace, lists panes, reads output, sends text,
   interrupts panes, takes snapshots, and runs a basic doctor check.

2. `src/server.cjs`
   A Node-based MCP server. Coding agents can load this server and call tools such as
   `list_agents`, `read_pane`, `message_agent`, and `ask_agent`.

Under the hood, sends are still terminal automation:

```text
load text into a tmux buffer
paste the buffer into the target pane
press Enter or Tab
```

The implementation adds a few practical safeguards:

- unique tmux buffers per send
- copy-mode exit before paste
- `Enter` when the target looks idle
- `Tab` when Codex appears to be showing a queue prompt
- send metadata logging without storing message contents

This makes the workflow useful, but it does not make it magic. If a terminal app changes its
TUI behavior, or if an agent CLI is in a modal state, message delivery can still be imperfect.

## Requirements

- `tmux`
- Node.js 18+
- A terminal emulator
- An MCP-capable coding agent if you want agent-to-agent tools

Ghostty is the terminal this was built in, but Ghostty is not required. The project is named
`ghostbus` because that was the original local experiment.

## Install

Clone the repo:

```bash
git clone <your-fork-or-clone-url> ghostbus
cd ghostbus
```

There are no runtime npm dependencies today. You can run directly from the repo:

```bash
./bin/ghostbus doctor
```

Or put the repo command on your path:

```bash
ln -s "$PWD/bin/ghostbus" /usr/local/bin/ghostbus
```

If you prefer npm-style local linking:

```bash
npm link
```

The package is not currently published. If you see an npm package with this name, do not
assume it is this project.

## Quick Start

From the project directory where you want the panes to open:

```bash
GHOSTBUS_WORKDIR="$PWD" /path/to/ghostbus/bin/ghostbus start
```

By default, this creates a tmux session named `ghostbus` with four panes:

```text
dev
orange
cicd
bohr
```

Those names are historical defaults from the original setup. They will become configurable.
For now, treat them as pane labels:

- `dev`: normal terminal / server output
- `orange`: primary builder/planner
- `cicd`: repo state, commits, tests, CI/CD checks
- `bohr`: reviewer/auditor

In another shell:

```bash
/path/to/ghostbus/bin/ghostbus status
/path/to/ghostbus/bin/ghostbus panes
/path/to/ghostbus/bin/ghostbus doctor
```

Read a pane:

```bash
/path/to/ghostbus/bin/ghostbus read bohr 120
```

Send text to a pane:

```bash
/path/to/ghostbus/bin/ghostbus send cicd 'git status --short'
```

Stop the workspace:

```bash
/path/to/ghostbus/bin/ghostbus stop
```

Use a different session name:

```bash
GHOSTBUS_SESSION=my-agents /path/to/ghostbus/bin/ghostbus start
```

Or:

```bash
/path/to/ghostbus/bin/ghostbus start my-agents
/path/to/ghostbus/bin/ghostbus status my-agents
```

## MCP Setup

Add the MCP server to your agent config.

For Codex, add something like this to your Codex config:

```toml
[mcp_servers.ghostbus]
command = "node"
args = ["/path/to/ghostbus/src/server.cjs"]
```

For Claude-style JSON config:

```json
{
  "mcpServers": {
    "ghostbus": {
      "command": "node",
      "args": ["/path/to/ghostbus/src/server.cjs"]
    }
  }
}
```

Restart existing agent processes after changing MCP config. MCP servers are generally started
by the agent process; editing the file does not hot-reload already-running agents.

## MCP Tools

The server exposes these tools:

```text
list_agents()
read_pane(session_id, max_bytes?, lines?)
message_agent(session_id, text, submit?)
ask_agent(session_id, text, reply_to?, from?, submit?)
ask_agents(session_ids, text, reply_to?, from?, submit?)
wait_for_reply(request_id, session_id?, reply_to?, timeout_ms?)
broadcast_agents(session_ids, text, submit?)
```

Typical usage pattern:

```text
ask_agent("reviewer", "Review this plan and reply PASS/BLOCK.")
wait_for_reply("<request_id>", session_id="reviewer")
```

Use `message_agent` for fire-and-forget sends. Use `ask_agent` when a reply matters.

## Role Prompts

Role prompts are intentionally local.

Tracked examples:

```text
prompts/agent.example.txt
prompts/reviewer.example.txt
prompts/protocol.example.md
```

Copy them and make your own local prompts:

```bash
cp prompts/agent.example.txt prompts/builder.txt
cp prompts/reviewer.example.txt prompts/auditor.txt
```

Local prompt files are ignored by git:

```text
prompts/*.txt
prompts/*.md
```

Only `*.example.txt` and `*.example.md` are tracked.

## Config

Config is not fully wired into the CLI yet, but the intended shape is in:

```text
config.example.toml
```

The goal is to support profiles like:

```toml
default_profile = "example"
state_dir = "~/.local/state/ghostbus"

[profiles.example]
session = "ghostbus"
workdir = "."
layout = "tiled"
lifecycle = "ephemeral"

[[profiles.example.panes]]
name = "dev"
command = "$SHELL"

[[profiles.example.panes]]
name = "reviewer"
command = "codex"
prompt = "prompts/reviewer.example.txt"
```

Local config files are ignored by git:

```text
config.toml
config.local.toml
profiles/*.toml
```

Only example configs should be committed.

## Logs And State

Send metadata is logged without message contents.

Default location:

```text
~/.local/state/ghostbus/send.log
```

The log is useful for debugging whether a send used `Enter` or `Tab`, whether copy mode was
canceled, and which pane was targeted.

Override it with:

```bash
GHOSTBUS_SEND_LOG=/tmp/ghostbus-send.log ghostbus send reviewer 'hello'
```

## Known Rough Edges

This project drives terminal UIs. That means it inherits terminal UI problems.

Known issues:

- copy/paste behavior depends on tmux and your terminal
- scrollback can be awkward
- busy agents are asynchronous, not broken
- terminal modal states can swallow keys
- pane titles can be changed by agent CLIs
- the current default roles are hardcoded
- concurrent sends can still be confusing if the target agent is in a weird input state

If you need a deterministic production-grade multi-agent API, this is not that.

## Safety Notes

This is local terminal automation. Treat it accordingly.

- Do not expose your tmux socket to untrusted users.
- Do not run untrusted prompts with access to sensitive repos.
- Do not assume messages are private from local processes with access to your terminal/session.
- Do not run this on a machine where accidental shell input would be dangerous.

`ghostbus` is a convenience tool for local workflows, not a security boundary.

## Support Policy

There is no support.

This is for hobbyists, tinkerers, and people comfortable reading shell scripts and Node files.
The maintainer may not respond to issues, comments, discussions, pull requests, emails, social
posts, or support requests. Silence does not mean approval, rejection, hostility, or anything
else. It just means there is no support process.

If you need changes, fork it.

If it breaks, keep both pieces.

If you want a different workflow, build it.

## Development

Validate the current scripts:

```bash
bash -n bin/ghostbus
bash -n bin/agentmux
bash -n bin/start-agent-tmux.sh
node --check src/server.cjs
```

Run the MCP self-test:

```bash
node src/server.cjs --selftest
```

Check tmux integration:

```bash
ghostbus doctor
```

## Roadmap, Maybe

Possible future work:

- profile config support
- configurable pane count and role names
- `ghostbus init`
- `ghostbus config codex`
- `ghostbus watch`
- `ghostbus state`
- optional nix/devenv setup
- package publishing
- better docs for Codex, Claude, and other MCP clients

None of this is promised.

## License

No license has been selected yet. Until a license is added, treat this repository as source
available, not open source.
