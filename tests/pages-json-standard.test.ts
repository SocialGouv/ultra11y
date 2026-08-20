// ONE COMMAND, ONE ANSWER.
//
// `pages --in … --standard rgaa --json` returned the WCAG core grid — 55 criteria, WCAG ids —
// while `--format report` with the SAME flag returned the RGAA grid of 106. Measured on a real
// audit: the JSON said `67 % (6/55)` and the report said `92 % (65/106)` about the same page,
// disagreeing on the number AND on what the number was a percentage of. A consumer reading the
// JSON (a dashboard, a gate, a person) had no way to know it was being handed a different
// standard from the one it asked for.
import { describe, expect, it } from "vitest";

import { derivePages, pageScopesFrom, pageView, renderPageGrid } from "../src/pages.js";
import { pageCoverage, pageCriterionRows, pageRatePct, pagesForStandard } from "../src/pages-report.js";
import { derivePackResults, loadPack } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";
import { runAudit } from "../src/audit.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGES_DIR, readSnapshots } from "../src/snapshot.js";

function auditWithPage(): AuditResult {
  const root = mkdtempSync(join(tmpdir(), "u11y-pjson-"));
  const dir = join(root, PAGES_DIR, "accueil");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: "accueil", name: "Accueil", url: "https://exemple.fr/" }));
  writeFileSync(
    join(dir, "dom.html"),
    `<!-- ultra11y:capture v=1 page=accueil url=https://exemple.fr/ -->\n<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><main><h1>Egapro</h1></main></body></html>\n`,
  );
  const result = runAudit({ inputs: [join(dir, "dom.html")] });
  // `runAudit` audits the DOM; the page SCOPE is what the CLI attaches from the snapshots on
  // disk. Same two steps here, so the projection under test sees a real page.
  result.scope.pages = pageScopesFrom(readSnapshots(root));
  return result;
}

