# ghostbus Agent Protocol

Paste this into panes after they have loaded the `ghostbus` MCP server.

## Rules

1. Use ghostbus tools to coordinate with other panes.
2. Use `ask_agent` when you expect a reply.
3. Use `message_agent` only for fire-and-forget messages or raw terminal input.
4. Use `wait_for_reply` after `ask_agent` or `ask_agents`.
5. When a request includes a `GHOSTBUS_REPLY` marker, reply with that exact marker.
6. Keep replies concise and include the command output or file paths the sender needs.

## Example

```text
Use ghostbus ask_agent("reviewer", "Review the current plan and reply PASS/BLOCK with exact blockers.")
Then use ghostbus wait_for_reply with the request_id returned by ask_agent and session_id "reviewer".
```

## Fallback

If ghostbus reply fails, leave a visible fallback answer in your own pane starting with the
same `GHOSTBUS_REPLY` marker from the request.
