// `prd` — turn an AuditResult into an actionable "fixes to do" backlog (Markdown),
// grouped by WCAG success criterion (or, with --standard <pack>, by the pack's
// criteria projected from the WCAG audit). Default: one combined backlog sectioned
// by priority. `--split criterion`: one PRD file per criterion. The same per-criterion
// units feed optional GitHub issue creation (see gh.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditResult, Finding, Lang, Severity } from "./types.js";
import { getSC, guidelineTitle, scTitle, techniques as scTechniques } from "./wcag.js";
import { resolveRemediation } from "./messages.js";
import {
  type StandardId,
  isCore,
  loadPack,
  derivePackResults,
  packConformancePct,
  packTestIds,
  packTestsCited,
  standardLabel,
  themeName,
  titlePlain as packTitlePlain,
} from "./standards/index.js";
import { guidanceEntriesFor } from "./guidance/resolve.js";
import type { GuidanceEntry } from "./guidance/types.js";
import { renderAuditorBacklog, renderAuditorPerCriterion, occurrenceLine, relatedLine } from "./auditor.js";
import { mdText } from "./md.js";

const SEV_ORDER: Severity[] = ["bloquant", "majeur", "mineur"];
const SEV_RANK: Record<Severity, number> = { bloquant: 0, majeur: 1, mineur: 2 };
const ICON: Record<Severity, string> = { bloquant: "🔴", majeur: "🟠", mineur: "🟡" };

const L = {
  fr: {
    title: (std: string) => `Plan de correction d'accessibilité — ${std}`,
    date: "Date",
    scope: "Périmètre",
    files: "fichier(s)",
    rate: "Taux de réussite automatique",
    note: "Backlog des corrections détectées automatiquement. Les critères « à évaluer » (rendu / jugement) sont adjugés par l'agent IA (`verify --manual`, de façon gatée), le rendu via `scan` (voir le rapport).",
    none: "Aucune correction automatique à faire : le moteur statique n'a relevé aucune non-conformité.",
    sev: { bloquant: "Bloquant", majeur: "Majeur", mineur: "Mineur" } as Record<Severity, string>,
    fix: "Correction",
    affected: "Occurrence(s)",
    effort: "Effort estimé",
    avoid: "À éviter",
    recommended: "Recommandé",
    example: "Exemple",
    prdTitle: (label: string) => `PRD — ${label}`,
    epic: "Épopée",
    story: "User story",
    ac: "Critères d'acceptation (Given/When/Then)",
    tasks: "Tâches",
    asUser: "En tant qu'utilisateur en situation de handicap",
    iNeed: (t: string) => `je dois pouvoir compter sur : ${t}`,
    given: "Étant donné",
    when: "Lorsque",
    then: "Alors",
    acWhen: "un utilisateur de technologie d'assistance y accède",
    givenElements: (sel: string) => `les éléments ${sel} concernés`,
    techniques: "Techniques WCAG",
    toRuleOn: "Critères à trancher",
    toRuleOnNote:
      "Le moteur ne peut pas les décider : ils relèvent du jugement ou du rendu. Ce ne sont PAS des non-conformités — ils sont indécidés. Générez la worklist (`verify --manual --standard <pack>`), qui porte l'énoncé complet de chaque test.",
    tests: "tests",
    // « ancrés sur les intitulés WCAG » was both a cross-reference and, since the acceptance
    // criteria are generated from the pack's numbered tests, no longer true under a pack.
    docNote:
      "Document d'exigences (PRD) généré depuis l'audit statique : une épopée par thème, une user story par critère, des critères d'acceptation ancrés sur l'énoncé des tests du référentiel actif. Adjugez les critères « à évaluer » avec `verify --manual` (agent IA, gaté), le rendu via `scan`.",
  },
  en: {
    title: (std: string) => `Accessibility fix plan — ${std}`,
    date: "Date",
    scope: "Scope",
    files: "file(s)",
    rate: "Automatic static-check pass rate",
    note: "Backlog of automatically-detected fixes. The “to assess” criteria (rendering / judgment) are adjudicated by the AI agent (`verify --manual`, gated), rendering via `scan` (see the report).",
    none: "No automatic fix to do: the static engine found no non-conformity.",
    sev: { bloquant: "Blocking", majeur: "Major", mineur: "Minor" } as Record<Severity, string>,
    fix: "Fix",
    affected: "Occurrence(s)",
    effort: "Estimated effort",
    avoid: "Avoid",
    recommended: "Recommended",
    example: "Example",
    prdTitle: (label: string) => `PRD — ${label}`,
    epic: "Epic",
    story: "User story",
    ac: "Acceptance criteria (Given/When/Then)",
    tasks: "Tasks",
    asUser: "As a user relying on assistive technology",
    iNeed: (t: string) => `I need: ${t}`,
    given: "Given",
    when: "When",
    then: "Then",
    acWhen: "a user of assistive technology reaches them",
    givenElements: (sel: string) => `the affected ${sel} elements`,
    techniques: "WCAG techniques",
    toRuleOn: "Criteria to rule on",
    toRuleOnNote:
      "The engine cannot decide these: they are judgment or rendering calls. They are NOT non-conformities — they are undecided. Generate the worklist (`verify --manual --standard <pack>`), which carries the full wording of every test.",
    tests: "tests",
    docNote:
      "Product-requirements document generated from the static audit: one epic per theme, one user story per criterion, acceptance criteria anchored to the active standard's own test wording. Adjudicate the “to assess” criteria with `verify --manual` (AI agent, gated), rendering via `scan`.",
  },
} as const;

