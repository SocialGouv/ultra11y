// references/adjudication.md is GENERATED from src/data/adjudication.json, like
// references/criteria.md and references/act.md. This test fails when the committed file
// drifts, so the page an agent reads and the worklist it answers can never disagree.
//
// Regenerate with: pnpm run build:adjudication
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { renderAdjudicationReference } from "../src/adjudicate.js";
import { allSC } from "../src/wcag.js";

const DOC = new URL("../skills/ultra11y/references/adjudication.md", import.meta.url);
const rendered = renderAdjudicationReference("en");

if (process.env.UPDATE_ADJUDICATION_MD) writeFileSync(DOC, rendered);

describe("references/adjudication.md is generated, never hand-edited", () => {
  it("matches the current dataset", () => {
    expect(readFileSync(DOC, "utf8")).toBe(rendered);
  });

  it("documents every criterion the engine cannot decide", () => {
    for (const sc of allSC()) {
      if (sc.automatability === "static") continue;
      expect(rendered, `${sc.sc} has no section`).toContain(`### ${sc.sc} — `);
    }
  });

  it("states the two rules that govern a verdict", () => {
    expect(rendered).toContain("must cite a normative test that resolves");
    expect(rendered).toContain("is a recommendation");
  });
});
