#!/usr/bin/env bash
#
# Builds real tmux workspaces from a config and asserts the panes. The unit
# tests cover the resolver; only this catches the layout never being wired to
# it.
#
# GHOSTBUS_SESSION AND AGENTMUX_SESSION ARE CLEARED DELIBERATELY. Either one
# set in the environment outranks the profile's session name, and a run that
# inherits one retargets whatever workspace that names — which, during
# development, meant attaching to a live session and changing its lifecycle.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STARTER="${ROOT}/bin/start-agent-tmux.sh"
TMPDIR_TEST="$(mktemp -d)"
SESSION_PREFIX="gb-selftest-$$"
failures=0
checks=0

cleanup() {
  local session
  for session in $(tmux list-sessions -F '#{session_name}' 2>/dev/null | grep "^${SESSION_PREFIX}" || true); do
    tmux kill-session -t "$session" 2>/dev/null || true
  done
  rm -rf "$TMPDIR_TEST"
}
trap cleanup EXIT

check() {
  local label="$1" want="$2" got="$3"
  checks=$((checks + 1))
  if [[ "$want" == "$got" ]]; then
    printf '  ok   %s\n' "$label"
  else
    printf '  FAIL %s\n       want: %s\n       got:  %s\n' "$label" "$want" "$got"
    failures=$((failures + 1))
  fi
}

if ! command -v tmux >/dev/null 2>&1; then
  printf 'tmux not installed; skipping the workspace tests\n'
  exit 0
fi

build() {
  local name="$1" config="$2"
  # The starter ends in `exec tmux attach`, which cannot succeed without a
  # terminal. The session is fully built before that, so the failure is
  # expected and the assertions run against the built session.
  env -u GHOSTBUS_SESSION -u AGENTMUX_SESSION -u GHOSTBUS_LIFECYCLE \
    GHOSTBUS_CONFIG="$config" "$STARTER" >/dev/null 2>&1
  tmux has-session -t "$name" 2>/dev/null
}

titles() {
  tmux list-panes -t "$1" -F '#{pane_title}' 2>/dev/null | paste -sd, -
}

# --- a two-pane profile ------------------------------------------------------
two_session="${SESSION_PREFIX}-two"
cat > "${TMPDIR_TEST}/two.toml" <<EOF
default_profile = "pair"
[profiles.pair]
session = "${two_session}"
layout = "even-horizontal"
lifecycle = "persistent"
[[profiles.pair.panes]]
name = "left"
[[profiles.pair.panes]]
name = "right"
EOF

if tmux has-session -t "$two_session" 2>/dev/null; then
  printf 'refusing to run: session %s already exists\n' "$two_session" >&2
  exit 1
fi

if build "$two_session" "${TMPDIR_TEST}/two.toml"; then
  check "two-pane profile builds two panes" "2" "$(tmux list-panes -t "$two_session" | wc -l | tr -d ' ')"
  check "two-pane titles come from the config" "left,right" "$(titles "$two_session")"
  check "persistent lifecycle leaves destroy-unattached off" "destroy-unattached off" \
    "$(tmux show-options -t "$two_session" destroy-unattached)"
else
  printf '  FAIL two-pane profile did not build a session\n'
  failures=$((failures + 1))
  checks=$((checks + 1))
fi

# --- a six-pane profile ------------------------------------------------------
six_session="${SESSION_PREFIX}-six"
{
  printf 'default_profile = "six"\n[profiles.six]\nsession = "%s"\n' "$six_session"
  for n in a1 a2 a3 a4 a5 a6; do
    printf '[[profiles.six.panes]]\nname = "%s"\n' "$n"
  done
} > "${TMPDIR_TEST}/six.toml"

if build "$six_session" "${TMPDIR_TEST}/six.toml"; then
  # SIX IS THE POINT. The old starter had four split-window calls; any count
  # other than four proves the layout is read from the config.
  check "six-pane profile builds six panes" "6" "$(tmux list-panes -t "$six_session" | wc -l | tr -d ' ')"
  check "six-pane titles come from the config" "a1,a2,a3,a4,a5,a6" "$(titles "$six_session")"
else
  printf '  FAIL six-pane profile did not build a session\n'
  failures=$((failures + 1))
  checks=$((checks + 1))
fi

# --- a broken config must stop, not fall back --------------------------------
bad_session="${SESSION_PREFIX}-bad"
printf 'default_profile = "ghost"\n[profiles.real]\nsession = "%s"\n[[profiles.real.panes]]\nname = "a"\n' \
  "$bad_session" > "${TMPDIR_TEST}/bad.toml"
bad_output="$(env -u GHOSTBUS_SESSION -u AGENTMUX_SESSION GHOSTBUS_CONFIG="${TMPDIR_TEST}/bad.toml" \
  "$STARTER" 2>&1)"

# NOT THE EXIT CODE. The starter ends in `exec tmux attach`, which fails
# without a terminal, so every run here exits non-zero whether the config was
# good or not — an earlier version of this file asserted that and was green
# while proving nothing.
#
# NOR WHETHER A SESSION APPEARED. A fallback builds under the PLACEHOLDER's
# session name, and if a session of that name is already running the starter
# attaches to it instead of creating one — so on a machine that happens to have
# one, both a refusal and a fallback leave the session list unchanged. That
# version of this check was green against a deliberately broken resolver.
#
# What separates them without depending on what else is running: a refusal
# exits before the final `exec tmux attach`, and only a run that reaches that
# line can report a failure to open a terminal.
check "a config naming a missing profile never reaches attach" "refused" \
  "$(printf '%s' "$bad_output" | grep -q 'open terminal failed' && printf 'attached' || printf 'refused')"
check "and says which profiles exist" "yes" \
  "$(printf '%s' "$bad_output" | grep -q 'profiles are real' && printf 'yes' || printf 'no')"

# --- `ghostbus start` must forward its flags, not rebuild them ---------------
# It used to parse the flags it knew and emit a fresh argument list, so
# `--profile NAME` fell through to the session-name slot: the workspace came up
# under the default profile in a session literally named NAME.
alt_session="${SESSION_PREFIX}-alt"
cat > "${TMPDIR_TEST}/alt.toml" <<EOF
default_profile = "first"
[profiles.first]
session = "${SESSION_PREFIX}-first"
[[profiles.first.panes]]
name = "one_only"
[profiles.second]
session = "${alt_session}"
[[profiles.second.panes]]
name = "two_a"
[[profiles.second.panes]]
name = "two_b"
EOF
env -u GHOSTBUS_SESSION -u AGENTMUX_SESSION GHOSTBUS_CONFIG="${TMPDIR_TEST}/alt.toml" \
  "${ROOT}/bin/ghostbus" start --profile second >/dev/null 2>&1
check "ghostbus start --profile selects the profile" "two_a,two_b" "$(titles "$alt_session")"
check "and does not create a session named after the flag" "absent" \
  "$(tmux has-session -t second 2>/dev/null && printf 'present' || printf 'absent')"

printf '\n%s checks, %s failed\n' "$checks" "$failures"
[[ $failures -eq 0 ]]
