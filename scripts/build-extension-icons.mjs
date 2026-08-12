#!/usr/bin/env node
// Generates the browser extension's icons — DEV ONLY, never shipped in the engine bundle.
//
// Why generate rather than commit a binary somebody drew: an icon is the one asset a reviewer
// cannot diff. Deriving it from a few lines of code means the shape is reviewable, every size
// is guaranteed consistent, and `--check` can prove the committed PNGs are exactly what this
// script produces — the same reproducibility contract the engine bundle is held to.
//
// The mark is an eye (the action's own branding icon), drawn as a filled lens with a pupil on
// the purple the action already declares. The PNG encoder is the engine's own
// (`src/pixel.ts`), imported through Node's type-stripping — the repo has no image dependency
// and is not about to grow one for four small files.
//
// That import runs both ways: because these four icons are committed, `--check` re-encodes
// them and proves `encodePng` still emits the exact bytes it emitted when they were drawn.
// A decode/encode round-trip could only prove the pair is self-consistent; this proves the
// encoder is PNG-correct against files a browser accepts. Keep `src/pixel.ts` a leaf (one
// runtime import, `node:zlib`) or this import stops resolving.
//
//   node scripts/build-extension-icons.mjs           # write
//   node scripts/build-extension-icons.mjs --check   # fail if the committed files differ
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/pixel.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "extension", "icons");
const SIZES = [16, 32, 48, 128];

// action.yml declares `color: purple`; keep the extension recognisably the same tool.
const BG = [107, 70, 193]; // #6b46c1
const FG = [255, 255, 255];

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
  const bytes = encodePng({ width: size, height: size, data: draw(size) });
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
