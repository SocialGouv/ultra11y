// The VISUAL SNAPSHOT of the render engine's captures: open each `.ultra11y/captures/<id>.html`
// that `render` wrote in Chromium, with the project's own stylesheets when they can be found,
// take a screenshot and run the controlled axe pass (src/axe-engine.ts) on it.
//
// What it is for: a reader of the report looks at the RENDERING of a component instead of its
// JSX. What it is NOT: a measurement of the real page. Every capture is the server markup of
// one component, rendered with no props, no provider and no page around it — so:
//
//   • every observation is labelled `context: "isolated-component"` in the index and in the
//     report, and none of them decides a criterion, credits one as conforming, or joins the
//     audit's axe coverage (`scope.axe`, `pageCoverage`): absence of a violation on an isolated
//     render proves nothing about the page that mounts it;
//   • the rules that judge a WHOLE page (landmarks, heading order, document title, lang…) are
//     set aside as `page-context`: a component alone cannot satisfy them, and reporting them
//     would be noise produced by the isolation itself;
//   • the rules that depend on computed styles (contrast, target size, links in text blocks…)
//     are set aside as `styles` unless the project's CSS was found and loaded in full. A
//     screenshot without CSS is labelled as such, and its contrast is never evidence.
//
// CSS DETECTION is deliberately conservative — it loads only what the project itself declares
// as global styles, and says what it left out:
//   1. the plain `.css` files imported by the root entry points: Next.js `app/layout`
//      (and route-group root layouts), `pages/_app`, Vite/CRA `src/main` / `src/index`
//      (relative paths, tsconfig `paths` aliases, and packages such as the DSFR);
//      CSS modules are left out (they are per-component, and the server render has no class
//      map for them); Tailwind sources (`@tailwind`, `@import "tailwindcss"`) and Sass/Less
//      files are NOT loaded — they mean nothing to a browser uncompiled — and are reported;
//   2. the stylesheets a root document links to (`<link rel="stylesheet" href="/x.css">` in
//      `pages/_document`, a layout, or Vite's `index.html`), served from `public/`;
//   3. a build's compiled CSS (`.next/static/css`, `dist/assets`, `build/static/css`), ONLY when
//      step 1 found an uncompiled source it had to leave out — the compiled output is then the
//      one form of those styles a browser can read.
// When nothing is found, the snapshot runs with the browser's default styles and says so.
//
// The browser is OPTIONAL. Without Playwright or Chromium the pass writes an index that says
// why, and `render` / `audit` carry on with the static captures exactly as before.
//
// Browser-context code is passed to `page.evaluate` as STRINGS: the engine's tsconfig ships no
// DOM lib (see src/scan-local.ts).
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type AxeEngine, runAxe } from "./axe-engine.js";
import { isAxeAdvisory, scForAxe } from "./axe-map.js";
import { toPosix } from "./glob.js";
import { aliasesOf } from "./render-engine.js";
import { launchChromium, localTierStatus, resolveLocalDeps } from "./scan-local.js";
import type {
  AxeEngineInfo,
  RenderManifest,
  RenderSnapshotIndex,
  RenderSnapshotSetAside,
  RenderSnapshotStyles,
  RenderSnapshotUnit,
  RenderSnapshotViolation,
} from "./types.js";
import { today } from "./util.js";

/** Where the snapshots and their index live, beside `.ultra11y/captures/` and `render.json`. */
export const RENDER_SNAPSHOTS_DIR = ".ultra11y/render-snapshots";
export const RENDER_SNAPSHOT_INDEX = `${RENDER_SNAPSHOTS_DIR}/index.json`;

/** The tallest screenshot kept, in CSS pixels: a component is not a page, and a runaway
 *  layout must not produce a 30 000 px image. */
export const SNAPSHOT_MAX_HEIGHT = 2000;
const VIEWPORT = { width: 1280, height: 800 };
const PAD = 8;
const NAV_TIMEOUT_MS = 15_000;

