// `report` — render an AuditResult into a dated compliance report (Markdown). The
// CANONICAL, gated report is WCAG 2.2 Level AA (renderReport). A country standards
// pack (RGAA, …) gets a DERIVED report (renderPackReport) projected from the same
// WCAG-keyed result. Both keep the honest structure: per-guideline/theme synthesis,
// non-conformities, conforming + not-applicable lists, and the manual worklist
// (never silently C).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { AuditResult, Finding, Lang, PageResult, Severity, Status } from "./types.js";
import { guidelineTitle, scTitle } from "./wcag.js";
import { prdUnits, partitionUnits, type PrdUnit } from "./prd.js";
import { auditorUnitModel, renderAuditorUnit, type AuditorCropLookup } from "./auditor.js";
import { resolveMessage, resolveRemediation } from "./messages.js";
import {
  basisLabel,
  derivePages,
  formatRate,
  occurrencesByPage,
  type PageResolver,
  pageResolver,
  pageView,
  renderPageGrid,
  renderRedirected,
} from "./pages.js";
import { PAGES_DIR } from "./snapshot.js";
import { pageCoverage, pageCriterionRows, pageRatePct } from "./pages-report.js";
import { mdLink, mdText } from "./md.js";
import { isLinkableUrl } from "./util.js";
import {
  type StandardId,
  CORE,
  isCore,
  loadPack,
  derivePackResults,
  isProvisionalJudgmentInapplicable,
  localize,
  packCriteriaForFinding,
  packConformancePct,
  packTestIds,
  titlePlain as packTitlePlain,
  themeName,
  type PackCriterionResult,
  type StandardPack,
} from "./standards/index.js";

const ICON: Record<Severity, string> = { bloquant: "🔴", majeur: "🟠", mineur: "🟡" };

/** One step of the summary's road map: [what to do, the rest of the sentence]. */
type Step = readonly [string, string];
const SEV_ORDER: Severity[] = ["bloquant", "majeur", "mineur"];

/** How many findings the « Constats par page » summary lists for one page before it stops. The
 *  section is a summary — the page's own sheet carries the full list — but a cap that stops
 *  silently is indistinguishable from a page that simply had nothing more, so the stop is
 *  announced. */
const PER_PAGE_MAX = 30;

