// 4.1.3 STATUS MESSAGES — the last needs-rendering criterion the suite-driven tier could not
// reach, and the reason the partial-audit banner was structurally permanent on egapro.
//
// The instrument existed: `probeLiveRegion` has shipped since the stateful probes landed. It
// was wired to `scan --sample` only — the cold-scanner path that cannot reach a screen behind
// a login — and not to `runLiveProbes`, which is what an E2E suite calls on a page it has
// already driven into the right state. So the criterion reached a PAID adjudicator on every
// run, carrying whatever `aria-live` happened to be in the source.
//
// It is opt-in on `runLiveProbes` and on by default in a SWEEP, and the asymmetry is the same
// one `probes: true` already carries: this probe TYPES INTO the page and toggles its controls,
// so a test that owns its page and asserts a line later must ask for it — while a sweep exists
// for nothing but recording the sample and asserts nothing afterwards.
import { describe, expect, it } from "vitest";

import { liveRegionExpr, LIVE_REGION_DETAIL, runLiveProbes } from "../src/probes.js";
import { sweepCheckOptions } from "../src/integrations/playwright.js";

/** A page that answers every probe with nothing, and records the expressions it was handed. */
function fakePage() {
  const seen: string[] = [];
  return {
    seen,
    viewportSize: () => ({ width: 1280, height: 900 }),
    setViewportSize: async () => {},
    addStyleTag: async () => ({}),
    hover: async () => {},
    waitForTimeout: async () => {},
    keyboard: { press: async () => {} },
    mouse: { move: async () => {} },
    evaluate: async (script: string) => {
      seen.push(script);
      if (script.includes("horizontalScroll")) return { horizontalScroll: false };
      if (script.includes("const focusables")) return 0;
      return [];
    },
  };
}

const ranLiveRegion = (page: ReturnType<typeof fakePage>) => page.seen.some((s) => s.includes("MutationObserver"));

describe("the live-region probe is opt-in on a page somebody else owns", () => {
  it("does not run, and does not credit 4.1.3, by default", async () => {
    const page = fakePage();
    const r = await runLiveProbes(page);
    expect(ranLiveRegion(page), "a read-only pass must not type into the caller's page").toBe(false);
    expect(r.probed).not.toContain("4.1.3");
  });

  it("runs and credits 4.1.3 when the caller asks for it", async () => {
    const page = fakePage();
    const r = await runLiveProbes(page, { liveRegion: true });
    expect(ranLiveRegion(page)).toBe(true);
    expect(r.probed).toContain("4.1.3");
    expect(r.liveRegion).toEqual([]);
  });

  it("keeps CLICKS off unless they are asked for separately", async () => {
    // Toggling a checkbox and typing into a field are restored; clicking an arbitrary button
    // on an authenticated application is not, and no `location.href` check can see a mutation
    // the server performed. So the safe half is the default even here.
    const page = fakePage();
    await runLiveProbes(page, { liveRegion: true });
    const expr = page.seen.find((s) => s.includes("MutationObserver")) ?? "";
    expect(expr).toContain("click interactions disabled");
    const clicking = fakePage();
    await runLiveProbes(clicking, { liveRegion: { clicks: true } });
    expect(clicking.seen.find((s) => s.includes("MutationObserver")) ?? "").toContain('button[type="button"]');
  });

  it("says nothing about 4.1.3 when the probe throws", async () => {
    const page = {
      ...fakePage(),
      evaluate: async () => {
        throw new Error("boom");
      },
    };
    const r = await runLiveProbes(page, { liveRegion: true });
    expect(r.probed).not.toContain("4.1.3");
    expect((r.skipped ?? []).some((s) => s.sc === "4.1.3")).toBe(true);
  });

  it("speaks the caller's language", async () => {
    const page = fakePage();
    await runLiveProbes(page, { liveRegion: true, lang: "fr" });
    expect(page.seen.find((s) => s.includes("MutationObserver")) ?? "").toContain(LIVE_REGION_DETAIL.fr);
    expect(liveRegionExpr(LIVE_REGION_DETAIL.en, false)).toContain(LIVE_REGION_DETAIL.en);
  });
});

describe("a sweep turns it on, because a sweep asserts nothing afterwards", () => {
  it("is on by default", () => {
    expect(sweepCheckOptions().liveRegion).toBe(true);
  });

  it("can be turned off", () => {
    expect(sweepCheckOptions({ liveRegion: false }).liveRegion).toBe(false);
  });
});
