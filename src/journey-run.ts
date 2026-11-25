// `journey run` — replay the journeys the agent wrote (src/journey.ts) in a real browser.
//
// The same instruments as `scan`, on states `scan` can never reach: the local Playwright and
// its Chromium (src/scan-local.ts), ultra11y's pinned axe-core (src/axe-engine.ts) and the live
// probes (src/probes.ts `runLiveProbes`, which measure and put everything back), run after
// every step on the page the journey built, and recorded as a page-state snapshot in
// `.ultra11y/pages/<journey>-<nn>-<slug>/` — the format every other producer writes.
//
// On top of them, what only a journey can observe, because it needs an action and a before and
// an after:
//   - the focus order Tab walks through to reach each control (keyboard mode);
//   - a control Tab never reaches (2.1.1), and a region Tab and Shift+Tab cannot leave (2.1.2);
//   - focus after a dialog opens (it must move inside) and after it closes (it must return
//     to the element that opened it) (2.4.3);
//   - an error shown after an action and tied to no field (3.3.1);
//   - text that appears outside any live region after an action (4.1.3).
//
// HONESTY: a step that fails — its locator matched nothing, the navigation threw or landed
// elsewhere, a timeout — stops its journey, with the reason, and every later step is recorded
// `not-run`. A control the keyboard cannot reach is a FINDING, not a failure: the step is then
// performed with the pointer so the rest of the journey is still measured, and the record says so.
//
// Browser-context code is passed to page.evaluate as STRINGS, as in src/scan-local.ts: the
// engine's tsconfig ships no DOM lib.
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { type AxeEngine, runAxe } from "./axe-engine.js";
import { type Journey, type JourneyStep, type JourneyTarget, notRunRecord, stepPageId, targetLabel } from "./journey.js";
import { resolveMessage } from "./messages.js";
import { TIMER_HOOK, startBehaviour } from "./behaviour.js";
import { PRELUDE, runLiveProbes } from "./probes.js";
import { type ProbeHit, type RunnerOutput, toDynamicResult, writeRunnerSnapshot } from "./scan.js";
import { landedOnRequestedPage, launchChromium, resolveLocalDeps } from "./scan-local.js";
import { captureAxTree } from "./screen-reader.js";
import { probeMedia } from "./media.js";
import { COLLECT_SNAPSHOT, type CollectedPage, FULL_SCREENSHOT_MAX_HEIGHT, PAGES_DIR, waitForLoaded } from "./snapshot.js";
import type { AxeEngineInfo, DynamicFinding, JourneyRecord, JourneyStepRecord, Lang } from "./types.js";

export const JOURNEY_ENGINE = "axe-core@playwright (journey)";

// Playwright is resolved at runtime and crosses the boundary untyped (see src/scan-local.ts).
type Any = any;

const DEFAULT_TIMEOUT = 5000;
/** Most Tab presses spent reaching one control. A page with more focusables than this is not
 *  proven unreachable when the bound runs out — the step says the bound was reached instead. */
const MAX_TABS = 250;
/** Consecutive presses that leave focus on the same element before it counts as stuck. */
const STUCK_AFTER = 3;
const MAX_FOCUS_LABELS = 40;

/** The in-page half: identity of elements across calls, labels, and the before/after
 *  observation of an action. Installed once per document; a full navigation drops it, which
 *  is how the Node side knows a step navigated. */
