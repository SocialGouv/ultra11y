// THE BROWSER-SIDE COLLECTOR — a LEAF module: it imports nothing.
//
// That is the whole point. This string is evaluated inside the page by every snapshot
// producer, and two of them ship as published plugins a project imports into its Cypress
// support file. Leaving it in snapshot.ts made those bundles pull parseHtml → htmlparser2 →
// the entire audit engine: 600 KB of Node code shipped to a browser to obtain one string.
// Nothing here may ever import from the engine.
//
// snapshot.ts re-exports all three names, so every existing importer is unaffected.

// The computed declarations the rendered tier consumes. Kept as one list so the collector
// and the rules that read it cannot drift. Extend here when a rendered rule needs a new one.
export const COLLECTED_CSS: readonly string[] = [
  "color",
  "backgroundColor",
  "backgroundImage",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecorationLine",
  "textTransform",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "whiteSpace",
  "display",
  "visibility",
  "opacity",
  "position",
  "overflowX",
  "overflowY",
  "outlineStyle",
  "outlineWidth",
  "outlineColor",
  // All four borders + the box shadow: WCAG 1.4.11 asks whether a control's BOUNDARY is
  // perceivable, and a boundary can be drawn by any side, by the fill, by an outline or by a
  // shadow. Collecting only one side would manufacture non-conformities on the other three.
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "boxShadow",
  "cursor",
];

// Bound on elements measured. A 20k-element page would otherwise write a styles.json far
// larger than the DOM itself. Truncation is RECORDED, never silent.
export const COLLECT_MAX_ELEMENTS = 5000;

// Browser-context source, evaluated as a STRING (the engine's tsconfig ships no DOM lib —
// see src/scan-local.ts). Registered in probeSources() so a typo fails CI instead of being
// swallowed at run time. Returns { dom, styles, boxes } for the CURRENT page.
export const COLLECT_SNAPSHOT = `(() => {
  const PROPS = ${JSON.stringify(COLLECTED_CSS)};
  const MAX = ${COLLECT_MAX_ELEMENTS};
  const els = document.querySelectorAll('*');
  const styles = [];
  const boxes = [];
  const n = Math.min(els.length, MAX);
  for (let i = 0; i < n; i++) {
    const el = els[i];
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    const css = {};
    for (const p of PROPS) {
      const v = cs[p];
      if (v !== undefined && v !== null && v !== '') css[p] = String(v);
    }
    styles.push({ i: i, tag: tag, css: css });
    const r = el.getBoundingClientRect();
    boxes.push({ i: i, tag: tag, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  // The page's own stylesheets. Some criteria are properties of the STYLESHEET rather than of
  // any element's computed style — focus styling removed with no replacement (2.4.7), a media
  // query that locks the orientation (1.3.4) — and this is the only place they exist.
  // A cross-origin sheet throws on .cssRules: COUNT those instead of ignoring them, so a rule
  // reading this digest can tell "nothing there" apart from "I could not look".
  const cssRules = [];
  let unreadable = 0;
  const MAXR = 4000;
  const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const walk = (list, media) => {
    for (const r of list) {
      if (cssRules.length >= MAXR) return;
      if (typeof r.selectorText === 'string' && r.style) {
        const decls = {};
        for (let i = 0; i < r.style.length; i++) {
          const prop = r.style[i];
          decls[camel(prop)] = r.style.getPropertyValue(prop);
        }
        cssRules.push(media ? { selector: r.selectorText, media: media, decls: decls } : { selector: r.selectorText, decls: decls });
      } else if (r.cssRules) {
        const cond = r.conditionText || (r.media && r.media.mediaText) || media;
        walk(r.cssRules, cond);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, undefined);
    } catch (e) {
      unreadable++;
    }
  }

  const truncated = els.length > MAX;
  return {
    dom: document.documentElement.outerHTML,
    css: { v: 1, rules: cssRules, unreadable: unreadable, truncated: cssRules.length >= MAXR },
    title: document.title,
    lang: document.documentElement.getAttribute('lang') || '',
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    styles: { v: 1, entries: styles, truncated: truncated },
    boxes: { v: 1, entries: boxes, truncated: truncated }
  };
})()`;
