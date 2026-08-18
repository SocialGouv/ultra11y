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
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { COLLECT_SNAPSHOT } from "../collector.js";
import { runLiveProbes } from "../probes.js";
import { type AuditLike, type CheckOptions, type ProbeTuning, auditSnapshot, buildPayload, gate, stayedOnPage, writePagesReport } from "./core.js";

// Playwright's own types are not a dependency of this package (it is a peer of YOUR repo),
// so the page object is structurally typed to exactly what is used.
interface PlaywrightPage {
  evaluate(script: string): Promise<unknown>;
  screenshot(opts: { fullPage: boolean }): Promise<Buffer>;
  url(): string;
  // Used only by the live probes (`probes: true`), so they stay optional: a page object that
  // cannot resize or press a key still records a snapshot exactly as before.
  viewportSize?(): { width: number; height: number } | null;
  setViewportSize?(size: { width: number; height: number }): Promise<void>;
  addStyleTag?(opts: { content: string }): Promise<unknown>;
  hover?(selector: string): Promise<void>;
  waitForTimeout?(ms: number): Promise<void>;
  keyboard?: { press(key: string): Promise<void> };
  mouse?: { move(x: number, y: number): Promise<void> };
}

export interface PlaywrightCheckOptions extends CheckOptions {
  /** Also write the per-page report once this page is recorded. Off by default: a report
   *  per checked page would be wasteful in a suite; turn it on in a final test. */
  report?: boolean | { out?: string; standard?: string; lang?: string };
}

/** Read the three shapes `probes` accepts — `true`, a list of criteria, or an options object —
 *  into the one shape `runLiveProbes` takes. */
function probeOptions(p: PlaywrightCheckOptions["probes"]): { only?: string[]; limits?: Omit<ProbeTuning, "only"> } {
  // `probes: true` means "use what the repository declared". The bounds are a judgement about
  // the pages being audited, so they belong in `.ultra11yrc.json` next to the sample and the
  // standard — not repeated at every call site, and not compiled into the tool.
  //
  // Read directly rather than through `loadConfig`: this module is a lean bundle a consumer
  // imports into their test run, and pulling the standards registry in for three numbers
  // would be a poor trade.
  if (p === true || p === undefined) return fromConfig();
  if (p === false) return {};
  if (Array.isArray(p)) return { only: p, ...fromConfig() };
  const { only, ...limits } = p;
  return { ...(only ? { only } : {}), limits };
}

function fromConfig(): { only?: string[]; limits?: Omit<ProbeTuning, "only"> } {
  try {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), ".ultra11yrc.json"), "utf8")) as { probes?: ProbeTuning };
    if (!cfg.probes) return {};
    const { only, ...limits } = cfg.probes;
    return { ...(only ? { only } : {}), limits };
  } catch {
    // No config, or one this cannot read — the engine defaults apply, which is the same thing
    // every repository that never opens the question gets.
    return {};
  }
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
  // The probes run AFTER the snapshot is collected, deliberately: they stress the page —
  // double the root font size, narrow the viewport to 320px, force a spacing stylesheet, press
  // Tab, hover a tooltip — and what gets recorded must be the page as the test built it, not
  // the page mid-measurement. Everything they touch is restored before this returns.
  //
  // Guarded as a whole: a probe run that throws costs the measurements, never the snapshot and
  // never the caller's test.
  let probes: unknown;
  if (opts.probes) {
    try {
      probes = await runLiveProbes(page, probeOptions(opts.probes));
    } catch (e) {
      // LOUD, not silent. A swallowed probe failure is indistinguishable from a page with
      // nothing wrong: the criteria it would have decided simply stay « to assess », run after
      // run, with nobody able to tell whether they were measured and clean or never measured
      // at all. That confusion is the exact failure mode this tool exists to prevent, so it
      // must not be the one it ships. The page is still recorded either way.
      console.warn(
        `ultra11y: the live probes failed on this page — ${e instanceof Error ? e.message : String(e)}. The snapshot was still recorded; the criteria they decide stay to assess.`,
      );
    }
  }

  const payload = buildPayload(collected, url, "playwright", opts, shot, probes);
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

