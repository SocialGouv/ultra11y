// RENDERED RULES — criteria that only a real browser can answer, decided OFFLINE from a page
// snapshot's signals (src/snapshot.ts).
//
// The static engine reads source; `scan` needs a live browser and a served app. These rules
// sit in between: they read the COMPUTED styles, the LAID-OUT boxes and the SCREENSHOT that a
// snapshot recorded, so CI can decide contrast and colour-only affordances with no browser, no
// Docker and no running server — from a committed artefact.
//
// Every rule here is inert without `doc.signals`, so an ordinary source audit is byte-for-byte
// unchanged. And every one of them reports only what it MEASURED: a colour it could not
// resolve, a region the screenshot could not settle, an element past the collector's cap — all
// leave the criterion undecided rather than guessed. That is the whole reason this tier is
// trustworthy: it can say "non-conforming" because it can also say "I don't know".
import { readFileSync } from "node:fs";
import { contrastRatio, parseColor, type RGBA } from "../color.js";
import type { Doc, El } from "../parse/html.js";
import { decodePng, dominantBackground, type Image } from "../pixel.js";
import type { RenderSignals, StyleEntry } from "../types.js";
import type { Rule, RuleFinding } from "./rule.js";

const SKIP_TAGS = new Set(["script", "style", "head", "title", "meta", "noscript", "link", "html", "br", "wbr"]);

/** The style entry for an element, by its document-order index. */
function styleAt(doc: Doc, i: number): StyleEntry | undefined {
  return doc.signals?.styles?.get(i);
}

function hasDirectText(el: El): boolean {
  return el.children.some((c) => c.type === "text" && c.data.trim() !== "");
}

/** Is this element painted at all? An invisible element cannot fail a contrast criterion. */
function invisible(css: Record<string, string>): boolean {
  if (css.display === "none" || css.visibility === "hidden") return true;
  const op = Number.parseFloat(css.opacity ?? "1");
  return Number.isFinite(op) && op === 0;
}

/** The effective background behind an element: the nearest ancestor (self included) whose
 *  computed `background-color` is opaque. Returns `undefined` when no ancestor resolves —
 *  typically because the real backdrop is an image or gradient, which the CSSOM cannot
 *  express. That is a genuine "unknown", handed to the pixel pass rather than assumed white. */
function backdropOf(doc: Doc, index: Map<El, number>, el: El): { color: RGBA; fromImage: boolean } | undefined {
  for (let p: El | null = el; p; p = p.parent) {
    const i = index.get(p);
    if (i === undefined) continue;
    const css = styleAt(doc, i)?.css;
    if (!css) continue;
    // A background IMAGE (or gradient) paints over whatever colour is declared, so the colour
    // is not the backdrop. Say so instead of using it.
    const img = css.backgroundImage;
    if (img && img !== "none") return undefined;
    const c = parseColor(css.backgroundColor ?? "");
    if (c && c.a >= 1) return { color: c, fromImage: false };
  }
  return undefined;
}

/** WCAG 1.4.3 large text, from COMPUTED values (no unit guessing needed — the browser already
 *  resolved everything to px). ≥24px, or ≥18.66px when bold. */
function isLargeText(css: Record<string, string>): boolean {
  const px = Number.parseFloat(css.fontSize ?? "");
  if (!Number.isFinite(px)) return false;
  const weight = Number.parseInt(css.fontWeight ?? "400", 10);
  const bold = Number.isFinite(weight) ? weight >= 700 : css.fontWeight === "bold";
  return px >= 24 || (px >= 18.66 && bold);
}

/** Index every element by its position in document order — the join key the signals use. */
function elementIndex(doc: Doc): Map<El, number> {
  const m = new Map<El, number>();
  doc.elements.forEach((el, i) => m.set(el, i));
  return m;
}

// ---- 1.4.3 contrast, from computed styles -------------------------------------------------

