// THE E2E INTEGRATION CORE — the Node half every test-runner plugin shares.
//
// Auditing a page during YOUR test run beats launching a second browser afterwards: `scan`
// starts a fresh app with none of the state your test just built (no login, no filled form,
// no opened modal). The integration inverts it — the audit runs on the page as your test
// left it.
//
// What the plugins do is deliberately almost nothing. Two steps per checked page:
//   1. collect the page IN THE BROWSER with the engine's own collector (COLLECT_SNAPSHOT —
//      never a copy), and
//   2. pipe the payload to `ultra11y snapshot write`, which persists the snapshot AND
//      audits it, returning the AuditResult.
// So a plugin holds NO knowledge of the snapshot format, the provenance comment or the
// audit. It is a pipe. There is nothing here to keep in sync with the engine.
//
// This module is the published implementation (`ultra11y/playwright`, `ultra11y/cypress`).
// `render --e2e` still writes install-free fixtures for repos that do not depend on
// ultra11y, and those fixtures interpolate the tables below rather than restating them —
// see e2e.ts, and tests/e2e-core-sync.test.ts which runs both over the same findings.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import type { AuditLike, SnapshotPayload } from "./payload.js";

// Re-exported so a Node-side consumer needs one import, not two.
export * from "./payload.js";

/** Where the engine lives, in order: the ULTRA11Y env override (same convention as the git
 *  hook), then the bundle shipped inside this very package. A published plugin resolves its
 *  own engine, so a project can never end up piping to a different build than the one it
 *  installed. */
export function enginePath(): string {
  if (process.env.ULTRA11Y) return process.env.ULTRA11Y;
  try {
    return createRequire(import.meta.url).resolve("ultra11y/scripts/ultra11y.mjs");
  } catch {
    // Running from the repo itself (dist/ sits one level under the root) or from a tarball
    // whose package.json exports are not resolvable — fall back to the relative bundle.
    return new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
  }
}

/** Persist a collected page as a snapshot and audit it. Returns the AuditResult.
 *  Spawning is deliberate: the engine writes files, which is not something a test process
 *  should be doing inline, and it keeps the plugin free of every engine dependency. */
export function auditSnapshot(payload: SnapshotPayload, engine = enginePath()): AuditLike {
  const res = spawnSync(process.execPath, [engine, "snapshot", "write", "--json"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 192 * 1024 * 1024,
  });
  if (res.error) throw new Error(`ultra11y: could not run the engine at ${engine} — ${res.error.message}`);
  if (!res.stdout) throw new Error(`ultra11y: the engine produced no output (exit ${res.status})\n${res.stderr || ""}`);
  try {
    return JSON.parse(res.stdout) as AuditLike;
  } catch {
    throw new Error(`ultra11y: could not parse the engine output\n${res.stdout.slice(0, 500)}`);
  }
}

/** Write the per-page report for everything captured so far. Opt-in (`report: true`), and
 *  never fatal: a reporting failure must not turn a passing test red. */
export function writePagesReport(opts: { out?: string; standard?: string; lang?: string; split?: boolean } = {}, engine = enginePath()): string | undefined {
  const args = [engine, "pages", "--in", "-", "--format", "report"];
  if (opts.split !== false) args.push("--split", "page");
  args.push("--out", opts.out ?? "audits/pages");
  if (opts.standard) args.push("--standard", opts.standard);
  if (opts.lang) args.push("--lang", opts.lang);
  // The report is rebuilt from an audit of the pages tree, so ask the engine for that audit
  // first and pipe it in — the plugin never assembles an AuditResult itself.
  const audit = spawnSync(process.execPath, [engine, "audit", ".ultra11y/pages", "--json"], { encoding: "utf8", maxBuffer: 192 * 1024 * 1024 });
  if (audit.error || !audit.stdout) return undefined;
  const res = spawnSync(process.execPath, args, { input: audit.stdout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) return undefined;
  return res.stdout.trim() || undefined;
}
