// The published ACT conformance matrix (skills/ultra11y/references/act.md) is GENERATED
// from the vendored corpus + the current engine, exactly like references/criteria.md. This
// test fails when the committed file drifts — so the matrix can never advertise a coverage
// level the engine no longer delivers.
//
// Regenerate with: pnpm run build:act
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { ACT_DIVERGENCES_FR, ACT_NOTES_FR, ACT_RULES, renderActMatrix, type ActTestcase } from "../src/act.js";

const MATRIX = new URL("../skills/ultra11y/references/act.md", import.meta.url);
const snapshot = JSON.parse(readFileSync(new URL("../scripts/vendor/act-testcases.json", import.meta.url), "utf8")) as {
  source: string;
  testcases: ActTestcase[];
};
const rendered = renderActMatrix(snapshot.testcases, snapshot.source);

if (process.env.UPDATE_ACT_MATRIX) writeFileSync(MATRIX, rendered);

describe("references/act.md is generated, never hand-edited", () => {
  it("matches what the current engine scores", () => {
    expect(readFileSync(MATRIX, "utf8")).toBe(rendered);
  });

  it("states the precision claim and its denominator", () => {
    expect(rendered).toContain("aucun faux positif inexpliqué");
    expect(rendered).toMatch(/Exemples sains laissés intacts \| \*\*\d+ \/ \d+\*\*/);
    const en = renderActMatrix(snapshot.testcases, snapshot.source, "en");
    expect(en).toContain("no unexplained false positive");
    expect(en).toMatch(/Clean examples left alone \| \*\*\d+ \/ \d+\*\*/);
  });

  it("has a French edition of every project-authored note and divergence reason", () => {
    for (const [id, m] of Object.entries(ACT_RULES)) {
      if (m.note) expect(ACT_NOTES_FR[id], `ACT rule ${id} has an English note but no French one`).toBeTruthy();
      for (const tc of Object.keys(m.divergences ?? {}))
        expect(ACT_DIVERGENCES_FR[tc], `divergence ${id}/${tc} has no French reason`).toBeTruthy();
    }
  });
});
