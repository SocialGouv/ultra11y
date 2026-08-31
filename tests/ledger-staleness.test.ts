// WHAT A STORED VERDICT SURVIVES, AND WHAT IT MUST NOT.
//
// The ledger existed so a judgment criterion could stay decided without paying a model again.
// On a living application it amortised nothing: `evidenceFingerprint` hashes the COMPLETE
// evidence set, so ONE snippet moving on ONE of thirty-seven pages expired the whole verdict.
// Measured on egapro, replaying the committed 48-entry ledger against the run of 31/08: 27 of
// 48 entries stale — every entry carrying twenty anchors or more.
//
// The relaxation is one sentence, and it is a WEAKENING of a guarantee, so it is spelled out
// here before it is trusted anywhere: a `C` says « everything I saw is conforming », so if
// today's evidence is a SUBSET of what was whitened, the verdict still covers it — whitening a
// set covers its parts. What must expire it is evidence that is NEW: code the adjudicator
// never read.
//
// Two guards keep that from becoming a laundering machine, and both exist because the failure
// they prevent is a false « conforme » rather than a wasted dollar:
//   • an incomplete harvest is not a shrunken codebase. A run whose page captures are missing
//     harvests a strictly smaller set, and « subset ⇒ still valid » would replay every verdict
//     as if those pages had been read. `unreadableCaptures` already names that trap;
//   • the fold is unchanged. Citations are still re-grounded and refused, coverage is still
//     checked. What is relaxed is only « the evidence set is byte-identical ».
import { describe, expect, it } from "vitest";

import type { Evidence } from "../src/adjudicate.js";
import { evidenceFingerprint, type LedgerEntry, verdictStillHolds } from "../src/ledger.js";

const ev = (file: string, line: number, snippet: string): Evidence => ({ file, line, selector: "div", snippet });

const A = ev("src/a.tsx", 1, "<div>alpha</div>");
const B = ev("src/b.tsx", 2, "<div>beta</div>");
const C = ev("src/c.tsx", 3, "<div>gamma</div>");

function entry(verdict: LedgerEntry["verdict"], evidence: Evidence[], extra: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    criteriaId: "10.3",
    verdict,
    evidenceFingerprint: evidenceFingerprint(evidence),
    evidenceAnchors: evidenceAnchorsOf(evidence),
    evidenceFiles: evidenceFilesOf(evidence),
    evidenceCount: evidence.length,
    date: "2026-08-24",
    decidedBy: "agent",
    ...extra,
  };
}

// Re-exported by the module under test; imported here separately so the fixture reads plainly.
import { evidenceAnchorsOf, evidenceFilesOf } from "../src/ledger.js";

const whole = { harvestComplete: true };

describe("a conformity survives what it already covered", () => {
  it("holds when the evidence is unchanged", () => {
    expect(verdictStillHolds(entry("C", [A, B, C]), [A, B, C], whole).holds).toBe(true);
  });

  it("holds when the evidence SHRANK — whitening a set covers its parts", () => {
    // `src/c.tsx` was deleted, which is why it contributes nothing now.
    const r = verdictStillHolds(entry("C", [A, B, C]), [A, B], { ...whole, fileExists: () => false });
    expect(r.holds).toBe(true);
  });

  it("EXPIRES the moment something new appears", () => {
    const r = verdictStillHolds(entry("C", [A, B]), [A, B, C], whole);
    expect(r.holds).toBe(false);
    expect(r.holds === false && r.why).toMatch(/1 /);
  });

  it("expires on an EDITED snippet, which is a removal and an addition at once", () => {
    const edited = ev("src/b.tsx", 2, "<div>beta rewritten</div>");
    expect(verdictStillHolds(entry("C", [A, B]), [A, edited], whole).holds).toBe(false);
  });

  it("treats a criterion conforming for want of a subject the same way", () => {
    expect(verdictStillHolds(entry("NA", [A, B]), [A], whole).holds).toBe(true);
    expect(verdictStillHolds(entry("NA", [A]), [A, B], whole).holds).toBe(false);
  });
});

