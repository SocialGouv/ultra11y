// The CLI adjudication backend, exercised WITHOUT invoking a model.
//
// `spawnImpl` is to this backend what `fetchImpl` is to the Messages one: the whole path —
// argv assembly, envelope parsing, the refusal of prose, retries, cost accounting — is
// reachable from a fake process. What a unit test cannot prove is the authentication and the
// model's behaviour on a real brief; that needs a real run, and it is the only part that does.
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CLI_MODEL, EFFORT_LEVELS, batchSchema, cliArgv, judgeBatchCli, reconcileIds, verdictsFromText } from "../src/agent-cli.js";
import type { AdjudicationItem } from "../src/adjudicate.js";
import type { LlmOptions } from "../src/llm.js";
import { verdictSystemPrompt } from "../src/verdict-rules.js";

const item = (criteriaId: string): AdjudicationItem => ({ criteriaId, evidence: [], verdict: "" }) as unknown as AdjudicationItem;

/** A successful envelope, in the shape the real CLI emits (probed, not guessed). */
const envelope = (result: string, over: Record<string, unknown> = {}): string =>
  JSON.stringify({ is_error: false, subtype: "success", total_cost_usd: 0.0141, num_turns: 1, permission_denials: [], result, ...over });

const ok = (result: string, over: Record<string, unknown> = {}) =>
  vi.fn(async (_argv: string[], _stdin: string, _timeoutMs?: number) => ({ code: 0, stdout: envelope(result, over), stderr: "" }));

const VERDICTS = '{"verdicts":[{"criteriaId":"1.1.1","verdict":"manual","reason":"undecidable"}]}';
const base: LlmOptions = { backoffMs: () => 0 };
const ITEMS = [item("1.1.1")];

describe("cliArgv", () => {
  it("asks for JSON, head-less, on a stated model", () => {
    const argv = cliArgv(base, ITEMS);
    expect(argv).toContain("-p");
    expect(argv.join(" ")).toContain("--output-format json");
    expect(argv.join(" ")).toContain(`--model ${DEFAULT_CLI_MODEL}`);
  });

  // The CLI's own default is Opus: $0.164 for a one-turn probe against $0.014 for Haiku.
  // Inheriting it would multiply a per-criterion run by twelve for no decision quality.
  it("states a model rather than inheriting the CLI's Opus default", () => {
    expect(DEFAULT_CLI_MODEL).toMatch(/haiku/i);
    expect(cliArgv({ ...base, model: "claude-sonnet-5" }, ITEMS).join(" ")).toContain("--model claude-sonnet-5");
  });

  // The audited source is not this tier's business. Answering on stdout is what lets the
  // grant be read-only at all — claude-code-action has to allow Write, and measured 17
  // permission denials for it.
  it("grants read tools only — never Edit or Write", () => {
    const tools = cliArgv(base, ITEMS)[cliArgv(base, ITEMS).indexOf("--allowedTools") + 1] ?? "";
    expect(tools).toBe("Read,Grep,Glob");
    expect(cliArgv(base, ITEMS).join(" ")).not.toMatch(/\bEdit\b|\bWrite\b/);
  });

  it("passes a dollar ceiling only when asked", () => {
    expect(cliArgv(base, ITEMS).join(" ")).not.toContain("--max-budget-usd");
    expect(cliArgv({ ...base, maxBudgetUsd: 1.5 }, ITEMS).join(" ")).toContain("--max-budget-usd 1.5");
  });

  // THE LEVER THAT IS NOT THE MODEL. What reaches this tier is what no engine could decide, so
  // how hard the model is asked to think moves verdicts without moving the bill to a bigger
  // tier. Unlike `--max-turns` below, `--effort` IS a flag of this CLI — hence passed, not
  // refused. Unset stays unset: inheriting the harness default is the documented behaviour.
  it("passes a reasoning effort only when asked", () => {
    expect(cliArgv(base, ITEMS).join(" ")).not.toContain("--effort");
    expect(cliArgv({ ...base, effort: "high" }, ITEMS).join(" ")).toContain("--effort high");
  });

  it("enumerates the levels the CLI documents, so a typo can be refused before it is swallowed", () => {
    expect(EFFORT_LEVELS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  // THE BOUND THAT ISN'T ONE. `--max-turns` is not a flag of this CLI, and the CLI swallows
  // unknown flags in silence — verified: `claude --definitely-not-a-real-flag --version`
  // exits 0 and prints the version. Passing it would read as a turn budget in every log and
  // every doc, and be an unbounded run. The bounds that exist are the dollar ceiling the CLI
  // documents and the wall clock we enforce ourselves.
  it("never passes --max-turns, which this CLI would swallow in silence", () => {
    expect(cliArgv({ ...base, maxBudgetUsd: 1 }, ITEMS).join(" ")).not.toContain("--max-turns");
  });

  // The audited repository is untrusted content: its CLAUDE.md, hooks, skills and MCP servers
  // would otherwise load into the session that rules on it.
  it("refuses the audited repository's own customizations", () => {
    const argv = cliArgv(base, ITEMS).join(" ");
    expect(argv).toContain("--safe-mode");
    expect(argv).toContain("--strict-mcp-config");
  });

  // The same system prompt the Messages backend sends — not a paraphrase, and not a second
  // protocol invented for this transport.
  it("sends the shared system prompt and the shared schema", () => {
    const argv = cliArgv(base, ITEMS);
    expect(argv[argv.indexOf("--system-prompt") + 1]).toBe(verdictSystemPrompt());
    expect(JSON.parse(argv[argv.indexOf("--json-schema") + 1] as string)).toEqual(batchSchema(ITEMS));
  });
});

describe("verdictsFromText", () => {
  it("reads a bare object", () => {
    expect(verdictsFromText(VERDICTS)).toHaveLength(1);
  });

  it("reads it out of a code fence", () => {
    expect(verdictsFromText("```json\n" + VERDICTS + "\n```")).toHaveLength(1);
  });

  it("reads it out of a sentence", () => {
    expect(verdictsFromText(`Here are my verdicts:\n${VERDICTS}\nLet me know.`)).toHaveLength(1);
  });

  // Same refusal as the Messages backend on a response that skipped the tool call: prose is
  // not an adjudication, and parsing prose into verdicts would invent them.
  it("refuses prose instead of guessing at it", () => {
    expect(() => verdictsFromText("I reviewed the criteria and they all look fine.")).toThrow(/without a verdicts object/);
  });
});

describe("judgeBatchCli", () => {
  it("sends the rendered worklist on stdin, not in argv", async () => {
    const run = ok(VERDICTS);
    await judgeBatchCli([item("1.1.1")], "WORKLIST_PAYLOAD_SENTINEL", { ...base, spawnImpl: run });
    const [argv, input] = run.mock.calls[0] as unknown as [string[], string];
    expect(input).toBe("WORKLIST_PAYLOAD_SENTINEL");
    expect(argv.join(" ")).not.toContain("WORKLIST_PAYLOAD_SENTINEL");
  });

  it("reports what the invocation actually cost", async () => {
    const spent: number[] = [];
    await judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: ok(VERDICTS), onCost: (u) => spent.push(u) });
    expect(spent).toEqual([0.0141]);
  });

  // The gate downstream would refuse it anyway; dropping it here keeps the failure legible.
  it("drops a verdict for a criterion nobody asked about", async () => {
    const stray = '{"verdicts":[{"criteriaId":"1.1.1","verdict":"manual"},{"criteriaId":"9.9.9","verdict":"C"}]}';
    const out = await judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: ok(stray) });
    expect(out.map((v) => v.criteriaId)).toEqual(["1.1.1"]);
  });

  // A denial means the adjudicator was refused a file it went looking for, so its verdicts
  // are about less than it tried to read. Folding that quietly is how a run looks complete.
  it("refuses a run that was denied tool calls", async () => {
    const denied = ok(VERDICTS, { permission_denials: [{ tool: "Read" }] });
    await expect(judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: denied })).rejects.toThrow(/denied 1 tool call/);
  });

  it("retries a rate limit and lands the verdicts", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: envelope("", { is_error: true, subtype: "error", api_error_status: 429 }), stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: envelope(VERDICTS), stderr: "" });
    const out = await judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: run });
    expect(out).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(2);
  });

  // Every transient fault still returns a well-formed envelope, so NO envelope means the
  // binary is missing or the install is broken. Retrying that four times changes nothing and
  // buries the cause under three more failures.
  it("reports a missing binary whole instead of retrying it away", async () => {
    const run = vi.fn(async () => ({ code: 127, stdout: "", stderr: "claude: command not found" }));
    await expect(judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: run })).rejects.toThrow(/command not found/);
    expect(run, "a missing binary was retried").toHaveBeenCalledTimes(1);
  });
});

