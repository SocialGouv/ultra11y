// #135 — A PAGE CAPTURED WHILE STILL LOADING WAS RECORDED AS AUDITED.
//
// egapro's `admin-declaration-detail` was snapshotted on its « Chargement... » placeholder: a
// header, a footer and one paragraph where the declaration would be. Nothing about that capture
// looked wrong, so it counted as an audited page and every criterion about the missing content
// read as silence. The producers now wait (bounded) for the loading markers to clear; a page
// still loading is recorded MARKED, reported « capture en état de chargement », and its silence
// concludes nothing. Its findings — real defects in what WAS on screen — stand.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { LOADING_STATE, waitForLoaded } from "../src/collector.js";
import { buildPayload } from "../src/integrations/payload.js";
import { basisLabel, pageBasisWarning, pageScopesFrom } from "../src/pages.js";
import { PAGES_DIR, PROBES_VERSION, SNAPSHOT_VERSION, pageScreenshot, readSnapshot, validateSnapshotMeta, writeSnapshot } from "../src/snapshot.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-loading-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("waitForLoaded — bounded, and honest about what it gave up on", () => {
  /** A page that answers LOADING_STATE with the next item of `answers` (the last one repeats). */
  const pageAnswering = (answers: unknown[]) => {
    let n = 0;
    const seen: string[] = [];
    return {
      seen,
      evaluate: async (script: string) => {
        seen.push(script);
        return answers[Math.min(n++, answers.length - 1)];
      },
    };
  };

  it("returns as soon as the markers clear", async () => {
    const page = pageAnswering([['aria-busy="true" main'], ['aria-busy="true" main'], []]);
    const r = await waitForLoaded(page, 5_000, 1);
    expect(r.markers).toEqual([]);
    expect(page.seen.every((s) => s === LOADING_STATE)).toBe(true);
    expect(page.seen).toHaveLength(3);
  });

  it("gives up at the bound and hands back the markers still there", async () => {
    const page = pageAnswering([['text "Chargement..." p']]);
    const r = await waitForLoaded(page, 60, 10);
    expect(r.markers).toEqual(['text "Chargement..." p']);
    expect(r.waitedMs).toBeGreaterThanOrEqual(60);
  });

  it("checks once and does not wait with a zero bound", async () => {
    const page = pageAnswering([["indeterminate progress progress"]]);
    const r = await waitForLoaded(page, 0);
    expect(page.seen).toHaveLength(1);
    expect(r.markers).toHaveLength(1);
  });

  it("treats a page that cannot answer as not known to be loading", async () => {
    const r = await waitForLoaded(
      {
        evaluate: async () => {
          throw new Error("context destroyed");
        },
      },
      1_000,
    );
    expect(r.markers).toEqual([]);
  });
});

