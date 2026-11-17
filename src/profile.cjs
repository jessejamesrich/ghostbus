#!/usr/bin/env node
"use strict";

/**
 * PROFILE RESOLUTION. The pane layout used to be four lines of hardcoded
 * tmux calls and a bash array holding one person's agent names, while
 * config.example.toml described a profile format nothing read. This is the
 * thing that reads it.
 *
 * The TOML subset here is deliberately small and REFUSES what it does not
 * understand. A parser that skips a construct it cannot read produces a
 * profile missing the pane you asked for and says nothing, which is worse
 * than not parsing at all.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * THE BUILT-IN PROFILE IS GENERIC ON PURPOSE. It used to be one person's four
 * agent names, compiled into a tool other people run. Your own names belong in
 * your own config.toml, which is gitignored; these are placeholders that
 * describe nothing about your setup.
 */
const builtinProfile = {
	name: "default",
	session: "ghostbus",
	workdir: ".",
	layout: "tiled",
	lifecycle: "ephemeral",
	panes: [
		{ name: "agent1", command: "$SHELL", prompt: "" },
		{ name: "agent2", command: "$SHELL", prompt: "" },
		{ name: "agent3", command: "$SHELL", prompt: "" },
		{ name: "agent4", command: "$SHELL", prompt: "" },
	],
};

const expandHome = (value) =>
	typeof value === "string" && (value === "~" || value.startsWith("~/"))
		? path.join(os.homedir(), value.slice(1))
		: value;

/** Candidate config paths, most specific first. */
const configCandidates = (root) => {
	const explicit = process.env.GHOSTBUS_CONFIG;
	if (explicit) return [expandHome(explicit)];
	const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
	return [
		path.join(root, "config.toml"),
		path.join(root, "config.local.toml"),
		path.join(xdg, "ghostbus", "config.toml"),
	];
};

const findConfig = (root) => configCandidates(root).find((p) => fs.existsSync(p)) || null;

const scalar = (raw, where) => {
	const text = raw.trim();
	if (text === "true") return true;
	if (text === "false") return false;
	if (/^-?\d+$/.test(text)) return Number(text);
	if (/^"([^"\\]|\\.)*"$/.test(text)) {
		return text
			.slice(1, -1)
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, "\\")
			.replace(/\\n/g, "\n")
			.replace(/\\t/g, "\t");
	}
	if (/^'[^']*'$/.test(text)) return text.slice(1, -1);
	// REFUSED RATHER THAN GUESSED. An inline table, a multiline string or a
	// bare word would each parse to something plausible and wrong.
	throw new Error(`${where}: unsupported value ${JSON.stringify(text)}`);
};

const descend = (root, keys, where) => {
	let node = root;
	for (const key of keys) {
		if (!(key in node)) node[key] = {};
		if (Array.isArray(node[key])) node = node[key][node[key].length - 1];
		else node = node[key];
		if (typeof node !== "object" || node === null) {
			throw new Error(`${where}: ${keys.join(".")} is not a table`);
		}
	}
	return node;
};

const splitKeyPath = (text, where) => {
	const keys = text.split(".").map((k) => k.trim());
	for (const key of keys) {
		const bare = /^[A-Za-z0-9_-]+$/.test(key);
		const quoted = /^"[^"]*"$/.test(key);
		if (!bare && !quoted) throw new Error(`${where}: bad key ${JSON.stringify(key)}`);
	}
	return keys.map((k) => (k.startsWith('"') ? k.slice(1, -1) : k));
};

/** A deliberately small TOML subset: comments, scalars, [tables], [[arrays]]. */
const parseToml = (text, label = "config") => {
	const root = {};
	let table = root;
	const lines = text.split(/\r?\n/);

	for (let i = 0; i < lines.length; i += 1) {
		const where = `${label}:${i + 1}`;
		const line = lines[i].replace(/^\s+/, "");
		if (line === "" || line.startsWith("#")) continue;

		const arrayTable = /^\[\[([^\]]+)\]\]\s*(#.*)?$/.exec(line);
		if (arrayTable) {
			const keys = splitKeyPath(arrayTable[1], where);
			const last = keys.pop();
			const parent = descend(root, keys, where);
			if (!(last in parent)) parent[last] = [];
			if (!Array.isArray(parent[last])) throw new Error(`${where}: ${last} is not an array of tables`);
			const entry = {};
			parent[last].push(entry);
			table = entry;
			continue;
		}

		const plainTable = /^\[([^\]]+)\]\s*(#.*)?$/.exec(line);
		if (plainTable) {
			table = descend(root, splitKeyPath(plainTable[1], where), where);
			continue;
		}

		const pair = /^([^=]+)=(.*)$/.exec(line);
		if (!pair) throw new Error(`${where}: not a key, a table or a comment: ${JSON.stringify(line)}`);
		const keys = splitKeyPath(pair[1], where);
		const leaf = keys.pop();
		const target = keys.length ? descend(table, keys, where) : table;
		// A trailing comment is only a comment outside a quoted value.
		let value = pair[2];
		const quoted = /^\s*("([^"\\]|\\.)*"|'[^']*')/.exec(value);
		if (quoted) value = quoted[1];
		else value = value.replace(/\s+#.*$/, "");
		target[leaf] = scalar(value, where);
	}

	return root;
};

