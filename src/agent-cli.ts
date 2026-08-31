// THE CLAUDE CODE CLI AS AN ADJUDICATION BACKEND.
//
// The second transport behind `judgeAll`, and the one that makes the agent tier portable. The
// `agent` tier existed only as three `uses: anthropics/claude-code-action@v1` steps in
// action.yml, which means it could not run from the skill, from a GitLab CI, or on a `push`
// event — claude-code-action parses the event context before it reads the prompt and refuses
// the ones it does not know, `push` above all, which is the event an accessibility gate
// actually fires on.
//
// This is the same tier as a local process: `claude -p`, the rendered worklist on stdin, the
// verdicts back on stdout. Nothing about a verdict is decided here — the prompt, the schema
// and the fail-closed fold are the ones the Messages backend and the emitted contracts
// already use.
//
// WHY IT READS AND NEVER WRITES. claude-code-action has to grant Edit and Write, because the
// adjudicator's only way to return anything is to write ADJUDICATE.verdicts.json. Measured on
// a real run: 17 permission denials and the file left untouched. Answering on stdout removes
// the need for the write entirely, so this backend runs on Read/Grep/Glob — it can still open
// every file a criterion cites, which is the whole point of the agent tier, and it can no
// longer touch the audited source.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { AdjudicationItem } from "./adjudicate.js";
import { VERDICT_TOOL } from "./llm.js";
import type { LlmOptions, RawVerdict } from "./llm.js";
import type { Lang } from "./types.js";
import { refuteSchema, refuteSystemPrompt, type VerifyItem } from "./verify.js";
import { verdictSystemPrompt } from "./verdict-rules.js";

/** Tools the adjudicator needs: open what a criterion cites, and nothing else. */
const ALLOWED_TOOLS = "Read,Grep,Glob";
/** Transient failures retried before a batch is given up on. Matches the Messages backend. */
const MAX_ATTEMPTS = 4;

/** The CLI's own default is Opus. Measured on a trivial one-turn probe: $0.164 against
 *  $0.014 for Haiku — twelve times, for a call that did no work. A per-criterion run makes
 *  that multiplier the difference between a few cents and a few dollars, so this backend
 *  states a model rather than inheriting one. */
export const DEFAULT_CLI_MODEL = "claude-haiku-4-5-20251001";

/** The levels `claude --effort` accepts. Enumerated here so a caller's typo is refused with a
 *  message instead of forwarded: this CLI treats an unrecognised value the way it treats an
 *  unrecognised flag — silently — and a ceiling that is silently nothing is the exact failure
 *  `--max-turns` already cost this repo once. */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];

/** What `claude -p --output-format json` puts on stdout. Only the fields this reads. */
interface CliEnvelope {
  /** Where `--json-schema` puts the validated object. Present since 2.1.x; `result` carries
   *  the same JSON as a string beside it, and older builds carry only `result`. */
  structured_output?: unknown;
  result?: string;
  is_error?: boolean;
  subtype?: string;
  total_cost_usd?: number;
  num_turns?: number;
  api_error_status?: number | null;
  permission_denials?: unknown[];
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** The wall-clock ceiling was reached and the process was killed. Never retried: trying
   *  again is just asking for twice the bound we deliberately set. */
  timedOut?: boolean;
}

/** Default wall-clock ceiling for one invocation. Generous, because the whole point of this
 *  tier is that it opens files and reads around them — and finite, because an agent that
 *  stopped making progress otherwise holds a CI job until the job's own timeout. */
export const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Injected in tests so the whole backend is exercised without invoking a model. */
export type SpawnImpl = (argv: string[], input: string, timeoutMs: number) => Promise<SpawnResult>;

function realSpawn(argv: string[], input: string, timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0] as string, argv.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    // The rendered worklist runs to tens of kilobytes under a country standard. argv has a
    // length limit and stdin does not, so the prompt goes through the pipe.
    child.stdin.end(input);
  });
}

/** `claude` when it is installed, else npx. The engine's "no install" promise holds for
 *  everything else; this tier is the one place that needs a model, and `npx --yes` is the
 *  same escape hatch ci.yml already uses for `skills add`. */
