// `ultra11y serve` — the audit results as a small local site, or as a static export of it.
//
// Three layers, kept apart for the same reason the HTML tier is split (src/html.ts):
//
//   1. THE SITE MODEL (`buildSite`): every page as a path and a renderer. It reads the audit
//      history (src/serve-history.ts) and builds `Doc`s with the report's own builders —
//      `indexDoc`, `pagesIndexDoc`, `pageDoc` (src/html-report.ts) and `renderSnapshotBlocks`
//      (src/render-snapshot-report.ts) — so a grid, a rate or a page sheet served here is the
//      one the report prints. Every link it emits is RELATIVE to the page that carries it,
//      which is what lets the very same pages work from `http://127.0.0.1:4711/` and from a
//      GitHub Pages sub-path (`https://org.github.io/repo/a11y/`).
//   2. THE FILE GUARD (`resolveUnder`): the only door from a URL to the disk. A raw file is
//      served from one of three roots — the audits directory, `.ultra11y/pages` (the page
//      captures) and `.ultra11y/render-snapshots` (the component snapshots) — and only when
//      the resolved path, AND its real path after following links, are still inside that root.
//      No directory is ever listed.
//   3. THE TRANSPORTS: `startServer` (node:http, read-only, loopback by default) and
//      `exportStatic` (writes the pages and copies exactly the files they reference).
//
// Nothing here decides a status or computes a rate; see src/serve-history.ts.
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { formatRate, type PackPageRate } from "./pages.js";
import { indexDoc, pageDoc, pagesIndexDoc } from "./html-report.js";
import { type Block, type Cell, type Doc, type NavLink, type Run, renderHtmlDocument } from "./html.js";
import { readJourneyRuns } from "./journey.js";
import { annexFileName } from "./report.js";
import { RENDER_SNAPSHOT_INDEX, RENDER_SNAPSHOTS_DIR } from "./render-snapshot.js";
import { renderSnapshotBlocks } from "./render-snapshot-report.js";
import {
  type AuditEntry,
  type AuditSummary,
  type ChangeKind,
  discoverAudits,
  type Evolution,
  evolution,
  historySignature,
  summarize,
} from "./serve-history.js";
import { PAGES_DIR, pageScreenshot } from "./snapshot.js";
import { type StandardId, standardLabel } from "./standards/index.js";
import { NEUTRAL_THEME, type Theme } from "./theme.js";
import type { JourneyRecord, Lang, RenderScope, RenderSnapshotIndex, Status } from "./types.js";

/** The default port. Arbitrary, unassigned, and easy to type; a busy one is skipped. */
export const DEFAULT_PORT = 4711;
/** How many ports above the requested one are tried when it is busy. */
export const PORT_TRIES = 20;

export interface SiteOptions {
  /** The audits directory (default layout: `audits/`). */
  auditsDir: string;
  /** The project root holding `.ultra11y/` (page captures, component snapshots, journeys). */
  root?: string;
  lang: Lang;
  standard?: StandardId;
  theme?: Theme;
}

/** The three roots raw files are served from, by URL prefix (`files/<mount>/…`). */
export type Mount = "audits" | "pages" | "components";

export interface Site {
  /** Site path (`index.html`, `audits/<id>/index.html`…) → its HTML. Rendered on demand. */
  routes: Map<string, () => string>;
  /** Every raw file route the rendered pages referenced (decoded, `files/<mount>/…`). Filled
   *  as pages render: the static export renders them all, then copies exactly these. */
  fileRoutes: Set<string>;
  mounts: Record<Mount, string>;
  history: AuditEntry[];
}

// ---- strings ---------------------------------------------------------------------------

