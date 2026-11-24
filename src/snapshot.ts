// PAGE SNAPSHOT — the shared primitive the rendered tier is built on.
//
// The static engine sees SOURCE; `scan` drives its own browser and keeps only findings.
// Neither leaves behind an artefact that (a) is a real rendered page, (b) knows WHICH page
// it is, and (c) can be re-audited later, offline, with no browser. That artefact is a
// snapshot, and it is what lets CI decide rendering criteria without a browser and lets a
// report speak page by page.
//
//   .ultra11y/pages/<page-id>/
//     meta.json     page identity + provenance (id, name, url, route, auth, sources…)
//     dom.html      documentElement.outerHTML, prefixed with the usual capture comment
//     styles.json   computed-style digest, joined to the DOM by document-order index
//     boxes.json    bounding boxes, same join key
//     axtree.json   accessibility tree as the browser computed it
//     scripts.json  what the page's scripts DID during the capture window — listeners, inline
//                   handlers, ARIA mutations, live regions, timers, moving content, scripts and
//                   stylesheets loaded (src/behaviour.ts); same join key, verified per entry
//     screen.png    viewport screenshot (pixel tier — shares boxes.json's coordinates)
//     screen-320.png   the page at the 320px reflow viewport, as the probe measured it (#184)
//     screen-full.png  the whole page, height-bounded, when it is taller than the viewport —
//                   what a reviewer judges; never read by a rule
//
// `dom.html` is deliberately an ORDINARY capture: it carries the same
// `<!-- ultra11y:capture … -->` provenance comment the render engine writes on a component, so the
// existing `audit` path ingests it with no special case. Two differences matter:
//   • it is a FULL document (a component capture is a fragment), so `scope: "page"` rules —
//     html-lang, title, viewport — actually run on it. That is where RGAA 8.3/8.5/8.6 and
//     the theme-12 criteria become decidable at all.
//   • its provenance carries `page` + `url`, which is what makes per-page attribution
//     possible downstream.
//
// JOIN KEY. styles/boxes/axtree index elements by DOCUMENT-ORDER ORDINAL, not by selector:
// a selector would have to survive serialization and re-parsing, an ordinal does not. Each
// entry repeats its `tag` so the join can be VERIFIED (`alignedStyles`); on any mismatch the
// whole digest is refused rather than silently mis-attributing a style to the wrong element.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { SCRIPTS_VERSION } from "./behaviour.js";
import { formatCaptureComment } from "./capture.js";
import { parseHtml } from "./parse/html.js";
import type { Doc } from "./parse/html.js";
import type { AxNode, BoxDigest, BoxEntry, CssDigest, ReflowClipped, RenderSignals, ScriptsDigest, StyleDigest, StyleEntry } from "./types.js";

export type { AxNode, BoxDigest, BoxEntry, CssDigest, RenderSignals, ScriptsDigest, StyleDigest, StyleEntry };

export const SNAPSHOT_VERSION = 1;

// The format of `scripts.json` lives with its collector (src/behaviour.ts), like PROBES_VERSION.
export { SCRIPTS_VERSION };

// The coverage contract that travels inside `probes.json` lives with the probes that write it
// (src/probes.ts) and is re-exported here, where the format is defined, so a reader of either
// module finds it.
export { PROBES_VERSION, WALK_DEPENDENT_SCS } from "./probes.js";
export const PAGES_DIR = ".ultra11y/pages";

export interface SnapshotViewport {
  width: number;
  height: number;
}

export interface SnapshotMeta {
  v: number;
  id: string; // stable slug — the page identity, and the directory name
  name: string; // human page name, shown in the report
  url: string;
  route?: string; // framework route pattern when the producer knows it (e.g. /blog/[slug])
  auth?: boolean; // the page sits behind authentication
  viewport?: SnapshotViewport;
  capturedAt?: string; // ISO timestamp SUPPLIED by the producer — never invented here
  runner?: string; // "playwright" | "cypress" | "dev" | "scan"
  /** The document's doctype declaration, verbatim. Recorded separately because `dom.html` is
   *  `documentElement.outerHTML`, which does not contain it — so without this field the
   *  criterion that asks about the doctype has no evidence at all. Empty string = the page
   *  genuinely had none; absent = this capture predates the field. Those are NOT the same
   *  claim, and the adjudication harvest keeps them apart. */
  doctype?: string;
  // Repo source files that rendered this page, when the producer can attribute them
  // (a Next route file, the components a test imported). Drives per-page attribution of
  // SOURCE findings — see src/pages.ts.
  sources?: string[];
  notes?: string;
  /** The page was collected while it still declared itself loading — `aria-busy="true"`, an
   *  indeterminate progress bar, a « Chargement… » standing for the content — after the
   *  producer had waited as long as it was allowed to. The markers it still carried, named.
   *  Absent = ready (or a producer that predates the check). Such a capture is reported
   *  « capture en état de chargement » and never concludes a conformity by silence: the
   *  content it would have been about was not on the page. */
  loading?: string[];
  /** The consent state the page was captured in (#184). `"none"`: consent placeholders or a
   *  consent banner were on the page — the capture never accepted cookies, so third-party
   *  content shows as its placeholder (src/consent.ts). `"accepted"`: reserved for a producer
   *  that accepted consent before capturing. Absent = no consent manager seen (or a producer
   *  that predates the field). */
  consent?: "none" | "accepted";
  /** The consent markers seen, as « kind vendor selector » (CONSENT_STATE). */
  consentMarkers?: string[];
  /** The journey step this page state was recorded at (`journey run`, src/journey-run.ts):
   *  the journey's name, the step (0 is the start page), the action it performed, and whether the journey
   *  was replayed with the keyboard alone. Absent on every other producer's capture. */
  journey?: SnapshotJourney;
}

