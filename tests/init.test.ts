import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { hookScript, stagedHookScript, ciWorkflow, writeHook, writeCi, ITERION_RGAA_AUDIT_URL } from "../src/init.js";
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
  type Step = { uses?: string; name?: string; run?: string; with?: Record<string, string> };
  const doc = (failOn: "bloquant" | "majeur") => {
    const path = writeCi(tmp(), "scripts/ultra11y.mjs", failOn);
    return parse(readFileSync(path, "utf8")) as {
      on: unknown;
      permissions?: Record<string, string>;
      jobs: { ultra11y: { steps: Step[] } };
    };
  };
  const gate = (failOn: "bloquant" | "majeur"): string => {
    const step = doc(failOn).jobs.ultra11y.steps.find((s) => s.run?.includes(" audit"));
    if (!step?.run) throw new Error("the workflow runs no audit");
    return step.run;
  };

  it("is valid YAML with an ultra11y job, triggered on pull requests", () => {
    const d = doc("bloquant");
    expect(d.jobs.ultra11y).toBeDefined();
    expect(ciWorkflow("x", "bloquant")).toContain("pull_request");
  });

  it("runs the engine CLI itself — the composite action no longer exists", () => {
    const steps = doc("bloquant").jobs.ultra11y.steps;
    expect(steps.some((s) => s.uses?.startsWith("SocialGouv/ultra11y"))).toBe(false);
    expect(gate("bloquant")).toContain("npx -y ultra11y@");
  });

  it("PINS the engine to the version that generated it — never `latest`", () => {
    expect(gate("bloquant")).toContain(`ultra11y@${VERSION} audit`);
    expect(ciWorkflow("x", "bloquant")).not.toMatch(/ultra11y@latest/);
  });

  it("points at iterion's rgaa-audit bot for the full audit, since this is only a gate", () => {
    expect(ciWorkflow("x", "bloquant")).toContain(ITERION_RGAA_AUDIT_URL);
    expect(ITERION_RGAA_AUDIT_URL).toBe("https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit");
  });

  it("passes the regression gate through: diff vs the base ref, against the committed baseline", () => {
    const run = gate("bloquant");
    expect(run).toContain(`--since "origin/$\{{ github.base_ref }}"`);
    expect(run).toContain("--baseline audits/baseline.json");
    expect(run).toContain("--fail-on blocking");
    // Annotations on the diff plus a job summary, on every plan — no code-scanning scope needed.
    expect(run).toContain("--format github");
  });

  it("carries the chosen severity through", () => {
    expect(gate("majeur")).toContain("--fail-on major");
  });

  it("checks out enough history for the diff gate to resolve the base ref", () => {
    const checkout = doc("bloquant").jobs.ultra11y.steps.find((s) => s.uses?.startsWith("actions/checkout"));
    expect(String(checkout?.with?.["fetch-depth"])).toBe("0");
  });

  it("grants read access to the checkout and no write at all", () => {
    expect(doc("bloquant").permissions).toEqual({ contents: "read" });
  });

  it("still documents the vendored route", () => {
    expect(ciWorkflow("vendor/ultra11y.mjs", "bloquant")).toContain("vendor/ultra11y.mjs");
  });
});
