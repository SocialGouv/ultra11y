import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cropFinding, evidenceNotice, loadPageEvidence, pageIdOfSnapshot, writeEvidence } from "../src/evidence.js";
import { findingId } from "../src/baseline.js";
import { parseHtml } from "../src/parse/html.js";
import { decodePng, encodePng } from "../src/pixel.js";
import { snapshotDir } from "../src/snapshot.js";
import type { AuditResult, BoxEntry, Finding } from "../src/types.js";

// The fixtures are BUILT, never committed: a snapshot is four files and a PNG we can make
// with the engine's own encoder, so the test owns its inputs and no binary enters the repo.

// Seven link classes on seven DISTINCT elements: the shape issue #16 actually measured —
// 472 findings of one rule collapsing onto a handful of different things.
const LINKS = ["fr-link", "fr-btn", "fr-nav__link", "fr-footer__bottom-link", "fr-sidemenu__link", "fr-summary__link", "fr-tag"];
const DOM = `<html><head><title>T</title></head><body><main><p>x</p>${LINKS.map((c) => `<a class="${c}" href="/a">go</a>`).join("")}</main></body></html>`;

let root = "";

/** Document-order ordinal and byte offset of the first element with this tag. */
function anchor(tag: string): { ordinal: number; start: number } {
  const doc = parseHtml(DOM, "d.html");
  for (let i = 0; i < doc.elements.length; i++) {
    const el = doc.elements[i]!;
    if (el.tag === tag) return { ordinal: i, start: el.start! };
  }
  throw new Error(`no <${tag}> in the fixture`);
}

/** Every `<a>`, in document order — one per class in LINKS. */
function anchors(): { ordinal: number; start: number }[] {
  const doc = parseHtml(DOM, "d.html");
  const out: { ordinal: number; start: number }[] = [];
  for (let i = 0; i < doc.elements.length; i++) {
    const el = doc.elements[i]!;
    if (el.tag === "a") out.push({ ordinal: i, start: el.start! });
  }
  return out;
}

/** A flat RGBA image of the given size, as a PNG. */
function shot(w: number, h: number): Buffer {
  return encodePng({ width: w, height: h, data: Buffer.alloc(w * h * 4, 0xc0) });
}

interface SnapOpts {
  boxes?: BoxEntry[];
  viewport?: { width: number; height: number } | null;
  img?: { w: number; h: number };
  screenshot?: Buffer | null;
  truncated?: boolean;
  dom?: string;
}

function snapshot(id: string, o: SnapOpts = {}): void {
  const dir = snapshotDir(root, id);
  mkdirSync(dir, { recursive: true });
  const viewport = o.viewport === undefined ? { width: 400, height: 300 } : o.viewport;
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id, name: id, url: `https://x.test/${id}`, ...(viewport ? { viewport } : {}) }));
  writeFileSync(join(dir, "dom.html"), o.dom ?? DOM);
  const boxes = o.boxes ?? defaultBoxes();
  writeFileSync(join(dir, "boxes.json"), JSON.stringify({ v: 1, entries: boxes, ...(o.truncated ? { truncated: true } : {}) }));
  const img = o.img ?? { w: 400, h: 300 };
  if (o.screenshot !== null) writeFileSync(join(dir, "screen.png"), o.screenshot ?? shot(img.w, img.h));
}

/** `<html>` at ordinal 0 spanning the viewport, plus one small box per link — the #16 shape. */
function defaultBoxes(): BoxEntry[] {
  const doc = parseHtml(DOM, "d.html");
  return [
    { i: 0, tag: doc.elements[0]!.tag, x: 0, y: 0, w: 400, h: 300 },
    ...anchors().map((a, n) => ({ i: a.ordinal, tag: "a", x: 40, y: 20 + n * 30, w: 50, h: 18 })),
  ];
}

function finding(over: Partial<Finding> = {}): Finding {
  const a = anchor("a");
  return {
    ruleId: "rendered-link-colour-only",
    criteriaId: "1.4.1",
    file: join(snapshotDir(root, "accueil"), "dom.html"),
    line: 2,
    col: 1,
    selectorHint: "a.fr-link",
    severity: "majeur",
    message: "lien identifié par la couleur seule",
    remediation: "Ajoutez un indice non coloré",
    snippet: "<a>",
    sourceStart: a.start,
    ...over,
  } as Finding;
}

