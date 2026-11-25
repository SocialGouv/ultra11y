import { describe, expect, it } from "vitest";
import { buildAudit } from "../src/audit.js";
import { checkDecided } from "../src/check.js";
import { parseSource } from "../src/parse/source.js";
import { reportGroups } from "../src/report.js";
import { runRules } from "../src/rules/registry.js";
import { derivePackResults, loadPack } from "../src/standards/index.js";

const ids = (html: string): string[] => runRules(parseSource(html, "fixture.html")).map((finding) => finding.ruleId);
const page = (body: string, htmlAttrs = "") => `<!doctype html><html ${htmlAttrs}><head><title>T</title></head><body><main>${body}</main></body></html>`;

describe("RGAA deterministic expansion — fail-closed boundaries", () => {
  it("accepts RGAA 8.3's per-text language alternative", () => {
    expect(ids(page('<p lang="fr">Bonjour</p><p lang="en">Hello</p>'))).not.toContain("document-language-missing");
  });

  // The 8.3.1 methodology names the attribute per doctype: `lang` « si le code est du HTML5 ou
  // du HTML4 », `xml:lang` alone only « si le code est du XHTML 1.1 ». An empty `lang` beside an
  // `xml:lang` on an HTML5 page therefore declares no default language (xml:lang is inert in
  // text/html, and ACT b5c3f8 fails it the same way).
  it("accepts xml:lang alone only where the doctype is XHTML 1.1", () => {
    expect(ids(page("<p>Texte</p>", 'lang="" xml:lang="fr"'))).toContain("document-language-missing");
    const xhtml11 = '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">';
    expect(ids(page("<p>Texte</p>", 'lang="" xml:lang="fr"').replace("<!doctype html>", xhtml11))).not.toContain("document-language-missing");
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

// #203 — an <img> with no alt attribute fails either way: 1.1.1 if it carries information,
// 1.2.1 if it is decorative (it then needed alt=""). It is a decisive NC, never a candidate.
describe("RGAA — an image with no alt attribute is a non-conformity (#203)", () => {
  const rgaa = (body: string) => {
    const audit = buildAudit([parseSource(page(body, 'lang="fr"'), "fixture.html")], ["fixture.html"]);
    const rows = derivePackResults(audit, "rgaa");
    return (id: string) => rows.find((row) => row.id === id);
  };
  const altRules = (body: string) => ids(page(body, 'lang="fr"')).filter((id) => id.startsWith("img-alt-missing"));

  it("a plain <img> with no alt is an NC of 1.1 (informative by default), not of 1.2", () => {
    const row = rgaa('<img src="chart.png">');
    expect(row("1.1")?.status).toBe("NC");
    expect(row("1.1")?.findings.some((f) => f.ruleId === "img-alt-missing" && !f.advisory)).toBe(true);
    expect(row("1.2")?.status).not.toBe("NC");
  });

  it("an <img> with no alt in a link or button that already has text is decorative: NC of 1.2, not of 1.1", () => {
    for (const body of ['<a href="/">Accueil <img src="house.png"></a>', '<button type="button"><img src="x.png"> Fermer</button>']) {
      const row = rgaa(body);
      expect(row("1.2")?.status, body).toBe("NC");
      expect(
        row("1.2")?.findings.some((f) => f.ruleId === "img-alt-missing-decorative"),
        body,
      ).toBe(true);
      expect(
        row("1.1")?.findings.some((f) => f.ruleId.startsWith("img-alt-missing")),
        body,
      ).toBe(false);
    }
  });

  it("an <img> that is the only content of a link stays informative (1.1)", () => {
    const row = rgaa('<a href="/"><img src="logo.png"></a>');
    expect(row("1.1")?.status).toBe("NC");
    expect(altRules('<a href="/"><img src="logo.png"></a>')).toEqual(["img-alt-missing"]);
  });

  it("aria-hidden / role=presentation without alt is how RGAA 1.2.1 ignores a decorative image: no NC", () => {
    for (const body of [
      '<img src="dot.png" aria-hidden="true">',
      '<img src="dot.png" role="presentation">',
      '<a href="/">Accueil <img src="h.png" aria-hidden="true"></a>',
    ]) {
      expect(altRules(body), body).toEqual([]);
      const row = rgaa(body);
      expect(row("1.1")?.status, body).not.toBe("NC");
      expect(row("1.2")?.status, body).not.toBe("NC");
    }
  });

  it('alt="" and a present alt are unchanged', () => {
    for (const body of ['<img src="dot.png" alt="">', '<img src="chart.png" alt="Ventes 2025">', '<a href="/">Accueil <img src="h.png" alt=""></a>'])
      expect(altRules(body), body).toEqual([]);
  });

  it("the pack contract makes both rules decisive and neither a candidate", () => {
    const pack = loadPack("rgaa");
    const contract = (criterionId: string, ruleId: string) =>
      pack.criteria.find((c) => c.id === criterionId)?.automation?.rules.find((rule) => rule.id === ruleId);
    expect(contract("1.1", "img-alt-missing")).toMatchObject({ effect: "decisive-nc", tests: ["1"] });
    expect(contract("1.1", "img-alt-missing")?.rationale).toContain("Informative by default; 1.2 if decorative");
    expect(contract("1.2", "img-alt-missing-decorative")).toMatchObject({ effect: "decisive-nc", tests: ["1"] });
    expect(contract("1.1", "img-alt-missing-decorative")).toBeUndefined();
  });
});
