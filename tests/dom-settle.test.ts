// #206 — THE SCAN'S SETTLE WAS A FIXED SLEEP.
//
// `scan --runtime local` slept 1200ms after networkidle and hoped hydration was done: too short on
// a loaded machine (the probes measured the pre-hydration DOM), dead time on an idle one. It now
// waits for the DOM to stop changing, bounded. The expression runs here in a VM context whose
// MutationObserver the test drives, so the condition itself is what is proven.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { domSettledExpr, waitForDomSettled } from "../src/collector.js";

type Rec = { type: string; attributeName?: string | null };

/** A context with a MutationObserver the test can fire, and the page's own timers. */
function sandbox() {
  const observers: { cb: (r: Rec[]) => void; on: boolean }[] = [];
  class MutationObserver {
    private o: { cb: (r: Rec[]) => void; on: boolean };
    constructor(cb: (r: Rec[]) => void) {
      this.o = { cb, on: false };
      observers.push(this.o);
    }
    observe() {
      this.o.on = true;
    }
    disconnect() {
      this.o.on = false;
    }
  }
  const mutate = (r: Rec[]) => observers.filter((o) => o.on).forEach((o) => o.cb(r));
  const ctx: Record<string, unknown> = { MutationObserver, document: { documentElement: {} }, performance, setTimeout, clearTimeout };
  const run = (expr: string) => runInNewContext(expr, ctx) as Promise<{ settled: boolean; waitedMs: number }>;
  return { ctx, run, mutate, observing: () => observers.some((o) => o.on) };
}

describe("domSettledExpr — waits for the DOM to go quiet, never longer than its bound", () => {
  it("settles after the quiet window on a page that does not change", async () => {
    const s = sandbox();
    const r = await s.run(domSettledExpr(30, 2000));
    expect(r.settled).toBe(true);
    expect(r.waitedMs).toBeLessThan(2000);
    expect(s.observing()).toBe(false);
  });

  it("restarts the quiet window on every structural change", async () => {
    const s = sandbox();
    const p = s.run(domSettledExpr(60, 2000));
    const started = Date.now();
    // three injections 40ms apart, each inside the previous quiet window
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 40));
      s.mutate([{ type: "childList" }]);
    }
    const r = await p;
    expect(r.settled).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(120 + 60 - 10);
  });

  it("ignores style rewrites — an animation is not hydration", async () => {
    const s = sandbox();
    const p = s.run(domSettledExpr(60, 2000));
    const tick = setInterval(() => s.mutate([{ type: "attributes", attributeName: "style" }]), 10);
    const r = await p.finally(() => clearInterval(tick));
    expect(r.settled).toBe(true);
  });

  it("schedules through the original setTimeout, so the behaviour hook never counts the settle as the page's", async () => {
    const s = sandbox();
    let counted = 0;
    const ctx = s.ctx;
    ctx.__ultra11yTimers = { orig: { st: setTimeout } };
    ctx.setTimeout = (fn: () => void, ms: number) => {
      counted++;
      return setTimeout(fn, ms);
    };
    const r = await s.run(domSettledExpr(20, 500));
    expect(r.settled).toBe(true);
    expect(counted).toBe(0);
  });

  it("gives up at the bound on a page that never stops", async () => {
    const s = sandbox();
    const p = s.run(domSettledExpr(40, 150));
    const tick = setInterval(() => s.mutate([{ type: "characterData" }]), 10);
    const r = await p.finally(() => clearInterval(tick));
    expect(r.settled).toBe(false);
    expect(s.observing()).toBe(false);
  });
});

describe("waitForDomSettled — never throws", () => {
  it("measures the page as it stands when the observer cannot run", async () => {
    const r = await waitForDomSettled({
      evaluate: async () => {
        throw new Error("context destroyed");
      },
    });
    expect(r.settled).toBe(false);
  });

  it("hands the page the settle expression", async () => {
    const seen: string[] = [];
    const r = await waitForDomSettled(
      {
        evaluate: async (s: string) => {
          seen.push(s);
          return { settled: true, waitedMs: 1 };
        },
      },
      50,
      500,
    );
    expect(r.settled).toBe(true);
    expect(seen).toEqual([domSettledExpr(50, 500)]);
  });
});