const L = {
  fr: {
    title: (std: string) => `Rapport d'audit d'accessibilité — ${std}`,
    wcagStd: "WCAG 2.2 niveau AA",
    date: "Date",
    tool: "Outil",
    // TWO NOTES, BECAUSE THERE ARE TWO KINDS OF RUN — and the header used to publish the
    // first one over both. A sweep that captured thirty-seven real pages, measured them in a
    // browser and had an adjudicator rule on the result introduced itself as a preliminary
    // static pass, which is the one thing it was not.
    toolNote: "moteur statique — audit préliminaire, critères de jugement à adjuger par l'agent IA (statique, gaté), rendu via `scan`",
    toolNoteRendered: (pages: number, adjudicated: number) =>
      `moteur statique + tier rendu — ${pages} page(s) capturée(s) auditée(s) sur leur DOM réel${adjudicated > 0 ? `, ${adjudicated} critère(s) de jugement adjugé(s) par l'agent IA (gaté)` : ", aucun critère de jugement adjugé"}`,
    scope: "Périmètre",
    files: "fichier(s)",
    rate: "Taux de réussite automatique (vérifications statiques)",
    rateNote: "sous-ensemble décidable par la machine : C ÷ (C + NC)",
    // THE HEADLINE OF A COUNTRY-STANDARD DELIVERABLE. Worded as the standard words it, with
    // both operands in the open — a reader who cannot recompute the number cannot defend it.
    conformanceRate: (std: string) => `Taux de conformité ${std}`,
    conformanceProvisional: "provisoire",
    conformanceNone: (na: number) =>
      `non calculable — aucun critère applicable dans ce périmètre (${na} critère(s) conforme(s) faute de sujet, aucun autre décidé ni ouvert). Un dénominateur vide n'est pas un taux de 100 %.`,
    conformanceFormula: (v: number, a: number) => `critères validés ÷ critères applicables (${v} ÷ ${a})`,
    conformanceNa: (na: number) => `${na} critère(s) non applicable(s) exclu(s) du dénominateur`,
    conformanceOpen: (open: number) =>
      `${open} critère(s) encore à évaluer, comptés au dénominateur et pas au numérateur — le taux publié est donc un plancher`,
    decidedLine: "Décidés",
    decidedNote: (c: number, nc: number, na: number, open: number) =>
      `${c} conforme(s), ${nc} non conforme(s), ${na} conforme(s) faute de sujet, ${open} à évaluer`,
    provenance: "Provenance des décisions",
    provenanceNote: (engine: number, scan: number, agent: number) => `${engine} moteur · ${scan} navigateur · ${agent} adjudication`,
    autoRateNote: (c: number, d: number) => `critères validés par le moteur seul ÷ critères décidés sans l'agent (${c} ÷ ${d})`,
    warn: "Ce rapport couvre le sous-ensemble de critères vérifiables automatiquement. Les critères « à évaluer » (rendu / jugement) sont adjugés par l'agent IA (`verify --manual`, de façon gatée) ; le rendu passe par `scan` (voir la section 5).",
    derived: (std: string) =>
      `Rapport ${std}. Chaque critère est jugé sur ses propres tests ; la vérification d'intégrité (\`check\`/\`verify\`) opère sur le même périmètre.`,
    synthTitle: (by: string) => `1. Synthèse par ${by}`,
    byGuideline: "règle WCAG",
    byTheme: "thématique",
    th: (head: string) => [head, "C", "NC", "NA", "À évaluer"],
    naSubset: (n: number) => `**NA est inclus dans C** (critère conforme faute de sujet), jamais en plus : C + NC + « À évaluer » = ${n} critères.`,
    total: "Total",
    ncTitle: "2. Non-conformités (par priorité)",
    recTitle: "Recommandations (non normatives)",
    recNote: "Bonnes pratiques sans test normatif : ce ne sont PAS des non-conformités et elles n'entrent dans aucun taux.",
    sev: { bloquant: "Bloquant", majeur: "Majeur", mineur: "Mineur" } as Record<Severity, string>,
    none: "Aucune non-conformité détectée par le moteur statique.",
    cTitle: "3. Critères conformes (C)",
    cAgentTitle: "Conformes par adjudication de l'agent (jugement, non prouvé par le moteur)",
    cAgentNote:
      "Ces critères ont été tranchés par l'agent IA à partir des évidences citées, non décidés par le moteur déterministe. Ils sont gatés (chaque verdict cite une évidence résolvable) mais restent un jugement : ils ne sont pas comptés dans le taux de réussite automatique ci-dessus.",
    pageRatesTitle: "Taux par page",
    pageRatesNote: "Une ligne par page : la base sur laquelle elle a été jugée, et son taux avec le dénominateur sur lequel il est calculé.",
    pageCol: "Page",
    urlCol: "URL",
    basisCol: "Base",
    rateCol: "Taux",
    naTitle: "4. Critères conformes faute de sujet",
    naNote:
      "Rien de ce type dans le périmètre audité (aucun tableau, média ou champ, selon le critère) : conformes, mais sans rien à vérifier. Chaque ligne dit ce qui a été cherché, pour que l'affirmation reste réfutable.",
    manualTitle: "5. Critères à évaluer (jugement / rendu)",
    manualWarn:
      "Jugement : `verify --manual` (l'agent décide depuis la source, de façon gatée) ; rendu : `scan`. Aucun critère n'est marqué « conforme » sans justification enregistrée et gatée.",
    testsToRule: "tests à trancher",
    manualSummary: (criteria: number, tests: number) =>
      `**${criteria} critère(s) / ${tests} test(s) restent à trancher.** Leur statut et leur répartition S/R/J figurent dans la grille exhaustive (section E).`,
    manualHowTo: "Worklist complète (énoncés des tests, notes techniques, glossaire) : `verify --manual --in <audit.json> --standard <pack> --out <dir>`.",
    // These three justifications appear ONLY in a pack report (the core has no derivation to
    // explain), so they are worded in the pack's terms: they used to describe the engine's
    // internals — « mappé sur des SC hors WCAG 2.2 AA », « les CS WCAG auxquels il est
    // rattaché » — inside a document whose reader is auditing to another referential entirely.
    outOfScope: "Hors du périmètre décidable par le moteur pour ce référentiel — vérification manuelle.",
    scopedOut: "Les non-conformités relevées concernent des éléments hors du périmètre de ce critère — à évaluer séparément.",
    judgment: "L’énoncé du critère demande davantage que ce que le moteur peut établir — à trancher.",
    nothing: "Aucun.",
    dedup: "Dédup",
    canonical: "fichier(s) canonique(s) audité(s)",
    duplicate: "doublon(s) identique(s) ignoré(s)",
    truncated: (l: number, t: number, s: number) =>
      `Périmètre tronqué : ${l}/${t} fichiers audités (priorité d'abord), ${s} ignoré(s). Élargir avec --max-files.`,
    rendered: (n: number, libs: string) =>
      `Verdict source préliminaire : ${n} fichier(s) rendent des composants de bibliothèque (${libs}) dont le HTML produit n'est pas visible en analyse statique. Auditez la sortie de build (\`render\` / \`audit <dist>\`) ou \`scan\` avant de conclure.`,
    // THE FACT SURVIVES, THE INSTRUCTION DOES NOT. Those source files really do render opaque
    // components — but « auditez la sortie de build avant de conclure » is spent advice in a
    // document whose scope line says the produced HTML of N pages was read.
    renderedAudited: (n: number, libs: string, pages: number) =>
      `${n} fichier(s) rendent des composants de bibliothèque (${libs}) invisibles en analyse statique. ${pages} page(s) ont été capturées et auditées sur leur DOM réel ; ce que ces composants produisent AILLEURS, sur une page non capturée, reste un angle mort.`,
    sourceTemplate: (n: number, exts: string) =>
      `Verdict source préliminaire : ${n} composant(s) ${exts} audité(s) en SOURCE (template). Les slots, snippets et liaisons dynamiques (:attr, {@render}) sont invisibles en analyse statique — auditez le rendu (\`render\` / \`scan\`) avant de conclure.`,
    sourceTemplateAudited: (n: number, exts: string, pages: number) =>
      `${n} composant(s) ${exts} audité(s) en SOURCE (template) — slots et liaisons dynamiques invisibles en analyse statique. ${pages} page(s) ont été capturées et auditées sur leur DOM réel ; ce qu'ils rendent sur une page non capturée reste un angle mort.`,
    captures: (n: number) => `${n} fichier(s) de capture rendus audités à pleine fidélité (DOM réel) — le vrai HTML produit, pas l'appel de composant.`,
    blindSpots: (n: number) =>
      `${n} composant(s) sans capture rendue (angles morts) — audités sur source opaque uniquement ; auditez leur DOM rendu (\`render --setup\`).`,
    // Task 5 — partial-audit advisory (owner decision: scan stays opt-in but strongly advised).
    // The list names ONLY the needs-rendering criteria still untested (real coverage).
    partialAudit: (list: string) =>
      `Audit partiel — les critères « à restituer » (${list}) n'ont pas été testés. Lancez \`ultra11y scan --sample\` (Playwright + axe + sondes) sur l'échantillon, puis fusionnez avec \`scan --merge\`.`,
    // Task 5 — « Constats par page » (Ara-style per-sample-page synthesis).
    perPageTitle: "Constats par page",
    perPageNote: "Pour chaque page de l'échantillon : sa capture d'écran et les critères non conformes relevés sur cette page.",
    pageNcCriteria: (n: number) => `${n} critère(s) non conforme(s) sur cette page`,
    transverseNote: (list: string) => `Éléments transverses audités sur chaque page : ${list}.`,
    authYes: "🔒 authentification requise",
    authNo: "🌐 public",
    ncCount: "non-conformité(s)",
    perPageMore: (hidden: number, total: number) =>
      `✂️ ${hidden} autre(s) constat(s) sur cette page ne sont pas listés ici (${total} au total) — voir la fiche de page.`,
    advCount: "recommandation(s)",
    screenshotAlt: (n: string) => `Capture d'écran de la page ${n}`,
    renderedPages: (n: number) => `Pages rendues réellement testées : ${n}`,
    noRenderedPages: "aucune page n'a été rendue ; les tests `rendered` n'ont donc pas été exécutés dans ce run",
    automationContract: "Contrat d'automatisation RGAA",
    automationCounts: (s: number, sc: number, r: number, rc: number, j: number, jc: number) =>
      `${s} test(s) static sur ${sc} critère(s) · ${r} rendered sur ${rc} · ${j} judgment sur ${jc}`,
    staticCriteria: "Critères avec au moins un test static",
    renderedCriteria: "Critères avec au moins un test rendered",
    exhaustiveTitle: "Grille exhaustive des critères",
    exhaustiveNote:
      "Une ligne par critère. S/R/J indique le nombre de tests static, rendered et judgment du contrat ; le statut reste « à évaluer » tant que les tests non conclusifs n'ont pas été adjugés.",
    criterionCol: "Critère",
    statusCol: "Statut",
    automationCol: "Tests S / R / J",
    decidedByCol: "Décidé par",
    owner: { engine: "moteur", scan: "scan", agent: "IA", pending: "à adjuger" },
    // THE SUMMARY — what a reader who stops after one screen must take away: the level, what to
    // fix, and what separates the site from the next level.
    methodTitle: "Méthode, couverture et avertissements",
    conformanceShort: (v: number, a: number) => `critères validés ÷ critères applicables (${v} ÷ ${a})`,
    denominatorLine: "Calcul du taux",
    summaryTitle: "Résumé",
    levelHead: (std: string, label: string) => `Niveau de conformité ${std} : ${label}`,
    levelProvisional: "provisoire",
    levelProvisionalNote: (open: number) => `${open} critère(s) restent à évaluer ; leur décision ne peut que maintenir ou relever ce niveau.`,
    levelSettled: "tous les critères du périmètre sont décidés.",
    levelNone: (std: string) => `Niveau de conformité ${std} : non calculable`,
    levelNoneNote: "aucun critère applicable dans ce périmètre.",
    verdictHead: (std: string, state: string) => `Conformité ${std} : ${state}`,
    verdictFailed: (nc: number) => [`non atteinte`, `${nc} critère(s) non conforme(s).`],
    verdictOpen: (open: number) => [`non établie`, `aucune non-conformité relevée, mais ${open} critère(s) restent à évaluer.`],
    verdictMet: ["atteinte", "tous les critères du périmètre audité sont conformes."],
    rateLabel: "Taux de conformité",
    rateValue: (pct: number, v: number, a: number) => `${pct} % — ${v} critère(s) validé(s) sur ${a} applicable(s)`,
    rangeValue: (hi: number, best?: string) => `jusqu'à ${hi} % selon l'issue des critères à évaluer${best ? ` (au mieux « ${best} » en l'état)` : ""}`,
    tallyLabel: (n: number) => `Bilan des ${n} critères`,
    tallyValue: (c: number, nc: number, na: number, open: number) => `${c} conforme(s) · ${nc} non conforme(s) · ${na} non applicable(s) · ${open} à évaluer`,
    scaleLabel: "Échelle",
    scaleBelow: (label: string, min: number) => `${label} sous ${min} %`,
    scaleFrom: (label: string, min: number) => `${label} dès ${min} %`,
    scaleAll: (label: string) => `${label} à 100 %`,
    fixTitle: "Ce qu'il faut corriger",
    fixIntro: (n: number) => `${n} critère(s) non conforme(s), du plus au moins bloquant.`,
    fixDetail: "Le détail par page est en section 2.",
    fixGeneric: "Corrigez chaque élément signalé sur les pages concernées (liste précise dans l'annexe technique).",
    fixCols: ["Priorité", "Critère", "Occurrences", "Correction attendue"],
    fixNone: "Aucune non-conformité relevée : rien à corriger à ce stade.",
    moreFixes: (n: number) => `(+${n} autre(s) correction(s))`,
    pagesCol: "Pages",
    allPages: (n: number) => `toutes les pages (${n}/${n})`,
    morePages: (n: number) => `+${n} autre(s)`,
    offPage: (n: number) => `${n} sans page`,
    atLeast: "(au moins)",
    noPagesNote:
      "Aucune URL : cet audit porte sur le code source, aucune page du site n'a été analysée. Les anomalies ne peuvent donc pas encore être situées sur des pages ; l'annexe technique indique comment compléter l'analyse.",
    noPagesNoteTech:
      "Aucune page dans le périmètre : pour situer chaque anomalie sur une URL, lancez `ultra11y scan --sample --merge <audit.json>` (échantillon déclaré dans `.ultra11yrc.json`, avec les `sources` de chaque page) ou capturez les pages dans `.ultra11y/pages/` avant l'audit.",
    approximateNote:
      "« (au moins) » : l'anomalie est dans un fichier source déclaré par plusieurs pages ; elle n'est rattachée qu'à la première, la liste des pages peut donc être incomplète.",
    fixAdvisory: (n: number) => `S'y ajoute(nt) ${n} recommandation(s) non normative(s), sans effet sur le niveau.`,
    nextTitle: "Pour atteindre un meilleur niveau",
    nextTitleCore: "Prochaines étapes",
    // Each step is [what to do, why it matters]: the first half is emphasized by every renderer.
    stepFix: (nc: number, pct: number, v: number, a: number, floor: boolean, level?: string): Step => [
      `Corriger les ${nc} critère(s) non conforme(s)`,
      ` : le taux passe à ${floor ? "au moins " : ""}${pct} % (${v} ÷ ${a})${level ? `, soit « ${level} »` : ""}.`,
    ],
    stepFixCore: (nc: number): Step => [`Corriger les ${nc} critère(s) non conforme(s)`, ` listés ci-dessus, puis refaire l'audit.`],
    stepTarget: (label: string, min: number, need: number, a: number, missing: number, fromNc: number, fromOpen: number): Step => [
      `Viser « ${label} » (${min} %)`,
      ` : ${need} critère(s) validé(s) sur ${a} sont nécessaires, il en manque ${missing} — ${
        fromNc > 0 ? `${fromNc} par la correction des non-conformités, ${fromOpen} parmi les critères à évaluer` : "à valider parmi les critères à évaluer"
      }.`,
    ],
    stepOpen: (open: number): Step => [
      `Faire évaluer les ${open} critère(s) restants`,
      ` : ils demandent un jugement ou un test sur les pages affichées. Tant qu'ils ne sont pas évalués, le niveau annoncé est un minimum.`,
    ],
    stepOpenCore: (open: number): Step => [
      `Faire évaluer les ${open} critère(s) restants`,
      ` : ils demandent un jugement ou un test sur les pages affichées. Tant qu'ils ne sont pas évalués, la conformité ne peut pas être établie.`,
    ],
    stepTop: [
      "Niveau le plus élevé atteint",
      " : aucune non-conformité ni critère ouvert. Rejouez l'audit à chaque évolution du site pour le maintenir.",
    ] as Step,
    ncVerify:
      "Chaque bloc donne le constat, la correction attendue et les occurrences à cocher. Contrôlez chaque occurrence (inspecteur, lecteur d'écran), corrigez, puis rejouez l'audit.",
    showCriteria: (n: number) => `Voir les ${n} critère(s)`,
    annexTitle: "Annexe — grille exhaustive des critères",
    // THE READER'S REPORT and ITS TECHNICAL ANNEX.
    pagesAudited: "Pages auditées",
    morePagesAudited: (n: number) => `+${n} autre(s)`,
    sourceOnlyScope: (files: number) => `code source uniquement (${files} fichier(s)) — aucune page du site n'a été analysée`,
    annexPointer: (href: string) => `📎 Emplacements dans le code, méthode et commandes : [annexe technique](${href})`,
    partialAuditBusiness: (list: string) =>
      `Audit partiel : les points qui se vérifient sur les pages affichées (${list}) n'ont pas encore été testés. L'annexe technique indique comment compléter l'analyse.`,
    scopeCaveat: "Le périmètre analysé est incomplet (fichiers non analysés ou composants jamais affichés) : voir l'annexe technique.",
    ncIntro:
      "Pour chaque critère : le problème constaté, les pages où il apparaît et la correction attendue. Les emplacements précis dans le code sont dans l'annexe technique.",
    problem: "Problème constaté",
    pagesConcerned: "Pages concernées",
    pagesConcernedAtLeast: "Pages concernées (au moins)",
    everyPage: (n: number) => `Toutes les pages auditées (${n})`,
    morePagesConcerned: (n: number) => `+${n} autre(s) page(s) — voir la grille par page`,
    orphanOccurrences: (n: number) => `${n} occurrence(s) sans page identifiée (dans le code source)`,
    whereCode: "Où",
    inCodeOnly: (n: number) => `${n} occurrence(s) dans le code source — emplacements dans l'annexe technique`,
    expectedFix: "Correction attendue",
    occShort: (n: number) => `${n} occurrence(s)`,
    suggestion: "Suggestion",
    pageRatesNoteBusiness:
      "Une ligne par page auditée : son adresse et son taux de réussite sur les critères déjà décidés pour cette page (entre parenthèses : critères décidés / critères du référentiel).",
    manualBusiness: (n: number) =>
      `**${n} critère(s) restent à évaluer.** Ils demandent un jugement (pertinence d'une alternative, d'un intitulé, d'un titre…) ou un test sur les pages affichées. Tant qu'ils ne sont pas évalués, le taux et le niveau annoncés sont des minimums ; la marche à suivre est dans l'annexe technique.`,
    annexDocTitle: (std: string, date: string) => `Annexe technique — audit ${std} du ${date}`,
    annexBack: (href: string) =>
      `Complète le rapport [${href}](${href}) : emplacements dans le code, méthode de l'audit et commandes. Le rapport, lui, s'adresse à tous les lecteurs.`,
    annexNcTitle: "A. Non-conformités — emplacements dans le code",
    annexRecTitle: "B. Recommandations — emplacements dans le code",
    annexPagesTitle: "C. Pages — base de jugement et constats",
    annexManualTitle: "D. Critères à évaluer — marche à suivre",
    annexGridTitle: "E. Grille exhaustive des critères",
  },
  en: {
    title: (std: string) => `Accessibility audit report — ${std}`,
    wcagStd: "WCAG 2.2 Level AA",
    date: "Date",
    tool: "Tool",
    toolNote: "static engine — preliminary audit; judgment criteria adjudicated by the AI agent (statically, gated), rendering via `scan`",
    toolNoteRendered: (pages: number, adjudicated: number) =>
      `static engine + rendered tier — ${pages} captured page(s) audited on their real DOM${adjudicated > 0 ? `; ${adjudicated} judgment criterion/criteria adjudicated by the AI agent (gated)` : "; no judgment criterion adjudicated"}`,
    scope: "Scope",
    files: "file(s)",
    rate: "Automatic static-check pass rate",
    rateNote: "machine-decidable subset: C ÷ (C + NC)",
    conformanceRate: (std: string) => `${std} conformity rate`,
    conformanceProvisional: "provisional",
    conformanceNone: (na: number) =>
      `not computable — no applicable criterion in this scope (${na} conforming for want of a subject, none other decided or open). An empty denominator is not a rate of 100%.`,
    conformanceFormula: (v: number, a: number) => `validated criteria ÷ applicable criteria (${v} ÷ ${a})`,
    conformanceNa: (na: number) => `${na} criterion/criteria not applicable, excluded from the denominator`,
    conformanceOpen: (open: number) =>
      `${open} criterion/criteria still to assess, counted in the denominator and not in the numerator — the published rate is a floor`,
    decidedLine: "Decided",
    decidedNote: (c: number, nc: number, na: number, open: number) =>
      `${c} conforming, ${nc} non-conforming, ${na} conforming for want of a subject, ${open} to assess`,
    provenance: "Where the decisions came from",
    provenanceNote: (engine: number, scan: number, agent: number) => `${engine} engine · ${scan} browser · ${agent} adjudication`,
    autoRateNote: (c: number, d: number) => `criteria validated by the engine alone ÷ criteria decided without the agent (${c} ÷ ${d})`,
    warn: "This report covers the subset of criteria checkable automatically. The “to assess” criteria (rendering / judgment) are adjudicated by the AI agent (`verify --manual`, gated); rendering goes through `scan` (see section 5).",
    derived: (std: string) =>
      `${std} report. Every criterion is judged on its own tests; the integrity gates (\`check\`/\`verify\`) operate on the same scope.`,
    synthTitle: (by: string) => `1. Synthesis by ${by}`,
    byGuideline: "WCAG guideline",
    byTheme: "theme",
    th: (head: string) => [head, "C", "NC", "NA", "To assess"],
    naSubset: (n: number) => `**NA is included in C** (conforming for want of a subject), never on top of it: C + NC + “To assess” = ${n} criteria.`,
    total: "Total",
    ncTitle: "2. Non-conformities (by priority)",
    recTitle: "Recommendations (non-normative)",
    recNote: "Good practices with no normative test: these are NOT non-conformities and enter no rate.",
    sev: { bloquant: "Blocking", majeur: "Major", mineur: "Minor" } as Record<Severity, string>,
    none: "No non-conformity detected by the static engine.",
    cTitle: "3. Conforming criteria (C)",
    cAgentTitle: "Conforming by agent adjudication (judgement, not proven by the engine)",
    cAgentNote:
      "These criteria were ruled on by the AI agent from the evidence it cited, not decided by the deterministic engine. They are gated (every verdict cites resolvable evidence) but remain a judgement: they are not counted in the automatic pass rate above.",
    pageRatesTitle: "Per-page rate",
    pageRatesNote: "One row per page: the basis it was judged on, and its rate with the denominator it was computed over.",
    pageCol: "Page",
    urlCol: "URL",
    basisCol: "Basis",
    rateCol: "Rate",
    naTitle: "4. Conforming for want of a subject",
    naNote:
      "Nothing of that kind in the audited scope (no table, media or form control, depending on the criterion): conforming, with nothing to verify. Each line says what was looked for, so the claim stays falsifiable.",
    manualTitle: "5. Criteria to assess (judgment / rendering)",
    manualWarn:
      "Judgment: `verify --manual` (the agent decides from source, gated); rendering: `scan`. No criterion is marked “conforming” without a recorded, gated justification.",
    testsToRule: "tests to rule on",
    manualSummary: (criteria: number, tests: number) =>
      `**${criteria} criterion(ia) / ${tests} test(s) remain to be ruled on.** Their status and S/R/J split are in the exhaustive grid (section E).`,
    manualHowTo: "Full worklist (test wording, technical notes, glossary): `verify --manual --in <audit.json> --standard <pack> --out <dir>`.",
    outOfScope: "Outside what the engine can decide for this standard — manual verification.",
    scopedOut: "The failures found concern elements outside this criterion's scope — assess separately.",
    judgment: "The criterion asks more than the engine can establish — rule on it.",
    nothing: "None.",
    dedup: "Dedup",
    canonical: "canonical file(s) audited",
    duplicate: "identical duplicate(s) skipped",
    truncated: (l: number, t: number, s: number) => `Scope truncated: ${l}/${t} files audited (highest-priority first), ${s} skipped. Widen with --max-files.`,
    rendered: (n: number, libs: string) =>
      `Preliminary source verdict: ${n} file(s) render component-library components (${libs}) whose produced HTML is invisible to static analysis. Audit the build output (\`render\` / \`audit <dist>\`) or \`scan\` before concluding.`,
    renderedAudited: (n: number, libs: string, pages: number) =>
      `${n} file(s) render component-library components (${libs}) invisible to static analysis. ${pages} page(s) were captured and audited on their real DOM; what those components produce ELSEWHERE, on a page nobody captured, remains a blind spot.`,
    sourceTemplate: (n: number, exts: string) =>
      `Preliminary source verdict: ${n} ${exts} component(s) audited as SOURCE (template). Slots, snippets and dynamic bindings (:attr, {@render}) are invisible to static analysis — audit the rendered output (\`render\` / \`scan\`) before concluding.`,
    sourceTemplateAudited: (n: number, exts: string, pages: number) =>
      `${n} ${exts} component(s) audited as SOURCE (template) — slots and dynamic bindings invisible to static analysis. ${pages} page(s) were captured and audited on their real DOM; what they render on a page nobody captured remains a blind spot.`,
    captures: (n: number) => `${n} rendered capture file(s) audited at full fidelity (real DOM) — the true produced HTML, not the component call.`,
    blindSpots: (n: number) =>
      `${n} component(s) without a rendered capture (blind spots) — audited from opaque source only; audit their rendered DOM (\`render --setup\`).`,
    // Task 5 — partial-audit advisory (owner decision: scan stays opt-in but strongly advised).
    // The list names ONLY the needs-rendering criteria still untested (real coverage).
    partialAudit: (list: string) =>
      `Partial audit — the needs-rendering criteria (${list}) were not tested. Run \`ultra11y scan --sample\` (Playwright + axe + probes) on the sample, then merge with \`scan --merge\`.`,
    // Task 5 — « Findings per page » (Ara-style per-sample-page synthesis).
    perPageTitle: "Findings per page",
    perPageNote: "For each sample page: its screenshot and the criteria found non-conforming on that page.",
    pageNcCriteria: (n: number) => `${n} non-conforming criterion/criteria on this page`,
    transverseNote: (list: string) => `Transverse elements audited on every page: ${list}.`,
    authYes: "🔒 authentication required",
    authNo: "🌐 public",
    ncCount: "non-conformity(ies)",
    perPageMore: (hidden: number, total: number) => `✂️ ${hidden} further finding(s) on this page are not listed here (${total} in total) — see its page sheet.`,
    advCount: "recommendation(s)",
    screenshotAlt: (n: string) => `Screenshot of the ${n} page`,
    renderedPages: (n: number) => `Rendered pages actually tested: ${n}`,
    noRenderedPages: "no page was rendered; the `rendered` tests were therefore not executed in this run",
    automationContract: "RGAA automation contract",
    automationCounts: (s: number, sc: number, r: number, rc: number, j: number, jc: number) =>
      `${s} static test(s) across ${sc} criterion(ia) · ${r} rendered across ${rc} · ${j} judgment across ${jc}`,
    staticCriteria: "Criteria with at least one static test",
    renderedCriteria: "Criteria with at least one rendered test",
    exhaustiveTitle: "Exhaustive criteria grid",
    exhaustiveNote:
      "One row per criterion. S/R/J is the number of static, rendered and judgment tests in the contract; a status stays “to assess” until non-conclusive tests have been adjudicated.",
    criterionCol: "Criterion",
    statusCol: "Status",
    automationCol: "S / R / J tests",
    decidedByCol: "Decided by",
    owner: { engine: "engine", scan: "scan", agent: "AI", pending: "to adjudicate" },
    methodTitle: "Method, coverage and caveats",
    conformanceShort: (v: number, a: number) => `validated criteria ÷ applicable criteria (${v} ÷ ${a})`,
    denominatorLine: "How the rate is computed",
    summaryTitle: "Summary",
    levelHead: (std: string, label: string) => `${std} conformity level: ${label}`,
    levelProvisional: "provisional",
    levelProvisionalNote: (open: number) => `${open} criterion/criteria still to assess; deciding them can only keep or raise this level.`,
    levelSettled: "every criterion in scope is decided.",
    levelNone: (std: string) => `${std} conformity level: not computable`,
    levelNoneNote: "no applicable criterion in this scope.",
    verdictHead: (std: string, state: string) => `${std} conformance: ${state}`,
    verdictFailed: (nc: number) => [`not met`, `${nc} non-conforming criterion/criteria.`],
    verdictOpen: (open: number) => [`not established`, `no non-conformity found, but ${open} criterion/criteria still to assess.`],
    verdictMet: ["met", "every criterion in the audited scope conforms."],
    rateLabel: "Conformity rate",
    rateValue: (pct: number, v: number, a: number) => `${pct}% — ${v} validated out of ${a} applicable criterion/criteria`,
    rangeValue: (hi: number, best?: string) => `up to ${hi}% depending on the criteria still to assess${best ? ` (at best “${best}” as things stand)` : ""}`,
    tallyLabel: (n: number) => `The ${n} criteria`,
    tallyValue: (c: number, nc: number, na: number, open: number) => `${c} conforming · ${nc} non-conforming · ${na} not applicable · ${open} to assess`,
    scaleLabel: "Scale",
    scaleBelow: (label: string, min: number) => `${label} below ${min}%`,
    scaleFrom: (label: string, min: number) => `${label} from ${min}%`,
    scaleAll: (label: string) => `${label} at 100%`,
    fixTitle: "What to fix",
    fixIntro: (n: number) => `${n} non-conforming criterion/criteria, most blocking first.`,
    fixDetail: "The per-page detail is in section 2.",
    fixGeneric: "Fix each element reported on the pages concerned (exact list in the technical annex).",
    fixCols: ["Priority", "Criterion", "Occurrences", "Expected fix"],
    fixNone: "No non-conformity found: nothing to fix at this stage.",
    moreFixes: (n: number) => `(+${n} more fix(es))`,
    pagesCol: "Pages",
    allPages: (n: number) => `all pages (${n}/${n})`,
    morePages: (n: number) => `+${n} more`,
    offPage: (n: number) => `${n} on no page`,
    atLeast: "(at least)",
    noPagesNote:
      "No URL: this audit read source code, and no page of the site was analysed. The defects therefore cannot be located on pages yet; the technical annex explains how to complete the analysis.",
    noPagesNoteTech:
      "No page in scope: to locate each defect on a URL, run `ultra11y scan --sample --merge <audit.json>` (sample declared in `.ultra11yrc.json`, with each page's `sources`) or capture the pages into `.ultra11y/pages/` before the audit.",
    approximateNote:
      "“(at least)”: the defect is in a source file several pages declare; it is attributed to the first of them only, so the page list may be incomplete.",
    fixAdvisory: (n: number) => `Plus ${n} non-normative recommendation(s), with no effect on the level.`,
    nextTitle: "Reaching a better level",
    nextTitleCore: "Next steps",
    stepFix: (nc: number, pct: number, v: number, a: number, floor: boolean, level?: string): Step => [
      `Fix the ${nc} non-conforming criterion/criteria`,
      `: the rate rises to ${floor ? "at least " : ""}${pct}% (${v} ÷ ${a})${level ? `, i.e. “${level}”` : ""}.`,
    ],
    stepFixCore: (nc: number): Step => [`Fix the ${nc} non-conforming criterion/criteria`, ` listed above, then run the audit again.`],
    stepTarget: (label: string, min: number, need: number, a: number, missing: number, fromNc: number, fromOpen: number): Step => [
      `Aim for “${label}” (${min}%)`,
      `: ${need} validated criteria out of ${a} are required, ${missing} missing — ${
        fromNc > 0
          ? `${fromNc} from fixing the non-conformities, ${fromOpen} from the criteria still to assess`
          : "to validate among the criteria still to assess"
      }.`,
    ],
    stepOpen: (open: number): Step => [
      `Have the ${open} remaining criterion/criteria assessed`,
      `: they need a judgment or a test on the displayed pages. Until they are, the announced level is a minimum.`,
    ],
    stepOpenCore: (open: number): Step => [
      `Have the ${open} remaining criterion/criteria assessed`,
      `: they need a judgment or a test on the displayed pages. Until they are, conformance cannot be established.`,
    ],
    stepTop: ["Highest level reached", ": no non-conformity and no open criterion. Re-run the audit whenever the site changes to keep it."] as Step,
    ncVerify:
      "Each block gives the finding, the expected fix and the occurrences to tick. Check each occurrence (inspector, screen reader), fix, then re-run the audit.",
    showCriteria: (n: number) => `Show the ${n} criterion/criteria`,
    annexTitle: "Appendix — exhaustive criteria grid",
    pagesAudited: "Pages audited",
    morePagesAudited: (n: number) => `+${n} more`,
    sourceOnlyScope: (files: number) => `source code only (${files} file(s)) — no page of the site was analysed`,
    annexPointer: (href: string) => `📎 Code locations, method and commands: [technical annex](${href})`,
    partialAuditBusiness: (list: string) =>
      `Partial audit: the points checked on displayed pages (${list}) have not been tested yet. The technical annex explains how to complete the analysis.`,
    scopeCaveat: "The analysed scope is incomplete (files not analysed, or components never displayed): see the technical annex.",
    ncIntro: "For each criterion: the problem found, the pages it appears on and the expected fix. The exact code locations are in the technical annex.",
    problem: "Problem found",
    pagesConcerned: "Pages concerned",
    pagesConcernedAtLeast: "Pages concerned (at least)",
    everyPage: (n: number) => `Every audited page (${n})`,
    morePagesConcerned: (n: number) => `+${n} more page(s) — see the per-page grid`,
    orphanOccurrences: (n: number) => `${n} occurrence(s) on no known page (in the source code)`,
    whereCode: "Where",
    inCodeOnly: (n: number) => `${n} occurrence(s) in the source code — locations in the technical annex`,
    expectedFix: "Expected fix",
    occShort: (n: number) => `${n} occurrence(s)`,
    suggestion: "Suggestion",
    pageRatesNoteBusiness:
      "One row per audited page: its address and its pass rate over the criteria already decided for that page (in brackets: criteria decided / criteria in the standard).",
    manualBusiness: (n: number) =>
      `**${n} criterion/criteria still to assess.** They need a judgment (is an alternative, a label, a title relevant…) or a test on the displayed pages. Until they are assessed, the announced rate and level are minimums; the procedure is in the technical annex.`,
    annexDocTitle: (std: string, date: string) => `Technical annex — ${std} audit of ${date}`,
    annexBack: (href: string) =>
      `Completes the report [${href}](${href}): code locations, audit method and commands. The report itself is written for every reader.`,
    annexNcTitle: "A. Non-conformities — code locations",
    annexRecTitle: "B. Recommendations — code locations",
    annexPagesTitle: "C. Pages — basis of judgment and findings",
    annexManualTitle: "D. Criteria to assess — procedure",
    annexGridTitle: "E. Exhaustive criteria grid",
  },
} as const;

// Every criterion an automated tier can CREDIT, with the labels the partial-audit banner names
// them by. Two tiers contribute, and `scope.scan.testedScs` is the single coverage stamp for
// both — so the banner only ever names criteria that genuinely lack a verdict, and disappears
// once they are all covered:
//
//   - the SNAPSHOT tier (src/rules/rendered.ts), offline from a recorded page: 1.3.4, 1.4.1,
//     1.4.3, 1.4.11, 2.4.7;
//   - the LIVE-BROWSER tier (src/scan.ts Docker measures 1.4.10 only; src/scan-local.ts adds
//     zoom / spacing / focus / hover, and live regions when interactions are on).
//
// This listed six, all from the live-browser tier, and that was wrong in both directions at
// once: an audit that had ingested 35 snapshots and measured contrast and focus visibility from
// them was still told the rendering criteria "were not tested", while the criteria those
// snapshots really did decide were absent from the list and so could never be reported covered.
//
// The needs-rendering criteria NO tier measures (1.4.5, 2.3.1, 2.5.8 — 2.1.2 left them when the
// keyboard-trap probe landed, 2.4.11 when the focus-obscured probe joined the same walk of the
// tab ring) are
// deliberately NOT here: listing them would make the banner permanent and un-actionable, since
// no run could ever clear it. They carry a per-criterion reason instead (src/audit.ts
// RESIDUAL_TRAIL) saying that no automated tier decides them, and what does.
const NEEDS_RENDERING: readonly { sc: string; label: Record<Lang, string> }[] = [
  { sc: "1.3.4", label: { fr: "verrou d’orientation", en: "orientation lock" } },
  { sc: "1.4.1", label: { fr: "information par la couleur", en: "use of colour" } },
  { sc: "1.4.3", label: { fr: "contraste du texte", en: "text contrast" } },
  { sc: "1.4.4", label: { fr: "zoom 200 %", en: "200% zoom" } },
  { sc: "1.4.10", label: { fr: "reflow 320 px", en: "320px reflow" } },
  { sc: "1.4.11", label: { fr: "contraste des composants", en: "non-text contrast" } },
  { sc: "1.4.12", label: { fr: "espacement du texte", en: "text spacing" } },
  { sc: "1.4.13", label: { fr: "contenu au survol", en: "content on hover" } },
  { sc: "2.1.2", label: { fr: "piège au clavier", en: "keyboard trap" } },
  { sc: "2.4.7", label: { fr: "visibilité du focus", en: "focus visibility" } },
  { sc: "2.4.11", label: { fr: "focus masqué", en: "focus obscured" } },
  { sc: "4.1.3", label: { fr: "régions live", en: "live regions" } },
];

/** The scan-tier needs-rendering SCs this audit has NO dynamic verdict for. Coverage =
 *  scope.scan.testedScs (the merge-time stamp); back-compat: a dyn-* probe finding proves
 *  its SC was measured even on an audit merged before the stamp existed. Non-empty ⇒ the
 *  partial-audit advisory shows, naming exactly these criteria. */
export function untestedNeedsRendering(r: AuditResult, established: ReadonlySet<string> = new Set()): string[] {
  const tested = new Set(r.scope.scan?.testedScs ?? []);
  for (const f of r.findings) if (f.ruleId.startsWith("dyn-")) tested.add(f.criteriaId);
  // A CRITERION THE DOCUMENT ITSELF RULES ON IS NOT ONE « NOBODY TESTED ».
  //
  // The banner and the grid are two claims in one document, and they were allowed to
  // contradict each other: egapro's report published « les critères à restituer (régions live)
  // n'ont pas été testés » above a grid ruling RGAA 7.5 non-conformant with three cited
  // findings. A reader cannot act on both.
  //
  // ESTABLISHED, not merely decided. A criterion conforming because nothing contradicted it is
  // exactly what this banner exists to warn about, so silence never clears it — only a verdict
  // something stands behind (an NC carries its findings; an adjudication carries its citations,
  // gated). The caller supplies the set, because the verdicts live at the standard's own
  // granularity, not at the WCAG success criterion's.
  return NEEDS_RENDERING.filter((c) => !tested.has(c.sc) && !established.has(c.sc)).map((c) => c.sc);
}

/** The WCAG success criteria a pack projection has actually SETTLED — an NC (which always
 *  carries its findings) or an agent adjudication (gated on a resolvable citation). A
 *  conformity reached by silence is deliberately not one of them. */
export function establishedScs(derived: readonly PackCriterionResult[]): Set<string> {
  const out = new Set<string>();
  for (const d of derived) {
    if (d.status !== "NC" && d.decidedBy !== "agent") continue;
    // THE SC THE CONSTAT CARRIES, not every SC the criterion happens to map to. RGAA 10.7
    // projects from 1.4.1 AND 2.4.7; one `dyn-focus-visible` hit fails it on 2.4.7 alone, and
    // crediting 1.4.1 with it would delete « information par la couleur » from the banner on
    // the strength of a measurement nobody made.
    const carried = new Set(d.findings.map((f) => f.criteriaId).filter((id) => d.scs.includes(id)));
    // A criterion mapped to exactly one SC needs no attribution: there is nowhere else the
    // verdict could be about. This is the ordinary case, and the one 7.5 → 4.1.3 falls in.
    if (carried.size === 0 && d.scs.length === 1) carried.add(d.scs[0]!);
    for (const sc of carried) out.add(sc);
  }
  return out;
}

/** The partial-audit advisory text (no leading `> `) — shared by the report banner and the
 *  CLI warning (src/cli.ts cmdReport) so the two can never drift. Names ONLY the criteria
 *  in `untested` (default: all of them — the no-scan-at-all case). */
export function partialAuditBanner(lang: Lang, untested: string[] = NEEDS_RENDERING.map((c) => c.sc)): string {
  const set = new Set(untested);
  const labels = NEEDS_RENDERING.filter((c) => set.has(c.sc)).map((c) => c.label[lang]);
  return L[lang].partialAudit(labels.join(", "));
}

// A normalized row the renderer is agnostic about: one labelled criterion + its status/findings.
export interface ReportRow {
  id: string;
  label: string; // "1.4.3 — Contrast (Minimum)" or "RGAA 1.1 — …"
  status: Status;
  findings: Finding[];
  justification?: string;
  // Who decided this criterion. Absent/"engine" = the deterministic engine; "agent" = an
  // adjudication (gated, but a judgement call); "scan" = the rendered tier. Rendered so a
  // conformity the engine PROVED is never presented as the same thing as one an agent
  // RULED — see the split in section 3 and the header rate.
  decidedBy?: "engine" | "agent" | "scan";
  /** Conforming because nothing of its kind is in scope — see INAPPLICABLE_STATUS. Section 4
   *  collects these, so section 3 stays the criteria something was actually verified about. */
  inapplicable?: boolean;
}

export interface ReportGroup {
  key: string;
  title: string;
  rows: ReportRow[];
}

export interface ReportTally {
  c: number;
  nc: number;
  na: number;
  manual: number;
}

/** The §1 synthesis arithmetic over one group's rows. */
export function tallyRows(rows: ReportRow[]): ReportTally {
  // `c` counts every conformity, including the ones reached for want of a subject; `na`
  // reports how many of those there were. It is therefore a SUBSET of `c`, never a fourth
  // column: c + nc + manual is the criterion count, and a reader adding all four would
  // otherwise overshoot it. Section 4 lists exactly the criteria `na` counts.
  return {
    c: rows.filter((x) => x.status === "C").length,
    nc: rows.filter((x) => x.status === "NC").length,
    na: rows.filter((x) => x.inapplicable).length,
    manual: rows.filter((x) => x.status === "manual").length,
  };
}

/** The §1 « Total » row: the same arithmetic over every group. */
export function reportTotals(groups: ReportGroup[]): ReportTally {
  const tot: ReportTally = { c: 0, nc: 0, na: 0, manual: 0 };
  for (const g of groups) {
    const t = tallyRows(g.rows);
    tot.c += t.c;
    tot.nc += t.nc;
    tot.na += t.na;
    tot.manual += t.manual;
  }
  return tot;
}

/** The denominator the headline rate never carried. `conformancePct` is computed from the
 *  decided set (src/audit.ts) and then thrown away, which is how « 100 % » reached a pull
 *  request over two decided criteria out of a hundred and six. Every surface that prints the
 *  run-wide rate resolves its `(decided/total)` here. */
export function reportCoverage(groups: ReportGroup[]): { decided: number; total: number } {
  const t = reportTotals(groups);
  // c + nc + manual, and NOT + na: `na` counts the conformities reached for want of a subject,
  // which are already inside `c` (see tallyRows). Adding it would put every such criterion in
  // the denominator twice and quietly deflate every rate that reads this.
  return { decided: t.c + t.nc, total: t.c + t.nc + t.manual };
}

/** THE OFFICIAL RGAA CONFORMITY RATE, and the operands a reader has to be able to check.
 *
 *  « Critères validés ÷ critères APPLICABLES », the non-applicable ones excluded from the
 *  denominator — the formula the French state fixes for a declaration of accessibility
 *  (accessibilite.numerique.gouv.fr, obligations / évaluation de conformité). It is the only
 *  one of the three a legal declaration may reproduce as it stands.
 *
 *  NA leaves BOTH halves, not just the denominator: this engine reports a criterion with no
 *  subject in scope as CONFORMING (INAPPLICABLE_STATUS), so `na` is a subset of `c` and has to
 *  be subtracted from it as well — otherwise every absent subject would count as a criterion
 *  somebody validated.
 *
 *  `open` is what makes the number PROVISIONAL. A criterion still to assess sits in the
 *  denominator and not in the numerator, so the published rate is a floor: it can only rise
 *  as the open ones close. A rate presented as final while five criteria are open is a claim
 *  the audit has not made. */
export interface ConformanceRate {
  pct: number;
  validated: number;
  applicable: number;
  na: number;
  open: number;
  decided: number;
  total: number;
}

export function conformanceRate(t: ReportTally): ConformanceRate {
  const validated = Math.max(0, t.c - t.na);
  const applicable = validated + t.nc + t.manual;
  return {
    // No applicable criterion is not a failure — it is a scope with nothing of any kind in it,
    // and the repository's convention for an empty denominator is 100 (src/audit.ts
    // conformancePct). Divergent conventions on the same question is how two numbers describing
    // one grid start disagreeing.
    pct: applicable === 0 ? 100 : Math.round((validated / applicable) * 100),
    validated,
    applicable,
    na: t.na,
    open: t.manual,
    decided: t.c + t.nc,
    total: t.c + t.nc + t.manual,
  };
}

/** Who settled each criterion — the engine's own tests, a browser measurement, or an
 *  adjudication. Published beside the rate because « 80 % » means something different when
 *  half of it was ruled by a model than when the engine proved it. */
export function decisionProvenance(rows: ReportRow[]): { engine: number; scan: number; agent: number } {
  const decided = rows.filter((r) => r.status !== "manual");
  return {
    engine: decided.filter((r) => !r.decidedBy || r.decidedBy === "engine").length,
    scan: decided.filter((r) => r.decidedBy === "scan").length,
    agent: decided.filter((r) => r.decidedBy === "agent").length,
  };
}

/** One step of a standard's conformity scale, resolved to the report language. */
export interface LevelStep {
  min: number;
  label: string;
}

/** The standard's scale, highest step first. Empty for the WCAG core and for a pack that
 *  publishes none — the summary then states a verdict instead of a level. */
export function conformityScale(standard: StandardId, lang: Lang): LevelStep[] {
  if (isCore(standard)) return [];
  const pack = loadPack(standard);
  return (pack.conformityLevels ?? [])
    .filter((l) => typeof l.min === "number" && l.min >= 0 && l.min <= 100)
    .map((l) => ({ min: l.min, label: localize(pack, l.label, lang) }))
    .filter((l) => l.label)
    .sort((a, b) => b.min - a.min);
}

/** The step `validated ÷ applicable` reaches. EXACT, not on the rounded percentage: « at least
 *  50 % » is a threshold on criteria, and 50 of 101 is 49.5 % however the headline rounds it. */
function levelAt(scale: LevelStep[], validated: number, applicable: number): LevelStep | undefined {
  if (applicable === 0) return undefined;
  return scale.find((l) => validated * 100 >= l.min * applicable);
}

/** Everything the report summary DECIDES, before it is turned into Markdown or HTML: the level
 *  the audited scope reaches, how far the open criteria could move it, what fixing the
 *  non-conformities would give, and what separates it from the next step of the scale.
 *
 *  Pure arithmetic over the same tally §1 prints, so the summary can never disagree with the
 *  synthesis table under it. Every « after » figure is a floor while criteria are open: an open
 *  criterion counts in the denominator and not in the numerator, and deciding it — C, NC or NA
 *  — can only keep or raise the rate. */
export interface ReportSummary {
  rate: ConformanceRate;
  scale: LevelStep[];
  level?: LevelStep;
  /** The rate if every open criterion were validated. */
  ceilingPct: number;
  best?: LevelStep;
  afterFix?: { validated: number; pct: number; level?: LevelStep };
  next?: { level: LevelStep; need: number; missing: number; fromNc: number; fromOpen: number };
}

export function reportSummary(tally: ReportTally, scale: LevelStep[]): ReportSummary {
  const rate = conformanceRate(tally);
  const { validated: v, applicable: a, open } = rate;
  const nc = tally.nc;
  const pct = (x: number) => (a === 0 ? 100 : Math.round((x / a) * 100));
  const level = levelAt(scale, v, a);
  const summary: ReportSummary = { rate, scale, ceilingPct: pct(v + open) };
  if (level) summary.level = level;
  const best = levelAt(scale, v + open, a);
  if (best && open > 0) summary.best = best;
  if (nc > 0) {
    const after = levelAt(scale, v + nc, a);
    summary.afterFix = { validated: v + nc, pct: pct(v + nc), ...(after ? { level: after } : {}) };
  }
  // The next step up is the LOWEST one above the current level — the one within reach.
  const above = scale.filter((l) => (level ? l.min > level.min : true)).sort((x, y) => x.min - y.min)[0];
  if (above && a > 0) {
    const need = Math.ceil((above.min * a) / 100);
    const missing = Math.max(0, need - v);
    const fromNc = Math.min(nc, missing);
    summary.next = { level: above, need, missing, fromNc, fromOpen: missing - fromNc };
  }
  return summary;
}

export interface AutomationOverview {
  tests: { static: number; rendered: number; judgment: number };
  criteria: { static: string[]; rendered: string[]; judgment: string[] };
  signals: { decisive: string[]; candidate: string[]; advisory: string[] };
}

/** The standard's declared test-level contract. This is a plan, not runtime coverage: the
 *  report prints the latter separately from `scope.pagesAudited`, so a source-only run can
 *  never make planned rendered tests look as though they ran. */
export function automationOverview(standard: StandardId): AutomationOverview | undefined {
  if (isCore(standard)) return undefined;
  const pack = loadPack(standard);
  const tests = { static: 0, rendered: 0, judgment: 0 };
  const criteria = { static: [] as string[], rendered: [] as string[], judgment: [] as string[] };
  const signals = { decisive: [] as string[], candidate: [] as string[], advisory: [] as string[] };
  for (const criterion of pack.criteria) {
    const tiers = Object.values(criterion.automation?.tests ?? {});
    for (const tier of tiers) tests[tier]++;
    for (const tier of ["static", "rendered", "judgment"] as const) if (tiers.includes(tier)) criteria[tier].push(criterion.id);
    const effects = new Set((criterion.automation?.rules ?? []).map((rule) => rule.effect));
    if (effects.has("decisive-nc")) signals.decisive.push(criterion.id);
    if (effects.has("candidate")) signals.candidate.push(criterion.id);
    if (effects.has("advisory")) signals.advisory.push(criterion.id);
  }
  return { tests, criteria, signals };
}

function automationCell(standard: StandardId, id: string): string {
  if (isCore(standard)) return "—";
  const tiers = Object.values(loadPack(standard).criteria.find((criterion) => criterion.id === id)?.automation?.tests ?? {});
  const n = (tier: "static" | "rendered" | "judgment") => tiers.filter((value) => value === tier).length;
  return `${n("static")} / ${n("rendered")} / ${n("judgment")}`;
}

function exhaustiveGrid(groups: ReportGroup[], standard: StandardId, lang: Lang, title: string): string[] {
  const s = L[lang];
  const rows = groups.flatMap((group) => group.rows);
  // AN APPENDIX, FOLDED. One row per criterion is the index an auditor looks a criterion up in,
  // not something anyone reads through — and printed right under the synthesis it put 106 rows
  // between the reader and the first non-conformity. The table is whole inside the fold, so
  // `check` (which counts the agent conformities in it) and every consumer still read it.
  const out = [
    `## ${title}`,
    "",
    `> ${s.exhaustiveNote}`,
    "",
    "<details>",
    `<summary>${s.showCriteria(rows.length)}</summary>`,
    "",
    `| ${s.criterionCol} | ${s.statusCol} | ${s.automationCol} | ${s.decidedByCol} |`,
    "| --- | :---: | :---: | --- |",
  ];
  for (const row of rows) {
    const owner = row.status === "manual" ? s.owner.pending : s.owner[row.decidedBy ?? "engine"];
    out.push(`| ${row.label} | ${row.inapplicable ? "NA" : row.status === "manual" ? "?" : row.status} | ${automationCell(standard, row.id)} | ${owner} |`);
  }
  out.push("", "</details>", "");
  return out;
}

/** Lines behind a `<details>` toggle. GFM renders Markdown inside one only after a blank line,
 *  hence the empty strings; the lines themselves are untouched, so every gate that reads them
 *  line by line (`check`'s §3/§4 scanners, `verify`'s worklist) reads them exactly as before. */
function folded(summary: string, lines: string[]): string[] {
  return ["<details>", `<summary>${summary}</summary>`, "", ...lines, "", "</details>", ""];
}

/** One table cell: Markdown-safe, single-line, with no pipe to split the row on. */
function cell(text: string): string {
  return mdText(text)
    .replace(/\s*\n\s*/g, " ")
    .replace(/\|/g, "\\|");
}

/** The scale in reading order, lowest step first: « Non conforme sous 50 % · Partiellement
 *  conforme dès 50 % · Totalement conforme à 100 % ». */
function scaleText(scale: LevelStep[], lang: Lang): string {
  const s = L[lang];
  const asc = [...scale].sort((a, b) => a.min - b.min);
  return asc
    .map((l, i) => {
      const next = asc[i + 1];
      if (l.min === 0 && next) return s.scaleBelow(l.label, next.min);
      if (l.min === 100) return s.scaleAll(l.label);
      return s.scaleFrom(l.label, l.min);
    })
    .join(" · ");
}

/** THE SUMMARY — one screen that answers the three questions a reader opens the report with:
 *  where does the site stand, what has to be fixed, and what does the next level take.
 *
 *  It decides nothing. The level and the arithmetic come from `reportSummary` over the same
 *  tally §1 prints; the rows are the §2 units (`prdUnits`), so a criterion listed here is exactly
 *  a criterion detailed there. Resolved to text once, here, and serialized twice — Markdown
 *  below, HTML in src/html-report.ts — so the two deliverables cannot word a level differently. */
export interface SummaryModel {
  title: string;
  /** The level (or, without a scale, the conformance verdict): emphasized part, then its note. */
  headline: readonly [string, string];
  facts: { label: string; value: string }[];
  fix: {
    title: string;
    intro?: string;
    none?: string;
    columns: readonly string[];
    /** The « Pages » column header — present only when the audit has pages in scope. */
    pagesColumn?: string;
    rows: { icon: string; priority: string; criterion: string; occurrences: number; pages?: SummaryPages; fix: string }[];
    /** Under the table: why there is no URL at all, or why a page list may be incomplete. */
    pagesNote?: string;
    advisory?: string;
  };
  next?: { title: string; steps: Step[] };
}

/** Where one non-conformity was found, already cut to what a table cell can hold. */
export interface SummaryPages {
  /** The pages listed by name, most occurrences first. */
  listed: { name: string; url: string }[];
  /** Pages found but not listed. */
  more: number;
  /** Set when the criterion fails on every page in scope: the count of those pages. */
  all?: number;
  /** Occurrences no page claims. */
  orphans: number;
  approximate: boolean;
}

/** How many pages a summary cell names before it counts the rest. */
const SUMMARY_PAGES_MAX = 3;

export function summaryModel(
  lang: Lang,
  std: string,
  standard: StandardId,
  tot: ReportTally,
  ncUnits: PrdUnit[],
  advisories: number,
  resolver?: PageResolver,
): SummaryModel {
  const s = L[lang];
  const scale = conformityScale(standard, lang);
  const sum = reportSummary(tot, scale);
  const { rate } = sum;
  const leveled = scale.length > 0 && (rate.applicable === 0 || sum.level !== undefined);

  let headline: readonly [string, string];
  if (leveled && rate.applicable === 0) headline = [s.levelNone(std), `— ${s.levelNoneNote}`];
  else if (leveled) {
    const head = s.levelHead(std, sum.level!.label);
    headline = rate.open > 0 ? [head, `(${s.levelProvisional}) — ${s.levelProvisionalNote(rate.open)}`] : [head, `— ${s.levelSettled}`];
  } else {
    const [state, note] = tot.nc > 0 ? s.verdictFailed(tot.nc) : rate.open > 0 ? s.verdictOpen(rate.open) : s.verdictMet;
    headline = [s.verdictHead(std, state), `— ${note}`];
  }

  const facts: SummaryModel["facts"] = [];
  if (!isCore(standard) && rate.applicable > 0) {
    const range = rate.open > 0 ? ` ; ${s.rangeValue(sum.ceilingPct, leveled ? sum.best?.label : undefined)}` : "";
    facts.push({ label: s.rateLabel, value: `${s.rateValue(rate.pct, rate.validated, rate.applicable)}${range}` });
  }
  facts.push({ label: s.tallyLabel(rate.total), value: s.tallyValue(rate.validated, tot.nc, rate.na, rate.open) });
  if (leveled) facts.push({ label: s.scaleLabel, value: scaleText(scale, lang) });

  const withPages = resolver !== undefined && resolver.pages.length > 0;
  const rows = ncUnits.map((u) => {
    const m = auditorUnitModel(u, standard, lang);
    // One fix per row: a criterion failed by five different rules would otherwise turn one row
    // of the summary into a paragraph. The count says there are more; §2 carries all of them.
    const fixes = readerFixes(m.normative, lang);
    const fix = (fixes[0] ?? "") + (fixes.length > 1 ? ` ${s.moreFixes(fixes.length - 1)}` : "");
    if (!withPages) return { icon: m.icon, priority: s.sev[u.severity], criterion: u.label, occurrences: m.occurrences, fix };
    const found = occurrencesByPage(m.normative, resolver);
    const total = resolver.pages.length;
    // « Every page » is a finding in itself: the defect lives in something all pages share, and is
    // fixed once. Below four pages, naming them is as short as saying so.
    const all = found.pages.length > SUMMARY_PAGES_MAX && found.pages.length === total ? total : undefined;
    const listed = all ? [] : found.pages.slice(0, SUMMARY_PAGES_MAX).map(({ page }) => ({ name: page.name, url: page.url }));
    const pages: SummaryPages = {
      listed,
      more: all ? 0 : Math.max(0, found.pages.length - SUMMARY_PAGES_MAX),
      ...(all ? { all } : {}),
      orphans: found.orphans,
      approximate: found.approximate && !all,
    };
    return { icon: m.icon, priority: s.sev[u.severity], criterion: u.label, occurrences: m.occurrences, pages, fix };
  });
  const pagesNote = !ncUnits.length ? undefined : !withPages ? s.noPagesNote : rows.some((r) => r.pages?.approximate) ? s.approximateNote : undefined;

  const steps: Step[] = [];
  if (leveled && rate.applicable > 0) {
    if (sum.afterFix) {
      const reached = sum.afterFix.level && sum.afterFix.level.min !== sum.level?.min ? sum.afterFix.level.label : undefined;
      steps.push(s.stepFix(tot.nc, sum.afterFix.pct, sum.afterFix.validated, rate.applicable, rate.open > 0, reached));
    }
    // A target fixing alone reaches is already named by the step above; only a target that needs
    // more than the non-conformities earns its own line.
    if (sum.next && sum.next.fromOpen > 0) {
      const n = sum.next;
      steps.push(s.stepTarget(n.level.label, n.level.min, n.need, rate.applicable, n.missing, n.fromNc, n.fromOpen));
    }
    if (rate.open > 0) steps.push(s.stepOpen(rate.open));
    if (!steps.length) steps.push(s.stepTop);
  } else {
    if (tot.nc > 0) steps.push(s.stepFixCore(tot.nc));
    if (rate.open > 0) steps.push(s.stepOpenCore(rate.open));
  }

  return {
    title: s.summaryTitle,
    headline,
    facts,
    fix: {
      title: s.fixTitle,
      ...(ncUnits.length ? { intro: s.fixIntro(ncUnits.length) } : { none: s.fixNone }),
      columns: s.fixCols,
      ...(withPages ? { pagesColumn: s.pagesCol } : {}),
      rows,
      ...(pagesNote ? { pagesNote } : {}),
      ...(advisories ? { advisory: s.fixAdvisory(advisories) } : {}),
    },
    ...(steps.length ? { next: { title: leveled && sum.next ? s.nextTitle : s.nextTitleCore, steps } } : {}),
  };
}

/** The words of a « Pages » cell, before any markup: the listed pages, then what they leave out.
 *  `link` decides how a page is written — a Markdown link, or its bare name. */
export function summaryPagesText(p: SummaryPages | undefined, lang: Lang, link: (name: string, url: string) => string): string {
  const s = L[lang];
  if (!p) return "—";
  const parts: string[] = [];
  if (p.all) parts.push(s.allPages(p.all));
  else if (p.listed.length) parts.push(p.listed.map((x) => link(x.name, x.url)).join(", ") + (p.more ? ` ${s.morePages(p.more)}` : ""));
  if (p.orphans) parts.push(s.offPage(p.orphans));
  if (!parts.length) return "—";
  return parts.join(" · ") + (p.approximate ? ` ${s.atLeast}` : "");
}

function pagesCell(p: SummaryPages | undefined, lang: Lang): string {
  // The links are built on escaped names; only the pipe still needs escaping inside a cell.
  return summaryPagesText(p, lang, (name, url) => mdLink(mdText(name), url)).replace(/\|/g, "\\|");
}

/** The summary as report Markdown. No line takes a gated shape — no header rate, no
 *  `**label** : <id>` line, no checkbox — so no gate can read it as a second claim. */
function renderSummary(m: SummaryModel, lang: Lang): string[] {
  const s = L[lang];
  const out: string[] = [`## ${m.title}`, "", `**${m.headline[0]}** ${m.headline[1]}`, ""];
  for (const f of m.facts) out.push(`- **${f.label}** : ${f.value}`);
  out.push("", `### ${m.fix.title}`, "");
  if (m.fix.none) out.push(m.fix.none, "");
  else {
    out.push(`${m.fix.intro} ${s.fixDetail}`, "");
    const [priority, criterion, occurrences, fix] = m.fix.columns;
    if (m.fix.pagesColumn) {
      out.push(`| ${priority} | ${criterion} | ${occurrences} | ${m.fix.pagesColumn} | ${fix} |`, "| --- | --- | :---: | --- | --- |");
      for (const r of m.fix.rows)
        out.push(`| ${r.icon} ${r.priority} | ${cell(r.criterion)} | ${r.occurrences} | ${pagesCell(r.pages, lang)} | ${cell(r.fix)} |`);
    } else {
      out.push(`| ${priority} | ${criterion} | ${occurrences} | ${fix} |`, "| --- | --- | :---: | --- |");
      for (const r of m.fix.rows) out.push(`| ${r.icon} ${r.priority} | ${cell(r.criterion)} | ${r.occurrences} | ${cell(r.fix)} |`);
    }
    out.push("");
  }
  if (m.fix.pagesNote) out.push(`> ${m.fix.pagesNote}`, "");
  if (m.fix.advisory) out.push(`_${m.fix.advisory}_`, "");
  if (m.next) {
    out.push(`### ${m.next.title}`, "");
    m.next.steps.forEach(([what, rest], i) => out.push(`${i + 1}. **${what}**${rest}`));
    out.push("");
  }
  return out;
}

/** One `##` section of a rendered report, kept WHOLE.
 *
 *  `lines` is exactly what was rendered — heading included — so a consumer that keeps a
 *  section shows the artifact's own words rather than a re-rendering that could disagree with
 *  the document a reader opens next. */
export interface ReportSection {
  heading: string;
  lines: string[];
  get text(): string;
}

/** Split a rendered report into its preamble and its `##` sections.
 *
 *  For any surface with a byte budget. Cutting a rendered document at an OFFSET lands mid-table
 *  (GFM renders the rest as prose) or inside an unterminated fence, where everything after it is
 *  swallowed into code — so a comment that must fit drops whole sections instead, and says which.
 *
 *  Fence-aware on purpose: a report embeds the audited source as evidence, and audited source is
 *  allowed to contain a line starting with `## `. Treating one as a boundary would split a
 *  document in the middle of the proof for a non-conformity. */
export function splitReportSections(md: string): { preamble: string[]; sections: ReportSection[] } {
  const lines = md.split("\n");
  const preamble: string[] = [];
  const sections: ReportSection[] = [];
  let current: string[] | null = null;
  let fence: string | null = null;
  const push = (l: string): void => {
    if (current) current.push(l);
    else preamble.push(l);
  };
  for (const line of lines) {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      const mark = f[1]!;
      if (fence === null) fence = mark[0]!.repeat(mark.length);
      else if (mark.startsWith(fence[0]!) && mark.length >= fence.length) fence = null;
      push(line);
      continue;
    }
    if (fence === null && line.startsWith("## ")) {
      current = [line];
      const own = current;
      sections.push({
        heading: line,
        lines: own,
        get text() {
          return own.join("\n");
        },
      });
      continue;
    }
    push(line);
  }
  return { preamble, sections };
}

