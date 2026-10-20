// THE TRIAL MUST GROUND A RETAINED CLAIM THE WAY THE FOLD GROUNDED IT.
//
// Measured on 5.42.1 (SocialGouv/iterion, dogfood audit of iterion's studio, run r4 of
// `bots/rgaa-audit`): a criterion ruled `C` on a citation whose snippet was the adjudicator's
// RETYPING of the harvester's — a closing backtick after `shrink-0` where the source reads
// `shrink-0 ${`. `verify --apply <adjudication>` accepted it: the fold grounds the citation,
// fails, then grounds the criterion's evidence anchor as a fallback. The trial of the SAME
// report (`verify --apply VERIFY.todo.json --report <draft> --in <audit>`) refused it —
// `groundItems(verifyGroundingInputs(passing))` had no fallback — so a conformity the fold
// accepted made every later trial of the report refuse part of itself, and the ledger
// carrying the citation brought the refusal back on every run that re-judged the criterion.
//
// The trial now re-derives the criterion's harvested evidence from the audit under `--in`
// (the worklist evidence is a pure function of the audit) and grants the same fallback,
// through the very same `evidenceFallback` the fold runs. A citation that is NOT one of the
// criterion's own anchors still fails strictly.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAudit } from "../src/audit.js";
import { applyAdjudication, buildAdjudicationWorklist, evidenceForCriteria, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { main } from "../src/cli.js";
import type { AuditResult } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-trial-anchor-"));

/** One line, like a browser's `documentElement.outerHTML` — which is what makes a retyped
 *  snippet the normal case: every anchor of the page sits on the same line, so what the
 *  grounding can test is the transcription and nothing else. */
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><img src="/assets/help.svg" alt="" class="fr-responsive-img" loading="lazy"><a href="/contact" class="fr-link">Nous contacter</a></main></body></html>`,
);

/** The draft the trial runs against: no non-conformities, so the worklist is the conformity
 *  claim alone — the one the fold accepted. */
const DRAFT = join(dir, "report.md");
writeFileSync(DRAFT, "# Report\n- **Rate** : 100%\n## 1. s\n## 2. NC\n## 3. x\n## 4. NA\n## 5. manual\n");

const audit = () => runAudit({ inputs: [PAGE] });

const file = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-10-14",
  items,
});

interface Folded {
  r: ReturnType<typeof applyAdjudication>;
  criteriaId: string;
  retyped: string;
}

/** Fold a `C` verdict whose citation is the adjudicator's RETYPING of the first harvested
 *  anchor — attributes dropped, the element unmistakable, the string absent from the file.
 *  Every other criterion is ruled `manual` so only this verdict can move the fold. */
function foldRetyped(): Folded {
  const items = buildAdjudicationWorklist(audit(), { standard: "rgaa", cwd: dir });
  const base = items.find((i) => i.evidence.length > 0);
  if (!base) throw new Error("no worklist item with evidence");
  const anchor = base.evidence[0]!;
  const tag = /<\s*([a-zA-Z][\w-]*)/.exec(anchor.snippet ?? "")?.[1]?.toLowerCase();
  if (!tag || tag === "video") throw new Error(`unexpected anchor markup: ${anchor.snippet}`);
  const retyped = `<${tag} alt="">`;
  expect(readFileSync(PAGE, "utf8")).not.toContain(retyped);
  const target: AdjudicationItem = {
    ...base,
    verdict: "C",
    justification: "vérifié sur la page",
    citations: [{ file: anchor.file, line: anchor.line, selector: anchor.selector, snippet: retyped }],
  };
  const adj = file(items.map((x) => (x.criteriaId === base.criteriaId ? target : ({ ...x, verdict: "manual", reason: "undecidable" } as AdjudicationItem))));
  return { r: applyAdjudication(audit(), adj, { cwd: dir }), criteriaId: base.criteriaId, retyped };
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  return {
    out,
    err,
    restore: () => {
      lo.mockRestore();
      le.mockRestore();
    },
  };
}

async function cli(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const c = capture();
  const code = await main(argv);
  c.restore();
  return { code, out: c.out.join("\n"), err: c.err.join("\n") };
}

/** The trial, end to end from a folded audit: write it, generate the VERIFY.todo.json
 *  worklist off its claims (the exact sequence of the measured failure), and fill every
 *  verdict `supported`. Returns the todo path the apply step reads. */
async function generateAndFill(folded: AuditResult): Promise<string> {
  const out = mkdtempSync(join(tmpdir(), "u11y-trial-run-"));
  const auditPath = join(out, "audit.json");
  writeFileSync(auditPath, JSON.stringify(folded));
  const g = await cli(["verify", "--report", DRAFT, "--in", auditPath, "--standard", "rgaa", "--max-verify", "0", "--out", out, "--json"]);
  expect(g.code, g.err).toBe(0);
  const gen = JSON.parse(g.out) as { todoPath: string; conformities: number };
  expect(gen.conformities).toBe(1);
  const todo = JSON.parse(readFileSync(gen.todoPath, "utf8")) as { verdict: string | null }[];
  for (const it of todo) it.verdict = "supported";
  writeFileSync(gen.todoPath, JSON.stringify(todo));
  return gen.todoPath;
}

afterEach(() => vi.restoreAllMocks());

describe("the trial grounds a retained claim the way the fold did", () => {
  it("accepts a conformity whose citation is the retyping the fold already forgave", async () => {
    const { r, criteriaId } = foldRetyped();
    // The fold's own contract, unchanged: the retyped citation is accepted there.
    expect(r.rejectedCriteria, r.issues.join("\n")).not.toContain(criteriaId);
    expect(r.applied).toBeGreaterThan(0);

    const todoPath = await generateAndFill(r.audit);
    const a = await cli(["verify", "--apply", todoPath, "--report", DRAFT, "--in", join(dirname(todoPath), "audit.json"), "--standard", "rgaa", "--json"]);
    expect(a.code, a.err).toBe(0);
    const parsed = JSON.parse(a.out) as { ok: boolean; grounding: { grounded: number; moved: number; failed: number; issues: string[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.grounding.failed, parsed.grounding.issues.join("\n")).toBe(0);
    // Grounded through the anchor, not the transcription — the same `moved` the fold reports.
    expect(parsed.grounding.moved).toBe(1);
  });

  it("still refuses a citation that is NOT one of the criterion's harvested anchors", async () => {
    const { r } = foldRetyped();
    const todoPath = await generateAndFill(r.audit);
    // A DIFFERENT KIND of element than any anchor holds: the harvest must not vouch for it,
    // and the strict literal check refuses the snippet exactly as before.
    const todo = JSON.parse(readFileSync(todoPath, "utf8")) as { citations: { snippet: string }[] }[];
    todo[0]!.citations[0]!.snippet = '<video controls src="/tour.mp4"></video>';
    writeFileSync(todoPath, JSON.stringify(todo));
    const a = await cli(["verify", "--apply", todoPath, "--report", DRAFT, "--in", join(dirname(todoPath), "audit.json"), "--standard", "rgaa", "--json"]);
    expect(a.code).toBe(1);
    const parsed = JSON.parse(a.out) as { ok: boolean; grounding: { failed: number; issues: string[] } };
    expect(parsed.grounding.failed).toBe(1);
    expect(parsed.grounding.issues.join("\n")).toMatch(/cited snippet not found/);
  });

  it("keeps the strict literal check when no audit is in hand", async () => {
    const { r } = foldRetyped();
    const todoPath = await generateAndFill(r.audit);
    // Without `--in` there is nothing to re-derive the harvest from, so nothing is granted:
    // the pre-fix behaviour is the contract there.
    const a = await cli(["verify", "--apply", todoPath, "--report", DRAFT, "--standard", "rgaa", "--json"]);
    expect(a.code).toBe(1);
    const parsed = JSON.parse(a.out) as { ok: boolean; grounding: { failed: number; issues: string[] } };
    expect(parsed.grounding.failed).toBe(1);
    expect(parsed.grounding.issues.join("\n")).toMatch(/cited snippet not found/);
  });

  it("re-derives, for a criterion the fold already decided, the evidence the worklist carried", () => {
    const before = buildAdjudicationWorklist(audit(), { standard: "rgaa", cwd: dir });
    const open = before.find((i) => i.evidence.length > 0);
    if (!open) throw new Error("no worklist item with evidence");
    const { r, criteriaId } = foldRetyped();
    expect(criteriaId).toBe(open.criteriaId);
    // Same audit inputs, same harvesters, same anchors: the trial's fallback may vouch only
    // for what the fold was shown — and the fold's item is exactly that set.
    const after = evidenceForCriteria(r.audit, [open.criteriaId], { standard: "rgaa", cwd: dir });
    expect(after.get(open.criteriaId)).toEqual(open.evidence);
  });
});
