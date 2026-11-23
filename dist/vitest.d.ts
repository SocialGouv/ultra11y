import { U as UnitCheckOptions, R as Renderable, T as TestContext } from './unit-C7c8k68J.js';
import { A as AuditLike } from './payload-BrdH5eEV.js';
export { F as FindingLike } from './payload-BrdH5eEV.js';

/** Audit a rendered component; throws when a finding reaches `failOn` (default `blocking`). */
declare const checkA11y: (target: Renderable, opts?: UnitCheckOptions) => Promise<AuditLike>;
/** The matcher, for `expect.extend({ toBeAccessible })`. */
declare const toBeAccessible: (this: (TestContext & {
    isNot?: boolean;
}) | undefined, received: Renderable, opts?: UnitCheckOptions) => {
    pass: boolean;
    message: () => string;
};

declare module "vitest" {
    interface Assertion<T = any> {
        /** Audit the rendered component with ultra11y; fails when a finding reaches `failOn`. */
        toBeAccessible(opts?: UnitCheckOptions): T;
    }
    interface AsymmetricMatchersContaining {
        toBeAccessible(opts?: UnitCheckOptions): unknown;
    }
}

export { AuditLike, Renderable, UnitCheckOptions, checkA11y, toBeAccessible };
