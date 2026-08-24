// `runLiveProbes` — the measurements a recorded snapshot can never settle, run on a page
// somebody else owns.
//
// The contract that matters is not what they find, it is what they PUT BACK. A suite calling
// this must get its page as it left it, or the assertion it runs next is measuring our
// leftovers: a viewport still at 320px, a text-spacing stylesheet still injected. So these
// tests drive a fake page and check the housekeeping, plus the one property the audit relies
// on — `probed` names the criteria that were actually looked at, because an empty hit list is
// evidence only for those.
import { describe, expect, it } from "vitest";

import { runLiveProbes } from "../src/probes.js";

/** The smallest thing shaped like a Playwright page. Records what was done to it. */
function fakePage(overrides: Record<string, unknown> = {}) {
  const log: string[] = [];
  let size = { width: 1280, height: 900 };
  const page = {
    log,
    viewportSize: () => size,
    setViewportSize: async (s: { width: number; height: number }) => {
      size = s;
      log.push(`viewport:${s.width}x${s.height}`);
    },
    addStyleTag: async () => {
      log.push("style:add");
      return {};
    },
    hover: async () => {
      log.push("hover");
    },
    waitForTimeout: async () => {},
    keyboard: {
      press: async (k: string) => {
        log.push(`key:${k}`);
      },
    },
    mouse: { move: async () => {} },
    evaluate: async (script: string) => {
      if (script.includes("letter-spacing: 0.12em") && script.includes("remove")) {
        log.push("style:remove");
        return true;
      }
      if (script.includes("horizontalScroll")) return { horizontalScroll: false };
      if (script.includes("data-u11y-h")) return [];
      if (script.includes("__u11yF")) return 0;
      return [];
    },
    ...overrides,
  };
  return page;
}

describe("runLiveProbes", () => {
  it("names the criteria it actually probed", async () => {
    const r = await runLiveProbes(fakePage());
    // 2.4.11 rides the SAME walk of the tab ring as 2.4.7 — both ask about the element that
    // has focus at that moment — so it is probed whenever the ring is walked, and recorded
    // separately so an empty result reads as « measured, nothing found » rather than « never
    // measured ».
    expect(r.probed.sort()).toEqual(["1.4.10", "1.4.12", "1.4.13", "1.4.4", "2.1.2", "2.4.11", "2.4.7"]);
  });

  it("restores the caller's viewport after narrowing it to 320px", async () => {
    const page = fakePage();
    await runLiveProbes(page);
    expect(page.log).toContain("viewport:320x900");
    expect(page.log[page.log.length - 1]).not.toBe("viewport:320x900");
    expect(page.viewportSize()).toEqual({ width: 1280, height: 900 });
  });

  it("removes the text-spacing stylesheet it injected", async () => {
    const page = fakePage();
    await runLiveProbes(page);
    expect(page.log).toContain("style:add");
    expect(page.log).toContain("style:remove");
  });

  it("runs only the criteria asked for", async () => {
    const page = fakePage();
    const r = await runLiveProbes(page, { only: ["1.4.10"] });
    expect(r.probed).toEqual(["1.4.10"]);
    // …and touches nothing the other probes would have touched.
    expect(page.log).not.toContain("style:add");
    expect(page.log.some((l) => l.startsWith("key:"))).toBe(false);
  });

  it("records WHY a probe did not run, instead of losing it", async () => {
    // The whole point. A measurement that vanishes silently is indistinguishable from a page
    // with nothing wrong: the criterion sits at « to assess » run after run, and nobody can
    // tell whether it was measured and clean or never measured at all. On a real CI run that
    // is exactly what happened — the probes threw, the catch swallowed it, and five criteria
    // stayed undecided with no trace of why.
    const page = fakePage({
      setViewportSize: async () => {
        throw new Error("viewport is fixed in this context");
      },
    });
    const r = await runLiveProbes(page);
    expect(r.probed).not.toContain("1.4.10");
    expect(r.skipped?.find((s) => s.sc === "1.4.10")?.why).toMatch(/viewport is fixed/);
  });

  it("keeps going when one probe throws — a measurement lost is not a page lost", async () => {
    // The guard that matters in a suite: a probe failing must cost its own criterion, never
    // the snapshot and never the caller's test.
    const page = fakePage({
      addStyleTag: async () => {
        throw new Error("no style tags in this runtime");
      },
    });
    const r = await runLiveProbes(page);
    expect(r.probed).toContain("1.4.10");
    expect(r.textSpacing).toEqual([]);
  });
});

