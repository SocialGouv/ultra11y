import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  AuditResult,
  AxeEngineInfo,
  DocumentAudit,
  DynamicEngine,
  DynamicFinding,
  DynamicResult,
  Finding,
  Lang,
  ReflowClipped,
  SamplePage,
  ScanRedirect,
  Severity,
} from "./types.js";
import { isAdjudicated } from "./types.js";
import { mergeDocumentAudit } from "./documents.js";
import { lineStartsOf, lineColAt } from "./parse/html.js";
import { allGuidelines } from "./wcag.js";
import { PROBE_SEVERITY, PROBE_WCAG, axeNodeTreatment, scForAxe } from "./axe-map.js";
import { unionAxeEngines } from "./axe-engine.js";
import { parseSitemapUrls, crawlUrls, crawlBound, nameFromUrl } from "./crawl.js";
import {
  PAGES_DIR,
  SNAPSHOT_VERSION,
  slugifyPageId,
  validateSnapshotMeta,
  writeSnapshot,
  type CollectedPage,
  type SnapshotMeta,
  type SnapshotProbes,
} from "./snapshot.js";
import { resolveMessage } from "./messages.js";
import { PROBES_VERSION, reflowClippedParams } from "./probes.js";
import { today } from "./util.js";
import { findingId } from "./baseline.js";

/** Snapshot findings are repository artefacts, not checkout-local files. `audit` may ingest
 * them as `.ultra11y/pages/...` while a following `scan --cwd "$PWD"` sees an absolute path;
 * treating those as different findings doubled a one-pass crawl from 850 to 1,348 findings. */
const portableFindingId = (finding: Finding): string => {
  const posix = finding.file.replace(/\\/g, "/");
  const marker = `${PAGES_DIR}/`;
  const at = posix.lastIndexOf(marker);
  return findingId(at >= 0 ? { ...finding, file: posix.slice(at) } : finding);
};

/** One observation from a residual-criteria probe (local runtime only). */
export interface ProbeHit {
  selector: string;
  html: string;
  detail: string;
}

/** The selectors of the boxes a 320px reflow probe found widening the page, as one phrase — or
 *  undefined when the producer did not look (an older runner output or snapshot) or found no
 *  box to name. A cause is only ever stated when it was measured. */
export function reflowWidening(reflow: { widening?: { selector: string }[] } | undefined): string | undefined {
  const sels = (reflow?.widening ?? []).map((w) => w.selector).filter(Boolean);
  return sels.length ? sels.join(", ") : undefined;
}

export interface RunnerOutput {
  url: string;
  violations: { id: string; impact: string | null; help: string; tags?: string[]; nodes: { target: string[]; html: string }[] }[];
  /** The axe-core build that produced `violations` (src/axe-engine.ts). */
  axe?: AxeEngineInfo;
  /** `widening`: the outermost boxes wider than the viewport, when the producer looked. */
  reflow: { horizontalScroll: boolean; widening?: ProbeHit[]; clipped?: ReflowClipped };
  // Residual-criteria probes — populated by the local runtime (scan-local.ts). Optional so
  // every caller/test that omits them stays valid.
  focusVisible?: ProbeHit[];
  /** 2.4.11 — the component receiving focus entirely hidden behind author-created content. */
  focusObscured?: ProbeHit[];
  reflowZoom?: ProbeHit[];
  textSpacing?: ProbeHit[];
  hover?: ProbeHit[];
  keyboardTrap?: ProbeHit[];
  // Stateful probes (local runtime, interactions ON) — a filled input clipped under each
  // stress, and content updated by a safe interaction outside any live region. Optional,
  // exactly like the residual probes above.
  inputOverflowReflow?: ProbeHit[];
  inputOverflowZoom?: ProbeHit[];
  inputOverflowSpacing?: ProbeHit[];
  liveRegion?: ProbeHit[];
  // Journey observations (`journey run`, src/journey-run.ts) — absent from every scan.
  keyboardUnreachable?: ProbeHit[];
  dialogFocus?: ProbeHit[];
  errorUnassociated?: ProbeHit[];
  // WHICH SUCCESS CRITERIA THIS RUN ACTUALLY MEASURED ON THIS PAGE — the load-bearing half.
  //
  // A probe array is silent for two different reasons: the probe ran and found nothing, or the
  // probe never ran (no keyboard, a viewport that would not resize, a budget spent). Only the
  // first is a measurement, and `renderedProvesOn` (src/coverage.ts) reads exactly this list
  // to decide whether silence may be read as conformity. A criterion whose probe was skipped
  // must never appear here.
  probed?: string[];
  // Why a probe did not run, when it did not. Carried for the report and the log, never for a
  // verdict: it is the complement of `probed`, not a second source of truth.
  skipped?: { sc: string; why: string }[];
  // The PRISTINE page as the browser built it (COLLECT_SNAPSHOT + a viewport screenshot,
  // base64). Absent when snapshotting was off or the collection failed — in which case the
  // page keeps its findings but earns no snapshot, and therefore no conforming-by-silence.
  /** `screenshotFull`: the whole page, height-bounded, beside the viewport shot (#135). */
  /** `screenshot320`: the page at the 320px reflow viewport, as the probe measured it (#184). */
  snapshot?: CollectedPage & { screenshot?: string; screenshotFull?: string; screenshot320?: string };
  // WHERE the browser was when the measurement started — read right after goto + settle,
  // before any probe could click something that routes. `url` above is read at the END and
  // is the address the run finished on; only this one is the identity of what was audited.
  // Optional: absent from a RunnerOutput that predates it.
  landedUrl?: string;
  // The navigation's HTTP status. A framework can answer 404/500 with a full document at the
  // requested URL (Next's `notFound()`), which no URL comparison can detect. Absent for
  // `file://` — absent is never treated as a failure.
  httpStatus?: number;
}

