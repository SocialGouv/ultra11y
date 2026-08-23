// THE ONE TIER NOTHING HERE EVER DROVE FOR REAL.
//
// `checkA11y`, `sweepSample` and the live probes are the surface this tool offers a test suite,
// and until this file every test of them handed them a FAKE page: an object with the right
// method names that resolved instantly and never refused anything. Three thousand tests, and
// both defects that reached a real repository walked straight through them.
//
//   1. `probeHover` called `page.hover()` with no timeout. Playwright's default is 0 — wait
//      forever — so a trigger that never became actionable blocked the caller's test until ITS
//      timeout killed it. The fake page's `hover` always resolved, so nothing here could see it.
//      In production it took two specs, and through a serial group fifteen more, and shipped an
//      RGAA report with 20 of 35 pages.
//   2. axe was never run by this tier at all. No fake page can reveal a pass that does not
//      happen.
//
// A fake page proves the plumbing. Only a real one proves the contract. This file drives real
// Chromium over a real page and asserts what the audit downstream is entitled to assume.
//
// It SKIPS rather than fails when no browser is installed: a contributor running `pnpm test` on
// a fresh clone should not be stopped by a 150 MB download, and CI installs it explicitly (see
// the `browser-tier` job in ci.yml, which also asserts these tests actually ran).
import { createServer, type Server } from "node:http";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { PAGES_DIR } from "../src/snapshot.js";

// Resolved lazily: importing @playwright/test at module scope would make the whole file fail to
// load where it is not installed, instead of skipping.
let chromium: typeof import("@playwright/test").chromium | undefined;
try {
  ({ chromium } = await import("@playwright/test"));
} catch {
  /* not installed — every test below skips */
}
let browserAvailable = false;

