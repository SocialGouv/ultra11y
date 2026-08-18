// `sweepSample` exists so a repo stops keeping a second copy of its own page sample. The
// sample already says what every page is; a hand-written route table beside it drifts, and a
// page renamed in one place keeps its old identity in the report — the exact failure the page
// tier exists to prevent.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateSample } from "../src/sample.js";

function rc(pages: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "u11y-sweep-"));
  writeFileSync(join(dir, ".ultra11yrc.json"), JSON.stringify({ sample: { pages } }));
  return dir;
}

describe("the sample carries everything a sweep needs", () => {
  it("accepts `sources`, so a route table beside it is redundant", () => {
    const v = validateSample({
      pages: [{ id: "accueil", name: "Accueil", url: "http://x/", sources: ["src/app/page.tsx"] }],
    });
    expect(v.ok, JSON.stringify(v.issues)).toBe(true);
    expect(v.sample?.pages[0]?.sources).toEqual(["src/app/page.tsx"]);
  });

  it("rejects a sources that is not a list of paths, rather than carrying it into the report", () => {
    const v = validateSample({ pages: [{ id: "a", name: "A", url: "http://x/", sources: "src/app/page.tsx" }] });
    expect(v.ok).toBe(false);
    expect(JSON.stringify(v.issues)).toContain("sources");
  });

  it("keeps sources optional — most samples do not need it", () => {
    const v = validateSample({ pages: [{ id: "a", name: "A", url: "http://x/" }] });
    expect(v.ok).toBe(true);
    expect(v.sample?.pages[0]?.sources).toBeUndefined();
  });
});

// The page SELECTION is separated from declaring tests on purpose: it is the half with rules
// in it, and it must be testable without a Playwright runtime in this repo.
describe("samplePagesFor — which pages a sweep owns", () => {
  it("refuses a directory with no .ultra11yrc.json instead of returning zero pages", async () => {
    const { samplePagesFor } = await import("../src/integrations/playwright.js");
    const empty = mkdtempSync(join(tmpdir(), "u11y-none-"));
    // A silent zero-page sweep is indistinguishable from one that ran and found nothing.
    expect(() => samplePagesFor({ cwd: empty })).toThrow(/\.ultra11yrc\.json/);
  });

  it("returns nothing, without failing, when the sample is empty", async () => {
    const { samplePagesFor } = await import("../src/integrations/playwright.js");
    expect(samplePagesFor({ cwd: rc([]) })).toEqual([]);
  });

  it("lets a repo keep the pages its own specs drive", async () => {
    const { samplePagesFor } = await import("../src/integrations/playwright.js");
    const dir = rc([
      { id: "accueil", name: "Accueil", url: "http://x/" },
      { id: "etape-2", name: "Étape 2", url: "http://x/etape/2" },
    ]);
    // `only` is how a funnel step that needs seeded state stays out of the generic sweep.
    const kept = samplePagesFor({ cwd: dir, only: (p) => !p.id.startsWith("etape-") });
    expect(kept.map((p) => p.id)).toEqual(["accueil"]);
  });

  it("carries auth, notes and sources through to the fixture", async () => {
    const { samplePagesFor } = await import("../src/integrations/playwright.js");
    const dir = rc([{ id: "a", name: "A", url: "http://x/a", auth: true, notes: "n", sources: ["s.tsx"] }]);
    expect(samplePagesFor({ cwd: dir })[0]).toMatchObject({ auth: true, notes: "n", sources: ["s.tsx"] });
  });
});

describe("sweepTarget — the sample stores URLs, a test wants a path", () => {
  it("takes the path so the config's baseURL applies", async () => {
    const { sweepTarget } = await import("../src/integrations/playwright.js");
    expect(sweepTarget("http://localhost:3000/aide")).toBe("/aide");
    expect(sweepTarget("http://localhost:3000/")).toBe("/");
  });

  it("leaves a path alone", async () => {
    const { sweepTarget } = await import("../src/integrations/playwright.js");
    expect(sweepTarget("/aide")).toBe("/aide");
  });
});

// The sweep's own defaults. Separated from `sweepSample` so they can be checked without a
// Playwright runtime — the same reason page SELECTION is separate above.
describe("what a swept page is checked with", () => {
  it("probes by default — the sweep exists for the criteria only a probe can decide", async () => {
    // Measured on egapro: `sweepSample({ settle, only })` owned 15 of the 20 recorded pages
    // and passed no probes, so 1.4.4 / 1.4.10 / 1.4.12 / 1.4.13 stayed « à évaluer » for the
    // WHOLE audit — conformity is an AND across every page in scope, so the five pages that
    // were probed could not carry the other fifteen.
    const { sweepCheckOptions } = await import("../src/integrations/playwright.js");
    expect(sweepCheckOptions().probes).toBe(true);
  });

  it("records without asserting — the durable output of a sweep is the snapshot", async () => {
    const { sweepCheckOptions } = await import("../src/integrations/playwright.js");
    expect(sweepCheckOptions().failOn).toBe(false);
  });

  it("lets the repository turn the probes off, and everything else it passes still wins", async () => {
    const { sweepCheckOptions } = await import("../src/integrations/playwright.js");
    expect(sweepCheckOptions({ probes: false }).probes).toBe(false);
    expect(sweepCheckOptions({ probes: { budgetMs: 5_000 } }).probes).toEqual({ budgetMs: 5_000 });
    expect(sweepCheckOptions({ failOn: "blocking" }).failOn).toBe("blocking");
  });
});
