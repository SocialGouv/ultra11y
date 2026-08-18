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
import { derivePages, pagesOf, attributePages } from "../src/pages.js";
import type { AuditResult, PageScope } from "../src/types.js";

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
