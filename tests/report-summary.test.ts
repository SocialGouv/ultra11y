// THE ONE SCREEN A READER ACTUALLY READS.
//
// The conformance report opened on twelve header bullets, eight banners and a 106-row grid
// before the first non-conformity. What a reader came for — where does the site stand, what
// must be fixed, what does the next level take — was nowhere stated, and had to be pieced
// together from a synthesis table and a rate whose formula was spelled out in a footnote.
//
// The report now opens on a summary: the level on the standard's own published scale (RGAA:
// non conforme / partiellement conforme from 50 % / totalement conforme at 100 %), the
// non-conformities to fix as one table, and the arithmetic of the next step. Everything else
// is still there — folded, or moved to an appendix — and every gate still reads it.
import { describe, expect, it } from "vitest";

import { buildAudit, runAudit } from "../src/audit.js";
import { checkReport } from "../src/check.js";
import { renderHtmlDocument } from "../src/html.js";
import { compositeDoc, indexDoc } from "../src/html-report.js";
import { parseSource } from "../src/parse/source.js";
import { partitionUnits, prdUnits } from "../src/prd.js";
import { conformityScale, renderPackReport, reportSummary, summaryModel } from "../src/report.js";
import { loadPack } from "../src/standards/index.js";
import { validatePack } from "../src/standards/validate.js";
import { buildWorklist } from "../src/verify.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const RGAA_FR = conformityScale("rgaa", "fr");

describe("the scale comes from the pack, not from the engine", () => {
  it("reads RGAA's three published levels, highest first, in both languages", () => {
    expect(RGAA_FR).toEqual([
      { min: 100, label: "Totalement conforme" },
      { min: 50, label: "Partiellement conforme" },
      { min: 0, label: "Non conforme" },
    ]);
    expect(conformityScale("rgaa", "en").map((l) => l.label)).toEqual(["Fully compliant", "Partially compliant", "Non-compliant"]);
  });

  it("has no scale for the WCAG core, which states a verdict instead", () => {
    expect(conformityScale("wcag", "fr")).toEqual([]);
  });

  it("warns — never fails — on a malformed scale in a runtime pack", () => {
    const pack = {
      key: "mypack",
      name: "MyPack",
      org: "Org",
      country: "XX",
      baseVersion: "1.0",
      wcagVersion: "2.2",
      locales: ["en"],
      defaultLocale: "en",
      license: "x",
      source: "https://x",
      attribution: "x",
      idPattern: "^\\d+\\.\\d+$",
      themes: [{ number: 1, name: { en: "Images" }, count: 1 }],
      criteria: [{ id: "1.1", theme: 1, title: { en: "Alt" }, titlePlain: { en: "Alt" }, wcag: ["1.1.1"] }],
      conformityLevels: [{ min: 150, label: {} }, "nope"],
    };
    const r = validatePack(pack);
    expect(r.ok).toBe(true);
    expect(r.issues.filter((i) => i.path.startsWith("conformityLevels")).every((i) => i.severity === "warn")).toBe(true);
    expect(r.issues.some((i) => i.path.startsWith("conformityLevels"))).toBe(true);
  });
});

