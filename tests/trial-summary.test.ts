// THE TRIAL'S OWN ACCOUNT (#60).
//
// After a counter-review the operator had the verdicts file, the prune log and the gate's exit
// code — three artifacts, none of which said, side by side: which claims the review confirmed,
// which it withdrew and whether the withdrawal was actually applied, which ENGINE decisions it
// contests (and `--prune` deliberately leaves standing), what it never looked at, and whether the
// semantic gate is green. On the Egapro audit that bilan had to be written by hand from 932
// verdicts. `verify --summary` writes it — read-only, from an audit and a verdicts file both named
// explicitly, never from a ledger it would have to guess.
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import type { VerifyItem } from "../src/verify.js";

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

type Entry = { criteriaId: string; kind: string; verdict: string | null; note: string; file: string; line: number };
interface Summary {
  kind: string;
  standard: string;
  identity: {
    audit: { path: string; sha256: string };
    verdicts: { path: string; sha256: string };
    report: { path: string; sha256: string };
    pruned?: { path: string };
  };
  claims: { total: number; nc: Record<string, number>; c: Record<string, number> };
  criteria: Record<string, string[]>;
  confirmed: Entry[];
  withdrawals: { applied: Entry[]; notApplied: Entry[] };
  contestedEngine: Entry[];
  untried: Entry[];
  foreign: Entry[];
  coverage: { expected: number; covered: number; missing: number; foreign: number; complete: boolean };
  application: { ok: boolean; pruned: boolean };
  gate: { ok: boolean; failed: number; total: number };
  validated: boolean;
}

let prev = "";
let D = "";
let REPORT = "";

/** The issue's fixture — engine NC 8.3 (no lang), adjudicated C 8.6 — plus, for the mixed case,
 *  an AGENT NC on 1.1 that `--prune` can withdraw and two more agent conformities (1.2, 3.2). */