const T = {
  fr: {
    siteTitle: "Résultats d'accessibilité",
    navLabel: "Navigation des résultats",
    home: "Accueil",
    dashboard: "Tableau de bord",
    pages: "Pages",
    evolution: "Évolution",
    journeys: "Parcours",
    components: "Composants",
    files: "Fichiers",
    auditOf: (d: string) => `Audit du ${d}`,
    source: "Fichier source",
    historyTitle: "Historique des audits",
    historyCaption:
      "Un audit par ligne, du plus récent au plus ancien : taux de conformité, taux moyen des pages, critères par statut et écart avec l'audit précédent.",
    audit: "Audit",
    rate: "Taux de conformité",
    average: "Taux moyen",
    c: "C",
    nc: "NC",
    na: "NA",
    manual: "À évaluer",
    delta: "Écart",
    rateNote:
      "Taux de conformité : critères validés ÷ critères applicables, calculé comme dans le rapport. Tant que des critères restent « à évaluer », il est provisoire. Le taux moyen est la moyenne des taux des pages, selon la méthode RGAA. Les NA sont comptés dans C.",
    historyCount: (n: number) => `${n} audit(s) trouvé(s) dans ce dossier.`,
    latestTitle: "Dernier audit",
    openLatest: (d: string) => `Ouvrir l'audit du ${d}`,
    openEvolution: (a: string, b: string) => `Voir l'évolution du ${a} au ${b}`,
    firstAudit: "C'est le premier audit de l'historique : il n'y a pas encore d'évolution à montrer.",
    changedCount: (n: number) => `${n} critère(s) ont changé de statut depuis l'audit précédent.`,
    points: (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)} point${Math.abs(n) > 1 ? "s" : ""}`),
    evolutionTitle: (a: string, b: string) => `Évolution du ${a} au ${b}`,
    ratesTitle: "Taux",
    ratesCaption: "Taux avant et après, et leur écart en points de pourcentage.",
    measure: "Mesure",
    before: "Avant",
    after: "Après",
    totalsTitle: "Critères par statut",
    totalsCaption: "Nombre de critères par statut dans les deux audits.",
    status: "Statut",
    changesTitle: "Critères dont le statut a changé",
    changesCaption: "Un critère par ligne : son statut avant, son statut après et le sens du changement.",
    criterion: "Critère",
    change: "Changement",
    noChanges: "Aucun critère n'a changé de statut entre ces deux audits.",
    kind: {
      fixed: "Corrigé",
      regressed: "Régression",
      decided: "Décidé",
      reopened: "Rouvert, à évaluer",
      requalified: "Requalifié",
      added: "Nouveau critère",
      removed: "Critère retiré",
    } as Record<ChangeKind, string>,
    absent: "absent",
    pagesTitle: "Pages",
    pagesCaption: "Taux de chaque page avant et après, et leur écart en points.",
    page: "Page",
    newPage: "nouvelle page",
    removedPage: "absente de l'audit récent",
    gridTitle: "Grille comparée des critères",
    gridCaption: "Statut de chaque critère dans les deux audits.",
    legend: "`C` conforme · `NC` non conforme · `—` non applicable · `?` à évaluer.",
    previous: "Audit précédent",
    averageLine: (pct: number, n: number) => `Taux moyen de conformité : ${pct} % (moyenne des taux des ${n} page(s) de l'échantillon).`,
    averageNone: "Taux moyen de conformité : aucune page n'a de critère décidé, il n'y a donc pas de moyenne.",
    averageOpen: (n: number) => `Provisoire : ${n} critère(s) restent à évaluer sur ces pages.`,
    averageExcluded: (n: number) => `${n} page(s) sans critère décidé sont exclues de la moyenne.`,
    journeysTitle: "Parcours",
    journeysIntro: (n: number) =>
      `${n} parcours. Chaque étape réalisée enregistre un état de page, audité comme une page mais compté à part : il n'entre ni dans le nombre de pages ni dans le taux moyen.`,
    noJourneys: "Aucun parcours dans cet audit : `journey run` n'a pas été lancé, ou ses résultats n'ont pas été fusionnés.",
    journeyFile: "Fichier",
    journeyStatus: "Statut",
    keyboardMode: "Rejoué au clavier",
    yes: "oui",
    no: "non",
    stepsCaption: (n: string) => `Étapes du parcours ${n}.`,
    stepN: "N°",
    step: "Étape",
    keyboard: "Clavier",
    pageState: "État de page",
    note: "Remarque",
    stepStatus: { done: "réalisée", failed: "en échec", "not-run": "non exécutée" } as Record<string, string>,
    journeyState: { done: "terminé", failed: "en échec", "not-run": "non rejoué" } as Record<string, string>,
    keyboardHow: { focus: "atteint au clavier", unreachable: "inatteignable au clavier", trap: "piège au clavier" } as Record<string, string>,
    componentsTitle: "Rendus de composants",
    noComponents: "Aucun instantané de composant pour cet audit : `render` n'a pris aucune capture dans un navigateur.",
    componentsOld:
      "Les images des instantanés ne sont montrées que pour l'audit le plus récent : le dossier `.ultra11y/render-snapshots` ne garde que le dernier passage.",
    filesTitle: "Fichiers de l'audit",
    docsTitle: "Documents",
    docsCaption: "Les fichiers produits pour cet audit, servis tels quels.",
    fileName: "Fichier",
    fileKind: "Type",
    fileSize: "Taille",
    noFiles: "Aucun autre fichier n'accompagne cet audit.",
    appMap: "Annexe I : carte de l'application (dans l'annexe technique)",
    appMapTitle: "Carte de l'application",
    shotsTitle: "Captures d'écran des pages",
    shotsCaption: "La capture de chaque page, quand elle existe.",
    capture: "Capture",
    noShot: "aucune",
    shotsOld:
      "Les captures de `.ultra11y/pages` ne sont rattachées qu'à l'audit le plus récent : elles décrivent l'état actuel des pages, pas celui d'un audit passé.",
    kinds: { md: "Markdown", html: "HTML", json: "JSON", image: "Image", pdf: "PDF", text: "Texte" } as Record<string, string>,
    notFoundTitle: "Page introuvable",
    notFound: "Cette adresse ne correspond à aucune page des résultats.",
    backHome: "Revenir à l'accueil",
  },
  en: {
    siteTitle: "Accessibility results",
    navLabel: "Results navigation",
    home: "Home",
    dashboard: "Dashboard",
    pages: "Pages",
    evolution: "Evolution",
    journeys: "Journeys",
    components: "Components",
    files: "Files",
    auditOf: (d: string) => `Audit of ${d}`,
    source: "Source file",
    historyTitle: "Audit history",
    historyCaption: "One audit per row, newest first: conformity rate, mean page rate, criteria per status and the change since the previous audit.",
    audit: "Audit",
    rate: "Conformity rate",
    average: "Mean rate",
    c: "C",
    nc: "NC",
    na: "NA",
    manual: "To assess",
    delta: "Change",
    rateNote:
      "Conformity rate: validated criteria ÷ applicable criteria, computed as in the report. While criteria remain to assess it is provisional. The mean rate is the mean of the page rates, per the RGAA method. NA are counted within C.",
    historyCount: (n: number) => `${n} audit(s) found in this directory.`,
    latestTitle: "Latest audit",
    openLatest: (d: string) => `Open the audit of ${d}`,
    openEvolution: (a: string, b: string) => `See the evolution from ${a} to ${b}`,
    firstAudit: "This is the first audit of the history: there is no evolution to show yet.",
    changedCount: (n: number) => `${n} criterion(ia) changed status since the previous audit.`,
    points: (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)} pt${Math.abs(n) === 1 ? "" : "s"}`),
    evolutionTitle: (a: string, b: string) => `Evolution from ${a} to ${b}`,
    ratesTitle: "Rates",
    ratesCaption: "Rates before and after, and their change in percentage points.",
    measure: "Measure",
    before: "Before",
    after: "After",
    totalsTitle: "Criteria per status",
    totalsCaption: "Number of criteria per status in both audits.",
    status: "Status",
    changesTitle: "Criteria whose status changed",
    changesCaption: "One criterion per row: its status before, its status after and the direction of the change.",
    criterion: "Criterion",
    change: "Change",
    noChanges: "No criterion changed status between these two audits.",
    kind: {
      fixed: "Fixed",
      regressed: "Regression",
      decided: "Decided",
      reopened: "Reopened, to assess",
      requalified: "Requalified",
      added: "New criterion",
      removed: "Criterion removed",
    } as Record<ChangeKind, string>,
    absent: "absent",
    pagesTitle: "Pages",
    pagesCaption: "Each page's rate before and after, and their change in points.",
    page: "Page",
    newPage: "new page",
    removedPage: "absent from the newer audit",
    gridTitle: "Compared criteria grid",
    gridCaption: "Each criterion's status in both audits.",
    legend: "`C` conforming · `NC` non-conforming · `—` not applicable · `?` to assess.",
    previous: "Previous audit",
    averageLine: (pct: number, n: number) => `Mean conformity rate: ${pct} % (mean of the rates of the ${n} sampled page(s)).`,
    averageNone: "Mean conformity rate: no page has a decided criterion, so there is no mean.",
    averageOpen: (n: number) => `Provisional: ${n} criterion(ia) remain to assess on these pages.`,
    averageExcluded: (n: number) => `${n} page(s) with no decided criterion are left out of the mean.`,
    journeysTitle: "Journeys",
    journeysIntro: (n: number) =>
      `${n} journey(s). Each step done records a page state, audited like a page but counted apart: it enters neither the page count nor the mean rate.`,
    noJourneys: "No journey in this audit: `journey run` was not run, or its results were not merged.",
    journeyFile: "File",
    journeyStatus: "Status",
    keyboardMode: "Replayed with the keyboard",
    yes: "yes",
    no: "no",
    stepsCaption: (n: string) => `Steps of the ${n} journey.`,
    stepN: "No.",
    step: "Step",
    keyboard: "Keyboard",
    pageState: "Page state",
    note: "Note",
    stepStatus: { done: "done", failed: "failed", "not-run": "not run" } as Record<string, string>,
    journeyState: { done: "completed", failed: "failed", "not-run": "not replayed" } as Record<string, string>,
    keyboardHow: { focus: "reached with the keyboard", unreachable: "unreachable with the keyboard", trap: "keyboard trap" } as Record<string, string>,
    componentsTitle: "Component renders",
    noComponents: "No component snapshot for this audit: `render` took no capture in a browser.",
    componentsOld: "Snapshot images are shown for the latest audit only: `.ultra11y/render-snapshots` keeps the last pass alone.",
    filesTitle: "Audit files",
    docsTitle: "Documents",
    docsCaption: "The files produced for this audit, served as they are.",
    fileName: "File",
    fileKind: "Type",
    fileSize: "Size",
    noFiles: "No other file comes with this audit.",
    appMap: "Annex I: application map (in the technical annex)",
    appMapTitle: "Application map",
    shotsTitle: "Page screenshots",
    shotsCaption: "Each page's screenshot, when there is one.",
    capture: "Screenshot",
    noShot: "none",
    shotsOld: "The `.ultra11y/pages` screenshots are attached to the latest audit only: they show the pages as they are now, not as a past audit saw them.",
    kinds: { md: "Markdown", html: "HTML", json: "JSON", image: "Image", pdf: "PDF", text: "Text" } as Record<string, string>,
    notFoundTitle: "Page not found",
    notFound: "This address matches no page of the results.",
    backHome: "Back to the home page",
  },
} as const;

/** Backtick spans as code runs — the same convention as the report's shared sentences. */
function ticks(text: string): Run[] {
  return text.split(/`([^`]+)`/).flatMap((part, i) => (part === "" ? [] : i % 2 === 1 ? [{ text: part, mono: true }] : [{ text: part }]));
}

// ---- paths -----------------------------------------------------------------------------

/** A link from one site path to another, relative, each segment percent-encoded. Resolved
 *  against `/` on both sides — `posix.relative` would otherwise resolve against the CWD. */
export function relHref(from: string, to: string): string {
  const r = posix.relative(`/${posix.dirname(from)}`, `/${to}`);
  const path = r === "" ? posix.basename(to) : r;
  return path
    .split("/")
    .map((s) => (s === ".." ? s : encodeURIComponent(s)))
    .join("/");
}

const P = {
  home: "index.html",
  audit: (id: string) => `audits/${id}/index.html`,
  pagesIndex: (id: string) => `audits/${id}/pages/index.html`,
  page: (id: string, slug: string) => `audits/${id}/pages/${slug}.html`,
  evolution: (id: string) => `audits/${id}/evolution.html`,
  journeys: (id: string) => `audits/${id}/journeys.html`,
  components: (id: string) => `audits/${id}/components.html`,
  files: (id: string) => `audits/${id}/files.html`,
};

/** A page id as a file name: what a snapshot directory may be called is not what a URL path
 *  segment may hold, and a collision is resolved by suffix rather than by overwriting. */
function pageSlugs(ids: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>(["index"]);
  for (const id of ids) {
    const base = id.replace(/[^A-Za-z0-9_-]+/g, "_") || "page";
    let s = base;
    for (let n = 2; used.has(s); n++) s = `${base}-${n}`;
    used.add(s);
    out.set(id, s);
  }
  return out;
}

// ---- the file guard --------------------------------------------------------------------

/** Content types of the raw files the server hands out. Anything else is not served. */
export const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

/** Whether a path segment may appear in a served path. Refuses `.`/`..`, every dot-file (no
 *  `.env`, no `.git` under the audits root), separators and NUL. */
function safeSegment(s: string): boolean {
  return s !== "" && !s.startsWith(".") && !s.includes("/") && !s.includes("\\") && !s.includes("\0");
}

/** Within `root` — strictly below it, never `root` itself. */
function isInside(root: string, p: string): boolean {
  return p.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * THE ONLY DOOR FROM A URL TO THE DISK. Resolves `segments` under `root` and returns the real
 * path of a regular file with a served extension — or undefined.
 *
 * Two checks, because one is not enough. The lexical one (resolve, then prefix) stops `..`; the
 * real-path one stops a symbolic link inside the root that points outside it, which the lexical
 * check cannot see. A directory is refused: there is no listing.
 */
export function resolveUnder(root: string, segments: string[]): string | undefined {
  if (!segments.length || !segments.every(safeSegment)) return undefined;
  const base = resolve(root);
  const candidate = resolve(base, ...segments);
  if (!isInside(base, candidate)) return undefined;
  let real: string;
  let realRoot: string;
  try {
    real = realpathSync(candidate);
    realRoot = realpathSync(base);
  } catch {
    return undefined;
  }
  if (!isInside(realRoot, real)) return undefined;
  if (!CONTENT_TYPES[extname(real).toLowerCase()]) return undefined;
  try {
    if (!statSync(real).isFile()) return undefined;
  } catch {
    return undefined;
  }
  return real;
}

/** The URL path, decoded and split, or null when it cannot be a path of this site: not
 *  absolute, malformed percent-encoding, NUL or backslash, an empty segment in the middle,
 *  `.`/`..`, or a dot-file. The RAW request target is parsed — never a `URL` object, which
 *  would normalise `..` away before the guard had a chance to refuse it. */
export function parseRequestPath(raw: string | undefined): string[] | null {
  if (!raw?.startsWith("/")) return null;
  const pathname = raw.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segs = decoded.split("/").slice(1);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s === "") {
      if (i !== segs.length - 1) return null;
      continue;
    }
    if (!safeSegment(s)) return null;
  }
  return segs;
}