// ---- which violations an isolated render may report -----------------------------------

/** axe rules that judge a whole PAGE. A component rendered alone has no landmarks around it,
 *  no title, no `lang`, no heading above it: these fire because of the isolation, not because
 *  of the component. */
export const PAGE_CONTEXT_RULES: ReadonlySet<string> = new Set([
  "region",
  "bypass",
  "document-title",
  "html-has-lang",
  "html-lang-valid",
  "html-xml-lang-mismatch",
  "valid-lang",
  "meta-viewport",
  "meta-viewport-large",
  "meta-refresh",
  "page-has-heading-one",
  "heading-order",
  "skip-link",
  "landmark-one-main",
  "landmark-no-duplicate-banner",
  "landmark-no-duplicate-contentinfo",
  "landmark-no-duplicate-main",
  "landmark-unique",
  "landmark-banner-is-top-level",
  "landmark-contentinfo-is-top-level",
  "landmark-main-is-top-level",
  "landmark-complementary-is-top-level",
  "frame-tested",
]);

/** axe rules whose answer depends on the COMPUTED styles. Without the project's full CSS the
 *  browser's defaults decide them, and their answer says nothing about the product. */
export const STYLE_DEPENDENT_RULES: ReadonlySet<string> = new Set([
  "color-contrast",
  "color-contrast-enhanced",
  "link-in-text-block",
  "target-size",
  "scrollable-region-focusable",
  "avoid-inline-spacing",
  "css-orientation-lock",
]);

/** Whether an isolated-render violation is set aside, and why. Style-dependent rules count
 *  only when every stylesheet found was loaded (`project`). */
export function setAsideReason(rule: string, styles: RenderSnapshotStyles["status"]): RenderSnapshotSetAside | undefined {
  if (PAGE_CONTEXT_RULES.has(rule)) return "page-context";
  if (STYLE_DEPENDENT_RULES.has(rule) && styles !== "project") return "styles";
  return undefined;
}

interface AxeViolationLike {
  id?: string;
  impact?: string | null;
  help?: string;
  tags?: string[];
  nodes?: { target?: unknown[]; html?: string }[];
}

/** axe's raw violations → the index's records, each marked counted or set aside. */
export function snapshotViolations(raw: readonly unknown[], styles: RenderSnapshotStyles["status"]): RenderSnapshotViolation[] {
  const out: RenderSnapshotViolation[] = [];
  for (const r of raw as AxeViolationLike[]) {
    if (!r?.id) continue;
    const aside = setAsideReason(r.id, styles);
    const first = r.nodes?.[0];
    const target = Array.isArray(first?.target) ? first.target.map(String).join(" ") : undefined;
    out.push({
      rule: r.id,
      criteriaId: scForAxe(r.id, r.tags),
      ...(r.impact ? { impact: r.impact } : {}),
      help: r.help ?? r.id,
      nodes: r.nodes?.length ?? 0,
      ...(target ? { target } : {}),
      ...(first?.html ? { html: first.html.slice(0, 200) } : {}),
      ...(isAxeAdvisory(r.id, r.tags) ? { advisory: true } : {}),
      counted: !aside,
      ...(aside ? { setAside: aside } : {}),
    });
  }
  return out.sort((a, b) => Number(b.counted) - Number(a.counted) || a.rule.localeCompare(b.rule));
}

// ---- finding the project's stylesheets --------------------------------------------------