const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Fiche</title>
<style>
  body { background: #fff; color: #222; font-family: system-ui; }
  .tip { display: none; position: absolute; background: #fff; border: 1px solid #222; }
  /* A trigger that is NEVER actionable: zero-sized, so Playwright waits for it forever. */
  .ghost { width: 0; height: 0; overflow: hidden; position: absolute; left: -9999px; }
</style></head>
<body>
  <header><nav aria-label="Principal"><a href="/">Accueil</a></nav></header>
  <main>
    <h1>Fiche entreprise</h1>
    <p>Un texte parfaitement contrasté.</p>
    <button class="ghost" aria-describedby="tip-ghost">Aide</button>
    <span class="tip" id="tip-ghost" role="tooltip">Une bulle</span>
    <a href="/aide">Consulter la page d aide</a>
  </main>
  <footer><a href="/mentions-legales">Mentions légales</a></footer>
</body></html>`;

let root: string;
let browser: Awaited<ReturnType<NonNullable<typeof chromium>["launch"]>> | undefined;
let server: Server | undefined;
let origin = "";

beforeAll(async () => {
  if (!chromium) return;
  try {
    browser = await chromium.launch();
    browserAvailable = true;
  } catch {
    /* no browser binary — skip */
  }
  // A SKIPPED TEST IS A GREEN LIE unless somebody is checking. Locally, skipping is right —
  // a contributor on a fresh clone should not be stopped by a 150 MB download. In CI, where the
  // browser is installed on purpose, a silent skip would turn this whole file into decoration,
  // which is the precise failure mode ("green but inactive") the tier below exists to catch.
  if (process.env.ULTRA11Y_REQUIRE_BROWSER === "1" && !browserAvailable) {
    throw new Error("ultra11y: ULTRA11Y_REQUIRE_BROWSER=1 but no Chromium could be launched — the browser tier did not run.");
  }
  root = mkdtempSync(join(tmpdir(), "u11y-browser-"));
  writeFileSync(join(root, "page.html"), PAGE);
  // SERVED, not `file://`. axe-core refuses a file URL ("Please use browser.newContext()"),
  // and a served page is what every real caller has anyway — a fixture that differs from
  // production in the one property under test is not a fixture, it is a second bug.
  server = createServer((req, res) => {
    // One dead route, because the tier's behaviour on an ERROR page is itself under test and
    // a server that only ever says 200 cannot show it.
    if (req.url === "/introuvable") {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><head><title>Error response</title></head><body><h1>404</h1></body></html>");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  origin = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

/** Drive `checkA11y` over the fixture, from `root` so the snapshot lands there. */
async function check(opts: Record<string, unknown> = {}) {
  const { checkA11y } = await import("../src/integrations/playwright.js");
  const context = await browser!.newContext();
  const page = await context.newPage();
  const cwd = process.cwd();
  process.chdir(root);
  try {
    await page.goto(origin);
    // `any`: the plugin is typed against Playwright's Page structurally.
    return await checkA11y(page as any, { as: "fiche", name: "Fiche", failOn: false, ...opts });
  } finally {
    process.chdir(cwd);
    await page.close();
    await context.close();
  }
}

describe.runIf(true)("the browser tier, driven for real", () => {
  // A CRAWL FOLLOWS LINKS, AND LINKS ROT. The sample scan has refused an error page since it
  // existed — filing one under a requested name is a false conformance claim — but the URL
  // path, which is what `--crawl` and `scan <urls>` both use, never applied the same rule.
  // Measured on a three-page site with one dead link: the deliverable carried a fourth page
  // called « Error response » at 97 % RGAA, snapshotted, its criteria counting towards the
  // run's own grid.
  //
  // Refused AND named: `renderRedirected` states the drop, because a report that is merely
  // shorter reads exactly like a complete one — and a dead link is a bug in the site, which
  // is fixable, rather than in the audit.
  it("refuses a crawled URL that answered an error, and says which one", async () => {
    if (!browserAvailable) return;
    const { runScanManyLocal } = await import("../src/scan-local.js");
    const out = await runScanManyLocal([`${origin}/introuvable`, origin], { cwd: process.cwd(), snapshotRoot: root, interact: false });

    expect(out.redirected, "the 404 was audited as a page of the site").toHaveLength(1);
    const [dropped] = out.redirected!;
    expect(dropped!.reason).toBe("http-status");
    expect(dropped!.status).toBe(404);
    expect(dropped!.requested).toContain("/introuvable");

    // …and only the page that answered was snapshotted and reported on.
    expect(out.snapshots ?? []).toHaveLength(1);
    expect(out.findings.every((f) => !String(f.page ?? "").includes("introuvable"))).toBe(true);
  }, 120_000);

  it("records a snapshot a later audit can re-read offline", async () => {
    if (!browserAvailable) return;
    await check();
    const dir = join(root, PAGES_DIR, "fiche");
    expect(existsSync(join(dir, "dom.html")), "no DOM was persisted").toBe(true);
    expect(existsSync(join(dir, "meta.json"))).toBe(true);
  }, 120_000);

  it("runs axe and records that it RAN, which is what lets its silence count", async () => {
    if (!browserAvailable) return;
    await check();
    const axe = JSON.parse(readFileSync(join(root, PAGES_DIR, "fiche", "axe.json"), "utf8"));
    expect(axe.ran, "@axe-core/playwright is installed here, so the pass must have happened").toBe(true);
    expect(Array.isArray(axe.violations)).toBe(true);
  }, 120_000);

  it("returns instead of hanging when a hover trigger is never actionable", async () => {
    // THE REGRESSION, reproduced with the thing that caused it: a zero-sized trigger. Playwright
    // waits for actionability, and with no timeout it waits until the caller's test dies. The
    // budget is what makes this a bounded cost instead of a lost suite.
    if (!browserAvailable) return;
    const started = Date.now();
    await check({ probes: { budgetMs: 4_000, actionTimeoutMs: 500 } });
    expect(Date.now() - started, "the probes outlived their budget — this is the egapro hang").toBeLessThan(60_000);
  }, 120_000);

  it("names the criteria it probed, and the audit closes them", async () => {
    if (!browserAvailable) return;
    await check({ probes: true });
    const probes = JSON.parse(readFileSync(join(root, PAGES_DIR, "fiche", "probes.json"), "utf8"));
    expect(probes.probed, "a probe that ran must say so, or its silence decides nothing").toContain("1.4.10");

    const r = runAudit({ inputs: [join(root, PAGES_DIR, "fiche", "dom.html")] });
    // Reflow was measured by the probe; text contrast by axe. Both on the only page in scope.
    expect(r.criteria.find((c) => c.id === "1.4.10")?.status).toBe("C");
    expect(r.criteria.find((c) => c.id === "1.4.3")?.status).toBe("C");
    expect(r.scope.scan?.testedScs ?? []).toContain("1.4.3");
  }, 120_000);

  // THE KEYBOARD-TRAP PROBE, AGAINST A REAL TAB RING — the only place it can be proved.
  //
  // Its unit tests drive a scripted fake page, which proves the decision logic and nothing about
  // whether `focusSetupExpr` tags anything, whether `page.keyboard.press("Tab")` moves focus, or
  // whether the active element comes back tagged. A probe wrong in any of those ways records
  // 2.1.2 as measured, finds nothing, and hands RGAA 12.9 a conformity nobody established —
  // « green but inactive », which is the failure this whole file exists to catch.
  it("walks the tab ring in a real browser, and lets 2.1.2 close on the measurement", async () => {
    if (!browserAvailable) return;
    await check({ probes: true });
    const probes = JSON.parse(readFileSync(join(root, PAGES_DIR, "fiche", "probes.json"), "utf8"));
    expect(probes.probed, "the ring was walked, so its silence may be read as conformity").toContain("2.1.2");
    // This page has no trap: four native focusables, no script, nothing that swallows Tab.
    expect(probes.keyboardTrap ?? [], "a page with no trap must produce no hit").toEqual([]);

    const r = runAudit({ inputs: [join(root, PAGES_DIR, "fiche", "dom.html")] });
    expect(r.criteria.find((c) => c.id === "2.1.2")?.status, "measured on every page in scope, and nothing found").toBe("C");
    expect(r.scope.scan?.testedScs ?? []).toContain("2.1.2");
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------
// THE RENDERED HALF OF THE RECALL GATE.
//
// tests/fixture-recall.test.ts proves the SOURCE half: every rule a static audit of
// tests/fixtures/realworld can reach does reach it. Six rules and eight probes cannot be reached
// that way at all — their evidence is a page a browser built — so a recall gate that stopped at
// the source half would leave exactly the tier this repository is most careful about unmeasured,
// while `pageCoverage.scs` went on naming those criteria as measured.
//
// So the site is served here and really scanned. Four pages carry all fourteen: the stylesheet is
// shared, and the four page-specific subjects live one per page — the gradient banner on `/`, the
// keyboard trap and the live region on `/contact.html`, the field that collapses inside a table
// cell on `/tarifs.html`, and the missing <!DOCTYPE> on `/cadres.html`. Scanning all nine would
// cost a minute and add no rule.
describe("the recall fixture's rendered tier", () => {
  const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
  const SITE = join(REPO, "tests", "fixtures", "realworld");
  let siteServer: Server | undefined;
  let siteOrigin = "";
  let scanRoot = "";

  beforeAll(async () => {
    if (!browserAvailable) return;
    scanRoot = mkdtempSync(join(tmpdir(), "u11y-recall-"));
    siteServer = createServer((req, res) => {
      const rel = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
      const file = join(SITE, rel === "/" ? "index.html" : rel.replace(/^\/+/, ""));
      // Never serve outside the fixture: the path comes off the wire, and a fixture server that
      // can be walked out of is one nobody should copy into anything else.
      if (!file.startsWith(SITE) || !existsSync(file)) {
        res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        res.end("<!doctype html><html><head><title>404</title></head><body>404</body></html>");
        return;
      }
      res.writeHead(200, { "content-type": file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8" });
      res.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => siteServer?.listen(0, "127.0.0.1", resolve));
    const addr = siteServer.address();
    siteOrigin = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (siteServer ? siteServer.close(() => resolve()) : resolve()));
  });

  it("fires every browser-only rule and every live probe the fixture seeds", async () => {
    if (!browserAvailable) return;
    const { runScanManyLocal } = await import("../src/scan-local.js");
    const urls = ["/", "/contact.html", "/tarifs.html", "/cadres.html"].map((u) => `${siteOrigin}${u}`);
    const scan = await runScanManyLocal(urls, { cwd: REPO, snapshotRoot: scanRoot, lang: "fr" });

    // (1) THE PROBES — measured in the browser, never derivable from source.
    // A DynamicFinding names its producer in `axeRule`, as the bare ENGINE name; `mergeDynamic`
    // is what prefixes it to the `dyn-…` rule id a report shows. Asserted one step earlier, so a
    // probe that measures nothing is caught where it measured rather than where it was renamed.
    const probes = new Set(scan.findings.map((f) => f.axeRule));
    for (const engine of [
      "focus-visible", // 10.7 — `*:focus { outline: none }` with nothing in its place
      "reflow", // 10.11 — `body { min-width: 1200px }`, at a 320px viewport
      "reflow-zoom", // 10.4 — the clipped entrefilet at 200%
      "text-spacing", // 10.12 — the same, under the WCAG text-spacing override
      "hover", // 10.13 — a tooltip revealed on hover only, and not dismissible
      "keyboard-trap", // 12.9 — Tab confiscated on /contact.html
      "live-region", // 4.1.3 — a counter updated outside any live region
      "input-overflow-reflow", // 10.11 — the field that collapses to 18px under 400px
    ]) {
      expect(probes, `the probe ${engine} found nothing on a fixture seeded for it`).toContain(engine);
    }

    // (2) THE RENDERED RULES — they read a snapshot's computed styles, stylesheet rules and
    // screenshot, so they exist only once the scan has written `.ultra11y/pages/`.
    const audited = runAudit({ inputs: [join(scanRoot, PAGES_DIR)] });
    const found = new Set([...audited.findings, ...(audited.packFindings ?? [])].map((f) => f.ruleId));
    for (const id of [
      "rendered-contrast", // 3.2 — a computed colour against a computed backdrop
      "rendered-contrast-pixel", // 3.2 — the gradient banner, decided on the screenshot alone
      "rendered-nontext-contrast", // 3.3 — a borderless white field on a white page
      "rendered-link-colour-only", // 10.6 — a link in a paragraph distinguished by colour alone
      "rendered-focus-not-visible", // 10.7 — the stylesheet rule that kills the outline
      "rendered-orientation-lock", // 13.9 — the portrait media query that rotates <html>
      // Signal-gated, and the reason /cadres.html is served without a <!DOCTYPE>: this pack rule
      // reads a CAPTURE's `doctype` signal and cannot fire on a source file at all.
      "pack:rgaa:doctype-missing", // 8.1
    ]) {
      expect(found, `the rendered rule ${id} found nothing on a fixture seeded for it`).toContain(id);
    }
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------
// 2.1.2, AND THE ONE CONTROL THAT LOOKS EXACTLY LIKE A CAGE WITHOUT BEING ONE.
//
// A `bloquant` false positive is the most expensive kind this tool can emit: it is the severity
// that turns a gate red and a release around. `input[type=date]` produced one. Chromium splits
// it into day, month, year and the picker button, and Tab walks those WITHOUT changing
// `document.activeElement` — so the trap walk, which confirmed over three presses, watched focus
// sit still on a field every keyboard user crosses in four and called it a cage.
//
// These two cases are the whole contract, and they must be asserted together: a probe made safe
// by never accusing anything is not a fixed probe, it is a deleted one.
describe("the keyboard-trap probe tells a composite control from a cage", () => {
  const withBody = async (body: string) => {
    const page = await browser!.newPage();
    await page.setContent(`<!doctype html><html lang="fr"><head><title>t</title></head><body>${body}</body></html>`, { waitUntil: "load" });
    return page;
  };

  it("does not accuse a native multi-segment editor, whatever its type", async () => {
    if (!browserAvailable) return;
    const { probeKeyboardTrap } = await import("../src/probes.js");
    for (const type of ["date", "time", "datetime-local", "month", "week"]) {
      const page = await withBody(
        `<a href="/a">A</a><label for="f">F</label><input id="f" type="${type}"><label for="g">G</label><input id="g" type="text"><a href="/b">B</a>`,
      );
      const hits = await probeKeyboardTrap(page);
      expect(
        hits.map((h) => h.selector),
        `input[type=${type}] was reported as a keyboard trap`,
      ).toEqual([]);
      await page.close();
    }
  }, 120_000);

  it("still catches a real cage sitting after one of them", async () => {
    if (!browserAvailable) return;
    // The date field first, so the walk has to cross it before it can reach the trap — which is
    // exactly the arrangement that used to end the walk two iterations in.
    const { probeKeyboardTrap } = await import("../src/probes.js");
    const page = await withBody(
      `<a href="/a">A</a><label for="d">D</label><input id="d" type="date">` +
        `<label for="t">T</label><input id="t" onkeydown="if(event.key==='Tab'){event.preventDefault();this.focus();}">` +
        `<a href="/b">B</a>`,
    );
    const hits = await probeKeyboardTrap(page);
    expect(hits.map((h) => h.selector).join(","), "the trap behind a date field was not found").toContain("#t");
    await page.close();
  }, 120_000);
});
