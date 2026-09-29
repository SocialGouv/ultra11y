// ONE REPORT FOR THE READER, ONE ANNEX FOR THE PERSON DOING THE WORK.
//
// The report was written for its own gates: every non-conformity came with `file:line`, CSS
// selectors, axe-core's English rule messages, the engine's automatic rate, its S/R/J test
// contract and the commands to run next — all before a product owner could find out which page
// of the site was broken. It is now two files: `<standard>-<date>.md`, which says where the site
// stands, what to fix and on which URLs, and `annexe-technique-<standard>-<date>.md`, which keeps
// everything the developer and the auditor need. The gates read both, and refuse the report
// when its annex is gone.
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAudit, runAudit } from "../src/audit.js";
import { checkReport } from "../src/check.js";
import { parseSource } from "../src/parse/source.js";
import { partitionUnits, prdUnits } from "../src/prd.js";
import { joinReportDocuments, renderPackReport, renderPackReportDocuments, renderReportDocuments, withReportAnnexes, writeReportFiles } from "../src/report.js";
import { mergeDynamic } from "../src/scan.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult, DynamicResult } from "../src/types.js";
import { buildWorklist } from "../src/verify.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;

/** A two-page site: the home page has an unnamed link (found in its source AND by axe in the
 *  browser), the contact page an unlabelled field (found by axe only). */
function site(): AuditResult {
  const home = `<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><main><h1>Accueil</h1><a href="/profil"></a></main></body></html>`;
  const base = buildAudit([parseSource(home, "src/accueil.html")], ["src"]);
  const dynamic: DynamicResult = {
    tool: "ultra11y",
    engine: "axe-core@playwright (local)",
    target: "2 page(s)",
    date: base.date,
    sample: {
      pages: [
        { id: "accueil", name: "Accueil", url: "https://exemple.fr/" },
        { id: "contact", name: "Contact", url: "https://exemple.fr/contact" },
      ],
    },
    findings: [
      {
        criteriaId: "2.4.4",
        axeRule: "link-name",
        impact: "serious",
        severity: "bloquant",
        message: "Links must have discernible text",
        selector: "a[href='/profil']",
        snippet: "",
        engine: "axe",
        page: "https://exemple.fr/",
        sample: { id: "accueil", name: "Accueil" },
      },
      {
        criteriaId: "4.1.2",
        axeRule: "label",
        impact: "critical",
        severity: "bloquant",
        message: "Form elements must have labels",
        selector: "input[name='societe']",
        snippet: "",
        engine: "axe",
        page: "https://exemple.fr/contact",
        sample: { id: "contact", name: "Contact" },
      },
    ],
  };
  const merged = mergeDynamic(base, dynamic, "fr");
  merged.scope.sample!.pages[0]!.url = "https://exemple.fr/";
  return merged;
}