export interface SnapshotJourney {
  name: string;
  step: number;
  action: string;
  keyboard: boolean;
}

/** What the LIVE probes measured on this page, when the producer ran them. Persisted beside
 *  the DOM because the audit that folds them runs later, in another process, over the whole
 *  `.ultra11y/pages` tree — a measurement that lives only in the producer's memory decides
 *  nothing. `probed` is the load-bearing half: the absence of a hit means "nothing found"
 *  only for the criteria that were actually looked at. */
export interface SnapshotProbes {
  /** The coverage contract this file was written against. See PROBES_VERSION. */
  v?: number;
  focusVisible?: { selector: string; html: string; detail: string }[];
  /** 2.4.11 — the focused component entirely hidden behind author-created content.
   *
   *  NAMED HERE BECAUSE A FAMILY THE FORMAT DOES NOT NAME IS A SILENT CONFORMITY. Every
   *  producer already wrote this array into `probes.json` (the file is the payload, verbatim),
   *  and `probed` already credited 2.4.11 — but neither this interface nor `probeFindings`
   *  knew the key, so a real obstruction measured in a browser came back `C` from the offline
   *  re-audit. A false positive gets argued away in review; a false CONFORME is what a
   *  declaration of accessibility then repeats. */
  focusObscured?: { selector: string; html: string; detail: string }[];
  hover?: { selector: string; html: string; detail: string }[];
  reflowZoom?: { selector: string; html: string; detail: string }[];
  textSpacing?: { selector: string; html: string; detail: string }[];
  /** 2.1.2 — focus that Tab cannot move off. Same story as `focusObscured`, and the more
   *  expensive one to lose: a keyboard trap is a `bloquant`. */
  keyboardTrap?: { selector: string; html: string; detail: string }[];
  /** 4.1.3 — content updated by an interaction and landing outside any live region. */
  liveRegion?: { selector: string; html: string; detail: string }[];
  /** Journey observations (`journey run`): a control Tab never reached (2.1.1), focus not
   *  moved into a dialog or not returned to its trigger (2.4.3), an error tied to no field
   *  (3.3.1). Written by the journey replay only. */
  keyboardUnreachable?: { selector: string; html: string; detail: string }[];
  dialogFocus?: { selector: string; html: string; detail: string }[];
  errorUnassociated?: { selector: string; html: string; detail: string }[];
  /** The three stresses applied to a FILLED input, each folding onto the criterion its own
   *  stress evidences (320px reflow 1.4.10, 200% zoom 1.4.4, text spacing 1.4.12). */
  inputOverflowReflow?: { selector: string; html: string; detail: string }[];
  inputOverflowZoom?: { selector: string; html: string; detail: string }[];
  inputOverflowSpacing?: { selector: string; html: string; detail: string }[];
  /** `widening` — the outermost boxes wider than the 320px viewport, when the producer named them. */
  reflow?: { horizontalScroll: boolean; widening?: { selector: string; html: string; detail: string }[]; clipped?: ReflowClipped };
  probed?: string[];
  /** Why a probe did not run — or did not FINISH — when it did not. The complement of
   *  `probed`, carried for the report and never for a verdict. */
  skipped?: { sc: string; why: string }[];
}

export interface Snapshot {
  meta: SnapshotMeta;
  dom: string;
  styles?: StyleDigest;
  boxes?: BoxDigest;
  axtree?: AxNode;
  css?: CssDigest;
  /** What the live probes measured, when the producer ran them. */
  probes?: SnapshotProbes;
  /** What axe-core found on this page, when the producer ran it. See RenderSignals.axe. */
  axe?: RenderSignals["axe"];
  /** What the page's scripts did during the capture window (`scripts.json`), when the producer
   *  recorded it. See ScriptsDigest. */
  scripts?: ScriptsDigest;
  /** Path of the screenshot on disk, relative to the snapshot dir. Set on READ. */
  screenshot?: string;
  /** The screenshot's bytes, base64, as a producer hands them over. Set on WRITE — a
   *  producer holds bytes, not a path. `writeSnapshot` turns it into `screen.png`. */
  screenshotBase64?: string;
  /** The whole page, height-bounded, base64 — written as `screen-full.png`. For the reader of
   *  the report; the pixel tier keeps the viewport shot, whose coordinates match boxes.json. */
  screenshotFullBase64?: string;
  /** Path of the full-page screenshot on disk, relative to the snapshot dir. Set on READ. */
  screenshotFull?: string;
  /** The page at the 320px reflow viewport, base64, as the probe measured it — written as
   *  `screen-320.png` (#184). For the reviewer of a 1.4.10 finding; never read by a rule. */
  screenshot320Base64?: string;
  /** Path of the 320px screenshot on disk, relative to the snapshot dir. Set on READ. */
  screenshot320?: string;
}

