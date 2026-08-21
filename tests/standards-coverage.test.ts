// The audit plan is DERIVED, not guessed.
//
// The whole value of `ultra11y_method` rests on these numbers being lookups over the repo's
// own data rather than a heuristic. A plan that double-counts, drops a criterion, or files a
// criterion the engine cannot see as "the engine has it" is worse than no plan — it turns
// into a conformance claim nobody tested.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { criterionCoverage, ruleTier, standardCoverage, type Tier } from "../src/standards/coverage.js";
import { allSC } from "../src/wcag.js";
import { allCriteria, loadPack } from "../src/standards/index.js";

function census(standard: string): Record<string, number> {
  const by: Record<string, number> = {};
  for (const c of standardCoverage(standard).values()) by[c.tier] = (by[c.tier] ?? 0) + 1;
  return by;
}

describe("the buckets partition the standard", () => {
  it("covers every WCAG success criterion exactly once", () => {
    const m = standardCoverage("wcag");
    expect(m.size).toBe(55);
    const total = Object.values(census("wcag")).reduce((a, b) => a + b, 0);
    expect(total).toBe(55);
  });

  it("covers every RGAA criterion exactly once", () => {
    const m = standardCoverage("rgaa");
    expect(m.size).toBe(106);
    expect(Object.values(census("rgaa")).reduce((a, b) => a + b, 0)).toBe(106);
  });
});

describe("the WCAG census reproduces the coverage arithmetic the tool quotes everywhere", () => {
  it("is 3 decided from source, 14 needing a rendered page or a browser, 38 judgment", () => {
    const by = census("wcag");
    // The 3/14/38 split is stated in COVERAGE_NOTE, in the prompts and in the README. If
    // this derivation disagreed with it, one of the two would be lying to an auditor.
    expect(by.source).toBe(3);
    expect((by["rendered-page"] ?? 0) + (by.browser ?? 0)).toBe(14);
    expect(by.judgment).toBe(38);
  });

  it("agrees criterion by criterion with the automatability class in wcag.json", () => {
    for (const sc of allSC()) {
      const cov = criterionCoverage("wcag", sc.sc)!;
      if (sc.automatability === "judgment") expect(cov.tier, sc.sc).toBe("judgment");
      if (sc.automatability === "static") expect(cov.sourceIsEnough, sc.sc).toBe(true);
      if (sc.automatability === "needs-rendering") {
        expect(["rendered-page", "browser"], sc.sc).toContain(cov.tier);
        expect(cov.sourceIsEnough, sc.sc).toBe(false);
      }
    }
  });
});

describe("a pack criterion is classified from what the pack declares", () => {
  it("files RGAA 8.1 — and only 8.1 — as out of engine scope", () => {
    // Its only WCAG mapping is 4.1.1 Parsing, which WCAG 2.2 removed. Same predicate as
    // derivePackResults, so the plan and the projection cannot disagree.
    const out = [...standardCoverage("rgaa")].filter(([, c]) => c.tier === "out-of-scope").map(([id]) => id);
    expect(out).toEqual(["8.1"]);
  });

  it("never claims source is enough for a criterion the pack says no rule can evidence", () => {
    const pack = loadPack("rgaa");
    for (const pc of allCriteria(pack)) {
      if (pc.appliesTo?.ruleIds?.length === 0) {
        const cov = criterionCoverage("rgaa", pc.id)!;
        expect(cov.sourceIsEnough, `${pc.id} has no applicable rule`).toBe(false);
        expect(cov.engineRules, pc.id).toEqual([]);
      }
    }
  });

  it("keeps `judgment` and `can still be failed by a rule` as separate axes", () => {
    // RGAA 4.10 is judgment:true — no tool may declare it conformant — yet it carries
    // `autoplay-media` and `axe:no-autoplay-audio`, which can fail it outright. A one-axis
    // model (the reference project's single `sourceSuffit` boolean) throws that away.
    const c = criterionCoverage("rgaa", "4.10")!;
    expect(c.tier).toBe("judgment");
    expect(c.sourceIsEnough).toBe(false);
    expect(c.canFailFrom).toContain("source");
    expect(c.engineRules).toContain("autoplay-media");
  });

  it("reports the cheapest tier that can prove a criterion, and names the rest", () => {
    const c = criterionCoverage("rgaa", "8.3")!;
    expect(c.tier).toBe("source");
    expect(c.sourceIsEnough).toBe(true);
    expect(c.engineRules).toContain("html-lang-missing");
    expect(c.alsoNeeds).toContain("browser");
  });

  it("says so when a pack declares no applicability at all", () => {
    // The path every brand-new country pack takes before anyone maps its rules.
    expect(criterionCoverage("rgaa", "8.3")!.applicabilityDeclared).toBe(true);
  });
});

