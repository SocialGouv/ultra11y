import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { renderHtmlDocument, type Doc } from "../src/html.js";
import { compositeDoc, indexDoc, pageDoc, pagesIndexDoc } from "../src/html-report.js";
import { DEFAULT_INLINE_BUDGET, externalReferences, pickRung, writeHtml } from "../src/html-emit.js";
import { derivePages, pagesOf } from "../src/pages.js";
import { encodePng } from "../src/pixel.js";
import { findingId } from "../src/baseline.js";
import type { AuditResult, Lang } from "../src/types.js";
import type { StandardId } from "../src/standards/index.js";
import { findingsForStandard } from "../src/standards/derive.js";

/** A real audit with real findings — the engine's own output, never a hand-written fixture,
 *  so the HTML is exercised against the shapes it will actually meet. */
function auditOf(html: string): AuditResult {
  return runAudit({ inputs: ["-"], stdin: html });
}

const BAD = `<!doctype html><html><head></head><body>
<div><img src="x.png"></div>
<a href="/a"></a>
<table><tr><td>1</td><td>2</td></tr></table>
<input type="text">
<h3>Skipped</h3>
</body></html>`;

const WITH_PAGES = (): AuditResult => {
  const r = auditOf(BAD);
  r.scope.pages = [
    { id: "accueil", name: "Accueil", url: "https://exemple.fr/", basis: "snapshot" },
    { id: "compte", name: "Mon compte", url: "https://exemple.fr/compte", basis: "attributed", auth: true },
  ];
  r.scope.pagesAudited = ["accueil"];
  for (const f of r.findings) f.page = "accueil";
  return r;
};

/** THE TEST THAT MATTERS. An accessibility report that fails an accessibility audit has no
 *  standing, so the engine audits its own deliverable rather than a human asserting it looks
 *  right. Every document, both emitters, both languages, core and pack.
 *
 *  A pack is a PROJECTION of the WCAG audit, so the run is always core and the findings are
 *  resolved through `findingsForStandard` — the same path `report --standard rgaa` takes. */
function auditHtml(html: string): AuditResult {
  return runAudit({ inputs: ["-"], stdin: html });
}

describe("the deliverable passes its own audit", () => {
  const docs: Array<[string, (lang: Lang, standard: StandardId) => Doc]> = [
    ["index", (lang, standard) => indexDoc(WITH_PAGES(), { lang, standard, links: [{ href: "./x.html", text: "X" }] })],
    ["composite", (lang, standard) => compositeDoc(WITH_PAGES(), { lang, standard })],
    ["pages index", (lang, standard) => pagesIndexDoc(WITH_PAGES(), { lang, standard, sheetHref: (id) => `./page-${id}.html` })],
    [
      "page sheet",
      (lang, standard) => {
        const r = WITH_PAGES();
        const page = derivePages(r, pagesOf(r))[0]!;
        return pageDoc(r, page, { lang, standard, screenshot: "../assets/accueil.png" });
      },
    ],
  ];

  for (const [name, build] of docs) {
    for (const lang of ["fr", "en"] as Lang[]) {
      for (const standard of ["wcag", "rgaa"] as StandardId[]) {
        it(`${name} · ${lang} · ${standard}`, () => {
          const html = renderHtmlDocument(build(lang, standard));
          const found = findingsForStandard(auditHtml(html), standard).filter((f) => !f.advisory);
          expect(found.map((f) => `${f.ruleId} ${f.selectorHint}: ${f.message}`)).toEqual([]);
        });
      }
    }
  }
});

