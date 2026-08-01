// The installers write into files that belong to the USER — their settings.json, their
// AGENTS.md. The failure that matters here is not "the hook did not fire", it is "the
// user's file was damaged", and that one is silent. So these drive the real functions
// against real temp directories and assert the destructive edges: backups happen, foreign
// content survives, a malformed file is refused rather than clobbered, and uninstall puts
// things back.
//
// Every installer takes explicit paths, so none of this spawns a process or touches $HOME.
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editJsonFile, SettingsParseError, writeTextWithBackup } from "../src/install/json-edit.js";
import { claudeCodeWired, CLAUDE_MARKER, installClaudeCode, uninstallClaudeCode } from "../src/install/claude-code.js";
import { agentsMdBlock, agentsMdPath, agentsMdWired, installAgentsMd, uninstallAgentsMd } from "../src/install/agents-md.js";
import { ALL_TARGETS, parseTargets } from "../src/install/index.js";
import { BLOCK_BEGIN, BLOCK_END } from "../src/install/text-edit.js";
import { CODEX_MARKER, codexHooksEnabled, codexWired, enableHooksFeature, installCodex, uninstallCodex } from "../src/install/codex.js";
import { installOpencode, opencodeWired, uninstallOpencode } from "../src/install/opencode.js";
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