describe("the bounds belong to the repository, not to the tool", () => {
  it("narrows to the width the caller asked for", async () => {
    const page = fakePage();
    await runLiveProbes(page, { limits: { reflowWidth: 360 } });
    expect(page.log).toContain("viewport:360x900");
  });

  it("keeps the engine default for anything the caller left alone", async () => {
    // A config that sets one number must not silently reset the others — the trap every
    // partial-override reader falls into.
    const page = fakePage();
    await runLiveProbes(page, { limits: { maxHits: 3 } });
    expect(page.log).toContain("viewport:320x900");
  });
});

// ---- the caller's test clock is not ours to spend ----------------------------------------
//
// Measured on a real CI run (SocialGouv/egapro, Playwright trace of the a11y sweep): the
// probes ran for 3.6s, called `page.hover()` on a trigger that never became actionable, and
// never came back. Playwright's default action timeout is 0 — *wait forever* — so the hover
// blocked until the caller's own 120s test timeout killed the test. The `try/catch` around it
// never fired, because nothing ever rejected. Two specs died that way, and being in a serial
// group they took 15 more tests with them: 15 of the 35 pages of the RGAA sample vanished
// from the report, every run.
//
// So: every interaction carries its own timeout, and the whole pass carries a wall-clock
// budget. What the budget cuts short is RECORDED — a measurement that did not happen must say
// so, never read as a measurement that found nothing.
describe("the probes never outlive the budget they were given", () => {
  /** A trigger that is never actionable: Playwright would block here until the test dies. */
  const hangingHover = () => new Promise<void>(() => {});

  it("returns even when an interaction never resolves", async () => {
    const page = fakePage({
      hover: hangingHover,
      evaluate: async (script: string) => {
        if (script.includes("letter-spacing: 0.12em") && script.includes("remove")) return true;
        if (script.includes("horizontalScroll")) return { horizontalScroll: false };
        if (script.includes("data-u11y-h")) return [{ key: "h0", target: "tip", selector: "button" }];
        if (script.includes("__u11yF")) return 0;
        return [];
      },
    });
    const started = Date.now();
    const r = await runLiveProbes(page, { limits: { budgetMs: 300 } });
    expect(Date.now() - started).toBeLessThan(5_000);
    // The criteria the pass did reach are still measured — the budget costs the tail only.
    expect(r.probed).toContain("1.4.10");
  });

  it("says which criterion the budget cost, and why", async () => {
    const page = fakePage({
      hover: hangingHover,
      evaluate: async (script: string) => {
        if (script.includes("letter-spacing: 0.12em") && script.includes("remove")) return true;
        if (script.includes("horizontalScroll")) return { horizontalScroll: false };
        if (script.includes("data-u11y-h")) return [{ key: "h0", target: "tip", selector: "button" }];
        if (script.includes("__u11yF")) return 0;
        return [];
      },
    });
    const r = await runLiveProbes(page, { limits: { budgetMs: 300 } });
    expect(r.probed).not.toContain("1.4.13");
    expect(r.skipped?.find((s) => s.sc === "1.4.13")?.why ?? "").toMatch(/budget/i);
  });

  it("gives every hover a finite timeout, so a dead trigger costs a second and not a test", async () => {
    const seen: unknown[] = [];
    const page = fakePage({
      hover: async (_sel: string, opts?: unknown) => {
        seen.push(opts);
      },
      evaluate: async (script: string) => {
        if (script.includes("letter-spacing: 0.12em") && script.includes("remove")) return true;
        if (script.includes("horizontalScroll")) return { horizontalScroll: false };
        if (script.includes("data-u11y-h")) return [{ key: "h0", target: "tip", selector: "button" }];
        if (script.includes("__u11yF")) return 0;
        return [];
      },
    });
    await runLiveProbes(page);
    expect(seen.length).toBeGreaterThan(0);
    for (const opts of seen) {
      const t = (opts as { timeout?: number } | undefined)?.timeout;
      expect(typeof t, "page.hover() was called with no timeout — Playwright then waits forever").toBe("number");
      expect(t).toBeGreaterThan(0);
    }
  });

  it("stops opening hover triggers once the page has offered more than the cap", async () => {
    let hovers = 0;
    const triggers = Array.from({ length: 400 }, (_, i) => ({ key: `h${i}`, target: `t${i}`, selector: "button" }));
    const page = fakePage({
      hover: async () => {
        hovers++;
      },
      evaluate: async (script: string) => {
        if (script.includes("letter-spacing: 0.12em") && script.includes("remove")) return true;
        if (script.includes("horizontalScroll")) return { horizontalScroll: false };
        if (script.includes("data-u11y-h")) return triggers;
        if (script.includes("__u11yF")) return 0;
        return [];
      },
    });
    await runLiveProbes(page, { limits: { maxTriggers: 25 } });
    expect(hovers).toBeLessThanOrEqual(25);
  });
});
