// THE GROUND TRUTH, CRITERION BY CRITERION (issue #65).
//
// Everything else in this suite pins a MECHANISM: which tier a test sits in, which rule fires
// on which seed, which subject a criterion harvests. Nothing pinned what an audit CONCLUDES on
// a page whose truth is known — and that is how five wrong « non applicable » (8.2, 10.11,
// 10.12, 12.8, 13.9) reached a signed report without any test going red.
//
// tests/fixtures/rgaa-golden/ holds two pages and, for each, the verdict a human auditor gives
// all 106 RGAA 4.1.2 criteria, with the official test it rests on:
//
//   non-conforme.html  a municipal workshop page carrying one or more real defects for every
//                      criterion that can fail on a single page, with a real image, a real
//                      video (speech + on-screen text) and a real audio file;
//   conforme.html      its twin with every defect fixed and the subjects kept, so a criterion
//                      that was NC there is C here, not quietly NA.
//
// The engine is held to that truth on everything it DECIDES, in the three shapes it reads a
// page: the source file; a bare capture (.ultra11y/pages snapshot, which records the doctype);
// and the capture a real browser made (rendered/, recorded by scripts/record-rgaa-golden.mjs,
// with computed styles, axe and the live probes — the rendered tier, audited offline). It may
// leave a criterion open (`manual`) — that is the adjudicator's work — but:
//   1. a criterion it decides must carry the expected verdict;
//   2. an expected NC is never C or NA;
//   3. it never says NA — not even a provisional one, which the adjudicator reads as a hint —
//      where the truth is C, NC or « undeterminable »;
//   4. a criterion it hands to the adjudicator, and that is not NA, arrives with something to
//      cite: an empty harvest leaves the adjudicator only NA or « undecidable » to choose from,
//      which is exactly how the five wrong NAs above were written.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist } from "../src/adjudicate.js";
import { derivePackResults, type PackCriterionResult } from "../src/standards/derive.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

const DIR = join(import.meta.dirname, "fixtures", "rgaa-golden");
type Verdict = "C" | "NC" | "NA" | "manual";
interface Golden {
  page: string;
  criteria: Record<string, { verdict: Verdict; test: string; reason: string }>;
}
const GOLDEN_PAGES = ["non-conforme", "conforme"] as const;
const readGolden = (name: string): Golden => JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), "utf8")) as Golden;

/** What the engine PUBLISHES for a criterion, or `undefined` when it leaves it open. A
 *  provisional absence (`judgment`) is still an NA claim: the adjudicator receives it as the
 *  engine's answer, and #61's wrong NAs were exactly an adjudicator agreeing with one. */
function engineVerdict(r: PackCriterionResult): Exclude<Verdict, "manual"> | undefined {
  if (r.status === "NC") return "NC";
  if (r.status === "C") return r.inapplicable ? "NA" : "C";
  return undefined;
}

interface Run {
  shape: string;
  audit: AuditResult;
  cwd: string;
}

const roots: string[] = [];
function tmp(): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-golden-"));
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** The page as a source file, audited where it sits next to its media. */
function sourceRun(name: string): Run {
  const root = tmp();
  cpSync(DIR, root, { recursive: true });
  return { shape: "source", audit: runAudit({ inputs: [join(root, `${name}.html`)] }), cwd: root };
}

/** The page as a capture: documentElement.outerHTML (no doctype) with the doctype recorded
 *  beside it, which is what `scan`/the e2e helpers write. */
function captureRun(name: string): Run {
  const root = tmp();
  const src = readFileSync(join(DIR, `${name}.html`), "utf8");
  const doctype = /^\s*<!doctype[^>]*>/i.exec(src)?.[0] ?? "";
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: name, name, url: `https://villeneuve.example/${name}`, doctype },
    dom: src.replace(/^\s*<!doctype[^>]*>/i, ""),
  });
  return { shape: "capture", audit: runAudit({ inputs: [join(root, PAGES_DIR)] }), cwd: root };
}

const RENDERED = join(DIR, "rendered", PAGES_DIR);

/** The capture a real browser made of the page (scripts/record-rgaa-golden.mjs): computed
 *  styles, boxes, axe and the live probes — the rendered tier, audited offline. */
function renderedRun(name: string): Run {
  return { shape: "rendered", audit: runAudit({ inputs: [join(RENDERED, `${name}-html`)] }), cwd: DIR };
}

/** Where the engine still disagrees with the ground truth, each with the reason it is not fixed.
 *  Keys are `<page> <shape> <criterion> <verdict|evidence>`. An entry that stops happening fails
 *  the last test below, so this list can only shrink. */
const SHAPES = ["source", "capture", "rendered"] as const;
const gap = (page: string, shapes: readonly string[], ids: string[], kind: "verdict" | "evidence", why: string): [string, string][] =>
  shapes.flatMap((shape) => ids.map((id): [string, string] => [`${page} ${shape} ${id} ${kind}`, why]));
