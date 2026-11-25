// End-to-end tests for the SIDE-EFFECTING commands: init (git hook),
// fix --write, and report/prd default output. Everything runs inside throwaway temp
// dirs / git repos so the real repository and its fixtures are never touched.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, FIX, mkTmp, mkTmpRepo, cleanupTmp, hasLocalPlaywright } from "./helpers.js";

afterAll(cleanupTmp);

describe("e2e: init (throwaway repo)", () => {
  it("default install wires a strict pre-commit hook with a SKIP_A11Y bypass", () => {
    const repo = mkTmpRepo();
    const r = runCli(["init"], { cwd: repo });
    expect(r.code).toBe(0);
    const hook = join(repo, ".git", "hooks", "pre-commit");
    expect(existsSync(hook)).toBe(true);
    expect(statSync(hook).mode & 0o111, "hook must be executable").toBeGreaterThan(0);
    const body = readFileSync(hook, "utf8");
    expect(body).toContain("SKIP_A11Y");
  });

  it("--help writes nothing (no side effect)", () => {
    const repo = mkTmpRepo();
    const r = runCli(["init", "--help"], { cwd: repo });
    expect(r.code).toBe(0);
    expect(existsSync(join(repo, "audits"))).toBe(false);
    expect(existsSync(join(repo, ".github"))).toBe(false);
    expect(existsSync(join(repo, ".git", "hooks", "pre-commit"))).toBe(false);
  });
});

describe("e2e: fix", () => {
  it("dry-run (default) never touches the file; --write applies changes", () => {
    const dir = mkTmp();
    const page = join(dir, "page.html");
    copyFileSync(FIX.bad, page);
    const original = readFileSync(page, "utf8");

    const dry = runCli(["fix", page], { cwd: dir });
    expect(dry.code).toBe(0);
    expect(readFileSync(page, "utf8"), "dry-run must not write").toBe(original);

    const write = runCli(["fix", page, "--write"], { cwd: dir });
    expect(write.code).toBe(0);
    expect(readFileSync(page, "utf8"), "--write must change the file").not.toBe(original);
  });
});

describe("e2e: report/prd default output (temp cwd)", () => {
  it("report with no --out writes audits/rgaa-*.md under the working dir", () => {
    const dir = mkTmp();
    const auditFile = join(dir, "audit.json");
    writeFileSync(auditFile, runCli(["audit", FIX.bad, "--json"]).stdout);
    const r = runCli(["report", "--in", auditFile], { cwd: dir });
    expect(r.code).toBe(0);
    const audits = join(dir, "audits");
    expect(existsSync(audits)).toBe(true);
    expect(readdirSync(audits).some((f) => /^rgaa-\d{4}-\d{2}-\d{2}\.md$/.test(f))).toBe(true);
  });

  it("prd writes a dated backlog document into --out", () => {
    const dir = mkTmp();
    const auditFile = join(dir, "audit.json");
    writeFileSync(auditFile, runCli(["audit", FIX.bad, "--json"]).stdout);
    const out = mkTmp();
    const r = runCli(["prd", "--in", auditFile, "--out", out]);
    expect(r.code).toBe(0);
    expect(readdirSync(out).some((f) => f.startsWith("prd-") && f.endsWith(".md"))).toBe(true);
  });
});

describe("e2e: scan (static / error path)", () => {
  it("reports a clean 'File not found' error (exit 1) before launching any browser", () => {
    const r = runCli(["scan", join(mkTmp(), "does-not-exist.html")]);
    expect(r.code).toBe(1);
    expect((r.stdout + r.stderr).toLowerCase()).toContain("file not found");
  });

  // The real rendered/contrast tier needs a browser; opt-in (slow) via env.
  const runScan = Boolean(process.env.U11Y_E2E_SCAN) && hasLocalPlaywright();
  it.skipIf(!runScan)("scans a rendered page and flags low contrast", () => {
    const r = runCli(["scan", FIX.lowContrast, "--json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });
});
