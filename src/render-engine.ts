// ultra11y's own render engine (`render`): produce the RENDERED HTML of a project's components
// itself, without reading or running the project's tests or snapshots.
//
// 1. DISCOVER the renderable units from the source tree: every .tsx/.jsx module (its default
//    and PascalCase exports that are React components), the framework pages among them
//    (Next.js app/ and pages/ routers), and the Storybook stories (CSF, rendered with their
//    args). Test, spec, mock, fixture and snapshot files are left out unread.
// 2. RENDER each unit with the PROJECT'S OWN react-dom/server (`renderToStaticMarkup`), no
//    props, in a throwaway harness ultra11y owns: a runner script written to the OS temp dir,
//    run in a child process per source file. The project's TSX/JSX is transpiled IN MEMORY by
//    a require hook using the transpiler the project already has (esbuild, then typescript,
//    then sucrase) — no file of the project is written, no build is run, and ultra11y bundles
//    no React. A watchdog kills a render that does not finish in time; the file is then
//    re-run without the unit that hung, so one hang costs one unit, not the file.
// 3. RECORD every outcome. A unit that rendered becomes `.ultra11y/captures/<id>.html` with the
//    usual provenance comment (source, component, renderer, `styles="none"`); a unit that threw
//    is kept with the reason (missing provider, props, browser-only API, data fetching,
//    transpile error, timeout…); a file that could not be tried is kept as not attempted. All
//    of it goes to `.ultra11y/render.json`, which `audit` reads into `scope.renders` and the
//    report's annex lists. Nothing is dropped silently.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { getTsconfig } from "get-tsconfig";
import { CAPTURES_DIR, formatCaptureComment } from "./capture.js";
import { compileGlobs, isTestArtifact, toPosix } from "./glob.js";
import type { RenderManifest, RenderReason, RenderScope, RenderUnit } from "./types.js";
import { walk } from "./walk.js";

export const RENDER_MANIFEST = ".ultra11y/render.json";
export const DEFAULT_RENDER_TIMEOUT_MS = 10_000;

// ---- discovery ------------------------------------------------------------------------

/** A source file the engine will load, and what it is. */
export interface RenderTarget {
  /** Project-relative posix path. */
  file: string;
  kind: "module" | "stories" | "sfc";
  /** Set for a framework page file: the route it serves. */
  route?: string;
}

// Directories and files that hold tests, test helpers or fixtures — never product UI, never
// read. On top of `isTestArtifact` (.test/.spec/.stories files, __tests__, __mocks__, .storybook).
const TEST_DIRS = new Set(["test", "tests", "__snapshots__", "__fixtures__", "fixtures", "e2e", "cypress", "playwright"]);
const TEST_HELPER = /(^|\/)(setupTests|test-utils|testUtils|jest\.setup|vitest\.setup|[^/]*\.test-utils)\.[cm]?[jt]sx?$/i;
const STORIES = /\.stories\.[cm]?[jt]sx?$/i;
const MODULE = /\.[jt]sx$/i;
const SFC = /\.(vue|svelte|astro)$/i;
const CONFIG = /(^|\/)[^/]+\.config\.[cm]?[jt]sx?$/i;

function isTestPath(rel: string): boolean {
  if (/\.snap$/i.test(rel) || TEST_HELPER.test(rel)) return true;
  if (rel.split("/").some((seg) => TEST_DIRS.has(seg))) return true;
  // Stories are rendered, not tests: only the directory they sit in can make one a test file.
  return isTestArtifact(STORIES.test(rel) ? rel.replace(STORIES, ".tsx") : rel);
}

/** The Next.js route a file serves, or undefined: `app/**\/page.tsx` (route groups dropped)
 *  and `pages/**` (minus `_app`/`_document`/`_error` and `api/`), under an optional `src/`. */
export function nextRoute(rel: string): string | undefined {
  const m = /^(?:src\/)?(app|pages)\/(.*)\.[jt]sx$/i.exec(rel);
  if (!m) return undefined;
  const [, router, rest = ""] = m;
  const segs = rest.split("/");
  if (router === "app") {
    if (segs.pop() !== "page") return undefined;
    const kept = segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
    return `/${kept.join("/")}`;
  }
  if (segs[0] === "api" || segs.some((s) => s.startsWith("_"))) return undefined;
  if (segs[segs.length - 1] === "index") segs.pop();
  return `/${segs.join("/")}`;
}

