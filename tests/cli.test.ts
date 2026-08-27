import { describe, it, expect, vi, afterEach } from "vitest";
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgs } from "../src/cli.js";
import { VERSION } from "../src/types.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  return {
    out,
    err,
    restore: () => {
      lo.mockRestore();
      le.mockRestore();
    },
  };
}
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const c = capture();
  const code = await main(argv);
  c.restore();
  return { code, out: c.out.join("\n"), err: c.err.join("\n") };
}

afterEach(() => vi.restoreAllMocks());

describe("parseArgs", () => {
  it("splits command, positionals and value/boolean flags", () => {
    const p = parseArgs(["audit", "a.html", "-", "--out", "x", "--jsx", "--json"]);
    expect(p.command).toBe("audit");
    expect(p.positionals).toEqual(["a.html", "-"]);
    expect(p.flags.out).toBe("x");
    expect(p.flags.jsx).toBe(true);
  });
  it("parses --key=value, not only --key value", () => {
    const p = parseArgs(["audit", "src", "--standard=rgaa", "--out=audits", "--fail-on=major"]);
    expect(p.flags.standard).toBe("rgaa");
    expect(p.flags.out).toBe("audits");
    expect(p.flags["fail-on"]).toBe("major");
    expect(p.unknown).toEqual([]);
  });
  it("records unknown/misspelled flags instead of silently accepting them", () => {
    const p = parseArgs(["audit", "src", "--grph", "--jsonn"]);
    expect(p.unknown).toContain("grph");
    expect(p.unknown).toContain("jsonn");
    expect(p.flags.graph).toBeUndefined();
    expect(parseArgs(["audit", "src", "--graph", "--json", "--cross-file"]).unknown).toEqual([]);
  });
  it("accumulates repeated list flags (include/exclude/ext); non-list flags stay last-wins", () => {
    expect(parseArgs(["audit", "src", "--include", "a", "--include", "b"]).flags.include).toBe("a,b");
    expect(parseArgs(["audit", "src", "--ext", "tsx", "--ext", "jsx"]).flags.ext).toBe("tsx,jsx");
    expect(parseArgs(["audit", "src", "--out", "a", "--out", "b"]).flags.out).toBe("b");
  });

  // MEASURED, on a real RGAA run of this repository:
  //   verify --apply … --ledger --lang fr
  // `--ledger` takes an OPTIONAL value (bare = the standard's default path), so it ate
  // `--lang` and wrote a 33 KB verdict ledger to a file literally named `--lang`.
  // `.ultra11y/verdicts/rgaa.json` was never written, and `--lang fr` having been consumed,
  // the whole run printed in English. Nothing failed and nothing warned — the next run simply
  // paid the entire adjudication again, which is the one cost the ledger exists to remove.
  it("does not swallow the NEXT FLAG as an optional flag's value", () => {
    const p = parseArgs(["verify", "--apply", "v.json", "--ledger", "--lang", "fr"]);
    expect(p.flags.ledger, "--ledger ate the next flag").toBe(true);
    expect(p.flags.lang, "--lang never survived to be read").toBe("fr");
  });

  it("still takes a real value, and a bare flag at the end of argv", () => {
    expect(parseArgs(["verify", "--ledger", "custom.json"]).flags.ledger).toBe("custom.json");
    // At the END of argv there is no next token to mistake for a value, so this keeps the
    // behaviour it always had: the empty string. `ledgerTarget` reads both it and `true` as
    // "bare — use the standard's default path", so the two forms are one instruction.
    expect(parseArgs(["verify", "--ledger"]).flags.ledger).toBe("");
    // `--key=value` is unaffected: the value never comes from the next token.
    expect(parseArgs(["verify", "--ledger=x.json", "--lang", "fr"]).flags.ledger).toBe("x.json");
  });

  it("leaves a single dash alone — it is the stdin positional, not a flag", () => {
    const p = parseArgs(["audit", "--out", "-"]);
    expect(p.flags.out, "'-' is a legitimate value").toBe("-");
  });
});

