// The installers write into files that belong to the USER — their settings.json, their
// AGENTS.md. The failure that matters here is not "the hook did not fire", it is "the
// user's file was damaged", and that one is silent. So these drive the real functions
// against real temp directories and assert the destructive edges: backups happen, foreign
// content survives, a malformed file is refused rather than clobbered, and uninstall puts
// things back.
//
// Every installer takes explicit paths, so none of this touches $HOME; the one CLI block at
// the end spawns the engine under a temporary HOME/XDG_CONFIG_HOME.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editJsonFile, SettingsParseError, writeTextWithBackup } from "../src/install/json-edit.js";
import { claudeCodeWired, CLAUDE_MARKER, installClaudeCode, uninstallClaudeCode } from "../src/install/claude-code.js";
import { agentsMdBlock, agentsMdPath, agentsMdWired, installAgentsMd, uninstallAgentsMd } from "../src/install/agents-md.js";
import { ALL_TARGETS, parseTargets } from "../src/install/index.js";
import { BLOCK_BEGIN, BLOCK_END } from "../src/install/text-edit.js";
import { CODEX_MARKER, codexHooksEnabled, codexWired, enableHooksFeature, installCodex, uninstallCodex } from "../src/install/codex.js";
import {
  detectOpencodeMajor,
  installOpencode,
  opencodeWired,
  parseOpencodeMajorFlag,
  parseOpencodeVersion,
  uninstallOpencode,
} from "../src/install/opencode.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** `codexHooksEnabled` reads a file; this asserts the same thing about a string. */
function codexHooksEnabledIn(content: string): boolean {
  const d = mkdtempSync(join(tmpdir(), "u11y-toml-"));
  tmps.push(d);
  writeFileSync(join(d, "config.toml"), content);
  return codexHooksEnabled(d);
}

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "u11y-install-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const COMMAND = 'node "/opt/ultra11y.mjs"';

