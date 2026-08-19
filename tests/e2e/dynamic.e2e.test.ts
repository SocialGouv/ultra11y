// End-to-end proof of the DYNAMIC-TIER DELTA (R2): the static engine correctly leaves
// contrast-over-gradient (1.4.3) and fixed-width reflow (1.4.10) as residual `manual`
// risks — it cannot decide them from source — and the axe/reflow scan upgrades EXACTLY
// those to NC, additively (no other criterion flips, no new false positive), with the
// axe-only finding carrying a real host file:line anchor (R3 synergy).
//
// The static assertions run always (no Docker). The merge assertions need the rendered
// tier and are opt-in via U11Y_E2E_DOCKER (slow image build) — skipped otherwise.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, FIX, mkTmp, cleanupTmp, hasDocker, hasLocalPlaywright, REPO_ROOT } from "./helpers.js";

afterAll(cleanupTmp);

interface Audit {
  criteria: { id: string; status: string }[];
  findings: { ruleId: string; criteriaId: string; file: string; line: number; selectorHint: string; snippet: string }[];
  residualRisks: { criteriaId: string }[];
}
const statusOf = (a: Audit, id: string) => a.criteria.find((c) => c.id === id)?.status;

describe("e2e: dynamic-tier delta — the static engine leaves the rendered-only criteria residual", () => {
  it("contrast-over-gradient leaves 1.4.3 manual (no static NC, no FP)", () => {
    const r = runCli(["audit", FIX.contrastOverGradient, "--json"]);
    const a = JSON.parse(r.stdout) as Audit;
    expect(statusOf(a, "1.4.3")).toBe("manual");
    expect(a.residualRisks.some((x) => x.criteriaId === "1.4.3")).toBe(true);
    expect(a.findings.length).toBe(0); // the static engine invents nothing here
  });

  it("fixed-width-reflow leaves 1.4.10 manual (no static NC, no FP)", () => {
    const r = runCli(["audit", FIX.fixedWidthReflow, "--json"]);
    const a = JSON.parse(r.stdout) as Audit;
    expect(statusOf(a, "1.4.10")).toBe("manual");
    expect(a.residualRisks.some((x) => x.criteriaId === "1.4.10")).toBe(true);
    expect(a.findings.length).toBe(0);
  });
});

const runDocker = Boolean(process.env.U11Y_E2E_DOCKER) && hasDocker();

describe("e2e: dynamic-tier delta — scan --merge upgrades the residual criteria (Docker)", () => {
  it.skipIf(!runDocker)("contrast-over-gradient: merge upgrades 1.4.3 to NC additively, anchored to the host file:line", () => {
    const dir = mkTmp();
    // static base
    expect(runCli(["audit", FIX.contrastOverGradient, "--out", dir, "--json"]).code).toBe(0);
    const auditPath = join(dir, "audit-latest.json");
    const before = JSON.parse(readFileSync(auditPath, "utf8")) as Audit;
    // scan + merge
    const scan = runCli(["scan", FIX.contrastOverGradient, "--merge", auditPath, "--out", dir]);
    expect(scan.code).toBe(0);
    const after = JSON.parse(readFileSync(auditPath, "utf8")) as Audit;

    // 1.4.3 flips manual → NC…
    expect(statusOf(before, "1.4.3")).toBe("manual");
    expect(statusOf(after, "1.4.3")).toBe("NC");
    // …additively: the static NC set (empty here) gained ONLY axe-attributed findings.
    const axeFindings = after.findings.filter((f) => f.ruleId.startsWith("axe:"));
    expect(axeFindings.length).toBeGreaterThan(0);
    // no criterion that was C/NA before was flipped to NC by the merge
    for (const c of before.criteria) if (c.status === "C" || c.status === "NA") expect(statusOf(after, c.id)).toBe(c.status);

    // R3 synergy: the axe-only finding carries a host anchor (real path + resolved line + snippet).
    const contrastF = after.findings.find((f) => f.criteriaId === "1.4.3" && f.ruleId.startsWith("axe:"))!;
    expect(contrastF.file).toContain("contrast-over-gradient.html");
    expect(contrastF.file).not.toContain("/work/input.html");
    expect(contrastF.snippet.length).toBeGreaterThan(0);
  });

  it.skipIf(!runDocker)("fixed-width-reflow: merge upgrades 1.4.10 to NC", () => {
    const dir = mkTmp();
    expect(runCli(["audit", FIX.fixedWidthReflow, "--out", dir, "--json"]).code).toBe(0);
    const auditPath = join(dir, "audit-latest.json");
    expect(runCli(["scan", FIX.fixedWidthReflow, "--merge", auditPath, "--out", dir]).code).toBe(0);
    const after = JSON.parse(readFileSync(auditPath, "utf8")) as Audit;
    expect(statusOf(after, "1.4.10")).toBe("NC");
  });
});

