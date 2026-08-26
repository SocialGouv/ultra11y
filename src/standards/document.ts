// THE PACK-KEYED AUDIT DOCUMENT — what `audit --standard <pack>` emits, and how it is read
// back.
//
// `audit` used to be WCAG-keyed with no way out: it took no `--standard`, ignored
// `.ultra11yrc.json { "standard": "rgaa" }`, and printed « WCAG 2.2 AA audit » with `[3.1.1]`
// tags in English at a French project that had declared RGAA. Every other command already
// spoke the pack — `report --standard rgaa --format github` emits `title=RGAA 8.4` — so the
// vocabulary was there and only the entry point was wired to the core.
//
// Selecting a standard now re-keys the DOCUMENT. It cannot re-key the ENGINE: a pack
// criterion is defined as a projection of WCAG success criteria (rgaa.json maps each of its
// 106 onto SCs), so without the core results there is nothing to project from — and
// report/prd/tickets/pages/check/verify/judge and the verdict ledger all read them. The core
// therefore travels inside the document, under `core`, where no rendering looks; everything a
// reader sees is the pack's own.
//
// `unwrapAudit` is the counterpart every `--in <audit.json>` consumer goes through, so a
// pack document is accepted anywhere a core one is and the caller never has to care which it
// was handed.
import type { AuditResult, PackAuditResult, PackCriterionEntry, PackFinding, PackThemeTally, Finding, Lang, ResidualRisk } from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { packAutomatability } from "../adjudicate.js";
import { derivePackResults, packConformancePct, packCriteriaForFinding } from "./derive.js";
import { CORE_KEY, loadPack } from "./registry.js";
import { themeName, titlePlain, getCriterion, hasId } from "./pack.js";
import { standardLabel } from "./index.js";
import type { StandardPack } from "./types.js";

/** Type guard for the document `audit --standard <pack>` writes. Structural, and deliberately
 *  strict about `core`: a document whose core is missing cannot be unwrapped, and letting it
 *  through would surface as a TypeError three commands downstream. */
export function isPackAudit(v: unknown): v is PackAuditResult {
  const d = v as Partial<PackAuditResult> | null;
  return (
    !!d &&
    d.tool === "ultra11y" &&
    d.kind === "pack-audit" &&
    typeof d.standard === "string" &&
    d.standard !== CORE_KEY &&
    typeof d.core === "object" &&
    d.core !== null
  );
}

/** The canonical WCAG-keyed result behind any audit document — the core itself, or the core a
 *  pack document carries. Every `--in` consumer calls this, so nothing downstream has to know
 *  which shape it was given. */
export function unwrapAudit<T>(v: T | PackAuditResult): T | AuditResult {
  return isPackAudit(v) ? v.core : (v as T);
}

/**
 * The document a command should WRITE BACK, in the active standard's shape.
 *
 * The rule is one line long on purpose: **a document is written in the standard the command
 * was run under**, never in the shape of whatever file it happened to read. `scan --merge`,
 * `verify --apply` and `judge --apply` all rewrite `audit-latest.json` mid-chain, and a chain
 * whose shape depended on which step last touched the file would drift silently — the first
 * step keyed RGAA, the second read it, wrote core, and the third reported WCAG at a project
 * that never asked for it.
 *
 * With `.ultra11yrc.json { "standard": "rgaa" }` the flag defaults are already RGAA at every
 * step (src/cli.ts applies `defaultStandard`), so the chain stays RGAA without repeating it.
 */
export function auditDocumentFor(audit: AuditResult | PackAuditResult, standard: string, lang: Lang): AuditResult | PackAuditResult {
  return standard === CORE_KEY ? (unwrapAudit(audit) as AuditResult) : packAuditDocument(audit, standard, lang);
}

/**
 * The pack criteria one finding fires on, `[]` when it belongs to no criterion of this
 * standard — which is how a core-only finding stays out of a pack rendering.
 *
 * TWO WAYS A FINDING CAN BELONG, and missing the second one is what printed « WCAG 4.11 » in
 * CI annotations for months:
 *
 *   1. Its rule maps onto pack criteria (`packCriteriaForFinding`). This is every engine rule.
 *   2. It is ALREADY keyed on a pack criterion. An agent adjudicating at the pack's own
 *      granularity records `{ ruleId: "agent:4.11", criteriaId: "4.11" }`, and a declarative
 *      pack rule records `pack:rgaa:*` — measured on this repository's own fixture, 27
 *      findings inside the WCAG-keyed list carrying RGAA ids (1.6, 4.11, 10.14, 11.4…). Fall
 *      through to rule 1 and `packCriteriaForFinding` matches nothing, because it looks up
 *      `pc.wcag.includes("4.11")` and 4.11 is not a success criterion. The old fallback then
 *      labelled it `WCAG 4.11` — a criterion that does not exist in any version of WCAG.
 */
export function packCriteriaOf(pack: StandardPack, f: Finding): string[] {
  const mapped = packCriteriaForFinding(pack, f);
  if (mapped.length) return mapped;
  return hasId(pack, f.criteriaId) ? [f.criteriaId] : [];
}

/** The criterion label a pack-keyed surface should print for one finding. Never mentions
 *  WCAG: under a standard, a finding either belongs to one of its criteria or is not shown. */
export function packCriterionLabel(pack: StandardPack, f: Finding): string | null {
  const ids = packCriteriaOf(pack, f);
  return ids.length ? `${pack.name} ${ids.join(", ")}` : null;
}

