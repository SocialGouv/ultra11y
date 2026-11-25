// THE BEHAVIOUR DIGEST — what the page's scripts DO, recorded beside what it IS (#190).
//
// A snapshot records the DOM the browser built, its computed styles, boxes and stylesheets. The
// script criteria are not judged on any of that: RGAA 7.1 asks whether a scripted control is
// reachable and announced, 7.3 whether it is operable by keyboard, 7.5 whether a status message
// is announced, 13.1 whether a time limit can be controlled, 13.8 whether moving content can be
// stopped. Markup alone answers none of them — a `<div>` with a click listener looks exactly like
// a `<div>` — so the snapshot also records `scripts.json`:
//
//   • the elements carrying click, key, pointer or hover listeners, FLAGGED when the element is
//     not natively interactive and has neither a role nor a tabindex;
//   • inline `on*` handlers;
//   • the ARIA attributes the page changed during the capture window;
//   • the live regions, and whether their content changed;
//   • content updated on interaction outside any live region;
//   • elements that kept changing while nobody touched the page, and the long CSS animations;
//   • the timers, and the scripts and stylesheets the page loaded.
//
// HOW. Listeners are read through the Chrome DevTools Protocol (`DOMDebugger.getEventListeners`)
// when the producer holds a CDP session — the only way to see a listener attached with
// `addEventListener`. Without one (Cypress, Firefox, a plain page object) the digest falls back to
// the DOM: inline handlers and `on*` properties. `collected` says which, and `none` that nothing
// could be collected — and a reader must never turn the absence of a listener into a conformity
// beyond what the collector could see.
//
// THE WINDOW. `startBehaviour` opens it right after COLLECT_SNAPSHOT has serialized the DOM, and
// indexes every element with the same document-order walk (src/collector.ts ELEMENT_WALK), so an
// element reported here joins to `dom.html` exactly as styles.json and boxes.json do. The first
// part of the window is IDLE: nothing touches the page, and whatever changes then changed on its
// own — a carousel turning, a counter ticking. `idle()` closes that part; whatever the producer
// does next (the live probes press Tab, hover, click buttons) is recorded as INTERACTION, which
// is where an `aria-expanded` toggled by a button shows up. `finish()` closes the window.
//
// PRODUCERS. `scan` (src/scan-local.ts) and `ultra11y/playwright` use the CDP path; `ultra11y/
// cypress` the DOM one. The journey runner (#189) records its steps with the scan runtime's
// `writeRunnerSnapshot`: it gets this digest by opening the window after its own COLLECT_SNAPSHOT
// and setting `snapshot.scripts` from `finish()` — nothing else to wire.
//
// A LEAF MODULE, like src/collector.ts: the Cypress support file and the Playwright plugin import
// it, so it imports nothing from the engine (types only, which are erased).
import { ELEMENT_WALK } from "./collector.js";
import type { BehaviourListener, ScriptsDigest } from "./types.js";

export const SCRIPTS_VERSION = 1;

/** The capture window, in ms — long enough for a carousel to turn twice. */
export const BEHAVIOUR_WINDOW_MS = 2000;

/** The bound on every list in `scripts.json`. A page with 3 000 delegated listeners would
 *  otherwise write a digest larger than its DOM. Recorded in the file, with the totals of any
 *  list it cut. */
export const BEHAVIOUR_CAPS = {
  listeners: 200,
  inline: 200,
  ariaMutations: 100,
  liveRegions: 50,
  updates: 50,
  motion: 30,
  animations: 30,
  resources: 100,
  intervals: 50,
} as const;

/** Event types that ACTIVATE something with a pointer. */
export const ACTIVATION_EVENTS = ["click", "dblclick", "auxclick", "mousedown", "mouseup", "pointerdown", "pointerup", "touchstart", "touchend"];
/** Event types that react to a pointer merely passing over. */
export const HOVER_EVENTS = ["mouseover", "mouseenter", "mouseout", "mouseleave", "pointerover", "pointerenter", "pointerout", "pointerleave"];
export const KEY_EVENTS = ["keydown", "keyup", "keypress"];
export const FOCUS_EVENTS = ["focus", "blur", "focusin", "focusout"];
const WATCHED = new Set([...ACTIVATION_EVENTS, ...HOVER_EVENTS, ...KEY_EVENTS, ...FOCUS_EVENTS]);

/** The timer hook. Installed with `addInitScript` BEFORE the page's own scripts when the producer
 *  navigates (`scan`, the journey runner), so an interval started at load is counted; installed
 *  by `startBehaviour` itself otherwise, and then only what is scheduled during the window is.
 *  Transparent: the originals are called with the same arguments and their return value is
 *  returned.
 *
 *  PAUSED during ultra11y's own phases. axe-core and the live probes run in the page's world and
 *  schedule timeouts of their own (an axe pass alone schedules dozens); counted, they would be
 *  reported as the page's. `BEHAVIOUR_MARK` pauses the timeout count when the producer takes the
 *  page in hand and the close of the window resumes it, so a hook that serves several windows
 *  (a journey: one navigation, one hook, a window per step) never carries the tool's timeouts of
 *  an earlier step into a later one. Intervals stay tracked: the list is of those still RUNNING
 *  when the window closes. */
