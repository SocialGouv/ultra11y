// THE REFUTATION PASS, EXERCISED WITHOUT INVOKING A MODEL.
//
// `verify --report` has always written a worklist for a human or a session agent to fill, and
// `orchestrate --phase verify-report` fans it out to a harness's subagents. Neither is a
// command a pipeline can run — so no pipeline ran one, and the pass that catches an
// over-accusing adjudicator was the only pass in the tool nothing could invoke. This is the
// backend that fixes it, on the same transport, the same bounds and the same retry policy as
// the adjudication pass.
import { describe, expect, it, vi } from "vitest";
import { refuteBatchCli } from "../src/agent-cli.js";
import { refuteSchema, refuteSystemPrompt, type VerifyItem } from "../src/verify.js";
import type { LlmOptions } from "../src/llm.js";

const item = (n: number, kind: "nc" | "c" = "nc"): VerifyItem => ({
  n,
  criteriaId: "11.2",
  file: "page.html",
  line: 12,
  selector: "input#email",
  claim: "étiquette non pertinente",
  verdict: null,
  note: "",
  kind,
});

const envelope = (result: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ is_error: false, subtype: "success", total_cost_usd: 0.0031, num_turns: 1, permission_denials: [], result, ...over });

const ok = (result: string, over: Record<string, unknown> = {}) =>
  vi.fn(async (_argv: string[], _stdin: string, _timeoutMs?: number) => ({ code: 0, stdout: envelope(result, over), stderr: "" }));

const base: LlmOptions = { backoffMs: () => 0 };

describe("refuteSchema pins what may come back", () => {
  const schema = refuteSchema([item(1), item(2)]) as {
    properties: { verdicts: { items: { properties: { n: { enum: number[] }; verdict: { enum: string[] } }; required: string[] } } };
  };

  it("enumerates the item numbers actually handed over", () => {
    expect(schema.properties.verdicts.items.properties.n.enum).toEqual([1, 2]);
  });

  it("enumerates the verdict vocabulary — the same four the gate reads", () => {
    expect(schema.properties.verdicts.items.properties.verdict.enum).toEqual(["supported", "partial", "refuted", "unsupported"]);
  });

  it("requires a note, because a verdict with no reading behind it is a coin toss", () => {
    expect(schema.properties.verdicts.items.required).toContain("note");
  });
});

describe("refuteSystemPrompt states the job", () => {
  for (const lang of ["fr", "en"] as const) {
    it(`asks the INVERTED question of a claimed conformity (${lang})`, () => {
      expect(refuteSystemPrompt(lang)).toMatch(lang === "fr" ? /INVERSE/ : /INVERTED/);
    });

    it(`asks whether the observation is attached to the right criterion (${lang})`, () => {
      expect(refuteSystemPrompt(lang)).toMatch(lang === "fr" ? /RATTACHEMENT/ : /ATTACHMENT/);
    });

    // The asymmetry that makes this pass worth paying for: an observation wrongly withdrawn
    // costs a second look, an observation wrongly kept ships in a legal deliverable.
    it(`tells the reviewer to refute when in doubt (${lang})`, () => {
      expect(refuteSystemPrompt(lang)).toMatch(lang === "fr" ? /doute, réfutez/i : /doubt, refute/i);
    });

    it(`forbids editing anything (${lang})`, () => {
      expect(refuteSystemPrompt(lang)).toMatch(lang === "fr" ? /Ne réécrivez rien/i : /Rewrite nothing/i);
    });
  }
});

describe("refuteBatchCli", () => {
  it("reads the verdicts out of the CLI's structured output", async () => {
    const spawnImpl = ok("", { structured_output: { verdicts: [{ n: 1, verdict: "refuted", note: "l'élément cité est conforme" }] } });
    const out = await refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl });
    expect(out).toEqual([{ n: 1, verdict: "refuted", note: "l'élément cité est conforme" }]);
  });

  it("falls back to parsing the final message, for a CLI too old for --json-schema", async () => {
    const spawnImpl = ok('```json\n{"verdicts":[{"n":1,"verdict":"supported","note":"réel"}]}\n```');
    const out = await refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl });
    expect(out[0]?.verdict).toBe("supported");
  });

  it("drops a verdict for an item it was never given — a silent mismatch is worse than a gap", async () => {
    const spawnImpl = ok("", { structured_output: { verdicts: [{ n: 99, verdict: "refuted", note: "" }] } });
    expect(await refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl })).toEqual([]);
  });

  it("reports what it cost, through the same channel the adjudication pass uses", async () => {
    let spent = 0;
    const spawnImpl = ok("", { structured_output: { verdicts: [{ n: 1, verdict: "partial", note: "" }] } });
    await refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl, onCost: (c) => (spent += c) });
    expect(spent).toBeCloseTo(0.0031, 6);
  });

  it("grants read tools only, and never Edit or Write", async () => {
    let argv: string[] = [];
    const spawnImpl = vi.fn(async (a: string[]) => {
      argv = a;
      return { code: 0, stdout: envelope("", { structured_output: { verdicts: [] } }), stderr: "" };
    });
    await refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl });
    const tools = argv[argv.indexOf("--allowedTools") + 1] ?? "";
    expect(tools).not.toMatch(/Edit|Write|Bash/);
    expect(tools).toMatch(/Read/);
  });

  it("treats the audited repository as untrusted, exactly as the adjudication pass does", async () => {
    let argv: string[] = [];
    const spawnImpl = vi.fn(async (a: string[]) => {
      argv = a;
      return { code: 0, stdout: envelope("", { structured_output: { verdicts: [] } }), stderr: "" };
    });
    await refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl });
    expect(argv).toContain("--safe-mode");
    expect(argv).toContain("--strict-mcp-config");
  });

  it("honours the dollar ceiling when one is set", async () => {
    let argv: string[] = [];
    const spawnImpl = vi.fn(async (a: string[]) => {
      argv = a;
      return { code: 0, stdout: envelope("", { structured_output: { verdicts: [] } }), stderr: "" };
    });
    await refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl, maxBudgetUsd: 0.25 });
    expect(argv.join(" ")).toContain("--max-budget-usd 0.25");
  });

  it("refuses prose instead of verdicts, rather than reading a review out of a paragraph", async () => {
    await expect(refuteBatchCli([item(1)], "worklist", { ...base, spawnImpl: ok("I reviewed the item and it looks fine.") })).rejects.toThrow(
      /without a verdicts object/,
    );
  });
});