describe("reportSummary — the level and the road to the next one", () => {
  it("places egapro's grid (91 C / 10 NC / 32 NA / 5 open) and says what the next level takes", () => {
    const sum = reportSummary({ c: 91, nc: 10, na: 32, manual: 5 }, RGAA_FR);
    expect(sum.rate).toMatchObject({ pct: 80, validated: 59, applicable: 74, open: 5 });
    expect(sum.level?.label).toBe("Partiellement conforme");
    // Every open criterion validated: 64 ÷ 74 — still not every criterion, so still partial.
    expect(sum.ceilingPct).toBe(86);
    expect(sum.best?.label).toBe("Partiellement conforme");
    expect(sum.afterFix).toMatchObject({ validated: 69, pct: 93 });
    expect(sum.afterFix?.level?.label).toBe("Partiellement conforme");
    // Totalement conforme needs all 74; fixing gives 10 of the 15 missing, the open ones the rest.
    expect(sum.next).toMatchObject({ need: 74, missing: 15, fromNc: 10, fromOpen: 5 });
    expect(sum.next?.level.label).toBe("Totalement conforme");
  });

  it("applies the threshold to the criteria, not to the rounded percentage", () => {
    // 50 of 101 is 49.5 %: the headline rounds it to 50 %, the scale does not.
    const sum = reportSummary({ c: 55, nc: 51, na: 5, manual: 0 }, RGAA_FR);
    expect(sum.rate).toMatchObject({ pct: 50, validated: 50, applicable: 101 });
    expect(sum.level?.label).toBe("Non conforme");
    expect(sum.next).toMatchObject({ need: 51, missing: 1, fromNc: 1, fromOpen: 0 });
  });

  it("says fixing is enough when it is, and names the level it reaches", () => {
    const m = summaryModel("fr", "RGAA 4.1.2", "rgaa", { c: 64, nc: 10, na: 0, manual: 0 }, [], 0);
    expect(m.headline[0]).toBe("Niveau de conformité RGAA 4.1.2 : Partiellement conforme");
    expect(m.next?.steps).toHaveLength(1);
    expect(m.next?.steps[0]?.[1]).toContain("le taux passe à 100 % (74 ÷ 74), soit « Totalement conforme »");
  });

  it("does not repeat the current level as if fixing changed it", () => {
    const m = summaryModel("fr", "RGAA 4.1.2", "rgaa", { c: 2, nc: 5, na: 2, manual: 99 }, [], 0);
    expect(m.next?.steps[0]?.[1]).not.toContain("soit « Non conforme »");
    expect(m.next?.steps.map(([what]) => what)).toEqual([
      "Corriger les 5 critère(s) non conforme(s)",
      "Viser « Partiellement conforme » (50 %)",
      "Faire évaluer les 99 critère(s) restants",
    ]);
  });

  it("stops at the top of the scale instead of inventing a next step", () => {
    const sum = reportSummary({ c: 80, nc: 0, na: 10, manual: 0 }, RGAA_FR);
    expect(sum.level?.label).toBe("Totalement conforme");
    expect(sum.next).toBeUndefined();
    const m = summaryModel("fr", "RGAA 4.1.2", "rgaa", { c: 80, nc: 0, na: 10, manual: 0 }, [], 0);
    expect(m.next?.steps.map(([what]) => what)).toEqual(["Niveau le plus élevé atteint"]);
  });

  it("names no level when nothing is applicable", () => {
    const m = summaryModel("fr", "RGAA 4.1.2", "rgaa", { c: 40, nc: 0, na: 40, manual: 0 }, [], 0);
    expect(m.headline[0]).toBe("Niveau de conformité RGAA 4.1.2 : non calculable");
    expect(reportSummary({ c: 40, nc: 0, na: 40, manual: 0 }, RGAA_FR).level).toBeUndefined();
  });

  it("gives the WCAG core a verdict and no level", () => {
    expect(summaryModel("en", "WCAG 2.2 Level AA", "wcag", { c: 3, nc: 2, na: 1, manual: 50 }, [], 0).headline[0]).toBe(
      "WCAG 2.2 Level AA conformance: not met",
    );
    const open = summaryModel("en", "WCAG 2.2 Level AA", "wcag", { c: 3, nc: 0, na: 1, manual: 50 }, [], 0);
    expect(open.headline[0]).toBe("WCAG 2.2 Level AA conformance: not established");
    // No level to be a floor of: the open criteria keep conformance from being established.
    expect(open.next?.steps[0]?.[1]).toContain("conformance cannot be established");
    expect(open.next?.steps[0]?.[1]).not.toContain("level");
  });
});

