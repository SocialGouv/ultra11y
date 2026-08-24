// The AUDITOR conformance block — the DEFAULT rendering of `prd` (backlog + per-criterion)
// and of the GitHub issues it files. Where `renderBacklog`/`issueBody` (prd.ts/gh.ts) speak
// to a developer (Fix / Effort / Occurrences), this speaks to an accessibility AUDITOR: per
// criterion it states the theme, the criterion + its official wording, the test(s), the WCAG
// mapping + level, the finding (non-conformity), the expected conformant state, and a
// verification method. Crucially it renders with the ACTIVE STANDARD's vocabulary
// (src/standards/vocabulary.ts): RGAA reads "Thématique / Critère / Test / C-NC-NA", the WCAG
// core reads "Principle · Guideline / Success criterion / Technique / Pass-Fail", and any
// future country pack reads its own — no term is hardcoded to one standard.
import type { AuditResult, Finding, Lang, Severity } from "./types.js";
import { prdUnits, partitionUnits, effortOf, guidanceFor, guidanceExampleBlock, acceptanceCriteria, type PrdUnit, type PrdFile } from "./prd.js";
import { getSC, guidelineTitle, principleTitle, techniques as scTechniques } from "./wcag.js";
import { resolveMessage, resolveRemediation, resolveNote } from "./messages.js";
import { type StandardId, isCore, loadPack, packTestIds, standardLabel, themeName, vocabularyFor } from "./standards/index.js";
import { mdText } from "./md.js";

const SEV_ORDER: Severity[] = ["bloquant", "majeur", "mineur"];
const ICON: Record<Severity, string> = { bloquant: "🔴", majeur: "🟠", mineur: "🟡" };
const SEV_LABEL: Record<Lang, Record<Severity, string>> = {
  fr: { bloquant: "Bloquant", majeur: "Majeur", mineur: "Mineur" },
  en: { bloquant: "Blocking", majeur: "Major", mineur: "Minor" },
};

// Generic (standard-agnostic) auditor labels; the standard-specific NOUNS come from the
// resolved vocabulary. Kept separate so a pack overrides only its terminology, not the
// auditor frame.
const L = {
  fr: {
    lead: "Lecture auditeur",
    tail: "Correspondance normative.",
    finding: "Constat",
    expected: "Attendu",
    verification: "Vérification",
    occ: "occurrence(s)",
    verify: "contrôler chaque occurrence ci-dessous (inspecteur / lecteur d'écran), puis rejouer l'audit (`ultra11y` / axe).",
    intro:
      "Lecture auditeur : une entrée par critère non conforme (constat, attendu, méthode de vérification). Les critères « à évaluer » (rendu / jugement) sont adjugés par l'agent IA (`verify --manual`, de façon gatée), le rendu via `scan`.",
    date: "Date",
    scope: "Périmètre",
    files: "fichier(s)",
    none: "Aucune non-conformité relevée automatiquement par le moteur statique.",
    captureOf: (comp: string, src: string) => `capture rendue de \`${comp}\` — source \`${src}\``,
    recommendationsTitle: "Recommandations (non normatives)",
    // Advisory (non-normative recommendation) vocabulary — deliberately NOT the NC wording.
    advisoryTag: "Recommandation (non normative)",
    advisoryNote: "Bonne pratique — aucun test normatif du référentiel actif ne l'exige. Ce n'est PAS une non-conformité.",
    observation: "Observation",
    suggestion: "Suggestion",
    relatedRef: "Critère lié",
    // Unified ticket template (Task 2).
    priority: "Priorité",
    technical: "Partie technique",
    impactedFiles: "Fichiers impactés",
    pages: "Pages / URLs impactées",
    change: "Changement attendu",
    ac: "Critères d'acceptation",
    complexity: "Complexité",
    pts: "pts",
    reproduction: "Contexte de reproduction",
    authRequired: "authentification requise",
    yes: "oui",
    no: "non",
    unknown: "inconnu",
    reproSteps: "état requis / étapes pour reproduire",
    associatedRec: "Recommandations associées (non normatives)",
  },
  en: {
    lead: "Auditor view",
    tail: "Normative mapping.",
    finding: "Finding",
    expected: "Expected",
    verification: "Verification",
    occ: "occurrence(s)",
    verify: "check each occurrence below (inspector / screen reader), then re-run the audit (`ultra11y` / axe).",
    intro:
      "Auditor view: one entry per non-conforming criterion (finding, expected state, verification method). The “to assess” criteria (rendering / judgment) are adjudicated by the AI agent (`verify --manual`, gated), rendering via `scan`.",
    date: "Date",
    scope: "Scope",
    files: "file(s)",
    none: "No non-conformity found automatically by the static engine.",
    captureOf: (comp: string, src: string) => `rendered capture of \`${comp}\` — source \`${src}\``,
    recommendationsTitle: "Recommendations (non-normative)",
    // Advisory (non-normative recommendation) vocabulary — deliberately NOT the NC wording.
    advisoryTag: "Recommendation (non-normative)",
    advisoryNote: "Good practice — no normative test of the active standard requires it. This is NOT a non-conformity.",
    observation: "Observation",
    suggestion: "Suggestion",
    relatedRef: "Related criterion",
    // Unified ticket template (Task 2).
    priority: "Priority",
    technical: "Technical details",
    impactedFiles: "Impacted files",
    pages: "Impacted pages / URLs",
    change: "Expected change",
    ac: "Acceptance criteria",
    complexity: "Complexity",
    pts: "pts",
    reproduction: "Reproduction context",
    authRequired: "authentication required",
    yes: "yes",
    no: "no",
    unknown: "unknown",
    reproSteps: "required state / steps to reproduce",
    associatedRec: "Related recommendations (non-normative)",
  },
} as const;