const JOURNEY_LIB = `(() => { ${PRELUDE}
  if (window.__u11yJ) return true;
  const ids = new WeakMap(); const byKey = new Map(); let next = 1;
  const key = (e) => { if (!e || e.nodeType !== 1) return 0; let k = ids.get(e); if (!k) { k = next++; ids.set(e, k); byKey.set(k, e); } return k; };
  const deep = () => { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; };
  const isBody = (a) => !a || a === document.body || a === document.documentElement;
  const squash = (t) => String(t || '').replace(/\\s+/g, ' ').trim();
  const nameOf = (e) => {
    const al = e.getAttribute('aria-label'); if (al && al.trim()) return squash(al);
    const lb = e.getAttribute('aria-labelledby');
    if (lb) { const t = lb.split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' '); if (squash(t)) return squash(t); }
    if (e.labels && e.labels.length) return squash(Array.from(e.labels).map((l) => l.textContent).join(' '));
    const t = squash(e.innerText || e.textContent); if (t) return t.slice(0, 60);
    return squash(e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('alt') || '');
  };
  const roleOf = (e) => {
    const r = e.getAttribute('role'); if (r) return r.split(/\\s+/)[0];
    const t = e.tagName.toLowerCase();
    if (t === 'a' && e.hasAttribute('href')) return 'link';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (t === 'input') { const ty = (e.getAttribute('type') || 'text').toLowerCase(); return ty === 'checkbox' ? 'checkbox' : ty === 'radio' ? 'radio' : (ty === 'submit' || ty === 'button' || ty === 'reset' || ty === 'image') ? 'button' : ty === 'range' ? 'slider' : 'textbox'; }
    return t;
  };
  const label = (e) => { if (isBody(e)) return '<body>'; const n = nameOf(e); return roleOf(e) + (n ? ' "' + n.slice(0, 60) + '"' : ''); };
  const FOCUSABLE = 'a[href],area[href],button,input:not([type=hidden]),select,textarea,summary,iframe,[contenteditable=""],[contenteditable="true"],[tabindex]';
  const tabbable = (e) => !e.disabled && !e.closest('[inert]') && e.tabIndex >= 0 && __vis(e);
  const modalOf = (e) => {
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      if (n.tagName === 'DIALOG' && n.open) { try { if (n.matches(':modal')) return n; } catch (_) {} }
      const r = n.getAttribute('role');
      if ((r === 'dialog' || r === 'alertdialog') && n.getAttribute('aria-modal') === 'true') return n;
    }
    return null;
  };
  const openDialogs = () => Array.from(document.querySelectorAll('dialog, [role=dialog], [role=alertdialog]')).filter((d) => (d.tagName !== 'DIALOG' || d.open) && __vis(d));
  const ERR = '[role=alert],[class*="error" i],[class*="erreur" i],[class*="invalid" i],[id*="error" i],[id*="erreur" i]';
  const errorCandidates = () => Array.from(document.querySelectorAll(ERR)).filter((e) => {
    if (/^(input|select|textarea|button|form|fieldset|label|option|body|html)$/i.test(e.tagName)) return false;
    if (e.querySelector('input,select,textarea,button')) return false;
    const t = squash(e.innerText || e.textContent);
    return t.length > 0 && t.length <= 300 && __vis(e);
  });
  const isLive = (n) => {
    for (let el = n && n.nodeType === 1 ? n : (n ? n.parentElement : null); el && el !== document.documentElement; el = el.parentElement) {
      const live = el.getAttribute('aria-live') || ''; const role = el.getAttribute('role') || '';
      if (live === 'polite' || live === 'assertive' || role === 'status' || role === 'alert' || role === 'log' || el.tagName === 'OUTPUT') return true;
    }
    return false;
  };
  const referenced = () => {
    const s = new Set();
    for (const el of Array.from(document.querySelectorAll('[aria-describedby],[aria-errormessage]')))
      for (const a of ['aria-describedby', 'aria-errormessage']) for (const id of (el.getAttribute(a) || '').split(/\\s+/)) if (id) s.add(id);
    return s;
  };
  const associated = (e, ids) => {
    for (let n = e; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) { if (n.id && ids.has(n.id)) return true; if (n.tagName === 'LABEL') return true; }
    for (const d of Array.from(e.querySelectorAll('[id]'))) if (ids.has(d.id)) return true;
    return false;
  };
  const fieldNear = (e) => {
    for (let n = e.parentElement, i = 0; n && i < 3 && n !== document.body; n = n.parentElement, i++) {
      const f = n.querySelector('input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea'); if (f) return f;
    }
    return document.querySelector('[aria-invalid="true"]');
  };
  const S = { trigger: null, dialogs: new Set(), errors: new Set(), records: [], obs: null, stack: [], saved: null };
  window.__u11yJ = {
    active() {
      const a = deep(); const body = isBody(a);
      const t = document.querySelector('[data-u11y-jt]');
      return { key: body ? 0 : key(a), label: label(a), body: body, frame: !!(a && a.tagName === 'IFRAME'),
        role: body ? '' : roleOf(a), onTarget: !!(t && a && !body && (t === a || t.contains(a) || a.contains(t))), modal: !!(a && !body && modalOf(a)) };
    },
    tabbables() { return Array.from(document.querySelectorAll(FOCUSABLE)).filter(tabbable).length; },
    region(keys) {
      const els = keys.map((k) => byKey.get(k)).filter((e) => e && e.isConnected);
      if (!els.length) return null;
      let anc = els[0];
      while (anc && !els.every((e) => anc.contains(e))) anc = anc.parentElement;
      if (!anc || anc === document.body || anc === document.documentElement) anc = els[0];
      return { selector: __sel(anc), html: __html(anc), label: els.length === 1 ? label(els[0]) : __sel(anc) };
    },
    save() { S.saved = deep(); return true; },
    restore() {
      const a = S.saved; S.saved = null;
      try {
        if (a && !isBody(a) && a.isConnected) a.focus({ preventScroll: true });
        else {
          // blur() alone leaves the browser's sequential-navigation starting point where the
          // probe walk ended, so the next Tab would resume from there: focus the body itself.
          const had = document.body.hasAttribute('tabindex');
          if (!had) document.body.setAttribute('tabindex', '-1');
          document.body.focus({ preventScroll: true });
          if (!had) document.body.removeAttribute('tabindex');
        }
      } catch (_) {}
      return true;
    },
    before() {
      const t = document.querySelector('[data-u11y-jt]'); const a = deep();
      S.trigger = t || (isBody(a) ? null : a);
      S.dialogs = new Set(openDialogs());
      S.errors = new Set(errorCandidates());
      S.records = [];
      if (S.obs) S.obs.disconnect();
      S.obs = new MutationObserver((m) => { for (const r of m) S.records.push(r); });
      S.obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      return true;
    },
    after() {
      const out = { dialogIn: [], dialogReturn: [], errors: [], status: [] };
      if (S.obs) { S.obs.disconnect(); S.obs = null; }
      const recs = S.records.splice(0);
      const a = deep();
      const now = openDialogs();
      for (const d of now.filter((x) => !S.dialogs.has(x)).slice(0, 3)) {
        S.stack.push({ dialog: d, trigger: S.trigger });
        if (!(a && d.contains(a))) out.dialogIn.push({ selector: __sel(d), html: __html(d), dialog: label(d), focus: label(a) });
      }
      for (const d of Array.from(S.dialogs).filter((x) => !now.includes(x))) {
        const i = S.stack.findIndex((x) => x.dialog === d);
        if (i < 0) continue;
        const tr = S.stack[i].trigger; S.stack.splice(i, 1);
        if (!tr || !tr.isConnected || !__vis(tr)) continue;
        if (a === tr || (a && !isBody(a) && (tr.contains(a) || a.contains(tr)))) continue;
        out.dialogReturn.push({ selector: __sel(tr), html: __html(tr), dialog: label(d), trigger: label(tr), focus: label(a) });
      }
      const ids = referenced();
      const errsNow = errorCandidates();
      const fresh = errsNow.filter((e) => !S.errors.has(e) && !errsNow.some((o) => o !== e && e.contains(o)));
      for (const e of fresh.slice(0, 10)) {
        if (associated(e, ids) || isLive(e)) continue;
        const f = fieldNear(e);
        out.errors.push({ selector: __sel(e), html: __html(e), text: squash(e.innerText || e.textContent).slice(0, 80), field: f ? label(f) : '' });
      }
      const target = document.querySelector('[data-u11y-jt]');
      const ctlId = S.trigger && S.trigger.getAttribute && S.trigger.getAttribute('aria-controls');
      const controlled = ctlId ? document.getElementById(ctlId) : null;
      const seen = new Set();
      for (const r of recs) {
        if (out.status.length >= 5) break;
        const nodes = r.type === 'characterData' ? [r.target] : Array.from(r.addedNodes);
        for (const n of nodes) {
          const host = n.nodeType === 1 ? n : n.parentElement;
          if (!host || !host.isConnected) continue;
          const t = squash(host.innerText || host.textContent);
          if (!t || t.length > 200) continue;
          if (isLive(host) || !__vis(host)) continue;
          if (host.querySelector('a[href],button,input,select,textarea,h1,h2,h3,h4,h5,h6,[tabindex]')) continue;
          if (now.some((d) => d.contains(host))) continue;
          if (errsNow.some((e) => e === host || e.contains(host) || host.contains(e))) continue;
          if (target && (target === host || target.contains(host) || host.contains(target))) continue;
          if (S.trigger && S.trigger.contains && S.trigger.contains(host)) continue;
          if (controlled && controlled.contains(host)) continue;
          const k = __sel(host);
          if (seen.has(k)) continue;
          seen.add(k);
          out.status.push({ selector: k, html: __html(host), text: t.slice(0, 80) });
          if (out.status.length >= 5) break;
        }
      }
      S.dialogs = new Set(now);
      return out;
    },
  };
  return true;
})()`;

