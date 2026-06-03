#!/usr/bin/env bash
set -euo pipefail

SESSION="${GHOSTBUS_SESSION:-${AGENTMUX_SESSION:-ghostbus}}"
LIFECYCLE="${GHOSTBUS_LIFECYCLE:-${AGENTMUX_LIFECYCLE:-ephemeral}}"
WORKDIR="${GHOSTBUS_WORKDIR:-${AGENTMUX_WORKDIR:-${PWD}}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${ROOT}/tmux-agent-bus.conf"

usage() {
  cat <<'EOF'
Usage: start-agent-tmux.sh [--ephemeral|--persistent] [--dir PATH] [session]

  --ephemeral   kill the tmux session when the last client closes/detaches
  --persistent  keep the tmux session running after Ghostty closes
  --dir PATH     working directory for new panes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ephemeral)
      LIFECYCLE="ephemeral"
      ;;
    --persistent)
      LIFECYCLE="persistent"
      ;;
    --dir|--cwd)
      shift
      [[ $# -gt 0 ]] || {
        printf 'start-agent-tmux.sh: --dir requires a path\n' >&2
        exit 1
      }
      WORKDIR="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      SESSION="$1"
      ;;
  esac
  shift
done

if [[ ! -d "${WORKDIR}" ]]; then
  printf 'start-agent-tmux.sh: directory does not exist: %s\n' "${WORKDIR}" >&2
  exit 1
fi

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

# Four-pane starter layout. This is still hardcoded in the prototype and
# should move to profile config next.
tmux split-window -h -t "${SESSION}:0.0" -c "${WORKDIR}"
tmux split-window -v -t "${SESSION}:0.0" -c "${WORKDIR}"
tmux split-window -v -t "${SESSION}:0.1" -c "${WORKDIR}"
tmux select-pane -t "${SESSION}:0.0" -T "dev"
tmux select-pane -t "${SESSION}:0.1" -T "orange"
tmux select-pane -t "${SESSION}:0.2" -T "cicd"
tmux select-pane -t "${SESSION}:0.3" -T "bohr"
tmux select-layout -t "${SESSION}:0" tiled
tmux select-pane -t "${SESSION}:0.0"
apply_lifecycle_before_attach

exec tmux attach -t "${SESSION}"
