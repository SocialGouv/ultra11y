// Theme 1 — Images.
import type { Doc, El } from "../parse/html.js";
import { attr, hasBoundAttr, boundAttr, hasDynamicSpread, visibleText, ancestors, descendants } from "../parse/html.js";
import { accessibleName, isNameExempt } from "../name.js";
import type { Rule, RuleFinding } from "./rule.js";

// Not exposed to assistive tech (aria-hidden / [hidden] / an inline display:none or
// visibility:hidden, on the element or an ancestor), or explicitly presentational —
// either way there is no accessible name to demand. Shared with the other rule families
// via src/name.ts so the whole engine agrees on what "not exposed" means.
const isHidden = isNameExempt;
// A dynamically-bound name (`:aria-label`, `v-bind:aria-labelledby`) names the element
// even though we cannot resolve its value — treat it as present, not missing.
const named = (el: El): boolean => !!(boundAttr(el, "aria-label") ?? "").trim() || hasBoundAttr(el, "aria-labelledby");

const imgAltMissing: Rule = {
  id: "img-alt-missing",
  criteria: ["1.1.1"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const isImg = el.tag === "img" || el.tag === "area" || (attr(el, "role") ?? "") === "img";
      if (!isImg) continue;
      if (isHidden(el) && el.tag !== "area") continue;
      // alt="" is the decorative opt-out (maps the image to presentation); a whitespace-only
      // alt is NOT — it provides no accessible name yet keeps the image in the a11y tree.
      const altLiteral = attr(el, "alt");
      const whitespaceAlt = altLiteral !== undefined && altLiteral !== "" && altLiteral.trim() === "";
      if ((hasBoundAttr(el, "alt") && !whitespaceAlt) || named(el)) continue; // alt="" / :alt="x" / aria-* → present
      if (hasDynamicSpread(el)) continue; // {...props} / Svelte {alt} shorthand may carry alt
      // role="img" on a non-<img> element (e.g. <svg role="img"><title>…) is named by its
      // <title>/text content, not an alt attribute — accept that accessible name.
      if (el.tag !== "img" && el.tag !== "area" && accessibleName(el, doc).trim() !== "") continue;
      // `title` IS an accname fallback for an image, so 1.1.1 is technically satisfied and
      // asserting a non-conformity would be inventing one. It is still the wrong tool —
      // `title` is hover-only, absent on touch and unevenly announced — so this stays a
      // recommendation to move the text into `alt`, never a normative failure.
      if ((attr(el, "title") ?? "").trim() !== "") {
        out.push({
          criteriaId: "1.1.1",
          el,
          msgId: "img-alt-missing.title-only",
          params: { tag: el.tag },
          advisory: true,
          severity: "mineur",
        });
        continue;
      }
      out.push({
        criteriaId: "1.1.1",
        el,
        msgId: "img-alt-missing",
        params: { tag: el.tag },
      });
    }
    return out;
  },
};

const decorativeAltMisuse: Rule = {
  id: "decorative-alt-misuse",
  criteria: ["1.1.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "img") continue;
      const alt = attr(el, "alt");
      const role = (attr(el, "role") ?? "").trim();
      const ariaLabel = (attr(el, "aria-label") ?? "").trim();
      const title = (attr(el, "title") ?? "").trim();
      if (alt === "" && (ariaLabel || title)) {
        out.push({
          criteriaId: "1.1.1",
          el,
          msgId: "decorative-alt-misuse.empty-but-named",
        });
      } else if (["presentation", "none"].includes(role) && alt?.trim()) {
        out.push({
          criteriaId: "1.1.1",
          el,
          msgId: "decorative-alt-misuse.role-but-alt",
          params: { role },
        });
      }
    }
    return out;
  },
};

const canvasFallbackMissing: Rule = {
  id: "canvas-fallback-missing",
  criteria: ["1.1.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "canvas") continue;
      if (attr(el, "aria-hidden") === "true") continue; // explicitly removed from the a11y tree (named on a role=img wrapper)
      const hasFallback = el.children.some((c) => (c.type === "element" ? true : c.data.trim().length > 0));
      if (hasFallback || named(el) || visibleText(el)) continue;
      out.push({
        criteriaId: "1.1.1",
        el,
        msgId: "canvas-fallback-missing",
      });
    }
    return out;
  },
};

