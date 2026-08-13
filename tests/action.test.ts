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

/** The position of a step, by a distinctive fragment of its name. Module-scoped: several
 *  describes reason about ORDER, and a per-describe copy is a copy that drifts. */
const idx = (needle: string): number => ACTION.runs.steps.findIndex((s) => s.name?.includes(needle));

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

// The judgment criteria — 38 of the 55 WCAG ones, 81 of RGAA's 106 — that no static pass can
// decide. In a coding agent the agent rules on them; in CI nobody does, so without this tier
// they stay « à évaluer » forever and the published conformance rate is partial by
// construction. Everything here is opt-in, and everything degrades.
describe("the adjudication tier", () => {
  /** Every surface that RENDERS from the adjudicated audit. They must all run after the
   *  verdicts are folded in, or the adjudication reaches nothing. */
  const CONSUMERS = ["Per-page report", "SARIF", "Annotations", "File tracker tickets", "Markdown report", "HTML report"];

  const adjudicationSteps = (): typeof ACTION.runs.steps => ACTION.runs.steps.filter((s) => s.name?.startsWith("Adjudicate"));

  it("is off by default — an existing consumer gets no model, no key, no network", () => {
    expect(ACTION.inputs.adjudicate?.default).toBe("none");
    expect(ACTION.inputs["gate-adjudicated"]?.default).toBe("false");
  });

  it("NEVER takes the API key as an input — a composite step inherits the job env", () => {
    for (const name of Object.keys(ACTION.inputs)) expect(name.toLowerCase()).not.toContain("api-key");
    expect(RAW).not.toMatch(/^\s+anthropic-api-key:/m);
    expect(RAW).toContain("ANTHROPIC_API_KEY");
  });

  it("offers both an API mode and an agent mode", () => {
    expect(ACTION.inputs.adjudicate?.description).toContain("api");
    expect(ACTION.inputs.adjudicate?.description).toContain("agent");
    expect(adjudicationSteps().some((s) => s.run?.includes("judge"))).toBe(true);
    expect(adjudicationSteps().some((s) => s.uses?.startsWith("anthropics/claude-code-action@"))).toBe(true);
  });

  it("runs AFTER the scan, so the model is never asked to rule on computed contrast", () => {
    const scan = idx("Scan the pages");
    const first = ACTION.runs.steps.findIndex((s) => s.name?.startsWith("Adjudicate") || s.name?.includes("Resolve the adjudication"));
    expect(scan).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(scan);
  });

  it("runs BEFORE every surface that reads audit-latest.json, or the verdicts reach nothing", () => {
    const last = Math.max(...ACTION.runs.steps.map((s, i) => (s.name?.startsWith("Adjudicate") ? i : -1)));
    expect(last).toBeGreaterThan(-1);
    for (const consumer of CONSUMERS) {
      expect(idx(consumer), `no step matching "${consumer}"`).toBeGreaterThan(last);
    }
  });

  // CONSUMERS is a LITERAL, so a new consumer stays invisible to the assertion above until
  // someone remembers to add the name. This closes the loop from the other side — and adding
  // "File tracker tickets" is what it caught: that step files the audit into a tracker and
  // had never been checked against the adjudication order.
  it("names every audit-latest.json reader in that list, so a new one cannot slip past it", () => {
    // `--in <file>` is what a READER passes. The producers reach the same path other ways:
    // `Audit the code` writes it with `--out`, `Scan the pages` folds into it with `--merge`,
    // and the adjudication tier rewrites it with the verdicts.
    const readers = ACTION.runs.steps.filter((s) => s.run?.includes("--in audits/audit-latest.json")).map((s) => s.name ?? "");
    expect(readers.length).toBeGreaterThan(CONSUMERS.length);
    for (const r of readers) {
      // Gate re-reads it to decide red or green, not to render a surface, and is asserted last
      // by its own test.
      if (r.startsWith("Adjudicate") || r.startsWith("Gate")) continue;
      expect(
        CONSUMERS.some((d) => r.includes(d)),
        `step "${r}" reads audit-latest.json but is not in CONSUMERS`,
      ).toBe(true);
    }
  });

  // Secrets are not exposed to a fork's pull request. Without this guard the tier would not
  // merely skip there — the step would run keyless and take the job down with it.
  it("skips itself when the key is absent, which is exactly a fork's pull request", () => {
    const resolve = ACTION.runs.steps.find((s) => s.id === "adjudication");
    expect(resolve?.run).toContain("ANTHROPIC_API_KEY");
    expect(resolve?.run).toContain("on=false");
    for (const step of adjudicationSteps()) {
      expect(step.if, `step "${step.name}" is not gated on the resolved tier`).toContain("steps.adjudication.outputs.on == 'true'");
    }
  });

  it("absorbs an adjudication failure instead of killing the audit job", () => {
    // The fold is fail-closed: one rate-limited batch refuses the whole apply. That must cost
    // the verdicts, never the report that was already produced above.
    const folding = adjudicationSteps().filter((s) => s.run?.includes("judge") || s.run?.includes("verify --apply"));
    expect(folding.length).toBe(2);
    for (const step of folding) {
      expect(step.run, `step "${step.name}" propagates its failure`).toContain("::warning::");
      expect(step.run, `step "${step.name}" ignores gate-adjudicated`).toContain("inputs.gate-adjudicated");
    }
  });

  it("pins claude-code-action, because `uses:` cannot take an expression", () => {
    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agent?.uses).toMatch(/^anthropics\/claude-code-action@v\d+$/);
    expect(agent?.uses).not.toContain("${{");
  });

  it("keeps the agent read-only over the source and pointed at the emitted runbook", () => {
    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agent?.with?.prompt).toContain("RUNBOOK.md");
    expect(agent?.with?.prompt).toContain("ADJUDICATE.todo.json");
    expect(agent?.with?.prompt).toMatch(/do not commit/i);
  });
});

