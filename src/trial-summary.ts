// `verify --summary` — THE TRIAL'S OWN ACCOUNT (#60).
//
// A counter-review leaves three artifacts behind: the verdicts file, what `--prune` printed, and
// the exit code of `check --semantic`. None of them says, side by side, what the review CONFIRMED,
// what it WITHDREW and whether the withdrawal actually landed, which ENGINE decisions it contests
// (and `--prune` deliberately leaves standing — src/refute.ts), what it never looked at, and
// whether the gate is green. On the audit that surfaced this, the bilan was written by hand from
// 932 verdicts and a log.
//
// This module builds that bilan and changes nothing. It is READ-ONLY by construction: the audit,
// the verdicts and the pruned audit are read, never written; the gate is reported, never
// relaxed. And every input is NAMED: the claims expected on trial are rebuilt from `--in` and the
// report only — no ledger fallback — because a bilan silently associated with an older ledger
// would describe a trial nobody ran.
//
// Three distinctions carry the whole document, because the operator must never be able to read
// one as the other:
//   - a CONTESTED ENGINE DECISION is unresolved. The review says the rule is wrong here; the
//     engine still says it fails. It is neither a confirmed finding nor a conformity;
//   - a withdrawal is APPLIED only when the pruned audit shows it — never assumed from a verdict;
//   - a trial that RAN is not an audit that is VALIDATED: the semantic gate decides that, and it
//     is reported apart from whether the verdicts applied cleanly.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SemanticResult } from "./check.js";
import { pruneRefuted } from "./refute.js";
import { type StandardId, isCore } from "./standards/index.js";
import type { AuditResult, Finding, Lang } from "./types.js";
import { applyVerdicts, buildConformityWorklist, buildWorklist, claimKey, conformityClaimsFromAudit, type VerifyItem } from "./verify.js";

export interface TrialEntry {
  n: number;
  kind: "nc" | "c";
  criteriaId: string;
  file: string;
  line: number;
  selector: string;
  claim: string;
  verdict: string | null;
  note: string;
}

export interface VerdictCounts {
  supported: number;
  partial: number;
  refuted: number;
  unsupported: number;
  /** Left blank. */
  unadjudicated: number;
  /** An unknown verdict token. */
  invalid: number;
  /** Expected on trial and absent from the verdicts file. */
  missing: number;
}

export interface FileIdentity {
  path: string;
  sha256: string;
  date?: string;
}

export interface TrialSummary {
  kind: "trial-summary";
  standard: string;
  identity: { audit: FileIdentity; verdicts: FileIdentity; report: FileIdentity; pruned?: FileIdentity };
  /** Counted in CLAIMS (one per element or evidence set), never in criteria — see `criteria`. */
  claims: { total: number; nc: VerdictCounts; c: VerdictCounts };
  /** The same buckets in distinct criterion ids, for a reader who counts the grid. */
  criteria: { confirmed: string[]; withdrawn: string[]; contested: string[]; untried: string[]; foreign: string[] };
  confirmed: TrialEntry[];
  /** Withdrawn claims `--prune` acts on (agent judgements): `applied` when the pruned audit shows
   *  it, `notApplied` otherwise — including every one of them when no pruned audit was given. */
  withdrawals: { applied: TrialEntry[]; notApplied: TrialEntry[] };
  /** Withdrawn claims that name an ENGINE decision — unresolved by design. */
  contestedEngine: TrialEntry[];
  /** Expected claims with no usable verdict: blank, unknown token, or absent from the file. */
  untried: TrialEntry[];
  /** Verdicts for claims this audit and report do not make — another audit's trial. */
  foreign: TrialEntry[];
  coverage: { expected: number; covered: number; missing: number; foreign: number; complete: boolean };
  /** Whether `verify --apply … --prune` accepts these verdicts (nothing blank, invalid or
   *  missing), and whether a pruned audit was given to check the withdrawals against. */
  application: { ok: boolean; pruned: boolean };
  gate: { ok: boolean; failed: number; total: number; issues: string[] };
  /** Only true when the gate is green AND nothing is missing, foreign or contested. */
  validated: boolean;
}