describe("the RGAA report opens on the summary", () => {
  const audit = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });
  const md = renderPackReport(audit, loadPack("rgaa"), "fr");
  const { nc, advisory } = partitionUnits(prdUnits(audit, "rgaa", "fr"));

  it("puts the level, the fixes and the next steps before the synthesis", () => {
    const at = (needle: string) => md.indexOf(needle);
    expect(at("## Résumé")).toBeGreaterThan(-1);
    expect(at("**Niveau de conformité RGAA 4.1.2 : Non conforme** (provisoire)")).toBeGreaterThan(at("## Résumé"));
    expect(at("### Ce qu'il faut corriger")).toBeLessThan(at("### Pour atteindre un meilleur niveau"));
    expect(at("### Pour atteindre un meilleur niveau")).toBeLessThan(at("## 1."));
    expect(md).toContain("- **Échelle** : Non conforme sous 50 % · Partiellement conforme dès 50 % · Totalement conforme à 100 %");
  });

  it("lists exactly the §2 non-conformities in the fix table, each with its occurrences and a fix", () => {
    const rows = md.split("\n").filter((l) => /^\| (🔴|🟠|🟡) /.test(l));
    expect(rows).toHaveLength(nc.length);
    for (const u of nc) expect(rows.some((r) => r.includes(`| ${u.label} |`))).toBe(true);
    for (const u of advisory) expect(rows.some((r) => r.includes(u.label))).toBe(false);
  });

  it("prints plain criterion titles, not glossary links that resolve nowhere in the report", () => {
    expect(md).not.toMatch(/\]\(#[a-z0-9-]+\)/);
  });

  it("keeps the report's header to three lines, and the method in the annex's", () => {
    const header = md.slice(0, md.indexOf("\n## "));
    expect(header.split("\n").filter((l) => l.startsWith("- **"))).toHaveLength(3);
    expect(header).not.toContain("Provenance des décisions");
    const annex = md.slice(md.indexOf("<!-- ultra11y:annex"));
    const annexHeader = annex.slice(0, annex.indexOf("\n## "));
    expect(annexHeader).toContain("Provenance des décisions");
    expect(annexHeader).toContain("Contrat d'automatisation RGAA");
  });
});

describe("every gate still reads the new shape", () => {
  // Seven unlabelled fields: enough occurrences for the checklist to fold behind a toggle.
  const html = `<!doctype html><html lang="fr"><head><title>Contact</title></head><body><main><h1>Contact</h1><form>${'<input type="text" name="f">'.repeat(7)}<button type="submit">Envoyer</button></form></main></body></html>`;
  const audit = buildAudit([parseSource(html, "contact.html")], ["contact.html"]);
  const md = renderPackReport(audit, loadPack("rgaa"), "fr");
  const { nc } = partitionUnits(prdUnits(audit, "rgaa", "fr"));

  it("passes `check`, including the NC projection gate against the audit", () => {
    expect(checkReport(md, "rgaa", "fr", { audit }).issues).toEqual([]);
  });

  it("folds a long checklist without hiding a single occurrence from `verify`", () => {
    expect(md).toContain("<summary>Voir les 7 occurrences</summary>");
    const occurrences = nc.reduce((n, u) => n + u.findings.filter((f) => !f.advisory).length, 0);
    const items = buildWorklist(md, "rgaa", Number.POSITIVE_INFINITY);
    expect(items).toHaveLength(occurrences);
    expect(items.filter((it) => it.criteriaId === "11.1").length).toBeGreaterThanOrEqual(7);
  });

  it("never lets a recommendation into the worklist", () => {
    const withAdvice = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });
    const doc = renderPackReport(withAdvice, loadPack("rgaa"), "fr");
    const parts = partitionUnits(prdUnits(withAdvice, "rgaa", "fr"));
    expect(parts.advisory.length).toBeGreaterThan(0);
    const advisoryIds = new Set(parts.advisory.map((u) => u.criteriaId));
    expect(buildWorklist(doc, "rgaa", Number.POSITIVE_INFINITY).some((it) => advisoryIds.has(it.criteriaId))).toBe(false);
  });
});

describe("the HTML deliverable carries the same summary", () => {
  const audit = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });

  it("opens the dashboard and the composite on the level", () => {
    for (const doc of [indexDoc(audit, { lang: "fr", standard: "rgaa" }), compositeDoc(audit, { lang: "fr", standard: "rgaa" })]) {
      expect(doc.blocks[0]).toMatchObject({ kind: "heading", text: "Résumé" });
      const html = renderHtmlDocument(doc);
      expect(html).toContain("Niveau de conformité RGAA 4.1.2 : Non conforme");
      expect(html).toContain("Pour atteindre un meilleur niveau");
    }
  });
});
