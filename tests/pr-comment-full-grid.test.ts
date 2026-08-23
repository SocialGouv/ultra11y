// THE COMMENT HAS TO CARRY THE WHOLE GRID, NOT A SUMMARY OF IT.
//
// The scoreboard says how many criteria each page conforms to; the per-page blocks say which
// ones it FAILS. Between the two, the criteria a page CONFORMS to were never named — and under
// a per-page norm like RGAA that is most of the deliverable. A reviewer asking « which of the
// 106 does this page pass? » had to download the artifact.
//
// So the comment carries the full criterion × page grid, collapsed. It is the same projection
// the artifact draws (`pageGridModel`), never a second computation of a status: a surface that
// recomputes a verdict is a surface that will disagree with the report.
import { describe, expect, it } from "vitest";
import { pagesComment } from "../src/annotate.js";
import type { AuditResult, CriterionResult, Finding, PageScope } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1.1",
  file: "src/a.html",
  line: 1,
  col: 1,
  selectorHint: "img",
  severity: "majeur",
  message: "image sans alternative",
  remediation: "ajouter un alt",
  snippet: "",
  ...over,
});
const C = (id: string, status: CriterionResult["status"], findings: Finding[] = []): CriterionResult => ({
  id,
  guideline: id.split(".").slice(0, 2).join("."),
  status,
  findings,
});
const PAGES: PageScope[] = [
  { id: "accueil", name: "Accueil", url: "https://x/", sources: ["app/page.tsx"], basis: "snapshot" },
  { id: "contact", name: "Contact", url: "https://x/contact", sources: ["app/contact/page.tsx"], basis: "snapshot" },
];
const audit = (over: Partial<AuditResult> = {}): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    date: "2026-08-18",
    scope: { inputs: [], files: 2, pages: PAGES },
    criteria: [C("1.1.1", "NC", [F({ page: "contact" })]), C("1.3.1", "C"), C("1.4.3", "NA")],
    guidelines: [],
    findings: [F({ page: "contact" })],
    residualRisks: [],
    conformancePct: 50,
    ...over,
  }) as unknown as AuditResult;

describe("the page comment carries the whole criterion grid", () => {
  it("names every criterion of the standard, not only the failing ones", () => {
    const md = pagesComment(audit(), { standard: "rgaa", lang: "fr" });
    // A handful spread across the themes — if the grid is there, they all are.
    for (const id of ["1.1", "5.1", "8.9", "11.1", "13.11"]) {
      expect(md, `RGAA ${id} is missing from the grid`).toMatch(new RegExp(`\\|\\s*${id.replace(".", "\\.")}\\b`));
    }
  });

  it("gives each page its own column, headed by its URL, so a cell is one page's standing on one criterion", () => {
    // The header carries the page's address rather than its name — see `pageColumnLabel`. Both
    // pages share an origin here, so the columns are paths and the origin is named once above.
    const md = pagesComment(audit(), { standard: "rgaa", lang: "fr" });
    const header = md.split("\n").find((l) => l.startsWith("|") && l.includes("| / |") && l.includes("| /contact |"));
    expect(header, "no grid header row with one column per page").toBeDefined();
    expect(md, "the origin the column paths are relative to is never stated").toContain("https://x");
  });

  it("says what conforms, not only what fails", () => {
    const md = pagesComment(audit(), { standard: "rgaa", lang: "fr" });
    // The grid marks C / NC / — / ? per cell; a conforming criterion must be visible as such.
    expect(md).toMatch(/\|\s*C\s*\|/);
  });

  it("folds it away, so the scoreboard stays the first thing a reviewer reads", () => {
    const md = pagesComment(audit(), { standard: "rgaa", lang: "fr" });
    const grid = md.indexOf("1.1");
    const scoreboard = md.indexOf("Accueil");
    expect(scoreboard).toBeLessThan(grid);
    expect(md).toContain("<details>");
  });

  it("drops the grid rather than shipping a truncated comment", () => {
    // 60 pages × 106 criteria does not fit in 64 KiB. The comment must stay valid and say what
    // it left out — never trail off mid-table.
    const many: PageScope[] = Array.from({ length: 60 }, (_, i) => ({
      id: `p${i}`,
      name: `Page numéro ${i} avec un nom réaliste et plutôt long`,
      url: `https://x/p${i}`,
      sources: ["app/page.tsx"],
      basis: "snapshot" as const,
    }));
    const md = pagesComment(audit({ scope: { inputs: [], files: 2, pages: many } } as Partial<AuditResult>), { standard: "rgaa", lang: "fr" });
    expect(md.length).toBeLessThan(65_536);
    expect(md.split("\n").every((l) => !l.startsWith("|") || l.endsWith("|"))).toBe(true);
  });
});