describe("the report speaks to every reader", () => {
  const audit = site();
  const { report, annex } = renderPackReportDocuments(audit, loadPack("rgaa"), "fr");

  it("carries no code location, selector, tool method or command", () => {
    expect(report).not.toMatch(/^\s*- \[ \] `/m); // the occurrence checklist
    expect(report).not.toContain("src/accueil.html");
    expect(report).not.toContain("a[href='/profil']");
    expect(report).not.toContain("Taux de réussite automatique");
    expect(report).not.toContain("Contrat d'automatisation");
    expect(report).not.toContain("- **Outil**");
    expect(report).not.toMatch(/verify --manual|scan --sample|`ultra11y /);
  });

  it("names the audited pages and says where each defect is, by URL", () => {
    expect(report).toContain("- **Pages auditées** : 2 — Accueil, Contact");
    const block = report.slice(report.indexOf("#### 🔴 RGAA 6.2"));
    expect(block).toMatch(/^- Accueil : <https:\/\/exemple\.fr\/> \(\d+\)$/m);
  });

  it("states the problem in the engine's own words rather than axe-core's", () => {
    const block = report.slice(report.indexOf("#### 🔴 RGAA 6.2"), report.indexOf("####", report.indexOf("#### 🔴 RGAA 6.2") + 5));
    expect(block).toContain("Lien sans intitulé");
    expect(block).not.toContain("Links must have discernible text");
    expect(block).not.toContain("axe-core");
  });

  it("keeps axe-core's message, without its rule id, when it is all there is", () => {
    const at = report.indexOf("Form elements must have labels");
    expect(at).toBeGreaterThan(-1);
    expect(report).not.toContain("(axe: label)");
    // …and no stock « verified by axe-core » sentence in place of a fix.
    expect(report).not.toContain("Vérifié au rendu par axe-core");
  });

  it("points at its annex, which carries everything it left out", () => {
    expect(report).toContain(`[annexe technique](annexe-technique-rgaa-${audit.date}.md)`);
    expect(annex).toMatch(/^- \[ \] `/m);
    expect(annex).toContain("a[href='/profil']");
    expect(annex).toContain("Taux de réussite automatique");
    expect(annex).toContain("Contrat d'automatisation");
    // The axe-core wording the report set aside is here, in the same criterion's block.
    const annexBlock = annex.slice(annex.indexOf("#### 🔴 RGAA 6.2"));
    expect(annexBlock.slice(0, annexBlock.indexOf("####", 5))).toContain("Links must have discernible text");
    expect(annex).toContain(`[rgaa-${audit.date}.md](rgaa-${audit.date}.md)`);
  });

  it("lists, page by page, the criteria that fail there — never a WCAG id inside an RGAA report", () => {
    const pages = report.slice(report.indexOf("## 📄"), report.indexOf("## 3."));
    expect(pages).toMatch(/^- RGAA 6\.2 — .* \(\d+ occurrence\(s\)\)$/m);
    expect(pages).not.toMatch(/^\s*- \[?\d+\.\d+\.\d+/m);
  });
});

describe("the gates read the report and its annex together", () => {
  const audit = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });

  it("finds every occurrence to verify in the annex, and none in the report alone", () => {
    const { report, annex } = renderPackReportDocuments(audit, loadPack("rgaa"), "fr");
    const { nc } = partitionUnits(prdUnits(audit, "rgaa", "fr"));
    const occurrences = nc.reduce((n, u) => n + u.findings.filter((f) => !f.advisory).length, 0);
    expect(buildWorklist(report, "rgaa", Number.POSITIVE_INFINITY)).toHaveLength(0);
    expect(buildWorklist(joinReportDocuments(report, annex), "rgaa", Number.POSITIVE_INFINITY)).toHaveLength(occurrences);
  });

  it("checks the annex's automatic rate like the report's headline", () => {
    const md = renderPackReport(audit, loadPack("rgaa"), "fr");
    expect(checkReport(md, "rgaa", "fr", { audit }).issues).toEqual([]);
    const tampered = md.replace(/(Taux de réussite automatique[^\n]*?: )\d+%/, "$199%");
    expect(tampered).not.toBe(md);
    expect(checkReport(tampered, "rgaa", "fr", { audit }).issues.some((i) => /[Tt]aux/.test(i))).toBe(true);
  });

  it("writes both files, and reading the report back joins the annex exactly as rendered", () => {
    const out = mkdtempSync(join(tmpdir(), "ultra11y-annex-"));
    const { path, annexPath } = writeReportFiles(audit, { out, lang: "fr", standard: "wcag" });
    expect(existsSync(annexPath)).toBe(true);
    // Never a second match for the `wcag-*.md` glob scripts use to find THE report.
    expect(annexPath.split("/").pop()).not.toMatch(/^wcag-.*\.md$/);
    const joined = withReportAnnexes(readFileSync(path, "utf8"), path, (p) => readFileSync(p, "utf8"));
    const { report, annex } = renderReportDocuments(audit, "fr", out);
    expect(joined).toBe(joinReportDocuments(report, annex));
  });

  it("does not look for an annex a joined document already carries", () => {
    const md = renderPackReport(audit, loadPack("rgaa"), "fr");
    expect(
      withReportAnnexes(md, "/nowhere/rgaa.md", () => {
        throw new Error("must not read");
      }),
    ).toBe(md);
  });

  it("fails closed when the annex is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "ultra11y-annex-missing-"));
    const { report } = renderReportDocuments(audit, "fr");
    const path = join(dir, "wcag.md");
    writeFileSync(path, report);
    expect(() => withReportAnnexes(report, path, (p) => readFileSync(p, "utf8"))).toThrow(/annex not found/);
  });

  it("follows only a bare annex file name beside the report — never a path", () => {
    const md = "# R\n\n[annexe technique](../../etc/annexe-technique-x.md) [autre](annexe-technique-x/../../y.md)\n";
    expect(
      withReportAnnexes(md, "/tmp/r.md", () => {
        throw new Error("must not read");
      }),
    ).toBe(md);
  });
});

describe("an evidence crop illustrates the defect for the reader", () => {
  it("shows one picture per criterion in the report and keeps every crop in the annex", () => {
    const audit = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });
    const cropFor = (f: { file: string; line: number }) => ({ href: `./assets/p/${f.line}.png`, alt: `Vignette ligne ${f.line}` });
    const { report, annex } = renderReportDocuments(audit, "fr", undefined, cropFor as never);
    const block = report.slice(report.indexOf("#### 🔴 3.1.1"));
    expect(block.slice(0, block.indexOf("####", 5))).toMatch(/!\[Vignette ligne \d+\]\(\.\/assets\/p\/\d+\.png\)/);
    expect((annex.match(/!\[Vignette ligne/g) ?? []).length).toBeGreaterThan((report.match(/!\[Vignette ligne/g) ?? []).length);
  });
});
