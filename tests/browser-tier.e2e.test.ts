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
import { join } from "node:path";
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
  server = createServer((_req, res) => {
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
    // biome-ignore lint/suspicious/noExplicitAny: the plugin is typed against Playwright's Page structurally
    return await checkA11y(page as any, { as: "fiche", name: "Fiche", failOn: false, ...opts });
  } finally {
    process.chdir(cwd);
    await page.close();
    await context.close();
  }
}

describe.runIf(true)("the browser tier, driven for real", () => {
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
});
