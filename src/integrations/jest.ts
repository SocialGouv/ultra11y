// `ultra11y/jest` — audit a component your Jest suite rendered, in the state the test built.
//
//   import { checkA11y, toBeAccessible } from "ultra11y/jest";
//   expect.extend({ toBeAccessible });
//
//   const { container } = render(<Button variant="primary" />);
//   await checkA11y(container, { as: "button-primary", failOn: "major" });
//   expect(container).toBeAccessible();
//
// Needs a DOM environment (`testEnvironment: "jsdom"`). Shipped as CommonJS too, since Jest
// requires its dependencies unless it runs in ESM mode. Each check writes
// `.ultra11y/captures/<id>.html`, which `ultra11y audit` re-reads offline. The implementation is
// shared with `ultra11y/vitest` (src/integrations/unit.ts); only the type augmentation differs.
import { type Renderable, type UnitCheckOptions, createUnitIntegration } from "./unit.js";

const unit = createUnitIntegration("jest");

/** Audit a rendered component; throws when a finding reaches `failOn` (default `blocking`). */
export const checkA11y = unit.checkA11y;
/** The matcher, for `expect.extend({ toBeAccessible })`. */
export const toBeAccessible = unit.toBeAccessible;

export type { AuditLike, FindingLike } from "./unit.js";
export type { Renderable, UnitCheckOptions };

declare global {
  // `@types/jest`'s global namespace — merged into when it is installed, inert when it is not.
  namespace jest {
    interface Matchers<R> {
      /** Audit the rendered component with ultra11y; fails when a finding reaches `failOn`. */
      toBeAccessible(opts?: UnitCheckOptions): R;
    }
  }
}