describe("editJsonFile", () => {
  it("creates the file and its parent directory", () => {
    const p = join(tmp(), "nested", "settings.json");
    const r = editJsonFile(p, (root) => {
      root.a = 1;
    });
    expect(r.changed).toBe(true);
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual({ a: 1 });
  });

  it("reports no change, and takes no second backup, when the edit is a no-op", () => {
    const d = tmp();
    const p = join(d, "settings.json");
    editJsonFile(p, (root) => {
      root.a = 1;
    });
    const second = editJsonFile(p, (root) => {
      root.a = 1;
    });
    expect(second.changed).toBe(false);
    expect(second.backup).toBeUndefined();
    expect(readdirSync(d).filter((f) => f.includes("backup"))).toEqual([]);
  });

  it("backs the file up before overwriting it", () => {
    const d = tmp();
    const p = join(d, "settings.json");
    writeFileSync(p, '{"a":1}\n');
    const r = editJsonFile(p, (root) => {
      root.a = 2;
    });
    expect(r.backup).toBeTruthy();
    expect(JSON.parse(readFileSync(r.backup as string, "utf8"))).toEqual({ a: 1 });
  });

  it("leaves no temporary file behind", () => {
    const d = tmp();
    editJsonFile(join(d, "settings.json"), (root) => {
      root.a = 1;
    });
    expect(readdirSync(d).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a malformed file instead of clobbering it", () => {
    const d = tmp();
    const p = join(d, "settings.json");
    writeFileSync(p, "{ this is not json");
    expect(() =>
      editJsonFile(p, (root) => {
        root.a = 1;
      }),
    ).toThrow(SettingsParseError);
    // The user's bytes are still there — that is the whole point.
    expect(readFileSync(p, "utf8")).toBe("{ this is not json");
  });

  it("refuses a file whose top level is not an object", () => {
    const d = tmp();
    const p = join(d, "settings.json");
    writeFileSync(p, "[1,2,3]");
    expect(() => editJsonFile(p, () => {})).toThrow(SettingsParseError);
  });

  it("treats an empty file as an empty object rather than an error", () => {
    const d = tmp();
    const p = join(d, "settings.json");
    writeFileSync(p, "");
    expect(
      editJsonFile(p, (root) => {
        root.a = 1;
      }).changed,
    ).toBe(true);
  });
});

describe("writeTextWithBackup", () => {
  it("is a no-op when the content already matches", () => {
    const d = tmp();
    const p = join(d, "f.txt");
    writeFileSync(p, "same");
    expect(writeTextWithBackup(p, "same").changed).toBe(false);
    expect(readdirSync(d)).toEqual(["f.txt"]);
  });
});

describe("installClaudeCode", () => {
  it("wires a PreToolUse hook carrying the ownership marker", () => {
    const p = join(tmp(), "settings.json");
    installClaudeCode({ settingsPath: p, command: COMMAND });
    const root = JSON.parse(readFileSync(p, "utf8"));
    expect(root.hooks.PreToolUse).toHaveLength(1);
    expect(root.hooks.PreToolUse[0].hooks[0].command).toContain(CLAUDE_MARKER);
    expect(root.hooks.PreToolUse[0].matcher).toContain("Bash");
    expect(claudeCodeWired(p)).toBe(1);
  });

  it("is idempotent — a second install does not stack a second copy", () => {
    const p = join(tmp(), "settings.json");
    installClaudeCode({ settingsPath: p, command: COMMAND });
    installClaudeCode({ settingsPath: p, command: COMMAND });
    expect(claudeCodeWired(p)).toBe(1);
  });

  it("leaves a user's own PreToolUse hook byte-identical, on install and on uninstall", () => {
    const p = join(tmp(), "settings.json");
    const foreign = { matcher: "Write", hooks: [{ type: "command", command: "echo mine", timeout: 5 }] };
    writeFileSync(p, `${JSON.stringify({ hooks: { PreToolUse: [foreign] }, theme: "dark" }, null, 2)}\n`);

    installClaudeCode({ settingsPath: p, command: COMMAND });
    let root = JSON.parse(readFileSync(p, "utf8"));
    expect(root.hooks.PreToolUse).toContainEqual(foreign);
    expect(root.theme).toBe("dark");

    uninstallClaudeCode({ settingsPath: p });
    root = JSON.parse(readFileSync(p, "utf8"));
    expect(root.hooks.PreToolUse).toEqual([foreign]);
    expect(root.theme).toBe("dark");
    expect(claudeCodeWired(p)).toBe(0);
  });

  it("removes the hooks key entirely when ours was the only one", () => {
    const p = join(tmp(), "settings.json");
    installClaudeCode({ settingsPath: p, command: COMMAND });
    uninstallClaudeCode({ settingsPath: p });
    expect(JSON.parse(readFileSync(p, "utf8")).hooks).toBeUndefined();
  });

  it("reports nothing wired for a missing or broken settings file", () => {
    const d = tmp();
    expect(claudeCodeWired(join(d, "nope.json"))).toBe(0);
    const broken = join(d, "broken.json");
    writeFileSync(broken, "{{{");
    expect(claudeCodeWired(broken)).toBe(0);
  });
});

describe("installAgentsMd", () => {
  it("creates AGENTS.md with both markers", () => {
    const d = tmp();
    installAgentsMd(d);
    const text = readFileSync(agentsMdPath(d), "utf8");
    expect(text).toContain(BLOCK_BEGIN);
    expect(text).toContain(BLOCK_END);
    expect(agentsMdWired(d)).toBe(true);
  });

  it("is idempotent — running twice leaves the file byte-identical", () => {
    const d = tmp();
    installAgentsMd(d);
    const first = readFileSync(agentsMdPath(d), "utf8");
    const second = installAgentsMd(d);
    expect(second.changed).toBe(false);
    expect(readFileSync(agentsMdPath(d), "utf8")).toBe(first);
  });

  it("appends after the user's prose without rewriting a byte of it", () => {
    const d = tmp();
    const prose = "# My project\n\nRun the tests with `make test`.\n";
    writeFileSync(agentsMdPath(d), prose);
    installAgentsMd(d);
    const text = readFileSync(agentsMdPath(d), "utf8");
    expect(text.startsWith(prose)).toBe(true);
    expect(text).toContain(BLOCK_BEGIN);
  });

  it("replaces a stale block in place rather than appending a second one", () => {
    const d = tmp();
    writeFileSync(agentsMdPath(d), `intro\n\n${BLOCK_BEGIN}\nold and wrong\n${BLOCK_END}\n`);
    installAgentsMd(d);
    const text = readFileSync(agentsMdPath(d), "utf8");
    expect(text).not.toContain("old and wrong");
    expect(text.match(new RegExp(BLOCK_BEGIN.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(text.startsWith("intro")).toBe(true);
  });

  it("uninstall removes the block and keeps the user's prose", () => {
    const d = tmp();
    const prose = "# My project\n\nRun the tests with `make test`.\n";
    writeFileSync(agentsMdPath(d), prose);
    installAgentsMd(d);
    uninstallAgentsMd(d);
    expect(readFileSync(agentsMdPath(d), "utf8")).toBe(prose);
  });

  it("uninstall deletes the file when the block was all it held", () => {
    const d = tmp();
    installAgentsMd(d);
    uninstallAgentsMd(d);
    expect(existsSync(agentsMdPath(d))).toBe(false);
  });

  it("uninstall is a no-op on a file that was never ours", () => {
    const d = tmp();
    writeFileSync(agentsMdPath(d), "someone else's notes\n");
    expect(uninstallAgentsMd(d).changed).toBe(false);
    expect(readFileSync(agentsMdPath(d), "utf8")).toBe("someone else's notes\n");
  });

  describe("the block itself", () => {
    const body = agentsMdBlock("/nowhere");

    it("names the two scopes an agent has to choose between", () => {
      expect(body).toContain("--staged --graph");
      expect(body).toContain("--since origin/main --graph");
    });

    it("carries the guardrail against invented non-conformities", () => {
      expect(body).toContain("Never invent a non-conformity");
      expect(body).toContain("check --report");
    });

    it("says plainly that residual risks are not conformance", () => {
      expect(body).toContain("residual risks");
      expect(body).toContain("Never call them conforming");
    });

    it("points at the repo gate, which is what actually enforces anything there", () => {
      expect(body).toContain("init --hook");
    });

    it("resolves to an invocation that works from another machine", () => {
      // A bare absolute path would be meaningless to whoever reads AGENTS.md next.
      expect(body).toContain("npx -y ultra11y");
    });
  });
});

describe("installCodex", () => {
  it("wires a PreToolUse hook and turns the feature flag on", () => {
    const d = tmp();
    installCodex({ codexDir: d, command: COMMAND });
    const hooks = JSON.parse(readFileSync(join(d, "hooks.json"), "utf8"));
    expect(hooks.hooks.PreToolUse[0].hooks[0].command).toContain(CODEX_MARKER);
    expect(hooks.hooks.PreToolUse[0].hooks[0].statusMessage).toBe("ultra11y");
    expect(hooks.hooks.PreToolUse[0].matcher).toContain("shell");
    expect(codexWired(d)).toBe(1);
    // A hook Codex will never run is the silent failure this flag causes.
    expect(codexHooksEnabled(d)).toBe(true);
  });

  it("is idempotent", () => {
    const d = tmp();
    installCodex({ codexDir: d, command: COMMAND });
    installCodex({ codexDir: d, command: COMMAND });
    expect(codexWired(d)).toBe(1);
  });

  it("leaves a user's own Codex hook alone, on install and on uninstall", () => {
    const d = tmp();
    const foreign = { matcher: "Edit", hooks: [{ type: "command", command: "node mine.mjs", timeout: 5 }] };
    writeFileSync(join(d, "hooks.json"), `${JSON.stringify({ hooks: { PreToolUse: [foreign] } }, null, 2)}\n`);
    installCodex({ codexDir: d, command: COMMAND });
    uninstallCodex({ codexDir: d });
    expect(JSON.parse(readFileSync(join(d, "hooks.json"), "utf8")).hooks.PreToolUse).toEqual([foreign]);
  });

  it("leaves `[features] hooks = true` enabled on uninstall", () => {
    // Other tools' hooks depend on that flag; turning it off would disable them too.
    const d = tmp();
    installCodex({ codexDir: d, command: COMMAND });
    uninstallCodex({ codexDir: d });
    expect(codexHooksEnabled(d)).toBe(true);
    expect(codexWired(d)).toBe(0);
  });

  it("reports a wired-but-inert home, where the hook exists and can never run", () => {
    const d = tmp();
    installCodex({ codexDir: d, command: COMMAND });
    writeFileSync(join(d, "config.toml"), "[features]\nhooks = false\n");
    expect(codexWired(d)).toBe(1);
    expect(codexHooksEnabled(d)).toBe(false);
  });
});

describe("enableHooksFeature", () => {
  const cases: Array<[string, string, boolean]> = [
    ["an empty config", "", true],
    ["a config with no [features] table", 'model = "gpt-5"\n', true],
    ["an existing empty [features] table", "[features]\n", true],
    ["[features] with other keys", "[features]\nmulti_agent = true\n", true],
    ["hooks explicitly disabled", "[features]\nhooks = false\n", true],
  ];
  for (const [label, input, shouldChange] of cases) {
    it(`turns hooks on given ${label}`, () => {
      const r = enableHooksFeature(input);
      expect(r.changed).toBe(shouldChange);
      expect(codexHooksEnabledIn(r.content)).toBe(true);
    });
  }

  it("is a no-op when hooks are already on", () => {
    expect(enableHooksFeature("[features]\nhooks = true\n").changed).toBe(false);
  });

  it("keeps the user's other settings byte-for-byte", () => {
    const original = '# my notes\nmodel = "gpt-5"\n\n[projects."/x"]\ntrust_level = "trusted"\n';
    const r = enableHooksFeature(original);
    expect(r.content).toContain(original);
  });

  it("does not mistake a `hooks` key under another table for ours", () => {
    // `[features]` is the only table where a bare `hooks = true` means what we want.
    const other = "[somethingelse]\nhooks = true\n";
    const r = enableHooksFeature(other);
    expect(r.changed).toBe(true);
    expect(r.content).toContain("[features]");
  });
});

describe("installOpencode", () => {
  const pluginSource = join(dirname(fileURLToPath(import.meta.url)), "..", ".opencode", "plugins", "ultra11y.js");

  it("writes the plugin where OpenCode looks for it", () => {
    const d = tmp();
    installOpencode({ configDir: d, pluginSource });
    const written = readFileSync(join(d, "plugin", "ultra11y.js"), "utf8");
    expect(written).toBe(readFileSync(pluginSource, "utf8"));
    expect(opencodeWired(d)).toBe(true);
  });

  it("is idempotent", () => {
    const d = tmp();
    installOpencode({ configDir: d, pluginSource });
    const second = installOpencode({ configDir: d, pluginSource });
    expect(second.reports.every((r) => !r.changed)).toBe(true);
  });

  it("refuses to overwrite a plugin file that is not ours", () => {
    const d = tmp();
    mkdirSync(join(d, "plugin"), { recursive: true });
    writeFileSync(join(d, "plugin", "ultra11y.js"), "// someone else's plugin\n");
    expect(() => installOpencode({ configDir: d, pluginSource })).toThrow(/refusing to overwrite/);
    expect(readFileSync(join(d, "plugin", "ultra11y.js"), "utf8")).toBe("// someone else's plugin\n");
  });

  it("uninstall removes the plugin it wrote", () => {
    const d = tmp();
    installOpencode({ configDir: d, pluginSource });
    uninstallOpencode({ configDir: d });
    expect(existsSync(join(d, "plugin", "ultra11y.js"))).toBe(false);
    expect(opencodeWired(d)).toBe(false);
  });

  it("recognises and removes the npm-pin route too", () => {
    const d = tmp();
    writeFileSync(join(d, "opencode.json"), `${JSON.stringify({ plugin: ["ultra11y@latest", "other@1"] }, null, 2)}\n`);
    expect(opencodeWired(d)).toBe(true);
    uninstallOpencode({ configDir: d });
    expect(JSON.parse(readFileSync(join(d, "opencode.json"), "utf8")).plugin).toEqual(["other@1"]);
  });

  describe("per OpenCode major", () => {
    it("OpenCode 1: plugin/ — the directory every V1 release scans", () => {
      const d = tmp();
      installOpencode({ configDir: d, pluginSource, major: 1 });
      expect(existsSync(join(d, "plugin", "ultra11y.js"))).toBe(true);
      expect(existsSync(join(d, "plugins", "ultra11y.js"))).toBe(false);
    });

    it("OpenCode 2: plugins/ — the directory V2 documents", () => {
      const d = tmp();
      const out = installOpencode({ configDir: d, pluginSource, major: 2 });
      expect(existsSync(join(d, "plugins", "ultra11y.js"))).toBe(true);
      expect(existsSync(join(d, "plugin", "ultra11y.js"))).toBe(false);
      expect(opencodeWired(d)).toBe(true);
      // The npm-pin alternative it points at uses V2's key, not V1's.
      expect(out.guidance.join("\n")).toContain('"plugins": ["ultra11y@latest"]');
      expect(out.guidance.join("\n")).not.toContain('"plugin": [');
    });

    it("an unknown major falls back to plugin/, which both majors read", () => {
      const d = tmp();
      installOpencode({ configDir: d, pluginSource, major: null });
      expect(existsSync(join(d, "plugin", "ultra11y.js"))).toBe(true);
    });

    it("moving from V1 to V2 removes OUR copy in plugin/, so the gate never loads twice", () => {
      const d = tmp();
      const engine = join(d, "engine.mjs");
      writeFileSync(engine, "// engine\n");
      installOpencode({ configDir: d, pluginSource, major: 1, enginePath: engine });
      expect(existsSync(join(d, "plugin", "ultra11y.mjs"))).toBe(true);
      const out = installOpencode({ configDir: d, pluginSource, major: 2, enginePath: engine });
      expect(existsSync(join(d, "plugin", "ultra11y.js"))).toBe(false);
      expect(existsSync(join(d, "plugin", "ultra11y.mjs"))).toBe(false);
      expect(existsSync(join(d, "plugins", "ultra11y.js"))).toBe(true);
      expect(existsSync(join(d, "plugins", "ultra11y.mjs"))).toBe(true);
      expect(out.guidance.join("\n")).toMatch(/moved/);
    });

    it("never removes a foreign ultra11y.js from the other directory", () => {
      const d = tmp();
      mkdirSync(join(d, "plugin"), { recursive: true });
      writeFileSync(join(d, "plugin", "ultra11y.js"), "// mine\n");
      installOpencode({ configDir: d, pluginSource, major: 2 });
      expect(readFileSync(join(d, "plugin", "ultra11y.js"), "utf8")).toBe("// mine\n");
    });

    it("refuses to overwrite a foreign plugins/ultra11y.js on V2", () => {
      const d = tmp();
      mkdirSync(join(d, "plugins"), { recursive: true });
      writeFileSync(join(d, "plugins", "ultra11y.js"), "// mine\n");
      expect(() => installOpencode({ configDir: d, pluginSource, major: 2 })).toThrow(/refusing to overwrite/);
      expect(readFileSync(join(d, "plugins", "ultra11y.js"), "utf8")).toBe("// mine\n");
    });

    it("warns when an npm pin would load the gate a second time", () => {
      const d = tmp();
      writeFileSync(join(d, "opencode.json"), `${JSON.stringify({ plugins: [{ package: "ultra11y@latest" }] }, null, 2)}\n`);
      const out = installOpencode({ configDir: d, pluginSource, major: 2 });
      expect(out.guidance.join("\n")).toMatch(/twice/);
    });

    it("recognises V2's `plugins` key, in string and object form, and uninstall drops both", () => {
      const d = tmp();
      writeFileSync(
        join(d, "opencode.json"),
        `${JSON.stringify({ plugins: ["ultra11y@latest", { package: "ultra11y", options: {} }, "other@1"] }, null, 2)}\n`,
      );
      expect(opencodeWired(d)).toBe(true);
      uninstallOpencode({ configDir: d });
      expect(JSON.parse(readFileSync(join(d, "opencode.json"), "utf8")).plugins).toEqual(["other@1"]);
      expect(opencodeWired(d)).toBe(false);
    });

    it("uninstall removes our copy from both directories", () => {
      const d = tmp();
      installOpencode({ configDir: d, pluginSource, major: 2 });
      mkdirSync(join(d, "plugin"), { recursive: true });
      writeFileSync(join(d, "plugin", "ultra11y.js"), readFileSync(pluginSource, "utf8"));
      uninstallOpencode({ configDir: d });
      expect(existsSync(join(d, "plugins", "ultra11y.js"))).toBe(false);
      expect(existsSync(join(d, "plugin", "ultra11y.js"))).toBe(false);
      expect(opencodeWired(d)).toBe(false);
    });
  });
});

describe("OpenCode major detection", () => {
  it("reads both majors' --version formats", () => {
    expect(parseOpencodeVersion("1.19.5\n")).toBe(1);
    expect(parseOpencodeVersion("opencode v2.2.5\n")).toBe(2);
    expect(parseOpencodeVersion("3.0.0")).toBe(2); // a later major speaks V2's API until told otherwise
    expect(parseOpencodeVersion("")).toBeNull();
    expect(parseOpencodeVersion("command not found")).toBeNull();
  });

  it("asks the opencode binary, and answers null when there is none", () => {
    expect(detectOpencodeMajor(() => ({ status: 0, stdout: "opencode v2.2.5\n" }))).toBe(2);
    expect(detectOpencodeMajor(() => ({ status: 0, stdout: "1.19.5\n" }))).toBe(1);
    expect(detectOpencodeMajor(() => ({ status: null, stdout: "", error: new Error("ENOENT") }))).toBeNull();
    expect(
      detectOpencodeMajor(() => {
        throw new Error("boom");
      }),
    ).toBeNull();
  });

  it("parses --opencode-version strictly", () => {
    expect(parseOpencodeMajorFlag(undefined)).toEqual({ major: undefined });
    expect(parseOpencodeMajorFlag("1")).toEqual({ major: 1 });
    expect(parseOpencodeMajorFlag("2")).toEqual({ major: 2 });
    expect(parseOpencodeMajorFlag("v2")).toEqual({ major: 2 });
    expect(parseOpencodeMajorFlag("3").error).toMatch(/1 or 2/);
    expect(parseOpencodeMajorFlag(true).error).toMatch(/1 or 2/);
  });
});

// Through the real CLI, against an isolated HOME/XDG_CONFIG_HOME: the flag parsing, the
// detection (a fake `opencode` first on PATH) and the per-major directory, end to end.
describe("ultra11y install --opencode (CLI)", () => {
  const cli = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "ultra11y.mjs");
  function run(args: string[], fakeVersion?: string) {
    const home = tmp();
    const bin = join(home, "bin");
    mkdirSync(bin, { recursive: true });
    if (fakeVersion !== undefined) {
      writeFileSync(join(bin, "opencode"), `#!/bin/sh\necho "${fakeVersion}"\n`, { mode: 0o755 });
    }
    const r = spawnSync(process.execPath, [cli, "install", "--opencode", "--no-skills", ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PATH: `${bin}:/usr/bin:/bin` },
    });
    return { ...r, configDir: join(home, ".config", "opencode") };
  }

  it("--opencode-version 2 writes plugins/", () => {
    const r = run(["--opencode-version", "2"]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(r.configDir, "plugins", "ultra11y.js"))).toBe(true);
    expect(r.stdout).toMatch(/OpenCode 2/);
  });

  it("--opencode-version 1 writes plugin/", () => {
    const r = run(["--opencode-version", "1"]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(r.configDir, "plugin", "ultra11y.js"))).toBe(true);
  });

  it.skipIf(process.platform === "win32")("detects the installed major from `opencode --version`", () => {
    const v2 = run([], "opencode v2.2.5");
    expect(v2.status, v2.stderr).toBe(0);
    expect(existsSync(join(v2.configDir, "plugins", "ultra11y.js"))).toBe(true);
    const v1 = run([], "1.19.5");
    expect(v1.status, v1.stderr).toBe(0);
    expect(existsSync(join(v1.configDir, "plugin", "ultra11y.js"))).toBe(true);
  });

  it("with no opencode on PATH, writes plugin/ — the directory both majors read", () => {
    const r = run([]);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(join(r.configDir, "plugin", "ultra11y.js"))).toBe(true);
    expect(r.stdout).toMatch(/both/);
  });

  it("rejects a bad --opencode-version without writing anything", () => {
    const r = run(["--opencode-version", "7"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/1 or 2/);
    expect(existsSync(r.configDir)).toBe(false);
  });
});

