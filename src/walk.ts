// Repository walk behind `audit` input expansion (src/glob.ts): every regular file
// under a root, minus what a source-level tool must never read.
//
//   - .gitignore files at every level (rules scoped to their own directory and
//     inherited by its children, a deeper file overriding a shallower one), plus
//     the root repository's .git/info/exclude (a linked worktree's `.git` FILE is
//     followed to its gitdir, then to the shared commondir);
//   - dependency, build, cache and VCS directories (IGNORE_DIRS, any depth);
//   - nested repositories: a directory below the root holding a `.git` entry;
//   - symlinked directories (never followed) and symlinked files resolving
//     outside the root;
//   - lockfiles, binary/asset extensions, minified bundles and files over 1 MiB.
//
// Directory traversal is fdir's; gitignore matching is `ignore`'s. Each .gitignore
// is loaded when fdir first reaches its directory (the `exclude` callback runs for
// a child directory only after its parent has been entered), so the rule stack of
// a directory is always known before any of its files reach the `filter` callback.
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import { fdir } from "fdir";
import ignore, { type Ignore } from "ignore";

const MAX_FILE_BYTES = 1024 * 1024;
const GIT_ENTRY = ".git";

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".pnpm",
  "bower_components",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".gradle",
  ".idea",
  ".vscode",
  ".cache",
  "tmp",
  ".ultraindex",
  ".codeindex",
  "Pods",
  "DerivedData",
  ".terraform",
  "elm-stuff",
  ".dart_tool",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "composer.lock",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "gemfile.lock",
  "go.sum",
  "flake.lock",
  "packages.lock.json",
  "podfile.lock",
  "mix.lock",
]);

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".icns",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".jar",
  ".war",
  ".class",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".o",
  ".a",
  ".wasm",
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
  ".lock",
  ".map",
]);

export interface WalkedFile {
  /** Root-relative posix path. */
  rel: string;
}

/** One ignore file's rules, matched against paths relative to `base` (root-relative posix, "" = root). */
interface RuleSet {
  base: string;
  ig: Ignore;
}

const toPosix = (p: string): string => (sep === "/" ? p : p.split(sep).join("/"));

function entryExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Read an ignore file as text; unreadable or binary (NUL bytes) content counts as empty. */
function readIgnoreText(p: string): string {
  try {
    const text = readFileSync(p, "utf8");
    if (text.includes("\0")) return "";
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return "";
  }
}

function ruleSet(base: string, text: string): RuleSet | null {
  if (!text.trim()) return null;
  // Case-sensitive like git's default on case-sensitive filesystems (and like the
  // matcher this replaced).
  return { base, ig: ignore({ ignorecase: false }).add(text) };
}

/** The root repository's `.git/info/exclude`, following a linked worktree's `.git` file. */
function readInfoExclude(root: string): string {
  const marker = join(root, GIT_ENTRY);
  try {
    let gitDir = marker;
    if (!lstatSync(marker).isDirectory()) {
      const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(marker, "utf8"));
      if (!m?.[1]) return "";
      gitDir = resolve(root, m[1]);
      const common = join(gitDir, "commondir");
      if (entryExists(common)) gitDir = resolve(gitDir, readFileSync(common, "utf8").trim());
    }
    return readIgnoreText(join(gitDir, "info", "exclude"));
  } catch {
    return "";
  }
}

/** Deepest rule set with an opinion decides (git precedence: a deeper .gitignore
 *  overrides a shallower one; within one file the last matching rule wins). */
function isIgnored(stack: readonly RuleSet[], rel: string, isDir: boolean): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    const { base, ig } = stack[i]!;
    const local = base ? rel.slice(base.length + 1) : rel;
    const r = ig.test(isDir ? `${local}/` : local);
    if (r.ignored) return true;
    if (r.unignored) return false;
  }
  return false;
}

/** Walk `root`, returning its files as root-relative posix paths, sorted. A missing root walks to nothing. */
export function walk(root: string): { files: WalkedFile[] } {
  let rootReal: string;
  try {
    rootReal = realpathSync(root);
    if (!statSync(rootReal).isDirectory()) return { files: [] };
  } catch {
    return { files: [] };
  }
  const rootAbs = resolve(root);
  const contained = (real: string): boolean => real === rootReal || real.startsWith(rootReal + sep);
  const relOf = (abs: string): string => toPosix(relative(rootAbs, abs));

  // Rule stack per directory (root-relative posix), filled as directories are entered.
  const stacks = new Map<string, readonly RuleSet[]>();
  const rootStack: RuleSet[] = [];
  for (const rs of [ruleSet("", readInfoExclude(rootAbs)), ruleSet("", readIgnoreText(join(rootAbs, ".gitignore")))]) {
    if (rs) rootStack.push(rs);
  }
  stacks.set("", rootStack);

  const parentOf = (rel: string): string => {
    const i = rel.lastIndexOf("/");
    return i === -1 ? "" : rel.slice(0, i);
  };

  const excludeDir = (name: string, dirPath: string): boolean => {
    if (IGNORE_DIRS.has(name)) return true;
    const abs = resolve(dirPath);
    const rel = relOf(abs);
    const inherited = stacks.get(parentOf(rel)) ?? [];
    if (isIgnored(inherited, rel, true)) return true;
    // A nested repository (or submodule / linked worktree) is its own project.
    if (entryExists(join(abs, GIT_ENTRY))) return true;
    const own = ruleSet(rel, readIgnoreText(join(abs, ".gitignore")));
    stacks.set(rel, own ? [...inherited, own] : inherited);
    return false;
  };

  const keepFile = (path: string): boolean => {
    const rel = toPosix(path);
    const name = rel.slice(rel.lastIndexOf("/") + 1);
    if (name === GIT_ENTRY) return false;
    if (LOCKFILES.has(name.toLowerCase())) return false;
    if (BINARY_EXT.has(extname(name).toLowerCase())) return false;
    if (name.endsWith(".min.js") || name.endsWith(".min.css")) return false;
    const abs = join(rootAbs, path);
    let isLink: boolean;
    let size: number;
    try {
      const lst = lstatSync(abs);
      isLink = lst.isSymbolicLink();
      const st = isLink ? statSync(abs) : lst;
      // Symlinked directories are never followed; sockets, FIFOs… are not source.
      if (!st.isFile()) return false;
      size = st.size;
    } catch {
      return false; // dangling symlink or vanished entry
    }
    if (size > MAX_FILE_BYTES) return false;
    if (isIgnored(stacks.get(parentOf(rel)) ?? [], rel, false)) return false;
    if (isLink) {
      try {
        if (!contained(realpathSync(abs))) return false;
      } catch {
        return false;
      }
    }
    return true;
  };

  const paths = new fdir().withRelativePaths().exclude(excludeDir).filter(keepFile).crawl(rootAbs).sync();
  const rels = paths.map(toPosix).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { files: rels.map((rel) => ({ rel })) };
}
