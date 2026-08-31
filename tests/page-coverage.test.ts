// A PAGE THE RUN MEASURED MUST BE ABLE TO CONFORM ON WHAT WAS MEASURED THERE.
//
// The engine's verdict is scope-wide: one contrast failure on one route makes the criterion
// non-conforming for the whole audit. Projected back onto a page, that NC used to re-open as
// « à évaluer » on every page the failure did NOT fire on — including pages the probes had just
// zoomed, reflowed, tabbed through and measured. Measured on a real RGAA sweep of 37 pages:
// 12 criteria NC run-wide, and 7 of them re-opened on the home page, which is 7 of its 9
// undecided cells. The evidence existed; the projection had no way to reach it.
//
// `scope.pageCoverage` is that dimension, persisted. These tests pin the three properties that
// make reading it safe, because each of them is a way to manufacture a false conformity:
//
//   1. ABSENT COVERAGE CONCLUDES NOTHING. An audit written before the field existed must
//      produce the byte-for-byte verdict it produced before.
//   2. AN INSTRUMENT THAT DID NOT RUN HERE KEEPS THE CRITERION OPEN. The fold is an AND.
//   3. A RECORDED VERDICT WINS OVER A MEASUREMENT. An agent that ruled « undecidable » looked
//      at the criterion and said so; a rule measuring something narrower must not overturn it.
import { describe, expect, it } from "vitest";

import { coverageFor, criterionMeasuredOn, intersectCoverage, renderedProvesOn, unionCoverage } from "../src/coverage.js";
import { derivePages, pagesOf } from "../src/pages.js";
import { derivePackResults } from "../src/standards/derive.js";
import { registerRuntimePack } from "../src/standards/index.js";
import type { AuditResult, CriterionResult, PageCoverage, PageScope } from "../src/types.js";

// ---- fixtures -----------------------------------------------------------------------------

const PAGES: PageScope[] = [
  { id: "accueil", name: "Accueil", url: "https://x/", basis: "snapshot" },
  { id: "aide", name: "Aide", url: "https://x/aide", basis: "snapshot" },
];

/** A run where BOTH pages were fully instrumented — the shape a complete sweep produces. */
const FULL: Record<string, PageCoverage> = {
  accueil: { dom: true, axe: true, rules: ["rendered-contrast", "rendered-contrast-pixel"], scs: ["1.4.3", "1.4.10"] },
  aide: { dom: true, axe: true, rules: ["rendered-contrast", "rendered-contrast-pixel"], scs: ["1.4.3", "1.4.10"] },
};

function audit(criteria: CriterionResult[], coverage?: Record<string, PageCoverage>): AuditResult {
  return {
    tool: "ultra11y",
    standard: "wcag",
    version: "0.0.0",
    schemaVersion: 1,
    date: "2026-08-19",
    scope: {
      inputs: ["src"],
      files: 1,
      pages: PAGES,
      pagesAudited: PAGES.map((p) => p.id),
      // Deliberately no `subjectsSeen`: present-and-empty means "nothing of any kind exists in
      // scope", which closes every criterion for absence and would decide these fixtures for
      // the wrong reason. Absent means "this audit predates the fold", which concludes nothing.
      ...(coverage ? { pageCoverage: coverage } : {}),
    },
    guidelines: [],
    criteria,
    findings: [],
    residualRisks: [],
    conformancePct: 100,
  } as unknown as AuditResult;
}

/** WCAG 1.4.3 (contrast) non-conforming run-wide — the exact shape that used to re-open. */
const contrastNcRunWide: CriterionResult[] = [{ id: "1.4.3", guideline: "1.4", status: "NC", findings: [] }];

// ---- 1. absent coverage concludes nothing --------------------------------------------------

describe("absent coverage", () => {
  it("leaves a run-wide NC undecided on a page it did not fire on — the pre-existing verdict", () => {
    const a = audit(contrastNcRunWide);
    const pages = derivePages(a, pagesOf(a));
    expect(pages.map((p) => p.criteria[0]?.status)).toEqual(["manual", "manual"]);
  });

  it("answers no to every coverage question rather than throwing", () => {
    expect(renderedProvesOn("1.4.3", undefined)).toBe(false);
    expect(unionCoverage(audit([]))).toBeUndefined();
    expect(intersectCoverage(audit([]))).toBeUndefined();
    expect(coverageFor(audit([]), "accueil")).toBeUndefined();
  });

  it("refuses a criterion whose deciding rules cannot be enumerated", () => {
    const cov: PageCoverage = { dom: true, axe: true };
    // No appliesTo at all (RGAA 12.3): nothing measures it, so nothing here may close it.
    expect(criterionMeasuredOn(undefined, ["2.4.5"], cov, cov)).toBe(false);
    expect(criterionMeasuredOn([], ["2.4.5"], cov, cov)).toBe(false);
    // A wildcard stands for a rule set this cannot enumerate — "all of them ran" is unprovable.
    expect(criterionMeasuredOn(["axe:*"], ["2.4.5"], cov, cov)).toBe(false);
    expect(criterionMeasuredOn(["*"], ["2.4.5"], cov, cov)).toBe(false);
  });
});

