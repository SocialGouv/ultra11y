import { U as UnitCheckOptions, R as Renderable, T as TestContext } from './unit-C7c8k68J.js';
import { A as AuditLike } from './payload-BPGhg2sa.js';
export { F as FindingLike } from './payload-BPGhg2sa.js';

/** Audit a rendered component; throws when a finding reaches `failOn` (default `blocking`). */
declare const checkA11y: (target: Renderable, opts?: UnitCheckOptions) => Promise<AuditLike>;
/** The matcher, for `expect.extend({ toBeAccessible })`. */
declare const toBeAccessible: (this: (TestContext & {
    isNot?: boolean;
}) | undefined, received: Renderable, opts?: UnitCheckOptions) => {
    pass: boolean;
    message: () => string;
};

declare global {
    namespace jest {
        interface Matchers<R> {
            /** Audit the rendered component with ultra11y; fails when a finding reaches `failOn`. */
            toBeAccessible(opts?: UnitCheckOptions): R;
        }
    }
}

export { AuditLike, Renderable, UnitCheckOptions, checkA11y, toBeAccessible };
