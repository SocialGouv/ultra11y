// THE IMPURE HALF of the HTML tier: read the image bytes, decide what fits, write the files.
//
// src/html.ts renders; src/html-report.ts decides what a criterion IS. This module owns the
// only two things neither of them may touch — the filesystem, and the SIZE POLICY.
//
// The size policy exists because the composite is a single self-contained file: every crop it
// shows travels inside it as a data: URI, and base64 costs a third more than the bytes it
// encodes. A 38-page RGAA audit with 200 crops can reach tens of megabytes, which is a file
// no reviewer opens twice. So there is a budget and a LADDER — and the rule the ladder obeys
// is that IMAGES DEGRADE AND NON-CONFORMITIES NEVER DO. Every rung is announced in the
// document itself and on stderr; nothing is dropped quietly.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingId } from "./baseline.js";
import type { EvidenceManifest } from "./evidence.js";
import { renderHtmlDocument, type Doc, type Run } from "./html.js";
import { compositeDoc, indexDoc, pageDoc, pagesIndexDoc, type CropLookup } from "./html-report.js";
import { derivePages, pagesOf } from "./pages.js";
import { CORE, type StandardId, isCore, loadPack } from "./standards/index.js";
import type { AuditResult, Finding, Lang } from "./types.js";

/** 12 MB of inlined image data. Chosen so the composite stays inside what a browser opens
 *  from a file:// URL without visible strain, and well under the artifact limits. */
export const DEFAULT_INLINE_BUDGET = 12 * 1024 * 1024;

/** The rungs, in the order they are climbed. Each drops the LEAST specific evidence first:
 *  a full-page screenshot says less about a non-conformity than a crop of the element does. */
export type DegradeStep = "screenshots" | "crops" | "none";

export interface EmitOpts {
  outDir: string;
  standard?: StandardId;
  lang?: Lang;
  /** The evidence tier's manifest — absolute paths and per-language alt text. */
  evidence?: EvidenceManifest;
  /** pageId → absolute path of the page screenshot. */
  screenshots?: Map<string, string>;
  /** Bytes of inlined image data the composite may carry. */
  inlineBudget?: number;
  /** Also write the navigable page sheets. */
  pages?: boolean;
  /** WHERE the sheets go, and what `index.html` is.
   *
   *  `report` (the default, for `report --html`): `index.html` is the dashboard and the sheets
   *  sit in `pages/`. `pages` (for `pages --html`): `index.html` IS the page index and the
   *  sheets sit beside it — mirroring exactly where that command already writes its Markdown,
   *  so `--out audits/pages` does not produce `audits/pages/pages/`. */
  layout?: "report" | "pages";
}

export interface EmitResult {
  /** The entry point — always written. */
  index: string;
  /** The detachable, printable single file. */
  composite: string;
  /** The page site's sheets, when `pages` was asked for. */
  sheets: string[];
  inlinedBytes: number;
  degraded: DegradeStep[];
  /** True at the last rung: not one image fit. The caller decides what that costs. */
  imagesDropped: boolean;
  /** Localized, for stderr. The same sentences are written into the document. */
  notices: string[];
}

const T = {
  fr: {
    overComposite: (mb: string, budget: string) =>
      `Les images dépassent le budget d'inclusion (${mb} Mo pour ${budget} Mo) : les captures de page ne sont pas incluses dans le fichier composite. Elles restent dans le rapport page par page.`,
    overCrops: (mb: string, budget: string) =>
      `Les images dépassent encore le budget (${mb} Mo pour ${budget} Mo) : une seule vignette par critère est incluse. Le rapport page par page les porte toutes.`,
    overNone: (budget: string) =>
      `Aucune image ne tient dans le budget de ${budget} Mo : le fichier composite est sans illustration. Les non-conformités, elles, y sont toutes. Augmentez \`--inline-budget\`, ou ouvrez le rapport page par page, qui référence les images au lieu de les inclure.`,
    docTitle: "Rapport complet, en un seul fichier (imprimable en PDF)",
    pagesTitle: "Rapport page par page",
    indexTitle: "Tableau de bord",
  },
  en: {
    overComposite: (mb: string, budget: string) =>
      `Images exceed the inline budget (${mb} MB for ${budget} MB): page screenshots are not embedded in the composite file. They remain in the page-by-page report.`,
    overCrops: (mb: string, budget: string) =>
      `Images still exceed the budget (${mb} MB for ${budget} MB): one crop per criterion is embedded. The page-by-page report carries them all.`,
    overNone: (budget: string) =>
      `No image fits within the ${budget} MB budget: the composite file carries no illustration. Every non-conformity is still in it. Raise \`--inline-budget\`, or open the page-by-page report, which references images instead of embedding them.`,
    docTitle: "Full report, in a single file (printable to PDF)",
    pagesTitle: "Page-by-page report",
    indexTitle: "Dashboard",
  },
} as const;

