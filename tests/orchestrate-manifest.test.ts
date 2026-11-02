// A GENERIC ORCHESTRATION MANIFEST (#82).
//
// `orchestrate` emitted the adjudication loop for one harness only — Claude Code's Workflow tool
// (and its RUNBOOK). Any other orchestrator (a bot, a CI job, another agent harness) rebuilt the
// same step graph by hand from the prose in references/orchestrators.md. `orchestrate --manifest`
// prints the steps as data: each step's command line (string AND argv), the files it reads and
// writes, its exit-code contract, and the step that comes next. The RUNBOOK is now one renderer
// of that manifest, so the two cannot drift.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type AdjudicationItem, writeAdjudication } from "../src/adjudicate.js";
import { main } from "../src/cli.js";
import { buildManifest, listPhases, orchestrateRun, renderCommand } from "../src/orchestrate.js";
import { phaseSpec } from "../src/orchestrate-templates.js";
import { type VerifyItem, writeWorklist } from "../src/verify.js";

const ENGINE = "/opt/skills/ultra11y/scripts/ultra11y.mjs";

function adjItem(criteriaId: string): AdjudicationItem {
  return {
    criteriaId,
    automatability: "judgment",
    title: `Criterion ${criteriaId}`,
    evidence: [{ file: "src/page.html", line: 3, selector: "img", snippet: '<img src="a.png" alt="logo">' }],
    verdict: null,
    justification: "",
    reason: null,
    findings: [],
    decidedBy: "agent",
  };
}

function makeRun(opts: { adjudicate?: number; verify?: number; audit?: boolean } = {}): string {
  const run = mkdtempSync(join(tmpdir(), "u11y-manifest-"));
  if (opts.audit) writeFileSync(join(run, "audit-latest.json"), JSON.stringify({ tool: "ultra11y", standard: "wcag", criteria: [], scope: { inputs: [] } }));
  if (opts.adjudicate !== undefined)
    writeAdjudication(
      Array.from({ length: opts.adjudicate }, (_, i) => adjItem(`1.${(i % 4) + 1}.${i + 1}`)),
      run,
      { standard: "wcag", auditDate: "2026-07-09" },
    );
  if (opts.verify !== undefined) {
    const items: VerifyItem[] = Array.from({ length: opts.verify }, (_, i) => ({
      n: i + 1,
      criteriaId: "1.1.1",
      file: "src/page.html",
      line: i + 2,
      selector: "img",
      claim: `claim ${i + 1}`,
      verdict: null,
      note: "",
    }));
    writeWorklist(items, run, false, "wcag", "en");
  }
  return run;
}

const ORDER = ["audit", "adjudicate-worklist", "adjudicate", "adjudicate-fold", "report", "verify-worklist", "verify", "verify-fold", "gate", "fix"];