// ---- stateful probe smoke (Task 4): the input-in-a-table-cell that only clips once FILLED.
// Needs a real browser (layout: scrollWidth/clientWidth) → runs ONLY where a local
// Playwright + Chromium resolve from the repo. Skipped (not failed) otherwise: the
// synthetic-RunnerOutput fold logic is proven browser-free in tests/scan.test.ts.
// The shape `scan --json` actually emits is a DynamicFinding: it carries `engine` (the probe or
// `axe`) and never `ruleId` — the `dyn-*` rule ids only appear once the result is MERGED into an
// audit. These assertions were written against the merged shape and, until this repository had a
// local Playwright runtime, never ran to say so.
interface DynFinding {
  engine?: string;
  criteriaId: string;
  severity: string;
  message: string;
}
interface DynResult {
  findings: DynFinding[];
}
const runLocal = hasLocalPlaywright(REPO_ROOT);

describe("e2e: stateful scan — a FILLED input inside a table cell clips at 320px/200%/text-spacing", () => {
  it.skipIf(!runLocal)("flags the clipping input (input-overflow → 1.4.10/1.4.4/1.4.12, with the table-cell note)", () => {
    const r = runCli(["scan", FIX.inputInCellClip, "--runtime", "local", "--cwd", REPO_ROOT, "--json"], { cwd: mkTmp() });
    expect(r.code).toBe(0);
    const dyn = JSON.parse(r.stdout) as DynResult;
    const overflow = dyn.findings.filter((f) => (f.engine ?? "").startsWith("input-overflow"));
    expect(overflow.length).toBeGreaterThan(0);
    // maps onto the reflow / zoom / spacing SCs
    const scs = new Set(overflow.map((f) => f.criteriaId));
    expect([...scs].some((sc) => sc === "1.4.10" || sc === "1.4.4" || sc === "1.4.12")).toBe(true);
    // carries the "input inside a table cell" detail
    expect(overflow.some((f) => /table cell|cellule de tableau/.test(f.message))).toBe(true);
  });

  it.skipIf(!runLocal)("the clean counterpart (growing field) fires NO input-overflow finding", () => {
    const r = runCli(["scan", FIX.inputInCellClean, "--runtime", "local", "--cwd", REPO_ROOT, "--json"], { cwd: mkTmp() });
    expect(r.code).toBe(0);
    const dyn = JSON.parse(r.stdout) as DynResult;
    expect(dyn.findings.some((f) => (f.engine ?? "").startsWith("input-overflow"))).toBe(false);
  });

  it.skipIf(!runLocal)("--no-interact turns the stateful probes off (no input-overflow, no live-region)", () => {
    const r = runCli(["scan", FIX.inputInCellClip, "--runtime", "local", "--cwd", REPO_ROOT, "--no-interact", "--json"], { cwd: mkTmp() });
    expect(r.code).toBe(0);
    const dyn = JSON.parse(r.stdout) as DynResult;
    expect(dyn.findings.some((f) => (f.engine ?? "").startsWith("input-overflow"))).toBe(false);
    expect(dyn.findings.some((f) => f.engine === "live-region")).toBe(false);
  });
});
