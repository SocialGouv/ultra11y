// `affected` — which pages of the sample can a diff change?
//
// The lite gate captures and audits only those pages, so this is where its cost is decided and
// where its blind spot would be: a page this misses is a page whose regression ships. Hence the
// direction of every trade below — when in doubt, SELECT. A page captured for nothing costs a few
// seconds; a page skipped that was touched costs the regression the gate exists to catch.
//
// The sample already says which files render each page (`sample.pages[].sources`). A page is
// affected when a changed file is in the TRANSITIVE closure of those sources over the import
// graph — the component three imports below the page is just as much the page. The walk goes
// FORWARD from the sources and reads only the files they reach: test suites, scripts and server
// code the pages never import are listed, never opened.
//
// What no import says is declared: `sample.global` globs (the root layout, global styles, the
// design-system setup) select every page when touched, and so does the config itself. One
// framework convention is built in because it is the common case and invisible to the graph: a
// Next.js App Router `page` is wrapped by every `layout`/`template` above it in `app/`.
//
// Import extraction is lexical, not a parse. Babel over a whole application is seconds; a regex
// over the files actually reached is milliseconds, and its failure mode (an import mentioned in a
// comment) only ever selects more.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { makeSpecResolver, type SpecResolver } from "./graph/engine-resolve.js";
import { readTsAliases } from "./graph/tsconfig.js";
import { isTestArtifact, toPosix } from "./glob.js";
import { compileGlobs as engineCompileGlobs, walk as engineWalk } from "./vendor/codeindex-engine.mjs";

/** Files the graph follows. Markup, scripts and stylesheets — what can change a rendered page. */
const GRAPH_EXT = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".astro",
  ".mdx",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".sass",
  ".less",
]);
/** Changed files of these kinds that no page reaches are reported as `unmapped`. */
const MARKUP_EXT = new Set([".html", ".htm", ".xhtml", ".jsx", ".tsx", ".vue", ".svelte", ".astro", ".mdx"]);
const STYLE_EXT = new Set([".css", ".scss", ".sass", ".less"]);
/** Always global: the file that declares the sample and the audit's own configuration. */
const IMPLICIT_GLOBAL = [".ultra11yrc.json"];

