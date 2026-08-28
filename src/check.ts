// `check` — structural integrity gate on a produced report. Catches the ways a
// report can lie: a section dropped, a cited criterion that doesn't exist in the
// active standard, an NA without a justification, a missing pass rate. Exit non-zero
// on any issue. This is the anti-hallucination guard around the audit deliverable.
// The canonical WCAG report is keyed by 3-segment success criteria (1.4.3); a pack
// report by the pack's own 2-segment ids (RGAA 8.3) — the id grammar is per-standard
// so the version token "WCAG 2.2 —" can never be mistaken for a criterion.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AuditResult, Lang } from "./types.js";
import { automatability, hasSC } from "./wcag.js";
import {
  type StandardId,
  CORE,
  criterionCoverage,
  getCriterion,
  isCore,
  loadPack,
  hasId,
  idCaptureSource,
  derivePackResults,
  isProvisionalJudgmentInapplicable,
} from "./standards/index.js";
import { buildWorklist, applyVerdicts, type VerifyItem, verifyGroundingInputs } from "./verify.js";
import { groundItems } from "./grounding.js";
import { isPagesReport, pageCriterionRows } from "./pages-report.js";
import { attributePages, derivePages, pagesOf } from "./pages.js";
import { PAGES_DIR } from "./snapshot.js";

export interface CheckResult {
  ok: boolean;
  issues: string[];
}

const M = {
  fr: {
    section: (n: number) => `Section ${n} manquante dans le rapport.`,
    crit: (id: string) => `Critère inexistant cité dans le rapport : ${id}.`,
    na: (id: string) => `Critère NA sans justification : ${id}.`,
    rateMissing: "Taux de réussite absent de l'en-tête du rapport.",
    rateRange: (v: string) => `Taux de réussite hors bornes (0–100) : ${v}%.`,
    rateInconsistent: (v: string, expected: number, c: number, nc: number) =>
      `Taux de réussite incohérent avec la synthèse : l'en-tête indique ${v}% alors que C automatique ÷ (C automatique+NC) = ${c} ÷ ${c + nc} = ${expected}%.`,
    overProject: (id: string) =>
      `Critère sur-projeté : ${id} est marqué non conforme dans le rapport mais l'audit ne le dérive pas comme NC (élément hors périmètre du critère).`,
    underProject: (id: string) => `Critère absent : l'audit dérive ${id} comme non conforme mais le rapport ne le présente pas.`,
    semanticMissing: (p: string) =>
      `Gate sémantique : aucun artefact de verdicts trouvé (${p}). Générez la worklist (\`verify --report <md>\`), statuez, puis relancez — ou passez \`--verdicts <fichier>\`.`,
    semanticUnreadable: (p: string) => `Gate sémantique : artefact de verdicts illisible ou JSON invalide : ${p}.`,
    semanticGate: (failed: number, total: number) => `Gate sémantique : ${failed}/${total} verdict(s) en échec (non statué, réfuté, non étayé ou non couvert).`,
    semanticGround: (issue: string) => `Gate sémantique : ${issue}`,
    unevidenced: (id: string, tier: string, tool: string) =>
      `Conformité non étayée : ${id} est déclaré conforme, mais ce critère se tranche au ${tier} et cet audit n'a produit aucune preuve de ce type. Lancez ${tool}, puis ré-auditez — ou laissez le critère « à évaluer ».`,
  },
  en: {
    section: (n: number) => `Section ${n} missing from the report.`,
    crit: (id: string) => `Non-existent criterion cited in the report: ${id}.`,
    na: (id: string) => `NA criterion without a justification: ${id}.`,
    rateMissing: "Pass rate missing from the report header.",
    rateRange: (v: string) => `Pass rate out of range (0–100): ${v}%.`,
    rateInconsistent: (v: string, expected: number, c: number, nc: number) =>
      `Pass rate inconsistent with the synthesis table: header says ${v}% but automatic C ÷ (automatic C+NC) = ${c} ÷ ${c + nc} = ${expected}%.`,
    overProject: (id: string) =>
      `Over-projected criterion: ${id} is marked non-conformant in the report but the audit does not derive it as NC (element outside the criterion's scope).`,
    underProject: (id: string) => `Missing criterion: the audit derives ${id} as non-conformant but the report does not present it.`,
    semanticMissing: (p: string) =>
      `Semantic gate: no verdicts artifact found (${p}). Generate the worklist (\`verify --report <md>\`), adjudicate it, then re-run — or pass \`--verdicts <file>\`.`,
    semanticUnreadable: (p: string) => `Semantic gate: verdicts artifact unreadable or invalid JSON: ${p}.`,
    semanticGate: (failed: number, total: number) => `Semantic gate: ${failed}/${total} verdict(s) failing (unadjudicated, refuted, unsupported or uncovered).`,
    semanticGround: (issue: string) => `Semantic gate: ${issue}`,
    unevidenced: (id: string, tier: string, tool: string) =>
      `Unevidenced conformity: ${id} is declared conformant, but this criterion is decided on the ${tier} and this audit produced no evidence of that kind. Run ${tool}, then re-audit — or leave the criterion "to assess".`,
  },
} as const;

