"use strict";

/**
 * The profile resolver, and above all its REFUSALS. A config parser that skips
 * what it cannot read hands back a profile missing the pane you asked for and
 * reports success, so most of what is asserted here is that a bad config
 * throws rather than degrades.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { parseToml, resolveProfile, emitShell, shellQuote, builtinProfile } = require("../src/profile.cjs");

const repoRoot = path.join(__dirname, "..");

/** Resolve against a temp config, with the real one out of the way. */
const withConfig = (body, run) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghostbus-test-"));
	const file = path.join(dir, "config.toml");
	fs.writeFileSync(file, body);
	const saved = process.env.GHOSTBUS_CONFIG;
	process.env.GHOSTBUS_CONFIG = file;
	try {
		return run(file);
	} finally {
		if (saved === undefined) delete process.env.GHOSTBUS_CONFIG;
		else process.env.GHOSTBUS_CONFIG = saved;
		fs.rmSync(dir, { recursive: true, force: true });
	}
};

const twoPanes = `
default_profile = "pair"
[profiles.pair]
session = "gb-pair"
[[profiles.pair.panes]]
name = "left"
[[profiles.pair.panes]]
name = "right"
`;

test("a profile with two panes resolves to two panes", () => {
	withConfig(twoPanes, () => {
		const profile = resolveProfile();
		// THE REGRESSION THIS FILE EXISTS FOR. The pane count was four, in a
		// bash array and two JS arrays, and nothing read the config at all.
		assert.equal(profile.panes.length, 2);
		assert.deepEqual(profile.panes.map((p) => p.name), ["left", "right"]);
		assert.equal(profile.session, "gb-pair");
	});
});

test("a profile with six panes resolves to six", () => {
	const panes = ["a1", "a2", "a3", "a4", "a5", "a6"];
	const body = `default_profile = "six"\n[profiles.six]\n${panes
		.map((n) => `[[profiles.six.panes]]\nname = "${n}"\n`)
		.join("")}`;
	withConfig(body, () => {
		assert.deepEqual(resolveProfile().panes.map((p) => p.name), panes);
	});
});

test("the tracked example config parses", () => {
	const file = path.join(repoRoot, "config.example.toml");
	const saved = process.env.GHOSTBUS_CONFIG;
	process.env.GHOSTBUS_CONFIG = file;
	try {
		const profile = resolveProfile();
		assert.equal(profile.panes.length, 4);
		assert.ok(profile.panes.every((p) => /^[A-Za-z0-9_-]+$/.test(p.name)));
	} finally {
		if (saved === undefined) delete process.env.GHOSTBUS_CONFIG;
		else process.env.GHOSTBUS_CONFIG = saved;
	}
});

test("the built-in profile carries nobody's real agent names", () => {
	// It used to be one person's four agent names, in a tool other people run.
	assert.deepEqual(builtinProfile.panes.map((p) => p.name), ["agent1", "agent2", "agent3", "agent4"]);
});

test("a named profile can be chosen over the default", () => {
	const body = `${twoPanes}\n[profiles.solo]\n[[profiles.solo.panes]]\nname = "only"\n`;
	withConfig(body, () => {
		assert.deepEqual(resolveProfile({ name: "solo" }).panes.map((p) => p.name), ["only"]);
		assert.deepEqual(resolveProfile().panes.map((p) => p.name), ["left", "right"]);
	});
});

test("a profile with no panes is refused, not treated as empty", () => {
	withConfig(`default_profile = "x"\n[profiles.x]\nsession = "s"\n`, () => {
		assert.throws(() => resolveProfile(), /declares no \[\[profiles\.x\.panes\]\]/);
	});
});

test("a duplicate pane name is refused", () => {
	withConfig(
		`default_profile = "d"\n[profiles.d]\n[[profiles.d.panes]]\nname = "same"\n[[profiles.d.panes]]\nname = "same"\n`,
		() => assert.throws(() => resolveProfile(), /names the pane "same" twice/),
	);
});

test("an unknown profile name is refused and lists what exists", () => {
	withConfig(twoPanes, () => {
		assert.throws(() => resolveProfile({ name: "nope" }), /no profile "nope".*profiles are pair/s);
	});
});

test("a pane name that cannot be addressed is refused", () => {
	for (const bad of ["two words", "semi;colon", "$(whoami)", ""]) {
		withConfig(`default_profile = "b"\n[profiles.b]\n[[profiles.b.panes]]\nname = "${bad}"\n`, () => {
			assert.throws(() => resolveProfile(), /needs a name|must be letters/);
		});
	}
});

test("a bad lifecycle is refused", () => {
	withConfig(
		`default_profile = "l"\n[profiles.l]\nlifecycle = "forever"\n[[profiles.l.panes]]\nname = "a"\n`,
		() => assert.throws(() => resolveProfile(), /lifecycle must be ephemeral or persistent/),
	);
});

test("a config with no profiles table is refused", () => {
	withConfig(`default_profile = "x"\n`, () => {
		assert.throws(() => resolveProfile(), /no \[profiles\.<name>\] table/);
	});
});

test("a default_profile that is absent and unnamed is refused", () => {
	withConfig(`[profiles.only]\n[[profiles.only.panes]]\nname = "a"\n`, () => {
		assert.throws(() => resolveProfile(), /no default_profile and none given/);
	});
});

test("an unsupported value is refused rather than skipped", () => {
	// An inline table parses to something plausible and wrong under a naive
	// reader, and a skipped line is a setting that silently did not apply.
	assert.throws(() => parseToml(`a = { b = 1 }`), /unsupported value/);
	assert.throws(() => parseToml(`a = bareword`), /unsupported value/);
	assert.throws(() => parseToml(`just some prose`), /not a key, a table or a comment/);
});

test("a # inside a quoted value is kept, and one outside is a comment", () => {
	// The same trap that ate a documented file format elsewhere: a bare # in
	// plain text opens a comment and discards the rest of the line.
	const parsed = parseToml(`a = "keep # this"\nb = "plain" # dropped\n`);
	assert.equal(parsed.a, "keep # this");
	assert.equal(parsed.b, "plain");
});

test("array-of-tables keeps order and does not merge entries", () => {
	const parsed = parseToml(
		`[[p.panes]]\nname = "one"\ncommand = "x"\n[[p.panes]]\nname = "two"\n`,
	);
	assert.equal(parsed.p.panes.length, 2);
	assert.deepEqual(parsed.p.panes.map((e) => e.name), ["one", "two"]);
	// The second entry must not inherit the first's command.
	assert.equal(parsed.p.panes[1].command, undefined);
});

test("a pane command defaults to the shell, and prompt to empty", () => {
	withConfig(twoPanes, () => {
		const [left] = resolveProfile().panes;
		assert.equal(left.command, "$SHELL");
		assert.equal(left.prompt, "");
	});
});

test("shell emission quotes a value that would otherwise break the eval", () => {
	assert.equal(shellQuote("it's"), `'it'\\''s'`);
	const emitted = emitShell({
		name: "x",
		source: "s",
		session: "s",
		workdir: "/tmp",
		layout: "tiled",
		lifecycle: "ephemeral",
		panes: [{ name: "a", command: "echo 'hi'; rm -rf /", prompt: "" }],
	});
	// The command reaches bash as one quoted word, so the `;` cannot run.
	assert.match(emitted, /GHOSTBUS_PROFILE_COMMANDS=\('echo '\\''hi'\\''; rm -rf \/'\)/);
});
