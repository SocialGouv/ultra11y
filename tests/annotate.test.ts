import { describe, it, expect } from "vitest";
import { annotations, perPageTable, prComment, stepSummary } from "../src/annotate.js";
import { runAudit } from "../src/audit.js";
import type { AuditResult, Finding } from "../src/types.js";
import { allSC } from "../src/wcag.js";

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

/** Criterion rows, so the headline rate has a denominator to be honest about. An audit whose
 *  `criteria` is empty has decided nothing, and that is what the surfaces must say. */
const CRITERIA = [
  { id: "1.1.1", guideline: "1.1", status: "NC", findings: [] },
  { id: "1.4.3", guideline: "1.4", status: "C", findings: [] },
  { id: "2.4.7", guideline: "2.4", status: "C", findings: [] },
  { id: "1.4.11", guideline: "1.4", status: "manual", findings: [] },
  // Conforming for want of a subject: no form control on the page, so nothing to instruct.
  // Reads `C` like any other conformity and is flagged for what it is (INAPPLICABLE_STATUS).
  { id: "3.3.2", guideline: "3.3", status: "C", inapplicable: true, findings: [] },
] as unknown as AuditResult["criteria"];
const GUIDELINES = [
  { key: "1.1", title: "Text Alternatives", c: 0, nc: 1, na: 0, manual: 0 },
  { key: "1.4", title: "Distinguishable", c: 1, nc: 0, na: 0, manual: 1 },
  { key: "2.4", title: "Navigable", c: 1, nc: 0, na: 0, manual: 0 },
  { key: "3.3", title: "Input Assistance", c: 1, nc: 0, na: 1, manual: 0 },
] as unknown as AuditResult["guidelines"];
const decided = (over: Partial<AuditResult> = {}): Partial<AuditResult> => ({ criteria: CRITERIA, guidelines: GUIDELINES, ...over });

