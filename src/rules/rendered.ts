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
import type { StyleEntry } from "../types.js";
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

export const renderedRules: Rule[] = [renderedContrast, renderedContrastPixel, renderedLinkColourOnly];