// ---- the site --------------------------------------------------------------------------

interface Ctx {
  lang: Lang;
  standard: StandardId;
  root: string;
  mounts: Record<Mount, string>;
  fileRoutes: Set<string>;
}

/** The route of a file under a mount, registered for the static export — or undefined when the
 *  guard refuses it (outside the mount, through a link, an unserved type). */
function fileRoute(ctx: Ctx, mount: Mount, abs: string): string | undefined {
  const base = resolve(ctx.mounts[mount]);
  const rel = relative(base, resolve(abs));
  if (!rel || rel.startsWith("..")) return undefined;
  const segs = rel.split(sep);
  if (!resolveUnder(base, segs)) return undefined;
  const route = `files/${mount}/${segs.join("/")}`;
  ctx.fileRoutes.add(route);
  return route;
}

function fileOfRoute(mounts: Record<Mount, string>, segs: string[]): string | undefined {
  const [head, mount, ...rest] = segs;
  if (head !== "files" || !mount || !Object.hasOwn(mounts, mount)) return undefined;
  return resolveUnder(mounts[mount as Mount], rest);
}

function navFor(from: string, items: { path: string; text: string }[]): NavLink[] {
  return items.map((i) => ({ href: relHref(from, i.path), text: i.text, ...(i.path === from ? { current: true } : {}) }));
}