describe("a non-conformity holds while its cited constat is there", () => {
  it("does not expire merely because new code appeared — more code cannot un-fail it", () => {
    expect(verdictStillHolds(entry("NC", [A]), [A, B, C], whole).holds).toBe(true);
  });
});

describe("the guards, which are why this is not a laundering machine", () => {
  it("refuses the subset rule when the run's harvest is INCOMPLETE", () => {
    // A checkout with no `.ultra11y/pages` harvests strictly less. Reading that as « the code
    // shrank » would replay every page verdict as if those pages had been audited — the exact
    // false conformity `unreadableCaptures` was written to name.
    const r = verdictStillHolds(entry("C", [A, B, C]), [A, B], { harvestComplete: false });
    expect(r.holds).toBe(false);
    expect(r.holds === false && r.why).toMatch(/capture|harvest|incomplet/i);
  });

  it("checks the harvest BEFORE the byte-identical fast path, not after it", () => {
    // The guard sat below the fingerprint check, so the one case it exists for walked straight
    // past it: a declared capture goes missing, it happened to contribute no anchor to THIS
    // criterion, the remaining anchors hash the same — and the verdict was replayed out of a
    // harvest the run itself reports as incomplete.
    const e = entry("C", [A, B]);
    expect(verdictStillHolds(e, [A, B], whole).holds, "identical evidence, complete harvest").toBe(true);
    const r = verdictStillHolds(e, [A, B], { harvestComplete: false });
    expect(r.holds, "identical evidence is not identical when the run could not read everything").toBe(false);
    expect(r.holds === false && r.why).toMatch(/INCOMPLETE/);
  });

  it("refuses a shrinkage no deletion explains", () => {
    // « Nothing new appeared » is half a licence. Evidence also gets smaller when the run
    // failed to READ a file the verdict was ruled against — a path out of scope, a glob that
    // stopped matching — and that is a coverage hole wearing the costume of a deletion.
    const e = entry("C", [A, B, C]);
    const stillOnDisk = (f: string) => f === "src/c.tsx";
    const r = verdictStillHolds(e, [A, B], { harvestComplete: true, fileExists: stillOnDisk });
    expect(r.holds).toBe(false);
    expect(r.holds === false && r.why).toMatch(/src\/c\.tsx/);
  });

  it("accepts the same shrinkage once the file is really gone", () => {
    const e = entry("C", [A, B, C]);
    expect(verdictStillHolds(e, [A, B], { harvestComplete: true, fileExists: () => false }).holds).toBe(true);
  });

  it("survives a corrupt anchor field instead of throwing on it", () => {
    // `isLedger` validates the envelope, not every field. An entry carrying a number here used
    // to reach `.split()` and take the whole replay down with it.
    const broken = { ...entry("C", [A, B]), evidenceAnchors: 42 as unknown as string };
    expect(verdictStillHolds(broken, [A], whole).holds).toBe(false);
  });

  it("does not accept a verdict over NOTHING, even though zero is a subset of everything", () => {
    // This guard was written, then removed on the argument that the fold's citation gate would
    // catch it anyway, then put back the same hour: driven end to end, a `C` replayed onto a
    // criterion whose evidence had gone to nothing was published as an agent conformity,
    // citation gate and all (tests/ledger.test.ts). « Nobody looked » and « nothing left to
    // fail » are not the same claim, and only one of them belongs in a conformance report.
    expect(verdictStillHolds(entry("C", [A, B]), [], whole).holds).toBe(false);
  });

  it("keeps the old strict rule for an entry recorded before anchors were stored", () => {
    const legacy = { ...entry("C", [A, B, C]), evidenceAnchors: undefined };
    expect(verdictStillHolds(legacy, [A, B, C], whole).holds).toBe(true);
    expect(verdictStillHolds(legacy, [A, B], whole).holds).toBe(false);
  });
});
