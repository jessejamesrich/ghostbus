---
name: setting-up-a-workspace
description: Configure or start a ghostbus tmux workspace — pane count, pane names, the command each pane runs, prompts, layout and lifecycle. Use whenever you are writing or changing config.toml, adding or renaming a pane, or a started workspace is not the one the config describes. Covers the profile format, what the config refuses and why, and the environment variable that silently retargets a live session.
---

# Setting up a workspace

A profile describes the workspace: how many panes, what each is called, what
each runs. `ghostbus start` reads it. Nothing about the layout is fixed —
there is no default pane count to work around.

**The rule: check `ghostbus profile` before and after you change anything. It
prints the profile in force and the file it came from, which is the only way to
tell a config you edited from a config that is being used.**

## The file

```toml
default_profile = "work"
state_dir = "~/.local/state/ghostbus"

[profiles.work]
session = "work"
workdir = "."
layout = "tiled"          # any tmux layout name
lifecycle = "ephemeral"   # or persistent

[[profiles.work.panes]]
name = "agent1"
command = "$SHELL"

[[profiles.work.panes]]
name = "agent2"
command = "codex"
prompt = "prompts/reviewer.example.txt"
```

One `[[profiles.<name>.panes]]` block per pane, in creation order. The first
file that exists wins:

```text
$GHOSTBUS_CONFIG
./config.toml
./config.local.toml
$XDG_CONFIG_HOME/ghostbus/config.toml   (or ~/.config/ghostbus/config.toml)
```

With no config file at all you get a built-in profile of four placeholder
panes. Choose a non-default profile with `--profile NAME` or
`GHOSTBUS_PROFILE=NAME`.

Personal config files are gitignored on purpose. **Put your own pane names in
your own `config.toml`, never in the tracked example** — the names you use for
your agents are not part of the tool.

## A pane name is an address

It reaches tmux as a pane title and the CLI as an argument, so it must be
letters, digits, `_` or `-`. A name with a space or a shell metacharacter in it
cannot be addressed and is refused rather than quietly mangled.

Order matters beyond cosmetics: an agent CLI that overwrites its own pane title
leaves the pane resolvable only by its POSITION in the profile. Reordering
panes in the config renames those panes from the bus's point of view.

## What the config refuses, and why it refuses instead of defaulting

A config that does not parse is fatal, and so is each of these:

- a profile with no panes
- two panes with the same name
- a pane name that cannot be addressed
- a `lifecycle` that is neither `ephemeral` nor `persistent`
- a profile name that does not exist in the file
- a value the parser does not support, such as an inline table

None of them falls back to the defaults. A workspace built from a profile the
config does not describe, reporting success, is harder to diagnose than one
that refuses to start — the symptom shows up later as a send to a pane name
that does not exist. The parser refuses what it cannot read for the same
reason: a skipped line is a setting that silently did not apply.

The MCP server is the exception, because it is started by a client that shows
no stderr and must not die. It falls back to the placeholder profile and says
so in the first line of `list_agents`. **If you see that notice, the pane names
are not yours.**

## The trap: GHOSTBUS_SESSION outranks the profile

`GHOSTBUS_SESSION` in the environment beats the profile's `session` value. If
it is exported in your shell — and an agent running inside a ghostbus pane
usually has it — then `ghostbus start` targets THAT session name.

When a session of that name already exists, `start` attaches to it rather than
building anything, and applies the new profile's lifecycle to it on the way in.
So a start intended to create a test workspace can instead reach into a running
one and change whether it survives being detached.

This has happened. The symptom is a workspace that is not the one you just
configured, and no error at all.

Guard against it:

- `ghostbus profile` says when the environment has overridden the file.
- Clear it for one-off runs: `env -u GHOSTBUS_SESSION -u AGENTMUX_SESSION ...`
- Give test profiles a session name that cannot collide.

## Prompts

`prompt` is a path to a file pasted into the pane after the pane's command is
running. It is not sent after a fixed delay — the starter waits for the pane's
running command to change from the shell, because a prompt pasted into a shell
that is about to be replaced is simply gone. If the command never starts, the
starter says which pane and which prompt it skipped.

Paths resolve against the workdir first, then the ghostbus install directory.

## After changing the config

```bash
ghostbus profile      # the profile in force, and the file it came from
npm test              # the resolver, its refusals, and real two- and six-pane workspaces
```

A changed config does not reshape a running session. Panes are built at
`start`, so a pane you added appears after the session is stopped and started
again, not on the next command.
