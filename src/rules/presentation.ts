// Theme 10 — Presentation: the statically-checkable slice of zoom support.
// 10.4 (text legible at 200%) generally needs rendering, but a viewport meta that
// blocks zooming is a DEFINITE failure detectable from the markup alone.
import type { Doc, El } from "../parse/html.js";
import { attr, textContent, ancestors } from "../parse/html.js";
import { isDisplayHidden, visuallyRenderedText } from "../name.js";
import type { Rule, RuleFinding } from "./rule.js";

const metaViewportZoomBlock: Rule = {
  id: "meta-viewport-zoom-block",
  criteria: ["1.4.4"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "meta" || (attr(el, "name") ?? "").toLowerCase() !== "viewport") continue;
      const content = (attr(el, "content") ?? "").toLowerCase();
      const pairs = new Map<string, string>();
      for (const part of content.split(/[,;]/)) {
        const [k, v] = part.split("=").map((s) => s.trim());
        if (k) pairs.set(k, v ?? "");
      }
      const userScalable = pairs.get("user-scalable");
      const maxScale = pairs.get("maximum-scale");
      // Only a real, finite maximum-scale < 2 blocks zoom. An empty (`maximum-scale=`)
      // or malformed value must NOT be treated as 0 (Number("") === 0) and falsely flagged.
      const maxScaleNum = maxScale !== undefined && maxScale.trim() !== "" ? Number(maxScale) : Number.NaN;
      // A maximum-scale of 0 or less is invalid: browsers discard it, so zoom is NOT
      // blocked (`maximum-scale=-1` is a W3C ACT "passed" example).
      const blocked = userScalable === "no" || userScalable === "0" || (Number.isFinite(maxScaleNum) && maxScaleNum > 0 && maxScaleNum < 2);
      if (!blocked) continue;
      out.push({
        criteriaId: "1.4.4",
        el,
        msgId: "meta-viewport-zoom-block",
        params: { blockedBy: userScalable === "no" || userScalable === "0" ? "user-scalable" : "maximum-scale", maxScale: maxScale ?? "" },
      });
    }
    return out;
  },
};

// ADVISORY (10.2-adjacent): CSS generated content that carries informative WORDS
// (`content: "…"`) is invisible to assistive technologies. Recommendation: move the text
// into the DOM. Conservative — only inline <style> text, only quoted values with a run of
// ≥3 letters (skips icon-font glyph escapes, punctuation, counters, quotes, attr()).
const CSS_CONTENT = /content\s*:\s*(["'])((?:\\.|(?!\1).)*)\1/gi;
const INFORMATIVE_WORD = /\p{L}{3,}/u;

const cssGeneratedContentInformative: Rule = {
  id: "css-generated-content-informative",
  criteria: ["1.3.1"],
  severity: "mineur",
  advisory: true,
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "style") continue;
      const css = textContent(el);
      const seen = new Set<string>();
      CSS_CONTENT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CSS_CONTENT.exec(css))) {
        const value = m[2] ?? "";
        if (value.startsWith("\\")) continue; // a glyph escape like "\f001" (icon font) — not text
        if (!INFORMATIVE_WORD.test(value)) continue; // punctuation / symbol / separator only
        if (seen.has(value)) continue;
        seen.add(value);
        out.push({ criteriaId: "1.3.1", el, msgId: "css-generated-content-informative", params: { text: value.slice(0, 40) }, advisory: true });
      }
    }
    return out;
  },
};

type SpacingProperty = "letter-spacing" | "word-spacing" | "line-height";

const INPUTS_WITHOUT_TEXT = new Set(["hidden", "checkbox", "radio", "range", "color", "file", "image", "button"]);
function hasRelevantText(el: El): boolean {
  if (visuallyRenderedText(el)) return true;
  // Text-like inputs may be empty in source and receive user text at runtime; submit/reset
  // controls also expose a user-agent label. Spacing restrictions apply to that text.
  if (el.tag === "input") return !INPUTS_WITHOUT_TEXT.has((attr(el, "type") ?? "text").trim().toLowerCase());
  if (el.tag === "textarea") return true;
  return false;
}

/** A narrow but decisive form of the ACT text-spacing rules. An author-important value below
 * the RGAA threshold prevents the user's required override. Values that need computed font
 * size (`px`, `rem`, `calc`) stay for the rendered probe rather than being guessed here. */
