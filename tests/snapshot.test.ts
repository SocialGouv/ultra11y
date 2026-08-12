import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SNAPSHOT_VERSION,
  PAGES_DIR,
  slugifyPageId,
  writeSnapshot,
  readSnapshot,
  readSnapshots,
  validateSnapshotMeta,
  alignedStyles,
  isSnapshotDom,
  snapshotPageId,
  COLLECT_SNAPSHOT,
  type Snapshot,
  type StyleDigest,
  type StyleEntry,
} from "../src/snapshot.js";
import { parseCaptureProvenance } from "../src/capture.js";
import { runAudit } from "../src/audit.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-snap-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  meta: { v: SNAPSHOT_VERSION, id: "accueil", name: "Page d'accueil", url: "https://example.com/", ...(over.meta ?? {}) },
  dom: '<!doctype html><html lang="fr"><head><title>Accueil</title></head><body><img src="x"></body></html>',
  ...over,
});

describe("page identity", () => {
  it("slugifies a URL into a stable, filesystem-safe id", () => {
    expect(slugifyPageId("https://example.com/nous-contacter")).toBe("nous-contacter");
    expect(slugifyPageId("https://example.com/")).toBe("accueil");
    expect(slugifyPageId("https://example.com/blog/mon-article?x=1#h")).toBe("blog-mon-article");
  });

  it("is deterministic and collision-free for distinct paths", () => {
    expect(slugifyPageId("https://a.test/x/y")).toBe(slugifyPageId("https://b.test/x/y"));
    expect(slugifyPageId("https://a.test/x")).not.toBe(slugifyPageId("https://a.test/y"));
  });

  it("strips characters a path cannot hold", () => {
    expect(slugifyPageId("https://x/Accès/Été ?")).toMatch(/^[a-z0-9-]+$/);
  });

  it("never returns an empty id", () => {
    expect(slugifyPageId("https://x/---")).toBeTruthy();
    expect(slugifyPageId("")).toBeTruthy();
  });
});

describe("snapshot round-trip", () => {
  it("writes then reads back the same snapshot", () => {
    const dir = writeSnapshot(root, snap());
    const back = readSnapshot(dir);
    expect(back?.meta.id).toBe("accueil");
    expect(back?.meta.url).toBe("https://example.com/");
    expect(back?.dom).toContain("<title>Accueil</title>");
  });

  it("writes under <root>/<PAGES_DIR>/<id>/", () => {
    const dir = writeSnapshot(root, snap());
    expect(dir).toBe(join(root, PAGES_DIR, "accueil"));
    expect(existsSync(join(dir, "meta.json"))).toBe(true);
    expect(existsSync(join(dir, "dom.html"))).toBe(true);
  });

  it("persists the optional signal files only when supplied", () => {
    const dir = writeSnapshot(root, snap());
    expect(existsSync(join(dir, "styles.json"))).toBe(false);
    const dir2 = writeSnapshot(root, snap({ styles: { v: 1, entries: [{ i: 0, tag: "html", css: { color: "rgb(0, 0, 0)" } }] } }));
    expect(existsSync(join(dir2, "styles.json"))).toBe(true);
    expect(readSnapshot(dir2)?.styles?.entries[0]?.css.color).toBe("rgb(0, 0, 0)");
  });

  it("lists every snapshot under the root, newest-agnostic", () => {
    writeSnapshot(root, snap());
    writeSnapshot(root, snap({ meta: { v: SNAPSHOT_VERSION, id: "contact", name: "Contact", url: "https://example.com/contact" } }));
    expect(
      readSnapshots(root)
        .map((s) => s.meta.id)
        .sort(),
    ).toEqual(["accueil", "contact"]);
  });

  it("returns null for a directory that is not a snapshot, rather than throwing", () => {
    mkdirSync(join(root, "nope"), { recursive: true });
    expect(readSnapshot(join(root, "nope"))).toBeNull();
  });

  it("skips an unreadable snapshot instead of failing the whole listing", () => {
    writeSnapshot(root, snap());
    const broken = join(root, PAGES_DIR, "broken");
    mkdirSync(broken, { recursive: true });
    writeFileSync(join(broken, "meta.json"), "{ not json");
    expect(readSnapshots(root).map((s) => s.meta.id)).toEqual(["accueil"]);
  });
});

