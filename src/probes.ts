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
}

export const PROBE_DEFAULTS: ProbeLimits = { reflowWidth: 320, maxFocusables: 120, maxHits: 20 };

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

export async function probeFocusVisible(page: Any, scope = "", limits: ProbeLimits = PROBE_DEFAULTS): Promise<ProbeHit[]> {
  const count = (await page.evaluate(focusSetupExpr(scope, limits.maxFocusables))) as number;
  if (!count) return [];
  const hits: ProbeHit[] = [];
  const seen = new Set<string>();
  const limit = Math.min(count + 2, limits.maxFocusables + 10);
  for (let i = 0; i < limit; i++) {
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

export async function probeHover(page: Any, limits: ProbeLimits = PROBE_DEFAULTS): Promise<ProbeHit[]> {
  const triggers = (await page.evaluate(HOVER_SETUP_PROBE)) as { key: string; target: string; selector: string }[];
  const hits: ProbeHit[] = [];
  for (const tr of triggers) {
    try {
      await page.hover(`[data-u11y-h="${tr.key}"]`);
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
  // Capability checks, not assumptions. A page object that cannot resize or press a key is a
  // page whose reflow and focus-visibility simply were not measured — which is a fact to
  // record, not a crash to propagate into somebody's test run.
  const canResize = typeof page.setViewportSize === "function" && typeof page.viewportSize === "function";
  const canType = !!page.keyboard && typeof page.keyboard.press === "function";
  const canHover = typeof page.hover === "function" && typeof page.waitForTimeout === "function";
  const canStyle = typeof page.addStyleTag === "function";
  const size = (canResize ? (page.viewportSize() ?? null) : null) as { width: number; height: number } | null;
  const restore = size ?? { width: 1280, height: 900 };
  const out: LiveProbeResult = { focusVisible: [], hover: [], reflowZoom: [], textSpacing: [], reflow: { horizontalScroll: false }, probed: [], skipped: [] };
  const skip = (sc: string, why: string): void => {
    out.skipped?.push({ sc, why });
  };
  if (!canResize) skip("1.4.10", "the page object cannot resize its viewport");
  if (!canType) skip("2.4.7", "the page object exposes no keyboard");
  if (!canHover) skip("1.4.13", "the page object cannot hover");
  if (!canStyle) skip("1.4.12", "the page object cannot inject a stylesheet");
  // Each probe is guarded on its own: one that throws costs its criterion, never the others
  // and never the caller's test.
  if (want("2.4.7") && canType) {
    const r = await probeFocusVisible(page, "", limits).catch((e: unknown) => {
      skip("2.4.7", String((e as Error)?.message ?? e).slice(0, 160));
      return null;
    });
    if (r) {
      out.focusVisible = r;
      out.probed.push("2.4.7");
    }
  }
  if (want("1.4.13") && canHover && canType) {
    const r = await probeHover(page, limits).catch((e: unknown) => {
      skip("1.4.13", String((e as Error)?.message ?? e).slice(0, 160));
      return null;
    });
    if (r) {
      out.hover = r;
      out.probed.push("1.4.13");
    }
  }
  if (want("1.4.4")) {
    out.reflowZoom = ((await page.evaluate(REFLOW_ZOOM_PROBE).catch(() => [])) as ProbeHit[]) ?? [];
    out.probed.push("1.4.4");
  }
  if (want("1.4.10") && canResize) {
    let narrowed = true;
    await page.setViewportSize({ width: limits.reflowWidth, height: restore.height }).catch((e: unknown) => {
      narrowed = false;
      skip("1.4.10", String((e as Error)?.message ?? e).slice(0, 160));
    });
    if (narrowed) {
      const r = (await page.evaluate(REFLOW_PROBE).catch((e: unknown) => {
        skip("1.4.10", String((e as Error)?.message ?? e).slice(0, 160));
        return null;
      })) as { horizontalScroll: boolean } | null;
      // The viewport goes back whatever the probe did — the caller's next assertion must not
      // be measuring a 320px page.
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
    const handle = await page.addStyleTag({ content: TEXT_SPACING_CSS }).catch((e: unknown) => {
      skip("1.4.12", String((e as Error)?.message ?? e).slice(0, 160));
      return null;
    });
    if (handle) {
      const r = (await page.evaluate(TEXT_SPACING_PROBE).catch((e: unknown) => {
        skip("1.4.12", String((e as Error)?.message ?? e).slice(0, 160));
        return null;
      })) as ProbeHit[] | null;
      await page.evaluate(REMOVE_TEXT_SPACING_STEP).catch(() => {});
      if (r) {
        out.textSpacing = r;
        out.probed.push("1.4.12");
      }
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
