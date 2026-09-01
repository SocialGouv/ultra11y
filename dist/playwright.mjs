// src/integrations/playwright.ts
import { readFileSync } from "fs";
import { createRequire as createRequire2 } from "module";
import { join } from "path";

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
  // The cap is on the ORDINARY pool only, and the traversal never stops early.
  //
  // It used to return the moment the pool filled, which abandoned every remaining sheet \u2014
  // and on a design-system app the pool fills long before the end. Measured on a real capture
  // of 38 pages: all 38 came back truncated, so rendered-focus-not-visible declined on every
  // one of them and 2.4.7 could never be decided by any number of scans. The rule was right to
  // decline (a :focus rule might have been among the dropped ones); the collector was wrong to
  // make that unavoidable.
  //
  // So the rules a rendered criterion actually READS \u2014 :focus styling, orientation locks,
  // pinned positioning, animation \u2014 are kept whatever the pool is doing, and truncated now
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
    // the DOM drops it \u2014 and RGAA 8.1 (is a doctype present, valid, and before <html>?) then
    // has nothing to look at. Recorded as its own field for that reason.
    doctype: document.doctype ? '<!DOCTYPE ' + document.doctype.name + (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : '') + (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : '') + '>' : '',
    lang: document.documentElement.getAttribute('lang') || '',
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    styles: { v: 1, entries: styles, truncated: truncated },
    boxes: { v: 1, entries: boxes, truncated: truncated }
  };
})()`;

// src/probes.ts
var PROBES_VERSION = 2;
var PRELUDE = `
const __sel = (e) => {
  if (!e || !e.tagName) return '\u2014';
  const esc = (v) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(v) : String(v).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  const unique = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
  const short = (n) => {
    const t = n.tagName.toLowerCase();
    if (n.id) return t + '#' + esc(n.id);
    const c = typeof n.className === 'string' ? n.className.trim().split(/\\s+/)[0] : '';
    return c ? t + '.' + esc(c) : t;
  };
  const first = short(e);
  if (unique(first)) return first;
  const parts = [];
  for (let n = e; n && n.tagName; n = n.parentElement) {
    let part = short(n);
    if (n.id && unique(part)) { parts.unshift(part); return parts.join(' > '); }
    const parent = n.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((x) => x.tagName === n.tagName);
      if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
    }
    parts.unshift(part);
    const path = parts.join(' > ');
    if (unique(path)) return path;
  }
  return parts.join(' > ') || first;
};
const __vis = (e) => {
  const r = e.getBoundingClientRect();
  if (r.width <= 4 || r.height <= 4) return false; // tiny / 1px sr-only boxes
  const s = getComputedStyle(e);
  if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
  // visually-hidden "screen-reader-only" pattern (clip rect / clip-path inset) \u2014 present in
  // the a11y tree but not painted; must not be measured for clipping/target-size.
  if (s.clip && s.clip !== 'auto' && s.clip !== 'rect(auto, auto, auto, auto)') return false;
  if (s.clipPath && (s.clipPath.indexOf('inset(100%') >= 0 || s.clipPath.indexOf('inset(50%') >= 0)) return false;
  return true;
};
const __html = (e) => (e.outerHTML || '').slice(0, 160);
`;
var PROBE_DEFAULTS = {
  reflowWidth: 320,
  maxFocusables: 120,
  maxHits: 20,
  maxTriggers: 60,
  actionTimeoutMs: 1e3,
  budgetMs: 2e4
};
function probeDeadline(budgetMs, now = Date.now) {
  const end = now() + budgetMs;
  return { out: () => now() >= end, left: () => Math.max(0, end - now()) };
}
function actionTimeout(limits, deadline) {
  const left = deadline ? deadline.left() : limits.actionTimeoutMs;
  return Math.max(1, Math.min(limits.actionTimeoutMs, left || limits.actionTimeoutMs));
}
var REFLOW_PROBE = `(() => {
  const el = document.scrollingElement || document.documentElement;
  return { horizontalScroll: el.scrollWidth > el.clientWidth + 2 };
})()`;
var REFLOW_ZOOM_PROBE = `(() => { ${PRELUDE}
  const root = document.documentElement;
  const prev = root.style.fontSize;
  root.style.fontSize = '200%';
  const hits = [];
  for (const e of Array.from(document.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,td,th,button,a,label,span'))) {
    if (!__vis(e)) continue;
    if ((e.textContent || '').trim().length < 8) continue;
    const s = getComputedStyle(e);
    const clip = s.overflow === 'hidden' || s.overflowY === 'hidden' || s.overflowX === 'hidden';
    const noWrap = s.whiteSpace === 'nowrap' || s.textOverflow === 'ellipsis';
    if ((clip || noWrap) && (e.scrollHeight > e.clientHeight + 6 || e.scrollWidth > e.clientWidth + 6)) {
      hits.push({ selector: __sel(e), html: __html(e), detail: 'Texte tronqu\xE9/masqu\xE9 \xE0 200% (conteneur overflow:hidden / nowrap) \u2014 perte de contenu au zoom (1.4.4).' });
    }
    if (hits.length >= 12) break;
  }
  root.style.fontSize = prev;
  return hits;
})()`;
var TEXT_SPACING_CSS = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";
var TEXT_SPACING_PROBE = `(() => { ${PRELUDE}
  const hits = [];
  for (const e of Array.from(document.querySelectorAll('p,li,span,a,button,h1,h2,h3,h4,h5,h6,td,th,label,div'))) {
    if (!__vis(e)) continue;
    if ((e.textContent || '').trim().length < 8) continue;
    const s = getComputedStyle(e);
    const clipped = (s.overflowX === 'hidden' || s.overflowY === 'hidden' || s.overflow === 'hidden') && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2);
    const ellipsis = s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 2;
    if (clipped || ellipsis) {
      // No criterion id in the text: every rendering already names the criterion this finding
      // belongs to, and a hard-coded \xAB 1.4.12 \xBB is a WCAG number appearing inside a deliverable
      // that may be keyed on another standard entirely.
      hits.push({ selector: __sel(e), html: __html(e), detail: 'Texte tronqu\xE9/masqu\xE9 sous l\\'espacement de texte impos\xE9 \u2014 perte de contenu.' });
    }
    if (hits.length >= 20) break;
  }
  return hits;
})()`;
function focusSetupExpr(scope = "", maxFocusables = PROBE_DEFAULTS.maxFocusables) {
  const rootExpr = scope ? `document.querySelectorAll(${JSON.stringify(scope)})` : `[document.documentElement]`;
  return `(() => { ${PRELUDE}
  // FOCUSABLE MEANS FOCUSABLE, NOT "the six tags we thought of". This list decides which
  // elements get tagged, and since the walk may now license a conformity, an element missing
  // from it is not merely unmeasured -- it is silently cleared. A page whose only control is a
  // <summary> tagged nothing at all, so the count was zero, so the ring was "vacuously whole",
  // so 2.4.7 and 2.4.11 closed without a single Tab press.
  //
  // AND NOT iframe / audio[controls] / video[controls], which were here for one release and
  // had to come back out. They are genuinely focusable, but their focus lives in another
  // document: everything below reads the PARENT'S activeElement, which stays the host element
  // press after press while the user tabs through the controls inside. The trap walk reads
  // exactly that as a cage, so an ordinary page with a video player, a payment frame, a map or
  // a support widget was reported as a bloquant 2.1.2 -- a blocker manufactured out of our own
  // blindness, able to fail somebody else's gate. The measurement we cannot make is not a
  // finding; Tab still crosses them, the walk still records that it crossed something it never
  // measured, and the page is not cleared either.
  // (No backticks in this comment: it lives inside a template literal.)
  const sel = 'a[href],area[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[contenteditable]:not([contenteditable="false"]),[tabindex]:not([tabindex="-1"]),[role=button]:not([disabled])';
  // A BOX THAT IS ANIMATING CANNOT BE COMPARED ACROSS TIME, so it contributes a constant.
  //
  // The snapshot is taken before Tab and re-read after it, and the properties compared include
  // background-color and colour \u2014 so a pseudo-element pulsing on a keyframe animation differs
  // between the two reads for a reason that has nothing to do with focus. That reads as \xAB the
  // focus is visible \xBB on a control that has no indicator at all: a MISSED non-conformity,
  // strictly worse than the false positive the pseudo-element read was added to remove.
  //
  // A transition is not affected and must not be excluded: it only moves on a state change,
  // so its at-rest value is stable and a focus transition is exactly what we want to see.
  //
  // When every part of an element is animated, both sides collapse to the same constant and
  // the probe reports \xAB no visible change \xBB \u2014 a finding rather than a silent pass. That is the
  // safe direction: this tool would rather name something a human can dismiss than clear
  // something nobody will look at again.
  const __style = (e, pseudo) => { const s = getComputedStyle(e, pseudo); if (s.animationName && s.animationName !== 'none') return 'animated'; return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderTopWidth, s.borderBottomWidth, s.backgroundColor, s.color, s.textDecorationLine].join('|'); };
  const snap = (e) => [__style(e, null), __style(e, '::before'), __style(e, '::after')].join('#');
  // Visually-hidden radio/checkbox \u2192 measure its visible label/proxy, not the input.
  const proxyFor = (e) => {
    const type = (e.getAttribute('type') || '').toLowerCase();
    const custom = e.tagName === 'INPUT' && (type === 'radio' || type === 'checkbox') && !__vis(e);
    if (!custom) return __vis(e) ? e : null;
    let p = null;
    if (e.id) { try { p = document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(e.id) : e.id) + '"]'); } catch (_) {} }
    if (!p) p = e.closest('label');
    if (!p) { const lb = (e.getAttribute('aria-labelledby') || '').split(/\\s+/)[0]; if (lb) p = document.getElementById(lb); }
    return (p && __vis(p)) ? p : null;
  };
  // Fresh authoritative pass: drop any tags a previous (whole-document or dialog) pass left.
  for (const el of Array.from(document.querySelectorAll('[data-u11y-f],[data-u11y-fp]'))) { el.removeAttribute('data-u11y-f'); el.removeAttribute('data-u11y-fp'); }
  const roots = ${rootExpr};
  const focusables = [];
  let total = 0;
  for (const root of Array.from(roots)) {
    if (root.matches && root.matches(sel)) focusables.push(root);
    for (const e of Array.from(root.querySelectorAll(sel))) focusables.push(e);
  }
  window.__u11yF = {};
  let n = 0;
  for (const e of focusables) {
    const proxy = proxyFor(e);
    if (!proxy) continue;
    const key = 'k' + n;
    total++;
    if (n >= ${maxFocusables}) continue; // tagged the cap; keep COUNTING so the caller knows it was cut
    e.setAttribute('data-u11y-f', key);
    proxy.setAttribute('data-u11y-fp', key);
    window.__u11yF[key] = { rest: snap(proxy), sel: __sel(proxy), html: __html(proxy) };
    n++;
  }
  return { n: n, total: total };
})()`;
}
var FOCUS_CHECK_PROBE = `(() => {
  const e = document.activeElement;
  // FOCUS LEFT THE DOCUMENT \u2014 the normal end of a tab ring, and nothing to measure.
  if (!e || e === document.body || e === document.documentElement) return null;
  const key = e.getAttribute && e.getAttribute('data-u11y-f');
  // FOCUS IS ON SOMETHING THE SETUP NEVER TAGGED, which is a different fact entirely and used
  // to be reported as the same one. A skip link revealed only on focus, a widget that moves
  // focus into a node the selector does not match -- Tab crossed it, nothing measured it, and
  // the walk went on to call itself whole. The caller needs to know the ring contained an
  // element it cannot speak for. (No backticks here: this lives inside a template literal.)
  if (!key || !window.__u11yF || !window.__u11yF[key]) return { untagged: true, key: '', changed: true, selector: '', html: '' };
  const rec = window.__u11yF[key];
  const proxy = document.querySelector('[data-u11y-fp="' + key + '"]') || e;
  // THE SAME THREE BOXES pass 1 snapshotted, in the same order. A design system that paints
  // its control in label::before -- DSFR, GOV.UK, USWDS, Bootstrap -- puts the focus ring
  // there too, and reading only the element would report every one of them as unfocusable.
  // (No backticks in this comment: it lives inside a template literal.)
  // Same three boxes, same animation exclusion as pass 1 -- an animating box contributes a
  // constant on both sides, so it can never fabricate a difference (nor hide a real one).
  const st = (pseudo) => { const s = getComputedStyle(proxy, pseudo); if (s.animationName && s.animationName !== 'none') return 'animated'; return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderTopWidth, s.borderBottomWidth, s.backgroundColor, s.color, s.textDecorationLine].join('|'); };
  const now = [st(null), st('::before'), st('::after')].join('#');
  return { key: key, changed: now !== rec.rest, selector: rec.sel, html: rec.html };
})()`;
var FOCUS_OBSCURED_PROBE = `(() => { ${PRELUDE}
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const key = e.getAttribute && e.getAttribute('data-u11y-f');
  if (!key) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;         // nothing to obscure
  const vw = window.innerWidth, vh = window.innerHeight;
  // Sample a 5\xD75 grid inset by a pixel, keeping only points inside the viewport. A component
  // scrolled off-screen leaves no sampleable point and is NOT reported: out of view is not
  // obscured, and the criterion is about content laid over it.
  const xs = [0.02, 0.25, 0.5, 0.75, 0.98], pts = [];
  for (const fx of xs) for (const fy of xs) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x >= 0 && y >= 0 && x < vw && y < vh) pts.push([x, y]);
  }
  if (!pts.length) return null;
  // The topmost element over a point, for each sampled point. The focused element counts as
  // visible when it \u2014 or anything inside it \u2014 is on top: an icon inside a button is the button
  // being visible, and reading that as occlusion would fail every well-built page.
  let occluder = null;
  for (const [x, y] of pts) {
    const top = document.elementsFromPoint(x, y)[0];
    if (!top) continue;
    if (top === e || e.contains(top)) return null;      // some part of it is on top \u2192 pass
    if (!occluder) occluder = top;
  }
  if (!occluder) return null;
  // AUTHOR-CREATED OVERLAY, or nothing. Walk up from the occluder looking for the fixed/sticky
  // ancestor that puts it over the page; without one this is ordinary layout, not obscuring.
  let overlay = null;
  for (let n = occluder; n && n !== document.documentElement; n = n.parentElement) {
    const pos = getComputedStyle(n).position;
    if (pos === 'fixed' || pos === 'sticky') { overlay = n; break; }
  }
  if (!overlay) return null;
  if (overlay.contains(e)) return null;                 // it is the component's own container
  return { key: key, selector: __sel(e), html: __html(e), overlay: __sel(overlay) };
})()`;
var HOVER_SETUP_PROBE = `(() => { ${PRELUDE}
  const out = [];
  let n = 0;
  let total = 0;
  for (const e of Array.from(document.querySelectorAll('[aria-describedby]'))) {
    const id = (e.getAttribute('aria-describedby') || '').split(/\\s+/)[0];
    if (!id) continue;
    const t = document.getElementById(id);
    if (!t) continue;
    // THE TRIGGER ITSELF HAS TO BE THERE. 1.4.13 is about content revealed on hover or focus,
    // and an element that is not rendered reveals nothing to anybody -- hovering it was always
    // futile, and once an unreachable trigger started withholding the criterion, that futility
    // would have turned into a page nobody could ever clear.
    if (!__vis(e)) continue;
    const s = getComputedStyle(t);
    const hidden = s.display === 'none' || s.visibility === 'hidden' || t.getBoundingClientRect().height === 0;
    if (!hidden) continue;
    total++;
    if (n >= 10) continue; // tagged ten; keep COUNTING so the caller knows what it did not see
    const key = 'h' + n;
    e.setAttribute('data-u11y-h', key);
    out.push({ key: key, target: id, selector: __sel(e) });
    n++;
  }
  for (const o of out) o.total = total;
  return out;
})()`;
function hoverVisibleExpr(id, wantHidden = false) {
  const j = JSON.stringify(id);
  return `(() => { const t = document.getElementById(${j}); if (!t) return ${wantHidden ? "true" : "false"}; const s = getComputedStyle(t); const shown = s.display !== 'none' && s.visibility !== 'hidden' && t.getBoundingClientRect().height > 0; return ${wantHidden ? "!shown" : "shown"}; })()`;
}
function readSetup(raw, limits) {
  if (typeof raw === "number") return { count: raw, capped: raw >= limits.maxFocusables };
  const o = raw ?? {};
  const count = o.n ?? 0;
  return { count, capped: (o.total ?? count) > count };
}
function cappedRing(capped, limits) {
  return capped ? `the setup pass stopped tagging at ${limits.maxFocusables} focusable elements (probes.maxFocusables), so everything past that was never focused and never measured` : void 0;
}
async function probeFocusRing(page, scope = "", limits = PROBE_DEFAULTS, deadline) {
  const { count, capped } = readSetup(await page.evaluate(focusSetupExpr(scope, limits.maxFocusables)), limits);
  if (!count) return { visible: [], obscured: [], complete: true };
  const hits = [];
  const obscured = [];
  const seen = /* @__PURE__ */ new Set();
  const limit = tabPressBudget(count, limits);
  let prevKey = null;
  let cutShort = `the walk spent its ${limit} Tab presses without the ring ever closing, so the tail of it was never reached`;
  let untagged = 0;
  for (let i = 0; i < limit; i++) {
    if (deadline?.out()) {
      cutShort = `the probe budget of ${limits.budgetMs}ms ran out after ${seen.size} of the ${count} focusable elements \u2014 the rest of the ring was never focused`;
      break;
    }
    await page.keyboard.press("Tab");
    const r = await page.evaluate(FOCUS_CHECK_PROBE);
    if (!r) continue;
    if (r.untagged) {
      untagged++;
      continue;
    }
    if (r.key === prevKey) continue;
    if (seen.has(r.key)) {
      cutShort = void 0;
      break;
    }
    seen.add(r.key);
    prevKey = r.key;
    if (!r.changed) {
      hits.push({
        selector: r.selector,
        html: r.html,
        detail: "Le focus clavier ne produit aucun changement visible (outline/box-shadow/bordure/fond) \u2014 focus non visible."
      });
    }
    if (obscured.length < 20 && !deadline?.out()) {
      const o = await page.evaluate(FOCUS_OBSCURED_PROBE);
      if (o) {
        obscured.push({
          selector: o.selector,
          html: o.html,
          detail: `Le composant qui re\xE7oit le focus clavier est enti\xE8rement masqu\xE9 par un contenu ajout\xE9 par l'auteur (${o.overlay}) \u2014 il est impossible de voir o\xF9 l'on se trouve au clavier.`
        });
      }
    }
    if (hits.length >= 20 && obscured.length >= 20) {
      cutShort = `both recording caps filled at ${seen.size} of the ${count} focusable elements \u2014 enough was found to fail the page, not enough to clear the rest of it`;
      break;
    }
  }
  if (cutShort && seen.size >= count) cutShort = void 0;
  const why = cappedRing(capped, limits) ?? cutShort ?? (untagged > 0 ? `Tab crossed ${untagged} element(s) the tagging pass never matched \u2014 a control focusable in the browser but not by this selector (a skip link revealed on focus, a widget moving focus into an untagged node). They were never compared, so this page is not cleared` : void 0);
  return { visible: hits, obscured, complete: !why, ...why ? { why } : {} };
}
var NATIVE_SEGMENT_STOPS = {
  date: 5,
  time: 5,
  "datetime-local": 8,
  month: 4,
  week: 4
};
function tabPressBudget(count, limits) {
  return Math.min(count * 2 + 20, limits.maxFocusables * 2 + 20);
}
var FOCUS_WHERE_PROBE = `(() => { ${PRELUDE}
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const key = e.getAttribute && e.getAttribute('data-u11y-f');
  const stops = ${JSON.stringify(NATIVE_SEGMENT_STOPS)};
  const type = e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text').toLowerCase() : '';
  return { key: key || __sel(e), tagged: !!key, selector: __sel(e), html: __html(e), segments: stops[type] || 1 };
})()`;
async function probeKeyboardTrapRing(page, limits = PROBE_DEFAULTS, deadline) {
  const { count, capped } = readSetup(await page.evaluate(focusSetupExpr("", limits.maxFocusables)), limits);
  if (!count || count < 2) return { hits: [], complete: true };
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
  const confirmPresses = 2;
  const limit = tabPressBudget(count, limits);
  let prev = null;
  let cutShort = `the walk spent its ${limit} Tab presses without the ring ever closing, so the tail of it was never reached`;
  for (let i = 0; i < limit; i++) {
    if (deadline?.out()) {
      cutShort = `the probe budget of ${limits.budgetMs}ms ran out after ${seen.size} of the ${count} focusable elements \u2014 the rest of the ring was never walked`;
      break;
    }
    await page.keyboard.press("Tab");
    const now = await page.evaluate(FOCUS_WHERE_PROBE);
    if (!now) {
      cutShort = void 0;
      break;
    }
    if (prev?.tagged && now.tagged && now.key === prev.key) {
      const budget = Math.max(confirmPresses, (now.segments ?? 1) - 1);
      let stuck = true;
      let confirmed = true;
      for (let k = 0; k < budget && stuck; k++) {
        if (deadline?.out()) {
          confirmed = false;
          break;
        }
        await page.keyboard.press("Tab");
        const again = await page.evaluate(FOCUS_WHERE_PROBE);
        stuck = again !== null && again.tagged === true && again.key === now.key;
      }
      if (!confirmed) {
        cutShort = `the probe budget of ${limits.budgetMs}ms ran out while confirming whether focus could leave ${now.selector} \u2014 an unconfirmed suspicion is not a non-conformity`;
        break;
      }
      if (stuck) {
        hits.push({
          selector: now.selector,
          html: now.html,
          detail: `Le focus reste sur cet \xE9l\xE9ment apr\xE8s ${1 + budget} appuis sur Tab, alors que la page compte ${count} \xE9l\xE9ments focalisables \u2014 pi\xE8ge au clavier (2.1.2).`
        });
        cutShort = void 0;
        break;
      }
    }
    if (now.key !== prev?.key) {
      if (seen.has(now.key)) {
        cutShort = void 0;
        break;
      }
      seen.add(now.key);
    }
    prev = now;
  }
  if (cutShort && seen.size >= count) cutShort = void 0;
  const why = cappedRing(capped, limits) ?? cutShort;
  return { hits, complete: !why, ...why ? { why } : {} };
}
async function probeHoverWalk(page, limits = PROBE_DEFAULTS, deadline) {
  const setup = await page.evaluate(HOVER_SETUP_PROBE);
  const triggers = setup;
  const hits = [];
  let cutShort;
  let unreachable = 0;
  const tried = triggers.slice(0, Math.max(1, limits.maxTriggers));
  if (tried.length < triggers.length) {
    cutShort = `only ${tried.length} of the ${triggers.length} hover triggers on this page were opened (probes.maxTriggers) \u2014 the rest were never asked whether Escape dismisses them`;
  }
  for (const tr of tried) {
    if (deadline?.out()) {
      cutShort = `the probe budget of ${limits.budgetMs}ms ran out with triggers left unopened`;
      break;
    }
    try {
      await page.hover(`[data-u11y-h="${tr.key}"]`, { timeout: actionTimeout(limits, deadline) });
    } catch {
      unreachable++;
      continue;
    }
    await page.waitForTimeout(150);
    const shown = await page.evaluate(hoverVisibleExpr(tr.target));
    if (!shown) continue;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const dismissed = await page.evaluate(hoverVisibleExpr(tr.target, true));
    await page.mouse.move(2, 2).catch(() => {
    });
    if (!dismissed) {
      hits.push({
        selector: tr.selector,
        html: "",
        detail: `Le contenu r\xE9v\xE9l\xE9 au survol (aria-describedby #${tr.target}) ne se masque pas avec \xC9chap \u2014 Contenu au survol ou au focus (1.4.13).`
      });
    }
    if (hits.length >= Math.min(limits.maxHits, 8)) {
      cutShort = "the recording cap filled with triggers left unopened \u2014 enough was found to fail the page, not enough to clear the rest of it";
      break;
    }
  }
  const capped = setup[0]?.total;
  const why = cutShort ?? (typeof capped === "number" && capped > triggers.length ? `only ${triggers.length} of the ${capped} hover triggers on this page were tagged \u2014 the rest were never opened` : void 0) ?? (unreachable > 0 ? `${unreachable} hover trigger(s) never became actionable, so their content was never opened or dismissed` : void 0);
  return { hits, complete: !why, ...why ? { why } : {} };
}
async function runLiveProbes(page, opts = {}) {
  const limits = { ...PROBE_DEFAULTS, ...opts.limits };
  const only = opts.only?.length ? new Set(opts.only) : null;
  const want = (id) => only === null || only.has(id);
  const deadline = probeDeadline(limits.budgetMs);
  const canResize = typeof page.setViewportSize === "function" && typeof page.viewportSize === "function";
  const canType = !!page.keyboard && typeof page.keyboard.press === "function";
  const canHover = typeof page.hover === "function" && typeof page.waitForTimeout === "function";
  const canStyle = typeof page.addStyleTag === "function";
  const size = canResize ? page.viewportSize() ?? null : null;
  const restore = size ?? { width: 1280, height: 900 };
  const out = {
    v: PROBES_VERSION,
    focusVisible: [],
    hover: [],
    keyboardTrap: [],
    reflowZoom: [],
    textSpacing: [],
    reflow: { horizontalScroll: false },
    probed: [],
    skipped: []
  };
  const skip = (sc, why) => {
    out.skipped?.push({ sc, why });
  };
  const bounded = async (sc, run) => {
    if (deadline.out()) {
      skip(sc, `the probe budget of ${limits.budgetMs}ms was already spent when this criterion came up`);
      return null;
    }
    let timer;
    const CUT = /* @__PURE__ */ Symbol("cut");
    const started = Date.now();
    try {
      const raced = await Promise.race([
        run().catch((e) => {
          throw e;
        }),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(CUT), Math.max(1, deadline.left()));
        })
      ]);
      if (raced === CUT) {
        skip(sc, `the probe budget of ${limits.budgetMs}ms ran out after ${Date.now() - started}ms \u2014 this measurement did not complete`);
        return null;
      }
      return raced;
    } catch (e) {
      skip(sc, String(e?.message ?? e).slice(0, 160));
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  if (!canResize) skip("1.4.10", "the page object cannot resize its viewport");
  if (!canType) for (const sc of ["2.4.7", "2.1.2"]) skip(sc, "the page object exposes no keyboard");
  if (!canHover) skip("1.4.13", "the page object cannot hover");
  if (!canStyle) skip("1.4.12", "the page object cannot inject a stylesheet");
  if (want("1.4.4")) {
    const r = await bounded("1.4.4", async () => await page.evaluate(REFLOW_ZOOM_PROBE));
    if (r) {
      out.reflowZoom = r ?? [];
      out.probed.push("1.4.4");
    }
  }
  if (want("1.4.10") && canResize) {
    const narrowed = await bounded("1.4.10", async () => {
      await page.setViewportSize({ width: limits.reflowWidth, height: restore.height });
      return true;
    });
    if (narrowed) {
      const r = await bounded("1.4.10", async () => await page.evaluate(REFLOW_PROBE));
      await page.setViewportSize(restore).catch(() => {
      });
      if (r) {
        out.reflow = r;
        out.probed.push("1.4.10");
      }
    }
  }
  if (want("1.4.12") && canStyle) {
    const handle = await bounded("1.4.12", () => page.addStyleTag({ content: TEXT_SPACING_CSS }));
    if (handle) {
      const r = await bounded("1.4.12", async () => await page.evaluate(TEXT_SPACING_PROBE));
      await page.evaluate(REMOVE_TEXT_SPACING_STEP).catch(() => {
      });
      if (r) {
        out.textSpacing = r;
        out.probed.push("1.4.12");
      }
    }
  }
  if ((want("2.4.7") || want("2.4.11")) && canType) {
    const r = await bounded("2.4.7", () => probeFocusRing(page, "", limits, deadline));
    if (r) {
      out.focusVisible = r.visible;
      out.focusObscured = r.obscured;
      for (const sc of ["2.4.7", "2.4.11"]) {
        if (!want(sc)) continue;
        if (r.complete) out.probed.push(sc);
        else skip(sc, r.why ?? "the walk of the tab ring did not cross the whole of it");
      }
    }
  }
  if (want("2.1.2") && canType) {
    const r = await bounded("2.1.2", () => probeKeyboardTrapRing(page, limits, deadline));
    if (r) {
      out.keyboardTrap = r.hits;
      if (r.complete) out.probed.push("2.1.2");
      else skip("2.1.2", r.why ?? "the walk of the tab ring did not cross the whole of it");
    }
  }
  if (want("1.4.13") && canHover && canType) {
    const r = await bounded("1.4.13", () => probeHoverWalk(page, limits, deadline));
    if (r) {
      out.hover = r.hits;
      if (r.complete) out.probed.push("1.4.13");
      else skip("1.4.13", r.why ?? "the hover pass did not open every trigger on the page");
    }
  }
  if (want("4.1.3") && opts.liveRegion) {
    const clicks = typeof opts.liveRegion === "object" && opts.liveRegion.clicks === true;
    const r = await bounded("4.1.3", () => probeLiveRegion(page, opts.lang ?? "fr", clicks));
    if (r) {
      out.liveRegion = r.hits;
      if (r.complete) out.probed.push("4.1.3");
      else skip("4.1.3", r.why ?? "the live-region pass did not exercise the whole page");
    }
  }
  for (const [bucket, sc] of UNREADABLE_BY_OLDER) {
    if (out[bucket]?.length) {
      const at = out.probed.indexOf(sc);
      if (at >= 0) out.probed.splice(at, 1);
    }
  }
  return out;
}
var DESTRUCTIVE_NAME_RE = "\\b(supprim|retir|effac|envoy|valid|confirm|pay|achet|command|delete|remove|eras|clear|send|submit|buy|order)";
function liveRegionExpr(detail, allowClicks) {
  const d = JSON.stringify(detail);
  const clickLoop = allowClicks ? `
  // click button[type=button] only (never a submit/link), skipping destructive names
  const dangerous = new RegExp(${JSON.stringify(DESTRUCTIVE_NAME_RE)}, 'i');
  const nameOf = (b) => {
    let n = (b.getAttribute('aria-label') || '') + ' ' + (b.textContent || '') + ' ' + (b.getAttribute('title') || '');
    // ALL aria-labelledby ids (attribute trimmed): a destructive verb may sit in ANY
    // referenced id, and the value may carry stray leading/trailing whitespace.
    for (const id of (b.getAttribute('aria-labelledby') || '').trim().split(/\\s+/)) {
      if (!id) continue;
      const t = document.getElementById(id);
      if (t) n += ' ' + (t.textContent || '');
    }
    // Icon-only buttons: the name lives in img[alt] (an attribute \u2014 invisible to
    // textContent) or an svg <title> (belt-and-braces; textContent usually includes it).
    for (const im of Array.from(b.querySelectorAll('img[alt]'))) n += ' ' + (im.getAttribute('alt') || '');
    for (const ti of Array.from(b.querySelectorAll('svg title'))) n += ' ' + (ti.textContent || '');
    return n;
  };
  for (const b of Array.from(document.querySelectorAll('button[type="button"]'))) {
    if (count >= 20 || hits.length >= 10) { untried += 1; continue; }
    if (b.disabled || !__vis(b)) continue;
    if (dangerous.test(nameOf(b))) { untried += 1; continue; } // defense-in-depth: never click a destructive-named button
    const before = location.href;
    try { b.click(); } catch (_) {}
    await settle();
    if (location.href !== before) { obs.disconnect(); return { hits: hits, untried: untried, navigated: true }; }
    drain();
    count++;
  }` : `
  // CLICKS DISABLED, and the buttons are counted rather than ignored. A status message very
  // often appears after a button press and nothing else, so a pass that never pressed one has
  // not measured 4.1.3 on this page -- it has measured the fields. Reporting how many it
  // declined is what lets the caller withhold the credit instead of publishing silence.
  for (const b of Array.from(document.querySelectorAll('button[type="button"]'))) {
    if (!b.disabled && __vis(b)) untried += 1;
  }`;
  return `(async () => { ${PRELUDE}
  const isLive = (node) => {
    let el = node && node.nodeType === 1 ? node : (node ? node.parentElement : null);
    while (el && el !== document.documentElement) {
      const live = (el.getAttribute && el.getAttribute('aria-live')) || '';
      const role = (el.getAttribute && el.getAttribute('role')) || '';
      if (live === 'polite' || live === 'assertive') return true;
      if (role === 'status' || role === 'alert' || role === 'log') return true;
      el = el.parentElement;
    }
    return false;
  };
  const hits = [];
  const seen = new Set();
  const records = [];
  const obs = new MutationObserver((muts) => { for (const m of muts) records.push(m); });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true });
  const settle = () => new Promise((r) => setTimeout(r, 40));
  const drain = () => {
    for (const m of records.splice(0)) {
      const targets = m.type === 'characterData' ? [m.target] : Array.from(m.addedNodes);
      for (const t of targets) {
        if (!t || (t.textContent || '').trim().length === 0) continue;
        if (isLive(t)) continue;
        const host = t.nodeType === 1 ? t : t.parentElement;
        if (!host || !__vis(host)) continue;
        const key = __sel(host);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ selector: key, html: __html(host), detail: ${d} });
      }
    }
  };
  let count = 0;
  // How many candidate interactions this pass did NOT perform -- caps, a destructive-sounding
  // name, clicks turned off. A probe that skipped half a page has not measured it, and the
  // caller may not read its silence as conformity.
  let untried = 0;${clickLoop}
  // toggle checkbox/radio, then restore
  for (const t of Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]'))) {
    if (count >= 40 || hits.length >= 10) { untried += 1; continue; }
    if (t.disabled || !__vis(t)) continue;
    const before = location.href;
    const prev = t.checked;
    // A RADIO IS NOT A CHECKBOX: clicking one UNCHECKS its pair, and restoring only the one we
    // clicked left the group with nothing selected -- a form the caller's next assertion, or
    // the user, finds broken. Remember which member of the group was checked and put THAT back.
    let group = null;
    if (t.type === 'radio' && t.name) {
      try {
        const form = t.form || document;
        for (const r of Array.from(form.querySelectorAll('input[type="radio"]'))) { if (r.name === t.name && r.checked) { group = r; break; } }
      } catch (_) {}
    }
    try { t.click(); } catch (_) {}
    await settle();
    if (location.href !== before) { obs.disconnect(); return { hits: hits, untried: untried, navigated: true }; }
    drain();
    try {
      if (group) { if (!group.checked) { group.checked = true; group.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (t.checked !== prev) { t.checked = prev; t.dispatchEvent(new Event('change', { bubbles: true })); }
    } catch (_) {}
    count++;
  }
  // fill text inputs, then restore
  for (const inp of Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], textarea'))) {
    if (count >= 60 || hits.length >= 10) { untried += 1; continue; }
    if (inp.disabled || inp.readOnly || !__vis(inp)) continue;
    const before = location.href;
    const prev = inp.value == null ? '' : String(inp.value);
    try { inp.value = 'test 123'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    await settle();
    if (location.href !== before) { obs.disconnect(); return { hits: hits, untried: untried, navigated: true }; }
    drain();
    try { inp.value = prev; inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    count++;
  }
  obs.disconnect();
  return { hits: hits.slice(0, 10), untried: untried, navigated: false };
})()`;
}
var LIVE_REGION_DETAIL = {
  fr: "Mise \xE0 jour de contenu d\xE9clench\xE9e par une interaction hors d'une r\xE9gion live (aria-live / role=status|alert|log) \u2014 probablement non restitu\xE9e aux technologies d'assistance.",
  en: "Content update triggered by an interaction outside any live region (aria-live / role=status|alert|log) \u2014 likely not announced to assistive technology."
};
async function probeLiveRegion(page, lang, allowClicks) {
  const detail = LIVE_REGION_DETAIL[lang] ?? LIVE_REGION_DETAIL.en;
  const r = await page.evaluate(liveRegionExpr(detail, allowClicks));
  const hits = r?.hits ?? [];
  if (r?.navigated) {
    return {
      hits,
      complete: false,
      why: "an interaction navigated away mid-pass \u2014 everything after it happened on another page, and this one was not finished"
    };
  }
  if (r?.untried > 0) {
    return {
      hits,
      complete: false,
      why: `${r.untried} interactive element(s) were never exercised (clicks disabled, a destructive-sounding name, or a cap) \u2014 a status message that only appears after one of them would not have been seen`
    };
  }
  return { hits, complete: true };
}
var REMOVE_TEXT_SPACING_STEP = `(() => {
  const sheets = Array.from(document.querySelectorAll('style'));
  for (const s of sheets) {
    if (s.textContent && s.textContent.indexOf('letter-spacing: 0.12em') >= 0) s.remove();
  }
  return true;
})()`;
var UNREADABLE_BY_OLDER = [
  ["focusObscured", "2.4.11"],
  ["keyboardTrap", "2.1.2"],
  ["liveRegion", "4.1.3"]
];