/** Options for {@link sweepSample}. */
export interface SweepOptions {
  /** Where `.ultra11yrc.json` lives. Defaults to the process cwd. */
  cwd?: string;
  /** Which declared pages this sweep owns. Return false for a page the repo snapshots itself
   *  — a wizard step that needs application state seeded first, say. Skipped pages are simply
   *  not declared here; they are still in the sample, so the report still expects them. */
  only?: (page: SamplePageLike) => boolean;
  /** Awaited after navigation, before collecting. This is where a framework's readiness goes:
   *  a design system that boots asynchronously will otherwise be serialized half-mounted, and
   *  the audit reports non-conformities about markup no user ever meets.
   *
   *  Typed loosely on purpose. The caller writes this against Playwright's real `Page` — with
   *  `waitForLoadState`, `waitForFunction`, locators — and Playwright is not a dependency of
   *  this package, so the narrow structural shape the collector needs would reject the very
   *  function this option exists to take. Same reasoning as `test` below. */
  // biome-ignore lint/suspicious/noExplicitAny: the shape is Playwright's, which is not a dependency here
  settle?: (page: any) => Promise<void> | void;
  /** Passed to every `checkA11y`. `failOn: false` (the default here) records without
   *  asserting: the durable output of a sweep is the snapshot, not a red test. */
  check?: Omit<PlaywrightCheckOptions, "as" | "name" | "auth" | "notes" | "sources" | "expectPath">;
}

export interface SamplePageLike {
  id: string;
  name: string;
  url: string;
  auth?: boolean;
  notes?: string;
  sources?: string[];
}

/** Declare one Playwright test per page of the `.ultra11yrc.json` sample.
 *
 *  The sample already says what every page is — id, name, URL, whether it sits behind a login,
 *  the sources that render it. A repo that then hand-writes a route table to drive its sweep is
 *  keeping a second copy of that, and the two drift: a page renamed in one place keeps its old
 *  identity in the report, which is the failure this whole tier exists to prevent.
 *
 *  So the sample drives the sweep:
 *
 *  ```ts
 *  import { test } from "@playwright/test";
 *  import { sweepSample } from "ultra11y/playwright";
 *
 *  sweepSample({ settle: async (page) => { await page.waitForLoadState("networkidle"); } });
 *  ```
 *
 *  Each page is navigated, checked against `expectPath` and its HTTP status, and recorded. A
 *  page the browser did not stay on — or that answered an error at the requested address — is
 *  `test.skip`ped with the reason, never filed under the requested name.
 *
 *  Pages your own specs drive (a funnel step that needs state seeded) are excluded with
 *  `only`. */
export function samplePagesFor(opts: Pick<SweepOptions, "cwd" | "only"> = {}): SamplePageLike[] {
  const cwd = opts.cwd ?? process.cwd();
  let declared: SamplePageLike[];
  try {
    const raw = readFileSync(join(cwd, ".ultra11yrc.json"), "utf8");
    declared = (JSON.parse(raw) as { sample?: { pages?: SamplePageLike[] } }).sample?.pages ?? [];
  } catch {
    // Not "declare zero tests and pass" — that is indistinguishable from a sweep that ran.
    throw new Error(`ultra11y: no readable .ultra11yrc.json in ${cwd} — sweepSample reads the page sample from it.`);
  }
  return declared.filter((p) => opts.only?.(p) ?? true);
}

/** The path a sample URL points at. The sample stores absolute URLs (it is also read by
 *  `scan`, which needs a real address); a Playwright test wants the path, so its `baseURL`
 *  applies. Anything unparseable is already a path. */
export function sweepTarget(url: string): string {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}

export function sweepSample(opts: SweepOptions = {}): void {
  const pages = samplePagesFor(opts);
  const t = test;
  if (!t) throw new Error("ultra11y: @playwright/test could not be resolved — sweepSample needs it.");
  if (!pages.length) return;

  // Serial by default is NOT imposed here: pages are independent unless the repo's own state
  // makes them otherwise, and that is the repo's call (`workers` in its config).
  for (const p of pages) {
    const target = sweepTarget(p.url);
    t(`a11y — ${p.name}`, async ({ page }: { page: PlaywrightPage & { goto(u: string): Promise<{ status(): number } | null> } }) => {
      const response = await page.goto(target);
      if (opts.settle) await opts.settle(page);

      const landed = page.url();
      t.skip(!stayedOnPage(target, landed), `${target} landed on ${landed} — the current state does not open this screen; nothing to record as "${p.name}"`);
      const status = response?.status();
      t.skip(
        status !== undefined && status >= 400,
        `${target} answered HTTP ${status} — an error page at the requested address; nothing to record as "${p.name}"`,
      );

      await checkA11y(page, {
        failOn: false,
        ...opts.check,
        as: p.id,
        name: p.name,
        ...(p.auth !== undefined ? { auth: p.auth } : {}),
        ...(p.notes ? { notes: p.notes } : {}),
        ...(p.sources ? { sources: p.sources } : {}),
        expectPath: target,
      });
    });
  }
}

export type { AuditLike, CheckOptions };
