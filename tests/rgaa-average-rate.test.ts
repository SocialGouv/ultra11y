// THE SECOND FIGURE THE RGAA METHOD ASKS OF A SAMPLE — « LE TAUX MOYEN DE CONFORMITÉ ».
//
// The method (accessibilite.numerique.gouv.fr/methode) publishes two rates for an audited
// sample: the GLOBAL rate, each criterion decided over the whole sample (`conformanceRate`),
// and the AVERAGE of the per-page rates, each page's rate being the same formula — validated ÷
// applicable — over that page alone. The declaration of accessibility reproduces both. The
// engine already decides every criterion page by page, and printed only the first: a bot
// reading the report had to answer « non calculé » for the second.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAudit } from "../src/audit.js";
import { checkReport } from "../src/check.js";
import { main } from "../src/cli.js";
import { attributePages, derivePages, pageScopesFrom } from "../src/pages.js";
import { pageCriterionRows, pageTally } from "../src/pages-report.js";
import { averageConformanceRate, conformanceRate, renderPackReport, renderReport } from "../src/report.js";
import { PAGES_DIR, readSnapshots } from "../src/snapshot.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

/** Three captured pages that fail differently, so their rates differ: the home page lacks its
 *  language (RGAA 8.3) and its title (RGAA 8.5), the contact page its title, the help page
 *  neither. Snapshots, not sources: a page judged on its source cannot be conforming by silence,
 *  so every page would rate 0 % and the mean would prove nothing. */
function threePages(): AuditResult {
  const root = mkdtempSync(join(tmpdir(), "u11y-avg-pages-"));
  const pages = [
    { id: "accueil", lang: false, title: false },
    { id: "contact", lang: true, title: false },
    { id: "aide", lang: true, title: true },
  ];
  const doms = pages.map((p) => {
    const dir = join(root, PAGES_DIR, p.id);
    mkdirSync(dir, { recursive: true });
    const url = `https://exemple.fr/${p.id}`;
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: p.id, name: p.id[0]!.toUpperCase() + p.id.slice(1), url }));
    writeFileSync(
      join(dir, "dom.html"),
      `<!-- ultra11y:capture v=1 page=${p.id} url=${url} -->\n<!doctype html><html${p.lang ? ' lang="fr"' : ""}><head>${p.title ? "<title>Page</title>" : ""}</head><body><main><h1>Page</h1><p>Texte</p></main></body></html>\n`,
    );
    return join(dir, "dom.html");
  });
  const audit = runAudit({ inputs: doms });
  audit.scope.pages = pageScopesFrom(readSnapshots(root));
  attributePages(audit, audit.scope.pages);
  rmSync(root, { recursive: true, force: true });
  return audit;
}

const audit = threePages();
const derived = derivePages(audit, audit.scope.pages ?? []);

describe("the average of the per-page rates", () => {
  const avg = averageConformanceRate(audit, derived, "rgaa", "fr");

  it("rates each page with the global formula, over that page alone", () => {
    expect(avg.pages.map((p) => p.id)).toEqual(derived.map((p) => p.id));
    expect(avg.pages).toHaveLength(3);
    for (const p of avg.pages) {
      const page = derived.find((d) => d.id === p.id)!;
      const rate = conformanceRate(pageTally(pageCriterionRows(audit, page, "rgaa", "fr")));
      expect(p).toMatchObject({ pct: rate.pct, validated: rate.validated, applicable: rate.applicable, open: rate.open });
    }
    // The fixture is only useful if the pages really differ.
    expect(new Set(avg.pages.map((p) => p.validated)).size).toBeGreaterThan(1);
  });

  it("is the mean of the exact per-page ratios, rounded once", () => {
    const mean = avg.pages.reduce((n, p) => n + p.validated / p.applicable, 0) / avg.pages.length;
    expect(avg.pct).toBe(Math.round(mean * 100));
  });

  it("is a floor while any averaged page has a criterion still open", () => {
    expect(avg.open).toBe(avg.pages.reduce((n, p) => n + p.open, 0));
    expect(avg.open).toBeGreaterThan(0);
  });

  it("has no mean, rather than 100 %, when no page has an applicable criterion", () => {
    const empty = averageConformanceRate(audit, [], "rgaa", "fr");
    expect(empty).toMatchObject({ pct: null, pages: [], excluded: [] });
  });
});

describe("the pack report prints it beside the global rate", () => {
  const md = renderPackReport(audit, loadPack("rgaa"), "fr");
  const avg = averageConformanceRate(audit, derived, "rgaa", "fr");

  it("right under the global rate in the header", () => {
    const lines = md.split("\n");
    const global = lines.findIndex((l) => l.startsWith("- **Taux de conformité RGAA"));
    expect(global).toBeGreaterThan(-1);
    expect(lines[global + 1]).toBe(
      `- **Taux moyen de conformité (provisoire)** : ${avg.pct}% — moyenne des taux de conformité (validés ÷ applicables) des 3 pages de l'échantillon`,
    );
  });

  it("in the summary facts, which the HTML dashboard shares", () => {
    expect(md).toContain(`- **Taux moyen de conformité** : ${avg.pct} % — moyenne des taux de conformité (validés ÷ applicables) des 3 pages de l'échantillon`);
  });

  it("with each page's own rate and operands in the per-page table", () => {
    for (const p of avg.pages) {
      const row = md.split("\n").find((l) => l.startsWith(`| ${p.id[0]!.toUpperCase()}${p.id.slice(1)} |`) && l.includes("÷"));
      expect(row, p.id).toContain(`| ${p.pct} % (${p.validated} ÷ ${p.applicable}) |`);
    }
  });

  it("in English too", () => {
    const en = renderPackReport(audit, loadPack("rgaa"), "en");
    expect(en).toContain(
      `- **Average conformity rate (provisional)** : ${avg.pct}% — mean of the per-page conformity rates (validated ÷ applicable) over the 3 sampled pages`,
    );
  });

  it("keeps every gate passing", () => {
    expect(checkReport(md, "rgaa", "fr", { audit }).issues).toEqual([]);
  });

  it("leaves the core WCAG report alone — it publishes no conformity rate to average", () => {
    expect(renderReport(audit, "fr")).not.toContain("Taux moyen de conformité");
  });
});

describe("`pages`", () => {
  let dir = "";
  afterEach(() => {
    vi.restoreAllMocks();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });
  async function pages(...args: string[]): Promise<string> {
    dir = mkdtempSync(join(tmpdir(), "u11y-avg-"));
    const file = join(dir, "audit.json");
    writeFileSync(file, JSON.stringify(audit));
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["pages", "--in", file, "--standard", "rgaa", "--lang", "fr", ...args])).toBe(0);
    return out.join("\n");
  }

  it("--json carries averageRate with the per-page rates it averages", async () => {
    const doc = JSON.parse(await pages("--json"));
    const avg = averageConformanceRate(audit, derived, "rgaa", "fr");
    expect(doc.averageRate).toEqual(JSON.parse(JSON.stringify(avg)));
    expect(doc.averageRate.pages).toHaveLength(3);
  });

  it("the grid prints the average and the per-page rates under it", async () => {
    const avg = averageConformanceRate(audit, derived, "rgaa", "fr");
    const grid = await pages("--format", "grid");
    expect(grid).toContain(`**Taux moyen de conformité (provisoire)** : ${avg.pct}% — moyenne`);
    for (const p of avg.pages) expect(grid).toContain(`${p.pct} % (${p.validated} ÷ ${p.applicable})`);
  });
});
