// `cy.ultra11y()` RECORDS THE BEHAVIOUR DIGEST TOO — DOM-only, and saying so (#190).
//
// Cypress gives a test no CDP session, so the listeners a page attaches with addEventListener
// are invisible to it. The digest is still worth recording — inline handlers, ARIA mutations,
// live regions, timers, moving content — as long as it says `collected: "dom"` and a reader
// never takes its silence about listeners for a page that has none. Driven here with fake
// Cypress globals: the command chain is the thing under test, not a browser.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BEHAVIOUR_MARK, BEHAVIOUR_START, BEHAVIOUR_WINDOW_MS } from "../src/behaviour.js";
import { COLLECT_SNAPSHOT } from "../src/collector.js";

type Fn = (...args: any[]) => any;
const g = globalThis as any;
const commands = new Map<string, Fn>();
const calls: { waited: number[]; evals: string[]; task?: Record<string, any> } = { waited: [], evals: [] };

/** A chainable that runs its callback at once — enough of Cypress's command queue for this. */
const chain = (value: unknown) => ({ then: (cb: Fn) => cb(value) });

function fakeWindow(raw: unknown) {
  return {
    location: { href: "https://exemple.test/page" },
    eval(s: string) {
      calls.evals.push(s);
      if (s === COLLECT_SNAPSHOT) return { dom: '<html><body><div onclick="x()">A</div></body></html>', url: "https://exemple.test/page", title: "Page" };
      if (s === BEHAVIOUR_START) return true;
      if (s === BEHAVIOUR_MARK) return true;
      return raw;
    },
  };
}

let win: ReturnType<typeof fakeWindow>;

beforeAll(async () => {
  g.Cypress = { Commands: { add: (name: string, fn: Fn) => commands.set(name, fn) } };
  g.cy = {
    screenshot: () => undefined,
    window: () => chain(win),
    wait: (ms: number) => {
      calls.waited.push(ms);
      return chain(undefined);
    },
    task: (_name: string, payload: Record<string, any>) => {
      calls.task = payload;
      return chain({ failing: [] });
    },
  };
  await import("../src/integrations/cypress.js");
});

afterAll(() => {
  delete g.Cypress;
  delete g.cy;
});

describe("cy.ultra11y and the behaviour digest", () => {
  it("opens the window, waits it out, and sends a DOM-only digest that says what it cannot see", () => {
    win = fakeWindow({
      windowMs: 2010,
      idleMs: 2010,
      inline: [{ i: 2, tag: "div", selector: "div", attrs: ["onclick"] }],
      domListeners: [{ facts: { i: 2, tag: "div", selector: "div", native: false }, events: ["click"] }],
      ariaMutations: [],
      liveRegions: [],
      updates: [],
      motion: [],
      animations: [],
      resources: [],
      truncated: {},
    });
    commands.get("ultra11y")!({ as: "page", screenshot: false });
    expect(calls.evals).toContain(BEHAVIOUR_START);
    expect(calls.waited).toContain(BEHAVIOUR_WINDOW_MS);
    const scripts = calls.task?.scripts;
    expect(scripts).toMatchObject({ v: 1, collected: "dom" });
    expect(scripts.why).toMatch(/no CDP session/);
    expect(scripts.listeners).toEqual([expect.objectContaining({ selector: "div", flagged: true })]);
  });

  it("records `collected: none` with the reason when the window cannot be read", () => {
    win = fakeWindow(null);
    commands.get("ultra11y")!({ as: "page", screenshot: false });
    expect(calls.task?.scripts).toMatchObject({ collected: "none" });
    expect(calls.task?.scripts.why).toMatch(/navigated or reloaded/);
  });

  it("`behaviour: false` records no digest and does not wait", () => {
    calls.waited = [];
    calls.evals = [];
    win = fakeWindow(null);
    commands.get("ultra11y")!({ as: "page", screenshot: false, behaviour: false });
    expect(calls.evals).not.toContain(BEHAVIOUR_START);
    expect(calls.waited.every((ms) => ms === 0)).toBe(true);
    expect(calls.task?.scripts).toBeUndefined();
  });
});
