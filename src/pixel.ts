// PIXEL TIER — reading a page screenshot, and writing one back, with no dependencies.
//
// Why bother, when the computed styles already give us colours? Because `getComputedStyle`
// answers with the CSS *declaration*, not with what a user sees. Text over a gradient, over a
// background image, or over a translucent overlay has `background-color: rgba(0, 0, 0, 0)`
// and no amount of style analysis will recover the real backdrop. That is a documented blind
// spot of every CSSOM-based contrast check, axe-core included. The screenshot is the only
// place the answer exists.
//
// PNG is decodable with `node:zlib` alone (a builtin), so the zero-dependency promise holds:
// parse IHDR, concatenate the IDAT chunks, inflate, un-filter the scanlines. Only what
// Playwright actually emits is supported — 8-bit truecolour, with or without alpha. Anything
// else returns null rather than decoding garbage, because a wrong pixel here becomes a
// fabricated non-conformity.
//
// The WRITE side (`encodePng` and the small raster ops beneath it) is the exact reciprocal,
// and exists so a non-conformity can be shown rather than only cited: `src/evidence.ts` crops
// the screenshot around the offending element and rings it. It is deliberately the same
// encoder `scripts/build-extension-icons.mjs` uses, so the committed icons double as an
// external PNG-conformance fixture that a decode/encode round-trip could never provide.
//
// THIS MODULE IS A LEAF, and must stay one: exactly one runtime import (`node:zlib`),
// everything else `import type`. The icon script imports it directly through Node's
// type-stripping, which a value import would break.
import { deflateSync, inflateSync } from "node:zlib";
import type { RGBA } from "./color.js";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Image {
  width: number;
  height: number;
  /** Pixel at (x, y), or undefined outside the image. */
  at(x: number, y: number): RGBA | undefined;
}

/** Paeth predictor (PNG filter type 4). */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decode an 8-bit truecolour PNG (colour type 2 or 6). Returns null for anything else,
 *  anything malformed and anything truncated — never a partially-read image. */
export function decodePng(buf: Buffer): Image | null {
  if (buf.length < 8 + 25) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (buf[i] !== SIGNATURE[i]) return null;

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length) return null; // truncated chunk
    if (type === "IHDR") {
      if (len < 13) return null;
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8] ?? 0;
      colorType = buf[dataStart + 9] ?? 0;
      interlace = buf[dataStart + 12] ?? 0;
    } else if (type === "IDAT") {
      idat.push(buf.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      break;
    }
    off = dataEnd + 4; // skip the CRC
  }

  if (!width || !height || !idat.length) return null;
  if (bitDepth !== 8) return null; // 16-bit / paletted: not what a browser screenshot emits
  if (colorType !== 2 && colorType !== 6) return null; // truecolour only
  if (interlace !== 0) return null; // Adam7 unsupported — refuse rather than mis-read

  const channels = colorType === 6 ? 4 : 3;
  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < height * (stride + 1)) return null; // truncated image data

  // Un-filter in place into a contiguous pixel buffer.
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const lineIn = y * (stride + 1) + 1;
    const lineOut = y * stride;
    const prevOut = lineOut - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[lineIn + i] ?? 0;
      const a = i >= channels ? (out[lineOut + i - channels] ?? 0) : 0;
      const b = y > 0 ? (out[prevOut + i] ?? 0) : 0;
      const c = y > 0 && i >= channels ? (out[prevOut + i - channels] ?? 0) : 0;
      let v: number;
      switch (filter) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4:
          v = x + paeth(a, b, c);
          break;
        default:
          return null; // unknown filter — refuse the image
      }
      out[lineOut + i] = v & 0xff;
    }
  }

  return {
    width,
    height,
    at(x: number, y: number): RGBA | undefined {
      if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
      const p = y * stride + x * channels;
      return {
        r: out[p] ?? 0,
        g: out[p + 1] ?? 0,
        b: out[p + 2] ?? 0,
        a: channels === 4 ? (out[p + 3] ?? 255) / 255 : 1,
      };
    },
  };
}

