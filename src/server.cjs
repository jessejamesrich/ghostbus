#!/usr/bin/env node
"use strict";

const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const NAME = "ghostbus";
const VERSION = "0.1.0";
const DEFAULT_LINES = Number(process.env.GHOSTBUS_CAPTURE_LINES || 200);
const DEFAULT_MAX_BYTES = Number(process.env.GHOSTBUS_MAX_BYTES || 12000);
const DEFAULT_SESSION = process.env.GHOSTBUS_TMUX_SESSION || "";
const SUBMIT_DELAY_MS = Number(process.env.GHOSTBUS_SUBMIT_DELAY_MS || 500);
const SEND_LOG = process.env.GHOSTBUS_SEND_LOG || path.join(os.homedir(), ".tooling", "ghostbus", "send.log");
const BUSY_QUEUE_RE = /tab\s+to\s+queue|queue\s+message/i;
const ROLE_NAMES = ["dev", "cicd", "orange", "bohr"];
const DEFAULT_PANE_ROLES = ["dev", "orange", "cicd", "bohr"];

function requestId() {
  return `gb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logEvent(event) {
  try {
    fs.mkdirSync(path.dirname(SEND_LOG), { recursive: true });
    fs.appendFileSync(SEND_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`);
  } catch {
    // Logging must never break message delivery.
  }
}

function tmuxBufferName(prefix) {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function paneMode(sessionId) {
  try {
    const output = await execTmux(["display-message", "-p", "-t", sessionId, "#{pane_in_mode}\t#{pane_mode}"]);
    const [inMode, mode] = output.trimEnd().split("\t");
    return { inMode: inMode === "1", mode: mode || "" };
  } catch {
    return { inMode: false, mode: "unknown" };
  }
}

async function cancelCopyMode(sessionId) {
  const mode = await paneMode(sessionId);
  if (!mode.inMode) return { ...mode, canceled: false };

  try {
    await execTmux(["copy-mode", "-q", "-t", sessionId]);
    return { ...mode, canceled: true };
  } catch {
    return { ...mode, canceled: false };
  }
}

async function pasteIntoPane(sessionId, text) {
  const mode = await cancelCopyMode(sessionId);
  const buffer = tmuxBufferName("ghostbus");
  let pasted = false;

  try {
    await execTmux(["load-buffer", "-b", buffer, "-"], text);
    await execTmux(["paste-buffer", "-d", "-b", buffer, "-t", sessionId]);
    pasted = true;
  } finally {
    if (!pasted) {
      await execTmux(["delete-buffer", "-b", buffer]).catch(() => {});
    }
  }

  return { buffer, mode };
}

async function submitPane(sessionId) {
  await sleep(SUBMIT_DELAY_MS);
  const visible = stripAnsi(await execTmux(["capture-pane", "-p", "-J", "-t", sessionId]));
  const busy = BUSY_QUEUE_RE.test(visible);
  const submitKey = busy ? "Tab" : "Enter";
  await execTmux(["send-keys", "-t", sessionId, submitKey]);
  return { key: submitKey, busy };
}

async function deliverToPane(sessionId, text, submit) {
  const paste = await pasteIntoPane(sessionId, text);
  const submitResult = submit ? await submitPane(sessionId) : null;
  logEvent({
    event: "send",
    pane: sessionId,
    submit,
    submit_key: submitResult ? submitResult.key : null,
    busy_prompt_detected: submitResult ? submitResult.busy : false,
    copy_mode_canceled: paste.mode.canceled,
    text_bytes: Buffer.byteLength(text, "utf8"),
  });
  return { paste, submit: submitResult };
}

function deliverySummary(delivery) {
  const details = [];
  if (delivery.submit) {
    details.push(`submit_key=${delivery.submit.key}`);
    if (delivery.submit.busy) details.push("busy_prompt_detected=true");
  } else {
    details.push("submit=false");
  }
  if (delivery.paste.mode.canceled) details.push("copy_mode_canceled=true");
  return details.join(" ");
}

function execTmux(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile("tmux", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || err.message || String(err)).trim();
        reject(new Error(detail || `tmux ${args.join(" ")} failed`));
        return;
      }
      resolve(stdout);
    });
    if (input !== undefined) {
      child.stdin.end(input);
    }
  });
}

