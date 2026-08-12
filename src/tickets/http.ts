// THE REST TRANSPORT — global `fetch`, no SDK, no npm dependency.
//
// It exists because the CLI transports cannot cover CI: `gh` ships on GitHub-HOSTED runners
// only, so self-hosted runners, container jobs and every other CI (GitLab CI, Jenkins) have
// no binary to shell out to — and Jira has no CLI at all. A token in the environment is the
// one thing all of them do have.
//
// Two rules govern this file:
//   • A token NEVER appears in anything it returns or throws. Errors name the header, never
//     its value: an error message ends up in a log, and a log ends up somewhere public.
//   • It never sleeps in tests. The delay function is injected, exactly as src/llm.ts does.
import { VERSION } from "../types.js";

export const USER_AGENT = `ultra11y/${VERSION}`;

/** Header names whose values must never be echoed back. */
const SECRET_HEADERS = ["authorization", "private-token", "x-atlassian-token"];

export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** Already scrubbed and truncated — safe to print. */
    readonly detail: string,
    readonly url: string,
  ) {
    super(`HTTP ${status}: ${detail}`);
    this.name = "HttpError";
  }
}

export interface HttpOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  /** Injected for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Injected for tests so a rate-limit retry never actually sleeps. */
  sleep?: (ms: number) => Promise<void>;
  /** Retries on 429/503 before giving up. */
  retries?: number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Strip anything that looks like a credential out of a response body before it becomes an
 *  error message. Trackers echo request context in their errors more often than you'd like. */
function scrub(text: string, headers: Record<string, string>): string {
  let out = text;
  for (const [k, v] of Object.entries(headers)) {
    if (v && SECRET_HEADERS.includes(k.toLowerCase())) out = out.split(v).join("<redacted>");
  }
  return out;
}

/** The one-line reason a caller surfaces. Prefers the tracker's own message field over a
 *  wall of JSON: GitHub uses `message`, GitLab `message`/`error`, Jira `errorMessages[]`. */
export function reasonFrom(detail: string): string {
  try {
    const j = JSON.parse(detail) as { message?: unknown; error?: unknown; errorMessages?: unknown; errors?: unknown };
    if (Array.isArray(j.errorMessages) && typeof j.errorMessages[0] === "string") return j.errorMessages[0];
    if (j.errors && typeof j.errors === "object" && !Array.isArray(j.errors)) {
      const first = Object.entries(j.errors as Record<string, unknown>)[0];
      if (first) return `${first[0]}: ${String(first[1])}`;
    }
    if (typeof j.message === "string") return j.message;
    if (typeof j.error === "string") return j.error;
  } catch {
    /* not JSON — fall through to the raw text */
  }
  return detail.split("\n")[0]?.slice(0, 300) ?? detail.slice(0, 300);
}

export interface HttpResponse<T> {
  data: T;
  headers: Headers;
}

/** One JSON request. Throws HttpError on a non-2xx, after retrying a rate limit. */
export async function requestJson<T>(url: string, opts: HttpOptions = {}): Promise<HttpResponse<T>> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const retries = opts.retries ?? 2;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": USER_AGENT, // GitHub REJECTS a request without one.
    ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    ...opts.headers,
  };

  for (let attempt = 0; ; attempt++) {
    const res = await doFetch(url, {
      method: opts.method ?? "GET",
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    if (res.ok) {
      const text = await res.text();
      return { data: (text ? JSON.parse(text) : {}) as T, headers: res.headers };
    }
    const detail = scrub(await res.text().catch(() => ""), headers);
    const retryable = res.status === 429 || res.status === 503;
    if (!retryable || attempt >= retries) throw new HttpError(res.status, detail, url);
    // Honour the tracker's own backoff hint, capped so a bad header cannot hang a CI job.
    const after = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    await sleep(Math.min(Number.isFinite(after) ? after * 1000 : 1000 * 2 ** attempt, 30_000));
  }
}
