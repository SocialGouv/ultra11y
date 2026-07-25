// R5 — RECALL MATRIX. One seeded defect per registered static rule: the engine must
// catch every machine-decidable failure it claims to. This closes the eval gap ("recall
// demonstrated only on bad.html"): the registry has 53 rules, and this asserts each fires
// on a fixture carrying exactly its target defect — no silent recall hole. Also covers the
// WebAIM Million top-6. Rules are exercised directly (parse → runRules) so a fixture needs
// no file I/O; a page-scoped rule gets a full document.
import { describe, it, expect } from "vitest";
import { parseSource } from "../src/parse/source.js";
import { runRules } from "../src/rules/registry.js";
import { ruleIds } from "../src/rules/registry.js";

/** A minimal document that carries the target defect of exactly one rule. */
const SEED: Record<string, string> = {
  // ARIA vocabulary validation (4.1.2 / 1.3.1)
  "invalid-aria-attr": `<main><div role="button" aria-labeledby="x">go</div></main>`,
  "invalid-aria-value": `<main><div role="button" aria-expanded="yes">go</div></main>`,
  "aria-required-attr": `<main><div role="checkbox">Accept</div></main>`,
  "aria-required-parent": `<main><div role="tab">One</div></main>`,
  "aria-prohibited-attr": `<main><p role="paragraph" aria-label="Intro">Text</p></main>`,
  // structure
  "dl-structure": `<main><dt>Term</dt></main>`,
  "headers-attr-dangling": `<main><table><caption>t</caption><tr><th id="a">A</th></tr><tr><td headers="ghost">1</td></tr></table></main>`,
  "th-no-data-cells": `<main><table><caption>t</caption><tr><th id="a">A</th><th id="b">B</th></tr><tr><td headers="a">1</td></tr></table></main>`,
  // forms / authentication / context change
  "autocomplete-token-invalid": `<main><form><label for="ac">Email</label><input id="ac" type="text" autocomplete="e-mail"></form></main>`,
  "credential-entry-blocked": `<main><form><label for="pw">Password</label><input id="pw" type="password" autocomplete="off"></form></main>`,
  "on-input-context-change": `<main><form><label for="ch">Country</label><select id="ch" onchange="this.form.submit()"><option>FR</option></select></form></main>`,
  // 2.5.3 label in name
  "label-in-name-mismatch": `<main><button aria-label="Submit">Send now</button></main>`,
  // images (1.1.1)
  "img-alt-missing": `<main><img src="x.png"></main>`,
  "input-image-alt-missing": `<main><input type="image" src="go.png"></main>`,
  "object-embed-no-name": `<main><object data="chart.svg"></object></main>`,
  "chart-no-accessible-name": `<main><div class="chart"><svg><rect width="10" height="10"/></svg></div></main>`,
  "canvas-fallback-missing": `<main><canvas width="200" height="100"></canvas></main>`,
  "decorative-alt-misuse": `<main><img src="icon.png" alt="" title="Company logo"></main>`,
  // frames (4.1.2)
  "iframe-title-missing": `<main><iframe src="/embed"></iframe></main>`,
  // colours (1.4.3) — literal inline low contrast
  "contrast-literal": `<main><p style="color:#bbbbbb;background:#ffffff">low</p></main>`,
  // multimedia
  "media-no-track": `<main><video src="v.mp4" controls></video></main>`,
  "autoplay-media": `<main><audio src="a.mp3" autoplay></audio></main>`,
  // tables (1.3.1)
  "data-table-no-headers": `<main><table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table></main>`,
  "table-caption-missing": `<main><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></main>`,
  "layout-table-data-markup": `<main><table role="presentation"><tr><th>x</th></tr><tr><td>1</td></tr></table></main>`,
  "sortable-header-no-aria-sort": `<main><table><caption>t</caption><tr><th class="sortable"><button>Name</button></th></tr><tr><td>a</td></tr></table></main>`,
  // links (2.4.4)
  "link-empty-name": `<main><a href="/next"></a></main>`,
  "icon-only-control-unnamed": `<main><a href="/x"><svg><path d="M0 0"/></svg></a></main>`,
  // scripts / ARIA (4.1.2 unless noted)
  "invalid-aria-role": `<main><div role="notarole">x</div></main>`,
  "aria-ref-missing-id": `<main><div aria-labelledby="ghost">x</div></main>`,
  "aria-required-children": `<main><ul role="list"><div>not a listitem</div></ul></main>`,
  "aria-hidden-focusable": `<main><button aria-hidden="true">x</button></main>`,
  "redundant-aria": `<main><button role="button">x</button></main>`,
  "nested-interactive": `<main><button><a href="/">link</a></button></main>`,
  "clickable-noninteractive": `<main><div onclick="go()">click</div></main>`,
  "control-name-title-only": `<main><input type="text" title="Search"></main>`,
  "live-region-conflict": `<main><div aria-live="polite" role="alert">x</div></main>`,
  "status-message-not-assertive": `<main><div aria-live="polite" class="error">x</div></main>`,
  // forms
  "control-label-missing": `<main><form><input type="text" name="q"></form></main>`,
  "label-for-dangling": `<main><form><label for="ghost">Name</label></form></main>`,
  "placeholder-as-label": `<main><form><input type="text" placeholder="Email"></form></main>`,
  "field-purpose-incomplete": `<main><form><label for="em">Email</label><input id="em" type="email" name="email"></form></main>`,
  "form-field-multiple-labels": `<main><form><label for="a">One</label><label for="a">Two</label><input id="a"></form></main>`,
  "fieldset-legend-missing": `<main><form><fieldset><input type="radio" name="r"><input type="radio" name="r"></fieldset></form></main>`,
  "button-empty-name": `<main><button></button></main>`,
  "select-has-option": `<main><form><label for="s">Pick</label><select id="s"></select></form></main>`,
  "disabled-context-content": `<main><form><fieldset disabled><legend>Recap</legend><label for="dc">SIREN</label><input id="dc" type="text" value="1"></fieldset></form></main>`,
  "radio-checkbox-group-ungrouped": `<main><form><label for="r1">A</label><input id="r1" type="radio" name="g"><label for="r2">B</label><input id="r2" type="radio" name="g"></form></main>`,
  "date-fields-ungrouped": `<main><form><label for="d1">Debut</label><input id="d1" type="date"><label for="d2">Fin</label><input id="d2" type="date"></form></main>`,
  "error-not-associated": `<main><form><label for="e">Email</label><input id="e" aria-invalid="true"><p class="error-message" id="e-error">Bad email</p></form></main>`,
  "aria-invalid-no-description": `<main><form><label for="e2">Email</label><input id="e2" aria-invalid="true"></form></main>`,
  // structure (1.3.1)
  "list-structure": `<main><ul><span>not an li</span></ul></main>`,
  "empty-heading": `<main><h2></h2></main>`,
  "table-empty-data-cell": `<main><table><caption>Résultats</caption><tr><th>A</th><th>B</th></tr><tr><td>1</td><td></td></tr></table></main>`,
  "css-generated-content-informative": `<main><style>.badge::after{content:"Nouveau"}</style><p>x</p></main>`,
  // navigation
  "positive-tabindex": `<main><button tabindex="3">x</button></main>`,
  "inline-lang-change-missing": `<main><p lang="">Bonjour</p></main>`,
};

