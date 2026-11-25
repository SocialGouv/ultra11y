// src/integrations/playwright.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "fs";
import { createRequire as createRequire3 } from "module";
import { join as join3 } from "path";

// src/consent.ts
var CONSENT_MARKERS = [
  // DSFR (système de design de l'État): the consent placeholder and the consent banner.
  { vendor: "dsfr", kind: "placeholder", cls: "fr-consent-placeholder" },
  { vendor: "dsfr", kind: "banner", cls: "fr-consent-banner" },
  // EU Cookie Compliance (Drupal).
  { vendor: "eu-cookie-compliance", kind: "banner", id: "sliding-popup" },
  { vendor: "eu-cookie-compliance", kind: "banner", cls: "eu-cookie-compliance-banner" },
  // tarteaucitron: its root and the « activate » box it puts where a blocked service was.
  { vendor: "tarteaucitron", kind: "banner", id: "tarteaucitron", idPrefix: true },
  { vendor: "tarteaucitron", kind: "placeholder", cls: "tac_activate", classPrefix: true },
  // Didomi.
  { vendor: "didomi", kind: "banner", id: "didomi-host" },
  { vendor: "didomi", kind: "banner", id: "didomi-notice" },
  { vendor: "didomi", kind: "placeholder", cls: "didomi-content-placeholder", classPrefix: true },
  // Axeptio.
  { vendor: "axeptio", kind: "banner", id: "axeptio_overlay" },
  { vendor: "axeptio", kind: "banner", cls: "axeptio_mount" },
  { vendor: "axeptio", kind: "placeholder", cls: "axeptio-placeholder", classPrefix: true }
];
var GENERIC_PLACEHOLDER = /consent.*(?:placeholder|blocked|disabled|fallback)|(?:placeholder|blocked).*consent/i;
var GENERIC_BANNER = /(?:cookie|consent).*(?:banner|popup|notice|modal|overlay|bar)$|^(?:cookie-?)?consent-?(?:banner|popup|notice|modal|overlay|bar)/i;
var CONSENT_STATE = `(() => {
  const MARKERS = ${JSON.stringify(CONSENT_MARKERS)};
  const GP = ${GENERIC_PLACEHOLDER.toString()};
  const GB = ${GENERIC_BANNER.toString()};
  const match = (id, classes) => {
    for (const m of MARKERS) {
      if (m.id !== undefined && id && (m.idPrefix ? id.indexOf(m.id) === 0 : id === m.id)) return m;
      if (m.cls !== undefined && classes.some((c) => (m.classPrefix ? c.indexOf(m.cls) === 0 : c === m.cls))) return m;
    }
    for (const c of classes) {
      if (!/consent/i.test(c)) continue;
      if (GP.test(c)) return { vendor: 'generic', kind: 'placeholder' };
      if (GB.test(c)) return { vendor: 'generic', kind: 'banner' };
    }
    return null;
  };
  const out = [];
  const seen = new Set();
  for (const e of Array.from(document.querySelectorAll('[id],[class]'))) {
    const classes = typeof e.className === 'string' ? e.className.split(/\\s+/).filter(Boolean) : Array.from(e.classList || []);
    const m = match(e.id || '', classes);
    if (!m) continue;
    // The outermost container only: the children of a banner are the banner.
    let inner = false;
    for (let p = e.parentElement; p; p = p.parentElement) if (seen.has(p)) { inner = true; break; }
    seen.add(e);
    if (inner) continue;
    const sel = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (classes[0] ? '.' + classes[0] : '');
    out.push(m.kind + ' ' + m.vendor + ' ' + sel);
    if (out.length >= 10) break;
  }
  return out;
})()`;

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
var LOADING_STATE = `(() => {
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
  const PHRASE = /^(chargement( en cours)?|veuillez patienter|loading|please wait)\\s*(\\.{1,3}|\u2026)?$/i;
  const text = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
  if (document.body) for (const e of Array.from(document.body.querySelectorAll('p,span,div,li,h1,h2,h3,h4,h5,h6,strong,em,output,[role="status"]'))) {
    const t = text(e);
    if (t.length > 40 || !PHRASE.test(t)) continue;
    if (Array.from(e.children).some((c) => PHRASE.test(text(c)))) continue;
    if (shown(e)) out.push('text "' + t + '" ' + name(e));
  }
  return out.slice(0, 10);
})()`;
async function waitForLoaded(page, timeoutMs, intervalMs = 150) {
  const started = Date.now();
  for (; ; ) {
    let markers = [];
    try {
      const r = await page.evaluate(LOADING_STATE);
      markers = Array.isArray(r) ? r.filter((m) => typeof m === "string") : [];
    } catch {
      return { markers: [], waitedMs: Date.now() - started };
    }
    const waitedMs = Date.now() - started;
    if (!markers.length || waitedMs >= timeoutMs) return { markers, waitedMs };
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, Math.max(1, timeoutMs - waitedMs))));
  }
}
var LOADING_TIMEOUT_MS = 1e4;
var FULL_SCREENSHOT_MAX_HEIGHT = 8e3;
var ELEMENT_WALK = `(root) => {
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
      // no computed style and an empty box, which the rules read as \xAB nothing measured \xBB.
      if (name === 'noscript' && child.children.length === 0 && (child.textContent || '').includes('<')) {
        const parsed = document.createElement('template');
        parsed.innerHTML = child.textContent || '';
        walkElements(parsed.content);
        continue;
      }
      walkElements(name === 'template' && child.content ? child.content : child);
    }
  };
  walkElements(root);
  return els;
}`;
var COLLECT_SNAPSHOT = `(() => {
  const PROPS = ${JSON.stringify(COLLECTED_CSS)};
  const MAX = ${COLLECT_MAX_ELEMENTS};
  const els = (${ELEMENT_WALK})(document);
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
    // The document's full height, so the producer knows whether a full-page screenshot adds
    // anything to the viewport one.
    docHeight: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0),
    // Still loading at the instant of collection: the markers, or none. Every producer runs
    // this same collector, so every producer can say so \u2014 see LOADING_STATE.
    loading: ${LOADING_STATE},
    // The consent placeholders and banners on the page (#184): a headless capture never
    // accepts cookies, so what they show is \xAB \xE9tat sans consentement \xBB, not content.
    consent: ${CONSENT_STATE},
    styles: { v: 1, entries: styles, truncated: truncated },
    boxes: { v: 1, entries: boxes, truncated: truncated }
  };
})()`;

// src/behaviour.ts
var SCRIPTS_VERSION = 1;
var BEHAVIOUR_WINDOW_MS = 2e3;
var BEHAVIOUR_CAPS = {
  listeners: 200,
  inline: 200,
  ariaMutations: 100,
  liveRegions: 50,
  updates: 50,
  motion: 30,
  animations: 30,
  resources: 100,
  intervals: 50
};
var ACTIVATION_EVENTS = ["click", "dblclick", "auxclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"];
var HOVER_EVENTS = ["mouseover", "mouseenter", "mouseout", "mouseleave", "pointerover", "pointerenter", "pointerout", "pointerleave"];
var KEY_EVENTS = ["keydown", "keyup", "keypress"];
var FOCUS_EVENTS = ["focus", "blur", "focusin", "focusout"];
var WATCHED = /* @__PURE__ */ new Set([...ACTIVATION_EVENTS, ...HOVER_EVENTS, ...KEY_EVENTS, ...FOCUS_EVENTS]);
var TIMER_HOOK_BODY = (since) => `
  if (!window.__ultra11yTimers) {
    const t = { since: '${since}', intervals: new Map(), timeouts: 0, long: [], paused: false, orig: { si: window.setInterval, ci: window.clearInterval, st: window.setTimeout } };
    window.setInterval = function (fn, delay, ...rest) {
      const id = t.orig.si.call(this, fn, delay, ...rest);
      if (t.intervals.size < 500) t.intervals.set(id, Number(delay) || 0);
      return id;
    };
    window.clearInterval = function (id) {
      t.intervals.delete(id);
      return t.orig.ci.call(this, id);
    };
    window.setTimeout = function (fn, delay, ...rest) {
      if (!t.paused) {
        t.timeouts++;
        const d = Number(delay) || 0;
        if (d >= 20000 && t.long.length < 20) t.long.push(d);
      }
      return t.orig.st.call(this, fn, delay, ...rest);
    };
    Object.defineProperty(window, '__ultra11yTimers', { value: t, configurable: true, enumerable: false, writable: true });
  }`;
var TIMER_HOOK = `(() => {${TIMER_HOOK_BODY("init")}
})()`;
var BEHAVIOUR_START = `(() => {
  if (window.__ultra11yBehaviour) return true;
  const els = (${ELEMENT_WALK})(document);
  const idx = new Map();
  for (let i = 0; i < els.length; i++) idx.set(els[i], i);
  const installedTimers = !window.__ultra11yTimers;
  ${TIMER_HOOK_BODY("window")}
  // A window counts the page's timers: a hook an earlier window left paused (its close never
  // ran) counts again from here.
  window.__ultra11yTimers.paused = false;
  const B = { idx: idx, els: els, phase: 'idle', t0: performance.now(), idleMs: undefined, changed: new Map(), aria: new Map(), installedTimers: installedTimers, overflow: { changed: 0, aria: 0 }, batch: 0 };
  const inHead = (n) => !!(document.head && (n === document.head || document.head.contains(n)));
  const OWN = /^(STYLE|SCRIPT|LINK)$/;
  const track = (el, kind) => {
    if (!el || el.nodeType !== 1 || inHead(el)) return;
    let r = B.changed.get(el);
    if (!r) {
      if (B.changed.size >= 500) { B.overflow.changed++; return; }
      r = { idle: new Set(), interaction: 0, kinds: new Set() };
      B.changed.set(el, r);
    }
    if (B.phase === 'idle') r.idle.add(B.batch);
    else r.interaction++;
    r.kinds.add(kind);
  };
  B.mo = new MutationObserver((records) => {
    B.batch++;
    for (const m of records) {
      if (m.type === 'attributes') {
        const n = m.attributeName || '';
        // The probes tag what they measure; their own marks are not the page's behaviour.
        if (n.indexOf('data-u11y') === 0) continue;
        const el = m.target;
        if (n.indexOf('aria-') === 0 || n === 'role') {
          let a = B.aria.get(el);
          if (!a) {
            if (B.aria.size >= 300) { B.overflow.aria++; continue; }
            a = new Map();
            B.aria.set(el, a);
          }
          let rec = a.get(n);
          if (!rec) { rec = { from: m.oldValue, values: [], count: 0, phases: new Set() }; a.set(n, rec); }
          rec.count++;
          rec.phases.add(B.phase);
          if (rec.values.length < 6) rec.values.push(el.getAttribute(n));
        }
        track(el, 'attr:' + n);
      } else if (m.type === 'childList') {
        let real = false;
        for (const a of m.addedNodes) if (!(a.nodeType === 1 && OWN.test(a.nodeName))) real = true;
        for (const a of m.removedNodes) if (!(a.nodeType === 1 && OWN.test(a.nodeName))) real = true;
        if (real) track(m.target, 'children');
      } else if (m.type === 'characterData') {
        track(m.target.parentElement, 'text');
      }
    }
  });
  B.mo.observe(document.documentElement, { subtree: true, attributes: true, attributeOldValue: true, childList: true, characterData: true });
  const NATIVE = new Set(['button', 'select', 'textarea', 'summary', 'option', 'label', 'iframe']);
  B.native = (el) => {
    const t = el.localName;
    if (t === 'a' || t === 'area') return el.hasAttribute('href');
    if (t === 'input') return (el.getAttribute('type') || '').toLowerCase() !== 'hidden';
    if (t === 'video' || t === 'audio') return el.hasAttribute('controls');
    return NATIVE.has(t) || el.isContentEditable === true;
  };
  B.selector = (el) => {
    if (el.id) return el.localName + '#' + el.id;
    const parts = [];
    let e = el;
    for (let depth = 0; e && e.nodeType === 1 && depth < 4; depth++) {
      if (e.id) { parts.unshift(e.localName + '#' + e.id); break; }
      let p = e.localName;
      const cls = (e.getAttribute('class') || '').trim().split(/\\s+/)[0];
      if (cls) p += '.' + cls;
      const parent = e.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((c) => c.localName === e.localName);
        if (same.length > 1) p += ':nth-of-type(' + (same.indexOf(e) + 1) + ')';
      }
      parts.unshift(p);
      e = parent;
    }
    return parts.join(' > ');
  };
  B.openTag = (el) => {
    let s = '<' + el.localName;
    for (const a of Array.from(el.attributes)) {
      if (a.name.indexOf('data-u11y') === 0) continue;
      s += ' ' + a.name + (a.value === '' ? '' : '="' + a.value.slice(0, 60) + '"');
      if (s.length > 160) break;
    }
    return (s + '>').slice(0, 160);
  };
  B.describe = (el) => {
    if (!el) return null;
    if (el.nodeType === 9) return { i: -1, tag: '#document', selector: 'document', root: true };
    if (el.nodeType !== 1) return null;
    const i = B.idx.has(el) ? B.idx.get(el) : -1;
    const role = el.getAttribute('role');
    const tabindex = el.getAttribute('tabindex');
    return {
      i: i,
      tag: el.localName,
      selector: B.selector(el),
      html: B.openTag(el),
      native: B.native(el),
      ...(role !== null ? { role: role } : {}),
      ...(tabindex !== null ? { tabindex: tabindex } : {}),
      root: el === document.documentElement || el === document.body,
    };
  };
  Object.defineProperty(window, '__ultra11yBehaviour', { value: B, configurable: true, enumerable: false, writable: true });
  return true;
})()`;
var BEHAVIOUR_MARK = `(() => {
  const B = window.__ultra11yBehaviour;
  if (!B) return false;
  B.phase = 'interaction';
  B.idleMs = Math.round(performance.now() - B.t0);
  // axe and the probes schedule timeouts of their own once the page is in their hands: the count
  // is taken here and the hook paused until the window closes, so the page's are never mixed
  // with ours \u2014 not in this window, and not in a later one the same hook serves.
  const T = window.__ultra11yTimers;
  B.timeoutsAtMark = T ? T.timeouts : 0;
  B.longAtMark = T ? T.long.length : 0;
  if (T) T.paused = true;
  return true;
})()`;
var behaviourFinishExpr = (domListeners) => `(() => {
  const B = window.__ultra11yBehaviour;
  if (!B) return null;
  try { B.mo.disconnect(); } catch (e) {}
  const CAPS = ${JSON.stringify(BEHAVIOUR_CAPS)};
  const truncated = {};
  const cap = (name, list) => {
    if (list.length > CAPS[name]) { truncated[name] = list.length; return list.slice(0, CAPS[name]); }
    return list;
  };
  const el$ = (el) => { const d = B.describe(el); return { i: d.i, tag: d.tag, selector: d.selector, html: d.html }; };
  const byI = (a, b) => (a.i - b.i) || (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0);
  const live = Array.from(B.els).filter((e) => e.isConnected);
  // Inline handlers, on what was serialized.
  const inline = [];
  for (const e of live) {
    const attrs = Array.from(e.attributes).map((a) => a.name.toLowerCase()).filter((n) => n.indexOf('on') === 0 && n.length > 2).sort();
    if (attrs.length) inline.push({ ...el$(e), attrs: attrs });
  }
  // The listeners the DOM alone can show.
  let domL = null;
  if (${domListeners ? "true" : "false"}) {
    const EVENTS = ${JSON.stringify([...WATCHED])};
    domL = [];
    const read = (target) => {
      const ev = new Set();
      if (target.attributes) for (const a of Array.from(target.attributes)) {
        const n = a.name.toLowerCase();
        if (n.indexOf('on') === 0 && EVENTS.indexOf(n.slice(2)) >= 0) ev.add(n.slice(2));
      }
      for (const t of EVENTS) { try { if (typeof target['on' + t] === 'function') ev.add(t); } catch (e) {} }
      return Array.from(ev).sort();
    };
    for (const e of live) {
      const events = read(e);
      if (events.length) domL.push({ facts: B.describe(e), events: events });
    }
    const de = read(document);
    if (de.length) domL.push({ facts: B.describe(document), events: de });
    const we = [];
    for (const t of EVENTS) { try { if (typeof window['on' + t] === 'function') we.push(t); } catch (e) {} }
    if (we.length) domL.push({ facts: { i: -1, tag: '#window', selector: 'window', root: true }, events: we });
  }
  // ARIA mutations.
  const ariaMutations = [];
  for (const [el, attrs] of B.aria) {
    for (const [name, rec] of attrs) {
      const phase = rec.phases.size > 1 ? 'both' : rec.phases.has('idle') ? 'idle' : 'interaction';
      ariaMutations.push({ ...el$(el), attr: name, from: rec.from === undefined ? null : rec.from, values: rec.values, count: rec.count, phase: phase });
    }
  }
  ariaMutations.sort((a, b) => byI(a, b) || (a.attr < b.attr ? -1 : 1));
  // Live regions, and whether what they hold changed.
  const REGION = '[aria-live],[role~="status"],[role~="alert"],[role~="log"],[role~="marquee"],[role~="timer"],output';
  const changedEls = Array.from(B.changed.keys());
  const liveRegions = [];
  for (const r of Array.from(document.querySelectorAll(REGION))) {
    const changed = changedEls.some((c) => r === c || r.contains(c));
    const lv = r.getAttribute('aria-live');
    const role = r.getAttribute('role');
    const atomic = r.getAttribute('aria-atomic');
    liveRegions.push({ ...el$(r), ...(lv !== null ? { live: lv } : {}), ...(role !== null ? { role: role } : {}), ...(atomic !== null ? { atomic: atomic } : {}), changed: changed });
  }
  liveRegions.sort(byI);
  // Content updated on interaction outside any live region, and what moved on its own.
  const updates = [];
  const motion = [];
  for (const [el, r] of B.changed) {
    if (!el.isConnected) continue;
    const kinds = Array.from(r.kinds).sort();
    if (r.interaction > 0 && (r.kinds.has('children') || r.kinds.has('text')) && !el.closest(REGION)) updates.push({ ...el$(el), kinds: kinds });
    if (r.idle.size >= 2) motion.push({ ...el$(el), changes: r.idle.size, kinds: kinds });
  }
  updates.sort(byI);
  motion.sort(byI);
  // Long CSS animations \u2014 moving content by the stylesheet's own declaration.
  const animations = [];
  try {
    for (const a of document.getAnimations ? document.getAnimations() : []) {
      const target = a.effect && a.effect.target;
      if (!target || target.nodeType !== 1) continue;
      const t = a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
      const iterations = t.iterations === Infinity ? 'infinite' : Number(t.iterations) || 1;
      const durationMs = Math.round(Number(t.duration) || 0);
      if (iterations !== 'infinite' && durationMs * iterations <= 5000) continue;
      animations.push({ ...el$(target), name: String(a.animationName || a.transitionProperty || a.id || 'animation'), iterations: iterations, durationMs: durationMs });
    }
  } catch (e) {}
  animations.sort(byI);
  // Timers.
  const T = window.__ultra11yTimers;
  const inlineText = Array.from(document.scripts).filter((s) => !s.src).map((s) => s.textContent || '').join('\\n');
  const count = (re) => (inlineText.match(re) || []).length;
  const refresh = document.querySelector('meta[http-equiv="refresh" i]');
  const timers = {
    source: T ? T.since : 'none',
    intervals: T ? cap('intervals', Array.from(T.intervals.values()).sort((a, b) => a - b)) : [],
    timeouts: T ? (B.timeoutsAtMark !== undefined ? B.timeoutsAtMark : T.timeouts) : 0,
    longTimeouts: T ? T.long.slice(0, B.longAtMark !== undefined ? B.longAtMark : T.long.length).sort((a, b) => a - b) : [],
    inlineSetInterval: count(/\\bsetInterval\\s*\\(/g),
    inlineSetTimeout: count(/\\bsetTimeout\\s*\\(/g),
    ...(refresh ? { metaRefresh: refresh.getAttribute('content') || '' } : {}),
  };
  if (T && B.installedTimers) {
    window.setInterval = T.orig.si;
    window.clearInterval = T.orig.ci;
    window.setTimeout = T.orig.st;
    try { delete window.__ultra11yTimers; } catch (e) {}
  } else if (T) {
    // The hook outlives this window (installed at navigation): the page is the page's again.
    T.paused = false;
  }
  // The scripts and stylesheets loaded \u2014 the ones the page had when the window opened.
  const sizeOf = (url) => {
    try {
      const e = performance.getEntriesByName(url)[0];
      const n = e ? (e.encodedBodySize || e.transferSize || e.decodedBodySize || 0) : 0;
      return n > 0 ? { size: n } : {};
    } catch (e) { return {}; }
  };
  const originOf = (url) => { try { return new URL(url, location.href).origin === location.origin ? 'same-origin' : 'cross-origin'; } catch (e) { return 'cross-origin'; } };
  const resources = [];
  for (const e of live) {
    const t = e.localName;
    if (t === 'script') {
      const src = e.getAttribute('src');
      if (src) resources.push({ kind: 'script', origin: originOf(e.src), url: e.src, ...sizeOf(e.src) });
      else if ((e.textContent || '').trim()) resources.push({ kind: 'script', origin: 'inline', size: (e.textContent || '').length });
    } else if (t === 'link' && /(^|\\s)stylesheet(\\s|$)/i.test(e.getAttribute('rel') || '') && e.getAttribute('href')) {
      resources.push({ kind: 'stylesheet', origin: originOf(e.href), url: e.href, ...sizeOf(e.href) });
    } else if (t === 'style' && (e.textContent || '').trim()) {
      resources.push({ kind: 'stylesheet', origin: 'inline', size: (e.textContent || '').length });
    }
  }
  const idleMs = B.idleMs !== undefined ? B.idleMs : Math.round(performance.now() - B.t0);
  const windowMs = Math.round(performance.now() - B.t0);
  if (B.overflow.changed) truncated.changed = B.changed.size + B.overflow.changed;
  if (B.overflow.aria) truncated.ariaElements = B.aria.size + B.overflow.aria;
  try { delete window.__ultra11yBehaviour; } catch (e) {}
  return {
    windowMs: windowMs,
    idleMs: idleMs,
    inline: cap('inline', inline),
    domListeners: domL,
    ariaMutations: cap('ariaMutations', ariaMutations),
    liveRegions: cap('liveRegions', liveRegions),
    updates: cap('updates', updates),
    motion: cap('motion', motion),
    animations: cap('animations', animations),
    timers: timers,
    resources: cap('resources', resources),
    truncated: truncated,
  };
})()`;
function classifyListener(facts, events) {
  const has = (list) => events.some((e) => list.includes(e));
  const activation = has(ACTIVATION_EVENTS);
  const hover = has(HOVER_EVENTS);
  const key = has(KEY_EVENTS);
  const focus = has(FOCUS_EVENTS);
  const native = facts.native === true;
  const role = facts.role !== void 0 && facts.role.trim() !== "" ? facts.role : void 0;
  const tabindex = facts.tabindex !== void 0 ? facts.tabindex : void 0;
  return {
    i: facts.i,
    tag: facts.tag,
    selector: facts.selector,
    ...facts.html ? { html: facts.html } : {},
    events: [...events].sort(),
    native,
    ...role !== void 0 ? { role } : {},
    ...tabindex !== void 0 ? { tabindex } : {},
    flagged: activation && !native && role === void 0 && tabindex === void 0,
    // An activation a keyboard cannot fire (a native control's click IS keyboard-fired), or a
    // hover reaction with neither a focus nor a key counterpart.
    mouseOnly: activation && !native && !key || hover && !focus && !key
  };
}
function assembleDigest(raw, targets, collected, why) {
  if (!raw) return noDigest("the capture window closed before it could be read (the page navigated or reloaded during it)");
  const listeners = [];
  const delegated = [];
  for (const t of targets ?? []) {
    const events = [...new Set(t.events.filter((e) => WATCHED.has(e)))].sort();
    if (!events.length) continue;
    if (t.facts.root) delegated.push({ target: t.facts.selector === "window" || t.facts.selector === "document" ? t.facts.selector : t.facts.tag, events });
    else listeners.push(classifyListener(t.facts, events));
  }
  listeners.sort((a, b) => a.i - b.i || a.selector.localeCompare(b.selector));
  delegated.sort((a, b) => a.target.localeCompare(b.target));
  const truncated = { ...raw.truncated ?? {} };
  const capped = (name, list) => {
    if (list.length <= BEHAVIOUR_CAPS[name]) return list;
    truncated[name] = list.length;
    return list.slice(0, BEHAVIOUR_CAPS[name]);
  };
  const ranked = [...listeners.filter((l) => l.flagged || l.mouseOnly), ...listeners.filter((l) => !l.flagged && !l.mouseOnly)];
  const kept = capped("listeners", ranked).sort((a, b) => a.i - b.i || a.selector.localeCompare(b.selector));
  return {
    v: SCRIPTS_VERSION,
    collected,
    ...why ? { why } : {},
    ...typeof raw.windowMs === "number" ? { windowMs: raw.windowMs } : {},
    ...typeof raw.idleMs === "number" ? { idleMs: raw.idleMs } : {},
    listeners: kept,
    delegated,
    inline: raw.inline ?? [],
    ariaMutations: raw.ariaMutations ?? [],
    liveRegions: raw.liveRegions ?? [],
    updates: raw.updates ?? [],
    motion: raw.motion ?? [],
    animations: raw.animations ?? [],
    ...raw.timers ? { timers: raw.timers } : {},
    resources: raw.resources ?? [],
    caps: { ...BEHAVIOUR_CAPS },
    ...Object.keys(truncated).length ? { truncated } : {}
  };
}
function noDigest(why) {
  return { v: SCRIPTS_VERSION, collected: "none", why, caps: { ...BEHAVIOUR_CAPS } };
}
var DESCRIBE_THIS = `function () { const B = window.__ultra11yBehaviour; return B ? B.describe(this) : null; }`;
var sleep = (page, ms) => page.waitForTimeout ? page.waitForTimeout(ms) : new Promise((resolve) => setTimeout(resolve, ms));
var firstLine = (e) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 200);
function pageListeners(list) {
  const instrumentation = new Set(list.filter((l) => l.type.startsWith("__playwright")).map((l) => l.scriptId));
  return list.filter((l) => !(l.scriptId !== void 0 && instrumentation.has(l.scriptId)));
}
async function cdpListeners(s) {
  const group = "ultra11y-behaviour";
  const evaluate = async (expression) => (await s.send("Runtime.evaluate", { expression, objectGroup: group })).result?.objectId;
  try {
    await s.send("DOM.getDocument", { depth: 0 });
    const docId = await evaluate("document");
    if (!docId) throw new Error("no document object");
    const all = pageListeners(
      (await s.send("DOMDebugger.getEventListeners", { objectId: docId, depth: -1, pierce: false })).listeners ?? []
    );
    const byNode = /* @__PURE__ */ new Map();
    for (const l of all) {
      if (l.backendNodeId === void 0 || !WATCHED.has(l.type)) continue;
      const set = byNode.get(l.backendNodeId) ?? /* @__PURE__ */ new Set();
      set.add(l.type);
      byNode.set(l.backendNodeId, set);
    }
    const out = [];
    const nodes = [...byNode.entries()].slice(0, BEHAVIOUR_CAPS.listeners * 3);
    for (const [backendNodeId, events] of nodes) {
      try {
        const resolved = await s.send("DOM.resolveNode", { backendNodeId, objectGroup: group });
        const objectId = resolved.object?.objectId;
        if (!objectId) continue;
        const r = await s.send("Runtime.callFunctionOn", { objectId, functionDeclaration: DESCRIBE_THIS, returnByValue: true });
        const facts = r.result?.value;
        if (facts) out.push({ facts, events: [...events] });
      } catch {
      }
    }
    const winId = await evaluate("window");
    if (winId) {
      const w = pageListeners((await s.send("DOMDebugger.getEventListeners", { objectId: winId })).listeners ?? []);
      const events = [...new Set(w.map((l) => l.type).filter((t) => WATCHED.has(t)))];
      if (events.length) out.push({ facts: { i: -1, tag: "#window", selector: "window", root: true }, events });
    }
    return out;
  } finally {
    await s.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {
    });
  }
}
async function startBehaviour(page, opts = {}) {
  let opened = false;
  let why = "";
  try {
    opened = await page.evaluate(BEHAVIOUR_START) === true;
    if (!opened) why = "the page refused the capture script";
  } catch (e) {
    why = `the capture script failed: ${firstLine(e)}`;
  }
  let marked = false;
  let targets;
  let fallback = "";
  const readListeners = async () => {
    const ctx = opts.cdp === false ? void 0 : page.context?.();
    const newSession = ctx?.newCDPSession;
    if (!ctx || !newSession) {
      targets = null;
      fallback = opts.cdp === false ? "CDP disabled by the producer" : "no CDP session on this page object";
      return;
    }
    let session;
    try {
      session = await newSession.call(ctx, page);
      targets = await cdpListeners(session);
    } catch (e) {
      targets = null;
      fallback = `CDP unavailable: ${firstLine(e)}`;
    } finally {
      await session?.detach?.().catch(() => {
      });
    }
  };
  return {
    async idle(ms = BEHAVIOUR_WINDOW_MS) {
      if (!opened || marked) return;
      await sleep(page, ms);
      marked = true;
      await page.evaluate(BEHAVIOUR_MARK).catch(() => {
      });
      await readListeners();
    },
    async finish() {
      if (!opened) return noDigest(why);
      if (!marked) {
        marked = true;
        await page.evaluate(BEHAVIOUR_MARK).catch(() => {
        });
      }
      if (targets === void 0) await readListeners();
      const found = targets ?? null;
      let raw;
      try {
        raw = await page.evaluate(behaviourFinishExpr(found === null));
      } catch (e) {
        return noDigest(`the capture window could not be read: ${firstLine(e)}`);
      }
      if (found !== null) return assembleDigest(raw, found, "cdp");
      return assembleDigest(raw, raw?.domListeners ?? [], "dom", `${fallback} \u2014 listeners attached with addEventListener are invisible to the DOM`);
    }
  };
}