function stripAnsi(text) {
  return String(text || "")
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "")
    .replace(/\r/g, "");
}

function trimBytes(text, maxBytes) {
  const bytes = Buffer.from(String(text || ""), "utf8");
  if (bytes.length <= maxBytes) return String(text || "");
  return bytes.subarray(bytes.length - maxBytes).toString("utf8").replace(/^[^\n]*\n?/, "");
}

function parsePaneLine(line) {
  const [id, command, path, active, title, pid] = line.split("\t");
  return {
    session_id: id,
    pane_id: id,
    command,
    working_dir: path,
    active: active === "1",
    title,
    pid,
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, " ")
    .trim();
}

function matchesRole(value, target) {
  const normalizedValue = normalizeName(value);
  const normalizedTarget = normalizeName(target);
  if (!normalizedTarget) return false;
  return normalizedValue === normalizedTarget || normalizedValue.split(/\s+/).includes(normalizedTarget);
}

function knownRoleFromTitle(title) {
  return ROLE_NAMES.find((role) => matchesRole(title, role)) || "";
}

function roleFromPaneId(sessionId) {
  const match = String(sessionId || "").match(/:(?:\d+)\.(\d+)$/);
  if (!match) return "";
  return DEFAULT_PANE_ROLES[Number(match[1])] || "";
}

function roleFromAgent(agent) {
  return knownRoleFromTitle(agent.title) || roleFromPaneId(agent.session_id) || normalizeName(agent.title) || "";
}

async function listAgents() {
  const format = [
    "#{session_name}:#{window_index}.#{pane_index}",
    "#{pane_current_command}",
    "#{pane_current_path}",
    "#{pane_active}",
    "#{pane_title}",
    "#{pane_pid}",
  ].join("\t");
  const args = ["list-panes", "-a", "-F", format];
  const output = await execTmux(args);
  let agents = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map(parsePaneLine)
    .map((agent) => ({ ...agent, role: roleFromAgent(agent) }));

  if (DEFAULT_SESSION) {
    agents = agents.filter((agent) => agent.session_id.startsWith(`${DEFAULT_SESSION}:`));
  }

  return agents;
}

async function resolveTarget(target) {
  if (!target) throw new Error("session_id is required");

  const agent = await findTarget(target);
  return agent.session_id;
}

async function findTarget(target) {
  if (!target) throw new Error("session_id is required");

  const agents = await listAgents();
  const exact = agents.find((agent) => agent.session_id === target);
  if (exact) return exact;

  const byTitle = agents.filter((agent) => matchesRole(agent.title, target));
  if (byTitle.length === 1) return byTitle[0];
  if (byTitle.length > 1) {
    throw new Error(`Multiple panes have title '${target}'. Use a raw pane id instead.`);
  }

  const byRole = agents.filter((agent) => matchesRole(agent.role, target));
  if (byRole.length === 1) return byRole[0];
  if (byRole.length > 1) {
    throw new Error(`Multiple panes match role '${target}'. Use a raw pane id instead.`);
  }

  const byCommand = agents.filter((agent) => agent.command === target);
  if (byCommand.length === 1) return byCommand[0];
  if (byCommand.length > 1) {
    throw new Error(`Multiple panes match command '${target}'. Use a raw pane id instead.`);
  }

  throw new Error(`No tmux pane matches '${target}'`);
}

async function callerPane() {
  const pane = process.env.TMUX_PANE;
  if (!pane) return null;
  try {
    const format = [
      "#{session_name}:#{window_index}.#{pane_index}",
      "#{pane_current_command}",
      "#{pane_current_path}",
      "#{pane_active}",
      "#{pane_title}",
      "#{pane_pid}",
    ].join("\t");
    const output = await execTmux(["display-message", "-p", "-t", pane, format]);
    const agent = parsePaneLine(output.trimEnd());
    return { ...agent, role: roleFromAgent(agent) };
  } catch {
    return null;
  }
}