describe("ruleTier dispatches on namespace, not on wording", () => {
  const cases: [string, Tier][] = [
    ["html-lang-missing", "source"],
    ["pack:rgaa:download-link-format", "source"],
    ["rendered-contrast", "rendered-page"],
    ["axe:image-alt", "browser"],
    ["dyn-live-region", "browser"],
    ["agent:alt-relevance", "judgment"],
  ];
  for (const [id, tier] of cases) {
    it(`files ${id} under ${tier}`, () => {
      expect(ruleTier(id)).toBe(tier);
    });
  }
});

describe("every criterion carries a stated reason", () => {
  it("explains itself for both standards", () => {
    for (const standard of ["wcag", "rgaa"]) {
      for (const [id, cov] of standardCoverage(standard)) {
        expect(cov.why.length, `${standard} ${id}`).toBeGreaterThan(20);
      }
    }
  });
});

// The prose used to disagree with itself about the single number a reader most wants: how many
// RGAA criteria will no tool decide? SKILL.md said 58, references/ci.md said 81,
// references/judgment.md said 99, and the pack itself says 59 — so at least two of the three
// were wrong, and nothing would ever have caught them. references/pages.md named five criteria
// that earn `C` by silence where only two do, because three of the five are `judgment: true`
// and `judgmentGuard` turns their `C` into `manual`.
//
// These figures are load-bearing: they are how someone decides whether to pay for an
// adjudication. Pin every place that states one against the pack that defines it.
describe("the documented RGAA figures match the pack", () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const cov = standardCoverage("rgaa");
  const judgmentCount = [...cov.values()].filter((c) => c.tier === "judgment").length;

  it("states the same judgment count everywhere it is quoted", () => {
    expect(judgmentCount).toBe(58); // the pack's own arithmetic; update the docs WITH this line
    for (const doc of ["skills/ultra11y/SKILL.md", "skills/ultra11y/references/ci.md", "skills/ultra11y/references/judgment.md"]) {
      const text = read(doc);
      const quoted = [...text.matchAll(/(\d+)\s*(?:of|de)\s*(?:RGAA's\s*)?106/gi)].map((m) => Number(m[1]));
      expect(quoted.length, `${doc} quotes no "<n> of 106" figure`).toBeGreaterThan(0);
      for (const n of quoted) expect(n, `${doc} quotes "${n} of 106"`).toBe(judgmentCount);
    }
  });

  it("names exactly the criteria that can earn C by silence, and no more", () => {
    const staticSc = new Set(
      allSC()
        .filter((c) => c.automatability === "static")
        .map((c) => c.sc),
    );
    const canC = allCriteria(loadPack("rgaa"))
      .filter((c) => !c.judgment && c.wcag.length > 0 && c.wcag.every((sc) => staticSc.has(sc)))
      .map((c) => c.id);
    expect(canC.sort()).toEqual(["8.3", "8.5"]);

    // …and the doc says so, rather than the five it used to list.
    const pages = read("skills/ultra11y/references/pages.md");
    expect(pages).toMatch(/\*\*8\.3 and 8\.5, and\s*\n?those two only\*\*/);
    expect(pages).toMatch(/judgmentGuard/);
  });
});