const uniq = (xs: string[]): string[] => [...new Set(xs.filter(Boolean))];

/** Resolves the annotated crop illustrating one occurrence, or nothing when the evidence tier
 *  could not draw it. A LOOKUP rather than a manifest so this module stays ignorant of how a
 *  finding is keyed (src/baseline.ts `findingId`) and of the evidence tier entirely — passing a
 *  manifest would couple the auditor block to a key format it has no business knowing. */
export type AuditorCropLookup = (f: Finding) => { href: string; alt: string } | undefined;

export interface AuditorUnitOpts {
  heading?: string; // "###"/"##" → emit a criterion heading; omit for a bare issue body
  // Emit the technical ticket sections (Partie technique + Contexte de reproduction).
  // Default true; `prd --no-technical` turns it off for a pure-auditor consumption.
  technical?: boolean;
  // Fold repeated occurrences of one (rule, selector) under a counted header. OFF by default,
  // so the backlog, `prd --split criterion` and every tracker issue body stay byte-identical;
  // only the per-page sheet turns it on, because that is where one design-system defect
  // multiplied by every route using it produces a page of near-identical lines.
  collapse?: boolean;
  // Hang the annotated crop under each occurrence that has one. Absent ⇒ the block is
  // byte-identical to what it was before evidence existed.
  cropFor?: AuditorCropLookup;
}

/** Repeated occurrences of ONE (rule, selector) on one file, folded into groups.
 *
 *  A DISPLAY fold and nothing else: every finding appears in exactly one group, the groups
 *  preserve the input order of their first member, and concatenating them returns the input. The
 *  count printed on a header is therefore the real number of occurrences, and the block total
 *  stays `normative.length` — a report that folds 472 lines into 7 headers still claims 472
 *  non-conformities, because it still has 472 of them.
 *
 *  `ruleId` is part of the key on purpose: WCAG 1.4.3 carries both `rendered-contrast` (measured
 *  from the CSSOM) and `rendered-contrast-pixel` (measured from a screenshot), and folding those
 *  together would present two different measurements as one defect. The resolved message is NOT
 *  part of the key — it interpolates per-finding values (a contrast ratio), so keying on it would
 *  fold nothing. */