/** The page id for a scanned target. A served URL slugifies from its PATH, which is the
 *  identity a reader recognises (`/nous-contacter` → `nous-contacter`). A local HTML file
 *  has no meaningful path — slugifying it would name the directory after the absolute path
 *  on whoever's machine ran the scan — so it slugifies from the FILE NAME instead. */
function pageIdFor(url: string): string {
  const isUrl = /^https?:\/\//i.test(url);
  if (isUrl) return slugifyPageId(url);
  const base = url.split(/[\\/]/).pop() ?? url;
  return slugifyPageId(base.replace(/\.x?html?$/i, "")) || "page";
}

/** The runner's probe results, in the shape the snapshot format publishes.
 *
 *  A straight projection — no filtering, no inference. `probed` arrives from the producer
 *  because the producer is the only thing that knows whether a probe ran at all: a caller
 *  reading `textSpacing: []` cannot tell "measured, nothing clipped" from "never applied the
 *  override".
 *
 *  THE STATEFUL FAMILIES RIDE ALONG TOO, which they did not use to. The objection was that they
 *  measure a page that has been TYPED INTO while the snapshot beside them is the pristine one —
 *  true, and an attribution point. But `probed` credits their criteria either way, so leaving
 *  them out did not make the record more careful: it made a run that had OBSERVED a clipped
 *  value or an unannounced status message publish conformity on it. A finding attached to the
 *  right page and the wrong DOM state is a citation an auditor can check; a finding thrown away
 *  is a conformity nobody can. */
function probesOf(out: RunnerOutput): SnapshotProbes {
  return {
    ...(out.focusVisible ? { focusVisible: out.focusVisible } : {}),
    // The two families this projection used to drop. They are not stateful — both come out of
    // the ONE walk of the pristine tab ring, before any fill or click — so they describe the
    // very document persisted beside them. Dropping them while still writing `probed` is what
    // turned a measured keyboard trap into a silent `C`.
    ...(out.focusObscured ? { focusObscured: out.focusObscured } : {}),
    ...(out.keyboardTrap ? { keyboardTrap: out.keyboardTrap } : {}),
    ...(out.hover ? { hover: out.hover } : {}),
    ...(out.reflowZoom ? { reflowZoom: out.reflowZoom } : {}),
    ...(out.textSpacing ? { textSpacing: out.textSpacing } : {}),
    ...(out.liveRegion ? { liveRegion: out.liveRegion } : {}),
    ...(out.inputOverflowReflow ? { inputOverflowReflow: out.inputOverflowReflow } : {}),
    ...(out.inputOverflowZoom ? { inputOverflowZoom: out.inputOverflowZoom } : {}),
    ...(out.inputOverflowSpacing ? { inputOverflowSpacing: out.inputOverflowSpacing } : {}),
    ...(out.keyboardUnreachable?.length ? { keyboardUnreachable: out.keyboardUnreachable } : {}),
    ...(out.dialogFocus?.length ? { dialogFocus: out.dialogFocus } : {}),
    ...(out.errorUnassociated?.length ? { errorUnassociated: out.errorUnassociated } : {}),
    reflow: out.reflow,
    // The contract this file is written under, so a future reader knows what `probed` means
    // here (src/probes.ts PROBES_VERSION).
    v: PROBES_VERSION,
    probed: out.probed ?? [],
    // The complement of `probed`, persisted for the same reason: a report reading this
    // snapshot later must be able to say WHY a criterion was not measured here.
    ...(out.skipped?.length ? { skipped: out.skipped } : {}),
  };
}

/** Persist a runner's collected page as a snapshot under `<root>/.ultra11y/pages/<id>/`,
 *  returning the page id — or undefined when there was nothing to write.
 *
 *  This is what turns `scan` from a findings-only pass into a producer of the durable
 *  artefact: without it a URL-scanned page is `basis: "attributed"` (src/pages.ts), its
 *  criteria can never leave `?`, and a whole sitemap-driven audit yields an empty per-page
 *  grid. The browser is already on the page — collecting it costs one `evaluate`.
 *
 *  Nothing here is fatal: a page that cannot be persisted is simply not a snapshot. */
