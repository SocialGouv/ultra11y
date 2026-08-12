// The issue set an audit turns into, plus GitHub as one transport for it.
//
// The SET is tracker-agnostic — `issueSet()` renders one de-duplicated item per
// criterion (title, body, labels, severity) and is what `prd --issues-json`
// emits, so a board that is not GitHub (a native kanban, GitLab, Jira, Linear)
// files the same items without shelling out to anything. `pushIssues` /
// `pushSingleIssue` are the GitHub TRANSPORT for that set: they shell out to the
// `gh` CLI (which handles its own auth) — NO npm dependency, no tokens in
// ultra11y. Both paths build their titles, bodies and labels through the same
// three functions, so the exported JSON and the filed GitHub issue can never
// drift apart.
//
// Everything on the transport side is best-effort: if gh is absent or
// unauthenticated, the caller still wrote the markdown and we just report that
// issues were skipped. De-dupes by issue title so re-running never creates
// duplicates.
import { execFileSync } from "node:child_process";
import type { Lang, Severity } from "./types.js";
import type { PrdUnit } from "./prd.js";
import { type StandardId, isCore, loadPack } from "./standards/index.js";
import { renderAuditorUnit } from "./auditor.js";
import { resolveMessage, resolveRemediation } from "./messages.js";

// Issue-body shape: `audit` (DEFAULT) = the auditor conformance block; `remediation` = the
// legacy dev body (WCAG refs / Fix / Occurrences). Mirrors `prd --format`.
export type IssueFormat = "audit" | "remediation";

const SEV_ORDER: Severity[] = ["bloquant", "majeur", "mineur"];
const SEV_RANK: Record<Severity, number> = { bloquant: 0, majeur: 1, mineur: 2 };
const ICON: Record<Severity, string> = { bloquant: "🔴", majeur: "🟠", mineur: "🟡" };
const SEV_LABEL: Record<Lang, Record<Severity, string>> = {
  fr: { bloquant: "Bloquant", majeur: "Majeur", mineur: "Mineur" },
  en: { bloquant: "Blocking", majeur: "Major", mineur: "Minor" },
};

/** Display label + issue tag for the active standard ("WCAG"/"wcag" or a pack's). */
function standardTag(standard: StandardId): { label: string; tag: string } {
  return isCore(standard)
    ? { label: "WCAG", tag: "wcag" }
    : (() => {
        const p = loadPack(standard);
        return { label: p.name, tag: p.key };
      })();
}

function gh(args: string[], input?: string): string {
  // Capture stderr (pipe, not ignore) so a failed `gh` call carries a surfaceable reason
  // on the thrown error instead of vanishing.
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...(input !== undefined ? { input } : {}) });
}

/** Extract a concise, single-line failure reason from a thrown `gh` error — the first
 *  meaningful stderr line (where `gh` prints the API/auth error), else the error message. */
function ghErrorReason(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { stderr?: unknown; message?: unknown };
  const stderr = typeof e.stderr === "string" ? e.stderr : Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : "";
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (line) return line;
  if (typeof e.message === "string" && e.message) return e.message.split("\n")[0]!.trim() || undefined;
  return undefined;
}

