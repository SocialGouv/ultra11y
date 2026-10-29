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

import { launchChromium, localAvailable, localTierStatus, resolveLocalDeps } from "../src/scan-local.js";

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

// Playwright's default headless launch wants the exact `chromium_headless_shell-<rev>` its own
// version pins. Measured auditing a static site: Chrome stable installed, other revisions in the
// cache, and the scan refused to start until a 95 MB download. The launch now falls back on a
// browser already on the machine, and when it cannot, names the Playwright that was resolved.
describe("launchChromium", () => {
  const missing = new Error("browserType.launch: Executable doesn't exist at /cache/chromium_headless_shell-1234/chrome");
  const fake = (ok: (opts: { channel?: string }) => boolean) => {
    const calls: (string | undefined)[] = [];
    return {
      calls,
      chromium: {
        launch: async (opts: { channel?: string }) => {
          calls.push(opts.channel);
          if (ok(opts)) return { browser: opts.channel ?? "default" };
          throw missing;
        },
      },
    };
  };

  it("uses the pinned browser when it is there, and says nothing", async () => {
    const f = fake(() => true);
    const warned: string[] = [];
    expect(await launchChromium(f.chromium, ".", (m) => warned.push(m))).toEqual({ browser: "default" });
    expect(f.calls).toEqual([undefined]);
    expect(warned).toEqual([]);
  });

  it("falls back on the installed Google Chrome, and says so", async () => {
    const f = fake((o) => o.channel === "chrome");
    const warned: string[] = [];
    expect(await launchChromium(f.chromium, ".", (m) => warned.push(m))).toEqual({ browser: "chrome" });
    expect(f.calls).toEqual([undefined, "chromium", "chrome"]);
    expect(warned.join("\n")).toContain('channel "chrome"');
  });

  it("names the resolved Playwright when no browser at all can start", async () => {
    const f = fake(() => false);
    const root = project(false);
    const err = await launchChromium(f.chromium, root, () => {}).catch((e: Error) => e);
    expect(String(err)).toMatch(/@playwright\/test@1\.0\.0 resolved at \S*u11y-local-\S*index\.js/);
    expect(String(err)).toMatch(/install chromium/);
    expect(String(err)).not.toMatch(/ultra11y's own Playwright/);
  });

  it("does not mask a launch failure that is not a missing browser", async () => {
    const boom = { launch: async () => Promise.reject(new Error("Target page, context or browser has been closed")) };
    await expect(launchChromium(boom, ".", () => {})).rejects.toThrow(/has been closed/);
  });
});

// AN EXPLICIT BROWSER — `scan --browser-path`, `status --browser --browser-path`,
// `ULTRA11Y_BROWSER_PATH`.
//
// Playwright resolves its pinned headless shell, its full Chromium, then Google Chrome at the
// vendor's path. A distribution's Chromium (`/usr/bin/chromium` on Debian — what a sandboxed
// runner image ships) is on none of them, and the launch fallback above cannot reach it either:
// the caller was told to download a second browser to use the one it had. The path is an
// explicit choice, so the two halves below are the contract: the probe answers about THAT file,
// and the launch starts THAT file and nothing else.
describe("an explicit browser executable (BrowserChoice)", () => {
  it("makes the tier available on the named binary, whatever Playwright's own would be", () => {
    // The pinned binary is absent (project(false)) and that no longer matters: the file the
    // caller named is there, so the tier is usable — and the status says WHICH executable.
    const root = project(false);
    const named = join(root, "distro-chromium");
    writeFileSync(named, "#!/bin/sh\n");
    const s = localTierStatus(root, { browserPath: named });
    expect(s.ok).toBe(true);
    expect(s.executable).toBe(named);
    expect(localAvailable(root, { browserPath: named })).toBe(true);
  });

  it("refuses a named binary that is not on disk, naming the path and the flag", () => {
    // The opposite half: a present pinned browser (project(true)) must NOT rescue a wrong
    // explicit path — the answer is about the caller's choice, never about a substitute.
    const root = project(true);
    const missing = join(root, "no-such-chromium");
    const s = localTierStatus(root, { browserPath: missing });
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.reason).toContain(missing);
      expect(s.reason).toMatch(/--browser-path/);
      expect(s.executable).toBe(missing);
    }
    expect(localAvailable(root, { browserPath: missing })).toBe(false);
  });

  it("still needs the two packages: a browser alone is not a tier", () => {
    const bare = mkdtempSync(join(tmpdir(), "u11y-bp-bare-"));
    writeFileSync(join(bare, "package.json"), JSON.stringify({ name: "p", version: "1.0.0" }));
    const named = join(bare, "chromium");
    writeFileSync(named, "#!/bin/sh\n");
    // Both packages resolve from ultra11y's own install here, so the tier IS usable on the
    // named binary — the assertion that matters is that the answer never mentions the pinned
    // binary Playwright would have wanted.
    const s = localTierStatus(bare, { browserPath: named });
    expect(s.ok).toBe(true);
    expect(s.executable).toBe(named);
  });

  it("launches the named executable once, and never falls back on a channel", async () => {
    const launches: { channel?: string; executablePath?: string }[] = [];
    const chromium = {
      launch: async (opts: { channel?: string; executablePath?: string }) => {
        launches.push(opts);
        return { browser: opts.executablePath ?? opts.channel ?? "default" };
      },
    };
    const warned: string[] = [];
    expect(await launchChromium(chromium, ".", (m) => warned.push(m), { browserPath: "/usr/bin/chromium" })).toEqual({ browser: "/usr/bin/chromium" });
    expect(launches).toEqual([{ args: ["--no-sandbox", "--disable-dev-shm-usage"], executablePath: "/usr/bin/chromium" }]);
    expect(warned).toEqual([]);
  });

  it("reports a failed explicit launch on the path the caller can fix, without trying another browser", async () => {
    // Even a "missing browser" failure — the exact signature the default launch falls back
    // on — stays an error here: a fallback would audit with a browser the caller did not
    // choose, and say so only on stderr.
    const calls: unknown[] = [];
    const chromium = {
      launch: async (opts: unknown) => {
        calls.push(opts);
        throw new Error("browserType.launch: Executable doesn't exist at /usr/bin/chromium");
      },
    };
    const err = await launchChromium(chromium, ".", () => {}, { browserPath: "/usr/bin/chromium" }).catch((e: Error) => e);
    expect(String(err)).toContain("/usr/bin/chromium");
    expect(String(err)).toMatch(/--browser-path/);
    expect(String(err)).toMatch(/never replaced/);
    expect(calls).toHaveLength(1);
  });
});
