// #149 — a Next.js App Router layout sets the document <title> through the metadata API and
// renders `<html><head>` through a shell component it imports. The shell's title-less <head>
// is not a missing title; a shell no metadata route renders still is.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildAudit, runAudit } from "../src/audit.js";
import { parseSource } from "../src/parse/source.js";
import { parseJsxAst } from "../src/parse/jsx-ast.js";
import { jsxAstToDoc } from "../src/parse/jsx-bridge.js";
import { runRules } from "../src/rules/registry.js";
import { extractGraphNode, type FileGraphNode } from "../src/graph/imports.js";
import { buildGraph, titleSetByImportingRoute } from "../src/graph/graph.js";
import { exportsMetadataTitle, isAppRouteFile } from "../src/rules/next-metadata.js";
import type { AuditResult, Finding } from "../src/types.js";

const FX = "tests/fixtures/next-metadata-layout";
const has = (fs: Finding[], ruleId: string, endsWith: string): boolean => fs.some((f) => f.ruleId === ruleId && f.file.endsWith(endsWith));
const status = (r: AuditResult, sc: string) => r.criteria.find((c) => c.id === sc);
const rulesOn = (file: string) => runRules(parseSource(readFileSync(file, "utf8"), file)).map((f) => f.ruleId);

function node(src: string, file: string): FileGraphNode {
  const ast = parseJsxAst(src)!;
  return extractGraphNode(ast, jsxAstToDoc(ast, src, file), file);
}

describe("the Next.js metadata signal", () => {
  it("recognises metadata / generateMetadata carrying a title", () => {
    expect(exportsMetadataTitle(`export const metadata: Metadata = { title: { default: "A", template: "%s - A" } };`)).toBe(true);
    expect(exportsMetadataTitle(`export async function generateMetadata() { return { title: "A" }; }`)).toBe(true);
    expect(exportsMetadataTitle(`export const generateMetadata = async () => ({ title: "A" });`)).toBe(true);
    expect(exportsMetadataTitle(`export const metadata = { description: "no title here" };`)).toBe(false);
    expect(exportsMetadataTitle(`const title = { title: "not exported metadata" };`)).toBe(false);
  });

  it("knows the App Router route files", () => {
    expect(isAppRouteFile("app/layout.tsx")).toBe(true);
    expect(isAppRouteFile("src/app/(site)/blog/page.jsx")).toBe(true);
    expect(isAppRouteFile("apps/web/app/layout.js")).toBe(true);
    expect(isAppRouteFile("src/RootShell.tsx")).toBe(false);
    expect(isAppRouteFile("app/components/layout-grid.tsx")).toBe(false);
  });

  it("is stored on the graph node, not re-read by the rule", () => {
    expect(node(readFileSync(`${FX}/app/layout.tsx`, "utf8"), "app/layout.tsx").exportsMetadataTitle).toBe(true);
    expect(node(readFileSync(`${FX}/plain/app/layout.tsx`, "utf8"), "plain/app/layout.tsx").exportsMetadataTitle).toBe(false);
  });

  it("the single-file rule alone still raises the shell's title-less <head>", () => {
    expect(rulesOn(`${FX}/src/RootShell.tsx`)).toContain("title-missing-empty");
    expect(rulesOn(`${FX}/dsfr/src/DsfrShell.tsx`)).toContain("title-missing-empty");
  });
});

describe("cross-next-metadata-title (audit --graph)", () => {
  const root = runAudit({ inputs: [`${FX}/app`, `${FX}/src`], dedup: "off", graph: true });
  const dsfr = runAudit({ inputs: [`${FX}/dsfr`], dedup: "off", graph: true });
  const plain = runAudit({ inputs: [`${FX}/plain`], dedup: "off", graph: true });

  it("suppresses title-missing-empty on a shell rendered by a layout exporting metadata.title (the #149 repro)", () => {
    expect(has(root.findings, "title-missing-empty", "src/RootShell.tsx")).toBe(false);
  });

  it("follows generateMetadata through a component and a barrel (layout → index.ts → Providers → DsfrShell)", () => {
    expect(has(dsfr.findings, "title-missing-empty", "DsfrShell.tsx")).toBe(false);
    expect(status(dsfr, "2.4.2")?.status).toBe("C");
  });

  it("keeps the finding on a shell no metadata route renders", () => {
    expect(has(root.findings, "title-missing-empty", "src/LangShell.tsx")).toBe(true);
    expect(status(root, "2.4.2")?.status).toBe("NC");
  });

  it("keeps the finding on a shell rendered by a layout with no metadata title", () => {
    expect(has(plain.findings, "title-missing-empty", "PlainShell.tsx")).toBe(true);
    expect(status(plain, "2.4.2")?.status).toBe("NC");
  });
});

