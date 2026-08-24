// NON-CONFORMITIES, GROUPED BY CRITERION — the shape the CI surfaces report in.
//
// They used to render one row per (criterion, rule, selector). On a real audit that was 252
// rows for 41 criteria: RGAA 1.1 appeared a dozen times, and — because the sort was severity →
// occurrences → criterion — its rows were not even adjacent. The 50-row ceiling then dropped
// 202 of them, taking whole criteria out of a table that reads as though it listed them all.
//
// The deliverable (src/prd.ts `prdUnits`) has grouped by criterion since it existed. These
// tests hold the CI surfaces to the same grain, and guard the two ways the folding can lie:
// counting a criterion twice, and summing pages that overlap.
import { describe, expect, it } from "vitest";
import { groupByCriterion, groupFindings, stepSummary } from "../src/annotate.js";
import type { AuditResult, Finding } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1.1",
  file: "src/a.html",
  line: 1,
  col: 1,
  selectorHint: "img",
  severity: "bloquant",
  message: "img without alt",
  remediation: "add an alt",
  snippet: "",
  ...over,
});

const audit = (findings: Finding[]): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    date: "2026-08-18",
    scope: { inputs: [], files: 3 },
    criteria: [],
    guidelines: [],
    findings,
    residualRisks: [],
    conformancePct: 50,
  }) as unknown as AuditResult;

const group = (findings: Finding[]) => groupByCriterion(groupFindings(findings, "wcag", "en", process.cwd()));

describe("groupByCriterion", () => {
  it("names a criterion once however many distinct defects it carries", () => {
    const defects = Array.from({ length: 12 }, (_, i) => F({ selectorHint: `img.n${i}`, file: `p${i}.html` }));
    const criteria = group(defects);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.criterion).toBe("WCAG 1.1.1");
    expect(criteria[0]?.defects).toHaveLength(12);
  });

  it("counts DISTINCT pages across its defects — a union, never a sum", () => {
    // Two defects of one criterion, on overlapping page sets: {a,b,c} ∪ {b,c} is three pages.
    // Summing `pages` would say five, and a reader would take it for five routes to visit.
    const criteria = group([
      F({ selectorHint: "img.hero", page: "a" }),
      F({ selectorHint: "img.hero", page: "b" }),
      F({ selectorHint: "img.hero", page: "c" }),
      F({ selectorHint: "img.thumb", page: "b" }),
      F({ selectorHint: "img.thumb", page: "c" }),
    ]);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.defects).toHaveLength(2);
    expect(criteria[0]?.occurrences).toBe(5);
    expect(criteria[0]?.pages).toBe(3);
  });

  it("takes the WORST severity of its defects — a criterion is as blocking as its worst one", () => {
    const criteria = group([F({ severity: "mineur", selectorHint: "img.a" }), F({ severity: "bloquant", selectorHint: "img.b" })]);
    expect(criteria[0]?.severity).toBe("bloquant");
  });

  it("keeps criteria apart when the defects share a rule", () => {
    const criteria = group([F({ criteriaId: "1.1.1" }), F({ criteriaId: "4.1.2", selectorHint: "button" })]);
    expect(criteria.map((c) => c.criterion).sort()).toEqual(["WCAG 1.1.1", "WCAG 4.1.2"]);
  });
});

describe("the job summary's non-conformity block", () => {
  const many = () => [
    ...Array.from({ length: 12 }, (_, i) => F({ selectorHint: `img.n${i}`, file: `p${i}.html`, page: `p${i}` })),
    F({ criteriaId: "4.1.2", ruleId: "button-empty-name", selectorHint: "button", severity: "majeur" }),
  ];

  it("writes each criterion on exactly one row of the criterion table", () => {
    const md = stepSummary(audit(many()), { lang: "en" });
    const table = md.slice(md.indexOf("| Severity | Criterion |"), md.indexOf("<details>"));
    expect(table.split("\n").filter((l) => l.includes("WCAG 1.1.1"))).toHaveLength(1);
    expect(table.split("\n").filter((l) => l.includes("WCAG 4.1.2"))).toHaveLength(1);
  });

  it("counts criteria, distinct defects and occurrences separately in the heading", () => {
    expect(stepSummary(audit(many()), { lang: "en" })).toContain("2 criterion(ia) · 13 distinct defect(s) · 13 occurrence(s)");
  });

  it("keeps every defect's location in its criterion's fold", () => {
    const md = stepSummary(audit(many()), { lang: "en" });
    const fold = md.slice(md.indexOf("<summary><b>WCAG 1.1.1</b>"));
    for (let i = 0; i < 12; i++) expect(fold).toContain(`p${i}.html:1`);
    expect(fold).toContain("12 distinct defect(s)");
  });

  it("leaves a blank line after every summary, at each level of nesting", () => {
    const md = stepSummary(audit(many()), { lang: "en" });
    // GFM renders Markdown inside <details> only after a blank line. A fold that opens
    // straight onto a table ships the table to the reader as literal pipes.
    const after = md.split("</summary>").slice(1);
    expect(after.length).toBeGreaterThan(0);
    for (const tail of after) expect(tail.startsWith("\n\n")).toBe(true);
  });

  it("says what a fold holds back rather than trailing off", () => {
    const defects = Array.from({ length: 26 }, (_, i) => F({ selectorHint: `img.n${i}`, file: `p${i}.html` }));
    const md = stepSummary(audit(defects), { lang: "en" });
    expect(md).toContain("6 more distinct defect(s) on this criterion");
  });
});