const renderedContrast: Rule = {
  id: "rendered-contrast",
  criteria: ["1.4.3"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    if (!doc.signals?.styles) return [];
    const index = elementIndex(doc);
    const out: RuleFinding[] = [];
    for (const [el, i] of index) {
      if (SKIP_TAGS.has(el.tag) || !hasDirectText(el)) continue;
      const css = styleAt(doc, i)?.css;
      if (!css || invisible(css)) continue;
      const fg = parseColor(css.color ?? "");
      if (!fg || fg.a < 1) continue; // translucent text: the composite is the pixel pass's job
      const bd = backdropOf(doc, index, el);
      if (!bd) continue; // unknown backdrop — left to the pixel pass, never assumed
      const ratio = contrastRatio(fg, bd.color);
      const large = isLargeText(css);
      const min = large ? 3 : 4.5;
      if (ratio >= min) continue;
      out.push({
        criteriaId: "1.4.3",
        el,
        msgId: "rendered-contrast",
        params: { ratio: ratio.toFixed(2), min, textSize: large ? "large" : "normal" },
      });
    }
    return out;
  },
};

// ---- 1.4.3 contrast, measured on the screenshot ------------------------------------------

// The pixel pass exists for exactly the case the CSSOM cannot answer: text over a gradient,
// an image, or a translucent stack. It is deliberately conservative — it only reports when
// the region has ONE dominant colour (`dominantBackground` returns null otherwise), because
// contrast against a photo is not a single number and pretending it is would be a fabricated
// finding. Reported as `majeur` like its CSSOM sibling; the region is measured, not guessed.
const renderedContrastPixel: Rule = {
  id: "rendered-contrast-pixel",
  criteria: ["1.4.3"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const shot = doc.signals?.screenshot;
    const boxes = doc.signals?.boxes;
    if (!shot || !boxes || !doc.signals?.styles) return [];
    let img: Image | null = null;
    try {
      img = decodePng(readFileSync(shot));
    } catch {
      return []; // unreadable screenshot — no measurement, no verdict
    }
    if (!img) return [];

    const index = elementIndex(doc);
    const out: RuleFinding[] = [];
    for (const [el, i] of index) {
      if (SKIP_TAGS.has(el.tag) || !hasDirectText(el)) continue;
      const css = styleAt(doc, i)?.css;
      if (!css || invisible(css)) continue;
      // Only where the CSSOM could NOT answer — otherwise renderedContrast already decided,
      // and reporting twice on one element would double-count the same defect.
      if (backdropOf(doc, index, el)) continue;
      const fg = parseColor(css.color ?? "");
      if (!fg || fg.a < 1) continue;
      const box = boxes.get(i);
      if (!box || box.w < 4 || box.h < 4) continue;
      const bg = dominantBackground(img, box);
      if (!bg) continue; // genuinely varied backdrop — not one number, so not our call
      const ratio = contrastRatio(fg, bg);
      const large = isLargeText(css);
      const min = large ? 3 : 4.5;
      if (ratio >= min) continue;
      out.push({
        criteriaId: "1.4.3",
        el,
        msgId: "rendered-contrast-pixel",
        params: { ratio: ratio.toFixed(2), min, textSize: large ? "large" : "normal" },
      });
    }
    return out;
  },
};

// ---- 1.4.1 a link identified by colour alone ----------------------------------------------

/** Does this element carry a non-colour visual affordance? Underline, a border, a background
 *  of its own, or a distinctly heavier weight than its surroundings. */
function hasNonColourAffordance(css: Record<string, string>, parentCss: Record<string, string> | undefined): boolean {
  const deco = css.textDecorationLine ?? "";
  if (deco && deco !== "none") return true;
  if ((css.borderBottomStyle ?? "none") !== "none" && Number.parseFloat(css.borderBottomWidth ?? "0") > 0) return true;
  const bg = parseColor(css.backgroundColor ?? "");
  if (bg && bg.a > 0) return true;
  const w = Number.parseInt(css.fontWeight ?? "400", 10);
  const pw = Number.parseInt(parentCss?.fontWeight ?? "400", 10);
  if (Number.isFinite(w) && Number.isFinite(pw) && w >= pw + 200) return true;
  return false;
}

