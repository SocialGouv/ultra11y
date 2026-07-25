// End-to-end tests that drive the SHIPPED bundle as a real subprocess across the
// non-mutating command surface (audit / report / criteria / check / verify + global
// flags), mirroring tests/MANUAL-TESTPLAN.md. Side-effecting commands (init / fix
// --write / report default output) live in artifacts.e2e.test.ts.
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "../../src/types.js";
import { runCli, auditJson, FIX, mkTmp, cleanupTmp } from "./helpers.js";

const badHtml = readFileSync(FIX.bad, "utf8");

afterAll(cleanupTmp);

describe("e2e: audit", () => {
  it("exits 0 on a conforming page and 0 on a non-conforming one (no gate without --fail-on)", () => {
    expect(runCli(["audit", FIX.good]).code).toBe(0);
    expect(runCli(["audit", FIX.bad]).code).toBe(0);
  });

  it("--json emits a well-formed payload keyed by WCAG criteria", () => {
    const j = auditJson([FIX.bad]);
    expect(j.tool).toBe("ultra11y");
    expect(j.scope.files).toBe(1);
    expect(Array.isArray(j.criteria)).toBe(true);
    expect(j.findings.length).toBeGreaterThan(0);
    for (const f of j.findings) {
      expect(typeof f.ruleId).toBe("string");
      expect(typeof f.criteriaId).toBe("string");
      expect(typeof f.severity).toBe("string");
    }
    const ruleIds = new Set(j.findings.map((f) => f.ruleId));
    expect(ruleIds).toContain("html-lang-missing");
    expect(ruleIds).toContain("img-alt-missing");
    expect(ruleIds).toContain("title-missing-empty");
  });

  it("reads HTML from stdin (audit - )", () => {
    const j = auditJson(["-"], { input: badHtml });
    expect(j.findings.length).toBeGreaterThan(0);
  });

  it("parses a real .tsx via the JSX AST path", () => {
    const j = auditJson([FIX.loginForm]);
    expect(Array.isArray(j.findings)).toBe(true);
    // every finding still resolves to a criterion + rule id (no crash / lossy fabrication)
    for (const f of j.findings) expect(f.ruleId.length).toBeGreaterThan(0);
  });

  it("--max-files truncates loudly (scope.truncated), never silently drops", () => {
    const j = auditJson([FIX.good, FIX.bad, "--max-files", "1"]);
    expect(j.scope.files).toBe(1);
    expect(j.scope.truncated).toBeTruthy();
    expect(j.scope.truncated?.skipped).toBe(1);
    expect(j.scope.truncated?.total).toBe(2);
  });

  it("--dedup exact|normalized|off all run and stay valid JSON", () => {
    for (const mode of ["exact", "normalized", "off"]) {
      const r = runCli(["audit", FIX.bad, "--dedup", mode, "--json"]);
      expect(r.code, `--dedup ${mode}`).toBe(0);
      expect(() => JSON.parse(r.stdout)).not.toThrow();
    }
  });

  it("--fail-on gates the exit code on its own (no --baseline needed)", () => {
    expect(runCli(["audit", FIX.bad, "--fail-on", "mineur"]).code).toBe(1);
    expect(runCli(["audit", FIX.bad, "--fail-on", "bloquant"]).code).toBe(1);
    expect(runCli(["audit", FIX.good, "--fail-on", "bloquant"]).code).toBe(0);
  });

  it("--lang switches the human summary language (code tokens stay untranslated)", () => {
    const en = runCli(["audit", FIX.bad, "--lang", "en"]);
    const fr = runCli(["audit", FIX.bad, "--lang", "fr"]);
    expect(en.stdout + en.stderr).toContain("To adjudicate");
    expect(fr.stdout + fr.stderr).toContain("À adjuger");
  });

  it("--changed on the current repo runs cleanly and yields valid JSON", () => {
    const r = runCli(["audit", "--changed", "--json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.stdout)).not.toThrow();
  });

  // Regression: the CLI used to end with `main().then(code => process.exit(code))`.
  // On a PIPE stdout is asynchronous, so the process died before the pending writes
  // flushed and a large payload was cut at exactly one pipe buffer (65536 bytes),
  // producing invalid JSON for any `audit --json | jq` on a real repository.
  it("--json survives a payload larger than the 64 KiB pipe buffer", () => {
    const dir = mkTmp("u11y-bigjson-");
    // Each file carries several distinct defects so the payload grows fast and stays
    // representative (findings, not padding). 120 files ≫ 64 KiB of JSON.
    for (let i = 0; i < 120; i++) {
      writeFileSync(
        join(dir, `page-${i}.html`),
        `<!doctype html><html><head></head><body><img src="a${i}.png"><a href="/x${i}"></a>` +
          `<button></button><input type="text" name="q${i}"><iframe src="/e${i}"></iframe></body></html>`,
      );
    }
    const r = runCli(["audit", join(dir, "*.html"), "--json"]);
    expect(r.code).toBe(0);
    expect(r.stdout.length, "payload must exceed one pipe buffer for this test to mean anything").toBeGreaterThan(65536);
    const j = JSON.parse(r.stdout) as { findings: unknown[]; scope: { files: number } };
    expect(j.scope.files).toBe(120);
    expect(j.findings.length).toBeGreaterThan(120);
  });
});

describe("e2e: report", () => {
  function auditToFile(): string {
    const dir = mkTmp();
    const r = runCli(["audit", FIX.bad, "--json"]);
    const p = join(dir, "audit.json");
    writeFileSync(p, r.stdout);
    return p;
  }

  it("renders a dated WCAG markdown report into --out", () => {
    const auditFile = auditToFile();
    const out = mkTmp();
    const r = runCli(["report", "--in", auditFile, "--out", out]);
    expect(r.code).toBe(0);
    const files = readdirSync(out) as string[];
    const wcag = files.find((f) => /^wcag-\d{4}-\d{2}-\d{2}\.md$/.test(f));
    expect(wcag).toBeTruthy();
    const md = readFileSync(join(out, wcag!), "utf8");
    expect(md.length).toBeGreaterThan(500);
    expect(md).toContain("WCAG");
  });

  it("derives a distinct RGAA view under --standard rgaa", () => {
    const auditFile = auditToFile();
    const out = mkTmp();
    const r = runCli(["report", "--in", auditFile, "--standard", "rgaa", "--out", out]);
    expect(r.code).toBe(0);
    const files = readdirSync(out) as string[];
    expect(files.some((f) => /^rgaa-\d{4}-\d{2}-\d{2}\.md$/.test(f))).toBe(true);
  });

  it("reads the audit JSON from stdin (--in -)", () => {
    const j = runCli(["audit", FIX.bad, "--json"]).stdout;
    const out = mkTmp();
    const r = runCli(["report", "--in", "-", "--out", out], { input: j });
    expect(r.code).toBe(0);
  });

  it("rejects an unknown standard with a usage error (exit 2)", () => {
    const auditFile = auditToFile();
    expect(runCli(["report", "--in", auditFile, "--standard", "nope"]).code).toBe(2);
  });
});

describe("e2e: criteria", () => {
  it("looks up a WCAG success criterion offline", () => {
    const r = runCli(["criteria", "1.4.3"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("1.4.3");
  });

  it("--json parses and --list runs", () => {
    expect(() => JSON.parse(runCli(["criteria", "1.4.3", "--json"]).stdout)).not.toThrow();
    expect(runCli(["criteria", "--list"]).code).toBe(0);
  });

  it("rejects a nonexistent criterion and a core --theme with exit 2", () => {
    expect(runCli(["criteria", "9.9.9"]).code).toBe(2);
    expect(runCli(["criteria", "--theme", "1"]).code).toBe(2); // themes are RGAA-only
  });
});

describe("e2e: check", () => {
  function makeReport(): string {
    const auditFile = join(mkTmp(), "audit.json");
    writeFileSync(auditFile, runCli(["audit", FIX.bad, "--json"]).stdout);
    const out = mkTmp();
    runCli(["report", "--in", auditFile, "--out", out]);
    const wcag = (readdirSync(out) as string[]).find((f) => f.startsWith("wcag-"))!;
    return join(out, wcag);
  }

  it("passes a genuine report (exit 0) and rejects a fabricated criterion (exit 1)", () => {
    const report = makeReport();
    expect(runCli(["check", "--report", report]).code).toBe(0);

    const doctored = join(mkTmp(), "doctored.md");
    const body = readFileSync(report, "utf8") + "\n### 🔴 9.9.9 — Critère inventé\nQuelque chose de fabriqué.\n";
    writeFileSync(doctored, body);
    expect(runCli(["check", "--report", doctored]).code).toBe(1);
  });
});

describe("e2e: verify", () => {
  it("generates a VERIFY worklist (VERIFY.md + VERIFY.todo.json) from a report", () => {
    const auditFile = join(mkTmp(), "audit.json");
    writeFileSync(auditFile, runCli(["audit", FIX.bad, "--json"]).stdout);
    const out = mkTmp();
    runCli(["report", "--in", auditFile, "--out", out]);
    const wcag = (readdirSync(out) as string[]).find((f) => f.startsWith("wcag-"))!;
    const r = runCli(["verify", "--report", join(out, wcag), "--out", out]);
    expect(r.code).toBe(0);
    const files = readdirSync(out) as string[];
    expect(files).toContain("VERIFY.md");
    expect(files).toContain("VERIFY.todo.json");
  });

  it("errors cleanly (exit 2) when the report file is missing", () => {
    expect(runCli(["verify", "--report", join(mkTmp(), "nope.md")]).code).toBe(2);
  });
});

describe("e2e: global flags", () => {
  it("-v/--version prints package.json version", () => {
    expect(runCli(["-v"]).stdout.trim()).toBe(VERSION);
    expect(runCli(["--version"]).stdout.trim()).toBe(VERSION);
  });

  it("-h/--help prints usage", () => {
    const r = runCli(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain("usage");
  });

  it("<cmd> --help prints help with no side effect and no crash", () => {
    for (const cmd of ["audit", "report", "verify", "check", "fix", "init", "scan", "prd", "criteria", "pack", "render"]) {
      const r = runCli([cmd, "--help"]);
      expect(r.code, `${cmd} --help`).toBe(0);
      expect(r.stdout.length, `${cmd} --help output`).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown command with a usage error (exit 2)", () => {
    expect(runCli(["frobnicate"]).code).toBe(2);
  });
});

describe("e2e: realistic-fixture false-positive guards", () => {
  it("does not report duplicate-id for one id reused across mutually-exclusive JSX arms", () => {
    const j = auditJson([FIX.loginForm]);
    const dupes = j.findings.filter((f) => f.ruleId === "duplicate-id");
    expect(dupes, `unexpected duplicate-id FP: ${JSON.stringify(dupes)}`).toHaveLength(0);
  });

  it("finds no blocking/major non-conformities on a genuinely accessible landing page", () => {
    const j = auditJson([FIX.landing]);
    const blocking = j.findings.filter((f) => f.severity === "bloquant" || f.severity === "majeur");
    expect(blocking, `unexpected FP on clean markup: ${JSON.stringify(blocking)}`).toHaveLength(0);
  });
});