/** What the browser-side collector (`COLLECT_SNAPSHOT`) returns. Every snapshot producer —
 *  the E2E integrations (ultra11y/playwright, ultra11y/cypress), `scan` — evaluates that one string and gets this
 *  shape back, so the format has exactly one definition and cannot drift per producer. */
export interface CollectedPage {
  dom: string;
  styles?: StyleDigest;
  boxes?: BoxDigest;
  css?: CssDigest;
  title?: string;
  lang?: string;
  url?: string;
  viewport?: SnapshotViewport;
  /** The document's doctype declaration, verbatim, or `""` when the browser parsed none.
   *  `dom` is `documentElement.outerHTML`, which does not contain it, so this is the only
   *  place it survives the trip out of the browser (see SnapshotMeta.doctype). */
  doctype?: string;
  /** The loading markers still on the page when it was collected (LOADING_STATE); empty or
   *  absent when it was ready. */
  loading?: string[];
  /** The consent placeholders and banners on the page (CONSENT_STATE); empty or absent when
   *  it showed none. */
  consent?: string[];
  /** The document's scroll height — whether a full-page screenshot adds anything. */
  docHeight?: number;
  /** The behaviour digest, when the producer opened a capture window after collecting
   *  (src/behaviour.ts) — not part of COLLECT_SNAPSHOT itself, which is synchronous. */
  scripts?: ScriptsDigest;
}

// ---- page identity --------------------------------------------------------------------

/** A stable, filesystem-safe page id derived from a URL path. Accent-folded and
 *  lowercased so `/Accès` and `/acces` land on one id. The root path is the home page. */
export function slugifyPageId(input: string): string {
  let path = input;
  try {
    // PERCENT-DECODE FIRST. `new URL()` encodes non-ASCII into the pathname, so `/Accès`
    // arrives as `/Acc%C3%A8s` and slugifying that yields `acc-c3-a8s` — the raw UTF-8 bytes
    // spelled out as a directory name, unreadable in a report and different from the id the
    // same path produces when it is not a URL. Accented routes are the norm on the sites this
    // tool exists to audit, so decode before folding. A malformed sequence keeps the raw form
    // rather than throwing.
    path = new URL(input).pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      /* malformed percent-escape — fold what we have */
    }
  } catch {
    /* not a URL — slugify the raw string */
  }
  const slug = path
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return path === "/" || path === "" ? "accueil" : "page";
}

// ---- validation (a producer is untrusted input) -----------------------------------------

export interface SnapshotIssue {
  path: string;
  message: string;
}

export interface SnapshotValidation {
  ok: boolean;
  issues: SnapshotIssue[];
  meta?: SnapshotMeta;
}

// An id becomes a directory name, so it must not be able to traverse out of the pages dir.
const ID_RE = /^[a-z0-9][a-z0-9-]*$/i;

