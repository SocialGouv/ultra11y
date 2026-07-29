// PIXEL TIER — reading a page screenshot, with no dependencies.
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
import { inflateSync } from "node:zlib";
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
