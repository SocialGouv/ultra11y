import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { decodePng, averageColor, dominantBackground } from "../src/pixel.js";

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
