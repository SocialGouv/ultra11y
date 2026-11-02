import { describe, it, expect } from "vitest";
import { findOf, page } from "./helpers.js";

describe("heading-order-skip (9.1)", () => {
  it("conforming: h1 → h2 → h3", () => {
    expect(findOf(`<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2>`, "heading-order-skip")).toHaveLength(0);
  });
  it("non-conforming: h2 → h4 skips h3", () => {
    const f = findOf(`<h2>A</h2><h4>B</h4>`, "heading-order-skip");
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("1.3.1");
  });
  // Headings in mutually-exclusive JSX conditional arms are NOT both rendered, so the
  // engine must not compare their levels across the branch boundary (egapro FP).
  it("does not flag a skip across mutually-exclusive ternary branches (JSX)", () => {
    const src = `<div>{j ? <h2>A</h2> : <h1>B</h1>}{j ? <h3>C</h3> : <h2>D</h2>}</div>`;
    expect(findOf(src, "heading-order-skip", "t.tsx")).toHaveLength(0);
  });
  it("still flags a real skip WITHIN a single branch (JSX)", () => {
    const src = `<div>{j ? (<><h2>A</h2><h4>B</h4></>) : null}</div>`;
    expect(findOf(src, "heading-order-skip", "t.tsx")).toHaveLength(1);
  });
  it("still flags a skip in static top-level JSX", () => {
    expect(findOf(`<div><h2>A</h2><h4>B</h4></div>`, "heading-order-skip", "t.tsx")).toHaveLength(1);
  });
  // A child component rendered between two headings may itself render an intermediate
  // heading (invisible to source) — so a "skip" across it is not a definite violation.
  it("does not flag a skip when a component sits between the headings (JSX)", () => {
    expect(findOf(`<div><h1>A</h1><StepIndicator /><h3>B</h3></div>`, "heading-order-skip", "t.tsx")).toHaveLength(0);
  });
  it("still flags a skip when only intrinsic siblings sit between the headings", () => {
    expect(findOf(`<div><h2>A</h2><p>x</p><h4>B</h4></div>`, "heading-order-skip", "t.tsx")).toHaveLength(1);
  });
});

describe("h1-missing — framework shell templates", () => {
  it("does not assert on a SPA mount shell (empty #app)", () => {
    const src = `<!doctype html><html lang="en"><head><title>X</title></head><body><div id="app"></div><script src="/m.js"></script></body></html>`;
    expect(findOf(src, "h1-missing")).toHaveLength(0);
  });
  it("does not assert on a SvelteKit shell with %sveltekit.body%", () => {
    const src = `<!doctype html><html lang="en"><head><title>X</title></head><body><div>%sveltekit.body%</div></body></html>`;
    expect(findOf(src, "h1-missing")).toHaveLength(0);
  });
  it("still asserts on a real content page with no h1 (unchanged)", () => {
    expect(findOf(page("<main><p>x</p></main>"), "h1-missing")).toHaveLength(1);
  });
});

// #106 — egapro's CompliancePathOptions: a component returns a fragment of <li>s that its
// caller places inside <ul>{children}</ul>. The fragment at the ROOT of a returned expression
// has no parent in this file.
describe("list-structure — a fragment of <li>s returned to the caller (#106)", () => {
  it("does not report the items of a component that returns a fragment", () => {
    const src = `function Items() { return (<><li>Informer le CSE</li><li>Transmettre l'avis</li></>); }
      function List({ children }) { return (<div><p>Obligations</p><ul>{children}</ul></div>); }
      export function Page() { return <List><Items /></List>; }`;
    expect(findOf(src, "list-structure", "Options.tsx")).toHaveLength(0);
  });
  it("still reports a <li> under a fragment nested inside a known non-list element", () => {
    expect(findOf(`export function F() { return (<div><><li>a</li></></div>); }`, "list-structure", "F.tsx")).toHaveLength(1);
    expect(findOf(`export function F() { return (<div><li>a</li></div>); }`, "list-structure", "F.tsx")).toHaveLength(1);
  });
});

describe("list-structure — slotted <li> (SFC named slots / component children)", () => {
  it("does not flag a <li> inside a <template> slot definition", () => {
    expect(findOf(`<template><li>a</li></template>`, "list-structure", "C.vue")).toHaveLength(0);
  });
  it("does not flag a <li> inside a component subtree (slotted into a parent <ul>)", () => {
    expect(findOf(`<MenuList><li>a</li></MenuList>`, "list-structure", "C.vue")).toHaveLength(0);
  });
  it("still flags a genuinely orphaned <li> in plain HTML", () => {
    expect(findOf(`<section><li>x</li></section>`, "list-structure")).toHaveLength(1);
  });
});

