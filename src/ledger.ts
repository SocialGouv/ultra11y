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

import { type AdjudicationFile, type AdjudicationItem, type AgentFinding, buildAdjudicationWorklist, type Evidence, readCitation } from "./adjudicate.js";
import { PAGES_DIR } from "./snapshot.js";
import { CORE, type StandardId } from "./standards/index.js";
import type { AuditResult } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import type { VerifyItem } from "./verify.js";

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
  /** THE ANCHOR SET behind that fingerprint — one short hash per piece of evidence, sorted,
   *  comma-joined.
   *
   *  A fingerprint answers one question — « is this the same evidence? » — and on a living
   *  application the answer is always no. It cannot answer the question that decides whether a
   *  verdict still covers today's code: « is anything here NEW? ». That needs the set, not its
   *  digest.
   *
   *  HASHES, not the anchors themselves, because this file is committed and reviewed: one
   *  criterion in egapro's grid carries 634 anchors, and spelling them out would bury its
   *  justification under half a megabyte of snippets. Sixteen hex characters of SHA-256 each —
   *  a collision here keeps a verdict that should have expired, which is why they are not
   *  shortened further.
   *
   *  ONE STRING, not an array, for the same reason the entries are id-sorted: `JSON.stringify`
   *  puts each array item on its own line, so the real ledger would gain some nine thousand
   *  lines and every re-adjudication would produce a diff nobody reads. A ledger nobody reads
   *  is a ledger that stops being reviewed, which is the whole reason it is committed.
   *
   *  Absent on an entry recorded before this field existed. Absent means « no set to compare »,
   *  which keeps the old strict rule — never « nothing was there ». */
  evidenceAnchors?: string;
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

/** A snapshot is a committed, repo-relative artefact even when the browser happened to write
 * it through an absolute `--cwd`. Hashing the runner's checkout prefix made the same page
 * evidence stale on another machine. Keep ordinary source paths strict, but key snapshots on
 * their published `.ultra11y/pages/<id>/dom.html` identity. */
const canonicalFile = (file: string): string => {
  const posix = file.replace(/\\/g, "/");
  const marker = `${PAGES_DIR}/`;
  const at = posix.lastIndexOf(marker);
  return at >= 0 ? posix.slice(at) : posix;
};

/** The line-independent identity of one piece of evidence: what the agent actually read. */
const anchorKey = (e: { file: string; selector?: string; snippet?: string }) => {
  const file = canonicalFile(e.file);
  let snippet = norm(e.snippet ?? "");
  // The capture header records transport provenance, not page evidence. A local port or CI
  // hostname changing must not stale a verdict about the same DOM/doctype.
  if (file.startsWith(`${PAGES_DIR}/`) && snippet.startsWith("<!-- ultra11y:capture ")) snippet = snippet.replace(/\surl="[^"]*"/, "");
  return `${file}|${e.selector ?? ""}|${snippet}`;
};

/** Fingerprint the evidence a criterion was ruled against. Order-independent (the harvester's
 *  traversal order is not a property of the code) and line-independent (see module header). */
export function evidenceFingerprint(evidence: Evidence[]): string {
  const keys = evidence.map(anchorKey).sort();
  return `sha256:${createHash("sha256")
    .update(`${keys.length}\n${keys.join("\n")}`)
    .digest("hex")
    .slice(0, 32)}`;
}

/** One short hash per anchor — the same identity `evidenceFingerprint` digests, kept as a SET
 *  so a replay can ask which pieces are new rather than only whether anything moved. Sorted and
 *  de-duplicated so the committed file has a stable diff. */
export function evidenceAnchorsOf(evidence: Evidence[]): string {
  const out = new Set<string>();
  for (const e of evidence) out.add(anchorHash(e));
  return [...out].sort().join(",");
}

const anchorHash = (e: { file: string; selector?: string; snippet?: string }): string => createHash("sha256").update(anchorKey(e)).digest("hex").slice(0, 16);

/** Does a stored verdict still cover today's harvest?
 *
 *  THE RULE, and it is a deliberate weakening of the one it replaces. A `C` says « everything I
 *  saw is conforming », so evidence that is a SUBSET of what was whitened is still covered —
 *  whitening a set covers its parts. What must expire it is evidence that is NEW: code the
 *  adjudicator never read. An `NC` is not expired by new code at all; more code cannot un-fail
 *  a criterion, and whether its cited constat survives is decided downstream by the citation
 *  gate and the re-grounding, which are unchanged.
 *
 *  Before this, `evidenceFingerprint` had to match exactly. On a living application that meant
 *  the ledger amortised nothing: measured on egapro, replaying the committed 48-entry ledger
 *  against the run of 31/08 expired 27 entries — every one carrying twenty anchors or more.
 *
 *  TWO GUARDS, and both exist because the failure they prevent is a false « conforme » rather
 *  than a wasted dollar:
 *
 *  • `harvestComplete`. An incomplete harvest is not a shrunken codebase. A checkout whose page
 *    captures are missing harvests strictly less of everything, and reading that as « the code
 *    shrank » would replay every page verdict as though those pages had been audited this run.
 *    `unreadableCaptures` already names exactly that trap; this is where it becomes a refusal.
 *  • An EMPTY harvest, which is not a subset worth honouring even though zero is a subset of
 *    everything. This guard was written, removed on the argument that the citation gate would
 *    catch it, and put back when the test proved otherwise: replaying a `C` onto a criterion
 *    whose evidence had gone to nothing published it as an agent conformity, citation gate and
 *    all. Evidence that has gone to nothing is a criterion nobody looked at — not a criterion
 *    with nothing left to fail — and the two must not be published as the same claim. */
