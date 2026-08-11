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
}

export { type AuditLike as A, type CheckOptions as C, type FindingLike as F, type SnapshotPayload as S, slugify as s };