/** Is the `gh` CLI installed AND authenticated here? */
export function ghAvailable(): boolean {
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Stable, language-neutral suffix marking a non-normative recommendation issue apart
// from a non-conformity one. Part of the de-dupe grain, so it must never drift.
export const RECOMMENDATION_SUFFIX = " (recommendation)";

/** One issue per criterion (stable de-dupe grain, regardless of --split). The label
 *  is the active standard ("WCAG" for the core, else the pack name e.g. "RGAA"). An
 *  advisory unit gets a stable suffix so its issue is never confused with an NC one. */
export function issueTitle(unit: PrdUnit, label = "WCAG"): string {
  return `[a11y] ${label} ${unit.criteriaId} — ${unit.title}${unit.advisory ? RECOMMENDATION_SUFFIX : ""}`;
}

/** Titles of all existing issues (open + closed), for de-duplication. Empty on any failure. */
export function existingIssueTitles(): Set<string> {
  try {
    const raw = gh(["issue", "list", "--state", "all", "--limit", "1000", "--json", "title"]);
    const arr = JSON.parse(raw) as Array<{ title?: string }>;
    return new Set(arr.map((i) => i.title ?? "").filter(Boolean));
  } catch {
    return new Set();
  }
}

export function issueBody(unit: PrdUnit, lang: Lang, standard: StandardId = "wcag", format: IssueFormat = "audit"): string {
  if (format === "audit") return renderAuditorUnit(unit, standard, lang).join("\n").trimEnd();
  const t = lang === "fr" ? { fix: "Correction", occ: "Occurrence(s)", def: "↳ définition" } : { fix: "Fix", occ: "Occurrence(s)", def: "↳ definition" };
  const lines: string[] = [];
  if (unit.refs.length) lines.push(`**WCAG** : ${unit.refs.join(", ")}`, "");
  for (const fx of [...new Set(unit.findings.map((f) => resolveRemediation(f, lang)))]) lines.push(`**${t.fix}** : ${fx}`);
  lines.push("", `**${t.occ} (${unit.findings.length})**`, "");
  for (const f of unit.findings) {
    lines.push(`- [ ] \`${f.file}:${f.line}\` (\`${f.selectorHint}\`) — ${resolveMessage(f, lang)}`);
    if (f.related) lines.push(`  - ${t.def} : \`${f.related.file}:${f.related.line}\` (\`${f.related.selectorHint}\`)`);
  }
  return lines.join("\n");
}

/** The labels an issue carries: `accessibility`, the active standard's tag, its severity —
 *  plus `recommendation` when the unit is advisory, so a good practice is never triaged as a
 *  non-conformity. Shared by the GitHub transport and the tracker-agnostic export. */
export function issueLabels(unit: PrdUnit, standard: StandardId = "wcag"): string[] {
  const { tag } = standardTag(standard);
  return unit.advisory ? ["accessibility", tag, "recommendation", unit.severity] : ["accessibility", tag, unit.severity];
}

/** One issue, rendered for whatever tracker is going to file it. */
export interface TrackerIssue {
  criteriaId: string;
  /** The de-dupe grain: stable across runs, so re-filing is a no-op on any tracker. */
  title: string;
  body: string;
  labels: string[];
  severity: Severity;
  /** A non-normative good practice, not a non-conformity. Never counts toward conformance. */
  advisory: boolean;
  /** Occurrences behind this issue — a tracker that wants inline anchors reads them here. */
  occurrences: { file: string; line: number; selector: string; message: string }[];
}

/** Render the audit's units as a tracker-agnostic issue set — the exact items `pushIssues`
 *  would file, minus the transport. This is what `prd --issues-json` emits. */
export function issueSet(units: PrdUnit[], lang: Lang, standard: StandardId = "wcag", format: IssueFormat = "audit"): TrackerIssue[] {
  const { label } = standardTag(standard);
  return units.map((u) => ({
    criteriaId: u.criteriaId,
    title: issueTitle(u, label),
    body: issueBody(u, lang, standard, format),
    labels: issueLabels(u, standard),
    severity: u.severity,
    advisory: u.advisory === true,
    occurrences: u.findings.map((f) => ({ file: f.file, line: f.line, selector: f.selectorHint, message: resolveMessage(f, lang) })),
  }));
}

export interface CreateResult {
  ok: boolean;
  /** Concise `gh` stderr reason when the creation failed (both attempts). */
  reason?: string;
}

/** Create one issue. Retries without labels if the labelled call fails (labels may
 *  not exist in the repo). On failure, carries `gh`'s stderr reason so the caller can
 *  surface WHY it failed instead of silently swallowing it. */
export function createIssue(title: string, body: string, labels: string[]): CreateResult {
  const base = ["issue", "create", "--title", title, "--body-file", "-"];
  try {
    gh([...base, "--label", labels.join(",")], body);
    return { ok: true };
  } catch (labelledErr) {
    try {
      gh(base, body);
      return { ok: true };
    } catch (err) {
      // Prefer the un-labelled attempt's reason (the real one); fall back to the labelled one.
      return { ok: false, reason: ghErrorReason(err) ?? ghErrorReason(labelledErr) };
    }
  }
}

export interface PushResult {
  created: number;
  skipped: number; // already existed (by title)
  failed: number;
  createdTitles: string[];
  /** Concise, de-duplicated `gh` failure reasons (empty when nothing failed). */
  errors: string[];
}

/** Record a creation failure, keeping distinct `gh` reasons (deduped) for surfacing. */
function recordFailure(result: PushResult, reason?: string): void {
  result.failed++;
  if (reason && !result.errors.includes(reason)) result.errors.push(reason);
}

/** Create a GitHub issue per unit, skipping titles that already exist. */
export function pushIssues(units: PrdUnit[], lang: Lang, standard: StandardId = "wcag", format: IssueFormat = "audit"): PushResult {
  const { label } = standardTag(standard);
  const existing = existingIssueTitles();
  const result: PushResult = { created: 0, skipped: 0, failed: 0, createdTitles: [], errors: [] };
  for (const u of units) {
    const title = issueTitle(u, label);
    if (existing.has(title)) {
      result.skipped++;
      continue;
    }
    // Advisory units get the `recommendation` label so they can be triaged apart from
    // real non-conformities (which they are not). Shared with the JSON export.
    const r = createIssue(title, issueBody(u, lang, standard, format), issueLabels(u, standard));
    if (r.ok) {
      result.created++;
      result.createdTitles.push(title);
      existing.add(title); // guard against duplicate units in one run
    } else {
      recordFailure(result, r.reason);
    }
  }
  return result;
}

/** Stable title for the single consolidated audit issue. No counts/date so re-runs de-dupe. */
export function singleIssueTitle(label = "WCAG"): string {
  return `[a11y] ${label} — Accessibility audit`;
}

/** One consolidated issue body: every criterion, sectioned by severity (blocking → minor),
 *  each criterion reusing the same fix + occurrences block as the per-criterion issues. */
export function singleIssueBody(units: PrdUnit[], lang: Lang, standard: StandardId = "wcag", format: IssueFormat = "audit"): string {
  const { label } = standardTag(standard);
  const intro =
    lang === "fr"
      ? `Audit d'accessibilité ${label} — ${units.length} critère(s) non conforme(s).`
      : `${label} accessibility audit — ${units.length} non-conforming criteria.`;
  const lines: string[] = [intro, ""];
  for (const sev of SEV_ORDER) {
    const group = units.filter((u) => u.severity === sev);
    if (!group.length) continue;
    lines.push(`## ${ICON[sev]} ${SEV_LABEL[lang][sev]} (${group.length})`, "");
    for (const u of group) {
      if (format === "audit") lines.push(...renderAuditorUnit(u, standard, lang, { heading: "###" }));
      else lines.push(`### ${u.label}`, "", issueBody(u, lang, standard, format), "");
    }
  }
  return lines.join("\n");
}

/** Create ONE consolidated issue for the whole audit, de-duped by its stable title and
 *  labelled by the most severe criterion. Mirrors pushIssues' best-effort/skip semantics. */
export function pushSingleIssue(units: PrdUnit[], lang: Lang, standard: StandardId = "wcag", format: IssueFormat = "audit"): PushResult {
  const { label, tag } = standardTag(standard);
  const result: PushResult = { created: 0, skipped: 0, failed: 0, createdTitles: [], errors: [] };
  if (!units.length) return result;
  const title = singleIssueTitle(label);
  if (existingIssueTitles().has(title)) {
    result.skipped = 1;
    return result;
  }
  const severity = [...units].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])[0]!.severity;
  const r = createIssue(title, singleIssueBody(units, lang, standard, format), ["accessibility", tag, severity]);
  if (r.ok) {
    result.created = 1;
    result.createdTitles.push(title);
  } else {
    recordFailure(result, r.reason);
  }
  return result;
}