const inputImageAltMissing: Rule = {
  id: "input-image-alt-missing",
  criteria: ["1.1.1"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "input" || (attr(el, "type") ?? "").toLowerCase() !== "image") continue;
      if (isHidden(el)) continue;
      const alt = (boundAttr(el, "alt") ?? "").trim();
      if (alt || named(el) || (attr(el, "title") ?? "").trim()) continue;
      out.push({
        criteriaId: "1.1.1",
        el,
        msgId: "input-image-alt-missing",
      });
    }
    return out;
  },
};

// <object>/<embed> embed non-text content (PDF, Flash-era media, SVG, video) and need an
// accessible name or text fallback, like <img>. (Decorative ones should be aria-hidden.)
const objectEmbedNoName: Rule = {
  id: "object-embed-no-name",
  criteria: ["1.1.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "object" && el.tag !== "embed") continue;
      if (isHidden(el)) continue;
      if (hasDynamicSpread(el)) continue; // a spread may inject aria-label/title
      // named(el) catches a dynamically-bound aria-label / :aria-labelledby / aria-labelledby={x}
      // (present name, value unknown) the same way chart-no-accessible-name does — without it,
      // a bound aria-labelledby re-fired as a false "no name" finding on <object>/<embed>.
      if (named(el) || accessibleName(el, doc).trim() !== "") continue; // aria-label/labelledby, title, or fallback content
      out.push({
        criteriaId: "1.1.1",
        el,
        msgId: "object-embed-no-name",
        params: { tag: el.tag },
      });
    }
    return out;
  },
};

// A charting container (<svg>/<div> of a known charting library) with no accessible
// name — the data visualization carries information with no text alternative
// (WCAG 1.1.1). Distinct from canvas-fallback-missing (which owns <canvas>): charting
// libs (recharts/echarts/chart.js/…) render into <svg>/<div>. Only the OUTERMOST chart
// container is reported (inner chart nodes are skipped), and a class allowlist bounds FP.
// Right boundary (`([-_ ]|$)`) so a generic token matches a WHOLE class token only — else
// `graph` prefix-matches `graphics`/`typography-graphic` (decorative), a false positive.
const CHART_CLASS = /(^|[-_ ])(charts?|graphs?|recharts|highcharts|chart-?js|plotly|nivo|apexcharts|echarts|d3)([-_ ]|$)/i;

const chartNoAccessibleName: Rule = {
  id: "chart-no-accessible-name",
  criteria: ["1.1.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "svg" && el.tag !== "div") continue;
      const cls = attr(el, "class") ?? "";
      if (!CHART_CLASS.test(cls)) continue;
      if (isHidden(el)) continue;
      if (hasDynamicSpread(el)) continue;
      // report only the outermost chart container (skip nested chart nodes)
      if (ancestors(el).some((a) => CHART_CLASS.test(attr(a, "class") ?? ""))) continue;
      if (named(el) || accessibleName(el, doc).trim() !== "") continue; // aria-label/labelledby, <svg><title>, text
      // named by a wrapping <figure><figcaption> or a role=img wrapper
      const fig = ancestors(el).find((a) => a.tag === "figure");
      if (fig && descendants(fig).some((d) => d.tag === "figcaption" && visibleText(d))) continue;
      if (ancestors(el).some((a) => (attr(a, "role") ?? "") === "img" && (named(a) || (attr(a, "aria-label") ?? "").trim()))) continue;
      out.push({
        criteriaId: "1.1.1",
        el,
        msgId: "chart-no-accessible-name",
        params: { tag: el.tag, cls: cls.trim().split(/\s+/)[0] ?? "" },
      });
    }
    return out;
  },
};

export const imagesRules: Rule[] = [imgAltMissing, decorativeAltMisuse, canvasFallbackMissing, inputImageAltMissing, objectEmbedNoName, chartNoAccessibleName];
