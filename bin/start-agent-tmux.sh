#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${ROOT}/tmux-agent-bus.conf"
PROFILE_JS="${ROOT}/src/profile.cjs"
PROMPT_TIMEOUT="${GHOSTBUS_PROMPT_TIMEOUT:-20}"
PROFILE_NAME=""

usage() {
  cat <<'EOF'
Usage: start-agent-tmux.sh [--ephemeral|--persistent] [--dir PATH] [--profile NAME] [session]

  --ephemeral     kill the tmux session when the last client closes/detaches
  --persistent    keep the tmux session running after the terminal closes
  --dir PATH      working directory for new panes
  --profile NAME  profile from config.toml (default: its default_profile)

The pane count, pane names and the command each pane runs come from the
profile. See config.example.toml.
EOF
}

SESSION_ARG=""
LIFECYCLE_ARG=""
WORKDIR_ARG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ephemeral) LIFECYCLE_ARG="ephemeral" ;;
    --persistent) LIFECYCLE_ARG="persistent" ;;
    --dir|--cwd)
      shift
      [[ $# -gt 0 ]] || { printf 'start-agent-tmux.sh: --dir requires a path\n' >&2; exit 1; }
      WORKDIR_ARG="$1"
      ;;
    --profile)
      shift
      [[ $# -gt 0 ]] || { printf 'start-agent-tmux.sh: --profile requires a name\n' >&2; exit 1; }
      PROFILE_NAME="$1"
      ;;
    -h|--help) usage; exit 0 ;;
    *) SESSION_ARG="$1" ;;
  esac
  shift
done

# A CONFIG THAT DOES NOT PARSE IS FATAL. Falling back to the placeholder
# profile would build a workspace the config does not describe and say nothing.
profile_emitted=""
if [[ -n "$PROFILE_NAME" ]]; then
  profile_emitted="$(node "$PROFILE_JS" --shell --profile "$PROFILE_NAME" 2>&1)" || {
    printf '%s\n' "$profile_emitted" >&2
    exit 1
  }
else
  profile_emitted="$(node "$PROFILE_JS" --shell 2>&1)" || {
    printf '%s\n' "$profile_emitted" >&2
    exit 1
  }
fi
eval "$profile_emitted"

SESSION="${SESSION_ARG:-${GHOSTBUS_SESSION:-${AGENTMUX_SESSION:-${GHOSTBUS_PROFILE_SESSION}}}}"
LIFECYCLE="${LIFECYCLE_ARG:-${GHOSTBUS_LIFECYCLE:-${AGENTMUX_LIFECYCLE:-${GHOSTBUS_PROFILE_LIFECYCLE}}}}"
WORKDIR="${WORKDIR_ARG:-${GHOSTBUS_WORKDIR:-${AGENTMUX_WORKDIR:-${GHOSTBUS_PROFILE_WORKDIR}}}}"
LAYOUT="${GHOSTBUS_LAYOUT:-${GHOSTBUS_PROFILE_LAYOUT}}"
ROLES=("${GHOSTBUS_PROFILE_ROLES[@]}")
COMMANDS=("${GHOSTBUS_PROFILE_COMMANDS[@]}")
PROMPTS=("${GHOSTBUS_PROFILE_PROMPTS[@]}")

[[ "$WORKDIR" == "." ]] && WORKDIR="$PWD"
WORKDIR="$(cd "$WORKDIR" 2>/dev/null && pwd)" || {
  printf 'start-agent-tmux.sh: directory does not exist: %s\n' "$WORKDIR" >&2
  exit 1
}

apply_lifecycle_before_attach() {
  if [[ "${LIFECYCLE}" == "ephemeral" ]]; then
    # The hook flips destroy-unattached only after a client is attached.
    # Setting it while the session is still detached would kill the session
    # before we finish building the layout.
    tmux set-option -t "${SESSION}" destroy-unattached off
    tmux set-hook -t "${SESSION}" client-attached "set-option -t ${SESSION} destroy-unattached on"
  else
    tmux set-option -t "${SESSION}" destroy-unattached off
    tmux set-hook -u -t "${SESSION}" client-attached 2>/dev/null || true
  fi
}

if tmux has-session -t "${SESSION}" 2>/dev/null; then
  apply_lifecycle_before_attach
  exec tmux attach -t "${SESSION}"
fi

tmux -f "${CONF}" new-session -d -s "${SESSION}" -n main -c "${WORKDIR}"

# PANES COME FROM THE PROFILE. This was four hardcoded split-window calls and
# four hardcoded titles. Re-tiling after every split is what makes an arbitrary
# pane count work: splitting the same pane repeatedly runs out of room and tmux
# refuses with "no space for new pane".
for ((i = 1; i < ${#ROLES[@]}; i++)); do
  tmux split-window -t "${SESSION}:0" -c "${WORKDIR}"
  tmux select-layout -t "${SESSION}:0" tiled >/dev/null
done

for ((i = 0; i < ${#ROLES[@]}; i++)); do
  tmux select-pane -t "${SESSION}:0.${i}" -T "${ROLES[$i]}"
done

tmux select-layout -t "${SESSION}:0" "${LAYOUT}" >/dev/null

# The command runs through the pane's shell rather than as the pane's process,
# so a crashed or exited agent CLI leaves a usable shell instead of closing the
# pane and renumbering every pane after it.
shell_basename="$(basename "${SHELL:-sh}")"
for ((i = 0; i < ${#ROLES[@]}; i++)); do
  command="${COMMANDS[$i]}"
  [[ -z "$command" || "$command" == '$SHELL' ]] && continue
  tmux send-keys -t "${SESSION}:0.${i}" "$command" C-m
done

# A PROMPT IS PASTED ONLY ONCE THE COMMAND IS ACTUALLY UP. A sleep long enough
# for a slow agent CLI is wasted on every fast one, and one too short silently
# drops the prompt into a shell that has already been replaced.
paste_prompt() {
  local index="$1" file="$2" pane="${SESSION}:0.${index}"
  local waited=0 current
  while ((waited < PROMPT_TIMEOUT)); do
    current="$(tmux display-message -p -t "$pane" '#{pane_current_command}' 2>/dev/null || printf '')"
    if [[ -n "$current" && "$current" != "$shell_basename" && "$current" != "sh" && "$current" != "bash" && "$current" != "zsh" ]]; then
      tmux load-buffer -b "ghostbus-prompt-${index}" "$file"
      tmux paste-buffer -b "ghostbus-prompt-${index}" -t "$pane" -d
      tmux send-keys -t "$pane" C-m
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  printf 'start-agent-tmux.sh: pane %s never started its command; prompt %s not sent\n' "${ROLES[$index]}" "$file" >&2
  return 1
}

for ((i = 0; i < ${#ROLES[@]}; i++)); do
  prompt="${PROMPTS[$i]}"
  [[ -z "$prompt" ]] && continue
  prompt_path="$prompt"
  [[ "$prompt_path" != /* ]] && prompt_path="${WORKDIR}/${prompt}"
  if [[ ! -f "$prompt_path" ]]; then
    prompt_path="${ROOT}/${prompt}"
  fi
  if [[ ! -f "$prompt_path" ]]; then
    printf 'start-agent-tmux.sh: prompt file not found for %s: %s\n' "${ROLES[$i]}" "$prompt" >&2
    continue
  fi
  paste_prompt "$i" "$prompt_path" || true
done

tmux select-pane -t "${SESSION}:0.0"
apply_lifecycle_before_attach

exec tmux attach -t "${SESSION}"