describe("judge runner validation", () => {
  const audit = join(FIX, "judge-audit.json");

  it("keeps `cli` as the Claude runner alias", async () => {
    const r = await run(["judge", "--in", audit, "--runner", "cli", "--effort", "minimal"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("not valid for claude");
  });

  it("uses Codex's effort vocabulary and refuses a fictional dollar ceiling", async () => {
    const effort = await run(["judge", "--in", audit, "--runner", "codex", "--effort", "max"]);
    expect(effort.code).toBe(2);
    expect(effort.err).toContain("not valid for codex");

    const budget = await run(["judge", "--in", audit, "--runner", "codex", "--max-budget-usd", "1"]);
    expect(budget.code).toBe(2);
    expect(budget.err).toContain("does not exist for a ChatGPT-subscription Codex run");
  });
});

describe("main — help / version / unknown", () => {
  it("--help lists all five commands", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    for (const c of ["audit", "report", "criteria", "check", "verify"]) expect(r.out).toContain(c);
  });
  it("--version prints VERSION", async () => {
    const r = await run(["--version"]);
    expect(r.out.trim()).toBe(VERSION);
  });
  it("unknown command exits 2", async () => {
    expect((await run(["frobnicate"])).code).toBe(2);
  });
});

describe("main — command wiring", () => {
  it("audit a fixture returns 0 and prints JSON with --json", async () => {
    const r = await run(["audit", `${FIX}conforming/good.html`, "--out", join(tmpdir(), "u11y-cli"), "--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).tool).toBe("ultra11y");
  });
  it("audit without --out streams to stdout and writes no audits/ folder", async () => {
    const cwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), "u11y-noout-"));
    try {
      process.chdir(tmp);
      const r = await run(["audit", `${FIX}conforming/good.html`, "--json"]);
      expect(r.code).toBe(0);
      expect(JSON.parse(r.out).tool).toBe("ultra11y");
      expect(existsSync(join(tmp, "audits"))).toBe(false); // no litter in the CWD
    } finally {
      process.chdir(cwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("audit --out <dir> persists audit-latest.json there", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-out-"));
    try {
      const r = await run(["audit", `${FIX}conforming/good.html`, "--out", tmp, "--json"]);
      expect(r.code).toBe(0);
      expect(existsSync(join(tmp, "audit-latest.json"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  it("report without --in exits 2", async () => {
    expect((await run(["report"])).code).toBe(2);
  });
  it("prd without --in exits 2", async () => {
    expect((await run(["prd"])).code).toBe(2);
  });
  it("prd renders a backlog from an audit json", async () => {
    const tmpd = join(tmpdir(), "u11y-prd-cli");
    await run(["audit", `${FIX}non-conforming/bad.html`, "--out", tmpd, "--json"]);
    const r = await run(["prd", "--in", join(tmpd, "audit-latest.json"), "--out", tmpd]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("prd-");
  });
  it("parses audit --graph/--cross-file and prd --split", () => {
    expect(parseArgs(["audit", "src", "--graph"]).flags.graph).toBe(true);
    expect(parseArgs(["audit", "src", "--cross-file"]).flags["cross-file"]).toBe(true);
    expect(parseArgs(["prd", "--in", "a.json", "--split", "criterion"]).flags.split).toBe("criterion");
  });

  it("parses the tickets surface", () => {
    const a = parseArgs(["tickets", "--in", "a.json", "--provider", "gitlab", "--grain", "page", "--transport", "rest", "--max-tickets", "5"]);
    expect(a.command).toBe("tickets");
    expect(a.flags).toMatchObject({ provider: "gitlab", grain: "page", transport: "rest", "max-tickets": "5" });
    expect(a.unknown).toEqual([]);
  });

  // The removed flags must land in `unknown`, which is what the REMOVED_FLAGS guard reads to
  // fail loudly instead of letting a scripted CI stay green while filing nothing.
  it("treats the retired prd ticket flags as unknown", () => {
    for (const f of ["--gh-issues", "--gh-single", "--issues-json"]) {
      expect(parseArgs(["prd", "--in", "a.json", f]).unknown, f).toContain(f.slice(2));
    }
  });
  it("parses prd --no-technical as a known boolean flag (not an unknown no-op)", () => {
    const a = parseArgs(["prd", "--in", "a.json", "--no-technical"]);
    expect(a.flags["no-technical"]).toBe(true);
    expect(a.unknown).not.toContain("no-technical");
  });
  it("parses --staged/--safe as boolean flags (not value flags)", () => {
    const a = parseArgs(["audit", "--staged", "--fail-on", "blocking"]);
    expect(a.flags.staged).toBe(true);
    expect(a.flags["fail-on"]).toBe("blocking"); // --staged did not swallow the next token
    const f = parseArgs(["fix", "--staged", "--write", "--safe"]);
    expect(f.flags.staged).toBe(true);
    expect(f.flags.safe).toBe(true);
    expect(f.flags.write).toBe(true);
  });
  it("render --json prints framework detection and exits 0", async () => {
    const r = await run(["render", ".", "--json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.out)).not.toThrow();
    expect(JSON.parse(r.out)).toHaveProperty("frameworks");
  });
  it("render --scaffold writes an SSR harness", async () => {
    const f = join(tmpdir(), "u11y-render-harness.tsx");
    const r = await run(["render", "--scaffold", "--out", f]);
    expect(r.code).toBe(0);
    expect(readFileSync(f, "utf8")).toContain("renderToStaticMarkup");
  });
  it("check without --report exits 2", async () => {
    expect((await run(["check"])).code).toBe(2);
  });
  it("criteria --list returns the WCAG success criteria (English by default)", async () => {
    const r = await run(["criteria", "--list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("55 success criteria");
  });
  it("criteria --theme on the WCAG core exits 2 (themes are pack-scoped)", async () => {
    expect((await run(["criteria", "--theme", "1"])).code).toBe(2);
  });
  it("criteria --standard rgaa --theme lists a pack theme", async () => {
    const r = await run(["criteria", "--standard", "rgaa", "--theme", "1"]);
    expect(r.code).toBe(0);
  });
  it("--lang fr switches the criteria list language", async () => {
    const r = await run(["criteria", "--list", "--lang", "fr"]);
    expect(r.out).toContain("critères de succès");
  });
});

describe("resolveLang — --lang auto default (conversation-first, repo/standard fallback)", () => {
  it('report --in without --lang renders French for an audit of a repo declaring <html lang="fr">', async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-lang-fr-"));
    try {
      await run(["audit", `${FIX}conforming/good.html`, "--out", tmp, "--json"]);
      const r = await run(["report", "--in", join(tmp, "audit-latest.json"), "--out", tmp]);
      expect(r.code).toBe(0);
      expect(readFileSync(r.out.trim(), "utf8")).toContain("Rapport d'audit d'accessibilité");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--lang en explicit wins over a French-repo audit", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-lang-en-"));
    try {
      await run(["audit", `${FIX}conforming/good.html`, "--out", tmp, "--json"]);
      const r = await run(["report", "--in", join(tmp, "audit-latest.json"), "--out", tmp, "--lang", "en"]);
      expect(r.code).toBe(0);
      expect(readFileSync(r.out.trim(), "utf8")).toContain("Accessibility audit report");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("--standard rgaa without a repo-language signal falls back to the pack's defaultLocale (fr)", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-lang-rgaa-"));
    try {
      // bad.html has no <html lang>, so scope.langs is absent — only the rgaa pack's own
      // defaultLocale ("fr") can resolve the output language.
      await run(["audit", `${FIX}non-conforming/bad.html`, "--out", tmp, "--json"]);
      const r = await run(["report", "--in", join(tmp, "audit-latest.json"), "--out", tmp, "--standard", "rgaa"]);
      expect(r.code).toBe(0);
      expect(readFileSync(r.out.trim(), "utf8")).toContain("Rapport d'audit d'accessibilité");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("nothing (no --lang, no repo signal, core standard) resolves to English", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-lang-default-"));
    try {
      await run(["audit", `${FIX}non-conforming/bad.html`, "--out", tmp, "--json"]); // bad.html has no <html lang>
      const r = await run(["report", "--in", join(tmp, "audit-latest.json"), "--out", tmp]);
      expect(r.code).toBe(0);
      expect(readFileSync(r.out.trim(), "utf8")).toContain("Accessibility audit report");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("init — --baseline is a boolean selector, not a value flag", () => {
  it("init --baseline does not swallow the following token", () => {
    const p = parseArgs(["init", "--baseline", "--hook"]);
    expect(p.flags.baseline).toBe(true);
    expect(p.flags.hook).toBe(true);
  });
  it("init --baseline alone selects baseline only", () => {
    const p = parseArgs(["init", "--baseline"]);
    expect(p.flags.baseline).toBe(true);
  });
  it("init --ci --baseline --fail-on majeur keeps fail-on as its value", () => {
    const p = parseArgs(["init", "--ci", "--baseline", "--fail-on", "majeur"]);
    expect(p.flags.ci).toBe(true);
    expect(p.flags.baseline).toBe(true);
    expect(p.flags["fail-on"]).toBe("majeur");
  });
  it("audit --baseline still consumes its path value", () => {
    const p = parseArgs(["audit", "x.html", "--baseline", "bl.json"]);
    expect(p.flags.baseline).toBe("bl.json");
  });
});

describe("subcommand --help is intercepted (no side effects)", () => {
  it("check --help prints help and exits 0 (instead of erroring on missing --report)", async () => {
    const r = await run(["check", "--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage:");
  });
  it("verify -h prints help and exits 0", async () => {
    const r = await run(["verify", "-h"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage:");
  });
});

describe("audit --fail-on gates a standalone audit (no --baseline)", () => {
  it("exits 1 when blocking NCs exist", async () => {
    const r = await run(["audit", `${FIX}non-conforming/bad.html`, "--fail-on", "bloquant"]);
    expect(r.code).toBe(1);
  });
  it("exits 0 on a conforming file", async () => {
    const r = await run(["audit", `${FIX}conforming/good.html`, "--fail-on", "bloquant"]);
    expect(r.code).toBe(0);
  });
  it("still exits 0 without --fail-on even with NCs", async () => {
    const r = await run(["audit", `${FIX}non-conforming/bad.html`, "--out", join(tmpdir(), "u11y-cli2"), "--json"]);
    expect(r.code).toBe(0);
  });
});

// `audit --in` exists so a pipeline that folded ADJUDICATED verdicts into audit-latest.json
// can apply the SAME severity gate to that result. Re-running detection there would miss the
// verdicts entirely, and hand-rolling the gate in bash would be a second implementation of
// it — the kind that drifts until a criterion is silently declared conforming.
describe("audit --in re-gates an audit that already exists", () => {
  const DIR = mkdtempSync(join(tmpdir(), "u11y-regate-"));
  const AUDIT = join(DIR, "audit-latest.json");

  it("gates the file's findings instead of re-auditing the source", async () => {
    expect((await run(["audit", `${FIX}non-conforming/bad.html`, "--out", DIR, "--json"])).code).toBe(0);
    expect((await run(["audit", "--in", AUDIT, "--fail-on", "bloquant"])).code).toBe(1);
  });

  it("exits 0 without --fail-on — reading an audit is not gating it", async () => {
    expect((await run(["audit", "--in", AUDIT])).code).toBe(0);
  });

  it("gates a CONFORMING audit green, so the path is not just 'always red'", async () => {
    const clean = mkdtempSync(join(tmpdir(), "u11y-regate-ok-"));
    await run(["audit", `${FIX}conforming/good.html`, "--out", clean, "--json"]);
    expect((await run(["audit", "--in", join(clean, "audit-latest.json"), "--fail-on", "bloquant"])).code).toBe(0);
  });

  // The refusals are the load-bearing part: a gate that silently ignored your scoping would
  // report on something other than what you asked it to report on.
  it.each([
    ["--since", "main"],
    ["--baseline", "b.json"],
    ["--out", "somewhere"],
  ])("refuses %s, which cannot change an audit that is already computed", async (flag, value) => {
    const r = await run(["audit", "--in", AUDIT, flag, value]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("already exists");
  });

  it("refuses positional paths too — they name a scope it will not honour", async () => {
    const r = await run(["audit", "--in", AUDIT, "src"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("already exists");
  });

  it("refuses a file that is not a current AuditResult", async () => {
    const bogus = join(DIR, "bogus.json");
    writeFileSync(bogus, JSON.stringify({ hello: "world" }));
    const r = await run(["audit", "--in", bogus]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not a current ultra11y AuditResult/);
  });

  it("refuses a missing file rather than gating an empty audit green", async () => {
    const r = await run(["audit", "--in", join(DIR, "nope.json"), "--fail-on", "bloquant"]);
    expect(r.code).toBe(2);
  });
});

describe("rendered captures — flags, coverage gate & render --coverage", () => {
  const PROJ = `${FIX}capture-project`;
  const CAPS = `${PROJ}/.ultra11y/captures`;

  it("parses --captures as a value flag and --no-captures/--require-captures as booleans", () => {
    const a = parseArgs(["audit", "src", "--captures", "caps", "--require-captures", "--fail-on", "blocking"]);
    expect(a.flags.captures).toBe("caps");
    expect(a.flags["require-captures"]).toBe(true);
    expect(a.flags["fail-on"]).toBe("blocking"); // --require-captures did not swallow it
    expect(parseArgs(["audit", "src", "--no-captures"]).flags["no-captures"]).toBe(true);
    expect(parseArgs(["render", ".", "--coverage"]).flags.coverage).toBe(true);
    expect(parseArgs(["render", ".", "--setup"]).flags.setup).toBe(true);
  });

  it("audit --require-captures exits 1 when a component lacks a capture", async () => {
    const r = await run(["audit", `${PROJ}/src`, "--require-captures", "--captures", CAPS]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Menu"); // blind-spot component named
  });

  it("audit --require-captures exits 0 when every in-scope component is covered", async () => {
    const r = await run(["audit", `${PROJ}/src/Button.tsx`, "--require-captures", "--captures", CAPS]);
    expect(r.code).toBe(0);
  });

  it("render --coverage --json reports covered vs blind-spot components", async () => {
    const r = await run(["render", PROJ, "--coverage", "--json"]);
    expect(r.code).toBe(0);
    const cov = JSON.parse(r.out);
    expect(cov.total).toBe(3);
    expect(cov.covered.some((k: string) => k.endsWith("Button.tsx#Button"))).toBe(true);
    expect(cov.blindSpots).toHaveLength(2);
    expect(cov.unattributed).toBe(1);
  });

  it("auto-ingests .ultra11y/captures by default, and --no-captures suppresses it", async () => {
    const cwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), "u11y-nocap-"));
    try {
      mkdirSync(join(tmp, ".ultra11y/captures"), { recursive: true });
      writeFileSync(
        join(tmp, ".ultra11y/captures/Button__x.html"),
        '<!-- ultra11y:capture v="1" source="src/Button.tsx" component="Button" -->\n<button></button>',
      );
      writeFileSync(join(tmp, "page.html"), '<!doctype html><html lang="en"><head><title>t</title></head><body><p>x</p></body></html>');
      process.chdir(tmp);
      const on = JSON.parse((await run(["audit", ".", "--json"])).out);
      expect(on.scope.captures?.files).toBe(1); // ingested by default
      const off = JSON.parse((await run(["audit", ".", "--no-captures", "--json"])).out);
      expect(off.scope.captures).toBeUndefined(); // suppressed (walk skips .ultra11y; no append)
    } finally {
      process.chdir(cwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("render --setup writes the harvester and prints runner wiring", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-setup-"));
    try {
      const r = await run(["render", tmp, "--setup"]);
      expect(r.code).toBe(0);
      const written = join(tmp, ".ultra11y/capture-setup.mjs");
      expect(existsSync(written)).toBe(true);
      expect(readFileSync(written, "utf8")).toContain("ultra11y:capture");
      expect(r.out).toContain("capture-setup.mjs");
      // also writes .gitattributes so committed captures stay byte-stable
      expect(existsSync(join(tmp, ".gitattributes"))).toBe(true);
      expect(readFileSync(join(tmp, ".gitattributes"), "utf8")).toContain(".ultra11y/captures/*.html");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("verify — input validation hardening", () => {
  it("--apply on a missing file reports not-found and exits 2", async () => {
    const r = await run(["verify", "--apply", join(tmpdir(), "u11y-nope.json")]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("not found");
  });
  it("--apply on non-array JSON exits 2 cleanly (no TypeError)", async () => {
    const f = join(tmpdir(), "u11y-apply-obj.json");
    writeFileSync(f, '{"verdict":"refuted"}');
    const r = await run(["verify", "--apply", f]);
    expect(r.code).toBe(2);
    expect(r.err).not.toContain("filter is not a function");
  });
  it("--max-verify with a non-numeric value exits 2 (no false-clean worklist)", async () => {
    const r = await run(["verify", "--report", `${FIX}non-conforming/bad.html`, "--max-verify", "abc", "--out", join(tmpdir(), "u11y-mv")]);
    expect(r.code).toBe(2);
  });
});

describe("scan --storage-state + an EXPLICIT docker runtime is an unsupported combination", () => {
  it("--runtime docker --storage-state exits 2 with a clear message (not a silent ignore)", async () => {
    const r = await run(["scan", "http://example.com", "--runtime", "docker", "--storage-state", join(tmpdir(), "auth.json")]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("storage-state");
    expect(r.err.toLowerCase()).toContain("docker");
  });

  it("--docker (alias) --storage-state also exits 2", async () => {
    const r = await run(["scan", "http://example.com", "--docker", "--storage-state", join(tmpdir(), "auth.json")]);
    expect(r.code).toBe(2);
  });

  it("--runtime local --storage-state is unaffected by the new gate (fails later for an unrelated reason, never exit 2)", async () => {
    const r = await run(["scan", "http://example.com", "--runtime", "local", "--storage-state", join(tmpdir(), "auth.json")]);
    expect(r.code).not.toBe(2); // no local Playwright resolvable in this sandbox → exit 1, not the docker gate
  });
});

describe("CLI gate & input hardening", () => {
  it("audit --fail-on with a typo'd value exits 2 (never silently degrades the gate)", async () => {
    const r = await run(["audit", `${FIX}non-conforming/bad.html`, "--fail-on", "majr"]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("fail-on");
  });

  it("report --in rejects a shallow-fabricated AuditResult (no scope) cleanly, not with a TypeError", async () => {
    const f = join(mkdtempSync(join(tmpdir(), "u-")), "stale.json");
    writeFileSync(f, JSON.stringify({ tool: "ultra11y", standard: "wcag", schemaVersion: 2, criteria: [] }));
    const r = await run(["report", "--in", f]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("AuditResult");
  });

  it("report --in on a missing file surfaces a clean 'file not found', not a raw ENOENT", async () => {
    const r = await run(["report", "--in", join(tmpdir(), "nope-4821.json")]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("not found");
    expect(r.err).not.toContain("ENOENT");
  });

  it("check --report on a missing file surfaces a clean 'file not found'", async () => {
    const r = await run(["check", "--report", join(tmpdir(), "nope-9931.md")]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("not found");
  });

  it("an unsupported --lang value warns (and falls back), never silently coerces", async () => {
    const r = await run(["criteria", "1.1.1", "--lang", "de"]);
    expect(r.err.toLowerCase()).toContain("--lang");
  });

  it("accepts judge --grain batch without the generic ticket-grain warning", async () => {
    const r = await run(["judge", "--in", join(tmpdir(), "missing-judge-audit.json"), "--runner", "claude", "--grain", "batch"]);
    expect(r.err).not.toContain("is not one of criterion|page|page-criterion|single|file");
    expect(r.err).toContain("--in file not found");
  });

  it("a single-dash flag typo (-grph) is surfaced as unknown", async () => {
    const r = await run(["audit", `${FIX}conforming/good.html`, "-grph"]);
    expect(r.err.toLowerCase()).toContain("unknown flag");
  });
});

// ---- WP: fail-closed verify gates (family P0) ----
describe("verify — fail-closed apply gate", () => {
  const makeBig = (n: number) => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-cov-"));
    const page = join(dir, "page.html");
    writeFileSync(page, `<html><body>\n${Array.from({ length: n + 2 }, () => "<img>").join("\n")}\n</body></html>`);
    const bullets = Array.from(
      { length: n },
      (_, i) => `- **1.1.1 — Non-text Content** — \`${page}:${i + 2}\` (\`img\`)\n  - image without a text alternative`,
    ).join("\n");
    const md = `# Report\n- **Rate** : 10%\n## 1. s\n## 2. NC\n${bullets}\n## 3. x\n## 4. NA\n## 5. manual\n`;
    const report = join(dir, "report.md");
    writeFileSync(report, md);
    return { dir, page, report };
  };

  it("--apply WITHOUT --report exits 2: coverage cannot be established", async () => {
    const f = join(tmpdir(), "u11y-apply-noreport.json");
    writeFileSync(f, "[]");
    const r = await run(["verify", "--apply", f]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--report");
  });

  it("coverage cross-check reaches BEYOND the 40-item worklist cap (missing NCs fail)", async () => {
    const { dir, report } = makeBig(45);
    // Generate the capped worklist (default 40), adjudicate everything in it…
    const g = await run(["verify", "--report", report, "--out", dir, "--json"]);
    expect(g.code).toBe(0);
    const todo = JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8")) as { verdict: string | null }[];
    expect(todo).toHaveLength(40);
    for (const it of todo) it.verdict = "supported";
    const filled = join(dir, "filled.json");
    writeFileSync(filled, JSON.stringify(todo));
    // …the 5 uncovered NCs must still fail the gate, pointing at --max-verify 0.
    const r = await run(["verify", "--apply", filled, "--report", report]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/missing|absent/i);
    expect(r.err).toContain("--max-verify 0");
  });

  it("--max-verify 0 lifts the cap for worklist generation", async () => {
    const { dir, report } = makeBig(45);
    const r = await run(["verify", "--report", report, "--out", dir, "--max-verify", "0", "--json"]);
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.out) as { count: number };
    expect(parsed.count).toBe(45);
  });

  it("grounds passing verdicts against the source: a citation to a non-existent element fails", async () => {
    const { dir, report } = makeBig(3);
    const g = await run(["verify", "--report", report, "--out", dir, "--max-verify", "0"]);
    expect(g.code).toBe(0);
    const todo = JSON.parse(readFileSync(join(dir, "VERIFY.todo.json"), "utf8")) as { verdict: string | null; selector: string }[];
    for (const it of todo) it.verdict = "supported";
    todo[0]!.selector = "video#ghost"; // cited element exists nowhere in page.html
    const filled = join(dir, "filled.json");
    writeFileSync(filled, JSON.stringify(todo));
    const r = await run(["verify", "--apply", filled, "--report", report]);
    expect(r.code).toBe(1);
  });
});

describe("check --semantic — the gate engages or fails, never green-but-inactive", () => {
  it("exits 1 with an explicit message when no verdicts artifact exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-chksem-"));
    const audit = await run(["audit", `${FIX}non-conforming/bad.html`, "--out", dir, "--json"]);
    expect([0, 1]).toContain(audit.code);
    const rep = await run(["report", "--in", join(dir, "audit-latest.json"), "--out", dir, "--lang", "en"]);
    expect(rep.code).toBe(0);
    const reportPath = readdirSync(dir).find((f) => f.startsWith("wcag-") && f.endsWith(".md"))!;
    const r = await run(["check", "--report", join(dir, reportPath), "--semantic"]);
    expect(r.code).toBe(1);
    expect(r.err.toLowerCase()).toMatch(/semantic/);
  });
});

// ---- R6: audit --out <file>.json is a FILE target, not a directory ----
describe("audit --out .json footgun (R6)", () => {
  it("--out <file>.json writes that exact file (not a dir) and reports the path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-outjson-"));
    const target = join(dir, "run1.json");
    const r = await run(["audit", `${FIX}conforming/good.html`, "--out", target, "--json"]);
    expect(r.code).toBe(0);
    expect(existsSync(target)).toBe(true); // the .json path is a FILE
    expect(existsSync(join(target, "audit-latest.json"))).toBe(false); // NOT a directory
    expect(JSON.parse(readFileSync(target, "utf8")).tool).toBe("ultra11y");
    // the path actually written is reported (on stderr, so --json stdout stays clean)
    expect(r.err).toContain("run1.json");
    expect(() => JSON.parse(r.out)).not.toThrow();
  });

  it("--out <dir> keeps the directory + audit-latest.json convention", async () => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-outdir-"));
    const r = await run(["audit", `${FIX}conforming/good.html`, "--out", dir, "--json"]);
    expect(r.code).toBe(0);
    expect(existsSync(join(dir, "audit-latest.json"))).toBe(true);
  });
});

describe("sample check + scan --sample + partial-audit advisory (Task 5)", () => {
  const withConfig = async (cfg: unknown, argv: string[]): Promise<{ code: number; out: string; err: string }> => {
    const cwd = process.cwd();
    const d = mkdtempSync(join(tmpdir(), "u11y-sample-cli-"));
    try {
      if (cfg !== undefined) writeFileSync(join(d, ".ultra11yrc.json"), JSON.stringify(cfg));
      process.chdir(d);
      return await run(argv);
    } finally {
      process.chdir(cwd);
      rmSync(d, { recursive: true, force: true });
    }
  };

  it("`sample check` lists the required RGAA page kinds a sample lacks (advisory, exit 0)", async () => {
    const r = await withConfig({ sample: { pages: [{ id: "accueil", name: "Accueil", url: "https://example.fr/" }] } }, [
      "sample",
      "check",
      "--standard",
      "rgaa",
    ]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Mentions légales");
    expect(r.out).toContain("Déclaration d’accessibilité");
  });

  it("`sample check` reports a complete-enough sample as covered", async () => {
    const r = await withConfig(
      {
        sample: {
          pages: [
            { id: "accueil", name: "Accueil", url: "https://example.fr/" },
            { id: "contact", name: "Contact", url: "https://example.fr/contact" },
            { id: "ml", name: "Mentions légales", url: "https://example.fr/mentions" },
            { id: "da", name: "Déclaration d'accessibilité", url: "https://example.fr/accessibilite" },
            { id: "plan", name: "Plan du site", url: "https://example.fr/plan" },
            { id: "aide", name: "Aide", url: "https://example.fr/aide" },
            { id: "auth", name: "Connexion", url: "https://example.fr/login" },
            { id: "rep", name: "Formulaire de recherche", url: "https://example.fr/recherche" },
          ],
          transverse: ["En-tête", "Navigation", "Pied de page"],
        },
      },
      ["sample", "check", "--standard", "rgaa", "--json"],
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).missing).toEqual([]);
  });

  it("`sample check` hard-errors (exit 2) when there is no sample block", async () => {
    expect((await withConfig({ standard: "rgaa" }, ["sample", "check"])).code).toBe(2);
    expect((await withConfig(undefined, ["sample", "check"])).code).toBe(2);
  });

  it("`sample check` hard-errors (exit 2) on a malformed sample", async () => {
    const r = await withConfig({ sample: { pages: [{ id: "x", url: "not a url" }] } }, ["sample", "check", "--standard", "rgaa"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/sample\.pages\[0\]/);
  });

  it("`scan --sample` without a sample block exits 2 with guidance", async () => {
    const r = await withConfig({ standard: "rgaa" }, ["scan", "--sample", "--runtime", "docker"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain(".ultra11yrc.json");
  });

  it("`report --standard rgaa` on a scanless audit prints the partial-audit advisory (exit 0)", async () => {
    const d = mkdtempSync(join(tmpdir(), "u11y-partial-"));
    try {
      await run(["audit", `${FIX}conforming/good.html`, "--out", d, "--json"]); // <html lang=fr> → lang fr
      const r = await run(["report", "--in", join(d, "audit-latest.json"), "--standard", "rgaa", "--out", d]);
      expect(r.code).toBe(0);
      expect(r.err).toContain("Audit partiel");
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});
