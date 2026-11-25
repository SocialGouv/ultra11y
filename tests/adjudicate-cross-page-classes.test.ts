// ONE CLASS PER DISTINCT THING, WHATEVER PAGE IT WAS READ ON (#222).
//
// SKILL.md rule 3b promises one representative per CONTENT CLASS, with `occurrences` and `alsoAt`.
// On a full-audit run the repeated-blocks harvest keyed its class on the PAGE, so every page was a
// class of its own: 12.2 listed 66 classes for three blocks, 12.4/12.5 70, and the same header
// was ruled on twenty times. This file pins the fix and the two things it must not break:
//
//   - a class whose content DIFFERS on one page stays a class of its own — merging is only ever
//     of identical content, so « same order everywhere » is still visible as « one class »;
//   - a page-scoped verdict still cites THAT page's capture: the merged class names every page in
//     its `alsoAt`, the brief prints them as `<id>:<line>`, and the gate accepts the sibling on
//     the page while refusing another page's anchor.
//
// It also pins the subject restrictions the same issue found: 1.3 is about images and nothing
// else, 9.1 about the heading outline and not the form labels.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { harvestSubjects, subjectsForPackCriterion } from "../src/adjudicate-subjects.js";
import { applyAdjudication, buildAdjudicationWorklist, formatAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { parseHtml } from "../src/parse/html.js";
import { attributePages } from "../src/pages.js";
import { PAGES_DIR } from "../src/snapshot.js";
import type { AuditResult, PageScope } from "../src/types.js";

const NAV = (links: string[]) => `<nav aria-label="Principale">${links.map((l) => `<a href="/${l}">${l}</a>`).join("")}</nav>`;
const page = (title: string, nav: string) =>
  [
    "<!doctype html>",
    `<html lang="fr"><head><title>${title}</title></head><body>`,
    `<header><a href="/">Accueil</a></header>`,
    nav,
    `<main><h1>${title}</h1><img src="/logo.png" alt="Logo"><form action="/f"><label for="q">Recherche</label><input id="q" name="q"></form></main>`,
    `<footer><a href="/mentions">Mentions</a></footer>`,
    "</body></html>",
  ].join("\n");

const root = mkdtempSync(join(tmpdir(), "u11y-cross-page-"));
const SAME = NAV(["aide", "contact"]);
const PAGES: Record<string, string> = {
  a: page("A", SAME),
  b: page("B", SAME),
  // The one page whose navigation is in another order: its own class, never merged.
  c: page("C", NAV(["contact", "aide"])),
};
for (const [id, html] of Object.entries(PAGES)) {
  mkdirSync(join(root, PAGES_DIR, id), { recursive: true });
  writeFileSync(join(root, PAGES_DIR, id, "dom.html"), html);
}
const capture = (id: string) => join(root, PAGES_DIR, id, "dom.html");

const auditOf = (): AuditResult => {
  const audit = runAudit({ inputs: Object.keys(PAGES).map(capture) });
  const scope: PageScope[] = Object.keys(PAGES).map((id) => ({
    id,
    name: id.toUpperCase(),
    url: `https://x/${id}`,
    sources: [capture(id)],
    basis: "snapshot",
  }));
  audit.scope.pages = scope;
  audit.scope.pagesAudited = Object.keys(PAGES);
  attributePages(audit, scope);
  return audit;
};

const item = (audit: AuditResult, id: string): AdjudicationItem => {
  const it = buildAdjudicationWorklist(audit, { standard: "rgaa" }).find((i) => i.criteriaId === id);
  expect(it, `${id} must be open on this fixture`).toBeDefined();
  return it!;
};

const onPage = (file: string, id: string) => file.endsWith(`${PAGES_DIR}/${id}/dom.html`);

describe("repeated blocks are classed by content, not by page (#222)", () => {
  it("merges the identical blocks of every page and keeps the one that differs apart", () => {
    const it122 = item(auditOf(), "12.2");
    const tags = it122.evidence.map((e) => e.selector);
    // header, footer: one class each across the three pages. nav: two — a/b, and c's own order.
    expect(tags.filter((t) => t.startsWith("header"))).toHaveLength(1);
    expect(tags.filter((t) => t.startsWith("footer"))).toHaveLength(1);
    const navs = it122.evidence.filter((e) => e.selector.startsWith("nav"));
    expect(navs).toHaveLength(2);
    const ab = navs.find((e) => (e.note ?? "").includes("aide › contact"))!;
    const c = navs.find((e) => (e.note ?? "").includes("contact › aide"))!;
    expect(ab.occurrences).toBe(2);
    expect(ab.pages?.sort()).toEqual(["a", "b"]);
    expect(c.occurrences ?? 1).toBe(1);
    expect(c.pages).toEqual(["c"]);
    // The page is in the anchors, never in the note that names the class.
    for (const e of it122.evidence) expect(e.note ?? "").not.toMatch(/page="/);
    expect(it122.population?.classes).toBe(4);
    expect(it122.population?.occurrences).toBe(9);
  });

  it("prints every page of a merged class as `<id>:<line>`, so a page verdict knows what to cite", () => {
    const it122 = item(auditOf(), "12.2");
    const md = formatAdjudication([it122], "fr", "rgaa", { preamble: false });
    const header = it122.evidence.find((e) => e.selector.startsWith("header"))!;
    expect(md).toMatch(new RegExp(`×3 sur a:${header.line}, b:${header.line}, c:${header.line}`));
  });

  it("lets a page verdict cite its own page's occurrence of a merged class, and refuses another page's", () => {
    const audit = auditOf();
    const it122 = item(audit, "12.2");
    const header = it122.evidence.find((e) => e.selector.startsWith("header"))!;
    const sibling = (id: string) => {
      const a = [header.file, ...(header.alsoAt ?? [])]
        .map((x, i) => (i === 0 ? `${x}:${header.line}` : x))
        .find((x) => onPage(x.slice(0, x.lastIndexOf(":")), id))!;
      return { file: a.slice(0, a.lastIndexOf(":")), line: Number(a.slice(a.lastIndexOf(":") + 1)), selector: "header", snippet: header.snippet };
    };
    const fold = (pages: Record<string, unknown>) =>
      applyAdjudication(
        audit,
        {
          tool: "ultra11y",
          kind: "adjudication",
          schemaVersion: 2,
          standard: "rgaa",
          auditDate: "2026-11-25",
          items: [{ ...it122, verdict: "C", justification: "même ordre partout sauf c", citations: it122.evidence, pages } as unknown as AdjudicationItem],
        } as AdjudicationFile,
        { cwd: root },
      );
    const ok = fold({ b: { verdict: "C", justification: "en-tête identique", citations: [sibling("b")] } });
    expect(
      ok.issues.filter((i) => i.includes("12.2")),
      ok.issues.join("\n"),
    ).toEqual([]);
    const crossed = fold({ b: { verdict: "C", justification: "en-tête identique", citations: [sibling("a")] } });
    expect(
      crossed.issues.some((i) => i.includes("12.2, page b") && /not this page.s evidence/.test(i)),
      crossed.issues.join("\n"),
    ).toBe(true);
  });
});

describe("a criterion's subjects are what its tests concern (#222)", () => {
  const doc = parseHtml(PAGES.a!, `${PAGES_DIR}/a/dom.html`);

  it("1.3 (relevance of text alternatives) is shown the images, and not the landmarks or the form", () => {
    const got = harvestSubjects(subjectsForPackCriterion("rgaa", "1.3", ["1.1.1", "4.1.2"]), [doc]);
    expect(got.length).toBeGreaterThan(0);
    for (const h of got) expect(h.ev.selector, h.ev.note).toMatch(/^img/);
  });

  it("9.1 (headings) is shown the heading outline, and not the form labels", () => {
    const got = harvestSubjects(subjectsForPackCriterion("rgaa", "9.1", ["1.3.1", "2.4.1", "2.4.6", "4.1.2"]), [doc]);
    expect(got.map((h) => h.ev.selector)).toEqual(["h1"]);
    // WCAG 2.4.6 is « Headings and Labels »: its own subject keeps the labels.
    expect(harvestSubjects(["headings"], [doc]).some((h) => h.ev.selector.startsWith("label"))).toBe(true);
  });
});
