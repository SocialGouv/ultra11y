#!/usr/bin/env node
// Generates the browser extension's icons — DEV ONLY, never shipped in the engine bundle.
//
// Why generate rather than commit a binary somebody drew: an icon is the one asset a reviewer
// cannot diff. Deriving it from a few lines of code means the shape is reviewable, every size
// is guaranteed consistent, and `--check` can prove the committed PNGs are exactly what this
// script produces — the same reproducibility contract the engine bundle is held to.
//
// The mark is an eye (the action's own branding icon), drawn as a filled lens with a pupil on
// the purple the action already declares. Written with a hand-rolled PNG encoder because the
// repo has no image dependency and is not about to grow one for four small files.
//
//   node scripts/build-extension-icons.mjs           # write
//   node scripts/build-extension-icons.mjs --check   # fail if the committed files differ
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");
const SIZES = [16, 32, 48, 128];

// action.yml declares `color: purple`; keep the extension recognisably the same tool.
const BG = [107, 70, 193]; // #6b46c1
const FG = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An RGBA pixel buffer → a PNG. Colour type 6, 8-bit, one filter byte per row. */
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none — the images are tiny, filtering buys nothing
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // level 9 so the bytes are a function of the pixels alone, not of zlib's default tuning.
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The eye mark, supersampled 4× so the curves do not alias at 16px. */
function draw(size) {
  const S = 4;
  const n = size * S;
  const acc = new Float64Array(size * size * 4);
  const c = n / 2;
  const rOuter = n * 0.47; // the rounded square's inscribed radius
  const corner = n * 0.22;
  const lensW = n * 0.34;
  const lensH = n * 0.2;
  const pupil = n * 0.108;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x - c;
      const dy = y - c;
      // Rounded square (squircle-ish): outside it the pixel is transparent.
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const inSquare =
        ax <= rOuter && ay <= rOuter && (ax <= rOuter - corner || ay <= rOuter - corner || (ax - (rOuter - corner)) ** 2 + (ay - (rOuter - corner)) ** 2 <= corner ** 2);
      if (!inSquare) continue;

      // The lens: an ellipse. The pupil is a disc at its centre.
      const inLens = (dx / lensW) ** 2 + (dy / lensH) ** 2 <= 1;
      const inPupil = dx * dx + dy * dy <= pupil * pupil;
      const [r, g, b] = inLens && !inPupil ? FG : BG;

      const i = (Math.floor(y / S) * size + Math.floor(x / S)) * 4;
      acc[i] += r;
      acc[i + 1] += g;
      acc[i + 2] += b;
      acc[i + 3] += 255;
    }
  }

  const out = Buffer.alloc(size * size * 4);
  const per = S * S;
  for (let i = 0; i < size * size; i++) {
    const a = acc[i * 4 + 3] / per;
    // Un-premultiply: the accumulator summed colour only over covered samples.
    const cov = acc[i * 4 + 3] / 255 || 1;
    out[i * 4] = Math.round(acc[i * 4] / cov);
    out[i * 4 + 1] = Math.round(acc[i * 4 + 1] / cov);
    out[i * 4 + 2] = Math.round(acc[i * 4 + 2] / cov);
    out[i * 4 + 3] = Math.round(a);
  }
  return out;
}

const check = process.argv.includes("--check");
mkdirSync(OUT, { recursive: true });
let stale = [];
for (const size of SIZES) {
  const file = join(OUT, `icon-${size}.png`);
  const bytes = png(size, draw(size));
  if (check) {
    let current = null;
    try {
      current = readFileSync(file);
    } catch {}
    if (!current || !current.equals(bytes)) stale.push(`icon-${size}.png`);
  } else {
    writeFileSync(file, bytes);
  }
}
if (check && stale.length) {
  console.error(`build-extension-icons: committed icons differ from the source (${stale.join(", ")}). Run \`node scripts/build-extension-icons.mjs\`.`);
  process.exitCode = 1;
} else {
  console.log(check ? "build-extension-icons: committed icons match the source." : `build-extension-icons: wrote ${SIZES.length} icon(s) to extension/icons/.`);
}