/** The component snapshot index for an audit: the on-disk one for the latest audit (it is the
 *  one `render` just wrote), the one the audit carried otherwise. */
function snapshotIndex(ctx: Ctx, entry: AuditEntry, latest: boolean): RenderSnapshotIndex | undefined {
  if (latest) {
    try {
      const raw = JSON.parse(readFileSync(join(ctx.root, RENDER_SNAPSHOT_INDEX), "utf8")) as Partial<RenderSnapshotIndex>;
      if (raw && raw.v === 1 && Array.isArray(raw.units)) return raw as RenderSnapshotIndex;
    } catch {
      // No index on disk: fall back to the audit's own copy.
    }
  }
  return entry.result.scope.renders?.snapshots;
}

function journeysOf(ctx: Ctx, entry: AuditEntry, latest: boolean): JourneyRecord[] {
  return entry.result.scope.journeys?.journeys ?? (latest ? (readJourneyRuns(ctx.root)?.journeys ?? []) : []);
}

const rateText = (r: { pct: number; validated: number; applicable: number } | null): string => (r ? formatRate(r.pct, r.validated, r.applicable) : "—");
const pageRateText = (r: PackPageRate | undefined): string => (r ? formatRate(r.pct, r.validated, r.decided) : "—");

function statusCell(s: Status | undefined, absent: string): Cell {
  return s ? { status: s, text: "" } : { text: absent, strong: false };
}

function fileKind(name: string): string | undefined {
  const ext = extname(name).toLowerCase();
  if (ext === ".md") return "md";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".json") return "json";
  if (ext === ".pdf") return "pdf";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if (ext === ".txt" || ext === ".csv") return "text";
  return undefined;
}

const size = (n: number, lang: Lang): string => {
  const unit = lang === "fr" ? ["o", "Ko", "Mo"] : ["B", "KB", "MB"];
  if (n < 1024) return `${n} ${unit[0]}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ${unit[1]}`;
  return `${(n / (1024 * 1024)).toFixed(1)} ${unit[2]}`;
};

/** The files that belong to one audit. An audit alone in its directory owns everything in it
 *  (and in its `pages/` sheets); one that shares the directory with others owns its own JSON
 *  and the files carrying its date — `rgaa-<date>.md`, the annex, the composite. */
function auditFiles(entry: AuditEntry, history: AuditEntry[]): string[] {
  const alone = history.filter((e) => e.dir === entry.dir).length === 1;
  const out: string[] = [];
  const list = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith(".") && fileKind(d.name))
        .map((d) => join(dir, d.name))
        .sort();
    } catch {
      return [];
    }
  };
  for (const f of list(entry.dir)) if (alone || f === entry.file || f.includes(entry.result.date)) out.push(f);
  if (alone) out.push(...list(join(entry.dir, "pages")));
  return out.slice(0, 500);
}