function projectDeps(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

export interface DiscoverRenderOpts {
  include?: string[];
  exclude?: string[];
  /** Render Storybook stories too (default true). */
  stories?: boolean;
}

/** Find what to render under `root`. Never reads a file: path rules only. */
export function discoverRenderTargets(root: string, opts: DiscoverRenderOpts = {}): { targets: RenderTarget[]; testFilesIgnored: number } {
  const include = compileGlobs(opts.include);
  const exclude = compileGlobs(opts.exclude);
  const next = Object.hasOwn(projectDeps(root), "next");
  const targets: RenderTarget[] = [];
  let testFilesIgnored = 0;
  for (const { rel } of walk(root).files) {
    const candidate = MODULE.test(rel) || SFC.test(rel) || STORIES.test(rel);
    if (!candidate || /\.d\.[cm]?ts$/i.test(rel) || CONFIG.test(rel)) continue;
    if (include && !include(rel)) continue;
    if (exclude?.(rel)) continue;
    if (isTestPath(rel)) {
      testFilesIgnored++;
      continue;
    }
    if (STORIES.test(rel)) {
      if (opts.stories !== false) targets.push({ file: rel, kind: "stories" });
      continue;
    }
    if (SFC.test(rel)) {
      targets.push({ file: rel, kind: "sfc" });
      continue;
    }
    const route = next ? nextRoute(rel) : undefined;
    targets.push({ file: rel, kind: "module", ...(route !== undefined ? { route } : {}) });
  }
  return { targets, testFilesIgnored };
}

// ---- toolchain ------------------------------------------------------------------------

export type TranspilerName = "esbuild" | "typescript" | "sucrase";
export const TRANSPILERS: readonly TranspilerName[] = ["esbuild", "typescript", "sucrase"];

export interface ResolvedTool {
  name: string;
  version: string;
  /** Absolute path the runner `require`s. */
  path: string;
}

function resolveFrom(root: string, spec: string): ResolvedTool | undefined {
  const req = createRequire(join(resolve(root), "package.json"));
  try {
    const path = req.resolve(spec);
    let version = "?";
    try {
      version = (JSON.parse(readFileSync(req.resolve(`${spec.split("/")[0]}/package.json`), "utf8")) as { version?: string }).version ?? "?";
    } catch {
      /* a package that hides its package.json still loads */
    }
    return { name: spec, version, path };
  } catch {
    return undefined;
  }
}

/** The project's own transpiler: the one named, else the first of esbuild, typescript, sucrase. */
export function resolveTranspiler(root: string, prefer?: TranspilerName): ResolvedTool | undefined {
  for (const name of prefer ? [prefer] : TRANSPILERS) {
    const hit = resolveFrom(root, name);
    if (hit) return hit;
  }
  return undefined;
}

/** The project's own React server renderer. */
export function resolveRenderer(root: string): ResolvedTool | undefined {
  const server = resolveFrom(root, "react-dom/server");
  if (!server || !resolveFrom(root, "react")) return undefined;
  return { ...server, name: "react-dom/server" };
}

interface PathAlias {
  pattern: string;
  targets: string[];
}

/** tsconfig/jsconfig `paths` (+ `baseUrl`) as absolute targets, for the runner's resolver. */
function aliasesOf(root: string): { paths: PathAlias[]; baseUrl?: string; jsxImportSource?: string } {
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    if (!existsSync(join(root, name))) continue;
    try {
      const found = getTsconfig(root, name);
      if (!found) continue;
      const dir = dirname(resolve(found.path));
      const co = found.config.compilerOptions ?? {};
      const base = resolve(dir, co.baseUrl ?? ".");
      const paths = Object.entries(co.paths ?? {}).map(([pattern, targets]) => ({ pattern, targets: targets.map((t) => resolve(base, t)) }));
      return { paths, ...(co.baseUrl ? { baseUrl: base } : {}), ...(co.jsxImportSource ? { jsxImportSource: co.jsxImportSource } : {}) };
    } catch {
      /* an unreadable tsconfig only costs the aliases */
    }
  }
  return { paths: [] };
}

// ---- failure classification ------------------------------------------------------------

/** What the runner reports about a thrown error. */
export interface RenderFailure {
  name?: string;
  message?: string;
  code?: string;
  /** A reason the runner already knows (a transpile error, an async component…). */
  ultra11y?: string;
}

const REASONS = new Set<RenderReason>(["provider", "props", "browser-api", "data", "transpile", "module", "timeout", "empty", "error", "no-renderer"]);
const BROWSER_GLOBALS =
  /\b(window|document|localStorage|sessionStorage|self|HTMLElement|Element|matchMedia|IntersectionObserver|ResizeObserver|MutationObserver|requestAnimationFrame|cancelAnimationFrame|getComputedStyle|customElements|location|history|indexedDB|DOMParser|Image|Audio) is not defined\b/;
const PROVIDER =
  /must be (used|wrapped|rendered) (with)?in|(used|rendered) (with)?in(side)? (a|an|the) <?[A-Z]\w*|outside (of )?(a|an|the) <?[A-Z]|\bProvider\b|\bcontext\b|app router to be mounted|NextRouter was not mounted|react-redux context|may be used only in the context of|No QueryClient set|<Router>/i;
const DATA =
  /network access is disabled|fetch failed|ECONNREFUSED|ENOTFOUND|async\/await is not yet supported|suspended|uncached promise|async server component/i;
const PROPS = /Cannot read propert(y|ies) of (undefined|null)|Cannot destructure property|is not iterable|undefined is not an object|null is not an object/;

/** Why a render threw, from the error alone. Order matters: a browser global or a missing
 *  provider is named before the TypeError it usually surfaces as. */