/** Full-document seeds (page-scoped rules need a complete <html> to fire). */
const PAGE_SEED: Record<string, string> = {
  "html-lang-missing": `<!doctype html><html><head><title>t</title></head><body><main>x</main></body></html>`,
  "lang-invalid": `<!doctype html><html lang="english"><head><title>t</title></head><body><main>x</main></body></html>`,
  "title-missing-empty": `<!doctype html><html lang="en"><head><title></title></head><body><main>x</main></body></html>`,
  "skip-link-target-missing": `<!doctype html><html lang="en"><head><title>t</title></head><body><a href="#gone">Skip</a><div>content, no #gone target</div></body></html>`,
  "h1-missing": `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h2>Sub</h2></main></body></html>`,
  "h1-multiple": `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>A</h1><h1>B</h1></main></body></html>`,
  "heading-order-skip": `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>A</h1><h4>Deep</h4></main></body></html>`,
  "missing-main-landmark": `<!doctype html><html lang="en"><head><title>t</title></head><body><h1>A</h1><p>no main</p></body></html>`,
  "multiple-main-landmark": `<!doctype html><html lang="en"><head><title>t</title></head><body><main>a</main><main>b</main></body></html>`,
  "nav-landmark-missing": `<!doctype html><html lang="en"><head><title>t</title></head><body><header><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="/d">D</a></header><main><h1>x</h1></main></body></html>`,
  "nav-landmark-unnamed": `<!doctype html><html lang="en"><head><title>t</title></head><body><nav aria-label="main"><a href="/a">A</a></nav><nav><a href="/b">B</a></nav><main><h1>x</h1></main></body></html>`,
  "duplicate-id": `<!doctype html><html lang="en"><head><title>t</title></head><body><main><p id="dup">a</p><p id="dup">b</p></main></body></html>`,
  "meta-refresh-redirect": `<!doctype html><html lang="en"><head><title>t</title><meta http-equiv="refresh" content="5;url=/next"></head><body><main>x</main></body></html>`,
  "meta-viewport-zoom-block": `<!doctype html><html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width, user-scalable=no"></head><body><main>x</main></body></html>`,
  "blink-marquee": `<!doctype html><html lang="en"><head><title>t</title></head><body><main><marquee>scrolling</marquee></main></body></html>`,
};

