// `scan --runtime local` — the dynamic tier WITHOUT Docker. Resolves a host/target
// Playwright + @axe-core/playwright AT RUNTIME (createRequire, a node: builtin) from
// `--cwd`, so the zero-dep static engine bundle never gains a static browser import.
// It runs the SAME axe-core pass as the Docker RUNNER, then the residual-criteria
// probes axe cannot decide (focus visibility, 200% zoom, text spacing, content on
// hover, target size). The Docker RUNNER / docker/* files are untouched (docker-sync).
//
// Browser-context code is passed to page.evaluate AS STRINGS — like the Docker RUNNER —
// because the engine's tsconfig ships no DOM lib (it is a Node program); a typed
// arrow body referencing document/window would not type-check.
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { DynamicFinding, DynamicResult, Lang, SamplePage, ScanRedirect } from "./types.js";
import { type DiscoverOpts, discoverUrls, type ProbeHit, type RunnerOutput, tagSampleFindings, toDynamicResult, writeRunnerSnapshot } from "./scan.js";
// The stress probes live in their own module so the E2E plugin can run them on a page it
// already owns — see src/probes.ts. Imported, never copied: a probe that means two things
// in two runtimes is worse than no probe.
import {
  FOCUS_CHECK_PROBE,
  focusSetupExpr,
  HOVER_SETUP_PROBE,
  hoverVisibleExpr,
  PRELUDE,
  REMOVE_TEXT_SPACING_STEP,
  probeFocusVisible,
  probeHover,
  REFLOW_PROBE,
  REFLOW_ZOOM_PROBE,
  TEXT_SPACING_CSS,
  TEXT_SPACING_PROBE,
} from "./probes.js";
import { sampleScope } from "./sample.js";
import { COLLECT_SNAPSHOT, type CollectedPage } from "./snapshot.js";
import { today } from "./util.js";

export const LOCAL_ENGINE = "axe-core@playwright (local)";

// The needs-rendering SCs the LOCAL runtime's probes actually MEASURE on every run: 200%
// zoom (1.4.4), 320px reflow (1.4.10), text spacing (1.4.12), focus visibility (2.4.7),
// content on hover (1.4.13). Live regions (4.1.3) are measured only when the STATEFUL
// interactions are on (`--no-interact` skips that probe). Stamped on every local
// DynamicResult so the partial-audit advisory reflects real coverage — the Docker subset
// lives in scan.ts (DOCKER_TESTED_SCS).
const LOCAL_TESTED_SCS: readonly string[] = ["1.4.4", "1.4.10", "1.4.12", "2.4.7", "1.4.13"];
export function localTestedScs(interact: boolean): string[] {
  return interact ? [...LOCAL_TESTED_SCS, "4.1.3"] : [...LOCAL_TESTED_SCS];
}

// Playwright + AxeBuilder are resolved at runtime (never typed deps of this package),
// so they cross the boundary untyped. biome's noExplicitAny is off for this repo.
type Any = any;

interface LocalDeps {
  chromium: Any;
  AxeBuilder: Any;
}

const PW_SPEC = "@playwright/test";
const AXE_SPEC = "@axe-core/playwright";

/** Why the LOCAL tier is (un)usable from `cwd` — the one line a reader of a
 *  `runtime: auto` log gets before the Docker fallback takes over. A silent degrade is
 *  indistinguishable from a working fallback, so the reason must NAME what to install. */
export type LocalTierStatus = { ok: true } | { ok: false; reason: string };

/** The same probe as `localAvailable`, keeping the reason instead of collapsing it to a
 *  boolean. Drives the `runtime: auto` decision AND the message printed when it degrades
 *  to Docker. */