// ---- sticky pull-request comment ---------------------------------------------------------
// A CI run that appends a new comment every push turns a busy PR into a wall of stale audits.
// This posts ONE comment and EDITS it on every subsequent run, keyed by an invisible marker.
// The marker is per-standard, so a WCAG run and an RGAA run coexist instead of overwriting
// one another (the same reason SARIF runs carry distinct automationDetails ids).

/** The hidden key identifying this tool's comment for a given standard. */
export function COMMENT_MARKER(standard: StandardId): string {
  return `<!-- ultra11y:report standard="${standard}" -->`;
}

export function stickyBody(markdown: string, standard: StandardId): string {
  return `${COMMENT_MARKER(standard)}\n${markdown}`;
}

/** The pull request to comment on: an explicit override, else the number GitHub Actions puts
 *  in GITHUB_REF on a pull_request event. Undefined off a PR — the caller then skips, rather
 *  than commenting on some unrelated issue. */
export function prNumberFromEnv(env: Record<string, string | undefined> = process.env): number | undefined {
  const explicit = Number.parseInt(env.ULTRA11Y_PR ?? "", 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const m = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? "");
  const n = m ? Number.parseInt(m[1] as string, 10) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export interface IssueComment {
  id: number;
  body?: string;
}

/** This tool's own previous comment for this standard, if any. Never adopts a human's comment
 *  nor another standard's — an edit is destructive, so the match must be exact. */
export function pickExistingComment(comments: IssueComment[], marker: string): IssueComment | undefined {
  return comments.find((c) => typeof c.body === "string" && c.body.includes(marker));
}

export interface CommentResult {
  ok: boolean;
  action: "created" | "updated" | "skipped";
  reason?: string;
}

/** Post (or update) the audit summary on the current pull request. Best-effort, exactly like
 *  issue creation: with no `gh`, no auth or no PR, it reports `skipped` and the caller carries
 *  on — a comment is never worth failing a build over. */
export function pushPrComment(markdown: string, standard: StandardId = "wcag"): CommentResult {
  const pr = prNumberFromEnv();
  if (pr === undefined) return { ok: true, action: "skipped", reason: "not a pull-request run" };
  const marker = COMMENT_MARKER(standard);
  const body = stickyBody(markdown, standard);
  try {
    const repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
    let existing: IssueComment | undefined;
    try {
      const raw = gh(["api", `repos/${repo}/issues/${pr}/comments`, "--paginate"]);
      existing = pickExistingComment(JSON.parse(raw) as IssueComment[], marker);
    } catch {
      // Listing failed (permissions, rate limit) — fall through and CREATE. A duplicate
      // comment is a far smaller harm than dropping the report entirely.
    }
    if (existing) {
      gh(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
      return { ok: true, action: "updated" };
    }
    gh(["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${body}`]);
    return { ok: true, action: "created" };
  } catch (e) {
    return { ok: false, action: "skipped", reason: ghErrorReason(e) };
  }
}
