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
          jobs: Record<string, { permissions?: unknown; "timeout-minutes"?: number }>;
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

  // GitHub's default ceiling is six hours. Measured on this repository: an install step wedged
  // on a network flake ran for 3h27 before anyone looked, and read in the run list exactly
  // like a code failure. `ee6625e` said "every job now carries a timeout-minutes"; five did
  // not, including the one that pushes to main and publishes to npm.
  it.each(workflows)("%s gives every job a timeout", (_name, wf) => {
    const naked = Object.entries(wf.jobs ?? {})
      .filter(([, j]) => typeof j["timeout-minutes"] !== "number")
      .map(([id]) => id);
    expect(naked, "these jobs run against GitHub's six-hour default").toEqual([]);
  });
});