// src/document-store.ts
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
var DOCUMENTS_DIR = ".ultra11y/documents";
var DOCUMENT_MAX_COUNT = 20;
var DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
var DOCUMENT_TIMEOUT_MS = 2e4;
var PDF_WORD = /(?:^|[^\p{L}\p{N}])pdf(?:$|[^\p{L}\p{N}])/iu;
function namesPdf(s) {
  return !!s && PDF_WORD.test(s);
}
function urlNamesPdf(u) {
  let s = `${u.pathname}${u.search}`;
  try {
    s = decodeURIComponent(s);
  } catch {
  }
  return s.split(/[^\p{L}\p{N}]+/u).some((tok) => tok.toLowerCase() === "pdf");
}
function documentCandidate(link, page, base = page) {
  const href = (link.href ?? "").trim();
  if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel|data|blob):/i.test(href)) return void 0;
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return void 0;
  }
  if (u.protocol !== page.protocol) return void 0;
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "file:") return void 0;
  if ((u.protocol === "http:" || u.protocol === "https:") && u.host !== page.host) return void 0;
  const candidate = /\.pdf$/i.test(u.pathname) || (link.type ?? "").trim().toLowerCase() === "application/pdf" || link.download === true || namesPdf(link.text) || namesPdf(link.ariaLabel) || namesPdf(link.title) || urlNamesPdf(u);
  if (!candidate) return void 0;
  u.hash = "";
  return u.href;
}
function hasPdfHeader(bytes) {
  return bytes.toString("latin1", 0, Math.min(bytes.length, 1024)).includes("%PDF-");
}
function looksLikePdf(contentType, bytes) {
  const ct = (contentType ?? "").split(";")[0].trim().toLowerCase();
  return ct === "application/pdf" || hasPdfHeader(bytes);
}
function sameOriginHop(start, next) {
  if (next.protocol !== "http:" && next.protocol !== "https:") return false;
  if (next.origin === start.origin) return true;
  return start.protocol === "http:" && next.protocol === "https:" && next.hostname === start.hostname;
}
async function fetchDocument(url, fetcher, opts = {}) {
  const maxBytes = opts.maxBytes ?? DOCUMENT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? 5;
  let start;
  try {
    start = new URL(url);
  } catch {
    return { reason: `unreadable URL ${url}` };
  }
  let current = url;
  for (let hop = 0; ; hop++) {
    let res;
    try {
      res = await fetcher(current);
    } catch (e) {
      return { reason: `request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status >= 300 && res.status < 400 && res.header("location")) {
      await res.discard?.().catch(() => void 0);
      if (hop >= maxRedirects) return { reason: `more than ${maxRedirects} redirects` };
      let next;
      try {
        next = new URL(res.header("location"), current);
      } catch {
        return { reason: `unreadable redirect to ${res.header("location")}` };
      }
      if (!sameOriginHop(start, next)) return { reason: `redirected off-origin to ${next.href}` };
      current = next.href;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      await res.discard?.().catch(() => void 0);
      return { reason: `HTTP ${res.status}` };
    }
    const declared = Number(res.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.discard?.().catch(() => void 0);
      return { reason: `larger than ${maxBytes} bytes` };
    }
    let bytes;
    try {
      bytes = await res.body(maxBytes);
    } catch (e) {
      return { reason: `request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!bytes) return { reason: `larger than ${maxBytes} bytes` };
    const type = res.header("content-type");
    if (!looksLikePdf(type, bytes))
      return { reason: `not a PDF \u2014 the response is ${type ? type.split(";")[0].trim() : "untyped"} with no %PDF- header (a login page, an error page?)` };
    return { bytes, url: current };
  }
}
var SIDECAR_KIND = "ultra11y-document";
var SIDECAR_VERSION = 1;
function readDocumentOrigin(pdfPath) {
  const side = pdfPath.replace(/\.pdf$/i, ".json");
  if (side === pdfPath || !existsSync(side)) return void 0;
  try {
    const raw = JSON.parse(readFileSync(side, "utf8"));
    if (!raw || typeof raw !== "object" || raw.v !== SIDECAR_VERSION) return void 0;
    if (raw.kind !== SIDECAR_KIND && !(raw.kind === void 0 && /(?:^|[\\/])[0-9a-f]{64}\.pdf$/i.test(pdfPath))) return void 0;
    const url = typeof raw.url === "string" ? raw.url : void 0;
    const pages = Array.isArray(raw.pages) ? raw.pages.filter((p) => typeof p === "string") : void 0;
    return { ...url ? { url } : {}, ...pages?.length ? { pages: [...new Set(pages)].sort() } : {} };
  } catch {
    return void 0;
  }
}
function recordDocumentPages(file, url, pageIds) {
  const prev = readDocumentOrigin(file);
  const pages = [.../* @__PURE__ */ new Set([...prev?.pages ?? [], ...pageIds])].sort();
  writeFileSync(file.replace(/\.pdf$/i, ".json"), `${JSON.stringify({ kind: SIDECAR_KIND, v: SIDECAR_VERSION, url: prev?.url ?? url, pages }, null, 2)}
`);
}
function storeDocument(root, url, bytes, pageIds) {
  const dir = join(root, DOCUMENTS_DIR);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const file = join(dir, `${sha}.pdf`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, bytes);
  recordDocumentPages(file, url, pageIds);
  return file;
}

// src/axe-engine.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { createRequire } from "module";
import { dirname, join as join2 } from "path";
import { fileURLToPath } from "url";
var AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
var AXE_CORE_PIN = "4.13.0";
var BUILDER_SPEC = "@axe-core/playwright";
var SOURCE_SPEC = "axe-core/axe.min.js";
var PACKAGE_SPEC = "axe-core/package.json";
var sourceCache = /* @__PURE__ */ new Map();
function locateSource(anchor) {
  const tryFrom = (from) => {
    try {
      const req = createRequire(from);
      const path = req.resolve(SOURCE_SPEC);
      const version = req(PACKAGE_SPEC).version ?? "unknown";
      return { path, version };
    } catch {
      return void 0;
    }
  };
  const direct = tryFrom(anchor);
  if (direct) return direct;
  try {
    return tryFrom(createRequire(anchor).resolve(BUILDER_SPEC));
  } catch {
    return void 0;
  }
}
function loadBuilder(anchor) {
  try {
    const mod = createRequire(anchor)(BUILDER_SPEC);
    const B = mod.default ?? mod.AxeBuilder ?? mod;
    return typeof B === "function" ? B : void 0;
  } catch {
    return void 0;
  }
}
function insideUltra11y(anchor) {
  let dir;
  try {
    dir = dirname(anchor.startsWith("file:") ? fileURLToPath(anchor) : anchor);
  } catch {
    return false;
  }
  for (; ; ) {
    const manifest = join2(dir, "package.json");
    if (existsSync2(manifest)) {
      try {
        return JSON.parse(readFileSync2(manifest, "utf8")).name === "ultra11y";
      } catch {
        return false;
      }
    }
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}
function resolveAxeEngine(opts) {
  const self = opts.self ?? import.meta.url;
  const project = join2(opts.cwd, "package.json");
  const AxeBuilder = loadBuilder(self) ?? loadBuilder(project);
  if (!AxeBuilder) {
    throw new Error(`${BUILDER_SPEC} resolves neither from ultra11y itself nor from ${opts.cwd}.`);
  }
  const own = locateSource(self);
  const located = own ?? locateSource(project);
  if (!located) throw new Error(`axe-core resolves neither from ultra11y itself nor from ${opts.cwd}.`);
  let source = sourceCache.get(located.path);
  if (source === void 0) {
    source = readFileSync2(located.path, "utf8");
    sourceCache.set(located.path, source);
  }
  const origin = own && insideUltra11y(self) ? located.version === AXE_CORE_PIN ? "ultra11y" : "unpinned" : "project";
  const note = origin === "project" ? `ultra11y: its own axe-core ${AXE_CORE_PIN} is not resolvable here \u2014 running the audited project's axe-core ${located.version} (${located.path}). Results are recorded with that version; install ultra11y with its dependencies to run the pinned one.` : origin === "unpinned" ? `ultra11y: the axe-core resolved from ultra11y's own package is ${located.version}, not the pinned ${AXE_CORE_PIN} (${located.path}). Results are recorded with that version; reinstall ultra11y's dependencies to run the pinned one.` : void 0;
  return {
    AxeBuilder,
    source,
    sourcePath: located.path,
    version: located.version,
    origin,
    ...note ? { note } : {}
  };
}
async function runAxe(engine, page, runner) {
  const res = await new engine.AxeBuilder({ page, axeSource: engine.source }).withTags([...AXE_TAGS]).analyze();
  return {
    violations: res.violations ?? [],
    engine: { version: res.testEngine?.version ?? engine.version, origin: engine.origin, ...runner ? { runner } : {} }
  };
}

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
var DEV_TOOL_HOSTS = ["nextjs-portal", "vite-error-overlay", "astro-dev-toolbar", "nuxt-devtools-container", "nuxt-devtools"];
var FRAMES = `
const __frames = () => new Promise((res) => {
  let done = false;
  const end = () => { if (!done) { done = true; res(true); } };
  setTimeout(end, 200);
  try { requestAnimationFrame(() => requestAnimationFrame(end)); } catch { end(); }
});
`;
var REFLOW_TEXT_CAP = 5e3;
var REFLOW_PROBE = `(async () => { ${PRELUDE} ${FRAMES}
  await __frames();
  const el = document.scrollingElement || document.documentElement;
  const vw = el.clientWidth;
  const horizontalScroll = el.scrollWidth > vw + 2;
  if (!horizontalScroll) return { horizontalScroll };
  const sx = window.scrollX || 0;
  const contained = (e) => {
    for (let n = e.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (getComputedStyle(n).overflowX !== 'visible') return true;
    }
    return false;
  };
  const boxes = new Set();
  const outer = [];
  const content = [];
  for (const e of Array.from(document.querySelectorAll('body, body *'))) {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const s = getComputedStyle(e);
    if (s.position === 'fixed' || s.display === 'none' || s.visibility === 'hidden') continue;
    const boxOver = r.right + sx - vw;
    const contentOver = s.overflowX === 'visible' ? r.left + sx + e.scrollWidth - vw : 0;
    if (boxOver <= 2 && contentOver <= 2) continue;
    if (contained(e)) continue;
    if (boxOver > 2) {
      boxes.add(e);
      let top = true;
      for (let n = e.parentElement; n; n = n.parentElement) if (boxes.has(n)) { top = false; break; }
      if (top) outer.push([e, 'd\xE9borde de ' + Math.round(boxOver) + 'px \xE0 droite (largeur ' + Math.round(r.width) + 'px)']);
    } else {
      content.push([e, 'son contenu (texte ou pseudo-\xE9l\xE9ment) d\xE9borde de ' + Math.round(contentOver) + 'px \xE0 droite de la bo\xEEte']);
    }
  }
  // A box wider than the viewport is the cause; failing one, the DEEPEST element whose own
  // content (a long word, a ::before/::after) spills out \u2014 its ancestors only carry the spill.
  const deepest = content.filter(([e]) => !content.some(([o]) => o !== e && e.contains(o)) && !Array.from(boxes).some((b) => e.contains(b)));
  const widening = outer.concat(deepest).slice(0, 5).map(([e, d]) => ({ selector: __sel(e), html: __html(e), detail: d }));
  // A WIDE BOX IS NOT LOST CONTENT (#184). A footer logo sticking out by 8px makes the page
  // scroll sideways, and was reported on a dozen pages as if text had gone missing. What 1.4.10
  // is about is CONTENT the user has to scroll in two dimensions to reach: text and controls.
  // So the same pass measures, per element, which TEXT lays out beyond the viewport (the text
  // node's own line boxes, Range.getClientRects, not its container's box) and which controls or
  // replaced elements (a link, a field, an image) do. A box whose own text fits reports neither.
  const textOver = new Map();
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  // BOUNDED, AND SAYS SO. A walk that stops at the cap has not looked at the rest of the page,
  // so it must never read as \xAB no text beyond the viewport \xBB: capped travels with the counts.
  let seenText = 0;
  let capped = false;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.nodeValue || !t.nodeValue.trim()) continue;
    const p = t.parentElement;
    if (!p) continue;
    if (seenText >= ${REFLOW_TEXT_CAP}) { capped = true; break; }
    seenText++;
    const ps = getComputedStyle(p);
    if (ps.visibility === 'hidden' || ps.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    let over = 0;
    for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) over = Math.max(over, r.right + sx - vw);
    if (over <= 2) continue;
    if (contained(p)) continue;
    let fixed = false;
    for (let n = p; n && n !== document.documentElement; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') { fixed = true; break; }
    if (fixed) continue;
    const prev = textOver.get(p);
    textOver.set(p, { over: Math.max(over, prev ? prev.over : 0), text: ((prev ? prev.text + ' ' : '') + t.nodeValue.trim()).slice(0, 80) });
  }
  const textHits = Array.from(textOver.entries()).sort((a, b) => b[1].over - a[1].over);
  const CONTROL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[tabindex]:not([tabindex="-1"]),img,svg,video,iframe,canvas,object,embed';
  const controlHits = [];
  for (const e of Array.from(document.querySelectorAll(CONTROL))) {
    const r = e.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const over = r.right + sx - vw;
    if (over <= 2) continue;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'fixed') continue;
    if (contained(e)) continue;
    // The svg inside a link is the link: name the outermost control only.
    if (controlHits.some(([o]) => o.contains(e))) continue;
    for (let i = controlHits.length - 1; i >= 0; i--) if (e.contains(controlHits[i][0])) controlHits.splice(i, 1);
    controlHits.push([e, over, r.width, /^(img|svg|video|iframe|canvas|object|embed)$/i.test(e.tagName) ? 'replaced' : 'control']);
  }
  controlHits.sort((a, b) => b[1] - a[1]);
  const clipped = {
    text: textHits.slice(0, 5).map(([e, v]) => ({ selector: __sel(e), html: __html(e), detail: 'texte \xAB ' + v.text + ' \xBB pos\xE9 ' + Math.round(v.over) + 'px au-del\xE0 du bord droit du viewport' })),
    textCount: textHits.length,
    controls: controlHits.slice(0, 5).map(([e, over, w, kind]) => ({ selector: __sel(e), html: __html(e), detail: (kind === 'replaced' ? '\xE9l\xE9ment remplac\xE9' : 'contr\xF4le') + ' pos\xE9 ' + Math.round(over) + 'px au-del\xE0 du bord droit du viewport (largeur ' + Math.round(w) + 'px)' })),
    controlCount: controlHits.length,
    ...(capped ? { capped: true, textNodesWalked: seenText } : {}),
  };
  return { horizontalScroll, widening, clipped };
})()`;
var STRESS_LIB = `${FRAMES}
const __pause = (ms) => new Promise((res) => setTimeout(res, ms));
const __CONTROLS = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=switch],[tabindex]:not([tabindex="-1"])';
// How far the element's CONTENT \u2014 its text and its child boxes, as laid out \u2014 reaches past the
// padding box its overflow clips at. Not \`scrollWidth\`: that counts a child's margin too, and
// the spacing override gives every paragraph a 2em bottom margin, so a panel sized to its text
// would read as \xAB clipped \xBB by a margin nobody can see. And not one Range over the whole
// subtree either: an sr-only label is a 1px clipped box whose text is still laid out at full
// width, and counting that text would call every icon-only button \xAB clipped \xBB. A descendant
// that is not painted is skipped with everything inside it; one that clips its own overflow
// counts by its own box, its content being its own measurement; a panel's padding is not
// content, so a design system's tab container trimming its panel's bottom padding is not a loss.
const __REPLACED = ['img', 'svg', 'video', 'canvas', 'iframe', 'object', 'embed', 'input', 'select', 'textarea', 'button', 'meter', 'progress', 'audio'];
const __extent = (e) => {
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  const add = (q) => { if (!q || (!q.width && !q.height)) return; l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom); };
  const range = document.createRange();
  const walk = (n, depth) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) {
        if (!c.textContent || !c.textContent.trim()) continue;
        range.selectNodeContents(c);
        add(range.getBoundingClientRect());
      } else if (c.nodeType === 1) {
        const cs = getComputedStyle(c);
        if (cs.display === 'contents') { if (depth < 40) walk(c, depth + 1); continue; }
        if (!__vis(c)) continue;
        // CONTENT, not decoration: a replaced element or a form control counts by its box, a
        // box that clips counts by its box; any other element only through what it holds \u2014 its
        // padding, its background and its margins are nothing a reader can lose.
        if (__REPLACED.indexOf(c.localName) >= 0 || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') add(c.getBoundingClientRect());
        else if (depth < 40) walk(c, depth + 1);
      }
    }
  };
  walk(e, 0);
  return l === Infinity ? null : { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
};
const __excess = (e) => {
  const r = e.getBoundingClientRect();
  const left = r.left + e.clientLeft, top = r.top + e.clientTop;
  const right = left + e.clientWidth, bottom = top + e.clientHeight;
  const t = __extent(e);
  if (!t) return { x: 0, y: 0, sw: 1, sh: 1 };
  return {
    x: Math.max(0, t.right - right) + Math.max(0, left - t.left),
    y: Math.max(0, t.bottom - bottom) + Math.max(0, top - t.top),
    sw: Math.max(1, t.width),
    sh: Math.max(1, t.height),
  };
};
const __clipsX = (s) => s.overflowX === 'hidden' || s.overflowX === 'clip' || s.overflow === 'hidden' || s.textOverflow === 'ellipsis';
const __clipsY = (s) => s.overflowY === 'hidden' || s.overflowY === 'clip' || s.overflow === 'hidden';
const __clipBase = (sel) => {
  const m = new Map();
  for (const e of Array.from(document.querySelectorAll(sel))) {
    if (!__vis(e)) continue;
    if ((e.textContent || '').trim().length < 8) continue;
    // Only a box that CLIPS can lose content by clipping, and the stress changes spacing and
    // size, never a box's overflow \u2014 so the rest of the page is not measured at all.
    const s = getComputedStyle(e);
    if (!__clipsX(s) && !__clipsY(s)) continue;
    m.set(e, { ...__excess(e), slack: (parseFloat(s.fontSize) || 16) / 2 });
  }
  return m;
};
const __clipLost = (e, b, tol) => {
  if (!e.isConnected || !__vis(e)) return false;
  const s = getComputedStyle(e);
  const now = __excess(e);
  // Whole at baseline: any cut the stress makes is a loss. Cut by up to half a glyph (a fixed
  // box shaving its descenders): the stress must cut MORE, in pixels and as a share of the
  // content \u2014 a box sized in rem that hides a sliver at 100 % hides the same share at 200 %.
  // Cut by more than that: hidden by design, never reported.
  const lost = (clips, b0, s0, n0, s1) => {
    if (!clips || n0 <= tol) return false;
    if (b0 <= tol) return true;
    if (b0 > Math.max(tol, b.slack)) return false;
    return n0 - b0 > tol && n0 / s1 - b0 / s0 > 0.05;
  };
  return lost(__clipsX(s), b.x, b.sw, now.x, now.sw) || lost(__clipsY(s), b.y, b.sh, now.y, now.sh);
};
const __up = (n) => n.parentElement || (n.getRootNode && n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
const __within = (n, e) => { for (; n; n = __up(n)) if (n === e) return true; return false; };
const __fixedish = (n) => {
  for (; n && n !== document.documentElement; n = __up(n)) {
    if (${JSON.stringify(DEV_TOOL_HOSTS)}.indexOf((n.localName || '').toLowerCase()) >= 0) return true;
    const p = getComputedStyle(n).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
};
const __topAt = (e) => {
  let r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return undefined;
  const inView = (r) => {
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    return x >= 0 && y >= 0 && x < window.innerWidth && y < window.innerHeight;
  };
  if (!inView(r)) {
    window.scrollTo({ left: Math.max(0, window.scrollX + r.left + r.width / 2 - window.innerWidth / 2), top: Math.max(0, window.scrollY + r.top + r.height / 2 - window.innerHeight / 2), behavior: 'instant' });
    r = e.getBoundingClientRect();
    if (!inView(r)) return undefined;
  }
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  let t = document.elementFromPoint(x, y);
  // Into open shadow roots: the host is not what sits on top, its rendered content is \u2014 and a
  // dev-tools overlay's fixed layer lives in there.
  for (let i = 0; t && t.shadowRoot && i < 8; i++) {
    const d = t.shadowRoot.elementFromPoint(x, y);
    if (!d || d === t) break;
    t = d;
  }
  if (!t) return undefined;
  if (__within(t, e)) return null;
  if (t.tagName === 'LABEL' && t.control === e) return null;
  if (__within(e, t)) return undefined;
  return t;
};
const __hitBase = () => {
  const m = new Set();
  for (const e of Array.from(document.querySelectorAll(__CONTROLS))) {
    if (!__vis(e)) continue;
    if (__topAt(e) === null) m.add(e);
  }
  return m;
};
const __covered = (e) => {
  if (!e.isConnected || !__vis(e)) return null;
  const t = __topAt(e);
  if (!t || __fixedish(t)) return null;
  return t;
};
const __compare = async (base, tol, clipDetail, coverDetail, max) => {
  const look = () => {
    const clip = [];
    for (const [e, b] of base.clip) if (__clipLost(e, b, tol)) clip.push(e);
    const cover = [];
    for (const e of base.hit) { const t = __covered(e); if (t) cover.push([e, t]); }
    return { clip, cover };
  };
  await __frames();
  let first = look();
  if (first.clip.length || first.cover.length) {
    await __pause(150);
    await __frames();
    const again = look();
    const stillClip = new Set(again.clip);
    const stillCover = new Map(again.cover);
    first = { clip: first.clip.filter((e) => stillClip.has(e)), cover: first.cover.filter(([e]) => stillCover.has(e)).map(([e]) => [e, stillCover.get(e)]) };
  }
  const hits = [];
  for (const e of first.clip) {
    if (hits.length >= max) break;
    hits.push({ selector: __sel(e), html: __html(e), detail: clipDetail });
  }
  for (const [e, t] of first.cover) {
    if (hits.length >= max) break;
    hits.push({ selector: __sel(e), html: __html(e), detail: coverDetail.replace('{by}', __sel(t)) });
  }
  return hits;
};
`;
var REFLOW_ZOOM_PROBE = `(async () => { ${PRELUDE} ${STRESS_LIB}
  const root = document.documentElement;
  const prev = root.style.fontSize;
  const sx = window.scrollX, sy = window.scrollY;
  const base = { clip: __clipBase('p,li,h1,h2,h3,h4,h5,h6,td,th,button,a,label,span,div'), hit: __hitBase() };
  window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  root.style.fontSize = '200%';
  try {
    return await __compare(base, 6,
      'Texte tronqu\xE9/masqu\xE9 \xE0 200 % alors qu\\'il \xE9tait enti\xE8rement visible au rendu normal \u2014 perte de contenu au zoom.',
      'Contr\xF4le recouvert par {by} \xE0 200 % alors qu\\'il ne l\\'\xE9tait pas au rendu normal \u2014 chevauchement, le contr\xF4le n\\'est plus atteignable \xE0 cet endroit.',
      12);
  } finally {
    root.style.fontSize = prev;
    window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  }
})()`;
var TEXT_SPACING_CSS = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";
var TEXT_SPACING_BASELINE_STEP = `(() => { ${PRELUDE} ${STRESS_LIB}
  const sx = window.scrollX, sy = window.scrollY;
  window.__u11ySpacingBase = { clip: __clipBase('p,li,span,a,button,h1,h2,h3,h4,h5,h6,td,th,label,div'), hit: __hitBase() };
  window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  return true;
})()`;
var TEXT_SPACING_PROBE = `(async () => { ${PRELUDE} ${STRESS_LIB}
  const base = window.__u11ySpacingBase;
  delete window.__u11ySpacingBase;
  if (!base) throw new Error('ultra11y: the text-spacing baseline was not recorded before the override, so nothing can be compared');
  const sx = window.scrollX, sy = window.scrollY;
  try {
    // No criterion id in the text: every rendering already names the criterion this finding
    // belongs to, and a hard-coded \xAB 1.4.12 \xBB is a WCAG number appearing inside a deliverable
    // that may be keyed on another standard entirely.
    return await __compare(base, 2,
      'Texte tronqu\xE9/masqu\xE9 sous l\\'espacement de texte impos\xE9 alors qu\\'il \xE9tait enti\xE8rement visible au rendu normal \u2014 perte de contenu.',
      'Contr\xF4le recouvert par {by} sous l\\'espacement de texte impos\xE9 alors qu\\'il ne l\\'\xE9tait pas au rendu normal \u2014 chevauchement, le contr\xF4le n\\'est plus atteignable \xE0 cet endroit.',
      20);
  } finally {
    window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  }
})()`;
function focusSetupExpr(scope = "", maxFocusables = PROBE_DEFAULTS.maxFocusables) {
  const rootExpr = scope ? `document.querySelectorAll(${JSON.stringify(scope)})` : `[document.documentElement]`;
  return `(async () => { ${PRELUDE} ${FRAMES}
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
  // THE INDICATOR MAY NOT BE ON THE ELEMENT. RGAA 10.7.1 accepts \xAB un style du focus d\xE9fini par
  // l'auteur [qui] est visible \xBB, and authors put it on the wrapper (:focus-within outlining a
  // card), on the next sibling (input:focus + .label \u2014 the visually-hidden checkbox pattern), or
  // in a property the first version did not read (transform, text-shadow, a side border). Each
  // was a decisive \xAB focus not visible \xBB on a visible indicator. So the parent, the grandparent
  // and the next sibling are compared too, and the property list is wider.
  // (No backticks in this comment: it lives inside a template literal.)
  const __style = (e, pseudo) => { const s = getComputedStyle(e, pseudo); if (s.animationName && s.animationName !== 'none') return 'animated'; return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderTopWidth, s.borderBottomWidth, s.borderLeftWidth, s.borderRightWidth, s.backgroundColor, s.backgroundImage, s.color, s.textDecorationLine, s.textShadow, s.transform, s.opacity, s.filter].join('|'); };
  const __ctx = (e) => [e.parentElement, e.parentElement && e.parentElement.parentElement, e.nextElementSibling].map((x) => (x ? __style(x, null) : '-')).join('~');
  const snap = (e) => [__style(e, null), __style(e, '::before'), __style(e, '::after')].join('#') + '@' + __ctx(e);
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
  // THE REST STATE IS THE UNFOCUSED STATE, and an element focused at load is not at rest. An
  // autofocus field (a login form's username, #184) was photographed with its ring already on,
  // so the comparison after Tab saw no change and reported a decisive \xAB focus not visible \xBB on
  // a ring that was plainly there. Blur whatever holds focus, let the page repaint (and finish
  // any focus transition, whose mid-flight value is neither state), snapshot, then hand focus
  // back so the walk starts where a keyboard user would.
  // NOT INSIDE AN OPENED DIALOG: the scoped pass runs on a dialog this tool opened, and blurring
  // its focused control is exactly what closes a menu or a popover listening on focusout. There
  // the focused element is simply recorded as not at rest, and never accused.
  // (No backticks in this comment: it lives inside a template literal.)
  const held = document.activeElement;
  const focusedHeld = !!(held && held !== document.body && held !== document.documentElement);
  const blurred = ${scope ? "false" : "true"} && focusedHeld && typeof held.blur === 'function';
  if (blurred) {
    try { held.blur(); } catch (_) {}
    await __frames();
    try { for (const a of document.getAnimations ? document.getAnimations() : []) { if (typeof CSSTransition !== 'undefined' && a instanceof CSSTransition) a.finish(); } } catch (_) {}
  }
  // A page that pulls focus straight back (a focus handler, a trap) leaves nothing at rest to
  // compare with: that element is recorded as such, and the check refuses to accuse it.
  const stillHeld = focusedHeld && document.activeElement === held ? held : null;
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
    const focusedAtRest = !!stillHeld && (stillHeld === e || stillHeld === proxy || e.contains(stillHeld));
    window.__u11yF[key] = { rest: snap(proxy), sel: __sel(proxy), html: __html(proxy), ...(focusedAtRest ? { focusedAtRest: true } : {}) };
    n++;
  }
  if (blurred && document.activeElement !== held) { try { held.focus({ preventScroll: true }); } catch (_) {} }
  return { n: n, total: total };
})()`;
}
var FOCUS_CHECK_PROBE = `(() => {
  const e = document.activeElement;
  // FOCUS LEFT THE DOCUMENT \u2014 the normal end of a tab ring, and nothing to measure.
  if (!e || e === document.body || e === document.documentElement) return null;
  // A FRAMEWORK'S DEV-TOOLS OVERLAY is not the product (#127): Next's <nextjs-portal> holds a
  // focusable button in its shadow root, and counting it as an untagged stop refused every page
  // captured under a dev server. Not compared, not counted; the walk goes on.
  if (${JSON.stringify(DEV_TOOL_HOSTS)}.indexOf((e.localName || '').toLowerCase()) >= 0) return { devTools: true, key: '', changed: true, selector: '', html: '' };
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
  const sty = (el, pseudo) => { const s = getComputedStyle(el, pseudo); if (s.animationName && s.animationName !== 'none') return 'animated'; return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderTopWidth, s.borderBottomWidth, s.borderLeftWidth, s.borderRightWidth, s.backgroundColor, s.backgroundImage, s.color, s.textDecorationLine, s.textShadow, s.transform, s.opacity, s.filter].join('|'); };
  const st = (pseudo) => sty(proxy, pseudo);
  const ctx = [proxy.parentElement, proxy.parentElement && proxy.parentElement.parentElement, proxy.nextElementSibling].map((x) => (x ? sty(x, null) : '-')).join('~');
  const now = [st(null), st('::before'), st('::after')].join('#') + '@' + ctx;
  // FOCUSED AT LOAD AND NEVER LET GO: the setup could not photograph this element unfocused
  // (the page pulled focus back, or the pass ran inside an opened dialog), so its \xAB rest \xBB is
  // its focused look and an unchanged read proves nothing. Unmeasured, never accused (#184).
  // (No backticks in this comment: it lives inside a template literal.)
  if (rec.focusedAtRest && now === rec.rest) return { key: key, changed: true, unmeasured: true, selector: rec.sel, html: rec.html };
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
  let unmeasured = 0;
  for (let i = 0; i < limit; i++) {
    if (deadline?.out()) {
      cutShort = `the probe budget of ${limits.budgetMs}ms ran out after ${seen.size} of the ${count} focusable elements \u2014 the rest of the ring was never focused`;
      break;
    }
    await page.keyboard.press("Tab");
    const r = await page.evaluate(FOCUS_CHECK_PROBE);
    if (!r || r.devTools) continue;
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
    if (r.unmeasured) unmeasured++;
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
  const why = cappedRing(capped, limits) ?? cutShort ?? (untagged > 0 ? `Tab crossed ${untagged} element(s) the tagging pass never matched \u2014 a control focusable in the browser but not by this selector (a skip link revealed on focus, a widget moving focus into an untagged node). They were never compared, so this page is not cleared` : unmeasured > 0 ? `${unmeasured} element(s) held focus from page load and could not be photographed unfocused (the page pulled focus straight back), so their focus indicator was never compared and this page is not cleared` : void 0);
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
  if (${JSON.stringify(DEV_TOOL_HOSTS)}.indexOf((e.localName || '').toLowerCase()) >= 0) return null; // dev tooling, not the product (#127)
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
    const based = await bounded("1.4.12", async () => await page.evaluate(TEXT_SPACING_BASELINE_STEP));
    const handle = based === null ? null : await bounded("1.4.12", () => page.addStyleTag({ content: TEXT_SPACING_CSS }));
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
import { createRequire as createRequire2 } from "module";

// src/messages.ts
var MSG_CATALOG = {
  // ---- Document rules (src/rules/pdf.ts) ----
  "pdf-untagged": {
    message: {
      fr: (p) => `Document PDF non balis\xE9 (PDF ${p.version}) \u2014 ${p.marked === "yes" ? "/MarkInfo d\xE9clare le balisage" : "pas de /MarkInfo << /Marked true >>"}, ${p.structTree === "yes" ? "un arbre de structure existe" : "pas d'arbre de structure (/StructTreeRoot)"} : une technologie d'assistance lit un flux de texte sans titres, listes ni tableaux.`,
      en: (p) => `Untagged PDF document (PDF ${p.version}) \u2014 ${p.marked === "yes" ? "/MarkInfo declares it marked" : "no /MarkInfo << /Marked true >>"}, ${p.structTree === "yes" ? "a structure tree exists" : "no structure tree (/StructTreeRoot)"}: assistive technology reads a flat stream of text with no headings, lists or tables.`
    },
    remediation: {
      fr: () => `Produisez un PDF balis\xE9 (PDF/UA-1) depuis l'outil source, ou proposez une version alternative accessible (HTML ou document balis\xE9) ; v\xE9rifiez le r\xE9sultat avec veraPDF ou PAC. En JavaScript, utilisez PDFKit (https://github.com/foliojs/pdfkit) : options \`subset: 'PDF/UA'\`, \`tagged: true\`, \`displayTitle: true\`, \`lang\`, un titre dans \`info\`, des polices TrueType ou OpenType incorpor\xE9es, et tout le contenu balis\xE9 ou marqu\xE9 comme artefact. PDFKit ne balise ni les annotations (dont les liens) ni les formulaires : pour ces contenus, pr\xE9voyez une version alternative accessible.`,
      en: () => `Produce a tagged PDF (PDF/UA-1) from the source tool, or offer an accessible alternative version (HTML or a tagged document); check the result with veraPDF or PAC. In JavaScript, use PDFKit (https://github.com/foliojs/pdfkit): options \`subset: 'PDF/UA'\`, \`tagged: true\`, \`displayTitle: true\`, \`lang\`, a title in \`info\`, embedded TrueType or OpenType fonts, and all content tagged or marked as an artifact. PDFKit does not tag annotations (links included) or forms: for those, provide an accessible alternative version.`
    }
  },
  "pdf-lang-missing": {
    message: {
      fr: () => `Le document PDF ne d\xE9clare pas de langue (/Lang absent du catalogue) \u2014 la synth\xE8se vocale ne sait pas dans quelle langue le lire.`,
      en: () => `The PDF document declares no language (no /Lang in the catalog) \u2014 speech synthesis cannot tell which language to read it in.`
    },
    remediation: {
      fr: () => `D\xE9clarez la langue du document (ex. /Lang (fr-FR)) dans l'outil qui produit le PDF.`,
      en: () => `Declare the document language (e.g. /Lang (en-GB)) in the tool that produces the PDF.`
    }
  },
  "pdf-title-missing": {
    message: {
      fr: (p) => p.titleState === "not-displayed" ? `Le document PDF a un titre (\xAB ${p.title} \xBB) mais /ViewerPreferences /DisplayDocTitle n'est pas vrai \u2014 le lecteur affiche le nom du fichier \xE0 la place.` : `Le document PDF n'a pas de titre (ni /Title dans les m\xE9tadonn\xE9es, ni dc:title XMP).`,
      en: (p) => p.titleState === "not-displayed" ? `The PDF document has a title ("${p.title}") but /ViewerPreferences /DisplayDocTitle is not true \u2014 the viewer shows the file name instead.` : `The PDF document has no title (no /Title in its metadata, no XMP dc:title).`
    },
    remediation: {
      fr: () => `Renseignez un titre pertinent dans les m\xE9tadonn\xE9es du document et activez l'affichage du titre (DisplayDocTitle).`,
      en: () => `Set a relevant title in the document metadata and turn on title display (DisplayDocTitle).`
    }
  },
  "pdf-no-text": {
    message: {
      fr: (p) => `Document PDF sans texte extractible (${p.pages} page(s), ${p.images} image(s), aucune police ni op\xE9rateur de texte) \u2014 un document num\xE9ris\xE9 dont le contenu est inaccessible \xE0 une technologie d'assistance.`,
      en: (p) => `PDF document with no extractable text (${p.pages} page(s), ${p.images} image(s), no font and no text operator) \u2014 a scanned document whose content assistive technology cannot reach.`
    },
    remediation: {
      fr: () => `Fournissez le document source en texte r\xE9el (ou passez-le en reconnaissance de caract\xE8res puis balisez-le), ou proposez une version alternative accessible.`,
      en: () => `Provide the source document as real text (or OCR it and then tag it), or offer an accessible alternative version.`
    }
  },
  "pdf-structure-shallow": {
    message: {
      fr: (p) => p.gap === "table-no-th" ? `Le document PDF est balis\xE9, mais ${p.without} tableau(x) sur ${p.tables} n'a(ont) aucune cellule d'en-t\xEAte (TH).` : `Le document PDF est balis\xE9, mais son arbre de structure (${p.elements} \xE9l\xE9ment(s)) ne contient aucun titre (H, H1\u2013H6).`,
      en: (p) => p.gap === "table-no-th" ? `The PDF document is tagged, but ${p.without} of its ${p.tables} table(s) have no header cell (TH).` : `The PDF document is tagged, but its structure tree (${p.elements} element(s)) holds no heading (H, H1\u2013H6).`
    },
    remediation: {
      fr: (p) => p.gap === "table-no-th" ? `Balisez les cellules d'en-t\xEAte des tableaux de donn\xE9es en TH (avec /Scope), si le tableau en a.` : `Balisez les intertitres du document en titres (H1\u2013H6), s'il en comporte.`,
      en: (p) => p.gap === "table-no-th" ? `Tag data-table header cells as TH (with /Scope), where the table has them.` : `Tag the document's headings as H1\u2013H6, where it has any.`
    }
  },
  "document-language-missing": {
    message: {
      fr: () => `La page n'a pas de langue par d\xE9faut sur <html> et au moins un texte visible n'h\xE9rite d'aucun attribut lang/xml:lang.`,
      en: () => `The page has no default language on <html>, and at least one visible text node inherits no lang/xml:lang attribute.`
    },
    remediation: {
      fr: () => `D\xE9clarez lang sur <html>, ou sur chaque texte (ou l'un de ses anc\xEAtres) conform\xE9ment au test RGAA 8.3.1.`,
      en: () => `Declare lang on <html>, or on every text node (or one of its ancestors) as allowed by RGAA test 8.3.1.`
    }
  },
  "html-lang-xml-lang-mismatch": {
    message: {
      fr: (p) => `lang="${p.lang}" et xml:lang="${p.xmlLang}" se contredisent sur <html>.`,
      en: (p) => `lang="${p.lang}" and xml:lang="${p.xmlLang}" conflict on <html>.`
    },
    remediation: {
      fr: () => `Utilisez le m\xEAme code de langue valide et pertinent dans les deux attributs, ou conservez seulement lang en HTML5.`,
      en: () => `Use the same valid and relevant language tag in both attributes, or keep only lang in HTML5.`
    }
  },
  "duplicate-attribute": {
    message: {
      fr: (p) => `L'attribut ${p.attr} est d\xE9clar\xE9 plusieurs fois sur la m\xEAme balise \u2014 le code g\xE9n\xE9r\xE9 est invalide.`,
      en: (p) => `The ${p.attr} attribute is declared more than once on the same tag \u2014 the generated markup is invalid.`
    },
    remediation: {
      fr: (p) => `Conservez une seule d\xE9claration de ${p.attr}.`,
      en: (p) => `Keep a single ${p.attr} declaration.`
    }
  },
  "presentational-children-focusable": {
    message: {
      fr: (p) => `Un descendant focalisable est plac\xE9 dans role="${p.role}", dont les enfants sont pr\xE9sentatifs \u2014 l'arbre d'accessibilit\xE9 est contradictoire.`,
      en: (p) => `A focusable descendant sits inside role="${p.role}", whose children are presentational \u2014 the accessibility tree conflicts.`
    },
    remediation: {
      fr: () => `Placez l'\xE9l\xE9ment interactif hors du composant, ou impl\xE9mentez l'interaction sur le composant ARIA lui-m\xEAme.`,
      en: () => `Move the interactive element outside the component, or implement the interaction on the ARIA component itself.`
    }
  },
  "decorative-marked-exposed": {
    message: {
      fr: (p) => `Ce <${p.tag}> est explicitement d\xE9coratif mais reste expos\xE9 par son nom ou sa pr\xE9sence dans l'ordre de tabulation.`,
      en: (p) => `This <${p.tag}> is explicitly decorative but remains exposed by its name or sequential focusability.`
    },
    remediation: {
      fr: () => `Retirez le nom et la focalisation de l'\xE9l\xE9ment d\xE9coratif, ou retirez son marquage d\xE9coratif s'il porte r\xE9ellement une fonction.`,
      en: () => `Remove the decorative element's name and focusability, or remove the decorative marking if it actually has a function.`
    }
  },
  "menuitem-empty-name": {
    message: {
      fr: () => `Cet \xE9l\xE9ment de menu n'a aucun nom accessible.`,
      en: () => `This menu item has no accessible name.`
    },
    remediation: {
      fr: () => `Fournissez un texte visible ou un nom accessible pertinent \xE0 l'\xE9l\xE9ment de menu.`,
      en: () => `Give the menu item visible text or a relevant accessible name.`
    }
  },
  "text-spacing-important": {
    message: {
      fr: (p) => `${p.property}: ${p.value} !important emp\xEAche l'espacement RGAA requis (minimum ${p.minimum}).`,
      en: (p) => `${p.property}: ${p.value} !important prevents the required RGAA spacing override (minimum ${p.minimum}).`
    },
    remediation: {
      fr: (p) => `Retirez !important de ${p.property}, ou utilisez une valeur au moins \xE9gale au seuil requis.`,
      en: (p) => `Remove !important from ${p.property}, or use a value at least equal to the required threshold.`
    }
  },
  "table-scope-invalid": {
    message: {
      fr: (p) => `scope="${p.scope}" n'est pas une valeur d'association d'en-t\xEAte valide.`,
      en: (p) => `scope="${p.scope}" is not a valid header-association value.`
    },
    remediation: {
      fr: () => `Utilisez scope="row", "col", "rowgroup" ou "colgroup" selon la port\xE9e r\xE9elle de l'en-t\xEAte.`,
      en: () => `Use scope="row", "col", "rowgroup", or "colgroup" according to the header's actual reach.`
    }
  },
  // ---- Theme 1 — Images (src/rules/images.ts) ---------------------------------
  "img-alt-missing": {
    message: {
      fr: (p) => `<${p.tag}> sans attribut alt ni nom accessible \u2014 alternative textuelle manquante.`,
      en: (p) => `<${p.tag}> has no alt attribute or accessible name \u2014 missing text alternative.`
    },
    remediation: {
      fr: () => `Ajoutez alt="\u2026" (description si l'image porte de l'information, alt="" si elle est d\xE9corative).`,
      en: () => `Add alt="\u2026" (a description if the image conveys information, alt="" if it is decorative).`
    }
  },
  "img-alt-missing-decorative": {
    message: {
      fr: (p) => `<${p.tag}> sans attribut alt dans un lien ou un bouton d\xE9j\xE0 intitul\xE9 par son texte \u2014 l'image le r\xE9p\xE8te, elle est d\xE9corative et doit \xEAtre ignor\xE9e.`,
      en: (p) => `<${p.tag}> has no alt attribute inside a link or button its own text already names \u2014 the image repeats it, so it is decorative and must be ignored.`
    },
    remediation: {
      fr: () => `Ajoutez alt="" (ou aria-hidden="true") ; si l'image apporte une information que le texte n'a pas, d\xE9crivez-la dans alt="\u2026".`,
      en: () => `Add alt="" (or aria-hidden="true"); if the image carries information the text does not, describe it in alt="\u2026".`
    }
  },
  "autocomplete-token-invalid": {
    message: {
      fr: (p) => `autocomplete="${p.value}" n'appartient pas au vocabulaire HTML \u2014 la finalit\xE9 du champ n'est pas identifiable.`,
      en: (p) => `autocomplete="${p.value}" is not in the HTML autofill vocabulary \u2014 the field's purpose is not identifiable.`
    },
    remediation: {
      fr: () => `Utilisez un token de la liste WCAG \xAB Input Purposes \xBB (par ex. given-name, email, tel, postal-code, current-password).`,
      en: () => `Use a token from the WCAG "Input Purposes" list (e.g. given-name, email, tel, postal-code, current-password).`
    }
  },
  "credential-entry-blocked.paste": {
    message: {
      fr: (p) => `Le collage est bloqu\xE9 sur ce champ <input type="${p.type}"> \u2014 la saisie du secret devient un test de m\xE9moire.`,
      en: (p) => `Paste is blocked on this <input type="${p.type}"> \u2014 entering the secret becomes a memory test.`
    },
    remediation: {
      fr: () => `Retirez le gestionnaire qui annule l'\xE9v\xE9nement paste : les gestionnaires de mots de passe doivent pouvoir remplir le champ.`,
      en: () => `Remove the handler cancelling the paste event: password managers must be able to fill the field.`
    }
  },
  "credential-entry-blocked.autocomplete": {
    message: {
      fr: (p) => `autocomplete="off" sur un champ d'identification (<input type="${p.type}">) \u2014 le remplissage automatique est d\xE9sactiv\xE9.`,
      en: (p) => `autocomplete="off" on a credential field (<input type="${p.type}">) \u2014 automatic filling is disabled.`
    },
    remediation: {
      fr: () => `D\xE9clarez la finalit\xE9 r\xE9elle (autocomplete="username" / "current-password" / "one-time-code") au lieu de "off".`,
      en: () => `Declare the real purpose (autocomplete="username" / "current-password" / "one-time-code") instead of "off".`
    }
  },
  "on-input-context-change": {
    message: {
      fr: (p) => `Changer la valeur de ce <${p.tag}> d\xE9clenche seul un changement de contexte (envoi/navigation).`,
      en: (p) => `Changing this <${p.tag}>'s value alone triggers a change of context (submit/navigation).`
    },
    remediation: {
      fr: () => `Attendez une action explicite (bouton \xAB Valider \xBB), ou annoncez le changement avant qu'il ne survienne.`,
      en: () => `Wait for an explicit action (a "Submit" button), or announce the change before it happens.`
    }
  },
  "label-in-name-mismatch": {
    message: {
      fr: (p) => `Le libell\xE9 visible \xAB ${p.visible} \xBB n'est pas contenu dans le nom accessible \xAB ${p.name} \xBB \u2014 la commande vocale \xE9choue.`,
      en: (p) => `The visible label "${p.visible}" is not contained in the accessible name "${p.name}" \u2014 voice control fails.`
    },
    remediation: {
      fr: (p) => `Faites commencer aria-label par le texte visible (\xAB ${p.visible} \u2026 \xBB), ou retirez aria-label et laissez le texte nommer le contr\xF4le.`,
      en: (p) => `Start aria-label with the visible text ("${p.visible} \u2026"), or drop aria-label and let the text name the control.`
    }
  },
  "field-label-in-name-mismatch": {
    message: {
      fr: (p) => `L'\xE9tiquette visible du champ \xAB ${p.visible} \xBB n'est pas contenue dans son nom accessible \xAB ${p.name} \xBB : l'aria-label la remplace (test RGAA 11.2.5).`,
      en: (p) => `The field's visible label "${p.visible}" is not contained in its accessible name "${p.name}": the aria-label replaces it.`
    },
    remediation: {
      fr: () => `Retirez l'aria-label pour que le <label> nomme le champ, ou faites-le contenir l'\xE9tiquette visible.`,
      en: () => `Drop the aria-label so the <label> names the field, or make it contain the visible label.`
    }
  },
  "headers-attr-dangling": {
    message: {
      fr: (p) => `headers="${p.ids}" ne d\xE9signe aucune cellule d'en-t\xEAte de ce tableau \u2014 l'association n'existe pas.`,
      en: (p) => `headers="${p.ids}" points at no header cell of this table \u2014 the association does not exist.`
    },
    remediation: {
      fr: () => `Faites pointer headers vers les id de <th> du M\xCAME tableau, ou utilisez scope="col"/"row".`,
      en: () => `Point headers at the ids of <th> cells in the SAME table, or use scope="col"/"row".`
    }
  },
  "th-no-data-cells": {
    message: {
      fr: () => `Cet en-t\xEAte n'est r\xE9f\xE9renc\xE9 par aucune cellule de donn\xE9es alors que le tableau utilise headers \u2014 il n'en-t\xEAte rien.`,
      en: () => `This header is referenced by no data cell although the table uses headers \u2014 it heads nothing.`
    },
    remediation: {
      fr: () => `Ajoutez son id au headers des cellules qu'il en-t\xEAte, ou retirez-le s'il ne sert qu'\xE0 la mise en forme.`,
      en: () => `Add its id to the headers of the cells it heads, or remove it if it is purely presentational.`
    }
  },
  "dl-structure.foreign-child": {
    message: {
      fr: (p) => `<${p.tag}> comme enfant direct de <dl> \u2014 seuls <dt>, <dd> (et <div> les groupant) sont admis.`,
      en: (p) => `<${p.tag}> as a direct child of <dl> \u2014 only <dt>, <dd> (and a grouping <div>) are allowed.`
    },
    remediation: {
      fr: () => `D\xE9placez le contenu dans un <dd>, ou sortez-le de la liste de d\xE9finitions.`,
      en: () => `Move the content into a <dd>, or take it out of the description list.`
    }
  },
  "dl-structure.orphan": {
    message: {
      fr: (p) => `<${p.tag}> hors de tout <dl> \u2014 la relation terme/description n'est pas expos\xE9e.`,
      en: (p) => `<${p.tag}> outside any <dl> \u2014 the term/description relationship is not exposed.`
    },
    remediation: {
      fr: (p) => `Enveloppez les paires <dt>/<dd> dans un <dl> (le <${p.tag}> seul n'a aucune s\xE9mantique).`,
      en: (p) => `Wrap the <dt>/<dd> pairs in a <dl> (a lone <${p.tag}> carries no semantics).`
    }
  },
  "invalid-aria-attr": {
    message: {
      fr: (p) => `Attribut ${p.attr} inconnu de WAI-ARIA \u2014 il est ignor\xE9 par les navigateurs et n'expose rien.`,
      en: (p) => `${p.attr} is not a WAI-ARIA attribute \u2014 browsers ignore it, so it exposes nothing.`
    },
    remediation: {
      fr: (p) => `Corrigez l'orthographe de ${p.attr} (par ex. aria-labelledby, aria-describedby) ou retirez l'attribut.`,
      en: (p) => `Fix the spelling of ${p.attr} (e.g. aria-labelledby, aria-describedby) or remove the attribute.`
    }
  },
  "invalid-aria-value": {
    message: {
      fr: (p) => `${p.attr}="${p.value}" n'est pas une valeur admise \u2014 l'\xE9tat est trait\xE9 comme absent.`,
      en: (p) => `${p.attr}="${p.value}" is not an allowed value \u2014 the state is treated as absent.`
    },
    remediation: {
      fr: (p) => `Utilisez une valeur d\xE9finie par WAI-ARIA pour ${p.attr} (par ex. true/false, ou un entier pour aria-level).`,
      en: (p) => `Use a value WAI-ARIA defines for ${p.attr} (e.g. true/false, or an integer for aria-level).`
    }
  },
  "invalid-aria-value.dangling-required": {
    message: {
      fr: (p) => `role="${p.role}" exige ${p.attr}, mais ${p.attr}="${p.value}" ne d\xE9signe aucun \xE9l\xE9ment de la page \u2014 la relation requise n'existe pas.`,
      en: (p) => `role="${p.role}" requires ${p.attr}, but ${p.attr}="${p.value}" names no element of the page \u2014 the required relationship does not exist.`
    },
    remediation: {
      fr: (p) => `Faites pointer ${p.attr} vers l'id d'un \xE9l\xE9ment pr\xE9sent dans la page.`,
      en: (p) => `Point ${p.attr} at the id of an element present in the page.`
    }
  },
  "aria-prohibited-attr.unsupported": {
    message: {
      fr: (p) => `${p.attrs} n'est pas pris en charge par le r\xF4le ${p.role} \u2014 la propri\xE9t\xE9 est ignor\xE9e et l'\xE9tat voulu n'est pas restitu\xE9.`,
      en: (p) => `${p.attrs} is not supported by the ${p.role} role \u2014 the property is dropped and the intended state never reaches the user.`
    },
    remediation: {
      fr: (p) => `Retirez ${p.attrs}, ou donnez \xE0 l'\xE9l\xE9ment le r\xF4le qui porte cette propri\xE9t\xE9.`,
      en: (p) => `Remove ${p.attrs}, or give the element the role that carries this property.`
    }
  },
  "aria-required-attr": {
    message: {
      fr: (p) => `role="${p.role}" sans ${p.attrs} \u2014 l'\xE9tat requis par ce r\xF4le n'est pas expos\xE9.`,
      en: (p) => `role="${p.role}" without ${p.attrs} \u2014 the state this role requires is not exposed.`
    },
    remediation: {
      fr: (p) => `Ajoutez ${p.attrs} et tenez la valeur \xE0 jour, ou utilisez l'\xE9l\xE9ment natif \xE9quivalent qui g\xE8re l'\xE9tat seul.`,
      en: (p) => `Add ${p.attrs} and keep it in sync, or use the native element, which manages the state on its own.`
    }
  },
  "aria-required-parent": {
    message: {
      fr: (p) => `role="${p.role}" hors de son conteneur requis (${p.parents}) \u2014 le r\xF4le n'est pas expos\xE9.`,
      en: (p) => `role="${p.role}" outside its required container (${p.parents}) \u2014 the role is not exposed.`
    },
    remediation: {
      fr: (p) => `Placez l'\xE9l\xE9ment dans un conteneur ${p.parents}, ou reliez-le via aria-owns.`,
      en: (p) => `Put the element inside a ${p.parents} container, or wire it up with aria-owns.`
    }
  },
  "aria-prohibited-attr": {
    message: {
      fr: (p) => `role="${p.role}" interdit un nom d'auteur, mais ${p.attrs} en fournit un \u2014 restitution impr\xE9visible.`,
      en: (p) => `role="${p.role}" prohibits an author-provided name, yet ${p.attrs} supplies one \u2014 restitution is unpredictable.`
    },
    remediation: {
      fr: (p) => `Retirez ${p.attrs}, ou donnez \xE0 l'\xE9l\xE9ment un r\xF4le qui accepte d'\xEAtre nomm\xE9.`,
      en: (p) => `Remove ${p.attrs}, or give the element a role that accepts a name.`
    }
  },
  "img-alt-missing.title-only": {
    message: {
      fr: (p) => `<${p.tag}> sans alt : le nom accessible vient du seul title, restitu\xE9 de fa\xE7on peu fiable (survol uniquement).`,
      en: (p) => `<${p.tag}> has no alt: its accessible name comes from title alone, which is restituted unreliably (hover only).`
    },
    remediation: {
      fr: () => `Recommandation : d\xE9placez le texte du title vers alt="\u2026" (alt="" si l'image est d\xE9corative).`,
      en: () => `Recommendation: move the title text into alt="\u2026" (alt="" if the image is decorative).`
    }
  },
  "decorative-alt-misuse.empty-but-named": {
    message: {
      fr: () => `Image d\xE9corative (alt="") mais nomm\xE9e par aria-label/title \u2014 incoh\xE9rence d\xE9coratif/informatif.`,
      en: () => `Decorative image (alt="") but named via aria-label/title \u2014 decorative/informative inconsistency.`
    },
    remediation: {
      fr: () => `Si l'image est d\xE9corative, retirez aria-label/title ; sinon donnez un alt descriptif.`,
      en: () => `If the image is decorative, remove aria-label/title; otherwise give it a descriptive alt.`
    }
  },
  "decorative-alt-misuse.role-but-alt": {
    message: {
      fr: (p) => `Image en role="${p.role}" mais porteuse d'un alt non vide \u2014 d\xE9clar\xE9e d\xE9corative pourtant nomm\xE9e.`,
      en: (p) => `Image with role="${p.role}" but carrying a non-empty alt \u2014 declared decorative yet named.`
    },
    remediation: {
      fr: (p) => `Retirez role="${p.role}" si l'image est informative, ou videz l'alt si elle est d\xE9corative.`,
      en: (p) => `Remove role="${p.role}" if the image is informative, or empty the alt if it is decorative.`
    }
  },
  "canvas-fallback-missing": {
    message: {
      fr: () => `<canvas> sans contenu alternatif ni nom accessible.`,
      en: () => `<canvas> has no fallback content or accessible name.`
    },
    remediation: {
      fr: () => `Placez un contenu de repli entre <canvas>\u2026</canvas> ou ajoutez role="img" + aria-label.`,
      en: () => `Place fallback content between <canvas>\u2026</canvas>, or add role="img" + aria-label.`
    }
  },
  "input-image-alt-missing": {
    message: {
      fr: () => `<input type="image"> sans alt ni nom accessible \u2014 le bouton image n'a pas d'alternative textuelle.`,
      en: () => `<input type="image"> has no alt or accessible name \u2014 the image button has no text alternative.`
    },
    remediation: {
      fr: () => `Ajoutez alt="\u2026" d\xE9crivant l'action du bouton (ex. alt="Rechercher").`,
      en: () => `Add alt="\u2026" describing the button's action (e.g. alt="Search").`
    }
  },
  "object-embed-no-name": {
    message: {
      fr: (p) => `<${p.tag}> sans nom accessible ni contenu de repli \u2014 m\xE9dia embarqu\xE9 sans alternative textuelle.`,
      en: (p) => `<${p.tag}> has no accessible name or fallback content \u2014 embedded media with no text alternative.`
    },
    remediation: {
      fr: () => `Ajoutez aria-label/title d\xE9crivant le contenu (et un contenu de repli textuel dans <object>\u2026</object>), ou aria-hidden="true" si d\xE9coratif.`,
      en: () => `Add aria-label/title describing the content (and text fallback content inside <object>\u2026</object>), or aria-hidden="true" if decorative.`
    }
  },
  "figure-caption-unassociated": {
    message: {
      fr: (p) => {
        const m = String(p.missing).split(",");
        const parts = [
          m.includes("role") ? `pas de role="figure" ou "group"` : "",
          m.includes("aria-label") ? "pas d'aria-label" : "",
          m.includes("aria-label-mismatch") ? "un aria-label diff\xE9rent de la l\xE9gende" : ""
        ].filter(Boolean);
        return `<figure> l\xE9gend\xE9e (\xAB ${p.caption} \xBB) : ${parts.join(", ")} \u2014 la l\xE9gende n'est pas reli\xE9e \xE0 l'image (test RGAA 1.9.1).`;
      },
      en: (p) => {
        const m = String(p.missing).split(",");
        const parts = [
          m.includes("role") ? `no role="figure" or "group"` : "",
          m.includes("aria-label") ? "no aria-label" : "",
          m.includes("aria-label-mismatch") ? "an aria-label that differs from the caption" : ""
        ].filter(Boolean);
        return `Captioned <figure> ("${p.caption}"): ${parts.join(", ")} \u2014 the caption is not tied to the image.`;
      }
    },
    remediation: {
      fr: (p) => `Ajoutez role="figure" et aria-label="${p.caption}" sur la balise <figure>, identique au contenu du <figcaption>.`,
      en: (p) => `Add role="figure" and aria-label="${p.caption}" to the <figure>, identical to the <figcaption> content.`
    }
  },
  "chart-no-accessible-name": {
    message: {
      fr: (p) => `Graphique (<${p.tag}> ${p.cls}) sans nom accessible \u2014 alternative textuelle manquante.`,
      en: (p) => `Chart (<${p.tag}> ${p.cls}) has no accessible name \u2014 missing text alternative.`
    },
    remediation: {
      fr: () => `Enveloppez le graphique dans <div role="img" aria-label="\u2026"> d\xE9crivant la tendance (ou ajoutez un <title>/aria-label).`,
      en: () => `Wrap the chart in <div role="img" aria-label="\u2026"> describing the trend (or add a <title>/aria-label).`
    }
  },
  // ---- Theme 2 — Frames (src/rules/frames.ts) ---------------------------------
  "iframe-title-missing": {
    message: {
      fr: () => `<iframe> sans attribut title \u2014 le cadre n'a pas de titre.`,
      en: () => `<iframe> has no title attribute \u2014 the frame has no title.`
    },
    remediation: {
      fr: () => `Ajoutez un title d\xE9crivant le contenu du cadre, ex. title="Carte de localisation".`,
      en: () => `Add a title describing the frame's content, e.g. title="Location map".`
    }
  },
  // ---- Theme 3 — Colours (src/rules/colors.ts) --------------------------------
  "contrast-literal": {
    message: {
      fr: (p) => `Contraste insuffisant : ratio ${p.ratio}:1 entre le texte et son fond (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}).`,
      en: (p) => `Insufficient contrast: ${p.ratio}:1 ratio between the text and its background (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text).`
    },
    remediation: {
      fr: (p) => `Assombrissez le texte ou \xE9claircissez le fond pour atteindre au moins ${p.min}:1 (contraste calcul\xE9 sur des couleurs inline litt\xE9rales).`,
      en: (p) => `Darken the text or lighten the background to reach at least ${p.min}:1 (contrast computed from literal inline colours).`
    }
  },
  // ---- Rendered tier (src/rules/rendered.ts) — decided from a page snapshot's signals -----
  // These say WHERE the measurement came from, because that is what makes them auditable: a
  // computed style, or a region of the screenshot. An auditor can go and re-check either.
  "rendered-contrast": {
    message: {
      fr: (p) => `Contraste insuffisant au rendu : ratio ${p.ratio}:1 entre le texte et son fond effectif (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}).`,
      en: (p) => `Insufficient contrast at render: ${p.ratio}:1 between the text and its effective background (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text).`
    },
    remediation: {
      fr: (p) => `Assombrissez le texte ou \xE9claircissez le fond pour atteindre au moins ${p.min}:1 (mesur\xE9 sur les styles calcul\xE9s de la page rendue).`,
      en: (p) => `Darken the text or lighten the background to reach at least ${p.min}:1 (measured from the rendered page's computed styles).`
    }
  },
  "rendered-contrast-pixel": {
    message: {
      fr: (p) => `Contraste insuffisant mesur\xE9 sur la capture d'\xE9cran : ratio ${p.ratio}:1 (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}). Le fond vient d'une image ou d'un d\xE9grad\xE9, invisible aux styles calcul\xE9s.`,
      en: (p) => `Insufficient contrast measured on the screenshot: ${p.ratio}:1 (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text). The background comes from an image or gradient, which computed styles cannot express.`
    },
    remediation: {
      fr: (p) => `Garantissez au moins ${p.min}:1 sur toute la zone : ajoutez un fond opaque sous le texte, un voile, ou une ombre port\xE9e. Le fond a \xE9t\xE9 mesur\xE9 sur les pixels de la zone occup\xE9e par le texte.`,
      en: (p) => `Guarantee at least ${p.min}:1 across the whole area: add an opaque backing behind the text, a scrim, or a text shadow. The background was measured on the pixels of the text's own box.`
    }
  },
  "rendered-link-colour-only": {
    message: {
      fr: (p) => `Lien dans un bloc de texte distingu\xE9 par la COULEUR SEULE (\xE9cart de ${p.ratio}:1 avec le texte environnant, sans soulignement, bordure ni fond) \u2014 invisible pour qui ne per\xE7oit pas cette diff\xE9rence de couleur.`,
      en: (p) => `Link inside a text block distinguished by COLOUR ALONE (${p.ratio}:1 apart from the surrounding text, with no underline, border or background) \u2014 invisible to anyone who does not perceive that colour difference.`
    },
    remediation: {
      fr: () => `Ajoutez un indice non chromatique : text-decoration: underline (le plus simple), une bordure basse, ou une graisse nettement sup\xE9rieure. \xC0 d\xE9faut, un contraste d'au moins 3:1 avec le texte environnant ET un indice au survol/focus.`,
      en: () => `Add a non-colour cue: text-decoration: underline (simplest), a bottom border, or a distinctly heavier weight. Failing that, at least 3:1 contrast with the surrounding text AND a cue on hover/focus.`
    }
  },
  "rendered-nontext-contrast": {
    message: {
      fr: (p) => `Limite du composant <${p.control}> non perceptible : ni son fond (${p.ratio}:1 avec l'environnement) ni sa bordure n'atteignent 3:1 \u2014 rien n'indique visuellement o\xF9 commence le champ.`,
      en: (p) => `The <${p.control}> boundary is not perceivable: neither its fill (${p.ratio}:1 against its surroundings) nor its border reaches 3:1 \u2014 nothing shows visually where the control begins.`
    },
    remediation: {
      fr: () => `Donnez au composant une bordure visible contrastant \xE0 3:1 avec le fond environnant, ou un fond distinct du fond environnant \xE0 3:1. Un box-shadow ou un outline visible conviennent aussi.`,
      en: () => `Give the control a visible border at 3:1 against the surrounding background, or a fill distinct from it at 3:1. A visible box-shadow or outline also qualifies.`
    }
  },
  "rendered-focus-not-visible": {
    message: {
      fr: (p) => `La feuille de styles supprime l'indicateur de focus (\`${p.selector}\`) et aucune r\xE8gle \`:focus\` ne le remplace \u2014 un utilisateur au clavier ne peut plus savoir o\xF9 il se trouve.`,
      en: (p) => `The stylesheet removes the focus indicator (\`${p.selector}\`) and no \`:focus\` rule puts one back \u2014 a keyboard user can no longer tell where they are.`
    },
    remediation: {
      fr: () => `Ne supprimez jamais outline sans remplacement. Si le style par d\xE9faut ne convient pas, remplacez-le : \`:focus-visible { outline: 2px solid <couleur contrast\xE9e>; outline-offset: 2px }\`.`,
      en: () => `Never remove outline without a replacement. If the default does not fit, replace it: \`:focus-visible { outline: 2px solid <contrasting colour>; outline-offset: 2px }\`.`
    }
  },
  "rendered-orientation-lock": {
    message: {
      fr: (p) => `Le contenu est verrouill\xE9 dans une seule orientation : \`@media ${p.media}\` applique \`transform: ${p.transform}\` au document \u2014 l'utilisateur ne peut pas consulter la page dans l'orientation de son choix.`,
      en: (p) => `Content is locked to a single orientation: \`@media ${p.media}\` applies \`transform: ${p.transform}\` to the document \u2014 the user cannot view the page in the orientation they need.`
    },
    remediation: {
      fr: () => `Supprimez la rotation et rendez la mise en page responsive dans les deux orientations. Un verrouillage n'est admis que si l'orientation est essentielle (piano, ch\xE8que bancaire).`,
      en: () => `Remove the rotation and make the layout work in both orientations. Locking is only acceptable where the orientation is essential (a piano keyboard, a bank cheque).`
    }
  },
  // ---- Theme 5 — Data tables (src/rules/tables.ts) ----------------------------
  "data-table-no-headers.no-th": {
    message: {
      fr: () => `Tableau de donn\xE9es sans <th> \u2014 en-t\xEAtes de colonne/ligne non d\xE9clar\xE9s.`,
      en: () => `Data table with no <th> \u2014 column/row headers are not declared.`
    },
    remediation: {
      fr: () => `D\xE9clarez les en-t\xEAtes avec <th>, et associez-les via scope="col"/"row" (ou headers/id).`,
      en: () => `Declare headers with <th>, and associate them via scope="col"/"row" (or headers/id).`
    }
  },
  "data-table-no-headers.no-assoc": {
    message: {
      fr: () => `Tableau de donn\xE9es avec <th> mais sans scope/headers \u2014 association cellule\u2194en-t\xEAte absente.`,
      en: () => `Data table with <th> but no scope/headers \u2014 the cell\u2194header association is missing.`
    },
    remediation: {
      fr: () => `Ajoutez scope="col"/"row" sur les <th> (ou headers="\u2026"/id sur cellules complexes).`,
      en: () => `Add scope="col"/"row" on the <th> elements (or headers="\u2026"/id for complex cells).`
    }
  },
  "table-caption-missing": {
    message: {
      fr: () => `Tableau de donn\xE9es sans <caption> ni nom accessible \u2014 titre du tableau absent.`,
      en: () => `Data table with no <caption> or accessible name \u2014 the table has no title.`
    },
    remediation: {
      fr: () => `Ajoutez un <caption> en premi\xE8re position du <table> (ou aria-label/aria-labelledby).`,
      en: () => `Add a <caption> as the first child of the <table> (or aria-label/aria-labelledby).`
    }
  },
  "layout-table-data-markup": {
    message: {
      fr: (p) => `Tableau de mise en forme (role="${p.role}") utilisant du balisage de donn\xE9es (th/caption/scope).`,
      en: (p) => `Layout table (role="${p.role}") using data markup (th/caption/scope).`
    },
    remediation: {
      fr: () => `Retirez th/caption/scope/headers d'un tableau de pr\xE9sentation, ou faites-en un vrai tableau de donn\xE9es.`,
      en: () => `Remove th/caption/scope/headers from a presentation table, or turn it into a real data table.`
    }
  },
  "sortable-header-no-aria-sort": {
    message: {
      fr: () => `En-t\xEAte de colonne triable sans aria-sort \u2014 l'\xE9tat de tri (croissant/d\xE9croissant) n'est pas restitu\xE9.`,
      en: () => `Sortable column header with no aria-sort \u2014 the sort state (ascending/descending) is not conveyed.`
    },
    remediation: {
      fr: () => `Ajoutez aria-sort="none|ascending|descending" sur le <th> tri\xE9, et masquez le glyphe de tri (aria-hidden="true").`,
      en: () => `Add aria-sort="none|ascending|descending" on the sorted <th>, and hide the sort glyph (aria-hidden="true").`
    }
  },
  "table-empty-data-cell": {
    message: {
      fr: () => `Cellule de donn\xE9es vide (ou r\xE9duite \xE0 \xAB - \xBB) : restitu\xE9e \xAB vide \xBB par les lecteurs d'\xE9cran.`,
      en: () => `Empty data cell (or reduced to "-"): announced as "blank" by screen readers.`
    },
    remediation: {
      fr: () => `Ajoutez un texte masqu\xE9 (classe sr-only) pr\xE9cisant l'absence de valeur, ex. \xAB Non renseign\xE9 \xBB.`,
      en: () => `Insert hidden text (an sr-only class) stating the absence of a value, e.g. "Not provided".`
    }
  },
  // ---- Theme 6/7 — Links & buttons (src/rules/links.ts) -----------------------
  "link-empty-name": {
    message: {
      fr: () => `Lien sans intitul\xE9 \u2014 aucun nom accessible.`,
      en: () => `Link with no label \u2014 no accessible name.`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 textuel au lien (texte visible, ou aria-label si vraiment n\xE9cessaire).`,
      en: () => `Give the link a text label (visible text, or aria-label if truly necessary).`
    }
  },
  "button-empty-name": {
    message: {
      fr: () => `Bouton sans intitul\xE9 \u2014 aucun nom accessible.`,
      en: () => `Button with no label \u2014 no accessible name.`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 au bouton (texte, value, ou aria-label).`,
      en: () => `Give the button a label (text, value, or aria-label).`
    }
  },
  "icon-only-control-unnamed": {
    message: {
      fr: (p) => `${p.kind === "link" ? "Lien" : "Bouton"} avec une ic\xF4ne seule (img/svg/i) sans nom accessible.`,
      en: (p) => `${p.kind === "link" ? "Link" : "Button"} with an icon only (img/svg/i) and no accessible name.`
    },
    remediation: {
      fr: () => `Ajoutez un alt/aria-label sur l'ic\xF4ne ou un texte masqu\xE9 visuellement (classe visually-hidden).`,
      en: () => `Add an alt/aria-label on the icon, or a visually-hidden text (visually-hidden class).`
    }
  },
  "control-name-title-only": {
    message: {
      fr: (p) => `${p.kind === "link" ? "Lien" : p.kind === "field" ? "Champ de formulaire" : "Bouton"} dont le seul nom accessible vient de l'attribut title \u2014 title n'est pas restitu\xE9 de fa\xE7on fiable (survol uniquement).`,
      en: (p) => `${p.kind === "link" ? "Link" : p.kind === "field" ? "Form field" : "Button"} whose only accessible name comes from the title attribute \u2014 title is not reliably conveyed (hover only).`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 via texte visible ou aria-label ; r\xE9servez title \xE0 une information compl\xE9mentaire.`,
      en: () => `Give it a label via visible text or aria-label; reserve title for supplementary information.`
    }
  },
  // ---- Theme 7 — Scripts / ARIA (src/rules/scripts-aria.ts) -------------------
  "invalid-aria-role": {
    message: {
      fr: (p) => `R\xF4le ARIA invalide : "${p.roles}" n'est pas un r\xF4le WAI-ARIA valide.`,
      en: (p) => `Invalid ARIA role: "${p.roles}" is not a valid WAI-ARIA role.`
    },
    remediation: {
      fr: () => `Utilisez un r\xF4le ARIA valide ou un \xE9l\xE9ment HTML natif \xE9quivalent.`,
      en: () => `Use a valid ARIA role, or an equivalent native HTML element.`
    }
  },
  "aria-ref-missing-id": {
    message: {
      fr: (p) => `${p.attr} r\xE9f\xE9rence un id inexistant : ${p.ids}.`,
      en: (p) => `${p.attr} references a non-existent id: ${p.ids}.`
    },
    remediation: {
      fr: () => `Corrigez la r\xE9f\xE9rence ou ajoutez l'\xE9l\xE9ment cible avec l'id attendu.`,
      en: () => `Fix the reference, or add the target element with the expected id.`
    }
  },
  "redundant-aria": {
    message: {
      fr: (p) => `role="${p.role}" est redondant : <${p.tag}> a d\xE9j\xE0 ce r\xF4le implicite.`,
      en: (p) => `role="${p.role}" is redundant: <${p.tag}> already has this implicit role.`
    },
    remediation: {
      fr: () => `Retirez l'attribut role redondant et laissez la s\xE9mantique native.`,
      en: () => `Remove the redundant role attribute and let the native semantics apply.`
    }
  },
  "clickable-noninteractive": {
    message: {
      fr: (p) => `<${p.tag}> avec onClick mais ${p.focusIssue === "no-tabindex" ? "non focalisable (tabindex absent)" : "sans r\xF4le interactif"} \u2014 contr\xF4le non accessible au clavier/AT.`,
      en: (p) => `<${p.tag}> has onClick but ${p.focusIssue === "no-tabindex" ? "is not focusable (no tabindex)" : "has no interactive role"} \u2014 control not accessible via keyboard/AT.`
    },
    remediation: {
      fr: () => `Utilisez <button>/<a> natif, ou ajoutez role + tabindex="0" + gestion clavier (Enter/Espace).`,
      en: () => `Use a native <button>/<a>, or add role + tabindex="0" + keyboard handling (Enter/Space).`
    }
  },
  "aria-required-children": {
    message: {
      fr: (p) => `role="${p.role}" sans enfant requis (${p.req}) \u2014 structure ARIA incompl\xE8te.`,
      en: (p) => `role="${p.role}" with no required child (${p.req}) \u2014 incomplete ARIA structure.`
    },
    remediation: {
      fr: () => `Ajoutez les \xE9l\xE9ments enfants au r\xF4le appropri\xE9, ou utilisez les \xE9l\xE9ments HTML natifs.`,
      en: () => `Add child elements with the appropriate role, or use native HTML elements.`
    }
  },
  "aria-required-children.forbidden-child": {
    message: {
      fr: (p) => `role="${p.role}" poss\xE8de un \xE9l\xE9ment de r\xF4le ${p.child}, qu'il n'admet pas (attendus : ${p.req}) \u2014 structure ARIA invalide.`,
      en: (p) => `role="${p.role}" owns an element with role ${p.child}, which it does not allow (expected: ${p.req}) \u2014 invalid ARIA structure.`
    },
    remediation: {
      fr: () => `Sortez cet \xE9l\xE9ment du conteneur, ou donnez-lui un r\xF4le que le conteneur admet.`,
      en: () => `Move that element out of the container, or give it a role the container allows.`
    }
  },
  "aria-hidden-focusable": {
    message: {
      fr: () => `aria-hidden="true" sur (ou contenant) un \xE9l\xE9ment focalisable \u2014 pi\xE8ge pour les technologies d'assistance.`,
      en: () => `aria-hidden="true" on (or containing) a focusable element \u2014 a trap for assistive technology.`
    },
    remediation: {
      fr: () => `Retirez aria-hidden, ou rendez l'\xE9l\xE9ment non focalisable (tabindex="-1", disabled).`,
      en: () => `Remove aria-hidden, or make the element non-focusable (tabindex="-1", disabled).`
    }
  },
  "nested-interactive": {
    message: {
      fr: (p) => `\xC9l\xE9ment interactif <${p.tag}> imbriqu\xE9 dans un autre \xE9l\xE9ment interactif \u2014 non restitu\xE9 correctement.`,
      en: (p) => `Interactive element <${p.tag}> nested inside another interactive element \u2014 not conveyed correctly.`
    },
    remediation: {
      fr: () => `Ne pas imbriquer des contr\xF4les interactifs (lien/bouton) ; mettez-les c\xF4te \xE0 c\xF4te.`,
      en: () => `Do not nest interactive controls (link/button); place them side by side instead.`
    }
  },
  "live-region-conflict.invalid-value": {
    message: {
      fr: (p) => `aria-live="${p.value}" invalide \u2014 seules les valeurs off, polite, assertive sont restitu\xE9es.`,
      en: (p) => `aria-live="${p.value}" is invalid \u2014 only the values off, polite, assertive are honoured.`
    },
    remediation: {
      fr: () => `Utilisez aria-live="polite" (associ\xE9 \xE0 aria-atomic="true") \u2014 ou role="alert" pour une erreur ; toute autre valeur est ignor\xE9e.`,
      en: () => `Use aria-live="polite" (paired with aria-atomic="true") \u2014 or role="alert" for an error; any other value is ignored.`
    }
  },
  "live-region-conflict.mismatch": {
    message: {
      fr: (p) => `role="${p.role}" implique aria-live="${p.want}" mais aria-live="${p.live}" \u2014 message de statut restitu\xE9 de fa\xE7on incoh\xE9rente.`,
      en: (p) => `role="${p.role}" implies aria-live="${p.want}" but aria-live="${p.live}" \u2014 status message conveyed inconsistently.`
    },
    remediation: {
      fr: (p) => p.want === "assertive" ? `Laissez role="${p.role}" g\xE9rer la restitution (retirez aria-live) ou utilisez aria-live="assertive".` : `Alignez aria-live sur "${p.want}" (avec aria-atomic="true"), coh\xE9rent avec role="${p.role}", ou retirez-le.`,
      en: (p) => p.want === "assertive" ? `Let role="${p.role}" drive the announcement (remove aria-live), or use aria-live="assertive".` : `Align aria-live with "${p.want}" (with aria-atomic="true"), consistent with role="${p.role}", or remove it.`
    }
  },
  "status-message-not-assertive": {
    message: {
      fr: () => `Conteneur d'erreur/alerte en aria-live="polite" \u2014 un message d'erreur doit \xEAtre restitu\xE9 de fa\xE7on assertive.`,
      en: () => `Error/alert container with aria-live="polite" \u2014 an error message must be conveyed assertively.`
    },
    remediation: {
      fr: () => `Utilisez role="alert" seul (restitution assertive imm\xE9diate) plut\xF4t qu'aria-live="polite" ; ne d\xE9placez pas aussi le focus vers ce conteneur \u2014 soit un m\xE9canisme aria-live/role="alert", soit un d\xE9placement du focus, jamais les deux.`,
      en: () => `Use role="alert" alone (immediate assertive restitution) rather than aria-live="polite"; do not also move focus to that container \u2014 a live region OR a focus move, never both.`
    }
  },
  // ---- Theme 8 — Mandatory elements (src/rules/mandatory.ts) ------------------
  "html-lang-missing": {
    message: {
      fr: () => `<html> sans attribut lang \u2014 la langue par d\xE9faut de la page n'est pas d\xE9clar\xE9e.`,
      en: () => `<html> has no lang attribute \u2014 the page's default language is not declared.`
    },
    remediation: {
      fr: () => `Ajoutez lang sur <html>, ex. <html lang="fr">.`,
      en: () => `Add lang on <html>, e.g. <html lang="en">.`
    }
  },
  "title-missing-empty": {
    message: {
      fr: (p) => p.titleState === "empty" ? `<title> vide \u2014 le titre de la page est absent de contenu.` : `<title> absent \u2014 la page n'a pas de titre.`,
      en: (p) => p.titleState === "empty" ? `<title> is empty \u2014 the page title has no content.` : `<title> is missing \u2014 the page has no title.`
    },
    remediation: {
      fr: () => `Ajoutez un <title> non vide et pertinent dans <head>.`,
      en: () => `Add a non-empty, relevant <title> in <head>.`
    }
  },
  "duplicate-id": {
    message: {
      fr: (p) => `id="${p.id}" dupliqu\xE9 \u2014 un id doit \xEAtre unique dans la page (HTML invalide).`,
      en: (p) => `id="${p.id}" duplicated \u2014 an id must be unique in the page (invalid HTML).`
    },
    remediation: {
      fr: () => `Donnez un id unique \xE0 chaque \xE9l\xE9ment ; ajustez les r\xE9f\xE9rences (label[for], aria-*).`,
      en: () => `Give each element a unique id; adjust references accordingly (label[for], aria-*).`
    }
  },
  "inline-lang-change-missing": {
    message: {
      fr: (p) => `Attribut lang vide sur <${p.tag}> \u2014 changement de langue mal indiqu\xE9.`,
      en: (p) => `Empty lang attribute on <${p.tag}> \u2014 the language change is not properly indicated.`
    },
    remediation: {
      fr: () => `Renseignez un code de langue valide (ex. lang="en") ou retirez l'attribut.`,
      en: () => `Provide a valid language code (e.g. lang="en") or remove the attribute.`
    }
  },
  "lang-invalid": {
    message: {
      fr: (p) => `Code de langue invalide lang="${p.lang}" sur <${p.tag}> \u2014 n'est pas un code BCP 47 valide.`,
      en: (p) => `Invalid language code lang="${p.lang}" on <${p.tag}> \u2014 not a valid BCP 47 code.`
    },
    remediation: {
      fr: () => `Utilisez un code de langue valide (ex. "fr", "en", "fr-CA").`,
      en: () => `Use a valid language code (e.g. "en", "fr", "en-US").`
    }
  },
  // ---- Theme 9 — Headings (src/rules/headings.ts) -----------------------------
  "heading-order-skip": {
    message: {
      fr: (p) => `Saut de niveau de titre : <h${p.level}> apr\xE8s <h${p.prev}> (niveau h${p.expected} attendu).`,
      en: (p) => `Heading level skip: <h${p.level}> after <h${p.prev}> (level h${p.expected} expected).`
    },
    remediation: {
      fr: () => `Ne sautez pas de niveau : encha\xEEnez les titres sans omettre de palier.`,
      en: () => `Do not skip a level: chain heading levels without omitting a step.`
    }
  },
  // ADVISORY (non-normative): "start the page at h1" is not required by HTML, WCAG, or
  // SEO — a single, well-structured heading hierarchy (covered normatively by
  // heading-order-skip) is what matters. Worded as a recommendation, not a constat.
  "h1-missing": {
    message: {
      fr: () => `Recommandation : la page ne commence par aucun <h1>. Un <h1> d\xE9crivant le contenu principal aide au rep\xE9rage, mais d\xE9marrer \xE0 h1 n'est requis ni par HTML, ni par l'accessibilit\xE9, ni par le SEO.`,
      en: () => `Recommendation: the page starts with no <h1>. An <h1> naming the main content aids orientation, but starting at h1 is not required by HTML, accessibility, or SEO.`
    },
    remediation: {
      fr: () => `Envisagez d'ajouter un <h1> d\xE9crivant le contenu principal ; la hi\xE9rarchie des titres (sans saut de niveau) reste l'exigence normative.`,
      en: () => `Consider adding an <h1> describing the page's main content; a heading hierarchy with no level skip stays the normative requirement.`
    }
  },
  // ADVISORY (non-normative): "a single h1 per page" is not a rule in HTML, accessibility,
  // or SEO. Multiple h1 are valid (HTML5 sectioning) — worded as a recommendation.
  "h1-multiple": {
    message: {
      fr: (p) => `Recommandation : plusieurs <h1> dans la page (${p.count}). Un titre de niveau 1 unique clarifie souvent la structure, mais \xAB un seul <h1> par page \xBB n'est une r\xE8gle ni en HTML, ni en accessibilit\xE9, ni en SEO.`,
      en: (p) => `Recommendation: multiple <h1> in the page (${p.count}). A single level-1 heading often clarifies structure, but "one h1 per page" is not a rule in HTML, accessibility, or SEO.`
    },
    remediation: {
      fr: () => `Envisagez de conserver un unique <h1> et de hi\xE9rarchiser le reste avec h2\u2026h6 ; ce n'est pas une non-conformit\xE9.`,
      en: () => `Consider keeping a single <h1> and structuring the rest with h2\u2026h6; this is not a non-conformity.`
    }
  },
  "list-structure.invalid-child": {
    message: {
      fr: (p) => `<${p.childTag}> enfant direct de <${p.parentTag}> \u2014 une liste ne doit contenir que des <li>.`,
      en: (p) => `<${p.childTag}> is a direct child of <${p.parentTag}> \u2014 a list must only contain <li>.`
    },
    remediation: {
      fr: (p) => `Enveloppez le contenu dans des <li>, ou utilisez un autre \xE9l\xE9ment que <${p.parentTag}>.`,
      en: (p) => `Wrap the content in <li> elements, or use a different element than <${p.parentTag}>.`
    }
  },
  "list-structure.li-outside-list": {
    message: {
      fr: (p) => `<li> hors d'une liste (<${p.parentTag}> parent) \u2014 structure de liste invalide.`,
      en: (p) => `<li> outside a list (<${p.parentTag}> parent) \u2014 invalid list structure.`
    },
    remediation: {
      fr: () => `Placez chaque <li> directement dans un <ul>, <ol> ou <menu>.`,
      en: () => `Place each <li> directly inside a <ul>, <ol> or <menu>.`
    }
  },
  "empty-heading": {
    message: {
      fr: (p) => `Titre <${p.tag}> de niveau ${p.level} vide \u2014 un titre sans intitul\xE9 d\xE9soriente la navigation au clavier/lecteur d'\xE9cran.`,
      en: (p) => `Empty level-${p.level} <${p.tag}> heading \u2014 a heading with no label disorients keyboard/screen-reader navigation.`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 textuel au titre, ou retirez-le s'il est purement d\xE9coratif.`,
      en: () => `Give the heading a text label, or remove it if it is purely decorative.`
    }
  },
  // ---- Theme 10 — Presentation / zoom (src/rules/presentation.ts) -------------
  "meta-viewport-zoom-block": {
    message: {
      fr: (p) => `<meta viewport> bloque le zoom (${p.blockedBy === "user-scalable" ? "user-scalable=no" : `maximum-scale=${p.maxScale}`}) \u2014 agrandissement \xE0 200% emp\xEAch\xE9.`,
      en: (p) => `<meta viewport> blocks zoom (${p.blockedBy === "user-scalable" ? "user-scalable=no" : `maximum-scale=${p.maxScale}`}) \u2014 200% zoom is prevented.`
    },
    remediation: {
      fr: () => `Retirez user-scalable=no et maximum-scale (ou maximum-scale \u2265 2) du content du viewport.`,
      en: () => `Remove user-scalable=no and maximum-scale (or set maximum-scale \u2265 2) from the viewport content.`
    }
  },
  "presentational-element": {
    message: {
      fr: (p) => `<${p.tag}> est une balise de pr\xE9sentation \u2014 la mise en forme doit passer par CSS (test RGAA 10.1.1).`,
      en: (p) => `<${p.tag}> is a presentational element \u2014 styling belongs in CSS (RGAA test 10.1.1).`
    },
    remediation: {
      fr: (p) => `Remplacez <${p.tag}> par un \xE9l\xE9ment porteur de sens (ou un <span>/<div> neutre) et d\xE9placez la mise en forme dans la feuille de styles.`,
      en: (p) => `Replace <${p.tag}> with a meaningful element (or a neutral <span>/<div>) and move the styling to the stylesheet.`
    }
  },
  "presentational-attribute": {
    message: {
      fr: (p) => `Attribut de pr\xE9sentation ${p.attr} sur <${p.tag}> \u2014 la mise en forme doit passer par CSS (test RGAA 10.1.2).`,
      en: (p) => `Presentational attribute ${p.attr} on <${p.tag}> \u2014 styling belongs in CSS (RGAA test 10.1.2).`
    },
    remediation: {
      fr: (p) => `Retirez ${p.attr} de <${p.tag}> et exprimez la m\xEAme mise en forme dans la feuille de styles.`,
      en: (p) => `Remove ${p.attr} from <${p.tag}> and express the same styling in the stylesheet.`
    }
  },
  "presentational-spacing": {
    message: {
      fr: (p) => p.how === "spelled-out" ? `Mot dont les lettres sont s\xE9par\xE9es par des espaces \u2014 restitu\xE9 lettre \xE0 lettre par un lecteur d'\xE9cran (test RGAA 10.1.3).` : `Suite d'espaces ins\xE9cables utilis\xE9e comme mise en page (test RGAA 10.1.3).`,
      en: (p) => p.how === "spelled-out" ? `A word whose letters are separated by spaces \u2014 a screen reader reads it out letter by letter (RGAA test 10.1.3).` : `A run of non-breaking spaces used as layout (RGAA test 10.1.3).`
    },
    remediation: {
      fr: (p) => p.how === "spelled-out" ? `\xC9crivez le mot normalement et obtenez l'espacement avec letter-spacing en CSS.` : `Remplacez les espaces ins\xE9cables par une mise en page CSS (grille, colonnes, marges).`,
      en: (p) => p.how === "spelled-out" ? `Write the word normally and get the spacing from CSS letter-spacing.` : `Replace the non-breaking spaces with CSS layout (grid, columns, margins).`
    }
  },
  "css-generated-content-informative": {
    message: {
      fr: (p) => `Contenu g\xE9n\xE9r\xE9 en CSS porteur de texte (content: "${p.text}") : invisible pour les technologies d'assistance.`,
      en: (p) => `CSS generated content carrying text (content: "${p.text}"): invisible to assistive technologies.`
    },
    remediation: {
      fr: () => `D\xE9placez ce texte informatif dans le DOM ; r\xE9servez content aux \xE9l\xE9ments purement d\xE9coratifs.`,
      en: () => `Move this informative text into the DOM; keep content for purely decorative elements.`
    }
  },
  // ---- Theme 11 — Forms (src/rules/forms.ts) ----------------------------------
  "control-label-missing": {
    message: {
      fr: (p) => `Champ de formulaire <${p.tag}> sans \xE9tiquette \u2014 aucun label associ\xE9.`,
      en: (p) => `Form field <${p.tag}> has no label \u2014 no associated label.`
    },
    remediation: {
      fr: () => `Associez un <label for="\u2026"> (ou enveloppez le champ d'un <label>, ou aria-label/aria-labelledby).`,
      en: () => `Associate a <label for="\u2026"> (or wrap the field in a <label>, or use aria-label/aria-labelledby).`
    }
  },
  "placeholder-as-label": {
    message: {
      fr: (p) => `placeholder="${p.value}" utilis\xE9 comme seule \xE9tiquette \u2014 le placeholder n'est pas un label.`,
      en: (p) => `placeholder="${p.value}" used as the only label \u2014 a placeholder is not a label.`
    },
    remediation: {
      fr: () => `Ajoutez un <label> r\xE9el ; le placeholder ne doit que compl\xE9ter, pas remplacer l'\xE9tiquette.`,
      en: () => `Add a real <label>; the placeholder should only supplement, not replace, the label.`
    }
  },
  "fieldset-legend-missing": {
    message: {
      fr: () => `<fieldset> sans <legend> (ou l\xE9gende vide) \u2014 regroupement de champs sans l\xE9gende.`,
      en: () => `<fieldset> has no <legend> (or an empty one) \u2014 a field group with no legend.`
    },
    remediation: {
      fr: () => `Ajoutez un <legend> non vide en premier enfant du <fieldset>.`,
      en: () => `Add a non-empty <legend> as the first child of the <fieldset>.`
    }
  },
  "form-field-multiple-labels": {
    message: {
      fr: (p) => `Champ <${p.tag}> r\xE9f\xE9renc\xE9 par ${p.count} <label for="${p.id}"> \u2014 \xE9tiquettes multiples ambigu\xEBs.`,
      en: (p) => `Field <${p.tag}> referenced by ${p.count} <label for="${p.id}"> \u2014 ambiguous multiple labels.`
    },
    remediation: {
      fr: () => `Un seul <label> doit cibler le champ ; fusionnez ou retirez les \xE9tiquettes superflues.`,
      en: () => `A single <label> should target the field; merge or remove the superfluous labels.`
    }
  },
  "select-has-option": {
    message: {
      fr: () => `<select> sans aucune <option> \u2014 liste de choix vide.`,
      en: () => `<select> has no <option> at all \u2014 empty choice list.`
    },
    remediation: {
      fr: () => `Ajoutez des <option> (et un <optgroup>/option par d\xE9faut si pertinent).`,
      en: () => `Add <option> elements (and an <optgroup>/default option if relevant).`
    }
  },
  "label-for-dangling": {
    message: {
      fr: (p) => `<label for="${p.id}"> ne cible aucun \xE9l\xE9ment \u2014 aucun champ n'a id="${p.id}".`,
      en: (p) => `<label for="${p.id}"> targets no element \u2014 no field has id="${p.id}".`
    },
    remediation: {
      fr: (p) => `Donnez au champ id="${p.id}", corrigez l'attribut for, ou enveloppez le champ dans le <label>.`,
      en: (p) => `Give the field id="${p.id}", fix the for attribute, or wrap the field inside the <label>.`
    }
  },
  "aria-invalid-no-description": {
    message: {
      fr: (p) => `<${p.tag}> a aria-invalid="true" mais aucun aria-describedby/aria-errormessage \u2014 l'erreur est signal\xE9e sans \xEAtre reli\xE9e \xE0 son message.`,
      en: (p) => `<${p.tag}> has aria-invalid="true" but no aria-describedby/aria-errormessage \u2014 the error is signalled without being linked to its message.`
    },
    remediation: {
      fr: () => `Reliez le message d'erreur au champ via aria-describedby (ou aria-errormessage) pointant vers le texte d'erreur.`,
      en: () => `Link the error message to the field via aria-describedby (or aria-errormessage) pointing at the error text.`
    }
  },
  "error-not-associated": {
    message: {
      fr: (p) => `Message d'erreur (id="${p.id}") reli\xE9 \xE0 aucun champ \u2014 aucun aria-describedby/aria-errormessage ne le r\xE9f\xE9rence.`,
      en: (p) => `Error message (id="${p.id}") linked to no field \u2014 no aria-describedby/aria-errormessage references it.`
    },
    remediation: {
      fr: (p) => `Sur le champ concern\xE9, ajoutez aria-describedby="${p.id}" (ou aria-errormessage) et aria-invalid="true" ; restituez l'erreur via role="alert" (pas aria-live="polite"), sans \xE0 la fois d\xE9placer le focus et recourir \xE0 aria-live/role="alert".`,
      en: (p) => `On the relevant field, add aria-describedby="${p.id}" (or aria-errormessage) and aria-invalid="true"; announce the error via role="alert" (not aria-live="polite"), without both moving focus and using a live region.`
    }
  },
  "field-purpose-incomplete.autocomplete": {
    message: {
      fr: (p) => `Champ d'identification (${p.type === "email" || p.type === "tel" ? `type="${p.type}"` : "name/id"}) sans autocomplete \u2014 objet du champ non expos\xE9.`,
      en: (p) => `Identification field (${p.type === "email" || p.type === "tel" ? `type="${p.type}"` : "name/id"}) with no autocomplete \u2014 the field's purpose is not exposed.`
    },
    remediation: {
      // No trailing criterion reference: every rendering already states the criterion this
      // remediation belongs to, and under a country standard the hard-coded « WCAG 1.3.5 »
      // named a referential the rest of the deliverable no longer mentions.
      fr: () => `Ajoutez un autocomplete appropri\xE9 (ex. email, tel, name, postal-code, street-address).`,
      en: () => `Add an appropriate autocomplete (e.g. email, tel, name, postal-code, street-address).`
    }
  },
  "field-purpose-incomplete.aria-required": {
    message: {
      fr: (p) => `Widget personnalis\xE9 (role="${p.role}") requis sans aria-required \u2014 l'\xE9tat requis n'est pas restitu\xE9.`,
      en: (p) => `Custom widget (role="${p.role}") is required but has no aria-required \u2014 the required state is not conveyed.`
    },
    remediation: {
      fr: () => `Ajoutez aria-required="true" sur le widget personnalis\xE9 requis.`,
      en: () => `Add aria-required="true" on the required custom widget.`
    }
  },
  "disabled-context-content.fieldset": {
    message: {
      fr: () => `<fieldset disabled> encapsulant des champs en lecture seule \u2014 le contenu risque d'\xEAtre ignor\xE9 par les technologies d'assistance.`,
      en: () => `<fieldset disabled> wrapping read-only fields \u2014 the content may be ignored by assistive technologies.`
    },
    remediation: {
      fr: () => `Remplacez le conteneur d\xE9sactiv\xE9 par un <div> (ou aria-disabled="true" + gestion clavier en JS) afin que le contenu reste restitu\xE9.`,
      en: () => `Replace the disabled container with a <div> (or aria-disabled="true" + JS keyboard handling) so the content stays exposed.`
    }
  },
  "disabled-context-content.inert": {
    message: {
      fr: () => `Conteneur [inert] encapsulant des champs de formulaire \u2014 leur contenu est retir\xE9 de l'arbre d'accessibilit\xE9.`,
      en: () => `[inert] container wrapping form fields \u2014 their content is taken out of the accessibility tree.`
    },
    remediation: {
      fr: () => `Retirez [inert] du conteneur en lecture seule (ou aria-disabled="true" + JS) pour que le contenu reste restitu\xE9.`,
      en: () => `Take [inert] off the read-only container (or use aria-disabled="true" + JS) so the content stays exposed.`
    }
  },
  "radio-checkbox-group-ungrouped": {
    message: {
      fr: (p) => `${p.count} champs ${p.type} partageant name="${p.name}" hors de tout <fieldset>/role="radiogroup"/role="group" \u2014 regroupement absent.`,
      en: (p) => `${p.count} ${p.type} fields sharing name="${p.name}" outside any <fieldset>/role="radiogroup"/role="group" \u2014 grouping is missing.`
    },
    remediation: {
      fr: () => `Regroupez ces champs de m\xEAme nature dans un <fieldset> avec <legend> (ou un role="radiogroup"/role="group" nomm\xE9).`,
      en: () => `Group these same-nature fields in a <fieldset> with a <legend> (or a named role="radiogroup"/role="group").`
    }
  },
  "date-fields-ungrouped": {
    message: {
      fr: (p) => `${p.count} champs de date adjacents hors de tout <fieldset>/role="group" \u2014 champs de m\xEAme nature non regroup\xE9s.`,
      en: (p) => `${p.count} adjacent date fields outside any <fieldset>/role="group" \u2014 same-nature fields left ungrouped.`
    },
    remediation: {
      fr: () => `Regroupez les champs de date (jour/mois/ann\xE9e, d\xE9but/fin) dans un <fieldset> avec une <legend> d\xE9crivant la p\xE9riode.`,
      en: () => `Group the date fields (day/month/year, start/end) in a <fieldset> with a <legend> describing the period.`
    }
  },
  // ---- Theme 12 — Navigation & landmarks (src/rules/navigation.ts) ------------
  "bypass-blocks-missing": {
    message: {
      fr: () => `La page r\xE9p\xE8te un bloc de navigation avant son contenu sans aucun moyen de le contourner : ni titre hors de la navigation, ni r\xE9gion (main, aside, section\u2026) autour du contenu, ni lien d'\xE9vitement.`,
      en: () => `The page repeats a navigation block before its content with no way to bypass it: no heading outside the navigation, no landmark (main, aside, section\u2026) around the content, and no skip link.`
    },
    remediation: {
      fr: () => `Placez le contenu principal dans <main>, ouvrez-le par un titre, et/ou ajoutez en t\xEAte de page un lien d'\xE9vitement vers lui.`,
      en: () => `Wrap the main content in <main>, start it with a heading, and/or add a skip link to it at the top of the page.`
    }
  },
  "skip-link-target-missing": {
    message: {
      fr: (p) => `Lien interne href="${p.href}" \u2014 la cible #${p.id} n'existe pas dans la page (lien d'\xE9vitement/ancre cass\xE9).`,
      en: (p) => `Internal link href="${p.href}" \u2014 target #${p.id} does not exist in the page (broken skip link/anchor).`
    },
    remediation: {
      fr: (p) => `Ajoutez un \xE9l\xE9ment avec id="${p.id}" (ex. <main id="${p.id}">) ou corrigez l'ancre.`,
      en: (p) => `Add an element with id="${p.id}" (e.g. <main id="${p.id}">) or fix the anchor.`
    }
  },
  "positive-tabindex": {
    message: {
      fr: (p) => `tabindex="${p.value}" positif \u2014 force un ordre de tabulation incoh\xE9rent avec l'ordre du DOM.`,
      en: (p) => `Positive tabindex="${p.value}" \u2014 forces a tab order inconsistent with DOM order.`
    },
    remediation: {
      fr: () => `Utilisez tabindex="0" (ou pas de tabindex) et ordonnez via le DOM ; r\xE9servez les valeurs >0.`,
      en: () => `Use tabindex="0" (or no tabindex) and order via the DOM; reserve values >0.`
    }
  },
  "missing-main-landmark": {
    message: {
      fr: () => `Aucun rep\xE8re <main> dans la page \u2014 le contenu principal n'est pas identifi\xE9 (et la cible d'un lien d'\xE9vitement manque).`,
      en: () => `No <main> landmark in the page \u2014 the main content is not identified (and a skip link's target is missing).`
    },
    remediation: {
      fr: () => `Enveloppez le contenu principal dans un <main id="content"> (unique par page).`,
      en: () => `Wrap the main content in a <main id="content"> (unique per page).`
    }
  },
  "multiple-main-landmark": {
    message: {
      fr: (p) => `Plusieurs rep\xE8res <main> dans la page (${p.count}) \u2014 un seul contenu principal est autoris\xE9.`,
      en: (p) => `Multiple <main> landmarks in the page (${p.count}) \u2014 only one main content area is allowed.`
    },
    remediation: {
      fr: () => `Conservez un unique <main>/role="main" ; structurez le reste avec <section>/<aside>.`,
      en: () => `Keep a single <main>/role="main"; structure the rest with <section>/<aside>.`
    }
  },
  "nav-landmark-missing": {
    message: {
      fr: (p) => `Groupe de ${p.count} liens de navigation dans <${p.region}> sans rep\xE8re de navigation (<nav> ou role="navigation") dans la page.`,
      en: (p) => `A cluster of ${p.count} navigation links in <${p.region}> with no navigation landmark (<nav> or role="navigation") in the page.`
    },
    remediation: {
      fr: () => `Encapsulez les liens de navigation dans un <nav> (ou role="navigation") pour exposer un rep\xE8re de navigation.`,
      en: () => `Wrap the navigation links in a <nav> (or role="navigation") to expose a navigation landmark.`
    }
  },
  "nav-landmark-unnamed": {
    message: {
      fr: () => `Plusieurs rep\xE8res de navigation dans la page ; celui-ci n'a ni aria-label ni aria-labelledby pour le distinguer.`,
      en: () => `Several navigation landmarks in the page; this one has neither aria-label nor aria-labelledby to tell them apart.`
    },
    remediation: {
      fr: () => `Donnez \xE0 chaque <nav> un aria-label (ou aria-labelledby) distinct, ex. \xAB Menu principal \xBB / \xAB Fil d'Ariane \xBB.`,
      en: () => `Give each <nav> a distinct aria-label (or aria-labelledby), e.g. "Primary" / "Breadcrumb".`
    }
  },
  // ---- Theme 4/13 — Multimedia (src/rules/multimedia.ts) ----------------------
  "autoplay-media.muted-video": {
    message: {
      fr: () => `<video autoplay> d\xE9marre automatiquement \u2014 contenu en mouvement non contr\xF4l\xE9.`,
      en: () => `<video autoplay> starts automatically \u2014 uncontrolled moving content.`
    },
    remediation: {
      fr: () => `\xC9vitez l'autoplay ou fournissez un contr\xF4le pause/stop accessible (et controls).`,
      en: () => `Avoid autoplay, or provide an accessible pause/stop control (and controls).`
    }
  },
  "autoplay-media.audible": {
    message: {
      fr: (p) => `<${p.tag} autoplay> d\xE9marre automatiquement ${p.tag === "audio" ? "du son" : "une vid\xE9o sonore"} \u2014 non contr\xF4lable par l'utilisateur.`,
      en: (p) => `<${p.tag} autoplay> automatically starts ${p.tag === "audio" ? "sound" : "a video with sound"} \u2014 not controllable by the user.`
    },
    remediation: {
      fr: () => `Retirez autoplay, ou ajoutez un contr\xF4le de lecture (controls + pause/stop) facilement accessible.`,
      en: () => `Remove autoplay, or add an easily accessible playback control (controls + pause/stop).`
    }
  },
  "media-no-track": {
    message: {
      fr: () => `<video> sans \xE9l\xE9ment <track> \u2014 aucune piste de sous-titres/l\xE9gendes synchronis\xE9es.`,
      en: () => `<video> has no <track> element \u2014 no synchronized captions/subtitles track.`
    },
    remediation: {
      fr: () => `Ajoutez <track kind="captions" src="\u2026" srclang="fr" label="Fran\xE7ais"> (ou subtitles) pour le m\xE9dia synchronis\xE9.`,
      en: () => `Add <track kind="captions" src="\u2026" srclang="en" label="English"> (or subtitles) for the synchronized media.`
    }
  },
  // ---- Theme 13 — Timing & moving content (src/rules/timing.ts) ---------------
  "meta-refresh-redirect": {
    message: {
      fr: (p) => `<meta http-equiv="refresh" content="${p.content}"> impose un d\xE9lai de ${p.seconds}s \u2014 rafra\xEEchissement/redirection temporis\xE9 non contr\xF4lable.`,
      en: (p) => `<meta http-equiv="refresh" content="${p.content}"> imposes a ${p.seconds}s delay \u2014 an uncontrollable timed refresh/redirect.`
    },
    remediation: {
      fr: () => `Supprimez le meta refresh temporis\xE9, ou laissez l'utilisateur contr\xF4ler/d\xE9sactiver/prolonger le d\xE9lai.`,
      en: () => `Remove the timed meta refresh, or let the user control/disable/extend the delay.`
    }
  },
  "blink-marquee": {
    message: {
      fr: (p) => `<${p.tag}> \u2014 contenu en mouvement/clignotant automatique sans m\xE9canisme de pause.`,
      en: (p) => `<${p.tag}> \u2014 automatic moving/blinking content with no pause mechanism.`
    },
    remediation: {
      fr: (p) => `Remplacez <${p.tag}> par du contenu statique, ou fournissez un contr\xF4le pause/stop/masquer.`,
      en: (p) => `Replace <${p.tag}> with static content, or provide a pause/stop/hide control.`
    }
  },
  // ---- Cross-file rules (src/rules/cross-registry.ts) -------------------------
  "cross-icon-only-unnamed": {
    message: {
      fr: (p) => `<${p.tag}> rend un contr\xF4le \xE0 ic\xF4ne seule mais est utilis\xE9 sans nom accessible (aucun aria-label/title/texte pass\xE9).`,
      en: (p) => `<${p.tag}> renders an icon-only control but is used with no accessible name (no aria-label/title/text passed).`
    },
    remediation: {
      fr: (p) => `Passez un nom au composant \xE0 cet endroit, p. ex. <${p.tag} aria-label="\u2026" /> (le composant ${p.defName} rend une ic\xF4ne sans texte).`,
      en: (p) => `Pass a name to the component at this usage, e.g. <${p.tag} aria-label="\u2026" /> (the component ${p.defName} renders an icon with no text).`
    }
  },
  "cross-prop-drilled-name-lost": {
    message: {
      fr: (p) => `<${p.tag} ${p.passed}="\u2026"> mais ${p.defName} ne transmet pas ce nom au contr\xF4le rendu \u2014 le nom accessible est perdu.`,
      en: (p) => `<${p.tag} ${p.passed}="\u2026"> but ${p.defName} does not forward this name to the rendered control \u2014 the accessible name is lost.`
    },
    remediation: {
      fr: (p) => `Dans ${p.defName}, transmettez ${p.passed} (ou {...props}) au <button>/<a> rendu, ou nommez le contr\xF4le directement.`,
      en: (p) => `In ${p.defName}, forward ${p.passed} (or {...props}) to the rendered <button>/<a>, or name the control directly.`
    }
  },
  // ---- Dynamic tier (src/scan.ts mergeDynamic) ---------------------------------
  // `scan --merge` folds axe-core/probe findings into a static AuditResult. Their
  // MESSAGE is either ultra11y's own authored prose (the 320px reflow check) or the
  // rendering engine's own text (axe-core's English violation help, or a probe's own
  // detail string) — never ultra11y prose in the latter case. Only the REMEDIATION
  // is always ultra11y-authored. Both entries below give these findings a `msg.id`
  // (set in mergeDynamic) so a LATER `report`/`prd --lang` re-render can still
  // resolve the OTHER language, instead of staying stuck in whatever language was
  // baked at merge/scan time.
  // `widening` — the selectors of the boxes the probe found wider than the viewport. Absent on a
  // finding recorded before the probe named causes, or by a producer that did not look: the sentence then states
  // the scroll and nothing else, never a cause nobody measured.
  "dyn-reflow": {
    message: {
      fr: (p) => `D\xE9filement horizontal \xE0 320px de large${p.widening ? ` \u2014 la page est \xE9largie par ${String(p.widening)}` : ""}${p.clippedText === void 0 ? "" : p.clippedCapped !== void 0 ? ` ; mesure du contenu hors viewport INCOMPL\xC8TE (arr\xEAt\xE9e apr\xE8s ${String(p.clippedCapped)} n\u0153uds de texte) : au moins ${String(p.clippedText)} bloc(s) de texte et ${String(p.clippedControls)} contr\xF4le(s) ou \xE9l\xE9ment(s) remplac\xE9(s) pos\xE9s au-del\xE0 du viewport` : p.clippedText === "0" && p.clippedControls === "0" ? " ; aucun texte ni contr\xF4le n'est pos\xE9 au-del\xE0 du viewport : seules des bo\xEEtes d\xE9bordent" : ` ; ${String(p.clippedText)} bloc(s) de texte et ${String(p.clippedControls)} contr\xF4le(s) ou \xE9l\xE9ment(s) remplac\xE9(s) pos\xE9s au-del\xE0 du viewport`}.`,
      en: (p) => `Horizontal scrolling at 320px width${p.widening ? ` \u2014 the page is widened by ${String(p.widening)}` : ""}${p.clippedText === void 0 ? "" : p.clippedCapped !== void 0 ? `; the measure of content beyond the viewport is INCOMPLETE (stopped after ${String(p.clippedCapped)} text nodes): at least ${String(p.clippedText)} text block(s) and ${String(p.clippedControls)} control(s) or replaced element(s) lie beyond the viewport` : p.clippedText === "0" && p.clippedControls === "0" ? "; no text or control lies beyond the viewport: only boxes overflow" : `; ${String(p.clippedText)} text block(s) and ${String(p.clippedControls)} control(s) or replaced element(s) lie beyond the viewport`}.`
    },
    remediation: {
      fr: () => `V\xE9rifi\xE9 au rendu par axe-core ; corrigez l'\xE9l\xE9ment cit\xE9.`,
      en: () => `Verified at render time by axe-core; fix the cited element.`
    }
  },
  // ---- Journey observations (`journey run`, src/journey-run.ts) ----
  // Worded once, in the run's language, into the probe hit's `detail` — the same channel the
  // live probes use — so a snapshot re-audited offline carries the sentence the replay wrote.
  "journey-keyboard-unreachable": {
    message: {
      fr: (p) => `${p.control} n'a jamais re\xE7u le focus : ${p.tabs} appui(s) sur Tab ont parcouru tout l'ordre de tabulation sans l'atteindre. L'\xE9tape \xAB ${p.step} \xBB n'est pas r\xE9alisable au clavier seul (elle a \xE9t\xE9 jou\xE9e au pointeur pour poursuivre le parcours).`,
      en: (p) => `${p.control} never received focus: ${p.tabs} Tab press(es) walked the whole tab order without reaching it. The step "${p.step}" cannot be performed with the keyboard alone (it was played with the pointer so the journey could go on).`
    },
    remediation: {
      fr: () => `Utilisez un \xE9l\xE9ment natif (<button>, <a href>) ou donnez au composant tabindex="0", un r\xF4le et la gestion des touches Entr\xE9e et Espace.`,
      en: () => `Use a native element (<button>, <a href>), or give the component tabindex="0", a role and Enter/Space key handling.`
    }
  },
  "journey-keyboard-trap": {
    message: {
      fr: (p) => `Pi\xE8ge clavier : le focus reste sur ${p.region} (${p.count} \xE9l\xE9ment(s)) \u2014 ni Tab ni Maj+Tab ne permettent d'en sortir, alors que la page compte ${p.total} \xE9l\xE9ment(s) focalisable(s).`,
      en: (p) => `Keyboard trap: focus stays within ${p.region} (${p.count} element(s)) \u2014 neither Tab nor Shift+Tab moves it out, while the page has ${p.total} focusable element(s).`
    },
    remediation: {
      fr: () => `Laissez Tab et Maj+Tab sortir du composant, ou annoncez une touche standard (\xC9chap) qui rend le focus \xE0 la page.`,
      en: () => `Let Tab and Shift+Tab leave the component, or announce a standard key (Escape) that hands focus back to the page.`
    }
  },
  "journey-dialog-focus-in": {
    message: {
      fr: (p) => `La bo\xEEte de dialogue ${p.dialog} s'est ouverte, mais le focus est rest\xE9 sur ${p.focus} : il n'a pas \xE9t\xE9 d\xE9plac\xE9 dans la bo\xEEte.`,
      en: (p) => `The dialog ${p.dialog} opened, but focus stayed on ${p.focus}: it was not moved into the dialog.`
    },
    remediation: {
      fr: () => `\xC0 l'ouverture, d\xE9placez le focus sur le premier \xE9l\xE9ment pertinent de la bo\xEEte de dialogue (ou sur la bo\xEEte elle-m\xEAme, tabindex="-1").`,
      en: () => `On opening, move focus to the first relevant element of the dialog (or to the dialog itself, tabindex="-1").`
    }
  },
  "journey-dialog-focus-return": {
    message: {
      fr: (p) => `La bo\xEEte de dialogue ${p.dialog} s'est ferm\xE9e, mais le focus n'est pas revenu sur ${p.trigger} qui l'avait ouverte (il est sur ${p.focus}).`,
      en: (p) => `The dialog ${p.dialog} closed, but focus did not return to ${p.trigger}, which opened it (it is on ${p.focus}).`
    },
    remediation: {
      fr: () => `\xC0 la fermeture, rendez le focus \xE0 l'\xE9l\xE9ment qui a ouvert la bo\xEEte de dialogue.`,
      en: () => `On closing, return focus to the element that opened the dialog.`
    }
  },
  "journey-error-unassociated": {
    message: {
      fr: (p) => `Message d'erreur affich\xE9 apr\xE8s l'action \xAB ${p.step} \xBB (\xAB ${p.text} \xBB) sans lien programmatique avec ${p.field} : ni aria-describedby, ni aria-errormessage, ni <label> ne le relient au champ.`,
      en: (p) => `Error message shown after the action "${p.step}" ("${p.text}") with no programmatic link to ${p.field}: no aria-describedby, aria-errormessage or <label> ties it to the field.`
    },
    remediation: {
      fr: () => `Reliez le message au champ par aria-describedby (ou aria-errormessage avec aria-invalid="true"), ou placez-le dans son <label>.`,
      en: () => `Tie the message to its field with aria-describedby (or aria-errormessage with aria-invalid="true"), or put it inside its <label>.`
    }
  },
  "journey-status-message": {
    message: {
      fr: (p) => `Apr\xE8s l'action \xAB ${p.step} \xBB, le texte \xAB ${p.text} \xBB est apparu hors de tout conteneur aria-live (ou role=status|alert|log) \u2014 probablement non restitu\xE9 aux technologies d'assistance.`,
      en: (p) => `After the action "${p.step}", the text "${p.text}" appeared outside any live region (aria-live / role=status|alert|log) \u2014 likely not announced to assistive technology.`
    },
    remediation: {
      fr: () => `Si ce texte est un message de statut, placez-le dans un conteneur role="status" (ou aria-live="polite") pr\xE9sent avant la mise \xE0 jour.`,
      en: () => `If this text is a status message, render it inside a role="status" (or aria-live="polite") container that exists before the update.`
    }
  },
  "dyn-remediation": {
    // Covers axe-core findings and the residual-criteria probes (focus-visible,
    // text-spacing, hover, reflow-zoom). Their message is authored by the engine
    // itself, not by ultra11y — it passes through UNCHANGED in both languages (never
    // translated; axe-core only ever speaks English), carried verbatim via `params.
    // message`. This is the documented "axe's own English messages stay as-is".
    message: {
      fr: (p) => String(p.message ?? ""),
      en: (p) => String(p.message ?? "")
    },
    remediation: {
      fr: () => `V\xE9rifi\xE9 au rendu par axe-core ; corrigez l'\xE9l\xE9ment cit\xE9.`,
      en: () => `Verified at render time by axe-core; fix the cited element.`
    }
  }
};
function entryFor(id) {
  return id === void 0 ? void 0 : MSG_CATALOG[id];
}
function resolveMessage(f, lang) {
  const localized = f.i18n?.message?.[lang];
  if (localized) return localized;
  const entry = entryFor(f.msg?.id);
  return entry ? entry.message[lang](f.msg?.params ?? {}) : f.message;
}

