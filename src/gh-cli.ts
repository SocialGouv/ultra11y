// The `gh` BINARY ADAPTER — nothing else. Shelling out is how ultra11y talks to GitHub
// without an npm dependency and without ever holding a token: `gh` handles its own auth.
//
// This module imports nothing from ultra11y on purpose, so it can be shared by the two
// unrelated things that need `gh` — the sticky PR comment (src/pr-comment.ts, a report
// surface) and the GitHub ticket provider (src/tickets/providers/github.ts) — without
// creating a cycle or making either depend on the other.
import { execFileSync } from "node:child_process";

/** Run `gh` and return its stdout. Captures stderr (pipe, not ignore) so a failed call
 *  carries a surfaceable reason on the thrown error instead of vanishing. */
export function ghExec(args: string[], input?: string): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...(input !== undefined ? { input } : {}) });
}

/** Extract a concise, single-line failure reason from a thrown `gh` error — the first
 *  meaningful stderr line (where `gh` prints the API/auth error), else the error message. */
export function ghErrorReason(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { stderr?: unknown; message?: unknown };
  const stderr = typeof e.stderr === "string" ? e.stderr : Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : "";
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (line) return line;
  if (typeof e.message === "string" && e.message) return e.message.split("\n")[0]!.trim() || undefined;
  return undefined;
}

/** Is the `gh` CLI installed AND authenticated here? */
export function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
