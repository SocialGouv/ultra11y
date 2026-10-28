// The documentation site (site/*.html, published on GitHub Pages) quotes numbers: how many
// RGAA criteria the engine can prove non-conforming, how many tests are judgment calls, how
// the engine scores on the W3C ACT corpus. Typed by hand, those numbers go stale the day a
// rule lands. So they are COMPUTED here, from the same data the engine ships, and written
// by `pnpm run build:site` into site/data.json and into the marked regions of each page.
// tests/site-data.test.ts fails when the committed site drifts from a fresh generation.
//
// Two kinds of generated content in a page:
//   <span data-gen="act.caught">125</span>       → the text is replaced by the value at that path
//   <!-- gen:grid -->…<!-- /gen:grid -->         → the block is replaced by a rendered fragment
// Everything else in a page is hand-written prose.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ACT_RULES, type ActTestcase, evaluateAct } from "./act.js";
import { CROSS_RULES } from "./rules/cross-registry.js";
import { renderedRules } from "./rules/rendered.js";
import { ALL_RULES } from "./rules/registry.js";
import { allCriteria, themeName, titlePlain } from "./standards/pack.js";
import { loadPack } from "./standards/registry.js";
import { allSC } from "./wcag.js";

/** How far a criterion can be decided without a model, from the pack's rule contracts. */
export type Level = "det" | "nc" | "hint" | "llm";

/** Where a rule's evidence comes from. `pack` = a rule the RGAA pack ships itself. */
export type Source = "static" | "axe" | "probe" | "rendered" | "pack";

export interface SiteCriterion {
  id: string;
  theme: number;
  title: string;
  level: Level;
  /** Sources with at least one NORMATIVE rule (decisive or candidate). Advisory rules never count. */
  sources: Source[];
  /** Sources with at least one decisive rule. */
  decisiveSources: Source[];
  decisive: string[];
  signals: string[];
  advisory: string[];
  tests: number;
}

export interface SiteData {
  version: string;
  /** The oldest Node.js the CLI runs on, from package.json `engines.node` (">=22.18.0" → "22.18"). */
  node: string;
  rgaa: {
    version: string;
    criteria: number;
    themes: { n: number; name: string; count: number }[];
    tests: { total: number; static: number; rendered: number; judgment: number; decidable: number };
    levels: Record<Level, number>;
    /** Criteria where a rule can prove a non-conformity: deterministic + proven NC. */
    provable: number;
    deterministic: string[];
    touched: number;
    /** Criteria where a « conforme » can only come from a judgment (not complete by silence). */
    cNeedsJudgment: number;
  };
  wcag: { criteria: number; static: number; rendering: number; judgment: number };
  engine: { staticRules: number; crossRules: number; renderedRules: number; packRules: number; axeRules: number; probes: number };
  sources: { key: Source; touched: number; decisive: number; signalOnly: number }[];
  act: {
    examples: number;
    rules: number;
    scoredRules: number;
    caught: number;
    failedScored: number;
    recallPct: number;
    clean: number;
    falsePositives: number;
    divergences: number;
    gapRules: number;
    renderedRules: number;
    judgmentRules: number;
    deprecatedRules: number;
    failed: { total: number; caught: number; missed: number; rendered: number; judgment: number; gap: number; deprecated: number; outside: number };
    overallPct: number;
  };
  tests: { fixtures: number };
  criteria: SiteCriterion[];
}

const SOURCE_ORDER: Source[] = ["static", "axe", "probe", "rendered", "pack"];

export const SOURCE_LABEL: Record<Source, { name: string; hint: string }> = {
  static: { name: "Moteur statique", hint: "lit le code source, sans navigateur" },
  axe: { name: "axe-core", hint: "pendant scan, dans un vrai navigateur" },
  probe: { name: "Sondes navigateur", hint: "focus, zoom, espacement, survol" },
  rendered: { name: "Rendu (capture)", hint: "styles calculés, capture d’écran" },
  pack: { name: "Règles spécifiques au RGAA", hint: "écrites pour le RGAA, hors WCAG" },
};

