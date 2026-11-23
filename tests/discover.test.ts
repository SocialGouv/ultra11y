import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discover, priority, gitChangedFiles } from "../src/discover.js";
import { runAudit, buildAudit } from "../src/audit.js";
import { parseSource } from "../src/parse/source.js";
import { readText } from "../src/util.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "u11y-disc-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("priority ordering", () => {
  it("ranks layouts/templates before shared components before leaves", () => {
    expect(priority("src/layouts/Base.astro")).toBe(0);
    expect(priority("app/index.html")).toBe(0);
    expect(priority("src/components/Button.tsx")).toBe(1);
    expect(priority("src/pages/about/team.html")).toBe(2);
  });

  it("discover returns files in priority-then-path order", () => {
    const d = tmp();
    mkdirSync(join(d, "components"));
    mkdirSync(join(d, "layouts"));
    writeFileSync(join(d, "components", "z.html"), "<p>z</p>");
    writeFileSync(join(d, "page.html"), "<p>leaf</p>");
    writeFileSync(join(d, "layouts", "main.html"), "<p>layout</p>");
    const { files } = discover([d]);
    expect(files.map((f) => f.split("/").pop())).toEqual(["main.html", "z.html", "page.html"]);
  });
});

describe("content de-duplication", () => {
  it("audits identical files once and reports the occurrence count", () => {
    const d = tmp();
    const dup = `<img src="x.png">`;
    writeFileSync(join(d, "a.html"), dup);
    writeFileSync(join(d, "b.html"), dup);
    writeFileSync(join(d, "c.html"), `<a href="/"></a>`);
    const r = runAudit({ inputs: [d] });
    expect(r.scope.files).toBe(2); // a (canonical) + c, b deduped
    expect(r.scope.dedup).toEqual({ canonicalFiles: 2, duplicateFiles: 1 });
  });

  it("--dedup off audits every file", () => {
    const d = tmp();
    const dup = `<img src="x.png">`;
    writeFileSync(join(d, "a.html"), dup);
    writeFileSync(join(d, "b.html"), dup);
    const r = runAudit({ inputs: [d], dedup: "off" });
    expect(r.scope.files).toBe(2);
    expect(r.scope.dedup).toBeUndefined();
  });
});

describe("--max-files cap", () => {
  it("caps canonical files and records logged truncation", () => {
    const d = tmp();
    for (let i = 0; i < 5; i++) writeFileSync(join(d, `p${i}.html`), `<p>${i}</p>`);
    const warnings: string[] = [];
    const r = runAudit({ inputs: [d], maxFiles: 2, onWarn: (m) => warnings.push(m) });
    expect(r.scope.files).toBe(2);
    expect(r.scope.truncated).toEqual({ limit: 2, total: 5, skipped: 3 });
    expect(warnings.some((w) => w.includes("--max-files=2"))).toBe(true);
  });

  it("does not let stdin push past the cap", () => {
    const d = tmp();
    for (let i = 0; i < 3; i++) writeFileSync(join(d, `p${i}.html`), `<p>${i}</p>`);
    const r = runAudit({ inputs: [d, "-"], stdin: `<img src="x">`, maxFiles: 2 });
    expect(r.scope.files).toBe(2); // stdin skipped once the cap is hit
  });
});

describe("streaming ≡ eager (golden equivalence)", () => {
  it("runAudit (streaming) matches buildAudit (all docs in memory), byte-for-byte", () => {
    const inputs = [FIX];
    const { files } = discover(inputs);
    const docs = files.map((f) => parseSource(readText(f), f));
    const eager = buildAudit(docs, inputs);
    const streamed = runAudit({ inputs, dedup: "off" });
    expect(JSON.stringify(streamed)).toBe(JSON.stringify(eager));
  });
});

describe("git incremental discovery", () => {
  it("--changed audits only files changed vs the ref; gitChangedFiles is null outside a repo", () => {
    const repo = tmp();
    const run = (...args: string[]): void => {
      execFileSync("git", args, { cwd: repo, stdio: "ignore" });
    };
    run("init");
    run("config", "user.email", "t@t.t");
    run("config", "user.name", "t");
    writeFileSync(join(repo, "old.html"), "<p>old</p>");
    writeFileSync(join(repo, "stable.html"), "<p>stable</p>");
    run("add", ".");
    run("commit", "-m", "base");
    writeFileSync(join(repo, "old.html"), `<img src="x">`); // modify
    writeFileSync(join(repo, "new.html"), `<a href="/"></a>`); // untracked

    const prev = process.cwd();
    try {
      process.chdir(repo);
      const changed = gitChangedFiles();
      expect(changed).not.toBeNull();
      const names = new Set(changed!.map((f) => f.split("/").pop()));
      expect(names.has("old.html")).toBe(true);
      expect(names.has("new.html")).toBe(true);
      expect(names.has("stable.html")).toBe(false);

      const { files, changedMode, gitUnavailable } = discover(["."], { changed: true });
      expect(changedMode).toBe(true);
      expect(gitUnavailable).toBe(false);
      const got = new Set(files.map((f) => f.split("/").pop()));
      expect(got).toEqual(new Set(["old.html", "new.html"]));
    } finally {
      process.chdir(prev);
    }
  });
});
