// THE CRITERIA, NAMED, PAGE BY PAGE — on the explicit page surfaces a reviewer asks for.
//
// The ordinary job summary is run-level. The page scoreboard belongs to the `pages`/`full`
// sticky comments and the artifact, where its matrix and named criteria have enough context.
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

describe("the job summary stays run-level when pages are in scope", () => {
  it("does not carry the page names, scoreboard or page-specific criterion lists", () => {
    const md = stepSummary(audit(), { standard: "rgaa", lang: "fr" });
    expect(md).not.toContain("Accueil");
    expect(md).not.toContain("Contact");
    expect(md).not.toContain("Bilan page par page");
    expect(md).not.toMatch(/\|\s*🔴\s*\|\s*🟠\s*\|\s*🟡\s*\|/);
    // The run-wide non-conformity still names the projected RGAA criterion.
    expect(md).toContain("RGAA 1.1");
  });

  it("omits the page scoreboard in English too", () => {
    const md = stepSummary(audit(), { standard: "rgaa", lang: "en" });
    expect(md).not.toContain("Page-by-page scoreboard");
    expect(md).not.toContain("Accueil");
    expect(md).not.toContain("Contact");
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