/** Clamp a rect to the image; null when nothing of it is inside. */
function clamp(img: Image, r: Rect): Rect | null {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  const x2 = Math.min(img.width, Math.round(r.x + r.w));
  const y2 = Math.min(img.height, Math.round(r.y + r.h));
  if (x2 <= x || y2 <= y) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

// Sampling stride: a full-page screenshot region can be hundreds of thousands of pixels, and
// colour statistics do not need every one of them.
const MAX_SAMPLES = 4096;

/** Mean colour of a region. Useful for a flat area; meaningless for a mixed one — see
 *  `dominantBackground`, which is what the contrast rule actually uses. */
export function averageColor(img: Image, rect: Rect): RGBA | null {
  const r = clamp(img, rect);
  if (!r) return null;
  const step = Math.max(1, Math.floor(Math.sqrt((r.w * r.h) / MAX_SAMPLES)));
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y += step) {
    for (let x = r.x; x < r.x + r.w; x += step) {
      const p = img.at(x, y);
      if (!p) continue;
      sr += p.r;
      sg += p.g;
      sb += p.b;
      n++;
    }
  }
  if (!n) return null;
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n), a: 1 };
}

// A region must be this dominated by one colour bucket before we call it "the background".
// Below it we return null: half black and half white averages to a grey that exists nowhere,
// and guessing there would be exactly the kind of invented evidence this engine refuses.
const DOMINANCE = 0.6;
const BUCKET = 16; // quantisation step, so anti-aliasing does not split one colour into many

/** The single most common colour of a region, or null when the region is genuinely varied
 *  (a photo, a gradient) and no one colour can honestly be called its background. */
export function dominantBackground(img: Image, rect: Rect): RGBA | null {
  const r = clamp(img, rect);
  if (!r) return null;
  const step = Math.max(1, Math.floor(Math.sqrt((r.w * r.h) / MAX_SAMPLES)));
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = r.y; y < r.y + r.h; y += step) {
    for (let x = r.x; x < r.x + r.w; x += step) {
      const p = img.at(x, y);
      if (!p) continue;
      const key = (Math.round(p.r / BUCKET) << 16) | (Math.round(p.g / BUCKET) << 8) | Math.round(p.b / BUCKET);
      const cur = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      cur.n++;
      cur.r += p.r;
      cur.g += p.g;
      cur.b += p.b;
      counts.set(key, cur);
      total++;
    }
  }
  if (!total) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best || best.n / total < DOMINANCE) return null;
  return { r: Math.round(best.r / best.n), g: Math.round(best.g / best.n), b: Math.round(best.b / best.n), a: 1 };
}

// ---- the write side ---------------------------------------------------------------------
//
// A mutable pixel buffer, unlike `Image` which is a read-only accessor over decoded bytes.
// The two are deliberately different types: everything that only READS a screenshot keeps
// taking `Image`, so adding the encoder cannot accidentally hand a rule a writable page.

/** Row-major RGBA8. `data` is exactly `width * height * 4` bytes. */
export interface Raster {
  width: number;
  height: number;
  data: Buffer;
}

/** A cropped raster, with the rect it actually took — which is NOT the rect that was asked
 *  for when the request ran off the edge. The caller needs the real one to translate an
 *  element box into crop-local coordinates. */
export interface Crop {
  raster: Raster;
  rect: Rect;
}

