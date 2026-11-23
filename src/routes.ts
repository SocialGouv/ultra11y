// THE ROUTE INVENTORY — every route of the application, and how each one was observed.
//
// The declared sample (`.ultra11yrc.json` `sample.pages`) is the RGAA sample: the pages the
// audit's verdicts are stated over. It is not the application. A full audit has to be able to
// say, for every route the application has, whether a browser ever saw it — otherwise a route
// nobody visited is simply absent from the deliverable, and an absent route reads exactly like
// a route that was fine.
//
// So discovery (`pages discover --write`: sitemap, crawl, or the snapshots an E2E run wrote)
// persists the inventory to `.ultra11y/routes.json`, and every audit that finds one classifies
// each route — captured by the project's E2E run, scanned by ultra11y's browser, seen in source
// only, or not reached — into `scope.routes`, which the report's annex lists in full.
//
// Routes are matched on their PATH (pathname + query), never on the full URL: a sitemap lists
// the production host, the E2E run captures `localhost:3000`, and both are the same route.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RouteCoverage, ScanRedirect } from "./types.js";

export const ROUTES_FILE = ".ultra11y/routes.json";

/** How a route entered the inventory. */
export type RouteSource = "sitemap" | "crawl" | "snapshots";

export interface RouteInventory {
  v: 1;
  routes: { url: string; via: RouteSource[] }[];
}

/** Default bound of `scan --all-routes`: enough for most applications, and stated in the
 *  report when it cuts — a route left out by the bound is listed, never dropped. */
export const ALL_ROUTES_MAX = 50;

/** The key a route is matched on: pathname + query, without a trailing slash or `index.html`.
 *  A `file://` URL or a bare path keeps its path. */
export function routePath(url: string): string {
  let path: string;
  try {
    const u = new URL(url);
    path = decodeURI(u.pathname) + u.search;
  } catch {
    path = url;
  }
  const [p, q] = path.split("?", 2) as [string, string | undefined];
  let base = p.replace(/\/index\.html?$/i, "/");
  if (base.length > 1) base = base.replace(/\/+$/, "");
  if (!base) base = "/";
  return q ? `${base}?${q}` : base;
}

export function readRoutes(root: string): RouteInventory | undefined {
  const file = join(root, ROUTES_FILE);
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<RouteInventory>;
    if (!Array.isArray(raw.routes)) return undefined;
    const routes = raw.routes.filter((r): r is RouteInventory["routes"][number] => !!r && typeof r.url === "string" && r.url.length > 0);
    return { v: 1, routes: routes.map((r) => ({ url: r.url, via: Array.isArray(r.via) ? r.via : [] })) };
  } catch {
    return undefined;
  }
}

/** Merge discovered URLs into the inventory (union by path; a known route gains the new source).
 *  Returns the file written, how many routes were new, and the total. */