/** The per-page rate table, as its own report section. Shares every helper with the per-page
 *  dossier's index (src/pages-report.ts), so the number here and the number there are the same
 *  computation and not two that happen to agree today. */
function renderPageRates(r: AuditResult, pages: PageResult[], standard: StandardId, lang: Lang): string[] {
  if (!pages.length) return [];
  const s = L[lang];
  const out: string[] = [`## 📋 ${s.pageRatesTitle}`, "", `> ${s.pageRatesNote}`, ""];
  out.push(`| ${s.pageCol} | ${s.urlCol} | ${s.basisCol} | ${s.rateCol} |`);
  out.push("| --- | --- | --- | --- |");
  for (const p of pages) {
    const rows = pageCriterionRows(r, p, standard, lang);
    const cov = pageCoverage(rows);
    out.push(`| ${p.name}${p.auth ? " 🔒" : ""} | \`${p.url}\` | ${basisLabel(p.basis, lang)} | ${formatRate(pageRatePct(rows), cov.decided, cov.total)} |`);
  }
  out.push("");
  return out;
}

/** What both documents are rendered from — computed once, so the report and its annex cannot
 *  disagree about a unit, a page or a rate. */
interface RenderOpts {
  std: string;
  groupHead: string;
  groups: ReportGroup[];
  standard: StandardId;
  derivedOf?: string;
  partialAudit?: string[];
  headerRatePct?: number;
  /** The country standard's OWN conformity rate, which leads the header when a pack report
   *  supplies it. Absent for the core WCAG report, which is a different document for a
   *  different reader and keeps its automatic rate as the headline. */
  conformance?: { rate: ConformanceRate; provenance: { engine: number; scan: number; agent: number }; autoDecided: number; autoValidated: number };
  // Where this report will be WRITTEN. Only used to resolve the per-page screenshots
  // relatively; absent ⇒ paths relative to the CWD, which is what stdout wants.
  outDir?: string;
  // The annotated crop for an occurrence, when the evidence tier drew one. Absent ⇒ every
  // byte below is what it was before the tier existed (tests/__snapshots__/auditor).
  cropFor?: AuditorCropLookup;
}

