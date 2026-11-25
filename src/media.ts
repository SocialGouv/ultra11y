// MEDIA PROBES — RGAA theme 4 (time-based and non-temporal media) and 13.7 (flashes).
//
// Two things a source reading cannot settle and a browser can measure:
//
//  1. WHAT THE MEDIA CARRY. A `<video>` with a `<track kind="captions">` whose file 404s has no
//     captions, whatever its markup says; a transcript is usually a link or a section NEXT to the
//     player, which only the laid-out page relates to it. `MEDIA_PROBE` lists every media element
//     of the page — video, audio, a player iframe or embed, and the things that can animate
//     (canvas, animated image, SVG animation, a running CSS animation) — with its tracks as the
//     browser loaded them and the companions found in the DOM: `aria-describedby` /
//     `aria-labelledby` targets, the `<figcaption>`, an adjacent link or text naming a
//     transcript, captions or an audio description, a `<details>` beside it.
//
//  2. WHETHER THE PAGE FLASHES. A short recording of the viewport — a frame sequence taken
//     through the DevTools protocol, read with ultra11y's own PNG decoder (src/pixel.ts) because
//     a WebM file cannot be decoded without a codec this engine does not ship — measured for
//     general flashes: pairs of opposing changes in relative luminance of at least 10 % where the
//     darker state is under 0.80 (the WCAG 2.3.1 definition RGAA 13.7 refers to), counted per
//     one-second window and per grid cell, against a quarter of a 10° visual field.
//
// WHAT IT CAN SAY, AND WHAT IT CANNOT. Both are evidence for the adjudicator, never a verdict:
// the flash measure saw the viewport for `durationMs`, after load, with nobody touching it — a
// flash that starts later, on an interaction, below the fold or as a saturated-red transition (not
// measured) is not in it. A sampling rate too low for a three-per-second count to mean anything
// is reported `undersampled`, which measured nothing. Every limit is in the evidence note.
import { ELEMENT_WALK } from "./collector.js";
import { decodePng } from "./pixel.js";
import type { Image } from "./pixel.js";
import type { FlashMeasure, MediaDigest, MediaItem } from "./types.js";

type Any = any;

/** How long the viewport is recorded for the flash measure. One second is the window the
 *  criterion counts in; half a second more lets a window start after the first frame. */
export const FLASH_WINDOW_MS = 1500;
/** The least frame rate at which a flash rate above 3/s is observable (a 4 Hz flash is 8 changes
 *  a second). Below it the measure is `undersampled`. */
export const FLASH_MIN_FPS = 8;
/** A quarter of a 10° visual field at 1024×768 (341 × 256 CSS pixels): the area WCAG 2.3.1's
 *  general flash threshold applies to. */
export const FLASH_AREA_THRESHOLD = Math.round((341 * 256) / 4);
/** Width, in image pixels, the frames are recorded at. Small on purpose: luminance per cell is
 *  all the measure reads, and a small frame is what keeps the frame rate up. */
const FRAME_WIDTH = 160;
/** Grid cell, in image pixels. */
const CELL = 4;
/** The most media items `media.json` lists. */
const MEDIA_MAX = 60;

/** Words that name a caption, a transcript or a description of a medium, in French and English. */
const COMPANION_WORDS =
  "transcri|version textuelle|texte (?:alternatif|integral|intégral)|sous-titr|audiodescri|audio-descri|description (?:audio|détaillée|detaillee)|caption|subtitle|audio description|text version";

/** Browser-context source, evaluated as a STRING (the engine ships no DOM lib). Registered in
 *  probeSources() so a typo fails CI instead of being swallowed at run time. */
