// The shipped AA snapshot (scripts/vendor/wcag-2.2-sc.json) must be derivable WITHOUT a
// local w3c/wcag checkout.
//
// It was the one vendored source the daily refresh could not touch: `--refresh` reads a
// directory on someone's disk, so a renamed or newly added success criterion would land in
// the vendored universe and never reach the core the engine actually ships. That is the
// silent-drift failure the refresh exists to prevent.
//
// `--refresh-core` derives it from the universe instead, which `--refresh-universe` already
// fetches. This asserts the two agree exactly — the derivation is a filter, not a second
// parser that could disagree with the first.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const universe = JSON.parse(readFileSync(join(ROOT, "scripts/vendor/wcag-2.2-sc-universe.json"), "utf8"));
const core = JSON.parse(readFileSync(join(ROOT, "scripts/vendor/wcag-2.2-sc.json"), "utf8"));

describe("the shipped AA snapshot is the universe's core-AA slice", () => {
  it("matches criterion for criterion, field for field", () => {
    const derived = universe.criteria.filter((c: { status: string }) => c.status === "core-AA").map(({ status, ...rest }: Record<string, unknown>) => rest);
    expect(derived).toEqual(core.criteria);
  });

  it("carries the 55 A/AA criteria and nothing else", () => {
    expect(core.criteria).toHaveLength(55);
    for (const c of core.criteria) expect(["A", "AA"]).toContain(c.level);
    // 4.1.1 Parsing was removed in WCAG 2.2: it is in the universe, never in the core.
    expect(core.criteria.map((c: { sc: string }) => c.sc)).not.toContain("4.1.1");
    expect(universe.criteria.map((c: { sc: string }) => c.sc)).toContain("4.1.1");
  });

  it("keeps only the guidelines its criteria actually use", () => {
    const used = new Set(core.criteria.map((c: { guideline: string }) => c.guideline));
    expect(new Set(core.guidelines.map((g: { number: string }) => g.number))).toEqual(used);
  });

  it("agrees with the universe on principle and guideline titles", () => {
    const uniG = new Map(universe.guidelines.map((g: { number: string; title: string }) => [g.number, g.title]));
    for (const g of core.guidelines) expect(uniG.get(g.number), g.number).toBe(g.title);
    const uniP = new Map(universe.principles.map((p: { number: number; title: string }) => [p.number, p.title]));
    for (const p of core.principles) expect(uniP.get(p.number), String(p.number)).toBe(p.title);
  });
});
