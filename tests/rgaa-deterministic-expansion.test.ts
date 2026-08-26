import { describe, expect, it } from "vitest";
import { parseSource } from "../src/parse/source.js";
import { runRules } from "../src/rules/registry.js";

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
  });

  it("does not report correctly hidden decoration or named menu items", () => {
    expect(ids(page('<img src="dot.svg" alt=""><div role="menu"><div role="menuitem">Open</div></div>', 'lang="fr"'))).not.toContain(
      "decorative-marked-exposed",
    );
    expect(ids(page('<div role="menu"><div role="menuitem">Open</div></div>', 'lang="fr"'))).not.toContain("menuitem-empty-name");
  });

  it("attributes an exposed presentational landmark to name/role/value, not non-text content", () => {
    const findings = runRules(parseSource(page('<nav role="presentation" aria-label="Global"></nav>', 'lang="fr"'), "fixture.html"));
    expect(findings.find((finding) => finding.ruleId === "decorative-marked-exposed")?.criteriaId).toBe("4.1.2");
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