export function classifyRenderFailure(f: RenderFailure): RenderReason {
  if (f.ultra11y && REASONS.has(f.ultra11y as RenderReason)) return f.ultra11y as RenderReason;
  const m = f.message ?? "";
  if (f.code === "MODULE_NOT_FOUND" || f.code === "ERR_MODULE_NOT_FOUND" || /Cannot find (module|package)/.test(m)) return "module";
  if (BROWSER_GLOBALS.test(m)) return "browser-api";
  if (DATA.test(m)) return "data";
  if (PROVIDER.test(m)) return "provider";
  if (PROPS.test(m) || (f.name === "TypeError" && /is not a function/.test(m))) return "props";
  return "error";
}

const firstLine = (s: string | undefined): string | undefined => {
  const line = s
    ?.split("\n")
    .find((l) => l.trim())
    ?.trim();
  return line ? (line.length > 240 ? `${line.slice(0, 237)}…` : line) : undefined;
};

// ---- the runner -----------------------------------------------------------------------

/** The harness, run by Node in a child process (CommonJS, dependency-free). It installs an
 *  in-memory transpile hook for the project's sources, loads ONE source file, lists its
 *  component exports (or its stories), and renders each with the project's own
 *  react-dom/server. It talks to the parent on fd 3, one JSON object per line, written
 *  synchronously so a unit that hangs is known by its `start` line. Kept as a string because
 *  the engine is one bundled file: it is written to a temp dir at run time. */
