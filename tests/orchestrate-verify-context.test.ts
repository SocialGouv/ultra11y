// THE TRIAL'S CONTEXT TRAVELS WITH IT (#59).
//
// `verify --report` puts two kinds of claim on trial: the report's non-conformities, and the
// conformities the adjudication cleared — read from `--in` (the audit the report came from),
// `--conformities <file>`, or the ledger in the current directory. The RUNBOOK `orchestrate`
// emitted passed none of them: `verify --report <md> --out RUN`, then `verify --apply … --report
// <md>`. In a directory with no ledger, the list it produced tried the engine's NC and silently
// left the adjudicated conformity out; applying it WITH `--in` then failed as « missing » and
// advised `--max-verify 0` — on a list that had never been capped. Applying it WITHOUT `--in`
// passed green over a trial that never looked at the conformity.
//
// Now: orchestrate builds the generation and the apply from one run context (audit, standard,
// any explicit conformity source); the worklist records the context it was generated from
// (VERIFY.context.json); and a coverage gap caused by a different claim source says so, instead
// of prescribing a cap removal that cannot fix it.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { listPhases, orchestrateRun } from "../src/orchestrate.js";
import type { VerifyItem } from "../src/verify.js";

const ENGINE = "/opt/skills/ultra11y/scripts/ultra11y.mjs";

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  try {
    const code = await main(argv);
    return { code, out: out.join("\n"), err: err.join("\n") };
  } finally {
    lo.mockRestore();
    le.mockRestore();
  }
}

/** An emitted `node <engine> verify …` command, as argv for `main`. */
const argvOf = (cmd: string, report: string): string[] =>
  cmd
    .replace(`node ${ENGINE} `, "")
    .split(" ")
    .map((t) => (t === "<report.md>" ? report : t));

const readTodo = (dir: string): VerifyItem[] => JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8")) as VerifyItem[];
const fill = (dir: string, verdict = "supported"): string => {
  const items = readTodo(dir).map((it) => ({ ...it, verdict, note: "constaté dans la source" }));
  const p = join(dir, "VERIFY.filled.json");
  writeFileSync(p, JSON.stringify(items, null, 2));
  return p;
};

// The issue's fixture, verbatim: one engine NC (8.3, no lang) and one adjudicated C (8.6), in a
// directory that holds no ledger.
let prev = "";
let D = "";
let REPORT = "";
const FOLDED = () => join(D, "folded", "audit-latest.json");

