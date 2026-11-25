// ANNEX I — THE APPLICATION MAP: what was seen, and how (#208).
//
// Annexes F, G and H each list one inventory — the routes, the rendered units, the journeys —
// and say how each item was observed. None of them answers the question a reader of a « 106
// critères » audit asks first: across the whole application, WHAT did the tool actually look at,
// with WHICH instrument, and which criteria could that instrument reach? This annex puts the
// three inventories side by side with the pages and page states the audit read, the capture
// files each one's evidence came from, and the coverage matrix (src/coverage-matrix.ts) per
// evidence source.
//
// It states what was seen; it decides nothing. Criterion ids appear only in the per-source table,
// in the same `\`id\` · \`id\`` form the annex header already uses for the automation contract, so
// `check` reads no claim into it.
import { EVIDENCE_SOURCES, type EvidenceSource, coverageMatrix, matrixBySource } from "./coverage-matrix.js";
import type { StandardId } from "./standards/index.js";
import type { AuditResult, DecidedBy, Lang, PageCoverage, Status } from "./types.js";

const CAPTURE_LABEL: Record<Lang, Record<string, string>> = {
  fr: {
    "styles.json": "styles calculés",
    "boxes.json": "boîtes",
    "css.json": "feuilles de style",
    "probes.json": "sondes",
    "axe.json": "axe-core",
    "scripts.json": "comportement JavaScript",
    "axtree.json": "arbre d'accessibilité",
    "sr.json": "lecteur d'écran simulé",
    "media.json": "médias et flashs",
    "screen.png": "capture d'écran",
  },
  en: {
    "styles.json": "computed styles",
    "boxes.json": "boxes",
    "css.json": "stylesheets",
    "probes.json": "probes",
    "axe.json": "axe-core",
    "scripts.json": "JavaScript behaviour",
    "axtree.json": "accessibility tree",
    "sr.json": "simulated screen reader",
    "media.json": "media and flashes",
    "screen.png": "screenshot",
  },
};

const CAPTURE_ORDER = [
  "styles.json",
  "boxes.json",
  "css.json",
  "axe.json",
  "probes.json",
  "scripts.json",
  "axtree.json",
  "sr.json",
  "media.json",
  "screen.png",
];

