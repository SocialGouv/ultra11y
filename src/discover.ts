// Smart file discovery for `audit` at scale. The static engine never needs to
// hold a whole monorepo in memory — it focuses: only markup files, optionally
// only what git says changed, ordered so the highest-value markup (layouts,
// templates, shared components) is audited first. Dedup + the --max-files cap are
// enforced by the streaming loop in audit.ts (single read per file). Zero deps:
// just node:fs + node:child_process (git) + node:path.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { expandInputs, makeFilter, inScopeMatcher, toPosix, type ExpandOpts } from "./glob.js";

export interface DiscoverOpts extends ExpandOpts {
  changed?: boolean; // audit only files changed vs `since` (default HEAD)
  since?: string; // git ref to diff against (implies changed)
  staged?: boolean; // audit exactly the staged index snapshot (strict pre-commit scope)
  onWarn?: (msg: string) => void;
}

export interface Discovery {
  files: string[]; // ordered: priority tier, then path (deterministic)
  changedMode: boolean;
  gitUnavailable: boolean; // changed mode requested but not a git repo / no git
  stagedContent?: Map<string, string>; // staged mode only: file → index blob content
}

function git(args: string[], maxBuffer?: number): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...(maxBuffer ? { maxBuffer } : {}) });
  } catch {
    return null;
  }
}

/** Files changed vs `ref` (working tree + index + untracked), repo-root-relative
 *  paths resolved to cwd-relative. null if git is unavailable / not a repo. */
export function gitChangedFiles(ref?: string): string[] | null {
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top === null) return null;
  const repoRoot = top.trim();
  const base = ref?.trim() ? ref.trim() : "HEAD";
  const out = new Set<string>();
  const add = (s: string | null): void => {
    if (!s) return;
    for (const line of s.split("\n")) {
      const t = line.trim();
      if (t) out.add(t);
    }
  };
  // --diff-filter=d drops deletions: we never audit a file that no longer exists.
  add(git(["diff", "--name-only", "--diff-filter=d", base]));
  add(git(["diff", "--name-only", "--diff-filter=d", "--cached", base]));
  add(git(["ls-files", "--others", "--exclude-standard"]));
  const cwd = process.cwd();
  return [...out].map((p) => relative(cwd, join(repoRoot, p)));
}

/** Staged (index) markup files: adds + modifications only (index vs HEAD) — NOT
 *  untracked, NOT working-tree-only edits. --diff-filter=d drops staged deletions; a
 *  rename surfaces as the new path. Repo-root-relative → cwd-relative. null if git is
 *  unavailable / not a repo. */
export function gitStagedFiles(): string[] | null {
  const top = git(["rev-parse", "--show-toplevel"]);
  if (top === null) return null;
  const out = git(["diff", "--cached", "--name-only", "--diff-filter=d"]);
  if (out === null) return null;
  const repoRoot = top.trim();
  const cwd = process.cwd();
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => relative(cwd, join(repoRoot, p)));
}

/** Exact bytes of the index (staged) blob for a path — what a commit would record,
 *  including any .gitattributes clean filters. `:./` makes the pathspec cwd-relative.
 *  null on any error (untracked path, or a blob larger than maxBuffer). */
export function stagedContent(file: string): string | null {
  return git(["show", `:./${toPosix(file)}`], 32 * 1024 * 1024);
}

/** Index blobs for MANY paths in ONE `git cat-file --batch` instead of one `git show`
 *  process per file — the pre-commit hook's cost used to grow one spawn at a time.
 *  Falls back to per-file `git show` when the batch is unavailable, so behaviour is
 *  identical either way (a path with no index blob is simply absent from the map).
 *
 *  `--batch` answers each request with `<sha> <type> <size>\n<size bytes>\n`, or
 *  `<request> missing\n`. Sizes are BYTE counts, so the stream is walked as a Buffer
 *  and each blob decoded afterwards — slicing utf8 by character count would corrupt
 *  any file containing non-ASCII. */
