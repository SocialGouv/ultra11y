import { describe, it, expect } from "vitest";
import { BATCH_SIZE, DEFAULT_MODEL, applyRawVerdicts, judgeAll, judgeBatch, modelFromEnv, type RawVerdict } from "../src/llm.js";
import { applyAdjudication, buildAdjudicationWorklist, formatAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { SCHEMA_VERSION } from "../src/types.js";

// `judge` is a CALLER, not a second judge: the worklist, the prompt and the gate all come
// from `verify --manual`'s machinery. So what is worth testing here is exactly that — that
// nothing a model returns can get past the gate an agent's verdicts pass, and that the
// transport fails loudly rather than quietly returning fewer verdicts than it claims.

const audit = () => runAudit({ inputs: ["-"], stdin: '<html lang="fr"><head><title>t</title></head><body><img src="a.png" alt="a"></body></html>' });

/** A stand-in Messages endpoint. No network, no key, no server. */
function fakeFetch(reply: (body: Record<string, unknown>) => unknown, status = 200, headers: Record<string, string> = {}) {
  const calls: Record<string, unknown>[] = [];
  const impl = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    calls.push(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k: string) => headers[k] ?? null },
      json: async () => reply(body),
      text: async () => JSON.stringify(reply(body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const toolReply = (verdicts: RawVerdict[]) => () => ({ content: [{ type: "tool_use", name: "record_verdicts", input: { verdicts } }] });

const item = (criteriaId: string): AdjudicationItem => ({
  criteriaId,
  automatability: "judgment",
  evidence: [],
  verdict: null,
  justification: "",
  reason: null,
  findings: [],
  decidedBy: "agent",
});

describe("judgeBatch", () => {
  it("sends the worklist itself as the prompt — there is no second protocol to keep in step", async () => {
    const items = buildAdjudicationWorklist(audit()).slice(0, 2);
    const prompt = formatAdjudication(items, "en");
    const { impl, calls } = fakeFetch(toolReply(items.map((i) => ({ criteriaId: i.criteriaId, verdict: "manual", reason: "undecidable" }))));
    await judgeBatch(items, prompt, { apiKey: "k", fetchImpl: impl });
    expect(calls[0]!.messages).toEqual([{ role: "user", content: prompt }]);
    expect(calls[0]!.tool_choice).toEqual({ type: "tool", name: "record_verdicts" });
  });

  it("drops a verdict for a criterion nobody asked about", async () => {
    const items = [item("1.1.1")];
    const { impl } = fakeFetch(toolReply([{ criteriaId: "42.9", verdict: "C", justification: "x" }]));
    expect(await judgeBatch(items, "p", { apiKey: "k", fetchImpl: impl })).toEqual([]);
  });

  it("refuses prose instead of parsing it into verdicts", async () => {
    const { impl } = fakeFetch(() => ({ content: [{ type: "text" }] }));
    await expect(judgeBatch([item("1.1.1")], "p", { apiKey: "k", fetchImpl: impl })).rejects.toThrow(/did not return the verdicts tool call/);
  });

  it("uses the configured model, else the env, else the default", async () => {
    const { impl, calls } = fakeFetch(toolReply([]));
    await judgeBatch([item("1.1.1")], "p", { apiKey: "k", model: "claude-opus-5", fetchImpl: impl });
    expect(calls[0]!.model).toBe("claude-opus-5");
    await judgeBatch([item("1.1.1")], "p", { apiKey: "k", fetchImpl: impl });
    expect(calls[1]!.model).toBe(modelFromEnv());
    expect(modelFromEnv()).toBe(DEFAULT_MODEL);
  });

  it("gives up on a 4xx rather than retrying what will fail identically", async () => {
    const { impl, calls } = fakeFetch(() => ({ error: "bad key" }), 401);
    await expect(judgeBatch([item("1.1.1")], "p", { apiKey: "k", fetchImpl: impl })).rejects.toThrow(/HTTP 401/);
    expect(calls).toHaveLength(1);
  });
});

describe("judgeAll", () => {
  it("reports a failed batch instead of dying, so one transient fault does not lose the run", async () => {
    let n = 0;
    const impl = (async () => {
      n++;
      if (n === 1) throw new Error("socket hang up");
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => toolReply([{ criteriaId: "1.1.1", verdict: "manual", reason: "undecidable" }])(),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const r = await judgeAll([{ items: [item("1.1.1")], prompt: "a" }], { apiKey: "k", fetchImpl: impl, backoffMs: () => 0 });
    // Retried, then succeeded — the batch is not lost to one dropped socket.
    expect(r.verdicts).toHaveLength(1);
    expect(r.failures).toEqual([]);
  });

  it("collects the failure when every attempt fails, leaving those criteria unadjudicated", async () => {
    const impl = (async () => {
      throw new Error("ENETDOWN");
    }) as unknown as typeof fetch;
    const r = await judgeAll([{ items: [item("1.1.1")], prompt: "a" }], { apiKey: "k", fetchImpl: impl, backoffMs: () => 0 });
    expect(r.verdicts).toEqual([]);
    expect(r.failures[0]).toMatch(/ENETDOWN/);
  });

  it("batches by the same size orchestrate fans out at", () => {
    expect(BATCH_SIZE).toBe(8);
  });
});

describe("applyRawVerdicts", () => {
  it("leaves an unanswered item blank, so the COVERAGE gate is what refuses it", () => {
    const items = [item("1.1.1"), item("1.3.1")];
    expect(applyRawVerdicts(items, [{ criteriaId: "1.1.1", verdict: "C", justification: "alt is descriptive" }])).toBe(1);
    expect(items[1]!.verdict).toBeNull();
  });

  it("keeps findings only for NC and a reason only for manual", () => {
    const items = [item("1.1.1"), item("1.3.1")];
    applyRawVerdicts(items, [
      { criteriaId: "1.1.1", verdict: "C", justification: "ok", reason: "undecidable", findings: [{ file: "a", line: 1, message: "m" }] },
      { criteriaId: "1.3.1", verdict: "manual", reason: "needs-rendered-dom" },
    ]);
    expect(items[0]!.reason).toBeNull();
    expect(items[0]!.findings).toEqual([]);
    expect(items[1]!.reason).toBe("needs-rendered-dom");
  });
});

describe("a model cannot get past the gate an agent's verdicts pass", () => {
  const gateOf = (verdicts: RawVerdict[]) => {
    const a = audit();
    const items = buildAdjudicationWorklist(a);
    applyRawVerdicts(items, verdicts);
    const adj: AdjudicationFile = { tool: "ultra11y", kind: "adjudication", schemaVersion: SCHEMA_VERSION, standard: "wcag", auditDate: a.date, items };
    return applyAdjudication(a, adj);
  };
  const allIds = () => buildAdjudicationWorklist(audit()).map((i) => i.criteriaId);

  it("refuses a blanket `conforming` with no justification", () => {
    const r = gateOf(allIds().map((criteriaId) => ({ criteriaId, verdict: "C" as const })));
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => /requires a justification/.test(i))).toBe(true);
  });

  it("refuses an NC that cites nothing", () => {
    const r = gateOf(allIds().map((criteriaId) => ({ criteriaId, verdict: "NC" as const })));
    expect(r.ok).toBe(false);
  });

  it("refuses an NC whose citation does not resolve against real source", () => {
    const ids = allIds();
    const r = gateOf(
      ids.map((criteriaId, i) =>
        i === 0
          ? { criteriaId, verdict: "NC" as const, findings: [{ file: "does/not/exist.html", line: 99, message: "m", normativeRef: criteriaId }] }
          : { criteriaId, verdict: "manual" as const, reason: "undecidable" },
      ),
    );
    expect(r.ok).toBe(false);
  });

  it("refuses an incomplete adjudication — a truncated run must not read as a finished one", () => {
    const r = gateOf(
      allIds()
        .slice(0, 1)
        .map((criteriaId) => ({ criteriaId, verdict: "manual" as const, reason: "undecidable" })),
    );
    expect(r.ok).toBe(false);
  });

  it("accepts an honest all-manual adjudication, which is a correct answer", () => {
    const r = gateOf(allIds().map((criteriaId) => ({ criteriaId, verdict: "manual" as const, reason: "undecidable" })));
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(0);
    expect(r.stillManual).toBeGreaterThan(0);
  });
});
