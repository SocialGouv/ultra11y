// CLI ergonomics of a first, skill-driven run (#233): the runbook's ledger replay on a run with
// no ledger yet, hints that print the invocation actually in use, a render that says what to
// install, a journey retried once after a transient browser close, and an unreadable
// node_modules named as such.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { BARE, invocationFor, rewriteInvocation } from "../src/invocation.js";
import { isBrowserClosedError, withBrowserClosedRetry } from "../src/journey-run.js";
import { missingRendererPackages, rendererInstallHint } from "../src/render-engine.js";
import { unreadableNodeModules } from "../src/scan-local.js";
import type { JourneyRecord } from "../src/types.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const temps: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "u11y-233-"));
  temps.push(d);
  return d;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const d of temps.splice(0)) {
    try {
      chmodSync(join(d, "node_modules"), 0o755);
    } catch {
      /* not every temp dir has one */
    }
    rmSync(d, { recursive: true, force: true });
  }
});

function capture(): { err: string[]; out: string[] } {
  const err: string[] = [];
  const out: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  return { err, out };
}

describe("verify --apply on the default ledger path (#233)", () => {
  it("a missing ledger at .ultra11y/verdicts/<standard>.json is a no-op that exits 0, with an info line", async () => {
    const { err } = capture();
    const code = await main(["verify", "--apply", ".ultra11y/verdicts/__absent-233.json", "--in", "audits/audit-latest.json", "--standard", "rgaa"]);
    expect(code).toBe(0);
    expect(err.join("\n")).toMatch(/ⓘ ultra11y verify : aucun registre de verdicts en \.ultra11y\/verdicts\/__absent-233\.json \(premier passage\)/);
  });

  it("an explicitly named missing file elsewhere still exits 2", async () => {
    const { err } = capture();
    const code = await main(["verify", "--apply", join(tmp(), "nowhere.json")]);
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/fichier --apply introuvable/);
  });
});

describe("the invocation the hints print (#233)", () => {
  it("derives the command prefix from the script node ran", () => {
    const cwd = "/work/app";
    expect(invocationFor("/home/u/.claude/skills/ultra11y/scripts/ultra11y.mjs", cwd)).toBe("node /home/u/.claude/skills/ultra11y/scripts/ultra11y.mjs");
    expect(invocationFor("/work/app/scripts/ultra11y.mjs", cwd)).toBe("node scripts/ultra11y.mjs");
    expect(invocationFor("/Users/u/My Skills/ultra11y/scripts/ultra11y.mjs", cwd)).toBe('node "/Users/u/My Skills/ultra11y/scripts/ultra11y.mjs"');
    expect(invocationFor("/home/u/.npm/_npx/abc123/node_modules/.bin/ultra11y", cwd)).toBe("npx -y ultra11y");
    expect(invocationFor("/work/app/node_modules/.bin/ultra11y", cwd)).toBe("npx ultra11y");
    expect(invocationFor("/usr/local/bin/ultra11y", cwd)).toBe(BARE);
    expect(invocationFor("/repo/node_modules/vitest/vitest.mjs", cwd)).toBe(BARE);
    expect(invocationFor(undefined, cwd)).toBe(BARE);
  });

  it("rewrites command code spans only — never a message label, a package name or a JSON payload", () => {
    const inv = "node scripts/ultra11y.mjs";
    expect(rewriteInvocation("Then `ultra11y sample check --standard rgaa` and `ultra11y scan --sample`.", inv)).toBe(
      "Then `node scripts/ultra11y.mjs sample check --standard rgaa` and `node scripts/ultra11y.mjs scan --sample`.",
    );
    expect(rewriteInvocation("ultra11y verify : fichier introuvable.", inv)).toBe("ultra11y verify : fichier introuvable.");
    expect(rewriteInvocation("import `ultra11y/playwright`", inv)).toBe("import `ultra11y/playwright`");
    expect(rewriteInvocation('{"hint":"`ultra11y scan`"}', inv)).toBe('{"hint":"`ultra11y scan`"}');
    expect(rewriteInvocation("`ultra11y scan`", BARE)).toBe("`ultra11y scan`");
  });

  it("the shipped skill bundle prints its own path in its hints", () => {
    const dir = tmp();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    writeFileSync(join(dir, "src", "A.jsx"), 'export default function A() { return <a href="/">x</a>; }\n');
    const bundle = join(ROOT, "skills", "ultra11y", "scripts", "ultra11y.mjs");
    let out = "";
    try {
      execFileSync(process.execPath, [bundle, "render", ".", "--no-snapshots"], { cwd: dir, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      out = String((e as { stdout?: string }).stdout ?? "");
    }
    expect(out).toContain(`\`node ${bundle} audit\``);
    expect(out).not.toContain("`ultra11y audit`");
  });
});

describe("render with no React renderer says what to install (#233)", () => {
  it("names the missing packages and both ways to provide them", () => {
    const dir = tmp();
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    const missing = missingRendererPackages(dir);
    expect(missing).toEqual(["react", "react-dom"]);
    const fr = rendererInstallHint(missing, dir, "fr")!;
    expect(fr).toContain("manquant : react, react-dom");
    expect(fr).toContain("`npm install --save-dev react react-dom`");
    expect(fr).toContain("NODE_PATH=");
    expect(rendererInstallHint(missing, dir, "en")).toContain("missing: react, react-dom");
    expect(rendererInstallHint([], dir, "fr")).toBeUndefined();
  });

  it("the render command prints the hint under its unit list", async () => {
    const dir = tmp();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "package.json"), '{"name":"x"}');
    writeFileSync(join(dir, "src", "A.jsx"), 'export default function A() { return <a href="/">x</a>; }\n');
    const { out } = capture();
    const code = await main(["render", dir, "--no-snapshots"]);
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/Moteur de rendu React introuvable .* manquant : react, react-dom\. Installez-le\(s\) dans le projet audité/);
  });
});

