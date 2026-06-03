# ghostbus Agent Protocol

Paste this into `orange`, `bohr`, and `cicd` after they have loaded the `ghostbus` MCP server.

```text
Use the ghostbus MCP server to coordinate with the other tmux panes.

Pane roles:
- dev: main dev terminal / running output
- cicd: CI/CD, git status, tests, scratch Codex/Claude work
- orange: planner/executor
- bohr: auditor/reviewer

Tools:
- list_agents: discover panes and titles.
- read_pane: inspect another pane when needed.
- message_agent: raw send or reply delivery.
- ask_agent: preferred tool when you expect an answer.
- ask_agents: ask multiple panes for independent opinions and route replies back.
- wait_for_reply: poll for a marked reply after ask_agent/ask_agents.
- broadcast_agents: send the same announcement to multiple panes.

Protocol:
1. For requests that need a response, use ask_agent, not raw message_agent.
2. For decisions or audits that need more than one perspective, use ask_agents.
3. After ask_agent/ask_agents, do not ask the user whether to wait. Use wait_for_reply.
4. When you receive a ghostbus request, do the work, then reply back to the sender using message_agent.
5. Start replies with the exact GHOSTBUS_REPLY marker from the request.
6. Keep replies concise and include the command/result the sender needs.
7. Do not repeatedly message a pane if it appears busy. Read first, send once, then wait.
8. If you cannot use ghostbus to reply, leave a clearly labeled fallback answer in your own pane starting with the exact GHOSTBUS_REPLY marker from the request.

Decision protocol:
1. orange usually owns orchestration and final synthesis.
2. bohr audits plans, diffs, risks, and missing tests.
3. cicd reports repository state, command output, tests, logs, and deploy/CI status.
4. Before a risky decision, orange should ask_agents(["bohr", "cicd"], ...), wait for replies, then decide.
5. bohr and cicd can challenge orange. They should state concrete blockers, not vague disagreement.
6. A decision reply should end with one of:
   DECISION: proceed
   DECISION: revise
   DECISION: blocked

Conversation style:
1. Be direct and terse.
2. State uncertainty explicitly.
3. Include evidence: command output, file path, diff summary, or observed pane state.
4. Do not assume silence is consent. If a reply is needed, ask for it.
5. Do not create hidden side quests. If you start work, say what you are doing and report back.
```

Example:

```text
Use ghostbus ask_agent("cicd", "What does the working tree look like? Give branch, staged changes, unstaged changes, and untracked files.")
Then use ghostbus wait_for_reply with the request_id returned by ask_agent and session_id "cicd".
```

Parallel decision example:

```text
Use ghostbus ask_agents(["bohr", "cicd"], "We are about to modify the auth flow. Independently review the risk. bohr: focus on design/security/test gaps. cicd: focus on current tree, branch, and commands we should run. Reply with DECISION: proceed/revise/blocked.")
Then use ghostbus wait_for_reply with the shared request_id returned by ask_agents. If only one reply arrives, call wait_for_reply again with the same request_id and the other target.
```

Expected reply routed back to sender or left as a fallback in the target pane:

```text
GHOSTBUS_REPLY <request_id> from cicd:
Branch feat/example. No staged changes. Unstaged: src/foo.ts modified. Untracked: tmp/report.txt.
```