const KNOWN_GAPS = new Map<string, string>([
  ...gap("non-conforme", SHAPES, ["9.3"], "verdict", "`lists` sees <ul>/<ol>/<dl> only: a <br>-built bullet list proves no list absent"),
  ...gap("non-conforme", SHAPES, ["13.3"], "verdict", "`downloadDocs` knows pdf/doc/xls only: an .odt is « nothing to download »"),
  ...gap("non-conforme", SHAPES, ["13.3"], "evidence", "same: the .odt link is not harvested"),
  ...gap("conforme", SHAPES, ["13.3", "13.4"], "verdict", "same: the .odt link is not harvested"),
  ...gap("conforme", SHAPES, ["13.3", "13.4"], "evidence", "same: the .odt link is not harvested"),
  ...gap("conforme", SHAPES, ["6.2"], "verdict", "link-empty-name ignores an <svg role=img aria-label> inside the link"),
  ...gap("conforme", SHAPES, ["13.11"], "verdict", "2.5.2 closes on « no down-event handler », which is not « no pointer action »"),
  ...gap("non-conforme", SHAPES, ["7.5"], "evidence", "`liveRegions` harvests marked-up regions only: an unmarked status target is invisible"),
  ...gap("non-conforme", ["source"], ["8.1"], "evidence", "`doctype` harvests nothing when a source file has no doctype"),
  ...gap("non-conforme", ["source", "capture"], ["10.4", "10.11", "13.9"], "evidence", "`readingOrder` stands in for zoom, reflow and orientation"),
  ...gap("conforme", SHAPES, ["10.4", "10.11", "10.12", "13.9"], "evidence", "`readingOrder` stands in for zoom, reflow, spacing and orientation"),
  ...gap("conforme", SHAPES, ["10.1", "10.5"], "evidence", "no stylesheet is harvested for 10.1/10.5"),
  ...gap("conforme", SHAPES, ["10.9", "10.10"], "evidence", "`sensoryText` harvests only the instructions that fail"),
  ...gap("conforme", SHAPES, ["3.2"], "evidence", "`colourPairs` reads inline colours only"),
  ...gap("conforme", ["source", "capture"], ["3.3"], "evidence", "`colourPairs` reads inline colours only"),
  ...gap("conforme", SHAPES, ["13.10", "13.11", "13.12"], "evidence", "`pointerHandlers` skips native controls and addEventListener gestures"),
]);

const observed = new Set<string>();
function unexplained(keys: string[]): string[] {
  for (const k of keys) observed.add(k);
  return keys.filter((k) => !KNOWN_GAPS.has(k));
}

describe("RGAA golden grids", () => {
  it("each grid gives a verdict, a test and a reason for all 106 criteria", () => {
    const ids = loadPack("rgaa").criteria.map((c) => c.id);
    for (const name of GOLDEN_PAGES) {
      const g = readGolden(name);
      expect(Object.keys(g.criteria).sort()).toEqual([...ids].sort());
      for (const [id, row] of Object.entries(g.criteria)) {
        expect(["C", "NC", "NA", "manual"], `${name} ${id}`).toContain(row.verdict);
        expect(row.test.startsWith(`${id}.`), `${name} ${id}: test ${row.test}`).toBe(true);
        expect(row.reason.trim().length, `${name} ${id}`).toBeGreaterThan(10);
      }
    }
  });

  it("the twin keeps every subject: a criterion NC on the bad page is never NA on the good one", () => {
    const bad = readGolden("non-conforme").criteria;
    const good = readGolden("conforme").criteria;
    // The two exceptions are designed, and named so a third one cannot slip in: the conforming
    // page shows its help bubble on activation, so there is no hover/focus content left to
    // judge, and nothing on it flashes, moves or refreshes.
    const designed = new Set(["10.13", "10.14", "4.10", "13.1", "13.7", "13.8"]);
    const lost = Object.keys(bad).filter((id) => bad[id]!.verdict === "NC" && good[id]!.verdict === "NA" && !designed.has(id));
    expect(lost).toEqual([]);
  });

  for (const name of GOLDEN_PAGES) {
    describe(name, () => {
      const golden = readGolden(name);
      let runs: Run[];
      beforeAll(() => {
        runs = [sourceRun(name), captureRun(name), renderedRun(name)];
      });

      it("the rendered recording is of the page as it is now", () => {
        const meta = JSON.parse(readFileSync(join(RENDERED, `${name}-html`, "meta.json"), "utf8")) as { notes?: string };
        const sha = createHash("sha256")
          .update(readFileSync(join(DIR, `${name}.html`)))
          .digest("hex");
        expect(meta.notes, "re-record with `node scripts/record-rgaa-golden.mjs`").toBe(`source sha256 ${sha}`);
      });

      it("every criterion the engine decides carries the expected verdict, and an expected NC is never C or NA", () => {
        const wrong: string[] = [];
        for (const run of runs) {
          for (const r of derivePackResults(run.audit, "rgaa")) {
            const got = engineVerdict(r);
            const want = golden.criteria[r.id]!;
            if (got !== undefined && got !== want.verdict) wrong.push(`${name} ${run.shape} ${r.id} verdict`);
          }
        }
        expect(unexplained(wrong)).toEqual([]);
      });

      it("every criterion handed to the adjudicator, and not NA, arrives with evidence to cite", () => {
        const empty: string[] = [];
        for (const run of runs) {
          for (const item of buildAdjudicationWorklist(run.audit, { cwd: run.cwd, standard: "rgaa" })) {
            // « Undeterminable from one page » is answered `manual undecidable`, which needs nothing.
            if (["NA", "manual"].includes(golden.criteria[item.criteriaId]!.verdict)) continue;
            if (item.evidence.length === 0) empty.push(`${name} ${run.shape} ${item.criteriaId} evidence`);
          }
        }
        expect(unexplained(empty)).toEqual([]);
      });
    });
  }

  it("no known gap is listed that no longer happens (the ratchet only tightens)", () => {
    expect([...KNOWN_GAPS.keys()].filter((k) => !observed.has(k))).toEqual([]);
  });
});