function groupOccurrences(findings: Finding[], collapse: boolean): Finding[][] {
  if (!collapse) return findings.map((f) => [f]);
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.file}\0${f.ruleId}\0${f.selectorHint}`;
    const g = groups.get(key);
    if (g) g.push(f);
    else groups.set(key, [f]);
  }
  return [...groups.values()];
}

/** The inert sub-bullets that hang off one occurrence: the crosswalk deviation note, the related
 *  occurrence, the capture provenance. Extracted so the grouped and ungrouped paths cannot drift,
 *  and so the indent is applied in exactly one place. */
function renderOccurrenceDetails(out: string[], f: Finding, lang: Lang, s: (typeof L)[Lang], indent: string, cropFor?: AuditorCropLookup): void {
  // A finding projected via an opt-in secondary crosswalk mapping carries a note explaining the
  // deviation from the SC-faithful projection — an inert (worklist-ignored) sub-bullet.
  if (f.secondary?.note) out.push(`${indent}  - ↳ ${f.secondary.note}`);
  // THE ONLY PLACE a crop is hung off an occurrence. `report §2`, `prd`, every tracker issue
  // body and every per-page sheet inherit it here, at once. The bullet carries no `[ ]`, which
  // is what keeps it out of verify.ts's worklist — indentation alone would NOT, since
  // AUDITOR_OCCURRENCE is anchored `^\s*-\s\[ \]` and tolerates leading space.
  const crop = cropFor?.(f);
  if (crop) out.push(`${indent}  - ![${crop.alt}](${crop.href})`);
  if (f.related) out.push(indent + relatedLine(f.related, lang, { selector: true }));
  if (f.origin) {
    const comp = f.origin.component ?? f.origin.sourceFile ?? f.file;
    const srcFile = f.origin.sourceFile ?? f.origin.capture;
    const src = f.origin.sourceFile && f.origin.sourceLine !== undefined ? `${f.origin.sourceFile}:${f.origin.sourceLine}` : srcFile;
    // Both halves collapsing to the same path means the line says "capture of X — X", which tells
    // the reader nothing. That is what a PAGE SNAPSHOT looks like when its producer wrote no
    // provenance comment: identity is synthesized from the path (src/audit.ts foldDoc), so
    // `origin` carries the capture file and neither a source nor a component, and the finding's
    // own file IS that capture. A Storybook dump, whose capture differs from the file it is
    // attributed to, still says something and still renders. Suppressed HERE rather than by
    // dropping `origin` from the Finding — six other consumers read that field.
    if (comp !== src) out.push(`${indent}  - _${s.captureOf(comp, src)}_`);
  }
}

// A URL-shaped finding location (a served page a `scan` crawled) vs a source file path.
const isUrlLocation = (file: string): boolean => /^https?:\/\//i.test(file);

// Per-sample provenance attached to a finding by `mergeDynamic` (`scan --sample`) — the
// crawled page name, whether it sits behind authentication, and reproduction notes. The
// technical + reproduction sections render it when present, and gracefully (URL only) when
// absent (a plain single-page/served-URL scan).
interface SampleMeta {
  page?: string;
  authRequired?: boolean;
  notes?: string;
}
function sampleMetaOf(f: Finding): SampleMeta | undefined {
  const meta = f.sample;
  return meta && typeof meta === "object" ? meta : undefined;
}

/** Nest one level below the unit heading, CLAMPED to `####` so the level always stays
 *  within verify.ts's `HEADING_LINE` (/^#{2,4}\s/): a `#####` would NOT reset the current
 *  criterion, letting a technical-section line leak into the worklist. */
function subHeading(heading?: string): string {
  return "#".repeat(Math.min((heading?.length ?? 2) + 1, 4));
}

const ADVISORY_ICON = "💡";

/** The single renderer for a finding's occurrence line, shared by auditor.ts and prd.ts.
 *  `checkbox` renders the EXACT parseable shape `verify.ts`'s `AUDITOR_OCCURRENCE` regex
 *  (src/verify.ts:48) keys on; `advisory` renders the deliberately NON-parseable `💡` shape
 *  (an advisory/recommendation must never enter the verify worklist as a claimed NC). Byte
 *  shape is otherwise identical — only the leading marker differs. */
export function occurrenceLine(f: Finding, lang: Lang, opts: { marker: "checkbox" | "advisory" }): string {
  const marker = opts.marker === "checkbox" ? "[ ]" : ADVISORY_ICON;
  return `- ${marker} \`${f.file}:${f.line}\` (\`${f.selectorHint}\`) — ${mdText(resolveMessage(f, lang))}`;
}

