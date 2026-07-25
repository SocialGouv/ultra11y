// Theme 10 — Presentation: the statically-checkable slice of zoom support.
// 10.4 (text legible at 200%) generally needs rendering, but a viewport meta that
// blocks zooming is a DEFINITE failure detectable from the markup alone.
import type { Doc } from "../parse/html.js";
import { attr, textContent } from "../parse/html.js";
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

export const presentationRules: Rule[] = [metaViewportZoomBlock, cssGeneratedContentInformative];
