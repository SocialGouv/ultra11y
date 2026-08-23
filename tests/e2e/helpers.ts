// Shared helpers for the end-to-end (E2E) tests. Unlike the rest of the suite —
// which imports functions from src/ — these spawn the SHIPPED bundle
// `scripts/ultra11y.mjs` as a real subprocess (`node scripts/ultra11y.mjs <cmd>`),
// exactly as a user runs it, and assert on exit codes / stdout / on-disk artifacts.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BUNDLE = join(REPO_ROOT, "scripts", "ultra11y.mjs");
export const FIXTURES = join(REPO_ROOT, "tests", "fixtures");

export const FIX = {
  good: join(FIXTURES, "conforming", "good.html"),
  bad: join(FIXTURES, "non-conforming", "bad.html"),
  lowContrast: join(FIXTURES, "dynamic", "low-contrast.html"),
  contrastOverGradient: join(FIXTURES, "dynamic", "contrast-over-gradient.html"),
  fixedWidthReflow: join(FIXTURES, "dynamic", "fixed-width-reflow.html"),
  inputInCellClip: join(FIXTURES, "dynamic", "input-in-cell-clip.html"),
  inputInCellClean: join(FIXTURES, "dynamic", "input-in-cell-clean.html"),
  loginForm: join(FIXTURES, "realworld", "LoginForm.tsx"),
  // THE FALSE-POSITIVE GUARD, and it lives in its own directory on purpose.
  //
  // This page IS the `realworld/index.html` that stood here until the site next door was
  // turned into a recall fixture — copied verbatim, not rewritten. A guard that says "the
  // engine invents nothing on genuinely accessible markup" is only worth something while the
  // markup it reads is genuinely accessible, and pointing it at a page seeded with defects
  // would have quietly turned an assertion into a tautology.
  landing: join(FIXTURES, "clean-landing", "index.html"),
  // `realworld/` grew from one page into a small SITE — a shared header (menu + search form),
  // a footer, a sitemap page, a contact form and a stylesheet — because the criteria it is
  // adjudicated against in CI are about an « ensemble de pages »: two navigation systems (12.1),
  // a search engine reachable identically (12.5), CSS-only content revealed on hover AND on
  // focus (10.14, 12.11). One page could not pose those questions, let alone answer them.
  //
  // It is now also the RECALL fixture: every page of it is seeded with real RGAA defects, so
  // an audit of it measures what the engine FINDS. A clean fixture can only ever prove the
  // absence of false positives; it says nothing about what a run misses. The two fixtures
  // answer the two halves and must not be merged back together.
  siteRoot: join(FIXTURES, "realworld"),
};

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the bundle as a subprocess. Never throws on a non-zero exit — the code is returned. */
export function runCli(args: string[], opts: { input?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): CliResult {
  const res = spawnSync(process.execPath, [BUNDLE, ...args], {
    input: opts.input,
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    env: opts.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Shape of the audit --json payload, kept loose (only the fields the E2E tests read). */
export interface AuditJson {
  tool: string;
  standard: string;
  scope: { inputs: string[]; files: number; truncated?: { limit: number; total: number; skipped: number }; langs?: string[] };
  criteria: { id: string; status: string; findings: unknown[] }[];
  findings: { ruleId: string; criteriaId: string; file: string; line: number; severity: string; message: string }[];
  conformancePct?: number;
}

/** Run `audit … --json` and parse stdout. Fails loudly if stdout is not valid JSON. */
export function auditJson(args: string[], opts?: { input?: string; cwd?: string }): AuditJson {
  const r = runCli(["audit", ...args, "--json"], opts);
  try {
    return JSON.parse(r.stdout) as AuditJson;
  } catch (e) {
    throw new Error(`audit --json did not emit valid JSON (exit ${r.code}).\nSTDOUT:\n${r.stdout}\nSTDERR:\n${r.stderr}\n(${String(e)})`);
  }
}

// --- temp-dir management -------------------------------------------------------

const created: string[] = [];

/** Make a throwaway temp dir, tracked for cleanup via cleanupTmp(). */
export function mkTmp(prefix = "u11y-e2e-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  created.push(d);
  return d;
}

/** Remove every temp dir made by mkTmp/mkTmpRepo. Call from afterAll. */
export function cleanupTmp(): void {
  for (const d of created.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** A throwaway git repo (isolated from the real repo) for init/fix --write tests. */
export function mkTmpRepo(): string {
  const d = mkTmp("u11y-repo-");
  const git = (a: string[]) => spawnSync("git", a, { cwd: d, encoding: "utf8" });
  git(["init", "-q"]);
  git(["config", "user.email", "e2e@example.com"]);
  git(["config", "user.name", "ultra11y-e2e"]);
  git(["config", "commit.gpgsign", "false"]);
  return d;
}

/** True when a working Docker daemon is reachable (the dynamic scan tier needs it). */
export function hasDocker(): boolean {
  const r = spawnSync("docker", ["info"], { encoding: "utf8", timeout: 10_000 });
  return r.status === 0;
}

/** True when the LOCAL dynamic runtime can run from `cwd`: @playwright/test +
 *  @axe-core/playwright resolve AND a Chromium browser is installed. Gates the
 *  stateful probe smoke test, which needs a real browser (layout-dependent). */
export function hasLocalPlaywright(cwd: string = REPO_ROOT): boolean {
  try {
    const req = createRequire(join(cwd, "package.json"));
    req.resolve("@playwright/test");
    req.resolve("@axe-core/playwright");
  } catch {
    return false;
  }
  // A resolvable Playwright still needs its BROWSER BINARY, and `executablePath()` returns the
  // path it WOULD use whether or not anything is there — so calling it proved only that the
  // package was installed. That was harmless while Playwright was absent from this repository
  // and the guard was false anyway; the moment it became a devDependency, every `--runtime
  // local` test switched itself on in a CI job that installs no browser, and failed on a launch
  // rather than skipping. The guard has to test the thing it guards.
  const r = spawnSync(process.execPath, ["-e", "process.stdout.write(require('@playwright/test').chromium.executablePath())"], {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
  });
  const path = (r.stdout ?? "").trim();
  return r.status === 0 && path.length > 0 && existsSync(path);
}
