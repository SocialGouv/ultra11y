// .opencode/plugins/ultra11y.js is committed JavaScript that no type-checker covers and
// that OpenCode loads straight from disk. It is also the only transport where the gate
// blocks by THROWING rather than by returning a decision, so the thing most worth proving
// is the one that would be worst to get wrong: it must throw for exactly our own decision
// and for nothing else, or a bug in it surfaces to the user as a broken `git push`.
//
// Driven directly — no OpenCode required, so this runs in CI.
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPath = join(repoRoot, ".opencode", "plugins", "ultra11y.js");
const engine = join(repoRoot, "scripts", "ultra11y.mjs");

const tmps: string[] = [];
function tmpRepo(withFinding: boolean): string {
  const d = mkdtempSync(join(tmpdir(), "u11y-oc-"));
  tmps.push(d);
  execFileSync("git", ["init", "-q", "."], { cwd: d });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: d });
  execFileSync("git", ["config", "user.name", "t"], { cwd: d });
  if (withFinding) {
    // An <img> with no alt — a blocking 1.1.1 finding, the same fixture hook.test.ts uses.
    writeFileSync(join(d, "page.html"), '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="a.png"></body></html>\n');
    execFileSync("git", ["add", "page.html"], { cwd: d });
  }
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Load the plugin and hand back its `tool.execute.before`, with the engine pinned and the
 *  process cwd pointed at `cwd` (which is what the plugin reports as the audited repo). */
async function hookFor(cwd: string) {
  process.env.ULTRA11Y_BIN = engine;
  const mod = await import(`${pluginPath}?t=${Math.random()}`);
  const table = await mod.Ultra11yPlugin({ directory: cwd });
  return table["tool.execute.before"] as (i: unknown, o: unknown) => Promise<void>;
}

const call = (fn: (i: unknown, o: unknown) => Promise<void>, tool: string, command: unknown, sessionID = "s1") =>
  fn({ tool, sessionID }, { args: { command } });

describe(".opencode/plugins/ultra11y.js", () => {
  it("is valid JavaScript on the Node floor", () => {
    const r = spawnSync(process.execPath, ["--check", pluginPath], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });

  it("imports nothing outside node: — the zero-dependency guarantee", () => {
    // OpenCode loads this file directly; a bare specifier would need a node_modules that
    // may not exist next to ~/.config/opencode/plugin/.
    const text = readFileSync(pluginPath, "utf8");
    const imports = [...text.matchAll(/^import .*? from ["']([^"']+)["']/gm)].map((m) => m[1] as string);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => !i.startsWith("node:"))).toEqual([]);
  });

  it("exposes the two lifecycle callbacks OpenCode calls", async () => {
    const mod = await import(`${pluginPath}?t=base`);
    const table = await mod.Ultra11yPlugin({});
    expect(typeof table.config).toBe("function");
    expect(typeof table["tool.execute.before"]).toBe("function");
  });

  it("carries the ownership marker the installer checks for", async () => {
    const mod = await import(`${pluginPath}?t=marker`);
    expect(mod.ULTRA11Y_OPENCODE_PLUGIN).toBe("ULTRA11Y_OPENCODE_PLUGIN");
  });

  describe("config()", () => {
    it("registers the bundled skills directory, idempotently", async () => {
      const mod = await import(`${pluginPath}?t=cfg`);
      const table = await mod.Ultra11yPlugin({});
      const config: { skills?: { paths?: string[] } } = {};
      await table.config(config);
      await table.config(config);
      expect(config.skills?.paths).toHaveLength(1);
      expect(config.skills?.paths?.[0]).toContain("skills");
    });

    it("leaves a config it cannot understand alone rather than throwing", async () => {
      const mod = await import(`${pluginPath}?t=cfg2`);
      const table = await mod.Ultra11yPlugin({});
      await expect(table.config(Object.freeze({}))).resolves.toBeUndefined();
    });
  });

  describe("tool.execute.before", () => {
    it("does not touch a non-shell tool", async () => {
      const fn = await hookFor(tmpRepo(true));
      await expect(call(fn, "read", undefined)).resolves.toBeUndefined();
    });

    it("does not touch a shell command that publishes nothing", async () => {
      // The prefilter must reject this without ever spawning the 2.5 MB engine.
      const fn = await hookFor(tmpRepo(true));
      await expect(call(fn, "bash", "ls -la")).resolves.toBeUndefined();
    });

    it("does not touch a non-string command", async () => {
      const fn = await hookFor(tmpRepo(true));
      await expect(call(fn, "bash", { weird: true })).resolves.toBeUndefined();
    });

    it("blocks a commit carrying a blocking finding, naming the skill and the code", async () => {
      const d = tmpRepo(true);
      const fn = await hookFor(d);
      await expect(call(fn, "bash", "git commit -m wip", d)).rejects.toThrow(/review-a11y/);
    });

    it("does not block twice for the same findings — the retry has to land", async () => {
      const d = tmpRepo(true);
      const fn = await hookFor(d);
      await expect(call(fn, "bash", "git commit -m wip", d)).rejects.toThrow();
      // Same session, same finding set: the anti-loop marker in the engine must let it by,
      // or the user could never commit at all.
      await expect(call(fn, "bash", "git commit -m wip", d)).resolves.toBeUndefined();
    });

    it("stays out of the way on a clean repository", async () => {
      const d = tmpRepo(false);
      const fn = await hookFor(d);
      await expect(call(fn, "bash", "git commit -m wip", d)).resolves.toBeUndefined();
    });

    it("honours SKIP_A11Y=1", async () => {
      const d = tmpRepo(true);
      const fn = await hookFor(d);
      process.env.SKIP_A11Y = "1";
      try {
        await expect(call(fn, "bash", "git commit -m wip", d)).resolves.toBeUndefined();
      } finally {
        delete process.env.SKIP_A11Y;
      }
    });

    it("stays silent when NO engine resolves rather than breaking the session", async () => {
      // Every candidate has to miss, so the plugin is copied somewhere with no package
      // above it and $HOME is pointed at an empty directory (which is where the pinned
      // engine would live). This is the shape of a botched install — and it must be a
      // silent no-op, never an error on the user's `git push`.
      const d = tmpRepo(true);
      const isolated = mkdtempSync(join(tmpdir(), "u11y-oc-noengine-"));
      tmps.push(isolated);
      const copied = join(isolated, "ultra11y-plugin.js");
      writeFileSync(copied, readFileSync(pluginPath, "utf8"));

      const savedHome = process.env.HOME;
      const savedBin = process.env.ULTRA11Y_BIN;
      process.env.HOME = isolated;
      delete process.env.ULTRA11Y_BIN;
      try {
        const mod = await import(`${copied}?t=missing`);
        const table = await mod.Ultra11yPlugin({ directory: d });
        await expect(call(table["tool.execute.before"], "bash", "git commit -m wip", d)).resolves.toBeUndefined();
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
        if (savedBin !== undefined) process.env.ULTRA11Y_BIN = savedBin;
      }
    });
  });
});
