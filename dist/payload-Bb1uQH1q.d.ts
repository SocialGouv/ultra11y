interface FindingLike {
    ruleId: string;
    criteriaId: string;
    file: string;
    line: number;
    severity: string;
    message: string;
    advisory?: boolean;
    origin?: {
        sourceFile?: string;
        sourceLine?: number;
    };
}
interface AuditLike {
    findings?: FindingLike[];
}
interface SnapshotPayload {
    meta: Record<string, unknown>;
    dom: string;
    styles?: unknown;
    boxes?: unknown;
    css?: unknown;
    screenshot?: string;
    /** What the live probes measured, when the caller ran them. */
    probes?: unknown;
    /** What axe-core found on this page, when the caller ran it. */
    axe?: unknown;
}
/** Same slug rule as the engine (src/snapshot.ts slugifyPageId): accent-folded URL path. */
declare function slugify(url: string): string;
interface CheckOptions {
    /** The page id (directory name). Defaults to the slugified URL path. */
    as?: string;
    /** Human page name for the report. Defaults to the document title. */
    name?: string;
    /** Severity at which the check fails, or `false` to record without ever failing. */
    failOn?: "blocking" | "major" | "minor" | false;
    /** Mark the page as sitting behind authentication. */
    auth?: boolean;
    /** Source files that rendered it — findings are then reported against YOUR code. */
    sources?: string[];
    /** Reproduction notes carried into the auditor ticket. */
    notes?: string;
    /** Capture a viewport screenshot for the pixel tier (Playwright: on by default). */
    screenshot?: boolean;
    /** The path you NAVIGATED to. Given it, the fixture refuses to record a page the browser
     *  did not stay on — a guarded route that redirected, a session that expired — instead of
     *  filing that other screen under this page's `as`/`name`. Nothing about such a snapshot
     *  looks wrong, which is what makes it the worst thing an accessibility report can carry.
     *  Compared by path (a query or fragment the app appends to its own route is the same
     *  page); a full URL works too. `scan --sample` applies the same rule. */
    expectPath?: string;
    /** Run the LIVE PROBES on this page after collecting it: 200% zoom, 320px reflow, the
     *  text-spacing override, focus visibility and content-on-hover.
     *
     *  These are the measurements a recorded snapshot can never settle, because they are
     *  properties of a page being acted on rather than of a page as it stands. `scan` runs them
     *  in its own browser, which is exactly why they were undecidable on any screen behind a
     *  login or a state machine — the scanner arrives cold and gets a redirect. Your suite has
     *  the page in the right state; this is how it says so.
     *
     *  Off by default: the probes press Tab, hover, resize the viewport and inject a stylesheet,
     *  and a suite should opt into that. Everything is restored before it returns, and the
     *  snapshot has already been collected, so what they measure cannot alter what was recorded.
     *  Pass an array to run only some of them (by criterion: "1.4.4", "1.4.10", "1.4.12",
     *  "1.4.13", "2.4.7"), or an object to also set the bounds — how wide the reflow probe
     *  narrows to, how many focusables are worth tabbing through, how many hits are worth
     *  recording. 320px is normative and stays the default; the other two are judgements about
     *  YOUR pages, and a screen with 400 focusables should be able to say so rather than being
     *  quietly cut off at 120. */
    probes?: boolean | string[] | ProbeTuning;
    /** Also measure 4.1.3 STATUS MESSAGES — content updated by an interaction and announced to
     *  nobody.
     *
     *  Separate from `probes` because it is a different promise. The probes above stress the page
     *  and put it back; this one FILLS its fields and toggles its controls to see what the update
     *  lands in, and a framework that reacted to that has reacted. Restored, but observed.
     *
     *  Off by default here and ON in a sweep, the same asymmetry `probes` carries: a sweep exists
     *  for nothing but recording the sample and asserts nothing afterwards. `{ clicks: true }`
     *  additionally presses `button[type=button]` (destructive-sounding names skipped, navigation
     *  aborts the pass) — never the default on an authenticated session, where a server mutation
     *  is invisible to any check this side of the network. */
    liveRegion?: boolean | {
        clicks?: boolean;
    };
    /** Run AXE-CORE on the page before recording it.
     *
     *  `scan` has always driven axe; your suite never did — and your suite is the only tier that
     *  reaches a page behind a login and a state machine, which is exactly where the criteria
     *  axe decides (computed contrast above all) were left « to assess » run after run.
     *
     *  Default `auto`: axe runs when `@axe-core/playwright` resolves from your project, and is
     *  silently skipped when it does not — so adding this costs nothing to a repo that has not
     *  installed it. `false` turns it off; `true` demands it and reports loudly if it cannot be
     *  resolved, which is what you want in CI where a silent downgrade is indistinguishable from
     *  a clean page. */
    axe?: boolean | "auto";
}
/** The bounds a repository may put on the live probes. Stated once, here, because the same
 *  list is read from `.ultra11yrc.json`, accepted at the call site and handed to the engine —
 *  three copies of a field list is three chances for one of them to fall behind.
 *
 *  `budgetMs` and `actionTimeoutMs` are not tuning in the same sense as the others: they are
 *  what stops a probe from spending SOMEBODY ELSE'S test timeout. See ProbeLimits. */
interface ProbeTuning {
    only?: string[];
    reflowWidth?: number;
    maxFocusables?: number;
    maxHits?: number;
    maxTriggers?: number;
    actionTimeoutMs?: number;
    budgetMs?: number;
}

export { type AuditLike as A, type CheckOptions as C, type FindingLike as F, type SnapshotPayload as S, slugify as s };
