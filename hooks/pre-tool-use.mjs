#!/usr/bin/env node
// The plugin's PreToolUse guard — deliberately tiny.
//
// No harness has a git-aware hook event, so this runs on EVERY shell tool call. The engine
// next to it is a 2.4 MB bundle; parsing that before each shell command would be an
// unacceptable tax on a session. So the split is: this file pays only a bare Node start
// and answers "could this possibly be a publishing command?", and the engine — spawned
// only when the answer is yes — makes the real decision (src/hook.ts).
//
// The prefilter is intentionally OVER-permissive: it matches any command mentioning git
// or gh at all. Precision lives in one place, `matchGitIntent`, so the two cannot drift.
//
// Shared by Claude Code and Codex: both set ${CLAUDE_PLUGIN_ROOT}, use the same PreToolUse
// payload fields and read the same `hookSpecificOutput` envelope.
//
// Contract with the harness: print the hook JSON on stdout to act, print nothing to stay
// out of the way. Exit code is ALWAYS 0 — a guard that errors out on a user's `git push`
// is worse than no guard, so every failure path here is silence.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  // Anchored so `BashOutput`/`KillShell` (background-shell polls) never reach the engine,
  // but deliberately loose about WHICH shell: `Bash` on Claude Code, `shell` and friends on
  // Codex. `isShellTool` in src/hook.ts is the precise check; tests/harness-sync.test.ts
  // asserts this regex accepts exactly the same names.
  if (!/^(?:bash|shell|exec|exec_command|local_?shell|run_command)$/i.test(String(payload.tool_name ?? ""))) process.exit(0);
  // Codex passes an argv array. Joining it is WRONG for deciding intent (see `commandOf`)
  // but exactly right here, where the only question is whether the words appear at all —
  // and the payload is forwarded untouched, so the engine re-parses it properly.
  const raw = payload.tool_input?.command;
  const command = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join(" ") : "";
  // Prefilter: no mention of git or gh ⇒ nothing to do, and we never touched the engine.
  if (!/\bgit\b|\bgh\b/.test(command)) process.exit(0);

  const here = dirname(fileURLToPath(import.meta.url));
  // The engine ships inside the review-a11y skill of this same plugin; the repo checkout
  // keeps its own copy at the root. Both are the same bytes (scripts/copy-bundle.mjs).
  const engine = [join(here, "..", "skills", "review-a11y", "scripts", "ultra11y.mjs"), join(here, "..", "scripts", "ultra11y.mjs")].find((p) => existsSync(p));
  if (!engine) process.exit(0);

  const run = spawnSync(process.execPath, [engine, "hook", "--claude-code"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const out = (run.stdout ?? "").trim();
  // Only ever forward something that parses as the expected decision — a stray warning on
  // stdout must not reach Claude Code as a malformed hook response.
  if (out.startsWith("{") && out.includes("hookSpecificOutput")) process.stdout.write(out);
} catch {
  /* unreadable payload, spawn failure, timeout — say nothing */
}
process.exit(0);
