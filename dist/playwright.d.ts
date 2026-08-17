import { C as CheckOptions, A as AuditLike } from './payload-B6NDkLYJ.js';

interface PlaywrightPage {
    evaluate(script: string): Promise<unknown>;
    screenshot(opts: {
        fullPage: boolean;
    }): Promise<Buffer>;
    url(): string;
}
interface PlaywrightCheckOptions extends CheckOptions {
    /** Also write the per-page report once this page is recorded. Off by default: a report
     *  per checked page would be wasteful in a suite; turn it on in a final test. */
    report?: boolean | {
        out?: string;
        standard?: string;
        lang?: string;
    };
}
/** Collect the current page, persist it as a snapshot, audit it, and fail on the threshold. */
declare function checkA11y(page: PlaywrightPage, opts?: PlaywrightCheckOptions): Promise<AuditLike>;
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
declare const test: any;
/** Options for {@link sweepSample}. */
interface SweepOptions {
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
    settle?: (page: any) => Promise<void> | void;
    /** Passed to every `checkA11y`. `failOn: false` (the default here) records without
     *  asserting: the durable output of a sweep is the snapshot, not a red test. */
    check?: Omit<PlaywrightCheckOptions, "as" | "name" | "auth" | "notes" | "sources" | "expectPath">;
}
interface SamplePageLike {
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
declare function samplePagesFor(opts?: Pick<SweepOptions, "cwd" | "only">): SamplePageLike[];
/** The path a sample URL points at. The sample stores absolute URLs (it is also read by
 *  `scan`, which needs a real address); a Playwright test wants the path, so its `baseURL`
 *  applies. Anything unparseable is already a path. */
declare function sweepTarget(url: string): string;
declare function sweepSample(opts?: SweepOptions): void;

export { AuditLike, CheckOptions, type PlaywrightCheckOptions, type SamplePageLike, type SweepOptions, checkA11y, samplePagesFor, sweepSample, sweepTarget, test };