/** The two files one `report` run writes: the report a reader opens, and its technical annex. */
export interface ReportDocuments {
  /** `<standard>-<date>.md` — for every reader: level, what to fix, on which pages. */
  report: string;
  /** Its annex — code locations, method, commands, the exhaustive grid. */
  annex: string;
  reportFile: string;
  annexFile: string;
}

/** `wcag-2026-09-17.md` / `rgaa-2026-09-17.md` — the name every script already globs. */
export function reportFileName(standard: StandardId, date: string): string {
  return `${isCore(standard) ? "wcag" : standard}-${date}.md`;
}

/** The annex's name. Deliberately NOT `<standard>-*.md`: scripts glob `audits/rgaa-*.md` for THE
 *  report, and a second match would hand them the annex as well. */
export function annexFileName(standard: StandardId, date: string, lang: Lang): string {
  return `${lang === "fr" ? "annexe-technique" : "technical-annex"}-${isCore(standard) ? "wcag" : standard}-${date}.md`;
}

/** The first line of an annex. Lets `withReportAnnexes` recognise a document that already carries
 *  its annex — `renderReport`'s joined output saved as one file — instead of looking for a file
 *  that has no reason to exist. */
function annexMarker(file: string): string {
  return `<!-- ultra11y:annex ${file} -->`;
}

