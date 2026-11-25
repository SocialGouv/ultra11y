// THE MEDIA AND SCREEN-READER PROBES AGAINST REAL CHROMIUM (#208).
//
// The pure halves are pinned in tests/media-probe.test.ts and tests/screen-reader.test.ts. This
// runs the browser halves on pages built for the purpose: a full-viewport square alternating black
// and white six times a second must come out OVER the general flash threshold, a slow fade and a
// still page must not, a video's track must be listed as the browser loaded it with the
// transcript link beside it, and the tree a reader is handed must name a disclosure's state and
// join each node to the element the snapshot serializes.
//
// It needs Chromium, so it lives in the browser tier (vitest.browser.config.ts); it skips where
// none can launch — unless ULTRA11Y_REQUIRE_BROWSER=1, where a skip would be a green lie.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ELEMENT_WALK } from "../src/collector.js";
import { probeMedia } from "../src/media.js";
import { announce, captureAxTree } from "../src/screen-reader.js";

let browser: any;
beforeAll(async () => {
  try {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch();
  } catch {
    browser = undefined;
  }
  if (process.env.ULTRA11Y_REQUIRE_BROWSER === "1" && !browser)
    throw new Error("ultra11y: ULTRA11Y_REQUIRE_BROWSER=1 but no Chromium could be launched — the capture probes did not run.");
}, 120_000);
afterAll(async () => {
  await browser?.close();
});

async function onPage<T>(html: string, run: (page: unknown) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await run(page);
  } finally {
    await context.close();
  }
}

const page = (body: string, head = "") => `<!doctype html><html lang="fr"><head><title>Essai</title>${head}</head><body>${body}</body></html>`;

describe("the flash measure on a real viewport recording", () => {
  it("calls a full-viewport black/white alternation at 6 Hz over the general flash threshold", async () => {
    if (!browser) return;
    const css = `<style>html,body{margin:0;height:100%}#f{position:fixed;inset:0;background:#000;animation:fl 166ms steps(1) infinite}@keyframes fl{50%{background:#fff}}</style>`;
    const media = await onPage(page('<div id="f"></div>', css), (p) => probeMedia(p, { flash: true }));
    expect(media?.flash?.fps, JSON.stringify(media?.flash)).toBeGreaterThanOrEqual(20);
    expect(media?.flash?.outcome, JSON.stringify(media?.flash)).toBe("over-threshold");
    expect(media?.flash?.maxFlashesPerSecond).toBeGreaterThan(3);
    // The running CSS animation is inventoried as something that can flash.
    expect(media?.items.map((m) => `${m.kind}:${m.selector}`)).toContain("animated:div#f");
  });

  it("sees no flash on a still page, and none in a slow two-second fade", async () => {
    if (!browser) return;
    const still = await onPage(page("<main><h1>Calme</h1><p>Rien ne bouge.</p></main>"), (p) => probeMedia(p, { flash: true }));
    expect(still?.flash?.outcome).toBe("none");
    expect(still?.items).toEqual([]);
    const css = `<style>#f{position:fixed;inset:0;animation:fade 2s linear infinite alternate}@keyframes fade{from{background:#000}to{background:#fff}}</style>`;
    const fade = await onPage(page('<div id="f"></div>', css), (p) => probeMedia(p, { flash: true }));
    expect(["none", "below-threshold"]).toContain(fade?.flash?.outcome);
  });

  it("records the inventory only, and says so, when the flash measure is off", async () => {
    if (!browser) return;
    const media = await onPage(page("<main><p>État de parcours.</p></main>"), (p) => probeMedia(p, { flash: false }));
    expect(media?.flash).toBeUndefined();
    expect(media?.flashSkipped).toMatch(/journey state/);
  });
});

describe("the media inventory", () => {
  it("lists a video with its track, as the browser loaded it, and the transcript link beside it", async () => {
    if (!browser) return;
    const vtt = "data:text/vtt;charset=utf-8,WEBVTT%0A%0A00:00.000 --> 00:01.000%0ABonjour";
    const html = page(
      `<main><h1>Présentation</h1><figure><video id="film" controls aria-describedby="resume"><track kind="captions" srclang="fr" label="Français" src="${vtt}" default></video><figcaption>Le service en une minute</figcaption></figure><p id="resume">Résumé de la vidéo.</p><p><a href="/transcription">Transcription textuelle</a></p></main>`,
    );
    const media = await onPage(html, async (p) => {
      // Give the default track the time to load.
      await (p as { waitForTimeout: (ms: number) => Promise<void> }).waitForTimeout(300);
      return probeMedia(p, { flash: false });
    });
    const video = media?.items.find((m) => m.tag === "video");
    expect(video).toMatchObject({ kind: "temporal", selector: "video#film", controls: true });
    expect(video?.tracks).toEqual([expect.objectContaining({ kind: "captions", srclang: "fr", label: "Français", default: true })]);
    expect(video?.companions.map((c) => c.via)).toEqual(expect.arrayContaining(["aria-describedby", "figcaption", "adjacent-link"]));
    expect(video?.companions.find((c) => c.via === "adjacent-link")).toMatchObject({ text: "Transcription textuelle", href: "/transcription" });
    expect(typeof video?.i).toBe("number");
  });
});

describe("the accessibility tree a screen reader is handed", () => {
  it("names the disclosure's state, the field's required and invalid states, and joins each node to its element", async () => {
    if (!browser) return;
    const html = page(
      `<main><h1>Contact</h1><button type="button" id="menu" aria-expanded="false" onclick="this.setAttribute('aria-expanded', this.getAttribute('aria-expanded') === 'true' ? 'false' : 'true')">Rubriques</button><form><label for="c">Courriel</label><input id="c" type="email" required value="pas-une-adresse"></form></main>`,
    );
    const { before, after, tags } = await onPage(html, async (p) => {
      const pg = p as { evaluate: (s: string) => Promise<unknown>; click: (s: string) => Promise<void> };
      const tags = (await pg.evaluate(`(${ELEMENT_WALK})(document).map((e) => e.localName)`)) as string[];
      const before = await captureAxTree(pg);
      await pg.click("#menu");
      const after = await captureAxTree(pg);
      return { before, after, tags };
    });
    const said = announce(before).entries;
    expect(said.map((e) => e.text)).toEqual(expect.arrayContaining(['heading level 1 "Contact"', 'button "Rubriques", collapsed']));
    const field = said.find((e) => e.role === "textbox");
    expect(field?.name).toBe("Courriel");
    expect(field?.states).toEqual(expect.arrayContaining(["required", "invalid"]));
    // Every joined node's tag is the tag the snapshot's own walk finds at that ordinal.
    for (const e of said.filter((x) => x.i !== undefined)) expect(tags[e.i!], e.text).toBe(e.tag);
    expect(announce(after).entries.map((e) => e.text)).toContain('button "Rubriques", expanded');
  });
});