const mb = (n: number): string => (n / (1024 * 1024)).toFixed(1);

/** The base64 cost of a file, or 0 when it cannot be read. A missing image degrades the
 *  document; it never fails the run. */
function inlineSize(path: string): number {
  try {
    return Math.ceil(statSync(path).size / 3) * 4;
  } catch {
    return 0;
  }
}

function dataUri(path: string): string | undefined {
  try {
    return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return undefined;
  }
}

/** Crops keyed by finding, as the report tier wants them: a lookup, not a manifest.
 *  `hrefOf` decides whether the image travels as a file reference or as a data: URI. */
function cropLookup(m: EvidenceManifest | undefined, lang: Lang, hrefOf: (path: string, href: string) => string | undefined): CropLookup {
  if (!m) return () => undefined;
  return (f: Finding) => {
    const c = m.crops.get(findingId(f));
    if (!c) return undefined;
    const href = hrefOf(c.path, c.href);
    return href ? { href, alt: c.alt[lang] } : undefined;
  };
}

/** Which rung the evidence lands on for a given budget. Pure — the sizes are measured once
 *  and the decision is taken before a single byte is encoded. */
export function pickRung(cropBytes: number[], shotBytes: number[], budget: number): { steps: DegradeStep[]; cropsPerCriterion: number; shots: boolean } {
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  if (sum(cropBytes) + sum(shotBytes) <= budget) return { steps: [], cropsPerCriterion: Number.POSITIVE_INFINITY, shots: true };
  if (sum(cropBytes) <= budget) return { steps: ["screenshots"], cropsPerCriterion: Number.POSITIVE_INFINITY, shots: false };
  // One crop per criterion is the smallest illustration that still says something: it shows
  // WHAT the defect looks like, and the occurrence table still lists every place it occurs.
  const smallest = [...cropBytes].sort((a, b) => a - b);
  let kept = 0;
  let total = 0;
  for (const b of smallest) {
    if (total + b > budget) break;
    total += b;
    kept++;
  }
  if (!kept) return { steps: ["screenshots", "crops", "none"], cropsPerCriterion: 0, shots: false };
  return { steps: ["screenshots", "crops"], cropsPerCriterion: 1, shots: false };
}

