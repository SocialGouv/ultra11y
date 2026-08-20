import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { type AdjudicationItem, writeAdjudication } from "../src/adjudicate.js";
import { main } from "../src/cli.js";
import { BATCH_SIZE, SMALL_WORKLIST, listPhases, orchestrateRun } from "../src/orchestrate.js";
import { agentContracts, phaseSpec } from "../src/orchestrate-templates.js";
import { type VerifyItem, writeWorklist } from "../src/verify.js";
import type { AuditResult } from "../src/types.js";

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

function verifyItem(n: number): VerifyItem {
  return { n, criteriaId: "1.1.1", file: "src/page.html", line: n + 1, selector: "img", claim: `claim ${n}`, verdict: null, note: "" };
}

/** A run dir holding real engine-written worklists (the same writers the pipeline uses). */
function makeRun(opts: { adjudicate?: number; verify?: number } = {}): string {
  const run = mkdtempSync(join(tmpdir(), "u11y-orch-"));
  if (opts.adjudicate !== undefined) {
    const items = Array.from({ length: opts.adjudicate }, (_, i) => adjItem(`1.${(i % 4) + 1}.${i + 1}`));
    writeAdjudication(items, run, { standard: "wcag", auditDate: "2026-07-09" });
  }
  if (opts.verify !== undefined) {
    const items = Array.from({ length: opts.verify }, (_, i) => verifyItem(i + 1));
    writeWorklist(items, run, false, "wcag", "en");
  }
  return run;
}

const wf = (run: string, phase: string) => join(run, "orchestration", `${phase}.workflow.mjs`);
const readWf = (run: string, phase: string) => readFileSync(wf(run, phase), "utf8");
const stable = (src: string, run: string) => src.replaceAll(run, "<RUN>").replaceAll(ENGINE, "<ENGINE>");

describe("orchestrate — listPhases", () => {
  it("reports both phases not ready on an empty run, naming the producing command", () => {
    const run = makeRun();
    const phases = listPhases(run, ENGINE);
    expect(phases.map((p) => p.name)).toEqual(["adjudicate", "verify-report"]);
    for (const p of phases) {
      expect(p.ready).toBe(false);
      expect(p.items).toBe(0);
    }
    expect(phases[0]!.prerequisite).toContain("verify --manual");
    expect(phases[1]!.prerequisite).toContain("verify --report");
  });

  it("reports ready phases with real item counts and absolute worklist paths", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    const phases = listPhases(run, ENGINE);
    expect(phases[0]).toMatchObject({ name: "adjudicate", ready: true, items: 5 });
    expect(phases[1]).toMatchObject({ name: "verify-report", ready: true, items: 2 });
    for (const p of phases) expect(isAbsolute(p.worklist)).toBe(true);
  });
});

