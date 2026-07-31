#!/usr/bin/env node
// The plugin's PreToolUse guard — deliberately tiny.
//
// Claude Code has no git-aware hook event, so this runs on EVERY Bash tool call. The
// engine next to it is a 2.4 MB bundle; parsing that before each shell command would be
// an unacceptable tax on a session. So the split is: this file pays only a bare Node
// start and answers "could this possibly be a publishing command?", and the engine —
// spawned only when the answer is yes — makes the real decision (src/hook.ts).
//
// The prefilter is intentionally OVER-permissive: it matches any command mentioning git
// or gh at all. Precision lives in one place, `matchGitIntent`, so the two cannot drift.
//
// Contract with Claude Code: print the hook JSON on stdout to act, print nothing to stay
// out of the way. Exit code is ALWAYS 0 — a guard that errors out on a user's `git push`
// is worse than no guard, so every failure path here is silence.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  if (payload.tool_name !== "Bash") process.exit(0);
  const command = payload.tool_input?.command ?? "";
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
