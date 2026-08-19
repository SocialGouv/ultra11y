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
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { localAvailable, localTierStatus } from "../src/scan-local.js";

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

  it("is false when the packages do not resolve at all", () => {
    const bare = mkdtempSync(join(tmpdir(), "u11y-local-bare-"));
    writeFileSync(join(bare, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
    expect(localAvailable(bare)).toBe(false);
  });
});

describe("localTierStatus", () => {
  // `runtime: auto` degrades to Docker when the local tier is refused, and a silent
  // degrade is indistinguishable from a working fallback — the CI stayed red for a day
  // on exactly that. The status must therefore NAME what is missing, so the one log line
  // a reader gets answers "what do I install" without re-deriving the probe.
  it("names the package that failed to resolve", () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-status-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
    const s = localTierStatus(root);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.reason).toContain("@playwright/test");
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
