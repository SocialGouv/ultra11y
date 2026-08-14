// Guidance is what makes a newly added country pack useful the day it lands.
//
// A pack says WHAT a criterion requires; guidance says HOW to implement it. Only RGAA ships
// a dataset of its own, so a freshly authored Section 508 or EN 301 549 pack would have no
// examples at all — unless it can inherit. Every guidance entry declares the WCAG success
// criteria it implements, and lookups walk every registered dataset, so it can.
//
// The inheritance must stay VISIBLE: an example borrowed through the WCAG crosswalk is not
// the national standard's own doctrine, and a report that presented it as such would be
// making a claim nobody wrote.
import { describe, expect, it } from "vitest";
import { resolveGuidance } from "../src/guidance/resolve.js";
import { getDataset, guidanceForWcag } from "../src/guidance/index.js";
import { allSC } from "../src/wcag.js";

describe("the WCAG-keyed dataset closes the gap no country pack can", () => {
  it("covers exactly the AA criteria the RGAA dataset never reached", () => {
    // Six of these were added in WCAG 2.2, after RGAA 4.1.2 (wcagVersion 2.1) froze. No
    // amount of French guidance could supply them.
    const ids = getDataset("wcag")!
      .entries.map((e) => e.criterionId)
      .sort();
    expect(ids).toEqual(["1.2.4", "2.3.1", "2.4.11", "2.4.5", "2.5.7", "2.5.8", "3.2.6", "3.3.3", "3.3.7", "3.3.8"]);
  });

  it("leaves no AA success criterion without reachable guidance", () => {
    const uncovered = allSC()
      .filter((c) => guidanceForWcag(c.sc).length === 0)
      .map((c) => c.sc);
    expect(uncovered).toEqual([]);
  });

  it("keeps every entry bilingual, so neither UI language falls back to the other", () => {
    for (const e of getDataset("wcag")!.entries) {
      expect(e.title.en, e.id).toBeTruthy();
      expect(e.title.fr, e.id).toBeTruthy();
      expect(e.summary.en, e.id).toBeTruthy();
      expect(e.summary.fr, e.id).toBeTruthy();
    }
  });

  it("records its own licence and attribution, as a redistributed source must", () => {
    const ds = getDataset("wcag")!;
    expect(ds.license).toBeTruthy();
    expect(ds.attribution).toMatch(/W3C/);
  });
});

describe("resolveGuidance marks where each entry came from", () => {
  it("prefers the pack's own entry and labels it `pack`", () => {
    const r = resolveGuidance("rgaa", "13.2");
    const own = r.filter((x) => !x.inherited);
    expect(own.length).toBeGreaterThan(0);
    expect(own[0]!.via).toBe("pack");
  });

  it("labels an entry reached through the WCAG crosswalk as inherited, naming the SC", () => {
    const inherited = resolveGuidance("rgaa", "13.2").filter((x) => x.inherited);
    expect(inherited.length).toBeGreaterThan(0);
    expect(inherited[0]!.via).toMatch(/^wcag:\d/);
  });

  it("never marks the core's own guidance as inherited", () => {
    // For WCAG the criterion id IS the success criterion — nothing is borrowed.
    for (const x of resolveGuidance("wcag", "2.5.8")) {
      expect(x.inherited).toBe(false);
      expect(x.via).toBe("wcag:2.5.8");
    }
  });

  it("dedupes, so an entry reachable twice is returned once", () => {
    const ids = resolveGuidance("rgaa", "1.1").map((x) => x.entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports which languages an entry actually has, rather than emitting the wrong one", () => {
    // The RGAA dataset is French-first. A caller asking in English needs to know when an
    // inherited entry has no English text, not receive French silently.
    for (const x of resolveGuidance("rgaa", "1.1")) {
      expect(Array.isArray(x.languagesAvailable), x.entry.id).toBe(true);
      expect(x.languagesAvailable.length, x.entry.id).toBeGreaterThan(0);
    }
  });
});

describe("a country pack that ships no guidance of its own", () => {
  it("still gets examples, through the criteria it maps to", () => {
    // The scenario that matters: someone adds Section 508 as a pack tomorrow. Its criteria
    // map onto WCAG success criteria, and that alone is enough for guidance to reach them.
    // "E205.4" is a Section-508-shaped id nothing is pinned to — exactly the state every
    // criterion of a brand-new pack is in. All it declares is the SC it maps to.
    const viaCrosswalk = resolveGuidance("rgaa", "E205.4", ["2.4.5"]);
    expect(viaCrosswalk.length).toBeGreaterThan(0);
    expect(viaCrosswalk.every((x) => x.inherited)).toBe(true);
    expect(viaCrosswalk.map((x) => x.entry.id)).toContain("navigation-multiple-ways");
  });
});
