// The cross-file dependency + component graph: a map of compact per-file nodes
// plus the queries the cross-file rules need. Built once (pass 1) over the full
// discovered scope; consumed (read-only) during the audit pass.
import type { FileGraphNode, ComponentDef } from "./imports.js";
import { makeSpecResolver, type SpecResolver } from "./spec-resolve.js";
import type { AliasMap } from "./tsconfig.js";
import { toPosix } from "../glob.js";
import { isAppRouteFile } from "../rules/next-metadata.js";

export interface DepGraph {
  nodes: Map<string, FileGraphNode>; // posix file -> node
  known: ReadonlySet<string>; // all discovered files (posix), for specifier resolution
  allIds: ReadonlySet<string>; // every literal id defined anywhere (global skip-link lookup)
  // Engine-backed specifier resolution (relative / ESM ".js" / tsconfig-alias
  // imports) bounded to `known`, with the original resolver as fallback.
  resolveSpec: SpecResolver;
  // Memo for `resolveUsage` top-level lookups (`file#name` -> def, null = "no such
  // component"). Read-only graph, so a hit is always correct; see resolveUsage.
  usageCache: Map<string, ComponentDef | null>;
  // Reverse import edges (`file` -> the files importing or re-exporting it), built on first
  // use by `importersOf`. Most audits never ask, so the graph does not pay for it up front.
  importedBy?: Map<string, string[]>;
}

export function buildGraph(nodes: FileGraphNode[], aliases: AliasMap = [], tsconfigStartDir?: string): DepGraph {
  const map = new Map<string, FileGraphNode>();
  const known = new Set<string>();
  const allIds = new Set<string>();
  // Deterministic: index in sorted-path order so re-runs are byte-identical.
  for (const n of [...nodes].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    map.set(n.file, n);
    known.add(n.file);
    for (const id of n.definesIds) allIds.add(id);
  }
  return { nodes: map, known, allIds, resolveSpec: makeSpecResolver(known, aliases, tsconfigStartDir), usageCache: new Map() };
}

/** Resolve a component used as `<localName/>` in `file` to its definition, following the
 *  import binding across files (relative or aliased), a namespace member (`<UI.Button/>`),
 *  a local definition, or a chain of barrel re-exports (`export { X } from "./x"`, modeled
 *  as an import-like binding by extractGraphNode) — however many barrels deep. `seen`
 *  guards against a re-export cycle (each file+name hop visited at most once). */
export function resolveUsage(graph: DepGraph, file: string, localName: string, seen: Set<string> = new Set()): ComponentDef | undefined {
  const posix = toPosix(file);
  const visitKey = `${posix}#${localName}`;
  // Top-level lookups are memoised: the graph is read-only for the whole audit, so
  // `(file, name)` always resolves the same way, and several cross rules walk the very
  // same component usages independently. Recursive hops keep their `seen` set and are
  // NOT cached — their result is relative to the path already taken.
  const memoized = seen.size === 0;
  if (memoized) {
    const hit = graph.usageCache.get(visitKey);
    if (hit !== undefined) return hit ?? undefined;
  }
  if (seen.has(visitKey)) return undefined;
  seen.add(visitKey);
  if (memoized) {
    const out = resolveUsageUncached(graph, posix, localName, seen);
    graph.usageCache.set(visitKey, out ?? null);
    return out;
  }
  return resolveUsageUncached(graph, posix, localName, seen);
}

function resolveUsageUncached(graph: DepGraph, posix: string, localName: string, seen: Set<string>): ComponentDef | undefined {
  const node = graph.nodes.get(posix);
  if (!node) return undefined;
  // Namespaced usage `<UI.Button/>` → namespace import `import * as UI` + member Button.
  if (localName.includes(".")) {
    const dot = localName.indexOf(".");
    const ns = localName.slice(0, dot);
    const member = localName.slice(dot + 1);
    const nsImp = node.imports.find((i) => i.imported === "*" && i.local === ns);
    if (!nsImp) return undefined;
    const target = graph.resolveSpec(posix, nsImp.source);
    if (!target) return undefined;
    // The namespace target may be a BARREL: `<UI.Button/>` where UI is `import * as UI from
    // "./components"` and components re-exports Button. If it isn't a direct component there,
    // follow the barrel's re-export bindings one more hop.
    return graph.nodes.get(target)?.components.get(member) ?? resolveUsage(graph, target, member, seen);
  }
  const imp = node.imports.find((i) => i.local === localName);
  if (imp) {
    if (imp.imported === "*") return undefined; // bare namespace binding used without a member
    const target = graph.resolveSpec(posix, imp.source);
    if (!target) return undefined;
    const direct = graph.nodes.get(target)?.components.get(imp.imported);
    if (direct) return direct;
    // The target doesn't define it directly — it may itself re-export it from
    // elsewhere (a barrel of barrels). Follow one more hop.
    return resolveUsage(graph, target, imp.imported, seen);
  }
  const local = node.components.get(localName);
  if (local) return local; // locally-defined component
  // `export * from "./x"` wildcard barrel: the name may be defined in any starred source.
  for (const src of node.starReexports) {
    const target = graph.resolveSpec(posix, src);
    if (!target) continue;
    const hit = resolveUsage(graph, target, localName, seen);
    if (hit) return hit;
  }
  return undefined;
}

