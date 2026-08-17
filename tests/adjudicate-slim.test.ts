// THE VERDICTS-ONLY ADJUDICATION.
//
// An adjudicator in CI has Read/Grep/Glob/Edit/Write and no shell. Against the inline worklist
// that is impossible work: 96 RGAA criteria come to ~540 KB of JSON, so reading it swamps a
// context and filling it is 96 exact-match edits inside half a megabyte. Measured on a real
// run: the file came back untouched, and the fold correctly discarded all 96.
//
// The fix is a smaller surface, NOT a weaker gate. These tests pin the second half: a slim file
// must fold to exactly what the inline one folds to, and must still be refused for every reason
// the inline one is refused for. If hydration ever became a way to smuggle an ungrounded
// conformity past the citation gate, that is the regression to catch here.
import { describe, expect, it } from "vitest";
import {
  applyAdjudication,
  buildAdjudicationWorklist,
  hydrateAdjudication,
  slimAdjudicationItems,
  writeAdjudication,
  type AdjudicationFile,
} from "../src/adjudicate.js";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditResult, CriterionResult } from "../src/types.js";

const C = (id: string, status: CriterionResult["status"]): CriterionResult => ({
  id,
  guideline: id.split(".").slice(0, 2).join("."),
  status,
  findings: [],
});

/** An audit with two residual criteria, under the WCAG core so no pack data is needed. */
const audit = (): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    date: "2026-08-17",
    scope: { inputs: [], files: 1 },
    criteria: [C("1.1.1", "manual"), C("2.4.4", "manual")],
    guidelines: [],
    findings: [],
    residualRisks: [
      { criteriaId: "1.1.1", why: "alt relevance", how: "read the image in context" },
      { criteriaId: "2.4.4", why: "link purpose", how: "read the link in context" },
    ],
    conformancePct: 0,
  }) as unknown as AuditResult;

const file = (items: AdjudicationFile["items"]): AdjudicationFile =>
  ({ tool: "ultra11y", kind: "adjudication", schemaVersion: 1, standard: "wcag", auditDate: "2026-08-17", contract: {}, items }) as unknown as AdjudicationFile;

describe("writeAdjudication splits the worklist for a shell-less adjudicator", () => {
  it("writes a verdicts-only file and one brief per criterion", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-slim-"));
    const items = buildAdjudicationWorklist(audit(), { standard: "wcag" });
    const w = writeAdjudication(items, dir, { standard: "wcag", auditDate: "2026-08-17" });

    expect(existsSync(w.verdictsPath)).toBe(true);
    for (const it of items) expect(existsSync(join(w.itemsDir, `${it.criteriaId}.md`))).toBe(true);

    // The point of the split, as a structural property rather than a byte count: the file to
    // WRITE carries no evidence at all. Size follows from that — on the real RGAA worklist that
    // produced this change, 1590 harvested anchors are what made the inline file 540 KB.
    const slim = readFileSync(w.verdictsPath, "utf8");
    const parsed = JSON.parse(slim) as AdjudicationFile;
    expect(parsed.items.every((it) => it.evidence.length === 0)).toBe(true);
    expect(slim.length).toBeLessThanOrEqual(readFileSync(w.todoPath, "utf8").length);

    // And it still states the contract, which is what tells the adjudicator what a verdict owes.
    expect(parsed.contract).toBeTruthy();
  });

  it("leaves the inline worklist exactly as it was — the split is additive", () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-slim-"));
    const items = buildAdjudicationWorklist(audit(), { standard: "wcag" });
    const w = writeAdjudication(items, dir, { standard: "wcag", auditDate: "2026-08-17" });
    const todo = JSON.parse(readFileSync(w.todoPath, "utf8")) as AdjudicationFile;
    // Every item keeps its evidence inline, for the sessions that can use it.
    expect(todo.items.every((it) => Array.isArray(it.evidence))).toBe(true);
    expect(todo.items.length).toBe(items.length);
  });

  it("keeps every field a verdict owes, and drops only the evidence", () => {
    const items = buildAdjudicationWorklist(audit(), { standard: "wcag" });
    const slim = slimAdjudicationItems(items);
    for (const [i, it] of slim.entries()) {
      expect(it.criteriaId).toBe(items[i]?.criteriaId);
      expect(it.verdict).toBe(items[i]?.verdict); // still unruled
      expect(it.evidence).toEqual([]);
      expect(it).toHaveProperty("justification");
      expect(it).toHaveProperty("findings");
    }
  });
});

