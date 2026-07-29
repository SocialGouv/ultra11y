import { describe, it, expect } from "vitest";
import adjudication from "../src/data/adjudication.json";
import { hasSC, allSC } from "../src/wcag.js";
import { loadPack } from "../src/standards/index.js";

// The adjudication protocol (src/data/adjudication.json, built by
// scripts/build-adjudication.mjs) is rendered per residual criterion by
// `formatAdjudication`. This is the honest-judgment-tier guard: EVERY criterion the engine
// cannot decide must carry a decision rule and at least one question, in both languages,
// keyed to a real success criterion. A criterion handed to the agent with no stated rule is
// where an audit quietly turns into an opinion.
type LocaleText = { fr: string; en: string };
const protocol = adjudication as Record<string, { decide: LocaleText; na?: LocaleText; questions: LocaleText[] }>;
const bank = Object.fromEntries(Object.entries(protocol).map(([sc, p]) => [sc, p.questions])) as Record<string, LocaleText[]>;

describe("adjudication.json integrity", () => {
  it("covers EVERY criterion the static engine cannot decide — no silent hand-off", () => {
    const needed = allSC()
      .filter((c) => c.automatability !== "static")
      .map((c) => c.sc)
      .sort();
    expect(Object.keys(protocol).sort()).toEqual(needed);
  });

  it("states a decision rule for every criterion, in both languages", () => {
    for (const [sc, p] of Object.entries(protocol)) {
      for (const lang of ["fr", "en"] as const) {
        expect(p.decide?.[lang]?.trim().length, `${sc}.decide.${lang}`).toBeGreaterThan(40);
        if (p.na) expect(p.na[lang]?.trim().length, `${sc}.na.${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it("is non-empty and keys only real WCAG success criteria", () => {
    const keys = Object.keys(bank);
    expect(keys.length).toBeGreaterThan(0);
    for (const sc of keys) {
      expect(sc, `key shape ${sc}`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(hasSC(sc), `${sc} must be a real WCAG 2.2 AA success criterion`).toBe(true);
    }
  });

  it("every criterion carries at least one question", () => {
    for (const [sc, questions] of Object.entries(bank)) {
      expect(Array.isArray(questions), `${sc} value is an array`).toBe(true);
      expect(questions.length, `${sc} has ≥1 question`).toBeGreaterThan(0);
    }
  });

  it("every question has non-empty fr AND en prose", () => {
    for (const [sc, questions] of Object.entries(bank)) {
      questions.forEach((q, i) => {
        expect(typeof q.fr, `${sc}[${i}].fr`).toBe("string");
        expect(typeof q.en, `${sc}[${i}].en`).toBe("string");
        expect(q.fr.trim().length, `${sc}[${i}].fr non-empty`).toBeGreaterThan(0);
        expect(q.en.trim().length, `${sc}[${i}].en non-empty`).toBeGreaterThan(0);
      });
    }
  });

  it("covers the judgment criteria the Ara audit surfaced (8.9/9.3 under 1.3.1, SPA 12.8 under 2.4.3, 6.1 under 2.4.4, 5.5 concision under 2.4.6, 7.5 under 4.1.3)", () => {
    for (const sc of ["1.3.1", "2.4.3", "2.4.4", "2.4.6", "4.1.3"]) {
      expect(bank[sc], `question bank covers ${sc}`).toBeDefined();
    }
    // The 5.5 caption-CONCISION question specifically (the auditor's case: a clear but
    // verbose caption should become a short intro, details via aria-labelledby) lives
    // under 2.4.6 — the headings-and-labels judgment SC whose harvester surfaces captions.
    const concision = (bank["2.4.6"] ?? []).find((q) => /concision/i.test(q.fr) && /concision/i.test(q.en));
    expect(concision, "2.4.6 carries the RGAA 5.5 caption-concision question").toBeDefined();
    expect(concision!.fr).toContain("5.5");
    expect(concision!.en).toContain("aria-labelledby");
  });

  it("keys questions only onto residual (non-static) SCs, so every one actually renders in an adjudication worklist", () => {
    // 2.4.2/1.4.2/3.1.1 are STATIC (auto-decided, never residual) — a question keyed there
    // would never surface. The bank must avoid them.
    for (const sc of ["2.4.2", "1.4.2", "3.1.1"]) {
      expect(bank[sc], `${sc} is static — must not carry manual questions`).toBeUndefined();
    }
  });
});

describe("the RGAA pack ships no stringified object", () => {
  // DINUM nests bullet lists as `{ ul: [...] }`. A `String(v)` on those used to emit a
  // literal "[object Object]" into 22 normative texts across 21 criteria — silently deleting
  // sub-conditions an auditor must apply, e.g. the four cases where RGAA 3.2 is NOT
  // applicable. The builder now flattens them and fails the build if any survive.
  const pack = loadPack("rgaa");

  it("carries no placeholder text in any normative field", () => {
    const bad: string[] = [];
    for (const c of pack.criteria) {
      for (const line of [...(c.technicalNote ?? []), ...(c.particularCases ?? []), ...Object.values(c.tests ?? {}).flat()]) {
        if (String(line).includes("[object Object]")) bad.push(c.id);
      }
    }
    expect(bad).toEqual([]);
  });

  it("kept the sub-conditions that were being dropped (RGAA 3.2's non-applicability cases)", () => {
    const pc = pack.criteria.find((c) => c.id === "3.2")?.particularCases ?? [];
    expect(pc.join(" ")).toMatch(/logo/i);
    expect(pc.join(" ")).toMatch(/décorat/i);
  });
});