export function claudeBin(): string[] {
  const pinned = process.env.ULTRA11Y_CLAUDE_BIN?.trim();
  if (pinned) return [pinned];
  // Resolved from PATH by looking, not by spawning `which`: the per-criterion grain invokes
  // this once per criterion, and a probe process per invocation is a cost for nothing.
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, "claude");
    if (existsSync(candidate)) return [candidate];
  }
  return ["npx", "--yes", "@anthropic-ai/claude-code"];
}

/** The verdict schema, with `criteriaId` pinned to THIS batch's ids.
 *
 *  Measured, on the first real run of this backend: the model ruled 1.2.1 correctly and
 *  returned `criteriaId: "1.2.1 — Audio-only and Video-only (Prerecorded)"` — the heading it
 *  had just read — so the id did not match, the verdict was dropped, and a correct, paid-for
 *  adjudication was thrown away in silence. An enum is not a hint: the CLI validates the
 *  structured output against this schema, so the wrong shape cannot come back at all. */
export function batchSchema(items: AdjudicationItem[]): Record<string, unknown> {
  const schema = structuredClone(VERDICT_TOOL.input_schema) as {
    properties: {
      verdicts: {
        description?: string;
        items: { properties: { criteriaId: Record<string, unknown> } };
      };
    };
  };
  const verdicts = schema.properties.verdicts;
  // Anthropic structured outputs support array minItems only at 0 or 1, not exact batch
  // cardinality. Keep completeness in the shared worklist contract and repeat it beside the
  // array the model is filling. A hard unsupported constraint could turn a useful 7/8 response
  // into a provider error and lose all seven valid verdicts; validateBatchVerdicts deliberately
  // preserves those seven and names the missing item for the next pass.
  verdicts.description = `Exactly one verdict for each of these ${items.length} worklist criteria. Do not omit criteria already reported non-conforming run-wide: page-level cells may still be open.`;
  const id = verdicts.items.properties.criteriaId;
  id.enum = items.map((i) => i.criteriaId);
  id.description = `The criterion id EXACTLY as given — the bare id (e.g. "1.2.1"), never the heading or the title beside it.`;
  return schema as unknown as Record<string, unknown>;
}

export function cliArgv(opts: LlmOptions, items: AdjudicationItem[]): string[] {
  const argv = [
    ...claudeBin(),
    "-p",
    "--output-format",
    "json",
    // Structured output, validated by the CLI itself — the counterpart of the Messages
    // backend's forced tool call, and the reason this backend never has to ask the model to
    // "please answer in JSON" and hope. `verdictsFromText` below stays as the fallback,
    // because a CLI old enough to lack this flag IGNORES IT SILENTLY (see cliArgv's note).
    "--json-schema",
    JSON.stringify(batchSchema(items)),
    // THE SAME system prompt the Messages backend sends. Not a paraphrase of it.
    "--system-prompt",
    verdictSystemPrompt(),
    // `--tools` bounds the toolset itself; `--allowedTools` bounds what may run unattended.
    // Both, because they answer different questions and only the pair leaves no Bash.
    "--tools",
    ALLOWED_TOOLS,
    "--allowedTools",
    ALLOWED_TOOLS,
    // THE AUDITED REPOSITORY IS UNTRUSTED CONTENT. Without this its CLAUDE.md, its hooks, its
    // skills and its MCP servers all load into the adjudicating session — an injection surface
    // and a source of non-determinism, since two repositories would then adjudicate the same
    // evidence differently.
    "--safe-mode",
    "--strict-mcp-config",
    "--model",
    opts.model ?? DEFAULT_CLI_MODEL,
  ];
  // NO `--max-turns`. It is not a flag of this CLI, and an unknown flag is SWALLOWED WITHOUT
  // A WORD (`claude --definitely-not-a-real-flag --version` exits 0). Passing it would read as
  // a turn budget and be an unbounded run. The bounds that are real: `--max-budget-usd`, which
  // the CLI documents, and the wall-clock kill in `judgeBatchCli`, which is ours.
  if (opts.maxBudgetUsd !== undefined) argv.push("--max-budget-usd", String(opts.maxBudgetUsd));
  // `--effort` IS documented by this CLI, unlike `--max-turns` above — so it is passed, and a
  // caller can raise how hard the model thinks without also having to change the model.
  if (opts.effort) argv.push("--effort", opts.effort);
  return argv;
}