const extOf = (f: string): string => {
  const b = f.slice(f.lastIndexOf("/") + 1);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i).toLowerCase();
};
const norm = (p: string): string => posix.normalize(toPosix(p)).replace(/^\.\//, "");

export interface AffectedPageInput {
  id: string;
  sources?: string[];
}

export interface AffectedInput {
  /** Project root (where `.ultra11yrc.json` lives); `sources` and `global` are relative to it. */
  root: string;
  pages: AffectedPageInput[];
  global?: string[];
  /** Changed files, relative to `root` (a file outside it starts with `../`). */
  changed: string[];
}

export interface AffectedResult {
  /** Page ids to capture and audit, in sample order. */
  pages: string[];
  /** Every page is selected — a global file was touched. */
  all: boolean;
  /** No page is selected — the diff reaches nothing a page renders. */
  none: boolean;
  /** Changed markup no page reaches: a page the sample does not declare, or `sources` too short. */
  unmapped: string[];
  /** Changed files that matched `sample.global` (or the config). */
  global: string[];
  /** Why each page was selected: the changed files in its closure (first few). */
  reasons: Record<string, string[]>;
  /** Pages that declare no `sources`: only a global change can select them. */
  unsourced: string[];
  changed: number;
}

// ---- module extraction ------------------------------------------------------------------------
//
// An import is followed by NAME, not by file. A barrel (`modules/shared/index.ts` re-exporting
// forty components) is how a project imports almost everything — and followed by file, it puts
// every component of the module in every page that imports one of them, which on egapro selected
// 48 of 52 pages for a one-line change to a table header. So `import { Button } from "~/shared"`
// follows the barrel's `export { Button } from "./Button"` and nothing else, and a name a module
// only declares as a TYPE is erased, like the import that asked for it.

/** What one module says about its imports and exports. `"*"` means "all of it": a namespace or
 *  side-effect import, a dynamic `import()`, a stylesheet. */
export interface ModuleInfo<T = string> {
  imports: { target: T; names: string[] | "*" }[];
  /** `export { a as b } from "x"` → `{ target: x, as: "b", from: "a" }`; `export * as ns` → from `"*"`. */
  reexports: { target: T; as: string; from: string }[];
  /** `export * from "x"`. */
  stars: T[];
  /** Names this module declares and exports itself (`default` included). */
  locals: Set<string>;
  /** Names it exports only as a type — erased at build time. */
  types: Set<string>;
}

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /^\s*\/\/.*$/gm;
// The clauses exclude quotes and `;`, so a match cannot run past its own statement.
const IMPORT_RE = /\bimport\s+(type\s+)?([^;'"`]*?)\s*\bfrom\s*(["'])([^"'\n]+)\3/g;
const REEXPORT_RE = /\bexport\s+(type\s+)?(\*\s*(?:as\s+([\w$]+))?|\{[^}]*\})\s*from\s*(["'])([^"'\n]+)\4/g;
const SIDE_EFFECT_RE = /\bimport\s*(["'])([^"'\n]+)\1/g;
const DYNAMIC_RE = /\b(?:import|require)\s*\(\s*(["'`])([^"'`\n]+)\1\s*\)/g;
const STYLE_RE = /@(?:import|use|forward)\s+(?:url\(\s*)?(["'])([^"'\n]+)\1/g;
const LOCAL_DECL_RE = /\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\s*\*?|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g;
const TYPE_DECL_RE = /\bexport\s+(?:declare\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/g;
const LOCAL_LIST_RE = /\bexport\s+(type\s+)?\{([^}]*)\}(?!\s*from\b)/g;

const unquote = (s: string): string => s.trim().replace(/^["']|["']$/g, "");
/** `a`, `a as b`, `type a`, `"a-b" as c` → [original, exported, typeOnly]. */
function specifiers(list: string): [string, string, boolean][] {
  const out: [string, string, boolean][] = [];
  for (const raw of list.split(",")) {
    let item = raw.trim();
    if (!item) continue;
    const typeOnly = /^type\s+/.test(item);
    if (typeOnly) item = item.replace(/^type\s+/, "");
    const [orig, alias] = item.split(/\s+as\s+/);
    out.push([unquote(orig ?? ""), unquote(alias ?? orig ?? ""), typeOnly]);
  }
  return out;
}

/** The imported names of an import clause (`X, { a, b as c }` → `default, a, b`), or `"*"`. */
function importedNames(clause: string): string[] | "*" {
  if (clause.includes("*")) return "*";
  const brace = clause.indexOf("{");
  const names: string[] = [];
  const head = (brace === -1 ? clause : clause.slice(0, brace)).replace(/,\s*$/, "").trim();
  if (head) names.push("default");
  if (brace !== -1) for (const [orig, , typeOnly] of specifiers(clause.slice(brace + 1, clause.lastIndexOf("}")))) if (!typeOnly) names.push(orig);
  return names;
}

/** What a module imports and exports, read lexically. Type-only imports are left out: they are
 *  erased at build time and cannot change what a page renders. */
export function parseModule(content: string, file: string): ModuleInfo {
  const m: ModuleInfo = { imports: [], reexports: [], stars: [], locals: new Set(), types: new Set() };
  if (STYLE_EXT.has(extOf(file))) {
    for (const x of content.replace(BLOCK_COMMENT, "").matchAll(STYLE_RE)) m.imports.push({ target: x[2]!, names: "*" });
    return m;
  }
  const src = content.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "");
  for (const x of src.matchAll(IMPORT_RE)) {
    if (x[1]) continue; // import type …
    const names = importedNames(x[2] ?? "");
    if (names === "*" || names.length) m.imports.push({ target: x[4]!, names });
  }
  for (const x of src.matchAll(REEXPORT_RE)) {
    const target = x[5]!;
    const clause = x[2]!;
    if (x[1]) {
      // `export type { A } from` — erased; remembered so a request for A reaches nothing.
      if (clause.startsWith("{")) for (const [, as] of specifiers(clause.slice(1, -1))) m.types.add(as);
      continue;
    }
    if (clause.startsWith("*")) {
      if (x[3]) m.reexports.push({ target, as: x[3], from: "*" });
      else m.stars.push(target);
      continue;
    }
    for (const [orig, as, typeOnly] of specifiers(clause.slice(1, -1))) {
      if (typeOnly) m.types.add(as);
      else m.reexports.push({ target, as, from: orig });
    }
  }
  for (const x of src.matchAll(SIDE_EFFECT_RE)) m.imports.push({ target: x[2]!, names: "*" });
  for (const x of src.matchAll(DYNAMIC_RE)) m.imports.push({ target: x[2]!, names: "*" });
  if (/\bexport\s+default\b/.test(src)) m.locals.add("default");
  for (const x of src.matchAll(LOCAL_DECL_RE)) m.locals.add(x[1]!);
  for (const x of src.matchAll(TYPE_DECL_RE)) m.types.add(x[1]!);
  for (const x of src.matchAll(LOCAL_LIST_RE))
    for (const [, as, typeOnly] of specifiers(x[2] ?? "")) {
      if (x[1] || typeOnly) m.types.add(as);
      else m.locals.add(as);
    }
  return m;
}

/** The specifiers a module mentions, in any role. */
export function extractSpecifiers(content: string, file: string): string[] {
  const m = parseModule(content, file);
  return [...new Set([...m.imports.map((i) => i.target), ...m.reexports.map((r) => r.target), ...m.stars])];
}

// ---- the graph --------------------------------------------------------------------------------

export interface AffectedGraph {
  known: Set<string>; // root-relative posix
  /** The module, its specifiers resolved to root-relative files (unresolvable ones dropped). */
  moduleOf(file: string): ModuleInfo;
}

function readDeps(root: string): Set<string> {
  const deps = new Set<string>();
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;
    for (const k of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) for (const d of Object.keys(pkg[k] ?? {})) deps.add(d);
  } catch {
    /* no manifest: every bare specifier is tried against the aliases */
  }
  return deps;
}

const packageOf = (spec: string): string => {
  const segs = spec.split("/");
  return spec.startsWith("@") ? segs.slice(0, 2).join("/") : segs[0]!;
};

function styleCandidates(dir: string, spec: string): string[] {
  const base = posix.join(dir, spec);
  const d = posix.dirname(base);
  const b = posix.basename(base);
  const out = [base];
  for (const e of [".scss", ".sass", ".css", ".less"])
    out.push(`${base}${e}`, posix.join(d, `_${b}${e}`), posix.join(base, `_index${e}`), posix.join(base, `index${e}`));
  return out;
}

const EMPTY_MODULE = (): ModuleInfo => ({ imports: [], reexports: [], stars: [], locals: new Set(), types: new Set() });

export function buildAffectedGraph(root: string, files?: string[]): AffectedGraph {
  // The resolver works on cwd-relative paths (the audit's convention); keep root-relative ones
  // for everything this module reports, and translate at the boundary.
  const rootRel = toPosix(relative(process.cwd(), resolve(root))) || ".";
  const toFull = (rel: string): string => (rootRel === "." ? rel : posix.join(rootRel, rel));
  const listed = files ?? engineWalk(root, { maxFiles: Number.MAX_SAFE_INTEGER }).files.map((f: { rel: string }) => f.rel);
  const known = new Set<string>();
  for (const f of listed) {
    const rel = norm(f);
    if (rel.split("/").some((seg) => seg === ".ultra11y" || seg === "audits")) continue;
    if (GRAPH_EXT.has(extOf(rel))) known.add(rel);
  }
  const fullKnown = new Set<string>();
  const back = new Map<string, string>();
  for (const rel of known) {
    const full = toFull(rel);
    fullKnown.add(full);
    back.set(full, rel);
  }
  const aliases = readTsAliases(rootRel);
  let resolver: SpecResolver | undefined;
  const deps = readDeps(root);
  const aliased = (spec: string): boolean => aliases.some((a) => (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix));
  const resolveFrom = (file: string, raw: string): string | null => {
    const spec = raw.split("?")[0]!;
    if (!spec || /^(?:[a-z]+:|\/\/|#)/i.test(spec)) return null; // node:, sass:, http:, data:, a hash
    if (STYLE_EXT.has(extOf(file))) {
      if (spec.startsWith("~")) return null;
      return (
        styleCandidates(posix.dirname(file), spec)
          .map(norm)
          .find((c) => known.has(c)) ?? null
      );
    }
    const relative = spec.startsWith(".") || spec.startsWith("/");
    if (!relative && !aliased(spec) && deps.has(packageOf(spec))) return null;
    resolver ??= makeSpecResolver(fullKnown, aliases, rootRel);
    const hit = resolver(toFull(file), spec);
    return hit === null ? null : (back.get(hit) ?? null);
  };
  const memo = new Map<string, ModuleInfo>();
  const moduleOf = (file: string): ModuleInfo => {
    const hit = memo.get(file);
    if (hit) return hit;
    let raw: ModuleInfo;
    try {
      raw = parseModule(readFileSync(join(root, file), "utf8"), file);
    } catch {
      raw = EMPTY_MODULE();
    }
    const out: ModuleInfo = { ...EMPTY_MODULE(), locals: raw.locals, types: raw.types };
    for (const i of raw.imports) {
      const target = resolveFrom(file, i.target);
      if (target) out.imports.push({ target, names: i.names });
    }
    for (const r of raw.reexports) {
      const target = resolveFrom(file, r.target);
      if (target) out.reexports.push({ ...r, target });
    }
    for (const st of raw.stars) {
      const target = resolveFrom(file, st);
      if (target) out.stars.push(target);
    }
    memo.set(file, out);
    return out;
  };
  return { known, moduleOf };
}

/** Every file a page renders from: its seeds in full, then each import by the names it takes. A
 *  module asked for a name it declares itself is taken whole (all its imports); a name it only
 *  re-exports is followed to where it comes from, and nothing else of the module is; a name it
 *  exports only as a type reaches nothing. A name found nowhere is taken whole, along with every
 *  `export *` — when unsure, select. */
export function closureOf(seeds: string[], graph: AffectedGraph): Set<string> {
  const reached = new Set<string>();
  const expanded = new Set<string>();
  const asked = new Set<string>();
  const stack: [string, string][] = seeds.map((s) => [s, "*"]);
  const expand = (file: string, m: ModuleInfo): void => {
    if (expanded.has(file)) return;
    expanded.add(file);
    for (const i of m.imports) {
      if (i.names === "*") stack.push([i.target, "*"]);
      else for (const n of i.names) stack.push([i.target, n]);
    }
  };
  while (stack.length) {
    const [file, want] = stack.pop()!;
    const key = `${file}\0${want}`;
    if (asked.has(key)) continue;
    asked.add(key);
    // A seed the diff deleted is not on disk any more, and is still a change to its page.
    if (!graph.known.has(file)) {
      reached.add(file);
      continue;
    }
    const m = graph.moduleOf(file);
    if (want === "*") {
      reached.add(file);
      expand(file, m);
      for (const r of m.reexports) stack.push([r.target, r.from]);
      for (const st of m.stars) stack.push([st, "*"]);
      continue;
    }
    if (m.types.has(want) && !m.locals.has(want) && !m.reexports.some((r) => r.as === want)) continue;
    reached.add(file);
    const named = m.reexports.filter((r) => r.as === want);
    for (const r of named) stack.push([r.target, r.from]);
    if (!named.length || m.locals.has(want)) {
      expand(file, m);
      if (!m.locals.has(want)) for (const st of m.stars) stack.push([st, want]);
    }
  }
  return reached;
}

// ---- the Next.js App Router convention -------------------------------------------------------

const NEXT_PAGE = /(^|\/)app\/(?:.*\/)?page\.(?:tsx|jsx|ts|js|mdx)$/;
const NEXT_WRAPPERS = ["layout", "template"];
const SCRIPT_EXTS = [".tsx", ".jsx", ".ts", ".js"];

/** The layouts and templates that wrap an App Router page, nearest first. */
export function nextWrappers(page: string, known: ReadonlySet<string>): string[] {
  if (!NEXT_PAGE.test(page)) return [];
  const segs = page.split("/");
  const appAt = segs.lastIndexOf("app");
  const out: string[] = [];
  for (let end = segs.length - 1; end > appAt; end--) {
    const dir = segs.slice(0, end).join("/");
    for (const w of NEXT_WRAPPERS) for (const e of SCRIPT_EXTS) if (known.has(`${dir}/${w}${e}`)) out.push(`${dir}/${w}${e}`);
  }
  return out;
}

// ---- selection --------------------------------------------------------------------------------

export function selectAffected(input: AffectedInput, graph: AffectedGraph = buildAffectedGraph(input.root)): AffectedResult {
  const changed = [...new Set(input.changed.map(norm))].sort();
  const empty: AffectedResult = { pages: [], all: false, none: true, unmapped: [], global: [], reasons: {}, unsourced: [], changed: changed.length };
  const unsourced = input.pages.filter((p) => !p.sources?.length).map((p) => p.id);
  if (!changed.length) return { ...empty, unsourced };

  const isGlobal = engineCompileGlobs([...IMPLICIT_GLOBAL, ...(input.global ?? []).map(norm)]) ?? (() => false);
  const globalHits = changed.filter((f) => isGlobal(f));
  if (globalHits.length)
    return {
      ...empty,
      pages: input.pages.map((p) => p.id),
      all: true,
      none: false,
      global: globalHits,
      unsourced,
    };

  const changedSet = new Set(changed);
  const reached = new Set<string>();
  const pages: string[] = [];
  const reasons: Record<string, string[]> = {};
  for (const page of input.pages) {
    const seeds = (page.sources ?? []).map(norm);
    if (!seeds.length) continue;
    const wrapped = seeds.flatMap((src) => [src, ...nextWrappers(src, graph.known)]);
    const seen = closureOf(wrapped, graph);
    const hits = changed.filter((f) => seen.has(f));
    for (const f of seen) if (changedSet.has(f)) reached.add(f);
    if (hits.length) {
      pages.push(page.id);
      reasons[page.id] = hits.slice(0, 5);
    }
  }
  const unmapped = changed.filter(
    (f) => !reached.has(f) && !f.startsWith("../") && MARKUP_EXT.has(extOf(f)) && !isTestArtifact(f) && existsSync(join(input.root, f)),
  );
  return { pages, all: false, none: pages.length === 0, unmapped, global: [], reasons, unsourced, changed: changed.length };
}

// ---- git ---------------------------------------------------------------------------------------

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}

export interface ChangedSince {
  mergeBase: string;
  /** Root-relative posix paths: committed since the merge-base, uncommitted, and untracked.
   *  Deletions included — a deleted source is a change to its page. */
  files: string[];
}

/** Files changed since the merge-base of `ref` and HEAD. Throws with a readable message when the
 *  ref or the merge-base cannot be resolved (a shallow clone is the usual cause). */
export function changedSince(ref: string, root: string): ChangedSince {
  // Real path on both sides: git answers with the resolved toplevel, and a root reached through a
  // symlink (macOS's /var → /private/var) would otherwise relativize every path out of the root.
  let abs = resolve(root);
  try {
    abs = realpathSync(abs);
  } catch {
    /* a root that does not exist fails at the git call below, with its own message */
  }
  let top: string;
  try {
    top = git(abs, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    throw new Error(`${root} is not inside a git repository.`);
  }
  let mergeBase: string;
  try {
    mergeBase = git(abs, ["merge-base", ref, "HEAD"]).trim();
  } catch {
    throw new Error(
      `no merge-base between "${ref}" and HEAD. Fetch the base branch with its history (actions/checkout with \`fetch-depth: 0\`), or pass a ref that exists.`,
    );
  }
  const lines = (s: string): string[] =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  const fromTop = [...lines(git(top, ["diff", "--name-only", "--no-renames", mergeBase])), ...lines(git(top, ["ls-files", "--others", "--exclude-standard"]))];
  const files = [...new Set(fromTop.map((p) => toPosix(relative(abs, join(top, p)))))].sort();
  return { mergeBase, files };
}