const S = {
  fr: {
    title: "I. Carte de l'application — ce qui a été vu, et comment",
    intro: (routes: number, pages: number, journeys: number, states: number, units: number) =>
      `${routes} route(s) connue(s), ${pages} page(s) et état(s) de page lus par l'audit, ${journeys} parcours (${states} état(s) enregistré(s)), ${units} unité(s) rendue(s) par le moteur ultra11y. Pour chaque page : d'où elle vient, quel instrument l'a vue et ce qu'il en a enregistré ; puis, pour chaque source de preuve, ce qu'elle a vu dans cet audit et les critères qu'elle peut atteindre. Cette carte constate, elle ne décide rien : un critère qu'une source peut atteindre n'est pas pour autant décidé.`,
    pagesTitle: "Pages et états observés",
    pagesHead: "| Page | Adresse | Origine | Vue par | Enregistré |",
    sample: "route de l'échantillon",
    outOfSample: "route hors échantillon",
    declared: "page déclarée",
    state: (j: string, n: number, label: string) => `parcours **${j}**, étape ${n} : ${label}`,
    browserScan: "navigateur (scan)",
    browserJourney: "navigateur (journey run)",
    browserE2E: "tests E2E (capture)",
    sourceOnly: "code source seulement",
    notAudited: "capture présente, non lue",
    loading: "capturée pendant le chargement",
    dom: "DOM",
    measured: (n: number) => `sondes : ${n} critère(s) WCAG mesuré(s)`,
    nothing: "—",
    unitsTitle: "Composants rendus, par route",
    unitsHead: "| Route | Unités rendues par le moteur |",
    isolated: "composants isolés",
    unitsNone: "Aucune unité rendue par le moteur ultra11y dans cet audit.",
    sourcesTitle: "Critères par source de preuve",
    sourcesHead: "| Source | Ce que cet audit en a vu | Critères atteints | Dont décidés |",
    source: {
      static: "Statique (code source, `audit`)",
      render: "Rendu (moteur de rendu, `render`)",
      snapshot: "Instantané (page capturée)",
      journey: "Navigateur (`scan`, `journey run`)",
      judgement: "Jugement (`verify --manual`)",
    } as Record<EvidenceSource, string>,
    seen: {
      static: (n: number) => `${n} fichier(s) lu(s)`,
      render: (n: number) => `${n} unité(s) rendue(s)`,
      snapshot: (n: number) => `${n} page(s) et état(s) capturé(s)`,
      journey: (axe: number, states: number) => `${axe} page(s) et état(s) mesuré(s) par axe-core, dont ${states} état(s) de parcours`,
      judgement: (n: number) => `${n} critère(s) tranché(s) par l'adjudicateur`,
    },
    decided: (d: number, n: number) => `${d} / ${n}`,
  },
  en: {
    title: "I. Application map — what was seen, and how",
    intro: (routes: number, pages: number, journeys: number, states: number, units: number) =>
      `${routes} known route(s), ${pages} page(s) and page state(s) read by the audit, ${journeys} journey(s) (${states} state(s) recorded), ${units} unit(s) rendered by ultra11y's engine. For each page: where it comes from, which instrument saw it and what that instrument recorded; then, for each evidence source, what it saw in this audit and the criteria it can reach. This map states facts and decides nothing: a criterion a source can reach is not thereby decided.`,
    pagesTitle: "Pages and states observed",
    pagesHead: "| Page | Address | Origin | Seen by | Recorded |",
    sample: "sample route",
    outOfSample: "route outside the sample",
    declared: "declared page",
    state: (j: string, n: number, label: string) => `journey **${j}**, step ${n}: ${label}`,
    browserScan: "browser (scan)",
    browserJourney: "browser (journey run)",
    browserE2E: "E2E tests (capture)",
    sourceOnly: "source code only",
    notAudited: "capture on disk, not read",
    loading: "captured while loading",
    dom: "DOM",
    measured: (n: number) => `probes: ${n} WCAG criterion(ia) measured`,
    nothing: "—",
    unitsTitle: "Rendered components, by route",
    unitsHead: "| Route | Units rendered by the engine |",
    isolated: "isolated components",
    unitsNone: "No unit was rendered by ultra11y's engine in this audit.",
    sourcesTitle: "Criteria by evidence source",
    sourcesHead: "| Source | What this audit saw of it | Criteria reached | Of which decided |",
    source: {
      static: "Static (source code, `audit`)",
      render: "Render (render engine, `render`)",
      snapshot: "Snapshot (captured page)",
      journey: "Browser (`scan`, `journey run`)",
      judgement: "Judgement (`verify --manual`)",
    } as Record<EvidenceSource, string>,
    seen: {
      static: (n: number) => `${n} file(s) read`,
      render: (n: number) => `${n} unit(s) rendered`,
      snapshot: (n: number) => `${n} page(s) and state(s) captured`,
      journey: (axe: number, states: number) => `${axe} page(s) and state(s) measured by axe-core, ${states} of them journey states`,
      judgement: (n: number) => `${n} criterion(ia) ruled by the adjudicator`,
    },
    decided: (d: number, n: number) => `${d} / ${n}`,
  },
};

const cell = (t: string): string => t.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** A row of the report grid, as much of it as the map reads. */
export interface MapRow {
  id: string;
  status: Status;
  decidedBy?: DecidedBy;
}

/** What one page's evidence was read from, in words. */
function recorded(cov: PageCoverage | undefined, lang: Lang): string {
  const s = S[lang];
  if (!cov) return s.nothing;
  const files = new Set(cov.captures ?? []);
  const parts = [s.dom];
  // In the order a reader meets them: what the page is, what was measured on it, what it shows.
  for (const f of CAPTURE_ORDER) {
    if (!files.has(f)) continue;
    parts.push(f === "probes.json" && cov.scs?.length ? s.measured(cov.scs.length) : (CAPTURE_LABEL[lang][f] ?? f));
  }
  for (const f of files) if (!CAPTURE_ORDER.includes(f)) parts.push(f);
  return parts.join(", ");
}

