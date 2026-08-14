// EVIDENCE TIER — a non-conformity, shown.
//
// A rendered finding cites `.ultra11y/pages/accueil/dom.html:412` (`div.card`), and under the
// rules that anchor at the document element it cites `dom.html:2` — the same line, for
// hundreds of findings at once. `selectorHint` is doing all the locating work and it is lossy
// by construction (src/rules/rule.ts `selectorOf`: first class only, href truncated). For a
// reviewer who did not write the page, that is not a location. A picture is.
//
// Everything this needs is already on disk and already verified:
//   • `screen.png`  — the page as the browser painted it
//   • `boxes.json`  — every element's rect, joined to the DOM by document-order ordinal
//   • `Finding.sourceStart` — the byte offset of the anchoring element in that same dom.html
// So the join is `sourceStart -> ordinal -> box -> pixels`, with no new capture, no new
// dependency, and no new field on Finding.
//
// WHY DERIVE, NOT STAMP. A box could have been written onto Finding when the rule fired.
// It is not, deliberately: a pixel rectangle is a property of an IMAGE, not of a finding. A
// stamped box survives into the audit JSON and goes silently wrong the moment that JSON is
// re-rendered against a re-captured page — and silently wrong is the one failure mode this
// engine refuses. Deriving re-runs the same verified join every time, and refuses wholesale
// when it does not hold, exactly as `align()` already does for styles and boxes.
//
// WHAT IT REFUSES, AND WHAT IT NEVER COUNTED. Two different things, and conflating them is
// how a report starts lying about its own coverage.
//
// NOT COUNTED: a finding raised on source code. It is not an occurrence this tier failed to
// draw, it is an occurrence outside the tier — so it never enters `located`, and a repository
// audited from source alone gets NO notice rather than one line per finding saying pixels
// were never involved. The filter is the snapshot PATH (`byPage` below).
//
// REFUSED: a finding that IS on a captured page and still gets no crop. Each of those has a
// reason, recorded and reported rather than left as a gap — a page-scope rule points at
// `<html>` and would "highlight" the whole screenshot, a component capture rendered by jsdom
// paints nothing, and — the one that surprises people — an element below the fold is simply
// not in the image, because every producer captures the VIEWPORT on purpose so the screenshot
// shares boxes.json's coordinate system (src/integrations/playwright.ts). None of these is a
// bug to work around; each is a fact to state.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findingId } from "./baseline.js";
import { parseHtml } from "./parse/html.js";
import { cropImage, decodePng, encodePng, fillRect, strokeRect } from "./pixel.js";
import { PAGES_DIR, alignedBoxes, isSnapshotDom, snapshotDir, validateSnapshotMeta } from "./snapshot.js";
import type { Image, Raster, Rect } from "./pixel.js";
import type { SnapshotMeta, SnapshotViewport } from "./snapshot.js";
import type { AuditResult, BoxDigest, BoxEntry, Finding, Lang } from "./types.js";

/** Why a finding got no picture. Every one of these is REPORTED, never swallowed: a reader
 *  who sees fewer images than non-conformities must be told which, and why.
 *
 *  A VALUE, not only a type, so the documentation can be held against it: `references/pages.md`
 *  publishes this list to auditors, and a reason added here without a row there is a refusal
 *  the reader meets in a report and cannot look up (tests/skill-md.test.ts). */
export const EVIDENCE_SKIPS = [
  "no-snapshot", // the snapshot this finding's own path names is not on disk (audit rendered elsewhere, `.ultra11y/` cleaned)
  "no-screenshot", // the producer captured no image for this page
  "unreadable-image", // screen.png is not 8-bit truecolour, or is corrupt
  "no-boxes", // no boxes.json, or it did not verify against this dom.html
  "truncated", // the collector hit its element cap; this element has no box
  "no-offsets", // the finding carries no sourceStart (cannot be joined)
  "unjoinable", // sourceStart matches no element in dom.html
  "page-scope", // anchored at the document element: the page screenshot IS the illustration
  "zero-area", // the element has no painted box (display:contents, empty inline)
  "below-the-fold", // outside a viewport-only capture
  "unknown-scale", // image-pixels-per-CSS-pixel is indeterminate
  "deduplicated", // the same (rule, element) is already illustrated — one picture, every occurrence
  "capped", // a numeric limit ran out (DEFAULT_CAPS below) — a DISTINCT defect went undrawn
] as const;

