// Read tsconfig.json `compilerOptions.baseUrl` + `paths` into a compact alias map so the
// graph resolver can follow alias imports like "@/components/Icon". Walks up from a start
// dir to the nearest tsconfig.json (bounded) and follows a single `extends` hop for
// baseUrl/paths defaults. No new dependency, no glob — explicit file reads only. Bare
// node_modules specifiers stay out of scope (the graph resolves only against discovered
// files). Bases are emitted RELATIVE to `cwd` so they match the discovered file paths
// (which are relative to the audit's working dir).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { toPosix } from "../glob.js";

export interface AliasRule {
  prefix: string; // pattern text before '*' (or the whole pattern when exact)
  wildcard: boolean;
  bases: string[]; // posix base paths (baseUrl-resolved, cwd-relative), target text before '*'
}
export type AliasMap = AliasRule[];

// Tolerate the // and /* */ comments and trailing commas common in tsconfig.json.
function readJsonish(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function findTsconfig(startDir: string): string | null {
  let dir = resolve(startDir);
  for (let i = 0; i < 30; i++) {
    const p = join(dir, "tsconfig.json");
    if (existsSync(p)) return p;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The nearest tsconfig.json above `startDir` plus its transitive relative
 *  `extends` chain (absolute paths, existing files only, cycle-guarded). Used by
 *  src/graph/spec-resolve.ts to pick the CANDIDATE configs (each chain member
 *  named tsconfig.json/jsconfig.json, scoped to its own directory); each
 *  candidate's effective options are then read by get-tsconfig. Bare package
 *  specifiers (e.g. "@tsconfig/strictest") are not chain members here. */
export function tsconfigChain(startDir: string): string[] {
  const first = findTsconfig(startDir);
  if (!first) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [resolve(first)];
  while (queue.length) {
    const p = queue.shift() as string;
    if (seen.has(p)) continue;
    seen.add(p);
    if (!existsSync(p)) continue;
    out.push(p);
    const cfg = readJsonish(p);
    const exts = Array.isArray(cfg?.extends) ? cfg.extends : typeof cfg?.extends === "string" ? [cfg.extends] : [];
    const dir = dirname(p);
    for (const e of exts) {
      if (typeof e !== "string") continue;
      // `extends` candidates: "<e>" when it names a .json file, else
      // "<e>.json" then "<e>/tsconfig.json".
      const cands = e.endsWith(".json") ? [resolve(dir, e)] : [resolve(dir, `${e}.json`), resolve(dir, e, "tsconfig.json")];
      const hit = cands.find((c) => existsSync(c));
      if (hit) queue.push(hit);
    }
  }
  return out;
}

/** Build the alias map from the nearest tsconfig.json above `startDir` (or empty). */
export function readTsAliases(startDir: string, cwd: string = process.cwd()): AliasMap {
  const tsconfigPath = findTsconfig(startDir);
  if (!tsconfigPath) return [];
  const root = dirname(tsconfigPath);
  const cfg = readJsonish(tsconfigPath);
  if (!cfg) return [];
  let co = (cfg.compilerOptions ?? {}) as Record<string, unknown>;
  // `extends` may be a string or (TS 5+) an array, merged in order with the child winning.
  // Package specifiers (e.g. "@tsconfig/strictest") aren't node-resolved here — they fall
  // through to a missing path and are skipped (documented bound; relative bases are honored).
  const exts = Array.isArray(cfg.extends) ? cfg.extends : typeof cfg.extends === "string" ? [cfg.extends] : [];
  for (const e of exts) {
    if (typeof e !== "string") continue;
    const ext = e.endsWith(".json") ? e : `${e}.json`;
    const base = readJsonish(resolve(root, ext));
    if (base?.compilerOptions) co = { ...(base.compilerOptions as Record<string, unknown>), ...co };
  }
  const baseUrl = typeof co.baseUrl === "string" ? co.baseUrl : ".";
  const baseAbs = resolve(root, baseUrl);
  const paths = (co.paths ?? {}) as Record<string, unknown>;
  const out: AliasMap = [];
  for (const [pattern, targetsRaw] of Object.entries(paths)) {
    if (!Array.isArray(targetsRaw)) continue;
    const targets = targetsRaw.filter((t): t is string => typeof t === "string");
    if (!targets.length) continue;
    const wildcard = pattern.includes("*");
    const prefix = wildcard ? pattern.slice(0, pattern.indexOf("*")) : pattern;
    const bases = targets.map((t) => {
      const star = t.indexOf("*");
      const tp = wildcard && star >= 0 ? t.slice(0, star) : t;
      return toPosix(relative(cwd, join(baseAbs, tp))) || ".";
    });
    out.push({ prefix, wildcard, bases });
  }
  return out;
}