const CODE_EXT = [".tsx", ".jsx", ".ts", ".js", ".mjs"];
const IMPORT_STYLE = /^\s*import\s+(?:[^'";]*?\s+from\s+)?["']([^"']+\.(?:css|scss|sass|less))(?:\?[^"']*)?["']/gm;
const LINK_STYLE = /<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi;
const HREF = /\bhref\s*=\s*["']([^"']+)["']/i;
const TAILWIND_SOURCE = /@tailwind\b|@import\s+["']tailwindcss[/"']|@import\s+url\(\s*["']?tailwindcss|@config\s+["']/;
const BUILD_DIRS = [".next/static/css", "dist/assets", "build/static/css"];

function firstExisting(root: string, stems: string[]): string[] {
  const out: string[] = [];
  for (const stem of stems)
    for (const e of CODE_EXT) {
      const f = join(root, `${stem}${e}`);
      if (existsSync(f)) {
        out.push(f);
        break;
      }
    }
  return out;
}

/** The root entry points whose imports are the project's GLOBAL styles. */
function styleEntries(root: string): string[] {
  const stems = ["app/layout", "src/app/layout", "pages/_app", "src/pages/_app", "src/main", "src/index", "app/root", "src/app"];
  const entries = firstExisting(root, stems);
  // Next.js route groups may each hold a root layout: `app/(marketing)/layout.tsx`.
  for (const base of ["app", "src/app"]) {
    const dir = join(root, base);
    if (!existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names.filter((x) => /^\(.+\)$/.test(x)).sort()) entries.push(...firstExisting(root, [`${base}/${n}/layout`]));
  }
  return entries;
}

/** Where a stylesheet specifier from `from` lands: relative, tsconfig alias, else a package. */
function resolveStyle(root: string, from: string, spec: string): string | undefined {
  if (spec.startsWith(".") || isAbsolute(spec)) {
    const f = resolve(dirname(from), spec);
    return existsSync(f) ? f : undefined;
  }
  const aliases = aliasesOf(root);
  for (const p of aliases.paths) {
    const star = p.pattern.indexOf("*");
    const candidates: string[] = [];
    if (star < 0) {
      if (spec === p.pattern) candidates.push(...p.targets);
    } else {
      const pre = p.pattern.slice(0, star);
      const suf = p.pattern.slice(star + 1);
      if (spec.startsWith(pre) && spec.endsWith(suf) && spec.length >= pre.length + suf.length) {
        const mid = spec.slice(pre.length, spec.length - suf.length);
        for (const t of p.targets) candidates.push(t.replace("*", mid));
      }
    }
    for (const c of candidates) if (existsSync(c)) return c;
  }
  if (aliases.baseUrl) {
    const f = join(aliases.baseUrl, spec);
    if (existsSync(f)) return f;
  }
  try {
    return createRequire(from).resolve(spec);
  } catch {
    return undefined;
  }
}

function cssFilesUnder(dir: string, depth = 4): string[] {
  const out: string[] = [];
  const walk = (d: string, n: number): void => {
    let names: string[];
    try {
      names = readdirSync(d).sort();
    } catch {
      return;
    }
    for (const name of names) {
      const f = join(d, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(f);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (n > 0) walk(f, n - 1);
      } else if (name.endsWith(".css")) out.push(f);
    }
  };
  walk(dir, depth);
  return out;
}

/** The project's global stylesheets, as absolute paths, with what was found and left out. */
export function findProjectStyles(root: string): { styles: RenderSnapshotStyles; paths: string[] } {
  const abs = resolve(root);
  const realRoot = real(abs);
  const label = (f: string): string => {
    // Through realpath on both sides: a package resolved by `require` comes back real
    // (/private/var/… on macOS, the pnpm store), the root may not.
    const rel = relative(realRoot, real(f));
    return toPosix(rel.startsWith("..") || isAbsolute(rel) ? f : rel);
  };
  const files: RenderSnapshotStyles["files"] = [];
  const skipped: RenderSnapshotStyles["skipped"] = [];
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (f: string, via: "import" | "link" | "build"): void => {
    if (seen.has(f)) return;
    seen.add(f);
    paths.push(f);
    files.push({ file: label(f), via });
  };
  let needsBuild = false;

  const entries = styleEntries(abs);
  for (const entry of entries) {
    let src: string;
    try {
      src = readFileSync(entry, "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(IMPORT_STYLE)) {
      const spec = m[1]!;
      if (/\.module\.(css|scss|sass|less)$/i.test(spec)) continue; // per-component, not global
      const f = resolveStyle(abs, entry, spec);
      if (!f) {
        skipped.push({ file: spec, reason: "unresolved" });
        continue;
      }
      if (!/\.css$/i.test(f)) {
        skipped.push({ file: label(f), reason: "preprocessor" });
        needsBuild = true;
        continue;
      }
      let css: string;
      try {
        css = readFileSync(f, "utf8");
      } catch {
        skipped.push({ file: label(f), reason: "unreadable" });
        continue;
      }
      if (TAILWIND_SOURCE.test(css)) {
        skipped.push({ file: label(f), reason: "tailwind-source" });
        needsBuild = true;
        continue;
      }
      add(f, "import");
    }
  }

  // Stylesheets a root document links to, served from `public/` (or beside `index.html`).
  const documents = [...entries, ...firstExisting(abs, ["pages/_document", "src/pages/_document"])];
  if (existsSync(join(abs, "index.html"))) documents.push(join(abs, "index.html"));
  for (const doc of documents) {
    let src: string;
    try {
      src = readFileSync(doc, "utf8");
    } catch {
      continue;
    }
    for (const tag of src.match(LINK_STYLE) ?? []) {
      const href = HREF.exec(tag)?.[1];
      if (!href || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || !/\.css(\?|$)/i.test(href)) continue;
      const clean = href.replace(/\?.*$/, "");
      const f = clean.startsWith("/")
        ? [join(abs, "public", clean), join(abs, clean)].find((x) => existsSync(x))
        : [resolve(dirname(doc), clean), join(abs, "public", clean)].find((x) => existsSync(x));
      if (f) add(f, "link");
      else skipped.push({ file: href, reason: "unresolved" });
    }
  }

  // A build's compiled CSS: only to stand in for a source the browser cannot read.
  let built = false;
  if (needsBuild)
    for (const d of BUILD_DIRS) {
      const found = cssFilesUnder(join(abs, d));
      for (const f of found) add(f, "build");
      if (found.length) {
        built = true;
        break;
      }
    }

  const unusable = skipped.length > 0 && !(built && skipped.every((s) => s.reason === "tailwind-source" || s.reason === "preprocessor"));
  const status: RenderSnapshotStyles["status"] = paths.length === 0 ? "none" : unusable ? "partial" : "project";
  return { styles: { status, files, skipped }, paths };
}

// ---- serving the captures --------------------------------------------------------------

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

/** The package (or project) directory a stylesheet belongs to: its fonts and images sit under it. */
function packageRoot(file: string): string {
  let dir = dirname(file);
  for (;;) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) return dirname(file);
    dir = up;
  }
}

const escAttr = (s: string): string => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The document the browser opens for one capture: the capture's markup, with the project's
 *  stylesheets linked in its head. A capture that is already a document (a page rendered with
 *  its layout) keeps its own `<html>`; a fragment is wrapped. */
export function snapshotDocument(capture: string, stylesheets: readonly string[], title: string): string {
  const links = stylesheets.map((href) => `<link rel="stylesheet" href="${escAttr(href)}">`).join("");
  const body = capture.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  if (/<html[\s>]/i.test(body)) {
    if (/<head(\s[^>]*)?>/i.test(body)) return body.replace(/<head(\s[^>]*)?>/i, (m) => `${m}${links}`);
    return body.replace(/<html(\s[^>]*)?>/i, (m) => `${m}<head>${links}</head>`);
  }
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escAttr(title)}</title>${links}</head><body>${body}</body></html>`;
}

interface Served {
  origin: string;
  close: () => Promise<void>;
}

/** A loopback server for the pass: `/__u11y/unit/<id>.html` (the documents), `/__u11y/fs/<abs>`
 *  (the stylesheets and what they reference, inside the allowed roots only), and everything else
 *  from the project's `public/`. axe refuses `file://`, and a served page is what every caller has. */
async function serve(root: string, docs: Map<string, string>, allowed: string[]): Promise<Served> {
  const pub = join(root, "public");
  const roots = [...new Set(allowed.map(real))];
  const inside = (f: string): boolean => roots.some((r) => f === r || f.startsWith(r.endsWith(sep) ? r : `${r}${sep}`));
  const sendFile = (res: ServerResponse, f: string): void => {
    const type = MIME[extname(f).toLowerCase()];
    if (!type) {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = readFileSync(f);
      res.writeHead(200, { "content-type": type }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  };
  const handler = (req: IncomingMessage, res: ServerResponse): void => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const unit = /^\/__u11y\/unit\/([^/]+)\.html$/.exec(path);
    if (unit) {
      const doc = docs.get(unit[1]!);
      if (doc === undefined) res.writeHead(404).end();
      else res.writeHead(200, { "content-type": MIME[".html"]! }).end(doc);
      return;
    }
    if (path.startsWith("/__u11y/fs/")) {
      const raw = path.slice("/__u11y/fs".length);
      const f = real(/^\/[A-Za-z]:\//.test(raw) ? raw.slice(1) : raw);
      if (!inside(f)) res.writeHead(403).end();
      else sendFile(res, f);
      return;
    }
    const f = real(join(pub, path));
    if (!existsSync(pub) || !f.startsWith(real(pub) + sep)) res.writeHead(404).end();
    else sendFile(res, f);
  };
  const server: Server = createServer(handler);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

const fsHref = (abs: string): string => `/__u11y/fs/${toPosix(resolve(abs)).replace(/^\//, "").split("/").map(encodeURIComponent).join("/")}`;

// The box the component occupies: the union of every laid-out element of the body.
const CONTENT_BOX = `(() => {
  const b = document.body;
  if (!b) return null;
  let x1 = Infinity, y1 = Infinity, x2 = 0, y2 = 0, n = 0;
  const els = b.querySelectorAll("*");
  for (let i = 0; i < els.length && i < 5000; i++) {
    const r = els[i].getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    n++;
    x1 = Math.min(x1, r.left + scrollX); y1 = Math.min(y1, r.top + scrollY);
    x2 = Math.max(x2, r.right + scrollX); y2 = Math.max(y2, r.bottom + scrollY);
  }
  const de = document.documentElement;
  return { n, x1, y1, x2, y2, w: Math.max(de.scrollWidth, b.scrollWidth), h: Math.max(de.scrollHeight, b.scrollHeight) };
})()`;
const FONTS_READY = `(document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true)`;

// ---- the pass --------------------------------------------------------------------------

export interface SnapshotRunOptions {
  /** Project root: where `.ultra11y/` is. */
  root: string;
  manifest: RenderManifest;
  /** An explicit browser executable (`--browser-path` / ULTRA11Y_BROWSER_PATH). */
  browserPath?: string;
  /** Pages open at once. */
  concurrency?: number;
  warn?: (msg: string) => void;
  onProgress?: (done: number, total: number, id: string) => void;
}

function writeIndex(root: string, index: RenderSnapshotIndex, keep: ReadonlySet<string>): void {
  const dir = join(root, RENDER_SNAPSHOTS_DIR);
  mkdirSync(dir, { recursive: true });
  // A PNG of a unit this run did not snapshot is stale: a component that now fails to render
  // must not keep showing its old picture.
  try {
    for (const name of readdirSync(dir)) if (name.endsWith(".png") && !keep.has(name.slice(0, -4))) rmSync(join(dir, name), { force: true });
  } catch {
    /* nothing to clean */
  }
  writeFileSync(join(root, RENDER_SNAPSHOT_INDEX), `${JSON.stringify(index, null, 2)}\n`);
}

/** Open every rendered capture of `manifest` in Chromium: screenshot + axe, with the project's
 *  CSS when found. Never throws for want of a browser: the index then says why, and the
 *  captures stay what they were. */
export async function snapshotRenderCaptures(opts: SnapshotRunOptions): Promise<RenderSnapshotIndex> {
  const root = resolve(opts.root);
  const warn = opts.warn ?? ((m: string) => console.error(m));
  const { styles, paths } = findProjectStyles(root);
  const rendered = opts.manifest.units.filter((u) => u.status === "rendered" && u.capture);
  const base: RenderSnapshotIndex = { v: 1, context: "isolated-component", date: today(), styles, units: [] };
  if (!rendered.length) {
    writeIndex(root, base, new Set());
    return base;
  }

  const unavailable = (reason: string): RenderSnapshotIndex => {
    const index = { ...base, unavailable: reason };
    writeIndex(root, index, new Set());
    return index;
  };
  const tier = localTierStatus(root, opts.browserPath ? { browserPath: opts.browserPath } : {});
  if (!tier.ok) return unavailable(tier.reason);
  let chromium: any;
  let axe: AxeEngine;
  try {
    ({ chromium, axe } = resolveLocalDeps(root));
  } catch (e) {
    return unavailable((e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "Playwright unavailable");
  }
  let browser: any;
  try {
    browser = await launchChromium(chromium, root, warn, opts.browserPath ? { browserPath: opts.browserPath } : {});
  } catch (e) {
    return unavailable((e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "Chromium could not be launched");
  }

  const docs = new Map<string, string>();
  const links = paths.map(fsHref);
  for (const u of rendered) {
    try {
      docs.set(u.id, snapshotDocument(readFileSync(join(root, u.capture!), "utf8"), links, u.component));
    } catch {
      /* a capture that vanished is recorded as failed below */
    }
  }
  const served = await serve(root, docs, [root, ...paths.map(packageRoot)]);
  const outDir = join(root, RENDER_SNAPSHOTS_DIR);
  mkdirSync(outDir, { recursive: true });
  const units: RenderSnapshotUnit[] = new Array(rendered.length);
  let engine: AxeEngineInfo | undefined;
  let browserVersion: string | undefined;
  try {
    browserVersion = typeof browser.version === "function" ? String(browser.version()) : undefined;
  } catch {
    /* unnamed browser */
  }
  let failure: string | undefined;
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, reducedMotion: "reduce" });
    // Only the loopback server is reachable: an isolated render must never phone home, and a
    // remote font that may or may not load would make two runs disagree.
    await context.route("**/*", (route: any) => (String(route.request().url()).startsWith(served.origin) ? route.continue() : route.abort()));
    let next = 0;
    let done = 0;
    const workers = Math.max(1, Math.min(opts.concurrency ?? 4, rendered.length));
    await Promise.all(
      Array.from({ length: workers }, async () => {
        const page = await context.newPage();
        try {
          while (next < rendered.length) {
            const i = next++;
            const u = rendered[i]!;
            const rec: RenderSnapshotUnit = {
              id: u.id,
              file: u.file,
              export: u.export,
              component: u.component,
              kind: u.kind,
              capture: u.capture!,
              status: "failed",
              violations: [],
            };
            try {
              if (!docs.has(u.id)) throw new Error(`capture not found: ${u.capture}`);
              await page.goto(`${served.origin}/__u11y/unit/${encodeURIComponent(u.id)}.html`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
              await page.evaluate(FONTS_READY).catch(() => undefined);
              const box = (await page.evaluate(CONTENT_BOX)) as { n: number; x1: number; y1: number; x2: number; y2: number; w: number; h: number } | null;
              const shotPath = join(outDir, `${u.id}.png`);
              let clip: { x: number; y: number; width: number; height: number } | undefined;
              if (box && box.n > 0 && Number.isFinite(box.x1)) {
                const x = Math.max(0, Math.floor(box.x1 - PAD));
                const y = Math.max(0, Math.floor(box.y1 - PAD));
                const width = Math.max(1, Math.min(Math.ceil(box.x2 + PAD), Math.max(box.w, VIEWPORT.width)) - x);
                const height = Math.max(1, Math.min(Math.ceil(box.y2 + PAD) - y, SNAPSHOT_MAX_HEIGHT));
                clip = { x, y, width, height };
              }
              await page.screenshot({ path: shotPath, ...(clip ? { fullPage: true, clip } : { fullPage: false }) });
              const run = await runAxe(axe, page, "render-snapshot");
              engine ??= run.engine;
              rec.status = "snapshotted";
              rec.screenshot = toPosix(join(RENDER_SNAPSHOTS_DIR, `${u.id}.png`));
              rec.width = clip?.width ?? VIEWPORT.width;
              rec.height = clip?.height ?? VIEWPORT.height;
              rec.violations = snapshotViolations(run.violations, styles.status);
            } catch (e) {
              rec.error = (e instanceof Error ? e.message : String(e)).split("\n")[0];
            }
            units[i] = rec;
            opts.onProgress?.(++done, rendered.length, u.id);
          }
        } finally {
          await page.close().catch(() => undefined);
        }
      }),
    );
    await context.close().catch(() => undefined);
  } catch (e) {
    failure = (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "the browser failed";
  } finally {
    await browser.close().catch(() => undefined);
    await served.close();
  }
  if (failure) return unavailable(failure);
  const index: RenderSnapshotIndex = {
    ...base,
    ...(browserVersion ? { browser: `chromium ${browserVersion}` } : {}),
    ...(engine ? { axe: engine } : {}),
    units,
  };
  writeIndex(root, index, new Set(units.filter((u) => u.screenshot).map((u) => u.id)));
  return index;
}

// ---- reading it back -------------------------------------------------------------------

export function readRenderSnapshotIndex(path: string): RenderSnapshotIndex | undefined {
  try {
    const m = JSON.parse(readFileSync(path, "utf8")) as RenderSnapshotIndex;
    return m && m.v === 1 && m.context === "isolated-component" && Array.isArray(m.units) && m.styles ? m : undefined;
  } catch {
    return undefined;
  }
}

/** The index beside a captures dir (`<dir>/../render-snapshots/index.json`), its screenshot
 *  paths rewritten relative to the current directory — the form `scope.renders.snapshots`
 *  carries, so a report written from there finds the PNGs. A PNG that is gone is dropped from
 *  its unit rather than linked broken. */
export function renderSnapshotScopeFor(capturesDir: string): RenderSnapshotIndex | undefined {
  const ultra = dirname(resolve(capturesDir.replace(/[/\\]+$/, "")));
  const index = readRenderSnapshotIndex(join(ultra, "render-snapshots", "index.json"));
  if (!index) return undefined;
  const projectRoot = dirname(ultra);
  const units = index.units.map((u) => {
    if (!u.screenshot) return u;
    const abs = resolve(projectRoot, u.screenshot);
    const { screenshot: _drop, ...rest } = u;
    return existsSync(abs) ? { ...u, screenshot: toPosix(relative(process.cwd(), abs)) || toPosix(abs) } : rest;
  });
  return { ...index, units };
}

/** Counts for a one-line summary: units snapshotted / failed, and violations counted / set aside. */
export function snapshotCounts(index: RenderSnapshotIndex): { snapshotted: number; failed: number; counted: number; setAside: number } {
  let snapshotted = 0;
  let failed = 0;
  let counted = 0;
  let setAside = 0;
  for (const u of index.units) {
    if (u.status === "snapshotted") snapshotted++;
    else failed++;
    for (const v of u.violations) {
      if (v.counted) counted++;
      else setAside++;
    }
  }
  return { snapshotted, failed, counted, setAside };
}