export function rendererRunner(): string {
  return String.raw`"use strict";
const Module = require("node:module");
const path = require("node:path");
const fs = require("node:fs");
const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
// Node hands the hooks real paths (a temp dir behind a symlink, a linked workspace).
const ROOT = fs.realpathSync(job.root);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const exit = process.exit.bind(process);
function emit(o) { fs.writeSync(3, JSON.stringify(o) + "\n"); }
function describe(e) {
  const err = e && typeof e === "object" ? e : { message: String(e) };
  return { name: err.name, message: String(err.message || err).slice(0, 2000), code: typeof err.code === "string" ? err.code : undefined, ultra11y: err.ultra11y };
}
// The project's console chatter must not reach the parent, and its process must not end ours.
for (const k of ["log", "info", "debug", "warn", "error", "trace", "dir", "table"]) console[k] = function () {};
process.exit = function () { throw new Error("ultra11y render: the module called process.exit"); };
process.on("unhandledRejection", function () {});
// A server render has no browser: Node's own Web Storage must not pass for one.
for (const k of ["localStorage", "sessionStorage"]) { try { delete globalThis[k]; } catch (e) {} }
// No network while rendering: data fetching is reported, never performed.
globalThis.fetch = function () {
  const e = new Error("ultra11y render: network access is disabled while rendering (fetch)");
  e.ultra11y = "data";
  return Promise.reject(e);
};

const T = job.transpiler;
const tx = require(T.path);
const SEP = path.sep;
const inProject = (f) => !f.includes(SEP + "node_modules" + SEP);
function transform(code, filename) {
  const ext = path.extname(filename).toLowerCase();
  const ts = ext === ".ts" || ext === ".mts" || ext === ".cts";
  if (T.name === "esbuild") {
    const loader = ts ? "ts" : ext === ".tsx" ? "tsx" : "jsx";
    return tx.transformSync(code, { loader, format: "cjs", jsx: "automatic", jsxImportSource: job.jsxImportSource || "react", target: "node22", sourcefile: filename, logLevel: "silent" }).code;
  }
  if (T.name === "typescript") {
    const fileName = /\.[cm]?js$/.test(ext) ? filename.replace(/\.[cm]?js$/, ".jsx") : filename;
    const out = tx.transpileModule(code, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: { module: tx.ModuleKind.CommonJS, target: tx.ScriptTarget.ES2022, jsx: tx.JsxEmit.ReactJSX, jsxImportSource: job.jsxImportSource || undefined, esModuleInterop: true, allowJs: true, isolatedModules: true, sourceMap: false, ignoreDeprecations: "6.0" },
    });
    const errs = (out.diagnostics || []).filter((d) => d.file && d.category === tx.DiagnosticCategory.Error);
    if (errs.length) throw new Error(tx.flattenDiagnosticMessageText(errs[0].messageText, "\n"));
    return out.outputText;
  }
  const transforms = ts ? ["typescript", "imports"] : ext === ".tsx" ? ["typescript", "jsx", "imports"] : ["jsx", "imports"];
  return tx.transform(code, { transforms, jsxRuntime: "automatic", production: true, filePath: filename, jsxImportSource: job.jsxImportSource || undefined }).code;
}
function compile(module, filename) {
  let out;
  try {
    out = transform(fs.readFileSync(filename, "utf8"), filename);
  } catch (e) {
    // esbuild reports "Transform failed with N errors" and puts each error in "errors".
    const first = e && Array.isArray(e.errors) && e.errors[0];
    const why = first ? first.text + (first.location ? " (line " + first.location.line + ")" : "") : String((e && e.message) || e);
    const err = new Error(rel(filename) + ": " + why);
    err.ultra11y = "transpile";
    throw err;
  }
  module._compile(out, filename);
}
const nodeJs = Module._extensions[".js"];
for (const e of [".tsx", ".ts", ".jsx", ".mts", ".cts"]) Module._extensions[e] = compile;
Module._extensions[".js"] = function (module, filename) { return inProject(filename) ? compile(module, filename) : nodeJs(module, filename); };
// Styles: plain sheets are nothing to a server render; CSS modules map each class to its own name.
const cssModule = new Proxy({}, { get: (_, k) => (k === "__esModule" ? false : typeof k === "string" ? k : undefined) });
for (const e of [".css", ".scss", ".sass", ".less", ".styl", ".pcss"]) Module._extensions[e] = function (module, filename) { module.exports = /\.module\.[a-z]+$/i.test(filename) ? cssModule : {}; };
// Static assets: their public path, the shape a bundler hands a component. An SVG is also a
// component (SVGR), rendering a bare <svg> with the props it is given.
for (const e of [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".bmp", ".svg", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".webm", ".mp3", ".wav", ".pdf"]) {
  Module._extensions[e] = function (module, filename) {
    const url = "/" + rel(filename);
    if (e === ".svg") {
      const React = Module.createRequire(filename)("react");
      const Svg = function Svg(props) { return React.createElement("svg", props); };
      Object.assign(Svg, { src: url, width: 24, height: 24, ReactComponent: Svg, toString: () => url });
      module.exports = Svg;
    } else module.exports = { src: url, width: 1, height: 1, blurDataURL: "", toString: () => url };
  };
}
// Framework modules that only work inside their own compiler or server.
const font = function () { return { className: "", variable: "", style: { fontFamily: "" } }; };
const fontStub = new Proxy({ __esModule: true, default: font }, { get: (t, k) => (k in t ? t[k] : font) });
const loadNode = Module._load;
Module._load = function (request) {
  if (request === "server-only" || request === "client-only") return {};
  if (/^(next\/font\/|@next\/font\/)/.test(request)) return fontStub;
  return loadNode.apply(this, arguments);
};
// Resolution: bundler query strings, TS-style ".js" specifiers for ".ts" files, tsconfig paths.
const resolveNode = Module._resolveFilename;
function aliasCandidates(req) {
  const out = [];
  for (const p of job.paths) {
    const star = p.pattern.indexOf("*");
    if (star < 0) { if (req === p.pattern) out.push(...p.targets); continue; }
    const pre = p.pattern.slice(0, star), suf = p.pattern.slice(star + 1);
    if (req.length >= pre.length + suf.length && req.startsWith(pre) && req.endsWith(suf)) {
      const mid = req.slice(pre.length, req.length - suf.length);
      for (const t of p.targets) out.push(t.replace("*", mid));
    }
  }
  if (job.baseUrl && !req.startsWith(".") && !path.isAbsolute(req)) out.push(path.join(job.baseUrl, req));
  return out;
}
Module._resolveFilename = function (request, parent, isMain, options) {
  let req = request;
  const q = req.indexOf("?");
  if (q > 0 && !req.startsWith("node:")) req = req.slice(0, q);
  try {
    return resolveNode.call(this, req, parent, isMain, options);
  } catch (err) {
    if (parent && parent.filename && inProject(parent.filename)) {
      const m = /\.[cm]?jsx?$/.exec(req);
      if (m && (req.startsWith(".") || path.isAbsolute(req)))
        for (const e of [".ts", ".tsx", ".mts", ".cts"]) { try { return resolveNode.call(this, req.slice(0, -m[0].length) + e, parent, isMain, options); } catch (e2) {} }
      for (const c of aliasCandidates(req)) { try { return resolveNode.call(this, c, parent, isMain, options); } catch (e2) {} }
    }
    throw err;
  }
};

let mod, React, server;
try {
  mod = require(job.file);
} catch (e) {
  emit(Object.assign({ type: "load-error" }, describe(e)));
  exit(0);
}
try {
  const req = Module.createRequire(job.file);
  React = req("react");
  server = req("react-dom/server");
} catch (e) {
  emit(Object.assign({ type: "load-error" }, describe(e), { ultra11y: "no-renderer" }));
  exit(0);
}

const typeOf = (v) => (v && typeof v.$$typeof === "symbol" ? v.$$typeof.description || "" : "");
function isComponent(v) {
  if (typeof v === "function") {
    if (v.prototype && v.prototype.isReactComponent) return true;
    return !/^class[\s{]/.test(Function.prototype.toString.call(v));
  }
  return /^react\.(memo|forward_ref)$/.test(typeOf(v));
}
function isAsync(v) {
  const fn = typeOf(v) === "react.memo" ? v.type : v;
  return typeof fn === "function" && fn.constructor && fn.constructor.name === "AsyncFunction";
}
// Does the component declare props? A function with no parameter (or only defaulted ones)
// renders faithfully with none; one that takes props would render a state no user meets
// (an empty label, an image without its alt), so it is left to its stories.
function takesProps(v) {
  const t = typeOf(v);
  if (t === "react.memo") return takesProps(v.type);
  if (t === "react.forward_ref" || typeof v !== "function") return true;
  if (v.prototype && v.prototype.isReactComponent) return !v.defaultProps;
  return v.length > 0;
}
const displayName = (v, fallback) => (v && (v.displayName || v.name || (v.type && (v.type.displayName || v.type.name)) || (v.render && v.render.name))) || fallback;
const exp = mod && (typeof mod === "object" || typeof mod === "function") ? mod : {};
const units = [];
if (job.kind === "stories") {
  const meta = exp.default && typeof exp.default === "object" ? exp.default : {};
  const title = typeof meta.title === "string" ? meta.title.split("/").pop().trim() : "";
  // The component a story shows is named by its export in the sibling module (by identity:
  // an anonymous forwardRef/memo, an explicit displayName or an aliased export all have a
  // function name that is not the export's), with its display name as a fallback.
  let sibling = null;
  if (job.sibling) { try { const s = require(job.sibling); if (s && (typeof s === "object" || typeof s === "function")) sibling = s; } catch (e) {} }
  const exportOf = (c) => {
    if (!c || !sibling) return "";
    if (sibling === c) return "default";
    for (const k of Object.keys(sibling)) { try { if (sibling[k] === c) return k; } catch (e) {} }
    return "";
  };
  const names = Array.isArray(exp.__namedExportsOrder) ? exp.__namedExportsOrder : Object.keys(exp).filter((k) => k !== "default" && k !== "__esModule" && k !== "__namedExportsOrder");
  for (const k of names) {
    const story = exp[k];
    if (typeof story !== "function" && !(story && typeof story === "object")) continue;
    if (Array.isArray(meta.excludeStories) && meta.excludeStories.includes(k)) continue;
    if (Array.isArray(meta.includeStories) && !meta.includeStories.includes(k)) continue;
    const comp = (story && story.component) || meta.component;
    const args = Object.assign({}, meta.args, story && story.args);
    const render = typeof story === "function" ? story : (story && story.render) || meta.render;
    units.push({
      name: k,
      component: title || displayName(comp, k),
      of: comp ? displayName(comp, "") : "",
      ofExport: exportOf(comp),
      props: false,
      target: render || comp,
      element: () => (render ? React.createElement(function Story() { return render(args, { args, component: comp }); }) : comp ? React.createElement(comp, args) : null),
    });
  }
} else {
  const seen = new Set();
  const named = Object.keys(exp).filter((k) => k !== "default" && k !== "__esModule" && /^[A-Z]/.test(k));
  const take = (k, v) => {
    if (!isComponent(v) || seen.has(v)) return;
    seen.add(v);
    units.push({ name: k, component: k === "default" ? displayName(v, job.fallbackName) : k, displayName: displayName(v, ""), props: takesProps(v), target: v, element: () => React.createElement(v, {}) });
  };
  for (const k of named) { let v; try { v = exp[k]; } catch (e) { continue; } take(k, v); }
  if (typeof mod === "function") take("default", mod);
  else { let v; try { v = exp.default; } catch (e) {} if (v !== undefined) take("default", v); }
}
emit({
  type: "units",
  units: units.map((u) => ({
    export: u.name,
    component: u.component,
    props: u.props,
    ...(u.displayName ? { displayName: u.displayName } : {}),
    ...(u.of ? { of: u.of } : {}),
    ...(u.ofExport ? { ofExport: u.ofExport } : {}),
  })),
});
for (const u of units) {
  if (u.props || job.skip.includes(u.name)) continue;
  emit({ type: "start", export: u.name });
  if (isAsync(u.target)) {
    emit({ type: "result", export: u.name, ok: false, ultra11y: "data", message: "async server component" });
    continue;
  }
  try {
    const el = u.element();
    if (!el) { emit({ type: "result", export: u.name, ok: false, ultra11y: "props", message: "story with neither a component nor a render function" }); continue; }
    emit({ type: "result", export: u.name, ok: true, html: server.renderToStaticMarkup(el) });
  } catch (e) {
    emit(Object.assign({ type: "result", export: u.name, ok: false }, describe(e)));
  }
}
emit({ type: "done" });
exit(0);
`;
}

