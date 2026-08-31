// A PROBE THAT STOPPED HALFWAY MUST NOT SAY IT MEASURED THE PAGE.
//
// `probed` is the field that licenses conformity: `renderedProvesOn` reads it to decide
// whether an empty hit list may be read as « nothing wrong here ». Both walks of the tab ring
// cut themselves short in three ordinary ways — the setup pass stops tagging at
// `maxFocusables`, the wall-clock budget runs out mid-ring, and the hit caps stop the
// recording — and all three used to return their partial result as if it were the whole page,
// after which 2.4.7, 2.4.11 and 2.1.2 were credited for a ring nobody finished crossing.
//
// The vocabulary for saying so already existed: `skipped: { sc, why }[]`, whose own comment
// describes this exact defect. These tests hold the two apart.
import { describe, expect, it } from "vitest";

import { PROBE_DEFAULTS, probeDeadline, probeFocusRing, probeKeyboardTrapRing, runLiveProbes } from "../src/probes.js";

/** A page whose tab ring is a script. `ring[i]` is what the check probe reports after the
 *  i-th Tab: a key, or null when focus is nowhere in the tagged ring. */
function focusPage(count: number, ring: (string | null)[], changed = true, obscured = false) {
  let i = 0;
  return {
    keyboard: {
      press: async (k: string) => {
        if (k === "Tab") i++;
      },
    },
    evaluate: async (expr: string) => {
      if (expr.includes("const focusables")) return count; // setup pass → how many were tagged
      // 2.4.11 — whether a fixed overlay covers the focused component
      if (expr.includes("overlay:")) return obscured ? { key: "k", selector: "#k", html: "<a>", overlay: "header.sticky" } : null;
      if (expr.includes("changed:")) {
        const key = ring[Math.min(i, ring.length) - 1] ?? null;
        return key === null ? null : { key, changed, selector: `#${key}`, html: `<button id="${key}">` };
      }
      return null;
    },
  };
}

/** The same script, in the shape `FOCUS_WHERE_PROBE` returns it. */
function trapPage(count: number, ring: (string | null)[]) {
  let i = 0;
  return {
    keyboard: {
      press: async (k: string) => {
        if (k === "Tab") i++;
      },
    },
    evaluate: async (expr: string) => {
      if (expr.includes("const focusables")) return count;
      const key = ring[Math.min(i, ring.length) - 1] ?? null;
      return key === null ? null : { key, tagged: true, selector: `#${key}`, html: `<button id="${key}">`, segments: 1 };
    },
  };
}

const spent = () => probeDeadline(0);

describe("the focus walk says whether it crossed the whole ring", () => {
  it("is complete when the ring wraps round to an element already visited", async () => {
    const r = await probeFocusRing(focusPage(3, ["a", "b", "c", "a"]));
    expect(r.complete).toBe(true);
    expect(r.why).toBeUndefined();
  });

  it("is INCOMPLETE when the setup pass stopped tagging at the focusable cap", async () => {
    // 120 tagged out of however many the page really has: everything past the cap was never
    // focused, never compared, and nothing said so.
    const r = await probeFocusRing(focusPage(PROBE_DEFAULTS.maxFocusables, ["a", "b", "a"]));
    expect(r.complete).toBe(false);
    expect(r.why ?? "").toMatch(/120/);
  });

  it("is INCOMPLETE when the budget ran out mid-ring", async () => {
    const r = await probeFocusRing(focusPage(50, ["a", "b", "c", "a"]), "", PROBE_DEFAULTS, spent());
    expect(r.complete).toBe(false);
    expect(r.why ?? "").toMatch(/budget|deadline/i);
  });

  it("is INCOMPLETE when the recording caps stopped the walk early", async () => {
    // Every stop fails both questions, so both hit lists fill up and the walk breaks on the
    // caps rather than on the ring closing. Enough was found to fail the page — not enough to
    // clear the forty stops nobody reached.
    const ring = Array.from({ length: 60 }, (_, i) => `k${i}`);
    const r = await probeFocusRing(focusPage(60, ring, false, true));
    expect(r.visible.length).toBe(20);
    expect(r.obscured.length).toBe(20);
    expect(r.complete).toBe(false);
    expect(r.why ?? "").toMatch(/cap/);
  });
});

describe("the keyboard-trap walk says the same thing", () => {
  it("is complete when focus leaves the page at the end of the ring", async () => {
    const r = await probeKeyboardTrapRing(trapPage(3, ["a", "b", "c", null]));
    expect(r.hits).toEqual([]);
    expect(r.complete).toBe(true);
  });

  it("is complete when the ring wraps round", async () => {
    expect((await probeKeyboardTrapRing(trapPage(3, ["a", "b", "c", "a"]))).complete).toBe(true);
  });

  it("is INCOMPLETE when the setup pass stopped tagging at the cap", async () => {
    const r = await probeKeyboardTrapRing(trapPage(PROBE_DEFAULTS.maxFocusables, ["a", "b", null]));
    expect(r.complete).toBe(false);
  });

  it("is INCOMPLETE when the budget ran out mid-ring", async () => {
    const r = await probeKeyboardTrapRing(trapPage(10, ["a", "b", null]), PROBE_DEFAULTS, spent());
    expect(r.complete).toBe(false);
  });
});

describe("runLiveProbes credits `probed` only for a walk that finished", () => {
  /** A page object complete enough for the whole pass, whose tab ring is capped. */
  function cappedPage() {
    const base = focusPage(PROBE_DEFAULTS.maxFocusables, ["a", "b", "a"]);
    return {
      ...base,
      viewportSize: () => ({ width: 1280, height: 900 }),
      setViewportSize: async () => {},
      addStyleTag: async () => ({}),
      hover: async () => {},
      waitForTimeout: async () => {},
      mouse: { move: async () => {} },
    };
  }

  it("withholds 2.4.7, 2.4.11 and 2.1.2 when the ring was truncated, and says why", async () => {
    const r = await runLiveProbes(cappedPage(), { only: ["2.4.7", "2.4.11", "2.1.2"] });
    expect(r.probed).toEqual([]);
    const skipped = Object.fromEntries((r.skipped ?? []).map((s) => [s.sc, s.why]));
    for (const sc of ["2.4.7", "2.4.11", "2.1.2"]) {
      expect(skipped[sc], `${sc} was neither probed nor explained`).toMatch(/\S/);
    }
  });

  it("still credits them on a page whose ring it crossed whole", async () => {
    const base = focusPage(3, ["a", "b", "c", "a"]);
    const page = {
      ...base,
      viewportSize: () => ({ width: 1280, height: 900 }),
      setViewportSize: async () => {},
      addStyleTag: async () => ({}),
      hover: async () => {},
      waitForTimeout: async () => {},
      mouse: { move: async () => {} },
    };
    const r = await runLiveProbes(page, { only: ["2.4.7", "2.4.11"] });
    expect(r.probed.sort()).toEqual(["2.4.11", "2.4.7"]);
  });
});