const HAS_LIB = "!!window.__u11yJ";
/** What a target resolves to: its nearest focusable or interactive ancestor (itself included). */
export const CONTROL_SELECTOR =
  'a[href],area[href],button,input,select,textarea,summary,[tabindex]:not([tabindex^="-"]),[contenteditable=""],[contenteditable="true"],' +
  "[role=button],[role=link],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox]";
const TARGET_INFO = `(() => { ${PRELUDE} const e = document.querySelector('[data-u11y-jt]'); return e ? { selector: __sel(e), html: __html(e) } : null; })()`;
const UNTAG_TARGET = `(() => { for (const e of Array.from(document.querySelectorAll('[data-u11y-jt]'))) e.removeAttribute('data-u11y-jt'); return true; })()`;
/** Every `data-u11y-*` attribute a probe or the replay left on the page, removed before the
 *  next snapshot is collected: the recorded DOM must be the application's, not our tagging. */
const STRIP_TAGS = `(() => {
  for (const e of Array.from(document.querySelectorAll('*'))) {
    for (const a of Array.from(e.attributes)) if (a.name.indexOf('data-u11y-') === 0) e.removeAttribute(a.name);
  }
  return true;
})()`;

/** Every browser-side string this module evaluates, for the syntax gate (tests/journey.test.ts). */
export function journeySources(): Record<string, string> {
  return { JOURNEY_LIB, HAS_LIB, TARGET_INFO, UNTAG_TARGET, STRIP_TAGS };
}

interface Active {
  key: number;
  label: string;
  body: boolean;
  frame: boolean;
  role: string;
  onTarget: boolean;
  modal: boolean;
}

/** A Playwright locator for a journey target. Accessible locators first (role, label, text). */
export function locatorFor(page: Any, t: JourneyTarget): Any {
  if ("role" in t) return page.getByRole(t.role, { ...(t.name ? { name: t.name } : {}), ...(t.exact ? { exact: true } : {}) });
  if ("label" in t) return page.getByLabel(t.label, t.exact ? { exact: true } : {});
  if ("text" in t) return page.getByText(t.text, t.exact ? { exact: true } : {});
  return page.locator(t.css);
}

