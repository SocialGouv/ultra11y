// THE BROWSER TIER, ASKED FOR RATHER THAN GUESSED AT.
//
// `scan --runtime local` resolves `@playwright/test` and `@axe-core/playwright` from the
// audited project first and from ultra11y's own install second (src/scan-local.ts
// resolveAnchors). Run as a GitHub Action, that second anchor is
// `$GITHUB_ACTION_PATH/scripts/ultra11y.mjs` — a checkout with no node_modules beside it — so
// a consumer whose repository does not pin Playwright gets no local tier at all, degrades to
// Docker, and silently loses every rendering criterion.
//
// The action can install the tier itself, but only if it can ask whether it needs to. It must
// ask the ENGINE that question rather than re-derive it in bash: `localTierStatus` already
// checks both packages AND the browser binary on disk, and a second implementation in shell is
// a second answer that will eventually disagree with the one `scan` acts on.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";
import { localTierStatus } from "../src/scan-local.js";

/** A project directory that resolves nothing — the shape of a consumer repo with no Playwright. */
function bareProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "u11y-status-browser-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", version: "1.0.0" }));
  return dir;
}

/** Run the CLI, capturing stdout. */
async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.join(" ")));
  try {
    const code = await main(argv);
    return { code: code as number, out: lines.join("\n") };
  } finally {
    spy.mockRestore();
  }
}

describe("status --browser", () => {
  // It reports the ENGINE'S answer, not a second one. That is the whole point: the action
  // branches on this to decide whether to install a tier, and `scan --runtime local` then acts
  // on `localTierStatus` itself — so the two must be the same function, not two readings of
  // the same idea.
  //
  // Note what this cannot assert from inside this repository: `resolveAnchors` tries the
  // audited project FIRST and ultra11y's own install SECOND, and here that second anchor is a
  // real `node_modules` carrying both packages. So a bare project still resolves. The anchor
  // that fails is the ACTION's — `$GITHUB_ACTION_PATH/scripts/ultra11y.mjs`, a checkout with no
  // node_modules beside it — which no unit test can stage.
  it("answers whether the local tier resolves, as JSON, agreeing with the engine", async () => {
    const dir = bareProject();
    const { code, out } = await run(["status", "--browser", "--cwd", dir, "--json"]);
    expect(code).toBe(0);
    const j = JSON.parse(out) as { browser?: { ok: boolean; reason?: string } };
    expect(j.browser, "status --browser must report a browser block").toBeDefined();
    expect(j.browser?.ok, "the CLI must report localTierStatus, never a second opinion").toBe(localTierStatus(dir).ok);
  });

  it("carries an actionable reason whenever it says no", async () => {
    const dir = bareProject();
    const status = localTierStatus(dir);
    const j = JSON.parse((await run(["status", "--browser", "--cwd", dir, "--json"])).out) as { browser: { ok: boolean; reason?: string } };
    if (status.ok) {
      expect(j.browser.reason, "a resolved tier has nothing to explain").toBeUndefined();
    } else {
      // Never a bare "unavailable": the caller has to know whether to install a package or a
      // browser binary, and they are different fixes.
      expect(j.browser.reason ?? "").toMatch(/@playwright\/test|@axe-core\/playwright|browser|playwright install/);
    }
  });

  it("exits 0 either way — it is a question, not a gate", async () => {
    // A doctor that fails is a doctor nobody runs in an `if`. The action branches on the
    // ANSWER; the exit code must stay reserved for "the question could not be asked".
    expect((await run(["status", "--browser", "--cwd", bareProject(), "--json"])).code).toBe(0);
  });

  it("prints a human line without --json", async () => {
    const { out } = await run(["status", "--browser", "--cwd", bareProject()]);
    expect(out).toMatch(/browser/i);
  });

  // The default `status` is the agent-harness doctor and is consumed by other tooling; adding
  // a browser question must not change what it already answers.
  it("leaves the plain status report untouched", async () => {
    const j = JSON.parse((await run(["status", "--json"])).out) as Record<string, unknown>;
    expect(j.targets).toBeDefined();
    expect(j.browser, "the browser block is opt-in — asking costs a resolve").toBeUndefined();
  });
});
