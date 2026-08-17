// CI-level probe-string guard (same spirit as capture-escape-sync.test.ts): the local
// dynamic runtime evaluates browser-context code AS STRINGS (src/scan-local.ts's
// PRELUDE/probe/step constants + parameterized builders), and every page.evaluate is
// wrapped in a `.catch(() => [])` — so a syntax typo in a probe string would silently
// yield zero findings at scan time instead of failing. This browser-free test compiles
// EVERY probe source via `new Function` (compiled, never called — nothing executes, no
// DOM needed): a typo fails CI here. probeSources() bakes representative arguments into
// the builders and must list every new probe/step added to the runtime.
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { probeSources, clicksAllowed, landedOnRequestedPage } from "../src/scan-local.js";

const sources = probeSources();
const names = Object.keys(sources);

describe("scan-local probe strings — every string-evaluated expression parses (browser-free)", () => {
  it("probeSources() lists the full probe surface (pre-existing + Task-4 stateful)", () => {
    // 10 pre-existing entries + 9 stateful ones (builders instantiated per variant); a
    // probe added without listing it (or removed) is a conscious update, never silent.
    expect(names.length).toBeGreaterThanOrEqual(19);
    for (const expected of [
      "REFLOW_PROBE",
      "REFLOW_ZOOM_PROBE",
      "TEXT_SPACING_PROBE",
      "FOCUS_CHECK_PROBE",
      "HOVER_SETUP_PROBE",
      "FILL_INPUTS_STEP",
      "RESTORE_INPUTS_STEP",
      "OPEN_DIALOGS_STEP",
      "CLOSE_DIALOGS_STEP",
    ]) {
      expect(names, `probeSources() must list ${expected}`).toContain(expected);
    }
  });

  it.each(names)("%s compiles via new Function (syntax-valid JS)", (name) => {
    const src = sources[name]!;
    expect(src.trim().length).toBeGreaterThan(0);
    // `new Function` COMPILES the body at construction — a SyntaxError throws here —
    // but the body only runs when the function is CALLED, which we never do (the
    // sources reference document/window and must not execute in Node).
    expect(() => new Function(`return (${src});`)).not.toThrow();
  });
});

// A sample page's declared id/name is applied to whatever the browser had on screen. If the
// route bounced — expired session, a wizard step the state does not open — the page sheet,
// the screenshot and the rate all describe another screen under the requested page's name.
// Nothing about it looks wrong, which is exactly why it has to be caught here.
describe("a scanned page is the page that was asked for", () => {
  it("accepts the same path, whatever the app appends to it", () => {
    expect(landedOnRequestedPage("http://localhost:3000/aide", "http://localhost:3000/aide")).toBe(true);
    expect(landedOnRequestedPage("http://localhost:3000/aide", "http://localhost:3000/aide?from=nav")).toBe(true);
    expect(landedOnRequestedPage("http://localhost:3000/aide", "http://localhost:3000/aide#section")).toBe(true);
    expect(landedOnRequestedPage("http://localhost:3000/aide", "http://localhost:3000/aide/")).toBe(true);
  });

  it("rejects a different path — the redirect this guard exists for", () => {
    // The session expired and the funnel bounced to sign-in.
    expect(landedOnRequestedPage("http://localhost:3000/declaration/etape/2", "http://localhost:3000/login")).toBe(false);
    // The wizard sent us back to the step the state actually opens.
    expect(landedOnRequestedPage("http://localhost:3000/declaration/etape/4", "http://localhost:3000/declaration/etape/1")).toBe(false);
    expect(landedOnRequestedPage("http://localhost:3000/admin", "http://localhost:3000/mon-espace")).toBe(false);
  });

  // The guard is here to catch a redirect, not to invent one: anything it cannot parse, and
  // targets that cannot redirect at all, pass through.
  it("stays out of the way when there is nothing to compare", () => {
    expect(landedOnRequestedPage("/tmp/page.html", "")).toBe(true);
    expect(landedOnRequestedPage("file:///tmp/page.html", "file:///tmp/page.html")).toBe(true);
    expect(landedOnRequestedPage("::not a url::", "::not a url::")).toBe(true);
  });
});

