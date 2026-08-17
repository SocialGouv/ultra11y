// The E2E fixtures had the hole `scan --sample` was fixed for: `as`/`name` is applied to
// whatever is on screen, so a guarded route that redirected got filed under the requested
// page's identity — a sheet, a screenshot and a rate describing a different screen. egapro
// re-implemented the guard in its own repo; every other consumer of `ultra11y/playwright`
// had no way to. `expectPath` closes it in the package.
import { describe, expect, it } from "vitest";
import { stayedOnPage } from "../src/integrations/payload.js";

describe("stayedOnPage — the E2E fixtures' redirect guard", () => {
  it("accepts the same path, whatever the app appends", () => {
    expect(stayedOnPage("/aide", "http://localhost:3000/aide")).toBe(true);
    expect(stayedOnPage("/aide", "http://localhost:3000/aide?from=nav")).toBe(true);
    expect(stayedOnPage("/aide", "http://localhost:3000/aide/")).toBe(true);
    expect(stayedOnPage("http://localhost:3000/aide", "http://localhost:3000/aide")).toBe(true);
  });

  it("rejects the bounce it exists for", () => {
    expect(stayedOnPage("/declaration/etape/4", "http://localhost:3000/declaration/etape/1")).toBe(false);
    expect(stayedOnPage("/admin", "http://localhost:3000/login")).toBe(false);
  });

  it("stays out of the way when there is nothing to compare", () => {
    expect(stayedOnPage("", "http://x/y")).toBe(true);
    expect(stayedOnPage("/a", "")).toBe(true);
  });

  it("is opt-in: no expectPath, no refusal", () => {
    // The option is absent from most callers; absence must never be read as a mismatch.
    const opts: { expectPath?: string } = {};
    expect(opts.expectPath ?? "").toBe("");
    expect(stayedOnPage(opts.expectPath ?? "", "http://x/anything")).toBe(true);
  });
});
