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
    probes?: boolean | string[] | {
        only?: string[];
        reflowWidth?: number;
        maxFocusables?: number;
        maxHits?: number;
    };
}

export { type AuditLike as A, type CheckOptions as C, type FindingLike as F, type SnapshotPayload as S, slugify as s };
