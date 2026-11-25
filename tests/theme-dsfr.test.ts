// The opt-in DSFR theme (#212). ultra11y never ships the DSFR: `--theme dsfr` reads the
// stylesheet from the AUDITED PROJECT's own `node_modules/@gouvfr/dsfr`. These tests build a
// tiny FAKE package in a temp project (a package.json and a dist/dsfr.min.css holding a marker
// rule) — no real DSFR file is vendored here, for the same licensing reason.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { main } from "../src/cli.js";
import { renderHtmlDocument, type Doc } from "../src/html.js";
import { compositeDoc, indexDoc, pageDoc } from "../src/html-report.js";
import { externalReferences, writeHtml } from "../src/html-emit.js";
import { derivePages, pagesOf } from "../src/pages.js";
import { findingsForStandard } from "../src/standards/derive.js";
import type { StandardId } from "../src/standards/index.js";
import { DsfrUnavailableError, loadDsfrTheme, NEUTRAL_THEME, resolveDsfrDir } from "../src/theme.js";
import type { AuditResult, Lang } from "../src/types.js";

const MARKER = ".u11y-test-marker{color:#000091}";
const PRINT_MARKER = ".u11y-test-print-marker{color:#000}";
const SERVE_AUDITS = join(import.meta.dirname, "fixtures", "serve", "audits");

const BAD = `<!doctype html><html><head></head><body>
<div><img src="x.png"></div>
<a href="/a"></a>
<table><tr><td>1</td><td>2</td></tr></table>
<input type="text">
<h3>Skipped</h3>
</body></html>`;

const auditOf = (html: string): AuditResult => runAudit({ inputs: ["-"], stdin: html });

const withPages = (): AuditResult => {
  const r = auditOf(BAD);
  r.scope.pages = [{ id: "accueil", name: "Accueil", url: "https://exemple.fr/", basis: "snapshot" }];
  r.scope.pagesAudited = ["accueil"];
  for (const f of r.findings) f.page = "accueil";
  return r;
};

/** A project with a fake `@gouvfr/dsfr` installed, the way npm lays it out. */
function fakeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ultra11y-dsfr-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "site-gouv-fr", private: true }));
  const pkg = join(root, "node_modules", "@gouvfr", "dsfr");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@gouvfr/dsfr", version: "0.0.0-test", license: "etalab-2.0" }));
  writeFileSync(join(pkg, "dist", "dsfr.min.css"), MARKER);
  writeFileSync(join(pkg, "dist", "dsfr.print.min.css"), PRINT_MARKER);
  return root;
}

function bareProject(): string {
  const root = mkdtempSync(join(tmpdir(), "ultra11y-nodsfr-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "site", private: true }));
  return root;
}

/** Captures stderr for one CLI run. */
async function run(args: string[]): Promise<{ code: number; err: string }> {
  const lines: string[] = [];
  const spyErr = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
  const spyLog = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const code = await main(args);
    return { code, err: lines.join("\n") };
  } finally {
    spyErr.mockRestore();
    spyLog.mockRestore();
  }
}

const htmlFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".html"))
    .map((f) => join(dir, f));

let project: string;
let bare: string;
beforeAll(() => {
  project = fakeProject();
  bare = bareProject();
});
afterAll(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(bare, { recursive: true, force: true });
});

