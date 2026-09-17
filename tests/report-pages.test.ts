// WHERE IS IT? — the question an RGAA reader asks about every non-conformity.
//
// RGAA is evaluated page by page over a declared sample, and the report knew which page each
// occurrence was found on — then printed that only in the per-page sections, two of them folded,
// while the summary table and the §2 blocks cited `file:line`, which for a captured page reads
// `.ultra11y/pages/<id>/dom.html:123`. The summary now names the pages (linked), §2 counts the
// occurrences per page, and a source-only audit says why it has no URL instead of leaving a
// column of dashes.
import { describe, expect, it } from "vitest";

import { buildAudit, runAudit } from "../src/audit.js";
import { checkReport } from "../src/check.js";
import { renderHtmlDocument } from "../src/html.js";
import { compositeDoc, indexDoc } from "../src/html-report.js";
import { mdLink } from "../src/md.js";
import { occurrencesByPage, pageResolver } from "../src/pages.js";
import { parseSource } from "../src/parse/source.js";
import { partitionUnits, prdUnits } from "../src/prd.js";
import { renderPackReport, renderPackReportDocuments, renderReport } from "../src/report.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";
import { buildWorklist } from "../src/verify.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;

/** Four pages, each rendered from its own file, each missing its <title> (RGAA 8.5) — and the
 *  home page alone missing its language (RGAA 8.3). */
function fourPages(sources: (id: string) => string[] = (id) => [`${id}.html`]): AuditResult {
  const noTitle = (lang: boolean) => `<!doctype html><html${lang ? ' lang="fr"' : ""}><head></head><body><main><h1>Page</h1><p>Texte</p></main></body></html>`;
  const ids = ["accueil", "contact", "tarifs", "aide"];
  const audit = buildAudit(
    ids.map((id) => parseSource(noTitle(id !== "accueil"), `${id}.html`)),
    ids.map((id) => `${id}.html`),
  );
  audit.scope.pages = ids.map((id) => ({
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    url: `https://exemple.fr/${id}`,
    sources: sources(id),
    basis: "attributed" as const,
  }));
  return audit;
}

/** The fix table's row for one criterion. */
const row = (md: string, id: string) => md.split("\n").find((l) => l.startsWith("| ") && l.includes(`| RGAA ${id} — `)) ?? "";

describe("the summary names the pages each non-conformity was found on", () => {
  const audit = fourPages();
  const md = renderPackReport(audit, loadPack("rgaa"), "fr");

  it("adds a Pages column, linking each page to its URL", () => {
    expect(md).toContain("| Priorité | Critère | Occurrences | Pages | Correction attendue |");
    expect(row(md, "8.3")).toContain("| [Accueil](<https://exemple.fr/accueil>) |");
  });

  it("says « every page » when the defect is on all of them — a shared cause, fixed once", () => {
    expect(row(md, "8.5")).toContain("| toutes les pages (4/4) |");
  });

  it("counts the occurrences per page in the §2 block", () => {
    const block = md.slice(md.indexOf("#### 🔴 RGAA 8.3"));
    expect(block).toMatch(/^\*\*Pages\*\* : \[Accueil\]\(<https:\/\/exemple\.fr\/accueil>\) \(1\)$/m);
  });

  it("keeps every gate passing", () => {
    expect(checkReport(md, "rgaa", "fr", { audit }).issues).toEqual([]);
    // One worklist item per occurrence the RGAA projection kept — the « Pages » line hides none.
    const { nc } = partitionUnits(prdUnits(audit, "rgaa", "fr"));
    const occurrences = nc.reduce((n, u) => n + u.findings.filter((f) => !f.advisory).length, 0);
    expect(buildWorklist(md, "rgaa", Number.POSITIVE_INFINITY)).toHaveLength(occurrences);
  });
});