function spacingImportantRule(id: string, property: SpacingProperty, minimum: number): Rule {
  return {
    id,
    criteria: ["1.4.12"],
    severity: "majeur",
    run(doc: Doc): RuleFinding[] {
      const out: RuleFinding[] = [];
      const escaped = property.replace("-", "\\-");
      const declaration = new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;!]+)\\s*!important(?=\\s*;|$)`, "gi");
      for (const el of doc.elements) {
        if (["script", "style", "svg", "canvas", "video", "img"].includes(el.tag) || isDisplayHidden(el)) continue;
        // Text-spacing only applies to passages of text. A declaration on an empty layout
        // wrapper, media-only node, or hidden/aria-hidden decoration cannot itself prove a
        // failure; a visible descendant makes the inherited restriction relevant again.
        if (!hasRelevantText(el)) continue;
        const style = attr(el, "style") ?? "";
        // Visually-hidden/off-canvas text and a scroll container cannot lose visible text
        // through spacing. These are ACT inapplicable cases, not conforming exceptions.
        const chainStyles = [el, ...ancestors(el)].map((node) => (attr(node, "style") ?? "").toLowerCase());
        if (chainStyles.some((value) => /(?:^|;)\s*(?:left|right|top|bottom)\s*:\s*-\d+(?:px|em|rem)/.test(value))) continue;
        if (chainStyles.some((value) => /(?:^|;)\s*overflow(?:-[xy])?\s*:\s*(?:auto|scroll)/.test(value))) continue;
        declaration.lastIndex = 0;
        let match: RegExpExecArray | null;
        let raw = "";
        while ((match = declaration.exec(style))) raw = (match[1] ?? "").trim().toLowerCase();
        if (!raw) continue;
        let value: number | undefined;
        if (raw === "normal" || raw === "initial") value = property === "line-height" ? 1.2 : 0;
        else if (/^-?(?:\d+|\d*\.\d+)em$/.test(raw)) value = Number.parseFloat(raw);
        else if (property === "line-height" && /^-?(?:\d+|\d*\.\d+)$/.test(raw)) value = Number.parseFloat(raw);
        else if (/^0(?:[a-z%]+)?$/.test(raw)) value = 0;
        if (value === undefined || value >= minimum) continue;
        out.push({ criteriaId: "1.4.12", el, msgId: "text-spacing-important", params: { property, value: raw, minimum } });
      }
      return out;
    },
  };
}

const letterSpacingImportant = spacingImportantRule("letter-spacing-important", "letter-spacing", 0.12);
const wordSpacingImportant = spacingImportantRule("word-spacing-important", "word-spacing", 0.16);
const lineHeightImportant = spacingImportantRule("line-height-important", "line-height", 1.5);

// ---- RGAA 10.1 — presentational markup ---------------------------------------------------
//
// « Dans le site web, des feuilles de styles sont-elles utilisées pour contrôler la
// présentation de l'information ? » Its three tests are all of the form « these things must be
// ABSENT », over lists the standard itself closes: the RGAA glossary entry « Présentation de
// l'information » names the forbidden elements and attributes outright, and it is vendored in
// this repository. So the criterion is markup and mechanical, and it had no instrument at all
// — it inherited the `readingOrder` subject through WCAG 1.3.2, which answers a different
// question, and therefore arrived at the adjudicator with an EMPTY harvest. Measured on run
// 32508717451 (Sonnet, RGAA, three passes): the model ruled `C` on it three times, the gate
// refused all three for citing nothing, and 10.1 was the single criterion of the 106 left « à
// évaluer » on every page.
//
// ADVISORY FOR WCAG, NORMATIVE FOR RGAA. `<center>` is obsolete HTML, not a WCAG failure:
// nothing about it breaks assistive technology, and WCAG's own F2 is about conveying meaning
// through presentation, which a centred div does not do. So these findings ship as
// RECOMMENDATIONS on 1.3.1 and the RGAA pack re-normativizes them through `overrides` — the
// documented mechanism for exactly this divergence (src/standards/types.ts PackOverride).
//
// INTRINSIC HTML ONLY. `<Button size="sm" color="red" width={200}>` is ordinary component API,
// not presentational abuse, and this engine reads JSX and single-file-component templates
// where the tag case is preserved for components. A tag carrying an uppercase letter is a
// component; a tag carrying a hyphen is a custom element with its own attribute contract.
// Neither is HTML, and neither is this rule's business.
const PRESENTATIONAL_TAGS = new Set(["basefont", "big", "blink", "center", "font", "marquee", "s", "strike", "tt"]);

// `u` is deliberately absent. The RGAA forbids it ONLY when the doctype is not HTML 5, and it
// is conforming HTML5 (an unarticulated annotation — a proper name in Chinese, a misspelling).
// Flagging it wholesale would manufacture a non-conformity on conforming markup.

const PRESENTATIONAL_ATTRS = new Set([
  "align",
  "alink",
  "background",
  "bgcolor",
  "border",
  "cellpadding",
  "cellspacing",
  "char",
  "charoff",
  "clear",
  "compact",
  "color",
  "frameborder",
  "hspace",
  "link",
  "marginheight",
  "marginwidth",
  "text",
  "valign",
  "vlink",
  "vspace",
]);

// The glossary's two notes, which are conditional rather than absolute.
//
// `width`/`height` are forbidden « on elements other than <img>, <object>, <embed>, <canvas>
// and <svg> ». That list is RGAA 4.1.2's and it predates nothing — `<video width>`,
// `<iframe width>`, `<source width>` and `<input type=image width>` are all CONFORMING HTML5
// content attributes, and flagging them would red-flag ordinary accessible markup. They are
// allowed here. The widening can only ever under-report, never invent a non-conformity, and it
// is stated so a stricter auditor can narrow it back to the glossary's five.
const DIMENSION_OK = new Set(["img", "object", "embed", "canvas", "svg", "video", "iframe", "source", "input"]);
// `size` is forbidden « on elements other than <select> ». Stricter than HTML5, which allows
// `<input size>` — and followed anyway, because implementing the standard is the job.
const SIZE_OK = new Set(["select"]);

/** An intrinsic HTML element: lowercase and unhyphenated. A component (PascalCase in JSX and
 *  in SFC templates) or a custom element (`<my-widget>`) owns its own attribute contract. */
function intrinsic(el: El): boolean {
  return el.tag === el.tag.toLowerCase() && !el.tag.includes("-");
}

/** Inside an <svg>? SVG's presentation attributes — `color`, `width`, `height` on geometry —
 *  are the language's own, not obsolete HTML. */
function inSvg(el: El): boolean {
  for (let p: El | null = el; p; p = p.parent) if (p.tag === "svg") return true;
  return false;
}

const presentationalElement: Rule = {
  id: "presentational-element",
  criteria: ["1.3.1"],
  severity: "majeur",
  advisory: true,
  run(doc: Doc): RuleFinding[] {
    return doc.elements
      .filter((el) => intrinsic(el) && PRESENTATIONAL_TAGS.has(el.tag))
      .map((el) => ({ criteriaId: "1.3.1", el, msgId: "presentational-element", params: { tag: el.tag } }));
  },
};

const presentationalAttribute: Rule = {
  id: "presentational-attribute",
  criteria: ["1.3.1"],
  severity: "majeur",
  advisory: true,
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!intrinsic(el) || inSvg(el)) continue;
      for (const name of Object.keys(el.attribs)) {
        const n = name.toLowerCase();
        const hit = PRESENTATIONAL_ATTRS.has(n) || ((n === "width" || n === "height") && !DIMENSION_OK.has(el.tag)) || (n === "size" && !SIZE_OK.has(el.tag));
        if (!hit) continue;
        out.push({ criteriaId: "1.3.1", el, msgId: "presentational-attribute", params: { attr: n, tag: el.tag } });
        break; // one finding per element: the remediation is the same for all of them
      }
    }
    return out;
  },
};

// Test 10.1.3 — spaces standing in for CSS. Two patterns, both distinctive enough that their
// silence is worth something and their firing is not a guess:
//
//   • a word spelled out one letter at a time (« P a r i s »), which a screen reader reads as
//     letters. Five letters minimum: « il y a » and « n y a t » are French, not layout.
//   • three or more consecutive NON-BREAKING spaces. Ordinary spaces collapse in HTML, so an
//     author's indentation inside a paragraph is invisible and harmless — matching on it would
//     fire on well-formatted source everywhere. `&nbsp;` does not collapse: a run of them is
//     someone building a column with the space bar.
//
// DIRECT text only, and never inside the elements where spacing is the content.
// Written as escapes, not as literal characters: a non-breaking space is invisible in a
// diff, and a reviewer must be able to see which space this matches.
const SPELLED_OUT = /(?:\p{L}[ \u00a0]){4,}\p{L}/u;
const NBSP_RUN = /\u00a0{3,}/u;
const SPACING_EXEMPT = new Set(["pre", "code", "kbd", "samp", "textarea", "script", "style", "svg"]);

const presentationalSpacing: Rule = {
  id: "presentational-spacing",
  criteria: ["1.3.1"],
  severity: "majeur",
  advisory: true,
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!intrinsic(el) || SPACING_EXEMPT.has(el.tag) || inSvg(el)) continue;
      const direct = el.children
        .filter((c) => c.type === "text")
        .map((c) => (c as { data: string }).data)
        .join("");
      if (!direct.trim()) continue;
      const how = SPELLED_OUT.test(direct) ? "spelled-out" : NBSP_RUN.test(direct) ? "nbsp-run" : undefined;
      if (!how) continue;
      out.push({ criteriaId: "1.3.1", el, msgId: "presentational-spacing", params: { how, tag: el.tag } });
    }
    return out;
  },
};

/** The RGAA-10.1 rule ids, exported so `scripts/build-pack-rgaa.mjs` wires the SAME list into
 *  the criterion's `appliesTo` and into its normativity overrides. Two hand-kept copies of a
 *  list are two chances for the pack to claim an instrument the engine does not ship. */
export const PRESENTATIONAL_RULE_IDS: readonly string[] = ["presentational-element", "presentational-attribute", "presentational-spacing"];

export const presentationRules: Rule[] = [
  metaViewportZoomBlock,
  cssGeneratedContentInformative,
  letterSpacingImportant,
  wordSpacingImportant,
  lineHeightImportant,
  presentationalElement,
  presentationalAttribute,
  presentationalSpacing,
];