/** The `↳` related-occurrence sub-bullet, shared by auditor.ts and prd.ts. `selector: false`
 *  omits the `` (`selectorHint`) `` segment (prd.ts's `renderPrdDoc` task list does this). */
export function relatedLine(related: NonNullable<Finding["related"]>, lang: Lang, opts: { selector: boolean }): string {
  const sel = opts.selector ? ` (\`${related.selectorHint}\`)` : "";
  return `  - ↳ ${resolveNote(related, lang)} : \`${related.file}:${related.line}\`${sel}`;
}

/** The auditor block for ONE criterion (a PrdUnit), localized and rendered with the active
 *  standard's vocabulary. Emits the full owner-validated ticket structure: the criterion
 *  block + Priorité, the parseable occurrence checklist, then (unless `opts.technical` is
 *  false) Partie technique + Contexte de reproduction. Returns lines (caller joins). */
export function renderAuditorUnit(unit: PrdUnit, standard: StandardId, lang: Lang, opts: AuditorUnitOpts = {}): string[] {
  const s = L[lang];
  if (unit.advisory) return renderAdvisoryUnit(unit, lang, opts);
  const m = auditorUnitModel(unit, standard, lang, opts);
  const out: string[] = [];
  if (opts.heading) out.push(`${opts.heading} ${m.icon} ${m.label}`, "");
  out.push(`> ${m.normativeNote}`, "");

  // ---- 1. criterion block (unchanged) + the explicit Priorité line ----
  for (const f of m.fields) out.push(`**${f.label}** : ${f.value}`);

  // ---- 2. finding / expected / verification + the PARSEABLE occurrence checklist ----
  // Advisory findings riding along in a MIXED unit are excluded from the checklist (they are
  // recommendations, never non-conformities) and rendered below in a distinct, NON-parseable
  // sub-list — so verify.ts's worklist never captures a recommendation as an NC claim. Its
  // POSITION (before any newly-introduced heading) is load-bearing for the parser.
  out.push("");
  out.push(`**${s.finding} (${m.conformanceTerms.nonConformant})** : ${m.occurrences} ${s.occ} — ${m.messages.map(mdText).join(" ; ")}`);
  if (m.fixes.length) out.push(`**${s.expected} (${m.conformanceTerms.conformant})** : ${m.fixes.map(mdText).join(" ; ")}`);
  out.push(`**${s.verification}** : ${s.verify}`, "");
  for (const group of m.groups) {
    // A GROUP HEADER, when several occurrences share a rule and a selector. It is deliberately
    // NOT checkbox-shaped: `verify` must see one item per claimed non-conformity, not one per
    // group, so the fold changes what the reader scans and never what the gate adjudicates.
    if (group.count > 1) out.push(`- **\`${group.lead.selectorHint}\`** — ${mdText(resolveMessage(group.lead, lang))} · ×${group.count}`);
    for (const f of group.findings) {
      // Members of a real group are indented under it; a lone occurrence stays flush, so an
      // ungrouped block is byte-identical to what it was before collapsing existed.
      const indent = group.count > 1 ? "  " : "";
      out.push(indent + occurrenceLine(f, lang, { marker: "checkbox" }));
      renderOccurrenceDetails(out, f, lang, s, indent, opts.cropFor);
    }
  }
  out.push("");

  // Associated recommendations (mixed unit only): a visually distinct, NON-parseable list —
  // the `- 💡` bullet deliberately avoids the `- [ ] \`file:line\`` checklist grammar.
  if (m.advisories.length) {
    out.push(`_${s.associatedRec}_`, "");
    for (const f of m.advisories) out.push(occurrenceLine(f, lang, { marker: "advisory" }));
    out.push("");
  }

  // ---- 3 + 4. technical ticket sections (opt-out via prd --no-technical) ----
  if (opts.technical ?? true) {
    out.push(...renderTechnicalSection({ ...unit, findings: m.normative }, unit, standard, lang, opts));
    out.push(...renderReproductionContext(m.normative, lang));
  }
  return out;
}

/** One `**label** : value` line of the criterion block, before it is serialized. */
export interface AuditorField {
  label: string;
  value: string;
}

/** Occurrences of one (file, rule, selector), as the block will present them. `count > 1` is
 *  what earns a group header; a lone occurrence renders flush. */
