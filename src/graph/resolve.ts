// Resolve an import specifier to a discovered file, the way a bundler would but
// only against the set of files the audit already walked (no extra fs probing —
// keeps the graph bounded and deterministic). RELATIVE specifiers resolve directly;
// ALIAS specifiers ("@/…") resolve through the tsconfig-paths map (src/graph/tsconfig.ts);
// bare node_modules specifiers ("react") stay out of scope and return null.
import { dirname, join } from "node:path";
import { toPosix } from "../glob.js";
import type { AliasMap } from "./tsconfig.js";

// Try the specifier verbatim, then with each source extension, then as a
// directory index. Order matches typical TS/bundler resolution.
//
// No .vue/.svelte/.astro/.html/.htm here: the primary resolver's candidate probe
// (JS_EXT_PROBES in spec-resolve.ts) covers SFC/HTML extensions, and
// makeSpecResolver always tries it first (see tests/golden-graph.test.ts and
// tests/graph-sfc.test.ts). This file is the fallback for whatever it doesn't cover.
const EXT_ORDER = [".tsx", ".jsx", ".ts", ".js"];

function candidates(base: string): string[] {
  const out = [base];
  // An ESM/NodeNext specifier writes the OUTPUT extension ("./Icon.js") even though the
  // source is "./Icon.ts"/".tsx"; try the base with a trailing js-family ext swapped for
  // each source ext, before the plain append/index candidates.
  const jsExt = /\.(?:js|jsx|mjs|cjs)$/.exec(base);
  if (jsExt) {
    const stripped = base.slice(0, -jsExt[0].length);
    for (const e of EXT_ORDER) out.push(stripped + e);
  }
  for (const e of EXT_ORDER) out.push(base + e);
  for (const e of EXT_ORDER) out.push(join(base, `index${e}`));
  return out;
}

function matchKnown(base: string, known: ReadonlySet<string>): string | null {
  for (const c of candidates(base)) {
    const key = toPosix(c);
    if (known.has(key)) return key;
  }
  return null;
}

/**
 * @param fromFile  the importing file (posix or native; normalised internally)
 * @param spec      the import specifier as written
 * @param known     set of POSIX-normalised paths of all discovered files
 * @param aliases   tsconfig-paths alias map (optional); enables "@/…" resolution
 * @returns the matched known file (posix), or null if unresolved/out-of-scope
 */
export function resolveSpecifier(fromFile: string, spec: string, known: ReadonlySet<string>, aliases?: AliasMap): string | null {
  if (spec.startsWith(".")) {
    return matchKnown(join(dirname(toPosix(fromFile)), spec), known);
  }
  // Alias specifier via tsconfig paths (e.g. "@/components/Icon").
  if (aliases?.length) {
    for (const rule of aliases) {
      if (rule.wildcard) {
        if (!spec.startsWith(rule.prefix)) continue;
        const rest = spec.slice(rule.prefix.length);
        for (const base of rule.bases) {
          const hit = matchKnown(join(base, rest), known);
          if (hit) return hit;
        }
      } else if (spec === rule.prefix) {
        for (const base of rule.bases) {
          const hit = matchKnown(base, known);
          if (hit) return hit;
        }
      }
    }
  }
  return null; // bare node_modules specifier — out of scope
}