export function writeRunnerSnapshot(
  root: string,
  out: RunnerOutput,
  target: string,
  page?: SamplePage,
  extra: { runner?: string; journey?: SnapshotMeta["journey"] } = {},
): string | undefined {
  const collected = out.snapshot;
  if (!collected?.dom) return undefined;
  // Cite what a reader can open: the host path for a file scan, the served URL otherwise —
  // the same mapping the findings get, so a page and its findings never disagree on where
  // they are.
  const url = page?.url ?? hostPageOf(out.url ?? collected.url, target);
  const id = page?.id ?? pageIdFor(url);
  // A BLANK <title> IS NOT A NAME, and reading it as one dropped the page entirely.
  //
  // `document.title` is `""` — not undefined — on a page whose <title> is empty, so `??` kept
  // it, `validateSnapshotMeta` refused the meta for an empty `name`, and this function
  // returned undefined. No snapshot, no page in `scope.pages`, no column in the grid, and
  // NOTHING SAID SO: the drop is not a redirect, so it never reached `redirected` either.
  //
  // The page it silently swallowed is the one carrying RGAA 8.5 / WCAG 2.4.2 — an empty
  // <title> is exactly that non-conformity — so the deliverable lost the page it was about to
  // fail, and came back shorter instead of louder. Measured on tests/fixtures/realworld:
  // nine pages crawled, eight snapshots written, no warning.
  //
  // `nameFromUrl` is the repository's existing answer to "this document names itself nothing"
  // (src/crawl.ts), and it reads as a name — « Mentions legales » rather than the raw
  // `mentions-legales-html` slug.
  const name = page?.name?.trim() || collected.title?.trim() || nameFromUrl(url);
  const meta: SnapshotMeta = {
    v: SNAPSHOT_VERSION,
    id,
    name,
    url,
    runner: extra.runner ?? "scan",
    ...(extra.journey ? { journey: extra.journey } : {}),
    ...(collected.viewport ? { viewport: collected.viewport } : {}),
    // The doctype, which `dom` cannot carry: `documentElement.outerHTML` starts at <html>.
    // The collector reads it and every OTHER producer forwards it; this one dropped it, so a
    // scanned page arrived with the field absent — "nobody looked" — and RGAA 8.1 stayed « à
    // évaluer » on exactly the pages a browser had just opened. Same shape of defect as the
    // probes/axe drop this function used to have: measured, then thrown away on the way out.
    ...(collected.doctype !== undefined ? { doctype: collected.doctype } : {}),
    ...(page?.auth !== undefined ? { auth: page.auth } : {}),
    ...(page?.notes ? { notes: page.notes } : {}),
    // The sample's `sources` are the one declared link between a page and the code that renders
    // it: `attributePages` uses them to put a SOURCE finding on its page, and the capture comment
    // cites the first as the component behind the DOM. Forwarding auth and notes but not these
    // left every source finding of a scanned sample « on no page » — the report could say which
    // URL a defect was measured on, never which URL the code defect lives on.
    ...(page?.sources?.length ? { sources: page.sources } : {}),
    // Still loading when the browser collected it (#135): the report says so, and the audit
    // concludes nothing from this page's silence.
    ...(collected.loading?.length ? { loading: collected.loading } : {}),
    // Captured without consent (#184): the placeholders it showed are named, and the briefs
    // tag what was harvested inside them « état sans consentement ».
    ...(collected.consent?.length ? { consent: "none" as const, consentMarkers: collected.consent } : {}),
  };
  // The producer is untrusted input even when it is us: a page id becomes a directory name.
  const v = validateSnapshotMeta(meta);
  if (!v.ok || !v.meta) return undefined;
  try {
    writeSnapshot(root, {
      meta: v.meta,
      dom: collected.dom,
      ...(collected.styles ? { styles: collected.styles } : {}),
      ...(collected.boxes ? { boxes: collected.boxes } : {}),
      ...(collected.css ? { css: collected.css } : {}),
      // WHAT THE BROWSER MEASURED, PERSISTED BESIDE WHAT IT SERIALIZED.
      //
      // The browser is the only place these answers exist, and the audit that folds them runs
      // later, in another process, over the whole `.ultra11y/pages` tree — a measurement that
      // lives only in this process's memory decides nothing. Dropping them is what made a
      // scanned page able to report a rendering violation and never able to conclude
      // conformity: `renderedProvesOn` reads `pageCoverage.scs` / `.axe`, and both are derived
      // from these two files alone.
      //
      // `probed` gates the lot. Written unconditionally when the producer reported one — an
      // empty list is a real statement ("nothing was measured here"), and omitting the file
      // instead would be indistinguishable from a producer that predates the field.
      ...(out.probed ? { probes: probesOf(out) } : {}),
      // `ran: true` is the axe counterpart of `probed`: the pass happened, so its silence on
      // the criteria AXE_DECIDES is usable. A RunnerOutput always carries `violations` because
      // a runner always runs axe — that is the one instrument neither runtime skips.
      axe: { violations: out.violations, ran: true, ...(out.axe ? { engine: out.axe } : {}) },
      // What the page's scripts did during the capture window (#190). Written whatever it says —
      // `collected: "none"` included: a producer that looked and could not is not one that never
      // looked. The journey runner (#189) goes through this same function, so it only has to set
      // `snapshot.scripts` from src/behaviour.ts to write the same file.
      ...(collected.scripts ? { scripts: collected.scripts } : {}),
      // The accessibility tree (and, derived from it by writeSnapshot, the screen-reader digest)
      // and the media probe (#208). Same rule as the probes: measured here, persisted here.
      ...(collected.axtree ? { axtree: collected.axtree } : {}),
      ...(collected.media ? { media: collected.media } : {}),
      ...(collected.screenshot ? { screenshotBase64: collected.screenshot } : {}),
      ...(collected.screenshotFull ? { screenshotFullBase64: collected.screenshotFull } : {}),
      ...(collected.screenshot320 ? { screenshot320Base64: collected.screenshot320 } : {}),
    });
  } catch {
    return undefined;
  }
  return v.meta.id;
}

// RunnerOutput key ↔ probe engine, so an output with no probe arrays folds to axe +
// reflow alone and each probe array adds its residual-criteria findings.
const PROBE_FIELDS: { key: keyof RunnerOutput; engine: Exclude<DynamicEngine, "axe" | "reflow"> }[] = [
  { key: "focusVisible", engine: "focus-visible" },
  { key: "focusObscured", engine: "focus-obscured" },
  { key: "reflowZoom", engine: "reflow-zoom" },
  { key: "textSpacing", engine: "text-spacing" },
  { key: "hover", engine: "hover" },
  { key: "keyboardTrap", engine: "keyboard-trap" },
  { key: "inputOverflowReflow", engine: "input-overflow-reflow" },
  { key: "inputOverflowZoom", engine: "input-overflow-zoom" },
  { key: "inputOverflowSpacing", engine: "input-overflow-spacing" },
  { key: "liveRegion", engine: "live-region" },
  { key: "keyboardUnreachable", engine: "keyboard-unreachable" },
  { key: "dialogFocus", engine: "dialog-focus" },
  { key: "errorUnassociated", engine: "error-unassociated" },
];

/** Map the runner's reported page back to a HOST-meaningful citation: the container mount
 *  (`/work/input.html`) and a `file://` URL both resolve to the host file we scanned; a
 *  real served URL (http/https) is kept as-is. This is what lets a dynamic finding cite a
 *  path a reader (and `verify --semantic`) can actually open, instead of `/work/input.html`. */