async function readPane(args) {
  const sessionId = await resolveTarget(args && args.session_id);
  const lines = Math.max(1, Math.min(Number(args.lines || DEFAULT_LINES) || DEFAULT_LINES, 5000));
  const maxBytes = Math.max(1000, Math.min(Number(args.max_bytes || DEFAULT_MAX_BYTES) || DEFAULT_MAX_BYTES, 200000));
  const output = await execTmux(["capture-pane", "-p", "-J", "-S", `-${lines}`, "-t", sessionId]);
  return trimBytes(stripAnsi(output).trimEnd(), maxBytes) || "(no recent output)";
}

async function readPaneByResolvedId(sessionId, lines = DEFAULT_LINES, maxBytes = DEFAULT_MAX_BYTES) {
  const safeLines = Math.max(1, Math.min(Number(lines) || DEFAULT_LINES, 5000));
  const safeMaxBytes = Math.max(1000, Math.min(Number(maxBytes) || DEFAULT_MAX_BYTES, 200000));
  const output = await execTmux(["capture-pane", "-p", "-J", "-S", `-${safeLines}`, "-t", sessionId]);
  return trimBytes(stripAnsi(output).trimEnd(), safeMaxBytes) || "(no recent output)";
}

async function messageAgent(args) {
  const sessionId = await resolveTarget(args && args.session_id);
  const text = args && args.text;
  if (typeof text !== "string") throw new Error("text is required");

  const delivery = await deliverToPane(sessionId, text, args.submit !== false);
  return `Message delivered to ${sessionId}; ${deliverySummary(delivery)}. Use read_pane to see its reply.`;
}

async function askAgent(args) {
  const target = args && args.session_id;
  const text = args && args.text;
  if (!target) throw new Error("session_id is required");
  if (typeof text !== "string") throw new Error("text is required");

  const targetAgent = await findTarget(target);
  const targetPane = targetAgent.session_id;
  const targetRole = roleFromAgent(targetAgent) || target;
  const caller = await callerPane();
  const replyTo = args.reply_to || (caller && (caller.role || caller.session_id));
  if (!replyTo) {
    throw new Error("reply_to is required when ghostbus cannot identify the caller pane");
  }

  const from = args.from || (caller && (caller.role || caller.session_id)) || "unknown";
  const id = args.request_id || requestId();
  const compactText = text.replace(/\s+/g, " ").trim();
  const wrapped = [
    `[ghostbus request from ${from}]`,
    `REQUEST_ID: ${id}.`,
    `Request: ${compactText}`,
    "Required response protocol:",
    "do the work; do not only answer in this pane;",
    `reply back by calling ghostbus message_agent with session_id "${replyTo}";`,
    `reply text must start exactly with "GHOSTBUS_REPLY ${id} from ${targetRole}:";`,
    `if ghostbus reply fails, leave fallback in this pane starting exactly with "GHOSTBUS_REPLY ${id} from ${targetRole}:".`,
    "Keep the reply concise and include commands/results the sender needs.",
  ].join(" ");

  const delivery = await deliverToPane(targetPane, wrapped, args.submit !== false);
  return [
    `Request ${id} delivered to ${targetPane}; ${deliverySummary(delivery)}; requested reply back to ${replyTo}.`,
    `Next: do not ask the user whether to wait. Call wait_for_reply with request_id "${id}" and session_id "${target}".`,
  ].join("\n");
}

async function askAgents(args) {
  const targets = args && (args.session_ids || args.targets);
  const text = args && args.text;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("session_ids must be a non-empty array");
  }
  if (typeof text !== "string") throw new Error("text is required");

  const id = args.request_id || requestId();
  const delivered = [];
  for (const target of targets) {
    const result = await askAgent({
      session_id: target,
      text,
      request_id: id,
      reply_to: args.reply_to,
      from: args.from,
      submit: args.submit,
    });
    delivered.push(`${target}: ${result}`);
  }
  return [
    `Shared request_id: ${id}`,
    delivered.join("\n"),
    `Next: call wait_for_reply with request_id "${id}" and each target session_id if replies do not route back.`,
  ].join("\n");
}