export function validateSnapshotMeta(raw: unknown): SnapshotValidation {
  const issues: SnapshotIssue[] = [];
  const err = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    err("meta", "meta must be an object { v, id, name, url, … }");
    return { ok: false, issues };
  }
  const m = raw as Record<string, unknown>;

  const v = typeof m.v === "number" ? m.v : Number.NaN;
  if (!Number.isFinite(v) || v < 1) err("meta.v", "v must be a positive integer snapshot-format version");
  // Refuse to READ a format from the future rather than misinterpreting fields we do not
  // know — the same fail-closed posture the audit schema check takes.
  else if (v > SNAPSHOT_VERSION) err("meta.v", `snapshot format v${v} is newer than this engine understands (v${SNAPSHOT_VERSION}) — upgrade ultra11y`);

  if (typeof m.id !== "string" || !m.id.trim()) err("meta.id", "id must be a non-empty string");
  else if (!ID_RE.test(m.id)) err("meta.id", `id "${m.id}" must match ${ID_RE} (it becomes a directory name)`);

  if (typeof m.name !== "string" || !m.name.trim()) err("meta.name", "name must be a non-empty string");
  if (typeof m.url !== "string" || !m.url.trim()) err("meta.url", "url must be a non-empty string");
  if (m.auth !== undefined && typeof m.auth !== "boolean") err("meta.auth", "auth must be a boolean");
  if (m.route !== undefined && typeof m.route !== "string") err("meta.route", "route must be a string");
  if (m.notes !== undefined && typeof m.notes !== "string") err("meta.notes", "notes must be a string");
  if (m.doctype !== undefined && typeof m.doctype !== "string") err("meta.doctype", "doctype must be a string");
  if (m.loading !== undefined && (!Array.isArray(m.loading) || m.loading.some((s) => typeof s !== "string")))
    err("meta.loading", "loading must be an array of strings");
  if (m.consent !== undefined && m.consent !== "none" && m.consent !== "accepted") err("meta.consent", 'consent must be "none" or "accepted"');
  if (m.consentMarkers !== undefined && (!Array.isArray(m.consentMarkers) || m.consentMarkers.some((s) => typeof s !== "string")))
    err("meta.consentMarkers", "consentMarkers must be an array of strings");
  if (m.sources !== undefined && (!Array.isArray(m.sources) || m.sources.some((s) => typeof s !== "string")))
    err("meta.sources", "sources must be an array of strings");
  const j = m.journey as Record<string, unknown> | undefined;
  if (
    j !== undefined &&
    (typeof j !== "object" ||
      j === null ||
      typeof j.name !== "string" ||
      !Number.isInteger(j.step) ||
      typeof j.action !== "string" ||
      typeof j.keyboard !== "boolean")
  )
    err("meta.journey", "journey must be { name: string, step: integer, action: string, keyboard: boolean }");

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    issues,
    meta: {
      v,
      id: m.id as string,
      name: m.name as string,
      url: m.url as string,
      ...(typeof m.route === "string" ? { route: m.route } : {}),
      ...(typeof m.auth === "boolean" ? { auth: m.auth } : {}),
      ...(m.viewport && typeof m.viewport === "object" ? { viewport: m.viewport as SnapshotViewport } : {}),
      ...(typeof m.capturedAt === "string" ? { capturedAt: m.capturedAt } : {}),
      ...(typeof m.runner === "string" ? { runner: m.runner } : {}),
      // THE FIELD THIS WHITELIST USED TO EAT. Every producer records the doctype — the
      // collector reads it, the Playwright/Cypress path and `scan` both forward it — and it
      // died here, silently, on the way in AND on the way back off disk (this function guards
      // both). So `SnapshotMeta.doctype` was always absent, which the harvest correctly reads
      // as « this capture never looked » — and RGAA 8.1, whose entire subject is that string,
      // was unanswerable on every page of every project. A rebuild-from-whitelist drops what
      // it does not name, so adding a field to the type is only ever half the change.
      ...(typeof m.doctype === "string" ? { doctype: m.doctype } : {}),
      ...(Array.isArray(m.sources) ? { sources: m.sources as string[] } : {}),
      ...(typeof m.notes === "string" ? { notes: m.notes } : {}),
      // Kept only when it says something: an empty list is a page that was ready.
      ...(Array.isArray(m.loading) && m.loading.length ? { loading: m.loading as string[] } : {}),
      // Same whitelist lesson as `doctype`: a field the rebuild does not name dies here.
      ...(m.consent === "none" || m.consent === "accepted" ? { consent: m.consent } : {}),
      ...(Array.isArray(m.consentMarkers) && m.consentMarkers.length ? { consentMarkers: m.consentMarkers as string[] } : {}),
      ...(j ? { journey: { name: j.name as string, step: j.step as number, action: j.action as string, keyboard: j.keyboard as boolean } } : {}),
    },
  };
}

// ---- IO ---------------------------------------------------------------------------------

export function snapshotDir(root: string, id: string): string {
  return join(root, PAGES_DIR, id);
}

/** Write a snapshot, returning its directory. The DOM is prefixed with the standard capture
 *  provenance comment (carrying page + url) so `audit` ingests it as an ordinary capture. */
