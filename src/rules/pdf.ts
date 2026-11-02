// DOCUMENT RULES — the checks run on a downloadable PDF (src/parse/pdf.ts), never on markup.
//
// Each reads the facts the reader established and raises the gross failure a PDF/UA-1 / WCAG
// review starts from. None of them, alone or together, says a PDF is accessible: a document that
// raises nothing has merely not shown these failures, and PDF/UA conformance is a validator's
// verdict (veraPDF, PAC). Their findings also never decide a WCAG criterion of the PAGE that
// links the document (src/audit.ts keeps them in `documentFindings`): an accessible alternative
// version may exist, so the RGAA projection hands them to 13.3 as candidate evidence.
//
// A rule that cannot observe its subject says nothing: an unreadable file raises no finding here
// (it is reported unreadable on `AuditResult.documents`), undecodable content raises no
// « no text », and an untagged file raises no « shallow structure » — `pdf-untagged` already
// says the larger thing.
import type { Doc, El } from "../parse/html.js";
import type { DocumentCheckOutcome } from "../types.js";
import type { Rule, RuleFinding } from "./rule.js";

/** The synthetic element a document finding is anchored to: the file's `%PDF-x.y` header,
 *  line 1 — which is what grounding finds when it re-opens the cited file. */
export function pdfAnchor(doc: Doc): El {
  return { type: "element", tag: "pdf", attribs: {}, children: [], parent: null, line: 1, col: 1, start: 0, end: doc.source.length };
}

const on = (doc: Doc, f: Omit<RuleFinding, "el">): RuleFinding => ({ el: pdfAnchor(doc), selectorHint: "document", ...f });

const yn = (b: boolean): string => (b ? "yes" : "no");

/** PDF/UA-1 §7.1: the catalog marks the file tagged and carries a structure tree. Without them an
 *  assistive technology reads an unordered stream of glyphs — no headings, lists or tables. */
const pdfUntagged: Rule = {
  id: "pdf-untagged",
  input: "pdf",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc) {
    const f = doc.pdf;
    if (!f?.readable || f.tagged) return [];
    return [on(doc, { criteriaId: "1.3.1", msgId: "pdf-untagged", params: { marked: yn(f.marked), structTree: yn(f.structTree), version: f.version ?? "?" } })];
  },
};

/** PDF/UA-1 §7.2: the natural language is declared — on the catalog, which is what a screen
 *  reader reads first. A language set only on individual structure elements is possible, which
 *  is why this is a finding to look at and not, on its own, a verdict. */
const pdfLangMissing: Rule = {
  id: "pdf-lang-missing",
  input: "pdf",
  criteria: ["3.1.1"],
  severity: "majeur",
  run(doc) {
    const f = doc.pdf;
    if (!f?.readable || f.lang) return [];
    return [on(doc, { criteriaId: "3.1.1", msgId: "pdf-lang-missing" })];
  },
};

/** PDF/UA-1 §7.1-8/7.1-9 and WCAG technique PDF18: a title in the metadata, AND the viewer told
 *  to show it instead of the file name (/ViewerPreferences /DisplayDocTitle true). */
const pdfTitleMissing: Rule = {
  id: "pdf-title-missing",
  input: "pdf",
  criteria: ["2.4.2"],
  severity: "majeur",
  run(doc) {
    const f = doc.pdf;
    if (!f?.readable) return [];
    if (!f.title) return [on(doc, { criteriaId: "2.4.2", msgId: "pdf-title-missing", params: { titleState: "missing" } })];
    if (!f.displayDocTitle)
      return [
        on(doc, { criteriaId: "2.4.2", msgId: "pdf-title-missing", params: { titleState: "not-displayed", title: f.title.slice(0, 80) }, severity: "mineur" }),
      ];
    return [];
  },
};

/** An image-only file — a scan with no OCR layer: no font resource and no text-showing operator
 *  anywhere. Raised only when every page's content was decoded; undecodable content proves
 *  nothing. Figures carrying alternative text in a structure tree are the one case where an
 *  image-only page can still be read, so a tagged file whose every figure has /Alt is spared. */
const pdfNoText: Rule = {
  id: "pdf-no-text",
  input: "pdf",
  criteria: ["1.1.1"],
  severity: "bloquant",
  run(doc) {
    const f = doc.pdf;
    if (!f?.readable || !f.contentScanned || f.pages === 0) return [];
    if (f.textOps > 0 || f.fonts > 0) return [];
    const s = f.structure;
    if (f.tagged && s && s.figures > 0 && s.figuresWithoutAlt === 0) return [];
    return [on(doc, { criteriaId: "1.1.1", msgId: "pdf-no-text", params: { pages: f.pages, images: f.images } })];
  },
};

/** Advisory: the file IS tagged, but its structure tree carries no heading, or a table with no
 *  header cell. A one-page receipt may legitimately have neither, so this is a recommendation for
 *  the reviewer, never a non-conformity. */
const pdfStructureShallow: Rule = {
  id: "pdf-structure-shallow",
  input: "pdf",
  criteria: ["1.3.1"],
  severity: "mineur",
  advisory: true,
  run(doc) {
    const f = doc.pdf;
    const s = f?.structure;
    if (!f?.readable || !f.tagged || !s) return [];
    const out: RuleFinding[] = [];
    if (s.headings === 0) out.push(on(doc, { criteriaId: "1.3.1", msgId: "pdf-structure-shallow", params: { gap: "no-heading", elements: s.elements } }));
    if (s.tablesWithoutTh > 0)
      out.push(on(doc, { criteriaId: "1.3.1", msgId: "pdf-structure-shallow", params: { gap: "table-no-th", tables: s.tables, without: s.tablesWithoutTh } }));
    return out;
  },
};

export const pdfRules: Rule[] = [pdfUntagged, pdfLangMissing, pdfTitleMissing, pdfNoText, pdfStructureShallow];

/** Whether each document rule could observe its subject on this file — the difference between
 *  « not detected » and « not checked » on `AuditResult.documents[].checks`. */
export function pdfCheckOutcomes(doc: Doc, firedRuleIds: ReadonlySet<string>): Record<string, DocumentCheckOutcome> {
  const f = doc.pdf;
  const out: Record<string, DocumentCheckOutcome> = {};
  for (const r of pdfRules) {
    let checkable = !!f?.readable;
    if (r.id === "pdf-no-text") checkable &&= !!f?.contentScanned && (f?.pages ?? 0) > 0;
    if (r.id === "pdf-structure-shallow") checkable &&= !!f?.tagged && !!f?.structure;
    out[r.id] = firedRuleIds.has(r.id) ? "fail" : checkable ? "not-detected" : "not-checked";
  }
  return out;
}
