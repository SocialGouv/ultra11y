// .opencode/plugins/ultra11y.js is committed JavaScript that no type-checker covers and
// that OpenCode loads straight from disk. It is also the only transport where the gate
// blocks by THROWING rather than by returning a decision, so the thing most worth proving
// is the one that would be worst to get wrong: it must throw for exactly our own decision
// and for nothing else, or a bug in it surfaces to the user as a broken `git push`.
//
// It is ONE module serving two plugin APIs (OpenCode 1's function/`server()` and OpenCode 2's
// `{ id, setup(ctx) }`), so every behaviour is driven through both entry points: fake V1
// input/output objects, and a fake V2 `ctx` recording what `setup` registers.
//
// Driven directly — no OpenCode required, so this runs in CI. The real-binary check of both
// majors is tests/opencode-smoke.e2e.test.ts (`pnpm test:opencode`).
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  it("carries the ownership marker the installer checks for", () => {
    expect(readFileSync(pluginPath, "utf8")).toContain("ULTRA11Y_OPENCODE_PLUGIN");
  });

  it("exports functions only, besides the default — an old OpenCode 1 calls every export", async () => {
    // OpenCode 1's legacy loader iterates Object.values(module) and throws "Plugin export is
    // not a function" on anything else, which kills the whole plugin (it did, on 1.19.5,
    // while this file still exported its marker strings).
    const mod = await import(`${pluginPath}?t=exports`);
    for (const [name, value] of Object.entries(mod)) {
      if (name === "default") continue;
      expect(typeof value, `export ${name}`).toBe("function");
    }
  });

  it("default-exports one object both majors read: { id, setup } for V2, server() for V1", async () => {
    const mod = await import(`${pluginPath}?t=default`);
    const def = mod.default;
    expect(def.id).toBe("ultra11y");
    expect(typeof def.setup).toBe("function");
    expect(typeof def.server).toBe("function");
    // V1 ≥ 1.18.28 calls ONLY default.server(); it must be the same factory as the named
    // export, or the two routes would drift.
    expect(def.server).toBe(mod.Ultra11yPlugin);
    // V1 rejects a default object carrying both server() and tui().
    expect("tui" in def).toBe(false);
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

  describe("tool.execute.before — what OpenCode 1 really hands in", () => {
    it("runs the engine once per tool call when an old V1 registers the module twice", async () => {
      // OpenCode 1 before the object entrypoint reaches Ultra11yPlugin twice (the named
      // export and default.server). Same call id ⇒ the second hook must not spawn again.
      const d = tmpRepo(true);
      const { bin, count } = fakeEngine("");
      process.env.ULTRA11Y_BIN = bin;
      const mod = await import(`${pluginPath}?t=twice`);
      const a = (await mod.Ultra11yPlugin({ directory: d }))["tool.execute.before"];
      const b = (await mod.default.server({ directory: d }))["tool.execute.before"];
      const input = { tool: "bash", sessionID: "s-twice", callID: "call-1" };
      await a(input, { args: { command: "git push" } });
      await b(input, { args: { command: "git push" } });
      expect(count()).toBe(1);
      // A different call is reviewed again.
      await b({ ...input, callID: "call-2" }, { args: { command: "git push" } });
      expect(count()).toBe(2);
    });

    it("blocks with the engine's text, verbatim", async () => {
      const { bin } = fakeEngine("ultra11y: 1 accessibility finding(s) (1 blocking) in the code about to be pushed.");
      process.env.ULTRA11Y_BIN = bin;
      const mod = await import(`${pluginPath}?t=verbatim`);
      const fn = (await mod.Ultra11yPlugin({ directory: tmpRepo(false) }))["tool.execute.before"];
      await expect(fn({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "git push" } })).rejects.toThrow(/^ultra11y: 1 accessibility finding/);
    });
  });

  describe("rule 1 — only OUR decision ever blocks", () => {
    it("never throws stdout that is not an ultra11y decision (OpenCode's own --help, say)", async () => {
      // Inside OpenCode, process.execPath is the Bun-compiled opencode binary: spawning it
      // with the engine path printed OpenCode's CLI help, which was then thrown at the
      // agent as a "finding" on every git push. Whatever the cause, foreign stdout is silence.
      const { bin } = fakeEngine("DESCRIPTION\n  OpenCode command line interface\n");
      process.env.ULTRA11Y_BIN = bin;
      const mod = await import(`${pluginPath}?t=foreign`);
      const v1 = (await mod.Ultra11yPlugin({ directory: tmpRepo(false) }))["tool.execute.before"];
      await expect(v1({ tool: "bash", sessionID: "s", callID: "f1" }, { args: { command: "git push" } })).resolves.toBeUndefined();
      const v2 = await setupV2(mod, tmpRepo(false));
      await expect(v2.before({ tool: "shell", input: { command: "git push" }, sessionID: "s" })).resolves.toBeUndefined();
    });

    it("is silent when the engine exits non-zero", async () => {
      const { bin } = fakeEngine("ultra11y: would block", 3);
      process.env.ULTRA11Y_BIN = bin;
      const mod = await import(`${pluginPath}?t=exit`);
      const v2 = await setupV2(mod, tmpRepo(false));
      await expect(v2.before({ tool: "shell", input: { command: "git push" }, sessionID: "s" })).resolves.toBeUndefined();
    });

    it("is silent when the node it would run the engine with does not exist", async () => {
      const { bin } = fakeEngine("ultra11y: would block");
      process.env.ULTRA11Y_BIN = bin;
      process.env.ULTRA11Y_NODE = join(tmpdir(), "no-such-node-binary");
      try {
        const mod = await import(`${pluginPath}?t=nonode`);
        const v2 = await setupV2(mod, tmpRepo(false));
        await expect(v2.before({ tool: "shell", input: { command: "git push" }, sessionID: "s" })).resolves.toBeUndefined();
      } finally {
        delete process.env.ULTRA11Y_NODE;
      }
    });
  });

  describe("OpenCode 2 — setup(ctx)", () => {
    it("registers the gate on ctx.tool.hook('execute.before') and nothing it does not need", async () => {
      const mod = await import(`${pluginPath}?t=v2reg`);
      const v2 = await setupV2(mod, tmpRepo(false));
      expect(Object.keys(v2.hooks)).toEqual(["execute.before"]);
      expect(v2.transforms).toHaveLength(1);
      expect(typeof v2.cleanup).toBe("function");
    });

    it("blocks a push carrying a blocking finding — V2 names the shell tool `shell`", async () => {
      const d = tmpRepo(true);
      process.env.ULTRA11Y_BIN = engine;
      const mod = await import(`${pluginPath}?t=v2block`);
      const v2 = await setupV2(mod, d);
      await expect(v2.before({ tool: "shell", input: { command: "git commit -m wip" }, sessionID: d })).rejects.toThrow(/review-a11y/);
      // Same session, same findings: the retry lands (rule 2).
      await expect(v2.before({ tool: "shell", input: { command: "git commit -m wip" }, sessionID: d })).resolves.toBeUndefined();
    });

    it("lets a command that publishes nothing through, without spawning the engine", async () => {
      const { bin, count } = fakeEngine("ultra11y: would block");
      process.env.ULTRA11Y_BIN = bin;
      const mod = await import(`${pluginPath}?t=v2ls`);
      const v2 = await setupV2(mod, tmpRepo(true));
      await expect(v2.before({ tool: "shell", input: { command: "ls -la" }, sessionID: "s" })).resolves.toBeUndefined();
      await expect(v2.before({ tool: "read", input: { filePath: "/x" }, sessionID: "s" })).resolves.toBeUndefined();
      await expect(v2.before({ tool: "shell", input: { command: 42 }, sessionID: "s" })).resolves.toBeUndefined();
      await expect(v2.before(undefined)).resolves.toBeUndefined();
      expect(count()).toBe(0);
    });

    it("audits the shell call's workdir when it names one", async () => {
      const d = tmpRepo(true);
      process.env.ULTRA11Y_BIN = engine;
      const mod = await import(`${pluginPath}?t=v2workdir`);
      // The plugin instance sits in a clean repo; the command runs in the dirty one.
      const v2 = await setupV2(mod, tmpRepo(false));
      await expect(v2.before({ tool: "shell", input: { command: "git commit -m wip", workdir: d }, sessionID: d })).rejects.toThrow(/review-a11y/);
    });

    it("honours SKIP_A11Y=1", async () => {
      process.env.ULTRA11Y_BIN = engine;
      const mod = await import(`${pluginPath}?t=v2skip`);
      const v2 = await setupV2(mod, tmpRepo(true));
      process.env.SKIP_A11Y = "1";
      try {
        await expect(v2.before({ tool: "shell", input: { command: "git commit -m wip" }, sessionID: "s" })).resolves.toBeUndefined();
      } finally {
        delete process.env.SKIP_A11Y;
      }
    });

    it("stays silent when NO engine resolves", async () => {
      const d = tmpRepo(true);
      const isolated = mkdtempSync(join(tmpdir(), "u11y-oc-noengine2-"));
      tmps.push(isolated);
      const copied = join(isolated, "ultra11y-plugin.js");
      writeFileSync(copied, readFileSync(pluginPath, "utf8"));
      const savedHome = process.env.HOME;
      const savedBin = process.env.ULTRA11Y_BIN;
      process.env.HOME = isolated;
      delete process.env.ULTRA11Y_BIN;
      try {
        const mod = await import(`${copied}?t=missing2`);
        const v2 = await setupV2(mod, d);
        await expect(v2.before({ tool: "shell", input: { command: "git commit -m wip" }, sessionID: "s" })).resolves.toBeUndefined();
        // And with no skills directory beside it, no skill transform either.
        expect(v2.transforms).toHaveLength(0);
      } finally {
        if (savedHome === undefined) delete process.env.HOME;
        else process.env.HOME = savedHome;
        if (savedBin !== undefined) process.env.ULTRA11Y_BIN = savedBin;
      }
    });

    it("adds the two bundled skills through ctx.skill.transform, replayably", async () => {
      const mod = await import(`${pluginPath}?t=v2skills`);
      const v2 = await setupV2(mod, tmpRepo(false));
      const editor = fakeSkillEditor();
      // Transforms are replayed onto a fresh value on every reload; each replay must give the same answer.
      v2.transforms[0]?.(editor);
      v2.transforms[0]?.(editor);
      const ids = editor.list().map((s) => s.id);
      expect(ids.sort()).toEqual(["review-a11y", "ultra11y"]);
      for (const s of editor.list()) {
        expect(s.name).toBe(s.id);
        expect(s.path).toBe(join(repoRoot, "skills", s.id, "SKILL.md"));
        expect(typeof s.description).toBe("string");
        expect(s.description?.length).toBeGreaterThan(40);
        // The body, not the frontmatter — OpenCode prints the description separately.
        expect(s.content.startsWith("---")).toBe(false);
        expect(s.content).toMatch(/^# /);
      }
    });

    it("leaves a skill of the same id alone — the user's copy wins", async () => {
      const mod = await import(`${pluginPath}?t=v2skillwin`);
      const v2 = await setupV2(mod, tmpRepo(false));
      const editor = fakeSkillEditor([
        { id: "review-a11y", name: "review-a11y", path: "/home/u/.config/opencode/skills/review-a11y/SKILL.md", content: "mine" },
      ]);
      v2.transforms[0]?.(editor);
      expect(editor.get("review-a11y")?.content).toBe("mine");
      expect(editor.get("ultra11y")).toBeTruthy();
    });

    it("a skill registry that throws is swallowed, inside the transform", async () => {
      const mod = await import(`${pluginPath}?t=v2skillthrow`);
      const v2 = await setupV2(mod, tmpRepo(false));
      const hostile = {
        get: () => undefined,
        add: () => {
          throw new Error("rejected");
        },
      };
      expect(() => v2.transforms[0]?.(hostile)).not.toThrow();
    });

    it("never fails setup, whatever ctx looks like", async () => {
      const mod = await import(`${pluginPath}?t=v2ctx`);
      await expect(mod.default.setup(undefined)).resolves.toBeTypeOf("function");
      await expect(mod.default.setup({})).resolves.toBeTypeOf("function");
      const throwing = {
        location: { directory: "/x" },
        tool: {
          hook: async () => {
            throw new Error("no");
          },
        },
        skill: {
          transform: async () => {
            throw new Error("no");
          },
        },
      };
      await expect(mod.default.setup(throwing)).resolves.toBeTypeOf("function");
    });

    it("the cleanup disposes what setup registered, and tolerates a second call", async () => {
      const mod = await import(`${pluginPath}?t=v2cleanup`);
      const v2 = await setupV2(mod, tmpRepo(false));
      await v2.cleanup?.();
      expect(v2.disposed()).toBe(2);
      await expect(v2.cleanup?.()).resolves.toBeUndefined();
      expect(v2.disposed()).toBe(2);
    });
  });
});

