// The engine writes its worklists RELATIVE TO THE CURRENT DIRECTORY. Run it from the
// repository root — to dogfood, to reproduce a bug, to check a criterion — and it leaves its
// output in the tree beside the source. `.gitignore` already anchored the `verify` half
// (`/VERIFY.md`, `/VERIFY.todo.json`) for exactly that reason; the `adjudicate` half had no
// such entry, so a 2026-08-11 run over two criteria left `ADJUDICATE.md`,
// `ADJUDICATE.todo.json`, `ADJUDICATE.verdicts.json` and `adjudicate/{1.1.1,1.2.1}.md`
// behind, and they were committed and carried for months.
//
// They were harmless — nothing reads them, the Action writes and reads `audits/ADJUDICATE.*`,
// a different path entirely — and that is the point: a stale artefact nobody reads is one
// nobody notices either, and the next reader has to work out whether the repository's own
// audit is a fixture, a baseline, or a mistake.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Everything git is tracking at the top level of the repository. */
const trackedAtRoot = (): string[] => execFileSync("git", ["ls-files", "-z", "--", ":(top)*"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);

describe("the repository tracks no artefact one of its own runs left behind", () => {
  // Both worklists, both halves of each: the rendered brief and the machine-readable todo.
  const LEFTOVERS = [/^ADJUDICATE\.(md|todo\.json|verdicts\.json)$/, /^adjudicate\//, /^VERIFY\.(md|todo\.json)$/, /^audits\//, /^\.ultra11y\//];

  it("has none of them in the index", () => {
    const offenders = trackedAtRoot().filter((f) => LEFTOVERS.some((re) => re.test(f)));
    expect(offenders, "a run's output is tracked — delete it and anchor it in .gitignore").toEqual([]);
  });

  // The index being clean today is a state; the ignore rule is what keeps it one. Anchored
  // with a leading slash so it cannot shadow `skills/…/references/verify.md` on a
  // case-insensitive filesystem — the reason the VERIFY entries are written that way.
  it.each([
    "/ADJUDICATE.md",
    "/ADJUDICATE.todo.json",
    "/ADJUDICATE.verdicts.json",
    "/adjudicate/",
    "/VERIFY.md",
    "/VERIFY.todo.json",
  ])("anchors %s in .gitignore", (entry) => {
    const lines = readFileSync(join(ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((l) => l.trim());
    expect(lines).toContain(entry);
  });
});

// Two properties every workflow in this repository has to hold, and neither is visible when
// you read one file at a time.
describe("every workflow states its blast radius and its ceiling", () => {
  const DIR = join(ROOT, ".github/workflows");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const workflows = files.map(
    (f) =>
      [
        f,
        parse(readFileSync(join(DIR, f), "utf8")) as {
          permissions?: unknown;
          on?: { workflow_dispatch?: { inputs?: Record<string, { default?: unknown; type?: string }> } };
          // A number, or a `${{ inputs.x }}` expression — see the ceiling test below.
          jobs: Record<string, { permissions?: unknown; "timeout-minutes"?: number | string }>;
        },
      ] as const,
  );

  it("has workflows to check at all", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // A workflow that declares none inherits the REPOSITORY default, which is a setting in a
  // web UI rather than a fact in the diff — and it is read/write on any repository that never
  // narrowed it. ci.yml was the one that did, for a run that needs nothing but the checkout.
  it.each(workflows)("%s declares permissions, at the workflow or on every job", (_name, wf) => {
    const declared = wf.permissions !== undefined || Object.values(wf.jobs ?? {}).every((j) => j.permissions !== undefined);
    expect(declared).toBe(true);
  });

  // MEASURED, the expensive way: `type: number` was declared on a workflow_dispatch input,
  // every YAML parser accepted it, and GitHub rejected the whole workflow at DISPATCH time —
  // no jobs, no log, a two-second failure. The keyed adjudication was undispatchable for as
  // long as it took to notice.
  //
  // workflow_dispatch takes `string` (the default), `choice`, `boolean` and `environment`,
  // and nothing else — `number` belongs to workflow_call, which is the trap. A number is
  // passed as a string and read with `fromJSON`.
  it.each(workflows)("%s declares only input types workflow_dispatch accepts", (_name, wf) => {
    const DISPATCH_INPUT_TYPES = ["string", "choice", "boolean", "environment"];
    for (const [id, spec] of Object.entries(wf.on?.workflow_dispatch?.inputs ?? {})) {
      if (spec.type === undefined) continue; // omitted means string
      expect(DISPATCH_INPUT_TYPES, `input \`${id}\` declares type \`${spec.type}\``).toContain(spec.type);
    }
  });

  // GitHub's default ceiling is six hours. Measured on this repository: an install step wedged
  // on a network flake ran for 3h27 before anyone looked, and read in the run list exactly
  // like a code failure. `ee6625e` said "every job now carries a timeout-minutes"; five did
  // not, including the one that pushes to main and publishes to npm.
  it.each(workflows)("%s gives every job a timeout", (_name, wf) => {
    // A literal number, or an expression reading a dispatch input that ITSELF defaults to a
    // number. The second form is what lets a hand-dispatched run raise its own ceiling; it is
    // only a real ceiling if the default is one, so the input is followed rather than trusted.
    const positive = (v: unknown): boolean => Number(v) > 0 && Number.isFinite(Number(v));
    const bounded = (v: unknown): boolean => {
      if (typeof v === "number") return v > 0;
      if (typeof v !== "string") return false;
      // `${{ inputs.x }}` or `${{ fromJSON(inputs.x) }}` — the second is what a dispatch
      // input needs, since every one of them arrives as a STRING (see the type test below).
      const m = v.match(/^\$\{\{\s*(?:fromJSON\()?\s*inputs\.([A-Za-z0-9_-]+)\s*\)?\s*\}\}$/);
      if (!m) return false;
      return positive(wf.on?.workflow_dispatch?.inputs?.[m[1]!]?.default);
    };
    const naked = Object.entries(wf.jobs ?? {})
      .filter(([, j]) => !bounded(j["timeout-minutes"]))
      .map(([id]) => id);
    expect(naked, "these jobs run against GitHub's six-hour default").toEqual([]);
  });
});
