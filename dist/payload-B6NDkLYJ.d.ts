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
}

export { type AuditLike as A, type CheckOptions as C, type FindingLike as F, type SnapshotPayload as S, slugify as s };