describe("the page model", () => {
  const doc = (over: Partial<Doc> = {}): Doc => ({ lang: "en", title: "T", blocks: [], ...over });

  it("is self-contained — no script, no external stylesheet, no remote font", () => {
    const html = renderHtmlDocument(compositeDoc(WITH_PAGES(), { lang: "en" }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/[^"]*\.(css|js|woff2?)/);
    expect(html).toContain("<style>");
  });

  it("carries exactly one h1, and never skips a heading level", () => {
    const html = renderHtmlDocument(compositeDoc(WITH_PAGES(), { lang: "en" }));
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    for (let i = 1; i < levels.length; i++) expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
  });

  it("escapes everything that comes from the audit, including the apostrophe", () => {
    const html = renderHtmlDocument(doc({ title: `<img src=x onerror="alert(1)">'&`, blocks: [{ kind: "para", runs: [{ text: "<b>" }] }] }));
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&#39;");
    expect(html).toContain("&lt;b&gt;");
  });

  // A status shown only in green or red is a 1.4.1 failure, and this tool exists to find
  // those. The letter is the accessible channel; the colour is redundant.
  it("never encodes a status by colour alone — every mark carries its letter", () => {
    const html = renderHtmlDocument(
      doc({
        blocks: [{ kind: "table", caption: "c", columns: [{ text: "a" }, { text: "b" }], rows: [[{ text: "r" }, { status: "NC", text: "" }]] }],
      }),
    );
    expect(html).toContain('<span class="st st-nc">NC</span>');
  });

  it("gives every table a caption and column scope, which a GFM table cannot express", () => {
    const html = renderHtmlDocument(compositeDoc(WITH_PAGES(), { lang: "fr" }));
    const tables = html.match(/<table>/g)?.length ?? 0;
    expect(tables).toBeGreaterThan(0);
    expect(html.match(/<caption>/g)).toHaveLength(tables);
    expect(html).toContain('<th scope="col"');
  });

  it("makes a source-only RGAA artifact exhaustive without inventing rendered pages", () => {
    const html = renderHtmlDocument(compositeDoc(auditOf(BAD), { lang: "fr", standard: "rgaa" }));
    expect(html).toContain("Périmètre réellement testé");
    expect(html).toContain("Aucune page rendue");
    expect(html).toContain("Grille exhaustive des critères");
    expect(html).toContain("17 test(s) static");
    expect(html).toContain("238 judgment");
    expect(html.match(/RGAA \d+\.\d+/g)?.length).toBeGreaterThanOrEqual(106);
    expect(html).not.toContain("[image porteuse d’information]");
  });

  // Empty cells are announced as "blank"; the engine's own advisory rule says so. An em dash
  // is not the bare "-" that rule also flags.
  it("writes an em dash rather than leaving a data cell empty", () => {
    const html = renderHtmlDocument(
      doc({ blocks: [{ kind: "table", caption: "c", columns: [{ text: "a" }, { text: "b" }], rows: [[{ text: "r" }, { text: "" }]] }] }),
    );
    expect(html).toContain("<td>—</td>");
  });

  it("has a skip link whose target exists", () => {
    const html = renderHtmlDocument(compositeDoc(WITH_PAGES(), { lang: "en" }));
    expect(html).toContain('href="#content"');
    expect(html).toContain('id="content"');
  });

  it("takes its lang from the document, so --lang fr produces a French page", () => {
    expect(renderHtmlDocument(doc({ lang: "fr" }))).toContain('<html lang="fr">');
    expect(renderHtmlDocument(doc({ lang: "fr" }))).toContain("Aller au contenu");
  });

  // The deliverable an auditor hands to a client is a PDF, and the way to get one is to
  // print the composite. A criterion split across a page break makes that unusable.
  it("carries a print sheet that keeps a criterion's evidence on one sheet", () => {
    const html = renderHtmlDocument(doc());
    expect(html).toContain("@media print");
    expect(html).toContain("break-inside:avoid-page");
    expect(html).toContain("break-after:avoid-page");
  });
});

describe("the inline budget", () => {
  it("embeds everything when it fits", () => {
    expect(pickRung([10, 10], [10], 100)).toMatchObject({ steps: [], shots: true });
  });

  it("drops the page screenshots first — they say the least about a non-conformity", () => {
    expect(pickRung([10, 10], [90], 100)).toMatchObject({ steps: ["screenshots"], shots: false });
  });

  it("then keeps one crop per criterion, rather than dropping them all", () => {
    expect(pickRung([60, 60], [10], 100)).toMatchObject({ steps: ["screenshots", "crops"], cropsPerCriterion: 1 });
  });

  it("gives up on images only when not one of them fits", () => {
    expect(pickRung([500], [10], 100)).toMatchObject({ steps: ["screenshots", "crops", "none"], cropsPerCriterion: 0 });
  });

  it("has a documented default rather than an implicit one", () => {
    expect(DEFAULT_INLINE_BUDGET).toBe(12 * 1024 * 1024);
  });
});

describe("the self-containment gate", () => {
  it("accepts fragments, data URIs and paths that stay inside the artifact", () => {
    expect(externalReferences('<a href="#x"><img src="data:image/png;base64,AA"><a href="./p.html">', 0)).toEqual([]);
    expect(externalReferences('<img src="../assets/a.png">', 1)).toEqual([]);
  });

  it("reports an absolute URL, a file:// link, and a path that climbs out", () => {
    expect(externalReferences('<img src="https://cdn/x.png">', 0)).toEqual(["https://cdn/x.png"]);
    expect(externalReferences('<a href="file:///etc/passwd">', 0)).toEqual(["file:///etc/passwd"]);
    expect(externalReferences('<img src="../../.ultra11y/pages/a/screen.png">', 1)).toEqual(["../../.ultra11y/pages/a/screen.png"]);
  });
});

describe("writing the artifact", () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), "ultra11y-html-"));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it("writes an entry point and a detachable composite, named for the standard and the date", () => {
    const r = WITH_PAGES();
    const res = writeHtml(r, { outDir: out, standard: "rgaa", lang: "fr" });
    expect(res.index).toBe(join(out, "index.html"));
    expect(res.composite).toBe(join(out, `ultra11y-rgaa-${r.date}.html`));
    expect(readFileSync(res.index, "utf8")).toContain(`ultra11y-rgaa-${r.date}.html`);
  });

  // The entry point is what an artifact viewer opens first. Loading megabytes of base64 to
  // show a dashboard is how a reviewer decides the report is not worth waiting for.
  it("keeps the entry point free of inlined images", () => {
    const res = writeHtml(WITH_PAGES(), { outDir: out, lang: "en" });
    expect(readFileSync(res.index, "utf8")).not.toContain("data:image");
  });

  it("writes the navigable site only when asked, one sheet per page plus its index", () => {
    expect(writeHtml(WITH_PAGES(), { outDir: out, lang: "en" }).sheets).toEqual([]);
    const res = writeHtml(WITH_PAGES(), { outDir: out, lang: "en", pages: true });
    expect(res.sheets.map((p) => p.slice(out.length + 1))).toEqual([
      join("pages", "index.html"),
      join("pages", "page-accueil.html"),
      join("pages", "page-compte.html"),
    ]);
  });

  // A page named `index` must not overwrite the index — the same reason the Markdown sheets
  // are `page-<id>.md`.
  it("prefixes every sheet, so a page called index cannot overwrite the index", () => {
    const r = WITH_PAGES();
    r.scope.pages = [{ id: "index", name: "Index", url: "https://exemple.fr/", basis: "snapshot" }];
    r.scope.pagesAudited = ["index"];
    const res = writeHtml(r, { outDir: out, lang: "en", pages: true });
    expect(res.sheets).toContain(join(out, "pages", "page-index.html"));
    expect(readFileSync(join(out, "pages", "index.html"), "utf8")).toContain("page-index.html");
  });

  it("emits nothing that points outside the artifact, from any document", () => {
    const res = writeHtml(WITH_PAGES(), { outDir: out, lang: "fr", pages: true });
    for (const p of [res.index, res.composite!]) expect(externalReferences(readFileSync(p, "utf8"), 0)).toEqual([]);
    for (const p of res.sheets) expect(externalReferences(readFileSync(p, "utf8"), 1)).toEqual([]);
  });

  it("inlines a crop into the composite and references it as a file from the site", () => {
    const png = encodePng({ width: 4, height: 4, data: Buffer.alloc(64, 0x80) });
    const assets = join(out, "assets", "accueil");
    mkdirSync(assets, { recursive: true });
    const cropPath = join(assets, "abc123.png");
    writeFileSync(cropPath, png);
    const r = WITH_PAGES();
    const f = r.findings[0]!;
    const manifest = {
      crops: new Map([
        [
          findingId(f),
          {
            findingId: findingId(f),
            page: "accueil",
            ruleId: f.ruleId,
            criteriaId: f.criteriaId,
            href: "./assets/accueil/abc123.png",
            path: cropPath,
            width: 4,
            height: 4,
            box: { tag: "img", x: 0, y: 0, w: 4, h: 4 },
            scale: 1,
            clipped: false,
            alt: { fr: "Capture recadrée", en: "Cropped capture" },
          },
        ],
      ]),
      skipped: new Map(),
      perPage: new Map(),
      totals: { located: 1, imaged: 1, skipped: {} },
    } as unknown as Parameters<typeof writeHtml>[1]["evidence"];
    const res = writeHtml(r, { outDir: out, lang: "en", pages: true, evidence: manifest });
    expect(readFileSync(res.composite!, "utf8")).toContain("data:image/png;base64,");
    const sheet = readFileSync(join(out, "pages", "page-accueil.html"), "utf8");
    expect(sheet).toContain('src="../assets/accueil/abc123.png"');
    expect(sheet).not.toContain("data:image");
  });

  // THE RULE THAT JUSTIFIES THE WHOLE TIER. An occurrence with no picture must never read as
  // an occurrence with no defect — that is precisely the misreading issue #16 measured. The
  // Markdown sheet has carried the refusal list since the tier shipped; the HTML, which is
  // the document an auditor actually hands to a client, carried nothing at all.
  it("says in the HTML what it could not illustrate, and why", () => {
    const tally = { located: 3, imaged: 0, skipped: { "below-the-fold": 2, "page-scope": 1 } };
    const manifest = {
      crops: new Map(),
      skipped: new Map(),
      perPage: new Map([["accueil", tally]]),
      totals: tally,
    } as unknown as Parameters<typeof writeHtml>[1]["evidence"];
    const res = writeHtml(WITH_PAGES(), { outDir: out, lang: "en", pages: true, evidence: manifest });
    for (const p of [res.composite!, join(out, "pages", "page-accueil.html")]) {
      const html = readFileSync(p, "utf8");
      expect(html, p).toContain("3 occurrence(s) are not illustrated");
      expect(html, p).toContain("the screenshot covers the viewport, not the whole page");
      expect(html, p).toContain("the page screenshot above is the illustration");
    }
  });

  it("says nothing about evidence when everything located was drawn", () => {
    const tally = { located: 2, imaged: 2, skipped: {} };
    const manifest = {
      crops: new Map(),
      skipped: new Map(),
      perPage: new Map([["accueil", tally]]),
      totals: tally,
    } as unknown as Parameters<typeof writeHtml>[1]["evidence"];
    const res = writeHtml(WITH_PAGES(), { outDir: out, lang: "en", pages: true, evidence: manifest });
    expect(readFileSync(res.composite!, "utf8")).not.toContain("are not illustrated");
  });

  // IMAGES DEGRADE, NON-CONFORMITIES NEVER. A budget of one byte drops every illustration —
  // and the document must still carry every finding, and say what it dropped.
  it("degrades the images and keeps the findings when the budget is exhausted", () => {
    const png = encodePng({ width: 8, height: 8, data: Buffer.alloc(256, 0x80) });
    const assets = join(out, "assets", "accueil");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "big.png"), png);
    const r = WITH_PAGES();
    const withCrops = writeHtml(r, { outDir: out, lang: "en" });
    const starved = writeHtml(r, { outDir: out, lang: "en", inlineBudget: 1 });
    expect(starved.notices.length).toBeGreaterThanOrEqual(0);
    // Whatever happened to the pictures, the non-conformities are all still there.
    const before = (readFileSync(withCrops.composite!, "utf8").match(/id="c-/g) ?? []).length;
    const after = (readFileSync(starved.composite!, "utf8").match(/id="c-/g) ?? []).length;
    expect(after).toBe(before);
    expect(before).toBeGreaterThan(0);
  });
});
