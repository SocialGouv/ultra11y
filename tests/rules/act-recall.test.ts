// The rule changes that raised the engine's recall on the W3C ACT corpus
// (tests/act-official.test.ts). Each block pins the failure ACT taught the rule to see AND
// the neighbouring shapes it must keep leaving alone — the corpus is the yardstick, but
// precision on real markup is the contract.
import { describe, it, expect } from "vitest";
import { findOf, page } from "./helpers.js";

/** Normative findings only: an advisory one never flips a criterion. */
const hits = (src: string, ruleId: string, file = "t.html") => findOf(src, ruleId, file).filter((f) => !f.advisory);

describe("presentational-role conflict resolution (img/button/link/iframe names)", () => {
  it("a FOCUSABLE element keeps its role: role=none does not exempt it from a name", () => {
    expect(hits(`<img role="none" tabindex="0" src="a.png">`, "img-alt-missing")).toHaveLength(1);
    expect(hits(`<button role="none"></button>`, "button-empty-name")).toHaveLength(1);
    expect(hits(`<a href="/x" role="none"> </a>`, "link-empty-name")).toHaveLength(1);
    expect(hits(`<iframe src="/f.html" title=" " role="none"></iframe>`, "iframe-title-missing")).toHaveLength(1);
  });
  it("a non-focusable presentational element stays exempt", () => {
    expect(hits(`<img role="none" src="a.png">`, "img-alt-missing")).toHaveLength(0);
    expect(hits(`<button role="none" disabled></button>`, "button-empty-name")).toHaveLength(0);
    expect(hits(`<a role="presentation"></a>`, "link-empty-name")).toHaveLength(0);
  });
  it("a presentational image's alt names nothing — its heading/link is empty", () => {
    expect(hits(`<h1><img src="l.png" alt="ACT rules" role="presentation"></h1>`, "empty-heading")).toHaveLength(1);
    expect(hits(`<h1><img src="l.png" alt="ACT rules"></h1>`, "empty-heading")).toHaveLength(0);
  });
});

describe("aria-labelledby that provably resolves to nothing", () => {
  it("an empty or (in a full HTML page) missing target does not name an image/object", () => {
    expect(hits(`<span id="l"></span><object aria-labelledby="l" data="x.png"></object>`, "object-embed-no-name")).toHaveLength(1);
    expect(hits(`<input type="image" src="s.svg" aria-labelledby="nope">`, "input-image-alt-missing")).toHaveLength(1);
    expect(hits(`<a href="/w"><img src="w.png" aria-labelledby="id1"></a><div id="id1"></div>`, "icon-only-control-unnamed")).toHaveLength(1);
  });
  it("a resolving target still names it", () => {
    expect(hits(`<span id="l">Chart</span><object aria-labelledby="l" data="x.png"></object>`, "object-embed-no-name")).toHaveLength(0);
    expect(hits(`<a href="/w"><img src="w.png" aria-labelledby="id1"></a><div id="id1">WAI</div>`, "icon-only-control-unnamed")).toHaveLength(0);
  });
  it("a component may reference an id another component renders — a MISSING id proves nothing there", () => {
    const jsx = `export const A = () => <input type="image" src="s.svg" aria-labelledby="search-label" />;`;
    expect(hits(jsx, "input-image-alt-missing", "A.tsx")).toHaveLength(0);
  });
});

describe("link-empty-name — image-map areas", () => {
  it("an unnamed <area href> of a map an image uses is an unnamed link", () => {
    expect(
      hits(`<img src="p.jpg" alt="Planets" usemap="#m"><map name="m"><area shape="rect" coords="0,0,8,8" href="sun.htm"></map>`, "link-empty-name"),
    ).toHaveLength(1);
  });
  it("a named area, an area without href, or a map no image uses is left alone", () => {
    expect(hits(`<img src="p.jpg" alt="P" usemap="#m"><map name="m"><area href="sun.htm" alt="Sun"></map>`, "link-empty-name")).toHaveLength(0);
    expect(hits(`<img src="p.jpg" alt="P" usemap="#m"><map name="m"><area shape="rect" coords="0,0,8,8"></map>`, "link-empty-name")).toHaveLength(0);
    expect(hits(`<map name="m"><area href="sun.htm"></map>`, "link-empty-name")).toHaveLength(0);
  });
});

