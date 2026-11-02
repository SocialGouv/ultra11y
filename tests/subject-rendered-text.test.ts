// TEXT SUBJECTS READ THE PAGE'S RENDERED TEXT, NOT ITS CODE (#129).
//
// The JSX parser keeps every `{…}` expression container as a raw text node, so the text a
// subject read on a component was its comments and code as much as its copy. Measured on a real
// run (egapro, 39 captures): 35 of the 38 « candidate foreign passages » of RGAA 8.7/8.8 were
// `{/* … */}` comments and `{cond && ( <… /> )}` fragments, two more were a Next.js `<script>`
// payload on a capture, and the page's one real English phrase — « Do Not Track », on its cookie
// page — was never shown. The sensory instructions of 10.9/10.10 were mostly code comments.
//
// Both directions are pinned here: the noise is gone, and the real passage is still found.
import { describe, expect, it } from "vitest";

import { SUBJECTS } from "../src/adjudicate-subjects.js";
import { parseHtml } from "../src/parse/html.js";
import { parseSource } from "../src/parse/source.js";

const tsx = (body: string) => parseSource(`export function C({ label, items }) {\n  return (\n${body}\n  );\n}\n`, "src/C.tsx");
const capture = (body: string, page = "p") =>
  parseHtml(
    `<html lang="fr"><head><title>T</title><script>self.__next_f.push([1,"the router and the loader for your page"])</script></head><body>${body}</body></html>`,
    `.ultra11y/pages/${page}/dom.html`,
  );
const notes = (subject: string, docs: ReturnType<typeof tsx>[]) => (SUBJECTS[subject]?.(docs) ?? []).map((x) => x.ev.note ?? "");
const foreign = (docs: ReturnType<typeof tsx>[]) => notes("langParts", docs).filter((n) => n.startsWith("candidate foreign passage"));

describe("langParts (8.7/8.8) reads rendered text only", () => {
  it("a JSX comment and a code fragment are not passages of the page", () => {
    const doc = tsx(`<div>
      Nombre de résultats par page {/* WCAG 3.2.2: the reload is what a sighted user asked for */}
      {items.length > 0 && (<ul className="fr-list">{items.map((i) => <li key={i}>{i}</li>)}</ul>)}
      <p>{label}</p>
    </div>`);
    expect(foreign([doc])).toEqual([]);
  });

  it("…while a real English phrase in the copy IS a candidate, in source and on a capture", () => {
    const src = tsx(`<p>Si votre navigateur émet le signal « Do Not Track » (Ne pas me pister), il est respecté.</p>`);
    expect(foreign([src]).some((n) => /Do Not Track/.test(n))).toBe(true);
    const page = capture(`<main><p>Si votre navigateur émet le signal « Do Not Track&nbsp;» (Ne pas me pister), il est respecté.</p></main>`);
    expect(foreign([page]).some((n) => /Do Not Track/.test(n))).toBe(true);
  });

  it("a string literal inside braces is rendered text, and stays a candidate", () => {
    expect(foreign([tsx(`<p>{"Read more about the project"}</p>`)]).some((n) => /Read more/.test(n))).toBe(true);
  });

  it("on a capture, script, style, template and noscript are not page text", () => {
    const page = capture(
      `<main><p>Bienvenue</p><noscript><img src="https://px/the-pixel.gif" alt="tracking for the analytics"></noscript><template><p>the template for your rows</p></template><style>.x::after{content:"the end"}</style><script>window.x = "and the rest"</script></main>`,
    );
    expect(foreign([page])).toEqual([]);
  });

  it("a word is matched as a WORD: « Isère » is not the English « is »", () => {
    expect(foreign([capture(`<main><select><option>38 — Isère</option></select></main>`)])).toEqual([]);
  });

  it("a phrase already inside a lang override is marked, so it is no candidate", () => {
    const page = capture(`<main><p lang="en"><strong>Do Not Track</strong> is honoured</p></main>`);
    expect(foreign([page])).toEqual([]);
    expect(notes("langParts", [page]).some((n) => /^lang="en"/.test(n))).toBe(true);
  });
});

describe("sensoryText / instructions (10.9/10.10) read rendered text only", () => {
  it("code comments are not instructions the page gives", () => {
    const doc = parseSource(
      `/**\n * Block pinned to the left of the title — the legend below it restates the figures.\n */\nexport function C() {\n  // the CSE field starts at 100, so below\n  return (<div>{/* The alert renders above the page h1 */}<span>Total</span></div>);\n}\n`,
      "src/C.tsx",
    );
    expect(notes("sensoryText", [doc])).toEqual([]);
    expect(notes("instructions", [doc])).toEqual([]);
  });

  it("…while copy, and a component's literal text prop, still are", () => {
    const doc = tsx(`<div>
      <p>Si ce n'est pas le cas, cliquez sur le bouton ci-dessous.</p>
      <CallOut description="Consignes pour compléter le fichier ci-dessus" />
      <CallOut description={label} />
    </div>`);
    const n = notes("sensoryText", [doc]);
    expect(n.some((x) => /cliquez sur le bouton ci-dessous/.test(x))).toBe(true);
    expect(n.some((x) => /fichier ci-dessus/.test(x))).toBe(true);
    expect(n).toHaveLength(2);
  });

  it("an instruction nested in a conditional is anchored on its own element, without the code around it", () => {
    const n = notes("instructions", [tsx(`<div>{!label && (<p className="fr-text--lg">Sélectionnez au moins un filtre pour lancer la recherche.</p>)}</div>`)]);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatch(/^instruction: "Sélectionnez au moins un filtre/);
    expect(n[0]).not.toMatch(/&&|className/);
  });

  it("on a capture, a script's text is no instruction", () => {
    const page = capture(`<main><p>Texte</p><script>/* click the button below */</script></main>`);
    expect(notes("sensoryText", [page])).toEqual([]);
    expect(notes("instructions", [page])).toEqual([]);
  });
});

describe("cryptic (13.5/13.6) and quotes (9.4) read rendered text only", () => {
  it("an emoticon in a comment is not content; one in the copy is", () => {
    expect(notes("cryptic", [tsx(`<div>{/* 🚧 temporary */}<span>Texte</span></div>`)])).toEqual([]);
    expect(notes("cryptic", [tsx(`<p>Merci 🎉</p>`)]).length).toBe(1);
  });

  it("a quoted string in code is not a quotation; one in the copy is", () => {
    expect(notes("quotes", [tsx(`<div>{label === "une valeur assez longue" ? "a" : "b"}</div>`)])).toEqual([]);
    expect(notes("quotes", [tsx(`<p>Le ministère précise : « une déclaration par entreprise et par an ».</p>`)]).length).toBe(1);
  });
});