describe("job summary", () => {
  it("reports coverage without turning it into a score", () => {
    const md = stepSummary(audit([F()], decided()), { lang: "en" });
    expect(md).toContain("ultra11y");
    expect(md).toContain("4/5 criteria decided in this run");
    expect(md).toContain("1 still to complete by scan or adjudication");
    expect(md).not.toContain("80 %");
    expect(md).toContain("1");
  });

  // THE #16 FAILURE, at the run grain. `conformancePct` is 80 on this fixture whatever the
  // criteria say, and the headline used to print it naked. Four decided out of five is the
  // fact a reviewer needs in order to know what the 80 % is a percentage OF — four, because a
  // criterion closed for want of a subject is decided (INAPPLICABLE_STATUS), not pending.
  it("never prints a percentage on a GitHub surface", () => {
    const md = stepSummary(audit([F()], decided()), { lang: "en" });
    expect(md).toContain("**4/5 criteria decided in this run**");
    expect(md).not.toContain("%");
  });

  // …and an audit that decided nothing has no rate at all, rather than a flattering one.
  it("states an empty coverage instead of inventing a score", () => {
    const md = stepSummary(audit([F()]), { lang: "en" });
    expect(md).toContain("**0/0 criteria decided in this run**");
    expect(md).not.toContain("80 %");
  });

  it("marks a conformity an agent RULED, so it is never read as one the engine proved", () => {
    const ruled = CRITERIA.map((c, i) => (i === 1 ? { ...c, decidedBy: "agent" as const } : c));
    const md = stepSummary(audit([F()], decided({ criteria: ruled })), { lang: "en" });
    expect(md).toContain("**4/5 criteria decided in this run**");
    expect(md).toContain("3 engine · 1 agent");
    expect(md).toContain("`C*`");
  });

  it("regresses the Egapro run without mixing the WCAG rate and RGAA grid", () => {
    const findings = [
      F({ ruleId: "th-no-data-cells", criteriaId: "1.3.1", line: 62, selectorHint: "th.fr-cell--fixed", severity: "mineur" }),
      F({ ruleId: "th-no-data-cells", criteriaId: "1.3.1", line: 87, selectorHint: "th#actions", severity: "mineur", sourceStart: 50 }),
      F({ ruleId: "dl-structure", criteriaId: "1.3.1", line: 249, selectorHint: "dt.label", severity: "majeur", sourceStart: 90 }),
      F({ ruleId: "dl-structure", criteriaId: "1.3.1", line: 250, selectorHint: "dd", severity: "majeur", sourceStart: 130 }),
    ];
    const conforming = new Set(["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5", "1.4.2", "2.1.4", "2.4.2", "2.5.1", "2.5.4", "3.1.1"]);
    const criteria = allSC().map((sc) => ({
      id: sc.sc,
      guideline: sc.guideline,
      status: sc.sc === "1.3.1" ? ("NC" as const) : conforming.has(sc.sc) ? ("C" as const) : ("manual" as const),
      ...(conforming.has(sc.sc) && sc.sc !== "2.4.2" && sc.sc !== "3.1.1" ? { inapplicable: true } : {}),
      findings: sc.sc === "1.3.1" ? findings : [],
    })) as AuditResult["criteria"];
    const result = audit(findings, {
      conformancePct: 92,
      criteria,
      scope: {
        inputs: ["packages/app/src"],
        files: 325,
        subjectsSeen: [
          "autocomplete",
          "contextChange",
          "controls",
          "declaredLang",
          "downloadDocs",
          "errors",
          "frames",
          "images",
          "links",
          "lists",
          "newWindow",
          "tables",
        ],
      },
    });

    const md = stepSummary(result, { standard: "rgaa", lang: "fr" });
    expect(md).toContain("11/106 critères tranchés dans ce run");
    expect(md).toContain("95 à compléter par scan ou adjudication");
    expect(md).not.toContain("92 %");
    expect(md).not.toContain("4 occurrence(s)");
    expect(md).toContain("Aucune non-conformité détectée");
    expect(md).not.toContain("| Sévérité | Critère |");

    const comment = prComment(result, { standard: "rgaa", lang: "fr" });
    expect(comment).toContain("11/106 critères tranchés dans ce run");
    expect(comment).not.toContain("92 %");
    expect(comment).not.toMatch(/4 constat\(s\).*aucune page/);
    expect(comment).toContain("0 page rendue : aucun test rendered n'a été exécuté");
    expect(comment).toContain("17 test(s) static — critères :");
    expect(comment).toContain("238 test(s) judgment sur 97 critère(s), tous transmis à l'IA");
    expect(comment).toContain("49 critère(s) reçoivent un signal normatif");
    expect(comment).toContain("15 critère(s) peuvent produire un NC décisif");
    expect(comment).toContain("41 reçoivent des preuves candidates");
    expect(comment).not.toContain("Grille exhaustive des critères");
    expect(comment).not.toContain("Synthèse par thématique");
  });

  it("names the rendered pages in the compact PR scope", () => {
    const result = audit([], {
      scope: {
        inputs: ["src"],
        files: 2,
        pagesAudited: ["accueil", "contact"],
        pages: [
          { id: "accueil", name: "Accueil", url: "https://example.test/", sources: [], basis: "snapshot" },
          { id: "contact", name: "Contact", url: "https://example.test/contact", sources: [], basis: "snapshot" },
        ],
      },
    });
    const comment = prComment(result, { standard: "rgaa", lang: "fr" });
    expect(comment).toContain("Pages testées : Accueil (`https://example.test/`) · Contact (`https://example.test/contact`)");
  });

  it("says so plainly when nothing was found", () => {
    expect(stepSummary(audit([]), { lang: "en" })).toMatch(/no non-conformity/i);
  });

  it("groups findings into a table by severity", () => {
    const md = stepSummary(audit([F(), F({ severity: "mineur", sourceStart: 50 })]), { lang: "en" });
    expect(md).toContain("| Severity |");
    expect(md).toContain("src/a.html:3");
  });

  // THE #16 FAILURE, at the finding grain: 472 occurrences of one rule across 38 routes, for
  // seven distinct selectors. Listed one per row it is unreadable; cut at 50 rows it lies
  // about the shape of the problem.
  it("folds one design-system defect repeated across routes into a single row", () => {
    const many = Array.from({ length: 40 }, (_, i) => F({ ruleId: "rendered-link-colour-only", selectorHint: "a.fr-link", file: `p${i}.html`, page: `p${i}` }));
    const md = stepSummary(audit([...many, F({ selectorHint: "a.fr-btn" })]), { lang: "en" });
    // Both findings sit under the same criterion, so the table is ONE criterion row; the two
    // distinct defects live in its fold, and neither count is hidden by the folding.
    expect(md).toContain("1 criterion(ia) · 2 distinct defect(s) · 41 occurrence(s)");
    const rows = md.split("\n").filter((l) => l.startsWith("| 🔴 bloquant |"));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("| WCAG 1.1.1 | 2 | 41 |");
    expect(md).toMatch(/\| 40 \| 40 \|/);
  });

  it("speaks the pack criterion when a standard is projected", () => {
    const finding = F();
    const criteria = allSC().map((sc) => ({
      id: sc.sc,
      guideline: sc.guideline,
      status: sc.sc === "1.1.1" ? ("NC" as const) : ("manual" as const),
      findings: sc.sc === "1.1.1" ? [finding] : [],
    })) as AuditResult["criteria"];
    const md = stepSummary(audit([finding], { criteria, scope: { inputs: [], files: 1, subjectsSeen: ["images"] } }), { standard: "rgaa", lang: "fr" });
    expect(md).toContain("RGAA");
    expect(md).toContain("1.1");
  });

  it("does not append the page scoreboard or cross-grid when the audit carries pages", () => {
    const a = audit([F()], {
      scope: {
        inputs: [],
        files: 1,
        sample: {
          pages: [
            { id: "accueil", name: "Accueil", url: "https://x/" },
            { id: "contact", name: "Contact", url: "https://x/contact" },
          ],
        },
      },
    } as unknown as Partial<AuditResult>);
    const md = stepSummary(a, { standard: "rgaa", lang: "fr" });
    expect(md).not.toContain("Bilan page par page");
    expect(md).not.toContain("Accueil");
    expect(md).not.toContain("Contact");
    expect(md).not.toContain("| / |");
    expect(md).not.toContain("le détail critère par critère");
    expect(md).not.toMatch(/\|\s*🔴\s*\|\s*🟠\s*\|\s*🟡\s*\|/);
  });
});

