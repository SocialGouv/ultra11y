// Can the rendered tier CONCLUDE, and does it refuse to when it should?
//
// src/rules/rendered.ts shipped able to fail a criterion and never able to clear one, with the
// reason stated out loud: "letting a clean measurement conclude C … needs per-rule coverage
// accounting". Measured consequence — a repository could scan thirty-eight pages and publish
// exactly what it would have published without scanning at all.
//
// The accounting is per RULE and per PAGE, and every case below exists because the difference
// between "measured somewhere" and "measured everywhere" is the difference between a verdict
// and a guess.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { untestedNeedsRendering } from "../src/report.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot, type StyleEntry } from "../src/snapshot.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-rcov-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const DOM = `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1><p>Bonjour</p></main></body></html>`;
// html, head, title, body, main, h1, p — in document order, as the browser collector emits.
const CLEAN: [string, Record<string, string>][] = [
  ["html", {}],
  ["head", {}],
  ["title", {}],
  ["body", { backgroundColor: "rgb(255, 255, 255)" }],
  ["main", {}],
  ["h1", { color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)", fontSize: "32px" }],
  ["p", { color: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)", fontSize: "16px" }],
];
const styles = (entries: [string, Record<string, string>][], truncated = false): { v: number; entries: StyleEntry[]; truncated?: boolean } => ({
  v: 1,
  entries: entries.map(([tag, css], i) => ({ i, tag, css })),
  ...(truncated ? { truncated } : {}),
});

/** Write N pages, optionally making ONE of them incomplete, then audit the lot. */
function auditPages(count: number, spoil?: (i: number) => Record<string, unknown> | undefined) {
  for (let i = 0; i < count; i++) {
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: `p${i}`, name: `P${i}`, url: `https://x/${i}` },
      dom: DOM,
      styles: styles(CLEAN),
      css: { v: 1, rules: [], unreadable: 0 },
      ...(spoil?.(i) ?? {}),
    } as Parameters<typeof writeSnapshot>[1]);
  }
  return runAudit({ inputs: [join(root, PAGES_DIR)] });
}

const of = (r: ReturnType<typeof runAudit>, sc: string) => r.criteria.find((c) => c.id === sc);

describe("a live probe is the other way a criterion gets measured", () => {
  // Zoom, reflow, text spacing, hover and focus visibility are properties of a page being
  // ACTED ON. No digest settles them, so before the probes they could only ever stay « to
  // assess » — on egapro, that was most of theme 10, run after run.
  // The full local-tier list — `src/scan-local.ts` LOCAL_TESTED_SCS. 2.1.2 joined it when the
  // keyboard-trap probe landed, and this fixture has to follow, or the banner assertion below
  // measures a sweep no runtime performs.
  const probed = { probed: ["1.4.4", "1.4.10", "1.4.12", "1.4.13", "2.1.2", "2.4.7"] };

  it("concludes C when the probe ran on every page and observed nothing", () => {
    const r = auditPages(2, () => ({ probes: probed }));
    const c = of(r, "1.4.10");
    expect(c?.status).toBe("C");
    expect(c?.decidedBy).toBe("scan");
    expect(c?.justification).toMatch(/Measured in a real browser on all 2 page/);
  });

  it("keeps it open when the probe did not run on one of the pages", () => {
    // Same AND across pages as the snapshot tier, for the same reason: the page nobody
    // probed is exactly where the failure would be.
    const r = auditPages(3, (i) => (i === 1 ? {} : { probes: probed }));
    expect(of(r, "1.4.10")?.status).toBe("manual");
  });

  it("turns what a probe OBSERVED into a non-conformity on the criterion it evidences", () => {
    const r = auditPages(2, () => ({ probes: { ...probed, reflow: { horizontalScroll: true } } }));
    expect(of(r, "1.4.10")?.status).toBe("NC");
    expect(r.findings.some((f) => f.ruleId === "dyn-reflow" && f.criteriaId === "1.4.10")).toBe(true);
  });

  it("credits only the criteria named in `probed` — silence is not a measurement", () => {
    const r = auditPages(2, () => ({ probes: { probed: ["1.4.10"] } }));
    expect(of(r, "1.4.10")?.status).toBe("C");
    expect(of(r, "1.4.12")?.status).toBe("manual");
  });

  it("counts a probe as COVERAGE, so the partial-audit banner stops naming what was measured", () => {
    // `scope.scan.testedScs` is the single coverage stamp the report reads to decide whether
    // to print « Audit partiel — les critères à restituer n'ont pas été testés ». It was fed
    // by the digest tier alone, so a sweep that probed zoom, reflow, spacing and hover on
    // every page still published that banner. Measured on egapro: testedScs came back as the
    // five digest criteria and the report told its reader nothing had been tested.
    const r = auditPages(2, () => ({ probes: probed }));
    const tested = new Set(r.scope.scan?.testedScs ?? []);
    for (const sc of ["1.4.4", "1.4.10", "1.4.12", "1.4.13", "2.1.2", "2.4.7"]) {
      expect(tested.has(sc), `${sc} was probed on every page but is absent from scope.scan.testedScs`).toBe(true);
    }
    // …and 4.1.3 is STILL named, correctly: no probe measures a live region. Deciding it
    // means clicking something and watching what gets announced, which is a mutation — the
    // probes are read-only by contract, so that one belongs to `scan --interact-clicks`. A
    // suite-driven sweep therefore closes every other one and says so about that one.
    expect(untestedNeedsRendering(r)).toEqual(["4.1.3"]);
  });

  it("still names a rendering criterion NOBODY probed", () => {
    // The other half: coverage must not become a blanket claim. A run that probed only reflow
    // has to keep saying that zoom and spacing were never tested.
    const r = auditPages(2, () => ({ probes: { probed: ["1.4.10"] } }));
    expect(untestedNeedsRendering(r)).toContain("1.4.4");
    expect(untestedNeedsRendering(r)).not.toContain("1.4.10");
  });

  it("says on how many pages it was probed, instead of failing the AND in silence", () => {
    // A criterion that stays open because 1 page of 3 was never probed reads exactly like one
    // nobody ever probed at all. The auditor needs to know which of the two it is looking at —
    // the fix is a page-by-page one, not a "turn the probes on" one.
    const r = auditPages(3, (i) => (i === 1 ? {} : { probes: probed }));
    const c = of(r, "1.4.10");
    expect(c?.status).toBe("manual");
    expect(c?.justification ?? "").toMatch(/2 of the 3 page|2 des 3 page/);
    expect(c?.justification ?? "").toMatch(/p1/);
  });
});