export function writeSnapshot(root: string, snap: Snapshot): string {
  const dir = snapshotDir(root, snap.meta.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), `${JSON.stringify(snap.meta, null, 2)}\n`);
  const comment = formatCaptureComment({
    v: 1,
    page: snap.meta.id,
    url: snap.meta.url,
    ...(snap.meta.sources?.[0] ? { sourceFile: snap.meta.sources[0] } : {}),
    name: snap.meta.name,
  });
  writeFileSync(join(dir, "dom.html"), `${comment}\n${snap.dom}\n`);
  if (snap.styles) writeFileSync(join(dir, "styles.json"), `${JSON.stringify(snap.styles)}\n`);
  if (snap.boxes) writeFileSync(join(dir, "boxes.json"), `${JSON.stringify(snap.boxes)}\n`);
  if (snap.axtree) writeFileSync(join(dir, "axtree.json"), `${JSON.stringify(snap.axtree)}\n`);
  if (snap.css) writeFileSync(join(dir, "css.json"), `${JSON.stringify(snap.css)}\n`);
  if (snap.probes) writeFileSync(join(dir, "probes.json"), `${JSON.stringify(snap.probes)}\n`);
  if (snap.axe) writeFileSync(join(dir, "axe.json"), `${JSON.stringify(snap.axe)}\n`);
  if (snap.scripts) writeFileSync(join(dir, "scripts.json"), `${JSON.stringify(snap.scripts)}\n`);
  // The screenshot rides in as base64 (a producer has bytes, not a path). It powers the
  // pixel tier — contrast over a gradient or a background image, where the CSSOM has no
  // answer. A screenshot that cannot be decoded/written must NEVER fail the snapshot: the
  // page is still fully auditable without it, the pixel rule simply declines.
  if (snap.screenshotBase64) {
    try {
      writeFileSync(join(dir, "screen.png"), Buffer.from(snap.screenshotBase64, "base64"));
    } catch {
      /* pixel tier skipped for this page — every other rule still runs */
    }
  }
  if (snap.screenshotFullBase64) {
    try {
      writeFileSync(join(dir, "screen-full.png"), Buffer.from(snap.screenshotFullBase64, "base64"));
    } catch {
      /* the report shows the viewport shot instead */
    }
  }
  if (snap.screenshot320Base64) {
    try {
      writeFileSync(join(dir, "screen-320.png"), Buffer.from(snap.screenshot320Base64, "base64"));
    } catch {
      /* the brief still carries the reflow measure itself */
    }
  }
  return dir;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Read one snapshot directory. Returns null when it is not a valid snapshot — a malformed
 *  producer output must degrade to "no snapshot", never to a half-read one. */
export function readSnapshot(dir: string): Snapshot | null {
  const rawMeta = readJson<unknown>(join(dir, "meta.json"));
  if (rawMeta === undefined) return null;
  const v = validateSnapshotMeta(rawMeta);
  if (!v.ok || !v.meta) return null;
  let dom: string;
  try {
    dom = readFileSync(join(dir, "dom.html"), "utf8");
  } catch {
    return null;
  }
  const styles = readJson<StyleDigest>(join(dir, "styles.json"));
  const boxes = readJson<BoxDigest>(join(dir, "boxes.json"));
  const axtree = readJson<AxNode>(join(dir, "axtree.json"));
  const css = readJson<CssDigest>(join(dir, "css.json"));
  // `writeSnapshot` writes these two and `attachSignals` reads them off disk, but this reader
  // used to drop them — so a round-trip through `readSnapshot` silently lost the measurement
  // half of the artefact, and any consumer holding a `Snapshot` (rather than a `Doc`) saw a
  // page that had never been probed. Read what we write.
  const probes = readJson<SnapshotProbes>(join(dir, "probes.json"));
  const axe = readJson<NonNullable<RenderSignals["axe"]>>(join(dir, "axe.json"));
  const scripts = readScripts(dir);
  const shot = join(dir, "screen.png");
  const full = join(dir, "screen-full.png");
  const narrow = join(dir, "screen-320.png");
  return {
    meta: v.meta,
    dom,
    ...(styles ? { styles } : {}),
    ...(boxes ? { boxes } : {}),
    ...(axtree ? { axtree } : {}),
    ...(css ? { css } : {}),
    ...(probes ? { probes } : {}),
    ...(axe ? { axe } : {}),
    ...(scripts ? { scripts } : {}),
    ...(existsSync(shot) ? { screenshot: "screen.png" } : {}),
    ...(existsSync(full) ? { screenshotFull: "screen-full.png" } : {}),
    ...(existsSync(narrow) ? { screenshot320: "screen-320.png" } : {}),
  };
}

/** Read `scripts.json`, or undefined when it is absent or not a behaviour digest this engine
 *  understands. A digest from a future format is refused rather than half-read, and a digest
 *  whose `collected` is not one of the three known values is not trusted to say what it saw.
 *  A digest whose declared fields are of the wrong type is not a crash either: it is read with
 *  the bad entries and fields dropped (see `asScriptsDigest`), and degrades to less evidence. */
export function readScripts(dir: string): ScriptsDigest | undefined {
  return asScriptsDigest(readJson<unknown>(join(dir, "scripts.json")));
}

// Field-by-field validators for the shapes `ScriptsDigest` declares. The digest arrives from a
// producer's output or off disk, so it is DATA, not code: anything with the wrong type is
// DROPPED — an entry out of a list, or the whole optional field — so a malformed digest
// degrades to less evidence and never crashes brief generation downstream (the behaviour
// subjects join on `events`/`kinds`/`values` and take `.length` on the timers arrays).
const isStr = (x: unknown): x is string => typeof x === "string";
const isNum = (x: unknown): x is number => typeof x === "number";
const isBool = (x: unknown): x is boolean => typeof x === "boolean";
const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object" && !Array.isArray(x);
const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every(isStr);
const isNumArr = (x: unknown): x is number[] => Array.isArray(x) && x.every(isNum);

/** The element join every behaviour entry carries — the same ordinals styles.json/boxes.json use. */
const isBehaviourEl = (e: Record<string, unknown>): boolean => isNum(e.i) && isStr(e.tag) && isStr(e.selector) && (e.html === undefined || isStr(e.html));

