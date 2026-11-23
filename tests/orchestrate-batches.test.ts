// HARNESS-NEUTRAL BATCHES (#158).
//
// `orchestrate` used to emit the fan-out only as `<phase>.workflow.mjs`, a script that Claude
// Code's Workflow tool alone can run. Codex and OpenCode subagents had to reverse-engineer the
// batches from that JS. The canonical output is now data — `<phase>.batches.json` plus one
// self-contained prompt per batch — and the workflow script is one adapter rendered from it.
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AdjudicationItem, writeAdjudication } from "../src/adjudicate.js";
import { BATCH_SIZE, type PhaseBatches, batchPaths, buildManifest, listPhases, orchestrateRun, phaseBatches } from "../src/orchestrate.js";
import { phaseSpec } from "../src/orchestrate-templates.js";
import { type VerifyItem, writeWorklist } from "../src/verify.js";

const ENGINE = "/opt/skills/ultra11y/scripts/ultra11y.mjs";
const PHASES = ["adjudicate", "verify-report"] as const;

function adjItem(criteriaId: string): AdjudicationItem {
  return {
    criteriaId,
    automatability: "judgment",
    title: `Criterion ${criteriaId}`,
    evidence: [{ file: "src/page.html", line: 3, selector: "img", snippet: `<img src="${criteriaId}.png" alt="logo">` }],
    verdict: null,
    justification: "",
    reason: null,
    findings: [],
    decidedBy: "agent",
  };
}

