import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, averageColor, dominantBackground, encodePng, cropImage, strokeRect, fillRect } from "../src/pixel.js";
import type { Image, Raster } from "../src/pixel.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A decoded image back into a writable raster — what the encoder round-trip needs. */
function rasterOf(img: Image): Raster {
  const data = Buffer.alloc(img.width * img.height * 4);
  let i = 0;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p = img.at(x, y);
      data[i++] = p?.r ?? 0;
      data[i++] = p?.g ?? 0;
      data[i++] = p?.b ?? 0;
      data[i++] = Math.round((p?.a ?? 1) * 255);
    }
  }
  return { width: img.width, height: img.height, data };
}

// A minimal, valid PNG built by hand so the test owns its own fixture: no binary blob in the
// repo, and the expectations are computable from the pixels we wrote.
function png(width: number, height: number, rgba: (x: number, y: number) => [number, number, number, number], colorType = 6): Buffer {
  const channels = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc(height * (1 + width * channels));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgba(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      if (channels === 4) raw[o++] = a;
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let TABLE: number[] | null = null;
function crc32(buf: Buffer): number {
  if (!TABLE) {
    TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return c ^ 0xffffffff;
}

describe("decoding a PNG with no dependencies", () => {
  it("reads dimensions and pixels back exactly", () => {
    const img = decodePng(png(2, 2, () => [10, 20, 30, 255]));
    expect(img).not.toBeNull();
    expect(img?.width).toBe(2);
    expect(img?.height).toBe(2);
    expect(img?.at(0, 0)).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(img?.at(1, 1)).toEqual({ r: 10, g: 20, b: 30, a: 1 });
  });

  it("handles a truecolour PNG with no alpha channel", () => {
    const img = decodePng(png(1, 1, () => [255, 0, 0, 255], 2));
    expect(img?.at(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("keeps per-pixel colours distinct across a gradient", () => {
    const img = decodePng(png(4, 1, (x) => [x * 60, 0, 0, 255]));
    expect(img?.at(0, 0)?.r).toBe(0);
    expect(img?.at(3, 0)?.r).toBe(180);
  });

  it("returns null for something that is not a PNG, rather than throwing", () => {
    expect(decodePng(Buffer.from("not a png at all"))).toBeNull();
    expect(decodePng(Buffer.alloc(0))).toBeNull();
  });

  it("returns null for an unsupported bit depth instead of decoding garbage", () => {
    const bad = png(1, 1, () => [0, 0, 0, 255]);
    bad[24] = 16; // IHDR bit depth
    expect(decodePng(bad)).toBeNull();
  });

  it("returns null for a truncated image rather than reading past the buffer", () => {
    const good = png(4, 4, () => [1, 2, 3, 255]);
    expect(decodePng(good.subarray(0, good.length - 20))).toBeNull();
  });

  it("reports out-of-bounds reads as undefined", () => {
    const img = decodePng(png(1, 1, () => [0, 0, 0, 255]));
    expect(img?.at(5, 5)).toBeUndefined();
    expect(img?.at(-1, 0)).toBeUndefined();
  });
});

describe("measuring a region", () => {
  const flat = decodePng(png(10, 10, () => [200, 200, 200, 255]))!;
  const half = decodePng(png(10, 10, (x) => (x < 5 ? [0, 0, 0, 255] : [255, 255, 255, 255])))!;

  it("averages a uniform region to its own colour", () => {
    expect(averageColor(flat, { x: 0, y: 0, w: 10, h: 10 })).toEqual({ r: 200, g: 200, b: 200, a: 1 });
  });

  it("clamps a region that runs off the image instead of reading past it", () => {
    expect(averageColor(flat, { x: 8, y: 8, w: 100, h: 100 })).toEqual({ r: 200, g: 200, b: 200, a: 1 });
  });

  it("returns null for a region entirely outside the image", () => {
    expect(averageColor(flat, { x: 50, y: 50, w: 4, h: 4 })).toBeNull();
    expect(averageColor(flat, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });

  it("finds the dominant colour of a mostly-uniform region, not its meaningless average", () => {
    // 80% white with black text on it: the background is white, and the average (a grey that
    // exists nowhere in the image) would be the wrong answer.
    const text = decodePng(png(10, 10, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])))!;
    const dom = dominantBackground(text, { x: 0, y: 0, w: 10, h: 10 });
    expect(dom).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(averageColor(text, { x: 0, y: 0, w: 10, h: 10 })?.r).toBeLessThan(255); // the average lies
  });

  it("refuses to name a background when the region is an even split — guessing would invent evidence", () => {
    expect(dominantBackground(half, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });

  it("refuses to name a dominant colour when the region is genuinely varied", () => {
    const noisy = decodePng(png(16, 16, (x, y) => [(x * 16) % 256, (y * 16) % 256, ((x + y) * 8) % 256, 255]))!;
    expect(dominantBackground(noisy, { x: 0, y: 0, w: 16, h: 16 })).toBeNull();
  });
});

// ---- the write side ---------------------------------------------------------------------

describe("encoding a PNG with no dependencies", () => {
  // The load-bearing test. A decode/encode round-trip only proves the pair agrees with
  // itself; these four files were drawn by a script, committed, and are loaded by a real
  // browser — so matching them byte for byte proves the encoder is PNG-correct, and pins the
  // reproducibility contract (filter 0, deflate level 9) that `--check` depends on.
  it("reproduces the committed extension icons byte for byte", () => {
    for (const size of [16, 32, 48, 128]) {
      const committed = readFileSync(join(ROOT, "extension", "icons", `icon-${size}.png`));
      const img = decodePng(committed);
      expect(img, `icon-${size}.png must decode`).not.toBeNull();
      expect(encodePng(rasterOf(img!)).equals(committed), `icon-${size}.png must re-encode identically`).toBe(true);
    }
  });

  it("round-trips through decodePng, alpha included", () => {
    const src: Raster = { width: 7, height: 5, data: Buffer.alloc(7 * 5 * 4) };
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 7; x++) {
        const p = (y * 7 + x) * 4;
        src.data[p] = x * 30;
        src.data[p + 1] = y * 50;
        src.data[p + 2] = (x + y) * 20;
        src.data[p + 3] = 255 - x * 10;
      }
    }
    const back = decodePng(encodePng(src));
    expect(back).not.toBeNull();
    expect(back!.width).toBe(7);
    expect(back!.height).toBe(5);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 7; x++) {
        const got = back!.at(x, y)!;
        expect([got.r, got.g, got.b, Math.round(got.a * 255)]).toEqual([x * 30, y * 50, (x + y) * 20, 255 - x * 10]);
      }
    }
  });

  it("is deterministic — the bytes are a function of the pixels alone", () => {
    const r: Raster = { width: 4, height: 4, data: Buffer.alloc(64, 0x7f) };
    expect(encodePng(r).equals(encodePng(r))).toBe(true);
  });

  it("refuses a raster whose data length disagrees with its dimensions", () => {
    expect(() => encodePng({ width: 2, height: 2, data: Buffer.alloc(4) })).toThrow(/needs 16 bytes/);
    expect(() => encodePng({ width: 0, height: 4, data: Buffer.alloc(0) })).toThrow(/refusing/);
  });

  // The icon script imports this module directly through Node's type-stripping. A value
  // import of anything outside `node:` would break `pnpm check:build` for a reason nobody
  // would connect back to this file.
  it("src/pixel.ts stays a leaf — one runtime import, node:zlib", () => {
    const src = readFileSync(join(ROOT, "src", "pixel.ts"), "utf8");
    const runtime = [...src.matchAll(/^import\s+(?!type\b)[^;]+from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(runtime).toEqual(["node:zlib"]);
  });
});

describe("raster operations", () => {
  const solid = (w: number, h: number, v = 0): Raster => ({ width: w, height: h, data: Buffer.alloc(w * h * 4, v) });
  const px = (r: Raster, x: number, y: number): number[] => {
    const p = (y * r.width + x) * 4;
    return [r.data[p]!, r.data[p + 1]!, r.data[p + 2]!, r.data[p + 3]!];
  };
  const RED = { r: 255, g: 0, b: 0, a: 1 };

  it("cropImage reports the rect it actually took, not the one asked for", () => {
    const img = decodePng(png(10, 10, (x, y) => [x * 10, y * 10, 0, 255]))!;
    const crop = cropImage(img, { x: -3, y: -3, w: 6, h: 6 });
    expect(crop).not.toBeNull();
    expect(crop!.rect).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(crop!.raster.width).toBe(3);
    expect(crop!.raster.data.length).toBe(3 * 3 * 4);
    // Top-left of the crop is the image's own origin pixel.
    expect(px(crop!.raster, 0, 0)).toEqual([0, 0, 0, 255]);
  });

  it("cropImage returns null when the rect is entirely outside", () => {
    const img = decodePng(png(4, 4, () => [1, 2, 3, 255]))!;
    expect(cropImage(img, { x: 50, y: 50, w: 10, h: 10 })).toBeNull();
  });

  it("strokeRect draws inward, so a box flush with the edge keeps its whole outline", () => {
    const r = solid(20, 20);
    strokeRect(r, { x: 0, y: 0, w: 20, h: 20 }, RED, 3);
    expect(px(r, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(r, 19, 19)).toEqual([255, 0, 0, 255]);
    expect(px(r, 2, 10)).toEqual([255, 0, 0, 255]); // still inside the 3px band
    expect(px(r, 10, 10)).toEqual([0, 0, 0, 0]); // the middle is untouched
  });

  it("strokeRect clips instead of throwing when the rect straddles the raster edge", () => {
    const r = solid(8, 8);
    expect(() => strokeRect(r, { x: -4, y: -4, w: 16, h: 16 }, RED, 2)).not.toThrow();
    expect(() => strokeRect(r, { x: 100, y: 100, w: 4, h: 4 }, RED, 2)).not.toThrow();
  });

  it("strokeRect with a dash period leaves gaps along the edge", () => {
    const r = solid(20, 20);
    strokeRect(r, { x: 0, y: 0, w: 20, h: 20 }, RED, 1, 4);
    const top = Array.from({ length: 20 }, (_, x) => px(r, x, 0)[3]! > 0);
    expect(top.some(Boolean)).toBe(true);
    expect(top.some((on) => !on)).toBe(true);
  });

  it("fillRect blends source-over and clips to the raster", () => {
    const r = solid(4, 4);
    fillRect(r, { x: 0, y: 0, w: 2, h: 2 }, { r: 255, g: 255, b: 255, a: 0.5 });
    expect(px(r, 0, 0)).toEqual([128, 128, 128, 128]);
    expect(px(r, 3, 3)).toEqual([0, 0, 0, 0]);
    expect(() => fillRect(r, { x: -10, y: -10, w: 2, h: 2 }, RED)).not.toThrow();
  });
});
