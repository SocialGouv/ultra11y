// The shipped composite action. It is consumed as `maxgfr/ultra11y@vN`, so a mistake here
// breaks every user's CI and cannot be caught by a unit test of src/ — gate its structure.
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = readFileSync(join(ROOT, "action.yml"), "utf8");
const ACTION = parse(RAW) as {
  name: string;
  description: string;
  inputs: Record<string, { description: string; default?: string; required?: boolean }>;
  outputs: Record<string, { value: string; description?: string }>;
  runs: {
    using: string;
    steps: {
      id?: string;
      name?: string;
      uses?: string;
      shell?: string;
      run?: string;
      if?: string;
      with?: Record<string, string>;
      env?: Record<string, string>;
      // Hyphenated, so it needs quoting here as well as at the use site.
      "continue-on-error"?: boolean;
    }[];
  };
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

  // The closure that `CONSUMERS` gates, taken by the other end. `CONSUMERS` catches a STEP
  // nobody listed; this catches an INPUT nobody reads — a setting the description promises
  // and no command receives. `evidence-max` shipped in 4.1.0 exactly like that: declared,
  // defaulted to 200, documented in references/ci.md, and passed to nothing.
  it("reads every input it declares — an unread input is a documented lie", () => {
    for (const name of Object.keys(ACTION.inputs)) {
      expect(RAW.includes(`inputs.${name}`), `input \`${name}\` is declared but no step reads it`).toBe(true);
    }
  });
});

