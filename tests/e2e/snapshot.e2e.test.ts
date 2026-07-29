// The `snapshot` command as a producer really uses it: the shipped bundle, a payload on
// stdin, artifacts on disk. This is the contract the generated E2E fixtures depend on.
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runCli, mkTmp, cleanupTmp } from "./helpers.js";

afterAll(cleanupTmp);

const PAGE = {
  meta: { v: 1, id: "accueil", name: "Page d'accueil", url: "https://example.com/", runner: "playwright", sources: ["app/page.tsx"] },
  dom: "<!doctype html><html><head></head><body><img src=a.png></body></html>",
  styles: { v: 1, entries: [{ i: 0, tag: "html", css: { color: "rgb(0, 0, 0)" } }] },
  boxes: { v: 1, entries: [{ i: 0, tag: "html", x: 0, y: 0, w: 1280, h: 800 }] },
};

const write = (cwd: string, payload: unknown, args: string[] = []) => runCli(["snapshot", "write", "--json", ...args], { cwd, input: JSON.stringify(payload) });

describe("snapshot write", () => {
  it("persists the page and returns its audit", () => {
    const cwd = mkTmp();
    const r = write(cwd, PAGE);
    expect(r.code).toBe(0);
    const dir = join(cwd, ".ultra11y", "pages", "accueil");
    for (const f of ["meta.json", "dom.html", "styles.json", "boxes.json"]) expect(existsSync(join(dir, f)), f).toBe(true);
    const audit = JSON.parse(r.stdout) as { findings: { ruleId: string; page?: string; origin?: { sourceFile?: string } }[] };
    expect(audit.findings.map((f) => f.ruleId)).toContain("img-alt-missing");
  });

  it("decides the page-scoped criteria a component capture cannot reach", () => {
    const cwd = mkTmp();
    const audit = JSON.parse(write(cwd, PAGE).stdout) as { findings: { ruleId: string }[] };
    const ids = audit.findings.map((f) => f.ruleId);
    expect(ids).toContain("html-lang-missing"); // WCAG 3.1.1 → RGAA 8.3
    expect(ids).toContain("title-missing-empty"); // WCAG 2.4.2 → RGAA 8.5/8.6
  });

  it("stamps every finding with the page and the source that rendered it", () => {
    const cwd = mkTmp();
    const audit = JSON.parse(write(cwd, PAGE).stdout) as { findings: { page?: string; origin?: { sourceFile?: string } }[] };
    expect(audit.findings.length).toBeGreaterThan(0);
    for (const f of audit.findings) {
      expect(f.page).toBe("accueil");
      expect(f.origin?.sourceFile).toBe("app/page.tsx");
    }
  });

  it("exits 1 under --fail-on when the page has findings at that severity", () => {
    const cwd = mkTmp();
    expect(write(cwd, PAGE, ["--fail-on", "blocking"]).code).toBe(1);
  });

  it("exits 0 under --fail-on for a clean page", () => {
    const cwd = mkTmp();
    const clean = { ...PAGE, dom: '<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><main><h1>Bonjour</h1></main></body></html>' };
    const r = write(cwd, clean, ["--fail-on", "blocking"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  });

  it("audits only the page it was given, never another page's backlog", () => {
    const cwd = mkTmp();
    write(cwd, PAGE); // a page full of non-conformities
    const clean = {
      meta: { v: 1, id: "contact", name: "Contact", url: "https://example.com/contact" },
      dom: '<!doctype html><html lang="fr"><head><title>Contact</title></head><body><main><h1>Contact</h1></main></body></html>',
    };
    expect(write(cwd, clean, ["--fail-on", "blocking"]).code).toBe(0);
  });

  it("re-audits offline, with no browser and no producer, from the committed snapshots", () => {
    const cwd = mkTmp();
    write(cwd, PAGE);
    const r = runCli(["audit", ".", "--json"], { cwd });
    const audit = JSON.parse(r.stdout) as { findings: { page?: string }[] };
    expect(audit.findings.some((f) => f.page === "accueil")).toBe(true);
  });
});

describe("snapshot write rejects what it cannot trust", () => {
  it("refuses an empty stdin rather than writing a hollow snapshot", () => {
    const r = runCli(["snapshot", "write"], { cwd: mkTmp(), input: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/no payload/i);
  });

  it("refuses malformed JSON", () => {
    const r = runCli(["snapshot", "write"], { cwd: mkTmp(), input: "{ nope" });
    expect(r.code).toBe(2);
  });

  it("refuses an id that would escape the pages directory", () => {
    const r = write(mkTmp(), { ...PAGE, meta: { ...PAGE.meta, id: "../../etc" } });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("meta.id");
  });

  it("refuses a payload with no DOM", () => {
    const r = write(mkTmp(), { ...PAGE, dom: "" });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/dom/i);
  });

  it("names the offending field so a producer can fix it", () => {
    const r = write(mkTmp(), { ...PAGE, meta: { ...PAGE.meta, url: "" } });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("meta.url");
  });
});

describe("snapshot list", () => {
  it("reports nothing when no page has been captured", () => {
    const r = runCli(["snapshot", "list"], { cwd: mkTmp() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/no snapshot|aucun instantané/i);
  });

  it("lists what has been captured", () => {
    const cwd = mkTmp();
    write(cwd, PAGE);
    const r = runCli(["snapshot", "list", "--json"], { cwd });
    const metas = JSON.parse(r.stdout) as { id: string; url: string }[];
    expect(metas).toHaveLength(1);
    expect(metas[0]?.id).toBe("accueil");
  });

  it("skips a corrupt snapshot instead of failing the whole listing", () => {
    const cwd = mkTmp();
    write(cwd, PAGE);
    const broken = join(cwd, ".ultra11y", "pages", "broken");
    runCli(["snapshot", "write", "--json"], { cwd, input: JSON.stringify({ ...PAGE, meta: { ...PAGE.meta, id: "broken" } }) });
    writeFileSync(join(broken, "meta.json"), "{ not json");
    const r = runCli(["snapshot", "list", "--json"], { cwd });
    expect(r.code).toBe(0);
    expect((JSON.parse(r.stdout) as unknown[]).length).toBe(1);
  });
});

describe("render --e2e writes fixtures that actually drive the engine", () => {
  it("writes the Playwright fixture and it round-trips a page through the CLI", () => {
    const cwd = mkTmp();
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "demo", devDependencies: { "@playwright/test": "^1.49.0" } }));
    const gen = runCli(["render", "--e2e", "--json"], { cwd });
    expect(gen.code).toBe(0);
    const fixture = join(cwd, ".ultra11y", "e2e", "playwright.mjs");
    expect(existsSync(fixture)).toBe(true);
    // The baked engine path must be usable from the generated file's own project.
    expect(readFileSync(fixture, "utf8")).toContain("ultra11y.mjs");

    // Drive the fixture in a subprocess rooted at the generated project — it spawns the
    // engine at process.cwd(), which is exactly what a real Playwright run gives it.
    const driver = join(cwd, "drive.mjs");
    writeFileSync(
      driver,
      `import { auditSnapshot, failingFindings } from "./.ultra11y/e2e/playwright.mjs";
const r = auditSnapshot(${JSON.stringify(PAGE)});
console.log(JSON.stringify({ findings: r.findings.length, failing: failingFindings(r, "blocking").length }));
`,
    );
    const run = spawnSync(process.execPath, [driver], { cwd, encoding: "utf8" });
    expect(run.status, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout) as { findings: number; failing: number };
    expect(out.findings).toBeGreaterThan(0);
    expect(out.failing).toBeGreaterThan(0);
    expect(existsSync(join(cwd, ".ultra11y", "pages", "accueil", "dom.html"))).toBe(true);
  });

  it("fails with an actionable message when no runner is present", () => {
    const cwd = mkTmp();
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "demo" }));
    const r = runCli(["render", "--e2e"], { cwd });
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/--runner/);
  });
});
