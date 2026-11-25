// The visual snapshot pass (src/render-snapshot.ts) in a REAL Chromium: the render engine's
// captures of the fixture app are opened in the browser, screenshotted and passed through axe,
// with the project's global CSS when the root layout imports one — and the report then shows
// the rendering instead of the JSX.
//
// Browser tier (vitest.browser.config.ts): it skips where no Chromium can be launched, and fails
// under ULTRA11Y_REQUIRE_BROWSER=1 rather than pass silently.
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { runRenderEngine } from "../src/render-engine.js";
import { RENDER_SNAPSHOT_INDEX, readRenderSnapshotIndex, snapshotRenderCaptures } from "../src/render-snapshot.js";
import { unwrapAudit } from "../src/standards/document.js";
import type { AuditResult, RenderManifest, RenderSnapshotIndex } from "../src/types.js";

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
const REACT = resolvable("react") && resolvable("react-dom/server") && resolvable("typescript");

let browserAvailable = false;
beforeAll(async () => {
  try {
    const { chromium } = await import("@playwright/test");
    const b = await chromium.launch();
    await b.close();
    browserAvailable = true;
  } catch {
    /* no browser — every test below returns early */
  }
  if (process.env.ULTRA11Y_REQUIRE_BROWSER === "1" && !browserAvailable) {
    throw new Error("ultra11y: ULTRA11Y_REQUIRE_BROWSER=1 but no Chromium could be launched — the render snapshot tier did not run.");
  }
}, 120_000);

/** A copy of the fixture app; `css` adds a global stylesheet imported by the root layout. */
function copyFixture(css: boolean): string {
  const tmp = mkdtempSync(join(tmpdir(), "u11y-render-snap-"));
  cpSync(FIXTURE, tmp, { recursive: true });
  symlinkSync(resolve("node_modules"), join(tmp, "node_modules"), "dir");
  // A component whose text is faint ONLY under the project's stylesheet.
  writeFileSync(join(tmp, "src/components/Notice.tsx"), 'export function Notice() {\n  return <p className="faint">Texte peu contrasté</p>;\n}\n');
  if (css) {
    writeFileSync(join(tmp, "src/app/globals.css"), "body { background: #ffffff; }\n.faint { color: #c8c8c8; }\n");
    const layout = join(tmp, "src/app/layout.tsx");
    writeFileSync(layout, `import "./globals.css";\n${readFileSync(layout, "utf8")}`);
  }
  return tmp;
}

const unitOf = (idx: RenderSnapshotIndex, file: string) => idx.units.find((u) => u.file === file);

