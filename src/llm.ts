// THE OPTIONAL LLM TIER — a source of verdicts, not a new judge.
//
// Of the 55 WCAG 2.2 AA criteria the static engine decides a handful; 38 are judgment calls,
// and under RGAA 59 of 106 criteria sit in the judgment tier. Inside a coding agent
// those are adjudicated by the agent itself (`verify --manual` → `--apply`). Outside one —
// a CI job, a browser extension, an E2E run — nobody rules on them, so they stay « à
// évaluer » forever: honest, and unusable on its own.
//
// This module closes that gap WITHOUT adding a second adjudication path. It reuses:
//   • `buildAdjudicationWorklist` for the items and their harvested evidence,
//   • `formatAdjudication` for the prompt — the same decision protocol, numbered tests,
//     technical notes, particular cases and glossary the agent reads,
//   • `applyAdjudication` for the gate, unchanged and fail-closed.
// So a model cannot assert a conformance the existing gate refuses: no verdict may be null,
// `C`/`NA` need a justification, an `NC` needs a `normativeRef` that resolves against the
// criterion's OWN tests, `manual` needs a reason, and every cited `file:line` is re-grounded
// against real source. What this file adds is a caller, and nothing else.
//
// STRICTLY ADDITIVE. Without ANTHROPIC_API_KEY nothing here runs and no other command
// changes: the engine's "no keys, no install" promise holds everywhere else.
//
// Zero dependencies: global `fetch`, no SDK.
import type { AdjudicationItem, AgentFinding, CriterionVerdict, Evidence } from "./adjudicate.js";

export const DEFAULT_MODEL = "claude-sonnet-5";
const API_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com";

/** Items per request. Matches `orchestrate`'s BATCH_SIZE: enough context per criterion to
 *  rule well, few enough that one bad response costs little. */
export const BATCH_SIZE = 8;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 4;
const MAX_TOKENS = 16000;

export function apiKeyFromEnv(): string | undefined {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k || undefined;
}

export function modelFromEnv(): string {
  return process.env.ULTRA11Y_LLM_MODEL?.trim() || DEFAULT_MODEL;
}

export interface LlmOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Injected for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Backoff before retry N (1-based). Injected so a test can exercise the retry path
   *  without waiting out the real curve. */
  backoffMs?: (attempt: number) => number;
  onProgress?: (done: number, total: number) => void;
}

// The verdict shape the model must return. It mirrors AdjudicationItem exactly, because the
// gate downstream reads AdjudicationItem — describing anything else here would only move the
// mismatch to where it is harder to see.
const VERDICT_TOOL = {
  name: "record_verdicts",
  description:
    "Record one verdict per criterion presented. Never invent a criterion that was not presented. A criterion you cannot decide from the evidence stays `manual` with a reason — that is a correct answer, not a failure.",
  input_schema: {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            criteriaId: { type: "string", description: "Exactly as presented." },
            verdict: { type: "string", enum: ["C", "NC", "NA", "manual"] },
            justification: {
              type: "string",
              description: "Required for C and NA: why the criterion is met, or why it does not apply. Cite what you saw.",
            },
            reason: {
              type: "string",
              enum: ["needs-rendered-dom", "undecidable"],
              description: "Required when the verdict is `manual`.",
            },
            findings: {
              type: "array",
              description: "Required (at least one) when the verdict is NC. Each must cite a real file:line from the evidence.",
              items: {
                type: "object",
                properties: {
                  file: { type: "string" },
                  line: { type: "number" },
                  selector: { type: "string" },
                  message: { type: "string" },
                  snippet: { type: "string" },
                  severity: { type: "string", enum: ["bloquant", "majeur", "mineur"] },
                  normativeRef: { type: "string", description: "The criterion's OWN numbered test that fails." },
                },
                required: ["file", "line", "message", "normativeRef"],
              },
            },
            citations: {
              type: "array",
              description:
                "Required for C and NA when evidence was presented: the evidence items you cleared (or ruled out of scope). Copy `file`, `line` and `snippet` VERBATIM from the evidence list of this criterion — a citation that is not among them, or that no longer matches the source, is rejected.",
              items: {
                type: "object",
                properties: {
                  file: { type: "string" },
                  line: { type: "number" },
                  selector: { type: "string" },
                  snippet: { type: "string" },
                },
                required: ["file", "line"],
              },
            },
            recommendations: {
              type: "array",
              description: "Non-normative good practices. They never change a status.",
              items: {
                type: "object",
                properties: {
                  file: { type: "string" },
                  line: { type: "number" },
                  selector: { type: "string" },
                  message: { type: "string" },
                  snippet: { type: "string" },
                },
                required: ["file", "line", "message"],
              },
            },
          },
          required: ["criteriaId", "verdict"],
        },
      },
    },
    required: ["verdicts"],
  },
} as const;

