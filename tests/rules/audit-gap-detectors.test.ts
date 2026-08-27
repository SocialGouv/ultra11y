import { describe, it, expect } from "vitest";
import { findOf, page } from "./helpers.js";

// Behavioral coverage for the Task-3 detectors born from the official Ara audit gaps.
// Every rule ships fire cases AND precision (non-fire) cases — the whole effort exists
// because the tool over-reported, so a false positive is worse than a miss.

describe("nav-landmark-missing (1.3.1)", () => {
  const HEADER_CLUSTER = `<header><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="/d">D</a></header>`;

  it("fires on a header link cluster with a <main> but no nav landmark", () => {
    const f = findOf(page(`${HEADER_CLUSTER}<main><h1>x</h1></main>`), "nav-landmark-missing");
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("1.3.1");
    expect(f[0]!.selectorHint).toContain("header");
  });

  it("does not fire when a <nav> exists anywhere", () => {
    expect(findOf(page(`<nav><a href="/x">x</a></nav>${HEADER_CLUSTER}<main><h1>x</h1></main>`), "nav-landmark-missing")).toHaveLength(0);
  });

  it("does not fire when a role=navigation exists", () => {
    expect(findOf(page(`<div role="navigation"><a href="/x">x</a></div>${HEADER_CLUSTER}<main><h1>x</h1></main>`), "nav-landmark-missing")).toHaveLength(0);
  });

  it("does not fire below the ≥4-link cluster threshold", () => {
    expect(findOf(page(`<header><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a></header><main><h1>x</h1></main>`), "nav-landmark-missing")).toHaveLength(
      0,
    );
  });

  it("does not fire without a <main> content structure (not a real page)", () => {
    expect(findOf(page(`${HEADER_CLUSTER}<div><h1>x</h1></div>`), "nav-landmark-missing")).toHaveLength(0);
  });

  it("is page-scoped: never fires on a bare fragment", () => {
    expect(findOf(`${HEADER_CLUSTER}<main><h1>x</h1></main>`, "nav-landmark-missing")).toHaveLength(0);
  });
});

describe("nav-landmark-unnamed (1.3.1)", () => {
  it("fires only on the unnamed nav when ≥2 navigation landmarks exist", () => {
    const f = findOf(page(`<nav aria-label="Principal"><a href="/a">A</a></nav><nav><a href="/b">B</a></nav><main>x</main>`), "nav-landmark-unnamed");
    expect(f).toHaveLength(1);
    expect(f[0]!.selectorHint).toContain("nav");
  });

  it("does not fire on a single unnamed nav (nothing to disambiguate)", () => {
    expect(findOf(page(`<nav><a href="/a">A</a></nav><main>x</main>`), "nav-landmark-unnamed")).toHaveLength(0);
  });

  it("does not fire when every nav is named", () => {
    expect(
      findOf(
        page(`<nav aria-label="Principal"><a href="/a">A</a></nav><nav aria-labelledby="h"><a href="/b">B</a></nav><main>x</main>`),
        "nav-landmark-unnamed",
      ),
    ).toHaveLength(0);
  });
});