export type EvidenceSkip = (typeof EVIDENCE_SKIPS)[number];

export interface EvidenceGeometry {
  /** Context kept around the element, in CSS pixels. */
  pad: number;
  minWidth: number;
  minHeight: number;
  maxWidth: number;
  maxHeight: number;
}

// The MINIMUM is the load-bearing number. A `rendered-link-colour-only` box is a 40×18 inline
// link; cropped tight it is an unreadable smear, and the whole question that rule asks —
// "is this distinguishable from the running text around it?" — is a question about the
// surroundings. So the crop is padded out to something a human can judge.
export const DEFAULT_GEOMETRY: EvidenceGeometry = { pad: 24, minWidth: 320, minHeight: 120, maxWidth: 960, maxHeight: 540 };

/** De-duplication. Issue #16's real audit holds 472 findings of ONE rule across 38 pages for
 *  7 distinct selectors: one image per occurrence would be 472 pictures of the same defect.
 *  One per (page, rule, selector), then hard caps — and the report says what it did not draw. */
export const DEFAULT_CAPS = { perRule: 6, perPage: 12, total: 200 };

export interface PageEvidenceContext {
  pageId: string;
  img: Image;
  /** Image pixels per CSS pixel. Derived, never assumed — see `resolveScale`. */
  scale: number;
  viewport: SnapshotViewport;
  /** `Finding.sourceStart` → document-order ordinal, the key `boxes.json` is joined on. */
  ordinalOf: Map<number, number>;
  boxes: Map<number, BoxEntry>;
  truncated: boolean;
}

export interface EvidenceCrop {
  findingId: string;
  page: string;
  ruleId: string;
  criteriaId: string;
  /** Path relative to the output directory, for a Markdown or HTML `src`. */
  href: string;
  /** Absolute path on disk. */
  path: string;
  width: number;
  height: number;
  box: BoxEntry;
  scale: number;
  /** The element ran past the capture edge: what is drawn is part of it, not all of it. */
  clipped: boolean;
  alt: Record<Lang, string>;
}

export interface EvidencePageTally {
  located: number;
  imaged: number;
  skipped: Partial<Record<EvidenceSkip, number>>;
}

export interface EvidenceManifest {
  crops: Map<string, EvidenceCrop>;
  skipped: Map<string, EvidenceSkip>;
  perPage: Map<string, EvidencePageTally>;
  totals: EvidencePageTally;
}

export interface EvidenceOptions {
  /** Where `assets/<page-id>/` is written. */
  outDir: string;
  /** Repository root holding `.ultra11y/pages`. Defaults to the process cwd. */
  root?: string;
  caps?: Partial<typeof DEFAULT_CAPS>;
  geometry?: Partial<EvidenceGeometry>;
}

// The ring. Red alone would encode the meaning by colour, which is a 1.4.1 failure — and this
// tool exists to find those. So the mark carries three independent channels: a light halo (so
// it survives a dark page), a solid ring, and corner brackets whose SHAPE says "here" with no
// hue at all. A dashed inner line adds texture for a monochrome print.
const HALO = { r: 255, g: 255, b: 255, a: 0.92 };
const MARK = { r: 179, g: 38, b: 30, a: 1 }; // #b3261e — the NC colour the reports already use
const RING = 3;