export function writeRoutes(root: string, urls: readonly string[], via: RouteSource): { file: string; added: number; total: number } {
  const file = join(root, ROUTES_FILE);
  const inv = readRoutes(root) ?? { v: 1 as const, routes: [] };
  const byPath = new Map(inv.routes.map((r) => [routePath(r.url), r]));
  let added = 0;
  for (const url of urls) {
    const key = routePath(url);
    const hit = byPath.get(key);
    if (hit) {
      if (!hit.via.includes(via)) hit.via.push(via);
      continue;
    }
    const entry = { url, via: [via] };
    byPath.set(key, entry);
    inv.routes.push(entry);
    added++;
  }
  inv.routes.sort((a, b) => routePath(a.url).localeCompare(routePath(b.url)));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(inv, null, 2)}\n`);
  return { file, added, total: inv.routes.length };
}

/** A recorded page, to exactly what the classification reads. `runner` is the snapshot's
 *  producer: "scan" for ultra11y's browser, anything else for the project's own run. */
export interface ObservedPage {
  /** The snapshot id under `.ultra11y/pages`, when one was recorded — absent for a page a
   *  `scan --no-snapshot` visited without persisting it. */
  id?: string;
  url: string;
  runner?: string;
}

export interface RouteCoverageInput {
  inventory?: RouteInventory;
  /** The declared RGAA sample. */
  sample?: readonly { id: string; url: string; sources?: string[] }[];
  /** The pages recorded under `.ultra11y/pages`. */
  pages?: readonly ObservedPage[];
  /** Pages a scan refused to record, and why. */
  refused?: readonly ScanRedirect[];
  /** Routes `scan --all-routes` left out because of its bound. */
  bounded?: readonly string[];
  /** The bound itself, for the reason line. */
  max?: number;
}

const ORDER: Record<RouteCoverage["observed"], number> = { captured: 0, scanned: 1, source: 2, "not-reached": 3 };

/** Every route the run knows of — inventory, sample and recorded pages — with how it was
 *  observed. A route is `captured` when the project's E2E run recorded it, `scanned` when
 *  ultra11y's browser did, `source` when only the sample's declared source files were audited,
 *  and `not-reached` otherwise, with the reason when one is known. Sample routes first. */
export function routeCoverage(input: RouteCoverageInput): RouteCoverage[] {
  const rows = new Map<string, RouteCoverage>();
  const ensure = (url: string): RouteCoverage => {
    const key = routePath(url);
    let row = rows.get(key);
    if (!row) {
      row = { path: key, url, sample: false, observed: "not-reached" };
      rows.set(key, row);
    }
    return row;
  };
  for (const r of input.inventory?.routes ?? []) ensure(r.url);
  for (const s of input.sample ?? []) {
    const row = ensure(s.url);
    row.sample = true;
    if (row.observed === "not-reached" && s.sources?.length) row.observed = "source";
  }
  for (const p of input.pages ?? []) {
    const row = ensure(p.url);
    const observed: RouteCoverage["observed"] = p.runner === "scan" ? "scanned" : "captured";
    // The strongest observation wins: a route the E2E run captured AND the scan visited is
    // reported as captured, the state the project's own tests built.
    if (ORDER[observed] < ORDER[row.observed] || (observed === row.observed && !row.page)) {
      row.observed = observed;
      if (p.id) row.page = p.id;
    }
  }
  for (const r of input.refused ?? []) {
    const row = ensure(r.requested);
    if (row.observed !== "not-reached") continue;
    const detail = r.reason === "http-status" ? String(r.status ?? "") : r.reason === "error" ? r.detail : r.landed;
    row.why = { reason: r.reason ?? "redirect", ...(detail ? { detail } : {}) };
  }
  for (const url of input.bounded ?? []) {
    const row = ensure(url);
    if (row.observed === "not-reached" && !row.why) row.why = { reason: "max-routes", ...(input.max !== undefined ? { detail: String(input.max) } : {}) };
  }
  return [...rows.values()].sort((a, b) => Number(b.sample) - Number(a.sample) || a.path.localeCompare(b.path));
}

/** Counts per observation, for a one-line summary. */
export function routeCounts(rows: readonly RouteCoverage[]): Record<RouteCoverage["observed"], number> {
  const out = { captured: 0, scanned: 0, source: 0, "not-reached": 0 };
  for (const r of rows) out[r.observed]++;
  return out;
}

/** The inventory routes `scan --all-routes` should visit beyond the sample: not in the sample,
 *  not already captured by the project's E2E run (that capture holds the state the tests built,
 *  and wins), bounded by `max`. Returns the URLs to scan and the ones the bound left out. */
export function routesToScan(
  inventory: RouteInventory,
  opts: { sample?: readonly { url: string }[]; captured?: readonly ObservedPage[]; max?: number },
): { scan: string[]; captured: string[]; bounded: string[] } {
  const inSample = new Set((opts.sample ?? []).map((s) => routePath(s.url)));
  const capturedPaths = new Set((opts.captured ?? []).filter((p) => p.runner !== "scan").map((p) => routePath(p.url)));
  const max = opts.max ?? ALL_ROUTES_MAX;
  const rest: string[] = [];
  const captured: string[] = [];
  for (const r of inventory.routes) {
    const key = routePath(r.url);
    if (inSample.has(key)) continue;
    if (capturedPaths.has(key)) captured.push(r.url);
    else rest.push(r.url);
  }
  return { scan: rest.slice(0, max), captured, bounded: rest.slice(max) };
}