/** An annex link, as the report writes it: a bare file name beside the report, nothing else. */
const ANNEX_LINK = /\]\(<?((?:annexe-technique|technical-annex)-[A-Za-z0-9._-]+\.md)>?\)/g;

/** The gated document: the report, then its annex — exactly what `check` and `verify` read off
 *  disk (`withReportAnnexes`). The gates need both halves: the §1–5 structure and the headline
 *  rate are in the report, the occurrence checklist every non-conformity is verified against and
 *  the grid the automatic rate is checked against are in the annex. */
export function joinReportDocuments(report: string, annex: string): string {
  return `${report.trimEnd()}\n\n${annex}`;
}

/** Append the annexes a report on disk links to, so a gate reads the whole deliverable.
 *
 *  FAILS CLOSED. A report whose annex is missing has lost the evidence its non-conformities are
 *  verified against: returning the report alone would give `verify` an empty worklist and let
 *  `check` pass a document nobody can audit. Only bare `annexe-technique-*.md` /
 *  `technical-annex-*.md` names beside the report are followed — never a path. */
export function withReportAnnexes(md: string, reportPath: string, read: (path: string) => string): string {
  const names = [...new Set([...md.matchAll(ANNEX_LINK)].map((m) => m[1]!))];
  let out = md;
  for (const name of names) {
    if (md.includes(annexMarker(name))) continue; // already joined
    const path = join(dirname(reportPath), name);
    let annex: string;
    try {
      annex = read(path);
    } catch {
      throw new Error(`technical annex not found: ${path} (linked from ${reportPath}) — re-run \`ultra11y report\`, which writes both files.`);
    }
    out = joinReportDocuments(out, annex);
  }
  return out;
}