describe("dom.html is an ordinary auditable capture", () => {
  it("carries a page-tagged provenance comment the capture parser understands", () => {
    const dir = writeSnapshot(root, snap());
    const html = readFileSync(join(dir, "dom.html"), "utf8");
    const prov = parseCaptureProvenance(html);
    expect(prov?.page).toBe("accueil");
    expect(prov?.url).toBe("https://example.com/");
  });

  it("keeps the serialized document a FULL document, so page-scoped rules run on it", () => {
    const dir = writeSnapshot(root, snap());
    const html = readFileSync(join(dir, "dom.html"), "utf8");
    expect(html).toMatch(/<html[\s>]/);
    expect(html.indexOf("<!-- ultra11y:capture")).toBeLessThan(html.indexOf("<html"));
  });

  it("records the source files that rendered the page, for per-page attribution", () => {
    const dir = writeSnapshot(root, snap({ meta: { v: SNAPSHOT_VERSION, id: "a", name: "A", url: "https://x/a", sources: ["app/a/page.tsx"] } }));
    expect(readSnapshot(dir)?.meta.sources).toEqual(["app/a/page.tsx"]);
  });
});

describe("a snapshot audits as a page (the whole point)", () => {
  it("fires page-scoped rules a component capture can never reach, and stamps the page on each finding", () => {
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: "accueil", name: "Accueil", url: "https://example.com/", sources: ["app/page.tsx"] },
      dom: "<!doctype html><html><head></head><body><img src=a.png></body></html>",
    });
    const r = runAudit({ inputs: [join(root, PAGES_DIR)] });
    const ids = r.findings.map((f) => f.ruleId);
    // 3.1.1 (RGAA 8.3) and 2.4.2 (RGAA 8.5/8.6) are only decidable on a FULL document.
    expect(ids).toContain("html-lang-missing");
    expect(ids).toContain("title-missing-empty");
    expect(ids).toContain("img-alt-missing");
    for (const f of r.findings) {
      expect(f.page).toBe("accueil");
      expect(f.origin?.sourceFile).toBe("app/page.tsx");
    }
  });

  it("leaves a component capture a fragment — page rules must NOT fire on it", () => {
    const dir = join(root, ".ultra11y/captures");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "Button__x.html"), '<!-- ultra11y:capture v="1" source="src/Button.tsx" component="Button" -->\n<button></button>\n');
    const r = runAudit({ inputs: [dir] });
    const ids = r.findings.map((f) => f.ruleId);
    expect(ids).not.toContain("html-lang-missing");
    expect(ids).not.toContain("title-missing-empty");
    for (const f of r.findings) expect(f.page).toBeUndefined();
  });

  it("stamps the page even when the producer wrote no provenance comment — the path IS provenance", () => {
    // The on-disk layout is a published contract, so a third-party producer may write meta.json
    // plus a raw dom.html. Before the path fallback its findings were ALL unattributed, and the
    // page earned `C` by silence: a sheet at 100% over an audit full of findings.
    const dir = join(root, PAGES_DIR, "contact");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "meta.json"), JSON.stringify({ v: 1, id: "contact", name: "Contact", url: "https://example.com/contact" }));
    writeFileSync(join(dir, "dom.html"), "<!doctype html><html><head></head><body><img src=a.png></body></html>\n");
    const r = runAudit({ inputs: [join(root, PAGES_DIR)] });
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) expect(f.page).toBe("contact");
    // Synthesized identity carries no source component, so nothing pretends to know one.
    for (const f of r.findings) expect(f.origin?.sourceFile).toBeUndefined();
  });

  it("keeps attributing under --jsx, which the CLI applies to snapshots the user never named", () => {
    // `audit "src/**/*.tsx" --jsx` auto-appends .ultra11y/pages. Forcing the JSX parser on a real
    // HTML document dropped its capture provenance entirely — the reported 700-finding audit.
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: "accueil", name: "Accueil", url: "https://example.com/", sources: ["app/page.tsx"] },
      dom: "<!doctype html><html><head></head><body><img src=a.png></body></html>",
    });
    const r = runAudit({ inputs: [join(root, PAGES_DIR)], forceJsx: true });
    expect(r.findings.map((f) => f.ruleId)).toContain("img-alt-missing");
    for (const f of r.findings) {
      expect(f.page).toBe("accueil");
      // The snapshot is parsed as the HTML it is, so its source attribution survives too.
      expect(f.origin?.sourceFile).toBe("app/page.tsx");
      // ...and it is rendered ground truth, never a lossy-JSX guess.
      expect(f.preliminary).toBeUndefined();
    }
  });

  it("keeps --jsx honoured for the inputs the user actually named", () => {
    // The flag exists to force JSX regardless of extension. Narrowing it must not reach past the
    // artefacts the CLI ingested on the user's behalf — a .html the user PASSED still gets JSX.
    //
    // A full HTML document is not valid JSX (the doctype alone kills the Babel parse), so forcing
    // the parser drops to the lossy regex fallback and flags every finding `preliminary`. That is
    // the observable difference, and it is precisely the damage the narrowing prevents on the
    // snapshots the CLI appends by itself.
    const f = join(root, "Widget.html");
    writeFileSync(f, "<!doctype html><html lang=fr><head><title>t</title></head><body><img src=a.png></body></html>\n");
    const forced = runAudit({ inputs: [f], forceJsx: true });
    expect(forced.findings.map((x) => x.ruleId)).toContain("img-alt-missing");
    expect(forced.findings.every((x) => x.preliminary)).toBe(true);

    const plain = runAudit({ inputs: [f] });
    expect(plain.findings.map((x) => x.ruleId)).toContain("img-alt-missing");
    expect(plain.findings.some((x) => x.preliminary)).toBe(false);
  });
});