// ---- running one file -------------------------------------------------------------------

interface RunnerJob {
  root: string;
  file: string;
  kind: "module" | "stories";
  fallbackName: string;
  transpiler: { name: string; path: string };
  paths: PathAlias[];
  baseUrl?: string;
  jsxImportSource?: string;
  /** For a stories file: the sibling module whose exports its stories show. */
  sibling?: string;
  skip: string[];
}

interface UnitOutcome {
  ok: boolean;
  html?: string;
  failure?: RenderFailure;
  timeout?: boolean;
}

/** A unit as the runner lists it: `props` when the component declares props (not rendered
 *  without them), `displayName` a module export's own name, `of` the display name of the
 *  component a story shows and `ofExport` the sibling module's export that IS that component. */
interface ListedUnit {
  export: string;
  component: string;
  props?: boolean;
  displayName?: string;
  of?: string;
  ofExport?: string;
}

interface FileOutcome {
  /** Exports in the order the module listed them, with their component names. */
  units: ListedUnit[];
  results: Map<string, UnitOutcome>;
  /** The whole file failed before any unit could be tried. */
  fileFailure?: RenderFailure & { timeout?: boolean };
}

interface Attempt {
  units?: ListedUnit[];
  results: Map<string, UnitOutcome>;
  loadError?: RenderFailure;
  hung?: string | "load";
  done: boolean;
  current?: string;
  exitCode: number | null;
  stderr: string;
}

