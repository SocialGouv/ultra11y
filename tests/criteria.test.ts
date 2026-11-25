import { describe, it, expect } from "vitest";
import { formatSC, formatPackCriterion, runCriteria, renderCriteriaReference } from "../src/criteria.js";
import { getSC } from "../src/wcag.js";
import { loadPack, listPacks, getCriterion as getPackCriterion } from "../src/standards/index.js";

describe("formatSC (WCAG core)", () => {
  it("renders id, title, level, guideline, automatability and rules", () => {
    const text = formatSC(getSC("1.1.1")!, "en");
    expect(text).toContain("1.1.1 — Non-text Content (A");
    expect(text).toContain("Guideline 1.1");
    expect(text).toContain("img-alt-missing");
    expect(text).toContain("Understanding");
  });
  it("shows the pack cross-reference (RGAA) for a mapped SC", () => {
    const text = formatSC(getSC("1.4.3")!, "en");
    expect(text).toContain("1.4.3 — Contrast (Minimum)");
    expect(text).toMatch(/RGAA 3\.2/);
  });

  it("renders the French title (W3C authorized translation) + localized guideline/principle when --lang fr", () => {
    const text = formatSC(getSC("1.4.3")!, "fr");
    expect(text).toContain("1.4.3 — Contraste (minimum)");
    expect(text).toContain("Règle 1.4 (Distinguable)");
    expect(text).toContain("principe 1 (Perceptible)");
  });
});

describe("formatPackCriterion (RGAA pack)", () => {
  it("renders the pack criterion with its WCAG mapping", () => {
    const pack = loadPack("rgaa");
    const text = formatPackCriterion(pack, getPackCriterion(pack, "8.3")!, "fr");
    expect(text).toContain("RGAA 8.3 —");
    expect(text).toContain("WCAG : 3.1.1");
  });
});

describe("runCriteria", () => {
  it("looks up a single WCAG success criterion (core)", () => {
    expect(runCriteria({ id: "1.4.3", lang: "en", standard: "wcag" })).toBe(0);
  });
  it("errors on an unknown SC", () => {
    expect(runCriteria({ id: "9.9.9", lang: "en", standard: "wcag" })).toBe(2);
  });
  it("rejects --theme on the WCAG core (themes are pack-scoped)", () => {
    expect(runCriteria({ theme: 1, lang: "en", standard: "wcag" })).toBe(2);
  });
  it("lists a pack theme and a pack criterion (--standard rgaa)", () => {
    expect(runCriteria({ theme: 8, lang: "fr", standard: "rgaa" })).toBe(0);
    expect(runCriteria({ id: "8.3", lang: "fr", standard: "rgaa" })).toBe(0);
    expect(runCriteria({ theme: 99, lang: "fr", standard: "rgaa" })).toBe(2);
  });
  it("lists the full WCAG reference by default", () => {
    expect(runCriteria({ list: true, lang: "en", standard: "wcag" })).toBe(0);
  });
});

describe("renderCriteriaReference", () => {
  const md = renderCriteriaReference();
  const mdEn = renderCriteriaReference("en");
  it("is a generated doc grouped by WCAG guideline — French by default, English on request", () => {
    expect(md).toContain("ne pas modifier à la main");
    expect(md).toContain("GÉNÉRÉ depuis src/data/wcag.json");
    expect(md).toContain("## 1.1 Équivalents textuels");
    expect(md).toContain("## 4.1 Compatible");
    expect(mdEn).toContain("do not edit by hand");
    expect(mdEn).toContain("GENERATED from src/data/wcag.json");
    expect(mdEn).toContain("## 1.1 Text Alternatives");
    expect(mdEn).toContain("## 4.1 Compatible");
  });
  it("includes a row for SC 1.1.1 with its rule and RGAA cross-ref", () => {
    expect(md).toMatch(/\| 1\.1\.1 \|.*\| A \|.*\| img-alt-missing/);
    expect(mdEn).toMatch(/\| 1\.1\.1 \|.*\| A \|.*\| img-alt-missing/);
  });

  it("has one table column per registered pack — never hardcoded to RGAA specifically", () => {
    for (const [doc, re] of [
      [md, /\| Critère \| Intitulé \| Niveau \| Automatisabilité \| Règles \|([^\n]*)\|/],
      [mdEn, /\| SC \| Title \| Level \| Automatability \| Rules \|([^\n]*)\|/],
    ] as const) {
      const header = re.exec(doc);
      expect(header).toBeTruthy();
      const packCols = header![1]!
        .split("|")
        .map((s) => s.trim())
        .filter(Boolean);
      expect(packCols).toEqual(listPacks().map((p) => p.name));
    }
  });
});
