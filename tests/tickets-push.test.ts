// The driver, exercised against an in-memory fake provider. No vi.mock: `planPush` is pure
// and `pushTickets` only ever touches the TicketProvider interface, which is the point.
import { describe, it, expect } from "vitest";
import { planPush, pushTickets } from "../src/tickets/push.js";
import type { CreateOutcome, ExistingTicket, Ticket, TicketProvider } from "../src/tickets/types.js";

const T = (title: string): Ticket => ({
  title,
  body: "b",
  labels: ["accessibility"],
  severity: "bloquant",
  advisory: false,
  scope: { grain: "criterion", criteriaId: "1.1.1" },
});

interface FakeOpts {
  existing?: string[];
  listThrows?: boolean;
  fail?: (t: Ticket) => string | undefined;
}

function fake(opts: FakeOpts = {}): TicketProvider & { created: string[] } {
  const created: string[] = [];
  return {
    id: "github",
    transport: "rest",
    capabilities: { bodyLimit: 65536, labels: true },
    available: () => true,
    unavailableReason: () => undefined,
    created,
    list: async (): Promise<ExistingTicket[]> => {
      if (opts.listThrows) throw new Error("boom");
      return (opts.existing ?? []).map((title) => ({ title }));
    },
    create: async (t: Ticket): Promise<CreateOutcome> => {
      const reason = opts.fail?.(t);
      if (reason) return { ok: false, reason };
      created.push(t.title);
      return { ok: true, url: `https://x/${created.length}` };
    },
  };
}

describe("planPush is pure and exact", () => {
  it("skips a title that already exists and keeps the rest", () => {
    const plan = planPush([T("a"), T("b")], [{ title: "a" }]);
    expect(plan.map((p) => p.action)).toEqual(["skip", "create"]);
  });

  it("matches EXACTLY — a near-miss is a different ticket, not the same one", () => {
    const plan = planPush([T("[a11y] WCAG 1.1.1 — Contenu")], [{ title: "[a11y] WCAG 1.1.1 - Contenu" }]);
    expect(plan[0]?.action).toBe("create");
  });

  it("de-dupes WITHIN one run, so a repeated title creates once", () => {
    const plan = planPush([T("a"), T("a")], []);
    expect(plan.map((p) => p.action)).toEqual(["create", "skip"]);
  });

  it("preserves input order", () => {
    const plan = planPush([T("c"), T("a"), T("b")], []);
    expect(plan.map((p) => p.ticket.title)).toEqual(["c", "a", "b"]);
  });
});

describe("pushTickets", () => {
  it("creates the planned tickets and reports urls", async () => {
    const p = fake();
    const { result } = await pushTickets([T("a"), T("b")], p);
    expect(result.created).toBe(2);
    expect(result.createdTitles).toEqual(["a", "b"]);
    expect(result.createdUrls).toHaveLength(2);
    expect(p.created).toEqual(["a", "b"]);
  });

  it("skips what already exists", async () => {
    const p = fake({ existing: ["a"] });
    const { result } = await pushTickets([T("a"), T("b")], p);
    expect(result).toMatchObject({ created: 1, skipped: 1, failed: 0 });
    expect(p.created).toEqual(["b"]);
  });

  // A duplicate ticket is a far smaller harm than dropping the whole backlog.
  it("degrades to CREATE when the listing fails, rather than losing the backlog", async () => {
    const p = fake({ listThrows: true });
    const { result, dedupeChecked } = await pushTickets([T("a")], p);
    expect(dedupeChecked).toBe(false);
    expect(result.created).toBe(1);
  });

  it("accounts failures and de-duplicates their reasons", async () => {
    const p = fake({ fail: () => "403 Forbidden" });
    const { result } = await pushTickets([T("a"), T("b")], p);
    expect(result).toMatchObject({ created: 0, failed: 2 });
    expect(result.errors).toEqual(["403 Forbidden"]);
  });

  it("survives a provider that throws instead of returning a failure", async () => {
    const p = fake();
    p.create = async () => {
      throw new Error("network down\nstack noise");
    };
    const { result } = await pushTickets([T("a")], p);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual(["network down"]);
  });

  it("creates NOTHING under dry-run, but still reports a real skip count", async () => {
    const p = fake({ existing: ["a"] });
    const { plan, result, dedupeChecked } = await pushTickets([T("a"), T("b")], p, { dryRun: true });
    expect(p.created).toEqual([]);
    expect(result.created).toBe(0);
    expect(result.skipped).toBe(1);
    expect(dedupeChecked).toBe(true);
    expect(plan.map((x) => x.action)).toEqual(["skip", "create"]);
  });

  it("does not call the provider at all for an empty ticket list", async () => {
    const p = fake();
    p.list = async () => {
      throw new Error("must not be called");
    };
    const { result } = await pushTickets([], p);
    expect(result.created).toBe(0);
  });
});
