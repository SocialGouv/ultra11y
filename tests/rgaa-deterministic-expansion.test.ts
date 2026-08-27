import { describe, expect, it } from "vitest";
import { buildAudit } from "../src/audit.js";
import { checkDecided } from "../src/check.js";
import { parseSource } from "../src/parse/source.js";
import { reportGroups } from "../src/report.js";
import { runRules } from "../src/rules/registry.js";
import { derivePackResults } from "../src/standards/index.js";

const ids = (html: string): string[] => runRules(parseSource(html, "fixture.html")).map((finding) => finding.ruleId);
const page = (body: string, htmlAttrs = "") => `<!doctype html><html ${htmlAttrs}><head><title>T</title></head><body><main>${body}</main></body></html>`;

describe("RGAA deterministic expansion — fail-closed boundaries", () => {
  it("accepts RGAA 8.3's per-text language alternative", () => {
    expect(ids(page('<p lang="fr">Bonjour</p><p lang="en">Hello</p>'))).not.toContain("document-language-missing");
  });

  it("accepts xml:lang when an empty HTML lang attribute is also present", () => {
    expect(ids(page("<p>Texte</p>", 'lang="" xml:lang="fr"'))).not.toContain("document-language-missing");
  });

  it("reports only a genuinely uncovered visible text node for RGAA 8.3", () => {
    expect(ids(page('<p lang="fr">Bonjour</p><p>Hello</p>'))).toContain("document-language-missing");
  });

  it("compares lang/xml:lang case-insensitively", () => {
    expect(ids(page("<p>Bonjour</p>", 'lang="fr-FR" xml:lang="FR-fr"'))).not.toContain("html-lang-xml-lang-mismatch");
    expect(ids(page("<p>Bonjour</p>", 'lang="fr" xml:lang="en"'))).toContain("html-lang-xml-lang-mismatch");
  });

  it("finds duplicate raw HTML attributes without confusing different attributes", () => {
    expect(ids(page('<p data-a="1" data-b="2">x</p>', 'lang="fr"'))).not.toContain("duplicate-attribute");
    expect(ids(page('<p CLASS="a" class="b">x</p>', 'lang="fr"'))).toContain("duplicate-attribute");
  });

  it("keeps conforming and non-rendered text-spacing declarations out", () => {
    expect(ids(page('<p style="letter-spacing:.12em !important;word-spacing:.16em !important;line-height:1.5 !important">x</p>', 'lang="fr"'))).not.toContain(
      "letter-spacing-important",
    );
    expect(ids(page('<p style="display:none;letter-spacing:0 !important">x</p>', 'lang="fr"'))).not.toContain("letter-spacing-important");
    expect(ids(page('<div style="letter-spacing:0 !important"><img src="dot.svg" alt=""></div>', 'lang="fr"'))).not.toContain("letter-spacing-important");
    expect(ids(page('<div style="letter-spacing:0 !important"><span hidden>Invisible</span></div>', 'lang="fr"'))).not.toContain("letter-spacing-important");
    expect(ids(page('<div style="letter-spacing:0 !important"><span>Visible</span></div>', 'lang="fr"'))).toContain("letter-spacing-important");
    expect(ids(page('<div style="letter-spacing:0 !important"><span aria-hidden="true">Visible</span></div>', 'lang="fr"'))).toContain(
      "letter-spacing-important",
    );
    expect(ids(page('<input value="Visible" style="letter-spacing:0 !important">', 'lang="fr"'))).toContain("letter-spacing-important");
  });

  it("does not report correctly hidden decoration or named menu items", () => {
    expect(ids(page('<img src="dot.svg" alt=""><div role="menu"><div role="menuitem">Open</div></div>', 'lang="fr"'))).not.toContain(
      "decorative-marked-exposed",
    );
    expect(ids(page('<div role="menu"><div role="menuitem">Open</div></div>', 'lang="fr"'))).not.toContain("menuitem-empty-name");
  });

  it("defers JSX names and document language that may be supplied by a spread", () => {
    const jsx = `export default function Page(props){return <html {...props}><body><div role="menu"><div role="menuitem" {...props}></div></div></body></html>}`;
    const findings = runRules(parseSource(jsx, "layout.tsx"));
    expect(findings.map((finding) => finding.ruleId)).not.toContain("html-lang-missing");
    expect(findings.map((finding) => finding.ruleId)).not.toContain("document-language-missing");
    expect(findings.map((finding) => finding.ruleId)).not.toContain("menuitem-empty-name");
  });

  it("still reports literal missing JSX names and document language", () => {
    const jsx = `export default function Page(){return <html><body><p>Visible</p><div role="menu"><div role="menuitem"></div></div></body></html>}`;
    const findings = runRules(parseSource(jsx, "layout.tsx"));
    expect(findings.map((finding) => finding.ruleId)).toContain("html-lang-missing");
    expect(findings.map((finding) => finding.ruleId)).toContain("document-language-missing");
    expect(findings.map((finding) => finding.ruleId)).toContain("menuitem-empty-name");
  });

  it("respects JSX attribute order when later literals override a spread", () => {
    const afterSpread = `export default function Page(props){return <html {...props} lang="" xmlLang=""><body><p>Visible</p></body></html>}`;
    const beforeSpread = `export default function Page(props){return <html lang="" xmlLang="" {...props}><body><p>Visible</p></body></html>}`;
    const after = runRules(parseSource(afterSpread, "layout.tsx")).map((finding) => finding.ruleId);
    const before = runRules(parseSource(beforeSpread, "layout.tsx")).map((finding) => finding.ruleId);
    expect(after).toContain("html-lang-missing");
    expect(after).toContain("document-language-missing");
    expect(before).not.toContain("html-lang-missing");
    expect(before).not.toContain("document-language-missing");
  });

  it("keeps a dynamically spread page language open across audit, report, pack, and require-decided", () => {
    const jsx = `export default function Page(props){return <html {...props}><body><p>Visible</p></body></html>}`;
    const audit = buildAudit([parseSource(jsx, "layout.tsx")], ["layout.tsx"]);
    expect(audit.findings.map((finding) => finding.ruleId)).not.toContain("html-lang-missing");
    expect(audit.findings.map((finding) => finding.ruleId)).not.toContain("document-language-missing");
    expect(audit.criteria.find((criterion) => criterion.id === "3.1.1")?.status).toBe("manual");
    expect(audit.residualRisks.some((risk) => risk.criteriaId === "3.1.1")).toBe(true);
    expect(
      reportGroups(audit, "en")
        .flatMap((group) => group.rows)
        .find((row) => row.id === "3.1.1")?.status,
    ).toBe("manual");
    expect(checkDecided(audit, "wcag", "en").undecided).toContain("3.1.1");
    expect(derivePackResults(audit, "rgaa").find((criterion) => criterion.id === "8.3")?.status).toBe("manual");
    expect(checkDecided(audit, "rgaa", "fr").undecided).toContain("8.3");

    const overridden = buildAudit(
      [parseSource(`export default function Page(props){return <html lang="fr" xmlLang="fr" {...props}><body><p>Visible</p></body></html>}`, "layout.tsx")],
      ["layout.tsx"],
    );
    const pinned = buildAudit(
      [parseSource(`export default function Page(props){return <html {...props} lang="fr" xmlLang="fr"><body><p>Visible</p></body></html>}`, "layout.tsx")],
      ["layout.tsx"],
    );
    expect(overridden.criteria.find((criterion) => criterion.id === "3.1.1")?.status).toBe("manual");
    expect(pinned.criteria.find((criterion) => criterion.id === "3.1.1")?.status).toBe("C");
  });

  it("closes document-language uncertainty when one explicit language follows a spread", () => {
    const audit = buildAudit(
      [parseSource(`export default function Page(props){return <html {...props} lang="fr"><body><p>Visible</p></body></html>}`, "layout.tsx")],
      ["layout.tsx"],
    );
    expect(audit.criteria.find((criterion) => criterion.id === "3.1.1")?.status).toBe("C");
    expect(derivePackResults(audit, "rgaa").find((criterion) => criterion.id === "8.3")?.status).toBe("C");
  });

  it("projects script-button naming failures onto RGAA 7.1", () => {
    const empty = buildAudit([parseSource(page('<button type="button"></button>', 'lang="fr"'), "empty.html")], ["empty.html"]);
    const mismatch = buildAudit(
      [parseSource(page('<button type="button" aria-label="Submit">Save</button>', 'lang="fr"'), "mismatch.html")],
      ["mismatch.html"],
    );
    const emptyCriterion = derivePackResults(empty, "rgaa").find((criterion) => criterion.id === "7.1");
    const mismatchCriterion = derivePackResults(mismatch, "rgaa").find((criterion) => criterion.id === "7.1");
    expect(emptyCriterion?.status).toBe("NC");
    expect(emptyCriterion?.findings.some((finding) => finding.ruleId === "button-empty-name")).toBe(true);
    expect(mismatchCriterion?.status).toBe("NC");
    expect(mismatchCriterion?.findings.some((finding) => finding.ruleId === "label-in-name-mismatch")).toBe(true);
  });

  it("attributes an exposed presentational landmark to name/role/value, not non-text content", () => {
    const findings = runRules(parseSource(page('<nav role="presentation" aria-label="Global"></nav>', 'lang="fr"'), "fixture.html"));
    expect(findings.find((finding) => finding.ruleId === "decorative-marked-exposed")?.criteriaId).toBe("4.1.2");
  });

  it("projects an unnamed image submit button onto RGAA 11.9.1 as well as the image criterion", () => {
    const audit = buildAudit([parseSource(page('<form><input type="image" src="send.png"></form>', 'lang="fr"'), "fixture.html")], ["fixture.html"]);
    const criterion = derivePackResults(audit, "rgaa").find((row) => row.id === "11.9");
    expect(criterion?.status).toBe("NC");
    expect(criterion?.findings.some((finding) => finding.ruleId === "form-button-empty-name")).toBe(true);
  });

  it("does not treat a disabled presentational child as focusable", () => {
    expect(ids(page('<div role="checkbox" aria-checked="false"><button disabled>Help</button></div>', 'lang="fr"'))).not.toContain(
      "presentational-children-focusable",
    );
  });

  it("accepts the four valid table scope values", () => {
    for (const scope of ["row", "col", "rowgroup", "colgroup"])
      expect(ids(page(`<table><caption>T</caption><tr><th scope="${scope}">H</th></tr><tr><td>D</td></tr></table>`, 'lang="fr"'))).not.toContain(
        "table-scope-invalid",
      );
  });
});