// src/integrations/core.ts
import { spawnSync } from "child_process";
import { createRequire } from "module";

// src/integrations/payload.ts
var RANK = { bloquant: 0, majeur: 1, mineur: 2 };
var THRESHOLD = { blocking: 0, bloquant: 0, major: 1, majeur: 1, minor: 2, mineur: 2 };
function failingFindings(result, failOn) {
  const max = THRESHOLD[failOn];
  if (max === void 0) throw new Error(`ultra11y: failOn must be blocking|major|minor (got "${failOn}")`);
  return (result.findings ?? []).filter((f) => !f.advisory && (RANK[f.severity] ?? 99) <= max);
}
function formatFailure(pageName, failing) {
  const lines = [`ultra11y: ${failing.length} accessibility non-conformity(ies) on "${pageName}":`];
  for (const f of failing.slice(0, 20)) {
    lines.push(`  [${f.severity}] ${f.ruleId} (WCAG ${f.criteriaId}) \u2014 ${f.origin?.sourceFile ?? f.file} \u2014 ${f.message}`);
  }
  if (failing.length > 20) lines.push(`  \u2026 and ${failing.length - 20} more.`);
  lines.push("Full detail: .ultra11y/pages/ \u2014 re-audit offline with `ultra11y audit`.");
  return lines.join("\n");
}
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
function stayedOnPage(expected, actual) {
  if (!expected || !actual) return true;
  const path = (u) => {
    try {
      return new URL(u, "http://x.invalid").pathname.replace(/\/+$/, "");
    } catch {
      return void 0;
    }
  };
  const a = path(expected);
  const b = path(actual);
  if (a === void 0 || b === void 0) return true;
  return a === b;
}
function buildPayload(collected, url, runner, opts, screenshot, probes, axe) {
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
      // `documentElement.outerHTML` starts at `<html>`, so the DOM alone drops the doctype and
      // RGAA 8.1 — « chaque page web est-elle définie par un type de document ? » — has nothing
      // to look at. The collector captures it separately; this is where it was being thrown
      // away one step later. Measured: 105 of 106 criteria decided, and the one left was 8.1,
      // whose brief read « this capture predates doctype recording ».
      //
      // `!== undefined`, never a truthiness test: an EMPTY doctype is a page that genuinely has
      // none, which is the non-conformity itself. Collapsing it into "not recorded" would hide
      // a failing page behind « à évaluer ».
      ...collected.doctype !== void 0 ? { doctype: collected.doctype } : {},
      ...opts.auth !== void 0 ? { auth: opts.auth } : {},
      ...opts.sources ? { sources: opts.sources } : {},
      ...opts.notes ? { notes: opts.notes } : {}
    },
    dom: collected.dom,
    styles: collected.styles,
    boxes: collected.boxes,
    css: collected.css,
    ...screenshot ? { screenshot } : {},
    // What the live probes measured, when the caller asked for them. It rides in the payload
    // because `snapshot write` persists it beside the DOM — the audit that folds it runs later
    // and in another process, so a measurement kept in memory decides nothing.
    ...probes ? { probes } : {},
    // Same contract as the probes: it rides in the payload and `snapshot write` persists it
    // beside the DOM, so the offline re-audit sees what the browser saw.
    ...axe ? { axe } : {}
  };
}
function gate(result, pageName, failOn) {
  const threshold = failOn === void 0 ? "blocking" : failOn;
  if (threshold === false) return;
  const failing = failingFindings(result, threshold);
  if (failing.length) throw new Error(formatFailure(pageName, failing));
}