describe("the loading mark travels from the collector to the report", () => {
  const collected = { dom: "<html></html>", title: "Détail", url: "https://x/admin/d/1", loading: ['text "Chargement..." p'] };

  it("buildPayload stamps it in meta, and leaves a ready page unmarked", () => {
    expect(buildPayload(collected, collected.url, "playwright", {}).meta.loading).toEqual(['text "Chargement..." p']);
    expect(buildPayload({ ...collected, loading: [] }, collected.url, "playwright", {}).meta).not.toHaveProperty("loading");
  });

  it("validateSnapshotMeta keeps a non-empty list, drops an empty one, refuses anything else", () => {
    const base = { v: 1, id: "d", name: "D", url: "https://x/d" };
    expect(validateSnapshotMeta({ ...base, loading: ['aria-busy="true" main'] }).meta?.loading).toEqual(['aria-busy="true" main']);
    expect(validateSnapshotMeta({ ...base, loading: [] }).meta).not.toHaveProperty("loading");
    expect(validateSnapshotMeta({ ...base, loading: "yes" }).ok).toBe(false);
  });

  it("a marked capture's page basis is « loading », labelled and warned in both languages", () => {
    const [p] = pageScopesFrom([{ meta: { id: "d", name: "D", url: "https://x/d", loading: ["x"] } }]);
    expect(p?.basis).toBe("loading");
    expect(pageScopesFrom([{ meta: { id: "d", name: "D", url: "https://x/d" } }])[0]?.basis).toBe("snapshot");
    expect(basisLabel("loading", "fr")).toBe("capture en état de chargement");
    expect(basisLabel("loading", "en")).toBe("captured while loading");
    expect(pageBasisWarning("loading", "fr")).toMatch(/n'y vaut PAS conformité/);
  });
});

describe("a capture of a placeholder concludes nothing from its silence", () => {
  const DOM = `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><p>Chargement...</p></main></body></html>`;
  const write = (id: string, loading?: string[]) =>
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id, name: id, url: `https://x/${id}`, ...(loading ? { loading } : {}) },
      dom: DOM,
      probes: { v: PROBES_VERSION, probed: ["1.4.10", "1.4.12"], reflow: { horizontalScroll: false } },
    });
  const of = (r: ReturnType<typeof runAudit>, sc: string) => r.criteria.find((c) => c.id === sc);

  it("keeps a probed criterion open when one page was captured loading — and closes it when none was", () => {
    write("ready");
    write("busy", ['text "Chargement..." p']);
    const r = runAudit({ inputs: [join(root, PAGES_DIR)] });
    expect(of(r, "1.4.10")?.status, "the busy page's silence must not count as a measurement").toBe("manual");
    expect(r.scope.pageCoverage?.busy?.scs ?? []).toEqual([]);

    rmSync(join(root, PAGES_DIR, "busy"), { recursive: true, force: true });
    write("busy");
    expect(of(runAudit({ inputs: [join(root, PAGES_DIR)] }), "1.4.10")?.status).toBe("C");
  });

  it("still reports what the browser FOUND on it", () => {
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: "busy", name: "busy", url: "https://x/busy", loading: ["x"] },
      dom: DOM,
      probes: { v: PROBES_VERSION, probed: ["1.4.10"], reflow: { horizontalScroll: true } },
    });
    const r = runAudit({ inputs: [join(root, PAGES_DIR)] });
    expect(of(r, "1.4.10")?.status).toBe("NC");
  });
});

describe("the whole page, beside the viewport shot", () => {
  const PNG = Buffer.from("89504e470d0a1a0a", "hex").toString("base64");

  it("is written as screen-full.png, read back, and preferred for the report's reader", () => {
    const dir = writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: "long", name: "Long", url: "https://x/long" },
      dom: "<html></html>",
      screenshotBase64: PNG,
      screenshotFullBase64: PNG,
    });
    expect(existsSync(join(dir, "screen.png"))).toBe(true);
    expect(readFileSync(join(dir, "screen-full.png")).toString("base64")).toBe(PNG);
    expect(readSnapshot(dir)?.screenshotFull).toBe("screen-full.png");
    expect(pageScreenshot(join(root, PAGES_DIR), "long")).toBe(join(dir, "screen-full.png"));
  });

  it("falls back to the viewport shot, and to nothing", () => {
    const dir = writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id: "short", name: "S", url: "https://x/s" }, dom: "<html></html>", screenshotBase64: PNG });
    expect(pageScreenshot(join(root, PAGES_DIR), "short")).toBe(join(dir, "screen.png"));
    expect(pageScreenshot(join(root, PAGES_DIR), "none")).toBeUndefined();
  });

  it("rides in the payload next to the viewport one", () => {
    const p = buildPayload({ dom: "<html></html>" }, "https://x/", "playwright", {}, "VIEW", undefined, undefined, "FULL");
    expect(p.screenshot).toBe("VIEW");
    expect(p.screenshotFull).toBe("FULL");
  });
});

describe("LOADING_STATE is the expression it reads as", () => {
  // A template-literal escape lost on the way into the browser turns `\s` into a literal `s` —
  // a regex that still matches « Chargement... » and silently mangles every other phrase.
  it("keeps its regex escapes intact in the evaluated source", () => {
    expect(LOADING_STATE).toContain("\\s*(\\.{1,3}|…)?$/i");
    expect(LOADING_STATE).toContain(".replace(/\\s+/g, ' ')");
  });
});