describe("meta validation (untrusted input from a producer)", () => {
  const ok = { v: 1, id: "accueil", name: "Accueil", url: "https://x/" };

  it("accepts a well-formed meta", () => {
    expect(validateSnapshotMeta(ok).ok).toBe(true);
  });

  it("rejects a missing or non-string id / name / url", () => {
    for (const bad of [
      { ...ok, id: "" },
      { ...ok, name: 42 },
      { ...ok, url: undefined },
    ]) {
      expect(validateSnapshotMeta(bad).ok).toBe(false);
    }
  });

  it("rejects an id that would escape the pages directory", () => {
    expect(validateSnapshotMeta({ ...ok, id: "../../etc" }).ok).toBe(false);
    expect(validateSnapshotMeta({ ...ok, id: "a/b" }).ok).toBe(false);
  });

  it("rejects a future snapshot version rather than misreading it", () => {
    expect(validateSnapshotMeta({ ...ok, v: SNAPSHOT_VERSION + 1 }).ok).toBe(false);
  });

  it("names the offending field so a producer can fix it", () => {
    expect(validateSnapshotMeta({ ...ok, url: "" }).issues[0]?.path).toBe("meta.url");
  });
});

describe("style/box alignment guard", () => {
  const dom = "<!doctype html><html><head></head><body><p>x</p></body></html>";

  const digest = (entries: StyleEntry[]): StyleDigest => ({ v: 1, entries });

  it("aligns entries with the parsed document by ordinal index", () => {
    const aligned = alignedStyles(
      dom,
      digest([
        { i: 0, tag: "html", css: {} },
        { i: 3, tag: "p", css: { color: "red" } },
      ]),
    );
    expect(aligned).not.toBeNull();
    expect(aligned?.get(3)?.css.color).toBe("red");
  });

  it("refuses the whole digest when a tag does not match the parsed document", () => {
    expect(
      alignedStyles(
        dom,
        digest([
          { i: 0, tag: "html", css: {} },
          { i: 3, tag: "div", css: { color: "red" } },
        ]),
      ),
    ).toBeNull();
  });

  it("refuses an index beyond the document rather than mis-attributing", () => {
    expect(alignedStyles(dom, digest([{ i: 99, tag: "p", css: {} }]))).toBeNull();
  });
});