const CROSS = new Set(ruleIds().filter((id) => id.startsWith("cross-")));
const fires = (ruleId: string, html: string): boolean => runRules(parseSource(html, `${ruleId}.html`)).some((f) => f.ruleId === ruleId);

describe("recall matrix — every registered static rule catches its seeded defect", () => {
  const registered = ruleIds().filter((id) => !CROSS.has(id));

  it("seeds a defect fixture for every registered (non-cross) rule — no silent coverage gap", () => {
    const seeded = new Set([...Object.keys(SEED), ...Object.keys(PAGE_SEED)]);
    const missing = registered.filter((id) => !seeded.has(id));
    expect(missing, `rules with no recall fixture: ${missing.join(", ")}`).toEqual([]);
  });

  for (const [ruleId, html] of Object.entries(SEED)) {
    it(`catches ${ruleId}`, () => expect(fires(ruleId, html), `${ruleId} did not fire on its seed`).toBe(true));
  }
  for (const [ruleId, html] of Object.entries(PAGE_SEED)) {
    it(`catches ${ruleId} (page-scoped)`, () => expect(fires(ruleId, html), `${ruleId} did not fire on its seed`).toBe(true));
  }
});

describe("recall — WebAIM Million top-6 (the failures that dominate the real web)", () => {
  // low contrast is dynamic-tier (see dynamic.e2e); the other five are static.
  it("missing alt text", () => expect(fires("img-alt-missing", SEED["img-alt-missing"]!)).toBe(true));
  it("missing form labels", () => expect(fires("control-label-missing", SEED["control-label-missing"]!)).toBe(true));
  it("empty links", () => expect(fires("link-empty-name", SEED["link-empty-name"]!)).toBe(true));
  it("empty buttons", () => expect(fires("button-empty-name", SEED["button-empty-name"]!)).toBe(true));
  it("missing document language", () => expect(fires("html-lang-missing", PAGE_SEED["html-lang-missing"]!)).toBe(true));
});
