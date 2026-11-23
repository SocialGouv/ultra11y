// Unit-test SNAPSHOT FILES as an audit source (#169): a project's `__snapshots__/*.snap` already
// hold the markup its components rendered, so the defects are found from the `.snap` alone — no
// test run, no React, no browser.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { expandInputs, isTestArtifact } from "../src/glob.js";
import { parseUnitSnapshotFile, parseSnapshotEntries, snapshotMarkupToHtml, snapshotTestFile } from "../src/parse/snap.js";
import { renderAuditorBacklog } from "../src/auditor.js";
import { ALL_RULES, runRules } from "../src/rules/registry.js";
import { parseHtml } from "../src/parse/html.js";

const FIX = "tests/fixtures/unit-snapshots";
const TOOLBAR = `${FIX}/src/components/__snapshots__/Toolbar.test.tsx.snap`;
const SEARCH = `${FIX}/src/__tests__/__snapshots__/SearchForm.test.jsx.snap`;
const CARD = `${FIX}/src/components/__snapshots__/Card.test.tsx.snap`;

/** The 1-based line of the first line of `file` containing `needle` at or after `from`. */
function lineOf(file: string, needle: string, from = 1): number {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = from - 1; i < lines.length; i++) if (lines[i]!.includes(needle)) return i + 1;
  throw new Error(`${needle} not in ${file}`);
}

describe("parsing a .snap file", () => {
  it("reads every entry, unescaping the key and value exactly as Jest/Vitest escape them", () => {
    const entries = parseSnapshotEntries(readFileSync(SEARCH, "utf8"));
    expect(entries.map((e) => e.name)).toEqual([
      "SearchForm renders an unlabelled field 1",
      "SearchForm shallow render 1",
      "SearchForm keeps the query 1",
      "SearchForm count 1",
    ]);
    // Backtick and `${` are escaped with a backslash in the file; the value is the raw string.
    expect(entries[2]!.value).toBe('"tarte `aux` pommes $' + '{x}"');
    expect(entries[0]!.line).toBe(lineOf(SEARCH, "exports[`SearchForm renders an unlabelled field 1`]"));
  });

  it("skips what is not host markup — objects, prose, numbers, shallow component trees — and says why", () => {
    const toolbar = parseUnitSnapshotFile(readFileSync(TOOLBAR, "utf8"), TOOLBAR);
    expect(toolbar.entries).toBe(4);
    expect(toolbar.docs).toHaveLength(2);
    expect(toolbar.skipped.map((s) => [s.name, s.reason])).toEqual([
      ["Toolbar > exposes its state 1", "not-markup"],
      ["Toolbar > label text 1", "not-markup"],
    ]);
    const search = parseUnitSnapshotFile(readFileSync(SEARCH, "utf8"), SEARCH);
    expect(search.docs).toHaveLength(1);
    // `<SearchBar>` is the component CALL (a shallow render): lowercased, it would be audited as
    // markup it may never render.
    expect(search.skipped.find((s) => s.name === "SearchForm shallow render 1")?.reason).toBe("component-tree");
  });

  it("converts react-test-renderer props to HTML: className→class, functions and objects dropped, booleans and styles kept", () => {
    const conv = snapshotMarkupToHtml(parseSnapshotEntries(readFileSync(SEARCH, "utf8"))[0]!.value);
    expect("html" in conv).toBe(true);
    const html = (conv as { html: string }).html;
    expect(html).toContain('class="fr-search-bar"');
    expect(html).not.toContain("className");
    expect(html).not.toContain("[Function]");
    expect(html).not.toContain("onSubmit");
    expect(html).toContain('aria-hidden="false"'); // an aria-* boolean is a string token
    expect(html).not.toMatch(/disabled/); // disabled={false} is no attribute at all
    expect(html).toContain('style="margin-left:8"');
  });

  it("closes a self-closed non-void element, so `<button />` does not swallow its siblings", () => {
    const conv = snapshotMarkupToHtml('\n<div>\n  <button\n    type="button"\n  />\n  <span>x</span>\n</div>\n') as { html: string };
    expect(conv.html).toContain("></button>");
  });

  it("unwraps the DocumentFragment asFragment() returns, and never keeps an <html> element", () => {
    const frag = snapshotMarkupToHtml("\n<DocumentFragment>\n  <p>x</p>\n</DocumentFragment>\n") as { html: string };
    expect(frag.html).not.toContain("DocumentFragment");
    const doc = snapshotMarkupToHtml('\n<html lang="fr">\n  <body>\n    <p>x</p>\n  </body>\n</html>\n') as { html: string };
    expect(doc.html).not.toMatch(/<html|<\/html>/);
    const str = snapshotMarkupToHtml('"<!DOCTYPE html><html lang=\\"fr\\"><body><p>x</p></body></html>"') as { html: string };
    expect(str.html).not.toMatch(/<html|<!doctype/i);
    expect(str.html).toContain("<p>x</p>");
  });

  it("keeps the newlines of every rewrite, so the converted markup has the entry's line count", () => {
    for (const file of [TOOLBAR, SEARCH, CARD]) {
      for (const e of parseSnapshotEntries(readFileSync(file, "utf8"))) {
        const conv = snapshotMarkupToHtml(e.value);
        if ("html" in conv) expect(conv.html.split("\n").length, `${file} ${e.name}`).toBe(e.value.split("\n").length);
      }
    }
  });

  it("names the test file the snapshot belongs to", () => {
    expect(snapshotTestFile("src/components/__snapshots__/Button.test.tsx.snap")).toBe("src/components/Button.test.tsx");
    expect(snapshotTestFile("src/Button.snap")).toBeUndefined();
  });
});