describe("orchestrate --manifest — the step graph as data (#82)", () => {
  it("lists every step of the loop in order, each linked to the next by id", () => {
    const m = buildManifest(makeRun(), ENGINE);
    expect(m.kind).toBe("ultra11y-orchestration-manifest");
    expect(m.schemaVersion).toBe(1);
    expect(m.steps.map((s) => s.id)).toEqual(ORDER);
    const ids = new Set(m.steps.map((s) => s.id));
    for (const s of m.steps) if (s.next !== null) expect(ids.has(s.next)).toBe(true);
    expect(m.steps.find((s) => s.id === "gate")!.next).toBeNull();
    expect(m.steps.find((s) => s.id === "gate")!.onFailure).toBe("fix");
    expect(m.steps.find((s) => s.id === "fix")!.next).toBe("audit");
  });

  it("gives every engine step its command as a line and as argv, plus an exit-code contract", () => {
    const m = buildManifest(makeRun(), ENGINE);
    for (const s of m.steps.filter((x) => x.kind === "engine")) {
      expect(s.argv?.slice(0, 2)).toEqual(["node", ENGINE]);
      expect(s.command).toBe(renderCommand(ENGINE, s.argv!.slice(2)));
      expect(Object.keys(s.exit ?? {})).toContain("0");
      expect(Object.keys(s.exit ?? {})).toContain("2");
      expect(s.outputs.length + s.inputs.length).toBeGreaterThan(0);
    }
    // The gate is the one whose 1 means « do not present ».
    expect(m.steps.find((s) => s.id === "gate")!.exit!["1"]).toMatch(/do not present/i);
  });

  it("chains files: what a step writes is what the next one reads", () => {
    const run = makeRun();
    const m = buildManifest(run, ENGINE);
    const step = (id: string) => m.steps.find((s) => s.id === id)!;
    expect(step("audit").outputs).toContain(join(run, "audit-latest.json"));
    expect(step("adjudicate-worklist").inputs).toContain(join(run, "audit-latest.json"));
    expect(step("adjudicate-worklist").outputs).toContain(join(run, "ADJUDICATE.todo.json"));
    expect(step("adjudicate").inputs).toContain(join(run, "ADJUDICATE.todo.json"));
    expect(step("adjudicate-fold").inputs).toContain(join(run, "ADJUDICATE.todo.json"));
    expect(step("verify-worklist").outputs).toContain(join(run, "VERIFY.todo.json"));
    expect(step("verify-fold").inputs).toContain(join(run, "VERIFY.todo.json"));
    expect(step("gate").inputs).toContain(join(run, "VERIFY.todo.json"));
  });

  it("describes the judgment steps — role, contract, worklist, batches, the schema a fragment must match", () => {
    const run = makeRun({ adjudicate: 10, verify: 3 });
    const m = buildManifest(run, ENGINE);
    const adj = m.steps.find((s) => s.id === "adjudicate")!;
    expect(adj.kind).toBe("judgment");
    expect(adj.role).toBe("adjudicator");
    expect(adj.contract).toBe(join(run, "orchestration", "agents", "adjudicator.md"));
    expect(adj.worklist).toBe(join(run, "ADJUDICATE.todo.json"));
    expect(adj.items).toBe(10);
    expect(adj.batches?.flat()).toHaveLength(10);
    expect(adj.schema).toEqual(phaseSpec("adjudicate").schema);
    expect(adj.command).toBeUndefined();
    const ver = m.steps.find((s) => s.id === "verify")!;
    expect(ver.role).toBe("refuter");
    expect(ver.batches).toEqual([["1", "2", "3"]]);
  });

  it("says which steps can run now, from the files on disk", () => {
    const empty = buildManifest(makeRun(), ENGINE);
    const ready = (m: typeof empty, id: string) => m.steps.find((s) => s.id === id)!.ready;
    expect(ready(empty, "audit")).toBe(true); // its only input is the caller's globs
    expect(ready(empty, "adjudicate-worklist")).toBe(false);
    expect(ready(empty, "adjudicate")).toBe(false);
    const withAudit = buildManifest(makeRun({ audit: true, adjudicate: 2 }), ENGINE);
    expect(ready(withAudit, "adjudicate-worklist")).toBe(true);
    expect(ready(withAudit, "adjudicate")).toBe(true);
    expect(ready(withAudit, "verify")).toBe(false);
  });

  it("names the placeholders a caller must substitute", () => {
    const m = buildManifest(makeRun(), ENGINE);
    expect(m.placeholders.map((p) => p.token)).toEqual(["<globs>", "<report.md>"]);
  });

  it("is the single source of the phase table and the RUNBOOK — they render the same commands", () => {
    const run = makeRun({ audit: true, adjudicate: 2, verify: 2 });
    orchestrateRun(run, ENGINE, { eco: true });
    const m = buildManifest(run, ENGINE);
    const rb = readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8");
    for (const s of m.steps.filter((x) => x.kind === "engine")) expect(rb).toContain(s.command!);
    const [adj, ver] = listPhases(run, ENGINE);
    const step = (id: string) => m.steps.find((s) => s.id === id)!;
    expect(adj!.prerequisite).toBe(step("adjudicate-worklist").command);
    expect(adj!.apply).toBe(step("adjudicate-fold").command);
    expect(ver!.prerequisite).toBe(step("verify-worklist").command);
    expect(ver!.apply).toBe(step("verify-fold").command);
  });
});

describe("orchestrate --manifest — the CLI (#82)", () => {
  it("prints the manifest as JSON on stdout and writes nothing", async () => {
    const run = makeRun({ adjudicate: 2 });
    const out: string[] = [];
    const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    const le = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let code: number;
    try {
      code = await main(["orchestrate", "--run", run, "--manifest", "--json"]);
    } finally {
      lo.mockRestore();
      le.mockRestore();
    }
    expect(code).toBe(0);
    const m = JSON.parse(out.join("\n")) as { kind: string; run: string; steps: Array<{ id: string }> };
    expect(m.kind).toBe("ultra11y-orchestration-manifest");
    expect(m.steps.map((s) => s.id)).toEqual(ORDER);
    expect(existsSync(join(run, "orchestration"))).toBe(false);
  });
});
