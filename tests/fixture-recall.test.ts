// THE RECALL GATE ON tests/fixtures/realworld.
//
// Every other fixture in this repository proves the engine invents nothing. This one proves it
// MISSES nothing: the site next door is seeded, page by page, with a real defect for every rule
// the engine ships, and this file fails the moment one of them stops being caught.
//
// Why a whole site rather than the per-rule snippets in tests/recall-matrix.test.ts: those
// prove each rule fires on the fragment written FOR it, hand-fed straight to `runRules`. They
// cannot see a rule that is lost between the parser, the graph, the page attribution and the
// pack projection — the path a real audit actually takes, and the only one a user ever runs.
// Measured while this fixture was built, three defects lived exactly in that gap:
//
//   · a page whose <title> is empty was silently dropped from the deliverable (src/scan.ts),
//   · a crawl followed .pdf/.docx links and spent its budget on downloads (src/crawl.ts),
//   · a native <input type="date"> was reported as a keyboard trap, and — same root cause —
//     both focus walks stopped dead at the first one (src/probes.ts).
//
// None of them was visible to a per-rule unit test, and all three were visible on the first
// full audit of a site built to fail.
//
// WHEN THIS GOES RED, the fix is almost never in this file. Either a rule regressed — fix the
// rule — or somebody made a fixture page conforming, in which case put the defect back. The
// pages say which defect they carry, in a comment above each one.
//
// The RENDERED half of the recall lives in tests/browser-tier.e2e.test.ts: contrast, focus
// visibility, reflow, text spacing, hover and the keyboard trap only exist in a browser, and a
// static test that claimed to cover them would be claiming the thing this engine refuses to
// claim anywhere else.
import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { ruleIds } from "../src/rules/registry.js";
import { crossRuleIds } from "../src/rules/cross-registry.js";
import { derivePackResults } from "../src/standards/derive.js";
import { loadPack } from "../src/standards/index.js";

const SITE = join(__dirname, "fixtures", "realworld");

/** Rules a SOURCE audit of this fixture cannot reach, each with the reason it cannot.
 *
 *  Declared, never silently subtracted: an exemption list that does not say why is how a rule
 *  stops being tested without anybody deciding that it should.
 *
 *  The five cross-file SUPPRESSORS need no entry here: `crossRuleIds()` already leaves them
 *  out, because a rule whose whole effect is to REMOVE another rule's finding can never appear
 *  in a findings list. Their absence is asserted where it means something — tests/graph-*. */
const OUT_OF_SCOPE: Record<string, string> = {
  // Browser-only. Their evidence is a rendered page, and this audit reads source.
  "rendered-contrast": "needs a snapshot's computed styles — tests/browser-tier.e2e.test.ts",
  "rendered-contrast-pixel": "needs a screenshot — tests/browser-tier.e2e.test.ts",
  "rendered-nontext-contrast": "needs a snapshot's computed styles — tests/browser-tier.e2e.test.ts",
  "rendered-link-colour-only": "needs a snapshot's computed styles — tests/browser-tier.e2e.test.ts",
  "rendered-focus-not-visible": "needs a snapshot's stylesheet rules — tests/browser-tier.e2e.test.ts",
  "rendered-orientation-lock": "needs a snapshot's stylesheet rules — tests/browser-tier.e2e.test.ts",
};

/** The pack rule that only a CAPTURE can raise: it is gated on the `doctype` signal, which a
 *  source file does not carry. `tests/fixtures/realworld/cadres.html` is served without a
 *  doctype on purpose; the browser tier is where it is asserted. */
const PACK_CAPTURE_ONLY = ["pack:rgaa:doctype-missing"];

const audit = (): ReturnType<typeof runAudit> => runAudit({ inputs: [SITE], graph: true });