const LISTENER_OK = (l: unknown): boolean =>
  isObj(l) &&
  isBehaviourEl(l) &&
  isStrArr(l.events) &&
  isBool(l.native) &&
  isBool(l.flagged) &&
  isBool(l.mouseOnly) &&
  (l.role === undefined || isStr(l.role)) &&
  (l.tabindex === undefined || isStr(l.tabindex));
const DELEGATED_OK = (g: unknown): boolean => isObj(g) && isStr(g.target) && isStrArr(g.events);
const INLINE_OK = (e: unknown): boolean => isObj(e) && isBehaviourEl(e) && isStrArr(e.attrs);
const ARIA_MUTATION_OK = (m: unknown): boolean =>
  isObj(m) &&
  isBehaviourEl(m) &&
  isStr(m.attr) &&
  (m.from === null || isStr(m.from)) &&
  Array.isArray(m.values) &&
  m.values.every((v) => v === null || isStr(v)) &&
  isNum(m.count) &&
  (m.phase === "idle" || m.phase === "interaction" || m.phase === "both");
const LIVE_REGION_OK = (r: unknown): boolean =>
  isObj(r) &&
  isBehaviourEl(r) &&
  isBool(r.changed) &&
  (r.live === undefined || isStr(r.live)) &&
  (r.role === undefined || isStr(r.role)) &&
  (r.atomic === undefined || isStr(r.atomic));
const UPDATE_OK = (u: unknown): boolean => isObj(u) && isBehaviourEl(u) && isStrArr(u.kinds);
const MOTION_OK = (m: unknown): boolean => isObj(m) && isBehaviourEl(m) && isNum(m.changes) && isStrArr(m.kinds);
const ANIMATION_OK = (a: unknown): boolean =>
  isObj(a) && isBehaviourEl(a) && isStr(a.name) && (a.iterations === "infinite" || isNum(a.iterations)) && isNum(a.durationMs);
const RESOURCE_OK = (r: unknown): boolean =>
  isObj(r) &&
  (r.kind === "script" || r.kind === "stylesheet") &&
  (r.origin === "inline" || r.origin === "same-origin" || r.origin === "cross-origin") &&
  (r.url === undefined || isStr(r.url)) &&
  (r.size === undefined || isNum(r.size));
const TIMERS_OK = (t: unknown): boolean =>
  isObj(t) &&
  (t.source === "init" || t.source === "window" || t.source === "none") &&
  isNumArr(t.intervals) &&
  isNum(t.timeouts) &&
  isNumArr(t.longTimeouts) &&
  isNum(t.inlineSetInterval) &&
  isNum(t.inlineSetTimeout) &&
  (t.metaRefresh === undefined || isStr(t.metaRefresh));

/** An optional list field, verified entry by entry: absent stays absent, a non-array or its
 *  invalid entries are dropped. `T` is the declared list type. */
const listField = <T>(raw: unknown, ok: (e: unknown) => boolean): T | undefined => (Array.isArray(raw) ? (raw.filter(ok) as T) : undefined);

/** A `Record<string, number>` (caps, truncated) with its non-numeric entries dropped. */
const countsOf = (raw: unknown): Record<string, number> =>
  isObj(raw) ? (Object.fromEntries(Object.entries(raw).filter(([, v]) => isNum(v))) as Record<string, number>) : {};

/** The same check for a digest arriving from a producer (`snapshot write` reads it off stdin):
 *  the shape is verified FIELD BY FIELD against `ScriptsDigest`, and an unknown `v` or
 *  `collected` still refuses the whole digest — but within a known version, a wrong-typed list,
 *  entry or timers field is dropped, never propagated to a consumer that would crash on it. */
