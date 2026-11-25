// THE BEHAVIOUR DIGEST REACHES THE CRITERIA IT DECIDES (#190).
//
// `scripts.json` records what a page's scripts did during its capture — a click listener on a
// `<div>`, an `aria-expanded` toggled by a button, a carousel turning on its own. A digest no
// brief quotes is a file nobody reads, so this pins the wiring: each fact lands, with its
// selector, in the evidence of the criterion it informs, and a digest that could not be
// collected says so instead of reading as a clean page.
//
// Synthetic page and synthetic digest: the browser half is exercised for real in
// tests/browser-tier.e2e.test.ts.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAdjudicationWorklist, captureFilesPresent } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { BEHAVIOUR_CAPS, assembleDigest, classifyListener, noDigest } from "../src/behaviour.js";
import { parseHtml } from "../src/parse/html.js";
import { PAGES_DIR, SNAPSHOT_VERSION, asScriptsDigest, readSnapshot, writeSnapshot } from "../src/snapshot.js";
import type { ScriptsDigest } from "../src/types.js";

const DOM = `<html lang="fr"><head><title>Comportements</title></head><body><main>
<h1>Comportements</h1>
<div id="carte" class="carte">Ouvrir la fiche</div>
<button type="button" id="menu-btn" aria-expanded="false" aria-controls="menu">Menu</button>
<ul id="menu" hidden><li>Un</li></ul>
<div id="carousel"><div class="slide" aria-hidden="false">A</div><div class="slide" aria-hidden="true">B</div></div>
<span id="survol" role="button" tabindex="0">Survol</span>
<p id="statut" role="status"></p>
</main></body></html>`;

/** The document-order ordinal of the element with this id, as the collector would record it. */
function ordinal(id: string): { i: number; tag: string } {
  const doc = parseHtml(DOM, "x.html");
  const i = doc.elements.findIndex((e) => e.attribs.id === id);
  if (i < 0) throw new Error(`no #${id}`);
  return { i, tag: doc.elements[i]!.tag };
}

function digest(): ScriptsDigest {
  const carte = ordinal("carte");
  const btn = ordinal("menu-btn");
  const carousel = ordinal("carousel");
  const survol = ordinal("survol");
  const statut = ordinal("statut");
  return assembleDigest(
    {
      windowMs: 2400,
      idleMs: 2000,
      inline: [],
      ariaMutations: [{ ...btn, selector: "button#menu-btn", attr: "aria-expanded", from: "false", values: ["true"], count: 1, phase: "interaction" }],
      liveRegions: [{ ...statut, selector: "p#statut", role: "status", changed: false }],
      updates: [],
      motion: [{ ...carousel, selector: "div#carousel", changes: 6, kinds: ["attr:aria-hidden", "attr:class"] }],
      animations: [],
      timers: { source: "init", intervals: [300], timeouts: 0, longTimeouts: [], inlineSetInterval: 1, inlineSetTimeout: 0 },
      resources: [{ kind: "script", origin: "inline", size: 512 }],
      truncated: {},
    },
    [
      { facts: { ...carte, selector: "div#carte", native: false }, events: ["click"] },
      { facts: { ...btn, selector: "button#menu-btn", native: true }, events: ["click"] },
      { facts: { ...survol, selector: "span#survol", native: false, role: "button", tabindex: "0" }, events: ["mousedown"] },
      { facts: { i: -1, tag: "#document", selector: "document", root: true }, events: ["keydown"] },
    ],
    "cdp",
  );
}

function capture(scripts: ScriptsDigest | undefined): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-behaviour-"));
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "comportements", name: "Comportements", url: "https://exemple.test/comportements" },
    dom: DOM,
    ...(scripts ? { scripts } : {}),
  });
  return root;
}

