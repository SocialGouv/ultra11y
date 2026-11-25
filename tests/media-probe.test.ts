// THE MEDIA PROBE (#208): the flash measure and the media inventory as evidence.
//
// `scan` records a short frame sequence of the viewport and counts general flashes in it (RGAA
// 13.7 / WCAG 2.3.1), and lists every media element with its tracks and the captions or
// transcripts found beside it (RGAA 4.x). This pins the pure half — the luminance arithmetic and
// the three-per-second count, the honesty of a sampling rate too low to count anything — and the
// wiring into the evidence of 13.7 and 4.x. The recording itself runs for real in
// tests/media-probe.e2e.test.ts and tests/full-audit.e2e.test.ts.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAdjudicationWorklist, captureFilesPresent } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { FLASH_AREA_THRESHOLD, type LumFrame, luminanceGrid, measureFlashes } from "../src/media.js";
import { parseHtml } from "../src/parse/html.js";
import type { Image } from "../src/pixel.js";
import { PAGES_DIR, SNAPSHOT_VERSION, readSnapshot, writeSnapshot } from "../src/snapshot.js";
import type { MediaDigest } from "../src/types.js";

const solid = (w: number, h: number, v: number): Image => ({ width: w, height: h, at: (x, y) => (x < w && y < h ? { r: v, g: v, b: v, a: 255 } : undefined) });

/** `n` frames at `fps`, every cell alternating dark/light at `hz` (0: steady). */
function frames(n: number, fps: number, hz: number, cells = 100, lightCells = cells): LumFrame[] {
  return Array.from({ length: n }, (_, k) => {
    const t = Math.round((k * 1000) / fps);
    const light = hz > 0 && Math.floor((t / 1000) * hz * 2) % 2 === 1;
    const lum = new Float64Array(cells);
    for (let c = 0; c < cells; c++) lum[c] = light && c < lightCells ? 1 : 0.02;
    return { t, lum };
  });
}

describe("luminanceGrid", () => {
  it("averages relative luminance per cell — black 0, white 1", () => {
    expect([...luminanceGrid(solid(8, 8, 0), 4).lum]).toEqual([0, 0, 0, 0]);
    expect(luminanceGrid(solid(8, 8, 255), 4).lum.every((v) => Math.abs(v - 1) < 1e-9)).toBe(true);
    expect(luminanceGrid(solid(8, 4, 128), 4).lum[0]).toBeCloseTo(0.2158, 3);
  });
});

describe("measureFlashes counts general flashes per one-second window", () => {
  const big = FLASH_AREA_THRESHOLD; // one cell already covers the threshold area
  it("sees nothing in a steady page", () => {
    expect(measureFlashes(frames(30, 20, 0), big, 1450)).toMatchObject({ outcome: "none", maxFlashesPerSecond: 0, flashingArea: 0 });
  });
  it("calls a large area alternating at 5 Hz over the threshold", () => {
    const m = measureFlashes(frames(40, 30, 5), 400, 1300);
    expect(m.maxFlashesPerSecond).toBeGreaterThan(3);
    expect(m.flashingArea).toBe(100 * 400);
    expect(m.outcome).toBe("over-threshold");
  });
  it("keeps a 1 Hz alternation below the threshold — at most 3 flashes a second is allowed", () => {
    const m = measureFlashes(frames(40, 30, 1), big, 1300);
    expect(m.outcome).toBe("below-threshold");
    expect(m.maxFlashesPerSecond).toBeLessThanOrEqual(3);
  });
  it("keeps a fast flash on a small area below the threshold", () => {
    const m = measureFlashes(frames(40, 30, 5, 100, 2), 100, 1300);
    expect(m.maxFlashesPerSecond).toBeGreaterThan(3);
    expect(m.flashingArea).toBe(200);
    expect(m.outcome).toBe("below-threshold");
  });
  it("ignores changes too small, or between two light states, to be a flash", () => {
    const soft = frames(40, 30, 0).map((f, k) => ({ t: f.t, lum: f.lum.map(() => (k % 2 ? 0.3 : 0.25)) }));
    expect(measureFlashes(soft, big, 1300).outcome).toBe("none");
    const bright = frames(40, 30, 0).map((f, k) => ({ t: f.t, lum: f.lum.map(() => (k % 2 ? 1 : 0.85)) }));
    expect(measureFlashes(bright, big, 1300).outcome).toBe("none");
  });
  it("says UNDERSAMPLED — measured nothing — when the frame rate cannot see 3 flashes a second", () => {
    expect(measureFlashes(frames(6, 4, 0), big, 1250).outcome).toBe("undersampled");
    expect(measureFlashes(frames(1, 20, 0), big, 0).outcome).toBe("undersampled");
  });
});