describe("h1-missing (9.1)", () => {
  it("conforming: page has an h1", () => {
    expect(findOf(page("<h1>Titre</h1><p>x</p>"), "h1-missing")).toHaveLength(0);
  });
  it("non-conforming: page without h1", () => {
    expect(findOf(page("<h2>Sous-titre</h2>"), "h1-missing")).toHaveLength(1);
  });
  it("does not fire on a fragment", () => {
    expect(findOf(`<section><h2>x</h2></section>`, "h1-missing")).toHaveLength(0);
  });
});

describe("h1-multiple (9.1)", () => {
  it("conforming: a single h1", () => {
    expect(findOf(page("<h1>A</h1>"), "h1-multiple")).toHaveLength(0);
  });
  it("non-conforming: two h1 reports the extra", () => {
    const f = findOf(page("<h1>A</h1><h1>B</h1>"), "h1-multiple");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("mineur");
  });
});

// h1-missing / h1-multiple are ADVISORY (non-normative recommendations): they fire, but
// carry `advisory: true` so they can never flip a criterion to NC. Heading HIERARCHY
// (heading-order-skip) stays normative.
describe("h1 rules are advisory (non-normative)", () => {
  it("h1-missing carries advisory: true", () => {
    const f = findOf(page("<h2>Sub</h2>"), "h1-missing");
    expect(f).toHaveLength(1);
    expect(f[0]!.advisory).toBe(true);
  });
  it("h1-multiple carries advisory: true", () => {
    const f = findOf(page("<h1>A</h1><h1>B</h1>"), "h1-multiple");
    expect(f).toHaveLength(1);
    expect(f[0]!.advisory).toBe(true);
  });
  it("heading-order-skip stays NORMATIVE (no advisory flag)", () => {
    const f = findOf(`<h2>A</h2><h4>B</h4>`, "heading-order-skip");
    expect(f).toHaveLength(1);
    expect(f[0]!.advisory).toBeUndefined();
  });
});

describe("list-structure (9.3)", () => {
  it("conforming: ul of li", () => {
    expect(findOf(`<ul><li>a</li><li>b</li></ul>`, "list-structure")).toHaveLength(0);
  });
  it("non-conforming: a div directly inside a ul", () => {
    const f = findOf(`<ul><div>a</div></ul>`, "list-structure");
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("1.3.1");
  });
  it("non-conforming: an li outside any list", () => {
    expect(findOf(`<section><li>x</li></section>`, "list-structure")).toHaveLength(1);
  });
  // A PascalCase component child of a list may render an <li> (invisible to source
  // analysis) — asserting a definite NC there is a false positive (egapro: <ul>{items
  // .map(i => <HistoryEntry/>)}</ul>, HistoryEntry renders <li>).
  it("does not flag a component child of <ul> (may render <li>)", () => {
    expect(findOf(`<ul>{items.map((i) => <Row key={i} />)}</ul>`, "list-structure", "t.tsx")).toHaveLength(0);
  });
  it("still flags an intrinsic non-li child in JSX", () => {
    expect(findOf(`<ul><div>x</div></ul>`, "list-structure", "t.tsx")).toHaveLength(1);
  });
  it("does not flag a <slot> child of <ul> (slotted list items)", () => {
    expect(findOf(`<ul><li>a</li><slot></slot></ul>`, "list-structure")).toHaveLength(0);
  });
});

describe("h1-missing — component-composed pages (JSX)", () => {
  // A Next.js root layout renders {children}; the <h1> is supplied by the page. A
  // child component can also render the h1. The static parse can't see through either,
  // so 1.3.1 must stay a residual risk, never a false NC.
  it("does not assert when the body content is injected via {children}", () => {
    expect(findOf(`<html lang="fr"><head><title>T</title></head><body>{children}</body></html>`, "h1-missing", "t.tsx")).toHaveLength(0);
  });
  it("does not assert when the body renders a child component", () => {
    expect(findOf(`<html lang="fr"><head><title>T</title></head><body><ErrorPage /></body></html>`, "h1-missing", "t.tsx")).toHaveLength(0);
  });
  it("still asserts on a fully static JSX page with no h1", () => {
    expect(findOf(`<html lang="fr"><head><title>T</title></head><body><div>static</div></body></html>`, "h1-missing", "t.tsx")).toHaveLength(1);
  });
  it("still asserts on a static HTML page with no h1 (unchanged)", () => {
    expect(findOf(page("<h2>Sous-titre</h2>"), "h1-missing")).toHaveLength(1);
  });
});