export interface AuditorOccurrenceGroup {
  lead: Finding;
  count: number;
  findings: Finding[];
}

/** Everything `renderAuditorUnit` DECIDES, before anything is turned into Markdown.
 *
 *  The split exists so a second surface — the HTML report — can present the same criterion
 *  without re-resolving the active standard's vocabulary, re-picking the theme line, or
 *  re-deciding which findings are normative. `renderAuditorUnit` is now the Markdown
 *  serializer of this model, and `tests/__snapshots__/auditor.test.ts.snap` pins that the
 *  serialization did not move a byte. */
export interface AuditorUnitModel {
  severity: Severity;
  icon: string;
  label: string;
  normativeNote: string;
  fields: AuditorField[];
  conformanceTerms: { conformant: string; nonConformant: string };
  /** Normative findings only — an advisory can never be counted as a non-conformity. */
  normative: Finding[];
  advisories: Finding[];
  occurrences: number;
  messages: string[];
  fixes: string[];
  groups: AuditorOccurrenceGroup[];
}

export function auditorUnitModel(unit: PrdUnit, standard: StandardId, lang: Lang, opts: AuditorUnitOpts = {}): AuditorUnitModel {
  const s = L[lang];
  const v = vocabularyFor(standard, lang);
  const fields: AuditorField[] = [];

  if (isCore(standard)) {
    const sc = getSC(unit.criteriaId);
    if (sc) {
      const pr = `${sc.principle} ${principleTitle(sc.principle, lang) ?? ""}`.trim();
      const gl = `${sc.guideline} ${guidelineTitle(sc.guideline, lang) ?? ""}`.trim();
      fields.push({ label: v.theme, value: [pr, gl].filter(Boolean).join(" · ") });
    }
    fields.push({ label: v.criterion, value: `${unit.criteriaId}${sc ? ` — ${unit.title}` : ""}` });
    const techs = scTechniques(unit.criteriaId);
    if (techs.length) fields.push({ label: v.test, value: techs.join(", ") });
    fields.push({ label: "WCAG", value: `${unit.criteriaId}${sc ? ` (${sc.level})` : ""}` });
  } else {
    const pack = loadPack(standard);
    const pc = pack.criteria.find((c) => c.id === unit.criteriaId);
    // `.trimEnd()` on the VALUE, not on the rendered line: a pack whose theme has no localized
    // name must not leave a trailing space behind the colon.
    if (pc) fields.push({ label: v.theme, value: `${pc.theme}. ${themeName(pack, pc.theme, lang) ?? ""}`.trimEnd() });
    fields.push({ label: v.criterion, value: `${unit.criteriaId} — ${unit.title}` });
    const testNums = packTestIds(pack, unit.criteriaId);
    if (testNums.length) fields.push({ label: `${v.test}(s)`, value: testNums.join(" · ") });
    // NO WCAG CROSS-REFERENCE UNDER A PACK. A deliverable produced with `--standard rgaa` is
    // read by an auditor working to RGAA: it names RGAA themes, RGAA criteria and RGAA tests,
    // and a « WCAG 1.1.1 (A) » line beside them is a second referential to reconcile in a
    // document that answers to one. The mapping still exists and is still how the projection
    // is computed — `criteria --standard rgaa <id>` prints it on demand — but a conformance
    // report is not where a reader goes looking for it.
  }
  fields.push({ label: s.priority, value: `${ICON[unit.severity]} ${SEV_LABEL[lang][unit.severity]}` });

  const normative = unit.findings.filter((f) => !f.advisory);
  return {
    severity: unit.severity,
    icon: ICON[unit.severity],
    label: unit.label,
    normativeNote: v.normativeNote ?? `${s.lead} — ${standardLabel(standard)}. ${s.tail}`,
    fields,
    conformanceTerms: { conformant: v.conformant, nonConformant: v.nonConformant },
    normative,
    advisories: unit.findings.filter((f) => f.advisory),
    occurrences: normative.length,
    messages: uniq(normative.map((f) => resolveMessage(f, lang))),
    fixes: uniq(normative.map((f) => resolveRemediation(f, lang))),
    groups: groupOccurrences(normative, opts.collapse === true).map((g) => ({ lead: g[0]!, count: g.length, findings: g })),
  };
}

