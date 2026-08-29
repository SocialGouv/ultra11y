import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { VERSION } from "../src/types.js";
import { COMMANDS, REMOVED_FLAGS } from "../src/cli.js";
import { EVIDENCE_SKIPS } from "../src/evidence.js";
import { ALL_RULES } from "../src/rules/registry.js";

// Guards that the published skills stay installable via `npx skills add` and
// that their docs never drift from the CLI they describe.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const SKILL_NAMES = ["review-a11y", "ultra11y"];
const REFS_DIR = join(ROOT, "skills/ultra11y", "references");

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };
const skills = Object.fromEntries(
  SKILL_NAMES.map((name) => {
    const raw = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
    const match = raw.match(FRONTMATTER_RE);
    return [name, { raw, frontmatter: match?.[1] ?? "", body: match?.[2] ?? "", matched: match !== null }];
  }),
);
const body = skills.ultra11y!.body;
const refFiles = readdirSync(REFS_DIR).filter((f) => f.endsWith(".md"));
const refBodies = Object.fromEntries(refFiles.map((f) => [f, readFileSync(join(REFS_DIR, f), "utf8")]));

describe("the skills are installable", () => {
  it("ships exactly the two skills", () => {
    expect(readdirSync(join(ROOT, "skills")).sort()).toEqual(SKILL_NAMES);
  });

  it.each(SKILL_NAMES)("%s has a frontmatter block that parses as YAML", (name) => {
    expect(skills[name]!.matched).toBe(true);
    expect(() => parse(skills[name]!.frontmatter)).not.toThrow();
  });

  it.each(SKILL_NAMES)("%s exposes its own name and a non-empty description", (name) => {
    const data = parse(skills[name]!.frontmatter) as Record<string, unknown>;
    expect(data.name).toBe(name);
    expect(typeof data.description).toBe("string");
    expect((data.description as string).length).toBeGreaterThan(0);
    expect((data.description as string).length).toBeLessThanOrEqual(1024);
    expect(Object.keys(data).every((key) => ["name", "description", "allowed-tools", "license", "metadata"].includes(key))).toBe(true);
  });

  it("ultra11y describes BOTH scopes (audit AND author/review)", () => {
    const description = (parse(skills.ultra11y!.frontmatter) as { description: string }).description;
    expect(description).toMatch(/audit/i);
    expect(description).toMatch(/author|accessible|review/i);
  });

  it("review-a11y describes the review scope and its change-based scoping", () => {
    const description = (parse(skills["review-a11y"]!.frontmatter) as { description: string }).description;
    expect(description).toMatch(/review/i);
    expect(description).toMatch(/staged|diff|branch|change/i);
  });

  // The two skills are one pipeline: the audit does the analysis, the review reads the change
  // it produced. That handoff used to be DESCRIPTIVE only — each frontmatter pointed at the
  // other and nothing ever dispatched — so an audit ended with a deliverable and the changed
  // code was never reviewed as a change.
  it("ultra11y dispatches review-a11y as a subagent once its analysis is done", () => {
    expect(body).toMatch(/review-a11y/);
    expect(body).toMatch(/subagent/i);
    // Named host routes, not a vague "hand it over": a step nobody can execute is a step nobody runs.
    expect(body).toMatch(/Codex/);
    expect(body).toMatch(/Agent\(/);
    // And the fallback, so a harness without subagents is not left stuck.
    expect(body).toMatch(/no subagent/i);
  });

  it("review-a11y states what it must return when it IS the subagent", () => {
    const b = skills["review-a11y"]!.body;
    expect(b).toMatch(/subagent/i);
    // Its report is the return value, so a summary would lose the findings.
    expect(b).toMatch(/return value|returns? it whole|verbatim/i);
  });

  it.each(SKILL_NAMES)("%s keeps version in lockstep with package.json and src/types.ts", (name) => {
    const data = parse(skills[name]!.frontmatter) as { metadata?: { version?: string } };
    expect(data.metadata?.version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });
});

// Derived from the CLI, never restated. A hardcoded copy is a second source of truth, and it
// failed exactly the way a second source of truth fails: a new command was documented, the
// oracle did not know it existed, and the "docs reference a real command" test rejected the
// real command.
const CLI_COMMANDS = new Set<string>(COMMANDS);

// The user-facing docs the CLI reference must stay true to — SKILL.mds, references, AND the
// top-level README + manual test plan (which drifted before this oracle covered them).
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const TESTPLAN = readFileSync(join(ROOT, "tests/MANUAL-TESTPLAN.md"), "utf8");

describe("skill docs stay in sync with the CLI", () => {
  const docs: [string, string][] = [
    ["ultra11y/SKILL.md", body],
    ["review-a11y/SKILL.md", skills["review-a11y"]!.body],
    ["README.md", README],
    ["tests/MANUAL-TESTPLAN.md", TESTPLAN],
    ...Object.entries(refBodies),
  ];

  it.each(docs)("%s only references commands the CLI actually has", (_name, text) => {
    // Require the command to START with a letter so `ultra11y.mjs --help` isn't read as a command.
    for (const m of text.matchAll(/ultra11y\.mjs\s+([a-z][a-z-]*)/g)) {
      expect(CLI_COMMANDS.has(m[1]!), `references unknown command "${m[1]}"`).toBe(true);
    }
  });

  it("teaches the machine-readable surface (--json)", () => {
    expect(body).toContain("--json");
    expect(skills["review-a11y"]!.body).toContain("--json");
  });

  it("documents every CLI flag the docs mention (guards help-text drift, incl. README + test plan)", () => {
    const help = execFileSync(process.execPath, [join(ROOT, "scripts/ultra11y.mjs"), "--help"], { encoding: "utf8" });
    const docText = [body, skills["review-a11y"]!.body, README, TESTPLAN, ...Object.values(refBodies)].join("\n");
    const flags = new Set(docText.match(/--[a-z][a-z-]+/g) ?? []);
    // A REMOVED flag may legitimately appear in a migration note, and only there — so the
    // exemption is DERIVED from the CLI's own table rather than restated here. A typo in a
    // doc still fails, because a misspelling is not in the table either.
    const removed = new Set(Object.keys(REMOVED_FLAGS).map((f) => `--${f}`));
    // FLAGS THAT ARE NOT OURS. `adjudicate-runner: cli` spawns the Claude Code CLI and the CI
    // templates call npm and npx, so the docs now quote three tools rather than one. Listed
    // rather than pattern-matched, and each one earns its line: an ultra11y flag that goes
    // missing from `--help` must still fail here, which is the whole point of this test.
    const foreign = new Set([
      // Claude Code CLI, cited by the `adjudicate-runner: cli` documentation.
      "--safe-mode",
      "--max-turns",
      "--max-budget-usd",
      // npm / npx, cited by the CI templates.
      "--no-save",
      "--prefix",
      "--yes",
      "--with-deps",
    ]);
    for (const f of flags) {
      if (removed.has(f) || foreign.has(f)) continue;
      expect(help.includes(f), `--help omits ${f}, which the docs document`).toBe(true);
    }
  });

  // The refusal list is not internal vocabulary: an auditor reads `deduplicated` or
  // `below-the-fold` in a delivered report and looks it up. A reason the engine can emit and
  // the reference does not name is a word the reader cannot resolve — and the table said
  // "twelve" for a whole release while the engine had its own ideas.
  // A SKILL.md tells an agent to go and read rule N. Nothing checked that rule N was the rule
  // meant: both pointers to the `--lang` obligation said "Core rule 5" while `--lang` is
  // rule 7 and rule 5 is "Look the criterion up; never recall it". An agent that follows the
  // pointer lands on an unrelated instruction and the obligation quietly evaporates — the
  // failure mode a cross-reference exists to prevent.
  it.each(SKILL_NAMES)("%s resolves every 'Core rule N' pointer to a rule that exists", (name) => {
    const text = skills[name]!.body;
    const rules = new Set<string>();
    // The block is a blockquote of "> 1. **Title**…" lines; sub-rules like "3b" are numbered
    // too, but nothing points at one, so the plain integers are what has to resolve.
    for (const m of text.matchAll(/^>\s*(\d+)\.\s/gm)) rules.add(m[1]!);
    expect(rules.size, `${name} declares no Core rules`).toBeGreaterThan(0);
    for (const m of text.matchAll(/Core rule (\d+)/g)) {
      expect(rules.has(m[1]!), `${name} points at Core rule ${m[1]} — it declares ${[...rules].join(", ")}`).toBe(true);
    }
  });

  it("names every evidence refusal reason in references/pages.md", () => {
    const doc = refBodies["pages.md"] ?? "";
    for (const skip of EVIDENCE_SKIPS) expect(doc.includes(`\`${skip}\``), `references/pages.md never names \`${skip}\``).toBe(true);
  });

  it("pins the 'N static checks' prose claim to the real ALL_RULES count", () => {
    const count = ALL_RULES.length;
    for (const [name, text] of [
      ["SKILL.md", skills.ultra11y!.raw], // the claim is in the frontmatter description
      ["README.md", README],
    ] as const) {
      const m = text.match(/(\d+)\s+(?:machine-detectable\s+)?static check/);
      expect(m, `${name} states no 'N static checks' claim`).not.toBeNull();
      expect(Number(m![1]), `${name} static-check count is stale`).toBe(count);
    }
  });
});

describe("SKILL.md routes to the references (progressive disclosure)", () => {
  it("ships exactly the forty reference docs", () => {
    expect(refFiles.sort()).toEqual([
      "act.md",
      "adjudication.md",
      "audit.md",
      "authoring.md",
      "automation.md",
      "ci.md",
      "claude-code-report.md",
      "correction.md",
      "criteria.md",
      "cross-file.md",
      "devtools.md",
      "dynamic.md",
      "e2e.md",
      "extension.md",
      "false-positives.md",
      "fix.md",
      "focus-and-logic.md",
      "forbidden-patterns.md",
      "forms-and-errors.md",
      "guidance.md",
      "harnesses.md",
      "judgment.md",
      "mcp.md",
      "media-and-motion.md",
      "methodology.md",
      "naming.md",
      "orchestration.md",
      "orchestrators.md",
      "packs.md",
      "pages.md",
      "prd.md",
      "rendered.md",
      "rgaa-automation.md",
      "runbook.md",
      "scale.md",
      "standards.md",
      "structure.md",
      "tickets.md",
      "verify.md",
      "widgets.md",
    ]);
  });

  it("mentions every reference file that exists", () => {
    for (const f of refFiles) {
      expect(body, `SKILL.md never routes to references/${f}`).toContain(`references/${f}`);
    }
  });

  it("routes Claude Code to a detailed evidenced report and CI to the compact exhaustive surface", () => {
    const claude = refBodies["claude-code-report.md"] ?? "";
    const ci = refBodies["ci.md"] ?? "";
    expect(body).toContain("references/claude-code-report.md");
    expect(claude).toContain("report --in audits/audit-latest.json");
    expect(claude).toContain("--html --evidence");
    expect(claude).toContain("--format report --split page");
    expect(claude).toContain("verify --report");
    expect(claude).toContain("--require-decided=pages");
    expect(claude).not.toMatch(/ultra11y\.mjs judge[^\n]*--runner claude/);
    for (const setting of ["report: 'false'", "html: 'false'", "evidence: 'false'", "pages-report: compact", "require-decided: pages"]) {
      expect(ci).toContain(setting);
    }
  });
});