export interface CheckOpts {
  /** When given (with a pack standard), the applicability gate (R1) re-derives the pack
   *  view from this audit and fails on any NC criterion the report over- or under-projects. */
  audit?: AuditResult;
}

export function checkReport(md: string, standard: StandardId = "wcag", lang: Lang = "en", opts: CheckOpts = {}): CheckResult {
  const issues: string[] = [];
  const s = M[lang];
  const core = isCore(standard);
  const pack = core ? null : loadPack(standard);
  const exists = (id: string) => (core ? hasSC(id) : hasId(pack!, id));
  // Core = the fixed 3-segment WCAG grammar (1.4.3). A pack's grammar is whatever its own
  // `idPattern` declares (RGAA's 2-segment "8.3", a hypothetical Section 508 "E205.4"…) —
  // built from the pack itself so the version token "WCAG 2.2 —" can never be mistaken
  // for a criterion, without the engine hardcoding a single fixed pack shape.
  const idGrammar = core ? "\\d{1,2}(?:\\.\\d{1,2}){2}" : idCaptureSource(pack!);
  // A REAL criterion always renders "<id> — <title>", so "<id> —" (below) recognizes it
  // wherever it sits. But a FABRICATED id has no title (the lookup fails), so the auditor
  // block renders it BARE — on its "### 🔴 <id>" heading and its "**<criterion>** :" /
  // "**WCAG** :" lines with no em-dash. Anchoring ONLY on "<id> —" is therefore blind to
  // fabrications by construction (the exact P0 the gate exists to stop), so we ALSO scan
  // those bare structural positions. The trailing `(?=\s|—|$)` lookahead keeps a pack's
  // 2-segment grammar from mis-matching a 3-segment WCAG mapping ref (e.g. "1.3.1" on a
  // pack's **WCAG** line stops at "1.3" then a ".", never a boundary).
  const bound = "(?=\\s|—|$)";
  const critRefs = [
    new RegExp(`(${idGrammar})\\s*—`, "g"), // "<id> — <title>" (real criteria, anywhere)
    new RegExp(`^#{2,4}\\s+\\S+\\s+(?:.*?\\s)?(${idGrammar})${bound}`, "gm"), // auditor-block heading "### 🔴 <id>" (pack: "### 🔴 RGAA <id>")
    new RegExp(`^\\*\\*[^*\\n]+\\*\\*\\s*:\\s*(${idGrammar})${bound}`, "gm"), // "**Success criterion** : <id>" / "**WCAG** : <id>"
  ];
  const naItem = core ? /^-\s+(?:[A-Za-z]+\s+)?(\d{1,2}(?:\.\d{1,2}){2})\s*—/ : new RegExp(`^-\\s+(?:[A-Za-z]+\\s+)?(${idCaptureSource(pack!)})\\s*—`);

  // A PER-PAGE report (`pages --format report`) is a different deliverable: one dossier per
  // page, no §1–5 conformance structure and no single synthesis table. Gating it as a
  // conformance report would emit five misleading "missing section" errors — a confusing
  // refusal rather than an explicit one — so it runs a profile instead: the gates that still
  // mean something here (no invented criterion, a sane rate) and not the ones that do not.
  // The anti-hallucination gate is the point of `check`, and it is the one that is kept.
  const perPage = isPagesReport(md);

  // 1. required sections (language-agnostic: "## 1." … "## 5.")
  if (!perPage) {
    for (let n = 1; n <= 5; n++) {
      if (!new RegExp(`^##\\s+${n}\\.`, "m").test(md)) issues.push(s.section(n));
    }
  }

  // 2. every cited criterion id must resolve to a real criterion in the active standard
  const seen = new Set<string>();
  for (const critRef of critRefs) {
    let m: RegExpExecArray | null;
    critRef.lastIndex = 0;
    while ((m = critRef.exec(md))) {
      const id = m[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!exists(id)) issues.push(s.crit(id));
    }
  }

  // 3. every NA entry must carry a justification (section 4 list items)
  const naSection = sectionBody(md, 4);
  for (const line of naSection.split("\n")) {
    const item = naItem.exec(line);
    if (item && !line.includes("_")) issues.push(s.na(item[1]!));
  }

  // 4. a pass rate must be present in a header bullet, be a sane 0–100 value, AND be
  // arithmetically consistent with the report's own C/NC synthesis totals (a report that
  // claims 99% while its table implies 17% is lying). The rate is defined as C ÷ (C + NC),
  // rounded — mirroring src/audit.ts's conformancePct — so we recompute it from the Total
  // row and fail on a material disagreement (±1 for rounding). Agent-adjudicated
  // conformities appear in the synthesis, but deliberately do not enter the AUTOMATIC rate;
  // the exhaustive grid identifies those rows so they can be subtracted before comparing.
  // This applies equally to core and pack reports: both headers are now computed on their own
  // active standard, and letting packs skip the check is how a 16% header shipped beside C=0.
  const rateM = /^-\s+\*\*[^*\n]*\*\*\s*:\s*(\d+(?:[.,]\d+)?)\s*%/m.exec(md);
  if (!rateM) {
    // A per-page report carries one rate PER PAGE, inside each page's own block, and no
    // document-level rate to find in a header. Its absence is the correct shape, not a lie.
    if (!perPage) issues.push(s.rateMissing);
  } else {
    const pct = parseFloat(rateM[1]!.replace(",", "."));
    if (pct < 0 || pct > 100) issues.push(s.rateRange(rateM[1]!));
    // A per-page report has no single synthesis table to be consistent WITH: its rates are
    // per page and each is computed from that page's own grid. Range still applies.
    else if (!perPage) {
      const totals = synthesisTotals(md);
      if (totals) {
        const { nc } = totals;
        const c = Math.max(0, totals.c - agentConformities(md));
        const expected = c + nc === 0 ? 100 : Math.round((c / (c + nc)) * 100);
        if (Math.abs(pct - expected) > 1) issues.push(s.rateInconsistent(rateM[1]!, expected, c, nc));
      }
    }
  }

  // 5. applicability gate (pack + --in audit): the report's non-conformant criteria set
  // must EQUAL what the audit derives with applicability (src/standards/derive.ts). Catches
  // a hand-edited report that over-projects an NC onto an inapplicable criterion (RGAA R1),
  // or drops a real one. Only runs for a pack standard with an audit in hand.
  // Skipped for a per-page report: its NC set is per page, so comparing it to the SCOPE-WIDE
  // derivation would flag every criterion that fails on one page and not another.
  if (!core && pack && opts.audit && !perPage) {
    const derivedNc = new Set(
      derivePackResults(opts.audit, standard)
        .filter((r) => r.status === "NC")
        .map((r) => r.id),
    );
    const reportNc = packReportNcIds(md, idCaptureSource(pack));
    for (const id of reportNc) if (!derivedNc.has(id)) issues.push(s.overProject(id));
    for (const id of derivedNc) if (!reportNc.has(id)) issues.push(s.underProject(id));
  }

  // 6. evidence gate: a criterion the report declares CONFORMANT whose verdict can only
  // come from a tier this audit never ran.
  //
  // Contrast, focus visibility and reflow are not decided by reading source — they are
  // measured on a render. An audit that never rendered anything and still publishes them
  // as conformant is making the one claim this tool must never make: a pass nobody tested.
  //
  // Scoped deliberately tight, so it refuses only what is unambiguously wrong:
  //   · needs `opts.audit` — without it there is no way to know what evidence exists;
  //   · reads only the ENGINE-decided half of section 3. An agent that rules a rendering
  //     criterion conformant has looked at something this audit cannot see, and section 3
  //     already separates that claim under its own heading;
  //   · treats an ABSENT `pagesAudited` as unknown, never as zero — an audit written
  //     before that field existed must not start failing.
  if (opts.audit) {
    const engineC = sectionBody(md, 3).split(/^###\s/m)[0] ?? "";
    const cItem = new RegExp(`^-\\s+(?:[A-Za-z]+\\s+)?(${idGrammar})\\s*—`, "gm");
    const scanned = hasScanEvidence(opts.audit);
    const rendered = hasRenderedEvidence(opts.audit);
    const claimed = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = cItem.exec(engineC))) claimed.add(m[1]!);
    for (const id of claimed) {
      const tier = criterionCoverage(standard, id)?.tier;
      if (tier === "browser" && !scanned) issues.push(s.unevidenced(id, core ? "browser" : "navigateur", "`ultra11y scan <target> --merge`"));
      else if (tier === "rendered-page" && rendered === false && !scanned) {
        issues.push(s.unevidenced(id, core ? "rendered page" : "rendu de page", "`ultra11y render` (or an E2E capture)"));
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Did a dynamic scan actually run? Either it recorded which SCs it measured, or its
 *  engines left findings behind. Same signal `untestedNeedsRendering` reads. */
function hasScanEvidence(r: AuditResult): boolean {
  if ((r.scope.scan?.testedScs ?? []).length > 0) return true;
  return r.findings.some((f) => f.ruleId.startsWith("dyn-") || f.ruleId.startsWith("axe:"));
}

/** Was a page snapshot audited? `undefined` means UNKNOWN (an audit predating the field),
 *  and unknown must never be read as "no" — that would fail an old report on a technicality. */
function hasRenderedEvidence(r: AuditResult): boolean | undefined {
  if (r.findings.some((f) => f.ruleId.startsWith("rendered-"))) return true;
  const audited = r.scope.pagesAudited;
  return audited === undefined ? undefined : audited.length > 0;
}

/** The set of criterion ids the report presents as non-conformant — parsed from the
 *  section-2 auditor blocks' "**<criterion>** : <id> — …" lines (the theme line "8." can't
 *  match the 2-segment id grammar, so it's never mistaken for a criterion). */
function packReportNcIds(md: string, idGrammar: string): Set<string> {
  const body = sectionBody(md, 2);
  const re = new RegExp(`^\\*\\*[^*\\n]+\\*\\*\\s*:\\s*(${idGrammar})\\s*—`, "gm");
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) ids.add(m[1]!);
  return ids;
}

export interface SemanticOptions {
  /** Path of the report file — anchors the artifact auto-discovery. */
  reportPath: string;
  /** Explicit verdicts artifact; default: `VERIFY.todo.json` next to the report. */
  verdictsPath?: string;
  standard?: StandardId;
  lang?: Lang;
  /** Base dir for resolving the citations' relative file paths (default: cwd). */
  cwd?: string;
}

export interface SemanticResult {
  ok: boolean;
  issues: string[];
  total: number;
  grounded: number;
  moved: number;
  failed: number;
}

/** `check --semantic` — the support-level gate above the structural `checkReport`.
 *  Fails CLOSED: no adjudicated verdicts artifact → fail (a green semantic exit must
 *  always mean the gate actually engaged). Coverage is re-derived from the report
 *  UNCAPPED, so a truncated worklist can't hide non-conformities; every passing
 *  verdict is then re-grounded content-level against the cited source (grounding.ts). */
export function checkSemantic(md: string, opts: SemanticOptions): SemanticResult {
  const lang = opts.lang ?? "en";
  const standard = opts.standard ?? "wcag";
  const s = M[lang];
  const empty = { total: 0, grounded: 0, moved: 0, failed: 0 };

  const artifact = opts.verdictsPath ?? join(dirname(opts.reportPath), "VERIFY.todo.json");
  if (!existsSync(artifact)) return { ok: false, issues: [s.semanticMissing(artifact)], ...empty };
  let items: VerifyItem[];
  try {
    const parsed: unknown = JSON.parse(readFileSync(artifact, "utf8"));
    if (!Array.isArray(parsed)) throw new Error("not an array");
    items = parsed as VerifyItem[];
  } catch {
    return { ok: false, issues: [s.semanticUnreadable(artifact)], ...empty };
  }

  const issues: string[] = [];
  const expected = buildWorklist(md, standard, Number.POSITIVE_INFINITY);
  const gate = applyVerdicts(items, expected);
  if (!gate.ok) issues.push(s.semanticGate(gate.failures.length, gate.total));

  // Content-level re-validation of every verdict that passed the adjudication gate.
  const passing = items.filter((it) => typeof it.verdict === "string" && ["supported", "partial"].includes(it.verdict.trim().toLowerCase()));
  const grounding = groundItems(verifyGroundingInputs(passing), { cwd: opts.cwd });
  for (const issue of grounding.issues) issues.push(s.semanticGround(issue));

  return { ok: issues.length === 0, issues, total: gate.total, grounded: grounding.grounded, moved: grounding.moved, failed: grounding.failed };
}

/** The Conforming/Non-conforming counts from the synthesis table's bold Total row —
 *  `| **Total** | **C** | **NC** | **NA** | **To assess** |` (label is localized but
 *  always bold; the data rows' numeric cells are NOT bold, so only the Total row matches).
 *  null when no such row is present (nothing to cross-check against). */
function synthesisTotals(md: string): { c: number; nc: number } | null {
  const m = /^\|\s*\*\*[^|*]+\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/m.exec(md);
  if (!m) return null;
  return { c: Number.parseInt(m[1]!, 10), nc: Number.parseInt(m[2]!, 10) };
}

/** Conformities in the exhaustive grid that were ruled by the agent. They are genuine
 *  published statuses and belong in the synthesis tally, but the header explicitly labels
 *  its rate automatic, so they are excluded from that one ratio. The grid is the only report
 *  surface that records both status and provenance for NA as well as ordinary C. */
function agentConformities(md: string): number {
  let count = 0;
  for (const line of md.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length === 4 && (cells[1] === "C" || cells[1] === "NA") && (cells[3] === "AI" || cells[3] === "IA")) count++;
  }
  return count;
}

/** The body of section N (between "## N." and the next "## "). */
function sectionBody(md: string, n: number): string {
  const start = new RegExp(`^##\\s+${n}\\.`, "m").exec(md);
  if (!start) return "";
  const from = start.index + start[0].length;
  const next = /^##\s+/m.exec(md.slice(from));
  return next ? md.slice(from, from + next.index) : md.slice(from);
}

// ---- the completeness gate --------------------------------------------------------------
//
// `check --require-decided` — does every criterion of the active standard carry a real
// verdict, or does the grid still say « à évaluer » somewhere?
//
// Why this exists as a GATE rather than a number in a report: a job can be green while
// deciding almost nothing. Measured on a real pull request, the page tier ran, adjudicated
// nothing, published 94 of 106 criteria as « à évaluer » — and reported success, because
// `fail-on` governs non-conformities and an adjudication that lands nothing only warns. A
// reader who trusts the green tick reads a grid that was never filled in.
//
// The escape hatch is a NAMED list, never a threshold. A percentage lets anything through so
// long as enough else passes, and it is precisely the criteria nobody could decide that a
// threshold would hide. An entry states which criterion and why; an entry with no reason
// fails the gate, because "documented" has to mean something.

// ---- the COVERAGE gate ------------------------------------------------------------------
//
// `--require-decided` asks whether every criterion carries a verdict. This asks the question one
// level below it, and it is the one that went unasked for a long time: a sweep that loses pages
// produces a report that is simply SHORTER, and a shorter deliverable reads exactly like a
// complete one. Measured on a real run — a hung probe killed two specs, a serial group took
// fifteen more with it, and the RGAA report shipped with 20 of the 35 declared pages, green,
// with nothing anywhere naming the missing fifteen or saying that any were missing.
//
// A declared page with no capture is not a page that passed. It is a page nobody looked at.

/** One declared page that produced no capture. */
export interface UncapturedPage {
  id: string;
  name: string;
  url: string;
}

export interface SampleCoverage {
  ok: boolean;
  issues: string[];
  /** Declared pages with no snapshot under `.ultra11y/pages/`. */
  missing: UncapturedPage[];
  declared: number;
  captured: number;
}

/** Hold the sample a repository DECLARES against the snapshots a run actually produced.
 *
 *  Reads `.ultra11yrc.json` for the declaration and the pages directory for the captures, so it
 *  answers for the working tree rather than for an audit JSON that may have been produced
 *  elsewhere. A repository that declares no sample has nothing to answer — a gate that fails on
 *  its own absence is a gate that gets turned off. */
export function checkSampleCaptured(root = ".", lang: Lang = "en"): SampleCoverage {
  const fr = lang === "fr";
  let declared: { id: string; name?: string; url?: string }[] = [];
  const rc = join(root, ".ultra11yrc.json");
  let raw: string;
  try {
    raw = readFileSync(rc, "utf8");
  } catch {
    // NO CONFIG AT ALL — nothing is declared, so there is nothing to answer for. This is the
    // one silence that may pass: a gate that fails on its own absence is a gate that gets
    // turned off.
    return { ok: true, issues: [], missing: [], declared: 0, captured: 0 };
  }
  try {
    const cfg = JSON.parse(raw) as { sample?: { pages?: { id: string; name?: string; url?: string }[] } };
    declared = cfg.sample?.pages ?? [];
  } catch (e) {
    // A CONFIG THAT EXISTS AND CANNOT BE READ is the opposite case, and it must not pass. The
    // file is where the sample is declared, so an unparseable one means this gate does not know
    // what the run was supposed to cover — and answering "covered" to that is how a gate
    // disarms itself at exactly the moment something is wrong.
    return {
      ok: false,
      issues: [
        fr
          ? `.ultra11yrc.json est présent mais illisible (${e instanceof Error ? e.message : String(e)}) — impossible de savoir quelles pages ce run devait couvrir. La porte de couverture ne peut pas répondre, et ne répondra donc pas « couvert ».`
          : `.ultra11yrc.json is present but unreadable (${e instanceof Error ? e.message : String(e)}) — there is no way to know which pages this run was meant to cover. The coverage gate cannot answer, so it does not answer "covered".`,
      ],
      missing: [],
      declared: 0,
      captured: 0,
    };
  }
  if (!declared.length) return { ok: true, issues: [], missing: [], declared: 0, captured: 0 };

  let captured = new Set<string>();
  try {
    captured = new Set(
      readdirSync(join(root, PAGES_DIR), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .filter((id) => existsSync(join(root, PAGES_DIR, id, "dom.html"))),
    );
  } catch {
    /* no pages directory at all — every declared page is missing, which is what we report */
  }
  const missing = declared.filter((p) => !captured.has(p.id)).map((p) => ({ id: p.id, name: p.name ?? p.id, url: p.url ?? "" }));

  const issues: string[] = [];
  if (missing.length) {
    const kept = declared.length - missing.length;
    issues.push(
      fr
        ? `${kept}/${declared.length} page(s) déclarée(s) ont été capturées. Aucune capture pour : ${missing.map((m) => `${m.name} (${m.id})`).join(", ")}. Une page déclarée sans capture n'est pas une page conforme, c'est une page que personne n'a regardée.`
        : `${kept}/${declared.length} declared page(s) were captured. No capture for: ${missing.map((m) => `${m.name} (${m.id})`).join(", ")}. A declared page with no capture is not a page that passed — it is a page nobody looked at.`,
    );
  }
  return { ok: issues.length === 0, issues, missing, declared: declared.length, captured: captured.size };
}

/** Numeric-segment order, so 2.1 comes before 10.1. */
function byCriterionId(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** One criterion a project declares it cannot decide, and why. */
export interface UndecidedAllowance {
  criteriaId: string;
  reason: string;
  recordedBy?: string;
  date?: string;
}

export interface UndecidedFile {
  tool?: string;
  kind?: string;
  standard?: string;
  entries: UndecidedAllowance[];
}

export interface DecidedResult {
  ok: boolean;
  issues: string[];
  /** Criteria still « to assess » and NOT covered by an allowance. */
  undecided: string[];
  /** Criteria still « to assess » but declared, with their stated reason. */
  allowed: UndecidedAllowance[];
  total: number;
  /** Per page, the criteria still « to assess » there and not declared. PRESENT — possibly
   *  empty — whenever the caller asked for the page dimension, absent when it did not: `[]`
   *  says the pages were checked and nothing is open, `undefined` says nobody looked, and a
   *  reader of this result must be able to tell those apart. A criterion can be settled for
   *  the RUN and open on a page — that is the normal shape of a per-page norm, and it is
   *  exactly what a page-by-page deliverable is judged on. */
  pages?: { id: string; name: string; undecided: string[] }[];
  /** WHO SETTLED THE STANDARD, this run — the answer to « did all 106 actually run? ».
   *
   *  The question has been asked by hand every time, by counting ledger entries against a
   *  worklist, and the hand count answers the wrong thing: a criterion the static engine
   *  decided never appears in either. The split says it directly, and it is the number worth
   *  watching between runs — every criterion that moves from `agent` to `engine` or `scan` is
   *  one the pass no longer pays a model to read. */
  provenance: { total: number; engine: number; scan: number; agent: number; declared: number; undecided: number };
}

export function isUndecidedFile(v: unknown): v is UndecidedFile {
  return !!v && typeof v === "object" && Array.isArray((v as UndecidedFile).entries);
}

/** Every criterion of `standard` that carries no verdict, minus the ones declared. */
export function checkDecided(
  audit: AuditResult,
  standard: StandardId = CORE,
  lang: Lang = "en",
  opts: { allow?: UndecidedFile; pages?: boolean } = {},
): DecidedResult {
  const fr = lang === "fr";
  const rows = isCore(standard)
    ? audit.criteria.map((c) => ({ id: c.id, status: c.status, decidedBy: c.decidedBy }))
    : (() => {
        const activePack = loadPack(standard);
        return derivePackResults(audit, standard).map((c) => ({
          id: c.id,
          // Subject absence is evidence for adjudicating a judgment criterion, not a verdict.
          // `verify` and every report surface already keep this shape open; the completeness
          // gate must ask the same question or it under-reports the residual work.
          status: isProvisionalJudgmentInapplicable(c, getCriterion(activePack, c.id)) ? ("manual" as const) : c.status,
          decidedBy: c.decidedBy,
        }));
      })();
  const issues: string[] = [];

  const declared = new Map<string, UndecidedAllowance>();
  for (const e of opts.allow?.entries ?? []) {
    if (!e.criteriaId) continue;
    if (!e.reason?.trim()) {
      issues.push(
        fr
          ? `Critère ${e.criteriaId} déclaré indécidable sans motif — un critère laissé ouvert doit dire pourquoi, sinon la déclaration ne vaut rien.`
          : `Criterion ${e.criteriaId} is declared undecidable with no reason — an open criterion must say why, or the declaration means nothing.`,
      );
      continue;
    }
    declared.set(e.criteriaId, e);
  }
  // THE PAGE DIMENSION — a different question, and the one a per-page norm is judged on.
  //
  // The run-wide grid can be complete while a page's is not: a criterion non-conforming
  // somewhere is settled FOR THE RUN, and on a page the failure did not fire on it may still be
  // nobody's verdict. A deliverable that publishes one sheet per page is only complete when
  // every sheet is, so a gate that stops at the run's own grid passes green over exactly the
  // gap the deliverable is about. Measured on egapro: 104/106 decided for the run, 8 to 11 open
  // on each of the 37 pages.
  //
  // Off by default: it is a stricter question, it needs pages in scope, and a project that
  // audits code only has nothing to answer.
  //
  // Computed HERE, before the staleness check below, because the two interact: a criterion open
  // only on a page is not open for the run, and a declaration covering it would otherwise be
  // reported as a stale exception for the thing it is actively excusing.
  const perPage = opts.pages ? openPerPage(audit, standard, lang) : [];

  // A declaration that no longer matches an open criterion is stale, and a stale allowance is
  // how an exception list quietly outlives the thing it excused.
  const open = new Set(rows.filter((r) => r.status === "manual").map((r) => r.id));
  const openAnywhere = new Set([...open, ...perPage.flatMap((p) => p.undecided)]);
  for (const id of declared.keys()) {
    if (!openAnywhere.has(id)) {
      issues.push(
        fr
          ? `Critère ${id} déclaré indécidable, mais il porte désormais un verdict — retirez-le de la liste.`
          : `Criterion ${id} is declared undecidable but now carries a verdict — remove it from the list.`,
      );
    }
  }

  // Sorted the way a criterion id reads, not the way a string does: lexicographic order puts
  // 10.1 before 2.1, and this list is meant to be worked through.
  const undecided = [...open].filter((id) => !declared.has(id)).sort(byCriterionId);
  const allowed = [...open].filter((id) => declared.has(id)).map((id) => declared.get(id)!);
  if (undecided.length) {
    issues.push(
      fr
        ? `${undecided.length}/${rows.length} critère(s) encore « à évaluer » : ${undecided.join(", ")}.`
        : `${undecided.length}/${rows.length} criterion(ia) still to assess: ${undecided.join(", ")}.`,
    );
  }

  // The declared exceptions apply per page too: an allowance a reader signed off once should
  // not have to be signed off again for every route it shows up on.
  const pages = opts.pages
    ? perPage.map((p) => ({ ...p, undecided: p.undecided.filter((id) => !declared.has(id)) })).filter((p) => p.undecided.length)
    : undefined;
  // ONE LINE FOR WHAT IS OPEN EVERYWHERE. Under a per-page norm the usual shape is a criterion
  // the engine cannot decide anywhere, so the naive rendering is thirty-seven identical lines
  // saying « 11.9, 12.3 » — a wall that hides the one page with a problem of its own. What is
  // open on every page is stated once; what is specific to a page is stated on that page.
  const pageCount = pages?.length ?? 0;
  const everywhere = pageCount && pages ? pages[0]!.undecided.filter((id) => pages.every((p) => p.undecided.includes(id))) : [];
  if (everywhere.length) {
    issues.push(
      fr
        ? `Sur les ${pageCount} page(s) concernée(s) : ${everywhere.length} critère(s) encore « à évaluer » — ${everywhere.join(", ")}.`
        : `On all ${pageCount} affected page(s): ${everywhere.length} criterion(ia) still to assess — ${everywhere.join(", ")}.`,
    );
  }
  for (const p of pages ?? []) {
    const own = p.undecided.filter((id) => !everywhere.includes(id));
    if (!own.length) continue;
    issues.push(
      fr
        ? `Page « ${p.name} » : ${own.length} critère(s) encore « à évaluer » — ${own.join(", ")}.`
        : `Page “${p.name}”: ${own.length} criterion(ia) still to assess — ${own.join(", ")}.`,
    );
  }
  // A criterion is counted exactly once, and `manual` wins over its provenance: a still-open
  // criterion recorded as agent-decided (the shape a refused verdict leaves behind) is open,
  // not adjudicated, and counting it under `agent` would be the laundering the gate refuses.
  const settled = rows.filter((r) => r.status !== "manual");
  const provenance = {
    total: rows.length,
    engine: settled.filter((r) => r.decidedBy === undefined || r.decidedBy === "engine").length,
    scan: settled.filter((r) => r.decidedBy === "scan").length,
    agent: settled.filter((r) => r.decidedBy === "agent").length,
    declared: allowed.length,
    undecided: undecided.length,
  };
  return { ok: issues.length === 0, issues, undecided, allowed, total: rows.length, provenance, ...(pages ? { pages } : {}) };
}

export interface RenderedCoverage {
  ok: boolean;
  issues: string[];
  /** Rendering criteria still « to assess » that nothing in this run could have measured. */
  open: string[];
  /** Rendering criteria still open but declared, with their stated reason. */
  allowed: UndecidedAllowance[];
  /** Pages whose real DOM this audit read. Zero is what makes the gate fire. */
  pagesAudited: number;
}

/** THE INSTRUMENT GATE — were the criteria that need a browser given one?
 *
 *  `--require-decided` asks whether every criterion carries a verdict; `--require-sample` asks
 *  whether the run looked at every page it declares. This asks the question underneath both,
 *  and it is the one that went unasked. Measured on the 2026-08-20 RGAA cascade — three passes,
 *  311 turns, $24.90 — seven criteria came back `needs-rendered-dom` and every one of them was
 *  RIGHT: the workflow audited sources only and no page was ever snapshotted. The job was
 *  green, the report said « à évaluer », and nothing anywhere said *because nobody rendered
 *  anything* — so two further passes were bought to rediscover it.
 *
 *  It asks about the INSTRUMENT, never about the answer. A run that rendered a page and still
 *  could not settle 1.4.5 passes: that is the honest residual this whole tool exists to
 *  preserve, and failing on it would push a project to manufacture a verdict. What fails is
 *  a rendering criterion left open by a run where the tier never ran at all.
 *
 *  `scope.pagesAudited === undefined` is UNKNOWN, not none — an audit written before that
 *  field existed cannot answer, and a gate that fails on "unknown" is one that gets turned
 *  off on the next run. */
export function checkRendered(audit: AuditResult, standard: StandardId = CORE, lang: Lang = "en", opts: { allow?: UndecidedFile } = {}): RenderedCoverage {
  const fr = lang === "fr";
  const issues: string[] = [];

  const declared = new Map<string, UndecidedAllowance>();
  for (const e of opts.allow?.entries ?? []) {
    if (!e.criteriaId) continue;
    if (!e.reason?.trim()) {
      issues.push(
        fr
          ? `Critère ${e.criteriaId} déclaré indécidable sans motif — un critère laissé ouvert doit dire pourquoi.`
          : `Criterion ${e.criteriaId} is declared undecidable with no reason — an open criterion must say why.`,
      );
      continue;
    }
    declared.set(e.criteriaId, e);
  }

  const audited = audit.scope.pagesAudited;
  const pagesAudited = audited?.length ?? 0;
  const unknown = audited === undefined && (audit.scope.pages ?? []).length > 0;
  if (pagesAudited > 0 || unknown) {
    return { ok: issues.length === 0, issues, open: [], allowed: [], pagesAudited };
  }

  const rendering = renderingCriteriaOpen(audit, standard);
  const open = rendering.filter((id) => !declared.has(id)).sort(byCriterionId);
  const allowed = rendering.filter((id) => declared.has(id)).map((id) => declared.get(id)!);
  if (open.length) {
    issues.push(
      fr
        ? `${open.length} critère(s) exigent une page rendue et aucune page n'a été instantanée : ${open.join(", ")}. Lancez \`ultra11y scan <url> --merge <audit.json>\` (ou \`scan --sample\`) avant d'adjuger — la mesure en ferme la plupart sans modèle.`
        : `${open.length} criterion(ia) need a rendered page and no page was snapshotted: ${open.join(", ")}. Run \`ultra11y scan <url> --merge <audit.json>\` (or \`scan --sample\`) before adjudicating — the measurement closes most of them with no model in the loop.`,
    );
  }
  return { ok: issues.length === 0, issues, open, allowed, pagesAudited };
}

/** The active standard's still-undecided criteria whose WCAG class is `needs-rendering`.
 *
 *  A pack criterion inherits the WORST class among the success criteria it maps to — the same
 *  fold `buildAdjudicationWorklist` applies — because a criterion needing a rendered DOM for
 *  any one of them needs one, full stop. */
function renderingCriteriaOpen(audit: AuditResult, standard: StandardId): string[] {
  if (isCore(standard)) {
    return audit.criteria.filter((c) => c.status === "manual" && automatability(c.id) === "needs-rendering").map((c) => c.id);
  }
  const pack = loadPack(standard);
  return derivePackResults(audit, standard)
    .filter((pc) => pc.status === "manual")
    .filter((pc) => (getCriterion(pack, pc.id)?.wcag ?? pc.scs).some((sc) => automatability(sc) === "needs-rendering"))
    .map((pc) => pc.id);
}

/** Every page in scope, with the criteria still « to assess » on it — BEFORE any allowance is
 *  applied, because the staleness check needs to know what is open regardless of what is
 *  excused. Empty when nothing was snapshotted: a repository that audits code only has no page
 *  dimension to answer for, and inventing one would fail a gate over an absence. */
function openPerPage(audit: AuditResult, standard: StandardId, lang: Lang): { id: string; name: string; undecided: string[] }[] {
  const scope = pagesOf(audit);
  if (!scope.length) return [];
  attributePages(audit, scope);
  const out: { id: string; name: string; undecided: string[] }[] = [];
  for (const page of derivePages(audit, scope)) {
    const openHere = pageCriterionRows(audit, page, standard, lang)
      .filter((r) => r.status === "manual")
      .map((r) => r.id)
      .sort(byCriterionId);
    if (openHere.length) out.push({ id: page.id, name: page.name, undecided: openHere });
  }
  return out;
}