// WCAG 1.4.1 / RGAA 10.6: a link inside running text must be identifiable without relying on
// colour. The classic failure — a coloured link with `text-decoration: none` in a paragraph —
// is invisible to source analysis (the rule lives in a stylesheet) and to axe-core, but the
// computed styles state it plainly. Restricted to links WITH text INSIDE a text block, which
// is where the criterion applies; a nav or button-styled link is out of scope by construction.
const TEXT_BLOCK = new Set(["p", "li", "dd", "dt", "td", "th", "blockquote", "figcaption", "caption"]);

const renderedLinkColourOnly: Rule = {
  id: "rendered-link-colour-only",
  criteria: ["1.4.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    if (!doc.signals?.styles) return [];
    const index = elementIndex(doc);
    const out: RuleFinding[] = [];
    for (const [el, i] of index) {
      if (el.tag !== "a" || !hasDirectText(el)) continue;
      const parent = el.parent;
      if (!parent || !TEXT_BLOCK.has(parent.tag)) continue; // only links in running text
      const css = styleAt(doc, i)?.css;
      const pi = index.get(parent);
      const parentCss = pi === undefined ? undefined : styleAt(doc, pi)?.css;
      if (!css || !parentCss || invisible(css)) continue;
      if (hasNonColourAffordance(css, parentCss)) continue;
      const linkColor = parseColor(css.color ?? "");
      const textColor = parseColor(parentCss.color ?? "");
      if (!linkColor || !textColor) continue;
      // Same colour as the surrounding text: not a colour-only affordance — it is no
      // affordance at all, which other rules cover. Only report a COLOUR-ONLY distinction.
      const distinct = contrastRatio(linkColor, textColor);
      if (distinct <= 1.02) continue;
      out.push({
        criteriaId: "1.4.1",
        el,
        msgId: "rendered-link-colour-only",
        params: { ratio: distinct.toFixed(2) },
      });
    }
    return out;
  },
};

// ---- 1.4.11 non-text contrast: is a control's BOUNDARY perceivable? ----------------------

// The controls whose boundary 1.4.11 (RGAA 3.3) is about. `input[type=hidden]` is excluded at
// the call site; so is anything the browser is not painting.
const BOUNDED_CONTROLS = new Set(["input", "select", "textarea", "button"]);
const SIDES = ["Top", "Right", "Bottom", "Left"] as const;

/** A visible border side's colour, for each side that is actually drawn. */
function borderColours(css: Record<string, string>): RGBA[] {
  const out: RGBA[] = [];
  for (const s of SIDES) {
    const style = css[`border${s}Style`];
    const width = Number.parseFloat(css[`border${s}Width`] ?? "0");
    if (!style || style === "none" || style === "hidden" || !(width > 0)) continue;
    const c = parseColor(css[`border${s}Color`] ?? "");
    if (c && c.a >= 1) out.push(c);
  }
  return out;
}

// WCAG 1.4.11 asks for 3:1 against ADJACENT colours. A control is distinguishable when its
// FILL contrasts with the surroundings, or when a drawn border contrasts with either side of
// itself. Three independent ways to pass — deliberately generous, because a false
// "non-conforming" here is far more costly than a missed one, and the remaining failures (a
// borderless input on a same-coloured background) are unambiguous.
const renderedNonTextContrast: Rule = {
  id: "rendered-nontext-contrast",
  criteria: ["1.4.11"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    if (!doc.signals?.styles) return [];
    const index = elementIndex(doc);
    const out: RuleFinding[] = [];
    for (const [el, i] of index) {
      if (!BOUNDED_CONTROLS.has(el.tag)) continue;
      const type = (el.attribs.type ?? "").toLowerCase();
      if (el.tag === "input" && (type === "hidden" || type === "image")) continue;
      const css = styleAt(doc, i)?.css;
      if (!css || invisible(css)) continue;
      // A shadow or an outline can BE the boundary, and neither is a colour we can compare
      // simply. Decline rather than guess.
      if (css.boxShadow && css.boxShadow !== "none") continue;
      if ((css.outlineStyle ?? "none") !== "none" && Number.parseFloat(css.outlineWidth ?? "0") > 0) continue;
      // The surrounding background: the nearest opaque ancestor colour, skipping the control.
      const surrounding = el.parent ? backdropOf(doc, index, el.parent) : undefined;
      if (!surrounding) continue; // unknown backdrop — not our call
      const own = parseColor(css.backgroundColor ?? "");
      // A transparent control is filled by whatever is behind it: the surroundings.
      const fill = own && own.a >= 1 ? own : surrounding.color;
      if (contrastRatio(fill, surrounding.color) >= 3) continue; // the fill draws the boundary
      const borders = borderColours(css);
      if (borders.some((b) => contrastRatio(b, surrounding.color) >= 3 || contrastRatio(b, fill) >= 3)) continue;
      // No fill contrast and no contrasting border: nothing marks where the control is.
      out.push({
        criteriaId: "1.4.11",
        el,
        msgId: "rendered-nontext-contrast",
        params: { ratio: contrastRatio(fill, surrounding.color).toFixed(2), control: el.tag },
      });
    }
    return out;
  },
};

