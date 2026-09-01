// THE LIVE PROBES — the measurements that only exist while a browser is acting on the page.
//
// Contrast and colour can be settled from a recorded snapshot; zoom, reflow, text spacing,
// hover and focus visibility cannot. They are properties of a page being STRESSED — the root
// font-size doubled, the viewport narrowed to 320px, a spacing stylesheet forced on, Tab
// pressed, a tooltip hovered — and a digest taken beforehand says nothing about any of them.
//
// They lived inside `scan-local`, which opens its own browser, and that is precisely why a
// real application could never decide them: the screens that matter sit behind authentication
// and behind a state machine, so a scanner arriving cold gets a redirect. An E2E suite already
// has the page in the right state and had no way to ask for these measurements. Hence this
// module: no Playwright import, no engine import, nothing but strings evaluated in a page and
// a caller-supplied `page`. Both runtimes use it, so a probe means the same thing in each.

/** THE COVERAGE CONTRACT INSIDE `probes.json`, versioned apart from the snapshot itself.
 *
 *  `SNAPSHOT_VERSION` describes the DIRECTORY — a dom, some digests, a screenshot — and it has
 *  not changed. What changed is the meaning of one field: up to 5.42.0, `probed` was written
 *  for a walk of the tab ring, of the hover triggers or of the page's interactions with NO
 *  completeness check at all, so a ring cut off at the tagging cap made the same claim as a
 *  whole one. A snapshot outlives the engine that wrote it, and believing an older file's claim
 *  for those criteria reinstates the exact defect the check was added to close.
 *
 *  v2 = `probed` is written only for a pass that finished. Absent = v1 = it means whatever the
 *  producer of the day felt like, and the criteria whose completeness is now tracked are not
 *  credited from it. */
export const PROBES_VERSION = 2;

/** The criteria whose `probed` claim depends on a walk having FINISHED — the tab ring (2.4.7,
 *  2.4.11, 2.1.2), the hover triggers (1.4.13) and the page's interactions (4.1.3). The digest
 *  and one-shot measurements are deliberately absent: a 320px reflow either ran or it did not,
 *  and there is no half of it to have been cut short, so withholding it would cost coverage for
 *  nothing. */
export const WALK_DEPENDENT_SCS: readonly string[] = ["1.4.13", "2.1.2", "2.4.7", "2.4.11", "4.1.3"];

/** One thing a probe observed. Structurally identical to `ProbeHit` in src/scan.ts, restated
 *  here so this module keeps no dependency on the scan runtime. */
export interface ProbeHit {
  selector: string;
  html: string;
  detail: string;
}

// Playwright's types are not a dependency of this package; the page is structurally typed to
// exactly the surface the probes use.
type Any = any;

// Shared helpers injected at the top of every probe expression.
export const PRELUDE = `
const __sel = (e) => {
  if (!e || !e.tagName) return '—';
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
  // visually-hidden "screen-reader-only" pattern (clip rect / clip-path inset) — present in
  // the a11y tree but not painted; must not be measured for clipping/target-size.
  if (s.clip && s.clip !== 'auto' && s.clip !== 'rect(auto, auto, auto, auto)') return false;
  if (s.clipPath && (s.clipPath.indexOf('inset(100%') >= 0 || s.clipPath.indexOf('inset(50%') >= 0)) return false;
  return true;
};
const __html = (e) => (e.outerHTML || '').slice(0, 160);
`;

/** The numbers a probe stops at, and the width it narrows to.
 *
 *  320px is normative (WCAG 1.4.10) and stays the default; how many focusables are worth
 *  tabbing through, and how many hits are worth recording before the point is made, are
 *  judgements about the pages being audited. A repository that has 400 focusable elements on
 *  one screen should be able to say so instead of being quietly cut off at 120. */
export interface ProbeLimits {
  reflowWidth: number;
  maxFocusables: number;
  maxHits: number;
  /** Hover triggers opened before the probe stops looking. `maxHits` bounds what is
   *  RECORDED; this bounds what is TRIED, which is the number that costs wall-clock. */
  maxTriggers: number;
  /** Timeout handed to every interaction the probes drive (hover above all).
   *
   *  Playwright's own default is 0 — *wait forever*, bounded only by the caller's test
   *  timeout. That default is right for a test asserting on its own page and catastrophic
   *  here: a trigger that never becomes actionable then blocks OUR pass until SOMEBODY
   *  ELSE'S test dies. Measured on a real sweep: one such trigger killed its test at 120s
   *  and, through a serial group, took 15 more tests with it. */
  actionTimeoutMs: number;
  /** Wall-clock the whole pass may spend. What it cuts short is recorded in `skipped`, never
   *  silently dropped: a measurement that did not happen must not read as one that found
   *  nothing. */
  budgetMs: number;
}

export const PROBE_DEFAULTS: ProbeLimits = {
  reflowWidth: 320,
  maxFocusables: 120,
  maxHits: 20,
  maxTriggers: 60,
  actionTimeoutMs: 1_000,
  budgetMs: 20_000,
};

/** A deadline the probes can consult without every one of them knowing about the clock.
 *  `left()` is what an interaction may still spend; `out()` is the question a loop asks
 *  between iterations. */
export interface ProbeDeadline {
  out(): boolean;
  left(): number;
}

export function probeDeadline(budgetMs: number, now: () => number = Date.now): ProbeDeadline {
  const end = now() + budgetMs;
  return { out: () => now() >= end, left: () => Math.max(0, end - now()) };
}

/** Never wait longer than the interaction's own timeout OR the budget, whichever is nearer —
 *  and never wait zero, which Playwright reads as "no limit", the exact bug this closes. */
function actionTimeout(limits: ProbeLimits, deadline?: ProbeDeadline): number {
  const left = deadline ? deadline.left() : limits.actionTimeoutMs;
  return Math.max(1, Math.min(limits.actionTimeoutMs, left || limits.actionTimeoutMs));
}

// The 320px reflow check (same semantics as the Docker RUNNER), mapped to 1.4.10.
export const REFLOW_PROBE = `(() => {
  const el = document.scrollingElement || document.documentElement;
  return { horizontalScroll: el.scrollWidth > el.clientWidth + 2 };
})()`;

