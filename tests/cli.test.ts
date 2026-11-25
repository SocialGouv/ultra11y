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

describe("removed commands and flags fail loudly, naming the replacement", () => {
  it.each(["mcp", "dev", "judge", "import"])("`%s` exits 2 with a pointer, not a bare unknown command", async (cmd) => {
    const r = await run([cmd]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("is no longer a command");
  });

  it.each([
    ["audit", "--lite"],
    ["audit", "--baseline", "b.json"],
    ["init", "--ci"],
    ["init", "--baseline"],
    ["render", "--e2e"],
    ["render", "--scaffold"],
    ["render", "--setup"],
    ["scan", "--docker"],
    ["scan", "--clean"],
    ["pages", "--diff", "x.json"],
  ])("`%s %s` exits 2 and names what replaced it", async (cmd, ...flag) => {
    const r = await run([cmd, ...flag]);
    expect(r.code).toBe(2);
    expect(r.err).toContain(`${flag[0]} was removed`);
  });

  // #194: RGAA 4.1.2 is the only standard ultra11y reports against. A WCAG report, grid or
  // rate is no longer produced — asking for one fails loudly and names RGAA.
  it.each([
    ["audit", ".", "--standard", "wcag"],
    ["report", "--in", join(FIX, "judge-audit.json"), "--standard", "wcag"],
    ["pages", "--in", join(FIX, "judge-audit.json"), "--standard", "WCAG"],
    ["check", "--report", "r.md", "--standard", "core"],
    ["verify", "--report", "r.md", "--standard", "wcag"],
    ["tickets", "--in", join(FIX, "judge-audit.json"), "--standard", "wcag"],
    ["prd", "--in", join(FIX, "judge-audit.json"), "--standard", "wcag"],
    ["criteria", "--standard", "Wcag"],
  ])("`%s … --standard <wcag>` exits 2 and names RGAA (%#)", async (...argv) => {
    const r = await run(argv);
    expect(r.code).toBe(2);
    expect(r.err).toContain("RGAA 4.1.2");
    expect(r.err).toContain("--standard rgaa");
  });

  it("a .ultra11yrc.json still declaring `standard: wcag` fails the same way", async () => {
    const tmpd = mkdtempSync(join(tmpdir(), "u11y-rc-wcag-"));
    const cwd = process.cwd();
    try {
      writeFileSync(join(tmpd, ".ultra11yrc.json"), JSON.stringify({ standard: "wcag" }));
      process.chdir(tmpd);
      const r = await run(["criteria", "8.3"]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("RGAA 4.1.2");
    } finally {
      process.chdir(cwd);
      rmSync(tmpd, { recursive: true, force: true });
    }
  });

  // A config pack must not be a back door to another standard: with `packs` registered, a
  // `standard: "xx"` (or `--standard xx`) used to run a non-RGAA audit.
  it.each([
    [{ packs: ["./xx.json"], standard: "xx" }, []],
    [{ packs: ["./xx.json"] }, ["--standard", "xx"]],
    [{ packs: ["./xx.json"] }, []],
    [{ standard: "section508" }, []],
    [{}, ["--standard", "xx"]],
  ])("a non-RGAA config %j / flags %j exits 2 naming RGAA", async (rc, flags) => {
    const tmpd = mkdtempSync(join(tmpdir(), "u11y-rc-pack-"));
    const cwd = process.cwd();
    try {
      const pack = JSON.parse(readFileSync(new URL("../src/data/standards/rgaa.json", import.meta.url), "utf8"));
      writeFileSync(join(tmpd, "xx.json"), JSON.stringify({ ...pack, key: "xx", name: "XX" }));
      writeFileSync(join(tmpd, ".ultra11yrc.json"), JSON.stringify(rc));
      process.chdir(tmpd);
      const r = await run(["audit", `${FIX}non-conforming/bad.html`, "--json", ...flags]);
      expect(r.code).toBe(2);
      expect(r.err).toContain("RGAA 4.1.2");
      expect(r.out).toBe("");
    } finally {
      process.chdir(cwd);
      rmSync(tmpd, { recursive: true, force: true });
    }
  });

  it("the default standard is RGAA: audit, report and pages speak it with no flag", async () => {
    const tmpd = mkdtempSync(join(tmpdir(), "u11y-rgaa-default-"));
    try {
      const a = await run(["audit", `${FIX}non-conforming/bad.html`, "--out", tmpd, "--json", "--lang", "en"]);
      const doc = JSON.parse(a.out) as { standard: string; kind: string; criteria: unknown[] };
      expect(doc).toMatchObject({ standard: "rgaa", kind: "pack-audit" });
      expect(doc.criteria).toHaveLength(106);
      const rep = await run(["report", "--in", join(tmpd, "audit-latest.json"), "--out", tmpd, "--lang", "en"]);
      expect(rep.code).toBe(0);
      expect(rep.out.trim()).toMatch(/rgaa-\d{4}-\d{2}-\d{2}\.md$/);
      expect(readdirSync(tmpd).some((f) => f.startsWith("wcag-"))).toBe(false);
      const pages = await run(["pages", "--in", join(tmpd, "audit-latest.json"), "--json"]);
      expect(pages.out).not.toContain('"standard": "wcag"');
      // An explicit --standard rgaa (iterion's rgaa-audit bot passes it) is the same thing.
      const explicit = await run(["report", "--in", join(tmpd, "audit-latest.json"), "--out", tmpd, "--lang", "en", "--standard", "rgaa"]);
      expect(explicit.code).toBe(0);
      expect(explicit.out.trim()).toBe(rep.out.trim());
    } finally {
      rmSync(tmpd, { recursive: true, force: true });
    }
  });

  it("`report --format sarif` is refused rather than silently writing Markdown", async () => {
    const r = await run(["report", "--in", join(FIX, "judge-audit.json"), "--format", "sarif"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--format");
  });

  // A removed VALUE of a still-valid flag must fail just as loudly: otherwise it only earned
  // the generic "using the default" warning and exit 0, so a CI job kept passing on nothing.
  it.each([
    ["audit", ".", "--format", "sarif"],
    ["audit", ".", "--format", "github"],
    ["audit", "--in", join(FIX, "judge-audit.json"), "--format", "sarif"],
    ["audit", "--in", join(FIX, "judge-audit.json"), "--format=github"],
    ["report", "--in", join(FIX, "judge-audit.json"), "--format", "github"],
  ])("`%s %s %s %s` (a removed CI format) exits 2 and names iterion and --json", async (...argv) => {
    const r = await run(argv);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--format (sarif|github) was removed/);
    expect(r.err).toContain("rgaa-audit");
    expect(r.err).toContain("--json");
    expect(r.err).not.toContain("using the default");
  });

  it.each(["prd", "tickets"])("`%s --format remediation` exits 2 and points at prd / tickets", async (cmd) => {
    const r = await run([cmd, "--in", join(FIX, "judge-audit.json"), "--format", "remediation"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("--format remediation was removed");
    expect(r.err).toContain("ultra11y prd");
    expect(r.err).toContain("ultra11y tickets");
  });

  it.each(["audit", "doc"])("`prd --format %s` still works", async (format) => {
    const tmpd = mkdtempSync(join(tmpdir(), "u11y-prd-format-"));
    try {
      const r = await run(["prd", "--in", join(FIX, "judge-audit.json"), "--out", tmpd, "--format", format]);
      expect(r.code, r.err).toBe(0);
      expect(r.err).not.toContain("was removed");
    } finally {
      rmSync(tmpd, { recursive: true, force: true });
    }
  });

  it("`pages --format grid` still works", async () => {
    const r = await run(["pages", "--in", join(FIX, "judge-audit.json"), "--format", "grid"]);
    // This fixture has no pages in scope (exit 1): what matters is that --format got through.
    expect(r.code, r.err).not.toBe(2);
    expect(r.err).not.toContain("--format");
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
  it("render --detect --json prints framework detection and exits 0", async () => {
    const r = await run(["render", ".", "--detect", "--json"]);
    expect(r.code).toBe(0);
    expect(() => JSON.parse(r.out)).not.toThrow();
    expect(JSON.parse(r.out)).toHaveProperty("frameworks");
  });
  it("check without --report exits 2", async () => {
    expect((await run(["check"])).code).toBe(2);
  });
  it("criteria --list returns the RGAA themes (RGAA is the default standard, French by default)", async () => {
    const r = await run(["criteria", "--list"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("RGAA 4.1.2 — 13 thématiques, 106 critères");
  });
  it("criteria --theme lists an RGAA theme by default; an unknown RGAA criterion exits 2", async () => {
    expect((await run(["criteria", "--theme", "1"])).code).toBe(0);
    expect((await run(["criteria", "9.9"])).code).toBe(2);
  });
  it("criteria <WCAG SC> still answers: it prints the mapping target", async () => {
    const r = await run(["criteria", "1.4.3", "--lang", "en"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Contrast (Minimum)");
  });
  it("criteria --standard rgaa --theme lists a pack theme", async () => {
    const r = await run(["criteria", "--standard", "rgaa", "--theme", "1"]);
    expect(r.code).toBe(0);
  });
  it("--lang en switches the criteria list language", async () => {
    const r = await run(["criteria", "--list", "--lang", "en"]);
    expect(r.out).toContain("13 themes, 106 criteria");
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

  it("nothing (no --lang, no repo signal) resolves to RGAA's own locale, French", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "u11y-lang-default-"));
    try {
      await run(["audit", `${FIX}non-conforming/bad.html`, "--out", tmp, "--json"]); // bad.html has no <html lang>
      const r = await run(["report", "--in", join(tmp, "audit-latest.json"), "--out", tmp]);
      expect(r.code).toBe(0);
      expect(readFileSync(r.out.trim(), "utf8")).toContain("Rapport d'audit d'accessibilité — RGAA 4.1.2");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("subcommand --help is intercepted (no side effects)", () => {
  it("check --help prints help and exits 0 (instead of erroring on missing --report)", async () => {
    const r = await run(["check", "--help"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Usage :"); // French help by default (#214)
  });
  it("verify -h prints help and exits 0", async () => {
    const r = await run(["verify", "-h", "--lang", "en"]);
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
    ["--out", "somewhere"],
  ])("refuses %s, which cannot change an audit that is already computed", async (flag, value) => {
    const r = await run(["audit", "--in", AUDIT, flag, value]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("existe déjà");
  });

  it("refuses positional paths too — they name a scope it will not honour", async () => {
    const r = await run(["audit", "--in", AUDIT, "src"]);
    expect(r.code).toBe(2);
    expect(r.err).toContain("existe déjà");
  });

  it("refuses a file that is not a current AuditResult", async () => {
    const bogus = join(DIR, "bogus.json");
    writeFileSync(bogus, JSON.stringify({ hello: "world" }));
    const r = await run(["audit", "--in", bogus]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/n'est pas un AuditResult ultra11y à jour/);
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
    expect(parseArgs(["render", ".", "--detect"]).flags.detect).toBe(true);
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
});

describe("verify — input validation hardening", () => {
  it("--apply on a missing file reports not-found and exits 2", async () => {
    const r = await run(["verify", "--apply", join(tmpdir(), "u11y-nope.json")]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("introuvable");
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

describe("scan runtime selection", () => {
  it("--runtime docker exits 2: the Docker runtime is gone, and the scan never silently runs another way", async () => {
    const r = await run(["scan", "http://example.com", "--runtime", "docker"]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("l'environnement docker a été retiré");
  });

  // Where no browser starts this fails fast (exit 1); where one does — the launcher now falls
  // back on an installed Google Chrome, which CI runners carry — the scan really runs, so the
  // test gets a real scan's time budget. Either way the gate under test never answers 2.
  it("--runtime local --storage-state is accepted (fails later for an unrelated reason, never exit 2)", { timeout: 90_000 }, async () => {
    const r = await run(["scan", "http://example.com", "--runtime", "local", "--storage-state", join(tmpdir(), "auth.json")]);
    expect(r.code).not.toBe(2);
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
    expect(r.err.toLowerCase()).toContain("introuvable");
    expect(r.err).not.toContain("ENOENT");
  });

  it("check --report on a missing file surfaces a clean 'file not found'", async () => {
    const r = await run(["check", "--report", join(tmpdir(), "nope-9931.md")]);
    expect(r.code).toBe(2);
    expect(r.err.toLowerCase()).toContain("introuvable");
    // The English wording stays one flag away.
    const en = await run(["check", "--report", join(tmpdir(), "nope-9931.md"), "--lang", "en"]);
    expect(en.err.toLowerCase()).toContain("not found");
  });

  it("an unsupported --lang value warns (and falls back), never silently coerces", async () => {
    const r = await run(["criteria", "1.1.1", "--lang", "de"]);
    expect(r.err.toLowerCase()).toContain("--lang");
  });

  it("a single-dash flag typo (-grph) is surfaced as unknown", async () => {
    const r = await run(["audit", `${FIX}conforming/good.html`, "-grph"]);
    expect(r.err.toLowerCase()).toContain("drapeau inconnu");
  });
});

// ---- WP: fail-closed verify gates (family P0) ----
describe("verify — fail-closed apply gate", () => {
  const makeBig = (n: number) => {
    const dir = mkdtempSync(join(tmpdir(), "u11y-cov-"));
    const page = join(dir, "page.html");
    writeFileSync(page, `<html><body>\n${Array.from({ length: n + 2 }, () => "<img>").join("\n")}\n</body></html>`);
    const bullets = Array.from({ length: n }, (_, i) => `- [ ] \`${page}:${i + 2}\` (\`img\`) — image without a text alternative`).join("\n");
    const md = `# Report\n- **Rate** : 10%\n## 1. s\n## 2. NC\n**Critère** : 1.1 — Chaque image porteuse d’information a-t-elle une alternative textuelle ?\n${bullets}\n## 3. x\n## 4. NA\n## 5. manual\n`;
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
    const reportPath = readdirSync(dir).find((f) => f.startsWith("rgaa-") && f.endsWith(".md"))!;
    const r = await run(["check", "--report", join(dir, reportPath), "--semantic"]);
    expect(r.code).toBe(1);
    expect(r.err.toLowerCase()).toMatch(/semantic|sémantique/);
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
            { id: "docs", name: "Publications", url: "https://example.fr/publications" },
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
    const r = await withConfig({ standard: "rgaa" }, ["scan", "--sample"]);
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