// ---- stylesheet-level criteria ------------------------------------------------------------
// Some criteria are properties of the STYLESHEET, not of any element's computed style. They
// are only answerable from `signals.css`, and only when the browser let us read every sheet:
// `unreadable > 0` means a cross-origin stylesheet was opaque to us, so the ABSENCE of a rule
// proves nothing and both rules below decline.

const FOCUS_SEL = /:focus(-visible|-within)?\b/;

/** Does this declaration block remove the focus outline? */
function killsOutline(d: Record<string, string>): boolean {
  const o = (d.outline ?? "").trim();
  if (o === "none" || /^0(px)?( |$)/.test(o) || /\bnone\b/.test(o)) return true;
  if ((d.outlineStyle ?? "") === "none") return true;
  return d.outlineWidth !== undefined && Number.parseFloat(d.outlineWidth) === 0;
}

/** Does it provide SOME visible focus affordance instead? */
function restoresIndicator(d: Record<string, string>): boolean {
  if (d.boxShadow && d.boxShadow !== "none") return true;
  if (d.outlineStyle && d.outlineStyle !== "none" && Number.parseFloat(d.outlineWidth ?? "1") > 0) return true;
  if (d.outline && !killsOutline(d)) return true;
  if (d.textDecorationLine && d.textDecorationLine !== "none") return true;
  for (const k of Object.keys(d)) {
    if (/^border(Top|Right|Bottom|Left)?(Color|Width|Style)?$/.test(k) && d[k] && d[k] !== "none") return true;
    if (/^background(Color|Image)?$/.test(k) && d[k] && d[k] !== "none" && d[k] !== "rgba(0, 0, 0, 0)") return true;
  }
  return d.filter !== undefined || d.transform !== undefined || d.color !== undefined;
}

// 2.4.7 / RGAA 10.7. The classic killer is a reset — `*:focus { outline: none }` — with
// nothing put back. Reported ONLY when no `:focus` rule anywhere in the document restores an
// affordance: a document-wide check, so a targeted `outline:none` that a sibling rule replaces
// is never flagged. That leaves this unable to see a focus style applied by JS or by an
// unreadable sheet — which is exactly why it declines in both cases rather than guessing.
const renderedFocusNotVisible: Rule = {
  id: "rendered-focus-not-visible",
  criteria: ["2.4.7"],
  severity: "majeur",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    const css = doc.signals?.css;
    if (!css || css.unreadable > 0 || css.truncated) return [];
    const focusRules = css.rules.filter((r) => FOCUS_SEL.test(r.selector));
    if (!focusRules.length) return []; // no focus styling at all is a different (manual) question
    if (!focusRules.some((r) => killsOutline(r.decls))) return [];
    if (focusRules.some((r) => restoresIndicator(r.decls))) return [];
    // Only meaningful on a page that has something to focus.
    const anchor = doc.elements.find((e) => ["a", "button", "input", "select", "textarea"].includes(e.tag));
    if (!anchor) return [];
    const killer = focusRules.find((r) => killsOutline(r.decls));
    return [{ criteriaId: "2.4.7", el: doc.elements[0] ?? anchor, msgId: "rendered-focus-not-visible", params: { selector: killer?.selector ?? ":focus" } }];
  },
};