describe("the bounds that are real", () => {
  // Retrying a timeout is asking for twice the ceiling we deliberately set.
  it("never retries a wall-clock kill", async () => {
    const run = vi.fn(async () => ({ code: null, stdout: "", stderr: "", timedOut: true }));
    await expect(judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: run, timeoutMs: 1000 })).rejects.toThrow(/1s ceiling/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("hands the ceiling to the spawn, so it is enforced by killing rather than by asking", async () => {
    const run = ok(VERDICTS);
    await judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: run, timeoutMs: 42_000 });
    expect(run.mock.calls[0]?.[2]).toBe(42_000);
  });
});

describe("the criterion id comes back as the id, not as the heading", () => {
  // MEASURED ON THE FIRST REAL RUN OF THIS BACKEND. The model ruled 1.2.1 correctly and
  // returned `criteriaId: "1.2.1 — Audio-only and Video-only (Prerecorded)"` — the heading it
  // had just read in the brief. The id did not match, the verdict was dropped, and a correct
  // adjudication that had been paid for vanished with no message at all.
  it("pins the ids in the schema, so the wrong shape cannot come back", () => {
    const schema = batchSchema([item("1.2.1"), item("4.1.2")]) as {
      properties: {
        verdicts: {
          description?: string;
          items: { properties: { criteriaId: { enum?: string[] } } };
        };
      };
    };
    expect(schema.properties.verdicts.items.properties.criteriaId.enum).toEqual(["1.2.1", "4.1.2"]);
    expect(schema.properties.verdicts.description).toContain("Exactly one verdict for each of these 2 worklist criteria");
  });

  // The schema is the defence; this is the one behind it, for a CLI too old to honour
  // `--json-schema` — which would ignore the flag without a word.
  it("recovers a heading-decorated id", () => {
    const out = reconcileIds([{ criteriaId: "1.2.1 — Audio-only and Video-only (Prerecorded)", verdict: "NC" } as never], [item("1.2.1")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.criteriaId).toBe("1.2.1");
  });

  it("still drops a verdict that matches no criterion in the batch", () => {
    expect(reconcileIds([{ criteriaId: "9.9.9", verdict: "C" } as never], [item("1.2.1")])).toEqual([]);
  });

  it("prefers the CLI's validated structured output over the string copy", async () => {
    const run = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        is_error: false,
        subtype: "success",
        permission_denials: [],
        structured_output: { verdicts: [{ criteriaId: "1.1.1", verdict: "NA" }] },
        result: "not json at all",
      }),
      stderr: "",
    }));
    const out = await judgeBatchCli([item("1.1.1")], "p", { ...base, spawnImpl: run });
    expect(out[0]?.verdict).toBe("NA");
  });
});