/** The business partial-audit banner: the same criteria as `partialAuditBanner`, without the
 *  commands — those are in the annex, next to the rest of the procedure. */
function partialAuditBusiness(lang: Lang, untested: string[]): string {
  const set = new Set(untested);
  return L[lang].partialAuditBusiness(
    NEEDS_RENDERING.filter((c) => set.has(c.sc))
      .map((c) => c.label[lang])
      .join(", "),
  );
}

/** A page address a reader can click, or read when it cannot be a link. */
function urlText(url: string): string {
  return isLinkableUrl(url) ? `<${url.replace(/</g, "%3C").replace(/>/g, "%3E")}>` : `\`${url}\``;
}

/** One non-conformity for the report's reader: what is wrong, where (pages and their URLs), and
 *  what to do. The criterion line keeps the `**<criterion>** : <id> — <title>` grammar `check`
 *  projects the NC set from; the file:line checklist `verify` works on is in the annex. */
function renderReaderUnit(u: PrdUnit, standard: StandardId, lang: Lang, resolver: PageResolver, cropFor?: AuditorCropLookup): string[] {
  const s = L[lang];
  const m = auditorUnitModel(u, standard, lang);
  const out: string[] = [`#### ${m.icon} ${m.label}`, "", `**${m.criterion.label}** : ${m.criterion.value}`, ""];
  out.push(`**${s.problem}** : ${readerMessages(m.normative, lang).map(mdText).join(" ; ")} (${s.occShort(m.occurrences)})`, "");
  // One picture of the defect, when the evidence tier drew one: it says more to this reader than
  // any selector. Every other crop hangs off its occurrence in the annex.
  const example = cropFor ? m.normative.map((f) => cropFor(f)).find((c) => c !== undefined) : undefined;
  if (example) out.push(`![${example.alt}](${example.href})`, "");
  if (resolver.pages.length) {
    const { pages, orphans, approximate } = occurrencesByPage(m.normative, resolver);
    const total = resolver.pages.length;
    const lines: string[] = [];
    if (pages.length > 3 && pages.length === total) lines.push(`- ${s.everyPage(total)}`);
    else {
      for (const { page, count } of pages.slice(0, READER_PAGES_MAX)) lines.push(`- ${mdText(page.name)} : ${urlText(page.url)} (${count})`);
      if (pages.length > READER_PAGES_MAX) lines.push(`- ${s.morePagesConcerned(pages.length - READER_PAGES_MAX)}`);
    }
    if (orphans) lines.push(`- ${s.orphanOccurrences(orphans)}`);
    out.push(`**${approximate ? s.pagesConcernedAtLeast : s.pagesConcerned}** :`, "", ...lines, "");
  } else {
    out.push(`**${s.whereCode}** : ${s.inCodeOnly(m.occurrences)}`, "");
  }
  const fixes = readerFixes(m.normative, lang);
  if (fixes.length) out.push(`**${s.expectedFix}** : ${fixes.map(mdText).join(" ; ")}`, "");
  return out;
}

/** What a finding says, in the words a reader of the report can use.
 *
 *  axe-core speaks English and names its rule (« Links must have discernible text (axe:
 *  link-name) »), and every browser-tier finding carries the same stock remediation (« Vérifié
 *  au rendu par axe-core ; corrigez l'élément cité »). Both belong to the annex. The report
 *  prefers the engine's own French wording of the same defect when the criterion has one, and
 *  falls back to the axe message, stripped of its rule id, when it does not — a criterion is
 *  never left without its problem stated. */
function readerMessages(findings: Finding[], lang: Lang): string[] {
  const own = findings.filter((f) => !f.ruleId.startsWith("axe:"));
  const from = own.length ? own : findings;
  return [...new Set(from.map((f) => resolveMessage(f, lang).replace(/\s*\(axe: [^)]*\)\s*$/, "")))].filter(Boolean);
}

const STOCK_REMEDIATION = new Set(["dyn-remediation", "dyn-reflow"]);

function readerFixes(findings: Finding[], lang: Lang): string[] {
  const specific = findings.filter((f) => !STOCK_REMEDIATION.has(f.msg?.id ?? ""));
  const fixes = [...new Set(specific.map((f) => resolveRemediation(f, lang)))].filter(Boolean);
  return fixes.length ? fixes : findings.length ? [L[lang].fixGeneric] : [];
}

/** The criteria ONE page fails, in the active standard's terms, with the occurrences behind each.
 *  Statuses come from `pageCriterionRows` — the per-page grid's own projection — so this list and
 *  the grid cannot disagree. */
function pageFailingCriteria(r: AuditResult, page: PageResult, standard: StandardId, lang: Lang): { label: string; count: number }[] {
  const normative = (fs: Finding[]) => fs.filter((f) => !f.advisory).length;
  if (isCore(standard)) {
    return pageCriterionRows(r, page, standard, lang)
      .filter((row) => row.status === "NC")
      .map((row) => ({
        label: `${row.id} — ${scTitle(row.id, lang) ?? ""}`.trim(),
        count: normative(page.criteria.find((c) => c.id === row.id)?.findings ?? []),
      }));
  }
  const pack = loadPack(standard);
  const byId = new Map(derivePackResults(pageView(r, page), standard, page.id).map((x) => [x.id, x]));
  return pageCriterionRows(r, page, standard, lang)
    .filter((row) => row.status === "NC")
    .map((row) => ({ label: `${pack.name} ${row.label}`, count: normative(byId.get(row.id)?.findings ?? []) }));
}

/** How many pages a reader block lists by URL before counting the rest. */
const READER_PAGES_MAX = 10;

/** One recommendation, in one line, located by page rather than by file. */
function renderReaderAdvisory(u: PrdUnit, lang: Lang, resolver: PageResolver): string {
  const s = L[lang];
  const messages = readerMessages(u.findings, lang);
  const fixes = readerFixes(u.findings, lang);
  let where = s.occShort(u.findings.length);
  if (resolver.pages.length) {
    const { pages } = occurrencesByPage(u.findings, resolver);
    if (pages.length) {
      const shown = pages.slice(0, 3).map(({ page }) => mdLink(mdText(page.name), page.url));
      where += ` : ${shown.join(", ")}${pages.length > 3 ? ` ${s.morePages(pages.length - 3)}` : ""}`;
    }
  }
  const suggestion = fixes.length ? ` — _${s.suggestion}_ : ${fixes.map(mdText).join(" ; ")}` : "";
  return `- 💡 **${u.label}** — ${messages.map(mdText).join(" ; ")} (${where})${suggestion}`;
}

