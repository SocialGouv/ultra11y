import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, matchGitIntent, resolveBase, resolveThreshold, scopeFor, type GitIntent } from "../src/hook.js";
import type { AuditResult, Finding, Severity } from "../src/types.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const guard = join(repoRoot, "hooks", "pre-tool-use.mjs");

const tmps: string[] = [];
function tmpRepo(): string {
  const d = mkdtempSync(join(tmpdir(), "u11y-hook-"));
  tmps.push(d);
  execFileSync("git", ["init", "-q", "."], { cwd: d });
  execFileSync("git", ["config", "user.email", "t@t.t"], { cwd: d });
  execFileSync("git", ["config", "user.name", "t"], { cwd: d });
  return d;
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("matchGitIntent", () => {
  const cases: Array<[string, GitIntent | null]> = [
    // The three publishing acts, in their ordinary shapes.
    ["git commit -m wip", "commit"],
    ["git commit --amend --no-edit", "commit"],
    ["git -C /some/repo commit -m x", "commit"],
    ["git --no-pager commit -m x", "commit"],
    ["git -c user.name=bot commit -m x", "commit"],
    ["git push", "push"],
    ["git push --force-with-lease origin HEAD", "push"],
    ["gh pr create --fill", "pr"],
    ["gh pr create --base develop --title x", "pr"],
    // Chained: the broadest scope wins, so a commit+push reviews the branch, not the index.
    ["npm test && git push", "push"],
    ["git add -A && git commit -m x && git push", "push"],
    ["git commit -m x; gh pr create --fill", "pr"],
    // Not a publishing act.
    ["git status", null],
    ["git log --oneline main", null],
    ["git diff --cached", null],
    ["gh pr list", null],
    ["gh pr view 12", null],
    ["ls -la", null],
    // The command has to be at a command POSITION — a mention inside a string is not one.
    ['echo "git commit"', null],
    ["grep -r 'git push' .", null],
    // Explicit opt-outs are honoured rather than second-guessed.
    ["git commit --no-verify -m x", null],
    ["git push --dry-run", null],
  ];
  for (const [command, expected] of cases) {
    it(`${JSON.stringify(command)} → ${expected ?? "null"}`, () => {
      expect(matchGitIntent(command)).toBe(expected);
    });
  }
});

describe("scopeFor / resolveBase", () => {
  it("scopes a commit to the staged snapshot, with no git call at all", () => {
    expect(scopeFor("commit", "git commit -m x", "/nonexistent")).toEqual({ staged: true });
  });

  it("returns null when no base ref resolves — no base, no review, no noise", () => {
    const d = tmpRepo(); // a fresh repo has no origin
    expect(scopeFor("push", "git push", d)).toBeNull();
    expect(resolveBase("git push", d)).toBeNull();
  });

  it("honours an explicit --base on gh pr create", () => {
    const d = tmpRepo();
    // No `origin/develop` here, so the ref is taken as given rather than invented.
    expect(resolveBase("gh pr create --base develop --fill", d)).toBe("develop");
    expect(scopeFor("pr", "gh pr create --base develop", d)).toEqual({ since: "develop" });
  });

  it("falls back to the default branch when origin/HEAD is set", () => {
    const d = tmpRepo();
    writeFileSync(join(d, "f.txt"), "x");
    execFileSync("git", ["add", "f.txt"], { cwd: d });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: d });
    execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: d });
    execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: d });
    expect(resolveBase("git push", d)).toBe("origin/main");
  });
});

describe("resolveThreshold", () => {
  it("defaults to blocking, matching `init --hook`", () => {
    expect(resolveThreshold(tmpRepo(), {})).toBe("bloquant");
  });
  it("takes the env override, English or French token", () => {
    expect(resolveThreshold(tmpRepo(), { ULTRA11Y_HOOK_FAIL_ON: "minor" })).toBe("mineur");
    expect(resolveThreshold(tmpRepo(), { ULTRA11Y_HOOK_FAIL_ON: "majeur" })).toBe("majeur");
  });
  it('treats "off" as a full disable', () => {
    expect(resolveThreshold(tmpRepo(), { ULTRA11Y_HOOK_FAIL_ON: "off" })).toBeNull();
  });
  it("reads hook.failOn from .ultra11yrc.json when no env override is set", () => {
    const d = tmpRepo();
    writeFileSync(join(d, ".ultra11yrc.json"), JSON.stringify({ hook: { failOn: "major" } }));
    expect(resolveThreshold(d, {})).toBe("majeur");
    // Env still wins over the file.
    expect(resolveThreshold(d, { ULTRA11Y_HOOK_FAIL_ON: "off" })).toBeNull();
  });
  it("survives a broken .ultra11yrc.json instead of throwing into a git flow", () => {
    const d = tmpRepo();
    writeFileSync(join(d, ".ultra11yrc.json"), "{ not json");
    expect(resolveThreshold(d, {})).toBe("bloquant");
  });
});

// --- decide -------------------------------------------------------------------------
// The audit is injected so these cases exercise the DECISION, not the engine.

function finding(over: Partial<Finding> = {}): Finding {
  return {
    ruleId: "img-alt",
    criteriaId: "1.1.1",
    file: "src/A.tsx",
    line: 4,
    col: 1,
    selectorHint: "img",
    severity: "bloquant" as Severity,
    message: "<img> has no alt attribute",
    remediation: "Add an alt attribute.",
    snippet: "<img src=x>",
    ...over,
  } as Finding;
}

