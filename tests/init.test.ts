import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stagedHookScript, writeHook } from "../src/init.js";

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
  it("is the strict-staged auto-fix gate — valid POSIX sh, gated, bypassable", () => {
    const d = tmp();
    const path = writeHook(d, "scripts/ultra11y.mjs", "bloquant");
    const script = readFileSync(path, "utf8");
    // `sh -n` parses without executing — proves the generated script is valid.
    expect(() => execFileSync("sh", ["-n", path])).not.toThrow();
    expect(script).toContain("SKIP_A11Y");
    expect(script).toContain("command -v node");
    expect(script).toContain("audit --staged --fail-on blocking");
    expect(script).toContain("fix --staged --write --safe");
    expect(script).not.toContain("--baseline"); // the gate needs no baseline
    expect(script).toContain('node "$ULTRA11Y"');
  });

  it("writes an executable hook and threads --fail-on into it", () => {
    const d = tmp();
    const path = writeHook(d, "x.mjs", "majeur");
    expect(statSync(path).mode & 0o111).not.toBe(0); // has an execute bit
    expect(stagedHookScript("x.mjs", "majeur")).toContain("--fail-on major");
    expect(stagedHookScript("x.mjs", "mineur").startsWith("#!/bin/sh")).toBe(true);
  });
});