describe("orchestrate — emitted workflow", () => {
  it("emits one workflow per ready phase, plus contracts and the runbook", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    const res = orchestrateRun(run, ENGINE);
    expect(res.exitCode).toBe(0);
    expect(existsSync(wf(run, "adjudicate"))).toBe(true);
    expect(existsSync(wf(run, "verify-report"))).toBe(true);
    expect(existsSync(join(run, "orchestration", "RUNBOOK.md"))).toBe(true);
    expect(existsSync(join(run, "orchestration", "agents", "adjudicator.md"))).toBe(true);
    expect(existsSync(join(run, "orchestration", "agents", "refuter.md"))).toBe(true);
  });

  it("parses as JavaScript the way the Workflow harness evaluates it (meta export + async body)", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    orchestrateRun(run, ENGINE);
    for (const phase of ["adjudicate", "verify-report"]) {
      const [metaLine, ...body] = readWf(run, phase).split("\n");
      expect(() => new Script(metaLine!.replace("export const meta =", "const meta ="))).not.toThrow();
      expect(() => new Script(`(async () => {\n${body.join("\n")}\n})`)).not.toThrow();
    }
  });

  it("meta is a pure JSON literal on line 1 (name, description, phases)", () => {
    const run = makeRun({ adjudicate: 5 });
    orchestrateRun(run, ENGINE);
    const first = readWf(run, "adjudicate").split("\n")[0]!;
    expect(first.startsWith("export const meta = ")).toBe(true);
    const meta = JSON.parse(first.replace("export const meta = ", "")) as { name: string; description: string; phases: unknown[] };
    expect(meta.name).toBe("ultra11y-adjudicate");
    expect(meta.description.length).toBeGreaterThan(0);
    expect(Array.isArray(meta.phases)).toBe(true);
  });

  it("never contains Date.now / Math.random / new Date (forbidden under the Workflow tool)", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    orchestrateRun(run, ENGINE);
    for (const phase of ["adjudicate", "verify-report"]) {
      const src = readWf(run, phase);
      expect(src).not.toContain("Date.now(");
      expect(src).not.toContain("Math.random(");
      expect(src).not.toContain("new Date(");
    }
  });

  it("injects absolute RUN/ENGINE/WORKLIST constants matching the run", () => {
    const run = makeRun({ verify: 2 });
    orchestrateRun(run, ENGINE);
    const src = readWf(run, "verify-report");
    for (const name of ["RUN", "ENGINE", "WORKLIST"]) {
      const m = src.match(new RegExp(`const ${name} = "([^"]+)"`));
      expect(m, `const ${name} missing`).not.toBeNull();
      expect(isAbsolute(m![1]!)).toBe(true);
    }
    expect(src).toContain(JSON.stringify(join(run, "VERIFY.todo.json")));
    expect(src).toContain(JSON.stringify(ENGINE));
  });

  it("injects the REAL current worklist ids — a doctored worklist shows up on re-emit", () => {
    const run = makeRun({ adjudicate: 4 });
    orchestrateRun(run, ENGINE);
    expect(readWf(run, "adjudicate")).not.toContain("9.9.9");
    const todoPath = join(run, "ADJUDICATE.todo.json");
    const file = JSON.parse(readFileSync(todoPath, "utf8")) as { items: AdjudicationItem[] };
    file.items.push(adjItem("9.9.9"));
    writeFileSync(todoPath, JSON.stringify(file, null, 2));
    orchestrateRun(run, ENGINE);
    expect(readWf(run, "adjudicate")).toContain("9.9.9");
  });

  it("is deterministic — two runs over the same state emit byte-identical artifacts", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    orchestrateRun(run, ENGINE);
    const first = ["adjudicate", "verify-report"].map((p) => readWf(run, p)).join("\0") + readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8");
    orchestrateRun(run, ENGINE);
    const second = ["adjudicate", "verify-report"].map((p) => readWf(run, p)).join("\0") + readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8");
    expect(second).toBe(first);
  });

  it("batches large worklists and dispatches one agent per batch", () => {
    const run = makeRun({ verify: 20 });
    orchestrateRun(run, ENGINE);
    const src = readWf(run, "verify-report");
    const m = src.match(/const BATCHES = (\[.*?\])\n/s);
    expect(m).not.toBeNull();
    const batches = JSON.parse(m![1]!) as string[][];
    expect(batches.length).toBe(Math.ceil(20 / BATCH_SIZE));
    expect(batches.flat().length).toBe(20);
    expect(src).toContain("pipeline(BATCHES");
    expect(src).toContain("agentType: 'general-purpose'");
    expect(src).toContain("schema: SCHEMA");
  });

  it("small worklist (≤ SMALL_WORKLIST) → single agent + an eco notice", () => {
    const run = makeRun({ verify: 2 });
    const res = orchestrateRun(run, ENGINE);
    const m = readWf(run, "verify-report").match(/const BATCHES = (\[.*?\])\n/s);
    expect((JSON.parse(m![1]!) as string[][]).length).toBe(1);
    expect(res.notices.some((n) => n.includes("--eco"))).toBe(true);
    expect(SMALL_WORKLIST).toBeLessThan(BATCH_SIZE);
  });

  it("an empty worklist is skipped with a notice, not emitted", () => {
    const run = makeRun({ adjudicate: 0, verify: 2 });
    const res = orchestrateRun(run, ENGINE);
    expect(res.exitCode).toBe(0);
    expect(existsSync(wf(run, "adjudicate"))).toBe(false);
    expect(existsSync(wf(run, "verify-report"))).toBe(true);
    expect(res.notices.some((n) => n.includes("adjudicate") && n.includes("empty"))).toBe(true);
  });

  it("every contract('<role>') referenced by a workflow has its agents/<role>.md", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    orchestrateRun(run, ENGINE);
    const agents = readdirSync(join(run, "orchestration", "agents")).map((f) => f.replace(/\.md$/, ""));
    for (const phase of ["adjudicate", "verify-report"]) {
      const refs = [...readWf(run, phase).matchAll(/contract\('([a-z-]+)'/g)].map((m) => m[1]!);
      expect(refs.length).toBeGreaterThan(0);
      for (const r of refs) expect(agents).toContain(r);
    }
  });

  it("workflows return fragments and never contain a write step (--apply stays with the orchestrator)", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    orchestrateRun(run, ENGINE);
    for (const phase of ["adjudicate", "verify-report"]) {
      const src = readWf(run, phase);
      expect(src).toMatch(/^return \{/m);
      // --apply may appear only in comments (the orchestrator's next step), never as executed code.
      const code = src
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      expect(code).not.toContain("--apply");
    }
  });
});