export interface PrdUnit {
  criteriaId: string;
  title: string; // criterion plain title
  label: string; // "<id> — <title>" (pack: "<name> <id> — <title>")
  refs: string[]; // related WCAG SC ids (pack units) — empty for the WCAG core
  severity: Severity; // most severe finding in the group
  findings: Finding[];
  // True when EVERY finding in the group is advisory (non-normative): the unit is a
  // « Recommandation (non normative) », never a non-conformity. A mixed unit (≥1 normative
  // finding) is NC and stays NC — advisory findings then ride along inside it. Renderers
  // route advisory units to the recommendations channel (report §Recommandations, the
  // `recommendation`-labelled GitHub issue), never the NC channel. Optional/additive
  // (absent ⇒ normative) — `prdUnits` always sets it; hand-built units may omit it.
  advisory?: boolean;
}

/** Group findings into actionable units (one backlog item / one GitHub issue),
 *  ordered by severity then id. Core groups by WCAG SC; a pack groups by its own
 *  criteria projected from the WCAG-keyed audit. */
export function prdUnits(r: AuditResult, standard: StandardId = "wcag", lang: Lang = "en"): PrdUnit[] {
  const units: PrdUnit[] = [];
  const mostSevere = (fs: Finding[]): Severity => [...fs].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])[0]?.severity ?? "mineur";
  const sortFindings = (fs: Finding[]) => [...fs].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  // All-advisory ⇒ recommendation unit; a single normative finding makes it an NC unit.
  const allAdvisory = (fs: Finding[]) => fs.length > 0 && fs.every((f) => f.advisory);

  if (isCore(standard)) {
    const byCrit = new Map<string, Finding[]>();
    for (const f of r.findings) (byCrit.get(f.criteriaId) ?? byCrit.set(f.criteriaId, []).get(f.criteriaId)!).push(f);
    for (const [criteriaId, fs] of byCrit) {
      const title = scTitle(criteriaId, lang);
      units.push({
        criteriaId,
        title: title ?? criteriaId,
        label: title ? `${criteriaId} — ${title}` : criteriaId,
        refs: [],
        severity: mostSevere(fs),
        findings: sortFindings(fs),
        advisory: allAdvisory(fs),
      });
    }
  } else {
    const pack = loadPack(standard);
    for (const pr of derivePackResults(r, standard)) {
      if (!pr.findings.length) continue;
      const pc = pack.criteria.find((c) => c.id === pr.id)!;
      const t = packTitlePlain(pack, pc, lang);
      units.push({
        criteriaId: pr.id,
        title: t,
        label: `${pack.name} ${pr.id} — ${t}`,
        refs: pc.wcag,
        severity: mostSevere(pr.findings),
        findings: sortFindings(pr.findings),
        advisory: allAdvisory(pr.findings),
      });
    }
  }
  units.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.criteriaId.localeCompare(b.criteriaId, undefined, { numeric: true }));
  return units;
}

