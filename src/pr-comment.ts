// THE STICKY PULL-REQUEST COMMENT — a REPORT surface, not a ticket.
//
// A CI run that appends a new comment every push turns a busy PR into a wall of stale
// audits. This posts ONE comment and EDITS it on every subsequent run, keyed by an invisible
// marker. The marker is per-standard AND per-kind, so a WCAG run and an RGAA run coexist —
// and so do the code digest and the page-by-page grid of one standard — instead of
// overwriting one another (the same reason SARIF runs carry distinct automationDetails ids).
//
// It deliberately lives outside src/tickets/: it has no title, no de-dupe key, no labels and
// no grain, so folding it into `TicketProvider` would force GitLab and Jira to stub a
// `comment()` method they have no business implementing. It serves `report --format github`.
import type { StandardId } from "./standards/index.js";
import { ghExec, ghErrorReason } from "./gh-cli.js";

/** WHICH document a sticky carries.
 *
 *  One workflow can run two tiers against the same pull request — a code gate and a page
 *  sweep — and they do not write the same document: the digest names the distinct defects a
 *  reviewer can act on in the diff, the page grid names what conforms page by page. They
 *  shared one marker, and the sweep (337 files, 684 occurrences) overwrote the four
 *  actionable findings of the gate on every run. The actionable half is the one that
 *  disappeared, so the kind is part of the key.
 *
 *  `digest` renders the historical marker BYTE FOR BYTE. A sticky already posted must keep
 *  being edited in place; re-keying it would leave the old comment orphaned on the PR and
 *  post a duplicate beside it. */
export type CommentKind = "digest" | "pages";

/** The hidden key identifying this tool's comment for a given standard and kind.
 *
 *  The kinds cannot collide as substrings of one another: the digest key ends in `" -->"`
 *  right after the standard, which the pages key never contains. That matters because
 *  `pickExistingComment` matches with `includes` — a prefix relationship there would make one
 *  tier adopt and overwrite the other's comment, which is the bug this parameter exists for. */
export function COMMENT_MARKER(standard: StandardId, kind: CommentKind = "digest"): string {
  return `<!-- ultra11y:report standard="${standard}"${kind === "digest" ? "" : ` kind="${kind}"`} -->`;
}

export function stickyBody(markdown: string, standard: StandardId, kind: CommentKind = "digest"): string {
  return `${COMMENT_MARKER(standard, kind)}\n${markdown}`;
}

/** The kind a caller asked for, from an untrusted string (a workflow input, an env var).
 *
 *  Fails to `digest`, never to nothing: an unset or misspelled value must degrade to the
 *  document every existing workflow already posts. A typo that silenced the comment entirely
 *  would look exactly like a clean run. */
export function commentKindFrom(value: string | undefined): CommentKind {
  return value === "pages" ? "pages" : "digest";
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
export function pushPrComment(markdown: string, standard: StandardId = "wcag", kind: CommentKind = "digest"): CommentResult {
  const pr = prNumberFromEnv();
  if (pr === undefined) return { ok: true, action: "skipped", reason: "not a pull-request run" };
  const marker = COMMENT_MARKER(standard, kind);
  const body = stickyBody(markdown, standard, kind);
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
