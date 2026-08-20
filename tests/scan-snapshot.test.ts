import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNNER, writeRunnerSnapshot, mergeSnapshotAudit, type RunnerOutput } from "../src/scan.js";
import { PAGES_DIR, readSnapshot, COLLECT_SNAPSHOT } from "../src/snapshot.js";
import { pageScopesFrom, derivePages } from "../src/pages.js";
import { runAudit } from "../src/audit.js";
import type { AuditResult } from "../src/types.js";
import { INAPPLICABLE_STATUS } from "../src/types.js";

// `scan` drives a browser over each page but used to keep only the findings. A page with no
// snapshot is `basis: "attributed"` (src/pages.ts honesty rule 2), so its criteria can never
// leave "to assess" — a sitemap-driven audit produced an empty per-page grid. These tests pin
// the collection, the persistence and the fold that closes that hole, WITHOUT a browser: the
// runner output is recorded data, exactly like tests/scan.test.ts does for axe.

const collected = {
  dom: '<html lang="fr"><head><title>Accueil</title></head><body><main><h1>Bonjour</h1></main></body></html>',
  styles: { v: 1, entries: [], truncated: false },
  boxes: { v: 1, entries: [], truncated: false },
  css: { v: 1, rules: [], unreadable: 0, truncated: false },
  title: "Accueil",
  url: "https://exemple.fr/",
  viewport: { width: 1280, height: 900 },
};

const out = (over: Partial<RunnerOutput> = {}): RunnerOutput =>
  ({
    url: "https://exemple.fr/",
    violations: [],
    reflow: { horizontalScroll: false },
    snapshot: collected,
    ...over,
  }) as RunnerOutput;

const tmp = (): string => mkdtempSync(join(tmpdir(), "ultra11y-scan-snap-"));

describe("writeRunnerSnapshot", () => {
  it("persists the collected page under .ultra11y/pages/<id>/ and returns the id", () => {
    const root = tmp();
    const id = writeRunnerSnapshot(root, out(), "https://exemple.fr/");
    expect(id).toBe("accueil");
    const snap = readSnapshot(join(root, PAGES_DIR, "accueil"));
    expect(snap?.meta.url).toBe("https://exemple.fr/");
    expect(snap?.meta.runner).toBe("scan");
    expect(snap?.meta.name).toBe("Accueil"); // document.title, not the slug
    expect(snap?.dom).toContain("<h1>Bonjour</h1>");
    expect(snap?.styles).toBeDefined();
    expect(snap?.css).toBeDefined();
  });

  it("derives the page id from the URL path", () => {
    const root = tmp();
    const id = writeRunnerSnapshot(root, out({ url: "https://exemple.fr/nous-contacter" }), "https://exemple.fr/nous-contacter");
    expect(id).toBe("nous-contacter");
  });

  it("names a local HTML target after its FILE, never after the absolute path", () => {
    const root = tmp();
    const abs = "/Users/someone/very/deep/project/site/contact.html";
    const id = writeRunnerSnapshot(root, out({ url: `file://${abs}`, snapshot: collected }), abs);
    // Slugifying the URL path would name the directory after whoever's machine ran the scan.
    expect(id).toBe("contact");
    // …and the recorded url is the HOST path a reader can open, not the file:// form.
    expect(readSnapshot(join(root, PAGES_DIR, "contact"))?.meta.url).toBe(abs);
  });

  it("lets a sample page's declared identity win over anything derived from the URL", () => {
    const root = tmp();
    const id = writeRunnerSnapshot(root, out(), "https://exemple.fr/", {
      id: "page-accueil",
      name: "Page d'accueil",
      url: "https://exemple.fr/",
      auth: true,
      notes: "Se connecter d'abord",
    });
    expect(id).toBe("page-accueil");
    const snap = readSnapshot(join(root, PAGES_DIR, "page-accueil"));
    expect(snap?.meta.name).toBe("Page d'accueil");
    expect(snap?.meta.auth).toBe(true);
    expect(snap?.meta.notes).toBe("Se connecter d'abord");
  });

  it("writes the screenshot when the runner captured one", () => {
    const root = tmp();
    // a 1x1 PNG
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    writeRunnerSnapshot(root, out({ snapshot: { ...collected, screenshot: png } }), "https://exemple.fr/");
    expect(existsSync(join(root, PAGES_DIR, "accueil", "screen.png"))).toBe(true);
    expect(readSnapshot(join(root, PAGES_DIR, "accueil"))?.screenshot).toBe("screen.png");
  });

  it("writes nothing when the runner collected no page — a failed collection costs the snapshot, never the findings", () => {
    const root = tmp();
    expect(writeRunnerSnapshot(root, out({ snapshot: undefined }), "https://exemple.fr/")).toBeUndefined();
    expect(existsSync(join(root, PAGES_DIR))).toBe(false);
  });

  it("refuses a page id that would traverse out of the pages directory", () => {
    const root = tmp();
    const id = writeRunnerSnapshot(root, out(), "https://exemple.fr/", {
      id: "../../etc",
      name: "evil",
      url: "https://exemple.fr/",
    });
    expect(id).toBeUndefined();
    expect(existsSync(join(root, PAGES_DIR))).toBe(false);
  });
});

