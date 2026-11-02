// #115 — five false findings found by an independent review, each with its true positive kept.
import { describe, it, expect } from "vitest";
import { findOf } from "./helpers.js";
import { harvestSubjects, subjectsForPackCriterion } from "../../src/adjudicate-subjects.js";
import { parseHtml } from "../../src/parse/html.js";
import { loadPack } from "../../src/standards/index.js";

describe("list-structure — a fragment inside a list (#115)", () => {
  it("does not report a conditional fragment of <li>s inside a <ul>, nor its items", () => {
    const src = `export function F({ open }) { return (<ul><li>Zéro</li>{open && (<><li>Un</li><li>Deux</li></>)}</ul>); }`;
    expect(findOf(src, "list-structure", "F.tsx")).toHaveLength(0);
  });
  it("does not report nested fragments inside an <ol>", () => {
    const src = `export function F() { return (<ol><><><li>Un</li></></></ol>); }`;
    expect(findOf(src, "list-structure", "F.tsx")).toHaveLength(0);
  });
  it("still reports a non-<li> child carried by a fragment inside a <ul>", () => {
    const f = findOf(`export function F({ open }) { return (<ul><li>a</li>{open && (<><div>b</div></>)}</ul>); }`, "list-structure", "F.tsx");
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("div");
  });
  it("still reports a <li> under a fragment inside a non-list element", () => {
    expect(findOf(`export function F() { return (<div><><li>a</li></></div>); }`, "list-structure", "F.tsx")).toHaveLength(1);
  });
});

describe("control-label-missing — a Vue-bound id (#115)", () => {
  it("does not block a field whose id is bound with :id or v-bind:id", () => {
    expect(findOf(`<template><input :id="inputId" type="text"></template>`, "control-label-missing", "C.vue")).toHaveLength(0);
    expect(findOf(`<template><input v-bind:id="inputId" type="text"></template>`, "control-label-missing", "C.vue")).toHaveLength(0);
  });
  it("still fires on a Vue field with a literal id and no label", () => {
    expect(findOf(`<template><input id="n" type="text"></template>`, "control-label-missing", "C.vue")).toHaveLength(1);
  });
});

describe("menuitem-empty-name — a dynamic aria-labelledby (#115)", () => {
  it("does not block a menuitem labelled by a JSX expression or a Vue binding", () => {
    expect(
      findOf(`export function M({ labelId }) { return <div role="menuitem" aria-labelledby={labelId}></div>; }`, "menuitem-empty-name", "M.tsx"),
    ).toHaveLength(0);
    expect(findOf(`<template><div role="menuitem" :aria-labelledby="labelId"></div></template>`, "menuitem-empty-name", "M.vue")).toHaveLength(0);
  });
  it("still fires on an empty menuitem, and on one whose literal labelledby dangles", () => {
    expect(findOf(`<div role="menu"><div role="menuitem"></div></div>`, "menuitem-empty-name")).toHaveLength(1);
    expect(findOf(`<div role="menu"><div role="menuitem" aria-labelledby="ghost"></div></div>`, "menuitem-empty-name")).toHaveLength(1);
  });
});

describe("field-label-in-name-mismatch — a visually hidden <label> (#115)", () => {
  const RULE = "field-label-in-name-mismatch";
  it("does not report a field whose <label> is itself sr-only (no visible label)", () => {
    expect(findOf(`<label for="q" class="sr-only">Recherche</label><input id="q" aria-label="Search the site">`, RULE)).toHaveLength(0);
    expect(findOf(`<label for="q" class="fr-label fr-sr-only">Recherche</label><input id="q" aria-label="Search the site">`, RULE)).toHaveLength(0);
    expect(findOf(`<label class="visually-hidden">Recherche <input aria-label="Search the site"></label>`, RULE)).toHaveLength(0);
  });
  it("still reports a visible label that the aria-label drops", () => {
    expect(findOf(`<label for="q" class="fr-label">Recherche</label><input id="q" aria-label="Search the site">`, RULE)).toHaveLength(1);
  });
});

describe("figure-caption-unassociated — a nested figure's caption (#115)", () => {
  const RULE = "figure-caption-unassociated";
  it("does not hold an outer figure to the caption of a nested figure", () => {
    const html = `<figure role="group" aria-label="Galerie">
      <figure role="figure" aria-label="Pont"><img src="a.png" alt="Pont"><figcaption>Pont</figcaption></figure>
    </figure>`;
    expect(findOf(html, RULE)).toHaveLength(0);
  });
  it("still reports the outer figure against its own caption, and a bare inner figure", () => {
    const html = `<figure>
      <figure role="figure" aria-label="Pont"><img src="a.png" alt="Pont"><figcaption>Pont</figcaption></figure>
      <figcaption>Galerie</figcaption>
    </figure>`;
    const f = findOf(html, RULE);
    expect(f).toHaveLength(1);
    expect(f[0]!.message).toContain("Galerie");
    const inner = `<figure role="group" aria-label="Galerie"><figure><img src="a.png" alt="Pont"><figcaption>Pont</figcaption></figure></figure>`;
    const g = findOf(inner, RULE);
    expect(g).toHaveLength(1);
    expect(g[0]!.message).toContain("Pont");
  });
});

describe("images subject — role=img is normalised like insideRoleImg (#115)", () => {
  const page = (body: string) => `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1>${body}</main></body></html>`;
  const images = (body: string) => {
    const pc = loadPack("rgaa").criteria.find((c) => c.id === "1.2")!;
    return harvestSubjects(subjectsForPackCriterion("rgaa", "1.2", pc.wcag), [parseHtml(page(body), "p.html")]).filter((x) => x.cls.startsWith("image|"));
  };
  it("harvests a role written ' IMG ' as an image", () => {
    expect(images(`<div role=" IMG " aria-label="Courbe"></div>`)).toHaveLength(1);
  });
  it("still harvests a plain role=img and ignores another role", () => {
    expect(images(`<div role="img" aria-label="Courbe"></div>`)).toHaveLength(1);
    expect(images(`<div role="region" aria-label="Courbe"></div>`)).toHaveLength(0);
  });
});
