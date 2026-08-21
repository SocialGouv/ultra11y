// `ultra11y/cypress/plugin` — the NODE half of the Cypress integration.
//
//   // cypress.config.js
//   import ultra11y from "ultra11y/cypress/plugin";
//   export default defineConfig({ e2e: { setupNodeEvents(on, config) { ultra11y(on); return config; } } });
//
// Cypress test code runs in the BROWSER and cannot write to disk, so the collected page
// round-trips through a task. The browser half is `ultra11y/cypress`.
//
// THE SCREENSHOT. `cy.screenshot()` writes to a path Cypress chooses and names, which is why
// the Cypress side used to have no pixel tier at all — `rendered-contrast-pixel` (contrast
// over a gradient or a background image, the one case no CSSOM analysis can answer) simply
// stayed undecided. The `after:screenshot` event is the missing link: it hands us the real
// path of the file Cypress just wrote, so we can read it back and attach it to the payload.
// If that event never fires, the page is recorded without a screenshot — the criterion stays
// undecided, exactly as before, and is never guessed.
import { readFileSync } from "node:fs";
import { type AuditLike, type FindingLike, type SnapshotPayload, auditSnapshot, failingFindings, formatFailure, writePagesReport } from "./core.js";

interface ScreenshotDetails {
  name?: string;
  path: string;
}

// `any`: Cypress's `on` is not a dependency of this package.
type On = (event: string, handler: any) => void;

export interface TaskPayload extends SnapshotPayload {
  failOn?: string | false;
  /** The name `cy.screenshot()` was called with, when the browser half took one. */
  screenshotName?: string;
  /** Forwarded from `cy.ultra11y({ report })` — the browser cannot write files, this side can. */
  report?: boolean | { out?: string; standard?: string; lang?: string };
}

export interface TaskResult {
  findings: FindingLike[];
  failing: FindingLike[];
  message: string;
}

/** Register the ultra11y task (and the screenshot capture) on Cypress's node events. */
export default function register(on: On): void {
  // name → path of the last screenshot Cypress wrote under it.
  const shots = new Map<string, string>();

  on("after:screenshot", (details: ScreenshotDetails) => {
    if (details?.name && details.path) shots.set(details.name, details.path);
    // Returning the details unchanged keeps any other after:screenshot consumer working —
    // Cypress merges what a handler returns into the screenshot record.
    return details;
  });

  on("task", {
    ultra11ySnapshot(payload: TaskPayload): TaskResult {
      const withShot: SnapshotPayload = { ...payload };
      const path = payload.screenshotName ? shots.get(payload.screenshotName) : undefined;
      if (path) {
        try {
          withShot.screenshot = readFileSync(path).toString("base64");
        } catch {
          /* unreadable — the page is still fully auditable, the pixel tier just declines */
        }
      }
      const result: AuditLike = auditSnapshot(withShot);
      if (payload.report) writePagesReport(typeof payload.report === "object" ? payload.report : {});
      const failOn = payload.failOn === undefined ? "blocking" : payload.failOn;
      const failing = failOn === false ? [] : failingFindings(result, failOn);
      // Return rather than throw: the browser half raises the assertion, so the failure is
      // attributed to the test rather than to the plugin.
      return {
        findings: result.findings ?? [],
        failing,
        message: failing.length ? formatFailure(String(payload.meta.name), failing) : "",
      };
    },
  });
}