describe("the rendered tier concludes only what it measured everywhere", () => {
  it("concludes C, marked as MEASURED rather than judged, when every rule ran on every page", () => {
    const r = auditPages(3);
    // 1.4.1 is carried by a single rule reading computed colours, so clean styles on every
    // page is the complete measurement. (1.4.3 needs more — see the next case.)
    const c = of(r, "1.4.1");
    expect(c?.status).toBe("C");
    // The provenance is the point: a conformity the tier measured must never be presentable
    // as the same thing an agent RULED, nor as one the source-level engine proved.
    expect(c?.decidedBy).toBe("scan");
    expect(c?.justification).toMatch(/all 3 page\(s\) in scope/);
  });

  it("keeps CONTRAST open until the pixel fallback ran too — a rule that declined measured nothing", () => {
    // 1.4.3 is carried by two rules: computed colours, and a screenshot fallback for the text
    // whose backdrop is an image or a gradient, where the CSSOM has no answer. With no
    // screenshot the second declines, so part of the criterion was never looked at — and a
    // criterion that is 90% measured is not measured.
    const r = auditPages(3);
    expect(of(r, "1.4.3")?.status).toBe("manual");
  });

  it("keeps the criterion open when ONE page's signals were incomplete", () => {
    // The fold is an AND across pages. This is the case the whole accounting exists for: two
    // clean pages and one truncated collector is not "mostly measured", it is unmeasured —
    // the element that would have failed could be exactly the one that was dropped.
    const r = auditPages(3, (i) => (i === 1 ? { styles: styles(CLEAN, true) } : undefined));
    expect(of(r, "1.4.1")?.status).toBe("manual");
  });

  it("keeps the criterion open when a page carried no signals at all", () => {
    const r = auditPages(3, (i) => (i === 2 ? { styles: undefined } : undefined));
    expect(of(r, "1.4.1")?.status).toBe("manual");
  });

  it("never concludes a criterion NO rendered rule measures, however many pages are clean", () => {
    // 1.4.5 (images of text), 2.1.2 (keyboard trap), 2.3.1 (flashes), 2.4.11 (focus obscured)
    // and 2.5.8 (target size) have no rule in this tier. Their silence is not a measurement,
    // and concluding from it is precisely the failure the tier is built to refuse.
    const r = auditPages(3);
    for (const sc of ["1.4.5", "2.1.2", "2.3.1", "2.4.11", "2.5.8"]) {
      // The property is that this TIER never claims them, not that they stay undecided: a
      // criterion whose subject matter is provably absent from the source (2.3.1 on a page
      // with no animation) is legitimately closed by the applicability table, and that
      // conformity comes from an absence the engine can point at — not from a measurement.
      // What must never happen is a conformity out of SILENCE, so the test is on the source
      // of the verdict, not on its label.
      const c = of(r, sc);
      expect(c?.decidedBy, `${sc} is measured by no rendered rule`).not.toBe("scan");
      if (c?.status === "C") {
        expect(c.inapplicable, `${sc} may only be conformant here for want of a subject`).toBe(true);
        expect((c.justification ?? "").length, `${sc} must say what it looked for`).toBeGreaterThan(0);
      }
    }
  });

  it("concludes nothing at all when there is no page in scope", () => {
    const r = runAudit({ inputs: ["-"], stdin: DOM });
    expect(of(r, "1.4.1")?.status).toBe("manual");
    expect(r.criteria.some((c) => c.decidedBy === "scan")).toBe(false);
  });

  it("still lets a real failure win over the measurement", () => {
    const bad: [string, Record<string, string>][] = [
      ...CLEAN.slice(0, 6),
      ["p", { color: "rgb(200, 200, 200)", backgroundColor: "rgb(255, 255, 255)", fontSize: "16px" }],
    ];
    for (let i = 0; i < 2; i++) {
      writeSnapshot(root, {
        meta: { v: SNAPSHOT_VERSION, id: `p${i}`, name: `P${i}`, url: `https://x/${i}` },
        dom: DOM,
        styles: styles(i === 0 ? bad : CLEAN),
        css: { v: 1, rules: [], unreadable: 0 },
      } as Parameters<typeof writeSnapshot>[1]);
    }
    const r = runAudit({ inputs: [join(root, PAGES_DIR)] });
    expect(of(r, "1.4.3")?.status).toBe("NC");
    expect(of(r, "1.4.3")?.decidedBy).toBeUndefined();
  });
});
