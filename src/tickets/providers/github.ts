// GitHub — two transports behind one TicketProvider.
//
// CLI (`gh`) is preferred by `auto` because it carries the user's own auth and ultra11y
// never touches a token. REST is the CI path: `gh` ships on GitHub-HOSTED runners only, so a
// container job, a self-hosted runner or any non-GitHub CI has a GITHUB_TOKEN and no binary.
// GHES works through GITHUB_API_URL, which Actions sets for you.
import { ghAvailable, ghErrorReason, ghExec } from "../../gh-cli.js";
import { HttpError, reasonFrom, requestJson } from "../http.js";
import type { CreateOutcome, ExistingTicket, ProviderCapabilities, Ticket, TicketProvider, TransportMode } from "../types.js";
import { gitRemoteSlug } from "./remote.js";

// GitHub caps an issue body at 65536 characters and 422s past it.
const CAPABILITIES: ProviderCapabilities = { bodyLimit: 65536, labels: true };

export interface GithubOptions {
  transport?: TransportMode;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests, so the probe never shells out. */
  cliAvailable?: () => boolean;
}

interface Resolved {
  transport: "cli" | "rest";
  repo?: string;
  token?: string;
  api: string;
  reason?: string;
}

function resolve(opts: GithubOptions): Resolved {
  const env = opts.env ?? process.env;
  const mode = opts.transport ?? "auto";
  const api = (env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  // LAZY, because the probe is `gh auth status` — a subprocess that calls github.com. REST is
  // the transport for the runners where `gh` is absent or useless, so a caller who already
  // named REST must not pay for a network round trip whose answer is then discarded.
  const probe = opts.cliAvailable ?? ghAvailable;
  let cached: boolean | undefined;
  const cliOk = (): boolean => (cached ??= probe());

  if (mode === "cli") {
    return cliOk() ? { transport: "cli", api } : { transport: "cli", api, reason: "`gh` is not installed or not authenticated (run `gh auth login`)" };
  }
  // Only REST needs the repo slug, and only REST should pay for a `git` subprocess to find
  // it — the CLI transport already knows which checkout it is standing in.
  const repo = env.ULTRA11Y_GITHUB_REPO || env.GITHUB_REPOSITORY || (mode === "rest" || !cliOk() ? gitRemoteSlug("github.com") : undefined);
  if (mode === "rest") {
    if (!token) return { transport: "rest", api, reason: "no GitHub token — set GH_TOKEN or GITHUB_TOKEN" };
    if (!repo) return { transport: "rest", api, token, reason: "no repository — set GITHUB_REPOSITORY (owner/name) or ULTRA11Y_GITHUB_REPO" };
    return { transport: "rest", api, token, repo };
  }
  // auto: the CLI first (it owns its auth), then REST, then say what BOTH were missing.
  if (cliOk()) return { transport: "cli", api };
  if (token && repo) return { transport: "rest", api, token, repo };
  const missing = [!token ? "a token (GH_TOKEN/GITHUB_TOKEN)" : "", !repo ? "a repository (GITHUB_REPOSITORY)" : ""].filter(Boolean);
  return {
    transport: "rest",
    api,
    ...(token ? { token } : {}),
    ...(repo ? { repo } : {}),
    reason: `\`gh\` is unavailable and REST is missing ${missing.join(" and ")}`,
  };
}

export function createGithubProvider(opts: GithubOptions = {}): TicketProvider {
  const r = resolve(opts);
  const auth = { Authorization: `Bearer ${r.token ?? ""}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const http = {
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    ...(opts.sleep ? { sleep: opts.sleep } : {}),
  };

  async function listRest(): Promise<ExistingTicket[]> {
    const out: ExistingTicket[] = [];
    // 10 pages of 100 mirrors the CLI transport's `--limit 1000`.
    for (let page = 1; page <= 10; page++) {
      const url = `${r.api}/repos/${r.repo}/issues?state=all&per_page=100&page=${page}`;
      const { data } = await requestJson<Array<{ title?: string; number?: number; html_url?: string; pull_request?: unknown }>>(url, {
        headers: auth,
        ...http,
      });
      if (!Array.isArray(data) || data.length === 0) break;
      // The issues endpoint returns PULL REQUESTS too. A PR whose title happened to match
      // would silently suppress a real ticket, so they are filtered, not merely tolerated.
      for (const i of data) {
        if (i.pull_request) continue;
        if (i.title) out.push({ title: i.title, ...(i.number !== undefined ? { id: String(i.number) } : {}), ...(i.html_url ? { url: i.html_url } : {}) });
      }
      if (data.length < 100) break;
    }
    return out;
  }

  function listCli(): ExistingTicket[] {
    const raw = ghExec(["issue", "list", "--state", "all", "--limit", "1000", "--json", "title"]);
    return (JSON.parse(raw) as Array<{ title?: string }>).filter((i) => i.title).map((i) => ({ title: i.title as string }));
  }

  async function createRest(t: Ticket): Promise<CreateOutcome> {
    const url = `${r.api}/repos/${r.repo}/issues`;
    const post = async (labels?: string[]) =>
      requestJson<{ number?: number; html_url?: string }>(url, {
        method: "POST",
        headers: auth,
        body: { title: t.title, body: t.body, ...(labels ? { labels } : {}) },
        ...http,
      });
    try {
      const { data } = await post(t.labels);
      return { ok: true, ...(data.number !== undefined ? { id: String(data.number) } : {}), ...(data.html_url ? { url: data.html_url } : {}) };
    } catch (e) {
      // A repo whose labels do not exist 422s. Retry unlabelled rather than lose the ticket
      // — the same fallback the CLI transport has always had.
      if (e instanceof HttpError && e.status === 422) {
        try {
          const { data } = await post();
          return { ok: true, ...(data.number !== undefined ? { id: String(data.number) } : {}), ...(data.html_url ? { url: data.html_url } : {}) };
        } catch (retryErr) {
          return { ok: false, reason: retryErr instanceof HttpError ? reasonFrom(retryErr.detail) : String(retryErr) };
        }
      }
      return { ok: false, reason: e instanceof HttpError ? reasonFrom(e.detail) : e instanceof Error ? e.message : String(e) };
    }
  }

  /** argv byte-identical to the pre-v3 `createIssue`, including the unlabelled retry. */
  function createCli(t: Ticket): CreateOutcome {
    const base = ["issue", "create", "--title", t.title, "--body-file", "-"];
    try {
      ghExec([...base, "--label", t.labels.join(",")], t.body);
      return { ok: true };
    } catch (labelledErr) {
      try {
        ghExec(base, t.body);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: ghErrorReason(err) ?? ghErrorReason(labelledErr) };
      }
    }
  }

  return {
    id: "github",
    transport: r.transport,
    capabilities: CAPABILITIES,
    available: () => r.reason === undefined,
    unavailableReason: () => r.reason,
    list: async () => {
      try {
        return r.transport === "cli" ? listCli() : await listRest();
      } catch {
        return []; // degrade to "create": a duplicate beats dropping the backlog
      }
    },
    create: async (t) => (r.transport === "cli" ? createCli(t) : createRest(t)),
  };
}