describe("it runs the engine that ships with it", () => {
  // THE ENGINE ships in the action and is never fetched. A blanket ban on `npm` used to stand
  // in for that, and it was accurate while the action installed nothing at all — but the
  // BROWSER TIER cannot ship in a git checkout (it is a 100+ MB binary), so the action now
  // installs Playwright when a scan needs it. The invariant that matters is unchanged and is
  // asserted directly: nothing ever installs, or executes, ultra11y itself from a registry.
  it("resolves the bundle from GITHUB_ACTION_PATH, never from a registry", () => {
    expect(RAW).toContain("$GITHUB_ACTION_PATH/scripts/ultra11y.mjs");
    expect(RAW).not.toMatch(/npx ultra11y/);
    expect(RAW).not.toMatch(/npm (i|install|exec)\s[^\n]*ultra11y/);
  });

  // TWO tiers cannot ship in a git checkout: the browser (a 100+ MB binary) and the
  // adjudication CLI (a model client the engine deliberately does not vendor). Both are
  // installed by the action, never by the engine, and never into the consumer's tree — which
  // is the invariant, and the reason `--prefix` is asserted on every one of them.
  it("installs nothing but the tiers that cannot ship, and nothing into the audited repository", () => {
    const installs = RAW.match(/npm (?:i|install)\s[^\n]*/g) ?? [];
    expect(installs.length, "the install lines vanished — this test would then assert nothing").toBeGreaterThan(0);
    for (const line of installs) {
      expect(line, "an npm install in this action must be the browser tier or the adjudication CLI").toMatch(
        /@playwright\/test|@axe-core\/playwright|@anthropic-ai\/claude-code/,
      );
      expect(line, "and must land in a scratch prefix, never in the consumer's tree").toContain("--prefix");
    }
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
    // A run with no page in scope is not a failure — it means nothing was scanned. The step
    // swallows the engine's non-zero and says so, rather than reddening a job that simply had
    // no pages to report on.
    expect(step?.run).toMatch(/no page in scope/);
    expect(step?.run).toMatch(/exit 0/);
  });

  // THE ARTIFACT MUST CONTAIN WHAT THE DOCS SAY IT CONTAINS.
  //
  // `references/ci.md` has documented `audits/pages/index.html + page-<id>.html` in the
  // artifact tree, and the step never passed `--html`; it never passed `--evidence` either, so
  // the page sheets cited `dom.html:412 (div.card)` with no picture while the compliance
  // report beside them carried annotated crops of the same defects. A documented artifact
  // layout that does not exist is a promise the reader discovers is empty.
  it("honours `html` and `evidence` in the per-page dossiers too, as the docs promise", () => {
    const step = ACTION.runs.steps.find((s) => s.name === "Per-page report");
    expect(step?.run).toContain("--html");
    expect(step?.run).toContain("--evidence");
  });

  it("writes the per-page grid as machine-readable JSON beside the sheets", () => {
    const step = ACTION.runs.steps.find((s) => s.name === "Per-page report");
    expect(step?.run).toContain("pages.json");
  });

  it("writes every page's criterion statuses to the artifact and the visible job summary", () => {
    const step = ACTION.runs.steps.find((s) => s.name === "Per-page report");
    expect(ACTION.inputs["pages-report"]?.description).toContain("compact");
    expect(step?.if).toContain("!= 'false'");
    expect(step?.run).toContain("audits/pages-status.md");
    expect(step?.run).toContain("GITHUB_STEP_SUMMARY");
    expect(step?.run).toContain("Impossible to verify");
    expect(step?.run).toContain("À vérifier");
  });

  it("keeps compact mode free of detailed remediation dossiers", () => {
    const step = ACTION.runs.steps.find((s) => s.name === "Per-page report");
    expect(step?.run).toContain("PAGES_REPORT_MODE");
    expect(step?.run).toMatch(/if \[ "\$PAGES_REPORT_MODE" = 'true' \]; then/);
  });

  it("packages only the compact result, source audit and ledger", () => {
    const prepare = ACTION.runs.steps.find((s) => s.name === "Prepare report artifact");
    const upload = ACTION.runs.steps.find((s) => s.name === "Upload the report");
    expect(prepare?.run).toContain("audit-latest.json pages.json pages-status.md");
    expect(prepare?.run).toContain('"verdicts-${STANDARD}.json"');
    expect(prepare?.run).not.toContain("ADJUDICATE");
    expect(upload?.with?.path).toContain("steps.artifact-files.outputs.path");

    const dir = mkdtempSync(join(tmpdir(), "u11y-compact-artifact-"));
    const runnerTemp = join(dir, "runner-temp");
    const output = join(dir, "output");
    mkdirSync(join(dir, "audits"));
    mkdirSync(runnerTemp);
    for (const file of ["audit-latest.json", "pages.json", "pages-status.md", "verdicts-rgaa.json", "ADJUDICATE.md"]) {
      writeFileSync(join(dir, "audits", file), file);
    }
    const result = spawnSync("bash", ["-euo", "pipefail", "-c", prepare?.run ?? ""], {
      cwd: dir,
      env: { ...process.env, PAGES_REPORT_MODE: "compact", STANDARD: "rgaa", RUNNER_TEMP: runnerTemp, GITHUB_OUTPUT: output },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    const artifactPath = readFileSync(output, "utf8")
      .trim()
      .replace(/^path=/, "");
    expect(readdirSync(artifactPath).sort()).toEqual(["audit-latest.json", "pages-status.md", "pages.json", "verdicts-rgaa.json"]);
  });

  it("renders all four honest status buckets from the real compact-summary program", () => {
    const run = ACTION.runs.steps.find((s) => s.name === "Per-page report")?.run ?? "";
    const program = /node <<'NODE'\n([\s\S]*?)\nNODE/.exec(run)?.[1];
    expect(program).toBeTruthy();

    const dir = mkdtempSync(join(tmpdir(), "u11y-pages-status-"));
    mkdirSync(join(dir, "audits"));
    writeFileSync(
      join(dir, "audits/pages.json"),
      JSON.stringify({
        pages: [
          {
            name: "Accueil <public>",
            url: "https://example.test/",
            criteria: [
              { id: "1.1", status: "C" },
              { id: "1.2", status: "NC" },
              { id: "1.3", status: "manual" },
              { id: "1.4", status: "manual" },
            ],
          },
        ],
      }),
    );
    writeFileSync(join(dir, "undecidable.json"), JSON.stringify({ entries: [{ criteriaId: "1.3", reason: "The video must be watched." }] }));
    const summary = join(dir, "summary.md");
    const result = spawnSync(process.execPath, ["-e", program!], {
      cwd: dir,
      env: { ...process.env, LANG_OPT: "fr", UNDECIDABLE_FILE: "undecidable.json", GITHUB_STEP_SUMMARY: summary },
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const artifact = readFileSync(join(dir, "audits/pages-status.md"), "utf8");
    expect(readFileSync(summary, "utf8")).toBe(artifact);
    expect(artifact).toContain("1 conformes · 1 non conformes · 1 impossibles à vérifier · 1 à vérifier");
    expect(artifact).toContain("**Conformes (1)** : `1.1`");
    expect(artifact).toContain("**Non conformes (1)** : `1.2`");
    expect(artifact).toContain("**Impossibles à vérifier (1)** : `1.3`");
    expect(artifact).toContain("**À vérifier (1)** : `1.4`");
    expect(artifact).toContain("Accueil &lt;public&gt;");
    expect(artifact).toContain("The video must be watched.");
  });

  // Unbounded by default: a sweep that silently stopped at 20 pages produced a report merely
  // SHORTER than the site, and a shorter deliverable reads exactly like a complete one.
  it("crawls without a cap unless the caller asks for one", () => {
    expect(ACTION.inputs["crawl-max"]?.default).toBe("0");
    expect(ACTION.inputs["crawl-depth"]?.default).toBe("0");
  });
});

// WHAT A LATER JOB CAN READ. The action published two repo-global scalars and nothing about
// pages, so a caller wanting a badge, a dashboard or a follow-up job had to re-parse an
// artifact it could not address while the run was still in flight.
describe("it publishes the page dimension as outputs", () => {
  const OUT = ACTION.outputs;

  it("names the per-page JSON and the dossier directory", () => {
    expect(OUT["pages-json-path"]).toBeTruthy();
    expect(OUT["pages-report-path"]).toBeTruthy();
  });

  it("publishes the counts a gate or a badge can read without downloading anything", () => {
    expect(OUT["pages-count"]).toBeTruthy();
    expect(OUT["pages-failing"]).toBeTruthy();
  });

  // A criterion × page matrix is not a scalar and a step output is size-capped: the PATH is
  // the honest contract, and truncating a grid into an output would be a silent lie.
  it("publishes the path to the grid, never the grid itself", () => {
    for (const key of ["pages-json-path", "pages-report-path", "pages-summary-path"]) {
      expect(OUT[key]?.description ?? "").toMatch(/path/i);
    }
  });

  it("wires every one of them to a step that exists", () => {
    const ids = new Set(ACTION.runs.steps.map((s) => s.id).filter(Boolean));
    for (const key of ["pages-json-path", "pages-report-path", "pages-summary-path", "pages-count", "pages-failing"]) {
      const m = /steps\.([a-z0-9_-]+)\.outputs/.exec(OUT[key]?.value ?? "");
      expect(m, `${key} is not wired to a step output`).toBeTruthy();
      expect(ids.has(m![1] as string), `${key} names step "${m![1]}", which does not exist`).toBe(true);
    }
  });
});

// THE BROWSER TIER, SHIPPED RATHER THAN ASSUMED.
//
// `scan --runtime local` resolves Playwright from the audited project first and from
// ultra11y's own install second. Run as `uses: maxgfr/ultra11y@v5`, that second anchor is a
// checkout with NO node_modules beside it — so a consumer who simply writes `crawl:` got no
// local tier, degraded to Docker, and silently lost every rendering criterion. The action
// installed nothing, while the `urls` input promised "a Chromium binary for the Playwright
// that ships with ultra11y".
describe("the action can provide its own browser tier", () => {
  const step = (): (typeof ACTION.runs.steps)[number] | undefined => ACTION.runs.steps.find((s) => s.name?.includes("browser tier"));

  it("takes a `browser` input, defaulting to auto", () => {
    expect(ACTION.inputs.browser).toBeTruthy();
    expect(ACTION.inputs.browser?.default).toBe("auto");
  });

  it("runs only when a scan was actually asked for", () => {
    const cond = step()?.if ?? "";
    for (const key of ["urls", "sample", "sitemap", "crawl"]) expect(cond, `the step must be gated on ${key}`).toContain(key);
    expect(cond).toContain("browser");
  });

  it("asks the ENGINE whether it needs to install, never a shell re-derivation", () => {
    // A second implementation of "does Playwright resolve?" is a second answer, and it will
    // eventually disagree with the one `scan` acts on.
    expect(step()?.run).toContain("status --browser");
  });

  it("installs into a scratch prefix, never into the audited repository", () => {
    // `npm i --omit=dev <pkg>` installs NOTHING for a package already in the target's
    // devDependencies — the trap that once left this repo's own CI with no tier at all. A
    // fresh prefix declares nothing, so it cannot be hit.
    expect(step()?.run).toContain("--prefix");
    expect(step()?.run).toContain("RUNNER_TEMP");
    expect(step()?.run).not.toContain("--omit=dev");
  });

  it("pins the versions to the action's own manifest, so the browsers match the packages", () => {
    expect(step()?.run).toContain("GITHUB_ACTION_PATH");
    expect(step()?.run).toContain("package.json");
  });

  it("downloads a browser binary, which is the half a package install does not bring", () => {
    expect(step()?.run).toContain("playwright install");
  });

  it("hands the scan the prefix it installed into", () => {
    const scan = ACTION.runs.steps.find((s) => s.name === "Scan the pages");
    expect(scan?.run).toContain("--cwd");
  });

  it("runs before the scan — a tier provided afterwards provides nothing", () => {
    expect(idx("browser tier")).toBeGreaterThan(-1);
    expect(idx("browser tier")).toBeLessThan(idx("Scan the pages"));
  });

  it("never fails the job over it: a tier it could not build degrades to the runtime's own fallback", () => {
    expect(step()?.run).toMatch(/continue|::warning::/);
  });
});

describe("the render gate and the one-comment mode are reachable from the action", () => {
  it("takes `require-rendered`, off by default like its two siblings", () => {
    expect(ACTION.inputs["require-rendered"]).toBeTruthy();
    expect(ACTION.inputs["require-rendered"]?.default).toBe("false");
  });

  it("runs it as a gate step, and only when asked", () => {
    const step = ACTION.runs.steps.find((s) => s.name?.includes("Render gate"));
    expect(step).toBeTruthy();
    expect(step?.if).toContain("require-rendered");
    expect(step?.run).toContain("--require-rendered");
  });

  it("documents `full` as a comment kind", () => {
    expect(ACTION.inputs["comment-kind"]?.description).toContain("full");
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

// The judgment criteria — 38 of the 55 WCAG ones, 58 of RGAA's 106 — that no static pass can
// decide. In a coding agent the agent rules on them; in CI nobody does, so without this tier
// they stay « à évaluer » forever and the published conformance rate is partial by
// construction. Everything here is opt-in, and everything degrades.
describe("the adjudication tier", () => {
  /** Every surface that RENDERS from the adjudicated audit. They must all run after the
   *  verdicts are folded in, or the adjudication reaches nothing. */
  const CONSUMERS = [
    "Per-page report",
    "SARIF",
    "Annotations",
    "File tracker tickets",
    "Markdown report",
    "HTML report",
    "Completeness gate",
    "Render gate",
    "left to assess",
  ];

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
      // by its own test. The ledger replay is a DECIDER, like the adjudication tier — it folds
      // stored verdicts INTO the audit — and has its own ordering test below.
      if (r.startsWith("Adjudicate") || r.startsWith("Gate") || r.startsWith("Replay the verdict ledger")) continue;
      expect(
        CONSUMERS.some((d) => r.includes(d)),
        `step "${r}" reads audit-latest.json but is not in CONSUMERS`,
      ).toBe(true);
    }
  });

  // The ledger is what lets a CI job publish a complete grid without a model, and its position
  // is the whole economy of the tier: replay first, so a paid pass only ever covers what the
  // ledger did not. Ordered after the scan for the same reason the adjudication is — by then
  // the rendered criteria are decided and no stored verdict can contradict a measurement.
  it("replays the verdict ledger after the scan and BEFORE any paid adjudication", () => {
    const ledger = idx("Replay the verdict ledger");
    const scan = idx("Scan the pages");
    const firstPaid = ACTION.runs.steps.findIndex((s) => s.name?.startsWith("Adjudicate") || s.name?.includes("Resolve the adjudication"));

    expect(ledger).toBeGreaterThan(scan);
    expect(ledger).toBeLessThan(firstPaid);
  });

  it("never lets a missing or refused ledger take the job down", () => {
    const ledger = ACTION.runs.steps.find((s) => s.id === "ledger");
    expect(ledger?.run).toContain("::warning::");
    // No `exit 1` anywhere: the criteria simply stay to assess, which is where they would have
    // been without a ledger at all.
    expect(ledger?.run).not.toContain("exit 1");
  });

  it("records the accepted verdicts in both adjudication modes, so a paid pass is never paid twice", () => {
    for (const name of ["Adjudicate with the API", "Adjudicate with an agent — fold the verdicts"]) {
      const step = ACTION.runs.steps.find((s) => s.name === name);
      expect(step?.run, `step "${name}" does not record a ledger`).toContain("--ledger");
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

  it("absorbs an adjudication failure instead of killing the audit job — on EVERY pass", () => {
    // The fold is fail-closed: one rate-limited batch refuses the whole apply. That must cost
    // the verdicts, never the report that was already produced above.
    //
    // Selected on `--apply`, not on the literal `verify --apply`: passes 2 and 3 assemble
    // their arguments into an array and call `verify "\${args[@]}"`, so the old selector
    // matched pass 1's COMMENT and nothing else. It reported two folding steps out of four —
    // and the two it never saw were precisely the two that ignored `gate-adjudicated`, which
    // is to say the test was green about the half of the code that was wrong.
    const folding = adjudicationSteps().filter((s) => s.run?.includes("--apply"));
    const agentFolds = folding.filter((s) => s.name?.includes("with an agent"));
    // One fold per claude-code-action pass — `adjudicate-passes` documents three.
    expect(agentFolds.length, "an agent pass was added without a fold, or a fold lost its --apply").toBe(3);
    // And one per tier that folds inside a single step: the API tier, and the CLI runner
    // (whose `judge --apply` derives, rules and folds in one go). Counted by what they ARE
    // rather than by a total, so adding a tier is a visible decision rather than a number
    // nudged from 4 to 5.
    expect(folding.length - agentFolds.length, "one fold per single-step tier: api and cli").toBe(2);
    for (const step of folding) {
      expect(step.run, `step "${step.name}" propagates its failure`).toContain("::warning::");
      // HONOURS it, however it reads it. Interpolating an input into a bash string is the
      // weaker spelling — this file's own rule is to pass inputs through `env:` so a value
      // carrying a quote stays data — so a step that does the safer thing must not fail an
      // assertion written when only the weaker one existed.
      const honours = String(step.run).includes("inputs.gate-adjudicated") || JSON.stringify(step.env ?? {}).includes("inputs.gate-adjudicated");
      expect(honours, `step "${step.name}" ignores gate-adjudicated`).toBe(true);
    }
  });

  // `adjudicate-passes: 0` used to run all three passes and bill for them: the gates were
  // written as `!= '1'` and `!= '1' && != '2'`, so every value that was not literally 1 or 2
  // fell through to the most expensive branch. A count is a floor as well as a ceiling.
  it("gates the extra passes on the count they are, not on the count they are not", () => {
    const worklists = adjudicationSteps().filter((s) => s.name?.includes("worklist") || s.id?.startsWith("worklist"));
    const later = worklists.filter((s) => /pass [23]/.test(s.name ?? ""));
    expect(later.length, "the second and third passes must each have a worklist step").toBe(2);
    for (const step of later) {
      expect(step.if, `step "${step.name}" is gated negatively`).not.toContain("adjudicate-passes != ");
      expect(step.if, `step "${step.name}" does not name the counts it runs for`).toContain("adjudicate-passes == ");
    }
  });

  // Two inputs are read by `if:` expressions that can only match fixed strings, so an
  // unrecognised value does not degrade to the default — the gate never matches, and a later
  // step then concludes from the empty output it left behind. `require-decided: yes` made the
  // job fail with "the criterion grid is incomplete" over a grid nothing had measured, because
  // `Completeness gate` matches 'true'|'pages' while `Gate` tested `!= 'false' && != ''`.
  it("refuses a value its own gates cannot match, rather than acting on the wrong one", () => {
    const engine = ACTION.runs.steps.find((s) => s.id === "engine");
    expect(engine, "the first step must still be the engine resolver").toBeTruthy();
    // Read from the environment, like every other caller-controlled input in this file.
    expect(engine?.env?.REQUIRE_DECIDED).toContain("inputs.require-decided");
    expect(engine?.env?.ADJUDICATE_PASSES).toContain("inputs.adjudicate-passes");
    for (const token of ["require-decided=", "adjudicate-passes="]) {
      expect(engine?.run, `the preflight never names ${token}`).toContain(token);
    }
    // It refuses, it does not warn: both inputs exist to make a run STRICTER, and a misspelt
    // strictness that quietly does nothing is the failure they were added to remove.
    expect(engine?.run).toContain("exit 1");
  });

  // The two gates that read `require-decided` have to agree on what it is. They did not: one
  // matched 'true'|'pages', the other anything that was not 'false' or empty.
  it("reads require-decided the same way in the gate that measures and the gate that fails", () => {
    const measuring = ACTION.runs.steps.find((s) => s.name === "Completeness gate");
    const gate = ACTION.runs.steps.find((s) => s.name === "Gate");
    expect(measuring?.if).toContain("inputs.require-decided == 'true'");
    expect(measuring?.if).toContain("inputs.require-decided == 'pages'");
    expect(gate?.if).toContain("inputs.require-decided == 'true'");
    expect(gate?.if).toContain("inputs.require-decided == 'pages'");
  });

  // THE DEFAULTS ARE THE DANGEROUS CASE. `adjudicate-passes` is 1 and `require-decided` is
  // false, so an adjudication that ran out of turns used to end the job green with half the
  // grid unruled — and on a green job an unruled criterion reads exactly like a passing one.
  // Measured on a real pull request: 94 of 106 criteria came back « à évaluer » under a check
  // that said success.
  it("names what it did not rule on, whatever the inputs say", () => {
    const residue = ACTION.runs.steps.find((s) => s.id === "residue");
    expect(residue, "the action must always measure its own residue").toBeTruthy();
    // Gated on the TIER having run, and on nothing else — not on require-decided, not on a
    // pass count, not on fail-on.
    expect(residue?.if).toBe("steps.adjudication.outputs.on == 'true'");
    expect(residue?.run).toContain("verify --manual");
    expect(residue?.run).toContain("::warning::");
    // It names the criteria, not just a count: "12 left to assess" is not actionable.
    expect(residue?.run).toContain("ids");
    // …and it does not clobber the worklist the passes above were handed.
    expect(residue?.run).not.toContain("--out audits");
  });

  it("measures the residue AFTER the last fold, or it measures nothing", () => {
    const at = (needle: string): number => ACTION.runs.steps.findIndex((s) => s.name?.includes(needle));
    expect(at("pass 3, fold")).toBeGreaterThan(0);
    expect(idx("left to assess")).toBeGreaterThan(at("pass 3, fold"));
    // …and before the gate that may fail the job on it.
    expect(idx("left to assess")).toBeLessThan(idx("Gate"));
  });

  // Production callers remain unbounded by default. A caller may nevertheless request a
  // deliberately partial smoke run; the residue/gate below still names everything omitted.
  it("only caps the API tier when the caller explicitly requests a bounded smoke run", () => {
    const api = adjudicationSteps().find((s) => s.run?.includes("judge"));
    expect(ACTION.inputs["adjudicate-max"]?.default).toBe("");
    expect(api?.env?.MAX_ITEMS).toBe("${{ inputs.adjudicate-max }}");
    expect(api?.run).toContain('args+=(--max "$MAX_ITEMS")');
    expect(api?.run).toContain("must be a positive integer");
  });

  // The agent tier is billed PER ITEM — a full RGAA worklist runs to ~90 — and it had no way
  // to pick a model at all: `adjudicate-model` reached the API tier only, so the expensive
  // mode was the one stuck on the harness default.
  it("lets the agent tier pick its model, which is how a run gets cheaper", () => {
    const worklists = adjudicationSteps().filter((s) => s.id?.startsWith("worklist"));
    expect(worklists.length, "one worklist per pass").toBe(3);
    for (const w of worklists) {
      expect(w.env?.MODEL, `${w.name} does not read the model`).toContain("inputs.adjudicate-model");
      expect(w.run, `${w.name} does not pass it on`).toContain("--model $MODEL");
      // Caller-controlled, and about to be written to $GITHUB_OUTPUT where a newline would
      // start a line of somebody else's choosing. Validated, not trusted.
      expect(w.run, `${w.name} does not validate the id`).toContain("[!A-Za-z0-9._:/-]");
      expect(w.run).toContain("args=$cargs");
    }
    // Every agent step takes the assembled string, so no pass is left on the default.
    for (const a of adjudicationSteps().filter((s) => s.uses?.startsWith("anthropics/claude-code-action@"))) {
      expect(String(a.with?.claude_args)).toMatch(/steps\.worklist\d?\.outputs\.args/);
    }
    expect(ACTION.inputs["adjudicate-model"]?.description, "the input still says API-only").toContain("BOTH");
  });

  // MEASURED on the first keyed run this repository ever performed: claude-code-action came
  // back `is_error` after a single turn, and every step below it was SKIPPED — the Markdown
  // report, the HTML report, the per-page dossiers, the artifact upload and the residue
  // warning, all of them already computed or about to be. The job reported a failed
  // accessibility audit when what had failed was one API call.
  //
  // The API tier had always honoured "an adjudication that fails is not an audit that fails",
  // because a `run:` step can wrap itself in `if … else warning`. A `uses:` step cannot, and
  // that is the whole reason this needs its own guard.
  it("never lets a failed model call take the audit down with it", () => {
    const agents = adjudicationSteps().filter((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agents.length, "one agent step per pass").toBe(3);
    for (const a of agents) {
      expect(a["continue-on-error"], `step "${a.name}" kills the run when the model call fails`).toBe(true);
    }
    // The failure is relocated, not swallowed: the fold decides what it costs, and it is the
    // fold that knows about gate-adjudicated.
    for (const f of adjudicationSteps().filter((s) => s.name?.includes("fold"))) {
      expect(f.run).toContain("inputs.gate-adjudicated");
    }
    const operationalGate = ACTION.runs.steps.find((step) => step.name === "Require at least one operational agent pass")!;
    expect(operationalGate.if).toContain("always()");
    expect(operationalGate.env).toMatchObject({
      PASS1: expect.stringContaining("agentpass1.outputs.conclusion"),
      PASS2: expect.stringContaining("agentpass2.outputs.conclusion"),
      PASS3: expect.stringContaining("agentpass3.outputs.conclusion"),
      FILE1: expect.stringContaining("agentpass1.outputs.execution_file"),
      FILE2: expect.stringContaining("agentpass2.outputs.execution_file"),
      FILE3: expect.stringContaining("agentpass3.outputs.execution_file"),
    });
    expect(operationalGate.run).toContain('"$attempted" -gt 0');
    expect(operationalGate.run).toContain('"$succeeded" -eq 0');
    expect(operationalGate.run).toContain("result.is_error !== true");
    expect(operationalGate.run).toContain('echo "ok=false" >> "$GITHUB_OUTPUT"');
    expect(operationalGate.run).not.toContain("exit 1");
    const finalGate = ACTION.runs.steps.find((step) => step.name === "Gate")!;
    expect(finalGate.if).toContain("steps.agentoperational.outputs.ok == 'false'");
    expect(finalGate.run).toContain("every attempted Claude Code adjudication pass failed operationally");
  });

  it("detects is_error inside a green Claude execution log before the final gate", () => {
    const operationalGate = ACTION.runs.steps.find((step) => step.name === "Require at least one operational agent pass")!;
    const dir = mkdtempSync(join(tmpdir(), "u11y-agent-operation-"));
    const executionFile = join(dir, "execution.jsonl");
    const output = join(dir, "output");
    const run = (isError: boolean, permissionDenials: unknown[] = [], permissionDenialsCount?: number) => {
      writeFileSync(
        executionFile,
        `${JSON.stringify({ subtype: "init" })}\n${JSON.stringify({ type: "result", subtype: "success", is_error: isError, num_turns: 1, permission_denials: permissionDenials, ...(permissionDenialsCount === undefined ? {} : { permission_denials_count: permissionDenialsCount }) })}\n`,
      );
      writeFileSync(output, "");
      const result = spawnSync("bash", ["-c", operationalGate.run ?? ""], {
        encoding: "utf8",
        env: { ...process.env, PASS1: "success", FILE1: executionFile, PASS2: "", FILE2: "", PASS3: "", FILE3: "", GITHUB_OUTPUT: output },
      });
      expect(result.status, result.stderr).toBe(0);
      return readFileSync(output, "utf8");
    };

    expect(run(true)).toContain("ok=false");
    expect(run(false)).toContain("ok=true");
    // A green wrapper can still mean Claude was unable to perform the adjudication. This is
    // the exact envelope captured from keyed run 32961042681: the action reported success,
    // but thirteen denied tool calls left every one of the 91 verdicts untouched.
    expect(run(false, [{ tool: "Write" }])).toContain("ok=false");
    expect(run(false, [], 13)).toContain("ok=false");

    writeFileSync(output, "");
    const blank = spawnSync("bash", ["-c", operationalGate.run ?? ""], {
      encoding: "utf8",
      env: { ...process.env, PASS1: "", FILE1: "", PASS2: "", FILE2: "", PASS3: "", FILE3: "", GITHUB_OUTPUT: output },
    });
    expect(blank.status, blank.stderr).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("ok=false");
  });

  // Removing the bound has to mean REMOVING THE FLAG, not passing a very large number:
  // claude-code-action sets no default of its own, so an absent `--max-turns` is what an
  // unbounded run actually looks like. What still stops it is the job's own timeout, and above
  // that GitHub's hard six-hour ceiling on a hosted runner.
  it("lets a caller remove the bound, and refuses a value that is neither", () => {
    for (const w of adjudicationSteps().filter((s) => s.id?.startsWith("worklist"))) {
      const run = String(w.run);
      expect(run, `${w.name} has no 'unlimited' branch`).toContain('unlimited|0) turns=""');
      // The flag is appended only when a budget survived that branch.
      expect(run).toContain('if [ -n "${turns:-}" ]; then cargs="$cargs --max-turns $turns"; fi');
      // …and a typo is refused rather than silently treated as unbounded, which would be the
      // expensive reading of a mistake.
      expect(run).toContain("is neither a turn count nor 'unlimited'");
    }
  });

  // THE CLI RUNNER — the same tier without GitHub in it. It is the production default: the
  // historical action runner needs the model to edit one large JSON file, while this path
  // returns structured verdicts on stdout and leaves the audited tree read-only.
  describe("the engine-driven CLI runner", () => {
    const cli = () => ACTION.runs.steps.find((s) => s.id === "clirunner");

    it("is the default while retaining worklist batches for compatibility", () => {
      expect(ACTION.inputs["adjudicate-runner"]?.default).toBe("cli");
      expect(ACTION.inputs["adjudicate-grain"]?.default).toBe("worklist");
    });

    it("and the action path stands down when it is on, so the tier never runs twice", () => {
      const actionPath = adjudicationSteps().filter((s) => s.if?.includes("inputs.adjudicate == 'agent'") && s.id !== "clirunner");
      expect(actionPath.length).toBeGreaterThan(0);
      for (const step of actionPath) {
        expect(step.if, `step "${step.name}" would run alongside the CLI runner`).toContain("inputs.adjudicate-runner != 'cli'");
      }
    });

    // One step where the action path needs eleven: `judge --apply` derives the worklist,
    // calls the model, folds fail-closed and records the ledger.
    it("derives, rules, folds and records in one step", () => {
      const run = String(cli()?.run ?? "");
      expect(run).toContain("judge");
      expect(run).toContain("--runner cli");
      expect(run).toContain("--apply");
      expect(run).toContain("--ledger");
    });

    it("makes an entirely non-operational CLI tier fail at the final gate", () => {
      const run = String(cli()?.run ?? "");
      expect(run).toContain('echo "operational=false" >> "$GITHUB_OUTPUT"');
      expect(run).toContain('echo "operational=true" >> "$GITHUB_OUTPUT"');
      const finalGate = ACTION.runs.steps.find((step) => step.name === "Gate")!;
      expect(finalGate.if).toContain("steps.clirunner.outputs.operational == 'false'");
      expect(finalGate.run).toContain("every attempted Claude CLI adjudication pass failed operationally");
    });

    it("does not start another paid pass after systemic provider saturation", () => {
      const run = String(cli()?.run ?? "");
      expect(run).toContain("ultra11y-provider-unavailable");
      expect(run).toMatch(/grep[^\n]+provider unavailable/);
      expect(run).toMatch(/provider unavailable[^\n]+stopping before pass/);
      expect(run).toContain("break");
    });

    // `--max-turns` is not a flag of the Claude Code CLI, and the CLI swallows unknown flags
    // without a word — so passing one would read as a ceiling in every log and be an
    // unbounded run. The bound that exists is the dollar one.
    it("bounds the spend in dollars, never in turns it cannot enforce", () => {
      expect(String(cli()?.run ?? "")).not.toContain("--max-turns");
      expect(String(cli()?.run ?? "")).toContain("--max-budget-usd");
      expect(ACTION.inputs["adjudicate-budget-usd"]).toBeDefined();
    });

    it("can bound a smoke run by criterion count without weakening the fold", () => {
      const run = String(cli()?.run ?? "");
      expect(cli()?.env?.MAX_ITEMS).toBe("${{ inputs.adjudicate-max }}");
      expect(run).toContain('args+=(--max "$MAX_ITEMS")');
      expect(run).toContain("must be a positive integer");
    });

    // The list exists only because claude-code-action refuses events it does not parse. A
    // local process has no such notion, so this runner is the one that works on `push`.
    it("carries no event allowlist, which is the point of it", () => {
      expect(cli()?.if).not.toContain("github.event_name");
    });

    // A composite action cannot loop over a `uses:` step, so the combination is impossible and
    // has to say so rather than ignore the grain the caller asked for.
    it("refuses grain=criterion on the action runner, in the step allowed to refuse", () => {
      const preflight = ACTION.runs.steps.find((s) => s.id === "engine");
      expect(preflight?.run).toContain("adjudicate-runner=");
      expect(preflight?.run).toContain("adjudicate-grain=");
      expect(preflight?.run).toMatch(/adjudicate-grain='criterion' needs adjudicate-runner='cli'/);
      expect(preflight?.run).toContain("exit 1");
    });
  });

  it("pins claude-code-action, because `uses:` cannot take an expression", () => {
    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agent?.uses).toMatch(/^anthropics\/claude-code-action@v\d+$/);
    expect(agent?.uses).not.toContain("${{");
  });

  // The prompt has to match the TOOLSET the same step grants, and it did not. It sent the agent
  // to the emitted RUNBOOK, which tells the reader to edit `ADJUDICATE.todo.json` in place and
  // then run `node …/ultra11y.mjs verify --apply`. On a real run that is 540 KB of JSON to edit
  // with no shell to script it: 17 permission denials, the file untouched, and the fail-closed
  // fold correctly discarding all 96 verdicts. So the CI contract is now its own.
  it("points the agent at the small files, and at nothing it cannot do", () => {
    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    const prompt = agent?.with?.prompt ?? "";
    // The one file it writes, and the per-criterion briefs it reads.
    expect(prompt).toContain("ADJUDICATE.verdicts.json");
    expect(prompt).toContain("audits/adjudicate/");
    // The dispatch contract still governs the verdicts themselves.
    expect(prompt).toContain("adjudicator.md");
    // It must resolve the conflict in ITS OWN favour, since it has no shell and this workflow
    // folds for it. A prompt that merely omits the commands leaves the contract file free to
    // reintroduce them — the agent reads that file too, and is told to.
    expect(prompt).toMatch(/no shell/i);
    expect(prompt).toMatch(/this prompt wins/i);
    expect(prompt).toMatch(/never run the engine/i);
    expect(prompt).toMatch(/do not commit/i);
  });

  // THE SYMMETRY THE PROMPT DID NOT STATE, AND THE FOUR CRITERIA IT COST.
  //
  // The prompt argued at length that an uncited `C` is refused, and said nothing at all about
  // the mirror rule. Measured on run 32385981037 (Haiku, RGAA, 3 passes): 12.1 and 12.5 came
  // back `NC` with no `file` — « there is no second navigation system » is an absence, and
  // nothing told the adjudicator that an absence is still observed on an element of a page.
  it("states the NC contract as loudly as the C one, in every pass", () => {
    const prompts = adjudicationSteps()
      .filter((s) => s.uses?.startsWith("anthropics/claude-code-action@"))
      .map((s) => String(s.with?.prompt ?? ""));
    expect(prompts.length).toBe(3); // pass 1, 2, 3
    for (const [i, prompt] of prompts.entries()) {
      expect(prompt, `pass ${i + 1}: an NC needs a file`).toMatch(/`NC`[\s\S]{0,400}`file`/);
      expect(prompt, `pass ${i + 1}: an absence is still anchored`).toMatch(/absence/i);
      expect(prompt, `pass ${i + 1}: NA is the answer when the subject is absent from scope`).toMatch(/`NA`/);
      expect(prompt, `pass ${i + 1}: needs-rendered-dom is refused over a capture`).toMatch(/\.ultra11y\/pages/);
    }
  });

  // A `normativeRef` under a pack is that pack's numbered test. A WCAG id looks alike, denotes
  // an unrelated test and is rejected by the fold — so the prompt has to name the trap.
  it("warns that a normativeRef is the criterion's own numbered test, not a WCAG id", () => {
    const first = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(String(first?.with?.prompt ?? "")).toMatch(/normativeRef[\s\S]{0,300}WCAG id/i);
  });

  // The agent's allowlist and the file it is asked to fill have to stay consistent: the fold
  // reads the verdicts file, so that is the file the prompt must name.
  it("folds the same file the agent was told to write", () => {
    const fold = adjudicationSteps().find((s) => typeof s.run === "string" && s.run.includes("verify --apply"));
    expect(fold?.run).toContain("audits/ADJUDICATE.verdicts.json");
  });

  // The two modes do not take the same credential, and conflating them produces the worst
  // kind of failure: a tier that reports itself on and then rules on nothing.
  it("lets `agent` run on a subscription token, and keeps `api` on the API key", () => {
    const resolve = ACTION.runs.steps.find((s) => s.id === "adjudication");
    // `api` speaks x-api-key to api.anthropic.com; an OAuth token is not a substitute, and
    // the warning has to SAY so rather than look like a missing secret.
    expect(resolve?.run).toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(resolve?.run).toMatch(/adjudicate=api needs ANTHROPIC_API_KEY/);
    // …while `agent` shells out to claude-code-action, which accepts either.
    expect(resolve?.run).toMatch(/adjudicate=agent but neither ANTHROPIC_API_KEY nor CLAUDE_CODE_OAUTH_TOKEN/);

    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agent?.with?.anthropic_api_key).toContain("ANTHROPIC_API_KEY");
    expect(agent?.with?.claude_code_oauth_token).toContain("CLAUDE_CODE_OAUTH_TOKEN");
  });

  // claude-code-action parses the event context before it reads the prompt and throws on
  // anything outside its list. The default CLI runner is a local process and must bypass
  // that GitHub-only restriction — `push` is the event an accessibility gate needs.
  it("applies the event allowlist only to the historical action runner", () => {
    const resolve = ACTION.runs.steps.find((s) => s.id === "adjudication");
    expect(resolve?.env?.RUNNER).toContain("inputs.adjudicate-runner");
    expect(resolve?.run).toContain("if [ \"$RUNNER\" = 'cli' ]");
    expect(resolve?.run).toContain("github.event_name");
    for (const supported of ["pull_request", "workflow_dispatch", "schedule", "workflow_run", "repository_dispatch"]) {
      expect(resolve?.run, `event ${supported} is not accepted`).toContain(supported);
    }
    // Degrades exactly like a missing credential — a warning and `on=false`, never an exit 1.
    expect(resolve?.run).toContain("::warning::");
    expect(resolve?.run).not.toMatch(/exit 1/);
  });

  // Without a token the action mints its own over OIDC, which needs `id-token: write` in the
  // CALLER's workflow. This step never touches the GitHub API, so requiring that of every
  // consumer would be a permission asked for and never used.
  it("hands the agent the job's own GitHub token, so no consumer needs id-token: write", () => {
    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agent?.with?.github_token).toContain("github.token");
  });

  // Nobody is watching this run. claude-code-action sets no default turn limit.
  it("bounds the unattended agent run", () => {
    // claude-code-action sets no default and nobody is watching this step. The flag now lives
    // in the string the worklist step assembles, because `--model` beside it is optional.
    const worklist = adjudicationSteps().find((s) => s.id === "worklist");
    expect(worklist?.run).toContain("--max-turns $turns");
    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agent?.with?.claude_args).toContain("steps.worklist.outputs.args");
  });

  // A fixed cap is a cliff, not a bound: the runbook is sequential and each criterion costs
  // real tool calls, so under RGAA (~80 items) a small budget truncates — and a truncated
  // adjudication is not a partial one, it is a discarded one (the fold fail-closes on the
  // first null verdict). The budget therefore has to follow the worklist.
  it("derives the turn budget from the worklist instead of hardcoding it", () => {
    const worklist = adjudicationSteps().find((s) => s.id === "worklist");
    expect(worklist?.run, "the worklist step must count the items").toContain("--json");
    expect(worklist?.run).toContain("turns=");
    expect(worklist?.run).toContain("turns=");
    const agent = adjudicationSteps().find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));
    expect(agent?.with?.claude_args).toContain("steps.worklist.outputs.args");
    // …and stay overridable, because a derived default is still a guess.
    expect(ACTION.inputs["adjudicate-max-turns"]).toBeTruthy();
    expect(ACTION.inputs["adjudicate-max-turns"]?.default).toBe("");
    expect(ACTION.inputs["adjudicate-max"]).toBeTruthy();
    expect(ACTION.inputs["adjudicate-max"]?.default).toBe("");
  });

  // An input arrives from a caller's workflow, which is free to wire an event payload into
  // it — `repository_dispatch` is on the very list the tier checks. Expanded into a
  // single-quoted bash string, a quote in the value escapes into the shell.
  it("reads caller-controlled inputs from the environment, not by interpolation", () => {
    // Assembled rather than written out: a literal `${{ … }}` in a JS string reads as a
    // template placeholder to the linter, and escaping it here would hide what is asserted.
    const expr = (name: string): string => `$\{{ inputs.${name} }}`;

    const resolve = ACTION.runs.steps.find((s) => s.id === "adjudication");
    expect(resolve?.env?.MODE).toContain("inputs.adjudicate");
    expect(resolve?.run, "the mode must not be interpolated into the script").not.toContain(expr("adjudicate"));

    const scan = ACTION.runs.steps.find((s) => s.name === "Scan the pages");
    expect(scan?.env?.RUNTIME).toContain("inputs.runtime");
    expect(scan?.env?.STORAGE_STATE).toContain("inputs.storage-state");
    expect(scan?.run).not.toContain(expr("storage-state"));
    expect(scan?.run).not.toContain(expr("runtime"));
  });

  // A typo used to reach the agent branch, report the tier on, then match no downstream step:
  // a tier that announced itself and did nothing.
  it("refuses a mode it does not know instead of half-enabling itself", () => {
    const resolve = ACTION.runs.steps.find((s) => s.id === "adjudication");
    expect(resolve?.run).toMatch(/is not a mode/);
  });
});

// The pages worth auditing usually sit behind a login, and a scan that silently lands on the
// sign-in screen reports that screen's accessibility under another page's name.
describe("the authenticated scan", () => {
  const scan = () => ACTION.runs.steps.find((s) => s.name === "Scan the pages");

  it("forwards a storage state to the scan", () => {
    expect(ACTION.inputs["storage-state"]).toBeTruthy();
    expect(ACTION.inputs["storage-state"]?.default).toBe("");
    expect(scan()?.run).toContain("--storage-state");
  });

  it("keeps the click probe off by default on a signed-in scan, and opt-in-able", () => {
    expect(ACTION.inputs["interact-clicks"]?.default).toBe("false");
    expect(scan()?.run).toContain("--interact-clicks");
  });

  // An authenticated scan is local-tier only. On `auto` a missing @axe-core/playwright
  // degrades to Docker, which then refuses the run — and without this input the caller has
  // no way to say "the local tier is the point".
  it("lets the caller pin the browser tier, since an authenticated scan needs the local one", () => {
    expect(ACTION.inputs.runtime?.default).toBe("auto");
    expect(scan()?.run).toContain("--runtime");
    // `auto` is the engine's own default; passing it back would be noise.
    expect(scan()?.run).toContain(`"$RUNTIME" != 'auto'`);
  });

  // A session file is a credential. It is handed to Playwright as a path and never read.
  it("says out loud that the storage state is a path, not a value to read", () => {
    expect(ACTION.inputs["storage-state"]?.description).toMatch(/never read/i);
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

  // `Markdown report` writes `audits/<std>-<date>.md` and runs `check` on it; `HTML report`
  // invokes `report` again into the same `--out`, which REWRITES that same file. So the two
  // invocations must agree about evidence — otherwise the document the integrity gate
  // validated is not the document that ships, and the difference is exactly the illustrations.
  it("gives both `report` invocations the same evidence flags", () => {
    const writers = ACTION.runs.steps.filter((s) => s.run?.includes("report --in audits/audit-latest.json") && !s.run.includes("--format"));
    expect(writers.map((s) => s.name)).toEqual(["Markdown report", "HTML report"]);
    for (const s of writers) {
      expect(s.run, `step "${s.name}" ignores inputs.evidence`).toContain("inputs.evidence }}");
      expect(s.run, `step "${s.name}" ignores inputs.evidence-max`).toContain("inputs.evidence-max }}");
    }
  });

  // The composite is one self-contained file, so every crop it shows travels inside it as
  // base64. A team whose artifact blows past the 12 MB default hits that in CI and nowhere
  // else — which is precisely where the knob was missing.
  it("lets a team set the composite's inline budget from CI, where the problem actually shows up", () => {
    expect(ACTION.inputs["inline-budget"]).toBeDefined();
    expect(html().run).toContain("inputs.inline-budget }}");
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

describe("the RGAA report artifact", () => {
  it("carries the exhaustive test-level automation matrix beside static and integral reports", () => {
    const step = ACTION.runs.steps.find((candidate) => candidate.name?.includes("RGAA automation matrix"));
    expect(step).toBeDefined();
    expect(step?.if).toContain("inputs.report == 'true'");
    expect(step?.if).toContain("inputs.html == 'true'");
    expect(step?.if).toContain("inputs.standard == 'rgaa'");
    expect(step?.run).toContain("audits/rgaa-automation.md");
  });
});

describe("the action is EXECUTED by CI, not only parsed", () => {
  // Everything above reads action.yml. But a composite action is bash — arrays, `set -e`,
  // quoting — and none of that is provable by reading YAML. The `action` job uses the real
  // thing end to end; without it, this whole file could stay green while the action was
  // broken for every consumer — which is what happened the day `npm i --omit=dev` silently
  // installed nothing.
  //
  // That job is now HAND-DISPATCHED: it is the heaviest in the file and the owner did not
  // want it on every push. The assertions below still hold the job's shape, and the last one
  // pins the gate itself — so the day someone widens or narrows it, they do it on purpose.
  const CI = parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as {
    on?: Record<string, unknown>;
    jobs: Record<string, { if?: string; steps: { name?: string; uses?: string; run?: string; with?: Record<string, string> }[] }>;
  };

  const actionJob = (): { steps: { name?: string; uses?: string; run?: string; with?: Record<string, string> }[] } => {
    const job = CI.jobs.action;
    if (!job) throw new Error("ci.yml has no `action` job — the shipped action would be parsed but never executed");
    return job;
  };

  it("runs only when somebody asks, and the workflow still offers that button", () => {
    expect(CI.jobs.action?.if, "the `action` job's trigger changed").toBe("github.event_name == 'workflow_dispatch'");
    // A dispatch-only job in a workflow with no dispatch trigger is a job that can never run.
    expect(Object.keys(CI.on ?? {}), "ci.yml has no workflow_dispatch to run it from").toContain("workflow_dispatch");
  });

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

// The action hardcodes claude-code-action's supported events while `uses:` floats on `@v1`.
// The list can only drift one way that matters: upstream ADDS an event (`push` is the one the
// comment calls out), and this action keeps skipping the tier on it — silently, since skipping
// is the designed degradation. Nothing would fail; the tier would just stop being offered.
// This test is the reminder, and it fetches nothing: it asserts the pin and the list are
// stated together, so a bump of one is a diff that shows the other.
describe("the event allowlist is pinned to a claude-code-action version", () => {
  const resolve = () => ACTION.runs.steps.find((s) => s.id === "adjudication");
  const agent = () => ACTION.runs.steps.find((s) => s.uses?.startsWith("anthropics/claude-code-action@"));

  it("names the version the list was copied from, next to the list", () => {
    const run = resolve()?.run ?? "";
    const pin = agent()?.uses?.split("@")[1] ?? "";
    expect(pin).toMatch(/^v\d+$/);
    expect(run, `the allowlist must name the claude-code-action version it mirrors (${pin})`).toContain(`claude-code-action@${pin}`);
  });

  it("still mirrors the ten events that version accepts", () => {
    const run = resolve()?.run ?? "";
    for (const e of [
      "pull_request",
      "pull_request_target",
      "pull_request_review",
      "pull_request_review_comment",
      "issues",
      "issue_comment",
      "workflow_dispatch",
      "repository_dispatch",
      "schedule",
      "workflow_run",
    ]) {
      expect(run, `event ${e} missing from the allowlist`).toContain(e);
    }
    // `push` is the one upstream might add. If it ever appears here, the comment above and
    // the workflow guidance in references/ci.md have to move with it.
    expect(run).not.toMatch(/\|push\)|\(push\|/);
  });
});

// A run whose artifact is merged away downstream must not send its reader to a dead link.
describe("the comment names the deliverable that survives the run", () => {
  it("offers an input for it, distinct from the one it uploads under", () => {
    // `artifact-name` must stay unique within a workflow run (GitHub 409s otherwise), so a
    // repository that merges several parts into one deliverable CANNOT simply name them all
    // the same. Measured on SocialGouv/egapro#4169: both sticky comments pointed at
    // `ultra11y-part-code` / `ultra11y-part-pages`, which the merge job had just deleted.
    expect(ACTION.inputs["report-artifact"]).toBeDefined();
    expect(ACTION.inputs["report-artifact"]?.default).toBe("");
  });

  it("prefers it over the uploaded name, and falls back to the historical default", () => {
    const step = ACTION.runs.steps.find((st) => st.name?.includes("PR comment"))!;
    const expr = String(step.env?.ULTRA11Y_ARTIFACT_NAME);
    // The precedence, read off the expression itself: report-artifact, then artifact-name,
    // then `ultra11y-<standard>`. Asserted here because it is a contract a consumer's
    // workflow depends on and it lives in YAML no type checker reads.
    expect(expr.indexOf("inputs.report-artifact")).toBeLessThan(expr.indexOf("inputs.artifact-name"));
    expect(expr).toContain("format('ultra11y-{0}', inputs.standard)");
  });

  it("still uploads under artifact-name — the link text moves, the upload does not", () => {
    const upload = ACTION.runs.steps.find((st) => st.id === "upload")!;
    expect(String(upload.with?.name)).toContain("inputs.artifact-name");
    expect(String(upload.with?.name)).not.toContain("report-artifact");
  });
});

// ONE PASS WAS NEVER ENOUGH, and not because of the criteria.
//
// The adjudicator can stop early. Measured on a real run: `num_turns: 22` against a budget of
// 228, `is_error: false`, and 42 criteria still `verdict: null` — a whole worklist abandoned
// with no error to show for it. A single pass has no way to come back to them, so a green job
// published a grid nobody had filled.
describe("the agent tier can go round again on what is still undecided", () => {
  const passStep = (n: number, kind: string) => ACTION.runs.steps.find((s) => s.name?.includes(`pass ${n}, ${kind}`))!;

  it("offers the number of passes as an input, defaulting to the historical single pass", () => {
    expect(ACTION.inputs["adjudicate-passes"]).toBeDefined();
    expect(ACTION.inputs["adjudicate-passes"]?.default).toBe("1");
  });

  it("re-derives the worklist each time, so a pass only ever costs the residue", () => {
    // `verify --manual` rebuilds from the audit, which by construction holds only what is
    // still `manual` — never reached, or refused by the gate and returned carrying its refusal.
    for (const n of [2, 3]) expect(String(passStep(n, "worklist").run)).toContain("verify --manual");
  });

  it("skips a later pass entirely when nothing is left", () => {
    // The stop condition, checked BEFORE any model is invoked: a run that decided everything
    // must not pay an adjudicator to discover it.
    expect(String(passStep(2, "worklist").if)).toContain("steps.worklist.outputs.remaining != '0'");
    expect(String(passStep(2, "Claude Code").if)).toContain("steps.worklist2.outputs.remaining != '0'");
    expect(String(passStep(3, "Claude Code").if)).toContain("steps.worklist3.outputs.remaining != '0'");
  });

  it("honours the cap AND the floor: each pass names the counts it runs for", () => {
    // Written as `!= '1'` and `!= '1' && != '2'`, the cap held but there was no floor:
    // `adjudicate-passes: 0` — or an empty string, or a typo — matched neither exclusion and
    // ran all three passes, billing a model for the most expensive branch on the input that
    // asks for the least. Stated positively, the gate can only fire on a count that exists,
    // and the preflight in `Resolve the engine` refuses the rest before any of this runs.
    expect(String(passStep(2, "worklist").if)).toContain("(inputs.adjudicate-passes == '2' || inputs.adjudicate-passes == '3')");
    expect(String(passStep(3, "worklist").if)).toContain("inputs.adjudicate-passes == '3'");
  });

  it("folds after every pass, through the same gate as the first", () => {
    for (const n of [2, 3]) {
      const fold = String(passStep(n, "fold").run);
      expect(fold).toContain("--apply audits/ADJUDICATE.verdicts.json");
      expect(fold).toContain("--ledger");
    }
  });

  it("never fails the job on a pass that landed nothing", () => {
    // Same degradation policy as the first fold: an adjudication that decides nothing is a
    // grid that stays « to assess », not a build that breaks.
    for (const n of [2, 3]) expect(String(passStep(n, "fold").run)).toContain("::warning::");
  });
});

// This is the paid end-to-end path CI cannot run on every push. Keep one runner and one
// acquisition pass: a comparison matrix doubles both the browser work and the model bill.
describe("the keyed adjudication workflow is singular, exhaustive and bounded", () => {
  const raw = readFileSync(join(ROOT, ".github/workflows/adjudication.yml"), "utf8");
  const WF = parse(raw) as {
    on?: { workflow_dispatch?: unknown };
    concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    jobs: Record<
      string,
      {
        "timeout-minutes"?: number | string;
        env?: Record<string, string>;
        steps: { id?: string; name?: string; uses?: string; run?: string; if?: string; with?: Record<string, string>; env?: Record<string, string> }[];
      }
    >;
  };
  const job = (): NonNullable<(typeof WF.jobs)[string]> => {
    const j = WF.jobs.adjudicate;
    if (!j) throw new Error("adjudication.yml has no `adjudicate` job");
    return j;
  };

  it("exposes one dispatch and removes the paid runner comparison", () => {
    expect(WF.on?.workflow_dispatch).toBeDefined();
    expect(existsSync(join(ROOT, ".github/workflows/adjudication-compare.yml"))).toBe(false);
    expect(job().steps.filter((step) => step.uses === "./")).toHaveLength(1);
    expect(raw).not.toMatch(/matrix:|adjudication-runner.*action|Adjudicate with the API/);
  });

  it("serialises paid dispatches instead of cancelling or racing them", () => {
    expect(WF.concurrency?.group).toBe("adjudication-keyed");
    expect(WF.concurrency?.["cancel-in-progress"]).toBe(false);
    expect(job()["timeout-minutes"]).toBe(60);
  });

  it("uses only the subscription credential", () => {
    const env = job().env ?? {};
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toContain("secrets.CLAUDE_CODE_OAUTH_TOKEN");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("pins Node, like every other workflow that runs the engine", () => {
    expect(job().steps.some((s) => s.uses?.startsWith("actions/setup-node@"))).toBe(true);
  });

  it("runs the full fixture once with the bounded batched Haiku CLI", () => {
    const agent = job().steps.find((step) => step.name === "Audit, crawl and adjudicate once");
    expect(agent?.with?.adjudicate).toBe("agent");
    expect(agent?.with?.["adjudicate-runner"]).toBe("cli");
    expect(agent?.with?.["adjudicate-grain"]).toBe("worklist");
    expect(agent?.with?.["adjudicate-model"]).toBe("haiku");
    expect(agent?.with?.["adjudicate-effort"]).toBe("low");
    expect(agent?.with?.["adjudicate-budget-usd"]).toBe("0.35");
    expect(agent?.with?.["adjudicate-passes"]).toBe("3");
    expect(agent?.with?.ledger).toBe("audits/fresh-rgaa-ledger.json");
    expect(agent?.with?.crawl).toBe("http://127.0.0.1:8932/");
    expect(agent?.with?.["crawl-max"]).toBe("0");
    expect(agent?.with?.["require-rendered"]).toBe("true");
    // NOT `pages`, and the value is pinned because it is a POLICY, not an oversight: this lane
    // must not go red because the model answered « I do not know ». Several RGAA criteria ask
    // whether information is carried by colour alone, or whether every button label is relevant
    // in context — measured on a real 37-page repository, four of them were declined after
    // everything else was ruled, and declining was the correct answer. What still fails here is
    // named in the workflow: a dead transport, an unrendered rendering criterion, the 9 × 106
    // shape below.
    expect(agent?.with?.["require-decided"]).toBe("false");
    expect(agent?.with?.["undecidable-file"]).toBe(".ultra11y/undecidable-rgaa.json");
    expect(agent?.with?.["pages-report"]).toBe("compact");
    expect(agent?.with?.report).toBe("false");
    expect(agent?.with?.html).toBe("false");
    expect(agent?.with?.evidence).toBe("false");
    expect(agent?.with?.["artifact-name"]).toBe("adjudication-rgaa-haiku");
  });

  it("does not buy a second model fold after the exhaustive adjudication", () => {
    const workflow = job()
      .steps.map((step) => `${step.name ?? ""}\n${String(step.run ?? "")}`)
      .join("\n");
    expect(workflow).not.toContain("Put every model claim on trial");
    expect(workflow).not.toContain("judge --refute");
    expect(workflow).not.toContain("--max-verify 0");
  });

  it("gates all criteria inside the Action, then verifies the 9 × 106 output shape", () => {
    const steps = job().steps;
    const adjudication = steps.findIndex((s) => s.name === "Audit, crawl and adjudicate once");
    const after = steps.findIndex((s) => s.name === "Verify the nine-page shape");
    expect(adjudication).toBeGreaterThanOrEqual(0);
    expect(after).toBeGreaterThan(adjudication);

    const agent = steps[adjudication];
    // The completeness gate is off (see above) — the shape assertion below is what this lane
    // holds instead, and it is deterministic: nine pages, 106 criteria each, whatever any model
    // decided about them.
    expect(agent?.with?.["require-decided"]).toBe("false");
    expect(agent?.with?.["require-rendered"]).toBe("true");
    expect(agent?.with?.["undecidable-file"]).toBe(".ultra11y/undecidable-rgaa.json");
    const completeness = ACTION.runs.steps.find((step) => step.name === "Completeness gate");
    expect(completeness?.run).toContain("--allow-stale-undecided");

    const shape = String(steps[after]?.run);
    expect(shape).not.toContain("--require-decided");
    expect(shape).toContain("grid.pages.length !== 9");
    expect(shape).toContain("page.criteria.length !== 106");
  });

  it("delegates the single compact artifact to the Action and does not render a fix report", () => {
    expect(job().steps.find((s) => s.name === "Render the final report")).toBeUndefined();
    expect(job().steps.find((s) => s.name === "Upload the final adjudication")).toBeUndefined();
    const agent = job().steps.find((step) => step.name === "Audit, crawl and adjudicate once");
    expect(agent?.with?.["pages-report"]).toBe("compact");
    expect(agent?.with?.["artifact-retention-days"]).toBe("14");
  });
});

describe("the pull-request RGAA lane is deterministic and rendered", () => {
  const workflow = parse(readFileSync(join(ROOT, ".github/workflows/static-rgaa.yml"), "utf8")) as {
    on?: { pull_request?: unknown; workflow_dispatch?: unknown };
    permissions?: Record<string, string>;
    jobs?: Record<
      string,
      {
        steps?: Array<{ uses?: string; with?: Record<string, string> }>;
      }
    >;
  };
  const steps = workflow.jobs?.["static-rgaa"]?.steps ?? [];
  const audit = steps.find((step) => step.uses === "./");

  it("runs on pull requests and can also be dispatched as a real smoke test", () => {
    expect(workflow.on?.pull_request).toBeDefined();
    expect(workflow.on?.workflow_dispatch).toBeDefined();
  });

  it("runs source and browser tiers without wiring any model", () => {
    expect(audit?.with?.standard).toBe("rgaa");
    expect(audit?.with?.adjudicate).toBe("none");
    expect(audit?.with?.["require-rendered"]).toBe("true");
    expect(audit?.with?.runtime).toBe("local");
    expect(audit?.with?.browser).toBe("install");
    expect(audit?.with?.urls).toMatch(/^http:\/\/127\.0\.0\.1:/);
    expect(audit?.with?.start).toBeTruthy();
    expect(audit?.with?.["wait-on"]).toBe(audit?.with?.urls);
    expect(JSON.stringify(workflow)).not.toMatch(/ANTHROPIC|CLAUDE_CODE/);
  });

  it("keeps the PR concise and the artifact exhaustive", () => {
    expect(workflow.permissions?.["pull-requests"]).toBe("write");
    expect(audit?.with?.comment).toContain("github.event_name == 'pull_request'");
    expect(audit?.with?.["comment-kind"]).toBe("digest");
    expect(audit?.with?.report).toBe("true");
    expect(audit?.with?.html).toBe("true");
    expect(audit?.with?.["pages-report"]).toBe("true");
    expect(audit?.with?.["artifact-name"]).toBe("ultra11y-pr-static-rgaa");
  });
});