const firstLine = (e: unknown): string =>
  String((e as Error)?.message ?? e)
    .split("\n")[0]!
    .slice(0, 200);

/** Resolve a step's target to exactly one element, or say why not. */
async function resolveTarget(page: Any, step: JourneyStep, timeout: number): Promise<{ loc: Any } | { reason: string }> {
  const loc = locatorFor(page, step.target!);
  try {
    await loc.first().waitFor({ state: "visible", timeout });
  } catch {
    const n = await loc.count().catch(() => 0);
    return {
      reason: n
        ? `${targetLabel(step.target)} matched ${n} element(s), none visible within ${timeout} ms`
        : `no element matches ${targetLabel(step.target)} within ${timeout} ms (locator not found)`,
    };
  }
  const n = await loc.count().catch(() => 1);
  if (n > 1) return { reason: `${targetLabel(step.target)} matched ${n} elements — make the target exact ("exact": true) or narrower` };
  return { loc: loc.first() };
}

interface Walk {
  reached: boolean;
  seq: Active[];
  stuck: boolean;
  /** Index in `seq` where focus came back to an element already visited: a whole loop. */
  cycleFrom: number;
  exhausted: boolean;
}

const active = async (page: Any): Promise<Active> => (await page.evaluate("window.__u11yJ.active()")) as Active;

/** Press `key` until focus lands on the tagged target, comes back where it has already been,
 *  stays put, or the bound runs out. `leave`: stop as soon as focus is outside these keys. */
async function walk(page: Any, key: "Tab" | "Shift+Tab", max: number, leave?: Set<number>): Promise<Walk & { left: boolean }> {
  const start = await active(page);
  const seq: Active[] = [];
  const seen = new Map<number, number>();
  if (!start.body) seen.set(start.key, -1);
  let prev = start.key;
  let same = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const a = await active(page);
    seq.push(a);
    if (leave && (a.body || !leave.has(a.key))) return { reached: a.onTarget, seq, stuck: false, cycleFrom: -1, exhausted: false, left: true };
    if (!leave && a.onTarget) return { reached: true, seq, stuck: false, cycleFrom: -1, exhausted: false, left: false };
    // An iframe holds focus while Tab walks its own document: not a trap of the page.
    if (!a.body && !a.frame && a.key === prev) {
      same++;
      if (same >= STUCK_AFTER - 1) return { reached: false, seq, stuck: true, cycleFrom: Math.max(0, seq.length - 1), exhausted: false, left: false };
    } else same = 0;
    prev = a.key;
    if (!a.body && !a.frame) {
      const at = seen.get(a.key);
      if (at !== undefined) return { reached: false, seq, stuck: false, cycleFrom: at + 1, exhausted: false, left: false };
      seen.set(a.key, i);
    }
  }
  return { reached: false, seq, stuck: false, cycleFrom: -1, exhausted: true, left: false };
}

type KeyboardOutcome =
  | { kind: "focus"; focus: string[] }
  | { kind: "unreachable"; focus: string[]; tabs: number }
  | { kind: "trap"; focus: string[]; region: { selector: string; html: string; label: string }; count: number; total: number }
  | { kind: "confined" | "bound"; focus: string[] };

/** Move focus onto the tagged target with the keyboard alone, the way a user would. */
async function reachByKeyboard(page: Any): Promise<KeyboardOutcome> {
  const start = await active(page);
  const labels = (seq: Active[]): string[] => {
    const out: string[] = [];
    for (const a of seq) if (out[out.length - 1] !== a.label) out.push(a.label);
    return out.slice(0, MAX_FOCUS_LABELS);
  };
  if (start.onTarget) return { kind: "focus", focus: [] };
  const total = (await page.evaluate("window.__u11yJ.tabbables()").catch(() => 0)) as number;
  const max = Math.min(MAX_TABS, total * 2 + 10);
  const fwd = await walk(page, "Tab", max);
  if (fwd.reached) return { kind: "focus", focus: labels(fwd.seq) };
  if (fwd.exhausted) return { kind: "bound", focus: labels(fwd.seq) };
  const loop = fwd.seq.slice(fwd.cycleFrom);
  const loopKeys = new Set(loop.filter((a) => !a.body).map((a) => a.key));
  // A loop that passed through the page itself (focus left the document) or covered every
  // focusable is the whole tab order: the target simply is not in it.
  const confined = !loop.some((a) => a.body) && loopKeys.size < total;
  if (confined) {
    // Focus held inside an open modal dialog is the dialog doing its job, not a trap.
    if (loop.every((a) => a.modal)) return { kind: "confined", focus: labels(fwd.seq) };
    const back = await walk(page, "Shift+Tab", loopKeys.size + STUCK_AFTER + 2, loopKeys);
    if (!back.left) {
      const region = ((await page.evaluate(`window.__u11yJ.region(${JSON.stringify([...loopKeys])})`).catch(() => null)) as {
        selector: string;
        html: string;
        label: string;
      } | null) ?? { selector: "—", html: "", label: "—" };
      return { kind: "trap", focus: labels(fwd.seq), region, count: loopKeys.size, total };
    }
    if (back.reached) return { kind: "focus", focus: labels([...fwd.seq, ...back.seq]) };
    // Out of the loop backwards: keep going that way, the target may sit before it.
    const rest = await walk(page, "Shift+Tab", max);
    if (rest.reached) return { kind: "focus", focus: labels([...fwd.seq, ...back.seq, ...rest.seq]) };
    if (rest.exhausted) return { kind: "bound", focus: labels([...fwd.seq, ...back.seq, ...rest.seq]) };
    return { kind: "unreachable", focus: labels([...fwd.seq, ...back.seq, ...rest.seq]), tabs: fwd.seq.length + back.seq.length + rest.seq.length };
  }
  return { kind: "unreachable", focus: labels(fwd.seq), tabs: fwd.seq.length };
}