const paneFrom = (raw, where) => {
	if (typeof raw.name !== "string" || raw.name.trim() === "") {
		throw new Error(`${where}: every pane needs a name`);
	}
	if (!/^[A-Za-z0-9_-]+$/.test(raw.name)) {
		// A role name reaches tmux as a pane title and this tool's own CLI as
		// an argument. Anything with a space or a shell metacharacter in it
		// cannot be addressed and must not be accepted.
		throw new Error(`${where}: pane name ${JSON.stringify(raw.name)} must be letters, digits, _ or -`);
	}
	return {
		name: raw.name,
		command: typeof raw.command === "string" && raw.command.trim() !== "" ? raw.command : "$SHELL",
		prompt: typeof raw.prompt === "string" ? raw.prompt : "",
	};
};

const resolveProfile = ({ root, name } = {}) => {
	const base = root || path.join(__dirname, "..");
	const configPath = findConfig(base);
	if (!configPath) {
		return { ...builtinProfile, source: "built-in", configPath: null };
	}

	const parsed = parseToml(fs.readFileSync(configPath, "utf8"), configPath);
	const profiles = parsed.profiles;
	if (!profiles || typeof profiles !== "object" || Array.isArray(profiles)) {
		throw new Error(`${configPath}: no [profiles.<name>] table`);
	}

	const wanted = name || process.env.GHOSTBUS_PROFILE || parsed.default_profile;
	const available = Object.keys(profiles);
	if (!wanted) {
		throw new Error(
			`${configPath}: no default_profile and none given — profiles are ${available.join(", ")}`,
		);
	}
	const chosen = profiles[wanted];
	if (!chosen) {
		throw new Error(`${configPath}: no profile ${JSON.stringify(wanted)} — profiles are ${available.join(", ")}`);
	}

	const panesRaw = chosen.panes;
	// FAIL CLOSED ON AN EMPTY PROFILE. Starting a workspace with no panes
	// looks like a working tool and does nothing, and the cause would be a
	// typo in a table name three files away.
	if (!Array.isArray(panesRaw) || panesRaw.length === 0) {
		throw new Error(`${configPath}: profile ${JSON.stringify(wanted)} declares no [[profiles.${wanted}.panes]]`);
	}

	const panes = panesRaw.map((p, i) => paneFrom(p, `${configPath} pane ${i + 1}`));
	const seen = new Set();
	for (const pane of panes) {
		if (seen.has(pane.name)) {
			// Two panes with one name makes `ghostbus send <name>` ambiguous
			// and it would silently pick the first.
			throw new Error(`${configPath}: profile ${JSON.stringify(wanted)} names the pane ${JSON.stringify(pane.name)} twice`);
		}
		seen.add(pane.name);
	}

	const lifecycle = chosen.lifecycle || "ephemeral";
	if (lifecycle !== "ephemeral" && lifecycle !== "persistent") {
		throw new Error(`${configPath}: lifecycle must be ephemeral or persistent, not ${JSON.stringify(lifecycle)}`);
	}

	return {
		name: wanted,
		session: chosen.session || "ghostbus",
		workdir: expandHome(chosen.workdir || "."),
		layout: chosen.layout || "tiled",
		lifecycle,
		panes,
		stateDir: expandHome(parsed.state_dir || ""),
		source: configPath,
		configPath,
	};
};

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

const emitShell = (profile) => {
	const names = profile.panes.map((p) => p.name);
	const commands = profile.panes.map((p) => p.command);
	const prompts = profile.panes.map((p) => p.prompt);
	return [
		`GHOSTBUS_PROFILE_NAME=${shellQuote(profile.name)}`,
		`GHOSTBUS_PROFILE_SOURCE=${shellQuote(profile.source)}`,
		`GHOSTBUS_PROFILE_SESSION=${shellQuote(profile.session)}`,
		`GHOSTBUS_PROFILE_WORKDIR=${shellQuote(profile.workdir)}`,
		`GHOSTBUS_PROFILE_LAYOUT=${shellQuote(profile.layout)}`,
		`GHOSTBUS_PROFILE_LIFECYCLE=${shellQuote(profile.lifecycle)}`,
		`GHOSTBUS_PROFILE_ROLES=(${names.map(shellQuote).join(" ")})`,
		`GHOSTBUS_PROFILE_COMMANDS=(${commands.map(shellQuote).join(" ")})`,
		`GHOSTBUS_PROFILE_PROMPTS=(${prompts.map(shellQuote).join(" ")})`,
	].join("\n");
};

const main = (argv) => {
	let mode = "roles";
	let name = "";
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--shell") mode = "shell";
		else if (arg === "--json") mode = "json";
		else if (arg === "--roles") mode = "roles";
		else if (arg === "--source") mode = "source";
		else if (arg === "--profile") name = argv[++i] || "";
		else if (arg.startsWith("--profile=")) name = arg.slice("--profile=".length);
		else {
			process.stderr.write(`ghostbus-profile: unknown argument ${arg}\n`);
			return 2;
		}
	}

	let profile;
	try {
		profile = resolveProfile({ name });
	} catch (error) {
		process.stderr.write(`ghostbus-profile: ${error.message}\n`);
		return 1;
	}

	if (mode === "shell") process.stdout.write(`${emitShell(profile)}\n`);
	else if (mode === "json") process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
	else if (mode === "source") process.stdout.write(`${profile.source}\n`);
	else process.stdout.write(`${profile.panes.map((p) => p.name).join("\n")}\n`);
	return 0;
};

module.exports = { parseToml, resolveProfile, emitShell, builtinProfile, findConfig, shellQuote };

if (require.main === module) process.exit(main(process.argv.slice(2)));