export function localTierStatus(cwd: string): LocalTierStatus {
  const req = createRequire(resolve(cwd, "package.json"));
  for (const spec of [PW_SPEC, AXE_SPEC]) {
    try {
      req.resolve(spec);
    } catch {
      return { ok: false, reason: `${spec} does not resolve from ${cwd}` };
    }
  }
  try {
    const pw = req(PW_SPEC) as { chromium?: { executablePath?: () => string } };
    const bin = pw.chromium?.executablePath?.();
    // No path at all ⇒ a Playwright that cannot tell us; treat as available and let the
    // launch report its own failure, rather than refusing a tier that might work.
    if (typeof bin === "string" && bin.length > 0 && !existsSync(bin)) {
      return { ok: false, reason: `no browser binary at ${bin} — run \`npx playwright install chromium\`` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `${PW_SPEC} failed to load: ${(e as Error).message.split("\n")[0]}` };
  }
}

/** Is the LOCAL tier actually usable from `cwd`? Drives `runtime: auto`.
 *
 *  Both packages must resolve — and the browser BINARY must be on disk. The second half is not
 *  belt-and-braces: `npm i @playwright/test` installs the package, `npx playwright install`
 *  installs the browsers, and the two are separate steps that CI images routinely do only one
 *  of. Resolution alone therefore says "local is available" on a machine that cannot launch
 *  anything, and `auto` — whose whole contract is to degrade to Docker when the local tier is
 *  not there — instead picks it and dies on the launch.
 *
 *  Measured on this repository the day Playwright became a devDependency: three `--runtime
 *  local` tests and the action's own crawl job switched themselves on in jobs that install no
 *  browser, and failed rather than degrading. `executablePath()` is a pure path computation, so
 *  this stays cheap: no launch, no download, one `stat`. */
export function localAvailable(cwd: string): boolean {
  return localTierStatus(cwd).ok;
}

/** Load Playwright `chromium` + the `AxeBuilder` class from the target project. */
export function resolveLocalDeps(cwd: string): LocalDeps {
  let chromium: Any;
  let AxeBuilder: Any;
  try {
    const req = createRequire(resolve(cwd, "package.json"));
    const pw = req(PW_SPEC);
    const axeMod = req(AXE_SPEC);
    chromium = pw.chromium;
    AxeBuilder = axeMod.default ?? axeMod;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Playwright not resolvable from "${cwd}". Pass --cwd <dir> at a project with @playwright/test + @axe-core/playwright installed (e.g. --cwd packages/app), or use --runtime docker. (${msg})`,
    );
  }
  if (!chromium || typeof AxeBuilder !== "function") {
    throw new Error(
      `Resolved Playwright/@axe-core/playwright from "${cwd}" but they did not expose chromium / AxeBuilder. Check the installed versions, or use --runtime docker.`,
    );
  }
  return { chromium, AxeBuilder };
}

async function launchChromium(chromium: Any): Promise<Any> {
  try {
    return await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Executable doesn'?t exist|playwright install|browserType\.launch/i.test(msg)) {
      throw new Error(
        `Could not launch Chromium for the resolved Playwright. Install it from the --cwd project: \`npx playwright install chromium\`. (${msg})`,
      );
    }
    throw e;
  }
}

// ---- residual-criteria probes (browser-context source, evaluated as strings) ----

// Note: WCAG 2.5.8 Target Size is covered by axe-core's own `target-size` rule (which
// correctly applies the inline + 24px-spacing exceptions), so there is no bespoke probe
// for it — a hand-rolled one was strictly noisier than axe on real DSFR pages.

// ---- stateful probes (local runtime, interactions ON) --------------------------------
// SAFETY CONTRACT (also stated in `scan --no-interact` help): these probes drive the page
// but perform ONLY non-navigating actions — fill text inputs, toggle checkbox/radio, click
// `button[type="button"]`. NEVER a link, NEVER a submit button, NEVER a form submit. Every
// interaction records `location.href` before and aborts + restores if it changed, and every
// loop is bounded, exactly like the read-only probes above. Original state is restored.

// (1) FILL_INPUTS_STEP — set a long representative value on each visible text-like input
// (text/search/email/tel/number/date + textarea), fire `input`, tag whether an ancestor is
// a td/th, and stash the original value so RESTORE_INPUTS_STEP reverts every field. The
// stress probes then measure a page that carries the real typed content the auditor
// confirmed is required to reproduce the reflow/zoom/text-spacing NCs.
const FILL_INPUTS_STEP = `(() => { ${PRELUDE}
  const LONG = 'Établissement Général des Très Longues Valeurs Saisies 0123456789 exemple';
  const textLike = new Set(['text','search','email','tel','number','date']);
  let n = 0;
  for (const e of Array.from(document.querySelectorAll('input, textarea'))) {
    const tag = e.tagName.toLowerCase();
    const type = (e.getAttribute('type') || 'text').toLowerCase();
    const isTextarea = tag === 'textarea';
    if (!isTextarea && !textLike.has(type)) continue;
    if (e.disabled || e.readOnly) continue;
    if (!__vis(e)) continue;
    let val = LONG;
    if (type === 'number') val = '01234567890123456789';
    else if (type === 'date') val = '2026-12-31';
    else if (type === 'email') val = 'utilisateur.au.nom.tres.long@sous-domaine.exemple.fr';
    else if (type === 'tel') val = '+33 6 12 34 56 78 90 12 34';
    // Respect maxlength: a user can never enter more than that, so a short-code field
    // (maxlength=4) must not be judged as if it held a 70-char value (false overflow).
    const ml = parseInt(e.getAttribute('maxlength') || '0', 10);
    if (ml > 0 && val.length > ml && type !== 'date') val = val.slice(0, ml);
    const key = 'fi' + n;
    e.setAttribute('data-u11y-fill', key);
    e.setAttribute('data-u11y-orig', e.value == null ? '' : String(e.value));
    if (e.closest('td, th')) e.setAttribute('data-u11y-cell', '1');
    try { e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    n++;
    if (n >= 60) break;
  }
  return n;
})()`;

const RESTORE_INPUTS_STEP = `(() => {
  for (const e of Array.from(document.querySelectorAll('[data-u11y-fill]'))) {
    const orig = e.getAttribute('data-u11y-orig');
    try { if (orig !== null) { e.value = orig; e.dispatchEvent(new Event('input', { bubbles: true })); } } catch (_) {}
    e.removeAttribute('data-u11y-fill');
    e.removeAttribute('data-u11y-orig');
    e.removeAttribute('data-u11y-cell');
  }
  return true;
})()`;

