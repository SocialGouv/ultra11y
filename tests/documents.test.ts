// `scan` DOWNLOADS THE DOCUMENTS ITS PAGES LINK TO (issue #90) — the offline half, with a real
// HTTP server and no browser: which links count, what is refused and why, the sidecar that
// attributes each document's findings to the pages linking it, and the caps. The browser half
// (a real scan writing the snapshots this reads) is in tests/browser-tier.e2e.test.ts.
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DOCUMENTS_DIR, downloadLinkedDocuments, downloadSnapshotDocuments, pdfLinksIn, readDocumentOrigin } from "../src/documents.js";
import { runAudit } from "../src/audit.js";
import { mergeSnapshotAudit } from "../src/scan.js";
import { pageView } from "../src/pages.js";
import { derivePackResults } from "../src/standards/index.js";
import { PAGES_DIR } from "../src/snapshot.js";
import { expandInputs } from "../src/glob.js";

const FIX = join(import.meta.dirname, "fixtures", "pdf");
const UNTAGGED = readFileSync(join(FIX, "untagged.pdf"));
const TAGGED = readFileSync(join(FIX, "tagged-ua1.pdf"));

let server: Server;
let origin = "";
const hits: string[] = [];
const root = mkdtempSync(join(tmpdir(), "u11y-docs-"));

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/docs/recu.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(UNTAGGED);
    } else if (req.url === "/docs/ok.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(TAGGED);
    } else if (req.url === "/docs/login.pdf") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>Connexion requise</body></html>");
    } else if (req.url === "/docs/huge.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(4096, 0x20)]));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
afterAll(() => {
  server?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("which links are a document to download", () => {
  it("same-origin links whose path ends in .pdf, or that declare type=application/pdf — resolved against <base>", () => {
    const html = `<html><head><base href="/sub/"></head><body>
      <a href="a.pdf">relative to base</a>
      <a href="/b.PDF#page=2">upper case, fragment</a>
      <a href="/telecharger?id=3" type="application/pdf">declared</a>
      <a href="https://elsewhere.example/c.pdf">third party</a>
      <a href="/page.html">not a document</a>
      <a href="mailto:x@y.z">mail</a>
      <a href="#top">anchor</a></body></html>`;
    expect(pdfLinksIn(html, "https://site.example/start")).toEqual([
      "https://site.example/b.PDF",
      "https://site.example/sub/a.pdf",
      "https://site.example/telecharger?id=3",
    ]);
  });

  it("a local page's links resolve to local files, never to the web", () => {
    expect(pdfLinksIn(`<a href="doc.pdf">x</a><a href="https://site.example/x.pdf">y</a>`, "file:///srv/site/index.html")).toEqual([
      "file:///srv/site/doc.pdf",
    ]);
  });
});

describe("downloading them", () => {
  it("keeps the PDFs, refuses what is not one, and says why for every link it did not keep", async () => {
    const dir = join(root, "a");
    const html = `<a href="/docs/recu.pdf">Récépissé</a><a href="/docs/login.pdf">Protégé</a><a href="/docs/missing.pdf">Absent</a><a href="/docs/huge.pdf">Gros</a>`;
    const r = await downloadLinkedDocuments(dir, [{ id: "declaration", url: `${origin}/declaration`, html }], { maxBytes: 2048 });
    expect(r.files).toHaveLength(1);
    expect(readFileSync(r.files[0]!)).toEqual(UNTAGGED);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.url.replace(origin, ""), s.reason]));
    expect(reasons["/docs/login.pdf"]).toMatch(/not a PDF/);
    expect(reasons["/docs/missing.pdf"]).toBe("HTTP 404");
    expect(reasons["/docs/huge.pdf"]).toMatch(/larger than 2048 bytes/);
  });

  it("stores one file per document, named by its hash, with a sidecar naming the URL and EVERY page linking it", async () => {
    const dir = join(root, "b");
    const link = `<a href="/docs/recu.pdf">Récépissé</a>`;
    const r = await downloadLinkedDocuments(dir, [
      { id: "page-a", url: `${origin}/a`, html: link },
      { id: "page-b", url: `${origin}/b`, html: link },
    ]);
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatch(new RegExp(`${DOCUMENTS_DIR.replace(".", "\\.")}/[0-9a-f]{64}\\.pdf$`));
    expect(readDocumentOrigin(r.files[0]!)).toEqual({ url: `${origin}/docs/recu.pdf`, pages: ["page-a", "page-b"] });
    // A later run linking it from a third page adds the page; the sidecar never loses one.
    await downloadLinkedDocuments(dir, [{ id: "page-c", url: `${origin}/c`, html: link }]);
    expect(readDocumentOrigin(r.files[0]!)?.pages).toEqual(["page-a", "page-b", "page-c"]);
  });

  it("stops at the document cap and reports the rest", async () => {
    const dir = join(root, "c");
    const html = `<a href="/docs/recu.pdf">1</a><a href="/docs/ok.pdf">2</a>`;
    const r = await downloadLinkedDocuments(dir, [{ id: "p", url: `${origin}/p`, html }], { maxCount: 1 });
    expect(r.files).toHaveLength(1);
    expect(r.skipped).toEqual([{ url: expect.stringContaining(".pdf"), reason: "document cap reached (1)" }]);
  });

  it("never requests a third-party document", async () => {
    hits.length = 0;
    const r = await downloadLinkedDocuments(join(root, "d"), [{ id: "p", url: `${origin}/p`, html: `<a href="http://localhost:1/x.pdf">x</a>` }]);
    expect(r.files).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(hits).toEqual([]);
  });
});

