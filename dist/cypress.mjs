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
    const t = { since: '${since}', intervals: new Map(), timeouts: 0, long: [], orig: { si: window.setInterval, ci: window.clearInterval, st: window.setTimeout } };
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
      t.timeouts++;
      const d = Number(delay) || 0;
      if (d >= 20000 && t.long.length < 20) t.long.push(d);
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
  // The probes schedule timeouts of their own once the page is in their hands: counted here, the
  // page's are not mixed with ours.
  B.timeoutsAtMark = window.__ultra11yTimers ? window.__ultra11yTimers.timeouts : 0;
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
    longTimeouts: T ? T.long.slice().sort((a, b) => a - b) : [],
    inlineSetInterval: count(/\\bsetInterval\\s*\\(/g),
    inlineSetTimeout: count(/\\bsetTimeout\\s*\\(/g),
    ...(refresh ? { metaRefresh: refresh.getAttribute('content') || '' } : {}),
  };
  if (T && B.installedTimers) {
    window.setInterval = T.orig.si;
    window.clearInterval = T.orig.ci;
    window.setTimeout = T.orig.st;
    try { delete window.__ultra11yTimers; } catch (e) {}
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

// src/integrations/cypress.ts
function registerUltra11yCommand() {
  Cypress.Commands.add("ultra11y", (opts = {}) => {
    const shotName = opts.screenshot === false ? void 0 : `ultra11y-${opts.as || "page"}-${Date.now()}`;
    if (shotName) cy.screenshot(shotName, { capture: "viewport", log: false });
    return cy.window({ log: false }).then((win) => {
      const collected = win.eval(COLLECT_SNAPSHOT);
      const url = collected.url || win.location.href;
      if (opts.expectPath && !stayedOnPage(opts.expectPath, url)) {
        throw new Error(
          `ultra11y: ${opts.expectPath} landed on ${url} \u2014 not recording it as "${opts.as ?? opts.name ?? "this page"}". The state that opens this route is not the one the test built; seed it first, or drop the page from the sample.`
        );
      }
      const windowMs = typeof opts.behaviour === "object" && opts.behaviour.windowMs !== void 0 ? opts.behaviour.windowMs : BEHAVIOUR_WINDOW_MS;
      let opened = false;
      let why = "";
      if (opts.behaviour !== false) {
        try {
          opened = win.eval(BEHAVIOUR_START) === true;
        } catch (e) {
          why = `the capture script failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      return cy.wait(opened ? windowMs : 0, { log: false }).then(() => {
        if (opts.behaviour !== false) {
          if (!opened) collected.scripts = noDigest(why || "the page refused the capture script");
          else {
            try {
              win.eval(BEHAVIOUR_MARK);
              const raw = win.eval(behaviourFinishExpr(true));
              collected.scripts = assembleDigest(
                raw,
                raw?.domListeners ?? [],
                "dom",
                "Cypress gives no CDP session \u2014 listeners attached with addEventListener are invisible to the DOM"
              );
            } catch (e) {
              collected.scripts = noDigest(`the capture window could not be read: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
        const payload = {
          ...buildPayload(collected, url, "cypress", opts),
          failOn: opts.failOn,
          ...opts.report ? { report: opts.report } : {},
          ...shotName ? { screenshotName: shotName } : {}
        };
        return cy.task("ultra11ySnapshot", payload, { log: false }).then((res) => {
          if (res?.failing?.length) throw new Error(res.message);
          return res;
        });
      });
    });
  });
}
registerUltra11yCommand();
export {
  registerUltra11yCommand,
  slugify
};