const evidenceOf = (root: string, standard: "rgaa" | "wcag", id: string): string[] => {
  const items = buildAdjudicationWorklist(runAudit({ inputs: [join(root, PAGES_DIR)] }), standard === "rgaa" ? { standard: "rgaa" } : {});
  const item = items.find((i) => i.criteriaId === id);
  return (item?.evidence ?? []).map((e) => `${e.selector} :: ${e.note ?? ""}`);
};

describe("classifyListener flags by one rule, whichever path collected the listener", () => {
  it("flags an activation listener on a non-interactive element with no role and no tabindex", () => {
    expect(classifyListener({ i: 3, tag: "div", selector: "div#a", native: false }, ["click"])).toMatchObject({ flagged: true, mouseOnly: true });
  });
  it("does not flag a native control, and does not call its click mouse-only", () => {
    expect(classifyListener({ i: 3, tag: "button", selector: "button", native: true }, ["click"])).toMatchObject({ flagged: false, mouseOnly: false });
  });
  it("calls a role=button span with a mousedown listener and no key listener mouse-only, without flagging it", () => {
    expect(classifyListener({ i: 3, tag: "span", selector: "span", native: false, role: "button", tabindex: "0" }, ["mousedown"])).toMatchObject({
      flagged: false,
      mouseOnly: true,
    });
    expect(classifyListener({ i: 3, tag: "span", selector: "span", native: false, role: "button", tabindex: "0" }, ["keydown", "mousedown"]).mouseOnly).toBe(
      false,
    );
  });
  it("calls a hover reaction with no focus counterpart mouse-only", () => {
    expect(classifyListener({ i: 3, tag: "a", selector: "a", native: true }, ["mouseenter"]).mouseOnly).toBe(true);
    expect(classifyListener({ i: 3, tag: "a", selector: "a", native: true }, ["focus", "mouseenter"]).mouseOnly).toBe(false);
  });
});

describe("assembleDigest keeps the file bounded and says where it cut", () => {
  it("records the caps, and the total of a list it cut — flagged entries kept first", () => {
    const many = Array.from({ length: BEHAVIOUR_CAPS.listeners + 25 }, (_, i) => ({
      facts: { i, tag: "button", selector: `button:nth-of-type(${i + 1})`, native: true },
      events: ["click"],
    }));
    many.push({ facts: { i: 9999, tag: "div", selector: "div#late", native: false }, events: ["click"] });
    const d = assembleDigest({ inline: [], truncated: {} }, many, "cdp");
    expect(d.listeners).toHaveLength(BEHAVIOUR_CAPS.listeners);
    expect(d.truncated?.listeners).toBe(BEHAVIOUR_CAPS.listeners + 26);
    expect(d.caps.listeners).toBe(BEHAVIOUR_CAPS.listeners);
    expect(d.listeners?.some((l) => l.selector === "div#late" && l.flagged)).toBe(true);
  });
  it("separates the delegation roots from the elements", () => {
    const d = digest();
    expect(d.delegated).toEqual([{ target: "document", events: ["keydown"] }]);
    expect(d.listeners?.map((l) => l.selector)).toEqual(["div#carte", "button#menu-btn", "span#survol"]);
  });
});

describe("scripts.json round-trips with the snapshot", () => {
  it("is written beside dom.html, read back, and named among the capture files", () => {
    const root = capture(digest());
    const dir = join(root, PAGES_DIR, "comportements");
    expect(JSON.parse(readFileSync(join(dir, "scripts.json"), "utf8")).collected).toBe("cdp");
    expect(readSnapshot(dir)?.scripts?.listeners?.length).toBe(3);
    expect(captureFilesPresent([join(dir, "dom.html")])).toContain("scripts.json");
  });
  it("reads back EXACTLY the digest that was written — no field dropped, nothing marked invalid", () => {
    const written = digest();
    const read = readSnapshot(join(capture(written), PAGES_DIR, "comportements"))?.scripts;
    expect(read).toEqual(written);
    expect(read?.invalid).toBeUndefined();
    // And the check is idempotent: a digest it already read reads the same again.
    expect(asScriptsDigest(read)).toEqual(read);
  });
  it("refuses a digest from a future format rather than half-reading it", () => {
    const root = capture({ ...digest(), v: 99 });
    expect(readSnapshot(join(root, PAGES_DIR, "comportements"))?.scripts).toBeUndefined();
  });
});