function hostPageOf(url: string | undefined, target: string): string {
  if (!url) return target;
  if (url.startsWith("file://")) {
    try {
      return fileURLToPath(url);
    } catch {
      return target;
    }
  }
  return url; // a real served URL — no host file to map to
}

export function toDynamicResult(out: RunnerOutput, target: string, lang: Lang = "en", engine = "axe-core@playwright"): DynamicResult {
  const page = hostPageOf(out.url, target);
  const findings: DynamicFinding[] = [];
  for (const v of out.violations) {
    const criteriaId = scForAxe(v.id, v.tags);
    for (const n of v.nodes.length ? v.nodes : [{ target: [], html: "" }]) {
      // A best-practice-only axe violation (no `wcag<digits>` tag) evidences no testable SC
      // → fold as an advisory recommendation, never a criterion NC (e.g. empty-table-header).
      // Decided per NODE: some rules need the element to tell a weak name from no name (#117).
      const { severity, advisory } = axeNodeTreatment(v.id, v.tags, v.impact, n.html);
      findings.push({
        criteriaId,
        axeRule: v.id,
        impact: v.impact ?? "minor",
        severity,
        message: `${v.help} (axe: ${v.id})`,
        selector: n.target.join(" ") || "—",
        snippet: n.html,
        engine: "axe",
        page,
        ...(advisory ? { advisory: true } : {}),
      });
    }
  }
  if (out.reflow?.horizontalScroll) {
    // THE CAUSE, NOT JUST THE SYMPTOM: the probe names the boxes wider than the viewport, and
    // the finding is anchored on the first of them — the element a developer has to change.
    const widening = reflowWidening(out.reflow);
    const first = out.reflow.widening?.[0];
    // …AND WHETHER ANY CONTENT IS OUT OF REACH (#184): a box that overflows with its text in
    // view is not the same finding as text laid out past the edge, and the sentence says which.
    const clipped = reflowClippedParams(out.reflow.clipped);
    findings.push({
      criteriaId: "1.4.10",
      axeRule: "reflow",
      impact: "serious",
      severity: "majeur",
      message: resolveMessage({ message: "", msg: { id: "dyn-reflow", params: { ...(widening ? { widening } : {}), ...clipped } } }, lang),
      selector: first?.selector || "document",
      snippet: first?.html ?? "",
      engine: "reflow",
      page,
      ...(widening ? { widening } : {}),
      ...(clipped.clippedText !== undefined ? { clippedText: clipped.clippedText, clippedControls: clipped.clippedControls } : {}),
      ...(clipped.clippedCapped !== undefined ? { clippedCapped: clipped.clippedCapped } : {}),
    });
  }
  // Residual-criteria probes (local runtime). Each hit the probe OBSERVED becomes a
  // definite NC on the SC it evidences; an absent/empty array contributes nothing.
  for (const { key, engine: probe } of PROBE_FIELDS) {
    const hits = out[key] as ProbeHit[] | undefined;
    if (!hits) continue;
    const severity = PROBE_SEVERITY[probe];
    for (const h of hits) {
      findings.push({
        criteriaId: PROBE_WCAG[probe],
        axeRule: probe,
        impact: severity === "majeur" ? "serious" : "minor",
        severity,
        message: h.detail,
        selector: h.selector || "—",
        snippet: h.html ?? "",
        engine: probe,
        page,
      });
    }
  }
  return { tool: "ultra11y", engine, target, date: today(), findings, ...(out.axe ? { axe: out.axe } : {}) };
}

/** Fetch a URL's served HTML (zero-dep, Node global fetch), with the address it was served
 *  from after redirects — the base its links resolve against. Empty on error. */
async function fetchHtml(url: string): Promise<{ html: string; url: string }> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { html: "", url };
    return { html: await res.text(), url: res.url || url };
  } catch {
    return { html: "", url };
  }
}

export interface DiscoverOpts {
  sitemap?: string; // sitemap.xml URL — scan every <loc>
  crawl?: string; // start URL — BFS the served HTML for same-origin links
  depth?: number; // crawl: link hops from the start URL  (absent or 0 ⇒ unbounded)
  max?: number; // cap on pages scanned                  (absent or 0 ⇒ unbounded)
  /** Progress, forwarded to `crawlUrls`. An unbounded sweep must say what it is doing. */
  onPage?: (url: string, n: number) => void;
}

/** Resolve the page URLs to scan from a sitemap or by crawling (zero-dep).
 *
 *  Unbounded unless the caller bounds it (`crawlBound`): a sweep that silently stopped at 50
 *  pages produced a report that was merely SHORTER than the site, and a shorter deliverable
 *  reads exactly like a complete one. */
export async function discoverUrls(opts: DiscoverOpts): Promise<string[]> {
  const max = crawlBound(opts.max);
  if (opts.sitemap) {
    const urls = parseSitemapUrls((await fetchHtml(opts.sitemap)).html);
    const kept = Number.isFinite(max) ? urls.slice(0, max) : urls;
    kept.forEach((u, i) => opts.onPage?.(u, i + 1));
    return kept;
  }
  if (opts.crawl) {
    return crawlUrls(opts.crawl, { fetchHtml, depth: opts.depth, max: opts.max, ...(opts.onPage ? { onPage: opts.onPage } : {}) });
  }
  return [];
}

/** Stamp each dynamic finding with its originating sample page's provenance (id/name/auth/
 *  notes) so `mergeDynamic` can carry it onto the Finding for ticket rendering. Shared by
 *  the sample runners. Mutates + returns the findings. */
export function tagSampleFindings(findings: DynamicFinding[], page: SamplePage): DynamicFinding[] {
  for (const f of findings) {
    f.sample = { id: page.id, name: page.name, ...(page.auth !== undefined ? { auth: page.auth } : {}), ...(page.notes ? { notes: page.notes } : {}) };
  }
  return findings;
}

