import { S as SnapshotPayload, F as FindingLike } from './payload-D0VQYlGS.js';

type On = (event: string, handler: any) => void;
interface TaskPayload extends SnapshotPayload {
    failOn?: string | false;
    /** The name `cy.screenshot()` was called with, when the browser half took one. */
    screenshotName?: string;
}
interface TaskResult {
    findings: FindingLike[];
    failing: FindingLike[];
    message: string;
}
/** Register the ultra11y task (and the screenshot capture) on Cypress's node events. */
declare function register(on: On): void;

export { type TaskPayload, type TaskResult, register as default };