export function asScriptsDigest(input: unknown): ScriptsDigest | undefined {
  if (!isObj(input)) return undefined;
  const raw = input;
  if (typeof raw.v !== "number" || raw.v < 1 || raw.v > SCRIPTS_VERSION) return undefined;
  if (raw.collected !== "cdp" && raw.collected !== "dom" && raw.collected !== "none") return undefined;
  const out: ScriptsDigest = { v: raw.v, collected: raw.collected, caps: countsOf(raw.caps) };
  if (isStr(raw.why)) out.why = raw.why;
  if (isNum(raw.windowMs)) out.windowMs = raw.windowMs;
  if (isNum(raw.idleMs)) out.idleMs = raw.idleMs;
  const listeners = listField<NonNullable<ScriptsDigest["listeners"]>>(raw.listeners, LISTENER_OK);
  const delegated = listField<NonNullable<ScriptsDigest["delegated"]>>(raw.delegated, DELEGATED_OK);
  const inline = listField<NonNullable<ScriptsDigest["inline"]>>(raw.inline, INLINE_OK);
  const ariaMutations = listField<NonNullable<ScriptsDigest["ariaMutations"]>>(raw.ariaMutations, ARIA_MUTATION_OK);
  const liveRegions = listField<NonNullable<ScriptsDigest["liveRegions"]>>(raw.liveRegions, LIVE_REGION_OK);
  const updates = listField<NonNullable<ScriptsDigest["updates"]>>(raw.updates, UPDATE_OK);
  const motion = listField<NonNullable<ScriptsDigest["motion"]>>(raw.motion, MOTION_OK);
  const animations = listField<NonNullable<ScriptsDigest["animations"]>>(raw.animations, ANIMATION_OK);
  const resources = listField<NonNullable<ScriptsDigest["resources"]>>(raw.resources, RESOURCE_OK);
  const truncated = countsOf(raw.truncated);
  return {
    ...out,
    ...(listeners ? { listeners } : {}),
    ...(delegated ? { delegated } : {}),
    ...(inline ? { inline } : {}),
    ...(ariaMutations ? { ariaMutations } : {}),
    ...(liveRegions ? { liveRegions } : {}),
    ...(updates ? { updates } : {}),
    ...(motion ? { motion } : {}),
    ...(animations ? { animations } : {}),
    ...(resources ? { resources } : {}),
    // The timers fields are read together (`.length` on the arrays beside the counters), so a
    // half-valid timers object would be read as "no timers" — a statement of evidence, not the
    // absence of one. It is dropped WHOLESALE when any field is missing or of the wrong type.
    ...(TIMERS_OK(raw.timers) ? { timers: raw.timers as NonNullable<ScriptsDigest["timers"]> } : {}),
    // The truncated counts are evidence-bearing only when non-empty; an all-invalid or
    // non-object `truncated` simply says nothing was capped.
    ...(Object.keys(truncated).length ? { truncated } : {}),
  };
}

/** The screenshot a READER of the report should see for a page: the whole page when the
 *  producer took it, the viewport otherwise; undefined when there is none. */