function attempt(runner: string, jobFile: string, cwd: string, unitMs: number, loadMs: number): Promise<Attempt> {
  return new Promise((resolveAttempt) => {
    const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", runner, jobFile], {
      cwd,
      stdio: ["ignore", "ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production", ULTRA11Y_RENDER: "1" },
    });
    const a: Attempt = { results: new Map(), done: false, exitCode: null, stderr: "" };
    let buf = "";
    let timer: NodeJS.Timeout | undefined;
    const arm = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        a.hung = a.current ?? "load";
        child.kill("SIGKILL");
      }, ms);
    };
    arm(loadMs);
    const onLine = (line: string) => {
      if (!line.trim()) return;
      let msg: { type?: string; export?: string; units?: ListedUnit[]; ok?: boolean; html?: string } & RenderFailure;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === "units") a.units = msg.units ?? [];
      else if (msg.type === "start" && msg.export) {
        a.current = msg.export;
        arm(unitMs);
      } else if (msg.type === "result" && msg.export) {
        a.results.set(
          msg.export,
          msg.ok
            ? { ok: true, html: msg.html ?? "" }
            : { ok: false, failure: { name: msg.name, message: msg.message, code: msg.code, ultra11y: msg.ultra11y } },
        );
        a.current = undefined;
      } else if (msg.type === "load-error") a.loadError = { name: msg.name, message: msg.message, code: msg.code, ultra11y: msg.ultra11y };
      else if (msg.type === "done") a.done = true;
    };
    const fd3 = child.stdio[3] as NodeJS.ReadableStream | null;
    fd3?.setEncoding("utf8");
    fd3?.on("data", (chunk: string) => {
      buf += chunk;
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        onLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (c: string) => {
      if (a.stderr.length < 4000) a.stderr += c;
    });
    child.on("error", (e) => {
      a.loadError = { message: e.message };
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (buf) onLine(buf);
      a.exitCode = code;
      resolveAttempt(a);
    });
  });
}

/** Render every unit of one file, re-running past a unit that hangs or kills the process. */
async function renderFile(runner: string, tmp: string, job: Omit<RunnerJob, "skip">, unitMs: number): Promise<FileOutcome> {
  const out: FileOutcome = { units: [], results: new Map() };
  const loadMs = Math.max(30_000, unitMs);
  const skip = new Set<string>();
  const jobFile = join(tmp, `job-${Math.random().toString(36).slice(2)}.json`);
  try {
    for (let round = 0; round < 200; round++) {
      writeFileSync(jobFile, JSON.stringify({ ...job, skip: [...skip] }));
      const a = await attempt(runner, jobFile, job.root, unitMs, loadMs);
      if (a.units && !out.units.length) out.units = a.units;
      for (const [k, v] of a.results) {
        out.results.set(k, v);
        skip.add(k);
      }
      if (a.loadError) {
        out.fileFailure = a.loadError;
        break;
      }
      if (a.done) break;
      if (a.hung === "load" || (!a.units && !a.hung)) {
        out.fileFailure =
          a.hung === "load"
            ? { message: `loading the module did not finish within ${loadMs} ms`, timeout: true }
            : { message: firstLine(a.stderr) ?? `the render process exited with code ${a.exitCode}` };
        break;
      }
      const stuck = a.hung ?? a.current ?? (a.units ?? []).find((u) => !u.props && !skip.has(u.export))?.export;
      if (!stuck) break; // every listed unit has a result
      out.results.set(
        stuck,
        a.hung ? { ok: false, timeout: true } : { ok: false, failure: { message: firstLine(a.stderr) ?? `the render process exited with code ${a.exitCode}` } },
      );
      skip.add(stuck);
    }
  } finally {
    rmSync(jobFile, { force: true });
  }
  return out;
}

// ---- the run ---------------------------------------------------------------------------

export interface RenderRunOptions extends DiscoverRenderOpts {
  /** Project root: where the sources are discovered and `.ultra11y/` is written. */
  root: string;
  /** Per-unit render budget, in ms. */
  timeoutMs?: number;
  /** Files rendered at once (one child process each). */
  concurrency?: number;
  /** Force a transpiler (by name), or hand one in already resolved. */
  transpiler?: TranspilerName | ResolvedTool;
  onProgress?: (done: number, total: number, file: string) => void;
}

const slug = (s: string): string =>
  s
    .replace(/\.[^./]+$/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "") || "unit";

function componentFallback(rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  const stem = base.replace(/\.[^.]+$/, "").replace(/\.stories$/i, "");
  // `index.tsx` / `page.tsx` say nothing; the directory does.
  if (/^(index|page|layout)$/i.test(stem)) return rel.split("/").slice(-2, -1)[0] ?? stem;
  return stem;
}

