import { describe, it, expect } from "vitest";
import { parseHtml, attr, hasAttr, visibleText, elementsByTag, getById, ancestors, descendants, allIds, snippet } from "../src/parse/html.js";

const HTML = `<!doctype html>
<html lang="fr">
  <head><title>Accueil</title></head>
  <body>
    <main id="main">
      <h1>Bonjour</h1>
      <img src="a.png" alt="Un chat">
      <a href="/x"><span>Lire</span> la suite</a>
      <input id="dup" type="text">
      <label id="dup">x</label>
    </main>
  </body>
</html>`;

describe("parseHtml", () => {
  const doc = parseHtml(HTML, "page.html");

  it("collects all elements with lowercased tags", () => {
    const tags = doc.elements.map((e) => e.tag);
    expect(tags).toContain("html");
    expect(tags).toContain("title");
    expect(tags).toContain("img");
    expect(tags).toContain("a");
  });

  it("reads attributes case-insensitively", () => {
    const html = elementsByTag(doc, "html")[0]!;
    expect(attr(html, "lang")).toBe("fr");
    expect(attr(html, "LANG")).toBe("fr");
    expect(hasAttr(html, "lang")).toBe(true);
    const img = elementsByTag(doc, "img")[0]!;
    expect(attr(img, "alt")).toBe("Un chat");
  });

  it("computes 1-based line/col for elements", () => {
    const h1 = elementsByTag(doc, "h1")[0]!;
    expect(h1.line).toBe(6);
    expect(h1.col).toBe(7);
  });

  it("extracts visible text including nested elements", () => {
    const a = elementsByTag(doc, "a")[0]!;
    expect(visibleText(a)).toBe("Lire la suite");
  });

  it("resolves ids (first wins) and lists duplicates", () => {
    expect(getById(doc, "main")?.tag).toBe("main");
    const dups = allIds(doc).filter((x) => x.id === "dup");
    expect(dups.length).toBe(2);
  });

  it("navigates ancestors and descendants", () => {
    const span = elementsByTag(doc, "span")[0]!;
    expect(ancestors(span).map((e) => e.tag)).toEqual(["a", "main", "body", "html"]);
    const main = getById(doc, "main")!;
    expect(descendants(main).some((e) => e.tag === "img")).toBe(true);
  });

  it("produces a trimmed source snippet for an element", () => {
    const img = elementsByTag(doc, "img")[0]!;
    expect(snippet(doc, img)).toContain("<img");
  });

  it("anchors snippets at the target in a minified single-line document", () => {
    const minified = parseHtml('<main><input id="first"><span>middle</span><input id="target" aria-label="Target"></main>', "minified.html");
    const target = getById(minified, "target")!;
    expect(snippet(minified, target)).toMatch(/^<input id="target" aria-label="Target">/);
    expect(snippet(minified, target)).not.toContain('id="first"');
  });

  it("uses the indexed next-line boundary for ordinary multiline source", () => {
    const multiline = parseHtml('<main>\n  <input id="target">\n  <p>next line</p>\n</main>', "multiline.html");
    const target = getById(multiline, "target")!;
    expect(snippet(multiline, target)).toBe('<input id="target">');
  });
});