export interface TrialSummaryInput {
  standard: StandardId;
  lang: Lang;
  audit: AuditResult;
  auditPath: string;
  verdicts: VerifyItem[];
  verdictsPath: string;
  reportMd: string;
  reportPath: string;
  pruned?: { audit: AuditResult; path: string };
  gate: SemanticResult;
}

const sha256 = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

const entry = (it: VerifyItem): TrialEntry => ({
  n: it.n,
  kind: it.kind ?? "nc",
  criteriaId: it.criteriaId,
  file: it.file,
  line: it.line,
  selector: it.selector,
  claim: it.claim,
  verdict: typeof it.verdict === "string" ? it.verdict : null,
  note: typeof it.note === "string" ? it.note : "",
});

const norm = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null);

const emptyCounts = (): VerdictCounts => ({ supported: 0, partial: 0, refuted: 0, unsupported: 0, unadjudicated: 0, invalid: 0, missing: 0 });

/** The record `--prune` writes to for this criterion — the pack's adjudication under a pack. */
function recordOf(audit: AuditResult, standard: StandardId, id: string): { status?: string; findings: Finding[] } | undefined {
  if (!isCore(standard)) return audit.packAdjudication?.standard === standard ? audit.packAdjudication.criteria.find((c) => c.id === id) : undefined;
  return audit.criteria.find((c) => c.id === id);
}

/** Does the pruned audit SHOW this withdrawal? A non-conformity: its anchor is gone from the
 *  criterion. A conformity: the criterion no longer clears (back to « to assess »). */
function withdrawalLanded(pruned: AuditResult, standard: StandardId, it: VerifyItem): boolean {
  const rec = recordOf(pruned, standard, it.criteriaId);
  if (it.kind === "c") return !rec || (rec.status !== "C" && rec.status !== "NA");
  const k = `${it.file.trim()}|${it.line}|${(it.selector ?? "").trim()}`;
  return !rec?.findings.some((f) => `${f.file.trim()}|${f.line}|${(f.selectorHint ?? "").trim()}` === k);
}

const ids = (xs: TrialEntry[]): string[] => [...new Set(xs.map((x) => x.criteriaId))].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

export function buildTrialSummary(input: TrialSummaryInput): TrialSummary {
  const { standard, audit, verdicts } = input;
  const expectedNc = buildWorklist(input.reportMd, standard, Number.POSITIVE_INFINITY);
  const expected = [...expectedNc, ...buildConformityWorklist(conformityClaimsFromAudit(audit, standard), expectedNc.length, Number.POSITIVE_INFINITY)];
  const r = applyVerdicts(verdicts, expected);
  const expectedKeys = new Set(expected.map(claimKey));
  const foreignItems = verdicts.filter((it) => !expectedKeys.has(claimKey(it)));
  const missingItems = r.failures.filter((f) => !verdicts.includes(f));

  const claims = { total: verdicts.length + missingItems.length, nc: emptyCounts(), c: emptyCounts() };
  for (const it of verdicts) {
    const counts = it.kind === "c" ? claims.c : claims.nc;
    const v = norm(it.verdict);
    if (v === null) counts.unadjudicated++;
    else if (v === "supported" || v === "partial" || v === "refuted" || v === "unsupported") counts[v]++;
    else counts.invalid++;
  }
  for (const it of missingItems) (it.kind === "c" ? claims.c : claims.nc).missing++;

  // The prune, dry: which withdrawn claims it would act on and which name an engine decision.
  // Run on the audit the trial was held against, so it is the same decision `--prune` took.
  const untriedForPrune = r.failures.filter((f) => !["refuted", "unsupported"].includes(norm(f.verdict) ?? ""));
  const dry = pruneRefuted(audit, standard, verdicts, input.lang, untriedForPrune);
  const contested = new Set(dry.skippedEngineClaims);
  const foreign = new Set(foreignItems);
  const withdrawnAgent = verdicts.filter((it) => !foreign.has(it) && !contested.has(it) && ["refuted", "unsupported"].includes(norm(it.verdict) ?? ""));
  const applied: TrialEntry[] = [];
  const notApplied: TrialEntry[] = [];
  for (const it of withdrawnAgent) (input.pruned && withdrawalLanded(input.pruned.audit, standard, it) ? applied : notApplied).push(entry(it));

  const confirmed = verdicts.filter((it) => !foreign.has(it) && ["supported", "partial"].includes(norm(it.verdict) ?? "")).map(entry);
  const contestedEngine = verdicts.filter((it) => contested.has(it) && !foreign.has(it)).map(entry);
  const untried = [
    ...verdicts.filter((it) => !foreign.has(it) && !["supported", "partial", "refuted", "unsupported"].includes(norm(it.verdict) ?? "")),
    ...missingItems,
  ].map(entry);
  const foreignEntries = foreignItems.map(entry);

  const coverage = {
    expected: expected.length,
    covered: expected.length - missingItems.length,
    missing: missingItems.length,
    foreign: foreignItems.length,
    complete: missingItems.length === 0 && foreignItems.length === 0,
  };
  const gate = { ok: input.gate.ok, failed: input.gate.issues.length, total: input.gate.total, issues: input.gate.issues };
  const id = (path: string, date?: string): FileIdentity => ({ path, sha256: sha256(path), ...(date ? { date } : {}) });
  return {
    kind: "trial-summary",
    standard,
    identity: {
      audit: id(input.auditPath, audit.date),
      verdicts: id(input.verdictsPath),
      report: id(input.reportPath),
      ...(input.pruned ? { pruned: id(input.pruned.path, input.pruned.audit.date) } : {}),
    },
    claims,
    criteria: {
      confirmed: ids(confirmed),
      withdrawn: ids([...applied, ...notApplied]),
      contested: ids(contestedEngine),
      untried: ids(untried),
      foreign: ids(foreignEntries),
    },
    confirmed,
    withdrawals: { applied, notApplied },
    contestedEngine,
    untried,
    foreign: foreignEntries,
    coverage,
    application: { ok: r.unadjudicated + r.invalid + r.missing === 0, pruned: input.pruned !== undefined },
    gate,
    validated: gate.ok && coverage.complete && contestedEngine.length === 0 && untried.length === 0,
  };
}

