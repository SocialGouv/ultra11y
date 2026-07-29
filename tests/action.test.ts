// The shipped composite action. It is consumed as `maxgfr/ultra11y@vN`, so a mistake here
// breaks every user's CI and cannot be caught by a unit test of src/ — gate its structure.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = readFileSync(join(ROOT, "action.yml"), "utf8");
const ACTION = parse(RAW) as {
  name: string;
  description: string;
  inputs: Record<string, { description: string; default?: string; required?: boolean }>;
  outputs: Record<string, { value: string }>;
  runs: { using: string; steps: { id?: string; name?: string; uses?: string; shell?: string; run?: string; if?: string; with?: Record<string, string> }[] };
};

describe("the action is well-formed", () => {
  it("is a composite action with a name and a description", () => {
    expect(ACTION.runs.using).toBe("composite");
    expect(ACTION.name).toBeTruthy();
    expect(ACTION.description).toBeTruthy();
  });

  it("gives every shell step an explicit shell — composite actions require it", () => {
    for (const step of ACTION.runs.steps) {
      if (step.run !== undefined) expect(step.shell, `step "${step.name}" has a run: but no shell:`).toBeTruthy();
    }
  });

  it("documents every input", () => {
    for (const [name, spec] of Object.entries(ACTION.inputs)) expect(spec.description, `input ${name}`).toBeTruthy();
  });
});

describe("it runs the engine that ships with it", () => {
  it("resolves the bundle from GITHUB_ACTION_PATH, never from a registry", () => {
    expect(RAW).toContain("$GITHUB_ACTION_PATH/scripts/ultra11y.mjs");
    expect(RAW).not.toMatch(/npm (i|install|exec)\s/);
    expect(RAW).not.toMatch(/npx ultra11y/);
  });

  it("ships that bundle in the repository", () => {
    expect(existsSync(join(ROOT, "scripts/ultra11y.mjs"))).toBe(true);
  });

  it("needs no setup-node step — the runner already has Node", () => {
    expect(RAW).not.toContain("actions/setup-node");
  });
});

describe("it covers both halves of the ask: the code and the pages", () => {
  it("always audits the code", () => {
    const audit = ACTION.runs.steps.find((s) => s.id === "audit" || s.name === "Audit the code") as { run?: string } | undefined;
    expect(audit?.run).toContain("audit");
  });

  it("scans real pages when given URLs or a declared sample", () => {
    const scan = ACTION.runs.steps.find((s) => s.name === "Scan the pages");
    expect(scan?.if).toContain("inputs.urls");
    expect(scan?.if).toContain("inputs.sample");
    expect(scan?.run).toContain("--merge");
  });

  it("can start and wait for the app before scanning it", () => {
    const names = ACTION.runs.steps.map((s) => s.name);
    expect(names).toContain("Start the application");
    expect(names).toContain("Wait for the application");
  });
});

describe("it surfaces findings three ways, and degrades instead of failing", () => {
  it("uploads SARIF for inline annotations on the diff", () => {
    const upload = ACTION.runs.steps.find((s) => s.uses?.startsWith("github/codeql-action/upload-sarif"));
    expect(upload).toBeDefined();
    expect(upload?.with?.category).toContain("ultra11y-");
  });

  it("tolerates a repo without code scanning rather than failing the build", () => {
    const upload = ACTION.runs.steps.find((s) => s.uses?.startsWith("github/codeql-action/upload-sarif")) as { "continue-on-error"?: boolean } | undefined;
    expect(upload?.["continue-on-error"]).toBe(true);
  });

  it("emits workflow annotations, which every plan renders", () => {
    const step = ACTION.runs.steps.find((s) => s.name?.includes("Annotations"));
    expect(step?.run).toContain("--format github");
  });

  it("keeps the PR comment opt-in", () => {
    expect(ACTION.inputs.comment?.default).toBe("false");
  });
});

describe("the bash is safe under `set -e`", () => {
  // GitHub runs `shell: bash` as `bash --noprofile --norc -eo pipefail`. A `[ cond ] && cmd`
  // statement whose condition is FALSE returns 1 and aborts the whole step — the flag would
  // not merely be skipped, the job would die. Every conditional must be an `if` block.
  it("uses no `[ … ] && …` statement, which -e turns into a job-killer", () => {
    for (const step of ACTION.runs.steps) {
      for (const line of (step.run ?? "").split("\n")) {
        const code = line.trim();
        if (code.startsWith("#")) continue;
        expect(/^\[[^\]]*\]\s*&&/.test(code), `step "${step.name}" line \`${code}\` short-circuits under set -e`).toBe(false);
      }
    }
  });

  it("guards every optional flag with an if block instead", () => {
    const audit = ACTION.runs.steps.find((s) => s.id === "audit");
    expect(audit?.run).toMatch(/if \[ '\$\{\{ inputs\.jsx \}\}' = 'true' \]; then/);
    expect(audit?.run).toMatch(/if \[ -n '\$\{\{ inputs\.baseline \}\}' \]; then/);
  });
});

describe("the gate", () => {
  it("runs LAST, so a failing audit has still produced every surface above it", () => {
    const names = ACTION.runs.steps.map((s) => s.name);
    expect(names[names.length - 1]).toBe("Gate");
  });

  it("can be turned off entirely (report-only mode)", () => {
    const gate = ACTION.runs.steps[ACTION.runs.steps.length - 1];
    expect(gate?.if).toContain("inputs.fail-on != ''");
  });

  it("defaults to blocking-only, so a backlog of minor issues does not stop a team adopting it", () => {
    expect(ACTION.inputs["fail-on"]?.default).toBe("blocking");
  });

  it("supports the baseline so only NEW non-conformities can fail", () => {
    expect(ACTION.inputs.baseline).toBeDefined();
    expect(RAW).toContain("--baseline");
  });
});

describe("the standard", () => {
  it("defaults to the WCAG core and accepts a country pack", () => {
    expect(ACTION.inputs.standard?.default).toBe("wcag");
    expect(RAW).toContain("--standard '${{ inputs.standard }}'");
  });

  it("keeps SARIF runs distinct per standard, so two runs do not overwrite each other", () => {
    const upload = ACTION.runs.steps.find((s) => s.uses?.startsWith("github/codeql-action/upload-sarif"));
    expect(upload?.with?.category).toContain("${{ inputs.standard }}");
  });

  it("runs the report integrity gate, so CI cannot publish an invented criterion", () => {
    const report = ACTION.runs.steps.find((s) => s.name === "Markdown report");
    expect(report?.run).toContain("check --report");
  });
});
