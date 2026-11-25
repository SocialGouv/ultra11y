import { S as SnapshotPayload, C as CheckLang, F as FindingLike } from './payload-92OwFKBr.js';

type On = (event: string, handler: any) => void;
interface TaskPayload extends SnapshotPayload {
    failOn?: string | false;
    /** Forwarded from `cy.ultra11y({ lang })`: the language of the failure message and the report. */
    lang?: CheckLang;
    /** The name `cy.screenshot()` was called with, when the browser half took one. */
    screenshotName?: string;
    /** Forwarded from `cy.ultra11y({ report })` — the browser cannot write files, this side can. */
    report?: boolean | {
        out?: string;
        standard?: string;
        lang?: string;
    };
}
interface TaskResult {
    findings: FindingLike[];
    failing: FindingLike[];
    message: string;
}
/** Register the ultra11y task (and the screenshot capture) on Cypress's node events. */
declare function register(on: On): void;

export { type TaskPayload, type TaskResult, register as default };