/** Split PRD units into the non-conformity channel (nc) and the advisory recommendation
 *  channel (advisory). The report/GitHub renderers key off this so an advisory unit is
 *  NEVER presented among non-conformities. Order within each list is preserved. */
export function partitionUnits(units: PrdUnit[]): { nc: PrdUnit[]; advisory: PrdUnit[] } {
  const nc: PrdUnit[] = [];
  const advisory: PrdUnit[] = [];
  for (const u of units) (u.advisory ? advisory : nc).push(u);
  return { nc, advisory };
}

const SEV_WEIGHT: Record<Severity, number> = { bloquant: 3, majeur: 2, mineur: 1 };

/** Deterministic effort heuristic: Σ severity weights over the occurrences, bucketed.
 *  Exported so the auditor block (src/auditor.ts) renders the same t-shirt size + points
 *  as the remediation backlog — one heuristic, never two that can drift. */
export function effortOf(unit: PrdUnit): { bucket: "S" | "M" | "L"; points: number } {
  const points = unit.findings.reduce((sum, f) => sum + SEV_WEIGHT[f.severity], 0);
  return { bucket: points <= 4 ? "S" : points <= 12 ? "M" : "L", points };
}

/** Guidance entries for a unit: by pack criterion (pack view) or WCAG SC (core view),
 *  falling back to the unit's WCAG refs so a pack criterion with no direct entry still
 *  surfaces its SCs' guidance. Stable order, deduped by id. */
export function guidanceFor(unit: PrdUnit, standard: StandardId): GuidanceEntry[] {
  // Same order, same dedup — the chain now lives in guidance/resolve.ts so the MCP
  // reference tools and the criteria lookup can use it too, instead of the PRD being the
  // only surface that can reach a criterion's guidance.
  return guidanceEntriesFor(standard, unit.criteriaId, unit.refs);
}

/** The first guidance example (before/after) for a unit, rendered as fenced code.
 *  Exported so the auditor block's "Changement attendu" reuses this exact renderer
 *  instead of duplicating the before/after formatting. */
export function guidanceExampleBlock(entries: GuidanceEntry[], lang: Lang): string[] {
  const s = L[lang];
  for (const e of entries) {
    const ex = (e.examples ?? []).find((x) => x.bad || x.good);
    if (!ex) continue;
    const note = ex.note?.[lang] ?? ex.note?.fr ?? ex.note?.en;
    const out: string[] = [`**${s.example}**${note ? ` — ${note}` : ""}`, ""];
    if (ex.bad) out.push(`_${s.avoid} :_`, "```" + ex.lang, ex.bad, "```", "");
    if (ex.good) out.push(`_${s.recommended} :_`, "```" + ex.lang, ex.good, "```", "");
    return out;
  }
  return [];
}

// One backlog item: criterion heading, fix, effort, a guidance example, and the checklist.
function unitBlock(unit: PrdUnit, lang: Lang, heading: string, standard: StandardId): string[] {
  const s = L[lang];
  const out: string[] = [];
  // `unit.refs` is empty under the core (the unit IS the success criterion) and holds the
  // mapped SCs under a pack — where naming them appends a second referential to a heading
  // that already reads « RGAA 11.1 — … ». Same rule as `renderPrdDoc` and the auditor block.
  const refs = isCore(standard) && unit.refs.length ? `  ·  WCAG ${unit.refs.join(", ")}` : "";
  out.push(`${heading} ${ICON[unit.severity]} ${unit.label}${refs}`, "");
  const fixes = [...new Set(unit.findings.map((f) => resolveRemediation(f, lang)))];
  for (const fx of fixes) out.push(`- _${s.fix} :_ ${mdText(fx)}`);
  const { bucket, points } = effortOf(unit);
  out.push(`- _${s.effort} :_ ${bucket} (${points} pts)`, "");
  out.push(...guidanceExampleBlock(guidanceFor(unit, standard), lang));
  out.push(`**${s.affected} (${unit.findings.length})**`, "");
  for (const f of unit.findings) {
    out.push(occurrenceLine(f, lang, { marker: "checkbox" }));
    if (f.related) out.push(relatedLine(f.related, lang, { selector: true }));
  }
  out.push("");
  return out;
}

