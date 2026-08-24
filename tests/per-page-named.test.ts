// THE CRITERIA, NAMED, PAGE BY PAGE — on the two surfaces a reviewer actually reads.
//
// The job summary has carried a page-by-page table for a while, and it carries COUNTS: page,
// basis, how many conform, how many do not, and the severity tallies. Counts are the right
// shape for a scoreboard and the wrong one for acting: « 65 / 6 » on a row tells a reader
// nothing about WHICH 6, and the ids live only in the artifact nobody downloads.
//
// And the pull-request surface had two documents under two markers — a code digest and a page
// scoreboard — so "the comment at the end with everything in it" did not exist: whichever kind
// the workflow picked, the other half was somewhere else.
import { describe, expect, it } from "vitest";
import { stepSummary, prComment, pagesComment } from "../src/annotate.js";
import { commentKindFrom } from "../src/pr-comment.js";
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
    scope: { inputs: [], files: 2, pages: PAGES, pagesAudited: ["accueil", "contact"] },
    criteria: [C("1.1.1", "NC", [F({ page: "contact" })]), C("1.3.1", "C"), C("1.4.3", "NA")],
    guidelines: [],
    findings: [F({ page: "contact" })],
    residualRisks: [],
    conformancePct: 50,
    ...over,
  }) as unknown as AuditResult;

describe("the job summary names the criteria under each page", () => {
  it("keeps the counts table", () => {
    const md = stepSummary(audit(), { standard: "rgaa", lang: "fr" });
    expect(md).toContain("Accueil");
    expect(md).toContain("Contact");
  });

  it("names the NON-CONFORMING criteria of a page, not just how many", () => {
    const md = stepSummary(audit(), { standard: "rgaa", lang: "fr" });
    // 1.1.1 fires on `contact`; under RGAA that is criterion 1.1.
    expect(md).toMatch(/`1\.1`/);
  });

  it("names the CONFORMING ones too — the half a scoreboard can never show", () => {
    const md = stepSummary(audit(), { standard: "rgaa", lang: "fr" });
    expect(md).toMatch(/conforme/i);
    // 8.3 (lang) and 8.5 (title) are the two RGAA criteria a snapshot earns by silence.
    expect(md).toMatch(/`8\.[35]`/);
  });

  it("folds the detail away, so the scoreboard stays what is read first", () => {
    const md = stepSummary(audit(), { standard: "rgaa", lang: "fr" });
    expect(md).toContain("<details>");
    // GFM needs a blank line after the summary or the table ships as literal pipes.
    expect(md).toMatch(/<\/summary>\n\n/);
  });

  it("says nothing extra when no page is in scope", () => {
    const noPages = audit({ scope: { inputs: [], files: 2 } } as Partial<AuditResult>);
    const md = stepSummary(noPages, { standard: "rgaa", lang: "fr" });
    // No PAGE block — keyed on the page names, not on `<details>`: the non-conformity table
    // now folds each criterion behind one of its own, and that fold is not a page.
    expect(md).not.toContain("Accueil");
    expect(md).not.toContain("Contact");
    expect(md).not.toContain(`${"Bilan page par page"}`);
  });

  it("says it in English too", () => {
    expect(stepSummary(audit(), { standard: "rgaa", lang: "en" })).toMatch(/conforming/i);
  });
});

// ONE COMMENT, WITH EVERYTHING IN IT.
//
// `digest` answers "what is broken in this diff"; `pages` answers "which pages conform, and on
// which criteria". Both are true and neither is the whole thing, and because each has its own
// sticky marker a workflow that wants both posts two comments. `full` is the single document:
// the digest's distinct defects AND the page-by-page grid, under one marker.
describe("comment-kind: full", () => {
  it("is a recognised kind", () => {
    expect(commentKindFrom("full")).toBe("full");
  });

  it("still falls back to the digest on anything unrecognised", () => {
    expect(commentKindFrom("pagez")).toBe("digest");
    expect(commentKindFrom(undefined)).toBe("digest");
  });

  it("carries the page grid AND the defect digest in one document", () => {
    const full = pagesComment(audit(), { standard: "rgaa", lang: "fr", kind: "full" });
    // From the pages half: the criterion × page grid.
    expect(full).toMatch(/\|\s*8\.3\b/);
    // From the digest half: a defect with its location, which the page half alone never shows
    // for a repository whose findings are not page-attributed.
    expect(full).toContain("src/a.html");
  });

  it("leaves the two single-purpose comments byte-identical", () => {
    const a = pagesComment(audit(), { standard: "rgaa", lang: "fr" });
    const b = pagesComment(audit(), { standard: "rgaa", lang: "fr", kind: "pages" });
    expect(b).toBe(a);
    expect(prComment(audit(), { standard: "rgaa", lang: "fr" })).not.toContain("Grille complète");
  });
});