/** A story's capture is attributed to the component it shows: the sibling of `X.stories.tsx`
 *  when it exists, else the stories file itself (the same rule as `render --storybook`). */
function storySource(root: string, rel: string): string {
  for (const e of [".tsx", ".jsx", ".ts", ".js"]) {
    const sib = rel.replace(STORIES, e);
    if (sib !== rel && existsSync(join(root, sib))) return sib;
  }
  return rel;
}

/** Run the engine over `root`: discover, render, write the captures and the manifest. */
export async function runRenderEngine(opts: RenderRunOptions): Promise<RenderManifest> {
  const root = resolve(opts.root);
  const unitMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_RENDER_TIMEOUT_MS;
  const { targets, testFilesIgnored } = discoverRenderTargets(root, opts);
  const renderer = resolveRenderer(root);
  const transpiler = typeof opts.transpiler === "object" ? opts.transpiler : resolveTranspiler(root, opts.transpiler);
  const rendererLabel = renderer ? `${renderer.name} ${renderer.version}` : undefined;
  const units: RenderUnit[] = [];
  const usedIds = new Set<string>();
  const idFor = (file: string, exp: string): string => {
    const base = `${slug(file)}__${exp === "*" ? "file" : slug(exp)}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    return id;
  };
  const kindOf = (t: RenderTarget): RenderUnit["kind"] => (t.kind === "stories" ? "story" : t.route !== undefined ? "page" : "component");
  const fileLevel = (t: RenderTarget, status: RenderUnit["status"], reason: RenderReason, detail?: string): RenderUnit => ({
    id: idFor(t.file, "*"),
    file: t.file,
    export: "*",
    component: componentFallback(t.file),
    kind: kindOf(t),
    ...(t.route !== undefined ? { route: t.route } : {}),
    status,
    reason,
    ...(detail ? { detail } : {}),
  });

  const runnable = targets.filter((t) => t.kind !== "sfc");
  for (const t of targets.filter((x) => x.kind === "sfc")) units.push(fileLevel(t, "not-attempted", "unsupported-renderer"));
  // `detail` only ever carries what the project's code said (an error's first line) or a
  // measure: the reason itself is labelled, localized, by the report and the CLI.
  const blocker: RenderReason | undefined = !renderer ? "no-renderer" : !transpiler ? "no-transpiler" : undefined;
  const written = new Map<string, string>(); // capture id → content
  if (blocker) for (const t of runnable) units.push(fileLevel(t, "not-attempted", blocker));
  else if (runnable.length) {
    const tmp = mkdtempSync(join(tmpdir(), "ultra11y-render-"));
    const runner = join(tmp, "runner.cjs");
    writeFileSync(runner, rendererRunner());
    const aliases = aliasesOf(root);
    const tool = transpiler as ResolvedTool;
    const transpilerName = TRANSPILERS.find((n) => tool.name === n || tool.name.startsWith(`${n}@`)) ?? tool.name;
    const outcomes = new Map<RenderTarget, FileOutcome>();
    let next = 0;
    let done = 0;
    const workers = Math.max(1, Math.min(opts.concurrency ?? Math.min(4, availableParallelism()), runnable.length));
    try {
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (next < runnable.length) {
            const t = runnable[next++] as RenderTarget;
            const job: Omit<RunnerJob, "skip"> = {
              root,
              file: join(root, t.file),
              kind: t.kind === "stories" ? "stories" : "module",
              fallbackName: componentFallback(t.file),
              ...(t.kind === "stories" && storySource(root, t.file) !== t.file ? { sibling: join(root, storySource(root, t.file)) } : {}),
              transpiler: { name: transpilerName, path: tool.path },
              paths: aliases.paths,
              ...(aliases.baseUrl ? { baseUrl: aliases.baseUrl } : {}),
              ...(aliases.jsxImportSource ? { jsxImportSource: aliases.jsxImportSource } : {}),
            };
            outcomes.set(t, await renderFile(runner, tmp, job, unitMs));
            opts.onProgress?.(++done, runnable.length, t.file);
          }
        }),
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    // The components a story shows, by source file: they are rendered through their stories.
    // Matched on the export the story's component IS (identity, in the runner), else on a name:
    // the export name of a named export differs from the function or display name whenever the
    // component is an anonymous forwardRef/memo, sets a displayName or is exported under an alias.
    const storied = new Set<string>();
    for (const t of runnable) {
      if (t.kind !== "stories") continue;
      const src = storySource(root, t.file);
      for (const u of outcomes.get(t)?.units ?? []) {
        if (u.ofExport) storied.add(`${src}#export:${u.ofExport}`);
        if (u.of) storied.add(`${src}#name:${u.of}`);
      }
    }
    const isStoried = (file: string, u: ListedUnit): boolean =>
      storied.has(`${file}#export:${u.export}`) ||
      storied.has(`${file}#name:${u.component}`) ||
      (!!u.displayName && storied.has(`${file}#name:${u.displayName}`));
    for (const t of runnable) {
      const o = outcomes.get(t) as FileOutcome;
      if (o.fileFailure && !o.units.length) {
        units.push(fileLevel(t, "skipped", o.fileFailure.timeout ? "timeout" : classifyRenderFailure(o.fileFailure), firstLine(o.fileFailure.message)));
        continue;
      }
      const source = t.kind === "stories" ? storySource(root, t.file) : t.file;
      for (const u of o.units) {
        const r = o.results.get(u.export);
        const id = idFor(t.file, u.export);
        const base: RenderUnit = {
          id,
          file: t.file,
          export: u.export,
          component: u.component,
          kind: kindOf(t),
          ...(t.route !== undefined && u.export === "default" ? { route: t.route } : {}),
          status: "skipped",
        };
        if (u.props)
          units.push(isStoried(t.file, u) ? { ...base, status: "not-attempted", reason: "via-story" } : { ...base, status: "not-attempted", reason: "props" });
        else if (!r) units.push({ ...base, reason: "error", detail: "the render process ended before this unit was tried" });
        else if (r.timeout) units.push({ ...base, reason: "timeout", detail: `${unitMs} ms` });
        else if (!r.ok)
          units.push({
            ...base,
            reason: classifyRenderFailure(r.failure ?? {}),
            ...(firstLine(r.failure?.message) ? { detail: firstLine(r.failure?.message) } : {}),
          });
        else if (!r.html?.trim()) units.push({ ...base, reason: "empty" });
        else {
          const comment = formatCaptureComment({
            v: 1,
            sourceFile: source,
            component: u.component,
            name: t.kind === "stories" ? `story ${u.export} (args)` : `${u.export === "default" ? "default export" : u.export} (no props)`,
            ...(rendererLabel ? { renderer: rendererLabel } : {}),
            styles: "none",
          });
          written.set(id, `${comment}\n${r.html.trim()}\n`);
          units.push({ ...base, status: "rendered", capture: `${CAPTURES_DIR}/${id}.html` });
        }
      }
      // A file whose load failed after listing units would be odd, but never silent.
      if (o.fileFailure) units.push(fileLevel(t, "skipped", classifyRenderFailure(o.fileFailure), firstLine(o.fileFailure.message)));
    }
  }

  // Write: captures byte-stable (rewritten only when they change); the previous run's captures
  // that this run did not render are removed, so a component that now fails is not audited on
  // its stale markup. Captures of other producers (Storybook attribution) are never touched.
  const capDir = join(root, CAPTURES_DIR);
  const previous = readRenderManifest(join(root, RENDER_MANIFEST));
  for (const u of previous?.units ?? []) {
    if (!u.capture || written.has(u.id)) continue;
    const f = join(root, u.capture);
    if (existsSync(f)) unlinkSync(f);
  }
  if (written.size) mkdirSync(capDir, { recursive: true });
  for (const [id, content] of written) {
    const f = join(capDir, `${id}.html`);
    if (!existsSync(f) || readFileSync(f, "utf8") !== content) writeFileSync(f, content);
  }
  units.sort((a, b) => a.file.localeCompare(b.file) || a.export.localeCompare(b.export));
  const manifest: RenderManifest = {
    v: 1,
    ...(rendererLabel ? { renderer: rendererLabel } : {}),
    ...(transpiler ? { transpiler: `${transpiler.name} ${transpiler.version}` } : {}),
    testFilesIgnored,
    units,
  };
  const manifestPath = join(root, RENDER_MANIFEST);
  mkdirSync(dirname(manifestPath), { recursive: true });
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!existsSync(manifestPath) || readFileSync(manifestPath, "utf8") !== text) writeFileSync(manifestPath, text);
  return manifest;
}

