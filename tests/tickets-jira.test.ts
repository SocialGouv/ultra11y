import { describe, it, expect } from "vitest";
import { createJiraProvider, toAdf, JIRA_SCOPE_LABEL } from "../src/tickets/providers/jira.js";
import type { Ticket } from "../src/tickets/types.js";

const T = (over: Partial<Ticket> = {}): Ticket => ({
  title: "[a11y] WCAG 1.1.1 — Non-text Content",
  body: "line one\n\nline two",
  labels: ["accessibility", "wcag", "bloquant"],
  severity: "bloquant",
  advisory: false,
  scope: { grain: "criterion", criteriaId: "1.1.1" },
  ...over,
});

const ENV = { ULTRA11Y_JIRA_URL: "https://acme.atlassian.net", ULTRA11Y_JIRA_PROJECT: "A11Y", JIRA_EMAIL: "me@acme.com", JIRA_API_TOKEN: "j-s3cret" };

function fetchStub(responses: Array<{ ok?: boolean; status?: number; body?: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const r = responses.shift() ?? { ok: true, body: {} };
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      headers: new Headers(),
      text: async () => JSON.stringify(r.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("configuration", () => {
  it("is REST-only: --transport cli is a usage error, not a silent fallback", () => {
    const p = createJiraProvider({ transport: "cli", env: ENV });
    expect(p.available()).toBe(false);
    expect(p.unavailableReason()).toContain("no CLI transport");
  });

  it("asks for the site and the project by name", () => {
    expect(createJiraProvider({ env: {} }).unavailableReason()).toContain("ULTRA11Y_JIRA_URL");
    expect(createJiraProvider({ env: { ULTRA11Y_JIRA_URL: "https://x" } }).unavailableReason()).toContain("ULTRA11Y_JIRA_PROJECT");
  });

  it("builds Basic auth from email + api token (Cloud)", async () => {
    const { impl, calls } = fetchStub([{ body: { key: "A11Y-1" } }]);
    await createJiraProvider({ env: ENV, fetchImpl: impl }).create(T());
    const h = calls[0]?.init.headers as Record<string, string>;
    expect(h.Authorization).toBe(`Basic ${Buffer.from("me@acme.com:j-s3cret").toString("base64")}`);
  });

  it("falls back to a Bearer PAT (Server/DC)", async () => {
    const { impl, calls } = fetchStub([{ body: { key: "A11Y-1" } }]);
    const env = { ULTRA11Y_JIRA_URL: "https://jira.acme.com", ULTRA11Y_JIRA_PROJECT: "A11Y", JIRA_TOKEN: "pat" };
    await createJiraProvider({ env, fetchImpl: impl }).create(T());
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer pat");
  });

  it("never echoes a credential in the unavailable reason", () => {
    const p = createJiraProvider({ env: { JIRA_API_TOKEN: "j-s3cret" } });
    expect(p.unavailableReason()).not.toContain("j-s3cret");
  });
});

describe("the ADF renderer", () => {
  it("emits one paragraph per non-empty line, text verbatim", () => {
    const doc = toAdf("a\n\nb") as { type: string; content: Array<{ content: Array<{ text: string }> }> };
    expect(doc.type).toBe("doc");
    expect(doc.content).toHaveLength(2);
    expect(doc.content.map((p) => p.content[0]?.text)).toEqual(["a", "b"]);
  });

  it("never produces an empty document, which Jira rejects", () => {
    const doc = toAdf("") as { content: unknown[] };
    expect(doc.content).toHaveLength(1);
  });
});

describe("creating an issue", () => {
  it("posts v3 with an ADF description by default", async () => {
    const { impl, calls } = fetchStub([{ body: { key: "A11Y-7" } }]);
    const r = await createJiraProvider({ env: ENV, fetchImpl: impl }).create(T());
    expect(r).toMatchObject({ ok: true, id: "A11Y-7", url: "https://acme.atlassian.net/browse/A11Y-7" });
    expect(calls[0]?.url).toContain("/rest/api/3/issue");
    const f = JSON.parse(calls[0]?.init.body as string).fields;
    expect(f.project).toEqual({ key: "A11Y" });
    expect(f.summary).toBe(T().title);
    expect(f.issuetype).toEqual({ name: "Task" });
    expect(f.description.type).toBe("doc");
    expect(f.priority).toEqual({ name: "Highest" });
    expect(f.labels).toContain(JIRA_SCOPE_LABEL);
  });

  it("sends the markdown as a plain string when ULTRA11Y_JIRA_API=2", async () => {
    const { impl, calls } = fetchStub([{ body: { key: "A11Y-8" } }]);
    await createJiraProvider({ env: { ...ENV, ULTRA11Y_JIRA_API: "2" }, fetchImpl: impl }).create(T());
    expect(calls[0]?.url).toContain("/rest/api/2/issue");
    expect(JSON.parse(calls[0]?.init.body as string).fields.description).toBe("line one\n\nline two");
  });

  it("maps severity onto a Jira priority", async () => {
    const { impl, calls } = fetchStub([{ body: { key: "A" } }, { body: { key: "B" } }]);
    const p = createJiraProvider({ env: ENV, fetchImpl: impl });
    await p.create(T({ severity: "majeur" }));
    await p.create(T({ severity: "mineur" }));
    expect(JSON.parse(calls[0]?.init.body as string).fields.priority).toEqual({ name: "High" });
    expect(JSON.parse(calls[1]?.init.body as string).fields.priority).toEqual({ name: "Low" });
  });

  it("honours a custom issue type", async () => {
    const { impl, calls } = fetchStub([{ body: { key: "A" } }]);
    await createJiraProvider({ env: { ...ENV, ULTRA11Y_JIRA_ISSUE_TYPE: "Bug" }, fetchImpl: impl }).create(T());
    expect(JSON.parse(calls[0]?.init.body as string).fields.issuetype).toEqual({ name: "Bug" });
  });

  // A project that has not configured `priority` 400s. Shed the optional field, keep the ticket.
  it("retries without priority, then without labels, on a 400", async () => {
    const { impl, calls } = fetchStub([
      { ok: false, status: 400, body: { errors: { priority: "Field 'priority' cannot be set" } } },
      { ok: false, status: 400, body: { errors: { labels: "Field 'labels' cannot be set" } } },
      { body: { key: "A11Y-9" } },
    ]);
    const r = await createJiraProvider({ env: ENV, fetchImpl: impl }).create(T());
    expect(r).toMatchObject({ ok: true, id: "A11Y-9" });
    expect(JSON.parse(calls[1]?.init.body as string).fields.priority).toBeUndefined();
    expect(JSON.parse(calls[2]?.init.body as string).fields.labels).toBeUndefined();
  });

  it("stops immediately on a non-400 and surfaces Jira's own message", async () => {
    const { impl, calls } = fetchStub([{ ok: false, status: 401, body: { errorMessages: ["Client must be authenticated"] } }]);
    const r = await createJiraProvider({ env: ENV, fetchImpl: impl }).create(T());
    expect(r).toMatchObject({ ok: false, reason: "Client must be authenticated" });
    expect(calls).toHaveLength(1);
  });

  it("strips spaces from labels, which Jira forbids", async () => {
    const { impl, calls } = fetchStub([{ body: { key: "A" } }]);
    await createJiraProvider({ env: ENV, fetchImpl: impl }).create(T({ labels: ["needs triage"] }));
    expect(JSON.parse(calls[0]?.init.body as string).fields.labels).toContain("needs-triage");
  });
});

describe("de-dupe", () => {
  it("scopes the JQL by the constant label and asks only for the summary", async () => {
    const { impl, calls } = fetchStub([{ body: { issues: [{ key: "A11Y-1", fields: { summary: "one" } }] } }]);
    const got = await createJiraProvider({ env: ENV, fetchImpl: impl }).list();
    expect(got).toEqual([{ title: "one", id: "A11Y-1", url: "https://acme.atlassian.net/browse/A11Y-1" }]);
    const url = decodeURIComponent(calls[0]?.url ?? "");
    expect(url).toContain(`labels = "${JIRA_SCOPE_LABEL}"`);
    expect(url).toContain('project = "A11Y"');
    expect(calls[0]?.url).toContain("fields=summary");
  });

  it("degrades to an empty list when the search fails", async () => {
    const { impl } = fetchStub([{ ok: false, status: 500, body: {} }]);
    expect(await createJiraProvider({ env: ENV, fetchImpl: impl }).list()).toEqual([]);
  });
});