describe("browser collector", () => {
  it("is syntactically valid browser code (compiled, never called here)", () => {
    expect(() => new Function(`return ${COLLECT_SNAPSHOT}`)).not.toThrow();
  });

  it("walks elements in document order so the ordinal index is the join key", () => {
    expect(COLLECT_SNAPSHOT).toContain("querySelectorAll");
    expect(COLLECT_SNAPSHOT).toContain("documentElement");
  });
});

describe("snapshotPageId", () => {
  it("recovers the id from the path the engine itself wrote", () => {
    expect(snapshotPageId(`${PAGES_DIR}/accueil/dom.html`)).toBe("accueil");
  });

  it("recovers it from a relative, an absolute and a nested root alike", () => {
    expect(snapshotPageId(`./${PAGES_DIR}/contact/dom.html`)).toBe("contact");
    expect(snapshotPageId(`/Users/me/app/${PAGES_DIR}/contact/dom.html`)).toBe("contact");
    expect(snapshotPageId(`packages/web/${PAGES_DIR}/contact/dom.html`)).toBe("contact");
  });

  it("recovers it from Windows separators — a snapshot audited on Windows is still a page", () => {
    expect(snapshotPageId(".ultra11y\\pages\\parcours-etape-2\\dom.html")).toBe("parcours-etape-2");
  });

  it("takes the LAST marker, so a path that repeats it still resolves to the real page", () => {
    expect(snapshotPageId(`${PAGES_DIR}/fixtures/${PAGES_DIR}/accueil/dom.html`)).toBe("accueil");
  });

  it("returns undefined for a sibling that is not the serialized DOM", () => {
    expect(snapshotPageId(`${PAGES_DIR}/accueil/meta.json`)).toBeUndefined();
    expect(snapshotPageId(`${PAGES_DIR}/accueil/styles.json`)).toBeUndefined();
  });

  it("returns undefined for an ordinary capture or source file", () => {
    expect(snapshotPageId(".ultra11y/captures/Button.html")).toBeUndefined();
    expect(snapshotPageId("src/app/page.tsx")).toBeUndefined();
    expect(snapshotPageId("dom.html")).toBeUndefined();
    expect(snapshotPageId(undefined)).toBeUndefined();
  });

  it("refuses a directory name that could not be a page id, rather than inventing one", () => {
    // The same ID_RE validateSnapshotMeta holds a producer to: an id becomes a directory name,
    // and a name nobody could legally have written must never become a page attribution.
    expect(snapshotPageId(`${PAGES_DIR}/../dom.html`)).toBeUndefined();
    expect(snapshotPageId(`${PAGES_DIR}/-leading-dash/dom.html`)).toBeUndefined();
    expect(snapshotPageId(`${PAGES_DIR}/a b/dom.html`)).toBeUndefined();
  });

  it("agrees with isSnapshotDom on what a snapshot DOM is", () => {
    const yes = `${PAGES_DIR}/accueil/dom.html`;
    expect(isSnapshotDom(yes)).toBe(true);
    expect(snapshotPageId(yes)).toBeDefined();
    const no = ".ultra11y/captures/Button.html";
    expect(isSnapshotDom(no)).toBe(false);
    expect(snapshotPageId(no)).toBeUndefined();
  });

  it("round-trips every id writeSnapshot accepts", () => {
    for (const id of ["accueil", "contact", "parcours-conformite-etape-2", "a1"]) {
      const dir = writeSnapshot(root, { meta: { v: 1, id, name: id, url: `https://x.test/${id}` }, dom: "<html></html>" });
      expect(snapshotPageId(join(dir, "dom.html"))).toBe(id);
    }
  });
});
