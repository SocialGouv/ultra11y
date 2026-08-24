// The committed src/data/wcag.json (+ wcag-universe.json) is GENERATED from the vendored
// W3C snapshots (scripts/vendor/wcag-2.2-*.json) by scripts/build-standards.mjs.
//
// Guarded here, in the normal test run, for the reason guidance-wcag-sync.test.ts gives and
// this dataset learned the hard way: the daily standards-refresh workflow gates it only when
// something changed UPSTREAM. A hand edit to the committed file changes nothing upstream, so
// it sailed through every gate — SC 1.3.1 was given three presentational-* rules that
// RULE_SC_COVERAGE never cited, CI stayed green, and the nightly refresh went red on main
// two nights running before anyone read the log.
//
// Same shape as rgaa-pack-sync.test.ts and guidance-wcag-sync.test.ts: run the generator's
// `--check` offline, vendored data only, no network, and it writes nothing.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("src/data/wcag*.json stays in sync with the vendored W3C source", () => {
  it("`build-standards.mjs --check` reports no drift and exits 0", () => {
    const out = execFileSync(process.execPath, [join(ROOT, "scripts/build-standards.mjs"), "--check"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    expect(out).toMatch(/match the vendored source/);
  });

  it("refuses to combine `--check` with a network refresh", () => {
    expect(() =>
      execFileSync(process.execPath, [join(ROOT, "scripts/build-standards.mjs"), "--check", "--refresh-fr"], {
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow(/offline by construction/);
  });
});
