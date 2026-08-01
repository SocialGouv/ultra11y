// The multi-harness surface is three files that must agree about what a "shell tool" is,
// and none of them can import the others:
//
//   src/hook.ts             isShellTool — the precise check, inside the bundle
//   hooks/pre-tool-use.mjs  a cheap anchored regex, because it runs before the bundle exists
//   hooks/hooks.json        a matcher string, because the harness filters before we run
//
// Three copies of one fact drift. So instead of trusting discipline, this reads the two
// non-importable ones as TEXT, extracts their regexes, and holds them against the engine's
// own answer. The prefilter literal shared with the OpenCode plugin is checked the same way.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isShellTool } from "../src/hook.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(repoRoot, ...p), "utf8");

// Every name the engine accepts, plus the ones it must keep out. `BashOutput`/`KillShell`
// are the dangerous half: they poll a background shell, so a substring match would spawn
// the 2.5 MB engine on every tick.
const SHELLS = ["Bash", "bash", "shell", "exec", "exec_command", "local_shell", "localshell", "run_command"];
const NOT_SHELLS = ["BashOutput", "KillShell", "Read", "Grep", "Write", "NotebookEdit"];

describe("hooks/pre-tool-use.mjs stays in step with isShellTool", () => {
  const guard = read("hooks", "pre-tool-use.mjs");
  const literal = guard.match(/\/(\^\(\?:bash[^/]*)\/i/)?.[1];

  it("still carries an anchored, case-insensitive shell-name regex", () => {
    expect(literal, "the guard's shell-name regex moved or changed shape — update this oracle").toBeTruthy();
  });

  const re = new RegExp(literal as string, "i");
  for (const n of SHELLS) it(`accepts ${n}, as the engine does`, () => expect(re.test(n)).toBe(isShellTool(n)));
  for (const n of NOT_SHELLS) it(`rejects ${n}, as the engine does`, () => expect(re.test(n)).toBe(isShellTool(n)));
});

describe("hooks/hooks.json matcher covers every shell the engine accepts", () => {
  const hooks = JSON.parse(read("hooks", "hooks.json"));
  const matcher: string = hooks.hooks.PreToolUse[0].matcher;
  const re = new RegExp(matcher);

  // The matcher is deliberately WIDER than the guard: the harness may test it as a
  // substring, and a name that slips through only costs a bare Node start before the
  // guard's anchored regex rejects it. What it must never do is miss a real shell.
  for (const n of SHELLS) it(`matches ${n}`, () => expect(re.test(n)).toBe(true));

  it("does not reach for tools that are not shells at all", () => {
    for (const n of ["Read", "Grep", "Write", "NotebookEdit"]) expect(re.test(n)).toBe(false);
  });
});

describe("the two-stage prefilter cannot drift", () => {
  // Stage 0 runs on every shell call in both transports. If the guard and the OpenCode
  // plugin ever disagree about it, one harness silently reviews less than the other.
  const PREFILTER = String.raw`/\bgit\b|\bgh\b/`;

  it("hooks/pre-tool-use.mjs carries the shared literal", () => {
    expect(read("hooks", "pre-tool-use.mjs")).toContain(PREFILTER);
  });
});
