// `ultra11y/playwright` — audit a page DURING your Playwright run, in the state your test
// built it (logged in, form filled, modal open). `scan` cannot see that state: it starts a
// second browser after the fact.
//
//   import { test, checkA11y } from "ultra11y/playwright";
//
//   test("home page is accessible", async ({ page, ultra11y }) => {
//     await page.goto("/");
//     await ultra11y({ as: "accueil" });
//   });
//
//   // …or on any page object, with no fixture:
//   await checkA11y(page, { as: "contact", failOn: "major" });
//
// The durable half is not the assertion — it is the SNAPSHOT. Each checked page is written
// to `.ultra11y/pages/<id>/` (DOM + computed styles + boxes + stylesheets + screenshot), so
// the same page re-audits offline with no browser: that is how CI decides the rendering
// criteria without booting the app, and how the report speaks page by page. Commit it.
import { createRequire } from "node:module";
import { COLLECT_SNAPSHOT } from "../collector.js";
import { type AuditLike, type CheckOptions, auditSnapshot, buildPayload, gate, stayedOnPage, writePagesReport } from "./core.js";

// Playwright's own types are not a dependency of this package (it is a peer of YOUR repo),
// so the page object is structurally typed to exactly what is used.
interface PlaywrightPage {
  evaluate(script: string): Promise<unknown>;
  screenshot(opts: { fullPage: boolean }): Promise<Buffer>;
  url(): string;
}

export interface PlaywrightCheckOptions extends CheckOptions {
  /** Also write the per-page report once this page is recorded. Off by default: a report
   *  per checked page would be wasteful in a suite; turn it on in a final test. */
  report?: boolean | { out?: string; standard?: string; lang?: string };
}

/** Collect the current page, persist it as a snapshot, audit it, and fail on the threshold. */
export async function checkA11y(page: PlaywrightPage, opts: PlaywrightCheckOptions = {}): Promise<AuditLike> {
  const collected = (await page.evaluate(COLLECT_SNAPSHOT)) as Parameters<typeof buildPayload>[0];

  // A VIEWPORT screenshot, deliberately: the boxes come from getBoundingClientRect, which is
  // viewport-relative, so a full-page capture would put the two coordinate systems out of
  // step. It feeds the pixel tier — contrast over an image or a gradient, where the CSSOM
  // has no answer. A screenshot failure must never fail the accessibility check itself.
  let shot: string | undefined;
  if (opts.screenshot !== false) {
    try {
      shot = (await page.screenshot({ fullPage: false })).toString("base64");
    } catch {
      /* pixel tier skipped for this page; every other rule still runs */
    }
  }

  const url = collected.url || page.url();
  // Refuse a page the browser did not stay on, when the caller said where it went. The
  // snapshot's identity is `as`/`name`, applied to whatever is on screen — so a guarded route
  // that redirected would be filed under the requested page's name, and the resulting sheet,
  // screenshot and rate would all describe another screen. Skipping loudly beats that.
  if (opts.expectPath && !stayedOnPage(opts.expectPath, url)) {
    throw new Error(
      `ultra11y: ${opts.expectPath} landed on ${url} — not recording it as "${opts.as ?? opts.name ?? "this page"}". ` +
        `The state that opens this route is not the one the test built; seed it first, or drop the page from the sample.`,
    );
  }
  const payload = buildPayload(collected, url, "playwright", opts, shot);
  const result = auditSnapshot(payload);
  if (opts.report) writePagesReport(typeof opts.report === "object" ? opts.report : {});
  gate(result, String(payload.meta.name), opts.failOn);
  return result;
}

/** Optional fixture form. Import `test` from here instead of `@playwright/test`.
 *
 *  Playwright belongs to YOUR project, not to this package, so it is resolved from the
 *  PROJECT FIRST (cwd) and only then relative to this module — the same order
 *  `scan --runtime local` uses (src/scan-local.ts resolveLocalDeps). Module-relative alone
 *  works for an ordinary `node_modules/ultra11y` install, where Node walks up into the
 *  project's own tree, but silently yields `undefined` whenever the package is linked,
 *  pnpm-hoisted elsewhere, or in a monorepo — and a fixture that is `undefined` for
 *  layout reasons is a confusing failure.
 *
 *  Resolution is lazy and guarded either way, so importing this in a Cypress-only repo
 *  gives `undefined` rather than a crash. */
// biome-ignore lint/suspicious/noExplicitAny: the shape is Playwright's, which is not a dependency here
export const test: any = (() => {
  // biome-ignore lint/suspicious/noExplicitAny: same
  const load = (from: string): any => createRequire(from)("@playwright/test");
  for (const from of [`${process.cwd()}/package.json`, import.meta.url]) {
    try {
      const base = load(from).test;
      if (!base?.extend) continue;
      return base.extend({
        // biome-ignore lint/suspicious/noExplicitAny: same
        ultra11y: async ({ page }: any, use: any) => {
          await use((opts: PlaywrightCheckOptions) => checkA11y(page, opts));
        },
      });
    } catch {
      /* try the next resolution root */
    }
  }
  return undefined;
})();

export type { AuditLike, CheckOptions };
