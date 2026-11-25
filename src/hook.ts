// The PreToolUse hook — what makes the `review-a11y` skill fire on its own.
//
// No agent harness has a git-aware hook event, so the plugin listens on PreToolUse for the
// shell tool and recognises the commands that PUBLISH work: `git commit`, `git push`,
// `gh pr create`. When the change about to go out carries accessibility findings at or
// above the threshold, the hook denies the command once and hands the agent (Claude Code,
// Codex, or OpenCode through its plugin) the reason plus the findings, which is what gets
// `review-a11y` invoked without the user asking.
//
// TWO RULES GOVERN EVERYTHING BELOW.
//
//  1. NEVER break a git flow. Every unexpected condition — not a repo, no base ref, engine
//     error, unreadable payload — resolves to a silent no-op, never to an error the user
//     has to work around. A hook that blocks a commit for the wrong reason gets uninstalled.
//  2. NEVER loop. A bare `deny` would re-fire on the retry (the review adjudicates findings,
//     it does not necessarily erase them) and the user could never push. The finding-set
//     fingerprint recorded per session breaks that: one review per state of the change.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "./audit.js";
import { findingId, findingsAtOrAbove, parseFailOn } from "./baseline.js";
import { loadConfig } from "./config.js";
import { packRefLabel } from "./standards/document.js";
import { loadPack } from "./standards/registry.js";
import type { AuditResult, Finding, Severity } from "./types.js";

/** The publishing act a Bash command is about to perform. */
export type GitIntent = "commit" | "push" | "pr";

/** The PreToolUse payload the harness writes on the hook's stdin (fields we read).
 *  `command` is a string on Claude Code and an argv ARRAY on Codex — see `commandOf`. */
export interface PreToolUsePayload {
  tool_name?: string;
  tool_input?: { command?: string | string[] };
  cwd?: string;
  session_id?: string;
}

/** `null` = stay out of the way (emit nothing, exit 0). Otherwise the JSON to print. */
export type HookDecision = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "deny";
    permissionDecisionReason: string;
    additionalContext: string;
  };
} | null;

// A command POSITION: start of input, or just after a separator. This is what keeps
// `echo "git commit"` from matching — the substring is there, but not where a command
// starts. Options between the binary and the subcommand are consumed so that
// `git -C /repo commit`, `git --no-pager commit` and `git -c user.name=x commit` all hit.
const AT_CMD = String.raw`(?:^|[\n;|&(]\s*)`;
const OPTS = String.raw`(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*`;

const INTENTS: ReadonlyArray<readonly [GitIntent, RegExp]> = [
  // Ordered by breadth of what the command publishes: a `git commit && git push` chain is
  // reviewed against the base branch (push scope), not just the staged snapshot.
  ["pr", new RegExp(`${AT_CMD}gh${OPTS}\\s+pr\\s+create(?![\\w-])`)],
  ["push", new RegExp(`${AT_CMD}git${OPTS}\\s+push(?![\\w-])`)],
  ["commit", new RegExp(`${AT_CMD}git${OPTS}\\s+commit(?![\\w-])`)],
];

// The user has already said "skip the checks" — honour it rather than second-guess.
// `--no-verify` is git's own bypass and `--dry-run` publishes nothing.
const OPTED_OUT = /(?:^|\s)--(?:no-verify|dry-run)(?![\w-])/;

/** The publishing intent in a shell command, or `null` when there is none. */
export function matchGitIntent(command: string): GitIntent | null {
  if (OPTED_OUT.test(command)) return null;
  for (const [intent, re] of INTENTS) if (re.test(command)) return intent;
  return null;
}

// Every shell-ish tool name across the harnesses this runs on: `Bash` on Claude Code,
// `shell` (and its variants) on Codex. Matched EXACTLY on the lowercased name, never as a
// substring — `BashOutput` and `KillShell` are Claude Code tools that poll a background
// shell, and a substring test would drag the engine into every one of those calls.
const SHELL_TOOLS: ReadonlySet<string> = new Set(["bash", "shell", "exec", "exec_command", "local_shell", "localshell", "run_command"]);

/** True when the tool about to run is the harness's shell. */
export function isShellTool(name: string | undefined): boolean {
  return !!name && SHELL_TOOLS.has(name.toLowerCase());
}

// `sh`, `bash`, `zsh`, `ksh`, `dash` — bare or absolute.
const SHELL_BIN = /(?:^|\/)(?:ba|z|k|da)?sh$/;
// `-c`, and the bundled forms Codex emits: `-lc`, `-ic`.
const DASH_C = /^-[a-z]*c$/;