/** The page id of a snapshot dom.html path, or null when it is not one. */
export function pageIdOfSnapshot(file: string): string | null {
  if (!isSnapshotDom(file)) return null;
  const posix = file.split("\\").join("/");
  const at = posix.lastIndexOf(`${PAGES_DIR}/`);
  if (at < 0) return null;
  const rest = posix.slice(at + PAGES_DIR.length + 1);
  const id = rest.slice(0, rest.indexOf("/"));
  return id || null;
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Image pixels per CSS pixel.
 *
 *  Nothing records `devicePixelRatio`, so it is derived from the image against the viewport
 *  the collector recorded. When that is unusable, the `<html>` box is the fallback — it is by
 *  definition the full viewport width. When BOTH are unusable the answer is genuinely unknown,
 *  and the honest result is no crop: a guessed scale of 1 on a 2× capture rings the wrong half
 *  of the page, which is worse than no picture. */
function resolveScale(img: Image, viewport: SnapshotViewport | undefined, boxes: Map<number, BoxEntry>): number | null {
  const candidates = [viewport?.width, boxes.get(0)?.w];
  for (const w of candidates) {
    if (!w || w <= 0) continue;
    const scale = img.width / w;
    // A capture is 1×, 2× or 3×. Anything outside that band means the image and the boxes do
    // not describe the same render, and pretending otherwise would misplace every ring.
    if (scale >= 0.5 && scale <= 4) return scale;
  }
  return null;
}

/** Open a page snapshot's evidence, or say why it has none. Reads meta.json, dom.html,
 *  boxes.json and screen.png ONLY — styles.json and css.json can be megabytes and answer
 *  nothing here. */
export function loadPageEvidence(root: string, pageId: string): PageEvidenceContext | { skip: EvidenceSkip } {
  const dir = snapshotDir(root, pageId);
  const domFile = join(dir, "dom.html");
  const shotFile = join(dir, "screen.png");
  if (!existsSync(domFile)) return { skip: "no-snapshot" };
  if (!existsSync(shotFile)) return { skip: "no-screenshot" };

  let dom: string;
  let shot: Buffer;
  try {
    dom = readFileSync(domFile, "utf8");
    shot = readFileSync(shotFile);
  } catch {
    return { skip: "no-snapshot" };
  }

  const img = decodePng(shot);
  if (!img) return { skip: "unreadable-image" };

  const digest = readJson<BoxDigest>(join(dir, "boxes.json"));
  if (!digest) return { skip: "no-boxes" };
  const doc = parseHtml(dom, domFile);
  const boxes = alignedBoxes(dom, digest, doc);
  if (!boxes) return { skip: "no-boxes" };

  const scale = resolveScale(img, metaOf(dir)?.viewport, boxes);
  if (scale === null) return { skip: "unknown-scale" };

  const ordinalOf = new Map<number, number>();
  for (let i = 0; i < doc.elements.length; i++) {
    const start = doc.elements[i]?.start;
    if (start !== undefined && !ordinalOf.has(start)) ordinalOf.set(start, i);
  }

  const viewport: SnapshotViewport = metaOf(dir)?.viewport ?? { width: Math.round(img.width / scale), height: Math.round(img.height / scale) };
  return { pageId, img, scale, viewport, ordinalOf, boxes, truncated: Boolean(digest.truncated) };
}

function metaOf(dir: string): SnapshotMeta | undefined {
  const raw = readJson<unknown>(join(dir, "meta.json"));
  if (raw === undefined) return undefined;
  const v = validateSnapshotMeta(raw);
  return v.ok && v.meta ? v.meta : undefined;
}

/** The crop rect around an element box, in IMAGE pixels: padded for context, grown to the
 *  legible minimum, capped at the maximum, and slid back inside the image rather than
 *  hanging off it. */
function cropRect(box: BoxEntry, g: EvidenceGeometry, scale: number, img: Image): Rect {
  const bx = box.x * scale;
  const by = box.y * scale;
  const bw = box.w * scale;
  const bh = box.h * scale;
  const w = Math.min(Math.max(bw + g.pad * 2 * scale, g.minWidth * scale), g.maxWidth * scale, img.width);
  const h = Math.min(Math.max(bh + g.pad * 2 * scale, g.minHeight * scale), g.maxHeight * scale, img.height);
  let x = bx + bw / 2 - w / 2;
  let y = by + bh / 2 - h / 2;
  x = Math.max(0, Math.min(x, img.width - w));
  y = Math.max(0, Math.min(y, img.height - h));
  return { x, y, w, h };
}

/** Ring the element inside its crop. Three channels, none of them colour alone. */
function annotate(raster: Raster, target: Rect): void {
  strokeRect(raster, { x: target.x - RING, y: target.y - RING, w: target.w + RING * 2, h: target.h + RING * 2 }, HALO, RING);
  strokeRect(raster, target, MARK, RING);
  strokeRect(raster, { x: target.x + RING, y: target.y + RING, w: target.w - RING * 2, h: target.h - RING * 2 }, HALO, 1, 6);

  // Corner brackets: a shape cue that survives greyscale, a colour-blind reader and a print.
  const arm = Math.max(6, Math.min(18, Math.round(Math.min(target.w, target.h) / 3)));
  const t = RING;
  const x0 = target.x - RING;
  const y0 = target.y - RING;
  const x1 = target.x + target.w + RING;
  const y1 = target.y + target.h + RING;
  for (const [cx, cy, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    fillRect(raster, { x: dx > 0 ? cx : cx - arm, y: dy > 0 ? cy - t : cy, w: arm, h: t }, MARK);
    fillRect(raster, { x: dx > 0 ? cx - t : cx, y: dy > 0 ? cy : cy - arm, w: t, h: arm }, MARK);
  }
}

export interface CroppedFinding {
  png: Buffer;
  width: number;
  height: number;
  box: BoxEntry;
  scale: number;
  clipped: boolean;
}

/** One finding → one annotated PNG, or the reason there is none. */
export function cropFinding(ctx: PageEvidenceContext, f: Finding, geometry?: Partial<EvidenceGeometry>): CroppedFinding | { skip: EvidenceSkip } {
  const g = { ...DEFAULT_GEOMETRY, ...geometry };
  if (f.sourceStart === undefined) return { skip: "no-offsets" };
  const ordinal = ctx.ordinalOf.get(f.sourceStart);
  if (ordinal === undefined) return { skip: "unjoinable" };
  // The document element: its box IS the page, so ringing it would outline the screenshot.
  // The page's own screenshot already illustrates that, and the sheet already shows it.
  if (ordinal === 0) return { skip: "page-scope" };
  const box = ctx.boxes.get(ordinal);
  if (!box) return { skip: ctx.truncated ? "truncated" : "no-boxes" };
  if (box.w <= 0 || box.h <= 0) return { skip: "zero-area" };
  const vpArea = ctx.viewport.width * ctx.viewport.height;
  if (vpArea > 0 && (box.w * box.h) / vpArea >= 0.7) return { skip: "page-scope" };

  // Viewport-only captures, on every producer, on purpose: the screenshot shares boxes.json's
  // coordinate system. An element mostly below the fold is not in the image to be drawn.
  const visibleTop = Math.max(0, box.y * ctx.scale);
  const visibleBottom = Math.min(ctx.img.height, (box.y + box.h) * ctx.scale);
  const visibleFraction = box.h > 0 ? (visibleBottom - visibleTop) / (box.h * ctx.scale) : 0;
  if (visibleFraction < 0.5) return { skip: "below-the-fold" };

  const rect = cropRect(box, g, ctx.scale, ctx.img);
  const crop = cropImage(ctx.img, rect);
  if (!crop) return { skip: "below-the-fold" };

  annotate(crop.raster, {
    x: box.x * ctx.scale - crop.rect.x,
    y: box.y * ctx.scale - crop.rect.y,
    w: box.w * ctx.scale,
    h: box.h * ctx.scale,
  });

  return {
    png: encodePng(crop.raster),
    width: crop.raster.width,
    height: crop.raster.height,
    box,
    scale: ctx.scale,
    clipped: visibleFraction < 1,
  };
}

// ---- prose -------------------------------------------------------------------------------
// Every refusal has a sentence, in both languages. A missing image with no explanation reads
// as "the tool found nothing here", which is the opposite of what happened.

const S: Record<Lang, { alt: (sel: string, page: string) => string; notImaged: (n: number) => string; reasons: Record<EvidenceSkip, string> }> = {
  fr: {
    // No `N.N —` sequence: src/check.ts scans the WHOLE document for criterion mentions.
    alt: (sel, page) => `Capture recadrée de l'élément ${sel} sur la page ${page}, entouré d'un cadre`,
    notImaged: (n) => `${n} occurrence(s) ne sont pas illustrées :`,
    reasons: {
      "no-snapshot": "la capture de page que ce constat désigne n'est pas sur ce disque — sa référence fichier:ligne reste valable",
      "no-screenshot": "le producteur n'a pas fourni de capture pour cette page, donc le niveau pixel est inactif ici",
      "unreadable-image": "la capture n'est pas décodable (le moteur lit le truecolour 8 bits uniquement) — mieux vaut aucune image qu'une fausse",
      "no-boxes":
        "les positions d'éléments ne se vérifient pas contre le DOM sérialisé, elles ont donc été refusées en bloc plutôt que d'encadrer le mauvais élément",
      truncated: "la page dépasse la limite de collecte : aucune position n'a été enregistrée pour cet élément",
      "no-offsets": "le constat ne porte pas d'ancrage dans la source, il ne peut pas être joint à une position",
      unjoinable: "l'ancrage du constat ne correspond à aucun élément du DOM sérialisé",
      "page-scope": "le constat porte sur la page entière — la capture de page ci-dessus est l'illustration",
      "zero-area": "l'élément n'occupe aucune surface peinte",
      "below-the-fold": "l'élément est hors de la capture (la capture couvre la fenêtre, pas la page entière) — sa référence fichier:ligne reste valable",
      "unknown-scale": "le rapport pixels/CSS est indéterminé pour cette page ; un rapport deviné encadrerait le mauvais endroit",
      deduplicated: "même défaut sur le même élément : il est montré par l'illustration d'une autre occurrence, rien n'a été perdu",
      capped: "défaut distinct laissé sans image : le plafond de vignettes de ce lot est atteint — relevez `--evidence-max` pour les obtenir",
    },
  },
  en: {
    alt: (sel, page) => `Cropped screenshot of the ${sel} element on the ${page} page, outlined`,
    notImaged: (n) => `${n} occurrence(s) are not illustrated:`,
    reasons: {
      "no-snapshot": "the page snapshot this finding names is not on this disk — its file:line reference still holds",
      "no-screenshot": "the producer supplied no screenshot for this page, so the pixel tier is inactive here",
      "unreadable-image": "the screenshot does not decode (the engine reads 8-bit truecolour only) — no image beats a wrong one",
      "no-boxes": "the element positions do not verify against the serialized DOM, so they were refused wholesale rather than outlining the wrong element",
      truncated: "the page exceeded the collection cap: no position was recorded for this element",
      "no-offsets": "the finding carries no source anchor, so it cannot be joined to a position",
      unjoinable: "the finding's anchor matches no element in the serialized DOM",
      "page-scope": "the finding is about the whole page — the page screenshot above is the illustration",
      "zero-area": "the element paints no box",
      "below-the-fold": "the element sits outside the capture (the screenshot covers the viewport, not the whole page) — its file:line reference still holds",
      "unknown-scale": "the image-pixel to CSS-pixel ratio is indeterminate for this page; a guessed ratio would outline the wrong place",
      deduplicated: "the same defect on the same element: it is shown by the illustration of another occurrence, nothing was lost",
      capped: "a distinct defect left undrawn: this run's crop limit was reached — raise `--evidence-max` to get them",
    },
  },
};

/** The refusals themselves — per page, or overall when `pageId` is null. Undefined when
 *  everything located was imaged.
 *
 *  This is the DECISION (which refusals, with what counts, in what order); the bullet
 *  characters belong to whoever renders it. Markdown gets `- `, the HTML tier gets `<li>`,
 *  and neither can drift from the other because there is only one list here. */
export function evidenceRefusals(m: EvidenceManifest, pageId: string | null, lang: Lang): { headline: string; reasons: string[] } | undefined {
  const t = pageId === null ? m.totals : m.perPage.get(pageId);
  if (!t) return undefined;
  const missing = t.located - t.imaged;
  if (missing <= 0) return undefined;
  const entries = Object.entries(t.skipped).filter(([, n]) => n) as [EvidenceSkip, number][];
  const s = S[lang];
  return {
    headline: s.notImaged(missing),
    reasons: entries.sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${n} — ${s.reasons[reason]}`),
  };
}

/** What the report says about what it did NOT draw, as Markdown. Empty when there is
 *  nothing to say. */
export function evidenceNotice(m: EvidenceManifest, pageId: string | null, lang: Lang): string[] {
  const r = evidenceRefusals(m, pageId, lang);
  return r ? [r.headline, ...r.reasons.map((x) => `- ${x}`)] : [];
}

// ---- the run -----------------------------------------------------------------------------

function bump(t: EvidencePageTally, reason: EvidenceSkip): void {
  t.skipped[reason] = (t.skipped[reason] ?? 0) + 1;
}

/** A filesystem-safe, stable, collision-free name for a finding's crop. Derived from the same
 *  identity SARIF fingerprints use (src/baseline.ts `findingId`), hashed only because that
 *  identity contains path separators and pipes. The identity itself is never altered. */
function cropName(f: Finding): string {
  return `${createHash("sha1").update(findingId(f)).digest("hex").slice(0, 12)}.png`;
}

/** Draw every non-conformity that can be drawn, write the PNGs under
 *  `<outDir>/assets/<page-id>/`, and record what was not drawn and why.
 *
 *  Pages are the OUTER loop and the context is dropped between them on purpose: a 2560×1440
 *  screenshot inflates to ~15 MB, and holding 38 of them at once does not fit. Do not hoist. */
export function writeEvidence(result: AuditResult, opts: EvidenceOptions): EvidenceManifest {
  const root = opts.root ?? process.cwd();
  const caps = { ...DEFAULT_CAPS, ...opts.caps };
  const manifest: EvidenceManifest = {
    crops: new Map(),
    skipped: new Map(),
    perPage: new Map(),
    totals: { located: 0, imaged: 0, skipped: {} },
  };

  // The discriminator is the snapshot PATH, never `f.page`: attribution stamps a page id on
  // source findings too (src/pages.ts), and those have no pixels.
  const byPage = new Map<string, Finding[]>();
  for (const f of [...result.findings, ...(result.packFindings ?? [])]) {
    if (f.advisory) continue;
    const page = pageIdOfSnapshot(f.file);
    if (!page) continue;
    const list = byPage.get(page);
    if (list) list.push(f);
    else byPage.set(page, [f]);
  }

  for (const [pageId, findings] of [...byPage].sort((a, b) => a[0].localeCompare(b[0]))) {
    const tally: EvidencePageTally = { located: findings.length, imaged: 0, skipped: {} };
    manifest.perPage.set(pageId, tally);
    manifest.totals.located += findings.length;

    const ctx = loadPageEvidence(root, pageId);
    if ("skip" in ctx) {
      for (const f of findings) {
        manifest.skipped.set(findingId(f), ctx.skip);
        bump(tally, ctx.skip);
        bump(manifest.totals, ctx.skip);
      }
      continue;
    }

    const dir = join(opts.outDir, "assets", pageId);
    let wrote = false;
    const perRule = new Map<string, number>();
    const seen = new Set<string>();
    let onPage = 0;

    for (const f of findings) {
      const id = findingId(f);
      // One image per distinct element per page: 472 findings of one rule collapse to the
      // handful of DIFFERENT things actually wrong.
      const key = `${f.ruleId}\u0000${f.selectorHint}`;
      const ruleCount = perRule.get(f.ruleId) ?? 0;
      // TWO FACTS, never one label. `deduplicated` means the reader IS looking at this defect,
      // in another occurrence's picture — nothing was lost. `capped` means a DISTINCT defect
      // has no picture at all because a limit ran out. Only the second costs the reader
      // something, and only the second is worth a setting; folding them together hid the one
      // sentence that could tell someone their artifact is incomplete.
      const overLimit = ruleCount >= caps.perRule || onPage >= caps.perPage || manifest.crops.size >= caps.total;
      const refusal = seen.has(key) ? "deduplicated" : overLimit ? "capped" : null;
      if (refusal) {
        manifest.skipped.set(id, refusal);
        bump(tally, refusal);
        bump(manifest.totals, refusal);
        continue;
      }

      const crop = cropFinding(ctx, f, opts.geometry);
      if ("skip" in crop) {
        manifest.skipped.set(id, crop.skip);
        bump(tally, crop.skip);
        bump(manifest.totals, crop.skip);
        continue;
      }

      const name = cropName(f);
      const path = join(dir, name);
      try {
        if (!wrote) {
          mkdirSync(dir, { recursive: true });
          wrote = true;
        }
        writeFileSync(path, crop.png);
      } catch {
        // A failed image write must never fail a report — the same posture the screenshot
        // copier already takes. The finding keeps its file:line and is counted as not imaged.
        manifest.skipped.set(id, "no-screenshot");
        bump(tally, "no-screenshot");
        bump(manifest.totals, "no-screenshot");
        continue;
      }

      seen.add(key);
      perRule.set(f.ruleId, ruleCount + 1);
      onPage++;
      tally.imaged++;
      manifest.totals.imaged++;
      manifest.crops.set(id, {
        findingId: id,
        page: pageId,
        ruleId: f.ruleId,
        criteriaId: f.criteriaId,
        href: `./assets/${pageId}/${name}`,
        path,
        width: crop.width,
        height: crop.height,
        box: crop.box,
        scale: crop.scale,
        clipped: crop.clipped,
        alt: { fr: S.fr.alt(f.selectorHint, pageId), en: S.en.alt(f.selectorHint, pageId) },
      });
    }
  }

  return manifest;
}
