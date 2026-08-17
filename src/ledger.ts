// The VERDICT LEDGER — how a judgment criterion stays decided without paying a model again.
//
// The engine can decide only a handful of criteria outright; the rest are judgment calls that
// an agent adjudicates from harvested evidence (src/adjudicate.ts). That worked in a session
// and nowhere else: every other run — a CI job, a nightly report, a colleague's checkout —
// started from zero and published « to assess », because a verdict lived only in the
// `audit-latest.json` that one run produced.
//
// The ledger is that verdict, written down where it can be reviewed: a small file committed to
// the audited repository, holding one entry per adjudicated criterion with its justification,
// its citations and — the part that makes it trustworthy — a FINGERPRINT of the evidence it was
// ruled against. Replaying it is not a cache lookup: each entry is rebuilt into an ordinary
// adjudication and folded through `applyAdjudication`, so the same coverage checks, the same
// citation matching and the same content-level re-grounding decide whether it still stands.
// A verdict nobody can prove is refused in CI exactly as it would be in a session.
//
// Staleness is the reason the fingerprint exists. When the code under a criterion changes, the
// evidence the agent read changes with it, the fingerprint stops matching, and the verdict is
// dropped as STALE — the criterion returns to « to assess » saying so. The alternative, a
// verdict that silently outlives the code it described, is the one failure mode a conformance
// deliverable cannot afford.
//
// The fingerprint deliberately ignores LINE NUMBERS. Grounding already tolerates ±10 lines of
// drift (a citation that moved is still the same citation), so hashing line numbers would
// invalidate every verdict in a file the moment someone added a comment at the top — punishing
// a formatting change like a semantic one. It hashes what the agent actually read: the file, the
// selector and the normalised snippet.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { type AdjudicationFile, type AdjudicationItem, type AgentFinding, buildAdjudicationWorklist, type Evidence } from "./adjudicate.js";
import { CORE, type StandardId } from "./standards/index.js";
import type { AuditResult } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

/** Where a ledger lives by default, relative to the audited repository root. Committed on
 *  purpose: a verdict is a claim about this codebase, so it belongs in review alongside it. */
export const LEDGER_DIR = ".ultra11y/verdicts";

/** The default path for a standard's ledger. */
export function ledgerPath(standard: StandardId, root = "."): string {
  return join(root, LEDGER_DIR, `${standard}.json`);
}

export interface LedgerEntry {
  criteriaId: string;
  /** The verdict as folded — same vocabulary as an adjudication item. */
  verdict: "C" | "NC" | "NA" | "manual";
  justification?: string;
  reason?: string | null;
  citations?: Evidence[];
  findings?: AgentFinding[];
  recommendations?: AgentFinding[];
  /** Fingerprint of the evidence this verdict was ruled against (see module header). */
  evidenceFingerprint: string;
  /** How many evidence items were harvested — carried for the reader, never trusted. */
  evidenceCount: number;
  /** ISO date the verdict was recorded. */
  date: string;
  /** Who ruled. Only ever "agent": the engine's own verdicts are recomputed every run and
   *  have no business in a ledger. */
  decidedBy: "agent";
}