/** Pull the verdicts object out of the model's final message.
 *
 *  Tolerant about the wrapper, strict about the content: a fenced block or a sentence around
 *  the object is a formatting habit, but prose INSTEAD of an object means nothing was
 *  adjudicated — and saying so beats parsing prose into verdicts, exactly as the Messages
 *  backend refuses a response that skipped the tool call. */
export function verdictsFromText(text: string): RawVerdict[] {
  return verdictsArrayFromText(text) as RawVerdict[];
}

/** The same recovery, untyped — the refutation pass answers with a different verdict shape
 *  through the same envelope, and the wrapper-tolerance is about JSON, not about verdicts. */
export function verdictsArrayFromText(text: string): unknown[] {
  const candidates: string[] = [text.trim()];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const braced = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (braced.includes("verdicts")) candidates.push(braced.trim());
  for (const c of candidates) {
    if (!c) continue;
    try {
      const parsed = JSON.parse(c) as { verdicts?: unknown };
      if (Array.isArray(parsed?.verdicts)) return parsed.verdicts;
    } catch {
      /* try the next shape */
    }
  }
  throw new Error("ultra11y judge: the CLI answered without a verdicts object.");
}

/** Match each verdict back to the criterion it is about, then drop what is left over.
 *
 *  The enum in `batchSchema` is the real defence; this is the one behind it, because a CLI
 *  too old for `--json-schema` IGNORES IT WITHOUT A WORD and would put us back to reading
 *  whatever the model felt like writing. A leading id followed by the criterion's title is
 *  the shape it actually produced, so it is the shape this recovers — and anything that still
 *  matches no criterion is dropped, exactly as the Messages backend drops it, because the
 *  gate would refuse it and a silent drop keeps the failure legible. */
export function reconcileIds(verdicts: RawVerdict[], items: AdjudicationItem[]): RawVerdict[] {
  const known = new Set(items.map((i) => i.criteriaId));
  const out: RawVerdict[] = [];
  for (const v of verdicts) {
    if (known.has(v.criteriaId)) {
      out.push(v);
      continue;
    }
    // "1.2.1 — Audio-only and Video-only (Prerecorded)" → "1.2.1"
    const lead = String(v.criteriaId ?? "")
      .trim()
      .split(/[\s—–-]/)[0];
    if (lead && known.has(lead)) out.push({ ...v, criteriaId: lead });
  }
  return out;
}

