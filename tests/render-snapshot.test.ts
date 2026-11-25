// The visual snapshot pass (src/render-snapshot.ts) and its report views
// (src/render-snapshot-report.ts), without a browser: CSS detection, the isolation filter, the
// document a capture is opened as, the graceful degradation, and what the reader is shown.
// The pass itself, in a real Chromium, is tests/render-snapshot.e2e.test.ts (browser tier).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderHtmlDocument } from "../src/html.js";
import { compositeDoc } from "../src/html-report.js";
import {
  RENDER_SNAPSHOT_INDEX,
  findProjectStyles,
  readRenderSnapshotIndex,
  setAsideReason,
  snapshotDocument,
  snapshotRenderCaptures,
  snapshotViolations,
} from "../src/render-snapshot.js";
import { renderSnapshotAnnex, renderSnapshotBlocks } from "../src/render-snapshot-report.js";
import type { AuditResult, RenderManifest, RenderSnapshotIndex } from "../src/types.js";
import { runAudit } from "../src/audit.js";

const tmps: string[] = [];
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-render-snap-unit-"));
  tmps.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe("render snapshots — finding the project's CSS", () => {
  it("loads the plain stylesheets the root layout imports, through relative paths, aliases and packages, never CSS modules", () => {
    const root = project({
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } } }),
      "src/app/layout.tsx": [
        'import "./globals.css";',
        'import "@/styles/theme.css";',
        'import "@gouvfr/dsfr/dist/dsfr.min.css";',
        'import styles from "./layout.module.css";',
        "export default function L({ children }) { return children; }",
      ].join("\n"),
      "src/app/globals.css": "body { color: #111; }",
      "src/app/layout.module.css": ".x { color: red; }",
      "src/styles/theme.css": ":root { --c: #000; }",
      "node_modules/@gouvfr/dsfr/package.json": JSON.stringify({ name: "@gouvfr/dsfr", version: "1.0.0" }),
      "node_modules/@gouvfr/dsfr/dist/dsfr.min.css": ".fr-btn { color: #fff; }",
    });
    const { styles, paths } = findProjectStyles(root);
    expect(styles.status).toBe("project");
    expect(styles.files.map((f) => f.file)).toEqual(["src/app/globals.css", "src/styles/theme.css", "node_modules/@gouvfr/dsfr/dist/dsfr.min.css"]);
    expect(styles.files.every((f) => f.via === "import")).toBe(true);
    expect(styles.skipped).toEqual([]);
    expect(paths).toHaveLength(3);
  });

  it("never loads an uncompiled Tailwind or Sass source; a build's compiled CSS stands in for it, else there is no CSS", () => {
    const files = {
      "app/layout.tsx": 'import "./globals.css";\nimport "./extra.scss";\nexport default function L() { return null; }',
      "app/globals.css": "@tailwind base;\n@tailwind components;",
      "app/extra.scss": "$c: red;",
    };
    const bare = findProjectStyles(project(files));
    expect(bare.styles.status).toBe("none");
    expect(bare.styles.skipped).toEqual([
      { file: "app/globals.css", reason: "tailwind-source" },
      { file: "app/extra.scss", reason: "preprocessor" },
    ]);
    const built = findProjectStyles(project({ ...files, ".next/static/css/abc123.css": ".p-4{padding:1rem}" }));
    expect(built.styles.status).toBe("project");
    expect(built.styles.files).toEqual([{ file: ".next/static/css/abc123.css", via: "build" }]);
  });

  it("is partial when an import cannot be resolved, and follows a stylesheet linked from _document into public/", () => {
    const root = project({
      "pages/_app.tsx": 'import "../styles/missing.css";\nexport default function App() { return null; }',
      "pages/_document.tsx": '<link rel="stylesheet" href="/css/site.css" />\n<link rel="stylesheet" href="https://cdn.example/x.css" />',
      "public/css/site.css": "body { background: #fff; }",
    });
    const { styles } = findProjectStyles(root);
    expect(styles.status).toBe("partial");
    expect(styles.files).toEqual([{ file: "public/css/site.css", via: "link" }]);
    expect(styles.skipped).toEqual([{ file: "../styles/missing.css", reason: "unresolved" }]);
  });

  it("finds nothing — and says so — in a project with no global stylesheet", () => {
    expect(findProjectStyles(project({ "src/components/A.tsx": "export const A = () => null;" })).styles).toEqual({ status: "none", files: [], skipped: [] });
  });
});

