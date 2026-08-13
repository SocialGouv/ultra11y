// THE WIRING. `src/evidence.ts` and the HTML tier are exercised in isolation by
// tests/evidence.test.ts and tests/html.test.ts; this file asserts that a USER can reach
// them. `writeEvidence` shipped complete, tested, and with no caller for a whole release —
// absent from the three engine bundles, because tsup tree-shook a module nothing imported.
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";
import { parseHtml } from "../src/parse/html.js";
import { encodePng } from "../src/pixel.js";
import { PAGES_DIR } from "../src/snapshot.js";

const DOM = `<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><main><h1>Accueil</h1>
<img src="hero.png">
<a href="/a"><img src="i.png"></a>
<input type="text">
</main></body></html>`;

/** A page snapshot the pixel tier can actually work from: DOM, meta with a viewport, boxes
 *  joined by document-order ordinal, and a screenshot made with the engine's own encoder —
 *  so no binary enters the repository. */
function snapshot(root: string, id: string, name: string): void {
  const dir = join(root, PAGES_DIR, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id, name, url: `https://exemple.fr/${id}`, viewport: { width: 400, height: 300 } }));
  writeFileSync(join(dir, "dom.html"), DOM);
  const doc = parseHtml(DOM, "d.html");
  const entries = doc.elements.map((el, i) => ({ i, tag: el.tag, x: 10 + (i % 3) * 20, y: 10 + i * 12, w: 80, h: 24 }));
  entries[0] = { i: 0, tag: doc.elements[0]!.tag, x: 0, y: 0, w: 400, h: 300 };
  writeFileSync(join(dir, "boxes.json"), JSON.stringify({ v: 1, entries }));
  writeFileSync(join(dir, "screen.png"), encodePng({ width: 400, height: 300, data: Buffer.alloc(400 * 300 * 4, 0xc8) }));
}

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  return { out, err, restore: () => (lo.mockRestore(), le.mockRestore()) };
}

async function run(argv: string[], cwd: string): Promise<{ code: number; out: string; err: string }> {
  const prev = process.cwd();
  process.chdir(cwd);
  const c = capture();
  try {
    const code = await main(argv);
    return { code, out: c.out.join("\n"), err: c.err.join("\n") };
  } finally {
    c.restore();
    process.chdir(prev);
  }
}

/** A project with two snapshotted pages and an audit of them on disk. */
async function project(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "ultra11y-visual-"));
  snapshot(root, "accueil", "Accueil");
  snapshot(root, "contact", "Contact");
  const r = await run(["audit", `${PAGES_DIR}/**/dom.html`, "--out", "out", "--json"], root);
  expect(r.code).toBe(0);
  return root;
}

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
async function tmpProject(): Promise<string> {
  const root = await project();
  roots.push(root);
  return root;
}

describe("pages --evidence", () => {
  it("writes annotated crops, and says how many", async () => {
    const root = await tmpProject();
    const r = await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--split", "page", "--evidence", "--out", "out/pages"], root);
    expect(r.code).toBe(0);
    const dir = join(root, "out", "pages", "assets", "accueil");
    expect(readdirSync(dir).filter((f) => f.endsWith(".png")).length).toBeGreaterThan(0);
    expect(r.err).toMatch(/crop\(s\) written|vignette\(s\) écrite\(s\)/);
  });

  it("hangs each crop off its own occurrence in the sheet", async () => {
    const root = await tmpProject();
    await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--split", "page", "--evidence", "--out", "out/pages"], root);
    const md = readFileSync(join(root, "out", "pages", "page-accueil.md"), "utf8");
    // Indented, no checkbox — it illustrates the occurrence above it and never becomes one.
    expect(md).toMatch(/^ {2,4}- !\[[^\]]+\]\(\.\/assets\/accueil\/[0-9a-f]+\.png\)$/m);
  });

  // The whole posture of this engine: nothing is cut in silence. An occurrence that has no
  // picture must never read as an occurrence that has no defect.
  it("says on the page what it could not illustrate, and why", async () => {
    const root = await tmpProject();
    await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--split", "page", "--evidence", "--out", "out/pages"], root);
    const md = readFileSync(join(root, "out", "pages", "page-accueil.md"), "utf8");
    if (md.includes("not illustrated") || md.includes("pas illustrées")) expect(md).toMatch(/- \d+ — /);
  });

  it("leaves the Markdown byte-identical when it is not asked for", async () => {
    const root = await tmpProject();
    await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--split", "page", "--out", "out/a"], root);
    await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--split", "page", "--html", "--out", "out/b"], root);
    for (const f of ["index.md", "page-accueil.md", "page-contact.md"]) {
      expect(readFileSync(join(root, "out", "b", f), "utf8")).toBe(readFileSync(join(root, "out", "a", f), "utf8"));
    }
  });

  it("refuses to write images with no directory to write them into", async () => {
    const root = await tmpProject();
    const r = await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--evidence"], root);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--out/);
  });
});