/** The shell command a tool call is about to run, or `null` when there is none.
 *
 *  Claude Code passes a string. Codex passes an ARGV ARRAY, and the two array shapes must
 *  not be conflated: `["bash","-lc","git commit"]` joined naively yields
 *  `bash -lc git commit`, where `git` no longer sits at a command position, so `AT_CMD`
 *  refuses to match and the gate silently stops firing. For that wrapper form the SCRIPT is
 *  the command and the wrapper is noise. A direct argv (`["git","commit"]`) is the opposite
 *  case: joining is exactly right, because it puts `git` at position 0. */
export function commandOf(toolInput: { command?: string | string[] } | undefined): string | null {
  const raw = toolInput?.command;
  if (typeof raw === "string") return raw || null;
  if (!Array.isArray(raw)) return null;
  const parts = raw.filter((p): p is string => typeof p === "string");
  if (parts.length === 0) return null;
  if (SHELL_BIN.test(parts[0] as string)) {
    const i = parts.findIndex((p, n) => n > 0 && DASH_C.test(p));
    if (i !== -1 && parts[i + 1]) return parts[i + 1] as string;
  }
  return parts.join(" ") || null;
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** The ref a push/PR should be reviewed against: the DEFAULT branch, not the upstream.
 *  Reviewing `@{u}..HEAD` would silently cover nothing on an already-pushed branch — the
 *  case where a PR is most likely imminent. Returns `null` when nothing resolves, which
 *  the caller turns into a no-op. */
export function resolveBase(command: string, cwd: string): string | null {
  const explicit = command.match(/--base[=\s]+(\S+)/)?.[1]?.replace(/^["']|["']$/g, "");
  if (explicit) return explicit.includes("/") ? explicit : git(cwd, ["rev-parse", "--verify", `origin/${explicit}`]) ? `origin/${explicit}` : explicit;
  const head = git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (head) return head;
  for (const ref of ["origin/main", "origin/master"]) if (git(cwd, ["rev-parse", "--verify", ref])) return ref;
  return null;
}

/** The audit scope an intent implies: the staged snapshot for a commit, the whole branch
 *  vs its base for a push/PR. `null` when the base cannot be resolved. */
export function scopeFor(intent: GitIntent, command: string, cwd: string): { staged: true } | { since: string } | null {
  if (intent === "commit") return { staged: true };
  const base = resolveBase(command, cwd);
  return base ? { since: base } : null;
}

/** Severity gate: env wins, then `.ultra11yrc.json`, then the `init --hook` default.
 *  "off" (either source) disables the hook. `null` ⇒ do nothing. */
export function resolveThreshold(cwd: string, env: NodeJS.ProcessEnv): Severity | null {
  const fromEnv = env.ULTRA11Y_HOOK_FAIL_ON;
  if (fromEnv) return fromEnv === "off" ? null : parseFailOn(fromEnv);
  let configured: string | undefined;
  try {
    configured = loadConfig(cwd)?.hook?.failOn;
  } catch {
    /* a broken .ultra11yrc.json is the audit's problem to report, not the hook's */
  }
  if (configured) return configured === "off" ? null : parseFailOn(configured);
  return "bloquant";
}

/** Fingerprint of a finding SET, so the gate fires once per state of the change. Keyed on
 *  finding identity (stable across line drift) rather than on the diff: if the agent's
 *  review changed nothing, the retry sees the same key and is let through; if it fixed
 *  something, the findings are gone and the gate no longer fires at all. */
function loopKey(sessionId: string, intent: GitIntent, findings: Finding[]): string {
  const h = createHash("sha256");
  h.update(`${sessionId} ${intent} `);
  for (const id of findings.map(findingId).sort()) h.update(`${id} `);
  return h.digest("hex").slice(0, 32);
}

/** True the FIRST time this exact state is seen; false afterwards. Under the OS temp dir,
 *  never the project — the marker is session state, not something to commit or gitignore. */
function firstSighting(key: string): boolean {
  try {
    const dir = join(tmpdir(), "ultra11y-hook");
    mkdirSync(dir, { recursive: true });
    const marker = join(dir, key);
    if (existsSync(marker)) return false;
    writeFileSync(marker, "");
    return true;
  } catch {
    // Cannot persist the marker ⇒ cannot promise we will not loop ⇒ do not block at all.
    return false;
  }
}

const SEV_EN: Record<Severity, string> = { bloquant: "blocking", majeur: "major", mineur: "minor" };
const MAX_DIGEST = 10;

/** One line per finding, named by its RGAA 4.1.2 criterion — the only standard ultra11y
 *  reports against — with the WCAG success criterion as the discreet mapping only. */
function digestOf(findings: Finding[]): string {
  const rgaa = loadPack("rgaa");
  const shown = findings.slice(0, MAX_DIGEST).map((f) => `- ${f.file}:${f.line} — ${packRefLabel(rgaa, f)} (${SEV_EN[f.severity]}) — ${f.message}`);
  if (findings.length > MAX_DIGEST) shown.push(`- …and ${findings.length - MAX_DIGEST} more (the skill re-runs the engine and sees all of them).`);
  return shown.join("\n");
}

const SCOPE_HINT = {
  commit: "--staged --graph",
  push: (base: string) => `--since ${base} --graph`,
} as const;

/** A branch about to be pushed or proposed has pages to render, not only code to read: the
 *  review's second step renders the pages the diff reaches (src/affected.ts) and fails only on
 *  non-conformities the base deployment does not already show. The hook names the step; it never
 *  runs a browser itself (rule 1: it must stay fast and never break a git flow). */
const RENDERED_HINT = (base: string): string =>
  `Then the rendered step: \`affected --since ${base}\` lists the pages this change reaches; with a deployment of the branch, \`scan --since ${base} --base-url <url> --baseline <scan.json>\` renders exactly those pages and fails only on NEW non-conformities.`;

export interface DecideDeps {
  env?: NodeJS.ProcessEnv;
  /** Injected so tests can drive the decision without a repo or a real audit. */
  audit?: (scope: { staged: true } | { since: string }, cwd: string) => AuditResult | null;
  seen?: (key: string) => boolean;
}

function realAudit(scope: { staged: true } | { since: string }, cwd: string): AuditResult | null {
  const previous = process.cwd();
  try {
    process.chdir(cwd);
    return runAudit({
      inputs: ["."],
      changed: "since" in scope,
      ...("since" in scope ? { since: scope.since } : { staged: true as const }),
      graph: true,
      onWarn: () => {}, // stdout/stderr belong to the hook protocol — stay quiet
    });
  } catch {
    return null;
  } finally {
    try {
      process.chdir(previous);
    } catch {
      /* the previous cwd may be gone; nothing useful to do */
    }
  }
}

/** The whole decision. Returns `null` for "say nothing"; anything else is printed as JSON. */
export function decide(payload: PreToolUsePayload, deps: DecideDeps = {}): HookDecision {
  const env = deps.env ?? process.env;
  const audit = deps.audit ?? realAudit;
  const seen = deps.seen ?? firstSighting;

  if (!isShellTool(payload.tool_name)) return null;
  const command = commandOf(payload.tool_input);
  if (!command) return null;
  if (env.SKIP_A11Y || env.ULTRA11Y_HOOK === "off") return null;

  const intent = matchGitIntent(command);
  if (!intent) return null;

  const cwd = payload.cwd || process.cwd();
  if (!git(cwd, ["rev-parse", "--git-dir"])) return null;

  const threshold = resolveThreshold(cwd, env);
  if (!threshold) return null;

  const scope = scopeFor(intent, command, cwd);
  if (!scope) return null;

  const result = audit(scope, cwd);
  if (!result) return null;

  const findings = findingsAtOrAbove(result.findings, threshold);
  if (findings.length === 0) return null;

  if (!seen(loopKey(payload.session_id ?? "", intent, findings))) return null;

  const counts = (["bloquant", "majeur", "mineur"] as const)
    .map((s) => [s, findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${SEV_EN[s]}`)
    .join(", ");
  const where = intent === "commit" ? "about to be committed" : intent === "push" ? "about to be pushed" : "about to go into this pull request";
  const hint = "since" in scope ? SCOPE_HINT.push(scope.since) : SCOPE_HINT.commit;

  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `ultra11y: ${findings.length} accessibility finding(s) (${counts}) in the code ${where}.`,
      additionalContext: [
        `Invoke the \`review-a11y\` skill now, scoped to \`${hint}\`, before running this command again.`,
        "",
        "The engine already found:",
        digestOf(findings),
        "",
        "Adjudicate each one against the cited code — refute false positives with evidence, apply the fixes the user agrees to — and report by RGAA criterion and severity.",
        ...("since" in scope ? [RENDERED_HINT(scope.since)] : []),
        "Then re-run the command: this gate does not fire twice for the same set of findings, so it will go through.",
      ].join("\n"),
    },
  };
}
