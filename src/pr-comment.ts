// THE STICKY PULL-REQUEST COMMENT — a REPORT surface, not a ticket.
//
// A CI run that appends a new comment every push turns a busy PR into a wall of stale
// audits. This posts ONE comment and EDITS it on every subsequent run, keyed by an invisible
// marker. The marker is per-standard, so a WCAG run and an RGAA run coexist instead of
// overwriting one another (the same reason SARIF runs carry distinct automationDetails ids).
//
// It deliberately lives outside src/tickets/: it has no title, no de-dupe key, no labels and
// no grain, so folding it into `TicketProvider` would force GitLab and Jira to stub a
// `comment()` method they have no business implementing. It serves `report --format github`.
import type { StandardId } from "./standards/index.js";
import { ghExec, ghErrorReason } from "./gh-cli.js";

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

/** Post (or update) the audit summary on the current pull request. Best-effort: with no `gh`,
 *  no auth or no PR, it reports `skipped` and the caller carries on — a comment is never
 *  worth failing a build over. */
export function pushPrComment(markdown: string, standard: StandardId = "wcag"): CommentResult {
  const pr = prNumberFromEnv();
  if (pr === undefined) return { ok: true, action: "skipped", reason: "not a pull-request run" };
  const marker = COMMENT_MARKER(standard);
  const body = stickyBody(markdown, standard);
  try {
    const repo = ghExec(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]).trim();
    let existing: IssueComment | undefined;
    try {
      const raw = ghExec(["api", `repos/${repo}/issues/${pr}/comments`, "--paginate"]);
      existing = pickExistingComment(JSON.parse(raw) as IssueComment[], marker);
    } catch {
      // Listing failed (permissions, rate limit) — fall through and CREATE. A duplicate
      // comment is a far smaller harm than dropping the report entirely.
    }
    if (existing) {
      ghExec(["api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
      return { ok: true, action: "updated" };
    }
    ghExec(["api", "--method", "POST", `repos/${repo}/issues/${pr}/comments`, "-f", `body=${body}`]);
    return { ok: true, action: "created" };
  } catch (e) {
    return { ok: false, action: "skipped", reason: ghErrorReason(e) };
  }
}