export const LEVEL_LABEL: Record<Level, { name: string; short: string; desc: string; count: string }> = {
  det: { name: "Déterministe", short: "Déterministe", desc: "conforme et non conforme décidés sans IA", count: "déterministes" },
  nc: {
    name: "Non-conformité prouvée",
    short: "NC prouvée",
    desc: "une règle prouve le défaut ; le « conforme » reste un jugement",
    count: "avec non-conformité prouvée",
  },
  hint: { name: "Indices", short: "Indices", desc: "des règles signalent des candidats, l’IA tranche", count: "avec indices" },
  llm: { name: "Jugement seul", short: "Jugement seul", desc: "aucune règle ne fournit de preuve : l’IA ou un humain juge", count: "au jugement seul" },
};

export function sourceOf(ruleId: string): Source {
  if (ruleId.startsWith("pack:")) return "pack";
  if (ruleId.startsWith("axe:")) return "axe";
  if (ruleId.startsWith("dyn-")) return "probe";
  if (ruleId.startsWith("rendered-")) return "rendered";
  return "static";
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const ordered = (xs: Source[]): Source[] => SOURCE_ORDER.filter((s) => xs.includes(s));
const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);

function countFiles(dir: string): number {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    n += statSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

/** Compute every number the site quotes. `root` is the repository root. */
export function buildSiteData(root: string): SiteData {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string; engines?: { node?: string } };
  const nodeMin = /(\d+)\.(\d+)/.exec(pkg.engines?.node ?? "");
  if (!nodeMin) throw new Error("site: package.json has no engines.node minimum");
  const pack = loadPack("rgaa");
  const crits = allCriteria(pack);

  const criteria: SiteCriterion[] = crits.map((c) => {
    const rules = c.automation?.rules ?? [];
    const decisive = rules.filter((r) => r.effect === "decisive-nc").map((r) => r.id);
    const signals = rules.filter((r) => r.effect === "candidate").map((r) => r.id);
    const advisory = rules.filter((r) => r.effect === "advisory").map((r) => r.id);
    // Same routing as the "Reviewed routing" column of references/rgaa-automation.md
    // (scripts/build-pack-rgaa.mjs): advisory rules are not evidence.
    const level: Level = c.automation?.completeBySilence ? "det" : decisive.length ? "nc" : signals.length ? "hint" : "llm";
    return {
      id: c.id,
      theme: c.theme,
      title: titlePlain(pack, c, "fr"),
      level,
      sources: ordered(uniq([...decisive, ...signals].map(sourceOf))),
      decisiveSources: ordered(uniq(decisive.map(sourceOf))),
      decisive,
      signals,
      advisory,
      tests: Object.keys(c.tests ?? {}).length,
    };
  });

  const tiers = crits.flatMap((c) => Object.values(c.automation?.tests ?? {}));
  const tcount = (t: string): number => tiers.filter((x) => x === t).length;
  const levels = { det: 0, nc: 0, hint: 0, llm: 0 } as Record<Level, number>;
  for (const c of criteria) levels[c.level]++;

  const sources = SOURCE_ORDER.map((key) => {
    const touched = criteria.filter((c) => c.sources.includes(key)).length;
    const decisive = criteria.filter((c) => c.decisiveSources.includes(key)).length;
    return { key, touched, decisive, signalOnly: touched - decisive };
  });

  const normative = uniq(criteria.flatMap((c) => [...c.decisive, ...c.signals]));
  const core = allSC().filter((s) => s.level === "A" || s.level === "AA");
  const auto = (a: string): number => core.filter((s) => s.automatability === a).length;

  // ACT: the vendored W3C corpus, scored by the same function as references/act.md.
  const snap = JSON.parse(readFileSync(join(root, "scripts", "vendor", "act-testcases.json"), "utf8")) as { testcases: ActTestcase[] };
  const rs = evaluateAct(snap.testcases, ACT_RULES);
  const scored = rs.filter((r) => r.verdict !== "not-scored");
  const sum = (xs: typeof rs, f: (r: (typeof rs)[number]) => number): number => xs.reduce((n, r) => n + f(r), 0);
  const notScored = rs.filter((r) => r.verdict === "not-scored");
  const byScope = (s: string, gap = false): typeof rs => notScored.filter((r) => r.mapping.scope === s && !!r.mapping.gap === gap);
  const caught = sum(scored, (r) => r.caught);
  const failedScored = sum(scored, (r) => r.failed);
  const failedTotal = sum(rs, (r) => r.failed);
  const failed = {
    total: failedTotal,
    caught,
    missed: failedScored - caught,
    rendered: sum(byScope("rendered"), (r) => r.failed),
    judgment: sum(byScope("judgment"), (r) => r.failed),
    gap: sum(
      notScored.filter((r) => r.mapping.gap),
      (r) => r.failed,
    ),
    deprecated: sum(byScope("deprecated"), (r) => r.failed),
    outside: 0,
  };
  // Anything not accounted for above (a static mapping with no engine rule and no gap flag).
  failed.outside = failedTotal - failed.caught - failed.missed - failed.rendered - failed.judgment - failed.gap - failed.deprecated;

  return {
    version: pkg.version,
    node: `${nodeMin[1]}.${nodeMin[2]}`,
    rgaa: {
      version: pack.baseVersion ?? "",
      criteria: criteria.length,
      themes: pack.themes.map((t) => ({
        n: t.number,
        name: themeName(pack, t.number, "fr") ?? "",
        count: criteria.filter((c) => c.theme === t.number).length,
      })),
      tests: {
        total: tiers.length,
        static: tcount("static"),
        rendered: tcount("rendered"),
        judgment: tcount("judgment"),
        decidable: tcount("static") + tcount("rendered"),
      },
      levels,
      provable: levels.det + levels.nc,
      deterministic: criteria.filter((c) => c.level === "det").map((c) => c.id),
      touched: criteria.filter((c) => c.sources.length > 0).length,
      cNeedsJudgment: criteria.length - levels.det,
    },
    wcag: { criteria: core.length, static: auto("static"), rendering: auto("needs-rendering"), judgment: auto("judgment") },
    engine: {
      staticRules: ALL_RULES.length,
      crossRules: CROSS_RULES.length,
      renderedRules: renderedRules.length,
      packRules: pack.rules?.length ?? 0,
      axeRules: normative.filter((r) => sourceOf(r) === "axe").length,
      probes: normative.filter((r) => sourceOf(r) === "probe").length,
    },
    sources,
    act: {
      examples: snap.testcases.length,
      rules: rs.length,
      scoredRules: scored.length,
      caught,
      failedScored,
      recallPct: pct(caught, failedScored),
      clean: sum(scored, (r) => r.clean),
      falsePositives: sum(rs, (r) => r.falsePositives.length),
      divergences: sum(rs, (r) => r.divergences.length),
      gapRules: notScored.filter((r) => r.mapping.gap).length,
      renderedRules: byScope("rendered").length,
      judgmentRules: byScope("judgment").length,
      deprecatedRules: byScope("deprecated").length,
      failed,
      overallPct: pct(caught, failedTotal),
    },
    tests: { fixtures: countFiles(join(root, "tests", "fixtures")) },
    criteria,
  };
}

