// #144 — the lite gate: rendered snapshots, engine only, and a baseline keyed so that a finding
// which merely MOVED is not new. `findingId` keys on the snapshot's byte range, which shifts with
// every change above an element; the regression key does not.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { findingId } from "../src/baseline.js";
import { main } from "../src/cli.js";
import {
  buildRenderBaseline,
  diffRenderBaseline,
  normalizeSelector,
  parseRenderBaseline,
  RENDER_BASELINE_KIND,
  regressionKey,
  renderDiffMarkdown,
} from "../src/lite.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import { toSarif } from "../src/sarif.js";
import type { Finding } from "../src/types.js";

const page = (body: string) => `<!doctype html><html lang="fr"><head><title>Page</title></head><body><main>${body}</main></body></html>`;
const ONE_IMG = page(`<h1>Titre</h1><img src="a.png">`);
const MOVED = page(`<h1>Titre</h1><p>Un paragraphe ajouté au-dessus,</p><p>qui déplace tout ce qui suit.</p><img src="a.png">`);
const TWO_IMG = page(`<h1>Titre</h1><img src="a.png"><img src="b.png">`);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-lite-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const snap = (id: string, dom: string) => writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id, name: id, url: `http://localhost/${id}` }, dom });
const auditPages = (...ids: string[]): Finding[] =>
  runAudit({ inputs: ids.map((id) => join(root, PAGES_DIR, id, "dom.html")), dedup: "off", noDefaultExcludes: true, pixel: false }).findings;

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  const code = await main(argv);
  vi.restoreAllMocks();
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("the regression key", () => {
  it("folds generated parts of a selector, and keeps the tag", () => {
    expect(normalizeSelector("input#:r1a:")).toBe("input#:r:");
    expect(normalizeSelector("div#«r3»")).toBe("div#:r:");
    expect(normalizeSelector("a[href=/entreprise/998900001]")).toBe("a[href=/entreprise/0]");
    expect(normalizeSelector("div.css-1q2w3e")).toBe("div.css-~");
    expect(normalizeSelector("h2")).toBe("h2");
    expect(normalizeSelector("main > li:nth-child(12)")).toBe("main > li:nth-child(0)");
  });

  it("survives a finding that moved, where findingId does not", () => {
    snap("accueil", ONE_IMG);
    const before = auditPages("accueil").filter((f) => f.ruleId.includes("img") || f.criteriaId === "1.1.1");
    snap("accueil", MOVED);
    const after = auditPages("accueil").filter((f) => f.ruleId.includes("img") || f.criteriaId === "1.1.1");
    expect(before.length).toBeGreaterThan(0);
    expect(after.map(findingId)).not.toEqual(before.map(findingId));
    expect(after.map(regressionKey)).toEqual(before.map(regressionKey));
    expect(before[0] && regressionKey(before[0])).toMatch(/^accueil\|/);
  });
});