// src/integrations/core.ts
function enginePath() {
  if (process.env.ULTRA11Y) return process.env.ULTRA11Y;
  try {
    return createRequire(import.meta.url).resolve("ultra11y/scripts/ultra11y.mjs");
  } catch {
    return new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
  }
}
function auditSnapshot(payload, engine = enginePath()) {
  const res = spawnSync(process.execPath, [engine, "snapshot", "write", "--json"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 192 * 1024 * 1024
  });
  if (res.error) throw new Error(`ultra11y: could not run the engine at ${engine} \u2014 ${res.error.message}`);
  if (!res.stdout) throw new Error(`ultra11y: the engine produced no output (exit ${res.status})
${res.stderr || ""}`);
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`ultra11y: could not parse the engine output
${res.stdout.slice(0, 500)}`);
  }
}
function writePagesReport(opts = {}, engine = enginePath()) {
  const args = [engine, "pages", "--in", "-", "--format", "report"];
  if (opts.split !== false) args.push("--split", "page");
  args.push("--out", opts.out ?? "audits/pages");
  if (opts.standard) args.push("--standard", opts.standard);
  if (opts.lang) args.push("--lang", opts.lang);
  const audit = spawnSync(process.execPath, [engine, "audit", ".ultra11y/pages", "--json"], { encoding: "utf8", maxBuffer: 192 * 1024 * 1024 });
  if (audit.error || !audit.stdout) return void 0;
  const res = spawnSync(process.execPath, args, { input: audit.stdout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) return void 0;
  return res.stdout.trim() || void 0;
}

// src/integrations/playwright.ts
function probeOptions(p) {
  if (p === true || p === void 0) return fromConfig();
  if (p === false) return {};
  if (Array.isArray(p)) return { only: p, ...fromConfig() };
  const { only, ...limits } = p;
  return { ...only ? { only } : {}, limits };
}
function fromConfig() {
  try {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), ".ultra11yrc.json"), "utf8"));
    if (!cfg.probes) return {};
    const { only, ...limits } = cfg.probes;
    return { ...only ? { only } : {}, limits };
  } catch {
    return {};
  }
}
async function runAxe(page, mode) {
  if (mode === false) return void 0;
  const demanded = mode === true;
  let AxeBuilder;
  let lastError;
  for (const from of [join(process.cwd(), "package.json"), import.meta.url]) {
    try {
      const mod = createRequire2(from)("@axe-core/playwright");
      AxeBuilder = mod.default ?? mod;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!AxeBuilder) {
    if (demanded) {
      console.warn(
        `ultra11y: axe was requested but @axe-core/playwright could not be resolved from ${process.cwd()} nor from this package \u2014 ${lastError instanceof Error ? lastError.message : String(lastError)}. Install it, or set \`axe: false\`. The criteria axe decides stay to assess.`
      );
    }
    return void 0;
  }
  try {
    const res = await new AxeBuilder({ page }).analyze();
    return { ran: true, violations: res.violations ?? [] };
  } catch (e) {
    console.warn(
      `ultra11y: the axe pass failed on this page \u2014 ${e instanceof Error ? e.message : String(e)}. The snapshot was still recorded; the criteria axe decides stay to assess.`
    );
    return void 0;
  }
}
async function checkA11y(page, opts = {}) {
  const collected = await page.evaluate(COLLECT_SNAPSHOT);
  let shot;
  if (opts.screenshot !== false) {
    try {
      shot = (await page.screenshot({ fullPage: false })).toString("base64");
    } catch {
    }
  }
  const url = collected.url || page.url();
  if (opts.expectPath && !stayedOnPage(opts.expectPath, url)) {
    throw new Error(
      `ultra11y: ${opts.expectPath} landed on ${url} \u2014 not recording it as "${opts.as ?? opts.name ?? "this page"}". The state that opens this route is not the one the test built; seed it first, or drop the page from the sample.`
    );
  }
  let probes;
  if (opts.probes || opts.liveRegion) {
    try {
      probes = await runLiveProbes(page, {
        ...probeOptions(opts.probes),
        ...opts.probes ? {} : { only: ["4.1.3"] },
        ...opts.liveRegion ? { liveRegion: opts.liveRegion } : {}
      });
    } catch (e) {
      console.warn(
        `ultra11y: the live probes failed on this page \u2014 ${e instanceof Error ? e.message : String(e)}. The snapshot was still recorded; the criteria they decide stay to assess.`
      );
    }
  }
  const axe = await runAxe(page, opts.axe ?? "auto");
  const payload = buildPayload(collected, url, "playwright", opts, shot, probes, axe);
  const result = auditSnapshot(payload);
  if (opts.report) writePagesReport(typeof opts.report === "object" ? opts.report : {});
  gate(result, String(payload.meta.name), opts.failOn);
  return result;
}
var test = (() => {
  const load = (from) => createRequire2(from)("@playwright/test");
  for (const from of [`${process.cwd()}/package.json`, import.meta.url]) {
    try {
      const base = load(from).test;
      if (!base?.extend) continue;
      return base.extend({
        // `any` for the same reason.
        ultra11y: async ({ page }, use) => {
          await use((opts) => checkA11y(page, opts));
        }
      });
    } catch {
    }
  }
  return void 0;
})();
function samplePagesFor(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  let declared;
  try {
    const raw = readFileSync(join(cwd, ".ultra11yrc.json"), "utf8");
    declared = JSON.parse(raw).sample?.pages ?? [];
  } catch {
    throw new Error(`ultra11y: no readable .ultra11yrc.json in ${cwd} \u2014 sweepSample reads the page sample from it.`);
  }
  return declared.filter((p) => opts.only?.(p) ?? true);
}
function sweepTarget(url) {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}
function sweepCheckOptions(check) {
  return { failOn: false, probes: true, ...check };
}
function sweepSample(opts = {}) {
  const pages = samplePagesFor(opts);
  const t = test;
  if (!t) throw new Error("ultra11y: @playwright/test could not be resolved \u2014 sweepSample needs it.");
  if (!pages.length) return;
  for (const p of pages) {
    const target = sweepTarget(p.url);
    t(`a11y \u2014 ${p.name}`, async ({ page }) => {
      const response = await page.goto(target);
      if (opts.settle) await opts.settle(page);
      const landed = page.url();
      t.skip(!stayedOnPage(target, landed), `${target} landed on ${landed} \u2014 the current state does not open this screen; nothing to record as "${p.name}"`);
      const status = response?.status();
      t.skip(
        status !== void 0 && status >= 400,
        `${target} answered HTTP ${status} \u2014 an error page at the requested address; nothing to record as "${p.name}"`
      );
      await checkA11y(page, {
        ...sweepCheckOptions(opts.check),
        as: p.id,
        name: p.name,
        ...p.auth !== void 0 ? { auth: p.auth } : {},
        ...p.notes ? { notes: p.notes } : {},
        ...p.sources ? { sources: p.sources } : {},
        expectPath: target
      });
    });
  }
}
export {
  checkA11y,
  samplePagesFor,
  sweepCheckOptions,
  sweepSample,
  sweepTarget,
  test
};