describe("the JSON output speaks the standard it was asked for", () => {
  const result = auditWithPage();
  const scope = result.scope.pages ?? [];
  const core = derivePages(result, scope);

  it("keys the criteria on the pack, not on WCAG", () => {
    const [page] = pagesForStandard(result, core, "rgaa", "fr");
    // RGAA ids have two segments; WCAG success-criterion ids have three.
    for (const c of page!.criteria) expect(c.id, `"${c.id}" is not an RGAA criterion id`).toMatch(/^\d+\.\d+$/);
  });

  it("counts over the pack's own criteria, so the denominator matches its report", () => {
    const [page] = pagesForStandard(result, core, "rgaa", "fr");
    expect(page!.total).toBe(106);
    expect(page!.decided).toBeLessThanOrEqual(106);
  });

  it("leaves the core untouched — asking for WCAG still answers in WCAG", () => {
    const [page] = pagesForStandard(result, core, "wcag", "fr");
    expect(page!.total).toBe(core[0]!.total);
    for (const c of page!.criteria) expect(c.id).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// The same failure, one surface further along: `pagesForStandard` was taught to speak the
// pack, but the MARKDOWN GRID still read its rate row off `PageResult` — which is only ever
// the WCAG core projection. So the grid printed 106 rows and then announced « 89 % (9/55) »,
// while the same page's own dossier said 47/106. This grid is what `comment-kind: pages`
// pastes onto a pull request, so it is the number people actually read.
describe("the Markdown grid's rate is a summary of the grid, not of another standard", () => {
  const result = auditWithPage();
  const scope = result.scope.pages ?? [];

  const rateCell = (standard: "wcag" | "rgaa"): string => {
    const line = renderPageGrid(result, scope, standard, "fr")
      .split("\n")
      .find((l) => l.startsWith("| **Taux**"));
    if (!line) throw new Error("the grid has no rate row");
    return line;
  };

  it("counts out of the pack's criteria when a pack was asked for", () => {
    const grid = renderPageGrid(result, scope, "rgaa", "fr");
    // One row per RGAA criterion…
    expect(grid.split("\n").filter((l) => /^\| \d+\.\d+ \|/.test(l)).length).toBe(106);
    // …and a denominator that says so.
    expect(rateCell("rgaa")).toContain("/106)");
    expect(rateCell("rgaa")).not.toContain("/55)");
  });

  it("agrees with the per-page dossier, criterion for criterion", () => {
    const [page] = derivePages(result, scope);
    const rows = pageCriterionRows(result, page!, "rgaa", "fr");
    const cov = pageCoverage(rows);
    // The dossier's own numbers, rendered by its own helpers, must be the ones in the grid.
    expect(rateCell("rgaa")).toContain(`(${cov.decided}/${cov.total})`);
    const pct = pageRatePct(rows);
    expect(rateCell("rgaa")).toContain(pct === null ? "—" : `${pct} %`);
  });

  it("leaves the core grid exactly as it was", () => {
    const [page] = derivePages(result, scope);
    expect(rateCell("wcag")).toContain(`(${page!.decided}/${page!.total})`);
    expect(rateCell("wcag")).toContain("/55)");
  });
});

// "Does an RGAA run test all 106 criteria?" is not answered by a grid with 106 rows — that
// only proves the table is the right size. It is answered by every id the PACK declares
// reaching a status, exactly once, on every page, with nothing dropped, nothing duplicated
// and nothing invented. The failure this guards against is the quiet one: a projection that
// silently omits a criterion produces a report that is merely SHORTER, and a shorter
// deliverable reads exactly like a complete one.
describe("an RGAA projection puts EVERY criterion the pack declares through the mill", () => {
  const result = auditWithPage();
  const scope = result.scope.pages ?? [];
  const declared = loadPack("rgaa").criteria.map((c) => c.id);
  const STATUSES = ["C", "NC", "NA", "manual"];

  it("declares 106, so the rest of this describe means something", () => {
    expect(declared.length).toBe(106);
    expect(new Set(declared).size, "the pack declares an id twice").toBe(106);
  });

  it("gives each of them a status on the page, exactly once", () => {
    const [page] = pagesForStandard(result, derivePages(result, scope), "rgaa", "fr");
    const seen = page!.criteria.map((c) => c.id);
    expect(new Set(seen).size, "a criterion is projected twice").toBe(seen.length);
    expect([...seen].sort()).toEqual([...declared].sort());
    for (const c of page!.criteria) {
      expect(STATUSES, `${c.id} carries "${c.status}"`).toContain(c.status);
    }
  });

  it("counts them all, and counts nothing else", () => {
    const [page] = pagesForStandard(result, derivePages(result, scope), "rgaa", "fr");
    const t = { C: 0, NC: 0, NA: 0, manual: 0 };
    for (const c of page!.criteria) t[c.status as keyof typeof t]++;
    expect(t.C + t.NC + t.NA + t.manual).toBe(106);
    // `decided` is the rate's denominator and must never exceed the population.
    expect(page!.total).toBe(106);
    expect(page!.decided).toBeLessThanOrEqual(106);
    expect(page!.decided).toBe(t.C + t.NC);
  });

  // THE ROW LIST IS NOT THE PROOF. `pageCriterionRows` walks `pack.criteria` and looks each
  // status up in the projection, defaulting to `"manual"` when it is absent — so the grid is
  // structurally 106 rows long whatever the projection does, and a criterion the projection
  // dropped would quietly read « à évaluer » instead of disappearing. That fallback is the
  // right direction to fail in, and it is exactly why counting rows proves nothing about
  // coverage. The projection itself has to answer for all 106.
  it('has the PROJECTION cover all 106, without leaning on the `?? "manual"` fallback', () => {
    const [p0] = derivePages(result, scope);
    const projected = derivePackResults(pageView(result, p0!), "rgaa", p0!.id);
    const ids = projected.map((r) => r.id);
    expect(new Set(ids).size, "the projection emits a criterion twice").toBe(ids.length);
    expect([...ids].sort()).toEqual([...declared].sort());
    for (const r of projected) expect(STATUSES, `${r.id} carries "${r.status}"`).toContain(r.status);
  });

  // …and the same for the RUN's grid, which is the projection without a page id.
  it("covers all 106 on the run's own grid too", () => {
    const ids = derivePackResults(result, "rgaa").map((r) => r.id);
    expect([...ids].sort()).toEqual([...declared].sort());
  });

  it("says the same thing through pageCriterionRows, which the dossier and the grid share", () => {
    const [p0] = derivePages(result, scope);
    const rows = pageCriterionRows(result, p0!, "rgaa", "fr");
    expect(rows.length).toBe(106);
    expect([...rows.map((r) => r.id)].sort()).toEqual([...declared].sort());
    const cov = pageCoverage(rows);
    expect(cov.total).toBe(106);
    const pct = pageRatePct(rows);
    expect(pct === null || (pct >= 0 && pct <= 100)).toBe(true);
  });
});