async function settle(page: Any): Promise<void> {
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  await waitForLoaded(page, 5000);
}

async function ensureLib(page: Any): Promise<boolean> {
  return (await page.evaluate(JOURNEY_LIB).catch(() => false)) === true;
}

/** The page state after a step, as a RunnerOutput — the shape `scan` persists and folds. */
async function capture(page: Any, axe: AxeEngine, lang: Lang): Promise<RunnerOutput> {
  await page.evaluate(STRIP_TAGS).catch(() => {});
  let snapshot: (CollectedPage & { screenshot?: string; screenshotFull?: string }) | undefined;
  try {
    snapshot = (await page.evaluate(COLLECT_SNAPSHOT)) as CollectedPage;
  } catch {
    /* no snapshot for this state: its findings still count, its silence does not */
  }
  if (snapshot) {
    // What a screen reader is handed in THIS state (#208) — the tree after the step, so sr.json
    // says what is announced once the menu opened or the form refused the address.
    const axtree = await captureAxTree(page);
    if (axtree) snapshot.axtree = axtree;
    try {
      snapshot.screenshot = ((await page.screenshot({ fullPage: false })) as Buffer).toString("base64");
    } catch {
      /* pixel tier only */
    }
    const vp = snapshot.viewport;
    const height = Math.min(snapshot.docHeight ?? 0, FULL_SCREENSHOT_MAX_HEIGHT);
    if (vp && height > vp.height) {
      try {
        snapshot.screenshotFull = ((await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width: vp.width, height } })) as Buffer).toString("base64");
      } catch {
        /* the report shows the viewport shot instead */
      }
    }
    // The media inventory of this state; the flash measure is `scan`'s, on the page as loaded.
    const media = await probeMedia(page, { flash: false });
    if (media) snapshot.media = media;
  }
  // THE BEHAVIOUR WINDOW (#190), as `scan` opens it: on the DOM just serialized, idle first (what
  // changes then changed on its own), the probes below as its interaction half, closed after
  // them. Each step's snapshot then carries its own scripts.json — the state the journey built.
  const behaviour = snapshot ? await startBehaviour(page) : undefined;
  await behaviour?.idle();
  // Not caught: a state whose axe pass failed would be persisted as « axe ran, found nothing ».
  // The throw fails the step instead, with the reason.
  const axeRun = await runAxe(axe, page, "journey");
  const violations = (axeRun.violations as Any[]).map((v: Any) => ({
    id: v.id as string,
    impact: (v.impact ?? null) as string | null,
    help: v.help as string,
    tags: v.tags as string[],
    nodes: (v.nodes as Any[]).slice(0, 10).map((n: Any) => ({ target: (n.target as unknown[]).map(String), html: ((n.html as string) || "").slice(0, 200) })),
  }));
  // The probes press Tab and hover: the journey's own focus is put back afterwards, so the next
  // keyboard step starts where the user left it, not where the probe walk ended.
  await page.evaluate("window.__u11yJ && window.__u11yJ.save()").catch(() => {});
  const probes = await runLiveProbes(page, { lang }).catch((e: unknown) => ({
    focusVisible: [] as ProbeHit[],
    hover: [] as ProbeHit[],
    keyboardTrap: [] as ProbeHit[],
    reflowZoom: [] as ProbeHit[],
    textSpacing: [] as ProbeHit[],
    reflow: { horizontalScroll: false },
    probed: [] as string[],
    skipped: ["1.4.4", "1.4.10", "1.4.12", "1.4.13", "2.1.2", "2.4.7", "2.4.11"].map((sc) => ({ sc, why: `the live probes failed: ${firstLine(e)}` })),
    focusObscured: undefined as ProbeHit[] | undefined,
  }));
  await page.evaluate("window.__u11yJ && window.__u11yJ.restore()").catch(() => {});
  // Never fatal: a window that could not be read is written `collected: "none"`, with the reason.
  if (behaviour && snapshot) snapshot.scripts = await behaviour.finish();
  await page.evaluate(STRIP_TAGS).catch(() => {});
  return {
    url: page.url() as string,
    violations,
    axe: axeRun.engine,
    reflow: probes.reflow,
    focusVisible: probes.focusVisible,
    ...(probes.focusObscured ? { focusObscured: probes.focusObscured } : {}),
    hover: probes.hover,
    keyboardTrap: probes.keyboardTrap,
    reflowZoom: probes.reflowZoom,
    textSpacing: probes.textSpacing,
    probed: [...probes.probed].sort(),
    ...(probes.skipped?.length ? { skipped: probes.skipped } : {}),
    ...(snapshot?.dom ? { snapshot } : {}),
  };
}