export interface VerdictLedger {
  tool: "ultra11y";
  kind: "verdict-ledger";
  schemaVersion: number;
  standard: StandardId;
  entries: LedgerEntry[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The line-independent identity of one piece of evidence: what the agent actually read. */
const anchorKey = (e: { file: string; selector?: string; snippet?: string }) => `${e.file}|${e.selector ?? ""}|${norm(e.snippet ?? "")}`;

/** Fingerprint the evidence a criterion was ruled against. Order-independent (the harvester's
 *  traversal order is not a property of the code) and line-independent (see module header). */
export function evidenceFingerprint(evidence: Evidence[]): string {
  const keys = evidence.map(anchorKey).sort();
  return `sha256:${createHash("sha256")
    .update(`${keys.length}\n${keys.join("\n")}`)
    .digest("hex")
    .slice(0, 32)}`;
}

/** Move a stored anchor onto TODAY's line for the same piece of evidence.
 *
 *  Necessary, not cosmetic. The fingerprint is deliberately line-independent, but the fold's
 *  citation check is exact: a citation must match one of the criterion's harvested anchors by
 *  `file:line`. Without re-anchoring, adding a comment at the top of a file shifted every line
 *  and the gate refused every stored verdict in it as fabricated — punishing a reformatting
 *  exactly like a rewrite, and making the ledger useless in practice.
 *
 *  This launders nothing: the fingerprint has already proved the evidence set is the same
 *  content, so all that moves is the line number — the very drift `groundFinding` was written to
 *  tolerate. An anchor with no counterpart in today's evidence is left untouched, and the fold
 *  refuses it, which is the correct outcome. */
function reanchor<T extends { file: string; line: number; selector?: string; snippet?: string }>(stored: T[] | undefined, today: Evidence[]): T[] | undefined {
  if (!stored?.length) return stored;
  const byKey = new Map(today.map((e) => [anchorKey(e), e]));
  return stored.map((s) => {
    const now = byKey.get(anchorKey(s));
    return now && now.line !== s.line ? { ...s, line: now.line } : s;
  });
}

export function emptyLedger(standard: StandardId = CORE): VerdictLedger {
  return { tool: "ultra11y", kind: "verdict-ledger", schemaVersion: SCHEMA_VERSION, standard, entries: [] };
}

export function isLedger(v: unknown): v is VerdictLedger {
  const o = v as VerdictLedger | null;
  return !!o && typeof o === "object" && o.tool === "ultra11y" && o.kind === "verdict-ledger" && Array.isArray(o.entries);
}

export function readLedger(path: string): VerdictLedger | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isLedger(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeLedger(path: string, ledger: VerdictLedger): void {
  mkdirSync(dirname(path), { recursive: true });
  // Entries id-sorted so the committed file has a stable diff — a ledger that reshuffles on
  // every write is a ledger nobody reviews.
  const sorted: VerdictLedger = { ...ledger, entries: [...ledger.entries].sort((a, b) => a.criteriaId.localeCompare(b.criteriaId, "en", { numeric: true })) };
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** Record the verdicts an adjudication just landed, as ledger entries.
 *
 *  `applied` names the criteria whose verdict the fold ACCEPTED — a refused one must never
 *  reach the ledger, or the next replay would launder it back in. */
export function entriesFrom(adj: AdjudicationFile, accepted: ReadonlySet<string>, date: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const it of adj.items) {
    if (!accepted.has(it.criteriaId) || it.verdict === null) continue;
    out.push({
      criteriaId: it.criteriaId,
      verdict: it.verdict,
      ...(it.justification?.trim() ? { justification: it.justification.trim() } : {}),
      ...(it.reason ? { reason: it.reason } : {}),
      ...(it.citations?.length ? { citations: it.citations } : {}),
      ...(it.findings?.length ? { findings: it.findings } : {}),
      ...(it.recommendations?.length ? { recommendations: it.recommendations } : {}),
      evidenceFingerprint: evidenceFingerprint(it.evidence),
      evidenceCount: it.evidence.length,
      date,
      decidedBy: "agent",
    });
  }
  return out;
}

/** Merge fresh entries over an existing ledger — same criterion, newest wins. A refresh pass
 *  that only re-adjudicated part of the grid must not delete the rest. */
export function mergeLedger(existing: VerdictLedger | undefined, standard: StandardId, fresh: LedgerEntry[]): VerdictLedger {
  const base = existing && existing.standard === standard ? existing : emptyLedger(standard);
  const byId = new Map(base.entries.map((e) => [e.criteriaId, e]));
  for (const e of fresh) byId.set(e.criteriaId, e);
  return { ...base, schemaVersion: SCHEMA_VERSION, standard, entries: [...byId.values()] };
}

export interface ReplayResult {
  /** The ledger's still-valid verdicts, as an ordinary adjudication for `applyAdjudication`. */
  adj: AdjudicationFile;
  /** Criteria whose verdict still matches the evidence and will be folded. */
  fresh: string[];
  /** Criteria whose evidence changed since the verdict — dropped, with the reason to report. */
  stale: string[];
  /** Ledger entries for criteria the engine no longer leaves open (it decided them itself, or
   *  they are not part of this standard). Dropped: the engine outranks a stored verdict. */
  obsolete: string[];
  /** Open criteria the ledger says nothing about — they stay to assess, and are what a refresh
   *  pass has to adjudicate. */
  missing: string[];
  /** Per-criterion residual reasons for everything that did NOT fold, ready to hand to
   *  `applyAdjudication`. */
  residualReasons: Record<string, string>;
}

/** Rebuild a ledger into an adjudication for THIS audit, dropping what no longer holds.
 *
 *  The worklist is a pure function of the audit, so re-deriving it here reconstructs the very
 *  evidence anchors the citation gate checks against — the fold that follows is the same fold,
 *  with the same refusals. Nothing about a ledger entry is trusted except that it was written:
 *  its fingerprint is recomputed, its criterion must still be open, and its citations are
 *  re-grounded downstream. */
export function replayLedger(audit: AuditResult, ledger: VerdictLedger, opts: { cwd?: string; standard?: StandardId } = {}): ReplayResult {
  const standard = opts.standard ?? ledger.standard ?? CORE;
  const worklist = buildAdjudicationWorklist(audit, { cwd: opts.cwd, standard });
  const open = new Map(worklist.map((it) => [it.criteriaId, it]));
  const byId = new Map(ledger.entries.map((e) => [e.criteriaId, e]));

  const items: AdjudicationItem[] = [];
  const fresh: string[] = [];
  const stale: string[] = [];
  const obsolete: string[] = [];
  const missing: string[] = [];
  const residualReasons: Record<string, string> = {};

  for (const e of ledger.entries) if (!open.has(e.criteriaId)) obsolete.push(e.criteriaId);

  for (const it of worklist) {
    const e = byId.get(it.criteriaId);
    if (!e) {
      missing.push(it.criteriaId);
      residualReasons[it.criteriaId] = "No verdict in the ledger — this criterion has never been adjudicated. Run an adjudication pass to record one.";
      continue;
    }
    const now = evidenceFingerprint(it.evidence);
    if (now !== e.evidenceFingerprint) {
      stale.push(it.criteriaId);
      residualReasons[it.criteriaId] =
        `Ledger verdict is STALE — the evidence changed since it was recorded on ${e.date} (${e.evidenceCount} item(s) then, ${it.evidence.length} now). Re-adjudicate this criterion.`;
      continue;
    }
    fresh.push(it.criteriaId);
    // Rebuild the item on TODAY's harvested evidence, carrying only the decision from the
    // ledger. The stored citations still have to be found among that evidence, which is what
    // makes the replay a re-verification rather than a restore.
    items.push({
      ...it,
      verdict: e.verdict,
      justification: e.justification ?? "",
      reason: e.reason ?? null,
      findings: reanchor(e.findings, it.evidence) ?? [],
      ...(e.citations ? { citations: reanchor(e.citations, it.evidence) ?? [] } : {}),
      ...(e.recommendations ? { recommendations: reanchor(e.recommendations, it.evidence) ?? [] } : {}),
      decidedBy: "agent",
    });
  }

  return {
    adj: { tool: "ultra11y", kind: "adjudication", schemaVersion: SCHEMA_VERSION, standard, auditDate: audit.date, items },
    fresh,
    stale,
    obsolete,
    missing,
    residualReasons,
  };
}