// 1.4.4 Resize Text: enlarge text to 200% and detect actual LOSS OF CONTENT — text
// clipped in an overflow:hidden / nowrap / ellipsis container. (A mere horizontal
// scrollbar at 200% text is NOT a 1.4.4 failure — 2D reflow is 1.4.10 — so we do not
// flag page-level horizontal scroll here; only content the user can no longer read.)
export const REFLOW_ZOOM_PROBE = `(() => { ${PRELUDE}
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
      hits.push({ selector: __sel(e), html: __html(e), detail: 'Texte tronqué/masqué à 200% (conteneur overflow:hidden / nowrap) — perte de contenu au zoom (1.4.4).' });
    }
    if (hits.length >= 12) break;
  }
  root.style.fontSize = prev;
  return hits;
})()`;

// 1.4.12 Text Spacing override (line-height 1.5, letter 0.12em, word 0.16em, p 2em).
export const TEXT_SPACING_CSS =
  "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }";

export const TEXT_SPACING_PROBE = `(() => { ${PRELUDE}
  const hits = [];
  for (const e of Array.from(document.querySelectorAll('p,li,span,a,button,h1,h2,h3,h4,h5,h6,td,th,label,div'))) {
    if (!__vis(e)) continue;
    if ((e.textContent || '').trim().length < 8) continue;
    const s = getComputedStyle(e);
    const clipped = (s.overflowX === 'hidden' || s.overflowY === 'hidden' || s.overflow === 'hidden') && (e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2);
    const ellipsis = s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 2;
    if (clipped || ellipsis) {
      // No criterion id in the text: every rendering already names the criterion this finding
      // belongs to, and a hard-coded « 1.4.12 » is a WCAG number appearing inside a deliverable
      // that may be keyed on another standard entirely.
      hits.push({ selector: __sel(e), html: __html(e), detail: 'Texte tronqué/masqué sous l\\'espacement de texte imposé — perte de contenu.' });
    }
    if (hits.length >= 20) break;
  }
  return hits;
})()`;

// 2.4.7 Focus Visible — pass 1: tag each focusable + snapshot its unfocused style.
// `scope` (a CSS selector or "" for the whole document) restricts the pass — used to
// re-run it INSIDE an opened dialog whose focusables the pristine pass could not see.
//
// Custom radios/checkboxes (RGAA 10.7): the DSFR-style pattern hides the native input
// (sr-only) and paints the focus ring on its LABEL. Measuring the hidden input would
// always report "no visible change" as a false pass — so for a visually-hidden but
// focusable radio/checkbox we measure the PROXY (label[for], wrapping label, or the
// aria-labelledby target) instead, keyed by the input (which is what Tab focuses).
//
// AND THE PROXY'S PSEUDO-ELEMENTS, WHICH IS WHERE THE RING ACTUALLY IS. Having gone to
// the trouble of finding the label, reading only the label's OWN computed style measures
// the one box the design system does not paint: DSFR, GOV.UK, USWDS and Bootstrap all
// draw the control — the box, the tick, and the focus ring — in `label::before`. The
// label element itself never changes on focus, so every custom checkbox and radio came
// back "focus not visible".
//
// Measured on a real 37-page audit: TWELVE findings, all of them `<label class="fr-label">`
// proxies for DSFR checkboxes and radios, all false. Worse than noise — RGAA 10.7 is not on
// the `completeBySilence` allowlist, so one bogus NC on three pages left the criterion
// « to assess » on the thirty-four others, and no adjudication can reach it: a criterion
// already decided run-wide never enters the worklist.
//
// So `snap` reads the element and both generated boxes, and the check compares the same
// three. Symmetry is the whole contract here: comparing a two-part snapshot against a
// one-part one would report a change on every element that has a `::before` at all.
export function focusSetupExpr(scope = "", maxFocusables = PROBE_DEFAULTS.maxFocusables): string {
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
  // background-color and colour — so a pseudo-element pulsing on a keyframe animation differs
  // between the two reads for a reason that has nothing to do with focus. That reads as « the
  // focus is visible » on a control that has no indicator at all: a MISSED non-conformity,
  // strictly worse than the false positive the pseudo-element read was added to remove.
  //
  // A transition is not affected and must not be excluded: it only moves on a state change,
  // so its at-rest value is stable and a focus transition is exactly what we want to see.
  //
  // When every part of an element is animated, both sides collapse to the same constant and
  // the probe reports « no visible change » — a finding rather than a silent pass. That is the
  // safe direction: this tool would rather name something a human can dismiss than clear
  // something nobody will look at again.
  const __style = (e, pseudo) => { const s = getComputedStyle(e, pseudo); if (s.animationName && s.animationName !== 'none') return 'animated'; return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderTopWidth, s.borderBottomWidth, s.backgroundColor, s.color, s.textDecorationLine].join('|'); };
  const snap = (e) => [__style(e, null), __style(e, '::before'), __style(e, '::after')].join('#');
  // Visually-hidden radio/checkbox → measure its visible label/proxy, not the input.
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

