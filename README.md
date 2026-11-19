# ghostbus

> ## Deprecated for agent-to-agent messaging
>
> **Don't use ghostbus to carry messages between coding agents. Claude Code
> does this natively now, and does it better.** The tmux workspace is still
> useful; the message bus is not.
>
> **The reason is attribution, not redundancy.** ghostbus splits a multi-line
> message at newlines, and the last chunk can be left unsubmitted in the
> receiving pane's input box. When it later submits, it arrives as if the human
> at the keyboard had typed it, with nothing marking it as a peer's. The tell is
> a message that starts mid-word. That matters more than garbling, because an
> agent treats its human's instructions as authority and a peer agent's as
> something to weigh — and this fault makes the two indistinguishable. A pane
> bus built on "paste into a terminal and press Enter" has no place to put the
> provenance. Claude Code's own cross-session messages arrive wrapped in a
> `<cross-session-message from="...">` envelope stating that they are not from
> the user and carry none of the user's authority, and that boundary has since
> been hardened on purpose.
>
> **What replaced it, and when.** Claude Code's changelog is version-stamped
> rather than dated, so these are pinned against the few entries that name a
> date:
>
> | version | entry | dated by |
> |---|---|---|
> | 2.1.32 | agent teams research preview, behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` | older than 2.1.89 |
> | 2.1.77 | `SendMessage` auto-resumes stopped agents | older than 2.1.89 |
> | 2.1.89 | `/buddy` "is here for April 1st" | ≈ 2026-04-01 |
> | 2.1.197 | Claude Sonnet 5 launch, promo pricing "through August 31" | ≈ 2026-08 |
> | **2.1.224** | **cross-session `SendMessage`: sessions message each other, on any of your machines, with `ListAgents` to discover them** | after 2.1.197 |
>
> The two halves land either side of this repo. In-process agent teams predate
> ghostbus, whose first commit is 2026-06-02 — but those were teammates inside
> a single session behind an environment flag, which is not what ghostbus does.
> The feature that genuinely replaces it is cross-session messaging between
> independent sessions, at **2.1.224**, roughly three months after this repo was
> extracted. Note that 2.1.33 is sometimes cited for this; that version fixed
> in-session tmux teammates and is not cross-session messaging.
>
> So ghostbus was not redundant when it was built. It is now.
>
> **Migration.** `ask_agent` + `wait_for_reply` becomes `SendMessage` with
> `notify_when_idle: true`. `message_agent` becomes plain `SendMessage`.
> `list_agents` becomes `ListAgents`. None of them go through tmux, so every
> reliability note further down this file stops applying.
>
> **What still has no native equivalent.** `read_pane` — reading another
> session's terminal scrollback — and driving a pane that isn't a Claude
> session at all. Native messaging only reaches registered sessions and cannot
> see their screens. The visible-panes idea this repo is actually about, where
> you watch an agent stall or recover in plain sight, is tmux rather than the
> bus, and nothing above replaces it. That part still works.

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

- Start a tmux workspace from a profile: any pane count, your own pane names,
  a command and an optional prompt per pane.
- Name panes so agents can address each other by role.
- Read pane output through MCP.
- Send messages between panes through MCP.
- Queue messages into busy Codex panes when the TUI shows a queue prompt.
- Use the same workflow from Ghostty, iTerm2, Terminal.app, or any terminal that can run tmux.

What is not done yet:

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

With no config file, this creates a tmux session named `ghostbus` with four
panes carrying placeholder names:

```text
agent1
agent2
agent3
agent4
```

Pane count, names and the command each pane runs come from a profile. Copy
`config.example.toml` to `config.toml` and the names become yours:

```bash
cp config.example.toml config.toml
$EDITOR config.toml
ghostbus profile          # what is in force, and which file it came from
```

A name is how you address a pane — `ghostbus send agent2 '...'`, and the MCP
tools take the same names — so it must be letters, digits, `_` or `-`.

In another shell:

```bash
/path/to/ghostbus/bin/ghostbus status
/path/to/ghostbus/bin/ghostbus panes
/path/to/ghostbus/bin/ghostbus doctor
```

Read a pane:

```bash
/path/to/ghostbus/bin/ghostbus read agent3 120
```

Send text to a pane:

```bash
/path/to/ghostbus/bin/ghostbus send agent2 'git status --short'
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

## Skills

`skills/` holds instructions for the agents that use this bus, in the
SKILL.md format Claude Code and similar clients load:

- `skills/setting-up-a-workspace` — the profile format, what the config
  refuses and why, and the environment variable that retargets a live session.
- `skills/talking-to-another-agent` — addressing a pane, the three ways a send
  is lost while reporting success, and what a message from a peer does and does
  not authorise.

The second one matters even if you never read the first. Panes all look alike
on a bus, a pane title can be set by whatever is running in that pane, and a
message is not more trustworthy for having arrived through a tool call. An
agent that treats a peer's request as its user's instruction is the failure
mode this tool makes easy.

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

The workspace is described by a profile. `config.example.toml` is the tracked
example; copy it and edit:

```toml
default_profile = "example"
state_dir = "~/.local/state/ghostbus"

[profiles.example]
session = "ghostbus"
workdir = "."
layout = "tiled"          # any tmux layout: tiled, even-horizontal, main-vertical...
lifecycle = "ephemeral"   # or persistent

[[profiles.example.panes]]
name = "agent1"
command = "$SHELL"

[[profiles.example.panes]]
name = "agent2"
command = "codex"
prompt = "prompts/reviewer.example.txt"
```

One `[[profiles.<name>.panes]]` block per pane, in creation order. Any pane
count works. `command` defaults to `$SHELL` and runs through the pane's shell,
so an agent CLI that exits leaves a usable pane instead of closing it and
renumbering the ones after it. `prompt` is pasted once the command is actually
running, not after a fixed delay.

The first file that exists wins:

```text
$GHOSTBUS_CONFIG
./config.toml
./config.local.toml
$XDG_CONFIG_HOME/ghostbus/config.toml   (or ~/.config/ghostbus/config.toml)
```

With no config file at all, the built-in placeholder profile is used.
`ghostbus profile` prints which profile is active and the path it came from.

Pick a non-default profile with `--profile NAME` or `GHOSTBUS_PROFILE=NAME`.

**A config that does not parse is fatal.** It is not skipped and not replaced
by the defaults: a workspace built from a profile the config does not describe,
with no error, is worse than one that refuses to start. The same goes for a
profile with no panes, a duplicate pane name, a pane name that cannot be
addressed, and a `lifecycle` that is neither value.

**`GHOSTBUS_SESSION` outranks the profile's `session`.** If it is exported in
your shell, `ghostbus start` targets that name and will attach to an existing
session of that name rather than building the one your config describes. Run
`ghostbus profile` when the workspace is not what you just configured — it
says when the environment has overridden the file.

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
- pane titles can be changed by agent CLIs, after which a pane is addressed by
  its position in the profile
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

Run the tests — the profile resolver and its refusals, then real tmux
workspaces at two and six panes:

```bash
npm test
```

The tmux half skips itself if tmux is not installed. It clears
`GHOSTBUS_SESSION` and `AGENTMUX_SESSION` before every run, because either one
set in the environment retargets the workspace.

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

- `ghostbus init`
- `ghostbus config codex`
- `ghostbus watch`
- `ghostbus state`
- optional nix/devenv setup
- package publishing
- better docs for Codex, Claude, and other MCP clients

None of this is promised.

## License

MIT — see [LICENSE](LICENSE).