describe("the neutral theme stays the default", () => {
  it("renders the same page with no theme as with the neutral one, and no DSFR class", () => {
    const doc = compositeDoc(withPages(), { lang: "fr" });
    const html = renderHtmlDocument(doc);
    expect(html).toBe(renderHtmlDocument(doc, NEUTRAL_THEME));
    expect(html).toContain('<a class="skip" href="#content">');
    expect(html).toContain('<div class="tw">');
    expect(html).not.toMatch(/class="fr-/);
    expect(html).not.toContain(MARKER);
  });

  it("writeHtml without a theme writes the neutral look", () => {
    const out = mkdtempSync(join(tmpdir(), "ultra11y-neutral-"));
    try {
      const r = writeHtml(withPages(), { outDir: out, lang: "fr", pages: true });
      for (const f of [r.index, r.composite!, ...r.sheets]) expect(readFileSync(f, "utf8")).not.toMatch(/class="fr-/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("loading the project's DSFR", () => {
  it("resolves @gouvfr/dsfr from the project root, and its files are inlined unmodified", () => {
    expect(realpathSync(resolveDsfrDir(project)!)).toBe(realpathSync(join(project, "node_modules", "@gouvfr", "dsfr")));
    const theme = loadDsfrTheme(project, "fr");
    expect(theme.name).toBe("dsfr");
    expect(theme.css.startsWith(MARKER)).toBe(true);
    expect(theme.printCss).toBe(PRINT_MARKER);
  });

  it("follows a pnpm-style symlinked install", () => {
    const root = bareProject();
    try {
      const store = join(root, "node_modules", ".pnpm", "@gouvfr+dsfr@0.0.0", "node_modules", "@gouvfr", "dsfr");
      mkdirSync(join(store, "dist"), { recursive: true });
      writeFileSync(join(store, "package.json"), JSON.stringify({ name: "@gouvfr/dsfr" }));
      writeFileSync(join(store, "dist", "dsfr.min.css"), MARKER);
      mkdirSync(join(root, "node_modules", "@gouvfr"), { recursive: true });
      symlinkSync(store, join(root, "node_modules", "@gouvfr", "dsfr"), "dir");
      expect(loadDsfrTheme(root, "fr").css.startsWith(MARKER)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails loudly, in French, when the project has no DSFR — never a silent fallback", () => {
    expect(resolveDsfrDir(bare)).toBeUndefined();
    expect(() => loadDsfrTheme(bare, "fr")).toThrow(DsfrUnavailableError);
    try {
      loadDsfrTheme(bare, "fr");
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("@gouvfr/dsfr");
      expect(m).toContain("introuvable");
      expect(m).toContain(".gouv.fr");
      expect(m).toContain(".dsfr.yml");
      expect(m).toContain("ne le télécharge jamais");
    }
  });

  it("refuses a package that is not @gouvfr/dsfr, or a bundle missing from dist/", () => {
    const root = mkdtempSync(join(tmpdir(), "ultra11y-dsfr-bad-"));
    try {
      const pkg = join(root, "node_modules", "@gouvfr", "dsfr");
      mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@gouvfr/dsfr" }));
      expect(() => loadDsfrTheme(root, "fr")).toThrow(/dist\/dsfr\.min\.css/);
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "not-dsfr" }));
      expect(() => loadDsfrTheme(root, "en")).toThrow(/is not the @gouvfr\/dsfr package/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a stylesheet that would close the <style> element rather than edit it", () => {
    const root = fakeProject();
    try {
      writeFileSync(join(root, "node_modules", "@gouvfr", "dsfr", "dist", "dsfr.min.css"), "a{}</style><script>x</script>");
      expect(() => loadDsfrTheme(root, "fr")).toThrow(DsfrUnavailableError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("the DSFR markup", () => {
  const theme = (): ReturnType<typeof loadDsfrTheme> => loadDsfrTheme(project, "fr");

  it("inlines the project's CSS and maps the report onto fr-* classes, with no script and no external URL", () => {
    const html = renderHtmlDocument(
      compositeDoc(auditOf(BAD), { lang: "fr", standard: "rgaa", nav: [{ href: "./index.html", text: "Tableau de bord" }] }),
      theme(),
    );
    expect(html).toContain(`<style>${MARKER}`);
    expect(html).toContain(`<style media="print">${PRINT_MARKER}</style>`);
    for (const c of [
      "fr-skiplinks",
      'class="fr-header"',
      "fr-header__service-title",
      'class="fr-footer"',
      "fr-container",
      '<div class="fr-table fr-table--bordered">',
      "fr-badge fr-badge--sm fr-badge--no-icon",
      "fr-tags-group",
      'class="fr-tag"',
    ])
      expect(html, c).toContain(c);
    expect(html).toMatch(/fr-callout|fr-alert/);
    // No bloc-marque: ultra11y cannot know the issuing administration.
    expect(html).not.toContain("fr-logo");
    expect(html).not.toContain("fr-header__brand");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(externalReferences(html, 0)).toEqual([]);
    // The status keeps its letter: colour is never the only channel.
    expect(html).toMatch(/<span class="fr-badge[^"]*fr-badge--error">NC<\/span>/);
  });

  it("keeps the accessible structure: lang, one h1, skip link to main, captioned tables with scope", () => {
    const html = renderHtmlDocument(compositeDoc(withPages(), { lang: "fr" }), theme());
    expect(html).toContain('<html lang="fr">');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('href="#content"');
    expect(html).toContain('<main id="content"');
    const tables = html.match(/<table>/g)?.length ?? 0;
    expect(tables).toBeGreaterThan(0);
    expect(html.match(/<caption>/g)).toHaveLength(tables);
    expect(html).toContain('<th scope="col"');
  });

  const docs: Array<[string, (lang: Lang, standard: StandardId) => Doc]> = [
    [
      "index",
      (lang, standard) =>
        indexDoc(withPages(), { lang, standard, links: [{ href: "./x.html", text: "X" }], nav: [{ href: "./index.html", text: "I", current: true }] }),
    ],
    ["composite", (lang, standard) => compositeDoc(withPages(), { lang, standard })],
    [
      "page sheet",
      (lang, standard) => {
        const r = withPages();
        return pageDoc(r, derivePages(r, pagesOf(r))[0]!, { lang, standard, screenshot: "../assets/accueil.png" });
      },
    ],
  ];
  for (const [name, build] of docs)
    for (const lang of ["fr", "en"] as Lang[])
      for (const standard of ["wcag", "rgaa"] as StandardId[])
        it(`passes the engine's own audit · ${name} · ${lang} · ${standard}`, () => {
          const html = renderHtmlDocument(build(lang, standard), theme());
          const found = findingsForStandard(auditOf(html), standard).filter((f) => !f.advisory);
          expect(found.map((f) => `${f.ruleId} ${f.selectorHint}: ${f.message}`)).toEqual([]);
        });
});

describe("the CLI", () => {
  let work: string;
  let auditPath: string;
  beforeAll(() => {
    work = mkdtempSync(join(tmpdir(), "ultra11y-dsfr-cli-"));
    auditPath = join(work, "audit.json");
    writeFileSync(auditPath, JSON.stringify(withPages()));
  });
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("report --html --theme dsfr inlines the project's DSFR into every HTML file", async () => {
    const out = join(work, "dsfr");
    const r = await run(["report", "--in", auditPath, "--html", "--theme", "dsfr", "--root", project, "--out", out, "--lang", "fr"]);
    expect(r.code).toBe(0);
    const files = htmlFiles(out);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const html = readFileSync(f, "utf8");
      expect(html, f).toContain(MARKER);
      expect(html, f).toContain('class="fr-header"');
    }
  });

  it("report --html without --theme stays neutral", async () => {
    const out = join(work, "neutral");
    expect((await run(["report", "--in", auditPath, "--html", "--root", project, "--out", out, "--lang", "fr"])).code).toBe(0);
    for (const f of htmlFiles(out)) expect(readFileSync(f, "utf8")).not.toContain(MARKER);
  });

  it("report --html --theme dsfr without the package exits non-zero, explains why, and writes nothing", async () => {
    const out = join(work, "missing");
    const r = await run(["report", "--in", auditPath, "--html", "--theme", "dsfr", "--root", bare, "--out", out, "--lang", "fr"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("@gouvfr/dsfr");
    expect(r.err).toContain(".gouv.fr");
    expect(r.err).toContain("conditions d'utilisation");
    expect(existsSync(out)).toBe(false);
  });

  it("rejects an unknown theme name", async () => {
    const r = await run(["report", "--in", auditPath, "--html", "--theme", "marianne", "--out", join(work, "x"), "--lang", "fr"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("neutral ou dsfr");
  });

  it("reads html.theme from the project's .ultra11yrc.json", async () => {
    const root = fakeProject();
    try {
      writeFileSync(join(root, ".ultra11yrc.json"), JSON.stringify({ html: { theme: "dsfr" } }));
      const out = join(work, "config");
      expect((await run(["report", "--in", auditPath, "--html", "--root", root, "--out", out, "--lang", "fr"])).code).toBe(0);
      expect(readFileSync(join(out, "index.html"), "utf8")).toContain(MARKER);
      // The flag wins over the configuration.
      const out2 = join(work, "config-neutral");
      expect((await run(["report", "--in", auditPath, "--html", "--theme", "neutral", "--root", root, "--out", out2, "--lang", "fr"])).code).toBe(0);
      expect(readFileSync(join(out2, "index.html"), "utf8")).not.toContain(MARKER);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serve --static --theme dsfr exports every page with the project's DSFR", async () => {
    const out = join(work, "site");
    const r = await run(["serve", "--in", SERVE_AUDITS, "--root", project, "--static", out, "--theme", "dsfr", "--lang", "fr"]);
    expect(r.code).toBe(0);
    const files = htmlFiles(out);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const html = readFileSync(f, "utf8");
      expect(html, f).toContain(MARKER);
      expect(html, f).not.toMatch(/<script|<link/i);
    }
  });

  it("serve --theme dsfr without the package exits non-zero before serving", async () => {
    const r = await run(["serve", "--in", SERVE_AUDITS, "--root", bare, "--static", join(work, "nosite"), "--theme", "dsfr", "--lang", "fr"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain(".gouv.fr");
    expect(existsSync(join(work, "nosite"))).toBe(false);
  });
});