describe("a scanned page becomes a real per-page verdict", () => {
  it('earns basis "snapshot" and conforming criteria, which an attributed page never can', () => {
    const root = tmp();
    writeRunnerSnapshot(root, out(), "https://exemple.fr/");
    const scope = pageScopesFrom([readSnapshot(join(root, PAGES_DIR, "accueil"))!]);
    expect(scope[0]!.basis).toBe("snapshot");

    const audit = runAudit({ inputs: [join(root, PAGES_DIR, "accueil", "dom.html")] });
    const pages = derivePages(audit, scope);
    // 3.1.1 (Language of Page) is a STATIC criterion: the document declares lang="fr", so the
    // page is conforming on it. Without a snapshot this cell could only ever be "?".
    expect(pages[0]!.criteria.find((c) => c.id === "3.1.1")?.status).toBe("C");
    expect(pages[0]!.criteria.find((c) => c.id === "2.4.2")?.status).toBe("C"); // Page Titled
  });
});

describe("mergeSnapshotAudit", () => {
  const base = (): AuditResult => runAudit({ inputs: ["-"], stdin: "<div><img src=x></div>" });

  const snapAuditOf = (dom: string): AuditResult => {
    const root = tmp();
    const dir = join(root, PAGES_DIR, "accueil");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "dom.html"), `<!-- ultra11y:capture v="1" page="accueil" url="https://exemple.fr/" -->\n${dom}\n`);
    return runAudit({ inputs: [join(dir, "dom.html")] });
  };

  it("makes a criterion NC on a non-advisory finding raised on the snapshot", () => {
    const merged = mergeSnapshotAudit(base(), snapAuditOf('<html lang="fr"><head><title>x</title></head><body><img src="a.png"></body></html>'));
    expect(merged.criteria.find((c) => c.id === "1.1.1")?.status).toBe("NC");
    expect(merged.findings.some((f) => f.ruleId === "img-alt-missing" && f.page === "accueil")).toBe(true);
  });

  it("upgrades NA to C when the snapshot puts the criterion in scope and it passes", () => {
    const b = base();
    // A fragment has no <html>, so Page Titled / Language of Page are NA in the base audit.
    expect(b.criteria.find((c) => c.id === "3.1.1")?.status).toBe(INAPPLICABLE_STATUS);
    const merged = mergeSnapshotAudit(b, snapAuditOf('<html lang="fr"><head><title>Accueil</title></head><body><main>x</main></body></html>'));
    const sc = merged.criteria.find((c) => c.id === "3.1.1");
    expect(sc?.status).toBe("C");
    expect(sc?.justification).toBeUndefined(); // the "no relevant element" reason no longer holds
  });

  // THE MIRROR OF THE TEST ABOVE, and the case it was missing. When the snapshot ALSO closes
  // the criterion for want of a subject — no <video> in the source, none on the rendered page
  // either — both halves read `C` and only the FLAG tells them apart. Testing the status
  // instead stripped `inapplicable` and the justification from every such criterion.
  //
  // Two consequences, both silent. The `C` became the bare uncited conformity this engine
  // refuses everywhere else. And `pageStatus` reads that flag to hold "a conformity reached
  // for want of a subject holds on every page": without it those criteria fell through to the
  // rule that only `static` criteria earn a verdict by silence, and came back « to assess »
  // on EVERY page. Measured on a two-page RGAA crawl, the run reported a complete 106/106 grid
  // while each page carried 10 criteria that could never be adjudicated, there being nothing
  // there to adjudicate.
  it("keeps a conformity reached FOR WANT OF A SUBJECT when the snapshot has no subject either", () => {
    const b = base();
    const before = b.criteria.find((c) => c.id === "1.2.1")!;
    expect(before.status, "the source has no time-based media").toBe(INAPPLICABLE_STATUS);
    expect(before.inapplicable).toBe(true);
    expect(before.justification, "the claim must arrive citable").toBeTruthy();

    // A full document, and still not a single <video>/<audio> anywhere.
    const merged = mergeSnapshotAudit(b, snapAuditOf('<html lang="fr"><head><title>Accueil</title></head><body><main><h1>x</h1></main></body></html>'));
    const after = merged.criteria.find((c) => c.id === "1.2.1")!;
    expect(after.status).toBe(INAPPLICABLE_STATUS);
    expect(after.inapplicable, "the snapshot measured nothing — it just had no subject either").toBe(true);
    expect(after.justification).toBe(before.justification);
  });

  // …and the flag surviving is what the page projection needs: without it, a criterion nobody
  // could ever rule on sits « to assess » on every page of the deliverable.
  it("so the criterion still holds on the page, instead of asking for a verdict nobody can give", () => {
    const root = tmp();
    writeRunnerSnapshot(root, out(), "https://exemple.fr/");
    const dir = join(root, PAGES_DIR, "accueil");
    const merged = mergeSnapshotAudit(base(), runAudit({ inputs: [join(dir, "dom.html")] }));
    merged.scope.pages = pageScopesFrom([readSnapshot(dir)!]);
    merged.scope.pagesAudited = ["accueil"];
    const [page] = derivePages(merged, merged.scope.pages);
    expect(page!.basis, "the page must be snapshot-based for this to mean anything").toBe("snapshot");
    expect(page!.criteria.find((c) => c.id === "1.2.1")?.status).toBe(INAPPLICABLE_STATUS);
  });

  it("never lets the snapshot REMOVE applicability — a C in the base survives a snapshot that is NA", () => {
    const b = base();
    const c311 = b.criteria.find((x) => x.id === "3.1.1")!;
    c311.status = "C";
    const merged = mergeSnapshotAudit(b, snapAuditOf("<div>fragment</div>"));
    expect(merged.criteria.find((x) => x.id === "3.1.1")?.status).toBe("C");
  });

  it("drops the residual risk of a criterion the snapshot decided, and recomputes the rate", () => {
    const b = base();
    const merged = mergeSnapshotAudit(b, snapAuditOf('<html lang="fr"><head><title>x</title></head><body><img src="a.png"></body></html>'));
    expect(merged.residualRisks.some((r) => r.criteriaId === "1.1.1")).toBe(false);
    const decided = merged.criteria.filter((c) => c.status === "C" || c.status === "NC");
    const conform = decided.filter((c) => c.status === "C").length;
    expect(merged.conformancePct).toBe(Math.round((conform / decided.length) * 100));
    const g1 = merged.guidelines.find((g) => g.key === "1.1");
    expect(g1?.nc).toBe(1);
  });

  it("leaves the base untouched (pure fold)", () => {
    const b = base();
    const before = JSON.stringify(b);
    mergeSnapshotAudit(b, snapAuditOf('<html lang="fr"><head><title>x</title></head><body><img src="a.png"></body></html>'));
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe("the Docker runner collects the page too", () => {
  it("embeds the engine's own collector rather than a copy of it", () => {
    expect(RUNNER).toContain(JSON.stringify(COLLECT_SNAPSHOT).slice(1, 120));
  });
  it("collects BEFORE axe injects its source and before the 320px resize", () => {
    const collectAt = RUNNER.indexOf("page.evaluate(COLLECT)");
    const axeAt = RUNNER.indexOf("addScriptTag");
    const resizeAt = RUNNER.indexOf("setViewportSize");
    expect(collectAt).toBeGreaterThan(-1);
    expect(collectAt).toBeLessThan(axeAt);
    expect(collectAt).toBeLessThan(resizeAt);
  });
  it("honours ULTRA11Y_SNAPSHOT=0 and emits the snapshot on stdout", () => {
    expect(RUNNER).toContain('process.env.ULTRA11Y_SNAPSHOT !== "0"');
    expect(RUNNER).toContain("reflow, snapshot }");
  });
});

describe("docker/runner.mjs stays a real module", () => {
  it("parses as ESM", () => {
    const file = new URL("../docker/runner.mjs", import.meta.url).pathname;
    expect(existsSync(file)).toBe(true);
    // A syntax error here would only surface inside a container, swallowed by `docker run`.
    expect(() => new Function(`return async () => { ${readFileSync(file, "utf8").replace(/^import .*/gm, "")} }`)).not.toThrow();
  });
});
