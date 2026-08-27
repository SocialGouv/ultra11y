// VERDICTS ARE HANDED OVER AS THEY LAND, not once the sweep is over.
//
// MEASURED, and it cost a whole paid run. A per-criterion pass reached 31 of 51 criteria in 40
// minutes, the CI job hit its 45-minute ceiling, the process was killed — and the audit came
// back with all 51 criteria still to assess. The fold only ran at the END, so 31 rulings were
// bought and thrown away.
//
// That is the exact property the per-criterion grain was introduced for: "a run cut short
// loses at most ONE criterion". It was false as first built, because isolating the model CALL
// buys nothing while the WRITE is still one all-or-nothing operation at the end.
import { describe, expect, it, vi } from "vitest";
import { isProviderUnavailableError, judgeAll, type LlmOptions, type RawVerdict } from "../src/llm.js";
import type { AdjudicationItem } from "../src/adjudicate.js";

const item = (criteriaId: string): AdjudicationItem => ({ criteriaId, evidence: [], verdict: "" }) as unknown as AdjudicationItem;
const batch = (id: string) => ({ items: [item(id)], prompt: `rule on ${id}` });
const verdict = (criteriaId: string): RawVerdict => ({ criteriaId, verdict: "manual", reason: "undecidable" }) as RawVerdict;

/** A backend that rules one batch at a time, so the ORDER of the hand-offs is observable. */
const backendFor =
  (ruled: string[]): LlmOptions["backend"] =>
  async (items) => {
    const id = items[0]?.criteriaId as string;
    ruled.push(id);
    return [verdict(id)];
  };

describe("judgeAll hands verdicts over as they land", () => {
  it("calls onVerdicts once per batch, before the sweep is over", async () => {
    const seen: string[][] = [];
    await judgeAll([batch("1.1"), batch("1.2"), batch("1.3")], {
      concurrency: 1,
      backend: backendFor([]),
      onVerdicts: (v) => seen.push(v.map((x) => x.criteriaId)),
    });
    expect(seen).toEqual([["1.1"], ["1.2"], ["1.3"]]);
  });

  // THE FAILURE THIS EXISTS FOR: a sweep that dies partway must leave behind what it ruled.
  it("has already handed over the early batches when a later one throws", async () => {
    const landed: string[] = [];
    const backend: LlmOptions["backend"] = async (items) => {
      const id = items[0]?.criteriaId as string;
      if (id === "1.3") throw new Error("killed mid-sweep");
      return [verdict(id)];
    };
    const r = await judgeAll([batch("1.1"), batch("1.2"), batch("1.3")], {
      concurrency: 1,
      backend,
      onVerdicts: (v) => landed.push(...v.map((x) => x.criteriaId)),
    });
    expect(landed, "the batches before the failure were not handed over").toEqual(["1.1", "1.2"]);
    expect(r.failures).toHaveLength(1);
    expect(r.verdicts.map((v) => v.criteriaId)).toEqual(["1.1", "1.2"]);
  });

  it("says nothing when a batch lands no verdict, rather than an empty hand-off", async () => {
    const calls = vi.fn();
    await judgeAll([batch("1.1")], { concurrency: 1, backend: async () => [], onVerdicts: calls });
    expect(calls).not.toHaveBeenCalled();
  });

  // A process-spawning backend is not bound by the same thing an HTTP one is: four `claude`
  // processes on a subscription token reach a rate limit faster than four requests do, and
  // one at a time needed ~64 minutes for 51 criteria against a 45-minute CI ceiling.
  it("honours the caller's concurrency instead of the HTTP default", async () => {
    let inFlight = 0;
    let peak = 0;
    const backend: LlmOptions["backend"] = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [];
    };
    await judgeAll(
      Array.from({ length: 8 }, (_, i) => batch(`1.${i}`)),
      { concurrency: 2, backend },
    );
    expect(peak).toBe(2);
  });

  it("still defaults to the Messages backend's cadence when nothing is asked", async () => {
    let peak = 0;
    let inFlight = 0;
    const backend: LlmOptions["backend"] = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return [];
    };
    await judgeAll(
      Array.from({ length: 8 }, (_, i) => batch(`1.${i}`)),
      { backend },
    );
    expect(peak).toBe(4);
  });

  it("stops scheduling new batches after a systemic provider failure", async () => {
    const called: string[] = [];
    const result = await judgeAll([batch("1.1"), batch("1.2"), batch("1.3")], {
      concurrency: 1,
      backend: async (items) => {
        called.push(items[0]?.criteriaId as string);
        throw new Error("api status 429");
      },
      abortOnError: isProviderUnavailableError,
    });

    expect(called).toEqual(["1.1"]);
    expect(result.failures).toContain("provider unavailable — stopped before 2 remaining batch(es)");
  });

  it("distinguishes provider saturation from a bad model response", () => {
    expect(isProviderUnavailableError(new Error("the CLI reported an error (success, api status 429)"))).toBe(true);
    expect(isProviderUnavailableError(new Error("Codex turn failed: service unavailable"))).toBe(true);
    expect(isProviderUnavailableError(new Error("invalid JSON verdict"))).toBe(false);
  });
});