const sevRank: Record<Severity, number> = { bloquant: 3, majeur: 2, mineur: 1 };

/** Best-effort resolution of an axe outerHTML snippet to a host `file:line` + byte range.
 *  Only file-backed citations resolve (a served-URL scan has no source file). Tries the
 *  exact snippet, then just its opening tag (most likely verbatim), then a
 *  whitespace-normalized line scan. Returns null when nothing matches — the caller then
 *  keeps line 0 and relies on the selector/snippet, never inventing a line. */
function resolveHostAnchor(file: string, snippet: string): { line: number; col: number; start: number; end: number } | null {
  const s = snippet?.trim();
  if (!s || !existsSync(file)) return null;
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const starts = lineStartsOf(source);
  const at = (start: number, len: number) => {
    const { line, col } = lineColAt(starts, start);
    return { line, col, start, end: start + len };
  };
  // 1. exact snippet
  let idx = source.indexOf(s);
  if (idx >= 0) return at(idx, s.length);
  // 2. the opening tag alone (up to and including the first ">") — attributes/text after
  //    it may differ between the rendered DOM and source, the open tag rarely does.
  const openMatch = /^<[^>]*>/.exec(s);
  if (openMatch) {
    idx = source.indexOf(openMatch[0]);
    if (idx >= 0) return at(idx, openMatch[0].length);
  }
  // 3. whitespace-normalized line scan (collapse runs of whitespace on both sides).
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const needle = norm(openMatch ? openMatch[0] : s);
  if (needle) {
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (norm(lines[i]!).includes(needle)) {
        const start = starts[i] ?? 0;
        return { line: i + 1, col: 1, start, end: start + lines[i]!.length };
      }
    }
  }
  return null;
}

/** The `pages` block `scan --merge --json` prints in front of the merged document. A
 *  PRINT-side envelope only — `audit-latest.json` keeps the plain audit schema — under a
 *  top-level key no `--in` reader of the document looks at. */
export interface ScanPageSummary {
  // The declared sample's page count, on a `--sample` run; absent otherwise (a plain
  // URL/sitemap/crawl scan has no sample to be short of).
  sample?: number;
  // Ids of the snapshots the run persisted under `.ultra11y/pages/<id>/`.
  recorded: string[];
  // Pages the scan refused to record, and why (see ScanRedirect).
  refused: Array<{ id: string; reason?: ScanRedirect["reason"] }>;
}

/** What one scan RECORDED and REFUSED, page by page. Without it the merged `--json` output
 *  carries neither: the refusals reach the caller on stderr only, and the recorded ids would
 *  take a listing of `.ultra11y/pages` against the run's start time to recover — exactly the
 *  re-derivation an orchestrator reporting « N pages capturées, M refusées » must not do. */
export function scanPageSummary(dynamic: DynamicResult, sampleSize?: number): ScanPageSummary {
  return {
    ...(sampleSize === undefined ? {} : { sample: sampleSize }),
    recorded: dynamic.snapshots ?? [],
    refused: (dynamic.redirected ?? []).map((r) => ({ id: r.id, reason: r.reason })),
  };
}

/** Two scan runs of one `scan --all-routes` (the sample, then the rest of the inventory) as one
 *  result. The SAMPLE is the first run's alone: the rest of the routes are recorded and audited
 *  as pages, but they never join the declared RGAA sample. */
export function combineDynamic(sample: DynamicResult | undefined, rest: DynamicResult | undefined): DynamicResult {
  if (!sample) return rest!;
  if (!rest) return sample;
  const tested = [...new Set([...(sample.testedScs ?? []), ...(rest.testedScs ?? [])])].sort();
  const snapshots = [...(sample.snapshots ?? []), ...(rest.snapshots ?? [])];
  const redirected = [...(sample.redirected ?? []), ...(rest.redirected ?? [])];
  const axe = sample.axe ?? rest.axe;
  const scanned = [...(sample.scanned ?? []), ...(rest.scanned ?? [])];
  return {
    ...sample,
    target: `${sample.target} + ${rest.target}`,
    findings: [...sample.findings, ...rest.findings],
    ...(tested.length ? { testedScs: tested } : {}),
    ...(snapshots.length ? { snapshots } : {}),
    ...(scanned.length ? { scanned } : {}),
    ...(redirected.length ? { redirected } : {}),
    ...(axe ? { axe } : {}),
  };
}

/** Fold dynamic findings into a static AuditResult: a needs-rendering/manual or
 *  clean criterion that axe flags becomes NC; tallies + conformance recompute. */