// (2) INPUT_OVERFLOW — a FILLED input whose typed value has become UNREADABLE under the
// active stress. A single-line <input> never wraps, so a long value always makes
// scrollWidth > clientWidth — that alone is normal (the field scrolls), NOT a failure. The
// real defect the auditor confirmed is a field squeezed so NARROW (a fixed-width or
// table-cell input at 320px / 200% zoom / text-spacing) that only a few characters of the
// typed value are visible. So we require clipping AND an unusably narrow visible box: fewer
// than MIN_VISIBLE_CHARS characters fit at the current font size (font-relative, so the
// 200%-zoom case is caught naturally as the character width doubles), or the box collapsed
// near zero. Calibrated on the fixtures: the clip case shows 3.3 chars, the clean one 22. The SC +
// wording differ per stress; the "input inside a table cell" note is appended for a td/th.
const MIN_VISIBLE_CHARS = 6;
function inputOverflowScan(detail: string, cellSuffix: string): string {
  const d = JSON.stringify(detail);
  const cs = JSON.stringify(cellSuffix);
  return `
    for (const e of Array.from(document.querySelectorAll('[data-u11y-fill]'))) {
      if (!__vis(e)) continue;
      const clientW = e.clientWidth;
      const clipping = e.scrollWidth > clientW + 8;
      if (!clipping) continue;
      const fs = parseFloat(getComputedStyle(e).fontSize) || 16;
      const charW = Math.max(1, fs * 0.5); // ~ average glyph advance
      const charsVisible = clientW / charW;
      if (charsVisible < ${MIN_VISIBLE_CHARS} || clientW <= 24) {
        const inCell = e.getAttribute('data-u11y-cell') === '1';
        hits.push({ selector: __sel(e), html: __html(e), detail: ${d} + (inCell ? ${cs} : '') });
      }
      if (hits.length >= 12) break;
    }`;
}
// Viewport / text-spacing stress: the caller already set the 320px viewport or added the
// text-spacing stylesheet; we just measure the filled inputs.
function inputOverflowExpr(detail: string, cellSuffix: string): string {
  return `(() => { ${PRELUDE} const hits = [];${inputOverflowScan(detail, cellSuffix)} return hits; })()`;
}
// Zoom stress: self-contained — enlarge text to 200%, measure, restore.
function inputOverflowZoomExpr(detail: string, cellSuffix: string): string {
  return `(() => { ${PRELUDE}
  const root = document.documentElement;
  const prev = root.style.fontSize;
  root.style.fontSize = '200%';
  const hits = [];${inputOverflowScan(detail, cellSuffix)}
  root.style.fontSize = prev;
  return hits;
})()`;
}

const CELL_SUFFIX = { fr: " (champ situé dans une cellule de tableau)", en: " (input inside a table cell)" };
const INPUT_OVERFLOW_DETAIL = {
  reflow: {
    fr: "Champ rempli dont la valeur saisie est tronquée/illisible à 320px de large — perte de contenu (1.4.10).",
    en: "Filled input whose typed value is clipped/unreadable at 320px width — loss of content (1.4.10).",
  },
  zoom: {
    fr: "Champ rempli dont la valeur saisie est tronquée/illisible au zoom 200% — perte de contenu (1.4.4).",
    en: "Filled input whose typed value is clipped/unreadable at 200% zoom — loss of content (1.4.4).",
  },
  spacing: {
    fr: "Champ rempli dont la valeur saisie est tronquée/illisible sous l'espacement de texte WCAG — perte de contenu (1.4.12).",
    en: "Filled input whose typed value is clipped/unreadable under the WCAG text-spacing override — loss of content (1.4.12).",
  },
};

// (3) OPEN_DIALOGS_STEP — best effort: open the first 3 closed <dialog> (showModal, else
// the `open` attribute) and reveal currently-hidden [role=dialog]/[role=alertdialog]
// wrappers, tagging each so the focus pass can be re-run scoped to it. Original state is
// captured for CLOSE_DIALOGS_STEP. No navigation is possible from opening a dialog.
const OPEN_DIALOGS_STEP = `(() => { ${PRELUDE}
  const out = [];
  let n = 0;
  for (const d of Array.from(document.querySelectorAll('dialog:not([open])'))) {
    if (n >= 3) break;
    let opened = false;
    try { if (typeof d.showModal === 'function') { d.showModal(); opened = d.open === true; } } catch (_) {}
    if (!opened) { try { d.setAttribute('open', ''); opened = true; } catch (_) {} }
    if (!opened) continue;
    const key = 'dl' + n;
    d.setAttribute('data-u11y-dialog', key);
    out.push(key);
    n++;
  }
  for (const d of Array.from(document.querySelectorAll('[role=dialog],[role=alertdialog]'))) {
    if (n >= 3) break;
    if (__vis(d)) continue; // already open — its focusables were covered by the main pass
    const prevStyle = d.getAttribute('style') || '';
    const hadHidden = d.hasAttribute('hidden');
    d.removeAttribute('hidden');
    if (d.style.display === 'none') d.style.display = 'block';
    d.style.visibility = 'visible';
    d.style.opacity = '1';
    if (!__vis(d)) { if (hadHidden) d.setAttribute('hidden', ''); d.setAttribute('style', prevStyle); continue; }
    const key = 'dl' + n;
    d.setAttribute('data-u11y-dialog', key);
    d.setAttribute('data-u11y-dlg-style', prevStyle);
    if (hadHidden) d.setAttribute('data-u11y-dlg-hidden', '1');
    out.push(key);
    n++;
  }
  return out;
})()`;