const DOM = `<html lang="fr"><head><title>Vidéo</title></head><body><main>
<h1>Présentation du service</h1>
<video id="film" src="/film.mp4" controls><track kind="captions" srclang="fr" src="/film.vtt"></video>
<p><a href="/film-transcription">Transcription de la vidéo</a></p>
</main></body></html>`;

function capture(media?: MediaDigest): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-media-"));
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "video", name: "Vidéo", url: "https://exemple.test/video" },
    dom: DOM,
    ...(media ? { media } : {}),
  });
  return root;
}

function digest(): MediaDigest {
  const doc = parseHtml(DOM, "x.html");
  const i = doc.elements.findIndex((e) => e.tag === "video");
  return {
    v: 1,
    items: [
      {
        tag: "video",
        i,
        selector: "video#film",
        src: "https://exemple.test/film.mp4",
        kind: "temporal",
        controls: true,
        autoplay: false,
        muted: false,
        loop: false,
        paused: true,
        tracks: [{ kind: "captions", srclang: "fr", src: "/film.vtt", readyState: 3 }],
        companions: [{ via: "adjacent-link", text: "Transcription de la vidéo", href: "/film-transcription" }],
      },
    ],
    flash: { frames: 90, durationMs: 1480, fps: 60, maxFlashesPerSecond: 0, flashingArea: 0, areaThreshold: FLASH_AREA_THRESHOLD, outcome: "none" },
  };
}

const evidenceOf = (root: string, id: string): string[] =>
  (buildAdjudicationWorklist(runAudit({ inputs: [join(root, PAGES_DIR)] }), { standard: "rgaa" }).find((x) => x.criteriaId === id)?.evidence ?? []).map(
    (e) => `${e.selector} :: ${e.note ?? ""}`,
  );

describe("media.json is written, read back, and reaches 4.x and 13.7", () => {
  it("round-trips beside the snapshot and is named among the capture files", () => {
    const dir = join(capture(digest()), PAGES_DIR, "video");
    expect(JSON.parse(readFileSync(join(dir, "media.json"), "utf8")).items).toHaveLength(1);
    expect(readSnapshot(dir)?.media).toEqual(digest());
    expect(captureFilesPresent([join(dir, "dom.html")])).toContain("media.json");
  });

  it("tells 4.1 what loaded and what sits beside the player — a track that failed is said to have failed", () => {
    const ev = evidenceOf(capture(digest()), "4.1");
    const video = ev.find((e) => e.startsWith("video#film :: "));
    expect(video).toMatch(/browser media probe: tracks \[captions:fr \(FAILED to load\)\]/);
    expect(video).toMatch(/adjacent-link "Transcription de la vidéo" -> \/film-transcription/);
  });

  it("puts the flash measure first in 13.7, with what it cannot see", () => {
    const ev = evidenceOf(capture(digest()), "13.7");
    expect(ev[0]).toMatch(
      /^probe:flash :: page="video" flash measure RAN on a 1480 ms viewport recording \(90 frames, 60 frames\/s\): no luminance flash in any cell/,
    );
    expect(ev[0]).toMatch(/saturated-red flashes are not measured/);
  });

  it("says when the measure did not run, and never reads an unmeasured capture as flash-free", () => {
    const ev = evidenceOf(capture({ v: 1, items: [], flashSkipped: "no DevTools session" }), "13.7");
    expect(ev.find((e) => e.startsWith("probe:flash"))).toMatch(/flash measure did NOT run: no DevTools session/);
    expect(evidenceOf(capture(), "13.7").some((e) => e.startsWith("probe:flash"))).toBe(false);
  });
});