/** Write the artifact's HTML: the entry point, the composite, and — on request — the site. */
export function writeHtml(result: AuditResult, opts: EmitOpts): EmitResult {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const t = T[lang];
  const budget = opts.inlineBudget ?? DEFAULT_INLINE_BUDGET;
  const stdKey = isCore(standard) ? "wcag" : loadPack(standard).key;
  mkdirSync(opts.outDir, { recursive: true });

  const crops = [...(opts.evidence?.crops.values() ?? [])];
  const shots = [...(opts.screenshots?.values() ?? [])];
  const rung = pickRung(
    crops.map((c) => inlineSize(c.path)),
    shots.map(inlineSize),
    budget,
  );

  const notices: string[] = [];
  if (rung.steps.includes("none")) notices.push(t.overNone(mb(budget)));
  else if (rung.steps.includes("crops")) notices.push(t.overCrops(mb(crops.reduce((a, c) => a + inlineSize(c.path), 0)), mb(budget)));
  else if (rung.steps.includes("screenshots"))
    notices.push(t.overComposite(mb(crops.reduce((a, c) => a + inlineSize(c.path), 0) + shots.reduce((a, s) => a + inlineSize(s), 0)), mb(budget)));

  // ---- the composite: every image it shows travels inside it ----
  let inlinedBytes = 0;
  const perCriterion = new Map<string, number>();
  const inlineCrops = cropLookup(opts.evidence, lang, (path) => {
    if (rung.cropsPerCriterion === 0) return undefined;
    const uri = dataUri(path);
    if (!uri) return undefined;
    inlinedBytes += uri.length;
    return uri;
  });
  const budgetedCrops: CropLookup = (f) => {
    const c = opts.evidence?.crops.get(findingId(f));
    if (!c) return undefined;
    const n = perCriterion.get(c.criteriaId) ?? 0;
    if (n >= rung.cropsPerCriterion) return undefined;
    const drawn = inlineCrops(f);
    if (drawn) perCriterion.set(c.criteriaId, n + 1);
    return drawn;
  };

  // The two layouts differ in exactly two places: where a sheet is written, and what
  // `index.html` is. Everything below reads `up` and `sheetDir`, so neither can drift.
  const flat = opts.layout === "pages";
  const sheetDir = flat ? opts.outDir : join(opts.outDir, "pages");
  const up = flat ? "./" : "../";

  const compositeName = `ultra11y-${stdKey}-${result.date}.html`;
  const nav = [
    { href: "./index.html", text: flat ? t.pagesTitle : t.indexTitle },
    { href: `./${compositeName}`, text: t.docTitle },
    ...(opts.pages && !flat ? [{ href: "./pages/index.html", text: t.pagesTitle }] : []),
  ];
  const composite = compositeDoc(result, { standard, lang, crops: budgetedCrops, nav: nav.map((n) => ({ ...n, current: n.href === `./${compositeName}` })) });
  if (notices.length) composite.blocks.unshift({ kind: "note", tone: "warn", runs: noticeRuns(notices) });
  const compositePath = join(opts.outDir, compositeName);
  writeFileSync(compositePath, renderHtmlDocument(composite));

  // Images stay FILES on the sheets, so the same crop is not duplicated into every document
  // that shows it. Only the composite pays the base64 tax, because only it has to travel alone.
  const fileCrops = cropLookup(opts.evidence, lang, (_p, href) => href.replace(/^\.\//, up));

  // ---- the entry point: links and numbers, never an image ----
  const indexNav = nav.map((n) => ({ ...n, current: n.href === "./index.html" }));
  const index = flat
    ? pagesIndexDoc(result, { standard, lang, nav: indexNav, sheetHref: (id) => `./page-${id}.html` })
    : indexDoc(result, { standard, lang, nav: indexNav, links: nav.filter((n) => n.href !== "./index.html") });
  const indexPath = join(opts.outDir, "index.html");
  writeFileSync(indexPath, renderHtmlDocument(index));

  const sheets: string[] = [];
  if (opts.pages) {
    const derived = derivePages(result, pagesOf(result));
    mkdirSync(sheetDir, { recursive: true });
    const sheetNav = [
      { href: `${up}index.html`, text: flat ? t.pagesTitle : t.indexTitle },
      { href: `${up}${compositeName}`, text: t.docTitle },
      ...(flat ? [] : [{ href: "./index.html", text: t.pagesTitle }]),
    ];
    // In the nested layout the page index is its own document; flat, `index.html` already is it.
    if (!flat) {
      writeFileSync(
        join(sheetDir, "index.html"),
        renderHtmlDocument(
          pagesIndexDoc(result, {
            standard,
            lang,
            nav: sheetNav.map((n) => ({ ...n, current: n.href === "./index.html" })),
            sheetHref: (id) => `./page-${id}.html`,
          }),
        ),
      );
      sheets.push(join(sheetDir, "index.html"));
    }
    for (const p of derived) {
      const doc = pageDoc(result, p, {
        standard,
        lang,
        crops: fileCrops,
        nav: sheetNav,
        // Where `cmdPages`' screenshot copier already put the capture: `assets/<id>.png`,
        // beside the entry point, seen from wherever this sheet sits.
        ...(opts.screenshots?.has(p.id) ? { screenshot: `${up}assets/${p.id}.png` } : {}),
      });
      const path = join(sheetDir, `page-${p.id}.html`);
      writeFileSync(path, renderHtmlDocument(doc));
      sheets.push(path);
    }
  }

  return { index: indexPath, composite: compositePath, sheets, inlinedBytes, degraded: rung.steps, imagesDropped: rung.steps.includes("none"), notices };
}

function noticeRuns(notices: string[]): Run[] {
  return notices.flatMap((n, i) => (i ? [{ text: " " }, { text: n }] : [{ text: n }]));
}

/** The composite's own filename, so the CLI can report it without rebuilding the rule. */
export function compositeFileName(standard: StandardId, date: string): string {
  return `ultra11y-${isCore(standard) ? "wcag" : loadPack(standard).key}-${date}.html`;
}

/** Every `src`/`href` the emitted pages carry, for the self-containment gate. A report that
 *  points outside its own directory is a report that breaks the moment it is unzipped
 *  somewhere else — which is the only way anyone ever reads an artifact. */
export function externalReferences(html: string, depth: number): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1]!;
    if (ref.startsWith("#") || ref.startsWith("data:")) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) {
      out.push(ref); // an absolute URL — http:, file:, anything
      continue;
    }
    // Count how far the relative path climbs; more than the document's own depth escapes.
    let climbs = 0;
    for (const seg of ref.split("/")) if (seg === "..") climbs++;
    if (climbs > depth) out.push(ref);
  }
  return out;
}

/** Convenience for a caller that only wants the single file. */
export function renderComposite(result: AuditResult, opts: { standard?: StandardId; lang?: Lang } = {}): string {
  return renderHtmlDocument(compositeDoc(result, opts) as Doc);
}