/** Is `id` defined as a literal id by any file in the graph? */
export function idDefinedAnywhere(graph: DepGraph, id: string): boolean {
  return graph.allIds.has(id);
}

/** Does any file `file` transitively imports declare an <html lang> (wrapper/layout
 *  pattern)? Used to suppress a missing-lang false positive on a wrapped document. */
export function htmlLangProvidedFor(graph: DepGraph, file: string): boolean {
  const start = toPosix(file);
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  while (queue.length) {
    const cur = queue.shift() as string;
    const node = graph.nodes.get(cur);
    if (!node) continue;
    if (cur !== start && node.providesHtmlLang) return true;
    for (const imp of node.imports) {
      const target = graph.resolveSpec(cur, imp.source);
      if (target && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return false;
}

/** The files that import (or re-export) `file` directly, over every resolvable specifier. */
function importersOf(graph: DepGraph, file: string): string[] {
  if (!graph.importedBy) {
    const rev = new Map<string, string[]>();
    for (const [from, node] of graph.nodes) {
      const targets = new Set<string>();
      for (const imp of node.imports) {
        const t = graph.resolveSpec(from, imp.source);
        if (t) targets.add(t);
      }
      for (const src of node.starReexports) {
        const t = graph.resolveSpec(from, src);
        if (t) targets.add(t);
      }
      for (const t of targets) {
        if (t === from) continue;
        const arr = rev.get(t) ?? [];
        arr.push(from);
        rev.set(t, arr);
      }
    }
    graph.importedBy = rev;
  }
  return graph.importedBy.get(file) ?? [];
}

const ROUTE_SCRIPT_EXTS = [".tsx", ".jsx", ".ts", ".js"];

/** Does Next.js give the pages of App Router route file `route` a <title> from metadata?
 *  Metadata merges from the root layout down, so the route's own export or that of any
 *  `layout` above it, up to its `app/` directory, sets one. */
function routeHasMetadataTitle(graph: DepGraph, route: string): boolean {
  if (graph.nodes.get(route)?.exportsMetadataTitle) return true;
  const segs = route.split("/");
  const appAt = segs.lastIndexOf("app");
  for (let end = segs.length - 1; end > appAt; end--) {
    const dir = segs.slice(0, end).join("/");
    for (const e of ROUTE_SCRIPT_EXTS) if (graph.nodes.get(`${dir}/layout${e}`)?.exportsMetadataTitle) return true;
  }
  return false;
}

/** Is the document <title> of `file` set by the Next.js metadata API of the App Router
 *  routes that render it? `file` holds a <head> with no title of its own (a root shell
 *  component); the routes are the App Router `layout`/`page` files importing it, directly
 *  or through any chain of components and barrels. True only when at least one such route
 *  exists and EVERY one of them gets a metadata title: one route rendering the shell with
 *  no title anywhere above it is a page without a title. */
export function titleSetByImportingRoute(graph: DepGraph, file: string): boolean {
  const start = toPosix(file);
  // The <head> sits in a route file itself (a nested layout rendering the document shell).
  if (isAppRouteFile(start)) return routeHasMetadataTitle(graph, start);
  const seen = new Set<string>([start]);
  const queue: string[] = [start];
  let routes = 0;
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const importer of importersOf(graph, cur)) {
      if (seen.has(importer)) continue;
      seen.add(importer);
      if (isAppRouteFile(importer)) {
        // Rendering starts at a route: whatever imports a route file does not wrap its pages.
        if (!routeHasMetadataTitle(graph, importer)) return false;
        routes++;
        continue;
      }
      queue.push(importer);
    }
  }
  return routes > 0;
}
