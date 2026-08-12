import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import { VERSION } from "../src/types.js";
import { COMMANDS } from "../src/cli.js";
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
    for (const f of flags) {
      expect(help.includes(f), `--help omits ${f}, which the docs document`).toBe(true);
    }
  });

  it("pins the '53 static checks' prose claim to the real ALL_RULES count", () => {
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
  it("ships exactly the thirty-four reference docs", () => {
    expect(refFiles.sort()).toEqual([
      "act.md",
      "adjudication.md",
      "audit.md",
      "authoring.md",
      "automation.md",
      "ci.md",
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
      "media-and-motion.md",
      "methodology.md",
      "naming.md",
      "orchestration.md",
      "orchestrators.md",
      "packs.md",
      "pages.md",
      "prd.md",
      "rendered.md",
      "scale.md",
      "standards.md",
      "structure.md",
      "verify.md",
      "widgets.md",
    ]);
  });

  it("mentions every reference file that exists", () => {
    for (const f of refFiles) {
      expect(body, `SKILL.md never routes to references/${f}`).toContain(`references/${f}`);
    }
  });
});