// ---- reading it back -------------------------------------------------------------------

export function readRenderManifest(path: string): RenderManifest | undefined {
  try {
    const m = JSON.parse(readFileSync(path, "utf8")) as RenderManifest;
    return m && m.v === 1 && Array.isArray(m.units) ? m : undefined;
  } catch {
    return undefined;
  }
}

export function renderCounts(units: readonly RenderUnit[]): { rendered: number; skipped: number; notAttempted: number } {
  let rendered = 0;
  let skipped = 0;
  let notAttempted = 0;
  for (const u of units) {
    if (u.status === "rendered") rendered++;
    else if (u.status === "skipped") skipped++;
    else notAttempted++;
  }
  return { rendered, skipped, notAttempted };
}

/** `scope.renders` from the manifest beside a captures dir (`<dir>/../render.json`). */
export function renderScopeFor(capturesDir: string): RenderScope | undefined {
  const manifestPath = join(dirname(capturesDir.replace(/[/\\]+$/, "")), "render.json");
  const m = readRenderManifest(manifestPath);
  if (!m) return undefined;
  return {
    manifest: toPosix(relative(process.cwd(), resolve(manifestPath))) || toPosix(manifestPath),
    ...(m.renderer ? { renderer: m.renderer } : {}),
    ...(m.transpiler ? { transpiler: m.transpiler } : {}),
    ...renderCounts(m.units),
    units: m.units,
  };
}
