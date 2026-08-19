// `scan` — OPTIONAL dynamic tier. Runs axe-core in a real headless browser
// (Playwright) to decide the needs-rendering criteria the static engine can't:
// computed contrast (3.2/3.3) above all, plus a 320px reflow check (10.11) and a
// cross-check of the structural rules. Everything runs in a self-contained Docker
// image built on first use (the runner + Dockerfile are embedded below, so the
// skill stays a single distributable bundle). `--merge <audit.json>` folds the
// dynamic findings back into a static AuditResult, upgrading "manual" criteria.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditResult, DynamicEngine, DynamicFinding, DynamicResult, Finding, Lang, SamplePage, Severity } from "./types.js";
import { lineStartsOf, lineColAt } from "./parse/html.js";
import { allGuidelines } from "./wcag.js";
import { PROBE_SEVERITY, PROBE_WCAG, scForAxe, severityFromImpact, isAxeAdvisory } from "./axe-map.js";
import { parseSitemapUrls, crawlUrls } from "./crawl.js";
import { sampleScope } from "./sample.js";
import { COLLECT_SNAPSHOT, SNAPSHOT_VERSION, slugifyPageId, validateSnapshotMeta, writeSnapshot, type CollectedPage, type SnapshotMeta } from "./snapshot.js";
import { today } from "./util.js";

export const IMAGE_TAG = "ultra11y-dyn:1";
const MOUNT = "/work/input.html";

// The browser runner — lives INSIDE the Docker image (its own deps), never bundled
// into the zero-dep engine. Injects axe.source, runs axe, then a 320px reflow probe.
// Mirrored to docker/runner.mjs (kept byte-identical by docker-sync.test).
export const RUNNER = `import { chromium } from "playwright";
import axe from "axe-core";
const target = process.argv[2];
const isFile = target.startsWith("/work/");
const SNAPSHOT = process.env.ULTRA11Y_SNAPSHOT !== "0";
const COLLECT = ${JSON.stringify(COLLECT_SNAPSHOT)};
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.goto(isFile ? "file://" + target : target, { waitUntil: "load", timeout: 45000 });
  // Collected FIRST, on the pristine page: axe's injected source and the 320px reflow
  // resize both come after, and a snapshot must be the page as the browser built it.
  let snapshot;
  if (SNAPSHOT) {
    try {
      snapshot = await page.evaluate(COLLECT);
      try { snapshot.screenshot = (await page.screenshot({ fullPage: false })).toString("base64"); } catch {}
    } catch {}
  }
  await page.addScriptTag({ content: axe.source });
  const axeRes = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  await page.setViewportSize({ width: 320, height: 800 });
  const reflow = await page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return { horizontalScroll: el.scrollWidth > el.clientWidth + 2 };
  });
  const violations = axeRes.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, tags: v.tags,
    nodes: v.nodes.slice(0, 10).map((n) => ({ target: n.target, html: (n.html || "").slice(0, 200) })),
  }));
  console.log(JSON.stringify({ url: target, violations, reflow, snapshot }));
} finally {
  await browser.close();
}
`;

export const PKG = JSON.stringify(
  { name: "ultra11y-dynamic", private: true, type: "module", dependencies: { playwright: "^1.49.0", "axe-core": "4.12.1" } },
  null,
  2,
);

export const DOCKERFILE = `FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npx playwright install --with-deps chromium
COPY runner.mjs ./
WORKDIR /work
ENTRYPOINT ["node", "/app/runner.mjs"]
`;

export function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