export function mergeDynamic(audit: AuditResult, dynamic: DynamicResult, lang: Lang = "en"): AuditResult {
  const merged: AuditResult = JSON.parse(JSON.stringify(audit)) as AuditResult;
  const seenFindings = new Set(merged.findings.map(portableFindingId));
  // Record the normative page sample the dynamic tier ran over (Task 5) — drives the
  // report's « Constats par page » section. Storage-state paths were already dropped upstream.
  if (dynamic.sample) merged.scope.sample = dynamic.sample;
  // Pages the scan refused to record. They are NOT in `sample`, so without this the audit
  // would simply be quietly shorter than the sample the repository declares — and a shorter
  // deliverable that says nothing reads as a complete one. Unioned across merges by id, so a
  // page recovered by a later scan stops being reported as missing.
  if (dynamic.redirected?.length) {
    const byId = new Map((merged.scope.redirected ?? []).map((r) => [r.id, r]));
    for (const r of dynamic.redirected) byId.set(r.id, r);
    const scannedIds = new Set((merged.scope.sample?.pages ?? []).map((p) => p.id));
    const still = [...byId.values()].filter((r) => !scannedIds.has(r.id));
    if (still.length) merged.scope.redirected = still;
    else delete merged.scope.redirected;
  }
  // Record which needs-rendering SCs this scan actually MEASURED (union across merges) —
  // the partial-audit advisory keys on this, so a run that skipped a probe never silently
  // suppresses the banner for the criteria it did not measure.
  if (dynamic.testedScs?.length) {
    const tested = new Set([...(merged.scope.scan?.testedScs ?? []), ...dynamic.testedScs]);
    merged.scope.scan = { testedScs: [...tested].sort() };
  }
  // The axe-core build this scan injected, beside the ones already on record (a capture run, an
  // earlier scan): the report names every engine its axe verdicts came from.
  if (dynamic.axe) merged.scope.axe = unionAxeEngines(merged.scope.axe, [dynamic.axe]);
  const byId = new Map(merged.criteria.map((c) => [c.id, c]));
  const remediation =
    lang === "fr" ? "Vérifié au rendu par axe-core ; corrigez l'élément cité." : "Verified at render time by axe-core; fix the cited element.";

  for (const df of dynamic.findings) {
    const c = byId.get(df.criteriaId);
    if (!c) continue;
    // Catalog id for RE-LOCALIZATION (src/messages.ts): "dyn-reflow" is ultra11y's
    // own bilingual reflow prose; "dyn-remediation" covers axe-core + the residual
    // probes, whose MESSAGE is the engine's own text (never translated — passed
    // through verbatim via params.message) while the REMEDIATION is still ours.
    const msg: { id: string; params?: Record<string, string> } =
      df.engine === "reflow"
        ? (() => {
            const params: Record<string, string> = {
              ...(df.widening ? { widening: df.widening } : {}),
              ...(df.clippedText !== undefined && df.clippedControls !== undefined ? { clippedText: df.clippedText, clippedControls: df.clippedControls } : {}),
              ...(df.clippedCapped !== undefined ? { clippedCapped: df.clippedCapped } : {}),
            };
            return { id: "dyn-reflow", ...(Object.keys(params).length ? { params } : {}) };
          })()
        : { id: "dyn-remediation", params: { message: df.message } };
    const file = df.page ?? dynamic.target;
    // Anchor at a real host file:line by locating the cited outerHTML in the source (R3).
    // selector + snippet are ALWAYS kept as the anchor of last resort; line stays 0 (never
    // a fabricated line) when the snippet resolves nowhere (e.g. a served-URL scan, or DOM
    // that differs from source).
    const anchor = resolveHostAnchor(file, df.snippet);
    const finding: Finding = {
      ruleId: df.engine === "axe" ? `axe:${df.axeRule}` : `dyn-${df.engine}`,
      criteriaId: df.criteriaId,
      file,
      line: anchor?.line ?? 0,
      col: anchor?.col ?? 0,
      selectorHint: df.selector,
      severity: df.severity,
      message: df.message,
      remediation,
      msg,
      snippet: df.snippet,
      ...(anchor ? { sourceStart: anchor.start, sourceEnd: anchor.end } : {}),
      ...(df.advisory ? { advisory: true } : {}),
      // Task 5: carry the sample-page provenance onto the merged Finding so the auditor
      // ticket renders the page name + auth flag + reproduction notes.
      ...(df.sample
        ? {
            sample: {
              page: df.sample.name,
              ...(df.sample.auth !== undefined ? { authRequired: df.sample.auth } : {}),
              ...(df.sample.notes ? { notes: df.sample.notes } : {}),
            },
          }
        : {}),
    };
    const id = portableFindingId(finding);
    if (!seenFindings.has(id)) {
      seenFindings.add(id);
      c.findings.push(finding);
      merged.findings.push(finding);
    }
    // An ADVISORY dynamic finding (best-practice-only axe violation) is attached but never
    // authoritative: it must NOT flip the criterion to NC nor clear its justification, and
    // the criterion stays in residualRisks. A normative dynamic finding behaves as before.
    if (!df.advisory) {
      c.status = "NC"; // a rendered-tool finding is authoritative
      delete c.justification;
    }
  }

  // drop upgraded criteria from residual risks — NORMATIVE findings only (an advisory
  // finding does not decide the criterion, so its residual risk must remain).
  const nowNc = new Set(dynamic.findings.filter((d) => !d.advisory).map((d) => d.criteriaId));
  merged.residualRisks = merged.residualRisks.filter((r) => !nowNc.has(r.criteriaId));

  recomputeTallies(merged);
  return merged;
}

/** Re-derive the per-guideline tallies and the automatic pass rate from the criteria, and
 *  re-sort the findings by severity. Shared by every fold that can change a criterion's
 *  status, so two merges can never disagree on the arithmetic `check` verifies. */
export function recomputeTallies(merged: AuditResult): void {
  merged.guidelines = allGuidelines().map((g) => {
    const inG = merged.criteria.filter((c) => c.guideline === g.number);
    return {
      key: g.number,
      title: g.title,
      c: inG.filter((c) => c.status === "C").length,
      nc: inG.filter((c) => c.status === "NC").length,
      na: inG.filter((c) => c.status === "NA").length,
      manual: inG.filter((c) => c.status === "manual").length,
    };
  });
  // This is the AUTOMATIC pass rate. Agent-confirmed C/NA rows stay out of both numerator
  // and denominator, exactly as adjudication and checkReport define it; agent NC still counts
  // because evidenced failure safely lowers the rate. A later scan merge must not re-credit
  // human/model judgments as automatic checks.
  const decided = merged.criteria.filter((c) => c.status === "NC" || (c.status === "C" && !isAdjudicated(c.decidedBy)));
  const conform = decided.filter((c) => c.status === "C").length;
  merged.conformancePct = decided.length === 0 ? 100 : Math.round((conform / decided.length) * 100);
  merged.findings.sort((a, b) => sevRank[b.severity] - sevRank[a.severity]);
}