// ---- rendering ---------------------------------------------------------------------------

const T = {
  fr: {
    title: "Bilan de contre-expertise",
    validated: "**Contre-expertise exécutée, gate sémantique vert** — l'audit peut être présenté comme validé par la contre-expertise.",
    notValidated: (why: string[]) => `**Contre-expertise exécutée — audit NON validé** : ${why.join(" ; ")}.`,
    whyGate: (n: number) => `gate sémantique en échec (${n} problème(s))`,
    whyContested: (n: number) => `${n} décision(s) moteur contestée(s), non résolue(s)`,
    whyUntried: (n: number) => `${n} revendication(s) jamais mise(s) à l'épreuve`,
    whyForeign: (n: number) => `${n} verdict(s) étranger(s) à cet audit`,
    identity: "Identité",
    file: "Fichier",
    role: "Rôle",
    roles: { audit: "Audit contre-expertisé (--in)", verdicts: "Verdicts (--verdicts)", report: "Rapport (--report)", pruned: "Audit élagué (--pruned)" },
    standard: "Référentiel :",
    coverage: "Couverture",
    coverageLine: (c: TrialSummary["coverage"]) =>
      `${c.covered}/${c.expected} revendication(s) attendue(s) couverte(s), ${c.missing} absente(s), ${c.foreign} étrangère(s) à cet audit${c.complete ? "" : " — **couverture incomplète ou association incohérente**"}.`,
    unitNote:
      "Les nombres comptent des **revendications** (un élément ou un ensemble de preuves), pas des critères : un critère peut en porter plusieurs. Les critères distincts figurent sous chaque section.",
    verdicts: "Verdicts",
    head: "| Revendication | supported | partial | refuted | unsupported | non statué | invalide | absente |",
    nc: "Non-conformité",
    c: "Conformité revendiquée",
    confirmed: "Constats confirmés (supported / partial)",
    applied: "Retraits appliqués",
    appliedNone: "Aucun retrait constaté dans l'audit élagué.",
    notApplied: "Retraits non constatés",
    notAppliedWhy: (pruned: boolean) =>
      pruned
        ? "Ces revendications ont été retirées par la contre-expertise mais l'audit élagué les porte encore."
        : "Aucun audit élagué fourni (--pruned) : ces retraits ne sont PAS constatés. Appliquez-les avec `verify --apply … --prune`, puis passez l'audit obtenu en --pruned.",
    contested: "Décisions moteur contestées — non résolues",
    contestedWhy:
      "La contre-expertise conteste ces décisions du moteur ; `--prune` ne les modifie pas, et elles restent dans l'audit et dans le rapport. Elles ne sont ni des conformités ni des constats confirmés : un faux positif se corrige dans la règle, et le gate reste en échec tant qu'elles demeurent.",
    untried: "Jamais mises à l'épreuve",
    foreign: "Verdicts étrangers à cet audit",
    foreignWhy: "Ces verdicts portent sur des revendications que cet audit et ce rapport ne font pas : la liste vient d'un autre audit ou d'un autre rapport.",
    gate: "Gate sémantique et application",
    application: (a: TrialSummary["application"]) =>
      `Application des verdicts (\`verify --apply … --prune\`) : ${a.ok ? "acceptée" : "refusée (verdicts non statués, invalides ou absents)"}${a.pruned ? "" : " — non constatée : aucun audit élagué fourni"}.`,
    gateLine: (g: TrialSummary["gate"]) =>
      `Gate sémantique (\`check --semantic\` sur ce rapport et ces verdicts) : ${g.ok ? "**vert**" : `**en échec** (${g.failed} problème(s))`}.`,
    none: "Aucun.",
    verdict: "verdict :",
    note: "note :",
    distinct: (n: number) => `${n} critère(s) distinct(s)`,
  },
  en: {
    title: "Counter-review summary",
    validated: "**Counter-review run, semantic gate green** — the audit can be presented as validated by the counter-review.",
    notValidated: (why: string[]) => `**Counter-review run — audit NOT validated**: ${why.join("; ")}.`,
    whyGate: (n: number) => `semantic gate failing (${n} issue(s))`,
    whyContested: (n: number) => `${n} contested engine decision(s), unresolved`,
    whyUntried: (n: number) => `${n} claim(s) never tried`,
    whyForeign: (n: number) => `${n} verdict(s) foreign to this audit`,
    identity: "Identity",
    file: "File",
    role: "Role",
    roles: { audit: "Audit under review (--in)", verdicts: "Verdicts (--verdicts)", report: "Report (--report)", pruned: "Pruned audit (--pruned)" },
    standard: "Standard:",
    coverage: "Coverage",
    coverageLine: (c: TrialSummary["coverage"]) =>
      `${c.covered}/${c.expected} expected claim(s) covered, ${c.missing} missing, ${c.foreign} foreign to this audit${c.complete ? "" : " — **incomplete coverage or inconsistent association**"}.`,
    unitNote:
      "Counts are **claims** (one element or evidence set), not criteria: one criterion may carry several. Distinct criteria are listed under each section.",
    verdicts: "Verdicts",
    head: "| Claim | supported | partial | refuted | unsupported | unadjudicated | invalid | missing |",
    nc: "Non-conformity",
    c: "Claimed conformity",
    confirmed: "Confirmed findings (supported / partial)",
    applied: "Withdrawals applied",
    appliedNone: "No withdrawal shows in the pruned audit.",
    notApplied: "Withdrawals not shown applied",
    notAppliedWhy: (pruned: boolean) =>
      pruned
        ? "The counter-review withdrew these claims but the pruned audit still carries them."
        : "No pruned audit given (--pruned): these withdrawals are NOT shown applied. Apply them with `verify --apply … --prune`, then pass the resulting audit as --pruned.",
    contested: "Contested engine decisions — unresolved",
    contestedWhy:
      "The counter-review contests these engine decisions; `--prune` does not change them, and they stay in the audit and the report. They are neither conformities nor confirmed findings: a false positive is fixed in the rule, and the gate stays red while they remain.",
    untried: "Never tried",
    foreign: "Verdicts foreign to this audit",
    foreignWhy: "These verdicts are about claims this audit and report do not make: the list comes from another audit or report.",
    gate: "Semantic gate and application",
    application: (a: TrialSummary["application"]) =>
      `Verdict application (\`verify --apply … --prune\`): ${a.ok ? "accepted" : "refused (blank, invalid or missing verdicts)"}${a.pruned ? "" : " — not shown: no pruned audit given"}.`,
    gateLine: (g: TrialSummary["gate"]) =>
      `Semantic gate (\`check --semantic\` on this report and these verdicts): ${g.ok ? "**green**" : `**failing** (${g.failed} issue(s))`}.`,
    none: "None.",
    verdict: "verdict:",
    note: "note:",
    distinct: (n: number) => `${n} distinct criterion(ia)`,
  },
} as const;