describe("render snapshots — what an isolated render may report", () => {
  it("sets page-level rules aside always, and style-dependent rules unless the full CSS was loaded", () => {
    expect(setAsideReason("region", "project")).toBe("page-context");
    expect(setAsideReason("landmark-one-main", "project")).toBe("page-context");
    expect(setAsideReason("color-contrast", "project")).toBeUndefined();
    expect(setAsideReason("color-contrast", "partial")).toBe("styles");
    expect(setAsideReason("color-contrast", "none")).toBe("styles");
    expect(setAsideReason("button-name", "none")).toBeUndefined();
  });

  it("maps axe's violations to criteria, counted first", () => {
    const v = snapshotViolations(
      [
        {
          id: "region",
          impact: "moderate",
          help: "All page content should be contained by landmarks",
          tags: ["best-practice"],
          nodes: [{ target: ["p"], html: "<p>x</p>" }],
        },
        {
          id: "button-name",
          impact: "critical",
          help: "Buttons must have discernible text",
          tags: ["wcag2a", "wcag412"],
          nodes: [{ target: [".icon-btn"], html: "<button>" }],
        },
        {
          id: "color-contrast",
          impact: "serious",
          help: "Contrast",
          tags: ["wcag2aa", "wcag143"],
          nodes: [{ target: ["p"], html: "<p>" }, { target: ["span"] }],
        },
      ],
      "none",
    );
    expect(v.map((x) => [x.rule, x.counted, x.setAside])).toEqual([
      ["button-name", true, undefined],
      ["color-contrast", false, "styles"],
      ["region", false, "page-context"],
    ]);
    expect(v[0]).toMatchObject({ criteriaId: "4.1.2", target: ".icon-btn", nodes: 1 });
    expect(v[1]).toMatchObject({ criteriaId: "1.4.3", nodes: 2 });
    expect(v[2]?.advisory).toBe(true);
  });

  it("opens a fragment in a wrapping document, and a full document with the stylesheets injected in its head", () => {
    const frag = snapshotDocument('<!-- ultra11y-capture {"v":1} -->\n<button>Ok</button>\n', ["/__u11y/fs/a.css"], "Ok");
    expect(frag).toMatch(
      /^<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Ok<\/title><link rel="stylesheet" href="\/__u11y\/fs\/a.css"><\/head><body><button>Ok<\/button>/,
    );
    expect(frag).not.toContain("ultra11y-capture");
    const doc = snapshotDocument('<html lang="en"><head><title>T</title></head><body><header>h</header></body></html>', ["/x.css"], "T");
    expect(doc).toBe('<html lang="en"><head><link rel="stylesheet" href="/x.css"><title>T</title></head><body><header>h</header></body></html>');
  });
});

const MANIFEST: RenderManifest = {
  v: 1,
  testFilesIgnored: 0,
  units: [
    {
      id: "src-Icon__Icon",
      file: "src/Icon.tsx",
      export: "Icon",
      component: "Icon",
      kind: "component",
      status: "rendered",
      capture: ".ultra11y/captures/src-Icon__Icon.html",
    },
  ],
};

describe("render snapshots — without a browser", () => {
  it("never throws: it writes an index that says why, and the static captures stand", async () => {
    const root = project({ ".ultra11y/captures/src-Icon__Icon.html": "<button></button>" });
    const idx = await snapshotRenderCaptures({ root, manifest: MANIFEST, browserPath: join(root, "no-such-browser"), warn: () => {} });
    expect(idx.unavailable).toMatch(/no browser binary at/);
    expect(idx.units).toEqual([]);
    expect(readRenderSnapshotIndex(join(root, RENDER_SNAPSHOT_INDEX))).toEqual(idx);
    expect(existsSync(join(root, ".ultra11y/captures/src-Icon__Icon.html"))).toBe(true);
  });
});

