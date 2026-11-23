// Import resolution for the component graph. Resolves relative
// specifiers, ESM/NodeNext ".js"-for-".ts" specifiers and tsconfig path aliases
// against a BOUNDED universe: only the files the audit discovered. Nothing is
// probed on disk, so the graph stays deterministic. Bare node_modules
// specifiers stay out of scope (no package.json is consulted).
//
// tsconfig handling is get-tsconfig's (JSONC parsing, the full `extends` chain,
// package `extends` targets, `paths` relative to the config that declares them,
// `baseUrl`). WHICH configs apply follows the multi-config rule this module has
// always had: the nearest tsconfig.json above `startDir` plus every
// tsconfig.json/jsconfig.json in its `extends` chain is a candidate, each scoped
// to its own directory; the deepest candidate containing the importer whose
// `paths` has a matching pattern decides, and a shallower one is only consulted
// when no pattern of the deeper one matches.
//
// The older lexical resolver (src/graph/resolve.ts) stays as the fallback for
// every case this one misses (non-JS importers such as .mdx/.css, an alias whose
// targets do not resolve here).
import { resolve as absPath, basename, dirname, posix } from "node:path";
import { type Cache, createPathsMatcher, parseTsconfig } from "get-tsconfig";
import { toPosix } from "../glob.js";
import { ext } from "../util.js";
import { resolveSpecifier } from "./resolve.js";
import { type AliasMap, tsconfigChain } from "./tsconfig.js";

export type SpecResolver = (fromFile: string, spec: string) => string | null;

// Specifiers naming these are assets, never modules.
const ASSET_EXT = new Set([
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".icns",
  ".pdf",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".webm",
  ".wav",
  ".flac",
  ".ogg",
  ".map",
]);
// Candidate suffixes, in order: the specifier verbatim, then each source
// extension (SFC/HTML included, so an extensionless "./Widget" reaches Widget.vue),
// then a directory index.
const JS_EXT_PROBES = ["", ".ts", ".tsx", ".d.ts", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue", ".svelte", ".astro", ".html", ".htm"];
const JS_INDEX = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs"];
// Importer extensions this resolver handles; any other importer goes to the fallback.
const JS_TS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SFC_HTML = new Set([".vue", ".svelte", ".astro", ".html", ".htm"]);
const CONFIG_NAMES = new Set(["tsconfig.json", "jsconfig.json"]);

const norm = (p: string): string => posix.normalize(p).replace(/\/$/, "");

/** A tsconfig's `paths`, scoped to the directory holding the config. */
interface ScopedPaths {
  dir: string; // absolute posix
  patterns: string[];
  match: (spec: string) => string[];
}

/** TypeScript's pattern test: exact, or `prefix*suffix` with at most one `*`. */
function patternMatches(pattern: string, spec: string): boolean {
  const star = pattern.indexOf("*");
  if (star === -1) return pattern === spec;
  const pre = pattern.slice(0, star);
  const post = pattern.slice(star + 1);
  return spec.length >= pre.length + post.length && spec.startsWith(pre) && spec.endsWith(post);
}

function loadScopedPaths(startDir: string): ScopedPaths[] {
  const cache: Cache<string> = new Map();
  const out: ScopedPaths[] = [];
  for (const cfgPath of tsconfigChain(startDir)) {
    if (!CONFIG_NAMES.has(basename(cfgPath))) continue;
    try {
      const config = parseTsconfig(cfgPath, cache);
      const paths = config.compilerOptions?.paths;
      if (!paths) continue;
      const patterns = Object.keys(paths).filter((k) => Array.isArray(paths[k]));
      if (!patterns.length) continue;
      const match = createPathsMatcher({ path: cfgPath, config });
      if (!match) continue;
      out.push({ dir: toPosix(dirname(cfgPath)), patterns, match });
    } catch {
      // Unparseable config or an `extends` target that cannot be found: its
      // aliases are ignored here (the fallback resolver may still read them).
    }
  }
  return out.sort((a, b) => b.dir.length - a.dir.length);
}

/** Build a specifier resolver over the discovered file set. `startDir` anchors
 *  the tsconfig up-walk (the dir of the first discovered file, as before). */
export function makeSpecResolver(known: ReadonlySet<string>, aliases: AliasMap = [], startDir?: string): SpecResolver {
  // Probe one coherent ABSOLUTE-posix universe (so ".."-climbing specifiers and
  // config-relative alias targets compare equal) and map hits back to the
  // caller's own (posix, possibly relative) paths on the way out.
  const backMap = new Map<string, string>();
  for (const rel of known) backMap.set(toPosix(absPath(rel)), rel);
  const configs = startDir ? loadScopedPaths(startDir) : [];

  const probe = (p: string): string | undefined => {
    for (const e of JS_EXT_PROBES) {
      const c = norm(p + e);
      if (backMap.has(c)) return c;
    }
    for (const i of JS_INDEX) {
      const c = norm(posix.join(p, i));
      if (backMap.has(c)) return c;
    }
    return undefined;
  };
  // "./Icon.js" written for "./Icon.ts" (ESM/NodeNext output extensions).
  const tryResolve = (p: string): string | undefined => {
    const hit = probe(p);
    if (hit) return hit;
    const noJs = p.replace(/\.(js|jsx|mjs|cjs)$/, "");
    return noJs !== p ? probe(noJs) : undefined;
  };

  const resolveJs = (fromAbs: string, spec: string): string | undefined => {
    if (spec.startsWith(".")) return tryResolve(norm(posix.join(posix.dirname(fromAbs), spec)));
    for (const cfg of configs) {
      if (fromAbs !== cfg.dir && !fromAbs.startsWith(`${cfg.dir}/`)) continue;
      if (!cfg.patterns.some((p) => patternMatches(p, spec))) continue;
      for (const target of cfg.match(spec)) {
        const hit = tryResolve(norm(toPosix(target)));
        if (hit) return hit;
      }
      return undefined; // the deepest matching config decides
    }
    return undefined;
  };

  const resolveOne = (fromFile: string, spec: string): string | undefined => {
    const dot = spec.lastIndexOf(".");
    if (
      dot !== -1 &&
      ASSET_EXT.has(
        spec
          .slice(dot)
          .toLowerCase()
          .replace(/[?#].*$/, ""),
      )
    )
      return undefined;
    const fromExt = ext(fromFile);
    if (!JS_TS.has(fromExt) && !SFC_HTML.has(fromExt)) return undefined;
    return resolveJs(toPosix(absPath(fromFile)), spec);
  };

  // Resolution is a pure function of (fromFile, spec) over a fixed file set, and the
  // cross rules ask the same questions repeatedly — every component usage re-resolves
  // its import, and several rules walk the same usages independently. Memoise: the
  // graph is read-only for the whole audit, so a hit is always correct.
  const memo = new Map<string, string | null>();
  return (fromFile: string, spec: string): string | null => {
    const key = `${fromFile}\0${spec}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const hit = resolveOne(fromFile, spec);
    let out: string | null = hit === undefined ? null : (backMap.get(hit) ?? null);
    // The lexical resolver, unchanged, over the same known set.
    if (out === null) out = resolveSpecifier(fromFile, spec, known, aliases);
    memo.set(key, out);
    return out;
  };
}
