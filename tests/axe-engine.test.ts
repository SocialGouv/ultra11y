// The axe run ultra11y controls (src/axe-engine.ts): one axe-core build and one rule set for
// `scan` and `ultra11y/playwright`, ultra11y's own copy first, the project's only as a visible
// fallback. Unit-level: no browser — AxeBuilder is faked where a page would be needed.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AXE_CORE_PIN, AXE_TAGS, type AxeEngine, resolveAxeEngine, runAxe, unionAxeEngines } from "../src/axe-engine.js";
import { resolveIntegrationAxe } from "../src/integrations/playwright.js";
import { resolveLocalDeps } from "../src/scan-local.js";

const REPO = join(import.meta.dirname, "..");
const pinned = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { dependencies: Record<string, string> }).dependencies["axe-core"];
const installed = (createRequire(join(REPO, "package.json"))("axe-core/package.json") as { version: string }).version;

/** A project carrying its OWN @axe-core/playwright and axe-core — by default at a version
 *  ultra11y never pins. `name` "ultra11y" fakes ultra11y's own package instead. */
function projectWithItsOwnAxe(axeVersion = "9.9.9-project", name = "p"): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-axe-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  const mods: [string, string, string][] = [
    ["@axe-core/playwright", "index.js", "module.exports = class ProjectAxeBuilder {};"],
    ["axe-core", "axe.min.js", "/* the project's axe */"],
  ];
  for (const [name, main, body] of mods) {
    const dir = join(root, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: axeVersion, main }));
    writeFileSync(join(dir, main), body);
  }
  return root;
}

/** An anchor nothing resolves from: the standalone bundle with no node_modules beside it. */
function bareAnchor(): string {
  return join(mkdtempSync(join(tmpdir(), "u11y-bare-")), "ultra11y.mjs");
}

/** Run `fn` without `NODE_PATH`. `pnpm run` points it at the store's hoisted `node_modules`,
 *  which would make a bare anchor resolve everything — the opposite of the bundle we simulate. */
function withoutNodePath<T>(fn: () => T): T {
  const saved = process.env.NODE_PATH;
  const M = Module as unknown as { _initPaths(): void };
  delete process.env.NODE_PATH;
  M._initPaths();
  try {
    return fn();
  } finally {
    if (saved !== undefined) process.env.NODE_PATH = saved;
    M._initPaths();
  }
}

