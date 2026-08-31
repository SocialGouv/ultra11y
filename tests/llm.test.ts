import { describe, it, expect } from "vitest";
import {
  BATCH_SIZE,
  BudgetExceededError,
  DEFAULT_MODEL,
  applyRawVerdicts,
  batchWorklist,
  judgeAll,
  judgeBatch,
  modelFromEnv,
  type RawVerdict,
} from "../src/llm.js";
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

  // The one knob that lets this tier point somewhere other than api.anthropic.com — a
  // gateway, a corporate proxy, a recorded stand-in. It was implemented and untested, which
  // is the state in which a refactor removes something quietly: every existing test injects
  // `fetchImpl` and so never looks at the URL at all.
  it("honours an explicit base URL, then ANTHROPIC_BASE_URL, then the real API", async () => {
    const items = [item("1.1.1")];
    const seen: string[] = [];
    const impl = (async (url: string) => {
      seen.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => toolReply([])(),
        text: async () => "",
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await judgeBatch(items, "p", { apiKey: "k", fetchImpl: impl, baseUrl: "https://gateway.interne" });
    expect(seen.at(-1)).toBe("https://gateway.interne/v1/messages");

    const previous = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:8971";
    try {
      await judgeBatch(items, "p", { apiKey: "k", fetchImpl: impl });
      expect(seen.at(-1), "the environment override is ignored").toBe("http://127.0.0.1:8971/v1/messages");
      // An explicit option still wins over the environment.
      await judgeBatch(items, "p", { apiKey: "k", fetchImpl: impl, baseUrl: "https://gateway.interne" });
      expect(seen.at(-1)).toBe("https://gateway.interne/v1/messages");
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_BASE_URL;
      else process.env.ANTHROPIC_BASE_URL = previous;
    }

    await judgeBatch(items, "p", { apiKey: "k", fetchImpl: impl });
    expect(seen.at(-1), "the default must stay the real API").toBe("https://api.anthropic.com/v1/messages");
  });

  it("keeps an unknown verdict visible for the scheduler to diagnose", async () => {
    const items = [item("1.1.1")];
    const { impl } = fakeFetch(toolReply([{ criteriaId: "42.9", verdict: "C", justification: "x" }]));
    expect(await judgeBatch(items, "p", { apiKey: "k", fetchImpl: impl })).toEqual([{ criteriaId: "42.9", verdict: "C", justification: "x" }]);
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

  it("keeps every criterion exactly once at the 7/8/9 batch boundaries", () => {
    for (const count of [7, 8, 9]) {
      const items = Array.from({ length: count }, (_, i) => item(`x.${i + 1}`));
      const batches = batchWorklist(items, (slice) => slice.map((x) => x.criteriaId).join(","));
      const ids = batches.flatMap((batch) => batch.items.map((x) => x.criteriaId));
      expect(batches).toHaveLength(Math.ceil(count / BATCH_SIZE));
      expect(ids).toEqual(items.map((x) => x.criteriaId));
      expect(new Set(ids).size).toBe(count);
    }
  });

  it("refuses a duplicated worklist before any batch is rendered", () => {
    let rendered = 0;
    expect(() =>
      batchWorklist([item("1.1.1"), item("1.1.1")], () => {
        rendered++;
        return "prompt";
      }),
    ).toThrow(/duplicate criterion.*1\.1\.1/i);
    expect(rendered).toBe(0);
  });

  it("accepts valid partial results but diagnoses duplicate, unknown and missing ids", async () => {
    const items = [item("1.1.1"), item("1.3.1"), item("1.4.1")];
    const persisted: RawVerdict[][] = [];
    const r = await judgeAll([{ items, prompt: "a" }], {
      apiKey: "k",
      backend: async () => [
        { criteriaId: "1.1.1", verdict: "manual", reason: "undecidable" },
        { criteriaId: "1.1.1", verdict: "C", justification: "conflicting duplicate" },
        { criteriaId: "99.99", verdict: "manual", reason: "undecidable" },
        { criteriaId: "1.4.1", verdict: "manual", reason: "needs-rendered-dom" },
      ],
      onVerdicts: (landed) => persisted.push(landed),
    });

    expect(r.verdicts.map((v) => v.criteriaId)).toEqual(["1.4.1"]);
    expect(persisted.flat().map((v) => v.criteriaId)).toEqual(["1.4.1"]);
    expect(r.failures.join("\n")).toMatch(/duplicate.*1\.1\.1/i);
    expect(r.failures.join("\n")).toMatch(/unknown.*99\.99/i);
    expect(r.failures.join("\n")).toMatch(/missing.*1\.3\.1/i);
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

  it("does not choose a winner when a criterion has duplicate verdicts", () => {
    const items = [item("1.1.1")];
    expect(
      applyRawVerdicts(items, [
        { criteriaId: "1.1.1", verdict: "manual", reason: "undecidable" },
        { criteriaId: "1.1.1", verdict: "C", justification: "conflict" },
      ]),
    ).toBe(0);
    expect(items[0]!.verdict).toBeNull();
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

describe("`judge --max` and `--apply` together", () => {
  it("are still refused up front under --strict, where a bounded run genuinely cannot pass", async () => {
    // The all-or-nothing fold rejects an incomplete adjudication by design. Discovering that
    // AFTER paying for a full round of model calls is a bill for a guaranteed failure.
    const { execFileSync } = await import("node:child_process");
    const engine = new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
    const audit = new URL("./fixtures/", import.meta.url).pathname;
    let out = "";
    let code = 0;
    try {
      execFileSync(process.execPath, [engine, "judge", "--in", `${audit}judge-audit.json`, "--max", "2", "--apply", "--strict", "--lang", "en"], {
        encoding: "utf8",
        env: { ...process.env, ANTHROPIC_API_KEY: "sk-test" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status: number; stderr: string };
      code = err.status;
      out = err.stderr;
    }
    expect(code).toBe(2);
    expect(out).toMatch(/--apply --strict requires a COMPLETE adjudication/);
    // And it never reached the network: no batch was announced.
    expect(out).not.toMatch(/batch\(es\), model/);
  });

  // Without --strict the pair COMPOSES, and must not be turned away. The refusal above was
  // right only while the fold was all-or-nothing: a bounded run could then only ever fail the
  // coverage check. The fold is now per-verdict, so a bounded run lands what it covered —
  // which is exactly what someone bounding spend is asking for.
  it("compose without --strict: a bounded run is allowed to apply what it covered", async () => {
    const { execFileSync } = await import("node:child_process");
    const engine = new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
    const audit = new URL("./fixtures/", import.meta.url).pathname;
    let out = "";
    let code = 0;
    try {
      execFileSync(process.execPath, [engine, "judge", "--in", `${audit}judge-audit.json`, "--max", "2", "--apply", "--lang", "en"], {
        encoding: "utf8",
        // A minimal environment: `process.execPath` is absolute, so nothing else is needed, and
        // the key is the only thing this command reads from the environment.
        env: { ANTHROPIC_API_KEY: "sk-test" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      const err = e as { status: number; stderr: string };
      code = err.status;
      out = err.stderr;
    }
    // It may still fail LATER (the key is fake, so the calls do not resolve) — what matters is
    // that it was not refused up front for being bounded.
    expect(code).not.toBe(2);
    expect(out).not.toMatch(/requires a COMPLETE adjudication/);
  });
});

// SPLITTING A BATCH THE PROVIDER ABORTED ON ITS DOLLAR CEILING.
//
// `--max-budget-usd` bounds ONE invocation, so the same criteria split across two calls get two
// ceilings. That makes halving the right response to a budget abort, where retrying is not:
// a retry is the same work in a fresh process against a fresh ceiling, i.e. the same abort at
// full price. Measured on the run that motivated this — 30 invocations, $38.90, 12 verdicts
// kept out of 84 criteria, because every over-budget batch was discarded whole.
describe("judgeAll on a budget abort", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) => item(`1.1.${i + 1}`));
  const verdictsFor = (batch: AdjudicationItem[]): RawVerdict[] =>
    batch.map((it) => ({ criteriaId: it.criteriaId, verdict: "manual", reason: "undecidable" }) as unknown as RawVerdict);

  it("halves the batch and rules on the halves instead of losing all eight", async () => {
    const sizes: number[] = [];
    // Refuses anything wider than four, exactly as a real ceiling does on a batch that is too
    // much work for it — and rules normally once the halves are small enough.
    const backend = async (batch: AdjudicationItem[]): Promise<RawVerdict[]> => {
      sizes.push(batch.length);
      if (batch.length > 4) throw new BudgetExceededError("ultra11y judge: the CLI reported an error (error_max_budget_usd).");
      return verdictsFor(batch);
    };
    const r = await judgeAll([{ items: items(8), prompt: "p" }], { backend, render: (s) => `p:${s.length}`, concurrency: 1 });
    expect(sizes).toEqual([8, 4, 4]);
    expect(r.verdicts).toHaveLength(8);
    expect(r.failures).toEqual([]);
  });

  it("re-renders each half rather than reusing the prompt of the batch it came from", async () => {
    const prompts: string[] = [];
    const backend = async (batch: AdjudicationItem[], prompt: string): Promise<RawVerdict[]> => {
      prompts.push(prompt);
      if (batch.length > 1) throw new BudgetExceededError("error_max_budget_usd");
      return verdictsFor(batch);
    };
    await judgeAll([{ items: items(2), prompt: "WHOLE" }], { backend, render: (s) => `HALF:${s[0]?.criteriaId}`, concurrency: 1 });
    expect(prompts).toEqual(["WHOLE", "HALF:1.1.1", "HALF:1.1.2"]);
  });

  // The floor. One criterion that still overruns is a real failure, and it is reported as one
  // — never split forever, never silently dropped.
  it("reports a single criterion that still overruns, and loses only that one", async () => {
    const backend = async (batch: AdjudicationItem[]): Promise<RawVerdict[]> => {
      // The pair overruns, and so does 1.1.2 on its own — 1.1.1 is the only thing that fits.
      if (batch.length > 1 || batch[0]?.criteriaId === "1.1.2") throw new BudgetExceededError("error_max_budget_usd");
      return verdictsFor(batch);
    };
    const r = await judgeAll([{ items: items(2), prompt: "p" }], { backend, render: (s) => `p:${s.length}`, concurrency: 1 });
    expect(r.verdicts.map((v) => v.criteriaId)).toEqual(["1.1.1"]);
    expect(r.failures.join(" ")).toContain("error_max_budget_usd");
  });

  // Without a renderer there is no way to prompt a half, so the old behaviour stands rather
  // than a batch being sent under someone else's prompt.
  it("keeps the whole-batch loss when no renderer was supplied", async () => {
    const backend = async (): Promise<RawVerdict[]> => {
      throw new BudgetExceededError("error_max_budget_usd");
    };
    const r = await judgeAll([{ items: items(8), prompt: "p" }], { backend, concurrency: 1 });
    expect(r.verdicts).toHaveLength(0);
    expect(r.failures).toHaveLength(1);
  });
});