// ---- 2. the fold is an AND -----------------------------------------------------------------

describe("present coverage", () => {
  it("lets a page conform on a criterion the RUN failed, when the tier measured it here", () => {
    const a = audit(contrastNcRunWide, FULL);
    const pages = derivePages(a, pagesOf(a));
    expect(pages.map((p) => p.criteria[0]?.status)).toEqual(["C", "C"]);
    // …and says WHY, as a measurement rather than as silence.
    expect(pages[0]?.criteria[0]?.decidedBy).toBe("scan");
    expect(pages[0]?.criteria[0]?.justification).toMatch(/Measured in a real browser ON THIS PAGE/);
  });

  it("keeps the criterion open on the one page the browser tier never reached", () => {
    // `aide`'s snapshot was read (its DOM was folded) but no probe and no axe pass ran on it.
    // The fold is an AND: one such page and that page stays open, whatever the others measured.
    const partial = { accueil: FULL.accueil!, aide: { dom: true } };
    const a = audit(contrastNcRunWide, partial);
    const pages = derivePages(a, pagesOf(a));
    expect(pages.map((p) => `${p.id}:${p.criteria[0]?.status}`)).toEqual(["accueil:C", "aide:manual"]);
  });

  it("closes a criterion the RUN could not settle either, on the page that measured it", () => {
    // The scope-wide fold is « measured on EVERY page, or nothing », so a probe that skipped
    // one route leaves the criterion « to assess » for the whole run. That verdict says nothing
    // about the routes that WERE measured, and the branch has to sit above the run-wide
    // `manual` short-circuit — whose premise ("the engine cannot decide it anywhere") is
    // precisely what a page-level measurement refutes.
    const partial = { accueil: FULL.accueil!, aide: { dom: true } };
    const a = audit([{ id: "1.4.3", guideline: "1.4", status: "manual", findings: [] }], partial);
    const pages = derivePages(a, pagesOf(a));
    expect(pages.map((p) => `${p.id}:${p.criteria[0]?.status}`)).toEqual(["accueil:C", "aide:manual"]);
  });

  it("defers to a recorded verdict, even one that says « undecidable »", () => {
    // An agent that ruled the criterion open examined it and said so; a rule measuring
    // something narrower must not overturn that.
    const a = audit([{ id: "1.4.3", guideline: "1.4", status: "manual", decidedBy: "agent", findings: [] }], FULL);
    expect(derivePages(a, pagesOf(a))[0]?.criteria[0]?.status).toBe("manual");
  });

  it("never concludes for a page whose DOM this audit did not read", () => {
    // `pagesOf` downgrades a page this audit never read to "not-audited" AND strips its
    // coverage, so a stale record cannot re-publish the verdicts of a sweep that did not run.
    const a = audit(contrastNcRunWide, FULL);
    a.scope.pagesAudited = [];
    const pages = derivePages(a, pagesOf(a));
    expect(pages[0]?.basis).toBe("not-audited");
    expect(pages[0]?.criteria[0]?.status).toBe("manual");
  });

  it("folds the run's own answer as the INTERSECTION, never the union", () => {
    const partial = { accueil: FULL.accueil!, aide: { dom: true, axe: false, rules: [], scs: [] } };
    const a = audit(contrastNcRunWide, partial);
    expect(intersectCoverage(a)).toMatchObject({ axe: false, rules: [], scs: [] });
    // The union exists only to answer "is this instrument part of the run at all?".
    expect(unionCoverage(a)).toMatchObject({ axe: true, rules: ["rendered-contrast", "rendered-contrast-pixel"] });
  });

  it("does not demand an instrument this run never used anywhere", () => {
    // A source-only style run: the DOM was read, axe never was. A criterion decided by an
    // engine rule must still close, instead of waiting forever on a browser nobody ran.
    const noBrowser: PageCoverage = { dom: true };
    expect(criterionMeasuredOn(["axe:image-alt", "img-alt-missing"], ["1.1.1"], noBrowser, noBrowser)).toBe(true);
    // …but once axe IS part of the run, a page it skipped keeps the criterion open.
    const ranSomewhere: PageCoverage = { dom: true, axe: true };
    expect(criterionMeasuredOn(["axe:image-alt", "img-alt-missing"], ["1.1.1"], noBrowser, ranSomewhere)).toBe(false);
  });
});

