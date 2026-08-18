import { C as CheckOptions } from './payload-DzQb84Kw.js';
export { s as slugify } from './payload-DzQb84Kw.js';

interface CypressCheckOptions extends CheckOptions {
    /** Capture a viewport screenshot so the pixel tier can run. On by default — the plugin
     *  reads it back through Cypress's `after:screenshot` event. */
    screenshot?: boolean;
    /** Also write the per-page report once this page is recorded. Off by default: a report per
     *  checked page would be wasteful in a suite, so turn it on in a final test.
     *
     *  Cypress test code runs in the browser and cannot write files, so the option is only
     *  DECLARED here and forwarded — the Node half does the work. Same option, same behaviour
     *  as Playwright's; a runner that silently ignored it would be worse than one that lacked it. */
    report?: boolean | {
        out?: string;
        standard?: string;
        lang?: string;
    };
}
declare function registerUltra11yCommand(): void;

export { type CypressCheckOptions, registerUltra11yCommand };
