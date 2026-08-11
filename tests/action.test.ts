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

  it("takes the page list from a sitemap or a crawl, not only from a hand-written list", () => {
    const scan = ACTION.runs.steps.find((s) => s.name === "Scan the pages");
    expect(scan?.if).toContain("inputs.sitemap");
    expect(scan?.if).toContain("inputs.crawl");
    expect(scan?.run).toContain("--sitemap");
    expect(scan?.run).toContain("--crawl");
  });

  it("starts and waits for the app in the sitemap/crawl modes too — they need it served just as much", () => {
    for (const name of ["Start the application", "Wait for the application"]) {
      const step = ACTION.runs.steps.find((s) => s.name === name);
      expect(step?.if, name).toContain("inputs.sitemap");
      expect(step?.if, name).toContain("inputs.crawl");
    }
  });

  it("snapshots every scanned page by default — without one a page can never be conforming", () => {
    expect(ACTION.inputs.snapshot?.default).toBe("true");
    const scan = ACTION.runs.steps.find((s) => s.name === "Scan the pages");
    expect(scan?.run).toContain("--no-snapshot"); // only when explicitly turned off
  });

  it("writes the per-page dossiers into the uploaded artifact", () => {
    const step = ACTION.runs.steps.find((s) => s.name === "Per-page report");
    expect(step).toBeTruthy();
    expect(step?.run).toContain("--format report");
    expect(step?.run).toContain("--split page");
    // A run with no page in scope is not a failure — it means nothing was scanned.
    expect(step?.run).toContain("||");
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

describe("the artifact upload", () => {
  // Artifact names are unique per WORKFLOW RUN, not per step. With a fixed name, a second
  // invocation in one job — the code diff, then the served pages — died on a 409 with the
  // report already written but never uploaded. Found by actually running the action.
  const upload = ACTION.runs.steps.find((s) => s.uses?.startsWith("actions/upload-artifact"))!;

  it("lets the caller name the artifact, so the action can run twice in one job", () => {
    expect(ACTION.inputs["artifact-name"]).toBeDefined();
    expect(ACTION.inputs["artifact-name"]?.default).toBe("");
    expect(upload.with?.name).toContain("inputs.artifact-name");
  });

  it("keeps the historical default name when the caller does not", () => {
    expect(upload.with?.name).toContain("ultra11y-{0}");
    expect(upload.with?.name).toContain("inputs.standard");
  });

  it("warns about the uniqueness rule in the input's own description", () => {
    expect(ACTION.inputs["artifact-name"]?.description).toMatch(/uniq/i);
  });
});

describe("the action is EXECUTED by CI, not only parsed", () => {
  // Everything above reads action.yml. But a composite action is bash — arrays, `set -e`,
  // quoting — and none of that is provable by reading YAML. The `action` job uses the real
  // thing end to end; without it, this whole file could stay green while the action was
  // broken for every consumer.
  const CI = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
    jobs: Record<string, { steps: { name?: string; uses?: string; run?: string; with?: Record<string, string> }[] }>;
  };

  const actionJob = (): { steps: { name?: string; uses?: string; run?: string; with?: Record<string, string> }[] } => {
    const job = CI.jobs.action;
    if (!job) throw new Error("ci.yml has no `action` job — the shipped action would be parsed but never executed");
    return job;
  };

  it("has a job that runs `uses: ./`", () => {
    expect(actionJob().steps.filter((s) => s.uses === "./").length).toBeGreaterThanOrEqual(1);
  });

  it("checks out before using the local action, or `uses: ./` resolves to nothing", () => {
    const steps = actionJob().steps;
    expect(steps[0]?.uses).toMatch(/^actions\/checkout@/);
  });

  it("exercises the page-by-page path, which no unit test can reach", () => {
    const withs = actionJob()
      .steps.filter((s) => s.uses === "./")
      .map((s) => s.with ?? {});
    expect(withs.some((w) => w.crawl || w.sitemap || w.urls || w.sample === "true")).toBe(true);
  });

  it("names each invocation's artifact, or the second upload 409s", () => {
    const withs = actionJob()
      .steps.filter((s) => s.uses === "./")
      .map((s) => s.with ?? {});
    const names = withs.map((w) => w["artifact-name"]);
    expect(names.every(Boolean), "an invocation left the artifact name to the default").toBe(true);
    expect(new Set(names).size, "two invocations share an artifact name").toBe(names.length);
  });

  it("needs no `security-events: write`, so it runs on a fork's pull request", () => {
    for (const w of actionJob()
      .steps.filter((s) => s.uses === "./")
      .map((s) => s.with ?? {})) {
      expect(w.sarif).toBe("false");
    }
  });

  it("uses no `[ … ] && …` statement anywhere in CI either — -e turns it into a job-killer", () => {
    // The same trap action.yml is checked for. It is just as fatal in the workflow that
    // proves the action works, and it was written here once before this test existed.
    for (const [jobName, job] of Object.entries(CI.jobs)) {
      for (const step of job.steps) {
        for (const line of (step.run ?? "").split("\n")) {
          expect(/^\s*\[[^\]]+\]\s*&&/.test(line), `${jobName} › ${step.name}: ${line.trim()}`).toBe(false);
        }
      }
    }
  });
});