describe("a page list is marked « at least » only when it can really be incomplete", () => {
  it("does not hedge when each source belongs to one page", () => {
    const md = renderPackReport(fourPages(), loadPack("rgaa"), "fr");
    expect(md).not.toContain("(au moins)");
  });

  it("hedges when a source several pages declare carries the defect", () => {
    // Every page declares the shared layout: `attributePages` puts its findings on the first.
    const audit = fourPages((id) => [`${id}.html`, "accueil.html"]);
    const md = renderPackReport(audit, loadPack("rgaa"), "fr");
    expect(row(md, "8.3")).toContain("(au moins)");
    expect(md).toContain("> « (au moins) » : l'anomalie est dans un fichier source déclaré par plusieurs pages");
    expect(md).toMatch(/^\*\*Pages\*\* : au moins sur \[Accueil\]/m);
  });
});

describe("the page survives the JSON round-trip", () => {
  it("finds the page of a pack criterion's findings, which are copies after parsing", () => {
    const audit = fourPages();
    const resolver = pageResolver(audit); // stamps `findings`, not `criteria[].findings`
    const copy = JSON.parse(JSON.stringify(audit)) as AuditResult;
    const copyResolver = pageResolver(copy);
    const unstamped = copy.criteria.flatMap((c) => c.findings).map((f) => ({ ...f, page: undefined }));
    expect(unstamped.length).toBeGreaterThan(0);
    for (const f of unstamped) expect(copyResolver.pageOf(f)?.id).toBeDefined();
    expect(occurrencesByPage(unstamped, copyResolver).orphans).toBe(0);
    expect(resolver.pages).toHaveLength(4);
  });
});

describe("a source-only audit says why there is no URL", () => {
  const audit = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });

  it("has no Pages column, and tells the reader how to get one", () => {
    const md = renderPackReport(audit, loadPack("rgaa"), "fr");
    expect(md).toContain("| Priorité | Critère | Occurrences | Correction attendue |");
    expect(md).not.toMatch(/^\*\*Pages\*\* :/m);
    const { report, annex } = renderPackReportDocuments(audit, loadPack("rgaa"), "fr");
    expect(report).toContain("> Aucune URL : cet audit porte sur le code source, aucune page du site n'a été analysée.");
    // The reader is told why; the person completing the audit is told how — in the annex.
    expect(report).not.toContain("ultra11y scan");
    expect(annex).toContain("`ultra11y scan --sample --merge <audit.json>`");
  });

  it("does the same in the WCAG report", () => {
    expect(renderReport(audit, "en")).toContain("> No URL: this audit read source code, and no page of the site was analysed.");
  });
});

describe("page links", () => {
  it("escapes the name and wraps the destination", () => {
    expect(mdLink("Tarifs [pro]", "https://exemple.fr/a (b)")).toBe("[Tarifs \\[pro\\]](<https://exemple.fr/a (b)>)");
    expect(mdLink("Local", "site/contact.html")).toBe("[Local](<site/contact.html>)");
  });

  it("never turns a non-http scheme into a link", () => {
    expect(mdLink("Piège", "javascript:alert(1)")).toBe("Piège");
    const audit = fourPages();
    audit.scope.pages![0]!.url = "javascript:alert(1)";
    expect(renderPackReport(audit, loadPack("rgaa"), "fr")).not.toContain("](<javascript:");
  });
});

describe("the HTML deliverable locates them too", () => {
  const audit = fourPages();

  it("adds the Pages column to the dashboard summary", () => {
    const html = renderHtmlDocument(indexDoc(audit, { lang: "fr", standard: "rgaa" }));
    expect(html).toContain("toutes les pages (4/4)");
  });

  it("puts the page and its URL first in every occurrence table — as text, the artifact links nothing outside itself", () => {
    const html = renderHtmlDocument(compositeDoc(audit, { lang: "fr", standard: "rgaa" }));
    expect(html).toContain("Accueil (https://exemple.fr/accueil)");
    expect(html).not.toContain('href="https://exemple.fr/accueil"');
  });
});