const say = (id: string, params: Record<string, string | number>, lang: Lang): string => resolveMessage({ message: "", msg: { id, params } }, lang);

export interface JourneyRunOptions {
  root: string;
  cwd: string;
  lang: Lang;
  keyboard: boolean;
  storageState?: string;
  baseUrl?: string;
  browserPath?: string;
  onStep?: (journey: string, step: JourneyStepRecord) => void;
}

export interface JourneyRunResult {
  records: JourneyRecord[];
  /** Every finding, as `scan` reports them. */
  findings: DynamicFinding[];
  /** The findings of steps whose snapshot could not be written: the snapshot audit cannot fold
   *  them, so `--merge` folds these directly. */
  unsnapshotted: DynamicFinding[];
  snapshots: string[];
  testedScs: string[];
  scanned: string[];
  axe?: AxeEngineInfo;
}

/** Remove the snapshots a previous replay of this journey wrote, so a journey that now has
 *  fewer steps leaves no stale state behind in the grid. */
function clearJourneySnapshots(root: string, name: string): void {
  const dir = join(root, PAGES_DIR);
  if (!existsSync(dir)) return;
  for (const id of readdirSync(dir)) {
    try {
      const meta = JSON.parse(readFileSync(join(dir, id, "meta.json"), "utf8")) as { runner?: string; journey?: { name?: string } };
      if (meta.runner === "journey" && meta.journey?.name === name) rmSync(join(dir, id), { recursive: true, force: true });
    } catch {
      /* not a snapshot, or not ours */
    }
  }
}

/** Replay journeys, one browser for all, one context per journey. */
export async function runJourneys(entries: { journey: Journey; file: string }[], opts: JourneyRunOptions): Promise<JourneyRunResult> {
  const { chromium, axe } = resolveLocalDeps(opts.cwd, opts.lang);
  const browser = await launchChromium(chromium, opts.cwd, undefined, { browserPath: opts.browserPath });
  const result: JourneyRunResult = { records: [], findings: [], unsnapshotted: [], snapshots: [], testedScs: [], scanned: [] };
  const tested = new Set<string>();
  try {
    for (const { journey, file } of entries) {
      const rec = await runOne(browser, axe, journey, file, opts, result, tested);
      result.records.push(rec);
    }
  } finally {
    await browser.close();
  }
  result.testedScs = [...tested].sort();
  return result;
}