export function verdictStillHolds(entry: LedgerEntry, today: Evidence[], opts: { harvestComplete: boolean }): { holds: true } | { holds: false; why: string } {
  const stale = (why: string) => ({ holds: false as const, why });
  // The fast path, and the only path a legacy entry has: byte-identical evidence.
  if (evidenceFingerprint(today) === entry.evidenceFingerprint) return { holds: true };
  const was = entry.evidenceCount;
  if (!entry.evidenceAnchors) {
    return stale(
      `Ledger verdict is STALE — the evidence changed since it was recorded on ${entry.date} (${was} item(s) then, ${today.length} now), and the entry predates anchor recording, so what changed cannot be established. Re-adjudicate this criterion.`,
    );
  }
  if (!opts.harvestComplete) {
    return stale(
      `Ledger verdict is STALE — this run's harvest is INCOMPLETE (page captures the audit says it read are missing from disk), so a smaller evidence set says nothing about the code. Re-run with the captures present, then re-adjudicate if it still differs.`,
    );
  }
  // An NC survives new code by construction. Whether its constat is still there is the
  // citation gate's question, and it is asked on every replay whatever this returns.
  if (entry.verdict === "NC") return { holds: true };
  if (today.length === 0) {
    return stale(
      `Ledger verdict is STALE — the harvest for this criterion is now EMPTY where it held ${was} item(s) on ${entry.date}. Nothing was examined, which is not the same claim as nothing being wrong.`,
    );
  }
  const recorded = new Set(entry.evidenceAnchors.split(","));
  const added = evidenceAnchorsOf(today)
    .split(",")
    .filter((h) => h && !recorded.has(h));
  if (added.length > 0) {
    return stale(
      `Ledger verdict is STALE — ${added.length} piece(s) of evidence are NEW since the verdict was recorded on ${entry.date} (${was} item(s) then, ${today.length} now). A conformity covers what was read, and this was not. Re-adjudicate this criterion.`,
    );
  }
  return { holds: true };
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
function reanchor<T extends { file: string; line: number; selector?: string; snippet?: string }>(
  stored: T[] | undefined,
  today: Evidence[],
  currentFiles: ReadonlyMap<string, string>,
): T[] | undefined {
  if (!stored?.length) return stored;
  const byKey = new Map(today.map((e) => [anchorKey(e), e]));
  const byLocation = new Map<string, Evidence[]>();
  for (const evidence of today) {
    const key = `${canonicalFile(evidence.file)}:${evidence.line}`;
    const matches = byLocation.get(key);
    if (matches) matches.push(evidence);
    else byLocation.set(key, [evidence]);
  }
  return stored.map((s) => {
    const exact = byKey.get(anchorKey(s));
    const atLine = byLocation.get(`${canonicalFile(s.file)}:${s.line}`) ?? [];
    // Models often omit the optional selector, while candidate browser measurements carry a
    // note rather than a DOM snippet. A unique anchor at the same canonical file+line is still
    // enough to move the path; applyAdjudication re-grounds the claim afterwards.
    const now = exact ?? (atLine.length === 1 ? atLine[0] : atLine.find((evidence) => norm(evidence.snippet) === norm(s.snippet ?? "")));
    if (now && (now.line !== s.line || now.file !== s.file)) return { ...s, file: now.file, line: now.line };

    // An adjudicator may legitimately cite a neighbour or supporting source that was inside
    // the audited snapshot but was not itself one of THIS criterion's harvested anchors. The
    // fold accepts that only after grounding it in a file the audit read. Such an off-harvest
    // citation has no `today` counterpart for the exact/snippet lookup above, yet its checkout
    // prefix still has to move: a macOS path committed to the ledger does not exist on Linux.
    // `scope.inputs` is the authoritative current checkout mapping. Move the FILE only and
    // keep the claimed line/snippet strict; applyAdjudication will re-ground both afterwards.
    const currentFile = currentFiles.get(canonicalFile(s.file));
    return currentFile && currentFile !== s.file ? { ...s, file: currentFile } : s;
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

/** Would a ledger written from THIS harvest be replayable? Names what is missing when not.
 *
 *  A ledger entry is keyed on a fingerprint of the evidence the verdict was ruled against, and
 *  the harvest RE-READS the audited files from disk. So a verdict recorded where the audit's
 *  page captures are absent is fingerprinted over a strictly smaller evidence set than the one
 *  CI will rebuild — and it is stale on arrival, every time, silently.
 *
 *  Measured while adjudicating a real repository from a checkout with no `.ultra11y/pages/`:
 *  RGAA 12.3 was recorded over 13 evidence items where the run harvests 22. The entry looked
 *  perfectly well-formed, the fold accepted it, the file was committed and reviewed — and the
 *  replay dropped it as stale on every subsequent run, with nothing anywhere saying why.
 *
 *  Returns the page ids the audit says it read and whose capture is not on disk. Empty when
 *  there is nothing to warn about — including on a source-only audit, which legitimately has
 *  no captures to miss. */
export function unreadableCaptures(audit: AuditResult, cwd = "."): string[] {
  return (audit.scope.pagesAudited ?? []).filter((id) => !existsSync(join(cwd, PAGES_DIR, id, "dom.html")));
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
      // Normalised here too: a citation may have arrived as a bare "file:line" string, and a
      // ledger entry has to hold the object form so a replay can re-anchor and re-ground it.
      ...(it.citations?.length ? { citations: it.citations.map(readCitation).filter((c): c is Evidence => c !== null) } : {}),
      ...(it.findings?.length ? { findings: it.findings } : {}),
      ...(it.recommendations?.length ? { recommendations: it.recommendations } : {}),
      evidenceFingerprint: evidenceFingerprint(it.evidence),
      evidenceAnchors: evidenceAnchorsOf(it.evidence),
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

export interface PrunedLedgerResult {
  ledger: VerdictLedger;
  removedEntries: number;
  removedFindings: number;
}

/** Remove claims withdrawn by `verify --prune` from the reusable verdict ledger too.
 * Otherwise the repaired audit is honest for one run, then the next replay resurrects the
 * exact claim the independent reviewer rejected. Reopened criteria are deleted wholesale;
 * a criterion that remains NC keeps only its still-supported findings. */
export function pruneLedger(
  ledger: VerdictLedger,
  items: VerifyItem[],
  reopenedCriteria: readonly string[],
  clearedConformities: readonly string[],
): PrunedLedgerResult {
  const dropCriteria = new Set([...reopenedCriteria, ...clearedConformities]);
  const withdrawn = new Map<string, Set<string>>();
  const findingKey = (f: { file: string; line: number; selector?: string }) => `${canonicalFile(f.file)}|${f.line}|${(f.selector ?? "").trim()}`;
  for (const item of items) {
    if ((item.verdict ?? "").trim().toLowerCase() !== "refuted" && (item.verdict ?? "").trim().toLowerCase() !== "unsupported") continue;
    if (item.kind === "c") continue;
    const set = withdrawn.get(item.criteriaId) ?? new Set<string>();
    set.add(findingKey(item));
    withdrawn.set(item.criteriaId, set);
  }

  let removedEntries = 0;
  let removedFindings = 0;
  const entries: LedgerEntry[] = [];
  for (const entry of ledger.entries) {
    if (dropCriteria.has(entry.criteriaId)) {
      removedEntries++;
      continue;
    }
    const anchors = withdrawn.get(entry.criteriaId);
    if (!anchors?.size || !entry.findings?.length) {
      entries.push(entry);
      continue;
    }
    const findings = entry.findings.filter((finding) => {
      const keep = !anchors.has(findingKey(finding));
      if (!keep) removedFindings++;
      return keep;
    });
    if (entry.verdict === "NC" && findings.length === 0) {
      removedEntries++;
      continue;
    }
    entries.push({ ...entry, findings });
  }
  return { ledger: { ...ledger, entries }, removedEntries, removedFindings };
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
  // Whether this run read everything it says it read. The subset rule below is only sound over
  // a complete harvest — see `verdictStillHolds`.
  const harvestComplete = unreadableCaptures(audit, opts.cwd ?? ".").length === 0;
  const currentFiles = new Map<string, string>();
  for (const input of audit.scope.inputs) {
    const canonical = canonicalFile(input);
    if (canonical.startsWith(`${PAGES_DIR}/`)) currentFiles.set(canonical, input);
  }

  for (const e of ledger.entries) if (!open.has(e.criteriaId)) obsolete.push(e.criteriaId);

  for (const it of worklist) {
    const e = byId.get(it.criteriaId);
    if (!e) {
      missing.push(it.criteriaId);
      residualReasons[it.criteriaId] = "No verdict in the ledger — this criterion has never been adjudicated. Run an adjudication pass to record one.";
      continue;
    }
    const held = verdictStillHolds(e, it.evidence, { harvestComplete });
    if (!held.holds) {
      stale.push(it.criteriaId);
      residualReasons[it.criteriaId] = held.why;
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
      findings: reanchor(e.findings, it.evidence, currentFiles) ?? [],
      ...(e.citations ? { citations: reanchor(e.citations, it.evidence, currentFiles) ?? [] } : {}),
      ...(e.recommendations ? { recommendations: reanchor(e.recommendations, it.evidence, currentFiles) ?? [] } : {}),
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
