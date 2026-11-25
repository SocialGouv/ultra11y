// `affected` — which pages can a diff change?
//
// The review of a pull request renders only the pages the change can reach: rendering the
// whole application on every PR costs minutes, rendering nothing leaves the rendering criteria
// (contrast, focus, reflow) unchecked. The answer is read off the import graph the cross-file
// rules already build (src/graph/*): from each changed file, walk the REVERSE import edges up
// to the files a page starts from, then name those pages' URLs.
//
// A page starts from:
//   - a file-system route file: a Next.js App Router `app/**/page.*` (its URL is its directory,
//     route groups `(x)` and parallel slots `@x` dropped), a `layout`/`template` (every page
//     below it), or a Pages Router `pages/**` file (`_app`/`_document` wrap every page);
//   - a source a sample page declares (`.ultra11yrc.json` `sample.pages[].sources`), which is
//     how a project whose router is configured in code says which file renders which page.
//
// A route file's URL is a PATTERN when it has a dynamic segment (`[id]`, `[...slug]`); it is
// resolved against the known pages — the route inventory (`.ultra11y/routes.json`) and the
// sample — and a pattern nothing resolves is listed, never guessed.
//
// Every trade is made in one direction: when in doubt, select. A page rendered for nothing
// costs a few seconds; a page skipped that the change touched ships its regression. So the walk
// is file-level (a barrel selects every page importing it), and a changed markup file that
// reaches no page is reported rather than dropped.
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { discover } from "./discover.js";
import { GRAPH_ONLY_EXT, isTestArtifact, toPosix } from "./glob.js";
import { buildGraphStreaming } from "./graph/build.js";
import { importersOf, type DepGraph } from "./graph/graph.js";
import { routePath, type RouteInventory } from "./routes.js";
import type { SamplePage } from "./types.js";

/** What makes a file a page's starting point. */
export type EntryKind = "page" | "layout" | "sample";

export interface AffectedRoute {
  /** The route path (pathname + query), host-free — what the route inventory matches on. */
  path: string;
  /** The URL to render: rebased onto the base URL when one is given, else the known URL. */
  url?: string;
  /** The route file or declared source that selected this page (root-relative). */
  entry: string;
  kind: EntryKind;
  /** The sample page id, when the page is one. */
  sampleId?: string;
  /** The changed files that reach it (root-relative, first few). */
  changed: string[];
}

export interface AffectedResult {
  /** Changed files, root-relative. */
  changed: string[];
  /** The pages to render, sorted by path. */
  routes: AffectedRoute[];
  /** Dynamic route files the diff reaches that no known page resolves: add a concrete URL of
   *  each to the route inventory or the sample, or they are not rendered. */
  unresolved: { entry: string; pattern: string }[];
  /** Changed markup no page reaches: a page the sample does not declare, or dead code. */
  unmapped: string[];
}

export interface AffectedInput {
  /** Project root; `changed`, sample sources and the result are relative to it. */
  root: string;
  changed: string[];
  inventory?: RouteInventory;
  sample?: readonly Pick<SamplePage, "id" | "url" | "sources">[];
  /** Rebase every URL onto this origin (the preview deployment the review renders). */
  baseUrl?: string;
  /** A prebuilt graph over the root (tests); built from the root's files otherwise. */
  graph?: DepGraph;
}

const MARKUP_EXT = /\.(?:html?|xhtml|jsx|tsx|vue|svelte|astro|mdx)$/i;
const APP_PAGE = /(?:^|\/)app\/(?:(.+)\/)?page\.(?:tsx|jsx|ts|js|mdx)$/;
const APP_WRAPPER = /(?:^|\/)app\/(?:(.+)\/)?(?:layout|template)\.(?:tsx|jsx|ts|js)$/;
// Pages Router (Next.js, also Nuxt/Astro file routing): `pages/**`, minus API routes.
const PAGES_FILE = /(?:^|\/)pages\/(?!api\/)(.+)\.(?:tsx|jsx|ts|js|mdx|md|vue|astro|svelte)$/;

/** URL segments of an App Router directory: route groups and parallel slots render no segment. */
function appSegments(dir: string | undefined): string[] {
  return (dir ?? "").split("/").filter((s) => s && !/^\(.*\)$/.test(s) && !s.startsWith("@"));
}

