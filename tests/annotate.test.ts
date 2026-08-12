import { describe, it, expect } from "vitest";
import { annotations, perPageTable, stepSummary } from "../src/annotate.js";
import { runAudit } from "../src/audit.js";
import type { AuditResult, Finding } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1.1",
  file: "src/a.html",
  line: 3,
  col: 5,
  selectorHint: "img",
  severity: "bloquant",
  message: "Image without a text alternative.",
  remediation: "Add an alt attribute.",
  snippet: "<img src=x>",
  sourceStart: 10,
  sourceEnd: 20,
  ...over,
});

const audit = (findings: Finding[], over: Partial<AuditResult> = {}): AuditResult =>
  ({
    findings,
    date: "2026-07-29",
    conformancePct: 80,
    scope: { inputs: [], files: 2 },
    criteria: [],
    guidelines: [],
    residualRisks: [],
    ...over,
  }) as unknown as AuditResult;

describe("workflow-command annotations", () => {
  it("emits one ::error:: per blocking finding, anchored at file/line/col", () => {
    const out = annotations(audit([F()]));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("::error file=src/a.html,line=3,col=5,title=");
    expect(out[0]).toContain("Image without a text alternative.");
  });

  it("maps severity onto the three GitHub annotation levels", () => {
    const out = annotations(audit([F({ severity: "bloquant" }), F({ severity: "majeur", sourceStart: 50 }), F({ severity: "mineur", sourceStart: 90 })]));
    expect(out[0]?.startsWith("::error ")).toBe(true);
    expect(out[1]?.startsWith("::warning ")).toBe(true);
    expect(out[2]?.startsWith("::notice ")).toBe(true);
  });

  it("never raises a non-normative recommendation above a notice", () => {
    expect(annotations(audit([F({ advisory: true })]))[0]?.startsWith("::notice ")).toBe(true);
  });

  it("escapes the data so a message with a newline or comma cannot break the command", () => {
    const out = annotations(audit([F({ message: "line one\nline two, with comma" })]));
    expect(out[0]).not.toContain("\n");
    expect(out[0]).toContain("%0A");
  });

  it("skips a URL-keyed finding — there is no repo line for GitHub to annotate", () => {
    expect(annotations(audit([F({ file: "https://example.com/" })]))).toEqual([]);
  });

  it("clamps line 0 to 1", () => {
    expect(annotations(audit([F({ line: 0, col: 0 })]))[0]).toContain("line=1,col=1");
  });

  it("honours a severity floor so a noisy backlog does not annotate everything", () => {
    const a = audit([F({ severity: "bloquant" }), F({ severity: "mineur", sourceStart: 50 })]);
    expect(annotations(a, { failOn: "bloquant" })).toHaveLength(1);
  });
});

describe("job summary", () => {
  it("reports the headline rate and the finding count", () => {
    const md = stepSummary(audit([F()]), { lang: "en" });
    expect(md).toContain("ultra11y");
    expect(md).toContain("80%");
    expect(md).toContain("1");
  });

  it("says so plainly when nothing was found", () => {
    expect(stepSummary(audit([]), { lang: "en" })).toMatch(/no non-conformity/i);
  });

  it("groups findings into a table by severity", () => {
    const md = stepSummary(audit([F(), F({ severity: "mineur", sourceStart: 50 })]), { lang: "en" });
    expect(md).toContain("| Severity |");
    expect(md).toContain("src/a.html:3");
  });

  it("speaks the pack criterion when a standard is projected", () => {
    const md = stepSummary(audit([F()]), { standard: "rgaa", lang: "fr" });
    expect(md).toContain("RGAA");
    expect(md).toContain("1.1");
  });

  it("renders the per-page grid when the audit carries pages", () => {
    const a = audit([F()], {
      scope: { inputs: [], files: 1, sample: { pages: [{ id: "accueil", name: "Accueil", url: "https://x/" }] } },
    } as unknown as Partial<AuditResult>);
    const md = stepSummary(a, { lang: "fr" });
    expect(md).toContain("Accueil");
  });
});

describe("the per-page scoreboard", () => {
  // The surface a reviewer scans on a PR. It keys on the pages IN SCOPE, not on
  // `scope.sample`: keying on the sample left every snapshotted page — the e2e plugins',
  // the dev side-car's and `scan`'s own — out of the table named after them.
  const withPages = (): AuditResult => {
    const r = runAudit({ inputs: ["-"], stdin: "<div><img src=x></div>" });
    r.scope.pages = [
      { id: "accueil", name: "Accueil", url: "https://exemple.fr/", basis: "snapshot" },
      { id: "compte", name: "Mon compte", url: "https://exemple.fr/compte", basis: "attributed", auth: true },
    ];
    // A claimed snapshot basis is only honoured when this audit says it read the page.
    r.scope.pagesAudited = ["accueil"];
    for (const f of r.findings) f.page = "accueil";
    return r;
  };

  it("renders one row per page with its rate and severity counts", () => {
    const md = perPageTable(withPages(), "wcag", "fr");
    expect(md).toContain("### Bilan page par page");
    expect(md).toContain("| Accueil — `https://exemple.fr/` | instantané |");
    expect(md).toContain("| Mon compte 🔒 — `https://exemple.fr/compte` | source |");
  });

  it("fires on snapshots alone, with no scanned sample declared", () => {
    const r = withPages();
    expect(r.scope.sample).toBeUndefined();
    expect(perPageTable(r, "wcag", "en")).toContain("Page-by-page scoreboard");
  });

  it("says out loud that a source-only page's silence is not conformity", () => {
    expect(perPageTable(withPages(), "wcag", "fr")).toContain("n'a pas d'instantané");
  });

  it("refuses a snapshot basis this audit cannot back, without claiming the snapshot is missing", () => {
    // A page whose DOM this run never read has no business earning conformity by silence. It is
    // reported as « non audité » and NOT as « source »: the snapshot exists, and saying otherwise
    // would be a different false statement rather than a smaller one.
    const r = withPages();
    r.scope.pagesAudited = [];
    const md = perPageTable(r, "wcag", "fr");
    expect(md).toContain("| Accueil — `https://exemple.fr/` | non audité |");
    expect(md).not.toContain("| Accueil — `https://exemple.fr/` | instantané |");
  });

  it("leaves an audit written before the evidence field existed exactly as it was", () => {
    const r = withPages();
    r.scope.pagesAudited = undefined;
    expect(perPageTable(r, "wcag", "fr")).toContain("| Accueil — `https://exemple.fr/` | instantané |");
  });

  it("reports unattributed findings as a count rather than spreading them over the pages", () => {
    const r = withPages();
    for (const f of r.findings) f.page = undefined;
    const md = perPageTable(r, "wcag", "fr");
    expect(md).toMatch(/ne sont rattachés à aucune page/);
  });

  it("is empty — not a stray heading — when no page is in scope", () => {
    expect(perPageTable(runAudit({ inputs: ["-"], stdin: "<div></div>" }), "wcag", "en")).toBe("");
  });

  it("still appears on a clean run, which is exactly when you want to see WHICH pages passed", () => {
    const r = runAudit({ inputs: ["-"], stdin: "<div><p>ok</p></div>" });
    r.scope.pages = [{ id: "accueil", name: "Accueil", url: "https://exemple.fr/", basis: "snapshot" }];
    expect(stepSummary(r, { standard: "wcag", lang: "en" })).toContain("Page-by-page scoreboard");
  });
});