/** The annex that carries Annex I (the application map, #208), when the audit's annex has one. */
function appMapAnnex(entry: AuditEntry, standard: StandardId): string | undefined {
  for (const lang of ["fr", "en"] as Lang[]) {
    const file = join(entry.dir, annexFileName(standard, entry.result.date, lang));
    try {
      if (/^## I\. /m.test(readFileSync(file, "utf8"))) return file;
    } catch {
      // No annex in this language.
    }
  }
  return undefined;
}

export function buildSite(opts: SiteOptions): Site {
  const standard = opts.standard ?? "rgaa";
  const lang = opts.lang;
  const t = T[lang];
  const root = resolve(opts.root ?? ".");
  const mounts: Record<Mount, string> = {
    audits: resolve(opts.auditsDir),
    pages: join(root, PAGES_DIR),
    components: join(root, RENDER_SNAPSHOTS_DIR),
  };
  const ctx: Ctx = { lang, standard, root, mounts, fileRoutes: new Set() };
  const theme = opts.theme ?? NEUTRAL_THEME;
  const history = discoverAudits(mounts.audits);
  const summaries = new Map<string, AuditSummary>();
  const summaryOf = (e: AuditEntry): AuditSummary => {
    let s = summaries.get(e.id);
    if (!s) summaries.set(e.id, (s = summarize(e, standard, lang)));
    return s;
  };
  const routes = new Map<string, () => string>();
  const render = (doc: Doc): string => renderHtmlDocument({ ...doc, navLabel: t.navLabel }, theme);
  const latest = history.at(-1);

  routes.set(P.home, () => render(homeDoc(ctx, history, summaryOf)));

  history.forEach((entry, i) => {
    const isLatest = entry === latest;
    const prev = i > 0 ? history[i - 1] : undefined;
    const r = entry.result;
    const summary = (): AuditSummary => summaryOf(entry);
    // Slugs from the summary's own pages, so a sample page with no snapshot gets one too.
    const slugsOf = (() => {
      let cache: Map<string, string> | undefined;
      return () => (cache ??= pageSlugs(summary().derived.map((p) => p.id)));
    })();
    const snapshots = snapshotIndex(ctx, entry, isLatest);
    const journeys = journeysOf(ctx, entry, isLatest);
    const hasPages = summary().derived.length > 0;

    const navItems = [
      { path: P.home, text: t.home },
      { path: P.audit(entry.id), text: t.dashboard },
      ...(hasPages ? [{ path: P.pagesIndex(entry.id), text: t.pages }] : []),
      ...(prev ? [{ path: P.evolution(entry.id), text: t.evolution }] : []),
      ...(journeys.length ? [{ path: P.journeys(entry.id), text: t.journeys }] : []),
      ...(snapshots ? [{ path: P.components(entry.id), text: t.components }] : []),
      { path: P.files(entry.id), text: t.files },
    ];
    const identity = (from: string): Block => ({
      kind: "para",
      runs: [
        { text: `${t.auditOf(r.date)} · ${t.source} : `, strong: true },
        { text: entry.rel, mono: true, href: relHref(from, fileRoute(ctx, "audits", entry.file) ?? from) },
      ],
    });

    routes.set(P.audit(entry.id), () => {
      const from = P.audit(entry.id);
      const slugs = slugsOf();
      const links = navItems.filter((n) => n.path !== P.home && n.path !== from).map((n) => ({ href: relHref(from, n.path), text: n.text }));
      const doc = indexDoc(r, {
        standard,
        lang,
        nav: navFor(from, navItems),
        links,
        sheetHref: (id) => relHref(from, P.page(entry.id, slugs.get(id) ?? id)),
      });
      doc.blocks.unshift(identity(from));
      return render(doc);
    });

    if (hasPages) {
      routes.set(P.pagesIndex(entry.id), () => {
        const from = P.pagesIndex(entry.id);
        const slugs = slugsOf();
        const doc = pagesIndexDoc(r, {
          standard,
          lang,
          nav: navFor(from, navItems),
          sheetHref: (id) => relHref(from, P.page(entry.id, slugs.get(id) ?? id)),
        });
        doc.blocks.unshift(identity(from), ...averageBlocks(summary(), lang));
        return render(doc);
      });
    }

    // One sheet per derived page. The routes are registered up front (the static export walks
    // them), each rendered on demand.
    const derivedIds = summary().derived.map((p) => p.id);
    for (const pid of derivedIds) {
      const slug = slugsOf().get(pid)!;
      routes.set(P.page(entry.id, slug), () => {
        const from = P.page(entry.id, slug);
        const page = summary().derived.find((p) => p.id === pid)!;
        const shot = screenshotRoute(ctx, entry, pid, isLatest);
        const doc = pageDoc(r, page, { standard, lang, nav: navFor(from, navItems), ...(shot ? { screenshot: relHref(from, shot) } : {}) });
        doc.blocks.unshift(identity(from));
        return render(doc);
      });
    }

    if (prev) {
      routes.set(P.evolution(entry.id), () => {
        const from = P.evolution(entry.id);
        const evo = evolution(summaryOf(prev), summary());
        return render(evolutionDoc(ctx, evo, from, navFor(from, navItems), slugsOf()));
      });
    }
    if (journeys.length) {
      routes.set(P.journeys(entry.id), () => {
        const from = P.journeys(entry.id);
        return render(journeysDoc(ctx, entry, journeys, from, navFor(from, navItems), slugsOf()));
      });
    }
    if (snapshots) {
      routes.set(P.components(entry.id), () => {
        const from = P.components(entry.id);
        const href = (u: { screenshot?: string }): string | undefined => {
          if (!isLatest || !u.screenshot) return undefined;
          const route = fileRoute(ctx, "components", resolve(root, u.screenshot));
          return route ? relHref(from, route) : undefined;
        };
        const view = { ...r, scope: { ...r.scope, renders: { ...(r.scope.renders ?? {}), snapshots } as RenderScope } };
        const blocks = renderSnapshotBlocks(view, lang, href);
        if (!isLatest) blocks.splice(1, 0, { kind: "note", tone: "info", runs: ticks(t.componentsOld) });
        return render({
          lang,
          title: `${t.componentsTitle} — ${t.auditOf(r.date)}`,
          nav: navFor(from, navItems),
          blocks: [identity(from), ...(blocks.length ? blocks.slice(1) : [{ kind: "para", runs: ticks(t.noComponents) } as Block])],
        });
      });
    }
    routes.set(P.files(entry.id), () => {
      const from = P.files(entry.id);
      return render(filesDoc(ctx, entry, history, isLatest, from, navFor(from, navItems), summary(), slugsOf()));
    });
  });

  return { routes, fileRoutes: ctx.fileRoutes, mounts, history };
}

/** The page screenshot for one audit: the copy `pages --format report` put beside the audit
 *  (`assets/<id>.png`), else — for the latest audit only — the capture in `.ultra11y/pages`.
 *  An older audit is never shown today's capture: it would be a picture of another page state. */
function screenshotRoute(ctx: Ctx, entry: AuditEntry, pageId: string, latest: boolean): string | undefined {
  for (const name of [`${pageId}.png`]) {
    const copy = join(entry.dir, "assets", name);
    if (existsSync(copy)) {
      const route = fileRoute(ctx, "audits", copy);
      if (route) return route;
    }
  }
  if (!latest) return undefined;
  const shot = pageScreenshot(ctx.mounts.pages, pageId);
  return shot ? fileRoute(ctx, "pages", shot) : undefined;
}

function averageBlocks(s: AuditSummary, lang: Lang): Block[] {
  const t = T[lang];
  const avg = s.average;
  if (!avg) return [];
  const out: Block[] = [{ kind: "para", runs: [{ text: avg.pct === null ? t.averageNone : t.averageLine(avg.pct, avg.pages.length), strong: true }] }];
  const notes: string[] = [];
  if (avg.pct !== null && avg.open > 0) notes.push(t.averageOpen(avg.open));
  if (avg.excluded.length) notes.push(t.averageExcluded(avg.excluded.length));
  if (notes.length) out.push({ kind: "note", tone: "warn", runs: [{ text: notes.join(" ") }] });
  return out;
}

function homeDoc(ctx: Ctx, history: AuditEntry[], summaryOf: (e: AuditEntry) => AuditSummary): Doc {
  const t = T[ctx.lang];
  const from = P.home;
  const latest = history.at(-1);
  const nav = navFor(from, [{ path: P.home, text: t.home }, ...(latest ? [{ path: P.audit(latest.id), text: t.dashboard }] : [])]);
  const rows: Cell[][] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]!;
    const s = summaryOf(e);
    const prev = i > 0 ? summaryOf(history[i - 1]!) : undefined;
    const evo = prev ? evolution(prev, s) : undefined;
    rows.push([
      { text: e.id === e.result.date ? e.result.date : `${e.result.date} (${e.id})`, href: relHref(from, P.audit(e.id)) },
      { text: e.rel, mono: true },
      { text: rateText(s.rate), align: "end" },
      { text: s.average?.pct === null || s.average === undefined ? "—" : `${s.average.pct} %`, align: "end" },
      { text: String(s.totals.c), align: "end" },
      { text: String(s.totals.nc), align: "end" },
      { text: String(s.totals.na), align: "end" },
      { text: String(s.totals.manual), align: "end" },
      evo ? { text: t.points(evo.rateDelta), href: relHref(from, P.evolution(e.id)), align: "end" } : { text: "—", align: "end" },
    ]);
  }
  const blocks: Block[] = [
    { kind: "para", runs: [{ text: t.historyCount(history.length) }] },
    { kind: "heading", level: 2, text: t.historyTitle, id: "history" },
    {
      kind: "table",
      caption: t.historyCaption,
      columns: [
        { text: t.audit },
        { text: t.source },
        { text: t.rate, align: "end" },
        { text: t.average, align: "end" },
        { text: t.c, align: "end" },
        { text: t.nc, align: "end" },
        { text: t.na, align: "end" },
        { text: t.manual, align: "end" },
        { text: t.delta, align: "end" },
      ],
      rows,
    },
    { kind: "note", tone: "info", runs: ticks(t.rateNote) },
  ];
  if (latest) {
    const s = summaryOf(latest);
    blocks.push({ kind: "heading", level: 2, text: t.latestTitle, id: "latest" });
    const items: Run[][] = [[{ text: t.openLatest(latest.result.date), href: relHref(from, P.audit(latest.id)) }]];
    items.push([{ text: `${t.rate} : `, strong: true }, { text: rateText(s.rate) }]);
    if (s.average) items.push([{ text: `${t.average} : `, strong: true }, { text: s.average.pct === null ? "—" : `${s.average.pct} %` }]);
    const prev = history.at(-2);
    if (prev) {
      const evo = evolution(summaryOf(prev), s);
      items.push([{ text: t.changedCount(evo.changes.length) }]);
      items.push([{ text: t.openEvolution(prev.result.date, latest.result.date), href: relHref(from, P.evolution(latest.id)) }]);
    }
    blocks.push({ kind: "list", items });
    if (!prev) blocks.push({ kind: "para", runs: [{ text: t.firstAudit, em: true }] });
  }
  return { lang: ctx.lang, title: `${t.siteTitle} — ${standardLabel(ctx.standard)}`, nav, blocks };
}