describe("hydration restores the evidence the gate checks against", () => {
  it("folds a slim file to exactly what the inline file folds to", () => {
    const a = audit();
    const items = buildAdjudicationWorklist(a, { standard: "wcag" });
    const rule = (its: AdjudicationFile["items"]): AdjudicationFile["items"] =>
      its.map((it) => ({ ...it, verdict: "manual" as const, reason: "undecidable" as const }));

    const inline = applyAdjudication(a, file(rule(items)));
    const slim = file(rule(slimAdjudicationItems(items)));
    hydrateAdjudication(slim, a);
    const hydrated = applyAdjudication(a, slim);

    expect(inline.ok).toBe(true);
    expect(hydrated.ok).toBe(true);
    expect(hydrated.applied).toBe(inline.applied);
    expect(hydrated.stillManual).toBe(inline.stillManual);
  });

  it("still refuses a conformity with no justification", () => {
    const a = audit();
    const slim = file(slimAdjudicationItems(buildAdjudicationWorklist(a, { standard: "wcag" })).map((it) => ({ ...it, verdict: "C" as const })));
    hydrateAdjudication(slim, a);
    const r = applyAdjudication(a, slim);
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/justification/);
  });

  it("still refuses a conformity that cites nothing it was shown", () => {
    // The gate that matters most: a `C` has to name the evidence it cleared, and the anchor has
    // to be one of THIS criterion's harvested anchors. Hydration must not become a way past it.
    const a = audit();
    const slim = file(
      slimAdjudicationItems(buildAdjudicationWorklist(a, { standard: "wcag" })).map((it) => ({
        ...it,
        verdict: "C" as const,
        justification: "looked at everything, all good",
        citations: [{ file: "src/nowhere.tsx", line: 999, selector: "div", snippet: "<div />" }],
      })),
    );
    hydrateAdjudication(slim, a);
    const r = applyAdjudication(a, slim);
    expect(r.ok).toBe(false);
  });

  it("still refuses a surplus verdict the engine already decided", () => {
    const a = audit();
    const slim = file([
      ...slimAdjudicationItems(buildAdjudicationWorklist(a, { standard: "wcag" })).map((it) => ({
        ...it,
        verdict: "manual" as const,
        reason: "undecidable" as const,
      })),
      { criteriaId: "3.1.1", verdict: "C", justification: "not open for adjudication", evidence: [] },
    ] as unknown as AdjudicationFile["items"]);
    hydrateAdjudication(slim, a);
    const r = applyAdjudication(a, slim);
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/not open for adjudication/);
  });

  it("still refuses a partial file — one null verdict discards the whole run", () => {
    const a = audit();
    const items = slimAdjudicationItems(buildAdjudicationWorklist(a, { standard: "wcag" }));
    const slim = file([{ ...items[0], verdict: "manual", reason: "undecidable" }, items[1]] as unknown as AdjudicationFile["items"]);
    hydrateAdjudication(slim, a);
    const r = applyAdjudication(a, slim);
    expect(r.ok).toBe(false);
    expect(r.issues.join("\n")).toMatch(/unadjudicated/);
  });

  it("is a no-op on a file that already carries its evidence", () => {
    const a = audit();
    const items = buildAdjudicationWorklist(a, { standard: "wcag" });
    const f = file(items.map((it) => ({ ...it, verdict: "manual" as const, reason: "undecidable" as const })));
    const before = JSON.stringify(f);
    hydrateAdjudication(f, a);
    expect(JSON.stringify(f)).toBe(before);
  });
});