describe("the render baseline diff", () => {
  it("does not call a moved finding new, and does call a real one new", () => {
    snap("accueil", ONE_IMG);
    const baseline = buildRenderBaseline(auditPages("accueil"), ["accueil"], "wcag");
    snap("accueil", MOVED);
    const moved = diffRenderBaseline(auditPages("accueil"), ["accueil"], baseline);
    expect(moved.newFindings).toEqual([]);
    expect(moved.ok).toBe(true);

    snap("accueil", TWO_IMG);
    const added = diffRenderBaseline(auditPages("accueil"), ["accueil"], baseline);
    expect(added.newFindings.length).toBeGreaterThan(0);
    expect(added.blocking.length).toBeGreaterThan(0);
    expect(added.ok).toBe(false);
    expect(renderDiffMarkdown(added, "fr")).toContain("❌");
  });

  it("counts a fix, and a cleaner page passes", () => {
    snap("accueil", TWO_IMG);
    const baseline = buildRenderBaseline(auditPages("accueil"), ["accueil"], "wcag");
    snap("accueil", ONE_IMG);
    const d = diffRenderBaseline(auditPages("accueil"), ["accueil"], baseline);
    expect(d.ok).toBe(true);
    expect(d.fixed).toBeGreaterThan(0);
  });

  it("warns, never fails, on a page the baseline never measured", () => {
    snap("accueil", ONE_IMG);
    snap("contact", TWO_IMG);
    const baseline = buildRenderBaseline(auditPages("accueil"), ["accueil"], "wcag");
    const d = diffRenderBaseline(auditPages("accueil", "contact"), ["accueil", "contact"], baseline);
    expect(d.pagesWithoutBaseline).toEqual(["contact"]);
    expect(d.unbaselined.length).toBeGreaterThan(0);
    expect(d.newFindings).toEqual([]);
    expect(d.ok).toBe(true);
  });

  it("measures a clean page as measured, so a later finding on it is new", () => {
    snap("propre", page("<h1>Rien à signaler</h1>"));
    const baseline = buildRenderBaseline(auditPages("propre"), ["propre"], "wcag");
    expect(baseline.pages.propre).toBeDefined();
    snap("propre", ONE_IMG);
    expect(diffRenderBaseline(auditPages("propre"), ["propre"], baseline).ok).toBe(false);
  });

  it("warns, never fails, when another ultra11y version wrote the baseline", () => {
    snap("accueil", ONE_IMG);
    const baseline = { ...buildRenderBaseline(auditPages("accueil"), ["accueil"], "wcag"), version: "0.0.1" };
    snap("accueil", TWO_IMG);
    const d = diffRenderBaseline(auditPages("accueil"), ["accueil"], baseline);
    expect(d.blocking.length).toBeGreaterThan(0);
    expect(d.versionMismatch?.baseline).toBe("0.0.1");
    expect(d.ok).toBe(true);
  });

  it("reads a render baseline back, and an audit document as one", () => {
    snap("accueil", ONE_IMG);
    const result = runAudit({ inputs: [join(root, PAGES_DIR, "accueil", "dom.html")], dedup: "off" });
    const b = buildRenderBaseline(result.findings, ["accueil"], "wcag");
    expect(parseRenderBaseline(JSON.parse(JSON.stringify(b)))).toEqual(b);
    const fromAudit = parseRenderBaseline(JSON.parse(JSON.stringify(result)));
    expect(fromAudit?.kind).toBe(RENDER_BASELINE_KIND);
    expect(fromAudit?.pages.accueil).toEqual(b.pages.accueil);
    expect(parseRenderBaseline({ nope: true })).toBeNull();
  });

  it("gives every repeat of a coarse key its own SARIF fingerprint", () => {
    snap("accueil", page(`<img src="a.png"><img src="a.png">`));
    const result = runAudit({ inputs: [join(root, PAGES_DIR, "accueil", "dom.html")], dedup: "off" });
    const prints = toSarif(result, { fingerprint: regressionKey }).runs[0]!.results.map((r) => Object.values(r.partialFingerprints ?? {})[0]);
    expect(new Set(prints).size).toBe(prints.length);
  });
});

describe("audit --lite, the command", () => {
  it("writes a baseline, passes on a moved finding, fails on a new one, and warns on the rest", async () => {
    snap("accueil", ONE_IMG);
    const baseline = join(root, "baseline.json");
    const written = await run(["audit", "--lite", "--root", root, "--write-baseline", baseline]);
    expect(written.code).toBe(0);
    expect(JSON.parse(readFileSync(baseline, "utf8")).kind).toBe(RENDER_BASELINE_KIND);

    snap("accueil", MOVED);
    const moved = await run(["audit", "--lite", "--root", root, "--baseline", baseline, "--json"]);
    expect(moved.code).toBe(0);
    expect(JSON.parse(moved.out).newFindings).toEqual([]);

    snap("accueil", TWO_IMG);
    snap("contact", TWO_IMG);
    const out = join(root, "out");
    const added = await run(["audit", "--lite", "--root", root, "--pages", "accueil,contact,absente", "--baseline", baseline, "--out", out, "--json"]);
    expect(added.code).toBe(1);
    const diff = JSON.parse(added.out);
    expect(diff.pagesWithoutBaseline).toEqual(["contact"]);
    expect(diff.warnings.join("\n")).toContain("absente");
    expect(existsSync(join(out, "lite.sarif"))).toBe(true);
    const sarif = JSON.parse(readFileSync(join(out, "lite.sarif"), "utf8"));
    expect(sarif.runs[0].automationDetails.id).toBe("ultra11y-lite/wcag/");
    expect(sarif.runs[0].results.length).toBe(diff.newFindings.length);
  });

  it("treats a missing baseline file as no baseline: a warning, never a failure", async () => {
    snap("accueil", TWO_IMG);
    const r = await run(["audit", "--lite", "--root", root, "--baseline", join(root, "absent.json"), "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).noBaseline).toBe(true);
  });

  it("writes the job summary and annotations in --format github", async () => {
    snap("accueil", ONE_IMG);
    const baseline = join(root, "baseline.json");
    await run(["audit", "--lite", "--root", root, "--write-baseline", baseline]);
    snap("accueil", TWO_IMG);
    const summary = join(root, "summary.md");
    writeFileSync(summary, "");
    vi.stubEnv("GITHUB_STEP_SUMMARY", summary);
    const r = await run(["audit", "--lite", "--root", root, "--baseline", baseline, "--format", "github", "--lang", "en"]);
    vi.unstubAllEnvs();
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^::error file=/m);
    expect(readFileSync(summary, "utf8")).toContain("ultra11y lite");
  });

  it("refuses what does not apply to the snapshots", async () => {
    expect((await run(["audit", "--lite", "src", "--root", root])).code).toBe(2);
    expect((await run(["audit", "--lite", "--since", "main", "--root", root])).code).toBe(2);
  });
});