describe("titleSetByImportingRoute", () => {
  const SHELL = `export function Shell({ children }) { return <html lang="fr"><head /><body>{children}</body></html>; }`;
  const LAYOUT_TITLE = `import { Shell } from "../src/Shell";\nexport const metadata = { title: "Site" };\nexport default function L({ children }) { return <Shell>{children}</Shell>; }`;
  const LAYOUT_BARE = (from: string) => `import { Shell } from "${from}";\nexport default function L({ children }) { return <Shell>{children}</Shell>; }`;

  it("needs EVERY importing route to get a metadata title", () => {
    expect(titleSetByImportingRoute(buildGraph([node(SHELL, "src/Shell.tsx"), node(LAYOUT_TITLE, "app/layout.tsx")]), "src/Shell.tsx")).toBe(true);
    const g = buildGraph([node(SHELL, "src/Shell.tsx"), node(LAYOUT_TITLE, "app/layout.tsx"), node(LAYOUT_BARE("../../src/Shell"), "other/app/layout.tsx")]);
    expect(titleSetByImportingRoute(g, "src/Shell.tsx")).toBe(false);
  });

  it("credits a nested layout whose title comes from the root layout's metadata", () => {
    const ROOT = `export const metadata = { title: { default: "Site", template: "%s" } };\nexport default function R({ children }) { return children; }`;
    const g = buildGraph([node(SHELL, "src/Shell.tsx"), node(ROOT, "app/layout.tsx"), node(LAYOUT_BARE("../../src/Shell"), "app/(group)/layout.tsx")]);
    expect(titleSetByImportingRoute(g, "src/Shell.tsx")).toBe(true);
  });

  it("does not credit a shell nothing imports, nor one imported only outside the App Router", () => {
    const STORY = `import { Shell } from "./Shell";\nexport const metadata = { title: "Story" };\nexport default () => <Shell />;`;
    expect(titleSetByImportingRoute(buildGraph([node(SHELL, "src/Shell.tsx")]), "src/Shell.tsx")).toBe(false);
    expect(titleSetByImportingRoute(buildGraph([node(SHELL, "src/Shell.tsx"), node(STORY, "src/Shell.stories.tsx")]), "src/Shell.tsx")).toBe(false);
  });
});

describe("without a graph: a metadata layout in scope holds the shell back from a decisive 2.4.2 failure", () => {
  const root = runAudit({ inputs: [`${FX}/app`, `${FX}/src`], dedup: "off" });

  it("drops the finding and leaves 2.4.2 open (manual + residual risk), never conforming", () => {
    expect(has(root.findings, "title-missing-empty", "src/RootShell.tsx")).toBe(false);
    const c = status(root, "2.4.2");
    expect(c?.status).toBe("manual");
    expect(c?.justification).toMatch(/RootShell\.tsx/);
    expect(c?.justification).toMatch(/app\/layout\.tsx/);
    expect(c?.justification).toMatch(/--graph/);
    expect(root.residualRisks.some((r) => r.criteriaId === "2.4.2")).toBe(true);
  });

  it("buildAudit over the same docs agrees with runAudit", () => {
    const files = [`${FX}/app/layout.tsx`, `${FX}/src/RootShell.tsx`];
    const r = buildAudit(
      files.map((f) => parseSource(readFileSync(f, "utf8"), f)),
      files,
    );
    expect(has(r.findings, "title-missing-empty", "RootShell.tsx")).toBe(false);
    expect(status(r, "2.4.2")?.status).toBe("manual");
  });

  it("still fails 2.4.2 when no metadata layout is in scope", () => {
    const r = runAudit({ inputs: [`${FX}/src`], dedup: "off" });
    expect(has(r.findings, "title-missing-empty", "src/RootShell.tsx")).toBe(true);
    expect(status(r, "2.4.2")?.status).toBe("NC");
  });

  it("still fails 2.4.2 when the scope's layout sets no metadata title", () => {
    const r = runAudit({ inputs: [`${FX}/plain`], dedup: "off" });
    expect(has(r.findings, "title-missing-empty", "PlainShell.tsx")).toBe(true);
    expect(status(r, "2.4.2")?.status).toBe("NC");
  });
});

describe("language attributes bound to an expression (DSFR shells)", () => {
  const root = runAudit({ inputs: [`${FX}/app`, `${FX}/src`], dedup: "off", graph: true });
  const dsfr = runAudit({ inputs: [`${FX}/dsfr`], dedup: "off", graph: true });

  it("never judges lang={lang} an invalid language tag", () => {
    expect(has(root.findings, "lang-invalid", "src/LangShell.tsx")).toBe(false); // <html lang={lang}>
    expect(has(dsfr.findings, "lang-invalid", "DsfrShell.tsx")).toBe(false); // <DsfrProvider lang={lang}> over text
    expect(rulesOn(`${FX}/dsfr/src/DsfrShell.tsx`)).not.toContain("lang-invalid");
  });

  it("raises no missing-language finding on <html {...getHtmlAttributes({ lang })}>", () => {
    for (const id of ["html-lang-missing", "document-language-missing"]) expect(has(dsfr.findings, id, "DsfrShell.tsx")).toBe(false);
  });

  it("still flags an invalid literal tag, in JSX and in plain HTML", () => {
    expect(has(root.findings, "lang-invalid", "src/BrokenLangShell.tsx")).toBe(true);
    const html = parseSource(`<!doctype html><html lang="{lang}"><head><title>T</title></head><body><p>x</p></body></html>`, "page.html");
    expect(runRules(html).map((f) => f.ruleId)).toContain("lang-invalid");
  });

  it("still flags an <html> nothing gives a language to", () => {
    expect(has(root.findings, "document-language-missing", "src/NoLangShell.tsx")).toBe(true);
    expect(rulesOn(`${FX}/src/NoLangShell.tsx`)).toContain("html-lang-missing");
  });
});
