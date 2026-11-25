// THE TESTED COVERAGE MATRIX (#208).
//
// Every criterion of RGAA 4.1.2 has to be reachable by at least one producer of evidence —
// static, render, snapshot, journey or judgement — or an audit can only ever leave it « à
// évaluer », or rule it on nothing. The matrix is derived from the engine's own tables
// (src/coverage-matrix.ts); this file fails the build the day a criterion loses its last path,
// a path names a subject or a rule nobody ships, or `criteria --plan` stops saying so.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUBJECTS } from "../src/adjudicate-subjects.js";
import { EVIDENCE_SOURCES, coverageMatrix, ruleSources, subjectSources } from "../src/coverage-matrix.js";
import { runCriteria } from "../src/criteria.js";
import { CROSS_RULES } from "../src/rules/cross-registry.js";
import { renderedRules } from "../src/rules/rendered.js";
import { ALL_RULES } from "../src/rules/registry.js";

const RGAA = JSON.parse(readFileSync(join(import.meta.dirname, "..", "src", "data", "standards", "rgaa.json"), "utf8")) as {
  key: string;
  rules?: { id: string }[];
  criteria: { id: string }[];
};
const KNOWN_RULES = new Set([...ALL_RULES, ...CROSS_RULES, ...renderedRules].map((r) => r.id));
const PACK_RULES = new Set((RGAA.rules ?? []).map((r) => `pack:${RGAA.key}:${r.id}`));

afterEach(() => vi.restoreAllMocks());

describe("the coverage matrix: every RGAA criterion has an evidence path", () => {
  const matrix = coverageMatrix("rgaa");
  const byId = new Map(matrix.map((m) => [m.id, m]));

  it("covers exactly the 106 criteria of src/data/standards/rgaa.json", () => {
    expect(RGAA.criteria).toHaveLength(106);
    expect(matrix.map((m) => m.id).sort()).toEqual(RGAA.criteria.map((c) => c.id).sort());
  });

  it("gives every criterion at least one path from a source that PRODUCES evidence, not judgement alone", () => {
    const pathless = RGAA.criteria.map((c) => c.id).filter((id) => !(byId.get(id)?.paths ?? []).some((p) => p.source !== "judgement"));
    expect(pathless, "criteria no producer of evidence reaches").toEqual([]);
  });

  it("only grants a judgement path where another source harvests something to judge", () => {
    for (const m of matrix) {
      if (!m.sources.includes("judgement")) continue;
      expect(
        m.paths.some((p) => p.via.startsWith("subject:")),
        `${m.id}: a judgement path with no harvest subject is a verdict on nothing`,
      ).toBe(true);
    }
  });

  it("names only subjects and rules the engine ships", () => {
    for (const m of matrix)
      for (const p of m.paths) {
        expect(EVIDENCE_SOURCES).toContain(p.source);
        if (p.via.startsWith("subject:")) expect(SUBJECTS[p.via.slice(8)], `${m.id}: ${p.via}`).toBeTypeOf("function");
        else if (p.via.startsWith("rule:")) {
          const id = p.via.slice(5);
          if (/^(?:axe:|dyn-|agent:)/.test(id) || id.endsWith("*")) continue;
          if (id.startsWith("pack:")) expect(PACK_RULES.has(id), `${m.id}: ${id}`).toBe(true);
          else expect(KNOWN_RULES.has(id), `${m.id}: ${id}`).toBe(true);
        } else expect(p.via).toBe("verify --manual");
      }
  });

  it("reaches the media criteria (4.x, 13.7) and the restitution criteria (7.x, 11.x) from a live browser", () => {
    // The media probe (media.json) feeds 4.x through `temporalMedia` and 13.7 through `flashes`;
    // the screen-reader simulation (sr.json) feeds 7.1, 7.3, 7.5 and the form criteria.
    for (const id of ["4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "13.7", "7.1", "7.3", "7.5", "11.1", "11.2", "11.10"])
      expect(byId.get(id)?.sources, id).toContain("journey");
    expect(byId.get("13.7")?.paths).toContainEqual({ source: "journey", via: "subject:flashes" });
    expect(byId.get("11.1")?.paths).toContainEqual({ source: "journey", via: "subject:sr:fields" });
    expect(byId.get("7.1")?.paths).toContainEqual({ source: "journey", via: "subject:sr:widgets" });
  });

  it("files each subject and rule under the sources that actually produce it", () => {
    expect(subjectSources("sr:fields")).toEqual(["snapshot", "journey"]);
    expect(subjectSources("doctype")).toEqual(["snapshot"]);
    // A component fragment carries no <title>: the render engine is no path to it.
    expect(subjectSources("docTitle")).toEqual(["static", "snapshot"]);
    expect(subjectSources("controls")).toEqual(["static", "render", "snapshot"]);
    expect(ruleSources("axe:label", "rgaa")).toEqual(["journey"]);
    expect(ruleSources("rendered-contrast", "rgaa")).toEqual(["snapshot"]);
  });
});

describe("criteria --plan reports the matrix", () => {
  it("--json carries the paths per criterion and an empty `pathless`", () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => void out.push(String(s)));
    expect(runCriteria({ plan: true, json: true, lang: "en", standard: "rgaa" })).toBe(0);
    const plan = JSON.parse(out.join("\n")) as { pathless: string[]; matrix: { id: string; sources: string[] }[]; sources: Record<string, { count: number }> };
    expect(plan.pathless).toEqual([]);
    expect(plan.matrix).toHaveLength(106);
    expect(Object.keys(plan.sources)).toEqual([...EVIDENCE_SOURCES]);
    expect(plan.sources.snapshot!.count).toBe(106);
  });

  it("says so in words, in French too", () => {
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((s: unknown) => void out.push(String(s)));
    runCriteria({ plan: true, lang: "fr", standard: "rgaa" });
    expect(out.join("\n")).toMatch(/Chacun des 106 critères est atteint par au moins une source de preuve/);
  });
});