async function runOne(
  browser: Any,
  axe: AxeEngine,
  journey: Journey,
  file: string,
  opts: JourneyRunOptions,
  result: JourneyRunResult,
  tested: Set<string>,
): Promise<JourneyRecord> {
  const keyboard = opts.keyboard || journey.keyboardOnly === true;
  const record = notRunRecord(file, journey, journey.name);
  record.keyboard = keyboard;
  // The start is step 0: it is a navigation and a page state like any other.
  const start: JourneyStepRecord = { n: 0, action: "goto", label: `goto ${journey.startUrl}`, status: "not-run" };
  record.steps.unshift(start);
  const fail = (step: JourneyStepRecord, reason: string): JourneyRecord => {
    step.status = "failed";
    step.reason = reason;
    record.status = "failed";
    record.reason = `step ${step.n} (${step.label}): ${reason}`;
    opts.onStep?.(journey.name, step);
    return record;
  };
  // First, before anything can fail: a journey that stops before its first step must not leave
  // the previous replay's page states in the grid, contradicting its own annex row.
  clearJourneySnapshots(opts.root, journey.name);
  // The journey's own session wins over the run-wide one, as a sample page's does in `scan`.
  const storageState = journey.storageState ? resolve(opts.root, journey.storageState) : opts.storageState;
  if (storageState && !existsSync(storageState)) return fail(start, `storageState not found: ${storageState}`);
  let startUrl: string;
  try {
    startUrl = new URL(journey.startUrl, opts.baseUrl).href;
  } catch {
    return fail(start, `startUrl "${journey.startUrl}" is not an absolute URL — pass --base-url <url> to resolve it`);
  }
  const context = await browser.newContext(storageState ? { storageState } : {});
  const page = await context.newPage();
  // The timer hook before the application's own scripts, so each step's behaviour digest counts
  // the intervals started at load (src/behaviour.ts), as `scan` does. One hook serves every step's
  // window: each window pauses it while axe and the probes hold the page (#198), so a later step
  // never counts an earlier step's tool timeouts as the application's.
  await page.addInitScript(TIMER_HOOK).catch(() => {});
  const traps = new Set<string>();
  try {
    const steps: { def: JourneyStep; rec: JourneyStepRecord }[] = [
      { def: { action: "goto", url: startUrl }, rec: start },
      ...journey.steps.map((def, i) => ({ def, rec: record.steps[i + 1]! })),
    ];
    for (const { def, rec } of steps) {
      const timeout = def.timeoutMs ?? DEFAULT_TIMEOUT;
      const hits = {
        keyboardTrap: [] as ProbeHit[],
        keyboardUnreachable: [] as ProbeHit[],
        dialogFocus: [] as ProbeHit[],
        errorUnassociated: [] as ProbeHit[],
        liveRegion: [] as ProbeHit[],
      };
      if (def.note) rec.note = def.note;
      if (def.action === "goto") {
        let target: string;
        try {
          target = new URL(def.url!, page.url() && page.url() !== "about:blank" ? page.url() : startUrl).href;
        } catch {
          return fail(rec, `"${def.url}" is not a URL`);
        }
        let response: Any;
        try {
          response = await page.goto(target, { waitUntil: "load", timeout: Math.max(timeout, 30_000) });
        } catch (e) {
          return fail(rec, `navigation failed: ${firstLine(e)}`);
        }
        await settle(page);
        const status = typeof response?.status === "function" ? (response.status() as number) : undefined;
        if (status !== undefined && status >= 400) return fail(rec, `HTTP ${status} at ${target}`);
        if (!landedOnRequestedPage(target, page.url())) return fail(rec, `redirected to ${page.url()}`);
        await ensureLib(page);
      } else {
        await ensureLib(page);
        let loc: Any;
        if (def.target && def.action !== "waitFor" && def.action !== "expect") {
          const r = await resolveTarget(page, def, timeout);
          if ("reason" in r) return fail(rec, r.reason);
          loc = r.loc;
          // THE CONTROL, not the node the locator landed on: `getByText` resolves to the deepest
          // match — the <span> inside a <button> — and focus lands on the button around it. Tagging
          // the span made every focus check miss (a false 2.1.1, a false 2.4.3 on dialog close) and
          // read `aria-controls` off the wrong element (a false 4.1.3).
          await loc.evaluate((el: Any, sel: string) => (el.closest(sel) ?? el).setAttribute("data-u11y-jt", ""), CONTROL_SELECTOR).catch(() => {});
        }
        if (def.action === "waitFor" || def.action === "expect") {
          const state = def.state ?? "visible";
          try {
            await locatorFor(page, def.target!).first().waitFor({ state, timeout });
          } catch {
            return fail(rec, `${def.action === "expect" ? "expectation not met" : "timed out"}: ${targetLabel(def.target)} not ${state} within ${timeout} ms`);
          }
        } else {
          // Keyboard mode: reach the control with Tab, as a keyboard user has to.
          let pointer = !keyboard;
          if (keyboard && loc) {
            const k = await reachByKeyboard(page);
            rec.focus = k.focus;
            if (k.kind === "focus") rec.keyboard = "focus";
            else {
              pointer = true;
              if (k.kind === "trap") {
                rec.keyboard = "trap";
                if (!traps.has(k.region.selector)) {
                  traps.add(k.region.selector);
                  hits.keyboardTrap.push({
                    selector: k.region.selector,
                    html: k.region.html,
                    detail: say("journey-keyboard-trap", { region: k.region.label, count: k.count, total: k.total }, opts.lang),
                  });
                }
              } else if (k.kind === "unreachable") {
                rec.keyboard = "unreachable";
                const el = ((await page.evaluate(TARGET_INFO).catch(() => null)) as { selector: string; html: string } | null) ?? {
                  selector: targetLabel(def.target),
                  html: "",
                };
                hits.keyboardUnreachable.push({
                  selector: el.selector,
                  html: el.html,
                  detail: say("journey-keyboard-unreachable", { control: targetLabel(def.target), tabs: k.tabs, step: rec.label }, opts.lang),
                });
              } else if (k.kind === "confined") {
                rec.note = [rec.note, "focus is confined to the open modal dialog; performed with the pointer"].filter(Boolean).join(" — ");
              } else {
                rec.note = [rec.note, `Tab bound of ${MAX_TABS} reached before the control; performed with the pointer`].filter(Boolean).join(" — ");
              }
            }
          }
          await page.evaluate("window.__u11yJ.before()").catch(() => {});
          try {
            await perform(page, loc, def, pointer, timeout);
          } catch (e) {
            return fail(rec, `${def.action} failed: ${firstLine(e)}`);
          }
          await settle(page);
          // A full navigation dropped the in-page half: there is no « after » to compare.
          if ((await page.evaluate(HAS_LIB).catch(() => false)) === true) {
            const obs = (await page.evaluate("window.__u11yJ.after()").catch(() => null)) as {
              dialogIn: { selector: string; html: string; dialog: string; focus: string }[];
              dialogReturn: { selector: string; html: string; dialog: string; trigger: string; focus: string }[];
              errors: { selector: string; html: string; text: string; field: string }[];
              status: { selector: string; html: string; text: string }[];
            } | null;
            if (obs) {
              for (const d of obs.dialogIn)
                hits.dialogFocus.push({
                  selector: d.selector,
                  html: d.html,
                  detail: say("journey-dialog-focus-in", { dialog: d.dialog, focus: d.focus }, opts.lang),
                });
              for (const d of obs.dialogReturn)
                hits.dialogFocus.push({
                  selector: d.selector,
                  html: d.html,
                  detail: say("journey-dialog-focus-return", { dialog: d.dialog, trigger: d.trigger, focus: d.focus }, opts.lang),
                });
              for (const e of obs.errors)
                hits.errorUnassociated.push({
                  selector: e.selector,
                  html: e.html,
                  detail: say(
                    "journey-error-unassociated",
                    { step: rec.label, text: e.text, field: e.field || (opts.lang === "fr" ? "aucun champ" : "any field") },
                    opts.lang,
                  ),
                });
              for (const s of obs.status)
                hits.liveRegion.push({
                  selector: s.selector,
                  html: s.html,
                  detail: say("journey-status-message", { step: rec.label, text: s.text }, opts.lang),
                });
            }
          } else await ensureLib(page);
          await page.evaluate(UNTAG_TARGET).catch(() => {});
        }
      }
      // The state this step left the page in: snapshot, axe, probes.
      const out = await capture(page, axe, opts.lang);
      // The ring probe and the replay can both walk into the same trap: one finding per region,
      // the replay's, which also tried Shift+Tab.
      const trapped = new Set(hits.keyboardTrap.map((h) => h.selector));
      out.keyboardTrap = [...(out.keyboardTrap ?? []).filter((h) => !trapped.has(h.selector)), ...hits.keyboardTrap];
      // Same rule as `runLiveProbes`: a trap on record withdraws the coverage claim an older
      // reader of this file would misread as conformity; the finding itself is kept.
      if (out.keyboardTrap.length) out.probed = (out.probed ?? []).filter((sc) => sc !== "2.1.2");
      if (hits.keyboardUnreachable.length) out.keyboardUnreachable = hits.keyboardUnreachable;
      if (hits.dialogFocus.length) out.dialogFocus = hits.dialogFocus;
      if (hits.errorUnassociated.length) out.errorUnassociated = hits.errorUnassociated;
      if (hits.liveRegion.length) out.liveRegion = hits.liveRegion;
      for (const sc of out.probed ?? []) tested.add(sc);
      if (out.axe && !result.axe) result.axe = out.axe;
      const id = stepPageId(journey.name, rec.n, def);
      const name = `${journey.name} — ${rec.n}. ${rec.label}`;
      const written = writeRunnerSnapshot(
        opts.root,
        out,
        out.url,
        { id, name, url: out.url, ...(storageState ? { auth: true } : {}) },
        {
          runner: "journey",
          journey: { name: journey.name, step: rec.n, action: def.action, keyboard },
        },
      );
      const findings = toDynamicResult(out, out.url, opts.lang, JOURNEY_ENGINE).findings;
      for (const f of findings) f.sample = { id, name };
      result.findings.push(...findings);
      if (written) {
        rec.page = written;
        result.snapshots.push(written);
      } else result.unsnapshotted.push(...findings);
      if (!result.scanned.includes(out.url)) result.scanned.push(out.url);
      const observed = [
        ...(hits.keyboardTrap.length ? ["keyboard-trap"] : []),
        ...(hits.keyboardUnreachable.length ? ["keyboard-unreachable"] : []),
        ...(hits.dialogFocus.length ? ["dialog-focus"] : []),
        ...(hits.errorUnassociated.length ? ["error-unassociated"] : []),
        ...(hits.liveRegion.length ? ["live-region"] : []),
      ];
      if (observed.length) rec.observed = observed;
      rec.status = "done";
      opts.onStep?.(journey.name, rec);
    }
    record.status = "done";
    return record;
  } catch (e) {
    const open = record.steps.find((s) => s.status === "not-run");
    return open ? fail(open, `the browser failed: ${firstLine(e)}`) : record;
  } finally {
    await context.close().catch(() => {});
  }
}