export const MEDIA_PROBE = `(() => {
  const MAX = ${MEDIA_MAX};
  const WORDS = new RegExp(${JSON.stringify(COMPANION_WORDS)}, 'i');
  const PLAYER = /youtube|youtu\\.be|vimeo|dailymotion|dai\\.ly|peertube|soundcloud|spotify|deezer|podcast|player|video|audio|wistia|brightcove|jwplayer|kaltura/i;
  const els = (${ELEMENT_WALK})(document);
  const ordinal = new Map(els.map((e, i) => [e, i]));
  const sel = (e) => e.localName + (e.id ? '#' + e.id : '') + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\\s+/)[0] : '');
  const txt = (e) => ((e && (e.innerText || e.textContent)) || '').replace(/\\s+/g, ' ').trim().slice(0, 160);
  const companions = (e) => {
    const out = [];
    for (const attr of ['aria-describedby', 'aria-labelledby']) {
      for (const id of (e.getAttribute(attr) || '').split(/\\s+/).filter(Boolean)) {
        const t = document.getElementById(id);
        if (t) out.push({ via: attr, text: txt(t) });
      }
    }
    const fig = e.closest('figure');
    const cap = fig && fig.querySelector('figcaption');
    if (cap) out.push({ via: 'figcaption', text: txt(cap) });
    // Next to the player: its two nearest siblings on each side, and its wrappers', two levels up.
    const near = (n) => {
      const out = [];
      for (let s = n.previousElementSibling, k = 0; s && k < 2; s = s.previousElementSibling, k++) out.push(s);
      for (let s = n.nextElementSibling, k = 0; s && k < 2; s = s.nextElementSibling, k++) out.push(s);
      return out;
    };
    let node = e;
    for (let depth = 0; depth < 3 && node && node !== document.body; depth++) {
      for (const sib of near(node)) {
        if (!sib) continue;
        if (sib.localName === 'details' && WORDS.test(txt(sib))) out.push({ via: 'details', text: txt(sib) });
        const links = sib.matches('a[href]') ? [sib] : Array.from(sib.querySelectorAll('[href]')).filter((x) => x.localName === 'a').slice(0, 10);
        for (const a of links) {
          const label = txt(a) + ' ' + (a.getAttribute('title') || '') + ' ' + (a.getAttribute('aria-label') || '');
          if (WORDS.test(label) || WORDS.test(a.getAttribute('href') || '')) out.push({ via: 'adjacent-link', text: txt(a), href: a.getAttribute('href') || '' });
        }
        if (!links.length && sib.localName !== 'details' && WORDS.test(txt(sib))) out.push({ via: 'adjacent-text', text: txt(sib) });
      }
      node = node.parentElement;
    }
    const seen = new Set();
    return out.filter((c) => { const k = c.via + '|' + c.text + '|' + (c.href || ''); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
  };
  const items = [];
  const push = (e, kind) => {
    if (items.length >= MAX) return;
    const tag = e.localName;
    const m = (tag === 'video' || tag === 'audio') ? e : null;
    const tracks = Array.from(e.querySelectorAll ? e.querySelectorAll('track') : []).map((t) => ({
      kind: t.getAttribute('kind') || 'subtitles',
      ...(t.getAttribute('srclang') ? { srclang: t.getAttribute('srclang') } : {}),
      ...(t.getAttribute('label') ? { label: t.getAttribute('label') } : {}),
      ...(t.getAttribute('src') ? { src: t.getAttribute('src') } : {}),
      readyState: typeof t.readyState === 'number' ? t.readyState : undefined,
      ...(t.hasAttribute('default') ? { default: true } : {}),
    }));
    const src = e.currentSrc || e.getAttribute('src') || e.getAttribute('data') || (e.querySelector && e.querySelector('source') ? e.querySelector('source').getAttribute('src') : '') || '';
    items.push({
      tag: tag,
      ...(ordinal.has(e) ? { i: ordinal.get(e) } : {}),
      selector: sel(e),
      ...(src ? { src: String(src).slice(0, 200) } : {}),
      kind: kind,
      ...(m ? { controls: m.controls, autoplay: m.autoplay, muted: m.muted, loop: m.loop, paused: m.paused } : {}),
      ...(m && Number.isFinite(m.duration) ? { duration: Math.round(m.duration * 10) / 10 } : {}),
      tracks: tracks,
      companions: companions(e),
    });
  };
  for (const e of els) {
    const tag = e.localName;
    if (tag === 'video' || tag === 'audio') push(e, 'temporal');
    else if (tag === 'iframe' && PLAYER.test((e.getAttribute('src') || '') + ' ' + (e.getAttribute('title') || '') + ' ' + (e.getAttribute('allow') || ''))) push(e, 'temporal');
    else if ((tag === 'object' || tag === 'embed') && /video|audio|mp4|webm|ogg|mp3|wav|flash|swf/i.test((e.getAttribute('type') || '') + ' ' + (e.getAttribute('src') || e.getAttribute('data') || ''))) push(e, 'temporal');
    else if (tag === 'canvas') push(e, 'animated');
    else if (tag === 'img' && /\\.(gif|apng)(?:[?#]|$)/i.test(e.currentSrc || e.getAttribute('src') || '')) push(e, 'animated');
    else if (tag === 'svg' && e.querySelector('animate, animateTransform, animateMotion, set')) push(e, 'animated');
    else if (tag === 'marquee' || tag === 'blink') push(e, 'animated');
    else {
      const cs = getComputedStyle(e);
      if (cs.animationName && cs.animationName !== 'none' && parseFloat(cs.animationDuration) > 0) push(e, 'animated');
    }
  }
  return items;
})()`;