const auditWith = (findings: Finding[]) => () => ({ findings, conformancePct: 0 }) as unknown as AuditResult;
// The anti-loop marker lives in the OS temp dir and OUTLIVES the run, so a fixed session id
// would make the end-to-end cases pass once and fail on every rerun. Keying the session on
// the (fresh) repo path keeps runs independent while staying stable within one test.
const payload = (command: string, cwd: string) => ({ tool_name: "Bash", tool_input: { command }, cwd, session_id: cwd });

describe("decide", () => {
  it("denies a commit carrying a blocking finding, and names the skill and the scope", () => {
    const d = tmpRepo();
    const out = decide(payload("git commit -m x", d), { env: {}, audit: auditWith([finding()]), seen: () => true });
    expect(out?.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(out?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out?.hookSpecificOutput.permissionDecisionReason).toContain("1 accessibility finding");
    expect(out?.hookSpecificOutput.additionalContext).toContain("review-a11y");
    expect(out?.hookSpecificOutput.additionalContext).toContain("--staged --graph");
    expect(out?.hookSpecificOutput.additionalContext).toContain("src/A.tsx:4");
  });

  it("stays silent when the audit is clean", () => {
    const d = tmpRepo();
    expect(decide(payload("git commit -m x", d), { env: {}, audit: auditWith([]), seen: () => true })).toBeNull();
  });

  it("stays silent when every finding is below the threshold", () => {
    const d = tmpRepo();
    const minor = [finding({ severity: "mineur" as Severity })];
    expect(decide(payload("git commit -m x", d), { env: {}, audit: auditWith(minor), seen: () => true })).toBeNull();
    // …and speaks once the threshold is lowered to meet them.
    expect(decide(payload("git commit -m x", d), { env: { ULTRA11Y_HOOK_FAIL_ON: "minor" }, audit: auditWith(minor), seen: () => true })).not.toBeNull();
  });

  it("does not fire twice for the same findings — a retry must be able to land", () => {
    const d = tmpRepo();
    const deps = { env: {}, audit: auditWith([finding()]), seen: () => false };
    expect(decide(payload("git commit -m x", d), deps)).toBeNull();
  });

  const silent: Array<[string, ReturnType<typeof payload>, NodeJS.ProcessEnv]> = [
    ["a non-Bash tool", { ...payload("git commit -m x", "."), tool_name: "Read" }, {}],
    ["SKIP_A11Y=1", payload("git commit -m x", "."), { SKIP_A11Y: "1" }],
    ["ULTRA11Y_HOOK=off", payload("git commit -m x", "."), { ULTRA11Y_HOOK: "off" }],
    ["ULTRA11Y_HOOK_FAIL_ON=off", payload("git commit -m x", "."), { ULTRA11Y_HOOK_FAIL_ON: "off" }],
    ["--no-verify", payload("git commit --no-verify -m x", "."), {}],
    ["a command that publishes nothing", payload("git status", "."), {}],
  ];
  for (const [label, p, env] of silent) {
    it(`stays silent: ${label}`, () => {
      const d = tmpRepo();
      expect(decide({ ...p, cwd: d }, { env, audit: auditWith([finding()]), seen: () => true })).toBeNull();
    });
  }

  it("stays silent outside a git repository", () => {
    const d = mkdtempSync(join(tmpdir(), "u11y-nogit-"));
    tmps.push(d);
    expect(decide(payload("git commit -m x", d), { env: {}, audit: auditWith([finding()]), seen: () => true })).toBeNull();
  });

  it("stays silent when the engine fails rather than breaking the git flow", () => {
    const d = tmpRepo();
    expect(decide(payload("git commit -m x", d), { env: {}, audit: () => null, seen: () => true })).toBeNull();
  });
});

// --- the guard ----------------------------------------------------------------------
// hooks/pre-tool-use.mjs is never imported by the bundle (it is the plugin's entry
// point), so spawning it is the only way to cover it.

describe("hooks/pre-tool-use.mjs", () => {
  const run = (input: string, env: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, [guard], { input, encoding: "utf8", env: { ...process.env, ...env } });

  it("says nothing and exits 0 on a command that publishes nothing", () => {
    const r = run(JSON.stringify(payload("ls -la", repoRoot)));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("says nothing and exits 0 on an unreadable payload", () => {
    const r = run("not json at all");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("says nothing and exits 0 for a tool other than Bash", () => {
    const r = run(JSON.stringify({ ...payload("git push", repoRoot), tool_name: "Read" }));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("denies a staged blocking finding, end to end through the real engine", () => {
    const d = tmpRepo();
    writeFileSync(join(d, "page.html"), '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="a.png"></body></html>\n');
    execFileSync("git", ["add", "page.html"], { cwd: d });
    const r = run(JSON.stringify(payload("git commit -m wip", d)));
    expect(r.status).toBe(0);
    const decision = JSON.parse(r.stdout);
    expect(decision.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(decision.hookSpecificOutput.additionalContext).toContain("review-a11y");
    // Same session, same findings: the retry has to go through or the commit is trapped.
    expect(run(JSON.stringify(payload("git commit -m wip", d))).stdout.trim()).toBe("");
  });

  it("honours SKIP_A11Y=1", () => {
    const d = tmpRepo();
    writeFileSync(join(d, "page.html"), '<!doctype html><html lang="en"><head><title>t</title></head><body><img src="a.png"></body></html>\n');
    execFileSync("git", ["add", "page.html"], { cwd: d });
    const r = run(JSON.stringify(payload("git commit -m wip", d)), { SKIP_A11Y: "1" });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});
