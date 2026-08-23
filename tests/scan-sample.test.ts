// Task 5 — `scan --sample` data layer: a multi-page DynamicResult keeps per-page
// provenance through `mergeDynamic` (each merged Finding carries the page name + auth flag
// + reproduction notes), records the sample on scope.sample, and the report renders the
// « Constats par page » section + the ticket join (page name / auth / notes).
import { describe, it, expect } from "vitest";
import { runAudit } from "../src/audit.js";
import { mergeDynamic } from "../src/scan.js";
import { renderReport, renderPackReport } from "../src/report.js";
import { renderAuditorBacklog } from "../src/auditor.js";
import { checkReport } from "../src/check.js";
import { loadPack } from "../src/standards/index.js";
import type { DynamicResult } from "../src/types.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const base = runAudit({ inputs: [`${FIX}conforming/good.html`] });

const sampleDynamic: DynamicResult = {
  tool: "ultra11y",
  engine: "axe-core@playwright (local)",
  target: "2 page(s) (échantillon)",
  date: "2026-07-13",
  sample: {
    pages: [
      { id: "accueil", name: "Page d'accueil", url: "https://example.fr/" },
      { id: "compte", name: "Mon compte", url: "https://example.fr/compte", auth: true, notes: "Se connecter d'abord (compte de test)." },
    ],
    transverse: ["En-tête", "Navigation", "Pied de page"],
  },
  testedScs: ["1.4.4", "1.4.10", "1.4.12", "2.4.7", "1.4.13", "4.1.3"], // full local coverage
  findings: [
    {
      criteriaId: "1.4.10",
      axeRule: "reflow",
      impact: "serious",
      severity: "majeur",
      message: "Horizontal scrolling at 320px width.",
      selector: "document",
      snippet: "",
      engine: "reflow",
      page: "https://example.fr/",
      sample: { id: "accueil", name: "Page d'accueil" },
    },
    {
      criteriaId: "1.4.4",
      axeRule: "reflow-zoom",
      impact: "serious",
      severity: "majeur",
      message: "Text clipped at 200% zoom.",
      selector: "p.summary",
      snippet: "",
      engine: "reflow-zoom",
      page: "https://example.fr/compte",
      sample: { id: "compte", name: "Mon compte", auth: true, notes: "Se connecter d'abord (compte de test)." },
    },
  ],
};

describe("mergeDynamic keeps per-sample-page provenance", () => {
  const merged = mergeDynamic(base, sampleDynamic, "fr");

  it("records the sample on scope.sample (storageState-free) and flips the pages' criteria to NC", () => {
    expect(merged.scope.sample?.pages.map((p) => p.name)).toEqual(["Page d'accueil", "Mon compte"]);
    expect(merged.scope.sample?.transverse).toEqual(["En-tête", "Navigation", "Pied de page"]);
    expect(JSON.stringify(merged.scope.sample)).not.toContain("storageState");
    expect(merged.criteria.find((c) => c.id === "1.4.10")?.status).toBe("NC");
    expect(merged.criteria.find((c) => c.id === "1.4.4")?.status).toBe("NC");
  });

  it("records the scan's needs-rendering coverage on scope.scan (sorted union)", () => {
    expect(merged.scope.scan?.testedScs).toEqual(["1.4.10", "1.4.12", "1.4.13", "1.4.4", "2.4.7", "4.1.3"]);
  });

  it("carries the page name / auth / notes onto each merged Finding", () => {
    const reflow = merged.findings.find((f) => f.ruleId === "dyn-reflow");
    expect(reflow?.sample).toEqual({ page: "Page d'accueil" });
    const zoom = merged.findings.find((f) => f.ruleId === "dyn-reflow-zoom");
    expect(zoom?.sample).toEqual({ page: "Mon compte", authRequired: true, notes: "Se connecter d'abord (compte de test)." });
  });

  it("the auditor ticket join renders the page name + « authentification requise : oui » + the notes as repro steps", () => {
    const md = renderAuditorBacklog(merged, "fr", "wcag");
    expect(md).toContain("Mon compte · authentification requise : oui");
    expect(md).toContain("Se connecter d'abord (compte de test).");
    expect(md).toContain("Page d'accueil · authentification requise : non");
  });
});

describe("report « Constats par page » section", () => {
  const merged = mergeDynamic(base, sampleDynamic, "fr");

  it("renders a per-page synthesis (name + URL + auth badge + NC count) in the WCAG report", () => {
    const md = renderReport(merged, "fr");
    expect(md).toContain("## 📄 Constats par page");
    // Folded under the criteria × pages matrix: the identity line is the <summary>, not an
    // `###` heading, and carries the same name + URL + auth badge it always did.
    expect(md).toContain("<summary>Page d'accueil — <code>https://example.fr/</code> — 🌐 public</summary>");
    expect(md).toContain("<summary>Mon compte — <code>https://example.fr/compte</code> — 🔒 authentification requise</summary>");
    expect(md).toContain("Éléments transverses audités sur chaque page : En-tête, Navigation, Pied de page.");
    expect(md).toMatch(/- 1 non-conformité\(s\)/);
  });

  it("is present in the derived RGAA report too, and absent when no sample was scanned", () => {
    expect(renderPackReport(merged, loadPack("rgaa"), "fr")).toContain("## 📄 Constats par page");
    expect(renderReport(base, "fr")).not.toContain("Constats par page");
  });

  it("the structural `check` gate accepts a sample-merged report (per-page section + WCAG-id finding lines don't trip it)", () => {
    expect(checkReport(renderReport(merged, "fr"), "wcag", "fr").ok).toBe(true);
    expect(checkReport(renderPackReport(merged, loadPack("rgaa"), "fr"), "rgaa", "fr").ok).toBe(true);
  });
});
