// PERF SHAPE guard. Not a benchmark: absolute timings vary far too much across machines
// and CI runners to assert on. What IS stable is the *shape* of the cost curve — quadratic
// work grows ~16x when the input grows 4x, linear work grows ~4x.
//
// Rather than compare against a fixed threshold (which a loaded runner blows through), each
// suspect curve is measured against a CONTROL curve of ordinary markup taken in the same
// run, on the same machine, under the same load. Machine speed, JIT warm-up and background
// noise cancel out; only a genuinely different complexity class survives.
//
// This is what pins the `label-for-dangling` regression: a full `doc.elements.some(...)`
// scan nested inside the label loop cost 2.0 s at 4k labels and 7.9 s at 8k (O(n^1.83)),
// while ordinary markup stayed linear.
import { describe, it, expect } from "vitest";
import { parseSource } from "../src/parse/source.js";
import { runRules } from "../src/rules/registry.js";

const SMALL = 2000;
const LARGE = 8000; // 4x

/** A page with `n` labels whose `for` targets nothing, plus `n` unrelated fields. */
function danglingLabels(n: number): string {
  let h = '<!doctype html><html lang="en"><head><title>t</title></head><body><main>';
  for (let i = 0; i < n; i++) h += `<label for="missing_${i}">L${i}</label><input type="text" name="n${i}">`;
  return `${h}</main></body></html>`;
}

/** A page with `n` ordinary sections — the control curve, comparable in element count. */
function plainMarkup(n: number): string {
  let h = '<!doctype html><html lang="en"><head><title>t</title></head><body><main>';
  for (let i = 0; i < n; i++) h += `<section><h2>H${i}</h2><p>Paragraph ${i}</p><a href="/p${i}">Link ${i}</a></section>`;
  return `${h}</main></body></html>`;
}

/** Median wall time of `runs` audits of `html`, after one discarded warm-up run. */
function timeAudit(html: string, runs = 5): number {
  runRules(parseSource(html, "perf.html")); // warm-up, not measured
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    runRules(parseSource(html, "perf.html"));
    samples.push(performance.now() - t0);
  }
  return samples.sort((a, b) => a - b)[Math.floor(runs / 2)]!;
}

/** How much the cost multiplies when the input goes from SMALL to LARGE (4x). */
function growth(build: (n: number) => string): number {
  const small = timeAudit(build(SMALL));
  const large = timeAudit(build(LARGE));
  return large / Math.max(small, 1);
}

describe("perf shape — rule execution must not be quadratic in element count", () => {
  it("keeps the dangling-label curve in the same complexity class as ordinary markup", () => {
    const control = growth(plainMarkup);
    const suspect = growth(danglingLabels);
    // Quadratic-vs-linear is a ~4x difference in growth at this input ratio. A 3x limit
    // leaves room for the constant-factor differences between two shapes of markup while
    // still failing loudly on a re-introduced nested scan.
    expect(
      suspect / control,
      `dangling labels grew ${suspect.toFixed(1)}x vs ${control.toFixed(1)}x for ordinary markup (${SMALL} -> ${LARGE} labels)`,
    ).toBeLessThan(3);
  });

  it("keeps ordinary markup itself sub-quadratic", () => {
    const g = growth(plainMarkup);
    expect(g, `4x the markup cost ${g.toFixed(1)}x the time`).toBeLessThan(10);
  });
});
