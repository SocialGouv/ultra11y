// `ultra11y/vitest` — audit a component your Vitest suite rendered, in the state the test built.
//
//   import { expect } from "vitest";
//   import { checkA11y, toBeAccessible } from "ultra11y/vitest";
//   expect.extend({ toBeAccessible });
//
//   const { container } = render(<Button variant="primary" />);
//   await checkA11y(container, { as: "button-primary", failOn: "major" });
//   expect(container).toBeAccessible();
//
// Needs a DOM environment (`environment: "jsdom"` or `"happy-dom"`). Each check writes
// `.ultra11y/captures/<id>.html`, which `ultra11y audit` re-reads offline. The implementation is
// shared with `ultra11y/jest` (src/integrations/unit.ts); only the type augmentation differs.
import type {} from "vitest";
import { type Renderable, type UnitCheckOptions, createUnitIntegration } from "./unit.js";

const unit = createUnitIntegration("vitest");

/** Audit a rendered component; throws when a finding reaches `failOn` (default `blocking`). */
export const checkA11y = unit.checkA11y;
/** The matcher, for `expect.extend({ toBeAccessible })`. */
export const toBeAccessible = unit.toBeAccessible;

export type { AuditLike, FindingLike } from "./unit.js";
export type { Renderable, UnitCheckOptions };

declare module "vitest" {
  interface Assertion<T = any> {
    /** Audit the rendered component with ultra11y; fails when a finding reaches `failOn`. */
    toBeAccessible(opts?: UnitCheckOptions): T;
  }
  interface AsymmetricMatchersContaining {
    toBeAccessible(opts?: UnitCheckOptions): unknown;
  }
}