describe("the gate", () => {
  it("runs LAST, so a failing audit has still produced every surface above it", () => {
    const names = ACTION.runs.steps.map((s) => s.name);
    expect(names[names.length - 1]).toBe("Gate");
  });

  // Default: the red/green is a pure function of the commit. Opt-in: a model-ruled
  // non-conformity can fail the job, and the caller has accepted a verdict that no longer
  // reproduces run to run. Both live in the SAME step, because the gate must stay last.
  it("re-audits the source by default, so two runs on one commit cannot disagree", () => {
    const gate = ACTION.runs.steps[ACTION.runs.steps.length - 1];
    expect(gate?.run).toMatch(/node "\$ENGINE" audit "\$\{args\[@\]\}" --fail-on/);
  });

  it("gates the adjudicated audit only when asked, and says so in the log", () => {
    const gate = ACTION.runs.steps[ACTION.runs.steps.length - 1];
    expect(gate?.run).toContain("inputs.gate-adjudicated");
    expect(gate?.run).toContain("audit --in audits/audit-latest.json");
    expect(gate?.run).toMatch(/not reproducible/i);
  });

  it("warns in the input's own description that it costs reproducibility", () => {
    expect(ACTION.inputs["gate-adjudicated"]?.description).toMatch(/reproducible/i);
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

  // Rendering a front door and then not uploading it is worse than not rendering one: the
  // reviewer is told an artifact exists and finds nothing in it.
  it("uploads when EITHER producer ran, not only the Markdown one", () => {
    expect(upload.if).toContain("inputs.report == 'true'");
    expect(upload.if).toContain("inputs.html == 'true'");
  });

  it("carries an id, so the run's own artifact url can be an output", () => {
    expect(upload.id).toBe("upload");
    expect(ACTION.outputs?.["artifact-url"]?.value).toContain("steps.upload.outputs.artifact-url");
    expect(ACTION.outputs?.["artifact-id"]?.value).toContain("steps.upload.outputs.artifact-id");
  });

  it("honours a retention window, and defaults to the repository's own setting", () => {
    expect(upload.with?.["retention-days"]).toContain("inputs.artifact-retention-days");
    expect(ACTION.inputs["artifact-retention-days"]?.default).toBe("");
  });

  // `overwrite: true` would let a second invocation in one job silently replace the first
  // one's artifact — the 409 is the signal that two runs share a name, and it must stay loud.
  it("never overwrites, so a name collision stays a visible failure", () => {
    expect(upload.with?.overwrite).toBeUndefined();
  });

  // There is exactly one upload-artifact step, and every assertion above found it by taking
  // the FIRST match. A second one inserted earlier would make them all describe the wrong step.
  it("has exactly one upload step for those assertions to be about", () => {
    expect(ACTION.runs.steps.filter((s) => s.uses?.startsWith("actions/upload-artifact"))).toHaveLength(1);
  });
});

describe("the HTML tier", () => {
  const html = (): { name?: string; if?: string; run?: string } => {
    const s = ACTION.runs.steps.find((x) => x.name === "HTML report");
    if (!s) throw new Error("action.yml has no `HTML report` step");
    return s;
  };

  it("is on by default, with both inputs documented", () => {
    expect(ACTION.inputs.html?.default).toBe("true");
    expect(ACTION.inputs.evidence?.default).toBe("true");
    expect(ACTION.inputs.html?.description).toBeTruthy();
    expect(ACTION.inputs.evidence?.description).toBeTruthy();
  });

  // A report the integrity gate rejected has not earned a nice face, and a report rendered
  // before the upload is a report nobody downloads.
  it("runs after the integrity check and before the upload", () => {
    expect(idx("HTML report")).toBeGreaterThan(idx("Markdown report"));
    expect(idx("HTML report")).toBeLessThan(ACTION.runs.steps.findIndex((s) => s.uses?.startsWith("actions/upload-artifact")));
  });

  // A rendering bug must never become a red accessibility gate. ci.yml is the compensating
  // control, and its assertions are not optional.
  it("degrades to a warning rather than failing the job", () => {
    expect(html().run).toContain("::warning::");
    expect(html().run).toContain("exit 0");
  });

  it("publishes both document paths as outputs", () => {
    expect(ACTION.outputs?.["html-path"]?.value).toContain("steps.html.outputs.path");
    expect(ACTION.outputs?.["html-single-path"]?.value).toContain("steps.html.outputs.single-path");
  });
});

describe("the pull-request digest's links", () => {
  const comment = (): { env?: Record<string, string> } => ACTION.runs.steps.find((s) => s.name?.includes("PR comment")) as { env?: Record<string, string> };

  // The run URL is known before anything is produced and cannot 404.
  it("always links the run", () => {
    expect(comment().env?.ULTRA11Y_RUN_URL).toContain("github.run_id");
  });

  // The artifact name is NOT: the upload is conditional, and naming an artifact that was
  // never uploaded sends the reviewer to a page that does not exist.
  it("names the artifact only under the same condition as the upload", () => {
    const name = comment().env?.ULTRA11Y_ARTIFACT_NAME ?? "";
    expect(name).toContain("inputs.report == 'true'");
    expect(name).toContain("inputs.html == 'true'");
    expect(name).toContain("ultra11y-{0}");
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