// ---------------------------------------------------------------------------------------
// Rendering into the pages
// ---------------------------------------------------------------------------------------

const esc = (s: string | number): string => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** French number formatting with a no-break space as the thousands separator. */
export const fmt = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");

export const PAGES: { file: string; label: string }[] = [
  { file: "index.html", label: "Accueil" },
  { file: "installation.html", label: "Installer" },
  { file: "principes.html", label: "Principes" },
  { file: "workflow.html", label: "Intégration" },
  { file: "audit.html", label: "Audit" },
  { file: "couverture.html", label: "Couverture" },
  { file: "fiabilite.html", label: "Fiabilité" },
  { file: "commandes.html", label: "Commandes" },
];

const REPO = "https://github.com/SocialGouv/ultra11y";

function nav(file: string): string {
  const items = PAGES.map((p) => `<li><a href="${p.file}"${p.file === file ? ' aria-current="page"' : ""}>${esc(p.label)}</a></li>`).join("\n        ");
  return `<a class="skip" href="#contenu">Aller au contenu</a>
<header class="site-header">
  <div class="bar">
    <a class="brand" href="index.html">ultra11y</a>
    <nav aria-label="Navigation principale">
      <ul>
        ${items}
      </ul>
    </nav>
    <button type="button" class="theme-toggle" id="theme-toggle" hidden aria-pressed="false">Thème sombre</button>
  </div>
</header>`;
}

