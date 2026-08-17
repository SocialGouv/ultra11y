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

export { AuditLike, CheckOptions, type PlaywrightCheckOptions, checkA11y, test };