function evolutionDoc(ctx: Ctx, evo: Evolution, from: string, nav: NavLink[], slugs: Map<string, string>): Doc {
  const t = T[ctx.lang];
  const a = evo.from.entry.result.date;
  const b = evo.to.entry.result.date;
  const blocks: Block[] = [
    {
      kind: "para",
      runs: [
        { text: `${t.previous} : `, strong: true },
        { text: t.auditOf(a), href: relHref(from, P.audit(evo.from.entry.id)) },
      ],
    },
    { kind: "heading", level: 2, text: t.ratesTitle, id: "rates" },
    {
      kind: "table",
      caption: t.ratesCaption,
      columns: [{ text: t.measure }, { text: t.before, align: "end" }, { text: t.after, align: "end" }, { text: t.delta, align: "end" }],
      rows: [
        [
          { text: t.rate },
          { text: rateText(evo.from.rate), align: "end" },
          { text: rateText(evo.to.rate), align: "end" },
          { text: t.points(evo.rateDelta), align: "end" },
        ],
        ...(evo.from.average || evo.to.average
          ? [
              [
                { text: t.average },
                { text: evo.from.average?.pct == null ? "—" : `${evo.from.average.pct} %`, align: "end" as const },
                { text: evo.to.average?.pct == null ? "—" : `${evo.to.average.pct} %`, align: "end" as const },
                { text: t.points(evo.averageDelta), align: "end" as const },
              ],
            ]
          : []),
      ],
    },
    { kind: "heading", level: 2, text: t.totalsTitle, id: "totals" },
    {
      kind: "table",
      caption: t.totalsCaption,
      columns: [{ text: t.status }, { text: t.before, align: "end" }, { text: t.after, align: "end" }, { text: t.delta, align: "end" }],
      rows: (
        [
          [t.c, "c"],
          [t.nc, "nc"],
          [t.na, "na"],
          [t.manual, "manual"],
        ] as const
      ).map(([label, k]) => {
        const x = evo.from.totals[k];
        const y = evo.to.totals[k];
        return [
          { text: label },
          { text: String(x), align: "end" as const },
          { text: String(y), align: "end" as const },
          { text: y - x > 0 ? `+${y - x}` : y - x < 0 ? `−${x - y}` : "0", align: "end" as const },
        ];
      }),
    },
    { kind: "heading", level: 2, text: t.changesTitle, id: "changes" },
    { kind: "note", tone: "info", runs: ticks(t.legend) },
  ];
  if (!evo.changes.length) blocks.push({ kind: "para", runs: [{ text: t.noChanges }] });
  else
    blocks.push({
      kind: "table",
      caption: t.changesCaption,
      columns: [{ text: t.criterion }, { text: t.before }, { text: t.after }, { text: t.change }],
      rows: evo.changes.map((c) => [{ text: c.label }, statusCell(c.before, t.absent), statusCell(c.after, t.absent), { text: t.kind[c.kind] }]),
    });
  if (evo.pages.length) {
    blocks.push({ kind: "heading", level: 2, text: t.pagesTitle, id: "pages" });
    blocks.push({
      kind: "table",
      caption: t.pagesCaption,
      columns: [{ text: t.page }, { text: t.before, align: "end" }, { text: t.after, align: "end" }, { text: t.delta, align: "end" }],
      rows: evo.pages.map((p) => {
        const slug = slugs.get(p.id);
        return [
          { text: `${p.name} (${p.url})`, ...(p.after && slug ? { href: relHref(from, P.page(evo.to.entry.id, slug)) } : {}) },
          { text: p.before ? pageRateText(p.before) : t.newPage, align: "end" as const },
          { text: p.after ? pageRateText(p.after) : t.removedPage, align: "end" as const },
          { text: t.points(p.delta), align: "end" as const },
        ];
      }),
    });
  }
  // The whole grid, both columns side by side: the changes above are its rows that differ.
  const grid: Block = { kind: "table", caption: t.gridCaption, columns: [{ text: t.criterion }, { text: t.before }, { text: t.after }], rows: [] };
  let group = "";
  for (const g of evo.grid) {
    if (g.group !== group) {
      group = g.group;
      grid.rows.push([{ text: group, colspan: 3 }]);
    }
    grid.rows.push([{ text: g.label }, statusCell(g.before, t.absent), statusCell(g.after, t.absent)]);
  }
  blocks.push({ kind: "heading", level: 2, text: t.gridTitle, id: "grid" }, grid);
  return { lang: ctx.lang, title: t.evolutionTitle(a, b), subtitle: [{ text: standardLabel(ctx.standard) }], nav, blocks };
}