const sleep = (ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

/** Rule on one batch through the CLI. `prompt` is the rendered worklist for exactly these
 *  items — the same text the Messages backend sends and the same the agent reads. */
export async function judgeBatchCli(items: AdjudicationItem[], prompt: string, opts: LlmOptions): Promise<RawVerdict[]> {
  return runCli(cliArgv(opts, items), prompt, opts, (env) => {
    const structured = (env.structured_output as { verdicts?: unknown } | undefined)?.verdicts;
    const raw = Array.isArray(structured) ? (structured as RawVerdict[]) : verdictsFromText(env.result ?? "");
    return reconcileIds(raw, items);
  });
}

/** One refutation verdict, as the CLI returns it. Keyed by the worklist's item number rather
 *  than by criterion: one criterion can be on trial several times over — cleared on four
 *  images and failed on a fifth — and the number is the only thing that tells them apart. */
export interface RawRefutation {
  n: number;
  verdict: string;
  note?: string;
}

/**
 * Put a batch of already-written claims on trial. The counterpart of `judgeBatchCli`, through
 * the same transport, the same bounds and the same retry policy — and a DIFFERENT system
 * prompt, because the question is different: an adjudicator asked « is this criterion met? »
 * and a reviewer asked « does the cited evidence establish what was claimed? » fail in
 * different directions, and only the second catches an over-accusing first.
 */
export async function refuteBatchCli(items: VerifyItem[], prompt: string, opts: LlmOptions, lang: Lang = "en"): Promise<RawRefutation[]> {
  const argv = [
    ...claudeBin(),
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(refuteSchema(items)),
    "--system-prompt",
    refuteSystemPrompt(lang),
    "--tools",
    ALLOWED_TOOLS,
    "--allowedTools",
    ALLOWED_TOOLS,
    "--safe-mode",
    "--strict-mcp-config",
    "--model",
    opts.model ?? DEFAULT_CLI_MODEL,
  ];
  if (opts.maxBudgetUsd !== undefined) argv.push("--max-budget-usd", String(opts.maxBudgetUsd));
  // `--effort` IS documented by this CLI, unlike `--max-turns` above — so it is passed, and a
  // caller can raise how hard the model thinks without also having to change the model.
  if (opts.effort) argv.push("--effort", opts.effort);
  return runCli(argv, prompt, opts, (env) => {
    const structured = (env.structured_output as { verdicts?: unknown } | undefined)?.verdicts;
    const raw = Array.isArray(structured) ? structured : verdictsArrayFromText(env.result ?? "");
    const known = new Set(items.map((it) => it.n));
    // Anything matching no item is dropped, exactly as the adjudication path drops it: the
    // enum is the real defence, and a CLI too old for `--json-schema` ignores it in silence.
    return (raw as RawRefutation[]).filter((v) => known.has(Number(v?.n)));
  });
}

/**
 * ONE INVOCATION OF THE CLI, WITH ITS BOUNDS AND ITS RETRIES — shared by the adjudication pass
 * and the refutation pass.
 *
 * Extracted rather than copied because everything below the `extract` callback is policy, not
 * plumbing: which failures are transient, why a missing envelope never is, why a permission
 * denial is fatal rather than retried, and why a wall-clock kill is never tried twice. Two
 * copies of that would be two policies the day one of them is edited.
 */
async function runCli<T>(argv: string[], prompt: string, opts: LlmOptions, extract: (env: CliEnvelope) => T): Promise<T> {
  const run = opts.spawnImpl ?? realSpawn;
  let lastError = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(opts.backoffMs?.(attempt) ?? 2 ** attempt * 500);
    const { code, stdout, stderr, timedOut } = await run(argv, prompt, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (timedOut)
      throw new Error(
        `ultra11y judge: the CLI passed its ${Math.round((opts.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s ceiling and was killed — retrying would only ask for twice that bound.`,
      );
    let env: CliEnvelope;
    try {
      env = JSON.parse(stdout) as CliEnvelope;
    } catch {
      // NO ENVELOPE AT ALL IS NEVER TRANSIENT. A rate limit, an overloaded API, a refused
      // request — every one of those still comes back as a well-formed envelope carrying
      // `is_error` (see below), so the only way to get here is a missing binary, a broken
      // install or a credential the CLI refused before it ever called anything. Retrying that
      // four times changes nothing and buries the cause under three more failures.
      lastError = `the CLI produced no JSON envelope (exit ${code}): ${(stderr || stdout).trim().slice(0, 300)}`;
      break;
    }
    opts.onCost?.(env.total_cost_usd ?? 0);
    // A permission denial means the adjudicator was refused a file it went looking for — its
    // verdicts are then about less than it tried to read, and that is worth saying out loud
    // rather than folding quietly. It is not retried: the grant will not change on attempt 2.
    if (Array.isArray(env.permission_denials) && env.permission_denials.length > 0) {
      throw new Error(
        `ultra11y judge: the CLI was denied ${env.permission_denials.length} tool call(s) — its verdicts would cover less than it tried to read.`,
      );
    }
    if (env.is_error || env.subtype !== "success") {
      lastError = `the CLI reported an error (${env.subtype ?? "unknown"}${env.api_error_status ? `, api status ${env.api_error_status}` : ""}).`;
      // Only a transport fault is worth another attempt; a refusal is not.
      if (env.api_error_status && (env.api_error_status === 429 || env.api_error_status >= 500)) continue;
      break;
    }
    return extract(env);
  }
  throw new Error(`ultra11y judge: ${lastError || "the CLI failed after every attempt."}`);
}