describe("parseTargets", () => {
  it("returns null when nothing was picked, so the CLI can print usage", () => {
    expect(parseTargets({})).toBeNull();
  });

  it("expands --all to the agent harnesses", () => {
    expect(parseTargets({ all: true })?.sort()).toEqual([...ALL_TARGETS].sort());
  });

  it("keeps --agents-md out of --all", () => {
    // It is the only target that writes a TRACKED file into the user's repository, so it
    // must never arrive as a side effect of asking for "everything".
    expect(parseTargets({ all: true })).not.toContain("agents-md");
    expect(ALL_TARGETS).not.toContain("agents-md");
  });

  it("unions --all with an explicit --agents-md", () => {
    const t = parseTargets({ all: true, "agents-md": true });
    expect(t).toContain("agents-md");
    expect(t).toHaveLength(ALL_TARGETS.length + 1);
  });

  it("does not duplicate a target named twice", () => {
    expect(parseTargets({ all: true, codex: true })).toHaveLength(ALL_TARGETS.length);
  });
});

describe("project scoping", () => {
  it("puts the Claude settings under the project when --project is used", async () => {
    const { claudeSettingsPath } = await import("../src/install/paths.js");
    const d = tmp();
    mkdirSync(join(d, ".claude"), { recursive: true });
    expect(claudeSettingsPath(true, d)).toBe(join(d, ".claude", "settings.json"));
    expect(claudeSettingsPath(false, d)).not.toContain(d);
  });
});
