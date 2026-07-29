import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { hookScript, stagedHookScript, ciWorkflow, writeHook, writeCi } from "../src/init.js";
import { VERSION } from "../src/types.js";

const tmps: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "u11y-init-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("pre-commit hook", () => {
  it("defaults to the strict-staged auto-fix gate — valid POSIX sh, gated, bypassable", () => {
    const d = tmp();
    const path = writeHook(d, "scripts/ultra11y.mjs", "bloquant");
    const script = readFileSync(path, "utf8");
    // `sh -n` parses without executing — proves the generated script is valid.
    expect(() => execFileSync("sh", ["-n", path])).not.toThrow();
    expect(script).toContain("SKIP_A11Y");
    expect(script).toContain("command -v node");
    expect(script).toContain("audit --staged --fail-on blocking");
    expect(script).toContain("fix --staged --write --safe");
    expect(script).not.toContain("--baseline"); // the default gate needs no baseline
    expect(script).toContain('node "$ULTRA11Y"');
  });

  it('generates the legacy baseline regression gate with mode "baseline"', () => {
    const d = tmp();
    const path = writeHook(d, "scripts/ultra11y.mjs", "bloquant", "baseline");
    const script = readFileSync(path, "utf8");
    expect(() => execFileSync("sh", ["-n", path])).not.toThrow();
    expect(script).toContain("audit --changed --baseline audits/baseline.json --fail-on blocking");
    expect(script).not.toContain("--staged");
  });

  it("writes an executable hook and threads --fail-on into both variants", () => {
    const d = tmp();
    const path = writeHook(d, "x.mjs", "majeur");
    expect(statSync(path).mode & 0o111).not.toBe(0); // has an execute bit
    expect(stagedHookScript("x.mjs", "majeur")).toContain("--fail-on major");
    expect(hookScript("x.mjs", "majeur")).toContain("--fail-on major");
    // Both variants must be valid POSIX sh.
    for (const s of [stagedHookScript("x.mjs", "mineur"), hookScript("x.mjs", "mineur")]) {
      expect(s.startsWith("#!/bin/sh")).toBe(true);
    }
  });
});

describe("CI workflow", () => {
  const doc = (failOn: "bloquant" | "majeur") => {
    const path = writeCi(tmp(), "scripts/ultra11y.mjs", failOn);
    return parse(readFileSync(path, "utf8")) as {
      on: unknown;
      permissions?: Record<string, string>;
      jobs: { ultra11y: { steps: { uses?: string; with?: Record<string, string> }[] } };
    };
  };

  it("is valid YAML with an ultra11y job, triggered on pull requests", () => {
    const d = doc("bloquant");
    expect(d.jobs.ultra11y).toBeDefined();
    expect(ciWorkflow("x", "bloquant")).toContain("pull_request");
  });

  it("consumes the shipped action, so a user gets the annotations and not just an exit code", () => {
    const step = doc("bloquant").jobs.ultra11y.steps.find((s) => s.uses?.startsWith("maxgfr/ultra11y"));
    expect(step, "the workflow must use the ultra11y action").toBeDefined();
  });

  it("PINS the action to a tag that exists — never a moving branch", () => {
    const step = doc("bloquant").jobs.ultra11y.steps.find((s) => s.uses?.startsWith("maxgfr/ultra11y"));
    // `@main` would silently change under the user; the engine's own version always has a
    // matching `v<version>` release tag, so pinning to it is both valid and reproducible.
    expect(step?.uses).toBe(`maxgfr/ultra11y@v${VERSION}`);
    expect(step?.uses).not.toContain("@main");
  });

  it("tells the reader the major alias exists, for those who want fixes automatically", () => {
    expect(ciWorkflow("x", "bloquant")).toContain(`maxgfr/ultra11y@v${VERSION.split(".")[0]}`);
  });

  it("passes the regression gate through: diff vs the base ref, against the committed baseline", () => {
    const step = doc("bloquant").jobs.ultra11y.steps.find((s) => s.uses?.startsWith("maxgfr/ultra11y"));
    expect(step?.with?.since).toBe("auto");
    expect(step?.with?.baseline).toBe("audits/baseline.json");
    expect(step?.with?.["fail-on"]).toBe("blocking");
  });

  it("carries the chosen severity through", () => {
    const step = doc("majeur").jobs.ultra11y.steps.find((s) => s.uses?.startsWith("maxgfr/ultra11y"));
    expect(step?.with?.["fail-on"]).toBe("major");
  });

  it("checks out enough history for the diff gate to resolve the base ref", () => {
    const checkout = doc("bloquant").jobs.ultra11y.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(String(checkout?.with?.["fetch-depth"])).toBe("0");
  });

  it("grants the permission SARIF upload needs, and no write it does not", () => {
    const perms = doc("bloquant").permissions ?? {};
    expect(perms["security-events"]).toBe("write");
    expect(perms.contents).toBe("read");
    expect(perms["pull-requests"]).toBeUndefined(); // opt-in, together with `comment`
  });

  it("still documents the vendored no-action route", () => {
    expect(ciWorkflow("vendor/ultra11y.mjs", "bloquant")).toContain("vendor/ultra11y.mjs");
  });
});