const CLOSE_DIALOGS_STEP = `(() => {
  for (const d of Array.from(document.querySelectorAll('[data-u11y-dialog]'))) {
    if (d.tagName.toLowerCase() === 'dialog') {
      try { if (typeof d.close === 'function' && d.open) d.close(); } catch (_) {}
      d.removeAttribute('open');
    } else {
      const prev = d.getAttribute('data-u11y-dlg-style');
      if (prev) d.setAttribute('style', prev); else d.removeAttribute('style');
      if (d.getAttribute('data-u11y-dlg-hidden') === '1') d.setAttribute('hidden', '');
    }
    d.removeAttribute('data-u11y-dialog');
    d.removeAttribute('data-u11y-dlg-style');
    d.removeAttribute('data-u11y-dlg-hidden');
  }
  return true;
})()`;

async function probeDialogs(page: Any): Promise<ProbeHit[]> {
  const keys = (await page.evaluate(OPEN_DIALOGS_STEP).catch(() => [])) as string[];
  if (!Array.isArray(keys) || keys.length === 0) return [];
  const hits: ProbeHit[] = [];
  for (const key of keys) {
    const scoped = await probeFocusVisible(page, `[data-u11y-dialog="${key}"]`).catch(() => [] as ProbeHit[]);
    hits.push(...scoped);
    if (hits.length >= 12) break;
  }
  await page.evaluate(CLOSE_DIALOGS_STEP).catch(() => {});
  return hits.slice(0, 12);
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
const DESTRUCTIVE_NAME_RE = "\\b(supprim|retir|effac|envoy|valid|confirm|pay|achet|command|delete|remove|eras|clear|send|submit|buy|order)";
function liveRegionExpr(detail: string, allowClicks: boolean): string {
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
    if (count >= 20 || hits.length >= 10) break;
    if (b.disabled || !__vis(b)) continue;
    if (dangerous.test(nameOf(b))) continue; // defense-in-depth: never click a destructive-named button
    const before = location.href;
    try { b.click(); } catch (_) {}
    await settle();
    if (location.href !== before) { obs.disconnect(); return hits; }
    drain();
    count++;
  }`
    : `
  // click interactions disabled (authenticated scan without --interact-clicks)`;
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
  let count = 0;${clickLoop}
  // toggle checkbox/radio, then restore
  for (const t of Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]'))) {
    if (count >= 40 || hits.length >= 10) break;
    if (t.disabled || !__vis(t)) continue;
    const before = location.href;
    const prev = t.checked;
    try { t.click(); } catch (_) {}
    await settle();
    if (location.href !== before) { obs.disconnect(); return hits; }
    drain();
    try { if (t.checked !== prev) { t.checked = prev; t.dispatchEvent(new Event('change', { bubbles: true })); } } catch (_) {}
    count++;
  }
  // fill text inputs, then restore
  for (const inp of Array.from(document.querySelectorAll('input[type="text"], input[type="email"], input[type="search"], textarea'))) {
    if (count >= 60 || hits.length >= 10) break;
    if (inp.disabled || inp.readOnly || !__vis(inp)) continue;
    const before = location.href;
    const prev = inp.value == null ? '' : String(inp.value);
    try { inp.value = 'test 123'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) {}
    await settle();
    if (location.href !== before) { obs.disconnect(); return hits; }
    drain();
    try { inp.value = prev; inp.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    count++;
  }
  obs.disconnect();
  return hits.slice(0, 10);
})()`;
}
const LIVE_REGION_DETAIL = {
  fr: "Mise à jour de contenu déclenchée par une interaction hors d'une région live (aria-live / role=status|alert|log) — probablement non restituée aux technologies d'assistance (4.1.3).",
  en: "Content update triggered by an interaction outside any live region (aria-live / role=status|alert|log) — likely not announced to assistive technology (4.1.3).",
};

/** Should the live-region probe CLICK buttons? Never by default on an authenticated scan
 *  (a storageState session is loaded — a click could trigger a server mutation the
 *  location.href assertion cannot see); `scan --interact-clicks` re-enables explicitly.
 *  Unauthenticated scans keep clicks on. Exported for the browser-free policy test. */
export function clicksAllowed(storageState: string | undefined, interactClicks: boolean | undefined): boolean {
  return interactClicks === true || !storageState;
}

/** Did the browser end up on the page we ASKED for?
 *
 *  A sample page's declared id/name is the identity the report and the per-page grid speak,
 *  and it is applied to whatever the browser had on screen. So a route that redirects — an
 *  expired session bouncing to /login, a wizard step the application state does not open —
 *  gets recorded under the requested page's name while showing another screen entirely.
 *  Nothing about the resulting document looks wrong, which is what makes it the worst
 *  failure mode an accessibility report has: a reader sees a page sheet, a screenshot and a
 *  conformance rate, and none of it describes the page named at the top.
 *
 *  What counts as "the same page" is decided per component, because which component carries
 *  the route is the app's choice, not ours:
 *
 *  - **path** always, trailing slash folded (`/aide/` ≡ `/aide`).
 *  - **fragment** only when the REQUEST had one. That is the hash-router case, where the
 *    fragment IS the route: asking for `#/admin` and landing on `#/login` is precisely the
 *    bounce this guard exists to catch, and comparing paths alone (both empty) would miss it.
 *    When the request carried no fragment, one the app appended to its own route is noise.
 *  - **query** on the same rule, for `?page=admin` style routing.
 *  - **host** always, since a same-path bounce to an IdP or a maintenance host is exactly the
 *    misattribution above. Only the scheme, the port and a `www.` prefix may differ — those
 *    are canonicalisation, not another page.
 *
 *  `requested` must be the RESOLVED navigation target, not the raw config value: a relative
 *  `dist/index.html` becomes `file:///abs/dist/index.html` before `goto`, and comparing the
 *  two forms would drop every relative file target. Anything unparseable is treated as a
 *  match — this guard catches a redirect, it does not invent one. Exported for the
 *  browser-free policy test. */