/** A stand-in engine: counts its runs, prints `out`, exits with `code`. */
function fakeEngine(out: string, code = 0) {
  const d = mkdtempSync(join(tmpdir(), "u11y-oc-fake-"));
  tmps.push(d);
  const counter = join(d, "count");
  const bin = join(d, "engine.mjs");
  writeFileSync(
    bin,
    `import { appendFileSync, readFileSync } from "node:fs";\nreadFileSync(0);\nappendFileSync(${JSON.stringify(counter)}, "x");\nprocess.stdout.write(${JSON.stringify(out)});\nprocess.exit(${code});\n`,
  );
  return { bin, count: () => (existsSync(counter) ? readFileSync(counter, "utf8").length : 0) };
}

type Skill = { id: string; name: string; description?: string; path: string; content: string };
function fakeSkillEditor(initial: Skill[] = []) {
  const m = new Map(initial.map((s) => [s.id, s]));
  return {
    list: () => [...m.values()],
    get: (id: string) => m.get(id),
    add: (s: Skill) => void m.set(s.id, { ...s }),
    update: () => {},
    remove: (id: string) => void m.delete(id),
  };
}

/** Run the V2 entry point against a fake `ctx` that records every registration. */
async function setupV2(mod: { default: { setup: (ctx: unknown) => Promise<unknown> } }, directory: string) {
  const hooks: Record<string, (event: unknown) => Promise<void>> = {};
  const transforms: Array<(editor: unknown) => void> = [];
  let disposed = 0;
  const registration = () => ({ dispose: async () => void disposed++ });
  const ctx = {
    location: { directory, project: { id: "p", directory } },
    tool: {
      hook: async (name: string, cb: (event: unknown) => Promise<void>) => {
        hooks[name] = cb;
        return registration();
      },
    },
    skill: {
      transform: async (cb: (editor: unknown) => void) => {
        transforms.push(cb);
        return registration();
      },
    },
  };
  const cleanup = (await mod.default.setup(ctx)) as (() => Promise<void>) | undefined;
  return {
    hooks,
    transforms,
    cleanup,
    disposed: () => disposed,
    before: (event: unknown) => (hooks["execute.before"] ?? (async () => {}))(event),
  };
}