describe.skipIf(!REACT)("render snapshots — the captures opened in Chromium", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it("takes a screenshot and an axe pass per capture, with the project's CSS, and keeps isolation artifacts out", async () => {
    if (!browserAvailable) return;
    const root = copyFixture(true);
    roots.push(root);
    const manifest: RenderManifest = await runRenderEngine({ root, timeoutMs: 1500, transpiler: "typescript", exclude: ["**/Forever.tsx"] });
    const idx = await snapshotRenderCaptures({ root, manifest, warn: () => {} });

    expect(idx.unavailable).toBeUndefined();
    expect(idx.context).toBe("isolated-component");
    expect(idx.styles.status).toBe("project");
    expect(idx.styles.files).toEqual([{ file: "src/app/globals.css", via: "import" }]);
    expect(idx.axe?.version).toMatch(/^\d+\.\d+/);
    expect(idx.units.length).toBe(manifest.units.filter((u) => u.status === "rendered").length);

    // Every rendered unit has its PNG on disk, under the index.
    for (const u of idx.units) {
      expect(u.status, `${u.id}: ${u.error ?? ""}`).toBe("snapshotted");
      expect(existsSync(join(root, u.screenshot as string))).toBe(true);
      expect(
        readFileSync(join(root, u.screenshot as string))
          .subarray(1, 4)
          .toString(),
      ).toBe("PNG");
    }
    // The index on disk is the one returned.
    expect(readRenderSnapshotIndex(join(root, RENDER_SNAPSHOT_INDEX))).toEqual(idx);

    // A component defect axe sees: the icon-only button has no name — counted.
    const icon = unitOf(idx, "src/components/IconButton.tsx");
    expect(icon?.violations.find((v) => v.rule === "button-name")).toMatchObject({ counted: true, criteriaId: "4.1.2" });
    // The stylesheet was applied: the faint text fails contrast, and with the full CSS it counts.
    const notice = unitOf(idx, "src/components/Notice.tsx");
    expect(notice?.violations.find((v) => v.rule === "color-contrast")).toMatchObject({ counted: true, criteriaId: "1.4.3" });
    // Page-level rules are artifacts of the isolation: set aside, never counted.
    const pageLevel = idx.units
      .flatMap((u) => u.violations)
      .filter((v) => v.rule === "region" || v.rule === "landmark-one-main" || v.rule === "page-has-heading-one");
    for (const v of pageLevel) expect(v).toMatchObject({ counted: false, setAside: "page-context" });
  }, 120_000);

  it("without any project CSS, the snapshot says so and contrast is set aside", async () => {
    if (!browserAvailable) return;
    const root = copyFixture(false);
    roots.push(root);
    // Make the faint text faint without a stylesheet: an inline style the server render keeps.
    writeFileSync(
      join(root, "src/components/Notice.tsx"),
      'export function Notice() {\n  return <p style={{ color: "#c8c8c8" }}>Texte peu contrasté</p>;\n}\n',
    );
    const manifest = await runRenderEngine({ root, timeoutMs: 1500, transpiler: "typescript", exclude: ["**/Forever.tsx"] });
    const idx = await snapshotRenderCaptures({ root, manifest, warn: () => {} });
    expect(idx.styles).toMatchObject({ status: "none", files: [] });
    const contrast = unitOf(idx, "src/components/Notice.tsx")?.violations.find((v) => v.rule === "color-contrast");
    expect(contrast).toMatchObject({ counted: false, setAside: "styles" });
  }, 120_000);

  it("`render` → `audit` → `report`: the annex and the HTML composite show the renders, labelled isolated, and no verdict moves", async () => {
    if (!browserAvailable) return;
    const root = copyFixture(true);
    roots.push(root);
    const cwd = process.cwd();
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, "log").mockImplementation((m: unknown) => void out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m: unknown) => void err.push(String(m)));
    try {
      expect(await main(["render", root, "--timeout", "1500", "--transpiler", "typescript", "--exclude", "**/Forever.tsx", "--lang", "fr"])).toBe(0);
      expect(out.join("\n")).toMatch(/Instantanés visuels : \d+ pris, 0 en échec — avec le CSS du projet \(1 feuille\(s\)\)/);

      process.chdir(root);
      expect(await main(["audit", ".", "--out", "audits", "--json"])).toBe(0);
      const audit = unwrapAudit(JSON.parse(readFileSync(join(root, "audits/audit-latest.json"), "utf8"))) as AuditResult;
      const snaps = audit.scope.renders?.snapshots;
      expect(snaps?.context).toBe("isolated-component");
      expect(snaps?.units.every((u) => u.screenshot?.startsWith(".ultra11y/render-snapshots/"))).toBe(true);
      // Evidence only: no finding, no axe coverage comes from an isolated render.
      expect(audit.findings.some((f) => f.ruleId === "axe:color-contrast" || f.ruleId === "axe:button-name")).toBe(false);
      expect(audit.scope.axe ?? []).toEqual([]);
      expect(audit.criteria.find((c) => c.id === "1.4.3")?.status).not.toBe("NC");

      // The same audit without the snapshot index decides exactly the same criteria.
      renameSync(join(root, ".ultra11y/render-snapshots"), join(root, ".ultra11y/render-snapshots.off"));
      expect(await main(["audit", ".", "--out", "audits-plain", "--json"])).toBe(0);
      renameSync(join(root, ".ultra11y/render-snapshots.off"), join(root, ".ultra11y/render-snapshots"));
      const plain = unwrapAudit(JSON.parse(readFileSync(join(root, "audits-plain/audit-latest.json"), "utf8"))) as AuditResult;
      expect(plain.scope.renders?.snapshots).toBeUndefined();
      expect(plain.criteria.map((c) => [c.id, c.status])).toEqual(audit.criteria.map((c) => [c.id, c.status]));
      rmSync(join(root, "audits-plain"), { recursive: true, force: true });

      expect(await main(["report", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--out", "audits"])).toBe(0);
      const annex = readdirSync(join(root, "audits")).find((f) => /annex/.test(f) && f.includes("rgaa")) as string;
      const md = readFileSync(join(root, "audits", annex), "utf8");
      expect(md).toContain("### Rendus visuels des composants (rendu isolé)");
      expect(md).toContain("RENDUS ISOLÉS");
      expect(md).toMatch(/!\[Rendu isolé du composant IconButton \(composant\)\]\(\.\/assets\/components\/src-components-IconButton__IconButton\.png\)/);
      expect(existsSync(join(root, "audits/assets/components/src-components-IconButton__IconButton.png"))).toBe(true);
      // The gate still passes on the deliverable that carries them.
      const report = readdirSync(join(root, "audits")).find((f) => /^rgaa-\d{4}-\d{2}-\d{2}\.md$/.test(f)) as string;
      expect(await main(["check", "--report", `audits/${report}`, "--in", "audits/audit-latest.json", "--standard", "rgaa"])).toBe(0);

      expect(await main(["report", "--in", "audits/audit-latest.json", "--standard", "rgaa", "--lang", "fr", "--html", "--out", "audits-html"])).toBe(0);
      const composite = readdirSync(join(root, "audits-html")).find((f) => /^ultra11y-.*\.html$/.test(f)) as string;
      const html = readFileSync(join(root, "audits-html", composite), "utf8");
      expect(html).toContain('id="component-renders"');
      expect(html).toMatch(/<img src="data:image\/png;base64,[^"]+" alt="Rendu isolé du composant IconButton \(composant\)">/);
    } finally {
      process.chdir(cwd);
      vi.restoreAllMocks();
    }
  }, 180_000);
});