/** sRGB channel (0–255) → linear, as WCAG's relative luminance defines it. */
const linear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Mean relative luminance per grid cell of one frame. */
export function luminanceGrid(img: Image, cell = CELL): { cols: number; rows: number; lum: Float64Array } {
  const cols = Math.max(1, Math.floor(img.width / cell));
  const rows = Math.max(1, Math.floor(img.height / cell));
  const lum = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      let n = 0;
      for (let y = r * cell; y < Math.min(img.height, (r + 1) * cell); y++)
        for (let x = c * cell; x < Math.min(img.width, (c + 1) * cell); x++) {
          const p = img.at(x, y);
          if (!p) continue;
          sum += 0.2126 * linear(p.r) + 0.7152 * linear(p.g) + 0.0722 * linear(p.b);
          n++;
        }
      lum[r * cols + c] = n ? sum / n : 0;
    }
  return { cols, rows, lum };
}

/** One frame of the recording: its time in milliseconds and its luminance grid. */
export interface LumFrame {
  t: number;
  lum: Float64Array;
}

/** Count general flashes in a frame sequence. Pure: the recording is the caller's business.
 *
 *  Per cell, a CHANGE is a move of the relative luminance by at least 0.10 from the last
 *  extreme, with the darker of the two under 0.80, in the opposite direction to the previous
 *  change; a FLASH is a pair of opposing changes. Per one-second window, a cell that changes 8
 *  times or more has flashed more than 3 times. The flashing area is the cells over that rate in
 *  the same window, in CSS pixels (`cellArea` per cell). */
