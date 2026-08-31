// THE RULING RULES ARE ONE SOURCE — this test is what keeps them one.
//
// They lived in two copies, and the copies had drifted in BOTH directions. The orchestrate
// contracts carried « an NC shaped like an absence is still anchored » and « the rendered page
// may be on disk »; the Messages-API system prompt did not, and those are exactly the two
// rules measured to cost criteria on real runs (12.1 and 12.5 ruled `NC` with no `file`;
// rendering criteria answered `needs-rendered-dom` over captures sitting on disk). The system
// prompt carried « rule only on the criteria presented »; the contracts did not, and a surplus
// verdict is refused by the fold.
//
// Neither copy was the better one. So: one source, and a test that fails the moment a surface
// stops carrying a clause — because the drift was invisible for as long as nothing looked.
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verdictRulesMd, verdictSystemPrompt } from "../src/verdict-rules.js";
import { orchestrateRun } from "../src/orchestrate.js";

/** One probe per normative clause: a phrase that cannot survive the clause being dropped. */
const CLAUSES: [name: string, probe: RegExp][] = [
  ["the four verdict kinds", /`C`[\s\S]*`NC`[\s\S]*`NA`[\s\S]*`manual`/],
  ["a C needs citations", /citations\[\]/],
  ["an NC needs a groundable file", /`NC`[\s\S]{0,600}\bfile\b/],
  ["a normativeRef is the criterion's own numbered test", /normativeRef[\s\S]{0,400}WCAG id/],
  ["an absence is still anchored", /absence is OBSERVED somewhere/],
  ["the subject absent from scope is NA, never NC", /`NA`[\s\S]{0,200}never `NC`/],
  ["the rendered page may be on disk", /\.ultra11y\/pages\/<id>\//],
  ["needs-rendered-dom is refused over a capture", /`needs-rendered-dom` is refused/],
  ["never guess", /Never guess/],
  ["every worklist item gets a verdict", /exactly one verdict for EVERY criterion presented/],
  ["a run-wide NC can be a page-grid residual", /run-wide `NC`[\s\S]{0,240}page-level cells/],
  ["rule only on the criteria presented", /Rule ONLY on the criteria presented/],
  // The conformity half of the gate is only a deterrent if the adjudicator is told about it
  // BEFORE it rules. Nothing used to challenge a `C`, so a criterion cleared on presence
  // rather than on relevance shipped as an accessibility claim.
  ["a C will be attacked too", /A `C` WILL BE ATTACKED/],
  ["presence is not relevance", /a present `alt` is not a relevant `alt`/],
];

const SURFACES: [name: string, text: () => string][] = [
  ["the model-facing system prompt (api + cli backends)", () => verdictSystemPrompt()],
  ["the orchestrate contracts", () => verdictRulesMd(2)],
  [
    "the emitted adjudicator contract",
    () => {
      const run = mkdtempSync(join(tmpdir(), "ultra11y-rules-"));
      writeFileSync(
        join(run, "ADJUDICATE.todo.json"),
        JSON.stringify({
          tool: "ultra11y",
          kind: "adjudication",
          schemaVersion: 2,
          standard: "wcag",
          auditDate: "2026-08-24",
          items: [{ criteriaId: "1.1.1" }],
        }),
      );
      orchestrateRun(run, "/tmp/engine.mjs", { phase: "adjudicate", eco: true });
      return readFileSync(join(run, "orchestration", "agents", "adjudicator.md"), "utf8");
    },
  ],
];

describe("every adjudication surface states the same verdict rules", () => {
  for (const [surface, text] of SURFACES) {
    describe(surface, () => {
      for (const [clause, probe] of CLAUSES) {
        it(`carries: ${clause}`, () => {
          expect(text()).toMatch(probe);
        });
      }
    });
  }
});

describe("the numbering is the only thing that varies between surfaces", () => {
  it("renders the same clauses from any starting number", () => {
    const strip = (s: string): string => s.replace(/^\d+\. /gm, "");
    expect(strip(verdictRulesMd(1))).toBe(strip(verdictRulesMd(2)));
  });

  it("numbers consecutively from where the caller starts", () => {
    expect(
      verdictRulesMd(2)
        .split("\n")
        .filter((l) => /^\d+\. /.test(l))
        .map((l) => l.split(".")[0]),
    ).toEqual(["2", "3", "4", "5", "6", "7", "8"]);
  });
});
