// The repository walk behind `audit` directory/glob inputs and `affected` (src/walk.ts):
// what it must skip, and how per-directory .gitignore files combine.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walk } from "../src/walk.js";

let root: string;
let outside: string;
const put = (rel: string, body = "x"): void => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const files = (dir = root): string[] => walk(dir).files.map((f) => f.rel);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-walk-"));
  outside = mkdtempSync(join(tmpdir(), "u11y-walk-out-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe("walk — .gitignore semantics", () => {
  it("scopes each .gitignore to its directory, lets a deeper file override a shallower one, and honours negation", () => {
    put(".gitignore", "*.log\n!important.log\n/rootonly.txt\nbuild2/\na/**/gen.ts\n");
    put("a/.gitignore", "!keep.log\n*.tmp\nc/\n");
    put("a/keep/.gitignore", "!*.tmp\n");
    put("sub/.gitignore", "X.LOG\n");
    for (const f of [
      "x.log",
      "important.log",
      "rootonly.txt",
      "sub/rootonly.txt",
      "a/keep.log",
      "a/x.log",
      "a/y.tmp",
      "a/keep/z.tmp",
      "a/b/gen.ts",
      "a/b/c/f.ts",
      "a/b/ok.ts",
      "docs/build2/q.html",
      "docs/p.html",
      "sub/X.LOG",
      "sub/x.log",
      "sub/Other.ts",
    ])
      put(f);
    expect(files()).toEqual([
      ".gitignore",
      "a/.gitignore",
      "a/b/ok.ts",
      "a/keep.log",
      "a/keep/.gitignore",
      "a/keep/z.tmp",
      "docs/p.html",
      "important.log",
      "sub/.gitignore",
      "sub/Other.ts",
      "sub/rootonly.txt",
    ]);
  });

  it("honours the root repository's info/exclude, following a linked worktree's .git file to the common dir", () => {
    const common = join(outside, "repo.git");
    const gitdir = join(common, "worktrees", "wt");
    mkdirSync(join(common, "info"), { recursive: true });
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(common, "info", "exclude"), "secret.txt\n");
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(root, ".git"), `gitdir: ${gitdir}\n`);
    put("secret.txt");
    put("kept.txt");
    expect(files()).toEqual(["kept.txt"]);
  });

  it("matches case-sensitively", () => {
    put(".gitignore", "*.LOG\n");
    put("a.LOG");
    put("b.log");
    expect(files()).toEqual([".gitignore", "b.log"]);
  });
});

describe("walk — what is never read", () => {
  it("skips dependency/build directories, nested repositories, lockfiles, binaries, minified bundles and files over 1 MiB", () => {
    for (const f of [
      "node_modules/pkg/index.js",
      "src/node_modules/pkg/index.js",
      "dist/out.js",
      "nested/.git/HEAD",
      "nested/n.ts",
      "submodule/.git",
      "submodule/s.ts",
      "yarn.lock",
      "pnpm-lock.yaml",
      "Cargo.lock",
      "img.png",
      "font.woff2",
      "bundle.js.map",
      "app.min.js",
      "app.min.css",
      "src/ok.ts",
    ])
      put(f);
    put("big.txt", "a".repeat(1024 * 1024 + 1));
    put("edge.txt", "a".repeat(1024 * 1024));
    expect(files()).toEqual(["edge.txt", "src/ok.ts"]);
  });

  it("never follows a symlinked directory and drops a symlinked file resolving outside the root", () => {
    put("real/r.ts");
    writeFileSync(join(outside, "o.ts"), "x");
    mkdirSync(join(root, "links"));
    symlinkSync(join(root, "real"), join(root, "links", "dir"));
    symlinkSync(join(root, "real", "r.ts"), join(root, "links", "inside.ts"));
    symlinkSync(join(outside, "o.ts"), join(root, "links", "escape.ts"));
    symlinkSync(join(root, "nowhere"), join(root, "links", "dangling.ts"));
    expect(files()).toEqual(["links/inside.ts", "real/r.ts"]);
  });

  it("walks a directory named like a skipped one when it is the root itself", () => {
    put("dist/a.html");
    expect(files(join(root, "dist"))).toEqual(["a.html"]);
  });

  it("returns nothing for a missing root", () => {
    expect(files(join(root, "missing"))).toEqual([]);
  });
});