// Shared renderer over normalized groups/rows — keeps the WCAG and pack reports identical
// in shape. `groupHead` labels the synthesis column ("WCAG guideline" / "theme"). `standard`
// drives the NC section below (`prdUnits`/`renderAuditorUnit` are standard-aware).
//
// TWO DOCUMENTS, ONE DERIVATION. The report is written for a reader who decides and plans — a
// product owner, a project lead, an accessibility referent: where the site stands, what to fix,
// on which pages, at which URL. Everything that serves the person DOING the fix or checking the
// audit — `file:line`, selectors, the tool's method, its automatic rate, its commands, the S/R/J
// contract — is in the annex. Both come out of the same units, pages and tallies, computed once
// here.
function render(r: AuditResult, lang: Lang, opts: RenderOpts): ReportDocuments {
  const s = L[lang];
  const reportFile = reportFileName(opts.standard, r.date);
  const annexFile = annexFileName(opts.standard, r.date, lang);
  const rows = opts.groups.flatMap((g) => g.rows);
  const tot = reportTotals(opts.groups);
  // Attribute the findings to their pages FIRST — the summary and §2 say where each defect is,
  // and both page sections join on `Finding.page`. A finding merged from a dynamic scan carries
  // only the scanned URL in `file` until `attributePages` resolves it. `audit` and `scan` already
  // do this when they write the JSON, but a report rendered from an audit produced any other way
  // (a sample-only merge, a hand-assembled result) would otherwise show every page as empty —
  // which reads as "clean", the one thing this tool must never say by accident. The resolver's
  // attribution is an idempotent enrichment: it only fills `page` where something establishes it.
  const resolver = pageResolver(r);
  const pageScope = resolver.pages;
  // `prdUnits` once: the summary table, §2 and the annex list the same units, in the same order.
  const { nc: ncUnits, advisory: advisoryUnits } = partitionUnits(prdUnits(r, opts.standard, lang));
  // WHAT THIS RUN DID, read off the run rather than off the engine's capabilities.
  const pagesRead = r.scope.pagesAudited?.length ?? 0;

  // ================================ THE REPORT ================================
  const out: string[] = [];
  out.push(`# ${s.title(opts.std)}`, "");
  out.push(`- **${s.date}** : ${r.date}`);
  if (pageScope.length) {
    const names = pageScope.slice(0, 8).map((p) => mdText(p.name));
    out.push(
      `- **${s.pagesAudited}** : ${pageScope.length} — ${names.join(", ")}${pageScope.length > 8 ? ` ${s.morePagesAudited(pageScope.length - 8)}` : ""}`,
    );
  } else {
    out.push(`- **${s.scope}** : ${s.sourceOnlyScope(r.scope.files)}`);
  }
  // THE HEADLINE, AND THE ORDER IT IS READ IN.
  //
  // The automatic rate led this header, and on egapro it published « 17 % » — arithmetically
  // right, and taken away by every reader of a document whose own table reads 91 C / 10 NC. So a
  // pack report leads with the standard's own formula, names it and publishes both operands; the
  // automatic rate, with its numerator and denominator, is in the annex, where it is read for
  // what it is — a measure of what the engine settled alone.
  if (opts.conformance) {
    const { rate } = opts.conformance;
    const title = `${s.conformanceRate(opts.std)}${rate.open > 0 ? ` (${s.conformanceProvisional})` : ""}`;
    // NO APPLICABLE CRITERION IS NOT A HUNDRED PER CENT. « 100 % — validés ÷ applicables (0 ÷ 0) »
    // printed at the top of a conformance deliverable is a claim nobody made.
    out.push(
      rate.applicable === 0
        ? `- **${title}** : ${s.conformanceNone(rate.na)}`
        : `- **${title}** : ${rate.pct}% — ${s.conformanceShort(rate.validated, rate.applicable)}`,
    );
  } else {
    out.push(`- **${s.rate}** : ${opts.headerRatePct ?? r.conformancePct}% (${s.rateNote})`);
  }
  out.push("");
  // The caveats that change what a reader may conclude stay in sight — worded for that reader.
  if (opts.partialAudit?.length) out.push(`> 🚨 ${partialAuditBusiness(lang, opts.partialAudit)}`, "");
  if (r.scope.truncated || r.scope.captureCoverage?.blindSpots.length) out.push(`> ⚠️ ${s.scopeCaveat}`, "");
  out.push(`> ${s.annexPointer(annexFile)}`, "");

  out.push(...renderSummary(summaryModel(lang, opts.std, opts.standard, tot, ncUnits, advisoryUnits.length, resolver), lang));

  // 1. synthesis
  const th = s.th(opts.groupHead);
  out.push(`## ${s.synthTitle(opts.groupHead)}`, "");
  out.push(`| ${th.join(" | ")} |`);
  out.push(`|${"---|".repeat(th.length)}`);
  for (const g of opts.groups) {
    const t = tallyRows(g.rows);
    out.push(`| ${g.key} ${g.title} | ${t.c} | ${t.nc} | ${t.na} | ${t.manual} |`);
  }
  out.push(`| **${s.total}** | **${tot.c}** | **${tot.nc}** | **${tot.na}** | **${tot.manual}** |`, "");
  // SAY THAT NA IS A SUBSET OF C: anyone adding the four columns would otherwise overshoot the
  // criterion count and conclude the grid is wrong.
  out.push(`> ${s.naSubset(tot.c + tot.nc + tot.manual)}`, "");

  // 2. non-conformities by priority — the reader's block: problem, pages, fix. Built from the
  // SAME units `prd`/GitHub issues use, so a criterion here is exactly a backlog item.
  out.push(`## ${s.ncTitle}`, "");
  if (ncUnits.length === 0) {
    out.push(s.none, "");
  } else {
    out.push(`> ${s.ncIntro}`, "");
    for (const sev of SEV_ORDER) {
      const group = ncUnits.filter((u) => u.severity === sev);
      if (!group.length) continue;
      out.push(`### ${ICON[sev]} ${s.sev[sev]} (${group.length})`, "");
      for (const u of group) out.push(...renderReaderUnit(u, opts.standard, lang, resolver, opts.cropFor));
    }
  }

  // Recommendations (non-normative) — UNNUMBERED, outside §2, one line each: they change no level.
  if (advisoryUnits.length) {
    out.push(`## 💡 ${s.recTitle}`, "", `> ${s.recNote}`, "");
    for (const u of advisoryUnits) out.push(renderReaderAdvisory(u, lang, resolver));
    out.push("");
  }

  // « Taux par page » — each audited page, its URL and its rate with the denominator. Drawn from
  // `pageCriterionRows`/`pageRatePct`, the per-page dossier's own helpers.
  const derivedPages = pageScope.length ? derivePages(r, pageScope) : [];
  if (derivedPages.length) {
    out.push(`## 📋 ${s.pageRatesTitle}`, "", `> ${s.pageRatesNoteBusiness}`, "");
    out.push(`| ${s.pageCol} | ${s.urlCol} | ${s.rateCol} |`, "| --- | --- | --- |");
    for (const p of derivedPages) {
      const criteria = pageCriterionRows(r, p, opts.standard, lang);
      const cov = pageCoverage(criteria);
      out.push(`| ${mdText(p.name)}${p.auth ? " 🔒" : ""} | ${urlText(p.url)} | ${formatRate(pageRatePct(criteria), cov.decided, cov.total)} |`);
    }
    out.push("");
  }
  if (pageScope.length) {
    // The matrix is one row per criterion times one column per page: folded under its heading.
    const grid = renderPageGrid(r, pageScope, opts.standard, lang);
    const cut = grid.indexOf("\n");
    const body = grid.slice(cut + 1).split("\n");
    if (grid.includes("\n| ")) out.push(grid.slice(0, cut), "", ...folded(s.showCriteria(rows.length), body));
    else out.push(grid);
  }

  // « Constats par page » — each page folds: its screenshot and what fails on it, by criterion.
  // The selectors that used to sit on these lines are in the annex.
  if (derivedPages.length) {
    out.push(`## 📄 ${s.perPageTitle}`, "", `> ${s.perPageNote}`, "");
    if (r.scope.sample?.transverse?.length) out.push(`> ${s.transverseNote(r.scope.sample.transverse.join(", "))}`, "");
    // Pages the scan refused to record: a silently shorter deliverable reads as a complete one.
    if (r.scope.redirected?.length) out.push(...renderRedirected(r.scope.redirected, lang), "");
    for (const pg of derivedPages) {
      const adv = pg.findings.filter((f) => f.advisory);
      out.push("<details>", `<summary>${pg.name} — <code>${pg.url}</code> — ${pg.auth ? s.authYes : s.authNo}</summary>`, "");
      // THE PAGE'S OWN VERDICTS, not its raw findings: the criteria the per-page grid rules
      // non-conforming here, each with how many occurrences back it. Raw findings listed an
      // English axe message beside the engine's French one for the same defect, and cited WCAG
      // success criteria inside an RGAA deliverable whenever a finding projected onto none.
      const failing = pageFailingCriteria(r, pg, opts.standard, lang);
      out.push(`- ${s.pageNcCriteria(failing.length)}${adv.length ? ` · ${adv.length} ${s.advCount}` : ""}`);
      const notes = pageScope.find((x) => x.id === pg.id)?.notes;
      if (notes) out.push(`- _${notes}_`);
      // The screenshot the snapshot already holds, copied next to the report so the directory
      // travels intact — CI uploads `audits/` alone.
      const shot = join(PAGES_DIR, pg.id, "screen.png");
      if (existsSync(shot)) {
        let href = relative(opts.outDir ?? ".", shot)
          .split("\\")
          .join("/");
        if (opts.outDir) {
          try {
            mkdirSync(join(opts.outDir, "assets"), { recursive: true });
            copyFileSync(shot, join(opts.outDir, "assets", `${pg.id}.png`));
            href = `./assets/${pg.id}.png`;
          } catch {
            // Unwritable output dir: keep the relative reference rather than lose the image.
          }
        }
        out.push("", `![${s.screenshotAlt(pg.name)}](${href})`, "");
      }
      for (const { label, count } of failing.slice(0, PER_PAGE_MAX)) out.push(`- ${label} (${s.occShort(count)})`);
      // A cap that says nothing reads as a complete list.
      if (failing.length > PER_PAGE_MAX) out.push(`- _${s.perPageMore(failing.length - PER_PAGE_MAX, failing.length)}_`);
      out.push("", "</details>", "");
    }
  }

  // 3. conforming — split by PROVENANCE. A criterion the deterministic engine decided and one an
  // agent ruled on are both "C", but they are not the same claim. Both lists fold.
  out.push(`## ${s.cTitle}`, "");
  const conform = rows.filter((x) => x.status === "C" && !x.inapplicable);
  const byEngine = conform.filter((x) => x.decidedBy !== "agent");
  const byAgent = conform.filter((x) => x.decidedBy === "agent");
  if (!conform.length) out.push(s.nothing, "");
  else {
    if (byEngine.length)
      out.push(
        ...folded(
          s.showCriteria(byEngine.length),
          byEngine.map((x) => `- ${x.label}`),
        ),
      );
    if (byAgent.length) {
      out.push(`### ${s.cAgentTitle}`, "", `> ${s.cAgentNote}`, "");
      out.push(
        ...folded(
          s.showCriteria(byAgent.length),
          byAgent.map((x) => `- ${x.label}${x.justification ? ` — _${x.justification}_` : ""}`),
        ),
      );
    }
  }

  // 4. conforming for want of a subject — each with what was looked for, so the claim stays
  // falsifiable rather than merely asserted.
  out.push(`## ${s.naTitle}`, "");
  const na = rows.filter((x) => x.inapplicable);
  if (!na.length) out.push(s.nothing, "");
  else {
    out.push(`> ${s.naNote}`, "");
    out.push(
      ...folded(
        s.showCriteria(na.length),
        na.map((x) => `- ${x.label}${x.justification ? ` — _${x.justification}_` : ""}`),
      ),
    );
  }

  // 5. what is still open — what it means for the reader; the procedure is in the annex.
  out.push(`## ${s.manualTitle}`, "");
  const manual = rows.filter((x) => x.status === "manual");
  const pack5 = isCore(opts.standard) ? undefined : loadPack(opts.standard);
  const exhaustiveContract = pack5?.criteria.every((criterion) => criterion.automation !== undefined) === true;
  if (!manual.length) out.push(s.nothing, "");
  else {
    out.push(s.manualBusiness(manual.length), "");
    // A test-level pack's grid (annex, section E) already names every open criterion; repeating
    // ninety titles here doubled the report. The core has no such contract, so it lists them.
    if (!exhaustiveContract)
      out.push(
        ...folded(
          s.showCriteria(manual.length),
          manual.map((x) => `- ${x.label}`),
        ),
      );
  }

  // ================================ THE ANNEX ================================
  const ax: string[] = [annexMarker(annexFile), `# ${s.annexDocTitle(opts.std, r.date)}`, "", `> ${s.annexBack(reportFile)}`, ""];
  // ONE SOURCE FOR ONE FACT: a pack's adjudication count is its provenance, never the core grid's.
  const adjudicated = opts.conformance ? opts.conformance.provenance.agent : r.criteria.filter((c) => c.decidedBy === "agent").length;
  ax.push(`- **${s.tool}** : ultra11y v${r.version} (${pagesRead > 0 ? s.toolNoteRendered(pagesRead, adjudicated) : s.toolNote})`);
  ax.push(`- **${s.scope}** : ${r.scope.files} ${s.files} — ${r.scope.inputs.join(", ")}`);
  if (opts.conformance) {
    const { rate, provenance, autoDecided, autoValidated } = opts.conformance;
    if (rate.applicable > 0) {
      const notes = [s.conformanceNa(rate.na)];
      if (rate.open > 0) notes.push(s.conformanceOpen(rate.open));
      ax.push(`- **${s.denominatorLine}** : ${notes.join(" ; ")}`);
    }
    ax.push(
      `- **${s.decidedLine}** : ${rate.decided}/${rate.total} — ${s.decidedNote(rate.validated, rate.total - rate.validated - rate.na - rate.open, rate.na, rate.open)}`,
    );
    ax.push(`- **${s.provenance}** : ${s.provenanceNote(provenance.engine, provenance.scan, provenance.agent)}`);
    // Checked by `check` like every header rate: its operands must be a pair the grid licenses.
    ax.push(`- **${s.rate}** : ${opts.headerRatePct ?? r.conformancePct}% — ${s.autoRateNote(autoValidated, autoDecided)}`);
  }
  ax.push(`- **${s.renderedPages(pagesRead)}**${pagesRead === 0 ? ` — ${s.noRenderedPages}` : ""}`);
  const automation = automationOverview(opts.standard);
  if (automation) {
    ax.push(
      `- **${s.automationContract}** : ${s.automationCounts(
        automation.tests.static,
        automation.criteria.static.length,
        automation.tests.rendered,
        automation.criteria.rendered.length,
        automation.tests.judgment,
        automation.criteria.judgment.length,
      )}`,
      `- **${s.staticCriteria}** : ${automation.criteria.static.map((id) => `\`${id}\``).join(" · ") || "—"}`,
      `- **${s.renderedCriteria}** : ${automation.criteria.rendered.map((id) => `\`${id}\``).join(" · ") || "—"}`,
    );
  }
  if (r.scope.dedup) ax.push(`- **${s.dedup}** : ${r.scope.dedup.canonicalFiles} ${s.canonical}, ${r.scope.dedup.duplicateFiles} ${s.duplicate}`);
  ax.push("");
  ax.push(`> ⚠️ ${s.warn}`, "");
  // Partial-audit advisory (owner decision): names EXACTLY the untested criteria, with the
  // command that tests them. Labels only — no criterion-shaped token, so `check` accepts it.
  if (opts.partialAudit?.length) ax.push(`> 🚨 ${partialAuditBanner(lang, opts.partialAudit)}`, "");
  if (!pageScope.length) ax.push(`> 🧭 ${s.noPagesNoteTech}`, "");
  if (opts.derivedOf) ax.push(`> ↪️ ${s.derived(opts.derivedOf)}`, "");
  if (r.scope.truncated) ax.push(`> ✂️ ${s.truncated(r.scope.truncated.limit, r.scope.truncated.total, r.scope.truncated.skipped)}`, "");
  if (r.scope.rendered) {
    const { files, opaqueLibraries } = r.scope.rendered;
    ax.push(`> 🧩 ${pagesRead > 0 ? s.renderedAudited(files, opaqueLibraries.join(", "), pagesRead) : s.rendered(files, opaqueLibraries.join(", "))}`, "");
  }
  if (r.scope.sourceTemplate) {
    const { files, extensions } = r.scope.sourceTemplate;
    ax.push(`> 🧩 ${pagesRead > 0 ? s.sourceTemplateAudited(files, extensions.join(", "), pagesRead) : s.sourceTemplate(files, extensions.join(", "))}`, "");
  }
  if (r.scope.captures) ax.push(`> ✅ ${s.captures(r.scope.captures.files)}`, "");
  if (r.scope.captureCoverage?.blindSpots.length) ax.push(`> ⚠️ ${s.blindSpots(r.scope.captureCoverage.blindSpots.length)}`, "");

  // A. every non-conformity with its occurrence checklist — the lines `verify` adjudicates.
  ax.push(`## ${s.annexNcTitle}`, "");
  if (ncUnits.length === 0) ax.push(s.none, "");
  else {
    ax.push(`> ${s.ncVerify}`, "");
    for (const sev of SEV_ORDER) {
      const group = ncUnits.filter((u) => u.severity === sev);
      if (!group.length) continue;
      ax.push(`### ${ICON[sev]} ${s.sev[sev]} (${group.length})`, "");
      for (const u of group)
        ax.push(
          ...renderAuditorUnit(u, opts.standard, lang, {
            heading: "####",
            technical: false,
            compact: true,
            ...(pageScope.length ? { pages: resolver } : {}),
            ...(opts.cropFor ? { cropFor: opts.cropFor } : {}),
          }),
        );
    }
  }
  // B. recommendations with their files — never checkbox-shaped, never in the worklist.
  if (advisoryUnits.length) {
    ax.push(`## ${s.annexRecTitle}`, "", `> ${s.recNote}`, "");
    for (const u of advisoryUnits) ax.push(...renderAuditorUnit(u, opts.standard, lang, { compact: true }));
    ax.push("");
  }
  // C. what each page was judged on — a page with no snapshot cannot be conforming by silence —
  // and, page by page, every finding with its selector. Worklist-inert by shape: two-space
  // indent, no checkbox.
  if (derivedPages.length) {
    const table = renderPageRates(r, derivedPages, opts.standard, lang);
    ax.push(`## ${s.annexPagesTitle}`, "", ...table.slice(2));
    // Standard-aware label: a pack deliverable speaks its own criteria, falling back to the WCAG
    // success criterion for a finding no pack criterion claims. `loadPack` once, never per finding.
    const pack = isCore(opts.standard) ? undefined : loadPack(opts.standard);
    for (const pg of derivedPages) {
      const nc = pg.findings.filter((f) => !f.advisory);
      const adv = pg.findings.filter((f) => f.advisory);
      ax.push("<details>", `<summary>${pg.name} — <code>${pg.url}</code> — ${pg.auth ? s.authYes : s.authNo}</summary>`, "");
      ax.push(`- ${nc.length} ${s.ncCount}${adv.length ? ` · ${adv.length} ${s.advCount}` : ""}`);
      for (const f of nc.slice(0, PER_PAGE_MAX)) {
        const crits = pack ? packCriteriaForFinding(pack, f) : [];
        const label = crits.length ? crits.join(", ") : f.criteriaId;
        ax.push(`  - [${label}] \`${f.selectorHint}\` — ${mdText(resolveMessage(f, lang))}`);
      }
      // A cap that says nothing reads as a complete list.
      if (nc.length > PER_PAGE_MAX) ax.push(`  - _${s.perPageMore(nc.length - PER_PAGE_MAX, nc.length)}_`);
      ax.push("", "</details>", "");
    }
  }
  // D. the procedure for the open criteria.
  ax.push(`## ${s.annexManualTitle}`, "");
  if (!manual.length) ax.push(s.nothing, "");
  else {
    if (pack5 && exhaustiveContract) {
      const tests = manual.reduce((count, row) => count + packTestIds(pack5, row.id).length, 0);
      ax.push(s.manualSummary(manual.length, tests), "");
    } else {
      const lines = manual.map((x) => {
        const tests = pack5 ? packTestIds(pack5, x.id) : [];
        const testRef = tests.length ? ` — ${tests.length} ${s.testsToRule}` : "";
        return `- ${x.label}${x.justification ? ` — _${x.justification}_` : ""}${testRef}`;
      });
      ax.push(...folded(s.showCriteria(manual.length), lines));
    }
    ax.push(`> ${s.manualWarn} ${s.manualHowTo}`, "");
  }
  // E. the index a criterion is looked up in.
  ax.push(...exhaustiveGrid(opts.groups, opts.standard, lang, s.annexGridTitle));

  return { report: out.join("\n"), annex: ax.join("\n"), reportFile, annexFile };
}

