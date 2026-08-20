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
  const t = e.tagName.toLowerCase();
  if (e.id) return t + '#' + e.id;
  const c = typeof e.className === 'string' ? e.className.trim().split(/\\s+/)[0] : '';
  return c ? t + '.' + c : t;
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
      hits.push({ selector: __sel(e), html: __html(e), detail: 'Texte tronqué/masqué sous l\\'espacement de texte WCAG 1.4.12 — perte de contenu.' });
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
export function focusSetupExpr(scope = "", maxFocusables = PROBE_DEFAULTS.maxFocusables): string {
  const rootExpr = scope ? `document.querySelectorAll(${JSON.stringify(scope)})` : `[document.documentElement]`;
  return `(() => { ${PRELUDE}
  const sel = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[role=button]:not([disabled])';
  const snap = (e) => { const s = getComputedStyle(e); return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderTopWidth, s.borderBottomWidth, s.backgroundColor, s.color, s.textDecorationLine].join('|'); };
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
    e.setAttribute('data-u11y-f', key);
    proxy.setAttribute('data-u11y-fp', key);
    window.__u11yF[key] = { rest: snap(proxy), sel: __sel(proxy), html: __html(proxy) };
    n++;
    if (n >= ${maxFocusables}) break;
  }
  return n;
})()`;
}

// Pass 2 (after each Tab): is the active element a tagged focusable whose focus PROXY
// (itself, or its label for a custom control) is UNCHANGED vs the unfocused snapshot?
// If so, focus produced no visible indicator.
export const FOCUS_CHECK_PROBE = `(() => {
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const key = e.getAttribute && e.getAttribute('data-u11y-f');
  if (!key || !window.__u11yF || !window.__u11yF[key]) return null;
  const rec = window.__u11yF[key];
  const proxy = document.querySelector('[data-u11y-fp="' + key + '"]') || e;
  const s = getComputedStyle(proxy);
  const now = [s.outlineStyle, s.outlineWidth, s.outlineColor, s.boxShadow, s.borderColor, s.borderTopWidth, s.borderBottomWidth, s.backgroundColor, s.color, s.textDecorationLine].join('|');
  return { key: key, changed: now !== rec.rest, selector: rec.sel, html: rec.html };
})()`;

// 1.4.13 Content on Hover — find triggers whose aria-describedby target is hidden, so
// hovering can reveal it. probeHover then checks it is dismissible (Escape).
export const HOVER_SETUP_PROBE = `(() => { ${PRELUDE}
  const out = [];
  let n = 0;
  for (const e of Array.from(document.querySelectorAll('[aria-describedby]'))) {
    const id = (e.getAttribute('aria-describedby') || '').split(/\\s+/)[0];
    if (!id) continue;
    const t = document.getElementById(id);
    if (!t) continue;
    const s = getComputedStyle(t);
    const hidden = s.display === 'none' || s.visibility === 'hidden' || t.getBoundingClientRect().height === 0;
    if (!hidden) continue;
    const key = 'h' + n;
    e.setAttribute('data-u11y-h', key);
    out.push({ key: key, target: id, selector: __sel(e) });
    n++;
    if (n >= 10) break;
  }
  return out;
})()`;

export function hoverVisibleExpr(id: string, wantHidden = false): string {
  const j = JSON.stringify(id);
  return `(() => { const t = document.getElementById(${j}); if (!t) return ${wantHidden ? "true" : "false"}; const s = getComputedStyle(t); const shown = s.display !== 'none' && s.visibility !== 'hidden' && t.getBoundingClientRect().height > 0; return ${wantHidden ? "!shown" : "shown"}; })()`;
}

export async function probeFocusVisible(page: Any, scope = "", limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<ProbeHit[]> {
  const count = (await page.evaluate(focusSetupExpr(scope, limits.maxFocusables))) as number;
  if (!count) return [];
  const hits: ProbeHit[] = [];
  const seen = new Set<string>();
  const limit = Math.min(count + 2, limits.maxFocusables + 10);
  for (let i = 0; i < limit; i++) {
    // A tab ring of 130 elements is two round-trips each on a loaded CI runner. Stopping at
    // the deadline costs the tail of the ring, which `runLiveProbes` then records.
    if (deadline?.out()) break;
    await page.keyboard.press("Tab");
    const r = (await page.evaluate(FOCUS_CHECK_PROBE)) as { key: string; changed: boolean; selector: string; html: string } | null;
    if (!r) continue;
    if (seen.has(r.key)) break; // wrapped around the tab ring
    seen.add(r.key);
    if (!r.changed) {
      hits.push({
        selector: r.selector,
        html: r.html,
        detail: "Le focus clavier ne produit aucun changement visible (outline/box-shadow/bordure/fond) — focus non visible (2.4.7).",
      });
    }
    if (hits.length >= 20) break;
  }
  return hits;
}

// 2.1.2 No Keyboard Trap — where the ACTIVE element is, and whether it is still inside the
// page. `focusSetupExpr` has already tagged the focusable ring with `data-u11y-f`; this reads
// the tag back, so the walk below identifies an element without re-querying the document on
// every step.
//
// `null` means focus has left the ring — body, documentElement, or nothing at all, which is
// what Playwright reports once Tab hands focus back to the browser chrome. That is the NORMAL
// end of a tab ring, never a trap, and conflating the two would report every well-behaved page.
export const FOCUS_WHERE_PROBE = `(() => { ${PRELUDE}
  const e = document.activeElement;
  if (!e || e === document.body || e === document.documentElement) return null;
  const key = e.getAttribute && e.getAttribute('data-u11y-f');
  return { key: key || __sel(e), selector: __sel(e), html: __html(e) };
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
  const count = (await page.evaluate(focusSetupExpr("", limits.maxFocusables))) as number;
  // One focusable cannot be a trap: Tab has nowhere else to go, and that is the page's shape
  // rather than a cage. Zero cannot either.
  if (!count || count < 2) return [];
  const hits: ProbeHit[] = [];
  const seen = new Set<string>();
  const confirmPresses = 2;
  const limit = Math.min(count + 2, limits.maxFocusables + 10);
  let prev: { key: string; selector: string; html: string } | null = null;
  for (let i = 0; i < limit; i++) {
    if (deadline?.out()) break;
    await page.keyboard.press("Tab");
    const now = (await page.evaluate(FOCUS_WHERE_PROBE)) as { key: string; selector: string; html: string } | null;
    // Focus left the page. The ring ended the way it should; nothing to report and nothing
    // left to walk.
    if (!now) break;
    if (prev && now.key === prev.key) {
      // Stuck for one press. Confirm before accusing: press again, and only call it a trap if
      // focus is STILL on the same element every time.
      let stuck = true;
      for (let k = 0; k < confirmPresses && stuck; k++) {
        if (deadline?.out()) break;
        await page.keyboard.press("Tab");
        const again = (await page.evaluate(FOCUS_WHERE_PROBE)) as { key: string; selector: string } | null;
        stuck = again !== null && again.key === now.key;
      }
      if (stuck) {
        hits.push({
          selector: now.selector,
          html: now.html,
          detail: `Le focus reste sur cet élément après ${1 + confirmPresses} appuis sur Tab, alors que la page compte ${count} éléments focalisables — piège au clavier (2.1.2).`,
        });
        // One cage is the finding; walking further inside it only produces the same hit again.
        break;
      }
    }
    // The ring wrapped round to somewhere already visited: a complete, escapable cycle.
    if (seen.has(now.key)) break;
    seen.add(now.key);
    prev = now;
    if (hits.length >= 4) break;
  }
  return hits;
}

export async function probeHover(page: Any, limits: ProbeLimits = PROBE_DEFAULTS, deadline?: ProbeDeadline): Promise<ProbeHit[]> {
  const triggers = (await page.evaluate(HOVER_SETUP_PROBE)) as { key: string; target: string; selector: string }[];
  const hits: ProbeHit[] = [];
  // What is TRIED is capped, not just what is recorded: a design system that puts a tooltip
  // on every icon offers hundreds of triggers, and each one costs a hover plus two waits.
  for (const tr of triggers.slice(0, Math.max(1, limits.maxTriggers))) {
    if (deadline?.out()) break;
    try {
      // The timeout is the whole point. Without it Playwright waits for actionability
      // FOREVER — an element behind a sticky header, or one that never settles, then hangs
      // the caller's test instead of costing this trigger.
      await page.hover(`[data-u11y-h="${tr.key}"]`, { timeout: actionTimeout(limits, deadline) });
    } catch {
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
    if (hits.length >= Math.min(limits.maxHits, 8)) break;
  }
  return hits;
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
export async function runLiveProbes(page: Any, opts: { only?: string[]; limits?: Partial<ProbeLimits> } = {}): Promise<LiveProbeResult> {
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
  if (!canType) skip("2.4.7", "the page object exposes no keyboard");
  if (!canType) skip("2.1.2", "the page object exposes no keyboard");
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
  if (want("2.4.7") && canType) {
    const r = await bounded("2.4.7", () => probeFocusVisible(page, "", limits, deadline));
    if (r) {
      out.focusVisible = r;
      out.probed.push("2.4.7");
    }
  }
  // AFTER focus visibility, and for the same reason it comes late: it walks the tab ring, which
  // is one of the two measurements that cost seconds. It also reuses the tagging that
  // `probeFocusVisible` has just laid down, so on the common path it costs the walk and not the
  // setup.
  if (want("2.1.2") && canType) {
    const r = await bounded("2.1.2", () => probeKeyboardTrap(page, limits, deadline));
    if (r) {
      out.keyboardTrap = r;
      out.probed.push("2.1.2");
    }
  }
  if (want("1.4.13") && canHover && canType) {
    const r = await bounded("1.4.13", () => probeHover(page, limits, deadline));
    if (r) {
      out.hover = r;
      out.probed.push("1.4.13");
    }
  }
  return out;
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
export interface LiveProbeResult {
  focusVisible: ProbeHit[];
  hover: ProbeHit[];
  /** 2.1.2 — focus that Tab cannot move off. Empty AND `probed` carrying "2.1.2" is the only
   *  combination that means "the ring was walked and it always let go". */
  keyboardTrap: ProbeHit[];
  reflowZoom: ProbeHit[];
  textSpacing: ProbeHit[];
  reflow: { horizontalScroll: boolean };
  /** The success criteria actually probed on THIS page. Absence of a hit only means
   *  something when the probe ran, which is why this travels with the hits. */
  probed: string[];
  /** Why a probe did not run, when one did not. Recorded rather than dropped: a measurement
   *  that vanishes silently is indistinguishable from a page with nothing wrong, and the
   *  criteria it would have decided then sit at « to assess » with nobody able to tell which
   *  of the two happened. */
  skipped?: { sc: string; why: string }[];
}