/** Section 3 — Partie technique: impacted files, impacted pages/URLs (with Task-5 sample
 *  provenance when present), the expected change + guidance example, Given/When/Then
 *  acceptance criteria, and the deterministic complexity. All lines here are worklist-inert:
 *  they sit AFTER the section's heading, which resets verify.ts's current criterion. */
function renderTechnicalSection(ncView: PrdUnit, unit: PrdUnit, standard: StandardId, lang: Lang, opts: AuditorUnitOpts): string[] {
  const s = L[lang];
  const out: string[] = [`${subHeading(opts.heading)} ${s.technical}`, ""];

  // Impacted files — unique source paths (URL-only locations are listed under Pages/URLs).
  const files = uniq(ncView.findings.filter((f) => !isUrlLocation(f.file)).map((f) => f.file));
  if (files.length) {
    out.push(`**${s.impactedFiles}**`, "");
    for (const f of files) out.push(`- \`${f}\``);
    out.push("");
  }

  // Impacted pages / URLs — served locations, deduped, with the sample page + auth flag
  // once Task 5 attaches that provenance (rendered gracefully as URL-only until then).
  const seenUrl = new Set<string>();
  const pageLines: string[] = [];
  for (const f of ncView.findings) {
    if (!isUrlLocation(f.file) || seenUrl.has(f.file)) continue;
    seenUrl.add(f.file);
    const meta = sampleMetaOf(f);
    const suffix = meta ? ` — ${meta.page ? `${meta.page} · ` : ""}${s.authRequired} : ${meta.authRequired ? s.yes : s.no}` : "";
    pageLines.push(`- \`${f.file}\`${suffix}`);
  }
  if (pageLines.length) out.push(`**${s.pages}**`, "", ...pageLines, "");

  // Expected change — deduped remediation texts + the shared before/after guidance example.
  out.push(`**${s.change}**`, "");
  for (const fx of uniq(ncView.findings.map((f) => resolveRemediation(f, lang)))) out.push(`- ${mdText(fx)}`);
  out.push("");
  out.push(...guidanceExampleBlock(guidanceFor(unit, standard), lang));

  // Acceptance criteria — the shared Given/When/Then generator, as a checkbox list.
  out.push(`**${s.ac}**`, "");
  out.push(...acceptanceCriteria(ncView, standard, lang, { checkbox: true }));
  out.push("");

  // Complexity — the shared deterministic effort heuristic (t-shirt size + points).
  const { bucket, points } = effortOf(ncView);
  out.push(`**${s.complexity}** : ${bucket} (${points} ${s.pts})`, "");
  return out;
}

/** Section 4 — Contexte de reproduction: emitted only when ≥1 occurrence cites a served URL
 *  that static grounding could not resolve (the `mergeDynamic` unresolved-anchor case: a URL
 *  location at line 0) or a sample page behind authentication (Task-5 provenance). Gives the
 *  URL, the auth requirement, and a placeholder for the required state / reproduction steps. */
function renderReproductionContext(normative: Finding[], lang: Lang): string[] {
  const s = L[lang];
  const seen = new Set<string>();
  const qualifying: Finding[] = [];
  for (const f of normative) {
    const unresolvedUrl = isUrlLocation(f.file) && f.line === 0;
    const authGated = sampleMetaOf(f)?.authRequired === true;
    if ((!unresolvedUrl && !authGated) || seen.has(f.file)) continue;
    seen.add(f.file);
    qualifying.push(f);
  }
  if (!qualifying.length) return [];
  const out: string[] = [`**${s.reproduction}**`, ""];
  for (const f of qualifying) {
    const meta = sampleMetaOf(f);
    const auth = meta ? (meta.authRequired ? s.yes : s.no) : s.unknown;
    const name = meta?.page ? `${meta.page} · ` : "";
    out.push(`- **URL** : \`${f.file}\` — ${name}${s.authRequired} : ${auth}`);
    // Task 5: the sample page's notes ARE the required state / reproduction steps.
    if (meta?.notes) out.push(`  - ↳ ${meta.notes}`);
  }
  out.push(`- _${s.reproSteps}_`, "");
  return out;
}