// `ratePct`: the pack-projection rate (packConformancePct over that standard's own
// criteria), passed by pack callers so the PRD header matches the pack report's header
// (and its own NC table) instead of the core WCAG `conformancePct`. Core callers pass
// nothing — unchanged behavior.
function header(r: AuditResult, lang: Lang, title: string, note: string = L[lang].note, ratePct?: number): string[] {
  const s = L[lang];
  return [
    `# ${title}`,
    "",
    `- **${s.date}** : ${r.date}`,
    `- **${s.scope}** : ${r.scope.files} ${s.files} — ${r.scope.inputs.join(", ")}`,
    `- **${s.rate}** : ${ratePct ?? r.conformancePct}%`,
    "",
    `> ${note}`,
    "",
  ];
}

/** A single combined backlog, sectioned by priority (bloquant → majeur → mineur). */
export function renderBacklog(r: AuditResult, lang: Lang = "en", standard: StandardId = "wcag"): string {
  const s = L[lang];
  const units = prdUnits(r, standard, lang);
  const ratePct = isCore(standard) ? undefined : packConformancePct(derivePackResults(r, standard));
  const out = header(r, lang, s.title(standardLabel(standard)), undefined, ratePct);
  if (!units.length) {
    out.push(s.none, "");
    out.push(...toRuleOnSection(r, standard, lang));
    return out.join("\n");
  }
  for (const sev of SEV_ORDER) {
    const group = units.filter((u) => u.severity === sev);
    if (!group.length) continue;
    out.push(`## ${ICON[sev]} ${s.sev[sev]} (${group.length})`, "");
    for (const u of group) out.push(...unitBlock(u, lang, "###", standard));
  }
  return out.join("\n");
}

export interface PrdFile {
  name: string;
  content: string;
}

/** One standalone PRD document per criterion (for `--split criterion`). */
export function renderPerCriterion(r: AuditResult, lang: Lang = "en", standard: StandardId = "wcag"): PrdFile[] {
  const s = L[lang];
  const ratePct = isCore(standard) ? undefined : packConformancePct(derivePackResults(r, standard));
  return prdUnits(r, standard, lang).map((u) => {
    const out = header(r, lang, s.prdTitle(u.label), undefined, ratePct);
    out.push(...unitBlock(u, lang, "##", standard));
    return { name: `prd-${u.criteriaId}-${r.date}.md`, content: out.join("\n") };
  });
}

interface DocEpic {
  key: string;
  title: string;
  units: PrdUnit[];
}