describe("img-alt-missing — SVG graphics roles", () => {
  it("role=img on <svg> is named by a <title>, not by its drawn <text>", () => {
    expect(hits(`<svg role="img"><circle r="4"/><text x="1">1 circle</text></svg>`, "img-alt-missing")).toHaveLength(1);
    expect(hits(`<svg role="img"><title>1 circle</title><circle r="4"/></svg>`, "img-alt-missing")).toHaveLength(0);
  });
  it("graphics-symbol / graphics-document inside SVG need a name too", () => {
    expect(hits(`<svg><circle role="graphics-symbol" r="4"></circle></svg>`, "img-alt-missing")).toHaveLength(1);
    expect(hits(`<svg><circle role="graphics-symbol" r="4" aria-label="1 circle"></circle></svg>`, "img-alt-missing")).toHaveLength(0);
    expect(hits(`<svg><circle role="graphics-object" r="4"></circle></svg>`, "img-alt-missing")).toHaveLength(0);
  });
  it("a role=img <div> keeps its previous reading", () => {
    expect(hits(`<div role="img" aria-label="Chart"></div>`, "img-alt-missing")).toHaveLength(0);
  });
});

describe("title-missing-empty — only the document's own <title>", () => {
  it("an SVG <title> in the body is not a document title", () => {
    const src = `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><main><svg><title>Icone</title></svg><h1>A</h1></main></body></html>`;
    expect(hits(src, "title-missing-empty")).toHaveLength(1);
  });
  it("in plain HTML the FIRST <title> is the document's: an empty one is not rescued by a later one", () => {
    expect(hits(`<!doctype html><html><head><title></title></head><body><title>Page</title></body></html>`, "title-missing-empty")).toHaveLength(1);
    expect(hits(page("<p>x</p>", "<title>Accueil</title>"), "title-missing-empty")).toHaveLength(0);
  });
});

describe("lang-invalid — primary subtag not in the IANA registry", () => {
  it("an unregistered two-letter code, or a three-letter spelling of a two-letter language", () => {
    expect(hits(page("<p>x</p>", "<title>T</title>", ' lang="em-US"'), "lang-invalid")).toHaveLength(1);
    expect(hits(page("<p>x</p>", "<title>T</title>", ' lang="eng"'), "lang-invalid")).toHaveLength(1);
    expect(hits(`<p lang="fre">Bonjour</p>`, "lang-invalid")).toHaveLength(1);
  });
  it("registered codes, unknown-but-plausible three-letter codes and grandfathered tags stay valid", () => {
    for (const lang of ["en", "fr-CA", "EN", "zh-Hant", "sh", "iw", "gsw", "yue", "x-klingon", "i-navajo", "qaa"]) {
      expect(hits(`<span lang="${lang}">x</span>`, "lang-invalid"), lang).toHaveLength(0);
    }
  });
  it("an image's alt is text the lang governs", () => {
    expect(hits(`<div lang="invalid"><img src="f.jpg" alt="Fireworks over Paris"></div>`, "lang-invalid")).toHaveLength(1);
    expect(hits(`<div lang="invalid"><img src="f.jpg" alt=""></div>`, "lang-invalid")).toHaveLength(0);
  });
});

describe("meta-refresh-redirect — an unparseable directive does not claim the page", () => {
  it("the next parseable refresh is the one that runs", () => {
    const src = page("", `<title>T</title><meta http-equiv="refresh" content="0: https://w3.org"><meta http-equiv="refresh" content="5; https://w3.org">`);
    expect(hits(src, "meta-refresh-redirect")).toHaveLength(1);
  });
  it("a parseable first directive still shadows a later one", () => {
    const src = page("", `<title>T</title><meta http-equiv="refresh" content="0; https://w3.org"><meta http-equiv="refresh" content="5; https://w3.org">`);
    expect(hits(src, "meta-refresh-redirect")).toHaveLength(0);
  });
});