// 1.3.4 / RGAA 13.9. The orientation lock: a media query on `orientation` that rotates the
// whole document a quarter turn, forcing the user back to one orientation. Restricted to
// document-level selectors (html/body/:root/*) and to rotations that are an odd multiple of
// 90° — a decorative element rotated in landscape is legitimate and must not be flagged.
const DOC_SEL = /^\s*(\*|:root|html|body)\s*$/i;

function quarterTurn(transform: string): boolean {
  const m = /rotate[ZY]?\(\s*(-?[\d.]+)deg\s*\)/i.exec(transform);
  if (!m) return false;
  const deg = Math.abs(Number.parseFloat(m[1] as string)) % 180;
  return Math.abs(deg - 90) < 1;
}

const renderedOrientationLock: Rule = {
  id: "rendered-orientation-lock",
  criteria: ["1.3.4"],
  severity: "majeur",
  scope: "page",
  run(doc: Doc): RuleFinding[] {
    const css = doc.signals?.css;
    if (!css || css.unreadable > 0) return [];
    for (const r of css.rules) {
      if (!r.media || !/orientation\s*:/i.test(r.media)) continue;
      if (!r.selector.split(",").some((s) => DOC_SEL.test(s))) continue;
      const t = r.decls.transform ?? "";
      if (!quarterTurn(t)) continue;
      const el = doc.elements[0];
      if (!el) continue;
      return [{ criteriaId: "1.3.4", el, msgId: "rendered-orientation-lock", params: { media: r.media, transform: t } }];
    }
    return [];
  },
};

export const renderedRules: Rule[] = [
  renderedContrast,
  renderedContrastPixel,
  renderedLinkColourOnly,
  renderedNonTextContrast,
  renderedFocusNotVisible,
  renderedOrientationLock,
];

// ---- COVERAGE: which criteria a snapshot actually let this tier measure -------------------
//
// A snapshot's coverage was invisible. `scope.scan.testedScs` is stamped only by
// `mergeDynamic` (the live-browser path), so an audit that ingested 35 recorded pages and
// decided contrast and focus visibility from them still printed "the rendering criteria were
// not tested" — naming criteria it had in fact just measured. A reader who trusts that banner
// goes looking for a browser run that already happened.
//
// Coverage is claimed PER RULE and only when the signals that rule reads are present, because
// the tier's trustworthiness rests on being able to say "I don't know": a snapshot whose style
// digest failed verification, or whose collector truncated, measured nothing and must credit
// nothing. Declared beside the rules, and `tests/rendered-rules.test.ts` asserts every rule has
// an entry, so a new rule cannot silently claim — or silently lose — coverage.
const SIGNALS_REQUIRED: Record<string, (s: RenderSignals) => boolean> = {
  // Computed colours, per element.
  "rendered-contrast": (s) => !!s.styles && !s.truncated,
  "rendered-link-colour-only": (s) => !!s.styles && !s.truncated,
  "rendered-nontext-contrast": (s) => !!s.styles && !s.truncated,
  // The pixel fallback needs the screenshot AND the boxes to sample it by.
  "rendered-contrast-pixel": (s) => !!s.screenshot && !!s.boxes && !s.truncated,
  // These two read the page's own stylesheets, and both decline on an unreadable sheet.
  "rendered-focus-not-visible": (s) => !!s.css && s.css.unreadable === 0 && !s.css.truncated,
  "rendered-orientation-lock": (s) => !!s.css && s.css.unreadable === 0,
};

/** The success criteria this tier measured on a document carrying `signals`. Derived from the
 *  rules themselves, so the list cannot drift from what actually ran. */
export function renderedTestedScs(signals: RenderSignals): string[] {
  const scs = new Set<string>();
  for (const rule of renderedRules) {
    if (SIGNALS_REQUIRED[rule.id]?.(signals)) for (const sc of rule.criteria) scs.add(sc);
  }
  return [...scs].sort();
}

/** Every rule id that declares its signal requirement — for the drift test. */
export const RENDERED_SIGNAL_RULES: readonly string[] = Object.keys(SIGNALS_REQUIRED);
