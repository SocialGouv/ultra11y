// `runtime: auto` — what makes the LOCAL tier "available".
//
// Its contract is to degrade to Docker when the local tier is not there. It decided that on
// module RESOLUTION alone, and `npm i @playwright/test` and `npx playwright install` are two
// separate steps that CI images routinely do only one of. So on a machine with the package and
// no browsers, `auto` announced the local tier and then died on the launch — the one outcome
// the fallback exists to prevent.
//
// Measured here the day Playwright became a devDependency of this repository: three
// `--runtime local` e2e tests and the action's own crawl job switched themselves on in jobs
// that install no browser, and failed instead of degrading.
//
// Resolution now tries TWO anchors — the target project first, this package second — because
// `@playwright/test` and `@axe-core/playwright` are dependencies of ultra11y rather than a
// prerequisite every caller had to copy into its own manifest. The order is the contract: a
// project that pinned its own Playwright keeps it, and a project that has none still gets a
// tier. Both halves are asserted below.
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { localAvailable, localTierStatus, resolveLocalDeps } from "../src/scan-local.js";

/** A project that RESOLVES both packages, whose Playwright reports a browser path that may or
 *  may not exist. Written as real modules so `createRequire` resolves them for real. */
function project(binaryExists: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-local-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
  const bin = join(root, "chrome-bin");
  if (binaryExists) writeFileSync(bin, "#!/bin/sh\n");
  for (const [name, body] of [
    ["@playwright/test", `exports.chromium = { executablePath: () => ${JSON.stringify(bin)} };`],
    ["@axe-core/playwright", "module.exports = class AxeBuilder {};"],
  ] as const) {
    const dir = join(root, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", main: "index.js" }));
    writeFileSync(join(dir, "index.js"), body);
  }
  return root;
}

describe("localAvailable", () => {
  it("is true when the packages resolve AND the browser is on disk", () => {
    expect(localAvailable(project(true))).toBe(true);
  });

  it("is FALSE when the packages resolve but no browser was ever installed", () => {
    // The case that broke: `auto` must fall back to Docker here, not announce a tier it cannot
    // start. A launch failure is indistinguishable, to a reader of the log, from a real defect.
    expect(localAvailable(project(false))).toBe(false);
  });

  it("falls back to THIS package's Playwright when the project has none", () => {
    // Both packages are dependencies of ultra11y, so a project that installed ultra11y alone
    // still gets the tier — that is the whole point of the second anchor. What such a project
    // cannot conjure is a browser nobody downloaded, so the answer here is a function of the
    // binary on disk and never of a missing package. Asserting a fixed boolean would only
    // encode whether THIS machine ran `playwright install`.
    const bare = mkdtempSync(join(tmpdir(), "u11y-local-bare-"));
    writeFileSync(join(bare, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
    const s = localTierStatus(bare);
    expect(localAvailable(bare)).toBe(s.ok);
    if (!s.ok) expect(s.reason).toMatch(/playwright install|browser/i);
  });

  it("prefers the project's own Playwright over this package's", () => {
    // The load-bearing half of the two-anchor ORDER, asserted on the module actually LOADED and
    // not on a boolean that a machine with no browsers would satisfy by accident. A project that
    // pinned its own Playwright must keep it: two copies in one process hand out `Page` objects
    // that the other one's fixtures do not recognise, and the failure surfaces far from here.
    const root = project(true);
    const { chromium } = resolveLocalDeps(root);
    expect(chromium.executablePath()).toBe(join(root, "chrome-bin"));
  });
});

describe("localTierStatus", () => {
  // `runtime: auto` degrades to Docker when the local tier is refused, and a silent
  // degrade is indistinguishable from a working fallback — the CI stayed red for a day
  // on exactly that. The status must therefore NAME what is missing, so the one log line
  // a reader gets answers "what do I install" without re-deriving the probe.
  it("never blames a missing package on a bare project", () => {
    // It used to, and correctly so: resolution was anchored on `--cwd` alone, so a project
    // without the two packages had no tier. Since they became dependencies of ultra11y, that
    // reason would be a lie — the packages ARE resolvable, from here. Whatever refuses the tier
    // now, it is not their absence, and the one log line a reader gets must not send them off
    // installing something they already have.
    const root = mkdtempSync(join(tmpdir(), "u11y-status-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
    const s = localTierStatus(root);
    if (!s.ok) expect(s.reason).not.toMatch(/resolves neither/);
  });

  it("names the missing browser binary when the packages resolve", () => {
    const s = localTierStatus(project(false));
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toMatch(/playwright install|browser/i);
  });

  it("is ok exactly where localAvailable is true, and consistent on both halves", () => {
    expect(localTierStatus(project(true)).ok).toBe(true);
    expect(localTierStatus(project(true)).ok).toBe(localAvailable(project(true)));
    expect(localTierStatus(project(false)).ok).toBe(localAvailable(project(false)));
  });
});