function footer(d: SiteData): string {
  return `<footer class="site-footer">
  <p>ultra11y ${esc(d.version)} · licence MIT · <a href="${REPO}">code source sur GitHub</a> · <a href="https://www.npmjs.com/package/ultra11y">paquet npm</a></p>
  <p>Les chiffres de ce site sont calculés depuis le code à chaque publication (<code>pnpm run build:site</code>). RGAA ${esc(d.rgaa.version)} © DINUM, Licence Ouverte / Etalab 2.0. Corpus ACT © W3C ACT Rules Community Group.</p>
</footer>`;
}

function levelBar(d: SiteData): string {
  const order: Level[] = ["det", "nc", "hint", "llm"];
  const label = order.map((k) => `${d.rgaa.levels[k]} ${LEVEL_LABEL[k].count}`).join(", ");
  const segs = order.map((k) => `<div class="c-${k}" style="flex:${d.rgaa.levels[k]} 1 0">${d.rgaa.levels[k]}</div>`).join("");
  const legend = order
    .map(
      (k) =>
        `<li><span class="sw c-${k}"></span><span><strong><span class="mark mark-${k}"></span>${esc(LEVEL_LABEL[k].name)} · ${d.rgaa.levels[k]}</strong> — ${esc(LEVEL_LABEL[k].desc)}</span></li>`,
    )
    .join("\n    ");
  return `<div class="stack" role="img" aria-label="Répartition des ${d.rgaa.criteria} critères : ${esc(label)}">${segs}</div>
  <ul class="legend legend-col">
    ${legend}
  </ul>`;
}

function testsBar(d: SiteData): string {
  const t = d.rgaa.tests;
  const parts = [
    { n: t.static, k: "t-static", label: "tranchés par le code", desc: "une règle du moteur peut prouver l’échec en lisant le code source" },
    { n: t.rendered, k: "t-rendered", label: "demandent la page affichée", desc: "une règle peut prouver l’échec, mais sur la page rendue" },
    { n: t.judgment, k: "t-judgment", label: "demandent un jugement", desc: "pertinence, cohérence, contenu : l’IA ou un humain décide" },
  ];
  const segs = parts.map((p) => `<div class="${p.k}" style="flex:${p.n} 1 0">${p.n}</div>`).join("");
  const legend = parts
    .map((p) => `<li><span class="sw ${p.k}"></span><span><strong>${p.n} tests ${esc(p.label)}</strong> — ${esc(p.desc)}</span></li>`)
    .join("\n    ");
  return `<div class="stack stack-lg" role="img" aria-label="Les ${t.total} tests du RGAA : ${parts.map((p) => `${p.n} ${p.label}`).join(", ")}">${segs}</div>
  <ul class="legend legend-col">
    ${legend}
  </ul>`;
}

function grid(d: SiteData): string {
  const rows = d.rgaa.themes
    .map((t) => {
      const cells = d.criteria
        .filter((c) => c.theme === t.n)
        .map(
          (c) =>
            `<li><a class="cell c-${c.level}" href="#crit-${c.id.replace(".", "-")}" data-level="${c.level}" data-src="${c.sources.join(" ")}">${esc(c.id)}<span class="sr-only"> : ${esc(LEVEL_LABEL[c.level].name)}</span></a></li>`,
        )
        .join("");
      return `<div class="mrow"><h4 class="th">${t.n}. ${esc(t.name)}</h4><ul class="cells">${cells}</ul></div>`;
    })
    .join("\n    ");
  return `<div id="matrix">
    ${rows}
  </div>`;
}