const TOGGLE_ROLES = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio", "option"]);

/** Perform the step's action: with the keyboard on a focused target, else with the pointer. */
async function perform(page: Any, loc: Any, def: JourneyStep, pointer: boolean, timeout: number): Promise<void> {
  if (def.action === "press") {
    if (loc && pointer) await loc.press(def.key!, { timeout });
    else await page.keyboard.press(def.key!);
    return;
  }
  if (pointer) {
    if (def.action === "click") await loc.click({ timeout });
    else if (def.action === "check") await loc.check({ timeout });
    else if (def.action === "fill") await loc.fill(def.value!, { timeout });
    else if (def.action === "select") await loc.selectOption(def.value!, { timeout });
    return;
  }
  const role = ((await active(page).catch(() => undefined))?.role ?? "") as string;
  if (def.action === "click") await page.keyboard.press(TOGGLE_ROLES.has(role) ? "Space" : "Enter");
  else if (def.action === "check") {
    if (!(await loc.isChecked().catch(() => false))) await page.keyboard.press("Space");
  } else if (def.action === "fill") {
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Delete");
    await page.keyboard.type(def.value!);
  }
  // A native <select> opens a popup the page cannot see; the option is chosen on the focused
  // control, which is what a keyboard user's arrow keys amount to.
  else if (def.action === "select") await loc.selectOption(def.value!, { timeout });
}
