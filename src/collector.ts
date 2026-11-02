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

/** THE LOADING MARKERS — what says « this page is not there yet ».
 *
 *  egapro's `admin-declaration-detail` was recorded while it displayed « Chargement... »: the
 *  data had not arrived, the capture held a header, a footer and one paragraph, and it counted
 *  as an audited page all the same. Nothing about that snapshot looks wrong, which is what makes
 *  it costly — every criterion about the missing content reads as silence.
 *
 *  So the page is asked, in the browser, whether it is still loading:
 *  • `aria-busy="true"` on a rendered element — the one marker the platform defines;
 *  • an indeterminate progress bar (`role=progressbar` with no `aria-valuenow`, `<progress>`
 *    with no `value`) — a spinner, by its own declaration;
 *  • a rendered element whose WHOLE text is a loading phrase (« Chargement… », « Chargement en
 *    cours », « Veuillez patienter », « Loading… », « Please wait »). The whole text and the
 *    innermost element only: a sentence that merely contains the word is content.
 *  Returns the markers found, each named after its element; empty when the page is ready.
 *  Bounded to ten — the point is made long before. */
export const LOADING_STATE = `(() => {
  const out = [];
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return false;
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };
  const name = (e) => e.localName + (e.id ? '#' + e.id : '');
  for (const e of Array.from(document.querySelectorAll('[aria-busy="true"]'))) if (shown(e)) out.push('aria-busy="true" ' + name(e));
  for (const e of Array.from(document.querySelectorAll('[role="progressbar"]:not([aria-valuenow]), progress:not([value])'))) if (shown(e)) out.push('indeterminate progress ' + name(e));
  const PHRASE = /^(chargement( en cours)?|veuillez patienter|loading|please wait)\\s*(\\.{1,3}|…)?$/i;
  const text = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
  if (document.body) for (const e of Array.from(document.body.querySelectorAll('p,span,div,li,h1,h2,h3,h4,h5,h6,strong,em,output,[role="status"]'))) {
    const t = text(e);
    if (t.length > 40 || !PHRASE.test(t)) continue;
    if (Array.from(e.children).some((c) => PHRASE.test(text(c)))) continue;
    if (shown(e)) out.push('text "' + t + '" ' + name(e));
  }
  return out.slice(0, 10);
})()`;

/** Wait, BOUNDED, for the page to stop declaring itself busy (see LOADING_STATE).
 *
 *  Polled from the caller's side so it works on any page object that can evaluate a string —
 *  Playwright's, or a home-made harness — and never longer than `timeoutMs`: a page that stays
 *  busy is recorded anyway, with the markers it still carried, and marked as such. A capture
 *  that never happens is a missing page; a capture marked « loading » is a page the report can
 *  be honest about. `timeoutMs: 0` checks once and does not wait. */
export async function waitForLoaded(
  page: { evaluate(script: string): Promise<unknown> },
  timeoutMs: number,
  intervalMs = 150,
): Promise<{ markers: string[]; waitedMs: number }> {
  const started = Date.now();
  for (;;) {
    let markers: string[] = [];
    try {
      const r = await page.evaluate(LOADING_STATE);
      markers = Array.isArray(r) ? r.filter((m): m is string => typeof m === "string") : [];
    } catch {
      // A page that cannot answer is not known to be loading; the capture goes ahead as before.
      return { markers: [], waitedMs: Date.now() - started };
    }
    const waitedMs = Date.now() - started;
    if (!markers.length || waitedMs >= timeoutMs) return { markers, waitedMs };
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, timeoutMs - waitedMs))));
  }
}

/** How long a producer waits, by default, for a page to stop declaring itself loading. */
export const LOADING_TIMEOUT_MS = 10_000;

/** The tallest full-page screenshot taken, in CSS pixels. A whole page is what a reviewer
 *  judges, but an infinite feed would otherwise produce an image nobody can open. */
export const FULL_SCREENSHOT_MAX_HEIGHT = 8000;