function journeysDoc(ctx: Ctx, entry: AuditEntry, journeys: JourneyRecord[], from: string, nav: NavLink[], slugs: Map<string, string>): Doc {
  const t = T[ctx.lang];
  const blocks: Block[] = [{ kind: "para", runs: [{ text: t.journeysIntro(journeys.length) }] }];
  for (const j of journeys) {
    blocks.push({ kind: "heading", level: 2, text: j.name });
    blocks.push({
      kind: "list",
      items: [
        [
          { text: `${t.journeyFile} : `, strong: true },
          { text: j.file, mono: true },
        ],
        [{ text: `${t.journeyStatus} : `, strong: true }, { text: t.journeyState[j.status] ?? j.status }, ...(j.reason ? [{ text: ` — ${j.reason}` }] : [])],
        [{ text: `${t.keyboardMode} : `, strong: true }, { text: j.keyboard ? t.yes : t.no }],
      ],
    });
    blocks.push({
      kind: "table",
      caption: t.stepsCaption(j.name),
      columns: [{ text: t.stepN, align: "end" }, { text: t.step }, { text: t.status }, { text: t.keyboard }, { text: t.pageState }, { text: t.note }],
      rows: j.steps.map((s) => {
        const slug = s.page ? slugs.get(s.page) : undefined;
        return [
          { text: String(s.n), align: "end" as const },
          { text: s.label, mono: true },
          { text: t.stepStatus[s.status] ?? s.status },
          { text: s.keyboard ? (t.keyboardHow[s.keyboard] ?? s.keyboard) : "—" },
          s.page ? { text: s.page, mono: true, ...(slug ? { href: relHref(from, P.page(entry.id, slug)) } : {}) } : { text: "—" },
          { text: [s.reason, s.note].filter(Boolean).join(" — ") || "—" },
        ];
      }),
    });
  }
  return { lang: ctx.lang, title: `${t.journeysTitle} — ${t.auditOf(entry.result.date)}`, nav, blocks };
}

function filesDoc(
  ctx: Ctx,
  entry: AuditEntry,
  history: AuditEntry[],
  latest: boolean,
  from: string,
  nav: NavLink[],
  summary: AuditSummary,
  slugs: Map<string, string>,
): Doc {
  const t = T[ctx.lang];
  const blocks: Block[] = [];
  const files = auditFiles(entry, history);
  const rows: Cell[][] = [];
  for (const f of files) {
    const route = fileRoute(ctx, "audits", f);
    if (!route) continue;
    let bytes = 0;
    try {
      bytes = statSync(f).size;
    } catch {
      continue;
    }
    rows.push([
      { text: relative(ctx.mounts.audits, f).split(sep).join("/"), mono: true, href: relHref(from, route) },
      { text: t.kinds[fileKind(f) ?? "text"] ?? "—" },
      { text: size(bytes, ctx.lang), align: "end" },
    ]);
  }
  blocks.push({ kind: "heading", level: 2, text: t.docsTitle, id: "documents" });
  if (rows.length)
    blocks.push({ kind: "table", caption: t.docsCaption, columns: [{ text: t.fileName }, { text: t.fileKind }, { text: t.fileSize, align: "end" }], rows });
  else blocks.push({ kind: "para", runs: [{ text: t.noFiles }] });

  const annex = appMapAnnex(entry, ctx.standard);
  const annexRoute = annex ? fileRoute(ctx, "audits", annex) : undefined;
  if (annexRoute) {
    blocks.push({ kind: "heading", level: 2, text: t.appMapTitle, id: "app-map" });
    blocks.push({ kind: "list", items: [[{ text: t.appMap, href: relHref(from, annexRoute) }]] });
  }

  if (summary.derived.length) {
    blocks.push({ kind: "heading", level: 2, text: t.shotsTitle, id: "screenshots" });
    if (!latest) blocks.push({ kind: "note", tone: "info", runs: ticks(t.shotsOld) });
    blocks.push({
      kind: "table",
      caption: t.shotsCaption,
      columns: [{ text: t.page }, { text: t.capture }],
      rows: summary.derived.map((p) => {
        const shot = screenshotRoute(ctx, entry, p.id, latest);
        const slug = slugs.get(p.id);
        return [
          { text: p.name, ...(slug ? { href: relHref(from, P.page(entry.id, slug)) } : {}) },
          shot ? { text: shot.split("/").slice(2).join("/"), mono: true, href: relHref(from, shot) } : { text: t.noShot },
        ];
      }),
    });
  }
  return { lang: ctx.lang, title: `${t.filesTitle} — ${t.auditOf(entry.result.date)}`, nav, blocks };
}

function notFoundHtml(lang: Lang, theme: Theme): string {
  const t = T[lang];
  // Server-only page, at whatever depth the bad URL had: the one link it carries is absolute.
  return renderHtmlDocument(
    {
      lang,
      title: t.notFoundTitle,
      navLabel: t.navLabel,
      blocks: [
        { kind: "para", runs: [{ text: t.notFound }] },
        { kind: "list", items: [[{ text: t.backHome, href: "/index.html" }]] },
      ],
    },
    theme,
  );
}

// ---- the server ------------------------------------------------------------------------

/** Headers every response carries. The pages carry no script and load nothing from outside,
 *  so the policy can forbid both outright; `nosniff` keeps a served `.md` from being run as
 *  HTML. */