describe("meta-viewport-zoom-block / line-height-important", () => {
  it("maximum-scale=yes is 1", () => {
    expect(hits(page("", `<title>T</title><meta name="viewport" content="maximum-scale=yes">`), "meta-viewport-zoom-block")).toHaveLength(1);
  });
  it("a line-height percentage below 150% is definite", () => {
    expect(hits(`<p style="line-height: 120% !important">Some text here</p>`, "line-height-important")).toHaveLength(1);
    expect(hits(`<p style="line-height: 150% !important">Some text here</p>`, "line-height-important")).toHaveLength(0);
    expect(hits(`<p style="line-height: 20px !important">Some text here</p>`, "line-height-important")).toHaveLength(0);
  });
});

describe("ARIA structure", () => {
  it("presentational children: a native <button> owns its children like role=button", () => {
    expect(hits(`<button>Save <span role="button" tabindex="0">▼</span></button>`, "presentational-children-focusable")).toHaveLength(1);
    expect(hits(`<button>Save <span>▼</span></button>`, "presentational-children-focusable")).toHaveLength(0);
  });
  it("aria-hidden-focusable: a <details>' summary is focusable", () => {
    expect(hits(`<details aria-hidden="true"><summary>More</summary><p>x</p></details>`, "aria-hidden-focusable")).toHaveLength(1);
  });
  it("aria-required-attr: an empty required value is no value", () => {
    expect(hits(`<div role="combobox" aria-controls="" aria-expanded="true"></div>`, "aria-required-attr")).toHaveLength(1);
    expect(hits(`<div role="combobox" aria-controls="lb" aria-expanded="true"></div><ul id="lb"></ul>`, "aria-required-attr")).toHaveLength(0);
  });
  it("invalid-aria-value: a required idref naming nothing on the page", () => {
    expect(hits(`<div role="scrollbar" aria-controls="c1" aria-valuenow="2"></div>`, "invalid-aria-value")).toHaveLength(1);
    expect(hits(`<div id="c1"></div><div role="scrollbar" aria-controls="c1 c2" aria-valuenow="2"></div>`, "invalid-aria-value")).toHaveLength(0);
    // a collapsed combobox's popup legitimately does not exist yet
    expect(hits(`<div role="combobox" aria-controls="lb" aria-expanded="false"></div>`, "invalid-aria-value")).toHaveLength(0);
    // a component may render the target elsewhere
    expect(hits(`export const S = () => <div role="scrollbar" aria-controls="c1" aria-valuenow="2" />;`, "invalid-aria-value", "S.tsx")).toHaveLength(0);
  });
  it("aria-required-children: an owned element whose role the container does not allow", () => {
    expect(hits(`<div role="list"><li>1</li><span role="link">2</span></div>`, "aria-required-children")).toHaveLength(1);
    expect(hits(`<div role="grid"><div role="row"><span>Item</span></div></div>`, "aria-required-children")).toHaveLength(1);
    expect(
      hits(
        `<div role="menu"><div role="group"><span role="menuitem">a</span><div role="group"><span role="treeitem">b</span></div></div></div>`,
        "aria-required-children",
      ),
    ).toHaveLength(1);
    expect(hits(`<div role="list" aria-owns="t"></div><div id="t" role="tab">Tab</div>`, "aria-required-children")).toHaveLength(1);
  });
  it("aria-required-children: groups are looked through, separators and unknowns are tolerated", () => {
    expect(
      hits(`<div role="list"><span role="listitem">1</span><div role="group"><span role="listitem">2</span></div></div>`, "aria-required-children"),
    ).toHaveLength(0);
    expect(hits(`<div role="menu"><div role="menuitem">a</div><div role="separator"></div><li role="none"></li></div>`, "aria-required-children")).toHaveLength(
      0,
    );
    expect(hits(`<div role="row"><td>1</td></div>`, "aria-required-children")).toHaveLength(0);
    expect(hits(`<div role="radiogroup"><h3>Size</h3><input type="radio" name="s"></div>`, "aria-required-children")).toHaveLength(0);
    expect(hits(`<div role="list" aria-owns="ghost"><span role="listitem">1</span></div>`, "aria-required-children")).toHaveLength(0);
  });
  it("aria-required-parent: a generic wrapper carrying ARIA attributes owns the item", () => {
    expect(hits(`<div role="list"><div aria-live="polite"><div role="listitem">1</div></div></div>`, "aria-required-parent")).toHaveLength(1);
    expect(hits(`<div role="list"><div class="wrap"><div role="listitem">1</div></div></div>`, "aria-required-parent")).toHaveLength(0);
  });
  it("aria-prohibited-attr: a role-specific property on a role that does not support it", () => {
    expect(hits(`<button aria-sort="">Sort by year</button>`, "aria-prohibited-attr")).toHaveLength(1);
    expect(hits(`<audio src="a.mp3" controls aria-orientation="horizontal"></audio>`, "aria-prohibited-attr")).toHaveLength(1);
    expect(hits(`<button aria-pressed="false">Bold</button>`, "aria-prohibited-attr")).toHaveLength(0);
    expect(hits(`<div role="slider" aria-valuenow="3" aria-orientation="vertical"></div>`, "aria-prohibited-attr")).toHaveLength(0);
    expect(hits(`<th aria-sort="ascending">Year</th>`, "aria-prohibited-attr")).toHaveLength(0);
    // role=none on a focusable button is overridden — not decidable here, never judged
    expect(hits(`<button role="none" aria-pressed="false">x</button>`, "aria-prohibited-attr")).toHaveLength(0);
    // an element whose native role depends on context is never judged
    expect(hits(`<section aria-orientation="vertical">x</section>`, "aria-prohibited-attr")).toHaveLength(0);
  });
});

