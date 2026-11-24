import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

type Step = { id?: string; name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string> };
type Job = { "timeout-minutes"?: number; env?: Record<string, string>; steps?: Step[] };
type Workflow = {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, Job>;
};

const WORKFLOWS = readdirSync(join(ROOT, ".github/workflows")).filter((f) => f.endsWith(".yml"));
const workflow = (file: string): Workflow => parse(read(`.github/workflows/${file}`)) as Workflow;
const job = (file: string, name: string): Job => {
  const j = workflow(file).jobs[name];
  if (!j) throw new Error(`${file} has no \`${name}\` job`);
  return j;
};
const script = (j: Job): string => (j.steps ?? []).map((s) => `${s.name ?? ""}\n${s.run ?? ""}`).join("\n");

// Issue #165: ultra11y no longer ships a CI integration of its own. Audits in CI run through
// iterion's rgaa-audit bot, which installs the pinned engine and calls its CLI. Nothing here may
// quietly grow a second orchestration back.
describe("no shipped CI integration", () => {
  it("ships no composite action and no GitLab template", () => {
    expect(existsSync(join(ROOT, "action.yml"))).toBe(false);
    expect(existsSync(join(ROOT, "skills/ultra11y/templates/gitlab-ci.yml"))).toBe(false);
  });

  it("drives the engine CLI in every workflow, never a local or published ultra11y action", () => {
    for (const file of WORKFLOWS) {
      for (const [name, j] of Object.entries(workflow(file).jobs)) {
        for (const step of j.steps ?? []) {
          expect(step.uses === "./" || step.uses?.startsWith("SocialGouv/ultra11y") === true, `${file} › ${name} › ${step.name ?? step.uses}`).toBe(false);
        }
      }
    }
  });

  it("uses no `[ … ] && …` statement in any workflow — `-e` turns it into a job-killer", () => {
    for (const file of WORKFLOWS) {
      for (const [name, j] of Object.entries(workflow(file).jobs)) {
        for (const step of j.steps ?? []) {
          for (const line of (step.run ?? "").split("\n")) {
            expect(/^\s*\[[^\]]+\]\s*&&/.test(line), `${file} › ${name} › ${step.name}: ${line.trim()}`).toBe(false);
          }
        }
      }
    }
  });
});

describe("GitHub workflow economy", () => {
  it("releases only after CI has validated the exact SHA", () => {
    const release = read(".github/workflows/release.yml");
    expect(release).toContain("workflow_run:");
    expect(release).toContain("github.event.workflow_run.head_sha");
    expect(release).not.toMatch(/^\s{2}push:/m);
    for (const file of ["standards-refresh.yml", "act-refresh.yml"]) {
      expect(read(`.github/workflows/${file}`)).not.toContain("gh workflow run release.yml");
    }
  });

  it("no longer moves a major-version tag: there is no action left for `@vN` to resolve", () => {
    expect(read(".github/workflows/release.yml")).not.toMatch(/git tag -f/);
  });
});

// The repository's own PR gate: changed code, then one rendered page, no model.
describe("the PR accessibility gate", () => {
  const j = () => job("static-rgaa.yml", "static-rgaa");

  it("audits the PR diff under RGAA, leaving the by-design fixtures out", () => {
    const run = script(j());
    expect(run).toContain('--since "origin/$GITHUB_BASE_REF"');
    expect(run).toContain("--exclude 'tests/fixtures/**'");
    expect(run).toMatch(/audit[^\n]*\n?[^\n]*--standard rgaa/);
  });

  it("renders a real page and holds the instrument gate", () => {
    const run = script(j());
    expect(run).toContain("scan http://127.0.0.1:8933/");
    expect(run).toContain("--merge audits/audit-latest.json");
    expect(run).toContain("--require-rendered");
  });

  it("reaches no model and asks for no write scope", () => {
    expect(script(j())).not.toMatch(/\bjudge\b/);
    expect(workflow("static-rgaa.yml").permissions).toEqual({ contents: "read" });
  });

  it("gates LAST, on the source, and only on pull requests", () => {
    const steps = j().steps ?? [];
    const gate = steps.findIndex((s) => s.run?.includes("--fail-on blocking"));
    expect(gate).toBeGreaterThan(steps.findIndex((s) => s.run?.includes("scan http://")));
    expect(steps[gate]?.if).toBe("github.event_name == 'pull_request'");
    expect(steps.slice(gate + 1).every((s) => s.if === "always()")).toBe(true);
  });
});