export function formatTrialSummary(s: TrialSummary, lang: Lang = "en"): string {
  const t = T[lang] ?? T.en;
  const why: string[] = [];
  if (!s.gate.ok) why.push(t.whyGate(s.gate.failed));
  if (s.contestedEngine.length) why.push(t.whyContested(s.contestedEngine.length));
  if (s.untried.length) why.push(t.whyUntried(s.untried.length));
  if (s.foreign.length) why.push(t.whyForeign(s.foreign.length));
  const line = (e: TrialEntry): string =>
    `- **${e.criteriaId}** (${e.kind === "c" ? "C" : "NC"}) ${e.file ? `\`${e.file}:${e.line}\`${e.selector ? ` (\`${e.selector}\`)` : ""} ` : ""}— ${e.claim.replace(/\s+/g, " ").trim()} — ${t.verdict} ${e.verdict ?? "∅"}${e.note.trim() ? ` — ${t.note} ${e.note.trim()}` : ""}`;
  const list = (xs: TrialEntry[]): string => (xs.length ? `${t.distinct(ids(xs).length)}.\n\n${xs.map(line).join("\n")}` : t.none);
  const row = (label: string, c: VerdictCounts): string =>
    `| ${label} | ${c.supported} | ${c.partial} | ${c.refuted} | ${c.unsupported} | ${c.unadjudicated} | ${c.invalid} | ${c.missing} |`;
  const idRow = (role: string, f: FileIdentity): string => `| ${role} | \`${f.path}\`${f.date ? ` (${f.date})` : ""} | \`${f.sha256.slice(0, 12)}\` |`;
  return [
    `# ${t.title}`,
    "",
    s.validated && why.length === 0 ? t.validated : t.notValidated(why.length ? why : [t.whyGate(s.gate.failed)]),
    "",
    `## ${t.identity}`,
    "",
    `${t.standard} \`${s.standard}\``,
    "",
    `| ${t.role} | ${t.file} | sha256 |`,
    "|---|---|---|",
    idRow(t.roles.audit, s.identity.audit),
    idRow(t.roles.verdicts, s.identity.verdicts),
    idRow(t.roles.report, s.identity.report),
    ...(s.identity.pruned ? [idRow(t.roles.pruned, s.identity.pruned)] : []),
    "",
    `## ${t.coverage}`,
    "",
    t.coverageLine(s.coverage),
    "",
    `## ${t.verdicts}`,
    "",
    t.unitNote,
    "",
    t.head,
    "|---|---|---|---|---|---|---|---|",
    row(t.nc, s.claims.nc),
    row(t.c, s.claims.c),
    "",
    `## ${t.confirmed}`,
    "",
    list(s.confirmed),
    "",
    `## ${t.applied}`,
    "",
    s.withdrawals.applied.length ? list(s.withdrawals.applied) : t.appliedNone,
    "",
    `## ${t.notApplied}`,
    "",
    ...(s.withdrawals.notApplied.length ? [t.notAppliedWhy(s.application.pruned), "", list(s.withdrawals.notApplied)] : [t.none]),
    "",
    `## ${t.contested}`,
    "",
    ...(s.contestedEngine.length ? [t.contestedWhy, "", list(s.contestedEngine)] : [t.none]),
    "",
    `## ${t.untried}`,
    "",
    list(s.untried),
    "",
    `## ${t.foreign}`,
    "",
    ...(s.foreign.length ? [t.foreignWhy, "", list(s.foreign)] : [t.none]),
    "",
    `## ${t.gate}`,
    "",
    `- ${t.application(s.application)}`,
    `- ${t.gateLine(s.gate)}`,
    ...s.gate.issues.map((i) => `  - ${i}`),
    "",
  ].join("\n");
}
