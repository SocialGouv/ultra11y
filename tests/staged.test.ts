// Strict staged-snapshot mode (`--staged`) for audit/fix: the pre-commit gate reads
// the exact index blobs (`git show :./path`), never the working tree, and fix
// auto-applies + re-stages only fully-staged files. Reuses the temp-git harness from
// discover.test.ts; every staged case chdir's into the repo (the git helpers use cwd).
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitStagedFiles, stagedContent, stagedContents, hasUnstagedChanges } from "../src/discover.js";
import { runAudit } from "../src/audit.js";
import { runFix } from "../src/fix.js";

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "u11y-staged-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function initRepo(): string {
  const repo = tmp();
  const run = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  };
  run("init");
  run("config", "user.email", "t@t.t");
  run("config", "user.name", "t");
  // A committed base so "staged vs HEAD" has a reference.
  writeFileSync(join(repo, "base.html"), "<p>base</p>");
  run("add", ".");
  run("commit", "-m", "base");
  return repo;
}
const git = (repo: string, ...args: string[]): string => execFileSync("git", args, { cwd: repo, encoding: "utf8" });

function inRepo<T>(repo: string, fn: () => T): T {
  const prev = process.cwd();
  try {
    process.chdir(repo);
    return fn();
  } finally {
    process.chdir(prev);
  }
}

describe("gitStagedFiles / stagedContent", () => {
  it("lists only staged adds/mods, and reads the index blob (not untracked/unstaged)", () => {
    const repo = initRepo();
    writeFileSync(join(repo, "staged.html"), `<img src="x">`); // will be staged
    writeFileSync(join(repo, "untracked.html"), `<img src="y">`); // never added
    git(repo, "add", "staged.html");
    // Modify a committed file in the working tree WITHOUT staging it.
    writeFileSync(join(repo, "base.html"), "<p>edited but not staged</p>");

    inRepo(repo, () => {
      const staged = gitStagedFiles();
      expect(staged).not.toBeNull();
      const names = new Set(staged!.map((f) => f.split("/").pop()));
      expect(names.has("staged.html")).toBe(true);
      expect(names.has("untracked.html")).toBe(false); // untracked
      expect(names.has("base.html")).toBe(false); // unstaged-only edit

      expect(stagedContent("staged.html")).toBe(`<img src="x">`);
      expect(stagedContent("untracked.html")).toBeNull(); // not in the index
    });
  });
});

describe("audit --staged reads the index, not the working tree", () => {
  it("reports the staged snapshot even after the working-tree copy is fixed", () => {
    const repo = initRepo();
    writeFileSync(join(repo, "a.html"), `<img src="x">`); // missing alt — staged
    git(repo, "add", "a.html");
    // Now "fix" it only in the working tree (leave the index blob untouched).
    writeFileSync(join(repo, "a.html"), `<img src="x" alt="a real caption">`);

    inRepo(repo, () => {
      const staged = runAudit({ inputs: ["."], staged: true });
      expect(staged.findings.some((f) => f.ruleId === "img-alt-missing")).toBe(true); // from the index

      const working = runAudit({ inputs: ["."], changed: true });
      expect(working.findings.some((f) => f.ruleId === "img-alt-missing")).toBe(false); // working tree is clean
    });
  });

  it("falls back to a working-tree scan with a warning outside a git repo", () => {
    const dir = tmp(); // a plain dir, not a git repo
    writeFileSync(join(dir, "a.html"), `<img src="x">`);
    const warnings: string[] = [];
    inRepo(dir, () => {
      const r = runAudit({ inputs: ["."], staged: true, onWarn: (m) => warnings.push(m) });
      expect(r.scope.files).toBeGreaterThanOrEqual(1); // still audited (fallback)
    });
    expect(warnings.some((w) => w.includes("git is unavailable"))).toBe(true);
  });
});

describe("audit --staged + captureDiff — captures relevant to the diffed source files", () => {
  function repoWithButtonCapture(): string {
    const repo = initRepo();
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(repo + "/src/Button.tsx", `export default function Button() { return <button>Save</button>; }`);
    mkdirSync(join(repo, ".ultra11y/captures"), { recursive: true });
    // A real rendered capture for Button, committed and UNCHANGED — only its source
    // (Button.tsx) is about to be staged, mirroring the common real-world case.
    writeFileSync(
      join(repo, ".ultra11y/captures/Button.html"),
      '<!-- ultra11y:capture v="1" source="src/Button.tsx" component="Button" -->\n<button>Save</button>\n',
    );
    git(repo, "add", ".");
    git(repo, "commit", "-m", "base + capture");
    return repo;
  }

  it("includes the Button capture when Button.tsx itself is staged", () => {
    const repo = repoWithButtonCapture();
    writeFileSync(repo + "/src/Button.tsx", `export default function Button() { return <button aria-label="Save"><svg/></button>; }`);
    git(repo, "add", "src/Button.tsx");

    inRepo(repo, () => {
      const staged = runAudit({ inputs: ["."], staged: true, captureDir: ".ultra11y/captures", captureDiff: true });
      expect(staged.scope.captures?.components).toContain("Button");
    });
  });

  it("does NOT include the Button capture when an unrelated file is staged", () => {
    const repo = repoWithButtonCapture();
    writeFileSync(join(repo, "other.html"), "<p>unrelated</p>");
    git(repo, "add", "other.html");

    inRepo(repo, () => {
      const staged = runAudit({ inputs: ["."], staged: true, captureDir: ".ultra11y/captures", captureDiff: true });
      expect(staged.scope.captures).toBeUndefined();
    });
  });

  it("is a no-op without captureDiff (previous behavior: diff mode never pulls in captures)", () => {
    const repo = repoWithButtonCapture();
    writeFileSync(repo + "/src/Button.tsx", `export default function Button() { return <button aria-label="Save"><svg/></button>; }`);
    git(repo, "add", "src/Button.tsx");

    inRepo(repo, () => {
      const staged = runAudit({ inputs: ["."], staged: true, captureDir: ".ultra11y/captures" });
      expect(staged.scope.captures).toBeUndefined();
    });
  });
});