export function stagedContents(files: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!files.length) return out;
  const requests = files.map((f) => `:./${toPosix(f)}`);
  let buf: Buffer | null = null;
  try {
    buf = execFileSync("git", ["cat-file", "--batch"], {
      input: `${requests.join("\n")}\n`,
      stdio: ["pipe", "pipe", "ignore"],
      maxBuffer: 512 * 1024 * 1024,
    });
  } catch {
    buf = null;
  }
  if (buf === null) {
    for (const f of files) {
      const c = stagedContent(f);
      if (c !== null) out.set(f, c);
    }
    return out;
  }
  let pos = 0;
  for (const file of files) {
    const nl = buf.indexOf(0x0a, pos);
    if (nl === -1) break; // truncated stream — the rest is simply not resolved
    const header = buf.toString("utf8", pos, nl);
    pos = nl + 1;
    const m = /^[0-9a-f]{40,64} \w+ (\d+)$/.exec(header);
    if (!m) continue; // "<request> missing" (or an ambiguous name): no index blob
    const size = Number(m[1]);
    out.set(file, buf.toString("utf8", pos, pos + size));
    pos += size + 1; // blob + its trailing newline
  }
  return out;
}

/** True when the working tree differs from the index for `file` (unstaged edits).
 *  A partially-staged file must never be auto-fixed + re-staged: writing index-derived
 *  output over the working tree and `git add`-ing it would silently stage those edits. */
export function hasUnstagedChanges(file: string): boolean {
  return !!git(["diff", "--name-only", "--", file])?.trim();
}

/** Re-stage a file after a deterministic fix (only ever called on fully-staged files). */
export function gitAdd(file: string): void {
  git(["add", "--", file]);
}

// Audit the highest-value markup first so a partial / capped run still covers
// what matters. Lower number = earlier.
const TIER0 = /(^|\/)(layout|template|_app|_document|app|main|index)[.\-/]|(^|\/)(layouts?|templates?)\//i;
const TIER1 = /(^|\/)(components?|shared|ui|design-system|ds|partials?|includes?)\//i;
export function priority(file: string): number {
  const rel = toPosix(file);
  if (TIER0.test(rel)) return 0;
  if (TIER1.test(rel)) return 1;
  return 2;
}

/** Sort by priority tier, then path — deterministic, and the tier is computed ONCE per
 *  file instead of twice per comparison (the two `priority()` regexes used to run
 *  ~4·n·log n times on every discovery). */
function sortByPriorityThenPath(files: string[]): string[] {
  return files
    .map((file) => ({ file, tier: priority(file) }))
    .sort((a, b) => a.tier - b.tier || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
    .map((d) => d.file);
}

/** Resolve inputs into an ordered candidate file list. In `--changed` mode this
 *  starts from git's changed set (no full tree walk) filtered to the audited
 *  scope; otherwise it expands inputs normally. */
export function discover(inputs: string[], opts: DiscoverOpts = {}): Discovery {
  const changedMode = !!(opts.changed || opts.since || opts.staged);
  let files: string[];
  let gitUnavailable = false;
  let staged: Map<string, string> | undefined;

  if (opts.staged) {
    // Strict staged snapshot: audit exactly the index blobs (what a commit records),
    // not the working-tree copy. --staged takes precedence over --changed/--since.
    const stagedFiles = gitStagedFiles();
    if (stagedFiles === null) {
      gitUnavailable = true;
      opts.onWarn?.("ultra11y: --staged requested but git is unavailable here — falling back to a full scan.");
      files = expandInputs(inputs, opts);
    } else {
      const filter = makeFilter(opts);
      const inScope = inScopeMatcher(inputs);
      // No existsSync: a staged-added file may be edited/removed on disk, yet its index
      // blob is exactly what the commit would record — audit that.
      const scoped = stagedFiles.filter((f) => filter(f) && (!inScope || inScope(f)));
      staged = stagedContents(scoped);
      files = [...staged.keys()];
    }
  } else if (changedMode) {
    const changed = gitChangedFiles(opts.since);
    if (changed === null) {
      gitUnavailable = true;
      opts.onWarn?.("ultra11y: --changed requested but git is unavailable here — falling back to a full scan.");
      files = expandInputs(inputs, opts);
    } else {
      const filter = makeFilter(opts);
      const inScope = inScopeMatcher(inputs);
      files = changed.filter((f) => existsSync(f) && filter(f) && (!inScope || inScope(f)));
    }
  } else {
    files = expandInputs(inputs, opts);
  }

  files = sortByPriorityThenPath([...new Set(files)]);
  return { files, changedMode, gitUnavailable, ...(staged ? { stagedContent: staged } : {}) };
}