describe("orchestrate — contracts & runbook", () => {
  it("every emitted contract carries the one-writer footer and returns structured output", () => {
    const run = makeRun({ adjudicate: 2, verify: 2 });
    orchestrateRun(run, ENGINE);
    const dir = join(run, "orchestration", "agents");
    const files = readdirSync(dir);
    expect(files.sort()).toEqual(["adjudicator.md", "refuter.md"]);
    for (const f of files) {
      const md = readFileSync(join(dir, f), "utf8");
      expect(md).toContain("Return, don't write");
      expect(md).toContain("The orchestrator is the sole writer");
      expect(md).toContain("orchestration/out/");
    }
  });

  it("adjudicator contract encodes the fail-closed verdict rules; refuter the harsher-verdict rule", () => {
    const run = makeRun({ adjudicate: 2, verify: 2 });
    orchestrateRun(run, ENGINE);
    const adj = readFileSync(join(run, "orchestration", "agents", "adjudicator.md"), "utf8");
    for (const v of ["`C`", "`NC`", "`NA`", "`manual`"]) expect(adj).toContain(v);
    expect(adj).toContain("needs-rendered-dom");
    const ref = readFileSync(join(run, "orchestration", "agents", "refuter.md"), "utf8");
    for (const v of ["supported", "partial", "refuted", "unsupported"]) expect(ref).toContain(v);
    expect(ref).toMatch(/HARSHER/i);
  });

  it("the runbook covers every phase with concrete paths and the phase status", () => {
    const run = makeRun({ adjudicate: 5 });
    orchestrateRun(run, ENGINE);
    const rb = readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8");
    expect(rb).toContain(join(run, "ADJUDICATE.todo.json"));
    expect(rb).toContain("verify --report");
    expect(rb).toContain(ENGINE);
    expect(rb).toContain("adjudicator.md");
    expect(rb).toContain("refuter.md");
  });

  // RENDER BEFORE YOU ADJUDICATE — said in the runbook, because the runbook is what an agent
  // without a Workflow tool actually follows. A criterion needing a browser cannot be settled
  // by reading source, so every pass over it costs a model and returns `needs-rendered-dom`.
  // Measured on a real cascade: three passes, 311 turns and $24.90 to learn that.
  describe("it says to render first, when nothing has been rendered", () => {
    const withAudit = (audit: Partial<AuditResult>): string => {
      const run = makeRun({ adjudicate: 2 });
      // A worklist whose items need a browser — the shape `verify --manual` produces on a
      // source-only audit of anything with a stylesheet.
      const todo = JSON.parse(readFileSync(join(run, "ADJUDICATE.todo.json"), "utf8")) as { items: { automatability: string }[] };
      for (const it of todo.items) it.automatability = "needs-rendering";
      writeFileSync(join(run, "ADJUDICATE.todo.json"), JSON.stringify(todo));
      writeFileSync(join(run, "audit-latest.json"), JSON.stringify({ scope: { inputs: [], files: 1, pagesAudited: [] }, ...audit }));
      orchestrateRun(run, ENGINE);
      return readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8");
    };

    it("opens on the scan command, with the criteria named", () => {
      const rb = withAudit({});
      expect(rb).toMatch(/Render before you adjudicate/i);
      expect(rb).toContain("scan <url>");
      expect(rb).toContain("`1.1.1`");
      // Above the phase table: it changes what every phase below costs.
      expect(rb.indexOf("Render before you adjudicate")).toBeLessThan(rb.indexOf("## Phase status"));
    });

    it("says nothing once a page's real DOM has been read", () => {
      expect(withAudit({ scope: { inputs: [], files: 1, pagesAudited: ["accueil"] } } as Partial<AuditResult>)).not.toMatch(/Render before you adjudicate/i);
    });

    it("still emits a runbook when the run has no audit to read", () => {
      const run = makeRun({ adjudicate: 2 });
      expect(orchestrateRun(run, ENGINE).exitCode).toBe(0);
      expect(readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8")).not.toMatch(/Render before you adjudicate/i);
    });
  });

  it("golden shape (paths normalized)", () => {
    const run = makeRun({ adjudicate: 4, verify: 2 });
    orchestrateRun(run, ENGINE);
    expect(stable(readWf(run, "adjudicate"), run)).toMatchSnapshot("adjudicate.workflow.mjs");
    expect(stable(readFileSync(join(run, "orchestration", "agents", "refuter.md"), "utf8"), run)).toMatchSnapshot("refuter.md");
    expect(stable(readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8"), run)).toMatchSnapshot("RUNBOOK.md");
  });
});

describe("orchestrate — eco mode & phase gating", () => {
  it("--eco emits RUNBOOK + contracts only, no workflow scripts", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    const res = orchestrateRun(run, ENGINE, { eco: true });
    expect(res.exitCode).toBe(0);
    expect(existsSync(join(run, "orchestration", "RUNBOOK.md"))).toBe(true);
    expect(existsSync(join(run, "orchestration", "agents", "adjudicator.md"))).toBe(true);
    expect(existsSync(wf(run, "adjudicate"))).toBe(false);
    expect(existsSync(wf(run, "verify-report"))).toBe(false);
  });

  it("--phase on a not-ready phase exits 2 and names the producing command", () => {
    const run = makeRun({ verify: 2 });
    const res = orchestrateRun(run, ENGINE, { phase: "adjudicate" });
    expect(res.exitCode).toBe(2);
    expect(res.errors.some((e) => e.includes("verify --manual"))).toBe(true);
    expect(existsSync(wf(run, "adjudicate"))).toBe(false);
  });

  it("--phase restricts emission to that phase", () => {
    const run = makeRun({ adjudicate: 5, verify: 2 });
    const res = orchestrateRun(run, ENGINE, { phase: "verify-report" });
    expect(res.exitCode).toBe(0);
    expect(existsSync(wf(run, "verify-report"))).toBe(true);
    expect(existsSync(wf(run, "adjudicate"))).toBe(false);
  });

  it("an unknown phase exits 2 naming the valid ones", () => {
    const run = makeRun({ verify: 2 });
    const res = orchestrateRun(run, ENGINE, { phase: "nope" });
    expect(res.exitCode).toBe(2);
    expect(res.errors.some((e) => e.includes("adjudicate") && e.includes("verify-report"))).toBe(true);
  });
});

describe("orchestrate — CLI wiring", () => {
  it("orchestrate without --run exits 2", async () => {
    expect(await main(["orchestrate"])).toBe(2);
  });

  it("orchestrate --run <dir> --list exits 0; a full run emits and exits 0", async () => {
    const run = makeRun({ adjudicate: 2 });
    expect(await main(["orchestrate", "--run", run, "--list"])).toBe(0);
    expect(await main(["orchestrate", "--run", run])).toBe(0);
    expect(existsSync(wf(run, "adjudicate"))).toBe(true);
  });

  it("orchestrate --run <missing dir> exits 2", async () => {
    expect(await main(["orchestrate", "--run", join(tmpdir(), "u11y-does-not-exist-xyz")])).toBe(2);
  });
});

describe("orchestrate — stale artifact reconciliation", () => {
  it("removes a previously emitted workflow when its worklist empties on re-emit", () => {
    const run = makeRun({ adjudicate: 4, verify: 2 });
    orchestrateRun(run, ENGINE);
    expect(existsSync(wf(run, "adjudicate"))).toBe(true);
    // The worklist is regenerated empty (e.g. every criterion got adjudicated).
    writeAdjudication([], run, { standard: "wcag", auditDate: "2026-07-09" });
    const res = orchestrateRun(run, ENGINE);
    expect(res.exitCode).toBe(0);
    expect(existsSync(wf(run, "adjudicate"))).toBe(false);
    expect(existsSync(wf(run, "verify-report"))).toBe(true);
    expect(res.notices.some((n) => n.includes("adjudicate") && n.includes("removed"))).toBe(true);
  });

  it("removes a previously emitted workflow when its worklist disappears entirely", () => {
    const run = makeRun({ verify: 5 });
    orchestrateRun(run, ENGINE);
    expect(existsSync(wf(run, "verify-report"))).toBe(true);
    rmSync(join(run, "VERIFY.todo.json"));
    orchestrateRun(run, ENGINE);
    expect(existsSync(wf(run, "verify-report"))).toBe(false);
  });

  it("--eco also clears stale workflow scripts (the run is switching to the sequential path)", () => {
    const run = makeRun({ adjudicate: 4 });
    orchestrateRun(run, ENGINE);
    orchestrateRun(run, ENGINE, { eco: true });
    expect(existsSync(wf(run, "adjudicate"))).toBe(false);
  });
});

// The contract IS the spec the agent obeys — `action.yml` tells it to follow
// `agents/adjudicator.md` VERBATIM. So anything the fold requires and the contract omits is
// not a documentation gap, it is an instruction to produce work that will be thrown away.
//
// That happened: the fold requires `citations[]` on a C (and on an evidenced NA), the contract
// asked only for `justification`, and a CI run produced 97 obedient verdicts of which 63 were
// refused — discarding the whole adjudication, since the fold is all-or-nothing.
describe("the adjudicator contract states every field the fold enforces", () => {
  const contract = agentContracts("/run", ENGINE).adjudicator!;
  const schema = JSON.stringify(phaseSpec("adjudicate").schema);

  it("asks for citations on C, where the fold rejects their absence", () => {
    expect(contract).toContain("citations");
    // Named on the C rule itself, not merely mentioned somewhere in the file.
    const cRule = contract.split("\n").find((l) => l.includes("`C`") && l.includes("REQUIRES"));
    expect(cRule, "the C rule must name citations").toMatch(/citations/);
  });

  it("asks for citations on an evidenced NA, on the same rule", () => {
    const naRule = contract.split("\n").find((l) => l.includes("`NA`") && l.includes("REQUIRES"));
    expect(naRule, "the NA rule must name citations").toMatch(/citations/);
  });

  it("says the anchors must come from the item's own evidence, so none is invented", () => {
    expect(contract).toMatch(/verbatim|VERBATIM/);
    expect(contract).toMatch(/evidence\[\]/);
  });

  // The stake has to be stated TRUTHFULLY, because it is what the adjudicator optimises
  // against. It used to say a refusal discarded the whole adjudication; the fold is now
  // per-verdict, and telling a model that its good work is at stake when it is not teaches it
  // to guess in order to fill gaps — the one behaviour the gate exists to punish.
  it("says a refusal costs its own criterion, and steers to an honest `manual` over a guess", () => {
    expect(contract).toMatch(/costs THAT criterion/i);
    expect(contract).toMatch(/leaves every other verdict standing/i);
    expect(contract).toMatch(/never guess/i);
    expect(contract).not.toMatch(/WHOLE adjudication/i);
  });

  it("carries citations in the structured-output schema the fan-out path validates against", () => {
    expect(schema).toContain("citations");
  });

  // The same mismatch already bit `normativeRef` once (see the comment in ADJUDICATE_SCHEMA).
  it("keeps normativeRef required on an NC finding", () => {
    expect(schema).toContain("normativeRef");
    const ncRule = contract.split("\n").find((l) => l.includes("`NC`") && l.includes("REQUIRES"));
    expect(ncRule).toMatch(/normativeRef/);
  });
});