describe("audit picks the snapshots up", () => {
  it("includes .snap files by default — even under __tests__/, which the test-artifact rule otherwise drops", () => {
    const files = expandInputs([FIX]);
    expect(files).toContain(TOOLBAR);
    expect(files).toContain(SEARCH);
    // The test file itself is still a test artifact: typed markup, not a render.
    expect(files.some((f) => f.endsWith("Toolbar.test.tsx"))).toBe(false);
    expect(isTestArtifact("src/__tests__/__snapshots__/A.test.jsx.snap")).toBe(false);
    expect(isTestArtifact("src/__tests__/__snapshots__/button.html")).toBe(false);
    expect(isTestArtifact("src/__tests__/fixture.html")).toBe(true);
  });

  it("opts out like any other path", () => {
    expect(expandInputs([FIX], { exclude: ["**/__snapshots__/**"] }).some((f) => f.endsWith(".snap"))).toBe(false);
  });

  const r = runAudit({ inputs: [FIX] });
  const of = (file: string) => r.findings.filter((f) => f.file === file);

  it("finds the components' defects from the .snap files alone", () => {
    const toolbar = of(TOOLBAR);
    expect(toolbar.find((f) => f.ruleId === "button-empty-name")).toBeTruthy(); // icon-only close button
    expect(toolbar.find((f) => f.ruleId === "img-alt-missing")).toBeTruthy(); // logo without alt
    // react-test-renderer: a search field whose only label is its placeholder.
    expect(of(SEARCH).find((f) => f.ruleId === "placeholder-as-label")).toBeTruthy();
    // A string snapshot of innerHTML (old `escapeString` quoting included).
    expect(of(CARD).find((f) => f.ruleId === "img-alt-missing")).toBeTruthy();
  });

  it("anchors each finding to the .snap file and the line the element is written on", () => {
    const close = of(TOOLBAR).find((f) => f.ruleId === "button-empty-name")!;
    expect(close.line).toBe(lineOf(TOOLBAR, 'class="fr-btn fr-icon-close-line"') - 1);
    const logo = of(TOOLBAR).find((f) => f.ruleId === "img-alt-missing")!;
    expect(logo.line).toBe(lineOf(TOOLBAR, "<img"));
    const field = of(SEARCH).find((f) => f.ruleId === "placeholder-as-label")!;
    expect(field.line).toBe(lineOf(SEARCH, "<input"));
    // Offsets index the converted markup, not the file: `fix` must never edit a snapshot by range.
    expect(close.sourceStart).toBeUndefined();
  });

  it("names the entry each finding was raised on", () => {
    expect(of(TOOLBAR).find((f) => f.ruleId === "button-empty-name")!.origin?.snapshot).toBe("Toolbar > renders the icon-only close button 1");
    expect(of(TOOLBAR).find((f) => f.ruleId === "img-alt-missing")!.origin?.snapshot).toBe("Toolbar > renders the logo 1");
    expect(of(SEARCH)[0]!.origin?.snapshot).toBe("SearchForm renders an unlabelled field 1");
  });

  it("attributes to the component source only when it exists beside the test", () => {
    const card = of(CARD).find((f) => f.ruleId === "img-alt-missing")!;
    expect(card.origin?.sourceFile).toBe(`${FIX}/src/components/Card.tsx`);
    expect(card.origin?.component).toBe("Card");
    // No Toolbar.tsx in the fixture: no guessed attribution.
    expect(of(TOOLBAR)[0]!.origin?.sourceFile).toBeUndefined();
  });

  it("audits each entry as a component: the page-scoped rules stay off", () => {
    const pageScoped = new Set(ALL_RULES.filter((rule) => rule.scope === "page").map((rule) => rule.id));
    // The same markup as a whole page DOES trip them — so their silence above is the scope, not luck.
    const asPage = runRules(parseHtml("<!doctype html><html><head></head><body><button></button></body></html>", "page.html"));
    expect(asPage.some((f) => pageScoped.has(f.ruleId))).toBe(true);
    const snapFindings = r.findings.filter((f) => f.file.endsWith(".snap"));
    expect(snapFindings.filter((f) => pageScoped.has(f.ruleId))).toEqual([]);
    expect(snapFindings.every((f) => f.page === undefined)).toBe(true);
  });

  it("states what was read in the scope, apart from the browser captures", () => {
    expect(r.scope.unitSnapshots).toEqual({ files: 3, entries: 5, skipped: 5 });
    expect(r.scope.captures).toBeUndefined();
    // One .snap is one audited file, however many entries it holds (+ Card.tsx, the source).
    expect(r.scope.files).toBe(4);
  });

  it("prints the entry's name under the occurrence in the auditor view", () => {
    const md = renderAuditorBacklog(r, "fr", "rgaa");
    expect(md).toContain("instantané de test unitaire « Toolbar > renders the icon-only close button 1 »");
    expect(renderAuditorBacklog(r, "en", "wcag")).toContain("unit-test snapshot “SearchForm renders an unlabelled field 1”");
  });
});

it("does not mistake a data-only snapshot file for a render", () => {
  // The repo's own tests/__snapshots__ hold strings and arrays: none is markup.
  const r = runAudit({ inputs: [join("tests", "__snapshots__")] });
  expect(r.scope.unitSnapshots).toBeUndefined();
  expect(r.findings).toEqual([]);
  expect(r.scope.files).toBe(0);
});