describe("each behaviour fact reaches the brief of the criterion it informs", () => {
  const root = capture(digest());

  it("7.1 — the clickable div without a role, with its selector, and the aria-expanded the button toggled", () => {
    const ev = evidenceOf(root, "rgaa", "7.1");
    expect(ev.some((e) => e.startsWith("div#carte.carte ::") && /not natively interactive and has neither role nor tabindex/.test(e))).toBe(true);
    expect(ev.some((e) => e.startsWith("button#menu-btn ::") && /changed aria-expanded/.test(e) && /"false" → "true"/.test(e))).toBe(true);
  });

  it("4.1.2 — the same clickable div, under the WCAG core", () => {
    const ev = evidenceOf(root, "wcag", "4.1.2");
    expect(ev.some((e) => e.startsWith("div#carte.carte ::") && /neither role nor tabindex/.test(e))).toBe(true);
  });

  it("7.3 — the mouse-only listener", () => {
    const ev = evidenceOf(root, "rgaa", "7.3");
    expect(ev.some((e) => e.startsWith("span#survol ::") && /mousedown/.test(e) && /no keyboard event/.test(e))).toBe(true);
  });

  it("13.8 — the carousel that turned with nothing touching the page", () => {
    const ev = evidenceOf(root, "rgaa", "13.8");
    expect(ev.some((e) => e.startsWith("div#carousel ::") && /changed 6 times in 2000 ms with nothing touching the page/.test(e))).toBe(true);
  });

  it("13.1 — the interval that keeps running", () => {
    const ev = evidenceOf(root, "rgaa", "13.1");
    expect(ev.some((e) => /^scripts:timers :: timers \(since the page started\): 1 interval running \(every 300 ms\)/.test(e))).toBe(true);
  });

  it("7.5 and 4.1.3 — the live region, and whether it spoke", () => {
    for (const [std, id] of [
      ["rgaa", "7.5"],
      ["wcag", "4.1.3"],
    ] as const) {
      const ev = evidenceOf(root, std, id);
      expect(
        ev.some((e) => e.startsWith("p#statut ::") && /live region <p> role="status" — its content did not change/.test(e)),
        `${std} ${id}`,
      ).toBe(true);
    }
  });

  it("opens with a coverage line that says how the digest was collected", () => {
    const ev = evidenceOf(root, "rgaa", "7.1");
    expect(ev.some((e) => /behaviour digest \(scripts\.json\) collected via CDP/.test(e) && /delegated to document \(keydown\)/.test(e))).toBe(true);
  });
});

describe("a digest that could not look never reads as a page with nothing to find", () => {
  it("says the collector could not run, and that the absence proves nothing", () => {
    const root = capture(noDigest("the capture script failed: boom"));
    const ev = evidenceOf(root, "rgaa", "7.1");
    const line = ev.find((e) => /behaviour digest/.test(e)) ?? "";
    expect(line).toMatch(/could NOT be collected \(the capture script failed: boom\)/);
    expect(line).toMatch(/proves nothing/);
    expect(ev.some((e) => /neither role nor tabindex/.test(e))).toBe(false);
  });

  it("says a DOM-only digest cannot see addEventListener", () => {
    const d = { ...digest(), collected: "dom" as const, why: "Cypress gives no CDP session" };
    const ev = evidenceOf(capture(d), "rgaa", "7.1");
    expect(ev.some((e) => /DOM fallback \(Cypress gives no CDP session\)/.test(e) && /proves nothing/.test(e))).toBe(true);
  });

  it("anchors an element the page created during the window on its collected selector", () => {
    const d = digest();
    d.motion = [{ i: -1, tag: "div", selector: "div.toast", html: '<div class="toast">', changes: 3, kinds: ["text"] }];
    const ev = evidenceOf(capture(d), "rgaa", "13.8");
    expect(ev.some((e) => e.startsWith("div.toast ::") && /not in the serialized DOM/.test(e))).toBe(true);
  });
});

