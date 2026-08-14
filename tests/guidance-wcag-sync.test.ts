// The committed src/data/guidance/wcag.json is GENERATED from the vendored W3C techniques
// snapshot (scripts/vendor/wcag-2.2-techniques.json) by scripts/build-guidance-wcag.mjs.
//
// Guarded here, in the normal test run, and not only by the daily standards-refresh
// workflow: that workflow gates the dataset when something changed UPSTREAM. A hand edit to
// the committed file changes nothing upstream, so it would sail through — which is exactly
// the state this dataset used to be in, and the reason it was replaced by a generator.
//
// Same shape as rgaa-pack-sync.test.ts: run the generator's `--check` offline, vendored
// data only, no network.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("src/data/guidance/wcag.json stays in sync with the vendored W3C source", () => {
  it("`build-guidance-wcag.mjs --check` reports no drift and exits 0", () => {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/build-guidance-wcag.mjs"), "--check"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(out).toMatch(/matches the vendored source/);
  });
});