describe("disabled-context-content (4.1.2)", () => {
  it("fires on a <fieldset disabled> read-only recap wrapping controls", () => {
    const f = findOf(
      `<form><fieldset disabled><legend>Recap</legend><label for="a">A</label><input id="a" value="1"></fieldset></form>`,
      "disabled-context-content",
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("4.1.2");
  });

  it("fires on an [inert] container wrapping form fields", () => {
    expect(findOf(`<div inert><label for="a">A</label><input id="a"></div>`, "disabled-context-content")).toHaveLength(1);
  });

  it("does not fire when aria-busy marks a transient submission state", () => {
    expect(
      findOf(
        `<form aria-busy="true"><fieldset disabled><legend>x</legend><label for="a">A</label><input id="a"></fieldset></form>`,
        "disabled-context-content",
      ),
    ).toHaveLength(0);
  });

  it("does not fire when the group holds a submit control (form locked while posting)", () => {
    expect(
      findOf(
        `<form><fieldset disabled><legend>x</legend><label for="a">A</label><input id="a"><button type="submit">Send</button></fieldset></form>`,
        "disabled-context-content",
      ),
    ).toHaveLength(0);
  });

  it("does not fire on a disabled fieldset with no wrapped controls", () => {
    expect(findOf(`<fieldset disabled><legend>x</legend><p>text only</p></fieldset>`, "disabled-context-content")).toHaveLength(0);
  });
});

describe("radio-checkbox-group-ungrouped (1.3.1 / 3.3.2)", () => {
  it("fires once on ≥2 radios sharing a name with no grouping context", () => {
    const f = findOf(
      `<form><label for="a">A</label><input id="a" type="radio" name="g"><label for="b">B</label><input id="b" type="radio" name="g"></form>`,
      "radio-checkbox-group-ungrouped",
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("1.3.1");
  });

  it("fires on a same-name checkbox cluster", () => {
    expect(
      findOf(
        `<form><label for="a">A</label><input id="a" type="checkbox" name="opts"><label for="b">B</label><input id="b" type="checkbox" name="opts"></form>`,
        "radio-checkbox-group-ungrouped",
      ),
    ).toHaveLength(1);
  });

  it("does not fire when the radios are inside a <fieldset>", () => {
    expect(
      findOf(`<fieldset><legend>g</legend><input type="radio" name="g"><input type="radio" name="g"></fieldset>`, "radio-checkbox-group-ungrouped"),
    ).toHaveLength(0);
  });

  it("does not fire when the radios are inside role=radiogroup", () => {
    expect(
      findOf(`<div role="radiogroup" aria-label="g"><input type="radio" name="g"><input type="radio" name="g"></div>`, "radio-checkbox-group-ungrouped"),
    ).toHaveLength(0);
  });

  it("does not fire on a lone radio, or on radios with different names", () => {
    expect(findOf(`<form><input type="radio" name="g"></form>`, "radio-checkbox-group-ungrouped")).toHaveLength(0);
    expect(findOf(`<form><input type="radio" name="a"><input type="radio" name="b"></form>`, "radio-checkbox-group-ungrouped")).toHaveLength(0);
  });

  it("scopes same-name controls by their form owner", () => {
    expect(
      findOf(`<form id="a"><input type="radio" name="choice"></form><form id="b"><input type="radio" name="choice"></form>`, "radio-checkbox-group-ungrouped"),
    ).toHaveLength(0);
    expect(
      findOf(
        `<form id="a"></form><form id="b"></form><input form="a" type="checkbox" name="choice"><input form="b" type="checkbox" name="choice">`,
        "radio-checkbox-group-ungrouped",
      ),
    ).toHaveLength(0);
  });

  it("still groups controls with the same explicit form owner", () => {
    expect(
      findOf(
        `<form id="survey"></form><input form="survey" type="radio" name="choice"><input form="survey" type="radio" name="choice">`,
        "radio-checkbox-group-ungrouped",
      ),
    ).toHaveLength(1);
  });
});

describe("date-fields-ungrouped (3.3.2)", () => {
  it("fires on ≥2 adjacent native date inputs with no grouping", () => {
    const f = findOf(
      `<form><div><label for="a">Début</label><input id="a" type="date"><label for="b">Fin</label><input id="b" type="date"></div></form>`,
      "date-fields-ungrouped",
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("3.3.2");
  });

  it("fires on a day/month/year lexicon split (fr) without native date types", () => {
    expect(
      findOf(
        `<form><div><label for="j">Jour</label><input id="j"><label for="m">Mois</label><input id="m"><label for="a">Année</label><input id="a"></div></form>`,
        "date-fields-ungrouped",
      ),
    ).toHaveLength(1);
  });

  it("does not fire when the date fields are grouped in a fieldset", () => {
    expect(findOf(`<fieldset><legend>Période</legend><input type="date"><input type="date"></fieldset>`, "date-fields-ungrouped")).toHaveLength(0);
  });

  it("does not fire on a single date field", () => {
    expect(findOf(`<form><label for="a">Date</label><input id="a" type="date"></form>`, "date-fields-ungrouped")).toHaveLength(0);
  });

  it("does not fire when the two dates live in separate parent containers", () => {
    expect(findOf(`<form><div><input type="date"></div><div><input type="date"></div></form>`, "date-fields-ungrouped")).toHaveLength(0);
  });

  it("keeps the lexicon narrow: an unrelated field is not a date field", () => {
    expect(
      findOf(`<form><div><label for="c">Ville</label><input id="c"><label for="d">Code postal</label><input id="d"></div></form>`, "date-fields-ungrouped"),
    ).toHaveLength(0);
  });
});

describe("table-empty-data-cell (1.3.1, advisory)", () => {
  const T = (body: string) => `<table><caption>t</caption><tr><th>A</th><th>B</th></tr>${body}</table>`;

  it("fires as an ADVISORY recommendation on an empty <td>", () => {
    const f = findOf(T(`<tr><td>1</td><td></td></tr>`), "table-empty-data-cell");
    expect(f).toHaveLength(1);
    expect((f[0] as { advisory?: boolean }).advisory).toBe(true);
  });

  it("fires on a lone-dash cell", () => {
    expect(findOf(T(`<tr><td>1</td><td>-</td></tr>`), "table-empty-data-cell")).toHaveLength(1);
  });

  it("does not fire on a populated cell", () => {
    expect(findOf(T(`<tr><td>1</td><td>2</td></tr>`), "table-empty-data-cell")).toHaveLength(0);
  });

  it("does not fire when the cell holds an icon/element", () => {
    expect(findOf(T(`<tr><td>1</td><td><img src="ok.png" alt="oui"></td></tr>`), "table-empty-data-cell")).toHaveLength(0);
  });

  it("does not fire inside a layout table", () => {
    expect(findOf(`<table role="presentation"><tr><td>a</td><td></td></tr></table>`, "table-empty-data-cell")).toHaveLength(0);
  });
});

describe("css-generated-content-informative (1.3.1, advisory)", () => {
  it("fires as an ADVISORY recommendation on informative CSS content", () => {
    const f = findOf(`<style>.badge::after{content:"Nouveau"}</style>`, "css-generated-content-informative");
    expect(f).toHaveLength(1);
    expect((f[0] as { advisory?: boolean }).advisory).toBe(true);
  });

  it("does not fire on an icon-font glyph escape", () => {
    expect(findOf(`<style>.i::before{content:"\\f001"}</style>`, "css-generated-content-informative")).toHaveLength(0);
  });

  it("does not fire on punctuation-only or empty content", () => {
    expect(findOf(`<style>.a::after{content:":"} .b::after{content:""}</style>`, "css-generated-content-informative")).toHaveLength(0);
  });

  it("deduplicates repeated content strings within a stylesheet", () => {
    expect(findOf(`<style>.a::after{content:"Requis"} .b::after{content:"Requis"}</style>`, "css-generated-content-informative")).toHaveLength(1);
  });
});