// The pull-request digest is a DIFFERENT document from the job summary, not a truncation of
// it. Nothing tested this surface before: `emitCiFormat` posted the summary string to both.
describe("the pull-request digest", () => {
  it("leads with a verdict a reviewer can act on without reading the table", () => {
    expect(prComment(audit([F()], decided()), { lang: "en" })).toContain("🔴 1 blocking non-conformity(ies)");
    expect(prComment(audit([F({ severity: "mineur" })], decided()), { lang: "en" })).toContain("🟠 No blocking non-conformity");
    expect(prComment(audit([], decided()), { lang: "en" })).toContain("✅ No non-conformity");
  });

  it("carries coverage without a percentage, like every GitHub surface", () => {
    const md = prComment(audit([F()], decided()), { lang: "en" });
    expect(md).toContain("**4/5 criteria decided in this run**");
    expect(md).not.toContain("80 %");
  });

  it("keeps the exhaustive grid in the artifact and carries only the actionable digest", () => {
    const many = Array.from({ length: 25 }, (_, i) => F({ selectorHint: `sel-${i}`, file: `p${i}.html` }));
    const md = prComment(audit(many, decided()), { lang: "en" });
    expect(md).not.toMatch(/^## 1\. /m);
    expect(md).not.toContain("Exhaustive criterion grid");
    expect(md).toContain("distinct defect(s)");
  });

  it("links the run and names the artifact only when the caller says one exists", () => {
    const withBoth = prComment(audit([F()], decided()), { lang: "en", runUrl: "https://gh/run/1", artifactName: "ultra11y-rgaa" });
    expect(withBoth).toContain("[See the run and its job summary](https://gh/run/1)");
    expect(withBoth).toContain("artifact **ultra11y-rgaa**");
    // No artifact was uploaded ⇒ no dead reference to one.
    const linkOnly = prComment(audit([F()], decided()), { lang: "en", runUrl: "https://gh/run/1" });
    expect(linkOnly).not.toMatch(/artifact \*\*/);
  });

  // An artifact is not addressable by URL while its run is in flight, so an embedded crop
  // renders as a broken image on every pull request. The comment links; it never shows.
  it("never embeds an image", () => {
    expect(prComment(audit([F()], decided()), { lang: "en" })).not.toContain("![");
  });

  // Ten rows of ordinary width fit easily; ten rows of a pathological rendered-DOM selector
  // do not. Nothing clamped this path before, so such a run posted a body the API rejected
  // with a 422 and the step reported "PR comment failed" with no idea why.
  const pathological = () => Array.from({ length: 20 }, (_, i) => F({ selectorHint: `sel-${i}`, message: `${"m".repeat(9000)}-${i}`, file: `page-${i}.html` }));

  it("stays under GitHub's 65 536-character body limit, and says what it dropped", () => {
    const md = prComment(audit(pathological(), decided()), { lang: "en", runUrl: "https://gh/run/1" });
    expect(md.length).toBeLessThanOrEqual(65_536);
    expect(md).toMatch(/dropped from this comment to fit GitHub's limit/);
    // Whatever was dropped, the verdict and the way out survive.
    expect(md).toContain("🔴");
    expect(md).toContain("https://gh/run/1");
  });

  it("clamps by whole blocks — the document never ends on a half-written table", () => {
    const lines = prComment(audit(pathological(), decided()), { lang: "en" }).split("\n");
    expect(lines[lines.length - 1]).not.toMatch(/^\|/);
    // Every table row that survived is a complete one — the invariant a byte-offset cut breaks.
    for (const l of lines.filter((x) => x.trimStart().startsWith("|"))) {
      expect(l.trimEnd().endsWith("|"), `half-written row: ${l}`).toBe(true);
    }
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

  it("stays out of the job summary, where the run-level result is the only useful digest", () => {
    const r = runAudit({ inputs: ["-"], stdin: "<div><p>ok</p></div>" });
    r.scope.pages = [{ id: "accueil", name: "Accueil", url: "https://exemple.fr/", basis: "snapshot" }];
    const summary = stepSummary(r, { standard: "wcag", lang: "en" });
    expect(summary).not.toContain("Page-by-page scoreboard");
    expect(summary).not.toMatch(/\|\s*🔴\s*\|\s*🟠\s*\|\s*🟡\s*\|/);
    // The explicit page document remains available to callers that asked for it.
    expect(perPageTable(r, "wcag", "en")).toContain("Page-by-page scoreboard");
  });
});
