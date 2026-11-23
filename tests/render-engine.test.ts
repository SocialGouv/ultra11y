// ultra11y's own render engine (src/render-engine.ts): a small React app is rendered by the
// project's react-dom/server in ultra11y's throwaway harness, without any test file being read,
// and the audit then reports the rendered markup against the source components.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { classifyRenderFailure, discoverRenderTargets, nextRoute, runRenderEngine } from "../src/render-engine.js";
import { parseCaptureProvenance } from "../src/capture.js";
import { main } from "../src/cli.js";
import type { AuditResult, RenderManifest, RenderUnit } from "../src/types.js";

const FIXTURE = resolve("tests/fixtures/render-app");
const require = createRequire(import.meta.url);
const resolvable = (spec: string): boolean => {
  try {
    require.resolve(spec);
    return true;
  } catch {
    return false;
  }
};
// React is a devDependency of ultra11y (never a runtime one): the engine renders with the
// PROJECT's copy, and here the fixture's project is this repository.
const REACT = resolvable("react") && resolvable("react-dom/server") && resolvable("typescript");
if (!REACT) console.warn("render-engine.test: react, react-dom or typescript is not resolvable — the rendering tests are skipped (run pnpm install).");

/** A throwaway copy of the fixture app whose node_modules is this repository's. */
function copyFixture(): string {
  const tmp = mkdtempSync(join(tmpdir(), "u11y-render-app-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  symlinkSync(resolve("node_modules"), join(tmp, "node_modules"), "dir");
  return tmp;
}

const unit = (m: RenderManifest, file: string, exp: string): RenderUnit | undefined => m.units.find((u) => u.file === file && u.export === exp);

describe("render engine — discovery", () => {
  it("finds the modules, the pages with their routes, the stories and the SFCs, and leaves every test file out unread", () => {
    const { targets, testFilesIgnored } = discoverRenderTargets(FIXTURE);
    const files = targets.map((t) => t.file);
    expect(files).toContain("src/components/IconButton.tsx");
    expect(targets.find((t) => t.file === "src/app/about/page.tsx")?.route).toBe("/about");
    expect(targets.find((t) => t.file === "src/app/layout.tsx")?.route).toBeUndefined();
    expect(targets.find((t) => t.file === "src/components/Button.stories.tsx")?.kind).toBe("stories");
    expect(targets.find((t) => t.file === "src/components/Card.vue")?.kind).toBe("sfc");
    expect(files.some((f) => /\.test\.|__tests__/.test(f))).toBe(false);
    expect(testFilesIgnored).toBe(2);
    expect(discoverRenderTargets(FIXTURE, { stories: false }).targets.some((t) => t.kind === "stories")).toBe(false);
  });

  it("maps Next.js app/ and pages/ files to their routes", () => {
    expect(nextRoute("app/page.tsx")).toBe("/");
    expect(nextRoute("src/app/(marketing)/pricing/page.tsx")).toBe("/pricing");
    expect(nextRoute("app/blog/[slug]/page.tsx")).toBe("/blog/[slug]");
    expect(nextRoute("app/layout.tsx")).toBeUndefined();
    expect(nextRoute("pages/index.tsx")).toBe("/");
    expect(nextRoute("pages/about/team.jsx")).toBe("/about/team");
    expect(nextRoute("pages/_app.tsx")).toBeUndefined();
    expect(nextRoute("pages/api/hello.tsx")).toBeUndefined();
    expect(nextRoute("src/components/Button.tsx")).toBeUndefined();
  });

  it("classifies a render failure from the error", () => {
    expect(classifyRenderFailure({ name: "ReferenceError", message: "window is not defined" })).toBe("browser-api");
    expect(classifyRenderFailure({ message: "useAuth must be used within an AuthProvider" })).toBe("provider");
    expect(classifyRenderFailure({ message: "invariant expected app router to be mounted" })).toBe("provider");
    expect(classifyRenderFailure({ name: "TypeError", message: "Cannot read properties of undefined (reading 'map')" })).toBe("props");
    expect(classifyRenderFailure({ message: "ultra11y render: network access is disabled while rendering (fetch)" })).toBe("data");
    expect(classifyRenderFailure({ code: "MODULE_NOT_FOUND", message: "Cannot find module '@acme/ui'" })).toBe("module");
    expect(classifyRenderFailure({ ultra11y: "transpile", message: "x" })).toBe("transpile");
    expect(classifyRenderFailure({ message: "boom" })).toBe("error");
  });
});

describe.skipIf(!REACT)("render engine — rendering the fixture app", () => {
  let root: string;
  let manifest: RenderManifest;
  beforeAll(async () => {
    root = copyFixture();
    manifest = await runRenderEngine({ root, timeoutMs: 1500, transpiler: "typescript" });
  }, 60_000);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("renders with the project's own react-dom/server and transpiler", () => {
    expect(manifest.renderer).toMatch(/^react-dom\/server \d/);
    expect(manifest.transpiler).toMatch(/^typescript \d/);
    expect(manifest.testFilesIgnored).toBe(2);
  });

  it("writes a capture per rendered unit, with the provenance header", () => {
    const icon = unit(manifest, "src/components/IconButton.tsx", "IconButton");
    expect(icon?.status).toBe("rendered");
    const html = readFileSync(join(root, icon?.capture as string), "utf8");
    expect(html).toContain('<button type="button" class="icon-btn"><svg aria-hidden="true"');
    const prov = parseCaptureProvenance(html);
    expect(prov).toMatchObject({ sourceFile: "src/components/IconButton.tsx", component: "IconButton", styles: "none" });
    expect(prov?.renderer).toMatch(/^react-dom\/server /);
    // The default export, its CSS module and its image import resolve through the harness.
    const logo = unit(manifest, "src/components/Logo.tsx", "default");
    expect(logo?.status).toBe("rendered");
    expect(readFileSync(join(root, logo?.capture as string), "utf8")).toMatch(/<img class="logo" src="\/src\/components\/logo\.png"/);
    // A page through the tsconfig "@/" alias, labelled with its route.
    const about = unit(manifest, "src/app/about/page.tsx", "default");
    expect(about).toMatchObject({ kind: "page", route: "/about", status: "rendered" });
    expect(readFileSync(join(root, about?.capture as string), "utf8")).toContain("<h1>About</h1>");
  });

  it("renders the stories with their args, and leaves the component they show to them", () => {
    const primary = unit(manifest, "src/components/Button.stories.tsx", "Primary");
    expect(primary).toMatchObject({ kind: "story", status: "rendered", component: "Button" });
    const html = readFileSync(join(root, primary?.capture as string), "utf8");
    expect(html).toContain('<button type="button">Save</button>');
    expect(parseCaptureProvenance(html)?.sourceFile).toBe("src/components/Button.tsx");
    expect(unit(manifest, "src/components/Button.tsx", "Button")).toMatchObject({ status: "not-attempted", reason: "via-story" });
  });

  it("records every failure with its reason, never drops one", () => {
    expect(unit(manifest, "src/components/ThemedCard.tsx", "ThemedCard")).toMatchObject({ status: "skipped", reason: "provider" });
    expect(unit(manifest, "src/components/WindowWidth.tsx", "WindowWidth")).toMatchObject({ status: "skipped", reason: "browser-api" });
    expect(unit(manifest, "src/components/Forever.tsx", "Forever")).toMatchObject({ status: "skipped", reason: "timeout" });
    expect(unit(manifest, "src/components/Broken.tsx", "*")).toMatchObject({ status: "skipped", reason: "transpile" });
    expect(unit(manifest, "src/app/dashboard/page.tsx", "default")).toMatchObject({ status: "skipped", reason: "data", route: "/dashboard" });
    expect(unit(manifest, "src/components/Greeting.tsx", "Greeting")).toMatchObject({ status: "not-attempted", reason: "props" });
    expect(unit(manifest, "src/app/layout.tsx", "default")).toMatchObject({ status: "not-attempted", reason: "props" });
    expect(unit(manifest, "src/components/Card.vue", "*")).toMatchObject({ status: "not-attempted", reason: "unsupported-renderer" });
    // The manifest on disk is the one returned.
    expect(JSON.parse(readFileSync(join(root, ".ultra11y/render.json"), "utf8"))).toEqual(manifest);
  });

  it("never reads a test file: no unit, no capture comes from one", () => {
    expect(manifest.units.some((u) => /\.test\.|__tests__/.test(u.file))).toBe(false);
    for (const f of readdirSync(join(root, ".ultra11y/captures")))
      expect(readFileSync(join(root, ".ultra11y/captures", f), "utf8")).not.toMatch(/broken-on-purpose|also-broken/);
  });

  it("is byte-stable on a re-run and removes the captures of units it no longer renders", async () => {
    const before = readFileSync(join(root, ".ultra11y/render.json"), "utf8");
    const again = await runRenderEngine({ root, timeoutMs: 1500, transpiler: "typescript", exclude: ["**/Forever.tsx"] });
    expect(again.units.some((u) => u.file.endsWith("Forever.tsx"))).toBe(false);
    const third = await runRenderEngine({ root, timeoutMs: 1500, transpiler: "typescript", exclude: ["**/Forever.tsx", "**/IconButton.tsx"] });
    expect(existsSync(join(root, ".ultra11y/captures/src-components-IconButton__IconButton.html"))).toBe(false);
    expect(third.units.some((u) => u.file === "src/components/IconButton.tsx")).toBe(false);
    expect(before).toContain('"testFilesIgnored": 2');
  }, 60_000);
});

describe.skipIf(!REACT)("render engine — the CLI, then audit and report", () => {
  let root: string;
  const cwd = process.cwd();
  beforeAll(() => {
    root = copyFixture();
  });
  afterAll(() => {
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  });

  it("`render <dir>` renders, `audit` reports the findings against the source components, the annex lists every unit", async () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await main(["render", root, "--timeout", "1500", "--transpiler", "typescript", "--exclude", "**/Forever.tsx", "--json"])).toBe(0);
      const manifest = JSON.parse(out.join("\n")) as RenderManifest;
      expect(manifest.units.filter((u) => u.status === "rendered").length).toBeGreaterThanOrEqual(5);

      process.chdir(root);
      out.length = 0;
      expect(await main(["audit", ".", "--out", "audits", "--json"])).toBe(0);
      const audit = JSON.parse(readFileSync(join(root, "audits/audit-latest.json"), "utf8")) as AuditResult;
      const fromCaptures = audit.findings.filter((f) => f.origin?.capture);
      const icon = fromCaptures.find((f) => f.origin?.capture.endsWith("src-components-IconButton__IconButton.html"));
      expect(icon?.origin).toMatchObject({ sourceFile: "src/components/IconButton.tsx", component: "IconButton" });
      expect(fromCaptures.some((f) => f.ruleId === "img-alt-missing" && f.origin?.sourceFile === "src/components/Logo.tsx")).toBe(true);
      // The test files' deliberately broken markup produced nothing.
      expect(audit.findings.some((f) => /\.test\.|__tests__/.test(`${f.file} ${f.origin?.sourceFile ?? ""}`))).toBe(false);
      expect(audit.scope.renders).toMatchObject({ manifest: ".ultra11y/render.json", rendered: manifest.units.filter((u) => u.status === "rendered").length });

      expect(await main(["report", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "audits"])).toBe(0);
      const annex = readdirSync(join(root, "audits")).find((f) => /annex/.test(f) && f.includes("rgaa"));
      const md = readFileSync(join(root, "audits", annex as string), "utf8");
      expect(md).toContain("## G. Composants rendus par le moteur ultra11y");
      expect(md).toMatch(/\| ThemedCard \| `src\/components\/ThemedCard\.tsx` \| composant \| échec \| fournisseur de contexte manquant/);
      expect(md).toMatch(/\| AboutPage \(`\/about`\) \| `src\/app\/about\/page\.tsx` \| page \| rendue \|/);
    } finally {
      process.chdir(cwd);
      vi.restoreAllMocks();
    }
  }, 90_000);

  it("`render --scaffold`, `render --setup` and `capture write` fail with a pointer to the engine", async () => {
    const err: string[] = [];
    vi.spyOn(console, "error").mockImplementation((m: unknown) => void err.push(String(m)));
    try {
      expect(await main(["render", root, "--setup"])).toBe(2);
      expect(await main(["render", root, "--scaffold"])).toBe(2);
      expect(await main(["capture", "write"])).toBe(2);
      expect(err).toHaveLength(3);
      for (const e of err) expect(e).toMatch(/ultra11y render \[<dir>\]/);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

// The esbuild path, when this checkout has one to hand in (tsup ships it).
const ESBUILD = (() => {
  try {
    const path = createRequire(require.resolve("tsup")).resolve("esbuild");
    return { name: "esbuild", version: "?", path };
  } catch {
    return undefined;
  }
})();

describe.skipIf(!REACT || !ESBUILD)("render engine — esbuild transpiler", () => {
  it("renders the same units through esbuild", async () => {
    const root = copyFixture();
    try {
      const m = await runRenderEngine({ root, timeoutMs: 1500, transpiler: ESBUILD, exclude: ["**/Forever.tsx"] });
      expect(unit(m, "src/components/IconButton.tsx", "IconButton")?.status).toBe("rendered");
      expect(unit(m, "src/app/about/page.tsx", "default")?.status).toBe("rendered");
      expect(unit(m, "src/components/Broken.tsx", "*")).toMatchObject({ reason: "transpile" });
      expect(unit(m, "src/components/Broken.tsx", "*")?.detail).toMatch(/Broken\.tsx: .*\(line \d+\)/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
