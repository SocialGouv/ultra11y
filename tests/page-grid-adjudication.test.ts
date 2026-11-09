// AN ADJUDICATED VERDICT HAS TO REACH THE PER-PAGE GRID.
//
// The grid is what a reviewer reads on a pull request — one row per page, with an « À évaluer »
// column — and it is the surface the whole adjudication tier exists to fill. If a verdict ruled
// at the standard's granularity stopped at the run-wide report, every page would keep showing
// « 90 à évaluer » on a run that had just decided 81 criteria, and the tier would look broken
// while working perfectly.
//
// It reaches it through one seam and one only: `derivePackResults(pageView(result, page))`.
// `pageView` narrows the criteria and findings to the page and carries everything else
// through — `packAdjudication` included — and `derivePackResults` prefers a recorded verdict
// over its own derivation. Pinned here because the two are in different modules, nothing else
// checks the join, and a `pageView` that "helpfully" dropped an unrelated field would silently
// empty the column.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { applyAdjudication, buildAdjudicationWorklist, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { pageCriterionRows, pageTally } from "../src/pages-report.js";
import { derivePages, pagesOf, attributePages, pageGridModel, unattributedFindings } from "../src/pages.js";
import type { AuditResult, Finding, PageScope } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-grid-adj-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><img src="/a.svg" alt="Schéma du parcours" class="fr-responsive-img"><a href="/contact" class="fr-link">Nous contacter</a></main></body></html>`,
);

const SCOPE: PageScope[] = [{ id: "aide", name: "Aide", url: "https://x/aide", sources: [PAGE], basis: "snapshot" }];

const file = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-18",
  items,
});

/** Rule every criterion that carries evidence, citing the evidence it was shown. */
function adjudicated(): AuditResult {
  const base = runAudit({ inputs: [PAGE] });
  const items = buildAdjudicationWorklist(base, { standard: "rgaa" }).map((i) =>
    i.evidence.length && i.evidenceComplete !== false
      ? ({ ...i, verdict: "C", justification: "vérifié sur la page", citations: [i.evidence[0]!] } as AdjudicationItem)
      : ({ ...i, verdict: "manual", reason: "undecidable" } as AdjudicationItem),
  );
  const r = applyAdjudication(base, file(items), { cwd: dir });
  expect(r.applied, r.issues.join("\n")).toBeGreaterThan(0);
  return r.audit;
}

const rowsFor = (audit: AuditResult) => {
  attributePages(audit, pagesOf(audit).length ? pagesOf(audit) : SCOPE);
  const page = derivePages(audit, SCOPE)[0]!;
  return pageCriterionRows(audit, page, "rgaa", "fr");
};

describe("the per-page grid carries what the adjudication decided", () => {
  it("drops « à évaluer » on the page for the criteria that were ruled", () => {
    const before = pageTally(rowsFor(runAudit({ inputs: [PAGE] })));
    const after = pageTally(rowsFor(adjudicated()));
    expect(after.manual).toBeLessThan(before.manual);
  });

  it("shows the verdict itself, and says an agent ruled it", () => {
    // `decidedBy: "agent"` also rides on a criterion the agent honestly left « manual », which
    // is right — the provenance says WHO looked, not what they concluded. What this pins is
    // that a DECIDED verdict reaches the page carrying its provenance, so a reader can tell a
    // conformity the engine proved from one an agent ruled.
    const rows = rowsFor(adjudicated());
    const ruled = rows.filter((r) => r.decidedBy === "agent" && r.status !== "manual");
    expect(ruled.length).toBeGreaterThan(0);
  });

  it("leaves a criterion the adjudication did NOT rule exactly where it was", () => {
    // The column has to stay honest: filling it is the point, faking it is the failure.
    const rows = rowsFor(adjudicated());
    expect(rows.some((r) => r.status === "manual")).toBe(true);
  });
});

describe("a non-conformity the agent ruled stays on the pages it was found on", () => {
  // Measured on a real 38-page RGAA sweep: seven NC verdicts, each resting on findings located on
  // zero to four pages, came back NC on all 38 — every sheet the same tally, whatever the page.
  const LABEL = (title: string) =>
    `<!doctype html><html lang="fr"><head><title>${title}</title></head><body><main><h1>${title}</h1><label for="e">Champ</label><input id="e" type="email"></main></body></html>`;

  function twoPages(): { audit: AuditResult; bad: string; good: string } {
    const bad = join(dir, "ruled-bad.html");
    const good = join(dir, "ruled-good.html");
    writeFileSync(bad, LABEL("Bad"));
    writeFileSync(good, LABEL("Good"));
    const audit = runAudit({ inputs: [bad, good] });
    audit.scope.pages = [
      { id: "bad", name: "Bad", url: "https://x/bad", sources: [bad], basis: "snapshot" },
      { id: "good", name: "Good", url: "https://x/good", sources: [good], basis: "snapshot" },
    ];
    audit.scope.pagesAudited = ["bad", "good"];
    attributePages(audit, audit.scope.pages);
    return { audit, bad, good };
  }

  const ruleOn = (audit: AuditResult, bad: string): AuditResult => {
    const target = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((item) => item.criteriaId === "11.2");
    expect(target, "11.2 has to be open for this test to mean anything").toBeDefined();
    const folded = applyAdjudication(
      audit,
      file([
        {
          ...target!,
          verdict: "NC",
          justification: "",
          findings: [{ file: bad, line: 1, message: "Étiquette non pertinente.", normativeRef: "11.2.1", snippet: "<label" }],
        } as AdjudicationItem,
      ]),
    );
    expect(folded.audit.packAdjudication?.criteria.find((c) => c.id === "11.2")?.status, folded.issues.join("\n")).toBe("NC");
    return folded.audit;
  };

  const grid = (audit: AuditResult) => {
    attributePages(audit, audit.scope.pages ?? []);
    return pageGridModel(audit, derivePages(audit, audit.scope.pages ?? []), "rgaa", "fr").status.get("11.2");
  };

  it("is NC where the finding is, and stays open where it is not", () => {
    const { audit, bad } = twoPages();
    const cells = grid(ruleOn(audit, bad));
    expect(cells?.get("bad")).toBe("NC");
    expect(cells?.get("good")).toBe("manual");
  });

  it("gives two pages two different sheets, and does not credit the agent where it ruled nothing", () => {
    const { audit, bad } = twoPages();
    const ruled = ruleOn(audit, bad);
    attributePages(ruled, ruled.scope.pages ?? []);
    const [badPage, goodPage] = derivePages(ruled, ruled.scope.pages ?? []);
    const badRows = pageCriterionRows(ruled, badPage!, "rgaa", "fr");
    const goodRows = pageCriterionRows(ruled, goodPage!, "rgaa", "fr");
    expect(pageTally(badRows).nc).toBe(pageTally(goodRows).nc + 1);
    expect(goodRows.find((r) => r.id === "11.2")?.decidedBy).toBeUndefined();
    expect(badRows.find((r) => r.id === "11.2")?.decidedBy).toBe("agent");
  });

  it("survives a JSON round-trip, where the verdict's findings are copies of the stamped ones", () => {
    const { audit, bad } = twoPages();
    const cells = grid(JSON.parse(JSON.stringify(ruleOn(audit, bad))) as AuditResult);
    expect(cells?.get("bad")).toBe("NC");
    expect(cells?.get("good")).toBe("manual");
  });

  it("leaves a run-wide C on every page: it is a claim about the run, and is labelled as one", () => {
    const { audit } = twoPages();
    const target = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((item) => item.criteriaId === "11.2");
    expect(target?.evidence.length).toBeGreaterThan(0);
    const folded = applyAdjudication(
      audit,
      file([{ ...target!, verdict: "C", justification: "Étiquettes pertinentes.", citations: [target!.evidence[0]!] } as AdjudicationItem]),
    );
    const cells = grid(folded.audit);
    expect(cells?.get("bad")).toBe("C");
    expect(cells?.get("good")).toBe("C");
  });

  const recorded = (finding: Finding): AuditResult => {
    const { audit } = twoPages();
    audit.findings = [...audit.findings, finding];
    audit.packAdjudication = { standard: "rgaa", criteria: [{ id: "11.2", status: "NC", findings: [finding], decidedBy: "agent" }] };
    return audit;
  };

  const AT = (file: string): Finding => ({
    ruleId: "agent-adjudication",
    criteriaId: "11.2",
    file,
    line: 1,
    col: 1,
    selectorHint: "label",
    severity: "majeur",
    message: "Étiquette non pertinente.",
    remediation: "r",
    snippet: "<label",
  });

  it("lands on every page that declares the component it was found in", () => {
    const audit = recorded(AT("src/Shared.tsx"));
    for (const page of audit.scope.pages ?? []) page.sources = [...(page.sources ?? []), "src/Shared.tsx"];
    const cells = grid(audit);
    expect(cells?.get("bad")).toBe("NC");
    expect(cells?.get("good")).toBe("NC");
  });

  it("reaches no page when no page claims it, and is counted rather than spread", () => {
    const audit = recorded(AT("src/Nobody.tsx"));
    const cells = grid(audit);
    expect(cells?.get("bad")).toBe("manual");
    expect(cells?.get("good")).toBe("manual");
    expect(unattributedFindings(audit).filter((f) => f.file === "src/Nobody.tsx")).toHaveLength(1);
  });
});

describe("a strict page grid can adjudicate a run-level non-conformity", () => {
  it("puts an NC criterion back on the worklist and accepts its adjudication when another page is still open", () => {
    const bad = join(dir, "bad-page.html");
    const good = join(dir, "good-page.html");
    writeFileSync(
      bad,
      '<!doctype html><html lang="fr"><head><title>Bad</title></head><body><main><h1>Bad</h1><input type="image" src="/x.png"></main></body></html>',
    );
    writeFileSync(good, '<!doctype html><html lang="fr"><head><title>Good</title></head><body><main><h1>Good</h1><p>Texte</p></main></body></html>');
    const audit = runAudit({ inputs: [bad, good] });
    audit.scope.pages = [
      { id: "bad", name: "Bad", url: "https://x/bad", sources: [bad], basis: "snapshot" },
      { id: "good", name: "Good", url: "https://x/good", sources: [good], basis: "snapshot" },
    ];
    audit.scope.pagesAudited = ["bad", "good"];
    attributePages(audit, audit.scope.pages);

    const before = pageGridModel(audit, derivePages(audit, audit.scope.pages), "rgaa", "fr");
    expect(before.status.get("1.1")?.get("bad")).toBe("NC");
    expect(before.status.get("1.1")?.get("good")).toBe("manual");

    const target = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((item) => item.criteriaId === "1.1");
    expect(target, "the page gate would otherwise be impossible to close").toBeDefined();
    const abstained = applyAdjudication(
      audit,
      file([
        {
          ...target!,
          verdict: "manual",
          reason: "undecidable",
          justification: "The available evidence does not settle the unaffected page.",
        },
      ]),
    );
    const afterAbstention = pageGridModel(abstained.audit, derivePages(abstained.audit, abstained.audit.scope.pages ?? []), "rgaa", "fr");
    expect(afterAbstention.status.get("1.1")?.get("bad"), "an agent abstention must not erase a deterministic failure").toBe("NC");

    const folded = applyAdjudication(
      audit,
      file([
        {
          ...target!,
          verdict: "NA",
          justification: "No informative image is present on the unaffected rendered page.",
          // The image button IS harvested for 1.1 now (RGAA 1.1.3 is about it), so the NA has to
          // say which of the evidence it rules out of scope — the gate refuses an uncited one.
          citations: target!.evidence.slice(0, 1),
          findings: [],
        },
      ]),
    );
    expect(folded.issues.join("\n")).not.toMatch(/not open for adjudication/);
    expect(folded.audit.packAdjudication?.criteria.find((criterion) => criterion.id === "1.1")?.status).toBe("NA");
  });
});