/** The auditor block for ONE advisory (non-normative recommendation) unit. Rendered with
 *  the « Recommandation (non normative) » vocabulary, NEVER the non-conformity wording.
 *  Crucially, the criterion reference deliberately AVOIDS the "**label** : <id>" colon
 *  grammar the verify worklist parser keys on (src/verify.ts `auditorCriterionLine`), so
 *  an advisory block can never enter the non-conformity worklist — the related criterion
 *  is cited with an em-dash + middot instead of a colon. */
function renderAdvisoryUnit(unit: PrdUnit, lang: Lang, opts: AuditorUnitOpts): string[] {
  const s = L[lang];
  const out: string[] = [];
  if (opts.heading) out.push(`${opts.heading} ${ADVISORY_ICON} ${unit.label}`, "");
  out.push(`> ${s.advisoryTag} — ${s.advisoryNote}`, "");
  out.push(`**${s.advisoryTag}** — ${unit.criteriaId} · ${unit.title}`);
  // Same rule as the auditor block above: under a pack the deliverable names that pack's
  // criteria and nothing else.
  const messages = uniq(unit.findings.map((f) => resolveMessage(f, lang)));
  const fixes = uniq(unit.findings.map((f) => resolveRemediation(f, lang)));
  out.push("");
  out.push(`**${s.observation}** : ${unit.findings.length} ${s.occ} — ${messages.map(mdText).join(" ; ")}`);
  if (fixes.length) out.push(`**${s.suggestion}** : ${fixes.map(mdText).join(" ; ")}`);
  out.push("");
  for (const f of unit.findings) {
    out.push(occurrenceLine(f, lang, { marker: "checkbox" }));
    if (f.related) out.push(relatedLine(f.related, lang, { selector: true }));
  }
  out.push("");
  return out;
}

function auditorHeader(r: AuditResult, lang: Lang, standard: StandardId): string[] {
  const s = L[lang];
  const v = vocabularyFor(standard, lang);
  return [
    `# ${v.auditorHeading} — ${standardLabel(standard)}`,
    "",
    `- **${s.date}** : ${r.date}`,
    `- **${s.scope}** : ${r.scope.files} ${s.files} — ${r.scope.inputs.join(", ")}`,
    "",
    `> ${s.intro}`,
    "",
  ];
}

export interface AuditorBacklogOpts {
  // Emit the technical ticket sections per unit. Default true; `prd --no-technical` off.
  technical?: boolean;
}

/** A single auditor backlog, sectioned by priority (bloquant → majeur → mineur), with
 *  advisory recommendations kept in their own trailing section (never among NC). Default `prd`. */
export function renderAuditorBacklog(r: AuditResult, lang: Lang = "en", standard: StandardId = "wcag", opts: AuditorBacklogOpts = {}): string {
  const s = L[lang];
  const technical = opts.technical ?? true;
  const { nc, advisory } = partitionUnits(prdUnits(r, standard, lang));
  const out = auditorHeader(r, lang, standard);
  if (!nc.length && !advisory.length) {
    out.push(s.none, "");
    return out.join("\n");
  }
  for (const sev of SEV_ORDER) {
    const group = nc.filter((u) => u.severity === sev);
    if (!group.length) continue;
    out.push(`## ${ICON[sev]} ${SEV_LABEL[lang][sev]} (${group.length})`, "");
    for (const u of group) out.push(...renderAuditorUnit(u, standard, lang, { heading: "###", technical }));
  }
  if (advisory.length) {
    out.push(`## ${ADVISORY_ICON} ${s.recommendationsTitle} (${advisory.length})`, "");
    for (const u of advisory) out.push(...renderAuditorUnit(u, standard, lang, { heading: "###", technical }));
  }
  return out.join("\n");
}

/** One standalone auditor document per criterion (`prd --split criterion`). */
export function renderAuditorPerCriterion(r: AuditResult, lang: Lang = "en", standard: StandardId = "wcag", opts: AuditorBacklogOpts = {}): PrdFile[] {
  const technical = opts.technical ?? true;
  return prdUnits(r, standard, lang).map((u) => {
    const out = auditorHeader(r, lang, standard);
    out.push(...renderAuditorUnit(u, standard, lang, { heading: "##", technical }));
    return { name: `prd-${u.criteriaId}-${r.date}.md`, content: out.join("\n") };
  });
}