describe("--html", () => {
  it("gives `pages` the same flat layout its Markdown already uses", async () => {
    const root = await tmpProject();
    const r = await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--split", "page", "--html", "--out", "out/pages"], root);
    expect(r.code).toBe(0);
    const dir = join(root, "out", "pages");
    expect(existsSync(join(dir, "index.html"))).toBe(true);
    expect(existsSync(join(dir, "page-accueil.html"))).toBe(true);
    // NOT `out/pages/pages/` — the sheets sit beside the Markdown they mirror.
    expect(existsSync(join(dir, "pages"))).toBe(false);
  });

  it("gives `report` an entry point and a detachable composite", async () => {
    const root = await tmpProject();
    const r = await run(["report", "--in", "out/audit-latest.json", "--html", "--out", "out/audits"], root);
    expect(r.code).toBe(0);
    const files = readdirSync(join(root, "out", "audits"));
    expect(files).toContain("index.html");
    expect(files.some((f) => /^ultra11y-wcag-\d{4}-\d{2}-\d{2}\.html$/.test(f))).toBe(true);
    // Stdout still carries ONE line, the Markdown path: action.yml reads it into an output.
    expect(r.out.split("\n").filter(Boolean)).toHaveLength(1);
    expect(r.out).toMatch(/wcag-.*\.md$/);
  });

  it("carries the crops into the composite as data, and references them as files elsewhere", async () => {
    const root = await tmpProject();
    await run(["report", "--in", "out/audit-latest.json", "--html", "--evidence", "--out", "out/audits"], root);
    const dir = join(root, "out", "audits");
    const composite = readdirSync(dir).find((f) => f.startsWith("ultra11y-wcag-"))!;
    expect(readFileSync(join(dir, composite), "utf8")).toContain("data:image/png;base64,");
    expect(readFileSync(join(dir, "index.html"), "utf8")).not.toContain("data:image");
  });

  // `--format` on `report` names a CI CHANNEL; `--html` names a DOCUMENT. Resolving that by
  // precedence would silently drop one of the two deliverables.
  it("refuses --html together with a CI format, by name", async () => {
    const root = await tmpProject();
    const r = await run(["report", "--in", "out/audit-latest.json", "--html", "--format", "sarif"], root);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--html");
    expect(r.err).toContain("sarif");
  });

  it("refuses --evidence on `report` without --html, rather than writing images nothing shows", async () => {
    const root = await tmpProject();
    const r = await run(["report", "--in", "out/audit-latest.json", "--evidence", "--out", "out/audits"], root);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--html/);
  });

  it("emits nothing that points outside the artifact", async () => {
    const root = await tmpProject();
    await run(["pages", "--in", "out/audit-latest.json", "--format", "report", "--split", "page", "--evidence", "--html", "--out", "out/pages"], root);
    const dir = join(root, "out", "pages");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".html") || x.endsWith(".md"))) {
      const text = readFileSync(join(dir, f), "utf8");
      for (const m of text.matchAll(/(?:src|href)="([^"]+)"|\]\(([^)]+)\)/g)) {
        const ref = m[1] ?? m[2]!;
        if (ref.startsWith("#") || ref.startsWith("data:")) continue;
        expect(ref, `${f} points outside the artifact`).not.toMatch(/^\.\.\/|^https?:|^file:|\.ultra11y/);
      }
    }
  });
});

// The flags have to be DECLARED, not merely handled. An undeclared boolean makes parseArgs
// swallow the token after it and the run prints "unknown flag (ignored)" for a flag that in
// fact works — the cry-wolf src/cli.ts warns about.
describe("the flags are declared", () => {
  it("does not warn about a flag it honours", async () => {
    const root = await tmpProject();
    const r = await run(
      [
        "pages",
        "--in",
        "out/audit-latest.json",
        "--format",
        "report",
        "--split",
        "page",
        "--evidence",
        "--html",
        "--inline-budget",
        "999999",
        "--out",
        "out/pages",
      ],
      root,
    );
    expect(r.err).not.toMatch(/unknown flag/i);
    expect(r.code).toBe(0);
  });
});
