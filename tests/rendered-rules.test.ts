// The rendered tier, exercised through the real audit path: a snapshot on disk, its signals
// verified and attached, the rules run. What matters most here is the NEGATIVE space — every
// case where the tier must stay silent rather than guess.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot, type StyleEntry } from "../src/snapshot.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-rendered-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Build the style digest for a DOM by naming each element's computed declarations in
 *  document order — exactly what the browser collector produces. */
const styles = (entries: [string, Record<string, string>][]): { v: number; entries: StyleEntry[] } => ({
  v: 1,
  entries: entries.map(([tag, css], i) => ({ i, tag, css })),
});

const audit = (dom: string, extra: Record<string, unknown> = {}) => {
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "p", name: "P", url: "https://x/" },
    dom,
    ...extra,
  } as Parameters<typeof writeSnapshot>[1]);
  return runAudit({ inputs: [join(root, PAGES_DIR)] });
};
const ids = (dom: string, extra: Record<string, unknown> = {}) => audit(dom, extra).findings.map((f) => f.ruleId);

const PAGE = (body: string) => `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1>${body}</main></body></html>`;
// html, head, title, body, main, h1, then the body's own elements.
const HEAD: [string, Record<string, string>][] = [
  ["html", {}],
  ["head", {}],
  ["title", {}],
  ["body", { backgroundColor: "rgb(255, 255, 255)" }],
  ["main", {}],
  ["h1", {}],
];

describe("computed contrast (WCAG 1.4.3 → RGAA 3.2 / 10.5)", () => {
  it("reports text that genuinely fails against its effective background", () => {
    const dom = PAGE('<p style="x">grey on white</p>');
    const s = styles([...HEAD, ["p", { color: "rgb(200, 200, 200)", fontSize: "16px" }]]);
    expect(ids(dom, { styles: s })).toContain("rendered-contrast");
  });

  it("stays silent when the contrast passes", () => {
    const dom = PAGE("<p>black on white</p>");
    const s = styles([...HEAD, ["p", { color: "rgb(0, 0, 0)", fontSize: "16px" }]]);
    expect(ids(dom, { styles: s })).not.toContain("rendered-contrast");
  });

  it("applies the large-text threshold from the COMPUTED size, with no unit guessing", () => {
    const dom = PAGE("<p>large grey</p>");
    // 3.1:1 — fails at 4.5 (normal) but passes at 3 (large).
    const grey = { color: "rgb(148, 148, 148)", fontSize: "30px" };
    expect(ids(dom, { styles: styles([...HEAD, ["p", grey]]) })).not.toContain("rendered-contrast");
    expect(ids(dom, { styles: styles([...HEAD, ["p", { ...grey, fontSize: "14px" }]]) })).toContain("rendered-contrast");
  });

  it("says nothing when the backdrop is a background IMAGE — the CSSOM cannot express it", () => {
    const dom = PAGE("<p>over an image</p>");
    const s = styles([
      ["html", {}],
      ["head", {}],
      ["title", {}],
      ["body", { backgroundColor: "rgb(255, 255, 255)", backgroundImage: 'url("hero.jpg")' }],
      ["main", {}],
      ["h1", {}],
      ["p", { color: "rgb(200, 200, 200)", fontSize: "16px" }],
    ]);
    expect(ids(dom, { styles: s })).not.toContain("rendered-contrast");
  });

  it("says nothing when no ancestor declares an opaque background", () => {
    const dom = PAGE("<p>unknown backdrop</p>");
    const s = styles([
      ["html", {}],
      ["head", {}],
      ["title", {}],
      ["body", { backgroundColor: "rgba(0, 0, 0, 0)" }],
      ["main", {}],
      ["h1", {}],
      ["p", { color: "rgb(200, 200, 200)", fontSize: "16px" }],
    ]);
    expect(ids(dom, { styles: s })).not.toContain("rendered-contrast");
  });

  it("ignores text that is not painted at all", () => {
    const dom = PAGE('<p style="x">hidden</p>');
    const s = styles([...HEAD, ["p", { color: "rgb(200, 200, 200)", fontSize: "16px", display: "none" }]]);
    expect(ids(dom, { styles: s })).not.toContain("rendered-contrast");
  });

  it("does not fire at all without signals — an ordinary source audit is unchanged", () => {
    const r = runAudit({ inputs: ["tests/fixtures/non-conforming/bad.html"] });
    expect(r.findings.map((f) => f.ruleId)).not.toContain("rendered-contrast");
  });

  it("refuses a style digest that does not verify against the DOM, rather than mis-attributing", () => {
    const dom = PAGE("<p>text</p>");
    // Same length, wrong tags: the join must be refused WHOLESALE.
    const s = styles([...HEAD, ["div", { color: "rgb(200, 200, 200)", fontSize: "16px" }]]);
    expect(ids(dom, { styles: s })).not.toContain("rendered-contrast");
  });
});