function indexWith(root: string, styles: RenderSnapshotIndex["styles"]["status"]): RenderSnapshotIndex {
  mkdirSync(join(root, "shots"), { recursive: true });
  writeFileSync(join(root, "shots/src-Icon__Icon.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  return {
    v: 1,
    context: "isolated-component",
    date: "2026-11-25",
    browser: "chromium 151",
    styles: { status: styles, files: styles === "none" ? [] : [{ file: "src/app/globals.css", via: "import" }], skipped: [] },
    units: [
      {
        id: "src-Icon__Icon",
        file: "src/Icon.tsx",
        export: "Icon",
        component: "Icon",
        kind: "component",
        capture: ".ultra11y/captures/src-Icon__Icon.html",
        status: "snapshotted",
        screenshot: join(root, "shots/src-Icon__Icon.png"),
        violations: [
          { rule: "button-name", criteriaId: "4.1.2", impact: "critical", help: "Buttons must have discernible text", nodes: 1, counted: true },
          { rule: "region", criteriaId: "4.1.2", help: "Landmarks", nodes: 1, counted: false, setAside: "page-context", advisory: true },
        ],
      },
      { id: "src-B__B", file: "src/B.tsx", export: "B", component: "B", kind: "component", capture: "x", status: "failed", error: "net::ERR", violations: [] },
    ],
  };
}

describe("render snapshots — what the report shows", () => {
  it("the annex: framed as isolated renders, labelled when without CSS, the PNG copied beside the report", () => {
    const root = project({});
    const out = join(root, "audits");
    const md = renderSnapshotAnnex(indexWith(root, "none"), "fr", out).join("\n");
    expect(md).toContain("### Rendus visuels des composants (rendu isolé)");
    expect(md).toContain("aucune de ces observations ne fonde un verdict");
    expect(md).toContain("Styles : AUCUN");
    expect(md).toContain("![Rendu isolé du composant Icon (composant), sans le CSS du projet](./assets/components/src-Icon__Icon.png)");
    expect(md).toContain("_Rendu isolé, SANS le CSS du projet (styles par défaut du navigateur)_");
    expect(md).toContain("- Buttons must have discernible text (axe : button-name, critical) — 1 nœud(s)");
    expect(md).toContain("_1 écartée(s) car propre(s) à une page entière");
    expect(md).toContain("_Instantané en échec : net::ERR_");
    expect(existsSync(join(out, "assets/components/src-Icon__Icon.png"))).toBe(true);
    // Worklist-inert and criterion-free: no checkbox, no criterion number.
    expect(md).not.toMatch(/- \[[ x]\]/);
    expect(md).not.toMatch(/4\.1\.2/);
  });

  it("the annex: says when no browser was available", () => {
    const md = renderSnapshotAnnex(
      { v: 1, context: "isolated-component", date: "d", unavailable: "no Chromium", styles: { status: "none", files: [], skipped: [] }, units: [] },
      "en",
    ).join("\n");
    expect(md).toContain("Visual snapshots not taken: no browser available (no Chromium)");
  });

  it("the HTML composite: a section with the picture, only when the audit carries snapshots", () => {
    const root = project({ "a.html": '<html lang="fr"><head><title>A</title></head><body><main><h1>A</h1></main></body></html>' });
    const audit: AuditResult = runAudit({ inputs: [join(root, "a.html")] });
    expect(renderSnapshotBlocks(audit, "fr", () => undefined)).toEqual([]);
    audit.scope.renders = {
      manifest: ".ultra11y/render.json",
      rendered: 1,
      skipped: 0,
      notAttempted: 0,
      units: MANIFEST.units,
      snapshots: indexWith(root, "project"),
    };
    const html = renderHtmlDocument(
      compositeDoc(audit, { lang: "fr", componentShots: (u) => (u.id === "src-Icon__Icon" ? "data:image/png;base64,AAAA" : undefined) }),
    );
    expect(html).toContain('<h2 id="component-renders">Composants rendus — instantanés visuels</h2>');
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="Rendu isolé du composant Icon (composant)">');
    expect(html).toContain("Styles : le CSS global du projet (1 feuille(s) chargée(s)).");
    expect(readFileSync(join(root, "shots/src-Icon__Icon.png")).length).toBeGreaterThan(0);
  });
});