beforeAll(async () => {
  prev = process.cwd();
  D = mkdtempSync(join(tmpdir(), "u11y-verify-ctx-"));
  process.chdir(D);
  writeFileSync(
    "page.html",
    `<!doctype html>
<html>
<head><title>Page de démonstration</title></head>
<body><main><h1>Démonstration</h1><img src="demo.png"></main></body>
</html>
`,
  );
  await cli(["audit", "page.html", "--standard", "rgaa", "--lang", "fr", "--out", "audit"]);
  expect((await cli(["verify", "--manual", "--in", "audit/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "manual"])).code).toBe(0);
  const adj = JSON.parse(readFileSync("manual/ADJUDICATE.todo.json", "utf8")) as {
    items: Array<Record<string, unknown> & { criteriaId: string; evidence: unknown[] }>;
  };
  const it86 = adj.items.find((i) => i.criteriaId === "8.6")!;
  adj.items = [
    { ...it86, verdict: "C", justification: "Le titre « Page de démonstration » décrit bien cette page de démonstration.", citations: [it86.evidence[0]] },
  ];
  writeFileSync("manual/ADJUDICATE.filled.json", JSON.stringify(adj, null, 2));
  await cli(["verify", "--apply", "manual/ADJUDICATE.filled.json", "--in", "audit/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "folded"]);
  expect((await cli(["report", "--in", "folded/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "report"])).code).toBe(0);
  REPORT = join(D, "report", readdirSync(join(D, "report")).find((f) => f.startsWith("rgaa-") && f.endsWith(".md"))!);
});

afterAll(() => {
  process.chdir(prev);
  rmSync(D, { recursive: true, force: true });
});

/** A fresh run dir holding the folded audit — what RUNBOOK step 1–3 leave behind. */
function freshRun(name: string): string {
  const run = join(D, name);
  mkdirSync(run, { recursive: true });
  copyFileSync(FOLDED(), join(run, "audit-latest.json"));
  return run;
}

describe("orchestrate's verify-report commands carry the run's context (#59)", () => {
  it("generation → list → apply puts the engine NC AND the adjudicated C on trial, with no ledger around", async () => {
    expect(existsSync(join(D, ".ultra11y"))).toBe(false);
    const run = freshRun("run-a");
    const [, verify] = listPhases(run, ENGINE);
    expect(verify!.prerequisite).toContain(`--in ${join(run, "audit-latest.json")}`);
    expect(verify!.prerequisite).toContain("--standard rgaa");

    const gen = await cli(argvOf(verify!.prerequisite, REPORT));
    expect(gen.code).toBe(0);
    expect(
      readTodo(run)
        .map((i) => `${i.criteriaId}:${i.kind ?? "nc"}`)
        .sort(),
    ).toEqual(["8.3:nc", "8.6:c"]);

    for (const it of [readTodo(run)]) writeFileSync(join(run, "VERIFY.todo.json"), JSON.stringify(it.map((i) => ({ ...i, verdict: "supported", note: "vu" }))));
    expect(orchestrateRun(run, ENGINE, { phase: "verify-report", eco: true }).exitCode).toBe(0);
    const phase = listPhases(run, ENGINE)[1]!;
    // The apply names the report the list was generated from, and the same audit and standard.
    expect(phase.apply).toContain(`--report ${REPORT}`);
    expect(phase.apply).toContain(`--in ${join(run, "audit-latest.json")}`);
    expect(phase.apply).toContain("--standard rgaa");

    const rb = readFileSync(join(run, "orchestration", "RUNBOOK.md"), "utf8");
    expect(rb).toContain(phase.apply);
    expect(rb).not.toMatch(/verify --report <the report \.md> --out/);
    const refuter = readFileSync(join(run, "orchestration", "agents", "refuter.md"), "utf8");
    expect(refuter).toContain(`--in ${join(run, "audit-latest.json")}`);
    expect(refuter).toContain("--standard rgaa");

    const applied = await cli(argvOf(phase.apply, REPORT));
    expect(applied.code).toBe(0);
    expect(applied.out).toMatch(/2 (claim|revendication)/);
  });

  it("the fan-out workflow's fold step is the same contextual apply", async () => {
    const run = freshRun("run-b");
    await cli(argvOf(listPhases(run, ENGINE)[1]!.prerequisite, REPORT));
    orchestrateRun(run, ENGINE, { phase: "verify-report" });
    const wf = readFileSync(join(run, "orchestration", "verify-report.workflow.mjs"), "utf8");
    expect(wf).toContain(listPhases(run, ENGINE)[1]!.apply);
  });

  it("an older ledger in the working directory does not change what the orchestrated trial covers", async () => {
    mkdirSync(join(D, ".ultra11y", "verdicts"), { recursive: true });
    writeFileSync(
      join(D, ".ultra11y", "verdicts", "rgaa.json"),
      JSON.stringify({
        kind: "verdict-ledger",
        entries: [
          { criteriaId: "1.1", verdict: "C", justification: "ancien run", citations: [{ file: "page.html", line: 4, selector: "img", snippet: "<img>" }] },
        ],
      }),
    );
    try {
      const run = freshRun("run-c");
      await cli(argvOf(listPhases(run, ENGINE)[1]!.prerequisite, REPORT));
      expect(
        readTodo(run)
          .map((i) => i.criteriaId)
          .sort(),
      ).toEqual(["8.3", "8.6"]);
    } finally {
      rmSync(join(D, ".ultra11y"), { recursive: true, force: true });
    }
  });

  it("an explicit --no-conformities generation is applied with --no-conformities, and the RUNBOOK keeps it", async () => {
    const run = freshRun("run-d");
    expect(
      (await cli(["verify", "--report", REPORT, "--in", join(run, "audit-latest.json"), "--standard", "rgaa", "--no-conformities", "--out", run])).code,
    ).toBe(0);
    expect(readTodo(run).map((i) => i.criteriaId)).toEqual(["8.3"]);
    const apply = listPhases(run, ENGINE)[1]!.apply;
    expect(apply).toContain("--no-conformities");
    fill(run);
    writeFileSync(join(run, "VERIFY.todo.json"), readFileSync(join(run, "VERIFY.filled.json")));
    const r = await cli(argvOf(apply, REPORT));
    expect(r.code).toBe(0);
    // A partial trial is not presented as covering the audit.
    expect(r.err).toMatch(/non-conformities only|non-conformités uniquement/i);
  });
});

describe("a coverage gap from a different claim source is diagnosed as such (#59)", () => {
  const PRESCRIBES_UNCAP = /régénérez la worklist avec --max-verify 0/i;
  async function listWithoutContext(name: string): Promise<string> {
    const out = join(D, name);
    // The issue's « without-context » list: no --in, no ledger, cap already lifted.
    const r = await cli(["verify", "--report", REPORT, "--standard", "rgaa", "--lang", "fr", "--max-verify", "0", "--out", out]);
    expect(r.code).toBe(0);
    expect(readTodo(out).map((i) => i.criteriaId)).toEqual(["8.3"]);
    // Said at generation time, where it can still be fixed for free.
    expect(r.err).toMatch(/--in/);
    return fill(out);
  }

  it("does not prescribe --max-verify 0 when the list was already uncapped, and names the source instead", async () => {
    const filled = await listWithoutContext("without-context");
    const r = await cli(["verify", "--apply", filled, "--report", REPORT, "--in", FOLDED(), "--standard", "rgaa", "--lang", "fr"]);
    expect(r.code).toBe(1);
    expect(r.err).not.toMatch(PRESCRIBES_UNCAP);
    expect(r.err).toMatch(/Couverture : la worklist a été générée avec une autre source de conformités/);
    expect(r.err).toMatch(/--max-verify 0 n'y changera rien/);
    expect(r.err).toContain(`--in ${FOLDED()}`);
    expect(r.err).toContain("8.6");
  });

  it("diagnoses the same way for a list written before the context was recorded (no VERIFY.context.json)", async () => {
    const filled = await listWithoutContext("legacy-list");
    rmSync(join(D, "legacy-list", "VERIFY.context.json"), { force: true });
    const r = await cli(["verify", "--apply", filled, "--report", REPORT, "--in", FOLDED(), "--standard", "rgaa", "--lang", "fr"]);
    expect(r.code).toBe(1);
    expect(r.err).not.toMatch(PRESCRIBES_UNCAP);
    expect(r.err).toMatch(/autre source de conformités/);
  });

  it("still prescribes --max-verify 0 when a cap can be the cause (a non-conformity is missing)", async () => {
    // The default cap only ever drops non-conformities; a list missing one may well be capped,
    // and nothing recorded says otherwise — so the historical remedy stays.
    const out = join(D, "capped");
    await cli(["verify", "--report", REPORT, "--in", FOLDED(), "--standard", "rgaa", "--lang", "fr", "--out", out]);
    rmSync(join(out, "VERIFY.context.json"), { force: true });
    writeFileSync(join(out, "VERIFY.todo.json"), JSON.stringify(readTodo(out).filter((i) => i.kind === "c")));
    const r = await cli(["verify", "--apply", fill(out), "--report", REPORT, "--in", FOLDED(), "--standard", "rgaa", "--lang", "fr"]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(PRESCRIBES_UNCAP);
  });

  it("an apply with no conformity source passes, but says the conformities were not on trial", async () => {
    const filled = await listWithoutContext("no-source");
    const r = await cli(["verify", "--apply", filled, "--report", REPORT, "--standard", "rgaa", "--lang", "fr"]);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(/non-conformités uniquement/i);
    expect(r.err).toContain("--in");
  });
});
