// `ultra11y/cypress` — the BROWSER half of the Cypress integration.
//
//   // cypress/support/e2e.js  (the supportFile)
//   import "ultra11y/cypress";
//
//   cy.visit("/");
//   cy.ultra11y({ as: "accueil" });
//
// Importing this file registers `cy.ultra11y()`. The Node half (`ultra11y/cypress/plugin`)
// must be wired in `cypress.config.js` too — Cypress test code cannot write to disk, so the
// collected page round-trips through a task.
import { COLLECT_SNAPSHOT } from "../collector.js";
import { type CheckOptions, buildPayload, slugify, stayedOnPage } from "./payload.js";

// Cypress's globals are not a dependency of this package; they exist at run time only.
declare const Cypress: {
  // `any`: Cypress's own command signature.
  Commands: { add(name: string, fn: (...args: any[]) => any): void };
};
// `any` for the same reason.
declare const cy: any;

export interface CypressCheckOptions extends CheckOptions {
  /** Capture a viewport screenshot so the pixel tier can run. On by default — the plugin
   *  reads it back through Cypress's `after:screenshot` event. */
  screenshot?: boolean;
  /** Also write the per-page report once this page is recorded. Off by default: a report per
   *  checked page would be wasteful in a suite, so turn it on in a final test.
   *
   *  Cypress test code runs in the browser and cannot write files, so the option is only
   *  DECLARED here and forwarded — the Node half does the work. Same option, same behaviour
   *  as Playwright's; a runner that silently ignored it would be worse than one that lacked it. */
  report?: boolean | { out?: string; standard?: string; lang?: string };
}

export function registerUltra11yCommand(): void {
  Cypress.Commands.add("ultra11y", (opts: CypressCheckOptions = {}) => {
    const shotName = opts.screenshot === false ? undefined : `ultra11y-${opts.as || "page"}-${Date.now()}`;
    // The screenshot is taken BEFORE the collection: `cy.screenshot()` toggles a class on
    // the document while it captures, and serializing the DOM mid-capture would record that
    // transient state as if it were the page.
    if (shotName) cy.screenshot(shotName, { capture: "viewport", log: false });
    // The engine's tsconfig ships no DOM lib (it is a Node bundle), so the app window is
    // typed structurally to exactly what is used here.
    return cy.window({ log: false }).then((win: { eval(s: string): unknown; location: { href: string } }) => {
      const collected = win.eval(COLLECT_SNAPSHOT) as Parameters<typeof buildPayload>[0];
      const url = collected.url || win.location.href;
      // Same refusal as the Playwright fixture: a page the browser did not stay on must not
      // be filed under the requested page's identity. See CheckOptions.expectPath.
      if (opts.expectPath && !stayedOnPage(opts.expectPath, url)) {
        throw new Error(
          `ultra11y: ${opts.expectPath} landed on ${url} — not recording it as "${opts.as ?? opts.name ?? "this page"}". ` +
            `The state that opens this route is not the one the test built; seed it first, or drop the page from the sample.`,
        );
      }
      const payload = {
        ...buildPayload(collected, url, "cypress", opts),
        failOn: opts.failOn,
        ...(opts.report ? { report: opts.report } : {}),
        ...(shotName ? { screenshotName: shotName } : {}),
      };
      return cy.task("ultra11ySnapshot", payload, { log: false }).then((res: { failing?: unknown[]; message?: string }) => {
        if (res?.failing?.length) throw new Error(res.message);
        return res;
      });
    });
  });
}

registerUltra11yCommand();

export { slugify };
