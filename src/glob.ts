// Zero-dependency input expansion for `audit`: turn file paths, directories and
// globs into a concrete file list, then apply --include/--exclude predicates.
// The generic machinery (directory walking, glob → RegExp) is the vendored
// codeindex engine's; everything ultra11y-specific (markup extension allowlist,
// test-artifact policy, audit-output skips, input-scope matching) stays here.
import { existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { ext } from "./util.js";
import { compileGlobs as engineCompileGlobs, walk as engineWalk } from "./vendor/codeindex-engine.mjs";

// HTML + JSX/TSX + the HTML-shaped single-file component formats (Vue/Svelte/Astro
// templates parse cleanly through the HTML path). Server templates (.twig/.erb/.hbs/
// .liquid/.njk…) are opt-in via `--ext` since their extensions are ambiguous.
const DEFAULT_EXT = new Set([".html", ".htm", ".xhtml", ".jsx", ".tsx", ".vue", ".svelte", ".astro"]);

// GRAPH-ONLY extensions: plain TS/JS modules are never markup, so they never enter
// the AUDIT allowlist above (`DEFAULT_EXT`) — but a barrel (`components/index.ts`
// re-exporting `.tsx` components) or a plain-JS component definition is real
// cross-file structure the dependency graph (`audit --graph`) needs to resolve
// imports/re-exports/definitions through. Fed to `discover`'s `ext` for the graph's
// OWN file discovery pass only (see `runAudit`'s graph branch in src/audit.ts) —
// these files are parsed for their imports/exports and never run through the rule
// engine themselves.
export const GRAPH_ONLY_EXT = [".ts", ".js", ".mjs", ".cjs"];

/** Normalise extensions (`twig` → `.twig`, lowercased) into a lookup set merged
 *  with the built-in defaults. */
function extSet(extra: string[] | undefined): Set<string> {
  const set = new Set(DEFAULT_EXT);
  for (const raw of extra ?? []) {
    for (const e of raw.split(",")) {
      const t = e.trim().toLowerCase();
      if (t) set.add(t.startsWith(".") ? t : `.${t}`);
    }
  }
  return set;
}
// Directories the engine's walk does not know about but ultra11y must never
// auto-walk: `audits/` holds generated reports, and `.ultra11y/` (captures +
// generated setup) is ingested only via the explicit `.ultra11y/captures` input
// the CLI appends (so `--no-captures` genuinely opts out) or a direct
// `--captures <dir>` / coverage scan of that dir. Like the old SKIP_DIR, these
// prune DESCENDANTS of a walked root — naming such a dir directly as the walk
// root still descends into it. The rest of the old SKIP_DIR (node_modules,
// .git, dist, build, coverage, .next, out) is covered by the engine's own
// ignore universe (a superset), and the engine walk additionally honours
// .gitignore files under the walked root.
const SKIP_DIR = new Set(["audits", ".ultra11y"]);

// Test / spec / story / mock markup is bad-by-design (intentionally non-conformant
// fixtures, never shipped UI). Excluded by default to keep the audit focused on real
// product code; re-admit by naming the file/dir directly, with an `--include` glob, or
// `--no-default-excludes`. NOT in SKIP_DIR (which prunes the walk unconditionally) so
// the opt-outs can still reach these files.
const TEST_DIR = new Set(["__tests__", "__mocks__", ".storybook"]);
const TEST_FILE = /\.(test|spec|stories|story|cy)\.[^./]+$/i;
export function isTestArtifact(rel: string): boolean {
  if (TEST_FILE.test(rel)) return true;
  return rel.split("/").some((seg) => TEST_DIR.has(seg));
}

// Glob matching is the engine's (same dialect as before: `**` crosses `/`,
// `**/` makes the segment optional, `*` runs within a segment, `?` is one
// non-`/` char). ultra11y's flag semantics on top: each --include/--exclude
// value may carry a comma-separated LIST of globs, split and trimmed here.
export function compileGlobs(globs: string[] | undefined): ((rel: string) => boolean) | null {
  if (!globs || globs.length === 0) return null;
  const list = globs
    .flatMap((g) => g.split(","))
    .map((g) => g.trim())
    .filter(Boolean);
  // A non-empty flag that splits to nothing (e.g. ",") historically compiled to
  // a match-nothing predicate — keep that, never silently widen to "no filter".
  return engineCompileGlobs(list) ?? (() => false);
}

export const toPosix = (p: string): string => p.split(sep).join("/");
export const hasGlob = (s: string): boolean => /[*?]/.test(s);

/** A reusable file predicate (extension + include/exclude) for callers that
 *  already have a file list (e.g. git-changed discovery) and skip the walk. */
export function makeFilter(opts: ExpandOpts = {}): (file: string) => boolean {
  const include = compileGlobs(opts.include);
  const exclude = compileGlobs(opts.exclude);
  const exts = extSet(opts.ext);
  return (file: string): boolean => {
    if (!exts.has(ext(file))) return false;
    const rel = toPosix(file);
    if (include && !include(rel)) return false;
    if (exclude?.(rel)) return false;
    // Default test-artifact exclusion (re-admitted by an explicit --include match).
    if (!opts.noDefaultExcludes && isTestArtifact(rel) && !(include && include(rel))) return false;
    return true;
  };
}

/** Match a file against explicit input scopes (globs OR directory prefixes).
 *  Used by `--changed` to keep only git-changed files inside the audited scope.
 *  Returns null when inputs impose no scope (only "." / "-"). */
export function inScopeMatcher(inputs: string[]): ((file: string) => boolean) | null {
  const scopes = inputs.filter((i) => i !== "-" && i !== ".");
  if (!scopes.length) return null;
  const globMatch = compileGlobs(scopes.filter(hasGlob));
  const prefixes = scopes.filter((i) => !hasGlob(i)).map((p) => toPosix(p).replace(/\/+$/, ""));
  return (file: string): boolean => {
    const rel = toPosix(file);
    if (globMatch?.(rel)) return true;
    return prefixes.some((p) => rel === p || rel.startsWith(`${p}/`));
  };
}

// Walk a directory with the engine (gitignore honoured, dependency/build/VCS
// dirs, lockfiles, binaries and >1 MiB files skipped), returning full paths the
// way the old recursive walker did (the input dir joined back onto each hit).
// No maxFiles cap here: the audit's own --max-files budget applies downstream,
// and a silent walk truncation must never masquerade as a clean "0 findings".
function walk(dir: string, acc: string[]): void {
  for (const f of engineWalk(dir, { maxFiles: Number.MAX_SAFE_INTEGER }).files) {
    // Engine rel paths are posix; prune ultra11y's own output dirs at any depth
    // below the walked root (the root itself may be named directly, as before).
    if (f.rel.split("/").some((seg) => SKIP_DIR.has(seg))) continue;
    acc.push(join(dir, f.rel));
  }
}

function staticBase(glob: string): string {
  const idx = glob.search(/[*?]/);
  const head = idx === -1 ? glob : glob.slice(0, idx);
  const slash = head.lastIndexOf("/");
  return slash === -1 ? "." : head.slice(0, slash) || ".";
}

export interface ExpandOpts {
  include?: string[];
  exclude?: string[];
  ext?: string[];
  noDefaultExcludes?: boolean; // audit test/spec/story/__tests__ markup too
  onWarn?: (msg: string) => void;
  // Memo of directory walks, shared by the calls that expand the SAME inputs with a
  // different extension allowlist — `audit --graph` discovers twice (markup, then
  // markup + .ts/.js for the dependency graph) and the tree walk is identical both
  // times because the extension filter is applied AFTER it. Caller-owned and
  // per-run on purpose: a module-level cache would go stale across audits (a
  // `fix --iterate` re-audit must always see the current tree).
  walkCache?: Map<string, string[]>;
}

/** Walk `dir` once per ExpandOpts.walkCache. Without a cache, walks every time. */
function walkCached(dir: string, opts: ExpandOpts): string[] {
  const hit = opts.walkCache?.get(dir);
  if (hit) return hit;
  const acc: string[] = [];
  walk(dir, acc);
  opts.walkCache?.set(dir, acc);
  return acc;
}

/** Expand inputs (paths/dirs/globs) into a sorted, de-duplicated file list. */
export function expandInputs(inputs: string[], opts: ExpandOpts = {}): string[] {
  const include = compileGlobs(opts.include);
  const exclude = compileGlobs(opts.exclude);
  const exts = extSet(opts.ext);
  const files = new Set<string>();
  const explicit = new Set<string>(); // files named directly — never auto-excluded

  for (const input of inputs) {
    if (input === "-") continue; // stdin handled by the caller
    if (hasGlob(input)) {
      // A positional glob input is ONE glob (no comma-splitting — that is an
      // --include/--exclude flag affordance), compiled by the engine.
      const match = engineCompileGlobs([input])!;
      const acc = walkCached(staticBase(input), opts);
      // Honour the markup allowlist for globs too — a broad `src/**` must not pull
      // in .js/.css/.json and parse them as HTML (engine scope is markup only).
      for (const f of acc) if (match(toPosix(f)) && exts.has(ext(f))) files.add(f);
    } else if (existsSync(input)) {
      if (statSync(input).isDirectory()) {
        const acc = walkCached(input, opts);
        for (const f of acc) if (exts.has(ext(f))) files.add(f);
      } else if (exts.has(ext(input))) {
        files.add(input);
        explicit.add(input);
      }
    } else if (input !== ".") {
      // A non-glob path that doesn't exist (a typo, a not-yet-built dist/…) — warn so a
      // gate never reads "0 files · 100%" on a silent miss. A glob matching nothing is fine.
      opts.onWarn?.(`ultra11y: input not found: ${input}`);
    }
  }

  let list = [...files];
  if (include) list = list.filter((f) => include(toPosix(f)));
  if (exclude) list = list.filter((f) => !exclude(toPosix(f)));
  // Default test-artifact exclusion — re-admitted when the file was named directly or
  // matched by an explicit --include. Logged (never a silent drop).
  if (!opts.noDefaultExcludes) {
    const before = list.length;
    list = list.filter((f) => {
      const rel = toPosix(f);
      return !isTestArtifact(rel) || explicit.has(f) || (include != null && include(rel));
    });
    const dropped = before - list.length;
    if (dropped) opts.onWarn?.(`ultra11y: skipped ${dropped} test/spec/story file(s) — pass --no-default-excludes to audit them.`);
  }
  return list.sort();
}