function imageExists(tag: string): boolean {
  try {
    execFileSync("docker", ["image", "inspect", tag], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CTX_PREFIX = "ultra11y-dyn-";

/** Build the dynamic-tier image from the embedded context (first use only).
 *  The temp build context is always removed afterwards — the host stays clean. */
export function buildImage(tag = IMAGE_TAG): void {
  const ctx = mkdtempSync(join(tmpdir(), CTX_PREFIX));
  try {
    writeFileSync(join(ctx, "runner.mjs"), RUNNER);
    writeFileSync(join(ctx, "package.json"), PKG);
    writeFileSync(join(ctx, "Dockerfile"), DOCKERFILE);
    execFileSync("docker", ["build", "-t", tag, ctx], { stdio: "inherit", timeout: 900000 });
  } finally {
    rmSync(ctx, { recursive: true, force: true });
  }
}

/** Remove any leftover temp build contexts (pure fs; safe to call always). */
export function cleanTempContexts(): number {
  let removed = 0;
  const dir = tmpdir();
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(CTX_PREFIX)) continue;
    rmSync(join(dir, name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

export interface CleanResult {
  imageRemoved: boolean;
  tempContextsRemoved: number;
}

/** Tear down the dynamic tier: remove the image + any leftover build contexts.
 *  Answers "clean it up easily from the script" — nothing is left on the host. */
export function cleanDynamic(tag = IMAGE_TAG): CleanResult {
  let imageRemoved = false;
  if (dockerAvailable() && imageExists(tag)) {
    try {
      execFileSync("docker", ["rmi", "-f", tag], { stdio: "ignore" });
      imageRemoved = true;
    } catch {
      /* image in use or already gone */
    }
  }
  return { imageRemoved, tempContextsRemoved: cleanTempContexts() };
}

/** One observation from a residual-criteria probe (local runtime only). */
export interface ProbeHit {
  selector: string;
  html: string;
  detail: string;
}

export interface RunnerOutput {
  url: string;
  violations: { id: string; impact: string | null; help: string; tags?: string[]; nodes: { target: string[]; html: string }[] }[];
  reflow: { horizontalScroll: boolean };
  // Residual-criteria probes — populated ONLY by the local runtime (scan-local.ts);
  // the Docker RUNNER never sets them, so its RunnerOutput is unchanged. Optional so
  // every existing caller/test (which omits them) stays valid.
  focusVisible?: ProbeHit[];
  reflowZoom?: ProbeHit[];
  textSpacing?: ProbeHit[];
  hover?: ProbeHit[];
  // Stateful probes (local runtime, interactions ON) — a filled input clipped under each
  // stress, and content updated by a safe interaction outside any live region. Optional +
  // Docker-never-sets, exactly like the residual probes above.
  inputOverflowReflow?: ProbeHit[];
  inputOverflowZoom?: ProbeHit[];
  inputOverflowSpacing?: ProbeHit[];
  liveRegion?: ProbeHit[];
  // The PRISTINE page as the browser built it (COLLECT_SNAPSHOT + a viewport screenshot,
  // base64). Absent when snapshotting was off or the collection failed — in which case the
  // page keeps its findings but earns no snapshot, and therefore no conforming-by-silence.
  snapshot?: CollectedPage & { screenshot?: string };
  // WHERE the browser was when the measurement started — read right after goto + settle,
  // before any probe could click something that routes. `url` above is read at the END and
  // is the address the run finished on; only this one is the identity of what was audited.
  // Local runtime only; absent from a Docker RunnerOutput.
  landedUrl?: string;
  // The navigation's HTTP status. A framework can answer 404/500 with a full document at the
  // requested URL (Next's `notFound()`), which no URL comparison can detect. Absent for
  // `file://` and for the Docker runner — absent is never treated as a failure.
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

/** Persist a runner's collected page as a snapshot under `<root>/.ultra11y/pages/<id>/`,
 *  returning the page id — or undefined when there was nothing to write.
 *
 *  This is what turns `scan` from a findings-only pass into a producer of the durable
 *  artefact: without it a URL-scanned page is `basis: "attributed"` (src/pages.ts), its
 *  criteria can never leave `?`, and a whole sitemap-driven audit yields an empty per-page
 *  grid. The browser is already on the page — collecting it costs one `evaluate`.
 *
 *  Nothing here is fatal: a page that cannot be persisted is simply not a snapshot. */
export function writeRunnerSnapshot(root: string, out: RunnerOutput, target: string, page?: SamplePage): string | undefined {
  const collected = out.snapshot;
  if (!collected?.dom) return undefined;
  // Cite what a reader can open: the host path for a file scan, the served URL otherwise —
  // the same mapping the findings get, so a page and its findings never disagree on where
  // they are.
  const url = page?.url ?? hostPageOf(out.url ?? collected.url, target);
  const id = page?.id ?? pageIdFor(url);
  const meta: SnapshotMeta = {
    v: SNAPSHOT_VERSION,
    id,
    name: page?.name ?? collected.title ?? id,
    url,
    runner: "scan",
    ...(collected.viewport ? { viewport: collected.viewport } : {}),
    ...(page?.auth !== undefined ? { auth: page.auth } : {}),
    ...(page?.notes ? { notes: page.notes } : {}),
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
      ...(collected.screenshot ? { screenshotBase64: collected.screenshot } : {}),
    });
  } catch {
    return undefined;
  }
  return v.meta.id;
}

// RunnerOutput key ↔ probe engine, so a clean Docker output (no probe arrays) folds
// exactly as before and the local output adds the residual-criteria findings.
const PROBE_FIELDS: { key: keyof RunnerOutput; engine: Exclude<DynamicEngine, "axe" | "reflow"> }[] = [
  { key: "focusVisible", engine: "focus-visible" },
  { key: "reflowZoom", engine: "reflow-zoom" },
  { key: "textSpacing", engine: "text-spacing" },
  { key: "hover", engine: "hover" },
  { key: "inputOverflowReflow", engine: "input-overflow-reflow" },
  { key: "inputOverflowZoom", engine: "input-overflow-zoom" },
  { key: "inputOverflowSpacing", engine: "input-overflow-spacing" },
  { key: "liveRegion", engine: "live-region" },
];

function runRunner(target: string, isFile: boolean, tag: string, snapshot = true): RunnerOutput {
  const args = ["run", "--rm"];
  if (!snapshot) args.push("-e", "ULTRA11Y_SNAPSHOT=0");
  if (isFile) args.push("-v", `${resolve(target)}:${MOUNT}:ro`);
  args.push(tag, isFile ? MOUNT : target);
  let stdout: string;
  try {
    // Pipe (not ignore) the container's stderr so a failed run surfaces the real
    // cause (e.g. ERR_NAME_NOT_RESOLVED / a navigation timeout) instead of a bare
    // "Command failed: docker run …".
    // The buffer is sized for the SNAPSHOT, not the findings: one line now carries the
    // serialized document, the computed-style digest, the boxes, the stylesheets and a
    // base64 screenshot. Too small a buffer would kill the run with ENOBUFS on exactly the
    // large pages that most need auditing.
    stdout = execFileSync("docker", args, { encoding: "utf8", timeout: 240000, maxBuffer: 192 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { stderr?: Buffer | string; message?: string };
    const detail = (err.stderr ? String(err.stderr).trim() : "") || err.message || String(e);
    throw new Error(`docker run failed — ${detail}`);
  }
  const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "{}";
  return JSON.parse(line) as RunnerOutput;
}

/** Map the runner's reported page back to a HOST-meaningful citation: the container mount
 *  (`/work/input.html`) and a `file://` URL both resolve to the host file we scanned; a
 *  real served URL (http/https) is kept as-is. This is what lets a dynamic finding cite a
 *  path a reader (and `verify --semantic`) can actually open, instead of `/work/input.html`. */
function hostPageOf(url: string | undefined, target: string): string {
  if (!url) return target;
  if (url === MOUNT) return target; // docker file mount → the host file we mounted read-only
  if (url.startsWith("file://")) {
    try {
      return fileURLToPath(url);
    } catch {
      return target;
    }
  }
  return url; // a real served URL — no host file to map to
}

export function toDynamicResult(out: RunnerOutput, target: string, lang: Lang = "en", engine = "axe-core@playwright (docker)"): DynamicResult {
  const page = hostPageOf(out.url, target);
  const findings: DynamicFinding[] = [];
  for (const v of out.violations) {
    const criteriaId = scForAxe(v.id, v.tags);
    const severity: Severity = severityFromImpact(v.impact);
    // A best-practice-only axe violation (no `wcag<digits>` tag) evidences no testable SC
    // → fold as an advisory recommendation, never a criterion NC (e.g. empty-table-header).
    const advisory = isAxeAdvisory(v.id, v.tags);
    for (const n of v.nodes.length ? v.nodes : [{ target: [], html: "" }]) {
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
    findings.push({
      criteriaId: "1.4.10",
      axeRule: "reflow",
      impact: "serious",
      severity: "majeur",
      message:
        lang === "fr"
          ? "Défilement horizontal à 320px de large — le contenu ne se redistribue pas (reflow)."
          : "Horizontal scrolling at 320px width — content does not reflow.",
      selector: "document",
      snippet: "",
      engine: "reflow",
      page,
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
  return { tool: "ultra11y", engine, target, date: today(), findings };
}

// The needs-rendering SCs the DOCKER runner actually MEASURES: axe + the 320px reflow
// probe only — the local-only probes (200% zoom, text spacing, focus visibility, content
// on hover, live regions) never run in the container. Stamped on every Docker
// DynamicResult so the partial-audit advisory (src/report.ts untestedNeedsRendering)
// never claims a probe ran when it did not. The local superset: scan-local.ts
// `localTestedScs`.
export const DOCKER_TESTED_SCS: readonly string[] = ["1.4.10"];

export interface ScanOpts {
  target: string;
  tag?: string;
  /** Repo root under which to persist `.ultra11y/pages/<id>/`. Unset ⇒ no snapshot. */
  snapshotRoot?: string;
}

/** Run the dynamic tier (builds the image on first use). Throws if Docker absent. */
export function runScan(opts: ScanOpts): DynamicResult {
  // A non-URL target must exist as a file BEFORE we spend a Docker build on a typo
  // (otherwise a mistyped path silently falls through to URL mode and fails deep
  // inside `docker run`, leaking the raw command).
  const isUrl = /^https?:\/\//i.test(opts.target);
  if (!isUrl && !existsSync(opts.target)) {
    throw new Error(`File not found: ${opts.target}. Pass an http(s):// URL or an existing HTML file.`);
  }
  if (!dockerAvailable()) {
    throw new Error("Docker is not available. Start Docker, then re-run `scan --docker`.");
  }
  const tag = opts.tag ?? IMAGE_TAG;
  if (!imageExists(tag)) buildImage(tag);
  const isFile = !isUrl && existsSync(opts.target) && statSync(opts.target).isFile();
  const out = runRunner(opts.target, isFile, tag, Boolean(opts.snapshotRoot));
  const id = opts.snapshotRoot ? writeRunnerSnapshot(opts.snapshotRoot, out, opts.target) : undefined;
  return { ...toDynamicResult(out, opts.target), testedScs: [...DOCKER_TESTED_SCS], ...(id ? { snapshots: [id] } : {}) };
}

/** Fetch a URL's served HTML (zero-dep, Node global fetch). Empty string on error. */
async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

export interface DiscoverOpts {
  sitemap?: string; // sitemap.xml URL — scan every <loc>
  crawl?: string; // start URL — BFS the served HTML for same-origin links
  depth?: number; // crawl: link hops from the start URL  (default 2)
  max?: number; // cap on pages scanned                  (default 50)
}

/** Resolve the page URLs to scan from a sitemap or by crawling (zero-dep). */
export async function discoverUrls(opts: DiscoverOpts): Promise<string[]> {
  const max = opts.max ?? 50;
  if (opts.sitemap) {
    return parseSitemapUrls(await fetchHtml(opts.sitemap)).slice(0, max);
  }
  if (opts.crawl) {
    return crawlUrls(opts.crawl, { fetchHtml, depth: opts.depth ?? 2, max });
  }
  return [];
}

/** Run the dynamic tier over many URLs and aggregate into one DynamicResult.
 *  Each URL is one container run (browser per page); slow but reuses the proven
 *  single-page runner. Findings keep the page they came from. */
export function runScanMany(urls: string[], tag = IMAGE_TAG, snapshotRoot?: string): DynamicResult {
  if (!dockerAvailable()) {
    throw new Error("Docker is not available. Start Docker, then re-run `scan`.");
  }
  if (!imageExists(tag)) buildImage(tag);
  const findings: DynamicFinding[] = [];
  const snapshots: string[] = [];
  for (const url of urls) {
    const out = runRunner(url, false, tag, Boolean(snapshotRoot));
    findings.push(...toDynamicResult(out, url).findings);
    const id = snapshotRoot ? writeRunnerSnapshot(snapshotRoot, out, url) : undefined;
    if (id) snapshots.push(id);
  }
  return {
    tool: "ultra11y",
    engine: "axe-core@playwright (docker)",
    target: `${urls.length} page(s)`,
    date: today(),
    findings,
    testedScs: [...DOCKER_TESTED_SCS],
    ...(snapshots.length ? { snapshots } : {}),
  };
}

/** Stamp each dynamic finding with its originating sample page's provenance (id/name/auth/
 *  notes) so `mergeDynamic` can carry it onto the Finding for ticket rendering. Shared by
 *  the Docker and local sample runners. Mutates + returns the findings. */
export function tagSampleFindings(findings: DynamicFinding[], page: SamplePage): DynamicFinding[] {
  for (const f of findings) {
    f.sample = { id: page.id, name: page.name, ...(page.auth !== undefined ? { auth: page.auth } : {}), ...(page.notes ? { notes: page.notes } : {}) };
  }
  return findings;
}

/** Run the Docker dynamic tier over a NORMATIVE page SAMPLE and aggregate into one
 *  DynamicResult. No storageState support (the Docker runner has no session mechanism) — the
 *  CLI requires the local runtime whenever any sample page carries auth. Each finding keeps
 *  its sample-page provenance; the sample itself is recorded on the result. */
export function runSampleScan(pages: SamplePage[], tag = IMAGE_TAG, snapshotRoot?: string): DynamicResult {
  if (!dockerAvailable()) {
    throw new Error("Docker is not available. Start Docker, then re-run `scan`.");
  }
  if (!imageExists(tag)) buildImage(tag);
  const findings: DynamicFinding[] = [];
  const snapshots: string[] = [];
  for (const page of pages) {
    const out = runRunner(page.url, false, tag, Boolean(snapshotRoot));
    findings.push(...tagSampleFindings(toDynamicResult(out, page.url).findings, page));
    // The sample page's declared id/name/auth/notes win over anything derived from the URL:
    // that identity is what the report and the per-page grid speak.
    const id = snapshotRoot ? writeRunnerSnapshot(snapshotRoot, out, page.url, page) : undefined;
    if (id) snapshots.push(id);
  }
  return {
    tool: "ultra11y",
    engine: "axe-core@playwright (docker)",
    target: `${pages.length} page(s) (échantillon)`,
    date: today(),
    findings,
    sample: sampleScope({ pages }),
    testedScs: [...DOCKER_TESTED_SCS],
    ...(snapshots.length ? { snapshots } : {}),
  };
}

/** Discover URLs (sitemap/crawl) then scan them all through the dynamic tier. */
export async function runCrawlScan(opts: DiscoverOpts & { tag?: string; snapshotRoot?: string }): Promise<DynamicResult> {
  const urls = await discoverUrls(opts);
  if (urls.length === 0) {
    throw new Error("No URL to scan (empty/unreachable sitemap, or entry page with no same-origin link).");
  }
  return runScanMany(urls, opts.tag ?? IMAGE_TAG, opts.snapshotRoot);
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

/** Fold dynamic findings into a static AuditResult: a needs-rendering/manual or
 *  clean criterion that axe flags becomes NC; tallies + conformance recompute. */
export function mergeDynamic(audit: AuditResult, dynamic: DynamicResult, lang: Lang = "en"): AuditResult {
  const merged: AuditResult = JSON.parse(JSON.stringify(audit)) as AuditResult;
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
  // the partial-audit advisory keys on this, so a Docker run (reflow only) never silently
  // suppresses the banner for the local-only probes it did not run.
  if (dynamic.testedScs?.length) {
    const tested = new Set([...(merged.scope.scan?.testedScs ?? []), ...dynamic.testedScs]);
    merged.scope.scan = { testedScs: [...tested].sort() };
  }
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
    const msg = df.engine === "reflow" ? { id: "dyn-reflow" } : { id: "dyn-remediation", params: { message: df.message } };
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
    c.findings.push(finding);
    merged.findings.push(finding);
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
  const decided = merged.criteria.filter((c) => c.status === "C" || c.status === "NC");
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
  // The base was a SOURCE audit; the snapshot audit is the run that actually read the pages.
  // Deep-copying only the base's scope would throw that evidence away and downgrade genuinely
  // audited pages to "not-audited" — the inverse of the guard, and a false statement in the
  // opposite direction. Union, so neither half can erase the other's.
  merged.scope.pagesAudited = [...new Set([...(base.scope.pagesAudited ?? []), ...(snap.scope.pagesAudited ?? [])])].sort();
  const byId = new Map(merged.criteria.map((c) => [c.id, c]));
  const snapById = new Map(snap.criteria.map((c) => [c.id, c]));

  for (const f of snap.findings) {
    const c = byId.get(f.criteriaId);
    if (!c) continue;
    c.findings.push(f);
    merged.findings.push(f);
    if (!f.advisory) {
      c.status = "NC";
      delete c.inapplicable; // a finding is proof the subject is in scope after all
      delete c.justification;
    }
  }
  // Declarative pack-rule findings live outside the WCAG core verdict; they are carried over
  // untouched so a pack projection sees the snapshot's hits too.
  if (snap.packFindings?.length) merged.packFindings = [...(merged.packFindings ?? []), ...snap.packFindings];

  // A criterion the static pass closed for want of a subject, which the snapshot then MEASURED.
  // Both read `C`, so the discriminator is the flag, not the status: what has to go is the
  // "nothing of that kind here" justification, which a rendered page has just falsified.
  for (const c of merged.criteria) {
    if (!c.inapplicable) continue;
    if (snapById.get(c.id)?.status === "C") {
      c.status = "C";
      delete c.inapplicable;
      delete c.justification; // "no relevant element in scope" no longer holds
    }
  }

  const nowNc = new Set(snap.findings.filter((f) => !f.advisory).map((f) => f.criteriaId));
  merged.residualRisks = merged.residualRisks.filter((r) => !nowNc.has(r.criteriaId));

  recomputeTallies(merged);
  return merged;
}