export function landedOnRequestedPage(requested: string, landed: string): boolean {
  if (!landed || requested === landed) return true;
  const parse = (u: string): URL | undefined => {
    try {
      return new URL(u, "http://x.invalid");
    } catch {
      return undefined;
    }
  };
  const a = parse(requested);
  const b = parse(landed);
  if (!a || !b) return true;

  const path = (u: URL): string => u.pathname.replace(/\/+$/, "");
  if (path(a) !== path(b)) return false;

  // `www.` is canonicalisation; a different host is a different site.
  const host = (u: URL): string => u.hostname.replace(/^www\./, "");
  if (host(a) !== host(b)) return false;

  // Only compared when the REQUEST carried one — see the doc block.
  if (a.hash && a.hash !== b.hash) return false;
  if (a.search && a.search !== b.search) return false;
  return true;
}

async function probeLiveRegion(page: Any, lang: Lang, allowClicks: boolean): Promise<ProbeHit[]> {
  const detail = LIVE_REGION_DETAIL[lang] ?? LIVE_REGION_DETAIL.en;
  return (await page.evaluate(liveRegionExpr(detail, allowClicks)).catch(() => [])) as ProbeHit[];
}

// ---- CI probe-string guard ------------------------------------------------------------
/** EVERY string-evaluated browser expression this runtime ships — the constants plus the
 *  parameterized builders instantiated with representative arguments. Exported ONLY for
 *  the browser-free CI smoke test (tests/probe-syntax.test.ts), which syntax-validates
 *  each via `new Function` (compiled, never called) — a probe-string typo fails CI
 *  instead of exploding (and being swallowed by a `.catch`) at scan time.
 *  Add every NEW probe/step/builder here when extending the runtime. */