function sourceBars(d: SiteData): string {
  const max = Math.max(...d.sources.map((s) => s.touched), 1);
  const scale = Math.ceil(max / 10) * 10;
  const rows = d.sources
    .map((s) => {
      const l = SOURCE_LABEL[s.key];
      const dec = s.decisive ? `<div class="seg-nc" style="width:${((s.decisive / scale) * 100).toFixed(2)}%"></div>` : "";
      const hint = s.signalOnly ? `<div class="seg-hint" style="width:${((s.signalOnly / scale) * 100).toFixed(2)}%"></div>` : "";
      return `<tr><th scope="row">${esc(l.name)}<small>${esc(l.hint)}</small></th><td class="num">${s.decisive}</td><td class="num">${s.signalOnly}</td><td class="num"><strong>${s.touched}</strong></td><td class="barcell"><div class="track">${dec}${hint}</div><span class="sr-only">${s.decisive} sur ${s.touched} prouvées</span></td></tr>`;
    })
    .join("\n      ");
  return `<table class="bars">
    <caption class="sr-only">Nombre de critères RGAA touchés par chaque source</caption>
    <thead><tr><th scope="col">Source</th><th scope="col" class="num">NC prouvée</th><th scope="col" class="num">Indice seul</th><th scope="col" class="num">Total</th><th scope="col" class="barcell">Répartition</th></tr></thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

function actBar(d: SiteData): string {
  const f = d.act.failed;
  const parts: { n: number; k: string; label: string; desc: string }[] = [
    { n: f.caught, k: "a-caught", label: "Détectés", desc: "défauts trouvés par le moteur statique" },
    { n: f.missed, k: "a-missed", label: "Ratés dans le périmètre", desc: "règle notée, défaut non détecté : la marge de progrès directe" },
    {
      n: f.rendered,
      k: "a-rendered",
      label: "Page affichée nécessaire",
      desc: `${d.act.renderedRules} règles ACT qui demandent un navigateur (axe, sondes) : non notées`,
    },
    { n: f.judgment, k: "a-judgment", label: "Jugement", desc: `${d.act.judgmentRules} règles ACT qui demandent l’IA ou un humain : non notées` },
    {
      n: f.gap + f.deprecated + f.outside,
      k: "a-other",
      label: "Manques connus et règles obsolètes",
      desc: `${d.act.gapRules} règles à implémenter (${f.gap} exemples) et ${d.act.deprecatedRules} règles ACT obsolètes (${f.deprecated + f.outside} exemples)`,
    },
  ];
  const segs = parts.map((p) => (p.n ? `<div class="${p.k}" style="flex:${p.n} 1 0">${p.n}</div>` : "")).join("");
  const legend = parts
    .map((p) => `<li><span class="sw ${p.k}"></span><span><strong>${esc(p.label)} · ${p.n}</strong> — ${esc(p.desc)}</span></li>`)
    .join("\n    ");
  const label = parts.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(", ");
  return `<div class="stack" role="img" aria-label="${f.total} exemples fautifs : ${esc(label)}">${segs}</div>
  <ul class="legend legend-col">
    ${legend}
  </ul>`;
}

/** Slide 3: Code → Moteur → Navigateur → Agent IA → Garde-fous → Livrables, with the two
 *  bands (« la machine décide », « l’IA juge, sous contrôle ») and the loop back to the agent.
 *  The steps are an ordered list; the bands and the loop are real text placed on the grid. */
function processDiagram(d: SiteData): string {
  return `<figure class="dia proc" aria-labelledby="proc-cap">
  <p class="band band-solid proc-b1">La machine décide</p>
  <p class="band band-dashed proc-b2">L’IA juge, sous contrôle</p>
  <ol class="proc-steps">
    <li class="bx bx-plain"><strong>Code</strong><span>HTML, JSX, Vue, Svelte, Astro</span></li>
    <li class="bx bx-fill"><strong>Moteur</strong><span>${d.engine.staticRules} vérifications sur le code</span></li>
    <li class="bx bx-fill"><strong>Navigateur</strong><span>contraste, focus, zoom</span></li>
    <li class="bx bx-line"><strong>Agent IA</strong><span>juge et justifie</span></li>
    <li class="bx bx-pale"><strong>Garde-fous</strong><span><code>verify</code>, <code>check</code> : preuve exigée</span></li>
    <li class="bx bx-plain"><strong>Livrables</strong><span>rapport RGAA, backlog, tickets</span></li>
  </ol>
  <p class="proc-loop"><span class="loop-line" aria-hidden="true"></span><span class="loop-text">verdict sans preuve : renvoyé à l’agent</span></p>
  <figcaption id="proc-cap">Le process en six étapes, du code aux livrables. Le moteur et le navigateur sont mécaniques : la machine décide. L’agent IA et les garde-fous relèvent du jugement : l’IA juge, sous contrôle. Un verdict sans preuve est renvoyé par les garde-fous à l’agent IA, qui doit le refaire.</figcaption>
</figure>`;
}

/** Slide 8: one square per RGAA criterion, coloured by how far a rule can decide it. */
function waffle(d: SiteData): string {
  const order: Level[] = ["det", "nc", "hint", "llm"];
  const squares = order.flatMap((k) => Array.from({ length: d.rgaa.levels[k] }, () => `<span class="sq c-${k}"></span>`)).join("");
  const legend = order
    .map(
      (k) =>
        `<li><span class="sw c-${k}"></span><span><strong><span class="mark mark-${k}"></span>${d.rgaa.levels[k]} critères · ${esc(LEVEL_LABEL[k].name)}</strong> — ${esc(LEVEL_LABEL[k].desc)}</span></li>`,
    )
    .join("\n    ");
  const label = order.map((k) => `${d.rgaa.levels[k]} ${LEVEL_LABEL[k].count}`).join(", ");
  return `<div class="waffle" role="img" aria-label="Les ${d.rgaa.criteria} critères, un carré par critère : ${esc(label)}">${squares}</div>
  <ul class="legend legend-col">
    ${legend}
  </ul>`;
}

/** Slide 9: the W3C ACT score on the slide's dark-blue panel. Real text; only the bars are drawn. */
function actScore(d: SiteData): string {
  const a = d.act;
  const w = (n: number, of: number): string => (of ? ((n / of) * 100).toFixed(2) : "0");
  const fp = a.falsePositives === 0 ? "aucune fausse alerte inexpliquée" : `${a.falsePositives} fausse(s) alerte(s) inexpliquée(s)`;
  return `<div class="act-score">
  <p class="as-h"><strong>${a.failedScored}</strong> exemples fautifs, sur les ${a.scoredRules} règles ACT notées</p>
  <div class="as-row">
    <div class="as-track" aria-hidden="true"><div class="as-fill" style="width:${w(a.caught, a.failedScored)}%"></div></div>
    <p class="as-in"><strong>${a.caught} signalés · ${a.recallPct} %</strong></p>
    <p class="as-side">${a.failed.missed} manqués, listés un par un dans le dépôt</p>
  </div>
  <p class="as-h"><strong>${a.clean}</strong> exemples corrects</p>
  <div class="as-row">
    <div class="as-track" aria-hidden="true"><div class="as-fill" style="width:100%"></div></div>
    <p class="as-in"><strong>${a.clean} laissés tranquilles</strong></p>
    <p class="as-side">${esc(fp)}</p>
  </div>
</div>`;
}

function table(d: SiteData): string {
  const code = (xs: string[]): string => (xs.length ? xs.map((x) => `<code>${esc(x)}</code>`).join(", ") : "—");
  const rows = d.criteria
    .map(
      (c) =>
        `<tr id="crit-${c.id.replace(".", "-")}"><th scope="row">${esc(c.id)}</th><td>${esc(c.title)}</td><td>${esc(LEVEL_LABEL[c.level].short)}</td><td>${esc(c.sources.map((s) => SOURCE_LABEL[s].name).join(", ") || "—")}</td><td>${code(c.decisive)}</td><td>${code(c.signals)}</td></tr>`,
    )
    .join("\n      ");
  return `<div class="scroll" role="region" aria-labelledby="annexe-titre" tabindex="0">
  <table class="crit-table">
    <caption>Les ${d.rgaa.criteria} critères du RGAA ${esc(d.rgaa.version)}, avec leur niveau d’automatisation et les règles qui les touchent</caption>
    <thead><tr><th scope="col">Critère</th><th scope="col">Intitulé</th><th scope="col">Niveau</th><th scope="col">Sources</th><th scope="col">Règles décisives</th><th scope="col">Indices</th></tr></thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  </div>`;
}

const BLOCKS: Record<string, (d: SiteData, file: string) => string> = {
  nav: (_d, file) => nav(file),
  footer: (d) => footer(d),
  "level-bar": (d) => levelBar(d),
  "tests-bar": (d) => testsBar(d),
  grid: (d) => grid(d),
  "source-bars": (d) => sourceBars(d),
  "act-bar": (d) => actBar(d),
  "act-score": (d) => actScore(d),
  process: (d) => processDiagram(d),
  waffle: (d) => waffle(d),
  table: (d) => table(d),
};

function lookup(d: SiteData, path: string): string {
  let v: unknown = d;
  for (const k of path.split(".")) {
    if (v === null || typeof v !== "object" || !(k in v)) throw new Error(`site: unknown data path "${path}"`);
    v = (v as Record<string, unknown>)[k];
  }
  if (typeof v === "number") return fmt(v);
  if (typeof v === "string") return esc(v);
  if (Array.isArray(v))
    return v
      .map((x) => esc(String(x)))
      .join(", ")
      .replace(/, ([^,]*)$/, " et $1");
  throw new Error(`site: data path "${path}" is not a scalar`);
}

/** French typography: a no-break space before « : ; ? ! % » and inside guillemets, so a
 *  line never starts with a lone punctuation mark. Text nodes and label attributes only. */
function frTypo(html: string): string {
  const NB = "\u00a0";
  const fix = (t: string): string =>
    t
      .replace(/« /g, `«${NB}`)
      .replace(/ »/g, `${NB}»`)
      .replace(/ ([:;?!])(?=\s|$|[«»"’)])/g, `${NB}$1`)
      .replace(/ %/g, `${NB}%`);
  return html.replace(/(<[^>]+>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) =>
    tag ? tag.replace(/(aria-label)="([^"]*)"/g, (_x, a: string, v: string) => `${a}="${fix(v)}"`) : fix(text ?? ""),
  );
}

/** Fill every generated region of one page. Idempotent: rendering a rendered page is a no-op. */
export function renderPage(html: string, file: string, d: SiteData): string {
  let out = html.replace(/<!-- gen:([\w-]+) -->[\s\S]*?<!-- \/gen:\1 -->/g, (_m, name: string) => {
    const f = BLOCKS[name];
    if (!f) throw new Error(`site: unknown block "${name}" in ${file}`);
    return `<!-- gen:${name} -->\n${frTypo(f(d, file))}\n<!-- /gen:${name} -->`;
  });
  out = out.replace(
    /(<(\w+)[^>]*\sdata-gen="([\w.]+)"[^>]*>)[^<]*(<\/\2>)/g,
    (_m, open: string, _tag, path: string, close: string) => `${open}${lookup(d, path)}${close}`,
  );
  return out;
}

/** The serialized data file, byte-stable. */
export function renderData(d: SiteData): string {
  return `${JSON.stringify(d, null, 2)}\n`;
}

export const SITE_PAGES = PAGES.map((p) => p.file);