async function broadcastAgents(args) {
  const targets = args && (args.session_ids || args.targets);
  const text = args && args.text;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("session_ids must be a non-empty array");
  }
  if (typeof text !== "string") throw new Error("text is required");

  const delivered = [];
  for (const target of targets) {
    const result = await messageAgent({
      session_id: target,
      text,
      submit: args.submit,
    });
    delivered.push(`${target}: ${result}`);
  }
  return delivered.join("\n");
}

function extractReply(text, marker) {
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  return text.slice(idx).trim();
}

async function waitForReply(args) {
  const id = args && args.request_id;
  if (!id) throw new Error("request_id is required");

  const marker = `GHOSTBUS_REPLY ${id}`;
  const timeoutMs = Math.max(1000, Math.min(Number(args.timeout_ms || 45000) || 45000, 180000));
  const intervalMs = Math.max(500, Math.min(Number(args.interval_ms || 3000) || 3000, 10000));
  const lines = Math.max(20, Math.min(Number(args.lines || 160) || 160, 1000));
  const maxBytes = Math.max(2000, Math.min(Number(args.max_bytes || 12000) || 12000, 50000));

  const target = args.session_id ? await resolveTarget(args.session_id) : null;
  const caller = await callerPane();
  const callerTarget = args.reply_to
    ? await resolveTarget(args.reply_to)
    : caller && caller.session_id;

  const started = Date.now();
  let lastTargetText = "";
  let lastCallerText = "";

  while (Date.now() - started <= timeoutMs) {
    if (callerTarget) {
      lastCallerText = await readPaneByResolvedId(callerTarget, lines, maxBytes);
      const reply = extractReply(lastCallerText, marker);
      if (reply) return reply;
    }

    if (target) {
      lastTargetText = await readPaneByResolvedId(target, lines, maxBytes);
      const reply = extractReply(lastTargetText, marker);
      if (reply) return reply;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  const parts = [`No marked reply found for ${id} after ${timeoutMs}ms.`];
  if (lastTargetText) {
    parts.push("\nLast target pane output:\n", lastTargetText);
  }
  if (lastCallerText && lastCallerText !== lastTargetText) {
    parts.push("\nLast caller pane output:\n", lastCallerText);
  }
  return parts.join("");
}

const TOOLS = [
  {
    name: "list_agents",
    description: "List tmux panes visible to ghostbus, with session_id, command, working_dir, title, pid, and active status. Call this first to find who to talk to.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_pane",
    description: "Read recent output from a tmux pane. Use before messaging a pane and after messaging to collect its reply.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Target tmux pane id, such as ghostbus:0.1, or a unique pane title such as bohr." },
        max_bytes: { type: "number", description: "Maximum bytes to return from the tail. Default 12000." },
        lines: { type: "number", description: "How many scrollback lines to capture before byte trimming. Default 200." },
      },
      required: ["session_id"],
    },
  },
  {
    name: "message_agent",
    description: "Paste a message into a tmux pane. By default submits it, or queues it with Tab if the target Codex pane is busy.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Target tmux pane id, such as ghostbus:0.1, or a unique pane title such as bohr." },
        text: { type: "string", description: "The prompt or terminal input to paste." },
        submit: { type: "boolean", description: "Submit or queue after pasting. Default true." },
      },
      required: ["session_id", "text"],
    },
  },
  {
    name: "ask_agent",
    description:
      "Send a request to another tmux pane and include instructions for the target to reply back via ghostbus with a request marker. Prefer this over message_agent when you expect an answer. After calling, call wait_for_reply.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Target tmux pane id or unique pane title, such as cicd, orange, or bohr." },
        text: { type: "string", description: "The request to send." },
        request_id: { type: "string", description: "Optional explicit request id. Usually omitted." },
        reply_to: { type: "string", description: "Optional reply target. Usually omitted; ghostbus infers the caller pane inside tmux." },
        from: { type: "string", description: "Optional sender label. Usually omitted; ghostbus infers it from pane title." },
        submit: { type: "boolean", description: "Submit or queue after pasting. Default true." },
      },
      required: ["session_id", "text"],
    },
  },
  {
    name: "ask_agents",
    description:
      "Ask multiple panes the same question and instruct each target to reply back via ghostbus. Use this for audits, decisions, and parallel opinions.",
    inputSchema: {
      type: "object",
      properties: {
        session_ids: {
          type: "array",
          items: { type: "string" },
          description: "Target pane ids or unique pane titles, such as [\"cicd\", \"bohr\"].",
        },
        text: { type: "string", description: "The request to send to each target." },
        request_id: { type: "string", description: "Optional explicit request id. Usually omitted." },
        reply_to: { type: "string", description: "Optional reply target. Usually omitted; ghostbus infers the caller pane inside tmux." },
        from: { type: "string", description: "Optional sender label. Usually omitted; ghostbus infers it from pane title." },
        submit: { type: "boolean", description: "Submit or queue after pasting. Default true." },
      },
      required: ["session_ids", "text"],
    },
  },
  {
    name: "wait_for_reply",
    description:
      "Poll the caller pane and optional target pane for a GHOSTBUS_REPLY marker. Use immediately after ask_agent/ask_agents instead of asking the user whether to wait.",
    inputSchema: {
      type: "object",
      properties: {
        request_id: { type: "string", description: "Request id returned by ask_agent or supplied by the caller." },
        session_id: { type: "string", description: "Optional target pane title/id to also poll for fallback replies." },
        reply_to: { type: "string", description: "Optional caller pane title/id. Usually omitted." },
        timeout_ms: { type: "number", description: "Maximum wait time. Default 45000." },
        interval_ms: { type: "number", description: "Polling interval. Default 3000." },
        lines: { type: "number", description: "Lines to inspect from each pane. Default 160." },
        max_bytes: { type: "number", description: "Maximum bytes to inspect per pane. Default 12000." },
      },
      required: ["request_id"],
    },
  },
  {
    name: "broadcast_agents",
    description: "Paste the same raw message into multiple panes. Use for announcements, not for questions that need replies.",
    inputSchema: {
      type: "object",
      properties: {
        session_ids: {
          type: "array",
          items: { type: "string" },
          description: "Target pane ids or unique pane titles, such as [\"cicd\", \"bohr\"].",
        },
        text: { type: "string", description: "The raw message to paste." },
        submit: { type: "boolean", description: "Submit or queue after pasting. Default true." },
      },
      required: ["session_ids", "text"],
    },
  },
];