export function pageScreenshot(pagesDir: string, id: string): string | undefined {
  for (const f of ["screen-full.png", "screen.png"]) {
    const p = join(pagesDir, id, f);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/** Every snapshot under `<root>/.ultra11y/pages`, id-sorted. Unreadable ones are skipped
 *  (never fatal) — a single broken producer run must not blind the whole report. */
export function readSnapshots(root: string): Snapshot[] {
  const base = join(root, PAGES_DIR);
  let dirs: string[];
  try {
    dirs = readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const out: Snapshot[] = [];
  for (const d of dirs.sort()) {
    const s = readSnapshot(join(base, d));
    if (s) out.push(s);
  }
  return out;
}

// ---- the join, verified -----------------------------------------------------------------

/** Index a style digest by document-order ordinal against the snapshot's own DOM, VERIFYING
 *  each entry's tag. Returns null when anything is out of step — a digest collected from a
 *  different DOM than the one serialized must be refused wholesale, because a silently
 *  shifted index would attribute one element's colour to another and manufacture a
 *  non-conformity out of nothing. */
export function alignedStyles(dom: string, styles: StyleDigest): Map<number, StyleEntry> | null {
  const doc = parseHtml(dom, "snapshot");
  const out = new Map<number, StyleEntry>();
  for (const e of styles.entries) {
    const el = doc.elements[e.i];
    if (!el || el.tag !== e.tag) return null;
    out.set(e.i, e);
  }
  return out;
}

/** Same verified join for bounding boxes.
 *
 *  `doc` is optional and purely an economy: a caller that has already parsed this very `dom`
 *  passes it rather than paying for a second parse of a whole page (src/evidence.ts needs the
 *  same tree to map source offsets to ordinals). The join itself has ONE definition either
 *  way — that is the point of this function, and of `align` beside it. */
export function alignedBoxes(dom: string, boxes: BoxDigest, doc?: Doc): Map<number, BoxEntry> | null {
  const parsed = doc ?? parseHtml(dom, "snapshot");
  const out = new Map<number, BoxEntry>();
  for (const e of boxes.entries) {
    const el = parsed.elements[e.i];
    if (!el || el.tag !== e.tag) return null;
    out.set(e.i, e);
  }
  return out;
}

// ---- the browser-side collector ----------------------------------------------------------

// Lives in its own LEAF module (src/collector.ts) so the published test-runner plugins can
// import it without dragging the parser — and therefore the whole engine — into a browser
// bundle. Re-exported here because this is where every reader looks for it.
export {
  COLLECTED_CSS,
  COLLECT_MAX_ELEMENTS,
  COLLECT_SNAPSHOT,
  FULL_SCREENSHOT_MAX_HEIGHT,
  LOADING_STATE,
  LOADING_TIMEOUT_MS,
  waitForLoaded,
} from "./collector.js";

// ---- attaching signals to a parsed Doc ---------------------------------------------------

/** Is this file a page snapshot's serialized DOM? */
export function isSnapshotDom(file: string): boolean {
  const posix = file.split("\\").join("/");
  return posix.endsWith("/dom.html") && posix.includes(`${PAGES_DIR}/`);
}

/** The page id a snapshot's `dom.html` path carries, or undefined when the path is not one.
 *
 *  THE PATH IS PROVENANCE. `writeSnapshot` puts the page id in the directory name and repeats it
 *  in the DOM's capture comment; the comment is what normally carries identity into
 *  `Finding.page`. But the comment is only written by THIS engine — the on-disk layout is a
 *  published contract (skills/ultra11y/references/pages.md), so a producer may write `meta.json`
 *  and a raw `dom.html` and never emit it — and a finding re-read from a committed audit.json has
 *  no comment to consult at all, only the file path it was raised on. Recovering the id from the
 *  path is therefore the one route that works in both cases.
 *
 *  Everything here is deliberately strict, because the id it returns becomes a page attribution:
 *  the segment pair comes from PAGES_DIR rather than from literals (one definition, no drift), the
 *  LAST occurrence wins (a repo may itself live under a path containing `.ultra11y/pages`), and
 *  the candidate must satisfy the same `ID_RE` a producer's meta.json is held to — so a stray
 *  directory can never invent a page. Callers must still check the id is in scope before
 *  attributing: see honesty rule 1 in src/pages.ts. */
export function snapshotPageId(file: string | undefined): string | undefined {
  if (!file) return undefined;
  const segs = file.split("\\").join("/").split("/");
  const marker = PAGES_DIR.split("/"); // [".ultra11y", "pages"] — never spelled out here
  // Layout is fixed: …/<marker…>/<id>/dom.html, so the tail is the only place to look.
  if (segs.length < marker.length + 2) return undefined;
  if (segs[segs.length - 1] !== "dom.html") return undefined;
  const idAt = segs.length - 2;
  for (let i = 0; i < marker.length; i++) if (segs[idAt - marker.length + i] !== marker[i]) return undefined;
  const id = segs[idAt];
  return id !== undefined && ID_RE.test(id) ? id : undefined;
}

/** Verify a digest's entries against a parsed document by document-order ordinal, returning
 *  the index or null. Shared by styles and boxes: the entry repeats its tag, so a digest
 *  collected from a DIFFERENT DOM than the one serialized is caught and refused WHOLESALE.
 *  Refusing everything is the point — a silently shifted index would attribute one element's
 *  colour to another and manufacture a non-conformity out of nothing. */
function align<T extends { i: number; tag: string }>(doc: Doc, entries: T[]): Map<number, T> | null {
  const out = new Map<number, T>();
  for (const e of entries) {
    const el = doc.elements[e.i];
    if (!el || el.tag !== e.tag) return null;
    out.set(e.i, e);
  }
  return out;
}

/** Load and verify the signals sitting beside a snapshot's `dom.html`, and attach them to the
 *  Doc. A no-op for any other file, and for a snapshot whose signals do not verify — in which
 *  case the rendered rules simply do not fire and their criteria stay `manual`, which is the
 *  honest outcome (never a guess, never a silent conformity). */
export function attachSignals(doc: Doc): void {
  if (!isSnapshotDom(doc.file)) return;
  const dir = dirname(doc.file);
  const styles = readJson<StyleDigest>(join(dir, "styles.json"));
  const boxes = readJson<BoxDigest>(join(dir, "boxes.json"));
  const axtree = readJson<AxNode>(join(dir, "axtree.json"));
  const css = readJson<CssDigest>(join(dir, "css.json"));
  const meta = readJson<{ doctype?: string; loading?: unknown }>(join(dir, "meta.json"));
  const loading = Array.isArray(meta?.loading) ? meta.loading.filter((m): m is string => typeof m === "string") : [];
  const probes = readJson<SnapshotProbes>(join(dir, "probes.json"));
  const axe = readJson<NonNullable<RenderSignals["axe"]>>(join(dir, "axe.json"));
  const scripts = readScripts(dir);
  const shot = join(dir, "screen.png");

  const alignedStyleMap = styles ? align(doc, styles.entries) : null;
  const alignedBoxMap = boxes ? align(doc, boxes.entries) : null;
  const truncated = Boolean(styles?.truncated || boxes?.truncated);

  const signals: RenderSignals = {
    ...(alignedStyleMap ? { styles: alignedStyleMap } : {}),
    ...(alignedBoxMap ? { boxes: alignedBoxMap } : {}),
    ...(axtree ? { axtree } : {}),
    // Not element-indexed, so it needs no alignment — it is a property of the stylesheet.
    ...(css ? { css } : {}),
    ...(existsSync(shot) ? { screenshot: shot } : {}),
    ...(meta?.doctype !== undefined ? { doctype: meta.doctype } : {}),
    ...(probes ? { probes } : {}),
    ...(axe ? { axe } : {}),
    // Not aligned wholesale like the styles: its reader verifies each entry's tag against the
    // DOM, because an element the page created during the window legitimately has no ordinal.
    ...(scripts ? { scripts } : {}),
    ...(truncated ? { truncated } : {}),
    ...(loading.length ? { capturedLoading: loading } : {}),
  };
  if (Object.keys(signals).length) doc.signals = signals;
}