describe("a link identified by colour alone (WCAG 1.4.1 → RGAA 10.6)", () => {
  const linkPage = PAGE('<p>see <a href="/x">the page</a> for more</p>');
  const base: [string, Record<string, string>][] = [...HEAD, ["p", { color: "rgb(0, 0, 0)", fontSize: "16px" }]];

  it("reports a coloured link with no underline inside running text", () => {
    const s = styles([...base, ["a", { color: "rgb(0, 0, 238)", textDecorationLine: "none", fontWeight: "400" }]]);
    expect(ids(linkPage, { styles: s })).toContain("rendered-link-colour-only");
  });

  it("accepts an underline", () => {
    const s = styles([...base, ["a", { color: "rgb(0, 0, 238)", textDecorationLine: "underline", fontWeight: "400" }]]);
    expect(ids(linkPage, { styles: s })).not.toContain("rendered-link-colour-only");
  });

  it("accepts a bottom border", () => {
    const s = styles([
      ...base,
      ["a", { color: "rgb(0, 0, 238)", textDecorationLine: "none", borderBottomStyle: "solid", borderBottomWidth: "1px", fontWeight: "400" }],
    ]);
    expect(ids(linkPage, { styles: s })).not.toContain("rendered-link-colour-only");
  });

  it("accepts a distinctly heavier weight", () => {
    const s = styles([...base, ["a", { color: "rgb(0, 0, 238)", textDecorationLine: "none", fontWeight: "700" }]]);
    expect(ids(linkPage, { styles: s })).not.toContain("rendered-link-colour-only");
  });

  it("accepts a background of its own", () => {
    const s = styles([...base, ["a", { color: "rgb(0, 0, 238)", textDecorationLine: "none", backgroundColor: "rgb(240, 240, 0)", fontWeight: "400" }]]);
    expect(ids(linkPage, { styles: s })).not.toContain("rendered-link-colour-only");
  });

  it("says nothing about a link that is NOT inside running text — a nav link is out of scope", () => {
    const nav = PAGE('<nav><a href="/x">Home</a></nav>');
    const s = styles([...HEAD, ["nav", { color: "rgb(0, 0, 0)" }], ["a", { color: "rgb(0, 0, 238)", textDecorationLine: "none", fontWeight: "400" }]]);
    expect(ids(nav, { styles: s })).not.toContain("rendered-link-colour-only");
  });

  it("says nothing when the link is the SAME colour as its text — that is a different defect", () => {
    const s = styles([...base, ["a", { color: "rgb(0, 0, 0)", textDecorationLine: "none", fontWeight: "400" }]]);
    expect(ids(linkPage, { styles: s })).not.toContain("rendered-link-colour-only");
  });
});

describe("contrast measured on the screenshot (the gradient case)", () => {
  // A 40x20 PNG that is uniformly light grey — a "background image" the CSSOM cannot express.
  function flatPng(w: number, h: number, rgb: [number, number, number]): Buffer {
    const raw = Buffer.alloc(h * (1 + w * 3));
    let o = 0;
    for (let y = 0; y < h; y++) {
      raw[o++] = 0;
      for (let x = 0; x < w; x++) {
        raw[o++] = rgb[0];
        raw[o++] = rgb[1];
        raw[o++] = rgb[2];
      }
    }
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body) >>> 0);
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
  let T: number[] | null = null;
  function crc32(buf: Buffer): number {
    if (!T) {
      T = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        T[n] = c;
      }
    }
    let c = 0xffffffff;
    for (const b of buf) c = T[(c ^ b) & 0xff]! ^ (c >>> 8);
    return c ^ 0xffffffff;
  }

  const dom = PAGE("<p>over a hero image</p>");
  const overImage: [string, Record<string, string>][] = [
    ["html", {}],
    ["head", {}],
    ["title", {}],
    ["body", { backgroundColor: "rgb(255, 255, 255)", backgroundImage: 'url("hero.jpg")' }],
    ["main", {}],
    ["h1", {}],
    ["p", { color: "rgb(230, 230, 230)", fontSize: "16px" }],
  ];
  const boxes = {
    v: 1,
    entries: [
      { i: 0, tag: "html", x: 0, y: 0, w: 40, h: 20 },
      { i: 1, tag: "head", x: 0, y: 0, w: 0, h: 0 },
      { i: 2, tag: "title", x: 0, y: 0, w: 0, h: 0 },
      { i: 3, tag: "body", x: 0, y: 0, w: 40, h: 20 },
      { i: 4, tag: "main", x: 0, y: 0, w: 40, h: 20 },
      { i: 5, tag: "h1", x: 0, y: 0, w: 40, h: 8 },
      { i: 6, tag: "p", x: 0, y: 8, w: 40, h: 12 },
    ],
  };

  const withShot = (rgb: [number, number, number]) => {
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: "p", name: "P", url: "https://x/" },
      dom,
      styles: styles(overImage),
      boxes,
    } as Parameters<typeof writeSnapshot>[1]);
    writeFileSync(join(root, PAGES_DIR, "p", "screen.png"), flatPng(40, 20, rgb));
    return runAudit({ inputs: [join(root, PAGES_DIR)] }).findings.map((f) => f.ruleId);
  };

  it("catches light text on a light hero image — the case computed styles cannot see", () => {
    expect(withShot([255, 255, 255])).toContain("rendered-contrast-pixel");
  });

  it("stays silent when the measured background gives enough contrast", () => {
    expect(withShot([0, 0, 0])).not.toContain("rendered-contrast-pixel");
  });

  it("does not double-report an element the computed styles already decided", () => {
    // Opaque body background, no image: renderedContrast owns this one.
    const s = styles([...HEAD, ["p", { color: "rgb(230, 230, 230)", fontSize: "16px" }]]);
    writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id: "p", name: "P", url: "https://x/" }, dom, styles: s, boxes } as Parameters<typeof writeSnapshot>[1]);
    writeFileSync(join(root, PAGES_DIR, "p", "screen.png"), flatPng(40, 20, [255, 255, 255]));
    const found = runAudit({ inputs: [join(root, PAGES_DIR)] }).findings.map((f) => f.ruleId);
    expect(found).toContain("rendered-contrast");
    expect(found).not.toContain("rendered-contrast-pixel");
  });

  it("says nothing without a screenshot, rather than assuming a backdrop", () => {
    expect(ids(dom, { styles: styles(overImage), boxes })).not.toContain("rendered-contrast-pixel");
  });
});