function audit(findings: Finding[]): AuditResult {
  return { findings, criteria: [], scope: { inputs: [], files: 1 } } as unknown as AuditResult;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ultra11y-evidence-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("finding → pixels", () => {
  it("joins through sourceStart, and ignores selectorHint entirely", () => {
    snapshot("accueil");
    const ctx = loadPageEvidence(root, "accueil");
    expect("skip" in ctx).toBe(false);
    if ("skip" in ctx) return;

    const right = cropFinding(ctx, finding());
    expect("skip" in right).toBe(false);
    if ("skip" in right) return;
    expect(right.box).toMatchObject({ x: 40, y: 20, w: 50, h: 18 });

    // A wrong selector must change nothing: it is a human hint, not the join key.
    const lying = cropFinding(ctx, finding({ selectorHint: "div.totally-wrong" }));
    expect("skip" in lying).toBe(false);
    if ("skip" in lying) return;
    expect(lying.box).toEqual(right.box);
    expect(lying.png.equals(right.png)).toBe(true);
  });

  it("draws the mark inside the crop, and the crop is a real decodable PNG", () => {
    snapshot("accueil");
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    const crop = cropFinding(ctx, finding());
    if ("skip" in crop) throw new Error(`unexpected skip: ${crop.skip}`);
    const img = decodePng(crop.png);
    expect(img).not.toBeNull();
    expect(img!.width).toBe(crop.width);
    // The page is flat grey; the ring must have put non-grey pixels in.
    let marked = 0;
    for (let y = 0; y < img!.height; y++) for (let x = 0; x < img!.width; x++) if (img!.at(x, y)!.r !== 0xc0) marked++;
    expect(marked).toBeGreaterThan(0);
  });

  it("refuses a finding with no source anchor", () => {
    snapshot("accueil");
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    const f = finding();
    delete (f as { sourceStart?: number }).sourceStart;
    expect(cropFinding(ctx, f)).toEqual({ skip: "no-offsets" });
  });

  it("refuses an anchor that matches no element", () => {
    snapshot("accueil");
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    expect(cropFinding(ctx, finding({ sourceStart: 99999 }))).toEqual({ skip: "unjoinable" });
  });

  it("refuses the document element — the page screenshot is already that illustration", () => {
    snapshot("accueil");
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    const doc = parseHtml(DOM, "d.html");
    expect(cropFinding(ctx, finding({ sourceStart: doc.elements[0]!.start }))).toEqual({ skip: "page-scope" });
  });

  it("refuses an element covering most of the viewport", () => {
    const a = anchor("a");
    snapshot("accueil", {
      boxes: [
        { i: 0, tag: "html", x: 0, y: 0, w: 400, h: 300 },
        { i: a.ordinal, tag: "a", x: 0, y: 0, w: 400, h: 250 },
      ],
    });
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    expect(cropFinding(ctx, finding())).toEqual({ skip: "page-scope" });
  });

  it("refuses an element below the fold of a viewport-only capture", () => {
    const a = anchor("a");
    snapshot("accueil", {
      boxes: [
        { i: 0, tag: "html", x: 0, y: 0, w: 400, h: 300 },
        { i: a.ordinal, tag: "a", x: 10, y: 900, w: 50, h: 18 },
      ],
    });
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    expect(cropFinding(ctx, finding())).toEqual({ skip: "below-the-fold" });
  });

  it("refuses an element that paints nothing", () => {
    const a = anchor("a");
    snapshot("accueil", {
      boxes: [
        { i: 0, tag: "html", x: 0, y: 0, w: 400, h: 300 },
        { i: a.ordinal, tag: "a", x: 10, y: 10, w: 0, h: 0 },
      ],
    });
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    expect(cropFinding(ctx, finding())).toEqual({ skip: "zero-area" });
  });
});

describe("the device-scale problem", () => {
  it("derives scale 2 from a 2× screenshot and places the mark accordingly", () => {
    snapshot("accueil", { img: { w: 800, h: 600 } });
    const ctx = loadPageEvidence(root, "accueil");
    if ("skip" in ctx) throw new Error("fixture");
    expect(ctx.scale).toBe(2);
    const crop = cropFinding(ctx, finding());
    if ("skip" in crop) throw new Error(`unexpected skip: ${crop.skip}`);
    expect(crop.scale).toBe(2);
  });

  it("falls back to the html box when meta.viewport is absent", () => {
    snapshot("accueil", { viewport: null, img: { w: 800, h: 600 } });
    const ctx = loadPageEvidence(root, "accueil");
    expect("skip" in ctx).toBe(false);
    if ("skip" in ctx) return;
    expect(ctx.scale).toBe(2);
  });

  it("never assumes 1 — an indeterminate ratio yields no crop at all", () => {
    snapshot("accueil", { viewport: null, boxes: [{ i: 0, tag: "html", x: 0, y: 0, w: 0, h: 0 }], img: { w: 800, h: 600 } });
    expect(loadPageEvidence(root, "accueil")).toEqual({ skip: "unknown-scale" });
  });

  it("refuses a scale outside the plausible band — the image and the boxes are not the same render", () => {
    snapshot("accueil", { viewport: { width: 20, height: 20 }, boxes: [{ i: 0, tag: "html", x: 0, y: 0, w: 20, h: 20 }], img: { w: 800, h: 600 } });
    expect(loadPageEvidence(root, "accueil")).toEqual({ skip: "unknown-scale" });
  });
});

describe("refusing a page wholesale", () => {
  it("says no-snapshot when the directory is not there", () => {
    expect(loadPageEvidence(root, "ghost")).toEqual({ skip: "no-snapshot" });
  });

  it("says no-screenshot when the producer captured none", () => {
    snapshot("accueil", { screenshot: null });
    expect(loadPageEvidence(root, "accueil")).toEqual({ skip: "no-screenshot" });
  });

  it("never throws on a corrupt screenshot", () => {
    snapshot("accueil", { screenshot: Buffer.from("this is not a png at all, not even close") });
    expect(() => loadPageEvidence(root, "accueil")).not.toThrow();
    expect(loadPageEvidence(root, "accueil")).toEqual({ skip: "unreadable-image" });
  });

  it("refuses boxes that do not verify against the serialized DOM, wholesale", () => {
    const a = anchor("a");
    snapshot("accueil", {
      boxes: [
        { i: 0, tag: "html", x: 0, y: 0, w: 400, h: 300 },
        { i: a.ordinal, tag: "span", x: 40, y: 60, w: 50, h: 18 }, // wrong tag for that ordinal
      ],
    });
    expect(loadPageEvidence(root, "accueil")).toEqual({ skip: "no-boxes" });
  });
});

describe("writeEvidence", () => {
  it("ignores source findings even when they carry a page id", () => {
    snapshot("accueil");
    const out = join(root, "audits");
    const m = writeEvidence(audit([finding({ file: "src/app/page.tsx", page: "accueil" })]), { outDir: out, root });
    expect(m.crops.size).toBe(0);
    expect(m.totals.located).toBe(0); // not a snapshot path — never even considered
  });

  it("ignores component captures", () => {
    snapshot("accueil");
    const out = join(root, "audits");
    const m = writeEvidence(audit([finding({ file: ".ultra11y/captures/Button.html" })]), { outDir: out, root });
    expect(m.crops.size).toBe(0);
  });

  it("collapses 472 findings of one rule to a handful, and says how many it dropped", () => {
    snapshot("accueil");
    // 472 occurrences over 7 distinct elements — each one a real anchor with its own offset,
    // exactly as the engine raises them. Identical occurrences of the SAME element share a
    // findingId by design, so what the cap has to collapse is the distinct ones.
    const els = anchors();
    const findings = Array.from({ length: 472 }, (_, i) => {
      const a = els[i % els.length]!;
      return finding({ selectorHint: `a.${LINKS[i % LINKS.length]}`, sourceStart: a.start, col: i + 1 });
    });
    const out = join(root, "audits");
    const m = writeEvidence(audit(findings), { outDir: out, root });

    expect(m.crops.size).toBe(6); // the per-rule cap, over 7 distinct elements
    expect(new Set([...m.crops.values()].map((c) => c.ruleId)).size).toBe(1);
    expect(m.totals.imaged).toBe(6);
    expect(m.totals.located).toBe(472);
    expect(m.totals.skipped.capped).toBe(466);
    // The arithmetic must close: nothing is dropped without being counted.
    expect(m.totals.imaged + (m.totals.skipped.capped ?? 0)).toBe(m.totals.located);
  });

  it("caps a page even when the rules are many", () => {
    snapshot("accueil");
    const findings = Array.from({ length: 40 }, (_, i) => finding({ ruleId: `rule-${i}`, selectorHint: `sel-${i}`, col: i + 1 }));
    const m = writeEvidence(audit(findings), { outDir: join(root, "audits"), root });
    expect(m.crops.size).toBe(12); // the per-page cap
    expect(m.totals.skipped.capped).toBe(28);
  });

  it("writes real files under assets/<page-id>/, with stable collision-free names", () => {
    snapshot("accueil");
    const a = join(root, "a");
    const b = join(root, "b");
    const findings = [finding({ selectorHint: "a.one", col: 1 }), finding({ selectorHint: "a.two", col: 2 })];
    const ma = writeEvidence(audit(findings), { outDir: a, root });
    const mb = writeEvidence(audit(findings), { outDir: b, root });

    const namesA = readdirSync(join(a, "assets", "accueil")).sort();
    const namesB = readdirSync(join(b, "assets", "accueil")).sort();
    expect(namesA).toEqual(namesB); // stable across runs
    expect(new Set(namesA).size).toBe(namesA.length); // collision-free
    for (const c of ma.crops.values()) {
      expect(decodePng(readFileSync(c.path))).not.toBeNull();
      expect(c.href.startsWith("./assets/accueil/")).toBe(true);
      expect(c.href).not.toContain("..");
    }
    expect([...ma.crops.keys()].sort()).toEqual([...mb.crops.keys()].sort());
  });

  it("keys the manifest by the same identity SARIF fingerprints use", () => {
    snapshot("accueil");
    const f = finding();
    const m = writeEvidence(audit([f]), { outDir: join(root, "audits"), root });
    expect([...m.crops.keys()]).toEqual([findingId(f)]);
  });

  it("records the page-wide reason when a page has no screenshot at all", () => {
    snapshot("accueil", { screenshot: null });
    const m = writeEvidence(audit([finding(), finding({ col: 2 })]), { outDir: join(root, "audits"), root });
    expect(m.crops.size).toBe(0);
    expect(m.perPage.get("accueil")).toMatchObject({ located: 2, imaged: 0, skipped: { "no-screenshot": 2 } });
  });

  it("leaves advisory findings alone — a recommendation is not a non-conformity", () => {
    snapshot("accueil");
    const m = writeEvidence(audit([finding({ advisory: true })]), { outDir: join(root, "audits"), root });
    expect(m.totals.located).toBe(0);
  });
});

describe("what the report says about what it did not draw", () => {
  it("names every reason, with a count, in both languages", () => {
    snapshot("accueil", { screenshot: null });
    const m = writeEvidence(audit([finding(), finding({ col: 2 })]), { outDir: join(root, "audits"), root });
    const fr = evidenceNotice(m, "accueil", "fr");
    const en = evidenceNotice(m, "accueil", "en");
    expect(fr.join("\n")).toContain("2 occurrence(s) ne sont pas illustrées");
    expect(en.join("\n")).toContain("2 occurrence(s) are not illustrated");
    expect(fr.join("\n")).not.toEqual(en.join("\n"));
  });

  it("says nothing when everything located was imaged", () => {
    snapshot("accueil");
    const m = writeEvidence(audit([finding()]), { outDir: join(root, "audits"), root });
    expect(evidenceNotice(m, "accueil", "fr")).toEqual([]);
    expect(evidenceNotice(m, null, "en")).toEqual([]);
  });

  // `check` scans the WHOLE document for `<id> —` criterion mentions (src/check.ts). An alt
  // text or a notice carrying `1.4 —` would be read as a criterion reference and corrupt it.
  it("never emits a `N.N —` sequence that check would mistake for a criterion reference", () => {
    snapshot("accueil", { screenshot: null });
    const m = writeEvidence(audit([finding()]), { outDir: join(root, "audits"), root });
    for (const lang of ["fr", "en"] as const) {
      expect(evidenceNotice(m, "accueil", lang).join("\n")).not.toMatch(/\d+\.\d+\s*—/);
    }
    snapshot("home");
    const m2 = writeEvidence(audit([finding({ file: join(snapshotDir(root, "home"), "dom.html") })]), { outDir: join(root, "a2"), root });
    for (const c of m2.crops.values()) {
      expect(c.alt.fr).not.toMatch(/\d+\.\d+\s*—/);
      expect(c.alt.en).not.toMatch(/\d+\.\d+\s*—/);
      expect(c.alt.fr).not.toEqual(c.alt.en);
    }
  });
});

describe("pageIdOfSnapshot", () => {
  it("reads the page id out of a snapshot path, and refuses anything else", () => {
    expect(pageIdOfSnapshot(".ultra11y/pages/accueil/dom.html")).toBe("accueil");
    expect(pageIdOfSnapshot("/abs/.ultra11y/pages/mes-informations/dom.html")).toBe("mes-informations");
    expect(pageIdOfSnapshot("src/app/page.tsx")).toBeNull();
    expect(pageIdOfSnapshot(".ultra11y/captures/Button.html")).toBeNull();
  });
});