export function probeSources(): Record<string, string> {
  return {
    PRELUDE: `(() => { ${PRELUDE} return true; })()`,
    REFLOW_PROBE,
    REFLOW_ZOOM_PROBE,
    TEXT_SPACING_PROBE,
    "focusSetupExpr(document)": focusSetupExpr(),
    "focusSetupExpr(scoped)": focusSetupExpr('[data-u11y-dialog="dl0"]'),
    FOCUS_CHECK_PROBE,
    HOVER_SETUP_PROBE,
    REMOVE_TEXT_SPACING_STEP,
    "hoverVisibleExpr(shown)": hoverVisibleExpr("tip-1"),
    "hoverVisibleExpr(hidden)": hoverVisibleExpr("tip-1", true),
    FILL_INPUTS_STEP,
    RESTORE_INPUTS_STEP,
    "inputOverflowExpr(reflow,en)": inputOverflowExpr(INPUT_OVERFLOW_DETAIL.reflow.en, CELL_SUFFIX.en),
    "inputOverflowExpr(spacing,fr)": inputOverflowExpr(INPUT_OVERFLOW_DETAIL.spacing.fr, CELL_SUFFIX.fr),
    "inputOverflowZoomExpr(zoom,en)": inputOverflowZoomExpr(INPUT_OVERFLOW_DETAIL.zoom.en, CELL_SUFFIX.en),
    OPEN_DIALOGS_STEP,
    CLOSE_DIALOGS_STEP,
    "liveRegionExpr(clicks)": liveRegionExpr(LIVE_REGION_DETAIL.en, true),
    "liveRegionExpr(noClicks)": liveRegionExpr(LIVE_REGION_DETAIL.fr, false),
    // Page-snapshot collector (src/snapshot.ts) — evaluated in the browser by every snapshot
    // producer (E2E fixtures, the dev sidecar), so it is syntax-gated here like the probes.
    COLLECT_SNAPSHOT,
  };
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** Drive one page through axe-core + every probe, returning a RunnerOutput. */
async function runOnPage(
  browser: Any,
  AxeBuilder: Any,
  target: string,
  isFile: boolean,
  opts: { storageState?: string; interact: boolean; allowClicks: boolean; lang: Lang; snapshot?: boolean },
): Promise<RunnerOutput> {
  const context = await browser.newContext(opts.storageState ? { storageState: opts.storageState } : {});
  const page = await context.newPage();
  const empty: ProbeHit[] = [];
  try {
    const url = isFile ? "file://" + resolve(target) : target;
    const response = await page.goto(url, { waitUntil: "load", timeout: 45000 });
    // Let the client hydrate and any framework JS inject content/landmarks (SPA routes,
    // DSFR JS) before measuring — otherwise axe/probes see the pre-hydration DOM and
    // report false "no h1 / not in a landmark". Bounded networkidle + a short settle.
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // The identity of what is ABOUT to be measured, captured here and nowhere later. The
    // probes below click buttons, and a click that routes (history.pushState) leaves
    // `page.url()` on another route — read at the end, it would accuse the server of a
    // redirect that never happened and throw away a page audited at the right address.
    // `file://` is normalised through the same resolve() the navigation used, so a relative
    // target compares against its own resolved form rather than against a bare path.
    const landedUrl = (page.url() as string) || url;
    // A framework can answer 404/500 with a full, valid document AT THE SAME URL —
    // Next's `notFound()` is exactly that. The path guard cannot see it, and recording it
    // would file an error page under a real page's name. `status()` is the only signal that
    // separates them. `file://` navigations report no status; absent is not a failure.
    const httpStatus: number | undefined = typeof response?.status === "function" ? (response.status() as number) : undefined;

    // THE SNAPSHOT IS COLLECTED FIRST, on the PRISTINE page — before axe injects its source,
    // before any probe fills an input, resizes the viewport or bolts on the text-spacing
    // stylesheet. A snapshot is meant to be "the page as the browser built it"; collected
    // later it would carry a 320px layout, letter-spacing overrides in css.json, and values
    // typed by the fill step, and the offline rendered tier would then measure OUR
    // instrumentation instead of the site. The screenshot is taken at the same instant and at
    // the same (normal) viewport, so it shares the coordinate system of boxes.json.
    let snapshot: CollectedPage | undefined;
    let screenshot: string | undefined;
    if (opts.snapshot !== false) {
      try {
        snapshot = (await page.evaluate(COLLECT_SNAPSHOT)) as CollectedPage;
      } catch {
        // A collection failure must never cost us the findings: the page stays scannable,
        // it simply earns no snapshot — and therefore no conforming-by-silence verdict.
      }
      if (snapshot) {
        try {
          screenshot = ((await page.screenshot({ fullPage: false })) as Buffer).toString("base64");
        } catch {
          /* pixel tier only — every other rendered rule still reads the digests */
        }
      }
    }

    const axeRes = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    const violations = (axeRes.violations as Any[]).map((v: Any) => ({
      id: v.id as string,
      impact: (v.impact ?? null) as string | null,
      help: v.help as string,
      tags: v.tags as string[],
      nodes: (v.nodes as Any[]).slice(0, 10).map((n: Any) => ({ target: (n.target as unknown[]).map(String), html: ((n.html as string) || "").slice(0, 200) })),
    }));
    // clean-DOM probes first (normal viewport), then — with inputs FILLED when interactions
    // are on — viewport/zoom, then the text-spacing override. Each probe is guarded: a single
    // probe failing degrades to no findings for that criterion rather than zeroing the whole
    // page (axe results are already captured). The stateful interaction probes (dialogs,
    // live-region) run LAST so their DOM side effects can never leak into the stress
    // measurements; `--no-interact` (opts.interact === false) skips fill/dialogs/live-region
    // entirely — the exact pre-stateful behaviour.
    const focusVisible = await probeFocusVisible(page).catch(() => empty);
    const hover = await probeHover(page).catch(() => empty);
    const l = opts.lang;
    if (opts.interact) await page.evaluate(FILL_INPUTS_STEP).catch(() => {});
    const reflowZoom = (await page.evaluate(REFLOW_ZOOM_PROBE).catch(() => [])) as ProbeHit[];
    const inputOverflowZoom = opts.interact
      ? ((await page.evaluate(inputOverflowZoomExpr(INPUT_OVERFLOW_DETAIL.zoom[l], CELL_SUFFIX[l])).catch(() => [])) as ProbeHit[])
      : [];
    await page.setViewportSize({ width: 320, height: 800 }).catch(() => {});
    const reflow = (await page.evaluate(REFLOW_PROBE).catch(() => ({ horizontalScroll: false }))) as { horizontalScroll: boolean };
    const inputOverflowReflow = opts.interact
      ? ((await page.evaluate(inputOverflowExpr(INPUT_OVERFLOW_DETAIL.reflow[l], CELL_SUFFIX[l])).catch(() => [])) as ProbeHit[])
      : [];
    await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await page.addStyleTag({ content: TEXT_SPACING_CSS }).catch(() => {});
    const textSpacing = (await page.evaluate(TEXT_SPACING_PROBE).catch(() => [])) as ProbeHit[];
    const inputOverflowSpacing = opts.interact
      ? ((await page.evaluate(inputOverflowExpr(INPUT_OVERFLOW_DETAIL.spacing[l], CELL_SUFFIX[l])).catch(() => [])) as ProbeHit[])
      : [];
    if (opts.interact) await page.evaluate(RESTORE_INPUTS_STEP).catch(() => {});
    // Stateful interaction probes last, and LIVE-REGION IS THE TERMINAL PROBE: unlike the
    // fill/toggle interactions (restored) its button-click DOM mutations are NOT restored
    // (a page's own click handler can change anything), so reordering it before any
    // measurement probe would leak that state into the measurements. Dialog focus issues
    // fold into the same 2.4.7 focus-visible bucket.
    const dialogFocus = opts.interact ? await probeDialogs(page).catch(() => empty) : [];
    const liveRegion = opts.interact ? await probeLiveRegion(page, l, opts.allowClicks).catch(() => empty) : [];
    return {
      url: (page.url() as string) || target,
      landedUrl,
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      violations,
      reflow,
      focusVisible: dialogFocus.length ? [...focusVisible, ...dialogFocus] : focusVisible,
      hover,
      reflowZoom,
      textSpacing,
      inputOverflowReflow,
      inputOverflowZoom,
      inputOverflowSpacing,
      liveRegion,
      ...(snapshot ? { snapshot: { ...snapshot, ...(screenshot ? { screenshot } : {}) } } : {}),
    };
  } finally {
    await context.close();
  }
}

export interface LocalScanOpts {
  target: string;
  cwd: string;
  storageState?: string;
  lang?: Lang;
  // Stateful probes (fill inputs → input-overflow, open dialogs, live-region) ON by default;
  // `scan --no-interact` sets this false to fall back to the pristine-page probes only.
  interact?: boolean;
  // Allow the live-region probe to CLICK button[type=button] on an AUTHENTICATED scan
  // (storageState in use). Off by default there — a click can trigger a server mutation
  // invisible to the href assertion; `scan --interact-clicks` opts in. Ignored (clicks
  // always on) when no storageState is loaded. See clicksAllowed().
  interactClicks?: boolean;
  /** Repo root under which to persist `.ultra11y/pages/<id>/`. Unset ⇒ no snapshot. */
  snapshotRoot?: string;
}

/** Run the dynamic tier locally over a single URL/file (no Docker). */
export async function runScanLocal(opts: LocalScanOpts): Promise<DynamicResult> {
  const isUrl = /^https?:\/\//i.test(opts.target);
  if (!isUrl && !existsSync(opts.target)) {
    throw new Error(`File not found: ${opts.target}. Pass an http(s):// URL or an existing HTML file.`);
  }
  const isFile = !isUrl && statSync(opts.target).isFile();
  const lang = opts.lang ?? "en";
  const interact = opts.interact !== false;
  const { chromium, AxeBuilder } = resolveLocalDeps(opts.cwd);
  const browser = await launchChromium(chromium);
  try {
    const out = await runOnPage(browser, AxeBuilder, opts.target, isFile, {
      storageState: opts.storageState,
      interact,
      allowClicks: clicksAllowed(opts.storageState, opts.interactClicks),
      lang,
      snapshot: Boolean(opts.snapshotRoot),
    });
    const id = opts.snapshotRoot ? writeRunnerSnapshot(opts.snapshotRoot, out, opts.target) : undefined;
    return { ...toDynamicResult(out, opts.target, lang, LOCAL_ENGINE), testedScs: localTestedScs(interact), ...(id ? { snapshots: [id] } : {}) };
  } finally {
    await browser.close();
  }
}

export interface LocalManyOpts {
  cwd: string;
  storageState?: string;
  lang?: Lang;
  interact?: boolean;
  interactClicks?: boolean; // see LocalScanOpts.interactClicks
  /** Repo root under which to persist `.ultra11y/pages/<id>/`. Unset ⇒ no snapshot. */
  snapshotRoot?: string;
}

/** Run the local dynamic tier over many URLs (one browser, one context per page). */
export async function runScanManyLocal(urls: string[], opts: LocalManyOpts): Promise<DynamicResult> {
  const lang = opts.lang ?? "en";
  const interact = opts.interact !== false;
  const { chromium, AxeBuilder } = resolveLocalDeps(opts.cwd);
  const browser = await launchChromium(chromium);
  const findings: DynamicFinding[] = [];
  const snapshots: string[] = [];
  try {
    for (const url of urls) {
      const out = await runOnPage(browser, AxeBuilder, url, false, {
        storageState: opts.storageState,
        interact,
        allowClicks: clicksAllowed(opts.storageState, opts.interactClicks),
        lang,
        snapshot: Boolean(opts.snapshotRoot),
      });
      findings.push(...toDynamicResult(out, url, lang, LOCAL_ENGINE).findings);
      const id = opts.snapshotRoot ? writeRunnerSnapshot(opts.snapshotRoot, out, url) : undefined;
      if (id) snapshots.push(id);
    }
  } finally {
    await browser.close();
  }
  return {
    tool: "ultra11y",
    engine: LOCAL_ENGINE,
    target: `${urls.length} page(s)`,
    date: today(),
    findings,
    testedScs: localTestedScs(interact),
    ...(snapshots.length ? { snapshots } : {}),
  };
}

/** Run the local dynamic tier over a NORMATIVE page SAMPLE (one browser, one context per
 *  page). Each page's own `storageState` OVERRIDES the run-wide one, so a mixed sample
 *  (some pages public, some authenticated) is scanned with the right session per page; the
 *  clicks-off policy (clicksAllowed) is re-evaluated per page from its effective
 *  storageState. Findings keep their sample-page provenance; the sample is recorded on the
 *  result. SECURITY: storageState is only ever passed to Playwright as a path — never read. */
export async function runSampleScanLocal(pages: SamplePage[], opts: LocalManyOpts): Promise<DynamicResult> {
  const lang = opts.lang ?? "en";
  const interact = opts.interact !== false;
  const { chromium, AxeBuilder } = resolveLocalDeps(opts.cwd);
  const browser = await launchChromium(chromium);
  const findings: DynamicFinding[] = [];
  const snapshots: string[] = [];
  const redirected: ScanRedirect[] = [];
  try {
    for (const page of pages) {
      const storageState = page.storageState ?? opts.storageState; // per-page override
      const isFile = !/^https?:\/\//i.test(page.url);
      const out = await runOnPage(browser, AxeBuilder, page.url, isFile, {
        storageState,
        interact,
        allowClicks: clicksAllowed(storageState, opts.interactClicks),
        lang,
        snapshot: Boolean(opts.snapshotRoot),
      });
      // The declared identity is applied to whatever the browser had on screen, so a page
      // that bounced elsewhere — or answered an error at the same address — would be filed
      // under the name of the page nobody looked at. Drop it instead, and say which one and
      // why: a page reported missing is a bug in the sample or the seeded state, and both
      // are fixable. A page reported under the wrong name is neither — it is a false
      // conformance claim.
      //
      // Compared against the RESOLVED target and the URL captured before the probes ran
      // (`landedUrl`), never `out.url`: that one is read at the end of the run, so a probe
      // click that routed would look exactly like a server redirect.
      const requestedUrl = isFile ? "file://" + resolve(page.url) : page.url;
      const landedUrl = out.landedUrl ?? out.url;
      if (!landedOnRequestedPage(requestedUrl, landedUrl)) {
        redirected.push({ id: page.id, name: page.name, requested: page.url, landed: landedUrl, reason: "redirect" });
        continue;
      }
      if (out.httpStatus !== undefined && out.httpStatus >= 400) {
        redirected.push({ id: page.id, name: page.name, requested: page.url, landed: landedUrl, reason: "http-status", status: out.httpStatus });
        continue;
      }
      findings.push(...tagSampleFindings(toDynamicResult(out, page.url, lang, LOCAL_ENGINE).findings, page));
      // The sample page's declared id/name/auth/notes win over anything derived from the
      // URL: that identity is what the report and the per-page grid speak.
      const id = opts.snapshotRoot ? writeRunnerSnapshot(opts.snapshotRoot, out, page.url, page) : undefined;
      if (id) snapshots.push(id);
    }
  } finally {
    await browser.close();
  }
  // The sample RECORDED is the sample actually scanned. Keeping a dropped page here would be
  // worse than losing it: `pagesOf` re-adds every declared page to the grid with
  // `basis: "attributed"` — the same basis as a page that was really visited — so the
  // deliverable would positively claim we looked at a page we refused to record. The pages
  // that were dropped travel in `redirected`, which says so out loud.
  const dropped = new Set(redirected.map((r) => r.id));
  const scanned = pages.filter((p) => !dropped.has(p.id));
  return {
    tool: "ultra11y",
    engine: LOCAL_ENGINE,
    target: `${scanned.length}/${pages.length} page(s) (échantillon)`,
    date: today(),
    findings,
    sample: sampleScope({ pages: scanned }),
    testedScs: localTestedScs(interact),
    ...(snapshots.length ? { snapshots } : {}),
    ...(redirected.length ? { redirected } : {}),
  };
}

/** Discover URLs (sitemap/crawl) then scan them all through the local dynamic tier. */
export async function runCrawlScanLocal(opts: DiscoverOpts & LocalManyOpts): Promise<DynamicResult> {
  const urls = await discoverUrls(opts);
  if (urls.length === 0) {
    throw new Error("No URL to scan (empty/unreachable sitemap, or entry page with no same-origin link).");
  }
  return runScanManyLocal(urls, opts);
}