/** Annex I. Empty when the audit read no page and knows no route: there is nothing to map. */
export function renderAppMap(r: AuditResult, standard: StandardId, rows: MapRow[], lang: Lang): string[] {
  const s = S[lang];
  const pages = r.scope.pages ?? [];
  const routes = r.scope.routes ?? [];
  if (!pages.length && !routes.length) return [];
  const journeys = r.scope.journeys?.journeys ?? [];
  const units = r.scope.renders?.units ?? [];
  const rendered = units.filter((u) => u.status === "rendered");
  // Which journey step recorded which page state.
  const stateOf = new Map<string, string>();
  for (const j of journeys) for (const st of j.steps) if (st.page) stateOf.set(st.page, s.state(cell(j.name), st.n, cell(st.label)));
  const routeOf = new Map(routes.filter((x) => x.page).map((x) => [x.page!, x]));
  const coverage = r.scope.pageCoverage ?? {};
  const out = [`## ${s.title}`, "", s.intro(routes.length, pages.length, journeys.length, stateOf.size, rendered.length), ""];

  out.push(`### ${s.pagesTitle}`, "", s.pagesHead, "|---|---|---|---|---|");
  for (const p of pages) {
    const route = routeOf.get(p.id);
    const origin = stateOf.get(p.id) ?? (route ? (route.sample ? s.sample : s.outOfSample) : s.declared);
    const cov = coverage[p.id];
    const by =
      p.basis === "attributed"
        ? s.sourceOnly
        : p.basis === "not-audited"
          ? s.notAudited
          : `${stateOf.has(p.id) ? s.browserJourney : route?.observed === "captured" ? s.browserE2E : s.browserScan}${p.basis === "loading" ? ` (${s.loading})` : ""}`;
    out.push(
      `| \`${cell(p.id)}\` | \`${cell(route?.path ?? p.route ?? p.url)}\` | ${origin} | ${by} | ${p.basis === "snapshot" || p.basis === "loading" ? recorded(cov, lang) : s.nothing} |`,
    );
  }
  out.push("");

  out.push(`### ${s.unitsTitle}`, "");
  if (!rendered.length) out.push(s.unitsNone, "");
  else {
    out.push(s.unitsHead, "|---|---|");
    const byRoute = new Map<string, string[]>();
    for (const u of rendered) {
      const key = u.route !== undefined ? `\`${cell(u.route)}\`` : s.isolated;
      const label = `${u.kind === "story" ? `${u.component} · ${u.export}` : u.component} (\`${cell(u.file)}\`)`;
      byRoute.set(key, [...(byRoute.get(key) ?? []), label]);
    }
    for (const [route, list] of [...byRoute.entries()].sort(([a], [b]) => (a === s.isolated ? 1 : b === s.isolated ? -1 : a.localeCompare(b))))
      out.push(`| ${route} | ${list.map(cell).join(" · ")} |`);
    out.push("");
  }

  out.push(`### ${s.sourcesTitle}`, "", s.sourcesHead, "|---|---|---|---|");
  const reached = matrixBySource(coverageMatrix(standard));
  const statusOf = new Map(rows.map((x) => [x.id, x]));
  const captured = pages.filter((p) => p.basis === "snapshot" || p.basis === "loading");
  const axe = captured.filter((p) => coverage[p.id]?.axe).length;
  const judged = rows.filter((x) => x.decidedBy === "agent" || x.decidedBy === "human").length;
  for (const src of EVIDENCE_SOURCES) {
    const ids = reached[src];
    const seen =
      src === "static"
        ? s.seen.static(r.scope.files)
        : src === "render"
          ? s.seen.render(rendered.length)
          : src === "snapshot"
            ? s.seen.snapshot(captured.length)
            : src === "journey"
              ? s.seen.journey(axe, captured.filter((p) => stateOf.has(p.id)).length)
              : s.seen.judgement(judged);
    const decided = ids.filter((id) => {
      const st = statusOf.get(id)?.status;
      return st === "C" || st === "NC" || st === "NA";
    }).length;
    out.push(`| ${s.source[src]} | ${seen} | ${ids.map((id) => `\`${id}\``).join(" · ") || s.nothing} | ${s.decided(decided, ids.length)} |`);
  }
  out.push("");
  return out;
}