// src/integrations/payload.ts
var RANK = { bloquant: 0, majeur: 1, mineur: 2 };
var THRESHOLD = { blocking: 0, bloquant: 0, major: 1, majeur: 1, minor: 2, mineur: 2 };
function failingFindings(result, failOn) {
  const max = THRESHOLD[failOn];
  if (max === void 0) throw new Error(`ultra11y: failOn must be blocking|major|minor (got "${failOn}")`);
  return (result.findings ?? []).filter((f) => !f.advisory && (RANK[f.severity] ?? 99) <= max);
}
var FAILURE = {
  fr: {
    head: (n, page) => `ultra11y : ${n} non-conformit\xE9(s) d'accessibilit\xE9 sur \xAB ${page} \xBB :`,
    more: (n) => `  \u2026 et ${n} de plus.`,
    detail: "D\xE9tail complet : .ultra11y/pages/ \u2014 r\xE9-auditez hors ligne avec `ultra11y audit`."
  },
  en: {
    head: (n, page) => `ultra11y: ${n} accessibility non-conformity(ies) on "${page}":`,
    more: (n) => `  \u2026 and ${n} more.`,
    detail: "Full detail: .ultra11y/pages/ \u2014 re-audit offline with `ultra11y audit`."
  }
};
function formatFailure(pageName, failing, lang = "fr", message = (f, l) => f.i18n?.message?.[l] ?? f.message) {
  const t = FAILURE[lang];
  const lines = [t.head(failing.length, pageName)];
  for (const f of failing.slice(0, 20)) {
    lines.push(`  [${f.severity}] ${f.ruleId} (WCAG ${f.criteriaId}) \u2014 ${f.origin?.sourceFile ?? f.file} \u2014 ${message(f, lang)}`);
  }
  if (failing.length > 20) lines.push(t.more(failing.length - 20));
  lines.push(t.detail);
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
function checkLang(result, lang) {
  if (lang === "fr" || lang === "en") return lang;
  const top = result.scope?.langs?.[0];
  return top === "en" ? "en" : "fr";
}
function reportOpts(report, lang) {
  const r = typeof report === "object" ? report : {};
  return r.lang || !lang ? r : { ...r, lang };
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
function buildPayload(collected, url, runner, opts, screenshot, probes, axe, screenshotFull) {
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
      ...opts.notes ? { notes: opts.notes } : {},
      // Still loading when collected: named, so the report can say so and the audit concludes
      // nothing from this page's silence.
      ...collected.loading?.length ? { loading: collected.loading } : {},
      // Captured without consent (#184): a test browser never accepts cookies either, so the
      // consent placeholders it showed are named and their content tagged in the briefs.
      ...collected.consent?.length ? { consent: "none", consentMarkers: collected.consent } : {}
    },
    dom: collected.dom,
    styles: collected.styles,
    boxes: collected.boxes,
    css: collected.css,
    ...screenshot ? { screenshot } : {},
    ...screenshotFull ? { screenshotFull } : {},
    // What the live probes measured, when the caller asked for them. It rides in the payload
    // because `snapshot write` persists it beside the DOM — the audit that folds it runs later
    // and in another process, so a measurement kept in memory decides nothing.
    ...probes ? { probes } : {},
    // Same contract as the probes: it rides in the payload and `snapshot write` persists it
    // beside the DOM, so the offline re-audit sees what the browser saw.
    ...axe ? { axe } : {},
    // The behaviour digest, when the runner opened a capture window (src/behaviour.ts).
    ...collected.scripts ? { scripts: collected.scripts } : {}
  };
}
function gate(result, pageName, failOn, lang, message) {
  const threshold = failOn === void 0 ? "blocking" : failOn;
  if (threshold === false) return;
  const failing = failingFindings(result, threshold);
  if (failing.length) throw new Error(formatFailure(pageName, failing, checkLang(result, lang), message));
}

