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
//     screen.png    full-page screenshot (pixel tier)
//
// `dom.html` is deliberately an ORDINARY capture: it carries the same
// `<!-- ultra11y:capture … -->` provenance comment the unit-test harvester writes, so the
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
import { formatCaptureComment } from "./capture.js";
import { parseHtml } from "./parse/html.js";
import type { Doc } from "./parse/html.js";
import type { AxNode, BoxDigest, BoxEntry, CssDigest, RenderSignals, StyleDigest, StyleEntry } from "./types.js";

export type { AxNode, BoxDigest, BoxEntry, CssDigest, RenderSignals, StyleDigest, StyleEntry };

export const SNAPSHOT_VERSION = 1;

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
  /** The three stresses applied to a FILLED input, each folding onto the criterion its own
   *  stress evidences (320px reflow 1.4.10, 200% zoom 1.4.4, text spacing 1.4.12). */
  inputOverflowReflow?: { selector: string; html: string; detail: string }[];
  inputOverflowZoom?: { selector: string; html: string; detail: string }[];
  inputOverflowSpacing?: { selector: string; html: string; detail: string }[];
  reflow?: { horizontalScroll: boolean };
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
  /** Path of the screenshot on disk, relative to the snapshot dir. Set on READ. */
  screenshot?: string;
  /** The screenshot's bytes, base64, as a producer hands them over. Set on WRITE — a
   *  producer holds bytes, not a path. `writeSnapshot` turns it into `screen.png`. */
  screenshotBase64?: string;
}

/** What the browser-side collector (`COLLECT_SNAPSHOT`) returns. Every snapshot producer —
 *  the E2E fixtures, the dev side-car, `scan` — evaluates that one string and gets this
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
  if (m.sources !== undefined && (!Array.isArray(m.sources) || m.sources.some((s) => typeof s !== "string")))
    err("meta.sources", "sources must be an array of strings");

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
  const shot = join(dir, "screen.png");
  return {
    meta: v.meta,
    dom,
    ...(styles ? { styles } : {}),
    ...(boxes ? { boxes } : {}),
    ...(axtree ? { axtree } : {}),
    ...(css ? { css } : {}),
    ...(probes ? { probes } : {}),
    ...(axe ? { axe } : {}),
    ...(existsSync(shot) ? { screenshot: "screen.png" } : {}),
  };
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
export { COLLECTED_CSS, COLLECT_MAX_ELEMENTS, COLLECT_SNAPSHOT } from "./collector.js";

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
  const meta = readJson<{ doctype?: string }>(join(dir, "meta.json"));
  const probes = readJson<SnapshotProbes>(join(dir, "probes.json"));
  const axe = readJson<NonNullable<RenderSignals["axe"]>>(join(dir, "axe.json"));
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
    ...(truncated ? { truncated } : {}),
  };
  if (Object.keys(signals).length) doc.signals = signals;
}