function makeRun(opts: { adjudicate?: number; verify?: number } = {}): string {
  const run = mkdtempSync(join(tmpdir(), "u11y-batches-"));
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

const readBatches = (run: string, phase: string) => JSON.parse(readFileSync(batchPaths(run, phase).file, "utf8")) as PhaseBatches;
const workflowBatches = (run: string, phase: string): string[][] => {
  const src = readFileSync(join(run, "orchestration", `${phase}.workflow.mjs`), "utf8");
  return JSON.parse(src.match(/const BATCHES = (\[.*?\])\n/s)![1]!) as string[][];
};

describe("orchestrate — harness-neutral batches", () => {
  it("emits <phase>.batches.json and one prompt per batch, for each ready phase", () => {
    const run = makeRun({ adjudicate: 20, verify: 10 });
    const res = orchestrateRun(run, ENGINE);
    expect(res.exitCode).toBe(0);
    for (const phase of PHASES) {
      const { file, promptDir, outDir } = batchPaths(run, phase);
      expect(existsSync(file)).toBe(true);
      expect(res.written).toContain(file);
      const pb = readBatches(run, phase);
      expect(pb).toMatchObject({ kind: "ultra11y-orchestration-batches", schemaVersion: 1, phase, run, engine: ENGINE, batchSize: BATCH_SIZE });
      expect(readdirSync(promptDir).sort()).toEqual(pb.batches.map((b) => `${b.id}.md`).sort());
      expect(existsSync(outDir)).toBe(true);
      for (const b of pb.batches) {
        expect(b.prompt).toBe(join(promptDir, `${b.id}.md`));
        expect(b.output).toBe(join(outDir, `${b.id}.json`));
        expect(b.role).toBe(phaseSpec(phase).role);
        expect(b.schema).toEqual(phaseSpec(phase).schema);
        expect(b.fold).toContain("verify --apply");
        expect(res.written).toContain(b.prompt);
      }
    }
    expect(readBatches(run, "adjudicate").batches.map((b) => b.id)).toEqual(["adjudicate-01", "adjudicate-02", "adjudicate-03"]);
  });

  it("each batch carries the exact worklist slice its ids name", () => {
    const run = makeRun({ adjudicate: 11, verify: 9 });
    orchestrateRun(run, ENGINE);
    const adjTodo = JSON.parse(readFileSync(join(run, "ADJUDICATE.todo.json"), "utf8")) as { items: AdjudicationItem[] };
    const adj = readBatches(run, "adjudicate");
    expect(adj.batches.flatMap((b) => b.items)).toEqual(adjTodo.items);
    for (const b of adj.batches) expect((b.items as AdjudicationItem[]).map((i) => i.criteriaId)).toEqual(b.ids);
    const verTodo = JSON.parse(readFileSync(join(run, "VERIFY.todo.json"), "utf8")) as VerifyItem[];
    const ver = readBatches(run, "verify-report");
    expect(ver.batches.flatMap((b) => b.items)).toEqual(verTodo);
    for (const b of ver.batches) expect((b.items as VerifyItem[]).map((i) => String(i.n))).toEqual(b.ids);
  });

  it("the Claude Code workflow is generated from the same batches (same partition, same count)", () => {
    const run = makeRun({ adjudicate: 20, verify: 17 });
    orchestrateRun(run, ENGINE);
    for (const phase of PHASES) {
      const pb = readBatches(run, phase);
      expect(workflowBatches(run, phase)).toEqual(pb.batches.map((b) => b.ids));
      const src = readFileSync(join(run, "orchestration", `${phase}.workflow.mjs`), "utf8");
      expect(src).toContain(`const SCHEMA = ${JSON.stringify(pb.schema)}`);
      expect(src).toContain(pb.fold);
      expect(src).toContain(batchPaths(run, phase).file);
    }
  });

  it("every prompt file is self-contained: ITEMS, the items, the schema, the output path, the contract and the fold", () => {
    const run = makeRun({ adjudicate: 10, verify: 3 });
    orchestrateRun(run, ENGINE);
    for (const phase of PHASES) {
      const pb = readBatches(run, phase);
      const contract = readFileSync(join(run, "orchestration", "agents", `${pb.role}.md`), "utf8");
      for (const b of pb.batches) {
        const md = readFileSync(b.prompt, "utf8");
        expect(md).toContain(`ITEMS=${b.ids.join(",")}`);
        expect(md).toContain(JSON.stringify(b.items, null, 2));
        expect(md).toContain(JSON.stringify(b.schema, null, 2));
        expect(md).toContain(b.output);
        expect(md).toContain(b.fold);
        expect(md).toContain(ENGINE);
        // The role contract is inlined, not merely referenced: the prompt is the whole brief.
        expect(md).toContain(contract.trim());
        expect(md).toContain("The orchestrator is the sole writer");
      }
    }
    // An adjudicating subagent needs the criterion's own brief, named per item.
    const first = readBatches(run, "adjudicate").batches[0]!;
    const md = readFileSync(first.prompt, "utf8");
    for (const id of first.ids) expect(md).toContain(join(run, "adjudicate", `${id}.md`));
    // A prompt rules on its own batch only.
    const second = readBatches(run, "adjudicate").batches[1]!;
    expect(md).not.toContain(`"criteriaId": "${second.ids[0]}"`);
  });

  it("is deterministic — re-emitting over the same state writes byte-identical batches and prompts", () => {
    const run = makeRun({ adjudicate: 12, verify: 4 });
    const snap = () =>
      PHASES.flatMap((p) => {
        const pb = readBatches(run, p);
        return [readFileSync(batchPaths(run, p).file, "utf8"), ...pb.batches.map((b) => readFileSync(b.prompt, "utf8"))];
      }).join("\0");
    orchestrateRun(run, ENGINE);
    const first = snap();
    orchestrateRun(run, ENGINE);
    expect(snap()).toBe(first);
  });

  it("a shrunk worklist drops the prompts of batches that no longer exist", () => {
    const run = makeRun({ adjudicate: 20 });
    orchestrateRun(run, ENGINE);
    expect(readdirSync(batchPaths(run, "adjudicate").promptDir)).toHaveLength(3);
    writeAdjudication([adjItem("1.1.1"), adjItem("1.2.2")], run, { standard: "wcag", auditDate: "2026-07-09" });
    orchestrateRun(run, ENGINE);
    expect(readdirSync(batchPaths(run, "adjudicate").promptDir)).toEqual(["adjudicate-01.md"]);
  });

  it("an emptied worklist, or --eco, removes the batch file and the prompts — but keeps saved answers", () => {
    const run = makeRun({ adjudicate: 4, verify: 2 });
    orchestrateRun(run, ENGINE);
    const answer = join(batchPaths(run, "adjudicate").outDir, "adjudicate-01.json");
    writeFileSync(answer, "{}");
    writeAdjudication([], run, { standard: "wcag", auditDate: "2026-07-09" });
    const res = orchestrateRun(run, ENGINE);
    expect(existsSync(batchPaths(run, "adjudicate").file)).toBe(false);
    expect(existsSync(batchPaths(run, "adjudicate").promptDir)).toBe(false);
    expect(existsSync(answer)).toBe(true);
    expect(res.notices.some((n) => n.includes("adjudicate") && n.includes("removed"))).toBe(true);
    orchestrateRun(run, ENGINE, { eco: true });
    expect(existsSync(batchPaths(run, "verify-report").file)).toBe(false);
    expect(existsSync(batchPaths(run, "verify-report").promptDir)).toBe(false);
  });

  it("phaseBatches on a not-ready phase has no batches", () => {
    const run = makeRun();
    const [adj] = listPhases(run, ENGINE);
    expect(phaseBatches(adj!, run, ENGINE).batches).toEqual([]);
  });
});

describe("orchestrate — manifest and RUNBOOK reference the batches", () => {
  it("each judgment step names its batch file, batch ids, prompts and output paths — matching the emitted files", () => {
    const run = makeRun({ adjudicate: 10, verify: 3 });
    orchestrateRun(run, ENGINE);
    const m = buildManifest(run, ENGINE);
    for (const [stepId, phase] of [
      ["adjudicate", "adjudicate"],
      ["verify", "verify-report"],
    ] as const) {
      const step = m.steps.find((s) => s.id === stepId)!;
      const pb = readBatches(run, phase);
      expect(step.batchFile).toBe(batchPaths(run, phase).file);
      expect(step.batchIds).toEqual(pb.batches.map((b) => b.id));
      expect(step.prompts).toEqual(pb.batches.map((b) => b.prompt));
      expect(step.batchOutputs).toEqual(pb.batches.map((b) => b.output));
      // Backward compatible: the historical fields are unchanged.
      expect(step.batches).toEqual(pb.batches.map((b) => b.ids));
      expect(step.schema).toEqual(pb.schema);
      for (const p of step.prompts!) expect(existsSync(p)).toBe(true);
    }
  });

  it("the RUNBOOK points at the batch files and says how any harness dispatches them", () => {
    const run = makeRun({ adjudicate: 10 });
    orchestrateRun(run, ENGINE);
    const rb = readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8");
    expect(rb).toContain(batchPaths(run, "adjudicate").file);
    expect(rb).toContain("<p>.batches.json");
    expect(rb).toMatch(/VERBATIM to one subagent/);
    expect(rb).toContain("<p>.workflow.mjs");
  });
});