// src/integrations/core.ts
function enginePath() {
  if (process.env.ULTRA11Y) return process.env.ULTRA11Y;
  try {
    return createRequire2(import.meta.url).resolve("ultra11y/scripts/ultra11y.mjs");
  } catch {
    return new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
  }
}
function localizedMessage(f, lang) {
  return resolveMessage(f, lang);
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
var LINKS_SCRIPT = `(() => Array.from(document.querySelectorAll("a[href]"), (a) => ({
  href: a.href,
  download: a.hasAttribute("download"),
  type: a.getAttribute("type") || "",
  text: (a.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 500),
  ariaLabel: a.getAttribute("aria-label") || "",
  title: a.getAttribute("title") || "",
})))()`;
var storedDocuments = /* @__PURE__ */ new Map();
function requestFetcher(request) {
  return async (url) => {
    const res = await request.get(url, { timeout: DOCUMENT_TIMEOUT_MS, maxRedirects: 0, failOnStatusCode: false });
    const headers = res.headers();
    return {
      status: res.status(),
      header: (name) => headers[name.toLowerCase()],
      discard: async () => {
        await res.dispose?.();
      },
      // The request context buffers the whole body; the declared length is checked first, and a
      // body over the bound is still never kept.
      body: async (maxBytes) => {
        const bytes = await res.body();
        await res.dispose?.();
        return bytes.length > maxBytes ? void 0 : bytes;
      }
    };
  };
}
async function downloadPageDocuments(page, pageId, opts = {}) {
  const request = page.context?.()?.request;
  if (!request) return [];
  const root = opts.root ?? process.cwd();
  const max = opts.maxPdf ?? DOCUMENT_MAX_COUNT;
  let pageUrl;
  try {
    pageUrl = new URL(page.url());
  } catch {
    return [];
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return [];
  const links = await page.evaluate(LINKS_SCRIPT) ?? [];
  const candidates = [...new Set(links.map((l) => documentCandidate(l, pageUrl)).filter((u) => !!u))].sort();
  const files = [];
  const inRoot = (url) => `${root}
${url}`;
  let attempts = 0;
  for (const url of candidates) {
    const known = storedDocuments.get(inRoot(url));
    if (known && existsSync3(known)) {
      recordDocumentPages(known, url, [pageId]);
      files.push(known);
      continue;
    }
    const held = [...storedDocuments.keys()].filter((k) => k.startsWith(`${root}
`)).length;
    if (held >= max || attempts >= max) {
      console.warn(`ultra11y: document not downloaded \u2014 ${url}: document cap reached (${max}).`);
      continue;
    }
    attempts++;
    try {
      const r = await fetchDocument(url, requestFetcher(request), { maxBytes: DOCUMENT_MAX_BYTES });
      if ("reason" in r) {
        console.warn(`ultra11y: document not downloaded \u2014 ${url}: ${r.reason}.`);
        continue;
      }
      const file = storeDocument(root, url, r.bytes, [pageId]);
      storedDocuments.set(inRoot(url), file);
      files.push(file);
    } catch (e) {
      console.warn(`ultra11y: document not downloaded \u2014 ${url}: failed: ${e instanceof Error ? e.message : String(e)}.`);
    }
  }
  return files;
}
function probeOptions(p) {
  if (p === true || p === void 0) return fromConfig();
  if (p === false) return {};
  if (Array.isArray(p)) return { only: p, ...fromConfig() };
  const { only, ...limits } = p;
  return { ...only ? { only } : {}, limits };
}
function fromConfig() {
  try {
    const cfg = JSON.parse(readFileSync3(join3(process.cwd(), ".ultra11yrc.json"), "utf8"));
    if (!cfg.probes) return {};
    const { only, ...limits } = cfg.probes;
    return { ...only ? { only } : {}, limits };
  } catch {
    return {};
  }
}
var notedAxe = /* @__PURE__ */ new Set();
function resolveIntegrationAxe(cwd = process.cwd()) {
  const engine = resolveAxeEngine({ cwd });
  if (engine.note && !notedAxe.has(engine.sourcePath)) {
    notedAxe.add(engine.sourcePath);
    console.warn(engine.note);
  }
  return engine;
}
async function runAxePass(page, mode) {
  if (mode === false) return void 0;
  const demanded = mode === true;
  let engine;
  try {
    engine = resolveIntegrationAxe();
  } catch (e) {
    if (demanded) {
      console.warn(
        `ultra11y: axe was requested but could not be resolved \u2014 ${e instanceof Error ? e.message : String(e)} Install ultra11y with its dependencies, or set \`axe: false\`. The criteria axe decides stay to assess.`
      );
    }
    return void 0;
  }
  try {
    const res = await runAxe(engine, page, "playwright");
    return { ran: true, violations: res.violations, engine: res.engine };
  } catch (e) {
    console.warn(
      `ultra11y: the axe pass failed on this page \u2014 ${e instanceof Error ? e.message : String(e)}. The snapshot was still recorded; the criteria axe decides stay to assess.`
    );
    return void 0;
  }
}
async function fullPageShot(page, collected) {
  const vp = collected.viewport;
  const height = Math.min(collected.docHeight ?? 0, FULL_SCREENSHOT_MAX_HEIGHT);
  if (!vp?.width || !vp.height || height <= vp.height) return void 0;
  try {
    return (await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vp.width, height } })).toString("base64");
  } catch {
    return void 0;
  }
}
async function checkA11y(page, opts = {}) {
  const settled = await waitForLoaded(page, opts.loadingTimeoutMs ?? LOADING_TIMEOUT_MS);
  const collected = await page.evaluate(COLLECT_SNAPSHOT);
  if (collected.loading?.length) {
    console.warn(
      `ultra11y: capture en \xE9tat de chargement \u2014 "${opts.as ?? opts.name ?? collected.url ?? page.url()}" still showed ${collected.loading.join(", ")} after ${settled.waitedMs} ms. Recorded and marked: its findings count, its silence does not. Wait for the content in the test, or raise \`loadingTimeoutMs\`.`
    );
  }
  let shot;
  let fullShot;
  if (opts.screenshot !== false) {
    try {
      shot = (await page.screenshot({ fullPage: false })).toString("base64");
    } catch {
    }
    fullShot = await fullPageShot(page, collected);
  }
  const url = collected.url || page.url();
  if (opts.expectPath && !stayedOnPage(opts.expectPath, url)) {
    throw new Error(
      `ultra11y: ${opts.expectPath} landed on ${url} \u2014 not recording it as "${opts.as ?? opts.name ?? "this page"}". The state that opens this route is not the one the test built; seed it first, or drop the page from the sample.`
    );
  }
  const behaviour = opts.behaviour === false ? void 0 : await startBehaviour(page);
  await behaviour?.idle(typeof opts.behaviour === "object" && opts.behaviour.windowMs !== void 0 ? opts.behaviour.windowMs : BEHAVIOUR_WINDOW_MS);
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
  const scripts = behaviour ? await behaviour.finish() : void 0;
  if (scripts) collected.scripts = scripts;
  const axe = await runAxePass(page, opts.axe ?? "auto");
  const payload = buildPayload(collected, url, "playwright", opts, shot, probes, axe, fullShot);
  const result = auditSnapshot(payload);
  if (opts.pdf !== false) {
    try {
      await downloadPageDocuments(page, String(payload.meta.id), { ...opts.maxPdf !== void 0 ? { maxPdf: opts.maxPdf } : {} });
    } catch (e) {
      console.warn(`ultra11y: the document download failed on this page \u2014 ${e instanceof Error ? e.message : String(e)}. The snapshot was still recorded.`);
    }
  }
  if (opts.report) writePagesReport(reportOpts(opts.report, opts.lang));
  gate(result, String(payload.meta.name), opts.failOn, opts.lang, localizedMessage);
  return result;
}
var test = (() => {
  const load = (from) => createRequire3(from)("@playwright/test");
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
    const raw = readFileSync3(join3(cwd, ".ultra11yrc.json"), "utf8");
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
  downloadPageDocuments,
  resolveIntegrationAxe,
  samplePagesFor,
  sweepCheckOptions,
  sweepSample,
  sweepTarget,
  test
};