// The standard PNG CRC-32 (IEEE 802.3), table-driven because a screenshot's IDAT is megabytes
// and the bit-at-a-time loop is measurably slower over that. Same polynomial, same output.
// `@__PURE__` so a bundle that never encodes drops the table with the rest of the write side.
// Without it esbuild must assume the IIFE has side effects and keeps 1 KB of dead constant.
const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ (buf[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An RGBA raster → a PNG. Colour type 6, 8-bit, filter 0 on every scanline.
 *
 *  Filter 0 and `level: 9` are not tuning knobs, they are the reproducibility contract: the
 *  bytes are then a function of the pixels alone, never of zlib's defaults or of a heuristic
 *  filter choice that could change between Node releases. `scripts/build-extension-icons.mjs`
 *  `--check` proves the committed icons still match, which only holds while this stays fixed.
 *
 *  Throws when `data` disagrees with the dimensions — that is a programming error upstream,
 *  never user input, and silently padding it would write a skewed image. */
export function encodePng(r: Raster): Buffer {
  const expected = r.width * r.height * 4;
  if (r.width <= 0 || r.height <= 0) throw new Error(`encodePng: refusing a ${r.width}×${r.height} raster`);
  if (r.data.length !== expected) {
    throw new Error(`encodePng: ${r.width}×${r.height} needs ${expected} bytes of RGBA, got ${r.data.length}`);
  }
  const stride = r.width * 4;
  const raw = Buffer.alloc(r.height * (stride + 1));
  for (let y = 0; y < r.height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    r.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(r.width, 0);
  ihdr.writeUInt32BE(r.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // bytes 10..12 stay 0: deflate compression, adaptive filtering, no interlace.
  return Buffer.concat([Buffer.from(SIGNATURE), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Copy a region of a decoded image into a writable raster. Null when nothing of the rect is
 *  inside — inherited from `clamp`, so a request that ran entirely off the page yields no
 *  image at all rather than a fabricated one. */
export function cropImage(img: Image, rect: Rect): Crop | null {
  const r = clamp(img, rect);
  if (!r) return null;
  const data = Buffer.alloc(r.w * r.h * 4);
  let i = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      const p = img.at(x, y);
      data[i] = p?.r ?? 0;
      data[i + 1] = p?.g ?? 0;
      data[i + 2] = p?.b ?? 0;
      data[i + 3] = Math.round((p?.a ?? 1) * 255);
      i += 4;
    }
  }
  return { raster: { width: r.w, height: r.h, data }, rect: r };
}

/** Source-over blend one pixel. Out of bounds is a no-op, never a throw: every drawing call
 *  here takes coordinates derived from a browser's box, and a box may legitimately sit
 *  partly outside the crop. */
function blend(raster: Raster, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return;
  const p = (y * raster.width + x) * 4;
  const a = Math.min(1, Math.max(0, c.a));
  if (a >= 1) {
    raster.data[p] = c.r;
    raster.data[p + 1] = c.g;
    raster.data[p + 2] = c.b;
    raster.data[p + 3] = 255;
    return;
  }
  const inv = 1 - a;
  raster.data[p] = Math.round(c.r * a + (raster.data[p] as number) * inv);
  raster.data[p + 1] = Math.round(c.g * a + (raster.data[p + 1] as number) * inv);
  raster.data[p + 2] = Math.round(c.b * a + (raster.data[p + 2] as number) * inv);
  raster.data[p + 3] = Math.max(raster.data[p + 3] as number, Math.round(a * 255));
}

/** Fill a rect, source-over. Clipped to the raster; never throws. */
export function fillRect(raster: Raster, rect: Rect, color: RGBA): void {
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(raster.width, Math.round(rect.x + rect.w));
  const y1 = Math.min(raster.height, Math.round(rect.y + rect.h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blend(raster, x, y, color);
}

/** Stroke a rect INWARD — the band lies inside the rect's own bounds, so a box flush with the
 *  raster edge keeps its full outline instead of losing the half that would fall outside.
 *
 *  `dash` is a period in pixels (half on, half off), phased on absolute coordinates so the
 *  four sides meet consistently at the corners. Undefined draws solid. */
export function strokeRect(raster: Raster, rect: Rect, color: RGBA, width: number, dash?: number): void {
  const t = Math.max(1, Math.round(width));
  const x0 = Math.round(rect.x);
  const y0 = Math.round(rect.y);
  const x1 = Math.round(rect.x + rect.w);
  const y1 = Math.round(rect.y + rect.h);
  if (x1 <= x0 || y1 <= y0) return;
  const on = (coord: number): boolean => {
    if (!dash || dash <= 1) return true;
    const half = dash / 2;
    return Math.floor(coord / half) % 2 === 0;
  };
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const top = y < y0 + t;
      const bottom = y >= y1 - t;
      const left = x < x0 + t;
      const right = x >= x1 - t;
      if (!top && !bottom && !left && !right) continue;
      // Horizontal bands dash along x, vertical ones along y, so a corner never blinks twice.
      if (!on(top || bottom ? x : y)) continue;
      blend(raster, x, y, color);
    }
  }
}