describe("the pinned axe-core", () => {
  it("is an exact dependency of ultra11y, and the one installed", () => {
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
    expect(installed).toBe(pinned);
  });

  it("is ultra11y's own copy even when the audited project ships another", () => {
    const e = resolveAxeEngine({ cwd: projectWithItsOwnAxe() });
    expect(e.origin).toBe("ultra11y");
    expect(e.version).toBe(pinned);
    expect(e.sourcePath).toMatch(/axe-core[\\/]axe\.min\.js$/);
    expect(e.source.length).toBeGreaterThan(100_000);
    expect(e.note).toBeUndefined();
  });

  it("falls back on the project's copy only when ultra11y's does not resolve — and says so", () => {
    const e = withoutNodePath(() => resolveAxeEngine({ cwd: projectWithItsOwnAxe(), self: bareAnchor() }));
    expect(e.origin).toBe("project");
    expect(e.version).toBe("9.9.9-project");
    expect(e.note).toMatch(/audited project's axe-core 9\.9\.9-project/);
  });

  it("bakes the pinned version into the source, in lockstep with package.json", () => {
    expect(AXE_CORE_PIN).toBe(pinned);
  });

  it("the skill bundle inside a project's skills dir runs the PROJECT's axe — and says so, even at the pinned version", () => {
    // `.codex/skills/ultra11y/scripts/ultra11y.mjs`: resolving from the bundle walks up to the
    // project's node_modules. Same version as the pin or not, that copy is not ultra11y's.
    for (const dir of [".codex", ".opencode"]) {
      for (const version of [AXE_CORE_PIN, "4.10.0"]) {
        const project = projectWithItsOwnAxe(version);
        const self = join(project, dir, "skills", "ultra11y", "scripts", "ultra11y.mjs");
        const e = withoutNodePath(() => resolveAxeEngine({ cwd: project, self }));
        expect(e.origin).toBe("project");
        expect(e.version).toBe(version);
        expect(e.note).toContain(`audited project's axe-core ${version}`);
      }
    }
  });

  it("ultra11y's own package at the pinned version is the pinned copy; at another version it is not", () => {
    const own = projectWithItsOwnAxe(AXE_CORE_PIN, "ultra11y");
    const atPin = withoutNodePath(() => resolveAxeEngine({ cwd: projectWithItsOwnAxe(), self: join(own, "dist", "playwright.mjs") }));
    expect(atPin).toMatchObject({ origin: "ultra11y", version: AXE_CORE_PIN });
    expect(atPin.note).toBeUndefined();

    const drifted = projectWithItsOwnAxe("4.10.0", "ultra11y");
    const off = withoutNodePath(() => resolveAxeEngine({ cwd: projectWithItsOwnAxe(), self: join(drifted, "dist", "playwright.mjs") }));
    expect(off).toMatchObject({ origin: "unpinned", version: "4.10.0" });
    expect(off.note).toContain(`is 4.10.0, not the pinned ${AXE_CORE_PIN}`);
  });

  it("throws when neither resolves, rather than running nothing silently", () => {
    const empty = mkdtempSync(join(tmpdir(), "u11y-none-"));
    writeFileSync(join(empty, "package.json"), "{}");
    expect(() => withoutNodePath(() => resolveAxeEngine({ cwd: empty, self: bareAnchor() }))).toThrow(/resolves neither/);
  });
});

describe("scan and ultra11y/playwright run the SAME axe", () => {
  it("resolve the same build, from the same file, whatever the project installs", () => {
    const cwd = projectWithItsOwnAxe();
    const scan = resolveLocalDeps(cwd).axe;
    const pw = resolveIntegrationAxe(cwd);
    expect(scan.origin).toBe("ultra11y");
    expect(pw.origin).toBe("ultra11y");
    expect(pw.version).toBe(scan.version);
    expect(pw.sourcePath).toBe(scan.sourcePath);
  });

  it("inject the pinned source with the pinned tags, and record the version that ran", async () => {
    const calls: { axeSource?: string; tags?: string[] }[] = [];
    class FakeBuilder {
      private call: { axeSource?: string; tags?: string[] };
      constructor(opts: { page: unknown; axeSource?: string }) {
        this.call = { axeSource: opts.axeSource };
        calls.push(this.call);
      }
      withTags(tags: string[]) {
        this.call.tags = tags;
        return this;
      }
      async analyze() {
        return { violations: [{ id: "color-contrast" }], testEngine: { name: "axe-core", version: "4.13.0" } };
      }
    }
    const engine: AxeEngine = { AxeBuilder: FakeBuilder, source: "/* pinned */", sourcePath: "/x/axe.min.js", version: "4.13.0", origin: "ultra11y" };
    const scanRun = await runAxe(engine, {}, "scan");
    const pwRun = await runAxe(engine, {}, "playwright");
    expect(calls.map((c) => c.axeSource)).toEqual(["/* pinned */", "/* pinned */"]);
    expect(calls.map((c) => c.tags)).toEqual([[...AXE_TAGS], [...AXE_TAGS]]);
    expect(scanRun.engine).toEqual({ version: "4.13.0", origin: "ultra11y", runner: "scan" });
    expect(pwRun.engine).toEqual({ version: "4.13.0", origin: "ultra11y", runner: "playwright" });
    expect(scanRun.violations).toHaveLength(1);
  });

  it("covers the rule AXE_DECIDES relies on", () => {
    // color-contrast is tagged wcag2aa; a tag set without it would leave 1.4.3 unmeasured.
    expect(AXE_TAGS).toContain("wcag2aa");
  });
});

describe("unionAxeEngines", () => {
  it("keeps one entry per version and origin, with every tier that ran it", () => {
    expect(
      unionAxeEngines(
        [{ version: "4.13.0", origin: "ultra11y", runner: "scan" }],
        [
          { version: "4.13.0", origin: "ultra11y", runner: "playwright" },
          { version: "4.10.0", origin: "project", runner: "playwright" },
        ],
      ),
    ).toEqual([
      { version: "4.10.0", origin: "project", runner: "playwright" },
      { version: "4.13.0", origin: "ultra11y", runner: "playwright,scan" },
    ]);
  });
});