// Browser-context source, evaluated as a STRING (the engine's tsconfig ships no DOM lib —
// see src/scan-local.ts). Registered in probeSources() so a typo fails CI instead of being
// swallowed at run time. Returns { dom, styles, boxes } for the CURRENT page.
export const COLLECT_SNAPSHOT = `(() => {
  const PROPS = ${JSON.stringify(COLLECTED_CSS)};
  const MAX = ${COLLECT_MAX_ELEMENTS};
  // The ordinal is a JOIN KEY against parseHtml(dom), so the walk must enumerate elements
  // exactly as a reparse of the serialisation below will (#101). querySelectorAll('*') did not:
  //  - an element appended INSIDE a raw-text element (Next's dev overlay puts <nextjs-portal>
  //    in a <script>) is serialised as that element's raw text, and a reparse reads text —
  //    one ordinal too many, and every digest refused from there on;
  //  - <template> contents are serialised and reparsed as elements, but live in
  //    template.content, which querySelectorAll never traverses — one ordinal too few.
  // Pre-order, children of the raw-text elements HTML parsers (htmlparser2 included) treat as
  // text skipped, template.content descended.
  const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes']);
  const els = [];
  const walkElements = (parent) => {
    for (const child of parent.children) {
      els.push(child);
      const name = child.localName;
      if (RAW_TEXT.has(name)) continue;
      // With scripting on, a <noscript>'s content is raw TEXT to the browser, while the reparse
      // reads it as elements (#112). Parse that text with the page's own parser and count what
      // it yields, in place, so every later ordinal still lines up. The inert parsed nodes have
      // no computed style and an empty box, which the rules read as « nothing measured ».
      if (name === 'noscript' && child.children.length === 0 && (child.textContent || '').includes('<')) {
        const parsed = document.createElement('template');
        parsed.innerHTML = child.textContent || '';
        walkElements(parsed.content);
        continue;
      }
      walkElements(name === 'template' && child.content ? child.content : child);
    }
  };
  walkElements(document);
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
  // The cap is on the ORDINARY pool only, and the traversal never stops early.
  //
  // It used to return the moment the pool filled, which abandoned every remaining sheet —
  // and on a design-system app the pool fills long before the end. Measured on a real capture
  // of 38 pages: all 38 came back truncated, so rendered-focus-not-visible declined on every
  // one of them and 2.4.7 could never be decided by any number of scans. The rule was right to
  // decline (a :focus rule might have been among the dropped ones); the collector was wrong to
  // make that unavoidable.
  //
  // So the rules a rendered criterion actually READS — :focus styling, orientation locks,
  // pinned positioning, animation — are kept whatever the pool is doing, and truncated now
  // means "some ordinary rule was dropped", which is a much weaker statement. A rule can then
  // ask for what it needs instead of refusing on a cap that never concerned it.
  const cssRules = [];
  let unreadable = 0;
  let dropped = 0;
  const MAXR = 4000;
  const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const KEEP_SELECTOR = /:focus|:target|:active/i;
  const KEEP_PROP = /^(?:outline|position|animation|transition|transform)/;
  const walk = (list, media) => {
    for (const r of list) {
      if (typeof r.selectorText === 'string' && r.style) {
        const decls = {};
        for (let i = 0; i < r.style.length; i++) {
          const prop = r.style[i];
          decls[camel(prop)] = r.style.getPropertyValue(prop);
        }
        const keep = KEEP_SELECTOR.test(r.selectorText) || Object.keys(decls).some((k) => KEEP_PROP.test(k));
        if (cssRules.length >= MAXR && !keep) { dropped++; continue; }
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
    css: { v: 1, rules: cssRules, unreadable: unreadable, truncated: dropped > 0, dropped: dropped },
    title: document.title,
    // The doctype is NOT part of documentElement.outerHTML, so a capture that records only
    // the DOM drops it — and RGAA 8.1 (is a doctype present, valid, and before <html>?) then
    // has nothing to look at. Recorded as its own field for that reason.
    doctype: document.doctype ? '<!DOCTYPE ' + document.doctype.name + (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : '') + (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : '') + '>' : '',
    lang: document.documentElement.getAttribute('lang') || '',
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    // The document's full height, so the producer knows whether a full-page screenshot adds
    // anything to the viewport one.
    docHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    // Still loading at the instant of collection: the markers, or none. Every producer runs
    // this same collector, so every producer can say so — see LOADING_STATE.
    loading: ${LOADING_STATE},
    styles: { v: 1, entries: styles, truncated: truncated },
    boxes: { v: 1, entries: boxes, truncated: truncated }
  };
})()`;