// Issue #168: the headless `judge` runner, and the paid workflow that drove it, are gone. The
// agent adjudicates through `verify --manual`; in CI, iterion's rgaa-audit bot does.
describe("no paid adjudication workflow", () => {
  it("ships no adjudication workflow", () => {
    expect(existsSync(join(ROOT, ".github/workflows/adjudication.yml"))).toBe(false);
    expect(existsSync(join(ROOT, ".github/workflows/adjudication-compare.yml"))).toBe(false);
  });

  it("calls no removed command or CI output in any workflow", () => {
    for (const file of WORKFLOWS) {
      const text = read(`.github/workflows/${file}`);
      for (const removed of [
        /\bultra11y\.mjs (judge|mcp|dev|affected|import)\b/,
        /--format (sarif|github)\b/,
        /audit --lite\b/,
        /--runtime docker\b/,
        /init --ci\b/,
      ]) {
        expect(removed.test(text), `${file} matches ${removed}`).toBe(false);
      }
    }
  });
});

// Issue #160: the harness integrations run for real — the OpenCode plugin and the Codex guard
// hook — each in a pinned binary, against a local mock model: no secret, no paid model.
describe("the harness smoke jobs", () => {
  const SMOKES = ["opencode-smoke", "codex-smoke"];

  it.each([
    ["opencode-smoke", "pnpm run test:opencode", "ULTRA11Y_REQUIRE_OPENCODE"],
    ["codex-smoke", "pnpm run test:codex", "ULTRA11Y_REQUIRE_CODEX"],
  ])("%s runs its smoke with the skip turned into a failure", (name, command, required) => {
    const j = job("ci.yml", name);
    const step = (j.steps ?? []).find((s) => s.run?.includes(command));
    expect(step, `${name} never runs ${command}`).toBeDefined();
    expect(step?.env?.[required]).toBe("1");
    expect(j["timeout-minutes"]).toBeLessThanOrEqual(15);
  });

  it("pins every harness version, and checks the one binary fetched outside a registry", () => {
    const oc = job("ci.yml", "opencode-smoke");
    expect(oc.env?.OPENCODE_V1_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(oc.env?.OPENCODE_V2_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(oc.env?.OPENCODE_V2_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(script(oc)).toContain("sha256sum -c -");
    expect(job("ci.yml", "codex-smoke").env?.CODEX_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    for (const name of SMOKES) expect(script(job("ci.yml", name))).not.toMatch(/@latest\b/);
  });

  it("caches the binaries and reaches no secret", () => {
    for (const name of SMOKES) {
      const j = job("ci.yml", name);
      expect(
        (j.steps ?? []).some((s) => s.uses?.startsWith("actions/cache@")),
        `${name} caches nothing`,
      ).toBe(true);
      expect(JSON.stringify(j)).not.toMatch(/secrets\.|OPENAI_API_KEY|ANTHROPIC_API_KEY/);
    }
    expect(workflow("ci.yml").permissions).toEqual({ contents: "read" });
  });

  it("keeps both smokes out of the main vitest run, each behind its own script", () => {
    const config = read("vitest.config.ts");
    expect(config).toContain('"tests/opencode-smoke.e2e.test.ts"');
    expect(config).toContain('"tests/codex-smoke.e2e.test.ts"');
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:opencode"]).toContain("vitest.opencode.config.ts");
    expect(pkg.scripts["test:codex"]).toContain("vitest.codex.config.ts");
  });
});
