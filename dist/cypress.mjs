// src/collector.ts
var COLLECTED_CSS = [
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
  "cursor"
];
var COLLECT_MAX_ELEMENTS = 5e3;
var COLLECT_SNAPSHOT = `(() => {
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
  // any element's computed style \u2014 focus styling removed with no replacement (2.4.7), a media
  // query that locks the orientation (1.3.4) \u2014 and this is the only place they exist.
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

// src/integrations/payload.ts
function slugify(url) {
  let path = url;
  try {
    path = new URL(url).pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
    }
  } catch {
  }
  const slug = path.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || (path === "/" || path === "" ? "accueil" : "page");
}
function buildPayload(collected, url, runner, opts, screenshot) {
  const id = opts.as || slugify(url);
  return {
    meta: {
      v: 1,
      id,
      name: opts.name || collected.title || id,
      url,
      runner,
      viewport: collected.viewport,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...opts.auth !== void 0 ? { auth: opts.auth } : {},
      ...opts.sources ? { sources: opts.sources } : {},
      ...opts.notes ? { notes: opts.notes } : {}
    },
    dom: collected.dom,
    styles: collected.styles,
    boxes: collected.boxes,
    css: collected.css,
    ...screenshot ? { screenshot } : {}
  };
}

// src/integrations/cypress.ts
function registerUltra11yCommand() {
  Cypress.Commands.add("ultra11y", (opts = {}) => {
    const shotName = opts.screenshot === false ? void 0 : `ultra11y-${opts.as || "page"}-${Date.now()}`;
    if (shotName) cy.screenshot(shotName, { capture: "viewport", log: false });
    return cy.window({ log: false }).then((win) => {
      const collected = win.eval(COLLECT_SNAPSHOT);
      const url = collected.url || win.location.href;
      const payload = {
        ...buildPayload(collected, url, "cypress", opts),
        failOn: opts.failOn,
        ...shotName ? { screenshotName: shotName } : {}
      };
      return cy.task("ultra11ySnapshot", payload, { log: false }).then((res) => {
        if (res?.failing?.length) throw new Error(res.message);
        return res;
      });
    });
  });
}
registerUltra11yCommand();
export {
  registerUltra11yCommand,
  slugify
};
