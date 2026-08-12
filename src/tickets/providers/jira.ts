// Jira — REST only. There is no first-party Jira CLI to shell out to, so `--transport cli`
// is a usage error here rather than a silent fallback.
//
// Two Jira-specific facts shape this file:
//
//  • API v3 requires ADF (Atlassian Document Format) for `description`, not Markdown. A real
//    Markdown→ADF converter is a library, and this engine has no dependencies — so we emit
//    one ADF paragraph per Markdown line. The text is faithful and readable; the formatting
//    is not rendered. `ULTRA11Y_JIRA_API=2` switches to the v2 endpoint, which takes a plain
//    string, for Jira Server/DC or anyone who prefers wiki markup.
//
//  • JQL's `~` is a fuzzy, punctuation-stripping text match, so it can NEVER decide whether a
//    ticket already exists. It is used only to narrow the candidate set (by a constant
//    `ultra11y` label); the exact title comparison happens client-side in planPush, the same
//    way it does for GitHub and GitLab.
import { HttpError, reasonFrom, requestJson } from "../http.js";
import type { Severity } from "../../types.js";
import type { CreateOutcome, ExistingTicket, ProviderCapabilities, Ticket, TicketProvider, TransportMode } from "../types.js";

const CAPABILITIES: ProviderCapabilities = { bodyLimit: 32767, labels: true };

/** The constant label every ultra11y ticket carries, so JQL can bound the candidate set. */
export const JIRA_SCOPE_LABEL = "ultra11y";

const PRIORITY: Record<Severity, string> = { bloquant: "Highest", majeur: "High", mineur: "Low" };

export interface JiraOptions {
  transport?: TransportMode;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface Resolved {
  url?: string;
  project?: string;
  issueType: string;
  apiVersion: "2" | "3";
  auth?: string;
  reason?: string;
}

function resolve(opts: JiraOptions): Resolved {
  const env = opts.env ?? process.env;
  const issueType = env.ULTRA11Y_JIRA_ISSUE_TYPE || "Task";
  const apiVersion = env.ULTRA11Y_JIRA_API === "2" ? "2" : "3";
  const url = (env.ULTRA11Y_JIRA_URL || "").replace(/\/+$/, "");
  const project = env.ULTRA11Y_JIRA_PROJECT;
  const base = { issueType, apiVersion, ...(url ? { url } : {}), ...(project ? { project } : {}) } as Resolved;

  if (opts.transport === "cli") return { ...base, reason: "Jira has no CLI transport — use --transport rest (the default) with ULTRA11Y_JIRA_URL and a token" };
  if (!url) return { ...base, reason: "no Jira site — set ULTRA11Y_JIRA_URL (e.g. https://acme.atlassian.net)" };
  if (!project) return { ...base, reason: "no Jira project — set ULTRA11Y_JIRA_PROJECT (the project KEY)" };

  // Jira Cloud uses Basic with an API token; Server/DC uses a Bearer PAT.
  if (env.JIRA_API_TOKEN && env.JIRA_EMAIL) return { ...base, auth: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64")}` };
  if (env.JIRA_TOKEN) return { ...base, auth: `Bearer ${env.JIRA_TOKEN}` };
  return { ...base, reason: "no Jira credentials — set JIRA_EMAIL + JIRA_API_TOKEN (Cloud) or JIRA_TOKEN (Server/DC)" };
}

interface AdfNode {
  type: string;
  content?: AdfNode[];
  text?: string;
}

/** Markdown → ADF, line by line. NOT a Markdown parser: each non-empty line becomes one
 *  paragraph carrying its text verbatim. Deliberately dumb, deliberately dependency-free. */
export function toAdf(markdown: string): AdfNode {
  const content = markdown
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map<AdfNode>((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] }));
  return { type: "doc", version: 1, content: content.length ? content : [{ type: "paragraph", content: [] }] } as AdfNode & { version: number };
}

export function createJiraProvider(opts: JiraOptions = {}): TicketProvider {
  const r = resolve(opts);
  const headers = { Authorization: r.auth ?? "" };
  const http = {
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  };

  async function list(): Promise<ExistingTicket[]> {
    const out: ExistingTicket[] = [];
    const jql = `project = "${r.project}" AND labels = "${JIRA_SCOPE_LABEL}" ORDER BY created DESC`;
    for (let startAt = 0; startAt < 500; startAt += 100) {
      const url = `${r.url}/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=100&startAt=${startAt}`;
      const { data } = await requestJson<{ issues?: Array<{ key?: string; fields?: { summary?: string } }> }>(url, { headers, ...http });
      const issues = data.issues ?? [];
      if (!issues.length) break;
      for (const i of issues) if (i.fields?.summary) out.push({ title: i.fields.summary, ...(i.key ? { id: i.key, url: `${r.url}/browse/${i.key}` } : {}) });
      if (issues.length < 100) break;
    }
    return out;
  }

  function fields(t: Ticket, opt: { priority: boolean; labels: boolean }): Record<string, unknown> {
    return {
      project: { key: r.project },
      summary: t.title,
      description: r.apiVersion === "3" ? toAdf(t.body) : t.body,
      issuetype: { name: r.issueType },
      ...(opt.labels ? { labels: [...new Set([...t.labels, JIRA_SCOPE_LABEL])].map((l) => l.replace(/\s+/g, "-")) } : {}),
      ...(opt.priority ? { priority: { name: PRIORITY[t.severity] } } : {}),
    };
  }

  async function post(t: Ticket, opt: { priority: boolean; labels: boolean }) {
    return requestJson<{ key?: string }>(`${r.url}/rest/api/${r.apiVersion}/issue`, { method: "POST", headers, body: { fields: fields(t, opt) }, ...http });
  }

  async function create(t: Ticket): Promise<CreateOutcome> {
    // Degradation ladder: a Jira project that has not configured `priority` (or forbids
    // labels on this issue type) 400s. Shed the optional field and retry rather than lose
    // the ticket — the same posture as GitHub's unlabelled retry.
    const attempts: Array<{ priority: boolean; labels: boolean }> = [
      { priority: true, labels: true },
      { priority: false, labels: true },
      { priority: false, labels: false },
    ];
    let last = "";
    for (const opt of attempts) {
      try {
        const { data } = await post(t, opt);
        return { ok: true, ...(data.key ? { id: data.key, url: `${r.url}/browse/${data.key}` } : {}) };
      } catch (e) {
        last = e instanceof HttpError ? reasonFrom(e.detail) : e instanceof Error ? e.message : String(e);
        if (!(e instanceof HttpError) || e.status !== 400) return { ok: false, reason: last };
      }
    }
    return { ok: false, reason: last };
  }

  return {
    id: "jira",
    transport: "rest",
    capabilities: CAPABILITIES,
    available: () => r.reason === undefined,
    unavailableReason: () => r.reason,
    list: async () => {
      try {
        return await list();
      } catch {
        return [];
      }
    },
    create,
  };
}