const TIMER_HOOK_BODY = (since: "init" | "window"): string => `
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

export const TIMER_HOOK = `(() => {${TIMER_HOOK_BODY("init")}
})()`;

/** Open the capture window: index the elements, observe every mutation, hook the timers. */
export const BEHAVIOUR_START = `(() => {
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

/** Close the idle part of the window: whatever changes from now on, the producer caused. */
export const BEHAVIOUR_MARK = `(() => {
  const B = window.__ultra11yBehaviour;
  if (!B) return false;
  B.phase = 'interaction';
  B.idleMs = Math.round(performance.now() - B.t0);
  // axe and the probes schedule timeouts of their own once the page is in their hands: the count
  // is taken here and the hook paused until the window closes, so the page's are never mixed
  // with ours — not in this window, and not in a later one the same hook serves.
  const T = window.__ultra11yTimers;
  B.timeoutsAtMark = T ? T.timeouts : 0;
  B.longAtMark = T ? T.long.length : 0;
  if (T) T.paused = true;
  return true;
})()`;

/** Close the window and return the digest's in-page half. With `domListeners`, also read the
 *  listeners the DOM can show (inline handlers, `on*` properties) — the fallback when no CDP
 *  session read them. Returns null when the window was never opened (or the page navigated). */
export const behaviourFinishExpr = (domListeners: boolean): string => `(() => {
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
  // Long CSS animations — moving content by the stylesheet's own declaration.
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
  // The scripts and stylesheets loaded — the ones the page had when the window opened.
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

/** Every browser-side string this module evaluates, for the syntax gate (tests/probe-syntax.test.ts). */
export function behaviourSources(): Record<string, string> {
  return {
    TIMER_HOOK,
    BEHAVIOUR_START,
    BEHAVIOUR_MARK,
    "behaviourFinishExpr(dom)": behaviourFinishExpr(true),
    "behaviourFinishExpr(cdp)": behaviourFinishExpr(false),
    DESCRIBE_THIS,
  };
}

/** What `describe` returns for a listener target, in the page. */
interface ListenerFacts {
  i: number;
  tag: string;
  selector: string;
  html?: string;
  native?: boolean;
  role?: string;
  tabindex?: string;
  root?: boolean;
}

/** Classify the listeners of one target. Pure, so the CDP path and the DOM fallback flag an
 *  element by exactly the same rule. */
export function classifyListener(facts: ListenerFacts, events: string[]): BehaviourListener {
  const has = (list: string[]) => events.some((e) => list.includes(e));
  const activation = has(ACTIVATION_EVENTS);
  const hover = has(HOVER_EVENTS);
  const key = has(KEY_EVENTS);
  const focus = has(FOCUS_EVENTS);
  const native = facts.native === true;
  const role = facts.role !== undefined && facts.role.trim() !== "" ? facts.role : undefined;
  const tabindex = facts.tabindex !== undefined ? facts.tabindex : undefined;
  return {
    i: facts.i,
    tag: facts.tag,
    selector: facts.selector,
    ...(facts.html ? { html: facts.html } : {}),
    events: [...events].sort(),
    native,
    ...(role !== undefined ? { role } : {}),
    ...(tabindex !== undefined ? { tabindex } : {}),
    flagged: activation && !native && role === undefined && tabindex === undefined,
    // An activation a keyboard cannot fire (a native control's click IS keyboard-fired), or a
    // hover reaction with neither a focus nor a key counterpart.
    mouseOnly: (activation && !native && !key) || (hover && !focus && !key),
  };
}

/** Assemble the digest from the in-page half and the listener targets. */
export function assembleDigest(
  raw: Record<string, unknown> | null,
  targets: { facts: ListenerFacts; events: string[] }[] | null,
  collected: "cdp" | "dom",
  why?: string,
): ScriptsDigest {
  if (!raw) return noDigest("the capture window closed before it could be read (the page navigated or reloaded during it)");
  const listeners: BehaviourListener[] = [];
  const delegated: { target: string; events: string[] }[] = [];
  for (const t of targets ?? []) {
    const events = [...new Set(t.events.filter((e) => WATCHED.has(e)))].sort();
    if (!events.length) continue;
    if (t.facts.root) delegated.push({ target: t.facts.selector === "window" || t.facts.selector === "document" ? t.facts.selector : t.facts.tag, events });
    else listeners.push(classifyListener(t.facts, events));
  }
  listeners.sort((a, b) => a.i - b.i || a.selector.localeCompare(b.selector));
  delegated.sort((a, b) => a.target.localeCompare(b.target));
  const truncated = { ...((raw.truncated as Record<string, number> | undefined) ?? {}) };
  const capped = <T>(name: keyof typeof BEHAVIOUR_CAPS, list: T[]): T[] => {
    if (list.length <= BEHAVIOUR_CAPS[name]) return list;
    truncated[name] = list.length;
    return list.slice(0, BEHAVIOUR_CAPS[name]);
  };
  // Flagged and mouse-only first, so a cap never cuts the entries a brief is about.
  const ranked = [...listeners.filter((l) => l.flagged || l.mouseOnly), ...listeners.filter((l) => !l.flagged && !l.mouseOnly)];
  const kept = capped("listeners", ranked).sort((a, b) => a.i - b.i || a.selector.localeCompare(b.selector));
  return {
    v: SCRIPTS_VERSION,
    collected,
    ...(why ? { why } : {}),
    ...(typeof raw.windowMs === "number" ? { windowMs: raw.windowMs } : {}),
    ...(typeof raw.idleMs === "number" ? { idleMs: raw.idleMs } : {}),
    listeners: kept,
    delegated,
    inline: (raw.inline as ScriptsDigest["inline"]) ?? [],
    ariaMutations: (raw.ariaMutations as ScriptsDigest["ariaMutations"]) ?? [],
    liveRegions: (raw.liveRegions as ScriptsDigest["liveRegions"]) ?? [],
    updates: (raw.updates as ScriptsDigest["updates"]) ?? [],
    motion: (raw.motion as ScriptsDigest["motion"]) ?? [],
    animations: (raw.animations as ScriptsDigest["animations"]) ?? [],
    ...(raw.timers ? { timers: raw.timers as NonNullable<ScriptsDigest["timers"]> } : {}),
    resources: (raw.resources as ScriptsDigest["resources"]) ?? [],
    caps: { ...BEHAVIOUR_CAPS },
    ...(Object.keys(truncated).length ? { truncated } : {}),
  };
}

/** The digest of a page whose behaviour could not be collected at all. Written all the same: a
 *  producer that LOOKED and could not is a different statement from one that never looked, and
 *  the brief says so instead of reading the silence. */
export function noDigest(why: string): ScriptsDigest {
  return { v: SCRIPTS_VERSION, collected: "none", why, caps: { ...BEHAVIOUR_CAPS } };
}

/** Run as `this` = a listener's target, through `Runtime.callFunctionOn`. */
const DESCRIBE_THIS = `function () { const B = window.__ultra11yBehaviour; return B ? B.describe(this) : null; }`;

// ---- the producer side -------------------------------------------------------------------

/** A CDP session, structurally — Playwright's `CDPSession`. */
export interface CdpSessionLike {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  detach?(): Promise<void>;
}

/** The page object, structurally: anything that evaluates a string. `context().newCDPSession`
 *  is Playwright's, on Chromium; without it the DOM fallback is used. */
export interface BehaviourPage {
  evaluate(script: string): Promise<unknown>;
  waitForTimeout?(ms: number): Promise<void>;
  context?(): { newCDPSession?(page: unknown): Promise<CdpSessionLike> };
}

export interface BehaviourCapture {
  /** Wait out the idle part of the window, then mark it closed. */
  idle(ms?: number): Promise<void>;
  /** Close the window and return the digest. Never throws. */
  finish(): Promise<ScriptsDigest>;
}

const sleep = (page: BehaviourPage, ms: number): Promise<void> =>
  page.waitForTimeout ? page.waitForTimeout(ms) : new Promise((resolve) => setTimeout(resolve, ms));

const firstLine = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]!.slice(0, 200);

interface CdpListener {
  type: string;
  backendNodeId?: number;
  scriptId?: string;
}

/** Drop the listeners the AUTOMATION installed, not the page. Playwright's injected script puts
 *  a set of capture listeners on `window` the first time it drives the pointer, and marks them
 *  with a sentinel event type of its own; every listener from that same script is its, never the
 *  site's. Measured: without this, every page a probe had hovered reported a window listening
 *  for click, pointerdown and touchstart. */
function pageListeners(list: CdpListener[]): CdpListener[] {
  const instrumentation = new Set(list.filter((l) => l.type.startsWith("__playwright")).map((l) => l.scriptId));
  return list.filter((l) => !(l.scriptId !== undefined && instrumentation.has(l.scriptId)));
}

/** Read every watched listener of the page through CDP, keyed by target. */
async function cdpListeners(s: CdpSessionLike): Promise<{ facts: ListenerFacts; events: string[] }[]> {
  const group = "ultra11y-behaviour";
  const evaluate = async (expression: string) =>
    ((await s.send("Runtime.evaluate", { expression, objectGroup: group })) as { result?: { objectId?: string } }).result?.objectId;
  try {
    await s.send("DOM.getDocument", { depth: 0 });
    const docId = await evaluate("document");
    if (!docId) throw new Error("no document object");
    const all = pageListeners(
      ((await s.send("DOMDebugger.getEventListeners", { objectId: docId, depth: -1, pierce: false })) as { listeners?: CdpListener[] }).listeners ?? [],
    );
    const byNode = new Map<number, Set<string>>();
    for (const l of all) {
      if (l.backendNodeId === undefined || !WATCHED.has(l.type)) continue;
      const set = byNode.get(l.backendNodeId) ?? new Set<string>();
      set.add(l.type);
      byNode.set(l.backendNodeId, set);
    }
    const out: { facts: ListenerFacts; events: string[] }[] = [];
    // Bounded: a listener per table row on a 2 000-row grid would otherwise cost 2 000 round trips.
    const nodes = [...byNode.entries()].slice(0, BEHAVIOUR_CAPS.listeners * 3);
    for (const [backendNodeId, events] of nodes) {
      try {
        const resolved = (await s.send("DOM.resolveNode", { backendNodeId, objectGroup: group })) as { object?: { objectId?: string } };
        const objectId = resolved.object?.objectId;
        if (!objectId) continue;
        const r = (await s.send("Runtime.callFunctionOn", { objectId, functionDeclaration: DESCRIBE_THIS, returnByValue: true })) as {
          result?: { value?: ListenerFacts | null };
        };
        const facts = r.result?.value;
        if (facts) out.push({ facts, events: [...events] });
      } catch {
        /* a node detached since — nothing to describe */
      }
    }
    const winId = await evaluate("window");
    if (winId) {
      const w = pageListeners(((await s.send("DOMDebugger.getEventListeners", { objectId: winId })) as { listeners?: CdpListener[] }).listeners ?? []);
      const events = [...new Set(w.map((l) => l.type).filter((t) => WATCHED.has(t)))];
      if (events.length) out.push({ facts: { i: -1, tag: "#window", selector: "window", root: true }, events });
    }
    return out;
  } finally {
    await s.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => {});
  }
}

/** Open the capture window on a page whose DOM was JUST serialized. Never throws: a window that
 *  cannot open yields a `collected: "none"` digest from `finish()`, with the reason. */
export async function startBehaviour(page: BehaviourPage, opts: { cdp?: boolean } = {}): Promise<BehaviourCapture> {
  let opened = false;
  let why = "";
  try {
    opened = (await page.evaluate(BEHAVIOUR_START)) === true;
    if (!opened) why = "the page refused the capture script";
  } catch (e) {
    why = `the capture script failed: ${firstLine(e)}`;
  }
  let marked = false;
  // The listeners are read ONCE, when the idle half closes: the page as its own scripts set it up,
  // before any probe has hovered, tabbed or clicked — the same instant the DOM index describes.
  let targets: { facts: ListenerFacts; events: string[] }[] | null | undefined;
  let fallback = "";
  const readListeners = async (): Promise<void> => {
    const ctx = opts.cdp === false ? undefined : page.context?.();
    const newSession = ctx?.newCDPSession;
    if (!ctx || !newSession) {
      targets = null;
      fallback = opts.cdp === false ? "CDP disabled by the producer" : "no CDP session on this page object";
      return;
    }
    let session: CdpSessionLike | undefined;
    try {
      session = await newSession.call(ctx, page);
      targets = await cdpListeners(session);
    } catch (e) {
      targets = null;
      fallback = `CDP unavailable: ${firstLine(e)}`;
    } finally {
      await session?.detach?.().catch(() => {});
    }
  };
  return {
    async idle(ms = BEHAVIOUR_WINDOW_MS) {
      if (!opened || marked) return;
      await sleep(page, ms);
      marked = true;
      await page.evaluate(BEHAVIOUR_MARK).catch(() => {});
      await readListeners();
    },
    async finish() {
      if (!opened) return noDigest(why);
      if (!marked) {
        marked = true;
        await page.evaluate(BEHAVIOUR_MARK).catch(() => {});
      }
      if (targets === undefined) await readListeners();
      const found = targets ?? null;
      let raw: (Record<string, unknown> & { domListeners?: { facts: ListenerFacts; events: string[] }[] | null }) | null;
      try {
        raw = (await page.evaluate(behaviourFinishExpr(found === null))) as typeof raw;
      } catch (e) {
        return noDigest(`the capture window could not be read: ${firstLine(e)}`);
      }
      if (found !== null) return assembleDigest(raw, found, "cdp");
      return assembleDigest(raw, raw?.domListeners ?? [], "dom", `${fallback} — listeners attached with addEventListener are invisible to the DOM`);
    },
  };
}