/** The canonical, gated WCAG 2.2 AA report — both documents. */
export function renderReportDocuments(r: AuditResult, lang: Lang = "en", outDir?: string, cropFor?: AuditorCropLookup): ReportDocuments {
  const s = L[lang];
  return render(r, lang, { std: s.wcagStd, groupHead: s.byGuideline, groups: reportGroups(r, lang), standard: CORE, outDir, ...(cropFor ? { cropFor } : {}) });
}

/** The CORE report's criterion rows, grouped by WCAG guideline. Extracted from `renderReport`
 *  so the HTML renderer and the CI digest project the SAME decisions the Markdown report
 *  projects — they consume the model, never a second derivation of it. */
export function reportGroups(r: AuditResult, lang: Lang = "en"): ReportGroup[] {
  const byGuideline = new Map<string, ReportRow[]>();
  for (const c of r.criteria) {
    const title = scTitle(c.id, lang);
    const row: ReportRow = {
      id: c.id,
      label: title ? `${c.id} — ${title}` : c.id,
      status: c.status,
      findings: c.findings,
      justification: c.justification,
      decidedBy: c.decidedBy,
      ...(c.inapplicable ? { inapplicable: true } : {}),
    };
    (byGuideline.get(c.guideline) ?? byGuideline.set(c.guideline, []).get(c.guideline)!).push(row);
  }
  // `g.title` on the AuditResult's GuidelineTally is the baked-in English title (kept for
  // JSON back-compat); resolve the localized label from the guideline KEY instead so
  // `--lang fr` renders the French guideline name here too.
  return r.guidelines.map((g) => ({ key: g.key, title: guidelineTitle(g.key, lang) ?? g.title, rows: byGuideline.get(g.key) ?? [] }));
}

/** The gated WCAG document: the report followed by its annex, as `check`/`verify` read them. */
export function renderReport(r: AuditResult, lang: Lang = "en", outDir?: string, cropFor?: AuditorCropLookup): string {
  const docs = renderReportDocuments(r, lang, outDir, cropFor);
  return joinReportDocuments(docs.report, docs.annex);
}

/** A PACK report's criterion rows, grouped by theme. The pack twin of `reportGroups`, and
 *  extracted for the same reason: one projection of a status, consumed by every surface. */
export function packReportGroups(r: AuditResult, pack: StandardPack, lang: Lang = "en"): ReportGroup[] {
  const derived = derivePackResults(r, pack.key);
  const s = L[lang];
  const naReason = lang === "fr" ? "Rien de la nature de ce critère n'est présent dans le périmètre." : "Nothing of this criterion's kind is present in scope.";
  const provisionalNaReason =
    lang === "fr"
      ? "Aucun sujet détecté par le moteur ; l'IA doit confirmer la non-applicabilité de ce critère de jugement."
      : "The engine detected no subject; the AI must confirm that this judgment criterion is not applicable.";
  const byTheme = new Map<number, ReportRow[]>();
  for (const pr of derived) {
    const pc = pack.criteria.find((c) => c.id === pr.id)!;
    const provisionalNa = isProvisionalJudgmentInapplicable(pr, pc);
    const row: ReportRow = {
      id: pr.id,
      // PLAIN, not the official title with its glossary links: `[image porteuse d'information](#…)`
      // points at anchors no report carries, and reads as markup in every grid and list.
      label: `${pack.name} ${pr.id} — ${packTitlePlain(pack, pc, lang)}`,
      status: provisionalNa ? "manual" : pr.status,
      findings: pr.findings,
      ...(pr.decidedBy ? { decidedBy: pr.decidedBy } : {}),
      ...(pr.inapplicable && !provisionalNa ? { inapplicable: true } : {}),
      // outOfScope / scopedOut criteria are "manual" with their own dedicated justification —
      // never mixed with the "nothing of that kind here" reason (see the manual section above).
      ...(provisionalNa
        ? { justification: provisionalNaReason }
        : pr.outOfScope
          ? { justification: s.outOfScope }
          : pr.scopedOut
            ? { justification: s.scopedOut }
            : pr.judgment
              ? { justification: s.judgment }
              : pr.inapplicable
                ? { justification: naReason }
                : {}),
    };
    (byTheme.get(pr.theme) ?? byTheme.set(pr.theme, []).get(pr.theme)!).push(row);
  }
  return pack.themes.map((t) => ({ key: `${t.number}.`, title: themeName(pack, t.number, lang) ?? "", rows: byTheme.get(t.number) ?? [] }));
}

/** A derived report for a country standards pack (RGAA, …) — the gated document: the report
 *  followed by its annex, as `check`/`verify` read them. */
export function renderPackReport(r: AuditResult, pack: StandardPack, lang: Lang = "en", outDir?: string, cropFor?: AuditorCropLookup): string {
  const docs = renderPackReportDocuments(r, pack, lang, outDir, cropFor);
  return joinReportDocuments(docs.report, docs.annex);
}

/** A derived report for a country standards pack (RGAA, …), projected from the WCAG audit — both
 *  documents. */
export function renderPackReportDocuments(
  r: AuditResult,
  pack: StandardPack,
  lang: Lang = "en",
  outDir?: string,
  cropFor?: AuditorCropLookup,
): ReportDocuments {
  const derived = derivePackResults(r, pack.key);
  const std = `${pack.name} ${pack.baseVersion}`;
  // Owner decision: a pack (RGAA) report is flagged PARTIAL while any needs-rendering
  // criterion lacks a dynamic verdict — the banner names exactly which ones (a Docker-only
  // scan covers reflow but not the local probes). The core WCAG report carries its own §5
  // manual worklist and is not flagged here.
  const groups = packReportGroups(r, pack, lang);
  const rows = groups.flatMap((g) => g.rows);
  const tally = reportTotals(groups);
  // The automatic rate's own two operands, computed exactly as `packConformancePct` computes
  // its ratio — one formula, published with its numerator and its denominator so a reader can
  // tell it apart from the conformity rate above it at a glance.
  const autoValidated = derived.filter((d) => d.status === "C" && d.decidedBy !== "agent" && !isProvisionalJudgmentInapplicable(d)).length;
  const autoDecided = autoValidated + derived.filter((d) => d.status === "NC").length;
  return render(r, lang, {
    std,
    groupHead: L[lang].byTheme,
    groups,
    derivedOf: std,
    standard: pack.key,
    partialAudit: untestedNeedsRendering(r, establishedScs(derived)),
    headerRatePct: packConformancePct(derived),
    conformance: { rate: conformanceRate(tally), provenance: decisionProvenance(rows), autoDecided, autoValidated },
    // Forwarded, unlike before: without it the per-page screenshots resolved against the
    // CWD instead of the report's own directory, so a pack report written to `audits/`
    // carried links that only worked when read from the repo root.
    outDir,
    ...(cropFor ? { cropFor } : {}),
  });
}

export interface ReportOpts {
  out: string;
  lang: Lang;
  standard: StandardId;
  /** The evidence tier's crops, when `--evidence` asked for them. The hrefs are relative to
   *  `out`, which is where this report is written — so the Markdown REFERENCES the same files
   *  the composite inlines, instead of the run writing images no document points at. */
  cropFor?: AuditorCropLookup;
}

/** Render and write the report and its technical annex, side by side. The WCAG report is
 *  canonical (`wcag-<date>.md`); a pack report is a derived `<pack>-<date>.md`. */
export function writeReportFiles(r: AuditResult, opts: ReportOpts): { path: string; annexPath: string } {
  const docs = isCore(opts.standard)
    ? renderReportDocuments(r, opts.lang, opts.out, opts.cropFor)
    : renderPackReportDocuments(r, loadPack(opts.standard), opts.lang, opts.out, opts.cropFor);
  mkdirSync(opts.out, { recursive: true });
  const path = join(opts.out, docs.reportFile);
  const annexPath = join(opts.out, docs.annexFile);
  // The annex first: a report is never on disk pointing at an annex that is not.
  writeFileSync(annexPath, docs.annex);
  writeFileSync(path, docs.report);
  return { path, annexPath };
}

/** Render and write both documents; returns the report's path. */
export function writeReport(r: AuditResult, opts: ReportOpts): string {
  return writeReportFiles(r, opts).path;
}