/** Group PRD units into epics: by WCAG guideline (core view) or pack theme (pack view). */
function epicsOf(units: PrdUnit[], standard: StandardId, lang: Lang): DocEpic[] {
  const pack = isCore(standard) ? null : loadPack(standard);
  const groups = new Map<string, DocEpic>();
  for (const u of units) {
    let key: string;
    let title: string;
    if (pack) {
      const themeNum = pack.criteria.find((c) => c.id === u.criteriaId)?.theme ?? 0;
      key = String(themeNum).padStart(3, "0");
      title = (themeNum ? themeName(pack, themeNum, lang) : undefined) ?? `#${themeNum}`;
    } else {
      const g = getSC(u.criteriaId)?.guideline ?? u.criteriaId;
      key = g;
      title = `${g} ${guidelineTitle(g, lang) ?? ""}`.trim();
    }
    let epic = groups.get(key);
    if (!epic) {
      epic = { key, title, units: [] };
      groups.set(key, epic);
    }
    epic.units.push(u);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}

/**
 * The Given/When/Then acceptance-criteria lines for a unit.
 *
 * Under the CORE there is one line per success criterion, anchored to its real WCAG title.
 *
 * Under a PACK there is one line per NUMBERED TEST of the pack's own criterion, anchored to
 * that test's wording. It used to enumerate the criterion's mapped WCAG refs instead — so an
 * RGAA deliverable's acceptance criteria read « Alors « Contenu non textuel » (WCAG 1.1.1) »,
 * naming a referential the rest of the document had stopped mentioning, and naming the wrong
 * unit of work besides: what an RGAA auditor signs off is test 1.1.1 through 1.1.8, not the
 * success criterion they collectively project onto.
 *
 * Shared by `renderPrdDoc` (plain bullets) and the auditor block's technical section
 * (checkbox list via `opts.checkbox`) so the generator lives in exactly one place.
 */
export function acceptanceCriteria(unit: PrdUnit, standard: StandardId, lang: Lang, opts: { checkbox?: boolean } = {}): string[] {
  const s = L[lang];
  const prefix = opts.checkbox ? "- [ ] " : "- ";
  const hints = [...new Set(unit.findings.map((f) => `\`${f.selectorHint}\``))].slice(0, 3).join(", ") || "—";
  const line = (req: string, ref: string) =>
    `${prefix}**${s.given}** ${s.givenElements(hints)} · **${s.when}** ${s.acWhen} · **${s.then}** « ${req} » (${ref}).`;

  if (isCore(standard)) {
    const sc = unit.criteriaId;
    return [line(scTitle(sc, lang) ?? sc, `WCAG ${sc}`)];
  }

  const pack = loadPack(standard);
  // Narrowed to the tests the unit's non-conformities cite, for the reason the auditor block
  // gives: a Given/When/Then per test of the criterion asks a developer to prove three things
  // where the audit established one. Falls back to every test when nothing cites one.
  const tests = packTestsCited(
    pack,
    unit.criteriaId,
    unit.findings.filter((f) => !f.advisory).map((f) => f.normativeRef),
  );
  // A pack criterion with no numbered test (or one this pack does not carry) still deserves a
  // line — fall back to the criterion itself rather than emitting nothing, which would leave
  // an NC block with no acceptance criteria at all.
  if (!tests.length) return [line(unit.title, `${pack.name} ${unit.criteriaId}`)];
  return tests.map((t) => line(t.wording, `${pack.name} ${t.id}`));
}

/** A product-requirements document: epics by theme, one user story per criterion, with
 *  Given/When/Then acceptance criteria anchored to the real WCAG SC titles + the task list. */
/** The criteria still to RULE ON — a country standard's real remaining work.
 *
 *  Deliberately NOT a `PrdUnit`. A unit is something with findings: it feeds report §2, the
 *  auditor blocks, the GitHub issues and `check`'s NC-projection gate, so putting a `manual`
 *  criterion there would make undecided work read as a non-conformity — the one thing this
 *  tool must never do. This is a separate section listing what has to be decided, and the
 *  numbered tests to decide it against.
 *
 *  It matters because 97 of RGAA's 106 criteria carry at least one judgment test: without
 *  this the backlog of an RGAA audit silently misses most of the job. */
export function toRuleOnSection(r: AuditResult, standard: StandardId, lang: Lang): string[] {
  if (isCore(standard)) return [];
  const s = L[lang];
  const pack = loadPack(standard);
  const manual = derivePackResults(r, standard).filter((pc) => pc.status === "manual");
  if (!manual.length) return [];
  const out: string[] = [`## ${s.toRuleOn} (${manual.length})`, "", `> ${s.toRuleOnNote}`, ""];
  for (const pc of manual) {
    const crit = pack.criteria.find((c) => c.id === pc.id);
    const title = crit ? packTitlePlain(pack, crit, lang) : pc.id;
    const tests = packTestIds(pack, pc.id);
    out.push(`- [ ] **${pack.name} ${pc.id}** — ${title}${tests.length ? `  ·  ${s.tests}: ${tests.map((t) => `\`${t}\``).join(" ")}` : ""}`);
  }
  out.push("");
  return out;
}

export function renderPrdDoc(r: AuditResult, lang: Lang = "en", standard: StandardId = "wcag"): string {
  const s = L[lang];
  const units = prdUnits(r, standard, lang);
  const ratePct = isCore(standard) ? undefined : packConformancePct(derivePackResults(r, standard));
  const out = header(r, lang, s.title(standardLabel(standard)), s.docNote, ratePct);
  if (!units.length) {
    out.push(s.none, "");
    return out.join("\n");
  }
  out.push(...toRuleOnSection(r, standard, lang));
  for (const epic of epicsOf(units, standard, lang)) {
    out.push(`## ${s.epic} — ${epic.title}`, "");
    for (const u of epic.units) {
      // ONE REFERENTIAL. The story heading used to append « · WCAG 1.3.1, 2.4.6, 3.3.2, 4.1.2 »
      // and the body a « Techniques WCAG : ARIA11, ARIA12, … » line of W3C technique ids —
      // both inside a backlog whose epics, stories and acceptance criteria are RGAA. The
      // techniques stay reachable where they answer a question a reader actually asked:
      // `criteria <sc>` under the core, and `criteria --standard rgaa <id>` for the pack's own
      // technical note.
      const refs = isCore(standard) && u.refs.length ? `  ·  WCAG ${u.refs.join(", ")}` : "";
      out.push(`### ${ICON[u.severity]} ${s.story} — ${u.label}${refs}`, "");
      out.push(`> ${s.asUser}, ${s.iNeed(u.title)}.`, "");
      out.push(`**${s.ac}**`, "");
      out.push(...acceptanceCriteria(u, standard, lang));
      const techs = isCore(standard) ? scTechniques(u.criteriaId) : [];
      if (techs.length) out.push("", `_${s.techniques} : ${techs.join(", ")}_`);
      out.push("", `**${s.tasks} (${u.findings.length})**`, "");
      for (const f of u.findings) {
        out.push(occurrenceLine(f, lang, { marker: "checkbox" }));
        if (f.related) out.push(relatedLine(f.related, lang, { selector: false }));
      }
      out.push("");
    }
  }
  return out.join("\n");
}

// Output shape: `audit` (DEFAULT) = the auditor conformance block (src/auditor.ts);
// `remediation` = the dev backlog above (kept for back-compat); `doc` = the user-story PRD.
export type PrdFormat = "audit" | "remediation" | "doc";

export interface PrdOpts {
  out: string;
  lang: Lang;
  split?: "criterion";
  format?: PrdFormat;
  standard: StandardId;
  /** Auditor formats only: emit the technical ticket sections (Partie technique +
   *  Contexte de reproduction). Default true; `prd --no-technical` sets it false for a
   *  pure-auditor consumption of the block. */
  technical?: boolean;
}

/** Render and write the PRD markdown; returns the written path(s). */
export function writePrd(r: AuditResult, opts: PrdOpts): string[] {
  mkdirSync(opts.out, { recursive: true });
  if (opts.format === "doc") {
    const p = join(opts.out, `prd-doc-${r.date}.md`);
    writeFileSync(p, renderPrdDoc(r, opts.lang, opts.standard));
    return [p];
  }
  const remediation = opts.format === "remediation";
  const technical = opts.technical ?? true;
  if (opts.split === "criterion") {
    const files = remediation ? renderPerCriterion(r, opts.lang, opts.standard) : renderAuditorPerCriterion(r, opts.lang, opts.standard, { technical });
    const paths: string[] = [];
    for (const f of files) {
      const p = join(opts.out, f.name);
      writeFileSync(p, f.content);
      paths.push(p);
    }
    return paths;
  }
  const p = join(opts.out, `prd-${r.date}.md`);
  writeFileSync(p, remediation ? renderBacklog(r, opts.lang, opts.standard) : renderAuditorBacklog(r, opts.lang, opts.standard, { technical }));
  return [p];
}