export function measureFlashes(frames: LumFrame[], cellArea: number, durationMs: number): FlashMeasure {
  const fps = durationMs > 0 ? Math.round(((frames.length - 1) / durationMs) * 1000 * 10) / 10 : 0;
  const base = { frames: frames.length, durationMs: Math.round(durationMs), fps, areaThreshold: FLASH_AREA_THRESHOLD };
  if (frames.length < 2) return { ...base, maxFlashesPerSecond: 0, flashingArea: 0, outcome: "undersampled" };
  const cells = frames[0]!.lum.length;
  // Change times per cell.
  const changes: number[][] = Array.from({ length: cells }, () => []);
  for (let k = 0; k < cells; k++) {
    let ref = frames[0]!.lum[k]!;
    let dir = 0;
    for (const f of frames.slice(1)) {
      const v = f.lum[k] ?? ref;
      const delta = v - ref;
      if (Math.abs(delta) >= 0.1 && Math.min(v, ref) < 0.8) {
        const d = Math.sign(delta);
        if (d !== dir) {
          changes[k]!.push(f.t);
          dir = d;
        }
        ref = v;
      } else if ((dir > 0 && v > ref) || (dir < 0 && v < ref)) ref = v; // follow the extreme
    }
  }
  let maxFlashes = 0;
  let maxArea = 0;
  const starts = [...new Set(changes.flat())].sort((a, b) => a - b);
  for (const t0 of starts) {
    let over = 0;
    for (const list of changes) {
      const n = list.filter((t) => t >= t0 && t < t0 + 1000).length;
      const flashes = Math.floor(n / 2);
      if (flashes > maxFlashes) maxFlashes = flashes;
      if (flashes > 3) over++;
    }
    if (over * cellArea > maxArea) maxArea = over * cellArea;
  }
  const any = changes.some((l) => l.length > 0);
  const outcome: FlashMeasure["outcome"] =
    maxFlashes > 3 && maxArea >= FLASH_AREA_THRESHOLD ? "over-threshold" : fps < FLASH_MIN_FPS ? "undersampled" : any ? "below-threshold" : "none";
  return { ...base, maxFlashesPerSecond: maxFlashes, flashingArea: Math.round(maxArea), outcome };
}

/** Record the viewport for `ms` and measure it. Chromium only (a DevTools session); anything
 *  else, or a failure, is returned as the reason the measure did not run. */
export async function recordFlashes(page: Any, ms = FLASH_WINDOW_MS): Promise<{ flash?: FlashMeasure; skipped?: string }> {
  let client: Any;
  try {
    client = await page.context().newCDPSession(page);
  } catch (e) {
    return { skipped: `no DevTools session to record the viewport (${String((e as Error)?.message ?? e).split("\n")[0]})` };
  }
  try {
    const vp = (await page.evaluate("({ w: window.innerWidth, h: window.innerHeight })")) as { w: number; h: number };
    const scale = FRAME_WIDTH / Math.max(1, vp.w);
    const clip = { x: 0, y: 0, width: vp.w, height: vp.h, scale };
    const frames: LumFrame[] = [];
    const started = Date.now();
    while (Date.now() - started < ms) {
      const t = Date.now() - started;
      const shot = (await client.send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false })) as { data: string };
      const img = decodePng(Buffer.from(shot.data, "base64"));
      if (!img) return { skipped: "a recorded frame could not be decoded" };
      frames.push({ t, lum: luminanceGrid(img).lum });
    }
    const durationMs = frames.length > 1 ? frames[frames.length - 1]!.t - frames[0]!.t : 0;
    const cssCell = CELL / scale;
    return { flash: measureFlashes(frames, cssCell * cssCell, durationMs) };
  } catch (e) {
    return { skipped: `the viewport recording failed (${String((e as Error)?.message ?? e).split("\n")[0]})` };
  } finally {
    await client.detach().catch(() => {});
  }
}

/** The page's media, and — when `flash` is set — the flash measure. Undefined when the inventory
 *  itself failed: no `media.json` is then written, which reads « not looked », never an empty
 *  list read as « no media ». */
export async function probeMedia(page: Any, opts: { flash: boolean }): Promise<MediaDigest | undefined> {
  let items: MediaItem[];
  try {
    items = ((await page.evaluate(MEDIA_PROBE)) as MediaItem[]) ?? [];
  } catch {
    return undefined;
  }
  if (!opts.flash) return { v: 1, items, flashSkipped: "not measured on this capture (a journey state records the media inventory only)" };
  const { flash, skipped } = await recordFlashes(page);
  return { v: 1, items, ...(flash ? { flash } : {}), ...(skipped ? { flashSkipped: skipped } : {}) };
}