beforeAll(async () => {
  prev = process.cwd();
  D = realpathSync(mkdtempSync(join(tmpdir(), "u11y-trial-summary-")));
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
  await cli(["verify", "--manual", "--in", "audit/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "manual"]);
  const adj = JSON.parse(readFileSync("manual/ADJUDICATE.todo.json", "utf8")) as {
    items: Array<Record<string, unknown> & { criteriaId: string; evidence: Array<Record<string, unknown>> }>;
  };
  const pick = (id: string) => adj.items.find((i) => i.criteriaId === id)!;
  const ev = (id: string) => pick(id).evidence[0]!;
  adj.items = [
    { ...pick("8.6"), verdict: "C", justification: "Le titre « Page de démonstration » décrit bien cette page de démonstration.", citations: [ev("8.6")] },
    { ...pick("1.2"), verdict: "C", justification: "L'image demo.png est décorative sur cette page.", citations: [ev("1.2")] },
    { ...pick("3.2"), verdict: "C", justification: "Aucune feuille de style : les contrastes sont ceux du navigateur.", citations: [ev("3.2")] },
    {
      ...pick("1.1"),
      verdict: "NC",
      findings: [
        {
          file: "page.html",
          line: 4,
          selector: "img",
          message: "Image porteuse d'information sans alternative textuelle.",
          snippet: ev("1.1").snippet,
          normativeRef: "1.1.1",
        },
      ],
    },
  ];
  writeFileSync("manual/ADJUDICATE.filled.json", JSON.stringify(adj, null, 2));
  expect(
    (
      await cli([
        "verify",
        "--apply",
        "manual/ADJUDICATE.filled.json",
        "--in",
        "audit/audit-latest.json",
        "--standard",
        "rgaa",
        "--lang",
        "fr",
        "--out",
        "folded",
      ])
    ).code,
  ).toBe(0);
  await cli(["report", "--in", "folded/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "report"]);
  REPORT = join(D, "report", readdirSync(join(D, "report")).find((f) => f.startsWith("rgaa-") && f.endsWith(".md"))!);
  expect(
    (await cli(["verify", "--report", REPORT, "--in", "folded/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--max-verify", "0", "--out", "trial"]))
      .code,
  ).toBe(0);
});

afterAll(() => {
  process.chdir(prev);
  rmSync(D, { recursive: true, force: true });
});

const todo = (): VerifyItem[] => JSON.parse(readFileSync(join(D, "trial", "VERIFY.todo.json"), "utf8")) as VerifyItem[];

/** Fill the trial: verdict per criterion; a criterion mapped to undefined is DROPPED from the file. */
function filled(name: string, verdicts: Record<string, string | null | undefined>): string {
  const items = todo()
    .filter((it) => !(it.criteriaId in verdicts) || verdicts[it.criteriaId] !== undefined)
    .map((it) => ({ ...it, verdict: verdicts[it.criteriaId] ?? null, note: verdicts[it.criteriaId] ? `note ${it.criteriaId}` : "" }));
  const p = join(D, "trial", name);
  writeFileSync(p, JSON.stringify(items, null, 2));
  return p;
}

async function summary(argv: string[]): Promise<Summary> {
  const r = await cli(["verify", "--summary", ...argv, "--standard", "rgaa", "--lang", "fr", "--json"]);
  expect(r.code).toBe(0);
  return JSON.parse(r.out) as Summary;
}

describe("verify --summary — the issue's fixture (#60)", () => {
  // 8.6 supported; 8.3 refuted as a SYNTHETIC verdict — the lang really is missing; this only
  // exercises how a contested engine decision is reported.
  let verdicts = "";
  let pruned = "";
  beforeAll(async () => {
    verdicts = filled("VERIFY.issue.json", { "8.6": "supported", "8.3": "refuted", "1.1": "supported", "1.2": "supported", "3.2": "supported" });
    const r = await cli([
      "verify",
      "--apply",
      verdicts,
      "--report",
      REPORT,
      "--in",
      "folded/audit-latest.json",
      "--standard",
      "rgaa",
      "--lang",
      "fr",
      "--prune",
      "--out",
      "pruned",
    ]);
    expect(r.code).toBe(0);
    pruned = join(D, "pruned", "audit-latest.json");
  });

  it("keeps the contested engine decision explicitly unresolved — neither confirmed nor withdrawn", async () => {
    const s = await summary(["--verdicts", verdicts, "--report", REPORT, "--in", "folded/audit-latest.json", "--pruned", pruned]);
    expect(s.kind).toBe("trial-summary");
    expect(s.contestedEngine.map((e) => e.criteriaId)).toEqual(["8.3"]);
    expect(s.contestedEngine[0]!.note).toBe("note 8.3");
    expect(s.confirmed.map((e) => e.criteriaId)).not.toContain("8.3");
    expect(s.withdrawals.applied.map((e) => e.criteriaId)).not.toContain("8.3");
    expect(s.criteria.contested).toEqual(["8.3"]);
    expect(s.claims.nc.refuted).toBe(1);
    expect(s.claims.c.supported).toBe(3);
  });

  it("keeps the gate apart from the application: applied cleanly, gate still red, audit not validated", async () => {
    const s = await summary(["--verdicts", verdicts, "--report", REPORT, "--in", "folded/audit-latest.json", "--pruned", pruned]);
    expect(s.application).toEqual({ ok: true, pruned: true });
    expect(s.gate.ok).toBe(false);
    expect(s.gate.failed).toBeGreaterThan(0);
    expect(s.validated).toBe(false);
  });

  it("names the audit, the verdicts and the report it was built from", async () => {
    const s = await summary(["--verdicts", verdicts, "--report", REPORT, "--in", "folded/audit-latest.json", "--pruned", pruned]);
    expect(s.identity.audit.path).toBe(join(D, "folded", "audit-latest.json"));
    expect(s.identity.verdicts.path).toBe(verdicts);
    expect(s.identity.report.path).toBe(REPORT);
    expect(s.identity.pruned?.path).toBe(pruned);
    for (const h of [s.identity.audit.sha256, s.identity.verdicts.sha256, s.identity.report.sha256]) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes a Markdown bilan with --out, and touches neither the audit nor the verdicts", async () => {
    const before = [readFileSync("folded/audit-latest.json", "utf8"), readFileSync(verdicts, "utf8"), readFileSync(pruned, "utf8")];
    const r = await cli([
      "verify",
      "--summary",
      "--verdicts",
      verdicts,
      "--report",
      REPORT,
      "--in",
      "folded/audit-latest.json",
      "--pruned",
      pruned,
      "--standard",
      "rgaa",
      "--lang",
      "fr",
      "--out",
      "bilan",
    ]);
    expect(r.code).toBe(0);
    const md = readFileSync(join(D, "bilan", "TRIAL.md"), "utf8");
    expect(md).toMatch(/Décisions moteur contestées — non résolues/);
    expect(md).toContain("8.3");
    expect(md).toContain("note 8.3");
    expect(md).toMatch(/NON validé/);
    expect([readFileSync("folded/audit-latest.json", "utf8"), readFileSync(verdicts, "utf8"), readFileSync(pruned, "utf8")]).toEqual(before);
  });
});

describe("verify --summary — a mixed trial (#60)", () => {
  it("separates confirmed, withdrawn-and-applied, contested engine, partial, unsupported and missing claims", async () => {
    // 1.1 agent NC refuted (withdrawable), 8.3 engine NC refuted (contested), 8.6 supported,
    // 1.2 unsupported (a conformity withdrawn), 3.2 partial, and... nothing dropped yet.
    const verdicts = filled("VERIFY.mixed.json", { "1.1": "refuted", "8.3": "refuted", "8.6": "supported", "1.2": "unsupported", "3.2": "partial" });
    await cli([
      "verify",
      "--apply",
      verdicts,
      "--report",
      REPORT,
      "--in",
      "folded/audit-latest.json",
      "--standard",
      "rgaa",
      "--lang",
      "fr",
      "--prune",
      "--out",
      "pruned-mixed",
    ]);
    const s = await summary([
      "--verdicts",
      verdicts,
      "--report",
      REPORT,
      "--in",
      "folded/audit-latest.json",
      "--pruned",
      join(D, "pruned-mixed", "audit-latest.json"),
    ]);
    expect(s.confirmed.map((e) => e.criteriaId).sort()).toEqual(["3.2", "8.6"]);
    expect(s.withdrawals.applied.map((e) => e.criteriaId).sort()).toEqual(["1.1", "1.2"]);
    expect(s.withdrawals.notApplied).toEqual([]);
    expect(s.contestedEngine.map((e) => e.criteriaId)).toEqual(["8.3"]);
    expect(s.claims.nc).toMatchObject({ refuted: 2, supported: 0 });
    expect(s.claims.c).toMatchObject({ supported: 1, partial: 1, unsupported: 1 });
    expect(s.coverage.complete).toBe(true);
  });

  it("without --pruned, a withdrawal is reported as NOT applied — never assumed", async () => {
    const verdicts = filled("VERIFY.mixed2.json", { "1.1": "refuted", "8.3": "refuted", "8.6": "supported", "1.2": "supported", "3.2": "supported" });
    const s = await summary(["--verdicts", verdicts, "--report", REPORT, "--in", "folded/audit-latest.json"]);
    expect(s.withdrawals.applied).toEqual([]);
    expect(s.withdrawals.notApplied.map((e) => e.criteriaId)).toEqual(["1.1"]);
    expect(s.application.pruned).toBe(false);
  });

  it("shows a list missing claims as incomplete coverage", async () => {
    const verdicts = filled("VERIFY.partial.json", { "8.6": "supported", "8.3": "supported", "1.1": "supported", "1.2": "supported", "3.2": undefined });
    const s = await summary(["--verdicts", verdicts, "--report", REPORT, "--in", "folded/audit-latest.json"]);
    expect(s.coverage).toMatchObject({ missing: 1, complete: false });
    expect(s.untried.map((e) => e.criteriaId)).toEqual(["3.2"]);
    expect(s.claims.c.missing).toBe(1);
    expect(s.validated).toBe(false);
  });

  it("shows verdicts associated with another audit as foreign claims", async () => {
    const verdicts = filled("VERIFY.foreign.json", { "8.6": "supported", "8.3": "supported", "1.1": "supported", "1.2": "supported", "3.2": "supported" });
    // The ORIGINAL audit, before the adjudication was folded: it claims no conformity at all.
    copyFileSync(join(D, "audit", "audit-latest.json"), join(D, "other-audit.json"));
    const s = await summary(["--verdicts", verdicts, "--report", REPORT, "--in", "other-audit.json"]);
    expect(s.foreign.map((e) => e.criteriaId).sort()).toEqual(["1.2", "3.2", "8.6"]);
    expect(s.coverage.complete).toBe(false);
    expect(s.validated).toBe(false);
  });

  it("refuses to guess its inputs: --verdicts, --report and --in are all required", async () => {
    const verdicts = filled("VERIFY.req.json", { "8.6": "supported" });
    for (const argv of [
      ["--report", REPORT, "--in", "folded/audit-latest.json"],
      ["--verdicts", verdicts, "--in", "folded/audit-latest.json"],
      ["--verdicts", verdicts, "--report", REPORT],
    ]) {
      const r = await cli(["verify", "--summary", ...argv, "--standard", "rgaa"]);
      expect(r.code).toBe(2);
    }
  });
});
