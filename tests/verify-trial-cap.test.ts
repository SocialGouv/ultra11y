// A CONFORMITY TRIAL MUST NEVER BE SILENTLY TRUNCATED.
//
// Measured on 5.45.1 auditing a 7-page static site under RGAA: with « non applicable » on trial
// (#62) the run held 74 C/NA claims, the default `--max-verify 40` put 40 of them in
// VERIFY.todo.json, and `verify --apply … --prune` printed « 34 claimed conformity(ies)
// unsupported — those criteria go back to "to assess" ». The grid did not change: the 34 were
// never in the file, so nothing pruned them, and every later `check` passed over conformities
// nobody had tried.
//
// Now: the conformity half is uncapped by default; an explicit cap names what it dropped; and
// under --prune a conformity that stood no trial goes back to « to assess », as the message says.
//
// Same file: `--prune --ledger` with no ledger yet creates one instead of aborting the trial.
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAudit } from "../src/audit.js";
import { applyAdjudication, buildAdjudicationWorklist, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { main } from "../src/cli.js";
import { pruneRefuted } from "../src/refute.js";
import type { AuditResult } from "../src/types.js";
import type { VerifyItem } from "../src/verify.js";
import { unwrapAudit } from "../src/standards/document.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-trial-cap-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1>
<img src="hero.png" alt="Un randonneur sur une crête">
<label for="email">Email</label><input id="email" type="email">
<a href="/aide">Contacter le support</a>
</main></body></html>`,
);
const DRAFT = join(dir, "report.md");
writeFileSync(DRAFT, "# Report\n- **Rate** : 100%\n## 1. s\n## 2. NC\n## 3. x\n## 4. NA\n## 5. manual\n");

/** Every criterion with evidence ruled `C` by the agent, the rest left undecidable. */
function adjudicated(): AuditResult {
  const items = buildAdjudicationWorklist(runAudit({ inputs: [PAGE] }), { standard: "rgaa", cwd: dir });
  const adj: AdjudicationFile = {
    tool: "ultra11y",
    kind: "adjudication",
    schemaVersion: 2,
    standard: "rgaa",
    auditDate: "2026-10-28",
    items: items.map((it) =>
      it.evidence.length
        ? ({ ...it, verdict: "C", justification: "vérifié sur la page", citations: [it.evidence[0]!] } as AdjudicationItem)
        : ({ ...it, verdict: "manual", reason: "undecidable" } as AdjudicationItem),
    ),
  };
  return applyAdjudication(runAudit({ inputs: [PAGE] }), adj, { cwd: dir }).audit;
}

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  const code = await main(argv);
  lo.mockRestore();
  le.mockRestore();
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function setup(): { out: string; auditPath: string; claims: number } {
  const out = mkdtempSync(join(tmpdir(), "u11y-trial-cap-run-"));
  const auditPath = join(out, "audit.json");
  const a = adjudicated();
  writeFileSync(auditPath, JSON.stringify(a));
  const claims = (a.packAdjudication?.criteria ?? []).filter((c) => c.decidedBy === "agent" && (c.status === "C" || c.status === "NA")).length;
  return { out, auditPath, claims };
}

const statusOf = (path: string, id: string): string | undefined =>
  (unwrapAudit(JSON.parse(readFileSync(path, "utf8"))) as AuditResult).packAdjudication?.criteria.find((c) => c.id === id)?.status;

afterEach(() => vi.restoreAllMocks());

describe("the conformity half of the trial", () => {
  it("is uncapped by default, so no claim escapes the worklist", async () => {
    const { out, auditPath, claims } = setup();
    expect(claims).toBeGreaterThan(3);
    const g = await cli(["verify", "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--json"]);
    expect(g.code, g.err).toBe(0);
    expect((JSON.parse(g.out) as { conformities: number }).conformities).toBe(claims);
    expect(g.err).not.toContain("capped");
  });

  it("names what an explicit cap drops", async () => {
    const { out, auditPath, claims } = setup();
    const g = await cli(["verify", "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--max-verify", "2", "--lang", "en", "--json"]);
    expect(g.code, g.err).toBe(0);
    expect((JSON.parse(g.out) as { conformities: number }).conformities).toBe(2);
    expect(g.err).toContain(`${claims - 2}/${claims} claimed conformity(ies) left out of the trial`);
    expect(g.err).toContain("--max-verify 0");
  });

  it("under --prune, sends every untried conformity back to « to assess » and fails", async () => {
    const { out, auditPath, claims } = setup();
    const g = await cli(["verify", "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--max-verify", "2", "--json"]);
    const todoPath = (JSON.parse(g.out) as { todoPath: string }).todoPath;
    const todo = JSON.parse(readFileSync(todoPath, "utf8")) as VerifyItem[];
    for (const it of todo) it.verdict = "supported";
    writeFileSync(todoPath, JSON.stringify(todo));
    const tried = new Set(todo.map((it) => it.criteriaId));

    const a = await cli(["verify", "--apply", todoPath, "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--prune", "--lang", "en"]);
    expect(a.code).toBe(1);
    expect(a.err).toContain(`${claims - 2} claimed conformity(ies) never tried — sent back to "to assess"`);
    expect(a.err).not.toContain("unsupported — those criteria");
    const written = join(out, "audit-latest.json");
    const before = JSON.parse(readFileSync(auditPath, "utf8")) as AuditResult;
    for (const c of before.packAdjudication!.criteria.filter((x) => x.decidedBy === "agent" && x.status === "C")) {
      expect(statusOf(written, c.id), c.id).toBe(tried.has(c.id) ? "C" : "manual");
    }

    // The repaired audit is coherent: regenerating the worklist from it holds only the tried
    // claims, and their verdicts carry — the next apply is green.
    const g2 = await cli(["verify", "--report", DRAFT, "--in", written, "--standard", "rgaa", "--out", out, "--json"]);
    expect((JSON.parse(g2.out) as { conformities: number }).conformities).toBe(2);
    const a2 = await cli(["verify", "--apply", todoPath, "--report", DRAFT, "--in", written, "--standard", "rgaa", "--out", out, "--prune"]);
    expect(a2.code, a2.err).toBe(0);
  });

  it("without --prune, names the remedy instead of claiming an effect", async () => {
    const { out, auditPath } = setup();
    const g = await cli(["verify", "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--json"]);
    const todoPath = (JSON.parse(g.out) as { todoPath: string }).todoPath;
    const todo = JSON.parse(readFileSync(todoPath, "utf8")) as VerifyItem[];
    todo[0]!.verdict = "refuted";
    for (const it of todo.slice(1)) it.verdict = "supported";
    writeFileSync(todoPath, JSON.stringify(todo));
    const a = await cli(["verify", "--apply", todoPath, "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--lang", "en"]);
    expect(a.code).toBe(1);
    expect(a.err).toContain("re-run with --prune");
    expect(a.err).not.toContain("never tried");
  });

  it("leaves an untried non-conformity alone and a withdrawn claim wins over a blank one", () => {
    const a = adjudicated();
    const id = a.packAdjudication!.criteria.find((c) => c.decidedBy === "agent" && c.status === "C")!.id;
    const claim: VerifyItem = { n: 1, criteriaId: id, file: "", line: 0, selector: "", claim: "", verdict: null, note: "", kind: "c" };
    const r = pruneRefuted(a, "rgaa", [], "fr", [claim]);
    expect(r.untriedConformities).toEqual([id]);
    expect(r.audit.packAdjudication!.criteria.find((c) => c.id === id)!.justification).toContain("jamais mise à l'épreuve");
    const nc = pruneRefuted(a, "rgaa", [], "en", [{ ...claim, kind: "nc" }]);
    expect(nc.clearedConformities).toEqual([]);
  });
});

describe("verify --apply --prune --ledger with no ledger yet", () => {
  it("creates the ledger, says so, and still applies the trial", async () => {
    const { out, auditPath } = setup();
    const g = await cli(["verify", "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--json"]);
    const todoPath = (JSON.parse(g.out) as { todoPath: string }).todoPath;
    const todo = JSON.parse(readFileSync(todoPath, "utf8")) as VerifyItem[];
    todo[0]!.verdict = "refuted";
    for (const it of todo.slice(1)) it.verdict = "supported";
    writeFileSync(todoPath, JSON.stringify(todo));
    const ledger = join(out, "ledger", "rgaa.json");
    expect(existsSync(ledger)).toBe(false);

    const a = await cli([
      "verify",
      "--apply",
      todoPath,
      "--report",
      DRAFT,
      "--in",
      auditPath,
      "--standard",
      "rgaa",
      "--out",
      out,
      "--prune",
      "--ledger",
      ledger,
      "--lang",
      "en",
    ]);
    expect(a.code, a.err).toBe(0);
    expect(a.err).toContain("No ledger at");
    expect(existsSync(ledger)).toBe(true);
    expect(JSON.parse(readFileSync(ledger, "utf8"))).toMatchObject({ kind: "verdict-ledger", standard: "rgaa" });
    expect(statusOf(join(out, "audit-latest.json"), todo[0]!.criteriaId)).toBe("manual");
  });

  it("still refuses a ledger file that exists but is not one", async () => {
    const { out, auditPath } = setup();
    const g = await cli(["verify", "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--out", out, "--json"]);
    const todoPath = (JSON.parse(g.out) as { todoPath: string }).todoPath;
    const todo = JSON.parse(readFileSync(todoPath, "utf8")) as VerifyItem[];
    for (const it of todo) it.verdict = "supported";
    writeFileSync(todoPath, JSON.stringify(todo));
    const bogus = join(out, "bogus.json");
    writeFileSync(bogus, "{}");
    const a = await cli([
      "verify",
      "--apply",
      todoPath,
      "--report",
      DRAFT,
      "--in",
      auditPath,
      "--standard",
      "rgaa",
      "--out",
      out,
      "--prune",
      "--ledger",
      bogus,
      "--lang",
      "en",
    ]);
    expect(a.err).toContain("--ledger file missing, invalid, or for another standard");
    expect(readFileSync(bogus, "utf8")).toBe("{}");
  });
});
