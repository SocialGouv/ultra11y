import { describe, it, expect } from "vitest";
import { loadPack, getCriterion, listTheme, resolveGlossary } from "../src/standards/index.js";
import { hasSC, knownScStatus } from "../src/wcag.js";

// The RGAA pack is the flagship country standard derived onto the WCAG 2.2 core. Its
// dataset (13 themes / 106 criteria + glossary) must keep the exact official shape —
// this is the deep integrity gate for a pack (packs.test.ts covers the generic schema).
const rgaa = loadPack("rgaa");

describe("RGAA pack dataset integrity", () => {
  it("declares RGAA 4.1.2 mapping WCAG 2.1, fr default locale", () => {
    expect(rgaa.baseVersion).toBe("4.1.2");
    expect(rgaa.wcagVersion).toBe("2.1");
    expect(rgaa.defaultLocale).toBe("fr");
  });

  it("has 13 themes and 106 criteria", () => {
    expect(rgaa.themes.length).toBe(13);
    expect(rgaa.criteria.length).toBe(106);
  });

  it("per-theme counts sum to 106 and match the criteria list", () => {
    const sum = rgaa.themes.reduce((s, t) => s + t.count, 0);
    expect(sum).toBe(106);
    for (const t of rgaa.themes) {
      expect(listTheme(rgaa, t.number).length, `theme ${t.number}`).toBe(t.count);
    }
  });

  it("every id is well-formed, unique, and composes <theme>.<n>", () => {
    const ids = new Set<string>();
    for (const c of rgaa.criteria) {
      expect(c.id).toMatch(/^\d+\.\d+$/);
      expect(Number(c.id.split(".")[0]), `theme of ${c.id}`).toBe(c.theme);
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
    }
  });

  it("every criterion maps to ≥1 well-formed WCAG SC; any out-of-core SC is a REAL removed/AAA SC (the SC-universe classification), never an unknown/fabricated one", () => {
    for (const c of rgaa.criteria) {
      expect(c.wcag.length, `wcag of ${c.id}`).toBeGreaterThan(0);
      for (const sc of c.wcag) {
        expect(sc, `SC shape ${sc}`).toMatch(/^\d+\.\d+\.\d+$/);
        if (!hasSC(sc)) expect(knownScStatus(sc), `${c.id} → ${sc} must classify as out-of-core or removed`).toMatch(/^(out-of-core|removed)$/);
      }
    }
  });

  // THE OFFICIAL TEST METHODOLOGY, one per numbered test. This is the instrument a pack
  // criterion is adjudicated with — without it the brief falls back on the WCAG success
  // criterion's decision rule, which routinely answers a broader question. RGAA documents
  // every one of its tests, so anything short of total coverage here is a build regression
  // (a re-key bug, or a vendored file that came back truncated), not an upstream gap.
  it("every numbered test carries the standard's own methodology, and none is orphaned", () => {
    let tests = 0;
    let documented = 0;
    for (const c of rgaa.criteria) {
      const keys = Object.keys(c.tests ?? {});
      expect(keys.length, `${c.id} declares no test`).toBeGreaterThan(0);
      tests += keys.length;
      for (const k of keys) {
        const m = c.methodology?.[k];
        expect(typeof m, `methodology of ${c.id}.${k}`).toBe("string");
        expect((m ?? "").trim().length, `methodology of ${c.id}.${k} is empty`).toBeGreaterThan(0);
        documented++;
      }
      // A methodology keyed to a test the criterion does not declare would render under
      // nothing at all — the silent half of a re-key bug.
      for (const k of Object.keys(c.methodology ?? {})) {
        expect(Object.hasOwn(c.tests ?? {}, k), `${c.id} documents a test ${k} it does not declare`).toBe(true);
      }
    }
    expect(tests).toBe(258);
    expect(documented).toBe(258);
  });

  it("publishes each criterion's official page as a single-placeholder https template", () => {
    expect(rgaa.criterionUrl).toBe("https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#{id}");
  });

  it("the removed 4.1.1 Parsing (RGAA 8.1's only mapping) classifies as exactly 'removed' — strict, nothing unknown tolerated", () => {
    expect(knownScStatus("4.1.1")).toBe("removed");
    expect(knownScStatus("9.9.9")).toBeUndefined(); // a fabricated id is UNKNOWN, not a status
  });

  it("every glossary anchor referenced anywhere in a criterion (title, tests, particularCases, technicalNote) resolves in the pack glossary", () => {
    const re = /\(#([a-z0-9-]+)\)/g;
    // RGAA 5.1's technicalNote links to an in-page "descriptions techniques" section of
    // the official DINUM criterion page (not a glossary definition) — confirmed present
    // as-is in the upstream source (see scripts/verify-rgaa-source.mjs), so it is not a
    // data error and is the sole tolerated exception.
    const KNOWN_NON_GLOSSARY_ANCHORS = new Set(["5.1#table-descriptions-techniques"]);
    for (const c of rgaa.criteria) {
      const strings = [c.title.fr ?? "", ...Object.values(c.tests ?? {}).flat(), ...(c.particularCases ?? []), ...(c.technicalNote ?? [])];
      for (const s of strings) {
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(s))) {
          const anchor = m[1]!;
          if (KNOWN_NON_GLOSSARY_ANCHORS.has(`${c.id}#${anchor}`)) continue;
          expect(resolveGlossary("rgaa", anchor), `anchor #${anchor} in ${c.id}`).toBeDefined();
        }
      }
    }
  });

  it("criteria with zero WCAG techniques are exactly {12.11, 13.9, 13.11, 13.12} (RGAA's own gap, not ours)", () => {
    const noTechniques = new Set(rgaa.criteria.filter((c) => (c.techniques ?? []).length === 0).map((c) => c.id));
    expect(noTechniques).toEqual(new Set(["12.11", "13.9", "13.11", "13.12"]));
  });

  it("every criterion has at least one test", () => {
    for (const c of rgaa.criteria) {
      expect(Object.keys(c.tests ?? {}).length, `tests of ${c.id}`).toBeGreaterThan(0);
    }
  });

  it("lookups: getCriterion / listTheme", () => {
    expect(getCriterion(rgaa, "1.1")?.theme).toBe(1);
    expect(getCriterion(rgaa, "8.5")?.titlePlain.fr).toContain("titre");
    expect(rgaa.themes.find((t) => t.number === 8)?.count).toBe(10);
    expect(getCriterion(rgaa, "99.9")).toBeUndefined();
  });
});