describe("control-label-missing — custom ARIA fields", () => {
  it("a role=textbox is named by neither its content nor a <label>", () => {
    expect(hits(`<div role="textbox">first name</div>`, "control-label-missing")).toHaveLength(1);
    expect(hits(`<label>first name <div role="textbox"></div></label>`, "control-label-missing")).toHaveLength(1);
    expect(hits(`<label for="f">first name</label><div role="textbox" id="f"></div>`, "control-label-missing")).toHaveLength(1);
  });
  it("aria-label, a resolving aria-labelledby, title, or a hidden field are fine", () => {
    expect(hits(`<div role="textbox" aria-label="first name"></div>`, "control-label-missing")).toHaveLength(0);
    expect(hits(`<span id="n">Name</span><div role="textbox" aria-labelledby="n"></div>`, "control-label-missing")).toHaveLength(0);
    expect(hits(`<div role="combobox" title="Country"></div>`, "control-label-missing")).toHaveLength(0);
    expect(hits(`<div role="textbox" aria-hidden="true"></div>`, "control-label-missing")).toHaveLength(0);
    expect(hits(`<div role="checkbox">I agree</div>`, "control-label-missing")).toHaveLength(0);
  });
});

describe("th-no-data-cells — the simple-grid model", () => {
  it("a column header whose column holds no cell", () => {
    const t = `<table><thead><tr><th>Rate</th><th>Value</th></tr></thead><tbody><tr><td>15%</td></tr></tbody></table>`;
    expect(hits(t, "th-no-data-cells").map((f) => f.snippet)).toEqual([expect.stringContaining("Value")]);
  });
  it("a column whose only cell is explicitly wired elsewhere", () => {
    const t = `<table><tr><th id="c1">Country</th><th id="c2">Z</th></tr><tr><td>Zambia</td><td headers="c1">Zimbabwe</td></tr></table>`;
    expect(hits(t, "th-no-data-cells")).toHaveLength(1);
  });
  it("an ARIA grid column with no gridcell", () => {
    const g = `<div role="grid"><div role="row"><div role="columnheader">Room</div><div role="columnheader">Occupant</div></div><div role="row"><div role="gridcell">1A</div></div></div>`;
    expect(hits(g, "th-no-data-cells")).toHaveLength(1);
  });
  it("leaves alone: a cell referencing the header from another column, spans, row headers, templating", () => {
    expect(
      hits(`<table><tr><th id="a">Cities</th><th id="b">Count</th></tr><tr><td>Paris</td></tr><tr><td headers="b">1</td></tr></table>`, "th-no-data-cells"),
    ).toHaveLength(0);
    expect(hits(`<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">wide</td></tr></table>`, "th-no-data-cells")).toHaveLength(0);
    expect(hits(`<table><tr><th>Name</th><th>Age</th></tr><tr><th>Bob</th><td>3</td></tr></table>`, "th-no-data-cells")).toHaveLength(0);
    expect(hits(`<table><tr><th>A</th><th>B</th></tr><tr><td>{{ a }}</td></tr></table>`, "th-no-data-cells")).toHaveLength(0);
    expect(hits(`<table><tr><th role="cell">A</th><th>B</th></tr><tr><td>1</td></tr></table>`, "th-no-data-cells")).toHaveLength(0);
  });
});