// Pass 2 (after each Tab): is the active element a tagged focusable whose focus PROXY
// (itself, or its label for a custom control) is UNCHANGED vs the unfocused snapshot?
// If so, focus produced no visible indicator.
export const FOCUS_CHECK_PROBE = `(() => {
  const e = document.activeElement;
  // FOCUS LEFT THE DOCUMENT — the normal end of a tab ring, and nothing to measure.
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

// 2.4.11 Focus Not Obscured (Minimum) — pass 2', run after the same Tab press as the
// focus-visible check, on the same tagged ring.
//
// THE CRITERION, from its own wording: « When a user interface component receives keyboard
// focus, the component is not ENTIRELY hidden due to author-created content. » Three things
// follow, and each one is a way to get this wrong:
//
//   • ENTIRELY, not partially. A sticky header covering the top half of a focused button
//     satisfies 2.4.11 (it is 2.4.12 Focus Not Obscured (Enhanced), AAA, that forbids any
//     obscuring). So a single visible point anywhere on the component is a pass, which is why
//     this samples a grid rather than testing the centre.
//   • AUTHOR-CREATED CONTENT. Scrolled out of the viewport is not this criterion — the browser
//     scrolls focus into view, and content below the fold is not "hidden by content". The
//     occluder must be something the author overlaid, so only `position: fixed` and `sticky`
//     ancestors count: the sticky headers, the cookie banners and the floating action bars
//     the Understanding document names.
//   • The component's OWN subtree does not obscure it. An icon inside a button is the topmost
//     element over the button's centre on every well-built page in existence; reading that as
//     occlusion would fail everything.
//
// `elementsFromPoint` is what makes this measurable: it returns the whole hit-test stack at a
// point, so "is any part of me on top anywhere?" is answered without guessing at z-index,
// transforms or stacking contexts — the three things that make a computed-style approach wrong.
export const FOCUS_OBSCURED_PROBE = `(() => { ${PRELUDE}
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const key = e.getAttribute && e.getAttribute('data-u11y-f');
  if (!key) return null;
  const r = e.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;         // nothing to obscure
  const vw = window.innerWidth, vh = window.innerHeight;
  // Sample a 5×5 grid inset by a pixel, keeping only points inside the viewport. A component
  // scrolled off-screen leaves no sampleable point and is NOT reported: out of view is not
  // obscured, and the criterion is about content laid over it.
  const xs = [0.02, 0.25, 0.5, 0.75, 0.98], pts = [];
  for (const fx of xs) for (const fy of xs) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x >= 0 && y >= 0 && x < vw && y < vh) pts.push([x, y]);
  }
  if (!pts.length) return null;
  // The topmost element over a point, for each sampled point. The focused element counts as
  // visible when it — or anything inside it — is on top: an icon inside a button is the button
  // being visible, and reading that as occlusion would fail every well-built page.
  let occluder = null;
  for (const [x, y] of pts) {
    const top = document.elementsFromPoint(x, y)[0];
    if (!top) continue;
    if (top === e || e.contains(top)) return null;      // some part of it is on top → pass
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

// 1.4.13 Content on Hover — find triggers whose aria-describedby target is hidden, so
// hovering can reveal it. probeHover then checks it is dismissible (Escape).
export const HOVER_SETUP_PROBE = `(() => { ${PRELUDE}
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

export function hoverVisibleExpr(id: string, wantHidden = false): string {
  const j = JSON.stringify(id);
  return `(() => { const t = document.getElementById(${j}); if (!t) return ${wantHidden ? "true" : "false"}; const s = getComputedStyle(t); const shown = s.display !== 'none' && s.visibility !== 'hidden' && t.getBoundingClientRect().height > 0; return ${wantHidden ? "!shown" : "shown"}; })()`;
}

/** What ONE walk of the tab ring measures. Two criteria, one walk: pressing Tab through a
 *  130-element ring is the expensive part (two round-trips per press on a loaded CI runner),
 *  and both questions are asked of the same focused element at the same moment. Walking twice
 *  would double the cost of the most expensive probe in the tier to learn nothing extra. */
export interface FocusRingHits extends RingCoverage {
  /** 2.4.7 — focus produced no visible change. */
  visible: ProbeHit[];
  /** 2.4.11 — the focused component was entirely hidden behind author-created content. */
  obscured: ProbeHit[];
}

/** DID THE WALK CROSS THE WHOLE RING?
 *
 *  Both walks below stop early in three ordinary ways — the setup pass stops tagging at
 *  `maxFocusables`, the wall-clock budget runs out mid-ring, the hit caps stop the recording
 *  — and each one used to return its partial result in the shape of a finished one. The caller
 *  then wrote 2.4.7 / 2.4.11 / 2.1.2 into `probed`, which is the field that licenses reading
 *  an empty hit list as conformity. A ring cut off at element 120 of 300 was therefore
 *  published as « measured, nothing wrong » for the 180 nobody looked at.
 *
 *  `complete` is what the caller must consult before crediting anything, and `why` is what it
 *  puts in `skipped` when it cannot. */
export interface RingCoverage {
  complete: boolean;
  /** The reason the walk stopped short. Absent exactly when `complete` is true. */
  why?: string;
}

/** What the tagging pass tagged, and how many candidates it saw.
 *
 *  It used to return the count alone, and the caller inferred truncation from
 *  `count >= maxFocusables` — which reads a page with EXACTLY 120 focusables as proof that a
 *  121st exists, and withholds a conformity the page earned. Counting past the cap answers the
 *  question directly. A producer that predates the shape returns a bare number and keeps the
 *  old conservative inference, which is the safe direction to be wrong in. */
function readSetup(raw: unknown, limits: ProbeLimits): { count: number; capped: boolean } {
  if (typeof raw === "number") return { count: raw, capped: raw >= limits.maxFocusables };
  const o = (raw ?? {}) as { n?: number; total?: number };
  const count = o.n ?? 0;
  return { count, capped: (o.total ?? count) > count };
}

/** The tagging pass stopped at the cap, so the ring itself is shorter than the page's. No
 *  amount of walking can reach an element the setup never tagged. */
function cappedRing(capped: boolean, limits: ProbeLimits): string | undefined {
  return capped
    ? `the setup pass stopped tagging at ${limits.maxFocusables} focusable elements (probes.maxFocusables), so everything past that was never focused and never measured`
    : undefined;
}

export async function probeFocusVisible(page: Any, scope = "", limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<ProbeHit[]> {
  return (await probeFocusRing(page, scope, limits, deadline)).visible;
}

export async function probeFocusRing(page: Any, scope = "", limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<FocusRingHits> {
  const { count, capped } = readSetup(await page.evaluate(focusSetupExpr(scope, limits.maxFocusables)), limits);
  // A page with nothing focusable has no ring to cross — the walk is vacuously whole, and
  // saying otherwise would withhold a conformity the page has earned.
  if (!count) return { visible: [], obscured: [], complete: true };
  const hits: ProbeHit[] = [];
  const obscured: ProbeHit[] = [];
  const seen = new Set<string>();
  const limit = tabPressBudget(count, limits);
  let prevKey: string | null = null;
  // Pessimistic until the ring closes. The loop running out of presses is not a normal ending
  // — `tabPressBudget` is a backstop — so this is the reason that survives when nothing
  // else sets one.
  let cutShort: string | undefined = `the walk spent its ${limit} Tab presses without the ring ever closing, so the tail of it was never reached`;
  let untagged = 0;
  for (let i = 0; i < limit; i++) {
    // A tab ring of 130 elements is two round-trips each on a loaded CI runner. Stopping at
    // the deadline costs the tail of the ring, which `runLiveProbes` then records.
    if (deadline?.out()) {
      cutShort = `the probe budget of ${limits.budgetMs}ms ran out after ${seen.size} of the ${count} focusable elements — the rest of the ring was never focused`;
      break;
    }
    await page.keyboard.press("Tab");
    const r = (await page.evaluate(FOCUS_CHECK_PROBE)) as { key: string; changed: boolean; selector: string; html: string; untagged?: boolean } | null;
    if (!r) continue;
    // Tab landed on a focusable the setup never tagged. Nothing here can be measured, and the
    // walk must not later claim it crossed the whole ring: a skip link that only appears on
    // focus is exactly the control this criterion is about.
    if (r.untagged) {
      untagged++;
      continue;
    }
    // STAYING PUT IS NOT WRAPPING ROUND, and reading it as such ended this walk early.
    //
    // A native multi-segment editor holds focus across several presses — `input[type=date]`
    // has four tab stops (day, month, year, picker) and `datetime-local` seven, all reported
    // as the same element. The wrap test below saw that repeat, concluded the ring had come
    // full circle, and stopped: on tests/fixtures/realworld/contact.html the walk ended on the
    // FIRST date field, 18 of 34 focusables in, and every control after it went unmeasured —
    // while `pageCoverage.scs` went on claiming 2.4.7 was measured for the whole page. Silent
    // under-coverage is the one outcome this engine must never produce.
    //
    // A wrap is returning to a key seen EARLIER in the walk. Being on the key we were already
    // on is the control eating a keystroke, and the loop's own `limit` still bounds it.
    if (r.key === prevKey) continue;
    if (seen.has(r.key)) {
      cutShort = undefined; // wrapped around the tab ring — the ring is closed, the walk is whole
      break;
    }
    seen.add(r.key);
    prevKey = r.key;
    if (!r.changed) {
      hits.push({
        selector: r.selector,
        html: r.html,
        detail: "Le focus clavier ne produit aucun changement visible (outline/box-shadow/bordure/fond) — focus non visible.",
      });
    }
    // Same focused element, same moment, second question. Evaluated after the visibility
    // check so a page with neither defect costs one extra round-trip per tab stop and no
    // second walk.
    if (obscured.length < 20 && !deadline?.out()) {
      const o = (await page.evaluate(FOCUS_OBSCURED_PROBE)) as { selector: string; html: string; overlay: string } | null;
      if (o) {
        obscured.push({
          selector: o.selector,
          html: o.html,
          detail: `Le composant qui reçoit le focus clavier est entièrement masqué par un contenu ajouté par l'auteur (${o.overlay}) — il est impossible de voir où l'on se trouve au clavier.`,
        });
      }
    }
    if (hits.length >= 20 && obscured.length >= 20) {
      cutShort = `both recording caps filled at ${seen.size} of the ${count} focusable elements — enough was found to fail the page, not enough to clear the rest of it`;
      break;
    }
  }
  // …unless every tagged element was in fact visited. A ring that never wraps because focus
  // left the document for good was still crossed end to end, and refusing it a verdict on the
  // shape of its ending would withhold a measurement that really happened.
  if (cutShort && seen.size >= count) cutShort = undefined;
  const why =
    cappedRing(capped, limits) ??
    cutShort ??
    (untagged > 0
      ? `Tab crossed ${untagged} element(s) the tagging pass never matched — a control focusable in the browser but not by this selector (a skip link revealed on focus, a widget moving focus into an untagged node). They were never compared, so this page is not cleared`
      : undefined);
  return { visible: hits, obscured, complete: !why, ...(why ? { why } : {}) };
}

// HOW MANY TAB STOPS ONE NATIVE CONTROL LEGITIMATELY HOLDS.
//
// A date field is not one tab stop. Chromium splits `input[type=date]` into day, month, year
// and the picker button, and Tab walks them one by one WITHOUT leaving the element — so
// `document.activeElement` is unchanged for several presses on a page with nothing wrong with
// it. MEASURED in Chromium, presses needed before focus leaves the input:
//
//     text · number · color · range · file   1
//     month · week                           3
//     date · time                            4
//     datetime-local                         7
//
// The trap walk confirmed over three presses, so `date`, `time` and `datetime-local` were all
// reported as keyboard traps — a `bloquant` 2.1.2 non-conformity, raised on a plain date field
// that any keyboard user tabs straight through. Found on tests/fixtures/realworld/contact.html,
// which carries two ordinary `<input type="date">`.
//
// The budget is read from the ELEMENT rather than raised to a constant: a bigger magic number
// would still be wrong for the next composite control, and it would make every genuine trap
// four presses slower to confirm. `+1` over the measured figure so the confirmation ends on a
// press that really did leave.
export const NATIVE_SEGMENT_STOPS: Record<string, number> = {
  date: 5,
  time: 5,
  "datetime-local": 8,
  month: 4,
  week: 4,
};

/** THE PRESS BUDGET OF A TAB WALK, which is not the same number as the ring's length.
 *
 *  Both walks below bounded themselves at `count + 2` PRESSES while `count` counts ELEMENTS,
 *  and the two only agree on a page where every control is crossed in one press. A composite
 *  native editor costs up to seven (see NATIVE_SEGMENT_STOPS), so a form with a handful of date
 *  fields ran the budget out before the end of the ring — and stopped measuring without saying
 *  so, which is the same silent under-coverage the wrap test used to produce.
 *
 *  The ceiling is generous because it is a BACKSTOP, not a schedule: `seen` stops the walk as
 *  soon as the ring closes, `hits` caps what is recorded, and `deadline` bounds the wall clock.
 *  What this number must never do is stop a walk that still had ring left to cross. */
function tabPressBudget(count: number, limits: ProbeLimits): number {
  return Math.min(count * 2 + 20, limits.maxFocusables * 2 + 20);
}

// 2.1.2 No Keyboard Trap — where the ACTIVE element is, and whether it is still inside the
// page. `focusSetupExpr` has already tagged the focusable ring with `data-u11y-f`; this reads
// the tag back, so the walk below identifies an element without re-querying the document on
// every step.
//
// `null` means focus has left the ring — body, documentElement, or nothing at all, which is
// what Playwright reports once Tab hands focus back to the browser chrome. That is the NORMAL
// end of a tab ring, never a trap, and conflating the two would report every well-behaved page.
//
// `tagged` decides whether the caller may COMPARE two observations. An element the setup pass
// never tagged is identified by its selector alone, and a selector is not an identity: two links
// in the same list share one, so a walk that compared them would report a trap on a page whose
// focus was moving perfectly well. Untagged means « cannot accuse ».
export const FOCUS_WHERE_PROBE = `(() => { ${PRELUDE}
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const key = e.getAttribute && e.getAttribute('data-u11y-f');
  const stops = ${JSON.stringify(NATIVE_SEGMENT_STOPS)};
  const type = e.tagName === 'INPUT' ? (e.getAttribute('type') || 'text').toLowerCase() : '';
  return { key: key || __sel(e), tagged: !!key, selector: __sel(e), html: __html(e), segments: stops[type] || 1 };
})()`;

/** RGAA 12.9 / WCAG 2.1.2 — can the keyboard always LEAVE?
 *
 *  The one rendering criterion this tool documented as measured by no tier at all (see
 *  src/report.ts NEEDS_RENDERING), and the reason RGAA 12.9 reached a paid adjudicator on every
 *  run carrying nothing but a React `preventDefault` line to rule on. A trap is not a property
 *  of the source; it is a property of the tab ring, and the tab ring only exists in a browser.
 *
 *  The measurement is deliberately narrow, because a wrong NC here is expensive: focus is
 *  TRAPPED when Tab is pressed and the active element does not change, on a page that has more
 *  than one focusable — confirmed over `confirmPresses` further presses so a control that
 *  swallows one keystroke (a listbox stepping through its options) is not reported as a cage.
 *  Everything else — focus leaving for the browser chrome, the ring wrapping round to its first
 *  element — is a page behaving correctly, and returns no hit. */
export async function probeKeyboardTrap(page: Any, limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<ProbeHit[]> {
  return (await probeKeyboardTrapRing(page, limits, deadline)).hits;
}

/** What one walk of the ring found, AND whether it crossed the whole of it. The hits alone
 *  cannot say: an empty list is « no cage anywhere » or « the budget ran out on the third
 *  element », and only the first may be read as conformity on 2.1.2. */
export interface KeyboardTrapWalk extends RingCoverage {
  hits: ProbeHit[];
}

export async function probeKeyboardTrapRing(page: Any, limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<KeyboardTrapWalk> {
  const { count, capped } = readSetup(await page.evaluate(focusSetupExpr("", limits.maxFocusables)), limits);
  // One focusable cannot be a trap: Tab has nowhere else to go, and that is the page's shape
  // rather than a cage. Zero cannot either. Either way the question is settled for this page,
  // so the walk is complete rather than skipped.
  if (!count || count < 2) return { hits: [], complete: true };
  const hits: ProbeHit[] = [];
  const seen = new Set<string>();
  const confirmPresses = 2;
  const limit = tabPressBudget(count, limits);
  type Where = { key: string; tagged?: boolean; selector: string; html: string; segments?: number };
  let prev: Where | null = null;
  let cutShort: string | undefined = `the walk spent its ${limit} Tab presses without the ring ever closing, so the tail of it was never reached`;
  for (let i = 0; i < limit; i++) {
    if (deadline?.out()) {
      cutShort = `the probe budget of ${limits.budgetMs}ms ran out after ${seen.size} of the ${count} focusable elements — the rest of the ring was never walked`;
      break;
    }
    await page.keyboard.press("Tab");
    const now = (await page.evaluate(FOCUS_WHERE_PROBE)) as Where | null;
    // Focus left the page. The ring ended the way it should; nothing to report and nothing
    // left to walk.
    if (!now) {
      cutShort = undefined;
      break;
    }
    if (prev?.tagged && now.tagged && now.key === prev.key) {
      // Stuck for one press. Confirm before accusing: press again, and only call it a trap if
      // focus is STILL on the same element every time.
      //
      // How many times is a property of the CONTROL, not a constant — see NATIVE_SEGMENT_STOPS.
      // An ordinary control gets the two extra presses this loop always used; a native
      // multi-segment editor gets as many as its segments need, because walking its own
      // segments is the control working, not a cage.
      const budget = Math.max(confirmPresses, (now.segments ?? 1) - 1);
      let stuck = true;
      // A CONFIRMATION THE BUDGET CUT IS NOT A CONFIRMATION. `stuck` starts true, so a
      // deadline firing on the first press left it true and the walk accused a control it had
      // pressed Tab on exactly once — a `bloquant` non-conformity manufactured out of our own
      // clock running out. The walk stops and says so instead.
      let confirmed = true;
      for (let k = 0; k < budget && stuck; k++) {
        if (deadline?.out()) {
          confirmed = false;
          break;
        }
        await page.keyboard.press("Tab");
        const again = (await page.evaluate(FOCUS_WHERE_PROBE)) as Where | null;
        stuck = again !== null && again.tagged === true && again.key === now.key;
      }
      if (!confirmed) {
        cutShort = `the probe budget of ${limits.budgetMs}ms ran out while confirming whether focus could leave ${now.selector} — an unconfirmed suspicion is not a non-conformity`;
        break;
      }
      if (stuck) {
        hits.push({
          selector: now.selector,
          html: now.html,
          detail: `Le focus reste sur cet élément après ${1 + budget} appuis sur Tab, alors que la page compte ${count} éléments focalisables — piège au clavier (2.1.2).`,
        });
        // One cage is the finding; walking further inside it only produces the same hit again.
        // The measurement REACHED ITS CONCLUSION — 2.1.2 fails on this page — so the walk
        // counts as complete even though it stopped mid-ring.
        cutShort = undefined;
        break;
      }
    }
    // The ring wrapped round to somewhere already visited: a complete, escapable cycle.
    //
    // Same exemption as the focus walk above: a key equal to the PREVIOUS one is a composite
    // control walking its own segments, not a cycle. Without it, a walk that started on a date
    // field — which is exactly where `probeFocusVisible` used to leave the focus — broke after
    // two iterations and never reached the real trap ten controls later. Measured on
    // tests/fixtures/realworld/contact.html: the seeded trap on `#confirmation` was reported by
    // a hand walk and by nothing else.
    if (now.key !== prev?.key) {
      if (seen.has(now.key)) {
        cutShort = undefined; // the ring came full circle — a complete, escapable cycle
        break;
      }
      seen.add(now.key);
    }
    prev = now;
  }
  if (cutShort && seen.size >= count) cutShort = undefined;
  const why = cappedRing(capped, limits) ?? cutShort;
  return { hits, complete: !why, ...(why ? { why } : {}) };
}

