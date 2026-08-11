import { C as CheckOptions } from './payload-D0VQYlGS.js';
export { s as slugify } from './payload-D0VQYlGS.js';

interface CypressCheckOptions extends CheckOptions {
    /** Capture a viewport screenshot so the pixel tier can run. On by default — the plugin
     *  reads it back through Cypress's `after:screenshot` event. */
    screenshot?: boolean;
}
declare function registerUltra11yCommand(): void;

export { type CypressCheckOptions, registerUltra11yCommand };