describe("journey run retries once after a transient browser close (#233)", () => {
  const rec = (status: JourneyRecord["status"], reason?: string): JourneyRecord => ({ status, ...(reason ? { reason } : {}) }) as JourneyRecord;
  const closed = "step 0 (goto http://localhost:3000/): navigation failed: page.goto: Target page, context or browser has been closed";

  it("recognises Playwright's closed-target errors, and only those", () => {
    expect(isBrowserClosedError(closed)).toBe(true);
    expect(isBrowserClosedError("browserContext.newPage: Target closed")).toBe(true);
    expect(isBrowserClosedError("HTTP 404 at http://x/")).toBe(false);
    expect(isBrowserClosedError(undefined)).toBe(false);
  });

  it("a failure on a closed browser is retried once, after the reset, and logged", async () => {
    const attempt = vi.fn<() => Promise<JourneyRecord>>().mockResolvedValueOnce(rec("failed", closed)).mockResolvedValueOnce(rec("done"));
    const reset = vi.fn(async () => {});
    const onRetry = vi.fn();
    const out = await withBrowserClosedRetry(attempt, reset, onRetry);
    expect(out.status).toBe("done");
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(closed);
  });

  it("a thrown closed-browser error is retried too; a second close is the outcome", async () => {
    const attempt = vi
      .fn<() => Promise<JourneyRecord>>()
      .mockRejectedValueOnce(new Error("browser.newContext: Target page, context or browser has been closed"))
      .mockResolvedValueOnce(rec("failed", closed));
    const out = await withBrowserClosedRetry(
      attempt,
      async () => {},
      () => {},
    );
    expect(out.status).toBe("failed");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("any other failure is not retried", async () => {
    const attempt = vi.fn<() => Promise<JourneyRecord>>().mockResolvedValue(rec("failed", "step 1 (click): no element matched"));
    const onRetry = vi.fn();
    await withBrowserClosedRetry(attempt, async () => {}, onRetry);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    await expect(
      withBrowserClosedRetry(
        () => Promise.reject(new Error("boom")),
        async () => {},
        onRetry,
      ),
    ).rejects.toThrow("boom");
  });
});

describe("an unreadable node_modules is named as such (#233)", () => {
  it("reports the path a permission error names", () => {
    const err = Object.assign(new Error("EPERM: operation not permitted, scandir '/p/node_modules'"), { code: "EPERM", path: "/p/node_modules" });
    expect(unreadableNodeModules(tmp(), err)).toEqual({ path: "/p/node_modules", code: "EPERM" });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("finds an unreadable node_modules on the resolution path", () => {
    const dir = tmp();
    const nm = join(dir, "node_modules");
    mkdirSync(nm);
    expect(unreadableNodeModules(dir)).toBeUndefined();
    chmodSync(nm, 0o000);
    const hit = unreadableNodeModules(join(dir));
    expect(hit?.path).toBe(nm);
    expect(["EACCES", "EPERM"]).toContain(hit?.code);
  });
});