export async function probeHover(page: Any, limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<ProbeHit[]> {
  return (await probeHoverWalk(page, limits, deadline)).hits;
}

/** What the hover pass found, AND whether it opened every trigger on the page. Same reason as
 *  the tab-ring walks: `HOVER_SETUP_PROBE` stops tagging at ten, `maxTriggers` bounds what is
 *  tried and `maxHits` what is recorded, and all three used to return a partial pass in the
 *  shape of a finished one — after which 1.4.13 was credited for a page with eleven tooltips
 *  of which the eleventh was the one that would not close. */
export interface HoverWalk extends RingCoverage {
  hits: ProbeHit[];
}

export async function probeHoverWalk(page: Any, limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<HoverWalk> {
  const setup = (await page.evaluate(HOVER_SETUP_PROBE)) as { key: string; target: string; selector: string; total?: number }[];
  const triggers = setup;
  const hits: ProbeHit[] = [];
  let cutShort: string | undefined;
  let unreachable = 0;
  // What is TRIED is capped, not just what is recorded: a design system that puts a tooltip
  // on every icon offers hundreds of triggers, and each one costs a hover plus two waits.
  const tried = triggers.slice(0, Math.max(1, limits.maxTriggers));
  if (tried.length < triggers.length) {
    cutShort = `only ${tried.length} of the ${triggers.length} hover triggers on this page were opened (probes.maxTriggers) — the rest were never asked whether Escape dismisses them`;
  }
  for (const tr of tried) {
    if (deadline?.out()) {
      cutShort = `the probe budget of ${limits.budgetMs}ms ran out with triggers left unopened`;
      break;
    }
    try {
      // The timeout is the whole point. Without it Playwright waits for actionability
      // FOREVER — an element behind a sticky header, or one that never settles, then hangs
      // the caller's test instead of costing this trigger.
      await page.hover(`[data-u11y-h="${tr.key}"]`, { timeout: actionTimeout(limits, deadline) });
    } catch {
      // NOT « one trigger less to worry about ». A trigger that will not become actionable —
      // covered by a sticky bar, detached mid-pass, never settling — is one whose tooltip was
      // never opened and never asked whether Escape dismisses it. Swallowing the exception and
      // walking on left 1.4.13 credited for a page this pass had not finished looking at.
      unreachable++;
      continue;
    }
    await page.waitForTimeout(150);
    const shown = (await page.evaluate(hoverVisibleExpr(tr.target))) as boolean;
    if (!shown) continue; // not actually a hover-revealed tooltip
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const dismissed = (await page.evaluate(hoverVisibleExpr(tr.target, true))) as boolean;
    await page.mouse.move(2, 2).catch(() => {});
    if (!dismissed) {
      hits.push({
        selector: tr.selector,
        html: "",
        detail: `Le contenu révélé au survol (aria-describedby #${tr.target}) ne se masque pas avec Échap — Contenu au survol ou au focus (1.4.13).`,
      });
    }
    if (hits.length >= Math.min(limits.maxHits, 8)) {
      cutShort = "the recording cap filled with triggers left unopened — enough was found to fail the page, not enough to clear the rest of it";
      break;
    }
  }
  // The SETUP pass has its own ceiling of ten, and it is the one nobody could see: a page with
  // eleven tooltips handed back ten, and the eleventh — which may be the broken one — was
  // never in the list this loop walks.
  const capped = (setup as { total?: number }[])[0]?.total;
  const why =
    cutShort ??
    (typeof capped === "number" && capped > triggers.length
      ? `only ${triggers.length} of the ${capped} hover triggers on this page were tagged — the rest were never opened`
      : undefined) ??
    (unreachable > 0 ? `${unreachable} hover trigger(s) never became actionable, so their content was never opened or dismissed` : undefined);
  return { hits, complete: !why, ...(why ? { why } : {}) };
}

/** THE LIVE PROBES, RUN ON A PAGE SOMEBODY ELSE OPENED.
 *
 *  `scanLocal` navigates its own browser, which is the whole reason a handful of criteria
 *  could never be decided on a real application: the screens that matter sit behind
 *  authentication and behind a state machine, and a scanner arriving cold gets a redirect.
 *  An E2E suite already has the page in the right state — it just had no way to ask for
 *  these measurements.
 *
 *  So the same probes, against a page the caller owns. Everything here is measured and then
 *  PUT BACK: the viewport is restored to what the caller had, the injected text-spacing
 *  stylesheet is removed, and the root font-size the zoom probe changes is reset inside the
 *  probe itself. A suite that calls this must find its page as it left it, or the assertion
 *  it runs next is measuring our leftovers.
 *
 *  Read-only by contract: no fill, no click, no navigation. The stateful probes stay in
 *  `scanLocal`, where the safety contract for driving a page is already stated and where a
 *  mutation cannot surprise a test that owns the session. */
/** What the caller asks `runLiveProbes` for.
 *
 *  `liveRegion` is the one option that changes the CONTRACT rather than the tuning. Every other
 *  probe here measures and puts back: the viewport is restored, the injected stylesheet
 *  removed, the root font-size reset. This one fills the page's text inputs and toggles its
 *  controls to see what gets announced — restored, but observed by anything watching — and
 *  with `clicks` it presses buttons whose side effects nothing can restore. So it is off unless
 *  asked for, and its clicks are off even then. */
export interface LiveProbeOptions {
  only?: string[];
  limits?: Partial<ProbeLimits>;
  /** Measure 4.1.3 Status Messages. `true` performs the RESTORED interactions only (fill a
   *  field, toggle a control); `{ clicks: true }` also presses `button[type=button]`, which no
   *  `location.href` check can undo on an authenticated application. */
  liveRegion?: boolean | { clicks?: boolean };
  /** The language the live-region finding is worded in. Defaults to French, which is what
   *  every other probe in this module already hard-codes into its `detail` — one document
   *  should not carry two languages of finding. */
  lang?: keyof typeof LIVE_REGION_DETAIL;
}

export async function runLiveProbes(page: Any, opts: LiveProbeOptions = {}): Promise<LiveProbeResult> {
  const limits: ProbeLimits = { ...PROBE_DEFAULTS, ...opts.limits };
  const only = opts.only?.length ? new Set(opts.only) : null;
  const want = (id: string): boolean => only === null || only.has(id);
  const deadline = probeDeadline(limits.budgetMs);
  // Capability checks, not assumptions. A page object that cannot resize or press a key is a
  // page whose reflow and focus-visibility simply were not measured — which is a fact to
  // record, not a crash to propagate into somebody's test run.
  const canResize = typeof page.setViewportSize === "function" && typeof page.viewportSize === "function";
  const canType = !!page.keyboard && typeof page.keyboard.press === "function";
  const canHover = typeof page.hover === "function" && typeof page.waitForTimeout === "function";
  const canStyle = typeof page.addStyleTag === "function";
  const size = (canResize ? (page.viewportSize() ?? null) : null) as { width: number; height: number } | null;
  const restore = size ?? { width: 1280, height: 900 };
  const out: LiveProbeResult = {
    v: PROBES_VERSION,
    focusVisible: [],
    hover: [],
    keyboardTrap: [],
    reflowZoom: [],
    textSpacing: [],
    reflow: { horizontalScroll: false },
    probed: [],
    skipped: [],
  };
  const skip = (sc: string, why: string): void => {
    out.skipped?.push({ sc, why });
  };
  /** Run one probe, and NEVER wait longer than the budget allows.
   *
   *  The timeout handed to `page.hover` is the polite ask; this is the guarantee. A page
   *  object is whatever the caller's runtime hands us — a Playwright `Page`, a Cypress shim,
   *  a home-made harness — and one that ignores the option would otherwise hang this pass and
   *  the test around it. The cut promise keeps running in the background where we cannot
   *  cancel it; its rejection is absorbed so it can never surface as an unhandled one. */
  const bounded = async <T>(sc: string, run: () => Promise<T>): Promise<T | null> => {
    if (deadline.out()) {
      skip(sc, `the probe budget of ${limits.budgetMs}ms was already spent when this criterion came up`);
      return null;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const CUT = Symbol("cut");
    const started = Date.now();
    try {
      const raced = await Promise.race([
        run().catch((e: unknown) => {
          throw e;
        }),
        new Promise<typeof CUT>((resolve) => {
          timer = setTimeout(() => resolve(CUT), Math.max(1, deadline.left()));
        }),
      ]);
      if (raced === CUT) {
        skip(sc, `the probe budget of ${limits.budgetMs}ms ran out after ${Date.now() - started}ms — this measurement did not complete`);
        return null;
      }
      return raced as T;
    } catch (e: unknown) {
      skip(sc, String((e as Error)?.message ?? e).slice(0, 160));
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  if (!canResize) skip("1.4.10", "the page object cannot resize its viewport");
  if (!canType) for (const sc of ["2.4.7", "2.1.2"]) skip(sc, "the page object exposes no keyboard");
  if (!canHover) skip("1.4.13", "the page object cannot hover");
  if (!canStyle) skip("1.4.12", "the page object cannot inject a stylesheet");
  // ORDER IS DELIBERATE: cheap and deterministic first, interactive last.
  //
  // Zoom, reflow and text spacing are one `evaluate` (plus a resize) each — milliseconds.
  // Focus visibility tabs through the whole ring, and hover opens one trigger after another;
  // those are the two that cost seconds, and the two that can be cut short. Running them last
  // means a budget overrun costs the interactive tail rather than three measurements that
  // would have completed in the time it takes to say so. It also leaves the caller's page
  // closer to how they left it: nothing after us moves the focus or hovers an element.
  //
  // Each probe is guarded on its own: one that throws — or outlives the budget — costs its
  // criterion, never the others and never the caller's test.
  if (want("1.4.4")) {
    const r = await bounded("1.4.4", async () => (await page.evaluate(REFLOW_ZOOM_PROBE)) as ProbeHit[]);
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
      const r = await bounded("1.4.10", async () => (await page.evaluate(REFLOW_PROBE)) as { horizontalScroll: boolean });
      // The viewport goes back whatever the probe did — the caller's next assertion must not
      // be measuring a 320px page. Outside `bounded`, and outside every early return: a
      // restore the budget could skip is a page handed back in the wrong shape.
      await page.setViewportSize(restore).catch(() => {});
      if (r) {
        out.reflow = r;
        out.probed.push("1.4.10");
      }
    }
  }
  if (want("1.4.12") && canStyle) {
    // Tagged so it can be removed again — an injected stylesheet left behind would change
    // every measurement the caller makes after this call.
    const handle = await bounded("1.4.12", () => page.addStyleTag({ content: TEXT_SPACING_CSS }));
    if (handle) {
      const r = await bounded("1.4.12", async () => (await page.evaluate(TEXT_SPACING_PROBE)) as ProbeHit[]);
      await page.evaluate(REMOVE_TEXT_SPACING_STEP).catch(() => {});
      if (r) {
        out.textSpacing = r;
        out.probed.push("1.4.12");
      }
    }
  }
  // ONE WALK, TWO CRITERIA. 2.4.7 asks whether focus is visible, 2.4.11 whether the focused
  // component is entirely hidden behind author-created content — both about the same element
  // at the same moment, so they share the ring rather than each paying for a walk of it.
  // `probed` records them separately: a run that reached the deadline mid-ring must not claim
  // to have measured either one for the whole page.
  if ((want("2.4.7") || want("2.4.11")) && canType) {
    const r = await bounded("2.4.7", () => probeFocusRing(page, "", limits, deadline));
    if (r) {
      out.focusVisible = r.visible;
      out.focusObscured = r.obscured;
      // WHAT IT FOUND IS KEPT EITHER WAY; WHAT IT MAY CONCLUDE IS NOT.
      //
      // A hit is a failure the browser reproduced on an element it really did focus, so a
      // truncated walk's hits are as good as a whole one's. Its SILENCE is not: nobody looked
      // at the tail of that ring, and `probed` is precisely the claim that somebody did.
      for (const sc of ["2.4.7", "2.4.11"]) {
        if (!want(sc)) continue;
        if (r.complete) out.probed.push(sc);
        else skip(sc, r.why ?? "the walk of the tab ring did not cross the whole of it");
      }
    }
  }
  // AFTER focus visibility, and for the same reason it comes late: it walks the tab ring, which
  // is one of the two measurements that cost seconds. It also reuses the tagging that
  // `probeFocusVisible` has just laid down, so on the common path it costs the walk and not the
  // setup.
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
  // LAST, AND FOR A REASON THE ORDER ABOVE ALREADY STATES TWICE: this is the only probe here
  // that changes the page rather than stressing it. Its fills and toggles are restored, but a
  // framework that reacted to them has reacted, so nothing measured after it would be
  // measuring the page the caller handed over. Running it at the end costs the tail of the
  // budget and nothing else.
  if (want("4.1.3") && opts.liveRegion) {
    const clicks = typeof opts.liveRegion === "object" && opts.liveRegion.clicks === true;
    const r = await bounded("4.1.3", () => probeLiveRegion(page, opts.lang ?? "fr", clicks));
    if (r) {
      out.liveRegion = r.hits;
      if (r.complete) out.probed.push("4.1.3");
      else skip("4.1.3", r.why ?? "the live-region pass did not exercise the whole page");
    }
  }
  // WHAT AN OLDER READER WOULD MISREAD IS NOT CLAIMED. The finding itself is kept — it is the
  // COVERAGE CLAIM that is withdrawn — so this engine still folds the hit into a
  // non-conformity, while a 5.41.x one that cannot see the bucket is left with an undecided
  // criterion instead of a `C` published over a failure a browser reproduced. Costs nothing on
  // a clean page, which is every page that has nothing to hide.
  for (const [bucket, sc] of UNREADABLE_BY_OLDER) {
    if (out[bucket]?.length) {
      const at = out.probed.indexOf(sc);
      if (at >= 0) out.probed.splice(at, 1);
    }
  }
  return out;
}

// (5) LIVE_REGION_PROBE — WCAG 4.1.3 Status Messages (honest heuristic, severity mineur).
// Install a MutationObserver on <body>, perform ONLY the safe interactions above, and flag
// a text update whose nearest ancestor is NOT a live region (aria-live / role=status|alert
// |log) — it was likely never announced to assistive tech. location.href is asserted after
// each interaction (abort + restore on any change). Interactions and hits are bounded.
//
// HEURISTIC HONESTY: an EXPECTED context change (a dialog opening, an accordion panel
// expanding after its toggle) also mutates non-live text and can fire this probe — such
// updates don't necessarily need a live region. That is why the finding is `mineur` with
// "likely/probablement" framing, deliberately: it points the auditor at the update, it does
// not claim certainty.
//
// CLICK SAFETY (authenticated scans): even a `button[type="button"]` click can trigger a
// server MUTATION (delete a row, send a message) that the location.href assertion cannot
// see. So the click loop is emitted ONLY when `allowClicks` is true — the caller disables
// it by default whenever a storageState (authenticated session) is in use, re-enabled via
// `scan --interact-clicks`; unauthenticated scans keep clicks on. Defense-in-depth on top:
// even when clicks are on, a button whose accessible name matches a destructive/submitting
// verb (fr/en: supprimer, retirer, effacer, envoyer, valider, confirmer, payer, delete,
// remove, send, submit, confirm, pay, …) is never clicked. Fill/toggle interactions always
// run (they are the confirmed real-world need) and are restored.
export const DESTRUCTIVE_NAME_RE = "\\b(supprim|retir|effac|envoy|valid|confirm|pay|achet|command|delete|remove|eras|clear|send|submit|buy|order)";
export function liveRegionExpr(detail: string, allowClicks: boolean): string {
  const d = JSON.stringify(detail);
  const clickLoop = allowClicks
    ? `
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
    // Icon-only buttons: the name lives in img[alt] (an attribute — invisible to
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
  }`
    : `
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
export const LIVE_REGION_DETAIL = {
  fr: "Mise à jour de contenu déclenchée par une interaction hors d'une région live (aria-live / role=status|alert|log) — probablement non restituée aux technologies d'assistance.",
  en: "Content update triggered by an interaction outside any live region (aria-live / role=status|alert|log) — likely not announced to assistive technology.",
};

/** What the live-region pass found, AND whether it exercised the page. `untried` is what
 *  stands between a measurement and a shrug: a status message very often appears after a
 *  button press and nothing else, so a pass that pressed none of a page's buttons has not
 *  decided 4.1.3 on it. */
export interface LiveRegionWalk extends RingCoverage {
  hits: ProbeHit[];
}

export async function probeLiveRegion(page: Any, lang: keyof typeof LIVE_REGION_DETAIL, allowClicks: boolean): Promise<LiveRegionWalk> {
  const detail = LIVE_REGION_DETAIL[lang] ?? LIVE_REGION_DETAIL.en;
  // NO `.catch(() => [])` HERE ANY MORE. It turned a probe that never ran into a probe that
  // found nothing, and the callers then credited 4.1.3 either way — the same shape of false
  // conformity the tab-ring walks used to produce. Each caller has its own guard, and each one
  // records the failure where it belongs (`skipped`) instead of publishing silence.
  const r = (await page.evaluate(liveRegionExpr(detail, allowClicks))) as { hits: ProbeHit[]; untried: number; navigated: boolean };
  const hits = r?.hits ?? [];
  if (r?.navigated) {
    return {
      hits,
      complete: false,
      why: "an interaction navigated away mid-pass — everything after it happened on another page, and this one was not finished",
    };
  }
  if (r?.untried > 0) {
    return {
      hits,
      complete: false,
      why: `${r.untried} interactive element(s) were never exercised (clicks disabled, a destructive-sounding name, or a cap) — a status message that only appears after one of them would not have been seen`,
    };
  }
  return { hits, complete: true };
}

/** Undo the text-spacing override. Identified by its own declaration rather than by a handle,
 *  because `addStyleTag` returns an ElementHandle the caller's runtime may not expose — and a
 *  stylesheet left behind would change every measurement the caller makes after this call. */
export const REMOVE_TEXT_SPACING_STEP = `(() => {
  const sheets = Array.from(document.querySelectorAll('style'));
  for (const s of sheets) {
    if (s.textContent && s.textContent.indexOf('letter-spacing: 0.12em') >= 0) s.remove();
  }
  return true;
})()`;

/** What `runLiveProbes` measured, and which criteria it is entitled to speak for. */
/** Buckets an engine older than this one does not know how to fold, and the criterion each is
 *  the sole evidence for. A writer that fills one of these and still declares the criterion
 *  measured hands a 5.41.x reader a silence it will publish as `C` — over a finding a browser
 *  reproduced. Nothing in a future version can fix a reader that already shipped; not making
 *  the claim is what a writer can do. */
const UNREADABLE_BY_OLDER: readonly ["focusObscured" | "keyboardTrap" | "liveRegion", string][] = [
  ["focusObscured", "2.4.11"],
  ["keyboardTrap", "2.1.2"],
  ["liveRegion", "4.1.3"],
];

export interface LiveProbeResult {
  /** The coverage contract this result is written under. See PROBES_VERSION. */
  v?: number;
  focusVisible: ProbeHit[];
  /** 2.4.11 — the focused component entirely hidden behind author-created content. Optional
   *  so every existing caller and fixture that omits it stays valid. */
  focusObscured?: ProbeHit[];
  hover: ProbeHit[];
  /** 2.1.2 — focus that Tab cannot move off. Empty AND `probed` carrying "2.1.2" is the only
   *  combination that means "the ring was walked and it always let go". */
  keyboardTrap: ProbeHit[];
  reflowZoom: ProbeHit[];
  textSpacing: ProbeHit[];
  reflow: { horizontalScroll: boolean };
  /** 4.1.3 — content updated by an interaction outside any live region. Present only when the
   *  caller opted in: unlike every other probe here, this one TYPES INTO the page. */
  liveRegion?: ProbeHit[];
  /** The success criteria actually probed on THIS page. Absence of a hit only means
   *  something when the probe ran, which is why this travels with the hits. */
  probed: string[];
  /** Why a probe did not run, when one did not. Recorded rather than dropped: a measurement
   *  that vanishes silently is indistinguishable from a page with nothing wrong, and the
   *  criteria it would have decided then sit at « to assess » with nobody able to tell which
   *  of the two happened. */
  skipped?: { sc: string; why: string }[];
}
