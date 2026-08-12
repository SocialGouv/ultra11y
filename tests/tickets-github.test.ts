// The GitHub provider, both transports. The CLI argv assertions are inherited from the
// pre-v3 tests/gh.test.ts on purpose: `gh` is invoked byte-identically, so a repo that
// already filed tickets keeps de-duping against them.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { createGithubProvider } from "../src/tickets/providers/github.js";
import type { Ticket } from "../src/tickets/types.js";

const exec = execFileSync as unknown as ReturnType<typeof vi.fn>;
const argv = (call: unknown[]): string[] => (call[1] as string[]) ?? [];

beforeEach(() => exec.mockReset());

const T = (over: Partial<Ticket> = {}): Ticket => ({
  title: "[a11y] WCAG 1.1.1 — Non-text Content",
  body: "body",
  labels: ["accessibility", "wcag", "bloquant"],
  severity: "bloquant",
  advisory: false,
  scope: { grain: "criterion", criteriaId: "1.1.1" },
  occurrences: [],
  ...over,
});

const REST_ENV = { GITHUB_TOKEN: "s3cret", GITHUB_REPOSITORY: "acme/app" };

/** A fetch double returning a queue of responses, recording every call. */
function fetchStub(responses: Array<{ ok?: boolean; status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { ok: true, body: [] };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      headers: new Headers(r.headers ?? {}),
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("transport resolution", () => {
  it("prefers the CLI under `auto` — it owns its auth, so ultra11y never holds a token", () => {
    const p = createGithubProvider({ env: {}, cliAvailable: () => true });
    expect(p.transport).toBe("cli");
    expect(p.available()).toBe(true);
  });

  it("falls back to REST when `gh` is absent but CI gave us a token and a repo", () => {
    const p = createGithubProvider({ env: REST_ENV, cliAvailable: () => false });
    expect(p.transport).toBe("rest");
    expect(p.available()).toBe(true);
  });

  it("names BOTH missing things when neither transport can work", () => {
    const p = createGithubProvider({ env: {}, cliAvailable: () => false });
    expect(p.available()).toBe(false);
    expect(p.unavailableReason()).toContain("a token");
    expect(p.unavailableReason()).toContain("a repository");
  });

  it("never leaks the token value into the reason", () => {
    const p = createGithubProvider({ env: { GITHUB_TOKEN: "s3cret" }, cliAvailable: () => false });
    expect(p.unavailableReason()).not.toContain("s3cret");
  });

  it("honours GITHUB_API_URL so GitHub Enterprise works", async () => {
    const { impl, calls } = fetchStub([{ body: [] }]);
    const p = createGithubProvider({ transport: "rest", env: { ...REST_ENV, GITHUB_API_URL: "https://ghe.acme.com/api/v3" }, fetchImpl: impl });
    await p.list();
    expect(calls[0]?.url.startsWith("https://ghe.acme.com/api/v3/repos/acme/app/issues")).toBe(true);
  });
});

describe("CLI transport", () => {
  const p = () => createGithubProvider({ transport: "cli", env: {}, cliAvailable: () => true });

  it("lists all issues, open and closed, for de-dupe", async () => {
    exec.mockReturnValueOnce(JSON.stringify([{ title: "a" }, { title: "b" }]));
    expect(await p().list()).toEqual([{ title: "a" }, { title: "b" }]);
    expect(argv(exec.mock.calls[0] as unknown[])).toEqual(["issue", "list", "--state", "all", "--limit", "1000", "--json", "title"]);
  });

  it("creates with --body-file - and the labels", async () => {
    exec.mockReturnValueOnce("");
    const r = await p().create(T());
    expect(r.ok).toBe(true);
    expect(argv(exec.mock.calls[0] as unknown[])).toEqual([
      "issue",
      "create",
      "--title",
      "[a11y] WCAG 1.1.1 — Non-text Content",
      "--body-file",
      "-",
      "--label",
      "accessibility,wcag,bloquant",
    ]);
  });

  it("retries WITHOUT labels when the labelled call fails, rather than losing the ticket", async () => {
    exec.mockImplementationOnce(() => {
      throw Object.assign(new Error("x"), { stderr: "could not add label: 'wcag' not found" });
    });
    exec.mockReturnValueOnce("");
    expect((await p().create(T())).ok).toBe(true);
    expect(argv(exec.mock.calls[1] as unknown[])).not.toContain("--label");
  });

  // Both attempts fail, one `mockImplementationOnce` each: a PERSISTENT throwing
  // mockImplementation would also poison vitest's own use of node:child_process.
  it("carries gh's stderr reason when both attempts fail", async () => {
    const boom = () => {
      throw Object.assign(new Error("x"), { stderr: "HTTP 403: Resource not accessible by integration" });
    };
    exec.mockImplementationOnce(boom).mockImplementationOnce(boom);
    const r = await p().create(T());
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("403");
  });

  it("degrades to an empty list when gh fails, so a listing error never drops the backlog", async () => {
    exec.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(await p().list()).toEqual([]);
  });
});

describe("REST transport", () => {
  it("sends the headers GitHub requires, including a User-Agent", async () => {
    const { impl, calls } = fetchStub([{ body: [] }]);
    await createGithubProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).list();
    const h = calls[0]?.init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer s3cret");
    expect(h["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(h["User-Agent"]).toMatch(/^ultra11y\//);
  });

  // The issues endpoint returns pull requests too; a PR title that matched would silently
  // suppress a real ticket.
  it("filters pull requests out of the issue listing", async () => {
    const { impl } = fetchStub([
      {
        body: [
          { title: "an issue", number: 1 },
          { title: "a PR", number: 2, pull_request: { url: "x" } },
        ],
      },
    ]);
    const got = await createGithubProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).list();
    expect(got.map((g) => g.title)).toEqual(["an issue"]);
  });

  it("stops paginating on a short page", async () => {
    const { impl, calls } = fetchStub([{ body: Array.from({ length: 3 }, (_, i) => ({ title: `t${i}` })) }]);
    await createGithubProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).list();
    expect(calls).toHaveLength(1);
  });

  it("creates with title/body/labels and returns the issue url", async () => {
    const { impl, calls } = fetchStub([{ body: { number: 7, html_url: "https://github.com/acme/app/issues/7" } }]);
    const r = await createGithubProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).create(T());
    expect(r).toMatchObject({ ok: true, id: "7", url: "https://github.com/acme/app/issues/7" });
    const sent = JSON.parse(calls[0]?.init.body as string);
    expect(sent).toMatchObject({ title: T().title, body: "body", labels: ["accessibility", "wcag", "bloquant"] });
    expect(calls[0]?.init.method).toBe("POST");
  });

  it("retries unlabelled on a 422, mirroring the CLI fallback", async () => {
    const { impl, calls } = fetchStub([{ ok: false, status: 422, body: { message: "Validation Failed" } }, { body: { number: 8 } }]);
    const r = await createGithubProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).create(T());
    expect(r.ok).toBe(true);
    expect(JSON.parse(calls[1]?.init.body as string).labels).toBeUndefined();
  });

  it("surfaces GitHub's own message on a hard failure", async () => {
    const { impl } = fetchStub([{ ok: false, status: 403, body: { message: "Resource not accessible by integration" } }]);
    const r = await createGithubProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).create(T());
    expect(r).toMatchObject({ ok: false, reason: "Resource not accessible by integration" });
  });

  it("retries a 429 without ever sleeping in tests", async () => {
    const { impl, calls } = fetchStub([{ ok: false, status: 429, headers: { "retry-after": "1" }, body: {} }, { body: { number: 9 } }]);
    const slept: number[] = [];
    const r = await createGithubProvider({
      transport: "rest",
      env: REST_ENV,
      fetchImpl: impl,
      sleep: async (ms) => {
        slept.push(ms);
      },
    }).create(T());
    expect(r.ok).toBe(true);
    expect(slept).toEqual([1000]);
    expect(calls).toHaveLength(2);
  });
});
