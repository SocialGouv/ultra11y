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
    expect(r.probed.sort()).toEqual(["1.4.10", "1.4.12", "1.4.13", "1.4.4", "2.4.7"]);
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