describe("fix --staged --write", () => {
  it("auto-fixes and re-stages a fully-staged file", () => {
    const repo = initRepo();
    writeFileSync(join(repo, "a.html"), `<div tabindex="5">go</div>`); // positive-tabindex (auto fix)
    git(repo, "add", "a.html");

    const r = inRepo(repo, () => runFix({ inputs: ["."], staged: true, safe: true, write: true }));
    expect(r.totals.filesWritten).toBe(1);
    expect(r.totals.filesRestaged).toBe(1);
    // The fix landed in BOTH the index (what commits) and the working tree.
    expect(git(repo, "show", ":./a.html")).toContain(`tabindex="0"`);
    expect(git(repo, "diff", "--name-only").trim()).toBe(""); // working tree == index (no leftover unstaged diff)
  });

  it("never touches a partially-staged file (unstaged edits would be silently staged)", () => {
    const repo = initRepo();
    writeFileSync(join(repo, "a.html"), `<div tabindex="5">go</div>`);
    git(repo, "add", "a.html"); // index = the fixable version
    writeFileSync(join(repo, "a.html"), `<div tabindex="5">go</div>\n<!-- unstaged edit -->`); // working tree diverges

    const r = inRepo(repo, () => {
      expect(hasUnstagedChanges("a.html")).toBe(true);
      return runFix({ inputs: ["."], staged: true, safe: true, write: true });
    });
    expect(r.totals.partialStageSkipped).toBe(1);
    expect(r.totals.filesRestaged).toBe(0);
    expect(r.totals.filesWritten).toBe(0);
    // The unstaged working-tree edit survives untouched.
    expect(git(repo, "diff", "--name-only")).toContain("a.html");
  });

  it("--safe leaves placeholder-only findings unfixed so the gate keeps blocking", () => {
    const repo = initRepo();
    writeFileSync(join(repo, "a.html"), `<img src="x">`); // img-alt-missing is placeholder-fixable
    git(repo, "add", "a.html");

    const { fixed, stillFailing } = inRepo(repo, () => {
      const fixed = runFix({ inputs: ["."], staged: true, safe: true, write: true });
      const stillFailing = runAudit({ inputs: ["."], staged: true });
      return { fixed, stillFailing };
    });
    expect(fixed.totals.filesWritten).toBe(0); // no auto fix available; placeholder skipped under --safe
    expect(stillFailing.findings.some((f) => f.ruleId === "img-alt-missing")).toBe(true);
    // Index blob is unchanged — no TODO stub was committed.
    expect(git(repo, "show", ":./a.html")).toBe(`<img src="x">`);
  });
});

// The staged snapshot used to cost one `git show` PROCESS per file; it is now a single
// `git cat-file --batch`. The batch protocol frames each blob by its BYTE size, so the
// riskiest case is non-ASCII content: slicing the stream by character offsets would
// desynchronise every blob after the first accented one.
describe("staged snapshot — batched index reads", () => {
  const files: Record<string, string> = {
    "a.html": `<img src="a.png">`,
    "accents.html": `<p>Représentation accentuée — déjà vu, ça coûte cher</p><img src="é.png">`,
    "emoji.html": `<p>🎯 mixed 漢字 content</p><button></button>`,
    "empty.html": "",
    "big.html": `<div>${"x".repeat(50_000)}</div>`,
  };

  it("returns exactly what a per-file `git show` returns, byte for byte", () => {
    const repo = initRepo();
    for (const [name, body] of Object.entries(files)) writeFileSync(join(repo, name), body);
    git(repo, "add", ".");

    const batched = inRepo(repo, () => stagedContents(Object.keys(files)));
    const oneByOne = inRepo(repo, () => new Map(Object.keys(files).map((f) => [f, stagedContent(f)])));

    expect([...batched.keys()].sort()).toEqual(Object.keys(files).sort());
    for (const [name, body] of Object.entries(files)) {
      expect(batched.get(name), `${name} vs the real index blob`).toBe(body);
      expect(batched.get(name), `${name} vs per-file git show`).toBe(oneByOne.get(name));
    }
  });

  it("omits a path with no index blob instead of inventing one", () => {
    const repo = initRepo();
    writeFileSync(join(repo, "staged.html"), "<p>staged</p>");
    writeFileSync(join(repo, "untracked.html"), "<p>untracked</p>");
    git(repo, "add", "staged.html");

    const batched = inRepo(repo, () => stagedContents(["staged.html", "untracked.html", "never-existed.html"]));
    expect([...batched.keys()]).toEqual(["staged.html"]);
    expect(batched.get("staged.html")).toBe("<p>staged</p>");
  });

  it("is a no-op on an empty request", () => {
    const repo = initRepo();
    expect(inRepo(repo, () => stagedContents([])).size).toBe(0);
  });
});
