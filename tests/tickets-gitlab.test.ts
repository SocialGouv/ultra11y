import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
import { execFileSync } from "node:child_process";
import { createGitlabProvider } from "../src/tickets/providers/gitlab.js";
import type { Ticket } from "../src/tickets/types.js";

const exec = execFileSync as unknown as ReturnType<typeof vi.fn>;
const argv = (call: unknown[]): string[] => (call[1] as string[]) ?? [];
beforeEach(() => exec.mockReset());

const T = (): Ticket => ({
  title: "[a11y] RGAA 1.1 — Image porteuse d'information",
  body: "body",
  labels: ["accessibility", "rgaa", "bloquant"],
  severity: "bloquant",
  advisory: false,
  scope: { grain: "criterion", criteriaId: "1.1" },
  occurrences: [],
});

const REST_ENV = { GITLAB_TOKEN: "gl-s3cret", CI_PROJECT_ID: "4242" };

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
  it("prefers glab under auto", () => {
    expect(createGitlabProvider({ env: {}, cliAvailable: () => true }).transport).toBe("cli");
  });

  it("falls back to REST with a token and a project", () => {
    const p = createGitlabProvider({ env: REST_ENV, cliAvailable: () => false });
    expect(p.transport).toBe("rest");
    expect(p.available()).toBe(true);
  });

  it("asks for GITLAB_TOKEN by name, never printing a value", () => {
    const p = createGitlabProvider({ env: { CI_PROJECT_ID: "1" }, cliAvailable: () => false });
    expect(p.available()).toBe(false);
    expect(p.unavailableReason()).toContain("GITLAB_TOKEN");
  });

  it("honours a self-managed instance through CI_API_V4_URL", async () => {
    const { impl, calls } = fetchStub([{ body: [] }]);
    await createGitlabProvider({ transport: "rest", env: { ...REST_ENV, CI_API_V4_URL: "https://git.acme.com/api/v4" }, fetchImpl: impl }).list();
    expect(calls[0]?.url.startsWith("https://git.acme.com/api/v4/projects/4242/issues")).toBe(true);
  });

  it("url-encodes a group/project path so it survives as one path segment", async () => {
    const { impl, calls } = fetchStub([{ body: [] }]);
    await createGitlabProvider({ transport: "rest", env: { GITLAB_TOKEN: "t", ULTRA11Y_GITLAB_PROJECT: "groupe/appli" }, fetchImpl: impl }).list();
    expect(calls[0]?.url).toContain("/projects/groupe%2Fappli/issues");
  });
});

describe("REST transport", () => {
  it("sends PRIVATE-TOKEN, `description` and labels as a COMMA STRING", async () => {
    const { impl, calls } = fetchStub([{ body: { iid: 12, web_url: "https://gitlab.com/g/a/-/issues/12" } }]);
    const r = await createGitlabProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).create(T());
    expect(r).toMatchObject({ ok: true, id: "12" });
    const h = calls[0]?.init.headers as Record<string, string>;
    expect(h["PRIVATE-TOKEN"]).toBe("gl-s3cret");
    const sent = JSON.parse(calls[0]?.init.body as string);
    expect(sent.description).toBe("body");
    expect(sent.body).toBeUndefined();
    expect(sent.labels).toBe("accessibility,rgaa,bloquant");
  });

  it("paginates on the x-next-page header and stops when it is absent", async () => {
    const { impl, calls } = fetchStub([{ body: [{ title: "a", iid: 1 }], headers: { "x-next-page": "2" } }, { body: [{ title: "b", iid: 2 }] }]);
    const got = await createGitlabProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).list();
    expect(got.map((g) => g.title)).toEqual(["a", "b"]);
    expect(calls).toHaveLength(2);
  });

  // A bare 403 here looks like a config error and costs an afternoon.
  it("names CI_JOB_TOKEN as the cause when that is the token in play", async () => {
    const { impl } = fetchStub([{ ok: false, status: 403, body: { message: "403 Forbidden" } }]);
    const p = createGitlabProvider({ transport: "rest", env: { CI_JOB_TOKEN: "job", CI_PROJECT_ID: "1" }, fetchImpl: impl });
    const r = await p.create(T());
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("CI_JOB_TOKEN cannot create issues");
  });

  it("does NOT blame CI_JOB_TOKEN when a real token is configured", async () => {
    const { impl } = fetchStub([{ ok: false, status: 403, body: { message: "403 Forbidden" } }]);
    const r = await createGitlabProvider({ transport: "rest", env: REST_ENV, fetchImpl: impl }).create(T());
    expect(r.reason).not.toContain("CI_JOB_TOKEN");
  });
});

describe("CLI transport", () => {
  const p = () => createGitlabProvider({ transport: "cli", env: {}, cliAvailable: () => true });

  it("creates with --description and a comma-joined --label", async () => {
    exec.mockReturnValueOnce("");
    expect((await p().create(T())).ok).toBe(true);
    expect(argv(exec.mock.calls[0] as unknown[])).toEqual([
      "issue",
      "create",
      "--title",
      T().title,
      "--description",
      "body",
      "--label",
      "accessibility,rgaa,bloquant",
    ]);
  });

  it("lists every issue as json", async () => {
    exec.mockReturnValueOnce(JSON.stringify([{ title: "a" }]));
    expect(await p().list()).toEqual([{ title: "a" }]);
    expect(argv(exec.mock.calls[0] as unknown[])).toEqual(["issue", "list", "--all", "--output", "json"]);
  });

  // glab's flag surface is version-dependent; an unparseable listing must not take the run
  // down, it must degrade to "create everything".
  it("degrades to an empty list when glab output cannot be parsed", async () => {
    exec.mockReturnValueOnce("not json at all");
    expect(await p().list()).toEqual([]);
  });
});
