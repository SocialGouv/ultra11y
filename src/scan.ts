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
import { parseSitemapUrls, crawlUrls, crawlBound } from "./crawl.js";
import { sampleScope } from "./sample.js";
import {
  COLLECT_SNAPSHOT,
  SNAPSHOT_VERSION,
  slugifyPageId,
  validateSnapshotMeta,
  writeSnapshot,
  type CollectedPage,
  type SnapshotMeta,
  type SnapshotProbes,
} from "./snapshot.js";
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
  keyboardTrap?: ProbeHit[];
  // Stateful probes (local runtime, interactions ON) — a filled input clipped under each
  // stress, and content updated by a safe interaction outside any live region. Optional +
  // Docker-never-sets, exactly like the residual probes above.
  inputOverflowReflow?: ProbeHit[];
  inputOverflowZoom?: ProbeHit[];
  inputOverflowSpacing?: ProbeHit[];
  liveRegion?: ProbeHit[];
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

/** The runner's probe results, in the shape the snapshot format publishes.
 *
 *  A straight projection — no filtering, no inference. `probed` arrives from the producer
 *  because the producer is the only thing that knows whether a probe ran at all: a caller
 *  reading `textSpacing: []` cannot tell "measured, nothing clipped" from "never applied the
 *  override". The stateful probes (input overflow, live region) are deliberately absent: they
 *  measure a page that has been TYPED INTO, and the snapshot beside them is the pristine one,
 *  so filing them here would attach a measurement to a document that never had that state. */
function probesOf(out: RunnerOutput): SnapshotProbes {
  return {
    ...(out.focusVisible ? { focusVisible: out.focusVisible } : {}),
    ...(out.hover ? { hover: out.hover } : {}),
    ...(out.reflowZoom ? { reflowZoom: out.reflowZoom } : {}),
    ...(out.textSpacing ? { textSpacing: out.textSpacing } : {}),
    reflow: out.reflow,
    probed: out.probed ?? [],
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
    // The doctype, which `dom` cannot carry: `documentElement.outerHTML` starts at <html>.
    // The collector reads it and every OTHER producer forwards it; this one dropped it, so a
    // scanned page arrived with the field absent — "nobody looked" — and RGAA 8.1 stayed « à
    // évaluer » on exactly the pages a browser had just opened. Same shape of defect as the
    // probes/axe drop this function used to have: measured, then thrown away on the way out.
    ...(collected.doctype !== undefined ? { doctype: collected.doctype } : {}),
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
      axe: { violations: out.violations, ran: true },
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
  { key: "keyboardTrap", engine: "keyboard-trap" },
  { key: "inputOverflowReflow", engine: "input-overflow-reflow" },
  { key: "inputOverflowZoom", engine: "input-overflow-zoom" },
  { key: "inputOverflowSpacing", engine: "input-overflow-spacing" },
  { key: "liveRegion", engine: "live-region" },
];

/** Rewrite a HOST loopback URL into one a container can reach. `docker run` gets no
 *  `--network host`, so the container's 127.0.0.1 is its own — a scan of
 *  `http://localhost:3000` (the action's `start:` + `urls:` shape) died on
 *  ERR_CONNECTION_REFUSED while the app ran the whole time, which is how this
 *  repository's CI stayed red for a day. `host.docker.internal` is natively resolved by
 *  Docker Desktop (macOS/Windows); on Linux the caller adds
 *  `--add-host host.docker.internal:host-gateway`. https:// loopback is deliberately NOT
 *  rewritten: the container would fail the self-signed certificate anyway. */
export function loopbackToHostGateway(target: string): { url: string; addHost: boolean } {
  const m = /^http:\/\/(localhost|127(?:\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.exec(target);
  if (!m) return { url: target, addHost: false };
  return { url: `http://host.docker.internal${m[2] ?? ""}${m[3] ?? ""}`, addHost: true };
}

function runRunner(target: string, isFile: boolean, tag: string, snapshot = true): RunnerOutput {
  const hostTarget = target;
  const args = ["run", "--rm"];
  if (!snapshot) args.push("-e", "ULTRA11Y_SNAPSHOT=0");
  if (isFile) args.push("-v", `${resolve(target)}:${MOUNT}:ro`);
  else {
    // The container must reach the HOST's loopback through host.docker.internal; on
    // Linux that name needs the host-gateway mapping Docker Desktop provides natively.
    const gw = loopbackToHostGateway(target);
    if (gw.addHost && process.platform === "linux") {
      args.push("--add-host", "host.docker.internal:host-gateway");
    }
    target = gw.url;
  }
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
  const out = JSON.parse(line) as RunnerOutput;
  // WHAT THIS RUNTIME ACTUALLY MEASURED, stated here rather than in the container. The Docker
  // RUNNER is kept byte-identical to docker/runner.mjs (docker-sync test), so it does not get
  // to grow fields; and it needs none — it runs axe and one 320px reflow check, which is
  // exactly DOCKER_TESTED_SCS. Claiming any more would hand `renderedProvesOn` a conformity
  // nothing on this path measured.
  out.probed = [...DOCKER_TESTED_SCS];
  // Report what a HOST reader can open: the runner finished on host.docker.internal, and
  // every downstream citation (hostPageOf, snapshot identity) derives from out.url. Only
  // the HOSTNAME is restored — the port stays from the container URL, which was copied
  // from the target, so pasting a full origin would double it
  // (`http://127.0.0.1:8931:8931/…`).
  if (loopbackToHostGateway(hostTarget).addHost && out.url) {
    const hostSchemeName = hostTarget.match(/^http:\/\/[^:/]+/)?.[0] ?? hostTarget;
    out.url = out.url.replace(/^http:\/\/host\.docker\.internal(?=:\d+|\/|$)/i, hostSchemeName);
  }
  return out;
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
    const urls = parseSitemapUrls(await fetchHtml(opts.sitemap));
    const kept = Number.isFinite(max) ? urls.slice(0, max) : urls;
    kept.forEach((u, i) => opts.onPage?.(u, i + 1));
    return kept;
  }
  if (opts.crawl) {
    return crawlUrls(opts.crawl, { fetchHtml, depth: opts.depth, max: opts.max, ...(opts.onPage ? { onPage: opts.onPage } : {}) });
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
  // A union, never a replacement: a Docker scan merged earlier in the same run has its own
  // entry, and the snapshot half must add to it rather than speak over it.
  const scs = new Set([...(base.scope.scan?.testedScs ?? []), ...(snap.scope.scan?.testedScs ?? [])]);
  if (scs.size) merged.scope.scan = { testedScs: [...scs].sort() };
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