describe("bypass-blocks-missing (2.4.1)", () => {
  const body = (b: string) => page(b, "<title>T</title>", ' lang="en"');
  const NAV = `<nav><ul><li><a href="/1">Chapter 1</a></li><li><a href="/2">Chapter 2</a></li></ul></nav>`;
  const TEXT = `<p>Unity succeeds division and division follows unity, after a long span of time.</p>`;
  it("fires when a nav precedes content and no heading, landmark or skip link exists", () => {
    const f = hits(body(`${NAV}<div id="main">${TEXT}</div>`), "bypass-blocks-missing");
    expect(f).toHaveLength(1);
    expect(f[0]!.criteriaId).toBe("2.4.1");
    // a heading that exists only inside the navigation does not head the content
    expect(hits(body(`<nav><h1>Contents</h1><a href="/1">1</a></nav><div>${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(1);
    // an aria-hidden heading is no heading
    expect(hits(body(`${NAV}<div><h1 aria-hidden="true">Title</h1>${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(1);
  });
  it("any one mechanism silences it", () => {
    expect(hits(body(`${NAV}<main>${TEXT}</main>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`${NAV}<div><h2>Chapter</h2>${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`<div role="heading" aria-level="1">Page</div>${NAV}<div>${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`<a href="#c">Skip</a>${NAV}<div id="c">${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`${NAV}<section aria-label="Article">${TEXT}</section>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`${NAV}<aside>${TEXT}</aside>`), "bypass-blocks-missing")).toHaveLength(0);
    // a control that can hide the navigation
    expect(hits(body(`<button onclick="hide('n')">Hide menu</button>${NAV}<div>${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`<a href="#" onclick="toggle()">Toggle menu</a>${NAV}<div>${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(0);
  });
  it("needs a repeated block marked by a <nav>, and real content after it", () => {
    expect(hits(body(`<div class="menu"><a href="/1">1</a></div><div>${TEXT}</div>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`<div>${TEXT}</div>${NAV}`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`${NAV}<footer>${TEXT}</footer>`), "bypass-blocks-missing")).toHaveLength(0);
    expect(hits(body(`${NAV}<div>© 2026</div>`), "bypass-blocks-missing")).toHaveLength(0);
  });
  it("never on a component or a fragment: the layout supplies what this file lacks", () => {
    expect(hits(`${NAV}<div>${TEXT}</div>`, "bypass-blocks-missing")).toHaveLength(0);
    const jsx = `export default function Page() { return (<html><body><nav><a href="/1">1</a></nav><div><p>Unity succeeds division and division follows unity.</p></div></body></html>); }`;
    expect(hits(jsx, "bypass-blocks-missing", "Page.tsx")).toHaveLength(0);
  });
});

describe("presentational-spacing — a spelled-out word must be a run of LONE letters", () => {
  it("« Il y a à faire » is French, not letter spacing", () => {
    expect(findOf(`<p>Il y a à faire ici.</p>`, "presentational-spacing")).toHaveLength(0);
  });
  it("« P a r i s » still is", () => {
    expect(findOf(`<p>Bienvenue à P a r i s cet été.</p>`, "presentational-spacing")).toHaveLength(1);
  });
});