const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const CSP = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface ServeOptions extends SiteOptions {
  /** Bind address. Default 127.0.0.1: the results stay on this machine unless asked. */
  host?: string;
  /** Requested port; 0 picks a free one. Default DEFAULT_PORT. */
  port?: number;
  /** How many successive ports are tried when the requested one is busy. */
  portTries?: number;
}

export interface RunningServer {
  server: Server;
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host) || /^127\./.test(host);
}

/** The site, rebuilt only when the audits directory's JSON changed — a new audit appears on
 *  the next request, and an unchanged directory is not re-read on every page. */
function siteCache(opts: SiteOptions): () => Site {
  let sig: string | undefined;
  let site: Site | undefined;
  return () => {
    const now = historySignature(resolve(opts.auditsDir));
    if (!site || now !== sig) {
      site = buildSite(opts);
      sig = now;
    }
    return site;
  };
}

function send(res: ServerResponse, status: number, type: string, body: string | Buffer, head: boolean, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...BASE_HEADERS, "Content-Type": type, "Content-Length": String(Buffer.byteLength(body)), ...extra });
  res.end(head ? undefined : body);
}

/** One request. Exported for the tests; `startServer` wires it to node:http. */
export function handleRequest(
  getSite: () => Site,
  opts: { lang: Lang; theme: Theme; allowedHosts?: Set<string> },
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const head = req.method === "HEAD";
  const html = "text/html; charset=utf-8";
  const text = "text/plain; charset=utf-8";
  if (req.method !== "GET" && !head) {
    send(res, 405, text, "Method Not Allowed\n", false, { Allow: "GET, HEAD" });
    return;
  }
  // DNS rebinding: a page on another origin that resolves its own name to 127.0.0.1 would
  // otherwise read these results. On loopback, only a loopback Host is answered.
  if (opts.allowedHosts && !opts.allowedHosts.has(String(req.headers.host ?? "").toLowerCase())) {
    send(res, 403, text, "Forbidden host\n", head);
    return;
  }
  const segs = parseRequestPath(req.url);
  if (!segs) {
    send(res, 400, text, "Bad Request\n", head);
    return;
  }
  try {
    const site = getSite();
    const joined = segs.join("/");
    const path = joined === "" ? P.home : joined.endsWith("/") ? `${joined}index.html` : joined;
    const page = site.routes.get(path);
    if (page) {
      send(res, 200, html, page(), head, { "Content-Security-Policy": CSP });
      return;
    }
    const file = segs.at(-1) === "" ? undefined : fileOfRoute(site.mounts, segs);
    if (!file) {
      send(res, 404, html, notFoundHtml(opts.lang, opts.theme), head, { "Content-Security-Policy": CSP });
      return;
    }
    const type = CONTENT_TYPES[extname(file).toLowerCase()]!;
    const st = statSync(file);
    const extra: Record<string, string> = type.startsWith("text/html") || type === "image/svg+xml" ? { "Content-Security-Policy": CSP } : {};
    res.writeHead(200, { ...BASE_HEADERS, "Content-Type": type, "Content-Length": String(st.size), ...extra });
    if (head) {
      res.end();
      return;
    }
    createReadStream(file)
      .on("error", () => res.destroy())
      .pipe(res);
  } catch {
    if (!res.headersSent) send(res, 500, text, "Internal Server Error\n", head);
    else res.destroy();
  }
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((ok, ko) => {
    const onError = (e: Error): void => {
      server.off("listening", onListening);
      ko(e);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const addr = server.address();
      ok(typeof addr === "object" && addr ? addr.port : port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

/** Start the read-only results server. A busy port is skipped for the next one, up to
 *  `portTries` times; port 0 asks the system for a free one. */
export async function startServer(opts: ServeOptions): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  const theme = opts.theme ?? NEUTRAL_THEME;
  const getSite = siteCache(opts);
  const allowedHosts = new Set<string>();
  const handlerOpts = { lang: opts.lang, theme, ...(isLoopback(host) ? { allowedHosts } : {}) };
  const server = createServer((req, res) => handleRequest(getSite, handlerOpts, req, res));
  const wanted = opts.port ?? DEFAULT_PORT;
  const tries = wanted === 0 ? 1 : Math.max(1, opts.portTries ?? PORT_TRIES);
  let port = -1;
  for (let i = 0; i < tries; i++) {
    try {
      port = await listen(server, wanted === 0 ? 0 : wanted + i, host);
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" || i === tries - 1) throw e;
    }
  }
  for (const h of ["127.0.0.1", "localhost", "[::1]", host.includes(":") ? `[${host}]` : host]) allowedHosts.add(`${h}:${port}`.toLowerCase());
  const shown = host.includes(":") ? `[${host}]` : host;
  return {
    server,
    host,
    port,
    url: `http://${shown}:${port}/`,
    close: () =>
      new Promise<void>((ok) => {
        server.closeAllConnections?.();
        server.close(() => ok());
      }),
  };
}

// ---- the static export -----------------------------------------------------------------

export interface StaticResult {
  outDir: string;
  pages: number;
  files: number;
}

/** Write every page of the site under `outDir`, then copy exactly the files they reference,
 *  into the same relative layout — so every link resolves, from any sub-path. Refuses an
 *  output directory that overlaps the audits directory: the export would end up in its own
 *  history, or overwrite the audits it is a copy of. */
export function exportStatic(opts: SiteOptions & { outDir: string }): StaticResult {
  const out = resolve(opts.outDir);
  const audits = resolve(opts.auditsDir);
  if (out === audits || isInside(audits, out) || isInside(out, audits)) {
    throw new Error(`the static export directory (${opts.outDir}) must not contain, or sit inside, the audits directory (${opts.auditsDir}).`);
  }
  const site = buildSite(opts);
  let pages = 0;
  for (const [path, render] of site.routes) {
    const target = join(out, ...path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, render());
    pages++;
  }
  let files = 0;
  for (const route of [...site.fileRoutes].sort()) {
    const src = fileOfRoute(site.mounts, route.split("/"));
    if (!src) continue;
    const target = join(out, ...route.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(src, target);
    files++;
  }
  // GitHub Pages runs Jekyll by default, which drops paths it considers private; the export
  // is plain files and wants them served as they are.
  writeFileSync(join(out, ".nojekyll"), "");
  return { outDir: out, pages, files };
}