/** Re-key a finding onto the pack. `criteriaId` is the FIRST criterion it fires on so every
 *  existing consumer of that field keeps working, and `criteriaIds` carries the rest: one
 *  missing landmark is RGAA 9.2 AND 12.6, and dropping either would understate the grid. */
function packFinding(f: Finding, ids: string[]): PackFinding {
  const { criteriaId: _sc, ...rest } = f;
  return { ...rest, criteriaId: ids[0] as string, criteriaIds: ids };
}

/**
 * Build the pack-keyed document from a core audit.
 *
 * Everything here is a re-keying of results already computed: `derivePackResults` folds the
 * SC verdicts onto the pack's criteria (and prefers an agent adjudication recorded at the
 * pack's own granularity over its own derivation, and folds in the pack's declarative-rule
 * findings), and `packConformancePct` is the pass rate over the pack's own criteria rather
 * than the core's. No verdict is decided here.
 */
export function packAuditDocument(input: AuditResult | PackAuditResult, packKey: string, lang: Lang): PackAuditResult {
  // UNWRAP FIRST, ALWAYS. Four `--in` readers cast their JSON straight to `AuditResult` with
  // no guard, so a pack document reaching one of them was accepted in silence and wrapped a
  // second time — `core.core`, `guidelines` gone from where the next reader looks for it, and
  // `report` refusing an audit it had just written. Unwrapping here makes the operation
  // idempotent, so the corruption cannot be reintroduced by the next unguarded reader either.
  const audit = unwrapAudit(input) as AuditResult;
  const pack = loadPack(packKey);
  const derived = derivePackResults(audit, packKey);

  // THE DERIVATION DECIDES WHICH FINDINGS COUNT, not the raw rule→criterion mapping.
  //
  // Re-keying `findingsForStandard` directly looked equivalent and was not: `derivePackResults`
  // applies the pack's own `appliesTo` scoping, its judgment guard and any agent verdict
  // recorded at the pack's granularity, and a criterion can therefore end up NOT non-conformant
  // while rules that map to it did fire elsewhere. Measured on this repository's fixture, RGAA
  // 4.3 came out « C » carrying three `media-no-track` findings — a conforming criterion
  // publishing its own non-conformities.
  //
  // So each entry takes the findings the derivation attributed to it, and the document's
  // top-level list is exactly their union. A finding appears where the standard counts it, and
  // nowhere else.
  const seen = new Map<Finding, string[]>();
  const criteria: PackCriterionEntry[] = derived.map((d) => {
    const pc = getCriterion(pack, d.id);
    for (const f of d.findings) (seen.get(f) ?? seen.set(f, []).get(f)!).push(d.id);
    return {
      id: d.id,
      theme: d.theme,
      title: pc ? titlePlain(pack, pc, lang) : d.id,
      status: d.status,
      findings: d.findings.map((f) => packFinding(f, [d.id])),
      ...(d.justification ? { justification: d.justification } : {}),
      ...(d.decidedBy ? { decidedBy: d.decidedBy } : {}),
      ...(d.inapplicable ? { inapplicable: true } : {}),
      ...(pc?.automation ? { automation: pc.automation } : {}),
    };
  });
  // One entry per finding, carrying EVERY criterion it counts against: a single missing
  // navigation landmark is RGAA 9.2 and 12.6, and listing it twice would have the document
  // report two defects where the page has one.
  const findings: PackFinding[] = [...seen].map(([f, ids]) => packFinding(f, ids));

  const themes: PackThemeTally[] = pack.themes.map((t) => {
    const rows = criteria.filter((c) => c.theme === t.number);
    return {
      number: t.number,
      title: themeName(pack, t.number, lang) ?? "",
      // `na` is a SUBSET of `c`, never a fourth bucket — a criterion conforming for want of a
      // subject reads C and is counted here to say how many of them there were. c + nc +
      // manual is the criterion count; adding all four overshoots it. Same arithmetic as
      // src/report.ts tallyRows, deliberately: two surfaces disagreeing about one grid is
      // worse than either being wrong.
      c: rows.filter((r) => r.status === "C").length,
      nc: rows.filter((r) => r.status === "NC").length,
      na: rows.filter((r) => r.inapplicable).length,
      manual: rows.filter((r) => r.status === "manual").length,
    };
  });

  // Residual risks re-keyed onto the pack: a core SC still to assess is only a residual for
  // THIS standard if a pack criterion of it is still to assess too. Deriving them from the
  // pack grid rather than copying the core's list is what stops the summary reporting
  // residuals for criteria the pack has already settled.
  const residualRisks: ResidualRisk[] = criteria
    .filter((c) => c.status === "manual")
    .map((c) => ({
      criteriaId: c.id,
      reason: c.justification ?? "",
      automatability: packAutomatability(getCriterion(pack, c.id)?.wcag ?? [], getCriterion(pack, c.id)),
    }));

  return {
    tool: "ultra11y",
    kind: "pack-audit",
    standard: packKey,
    standardLabel: standardLabel(packKey),
    version: audit.version,
    schemaVersion: SCHEMA_VERSION,
    date: audit.date,
    scope: audit.scope,
    themes,
    criteria,
    findings,
    residualRisks,
    conformancePct: packConformancePct(derived),
    core: audit,
  };
}