/** Fold an audit of the PAGE SNAPSHOTS a scan just wrote into the scan's merged result.
 *
 *  Why this exists. `scan` persists each page it visited, but a snapshot only earns its
 *  page a conforming-by-silence verdict once the STATIC rules have actually run against
 *  that document (src/pages.ts, honesty rule 2). Recording the pages without auditing them
 *  would hand every clean criterion a `C` nobody measured — the one output this tool must
 *  never produce. So the caller audits the freshly written `dom.html` files and folds the
 *  result here.
 *
 *  Re-running the whole audit instead is not an option: the original run's flags (`--jsx`,
 *  `--graph`, `--exclude`, dedup, `--max-files`) are not recorded on the result, so
 *  reconstructing it would silently shrink the audit.
 *
 *  Two fold rules, both mirroring what `finalize` already does across documents:
 *   • a NON-ADVISORY finding on a snapshot makes its criterion NC — a defect on a real
 *     rendered page is authoritative, exactly as a dynamic finding is;
 *   • `NA` + `C` ⇒ `C`. NA means "no relevant element was in scope"; a full rendered
 *     document puts one in scope and it passes. This is the same OR-fold of applicability
 *     the engine performs over its own inputs — never the reverse (a snapshot can add
 *     applicability, never remove it). */
export function mergeSnapshotAudit(base: AuditResult, snap: AuditResult): AuditResult {
  const merged: AuditResult = JSON.parse(JSON.stringify(base)) as AuditResult;
  // The adjudication worklist re-reads `scope.inputs`. Without the snapshot inputs the audit
  // contained rendered findings and page coverage, but its ledger fingerprint was rebuilt
  // from source only — valid verdicts therefore went stale on every fresh CI run.
  const inputIdentity = (input: string) => {
    const posix = input.replace(/\\/g, "/");
    const at = posix.lastIndexOf(PAGES_DIR);
    return at >= 0 ? posix.slice(at) : posix;
  };
  const knownInputs = new Set(base.scope.inputs.map(inputIdentity));
  const snapshotRootCovered = knownInputs.has(PAGES_DIR);
  const addedInputs = snap.scope.inputs.filter((input) => {
    const identity = inputIdentity(input);
    return !knownInputs.has(identity) && !(snapshotRootCovered && identity.startsWith(`${PAGES_DIR}/`));
  });
  merged.scope.inputs = [...base.scope.inputs, ...addedInputs];
  if (addedInputs.length === snap.scope.inputs.length) merged.scope.files = base.scope.files + snap.scope.files;
  merged.scope.langs = [...new Set([...(base.scope.langs ?? []), ...(snap.scope.langs ?? [])])];
  if (!merged.scope.langs.length) delete merged.scope.langs;
  merged.scope.subjectsSeen = [...new Set([...(base.scope.subjectsSeen ?? []), ...(snap.scope.subjectsSeen ?? [])])].sort();
  if (!merged.scope.subjectsSeen.length) delete merged.scope.subjectsSeen;
  const pageSubjects: Record<string, string[]> = { ...(base.scope.pageSubjects ?? {}) };
  for (const [page, subjects] of Object.entries(snap.scope.pageSubjects ?? {})) {
    pageSubjects[page] = [...new Set([...(pageSubjects[page] ?? []), ...subjects])].sort();
  }
  if (Object.keys(pageSubjects).length) merged.scope.pageSubjects = pageSubjects;
  const seenFindings = new Set(merged.findings.map(portableFindingId));
  // The base was a SOURCE audit; the snapshot audit is the run that actually read the pages.
  // Deep-copying only the base's scope would throw that evidence away and downgrade genuinely
  // audited pages to "not-audited" — the inverse of the guard, and a false statement in the
  // opposite direction. Union, so neither half can erase the other's.
  merged.scope.pagesAudited = [...new Set([...(base.scope.pagesAudited ?? []), ...(snap.scope.pagesAudited ?? [])])].sort();
  // …and for the same reason, the COVERAGE the snapshot run recorded. It is the only half that
  // has any: the base read source files, so it measured no page. Dropping it here would leave
  // every rendering criterion « to assess » on pages this run had just probed — the evidence
  // would exist and the projection would have no way to reach it. The snapshot run wins per
  // page (it is the one that measured), and a page only the base knew of keeps its record.
  const cov = { ...(base.scope.pageCoverage ?? {}), ...(snap.scope.pageCoverage ?? {}) };
  if (Object.keys(cov).length) merged.scope.pageCoverage = cov;
  // …and the RUN-WIDE stamp of the same evidence, for the same reason once more.
  //
  // `scope.scan.testedScs` answers "was this criterion measured ANYWHERE in this run?", and it
  // is what `untestedNeedsRendering` reads to decide whether to print « Audit partiel — les
  // critères à restituer n'ont pas été testés ». Dropping it here made a report contradict its
  // own grid: measured on CI over a two-page site, `pageCoverage` carried `axe: true` and all
  // six rendered-* rules on both pages, the per-page grid decided RGAA 3.2, and the banner two
  // paragraphs above still said the text contrast had not been tested.
  //
  // A union, never a replacement: a scan merged earlier in the same run has its own
  // entry, and the snapshot half must add to it rather than speak over it.
  const scs = new Set([...(base.scope.scan?.testedScs ?? []), ...(snap.scope.scan?.testedScs ?? [])]);
  if (scs.size) merged.scope.scan = { testedScs: [...scs].sort() };
  const axeEngines = unionAxeEngines(base.scope.axe, snap.scope.axe);
  if (axeEngines.length) merged.scope.axe = axeEngines;
  const byId = new Map(merged.criteria.map((c) => [c.id, c]));
  const snapById = new Map(snap.criteria.map((c) => [c.id, c]));

  for (const f of snap.findings) {
    const c = byId.get(f.criteriaId);
    if (!c) continue;
    const id = portableFindingId(f);
    if (!seenFindings.has(id)) {
      seenFindings.add(id);
      c.findings.push(f);
      merged.findings.push(f);
    }
    if (!f.advisory) {
      c.status = "NC";
      delete c.inapplicable; // a finding is proof the subject is in scope after all
      delete c.justification;
    }
  }
  // Declarative pack-rule findings live outside the WCAG core verdict; they are carried over
  // untouched so a pack projection sees the snapshot's hits too.
  if (snap.packFindings?.length) {
    const pack = [...(merged.packFindings ?? [])];
    const seenPack = new Set(pack.map(portableFindingId));
    for (const finding of snap.packFindings) {
      const id = portableFindingId(finding);
      if (!seenPack.has(id)) {
        seenPack.add(id);
        pack.push(finding);
      }
    }
    merged.packFindings = pack;
  }

  // Downloadable documents the snapshot run read (the PDFs `scan` fetched from these pages):
  // outside the WCAG verdict like the pack findings, carried over so the report lists them and a
  // pack projection routes their findings.
  //
  // ONE ENTRY PER CONTENT (issue #225): the base audit read `public/documents/formulaire.pdf`
  // from the glob, the snapshot run read the same bytes as `.ultra11y/documents/<sha256>.pdf` —
  // one document, two origins. The snapshot's copy is folded into the base entry (its path goes
  // to `copies`, its URL and linking pages are kept) and every finding is cited on the entry's
  // file, so each defect is reported once per linking page and not once more page-less.
  let folded = false;
  if (snap.documents?.length) {
    const docs = (merged.documents ?? []).map((d) => ({ ...d }));
    const key = (d: DocumentAudit): string => (d.sha256 ? `sha256:${d.sha256}` : `file:${d.file}`);
    const byKey = new Map(docs.map((d) => [key(d), d]));
    for (const d of snap.documents) {
      const into = byKey.get(key(d)) ?? docs.find((x) => x.file === d.file || x.copies?.includes(d.file));
      if (into) {
        mergeDocumentAudit(into, d);
        folded = true;
      } else {
        const copy = { ...d };
        docs.push(copy);
        byKey.set(key(copy), copy);
      }
    }
    merged.documents = docs;
  }
  if (snap.documentFindings?.length || folded) {
    // Any path now a copy of an entry → the file that entry's findings cite.
    const citeOn = new Map<string, string>();
    for (const d of merged.documents ?? []) for (const c of d.copies ?? []) citeOn.set(c, d.file);
    const cite = (f: Finding): Finding => {
      const file = citeOn.get(f.file);
      return file ? { ...f, file } : f;
    };
    // One document raises several findings at the same anchor (its header), once per linking
    // page — so the identity carries the page and the message variant too.
    const docId = (f: Finding): string => `${portableFindingId(f)}|${f.page ?? ""}|${f.msg?.id ?? ""}|${JSON.stringify(f.msg?.params ?? {})}`;
    const list: Finding[] = [];
    const seenDoc = new Set<string>();
    for (const raw of [...(merged.documentFindings ?? []), ...(snap.documentFindings ?? [])]) {
      const finding = cite(raw);
      const id = docId(finding);
      if (!seenDoc.has(id)) {
        seenDoc.add(id);
        list.push(finding);
      }
    }
    // A document now known to be linked from pages has its findings on those pages: the
    // page-less copies the base raised (before anyone knew who links it) would count each defect
    // once more.
    const linked = new Set((merged.documents ?? []).filter((d) => d.pages?.length).map((d) => d.file));
    const kept = list.filter((f) => f.page || !linked.has(f.file));
    if (kept.length) merged.documentFindings = kept;
    else delete merged.documentFindings;
  }

  // A criterion the static pass closed for want of a subject, which the snapshot then MEASURED.
  // Both read `C`, so the discriminator is the FLAG, not the status — and testing the status
  // is exactly what this loop used to do. The snapshot pages have no time-based media either,
  // so they closed 1.2.1 the same way the source did, `C` + `inapplicable`; reading only the
  // status, the merge took that for a measurement and stripped the flag from every criterion
  // both halves had closed for want of a subject.
  //
  // Two things then broke, both silently. The `C` lost the justification that made it
  // falsifiable, becoming the bare uncited conformity this engine refuses everywhere else. And
  // `pageStatus` reads `inapplicable` to hold "a conformity reached for want of a subject
  // holds on every page" — without the flag those criteria fell through to the honesty rule
  // that only `static` criteria earn a verdict by silence, and came back « à évaluer » on
  // EVERY page. Measured on a two-page RGAA crawl: the run reported a complete 106/106 grid
  // while each page carried 10 criteria nobody could ever adjudicate, because there was
  // nothing there to adjudicate.
  for (const c of merged.criteria) {
    if (!c.inapplicable) continue;
    const measured = snapById.get(c.id);
    // Only a snapshot that reached `C` WITHOUT the flag has falsified "nothing of that kind
    // here" — that one looked at the rendered page and found the subject.
    if (measured?.status !== "C" || measured.inapplicable) continue;
    c.status = "C";
    delete c.inapplicable;
    // Keep the claim citable: adopt what the measuring half said, rather than leaving a `C`
    // with nothing behind it.
    if (measured.justification) c.justification = measured.justification;
    else delete c.justification;
    if (measured.decidedBy) c.decidedBy = measured.decidedBy;
  }

  const nowNc = new Set(snap.findings.filter((f) => !f.advisory).map((f) => f.criteriaId));
  merged.residualRisks = merged.residualRisks.filter((r) => !nowNc.has(r.criteriaId));

  recomputeTallies(merged);
  return merged;
}