const SYSTEM = `You are an accessibility auditor ruling on the criteria a static engine could not decide.

Rules, in order of importance:
1. NEVER assert conformity you did not verify. "manual" with a reason is always available and is a correct answer.
2. An NC must cite a real file:line taken from the evidence you were given, and the criterion's OWN numbered test as normativeRef. A citation that does not resolve against the real source is rejected downstream, and the refusal costs THAT criterion alone — every other verdict you got right still stands. So never guess to fill a gap: an honest "manual" is worth more than a verdict that will be refused.
3. C and NA require a justification that says what you saw, AND a "citations" array naming the evidence items you cleared — file and line copied verbatim from the evidence presented for that criterion. A criterion presented with NO evidence cannot be C: record "manual" (reason "undecidable"), or NA if nothing in scope is concerned.
4. A criterion that needs a rendered page (computed contrast, visible focus, zoom, reflow) and was given only source evidence is "manual" with reason "needs-rendered-dom".
5. Rule only on the criteria presented. Never introduce another.`;

interface AnthropicContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
}

export interface RawVerdict {
  criteriaId: string;
  verdict: CriterionVerdict;
  justification?: string;
  reason?: string;
  findings?: AgentFinding[];
  citations?: Evidence[];
  recommendations?: AgentFinding[];
}

const sleep = (ms: number): Promise<void> => (ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
const backoff = (opts: LlmOptions, attempt: number): number => opts.backoffMs?.(attempt) ?? 2 ** attempt * 500;

/** One Messages call, with bounded retries. Retries only what is worth retrying — a rate
 *  limit or a server fault — and never a 4xx that will fail identically next time. */
async function callOnce(body: unknown, opts: LlmOptions): Promise<AnthropicResponse> {
  const f = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? process.env.ANTHROPIC_BASE_URL ?? DEFAULT_BASE_URL}/v1/messages`;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await f(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": API_VERSION },
        body: JSON.stringify(body),
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(backoff(opts, attempt));
      continue;
    }
    if (res.ok) return (await res.json()) as AnthropicResponse;
    const text = await res.text().catch(() => "");
    lastError = `HTTP ${res.status} ${text.slice(0, 300)}`;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) break;
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : backoff(opts, attempt));
  }
  throw new Error(`ultra11y judge: the model API call failed — ${lastError}`);
}

/** Pull the tool call out of a response. A model that answered in prose instead of calling
 *  the tool has not adjudicated anything, and saying so beats parsing prose into verdicts. */
function verdictsOf(res: AnthropicResponse): RawVerdict[] {
  const block = res.content?.find((c) => c.type === "tool_use" && c.name === VERDICT_TOOL.name);
  if (!block) throw new Error("ultra11y judge: the model did not return the verdicts tool call.");
  const input = block.input as { verdicts?: unknown } | undefined;
  if (!Array.isArray(input?.verdicts)) throw new Error("ultra11y judge: the model's tool call carried no verdicts array.");
  return input.verdicts as RawVerdict[];
}

/** Rule on one batch of worklist items. `prompt` is the rendered worklist for exactly these
 *  items — the same text the agent reads, never a second protocol. */
export async function judgeBatch(items: AdjudicationItem[], prompt: string, opts: LlmOptions): Promise<RawVerdict[]> {
  const res = await callOnce(
    {
      model: opts.model ?? modelFromEnv(),
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      tools: [VERDICT_TOOL],
      tool_choice: { type: "tool", name: VERDICT_TOOL.name },
      messages: [{ role: "user", content: prompt }],
    },
    opts,
  );
  const known = new Set(items.map((i) => i.criteriaId));
  // A verdict for a criterion nobody asked about is dropped rather than folded: the gate
  // downstream would reject it anyway, and dropping it keeps the failure legible.
  return verdictsOf(res).filter((v) => known.has(v.criteriaId));
}

/** Run every batch with bounded concurrency, returning the verdicts in no particular order.
 *  A batch that fails after its retries is reported and skipped — its criteria simply stay
 *  unadjudicated, which the gate then refuses loudly, rather than the whole run dying on one
 *  transient fault. */
export async function judgeAll(
  batches: { items: AdjudicationItem[]; prompt: string }[],
  opts: LlmOptions,
): Promise<{ verdicts: RawVerdict[]; failures: string[] }> {
  const verdicts: RawVerdict[] = [];
  const failures: string[] = [];
  let done = 0;
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let b = queue.shift(); b !== undefined; b = queue.shift()) {
        try {
          verdicts.push(...(await judgeBatch(b.items, b.prompt, opts)));
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
        opts.onProgress?.(++done, batches.length);
      }
    }),
  );
  return { verdicts, failures };
}

/** Fold raw verdicts onto the worklist items. Unmatched items keep their blank verdict, so
 *  the coverage gate — not this function — is what refuses an incomplete adjudication. */
export function applyRawVerdicts(items: AdjudicationItem[], verdicts: RawVerdict[]): number {
  const byId = new Map(verdicts.map((v) => [v.criteriaId, v]));
  let filled = 0;
  for (const item of items) {
    const v = byId.get(item.criteriaId);
    if (!v) continue;
    item.verdict = v.verdict;
    item.justification = v.justification ?? "";
    item.reason = v.verdict === "manual" ? (v.reason ?? null) : null;
    item.findings = v.verdict === "NC" ? (v.findings ?? []) : [];
    // Citations belong to the clearing verdicts, the way findings belong to NC. Dropping
    // them here (as this function once dropped everything a non-NC verdict carried) would
    // make every model-produced C fail the gate that now requires them.
    if (v.verdict === "C" || v.verdict === "NA") item.citations = v.citations ?? [];
    else delete item.citations;
    if (v.recommendations?.length) item.recommendations = v.recommendations;
    filled++;
  }
  return filled;
}