describe("from snapshot to audit: a document's findings land on the pages that link it", () => {
  const dir = join(root, "site");
  const page = (id: string, links: string): void => {
    const d = join(dir, PAGES_DIR, id);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "meta.json"), JSON.stringify({ v: 1, id, name: id, url: `${origin}/${id}` }));
    writeFileSync(
      join(d, "dom.html"),
      `<!-- ultra11y:capture {"v":1,"page":"${id}"} -->\n<html lang="fr"><head><title>${id}</title></head><body><main><h1>${id}</h1>${links}</main></body></html>\n`,
    );
  };

  it("downloads from the snapshots, audits, attributes, and the RGAA grid of each page sees it", async () => {
    page("declaration", `<a href="/docs/recu.pdf">Télécharger le récépissé (PDF)</a>`);
    page("accueil", `<p>Bienvenue</p>`);
    const docs = await downloadSnapshotDocuments(dir, ["declaration", "accueil"]);
    expect(docs.files).toHaveLength(1);

    const doms = ["declaration", "accueil"].map((id) => join(dir, PAGES_DIR, id, "dom.html"));
    const audit = runAudit({ inputs: [...doms, ...docs.files] });
    expect(audit.documents).toHaveLength(1);
    expect(audit.documents![0]).toMatchObject({ url: `${origin}/docs/recu.pdf`, pages: ["declaration"], tagged: false });
    expect(new Set(audit.documentFindings!.map((f) => f.page))).toEqual(new Set(["declaration"]));
    expect(audit.scope.pageSubjects?.declaration).toContain("downloadDocs");

    // Re-read offline: `audit` ingests `.ultra11y/documents/*.pdf` through the same glob.
    expect(expandInputs([join(dir, DOCUMENTS_DIR, "*.pdf")])).toEqual(docs.files);

    // The per-page view hands the page's own document findings to the projection.
    const view = (id: string) => pageView(audit, { id, name: id, url: "", criteria: audit.criteria, findings: [] } as never);
    const on = (id: string) => derivePackResults(view(id), "rgaa").find((r) => r.id === "13.3")!;
    expect((on("declaration").candidateFindings ?? []).map((f) => f.ruleId)).toContain("pdf-untagged");
    expect(on("accueil").candidateFindings ?? []).toEqual([]);
  });

  it("the snapshot merge carries the documents and their findings into the base audit", () => {
    const base = runAudit({ inputs: [join(dir, PAGES_DIR, "accueil", "dom.html")] });
    const files = readdirSync(join(dir, DOCUMENTS_DIR))
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => join(dir, DOCUMENTS_DIR, f));
    const snap = runAudit({ inputs: [join(dir, PAGES_DIR, "declaration", "dom.html"), ...files] });
    const merged = mergeSnapshotAudit(base, snap);
    expect(merged.documents).toHaveLength(1);
    expect(merged.documentFindings?.length).toBe(snap.documentFindings?.length);
    // …idempotently.
    expect(mergeSnapshotAudit(merged, snap).documentFindings?.length).toBe(snap.documentFindings?.length);
  });
});