// ---- 3. the pack projection, and what it must not touch ------------------------------------

describe("pack projection", () => {
  const rgaa = (a: AuditResult, pageId?: string) => new Map(derivePackResults(a, "rgaa", pageId).map((c) => [c.id, c]));

  it("does not rescue a partially covered pack criterion from rule silence", () => {
    // RGAA 11.9 maps onto 2.5.3 + 4.1.2 — both judgment SCs, so it derives `manual` run-wide.
    // Its own rules (button names) are engine + axe rules, and both ran on this page.
    const a = audit(
      [
        { id: "2.5.3", guideline: "2.5", status: "manual", findings: [] },
        { id: "4.1.2", guideline: "4.1", status: "manual", findings: [] },
      ],
      FULL,
    );
    expect(rgaa(a, "accueil").get("11.9")?.status).toBe("manual");
    expect(rgaa(a, "accueil").get("11.9")?.decidedBy).toBeUndefined();
  });

  // A PACK THAT DECLARES NO AUTOMATION CONTRACT HAS NOT REFUSED ANYTHING.
  //
  // 5.36.0 made `completeBySilence` the opt-in that lets measured silence prove conformity, and
  // wired it into `measuredRescue` as `pc.automation?.completeBySilence !== true`. On RGAA that
  // reads correctly — all 106 criteria ship a contract, and exactly three opt in. On a pack that
  // ships NO contract it read `undefined !== true` and refused the rescue, so the measure tier
  // was silently dead for every third-party pack, with no way to opt back in. This pins the
  // difference between "the pack said no" and "the pack said nothing".
  it("still rescues a measured criterion when the pack declares no automation contract", () => {
    const key = "synthnoautomation";
    const v = registerRuntimePack({
      key,
      name: "SynthNoAutomation",
      org: "O",
      country: "US",
      baseVersion: "1",
      wcagVersion: "2.2",
      locales: ["en"],
      defaultLocale: "en",
      license: "x",
      source: "x",
      attribution: "x",
      idPattern: "^\\d+\\.\\d+$",
      themes: [{ number: 1, name: { en: "Colour" }, count: 1 }],
      criteria: [
        {
          id: "1.1",
          theme: 1,
          title: { en: "Contrast" },
          titlePlain: { en: "Contrast" },
          wcag: ["1.4.3"],
          appliesTo: { ruleIds: ["rendered-contrast"] },
        },
      ],
    });
    expect(v.ok).toBe(true);

    const a = audit([{ id: "1.4.3", guideline: "1.4", status: "manual", findings: [] }], FULL);
    const c = new Map(derivePackResults(a, key, "accueil").map((x) => [x.id, x])).get("1.1");
    expect(c?.status).toBe("C");
    expect(c?.decidedBy).toBe("scan");
  });

  it("leaves a criterion no rule decides to the agent", () => {
    // RGAA 12.3 (« la page plan du site est-elle pertinente ? ») declares an EMPTY appliesTo.
    const a = audit([{ id: "2.4.5", guideline: "2.4", status: "manual", findings: [] }], FULL);
    expect(rgaa(a, "accueil").get("12.3")?.status).toBe("manual");
  });

  it("never turns a criterion closed for want of a subject into an open one", () => {
    // RGAA 4.10 is `judgment` and maps onto 1.4.2, which the engine closed because there is no
    // audio anywhere in scope. A measurement must not reopen that as « à évaluer » — this is
    // the regression that made the rescue a rescue rather than an early branch in deriveBase.
    const a = audit([{ id: "1.4.2", guideline: "1.4", status: "C", inapplicable: true, findings: [] }], FULL);
    const r = rgaa(a, "accueil").get("4.10");
    expect(r?.status).toBe("C");
    expect(r?.inapplicable).toBe(true);
  });

  it("lets an agent's « undecidable » stand against a measurement", () => {
    const a = audit(
      [
        { id: "2.5.3", guideline: "2.5", status: "manual", findings: [] },
        { id: "4.1.2", guideline: "4.1", status: "manual", findings: [] },
      ],
      FULL,
    );
    a.packAdjudication = {
      standard: "rgaa",
      criteria: [{ id: "11.9", status: "manual", reason: "undecidable", justification: "not decidable from the evidence", findings: [], decidedBy: "agent" }],
    };
    expect(rgaa(a, "accueil").get("11.9")?.status).toBe("manual");
  });

  it("gives the run and the page the same answer when every page was measured", () => {
    const a = audit(
      [
        { id: "2.5.3", guideline: "2.5", status: "manual", findings: [] },
        { id: "4.1.2", guideline: "4.1", status: "manual", findings: [] },
      ],
      FULL,
    );
    expect(rgaa(a).get("11.9")?.status).toBe(rgaa(a, "accueil").get("11.9")?.status);
  });
});