describe("a malformed scripts.json degrades to less evidence, never a crash", () => {
  it("loads with the wrong-typed fields and entries dropped, and harvesting subjects does not throw", () => {
    const d = digest();
    const bad = {
      ...d,
      timers: {}, // every timers field missing — the reader takes `.length` on its arrays
      listeners: [
        ...(d.listeners ?? []).slice(0, 1), // a well-formed entry survives the read
        { i: 0, tag: "div", selector: "div#carte", native: false, flagged: true, mouseOnly: true, events: "x" }, // events is not a list
      ],
      updates: [{ i: 4, tag: "p", selector: "p#statut", kinds: "x" }], // kinds is not a list
    } as unknown as ScriptsDigest;
    const root = capture(bad);
    const s = readSnapshot(join(root, PAGES_DIR, "comportements"))?.scripts;
    expect(s?.collected).toBe("cdp");
    expect(s?.timers).toBeUndefined();
    expect(s?.listeners).toHaveLength(1);
    expect(s?.listeners?.[0]?.events).toEqual(["click"]);
    expect(s?.updates).toEqual([]);
    // What was dropped is recorded, field by field — and survives a second read.
    expect(s?.invalid).toEqual({ listeners: 1, timers: 1, updates: 1 });
    expect(asScriptsDigest(s)).toEqual(s);
    // The criteria the digest informs are harvested on it — none of it may throw.
    for (const [std, ids] of [
      ["rgaa", ["7.1", "7.3", "7.5", "13.1", "13.8"]],
      ["wcag", ["2.1.1", "2.2.1", "2.2.2", "4.1.2", "4.1.3"]],
    ] as const)
      for (const id of ids) expect(() => evidenceOf(root, std, id)).not.toThrow();
  });

  it("never reads what it dropped as absence: the coverage line says so, and timers it could not read are « unreadable »", () => {
    const d = digest();
    const bad = {
      ...d,
      timers: { ...d.timers, timeouts: "many" },
      listeners: [{ i: 0, tag: "div", selector: "div#carte", events: "click" }, { nope: true }],
    } as unknown as ScriptsDigest;
    const root = capture(bad);
    const coverage = (id: string): string => evidenceOf(root, "rgaa", id).find((e) => /behaviour digest/.test(e)) ?? "";
    const clickable = coverage("7.1");
    expect(clickable).toMatch(/0 clickable elements without role or tabindex/);
    expect(clickable).toMatch(/2 malformed entries dropped \(listeners ×2\) — absence proves nothing/);
    const timers = evidenceOf(root, "rgaa", "13.1").filter((e) => /scripts:timers/.test(e));
    expect(timers.join("\n")).toMatch(/timers unreadable/);
    expect(timers.join("\n")).toMatch(/1 malformed entry dropped \(timers ×1\) — absence proves nothing/);
    expect(timers.join("\n")).not.toMatch(/no timer recorded/);
    // A page whose digest dropped nothing carries no such caveat.
    expect(evidenceOf(capture(d), "rgaa", "7.1").some((e) => /malformed/.test(e))).toBe(false);
  });

  it("a snapshot written by `snapshot write` records what the producer's digest lost", () => {
    const d = digest();
    const s = asScriptsDigest({ ...d, motion: "turning", windowMs: "long", truncated: { listeners: "lots" } });
    expect(s?.motion).toBeUndefined();
    expect(s?.windowMs).toBeUndefined();
    expect(s?.truncated).toBeUndefined();
    expect(s?.invalid).toEqual({ motion: 1, truncated: 1, windowMs: 1 });
  });
});