async function callTool(name, args) {
  if (name === "list_agents") {
    const agents = await listAgents();
    if (agents.length === 0) return "No tmux panes found.";
    return agents
      .map((a) => `${a.session_id}  ${a.active ? "active" : "inactive"}  role=${a.role}  cmd=${a.command}  pid=${a.pid}  dir=${a.working_dir}  title=${a.title}`)
      .join("\n");
  }
  if (name === "read_pane") return readPane(args || {});
  if (name === "message_agent") return messageAgent(args || {});
  if (name === "ask_agent") return askAgent(args || {});
  if (name === "ask_agents") return askAgents(args || {});
  if (name === "wait_for_reply") return waitForReply(args || {});
  if (name === "broadcast_agents") return broadcastAgents(args || {});
  throw new Error(`Unknown tool: ${name}`);
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg) {
  const { id, method, params } = msg;

  if (method === "initialize") {
    send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: NAME, version: VERSION },
      },
    });
    return;
  }

  if (method && method.startsWith("notifications/")) return;

  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }

  if (method === "tools/call") {
    const toolName = params && params.name;
    const toolArgs = params && params.arguments;
    try {
      const text = await callTool(toolName, toolArgs);
      send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        },
      });
    }
    return;
  }

  if (id !== undefined) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

async function selftest() {
  const agents = await listAgents();
  console.log(JSON.stringify({ ok: true, hostname: os.hostname(), agents }, null, 2));
}

if (process.argv.includes("--selftest")) {
  selftest().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
} else {
  let buffer = "";
  const pending = new Set();
  let queue = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const task = queue.then(() => handle(msg)).catch((err) => {
        console.error(`[${NAME}] handler error:`, err);
      });
      queue = task.catch(() => {});
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
  });
  process.stdin.on("end", () => {
    Promise.allSettled(Array.from(pending)).finally(() => process.exit(0));
  });
}
