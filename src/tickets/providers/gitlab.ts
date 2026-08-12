// GitLab — `glab` when it is there, REST otherwise.
//
// Two shape differences from GitHub that are easy to get wrong and impossible to notice
// until a ticket lands malformed: the body field is `description`, not `body`, and labels go
// over the wire as a COMMA STRING, not an array. GitLab also creates missing labels by
// itself, so unlike GitHub there is no unlabelled retry to write.
import { execFileSync } from "node:child_process";
import { HttpError, reasonFrom, requestJson } from "../http.js";
import type { CreateOutcome, ExistingTicket, ProviderCapabilities, Ticket, TicketProvider, TransportMode } from "../types.js";
import { gitRemoteSlug } from "./remote.js";

const CAPABILITIES: ProviderCapabilities = { bodyLimit: 1_000_000, labels: true };

export interface GitlabOptions {
  transport?: TransportMode;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  cliAvailable?: () => boolean;
}

function glabExec(args: string[]): string {
  return execFileSync("glab", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

function glabAvailable(): boolean {
  try {
    execFileSync("glab", ["auth", "status"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function execReason(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as { stderr?: unknown; message?: unknown };
  const stderr = typeof e.stderr === "string" ? e.stderr : Buffer.isBuffer(e.stderr) ? e.stderr.toString("utf8") : "";
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (line) return line;
  return typeof e.message === "string" ? (e.message.split("\n")[0]?.trim() ?? undefined) : undefined;
}

interface Resolved {
  transport: "cli" | "rest";
  project?: string;
  token?: string;
  /** True when the token came from CI_JOB_TOKEN, which CANNOT create issues. */
  jobToken: boolean;
  api: string;
  reason?: string;
}

function resolve(opts: GitlabOptions): Resolved {
  const env = opts.env ?? process.env;
  const mode = opts.transport ?? "auto";
  const api = (env.CI_API_V4_URL || "https://gitlab.com/api/v4").replace(/\/+$/, "");
  const token = env.GITLAB_TOKEN || env.CI_JOB_TOKEN;
  const jobToken = !env.GITLAB_TOKEN && !!env.CI_JOB_TOKEN;
  const cliOk = (opts.cliAvailable ?? glabAvailable)();

  if (mode === "cli") {
    return cliOk
      ? { transport: "cli", api, jobToken }
      : { transport: "cli", api, jobToken, reason: "`glab` is not installed or not authenticated (run `glab auth login`)" };
  }
  // Only REST needs the project, and only REST should pay for a `git` subprocess to find it.
  const project = env.ULTRA11Y_GITLAB_PROJECT || env.CI_PROJECT_ID || gitRemoteSlug("gitlab.");
  if (mode === "rest" || !cliOk) {
    const base = { transport: "rest" as const, api, jobToken, ...(token ? { token } : {}), ...(project ? { project } : {}) };
    if (!token) return { ...base, reason: `${mode === "auto" ? "`glab` is unavailable and REST has " : ""}no GitLab token — set GITLAB_TOKEN` };
    if (!project) return { ...base, reason: "no project — set CI_PROJECT_ID or ULTRA11Y_GITLAB_PROJECT (id or group/project)" };
    return base;
  }
  return { transport: "cli", api, jobToken };
}

export function createGitlabProvider(opts: GitlabOptions = {}): TicketProvider {
  const r = resolve(opts);
  // A project path must be URL-encoded whole ("group/app" → "group%2Fapp"); a numeric id
  // passes through untouched.
  const id = encodeURIComponent(r.project ?? "");
  const auth = { "PRIVATE-TOKEN": r.token ?? "" };
  const http = {
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  };

  /** CI_JOB_TOKEN is not allowed to create issues; a bare 403 looks like a config error and
   *  costs an afternoon. Name it. */
  const withTokenHint = (reason: string): string =>
    r.jobToken && /403|forbidden|unauthorized|401/i.test(reason)
      ? `${reason} — CI_JOB_TOKEN cannot create issues; use a project access token in GITLAB_TOKEN`
      : reason;

  async function listRest(): Promise<ExistingTicket[]> {
    const out: ExistingTicket[] = [];
    for (let page = 1; page <= 10; page++) {
      const url = `${r.api}/projects/${id}/issues?state=all&per_page=100&page=${page}`;
      const { data, headers } = await requestJson<Array<{ title?: string; iid?: number; web_url?: string }>>(url, { headers: auth, ...http });
      if (!Array.isArray(data) || data.length === 0) break;
      for (const i of data)
        if (i.title) out.push({ title: i.title, ...(i.iid !== undefined ? { id: String(i.iid) } : {}), ...(i.web_url ? { url: i.web_url } : {}) });
      if (!headers.get("x-next-page")) break;
    }
    return out;
  }

  function listCli(): ExistingTicket[] {
    const raw = glabExec(["issue", "list", "--all", "--output", "json"]);
    const parsed = JSON.parse(raw) as Array<{ title?: string }> | { issues?: Array<{ title?: string }> };
    const rows = Array.isArray(parsed) ? parsed : (parsed.issues ?? []);
    return rows.filter((i) => i.title).map((i) => ({ title: i.title as string }));
  }

  async function createRest(t: Ticket): Promise<CreateOutcome> {
    try {
      const { data } = await requestJson<{ iid?: number; web_url?: string }>(`${r.api}/projects/${id}/issues`, {
        method: "POST",
        headers: auth,
        body: { title: t.title, description: t.body, labels: t.labels.join(",") },
        ...http,
      });
      return { ok: true, ...(data.iid !== undefined ? { id: String(data.iid) } : {}), ...(data.web_url ? { url: data.web_url } : {}) };
    } catch (e) {
      const reason = e instanceof HttpError ? reasonFrom(e.detail) : e instanceof Error ? e.message : String(e);
      return { ok: false, reason: withTokenHint(e instanceof HttpError ? `${e.status} ${reason}` : reason) };
    }
  }

  function createCli(t: Ticket): CreateOutcome {
    try {
      glabExec(["issue", "create", "--title", t.title, "--description", t.body, "--label", t.labels.join(",")]);
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: withTokenHint(execReason(err) ?? "glab issue create failed") };
    }
  }

  return {
    id: "gitlab",
    transport: r.transport,
    capabilities: CAPABILITIES,
    available: () => r.reason === undefined,
    unavailableReason: () => r.reason,
    list: async () => {
      try {
        return r.transport === "cli" ? listCli() : await listRest();
      } catch {
        return [];
      }
    },
    create: async (t) => (r.transport === "cli" ? createCli(t) : createRest(t)),
  };
}