describe("live-region click policy (authenticated-scan safety)", () => {
  it("clicksAllowed: clicks ON for unauthenticated scans, OFF with a storageState, back ON with --interact-clicks", () => {
    expect(clicksAllowed(undefined, undefined)).toBe(true); // unauthenticated default
    expect(clicksAllowed(undefined, true)).toBe(true);
    expect(clicksAllowed(".auth/user.json", undefined)).toBe(false); // authenticated default
    expect(clicksAllowed(".auth/user.json", false)).toBe(false);
    expect(clicksAllowed(".auth/user.json", true)).toBe(true); // explicit opt-in
  });

  it("the noClicks variant carries NO button-click loop; the clicks variant does, with the destructive-name skip", () => {
    const withClicks = sources["liveRegionExpr(clicks)"]!;
    const noClicks = sources["liveRegionExpr(noClicks)"]!;
    expect(withClicks).toContain('button[type="button"]');
    expect(withClicks).toMatch(/supprim.*delete|delete.*supprim/); // fr + en destructive verbs present
    expect(noClicks).not.toContain('button[type="button"]');
    // fill/toggle interactions (the confirmed real-world need) remain in BOTH variants
    for (const s of [withClicks, noClicks]) {
      expect(s).toContain('input[type="checkbox"], input[type="radio"]');
      expect(s).toContain("MutationObserver");
    }
  });

  it("no probe source ever clicks a link or a submit button", () => {
    for (const name of names) {
      const src = sources[name]!;
      // the only .click() calls target button[type=button] / checkbox / radio — never
      // an <a> or a submit control; and no probe ever calls submit()/requestSubmit().
      expect(src, `${name} must not submit forms`).not.toMatch(/\.(submit|requestSubmit)\s*\(/);
      expect(src, `${name} must not query links for interaction`).not.toMatch(/querySelectorAll\(\s*['"]a[\s['"]/);
      expect(src, `${name} must not click submit buttons`).not.toMatch(/type=["']?submit/);
    }
  });
});

// ---- destructive-name skip: run the SHIPPED nameOf/dangerous against a real DOM ----
// Same pattern as capture-escape-sync.test.ts: extract the guard straight out of the
// generated probe string (never a hand copy that could drift), compile it, and confront
// it with the reviewer-demonstrated bypass cases on a jsdom document. `skipped(btn)`
// mirrors the probe's own gate: `dangerous.test(nameOf(b))`.
// The engine's tsconfig ships no DOM lib (see src/scan-local.ts header), so jsdom's
// document/elements are typed structurally here — just the members nameOf touches.
interface DomEl {
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelectorAll(sel: string): ArrayLike<DomEl>;
}
interface DomDoc {
  getElementById(id: string): DomEl | null;
}
// jsdom ships no type declarations and the repo deliberately has no @types/jsdom — load
// it untyped at runtime and cast to the structural surface above (the exact pattern
// src/scan-local.ts uses for the untyped Playwright runtime deps).
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string) => { window: { document: DomDoc } } };
function extractClickGuard(doc: DomDoc): { nameOf: (b: DomEl) => string; dangerous: RegExp } {
  const src = sources["liveRegionExpr(clicks)"]!;
  const nm = /const nameOf = (\(b\) => \{[\s\S]*?\n {2}\});/.exec(src);
  if (!nm) throw new Error("liveRegionExpr(clicks): could not find `const nameOf = (b) => {…};` — update this sync test alongside the probe");
  const dm = /const dangerous = new RegExp\((".*?"), 'i'\);/.exec(src);
  if (!dm) throw new Error("liveRegionExpr(clicks): could not find `const dangerous = new RegExp(…);` — update this sync test alongside the probe");
  const nameOf = new Function("document", `return ${nm[1]};`)(doc) as (b: DomEl) => string;
  const dangerous = new RegExp(JSON.parse(dm[1]!) as string, "i");
  return { nameOf, dangerous };
}

describe("destructive-name skip — the shipped guard closes the demonstrated accessible-name bypasses", () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <span id="row3">Ligne 3</span><span id="act3">Supprimer</span>
    <button type="button" id="multiId" aria-labelledby="row3 act3">x</button>
    <span id="del1">Supprimer la ligne</span>
    <button type="button" id="leadingWs" aria-labelledby="  del1  ">x</button>
    <button type="button" id="iconImg"><img src="trash.png" alt="Supprimer"></button>
    <button type="button" id="iconSvg"><svg><title>Delete</title></svg></button>
    <button type="button" id="safeIcon"><img src="loupe.png" alt="Rechercher"></button>
    <button type="button" id="safeText">Mettre à jour</button>
  </body></html>`);
  const doc = dom.window.document;
  const { nameOf, dangerous } = extractClickGuard(doc);
  const skipped = (id: string) => dangerous.test(nameOf(doc.getElementById(id)!));

  it("bypass (a1) multi-id aria-labelledby — the destructive verb in the SECOND id is seen → skipped", () => {
    expect(nameOf(doc.getElementById("multiId")!)).toContain("Supprimer");
    expect(skipped("multiId")).toBe(true);
  });

  it("bypass (a2) leading/trailing-whitespace aria-labelledby — still resolved → skipped", () => {
    expect(skipped("leadingWs")).toBe(true);
  });

  it("bypass (b) icon-only button named via img[alt] — the alt is part of the name → skipped", () => {
    expect(skipped("iconImg")).toBe(true);
  });

  it("icon-only button named via svg <title> → skipped", () => {
    expect(skipped("iconSvg")).toBe(true);
  });

  it("control: safe buttons (img[alt]='Rechercher', text 'Mettre à jour') are NOT skipped", () => {
    expect(skipped("safeIcon")).toBe(false);
    expect(skipped("safeText")).toBe(false);
  });
});