describe("the recall fixture catches every rule the engine ships", () => {
  const result = audit();
  const fired = new Set([...result.findings, ...(result.packFindings ?? [])].map((f) => f.ruleId));

  it("fires every rule that a source audit of the site can reach", () => {
    // BOTH registries. `ruleIds()` is the single-file set; the cross-file rules live in their
    // own registry, and a recall gate that read only the first would silently stop covering
    // the half of the engine that needs a dependency graph.
    const expected = [...ruleIds(), ...crossRuleIds()].filter((id) => !(id in OUT_OF_SCOPE));
    const missing = expected.filter((id) => !fired.has(id));
    expect(
      missing,
      `these rules no longer fire on tests/fixtures/realworld — either the rule regressed, or the page carrying its seeded defect was made conforming: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("declares a reason for every rule it does not cover, and covers everything else", () => {
    // The exemption list may not name a rule that does not exist: a renamed rule would
    // otherwise stay "declared out of scope" forever and quietly stop being tested.
    const registered = new Set([...ruleIds(), ...crossRuleIds()]);
    const stale = Object.keys(OUT_OF_SCOPE).filter((id) => !registered.has(id));
    expect(stale, `these exempted rules are no longer registered: ${stale.join(", ")}`).toEqual([]);
    expect(Object.values(OUT_OF_SCOPE).every((why) => why.length > 20)).toBe(true);
  });

  it("raises the two cross-file findings, which need the graph and exist in neither file alone", () => {
    // Both are seeded across IconButton.tsx (the definition) and Toolbar.tsx (the usage).
    // Without `graph: true` neither can be raised — which is the point of the pair.
    expect(fired.has("cross-icon-only-unnamed")).toBe(true);
    expect(fired.has("cross-prop-drilled-name-lost")).toBe(true);
    const flat = runAudit({ inputs: [SITE] });
    const flatIds = new Set(flat.findings.map((f) => f.ruleId));
    expect(flatIds.has("cross-icon-only-unnamed"), "a cross-file rule fired without a graph").toBe(false);
    expect(flatIds.has("cross-prop-drilled-name-lost"), "a cross-file rule fired without a graph").toBe(false);
  });

  it("fires the pack's own declarative rules, save the one only a capture can raise", () => {
    const pack = loadPack("rgaa");
    const declared = (pack.rules ?? []).map((r) => `pack:rgaa:${r.id}`);
    expect(declared.length, "the RGAA pack stopped shipping declarative rules").toBeGreaterThan(0);
    const missing = declared.filter((id) => !PACK_CAPTURE_ONLY.includes(id) && !fired.has(id));
    expect(missing, `pack rules with no seeded defect on the fixture: ${missing.join(", ")}`).toEqual([]);
  });

  it("leaves the clean landing page alone — the recall fixture did not become a false-positive fixture", () => {
    // The two fixtures answer the two halves. If seeding defects next door had also started
    // raising findings on genuinely accessible markup, this is where it would show.
    const clean = runAudit({ inputs: [join(__dirname, "fixtures", "clean-landing")] });
    const blocking = [...clean.findings, ...(clean.packFindings ?? [])].filter((f) => f.severity === "bloquant" || f.severity === "majeur");
    expect(blocking, `unexpected finding on clean markup: ${JSON.stringify(blocking)}`).toHaveLength(0);
  });
});

describe("the recall fixture poses every RGAA theme", () => {
  // A referential is thirteen themes, and a fixture that fails forty criteria in three of them
  // is not an exhaustive one — it is a deep hole in a narrow place. This asserts BREADTH: each
  // theme has at least one criterion the engine can actually fail here, from source alone.
  //
  // Themes 3 and 10 are largely rendered (contrast, focus, reflow, hover), so their source-side
  // NC comes from the markup half of the theme — `contrast-literal` for 3, the presentational
  // markup RGAA 10.1 re-normativizes for 10.
  const result = audit();
  const nc = new Set(
    derivePackResults(result, "rgaa")
      .filter((c) => c.status === "NC")
      .map((c) => c.id),
  );
  const themes = new Set([...nc].map((id) => id.split(".")[0]));

  it("fails at least one criterion in each of the thirteen themes", () => {
    const all = Array.from({ length: 13 }, (_, i) => String(i + 1));
    const empty = all.filter((t) => !themes.has(t));
    expect(empty, `no criterion of theme(s) ${empty.join(", ")} is non-conforming on the fixture`).toEqual([]);
  });

  it("fails enough of the referential to be worth calling a non-conforming site", () => {
    // A ratchet, like tests/rgaa-coverage.test.ts: the number may go UP when a rule gains a
    // mapping or a defect is added, never down without somebody deciding it should.
    expect(nc.size, `only ${nc.size} RGAA criteria are non-conforming on a fixture built to fail`).toBeGreaterThanOrEqual(38);
  });
});