/** The route pattern a route file serves, its kind, and — for a wrapper — the directory whose
 *  pages it wraps. `null` when the file is no route file. */
export function routeOfFile(rel: string): { kind: "page" | "layout"; pattern: string; dir?: string } | null {
  if (isTestArtifact(rel)) return null;
  const page = rel.match(APP_PAGE);
  if (page) return { kind: "page", pattern: `/${appSegments(page[1]).join("/")}` };
  const wrapper = rel.match(APP_WRAPPER);
  if (wrapper) return { kind: "layout", pattern: `/${appSegments(wrapper[1]).join("/")}`, dir: rel.slice(0, rel.lastIndexOf("/")) };
  const pages = rel.match(PAGES_FILE);
  if (pages) {
    const segs = (pages[1] ?? "").split("/");
    // `_app`/`_document` wrap every page of the router; any other `_x` is not a route.
    if (segs.at(-1) === "_app" || segs.at(-1) === "_document") return { kind: "layout", pattern: "/", dir: rel.match(/^(.*?(?:^|\/)pages)\//)?.[1] ?? "pages" };
    if (segs.some((s) => s.startsWith("_"))) return null;
    if (segs.at(-1) === "index") segs.pop();
    return { kind: "page", pattern: `/${segs.join("/")}` };
  }
  return null;
}

/** A matcher for a route pattern: `[id]` takes one segment, `[...slug]` one or more,
 *  `[[...slug]]` zero or more. */
function patternMatcher(pattern: string): (path: string) => boolean {
  if (!pattern.includes("[")) return (p) => p === pattern;
  const segs = pattern.split("/").filter(Boolean);
  let re = "";
  for (const s of segs) {
    if (/^\[\[\.\.\..+\]\]$/.test(s)) re += "(?:/[^?]+)?";
    else if (/^\[\.\.\..+\]$/.test(s)) re += "/[^?]+";
    else if (/^\[.+\]$/.test(s)) re += "/[^/?]+";
    else re += `/${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`;
  }
  const compiled = new RegExp(`^${re || "/"}$`);
  return (p) => compiled.test(p.split("?")[0] ?? p);
}

/** Rebase a known URL (or a bare path) onto the review's base URL. */
function rebase(path: string, known: string | undefined, baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return known;
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

/** Every graph file reached walking the import edges backwards from `start`, `start` included.
 *  A route file stops the walk: whatever imports a page does not render it. */
function reverseClosure(graph: DepGraph, start: string, rel: (f: string) => string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift() as string;
    if (cur !== start && routeOfFile(rel(cur))) continue;
    for (const importer of importersOf(graph, cur)) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      queue.push(importer);
    }
  }
  return seen;
}

/** The graph the selection walks: every source file under the root, scripts included. */
export function buildAffectedGraph(root: string): DepGraph {
  return buildGraphStreaming(discover([root], { ext: [...GRAPH_ONLY_EXT] }).files);
}

export function selectAffected(input: AffectedInput): AffectedResult {
  const root = resolve(input.root);
  const toRel = (key: string): string => toPosix(relative(root, resolve(key)));
  const changed = [...new Set(input.changed.map((c) => posix.normalize(toPosix(c)).replace(/^\.\//, "")))].sort();
  const empty: AffectedResult = { changed, routes: [], unresolved: [], unmapped: [] };
  if (!changed.length) return empty;
  const graph = input.graph ?? buildAffectedGraph(root);
  // Graph keys are the paths discovery produced (cwd-relative or absolute, as the root was
  // given); everything reported is root-relative. Translate at the boundary.
  const keyOf = new Map([...graph.known].map((k) => [toRel(k), k]));

  // Known pages: the sample first (its URL and its declared sources), then the inventory.
  const known = new Map<string, { url: string; sampleId?: string }>();
  for (const s of input.sample ?? []) known.set(routePath(s.url), { url: s.url, sampleId: s.id });
  for (const r of input.inventory?.routes ?? []) if (!known.has(routePath(r.url))) known.set(routePath(r.url), { url: r.url });
  const sourceOf = new Map<string, Pick<SamplePage, "id" | "url">[]>();
  for (const s of input.sample ?? [])
    for (const src of s.sources ?? []) {
      const k = posix.normalize(toPosix(src)).replace(/^\.\//, "");
      sourceOf.set(k, [...(sourceOf.get(k) ?? []), s]);
    }
  const pageFiles = [...graph.known].map(toRel).filter((f) => routeOfFile(f)?.kind === "page");

  const routes = new Map<string, AffectedRoute>();
  const unresolved = new Map<string, { entry: string; pattern: string }>();
  const add = (path: string, entry: string, kind: EntryKind, file: string, sampleId?: string): void => {
    const hit = known.get(path);
    const row = routes.get(path) ?? {
      path,
      ...(rebase(path, hit?.url, input.baseUrl) ? { url: rebase(path, hit?.url, input.baseUrl) } : {}),
      entry,
      kind,
      ...((sampleId ?? hit?.sampleId) ? { sampleId: sampleId ?? hit?.sampleId } : {}),
      changed: [],
    };
    if (!row.changed.includes(file) && row.changed.length < 5) row.changed.push(file);
    routes.set(path, row);
  };
  // `page` is the route file the pattern comes from: an unresolved route is named by it, once,
  // whether the page itself or a layout above it was reached.
  const addPattern = (pattern: string, page: string, entry: string, kind: EntryKind, file: string): void => {
    if (!pattern.includes("[")) {
      add(pattern, entry, kind, file);
      return;
    }
    const match = patternMatcher(pattern);
    const hits = [...known.keys()].filter(match);
    if (!hits.length) unresolved.set(page, { entry: page, pattern });
    for (const h of hits) add(h, entry, kind, file);
  };

  const unmapped: string[] = [];
  for (const file of changed) {
    const key = keyOf.get(file);
    // A file the graph does not hold (a stylesheet, a deleted file) reaches only itself, and
    // only while it exists: a deleted page has nothing left to render.
    const reached = key ? [...reverseClosure(graph, key, toRel)].map(toRel) : existsSync(join(root, file)) ? [file] : [];
    let hit = false;
    for (const f of reached) {
      for (const s of sourceOf.get(f) ?? []) {
        add(routePath(s.url), f, "sample", file, s.id);
        hit = true;
      }
      const route = routeOfFile(f);
      if (!route) continue;
      hit = true;
      if (route.kind === "page") addPattern(route.pattern, f, f, "page", file);
      else for (const pf of pageFiles.filter((p) => p.startsWith(`${route.dir}/`))) addPattern(routeOfFile(pf)!.pattern, pf, f, "layout", file);
    }
    if (!hit && MARKUP_EXT.test(file) && !isTestArtifact(file) && existsSync(join(root, file))) unmapped.push(file);
  }
  return {
    changed,
    routes: [...routes.values()].sort((a, b) => a.path.localeCompare(b.path)),
    unresolved: [...unresolved.values()],
    unmapped,
  };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

/** Files changed on the branch since its merge-base with `ref` (`git diff <ref>...HEAD`), plus
 *  what is not committed yet, root-relative. Throws a readable error when the ref does not
 *  resolve (a shallow clone without the base branch is the usual cause). */
export function changedSince(ref: string, root: string): string[] {
  let abs = resolve(root);
  try {
    abs = realpathSync(abs);
  } catch {
    /* a missing root fails at the git call below */
  }
  let top: string;
  try {
    top = git(abs, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new Error(`${root} is not inside a git repository.`);
  }
  let committed: string;
  try {
    committed = git(abs, ["diff", "--name-only", "--no-renames", `${ref}...HEAD`]);
  } catch {
    throw new Error(`no merge-base between "${ref}" and HEAD — fetch the base branch with its history, or pass a ref that exists.`);
  }
  const lines = (s: string): string[] =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const all = [
    ...lines(committed),
    ...lines(git(top, ["diff", "--name-only", "--no-renames", "HEAD"])),
    ...lines(git(top, ["ls-files", "--others", "--exclude-standard"])),
  ];
  return [...new Set(all.map((p) => toPosix(relative(abs, join(top, p)))))].filter((p) => !p.startsWith("../")).sort();
}
