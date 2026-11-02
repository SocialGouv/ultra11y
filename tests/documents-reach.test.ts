// THE DOCUMENTS A REAL SITE SERVES (issue #111). The first cut (#90) only reached a link whose
// path ended in `.pdf`, with no credential, from `scan` alone, and rendered them in the Markdown
// report only. egapro serves every document from a route behind a login —
// `<a download href="/api/declaration-pdf?year=2026" aria-label="Télécharger la déclaration (PDF)">`
// — so none of it was reached. This covers the offline half: which links are CANDIDATES, how the
// response proves one is a PDF, the storage-state cookies that open an authenticated one, and the
// HTML report's documents section. The browser half (the Playwright fixture downloading through
// its own session) is in tests/browser-tier.e2e.test.ts.
import { createServer, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cookieHeaderFor, downloadLinkedDocuments, pdfLinksIn, readDocumentOrigin, readStorageCookies } from "../src/documents.js";
import { documentCandidate, looksLikePdf } from "../src/document-store.js";
import { runAudit } from "../src/audit.js";
import { compositeDoc, indexDoc } from "../src/html-report.js";
import { documentsModel, renderReport } from "../src/report.js";
import type { Block } from "../src/html.js";

const FIX = join(import.meta.dirname, "fixtures", "pdf");
const UNTAGGED = readFileSync(join(FIX, "untagged.pdf"));

let server: Server;
let origin = "";
const hits: { url: string; cookie?: string }[] = [];
const root = mkdtempSync(join(tmpdir(), "u11y-docs-reach-"));

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push({ url: req.url ?? "", ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}) });
    const url = req.url ?? "";
    if (url.startsWith("/api/declaration-pdf")) {
      // A generated document behind a login: the session cookie, or a redirect to the login page.
      if (!/(?:^|; )session=ok(?:;|$)/.test(req.headers.cookie ?? "")) {
        res.writeHead(302, { location: "/login" });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": 'attachment; filename="declaration.pdf"' });
      res.end(UNTAGGED);
    } else if (url === "/login") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><form>Connexion</form></body></html>");
    } else if (url === "/telecharger/42") {
      // No extension, no declared type: only the bytes say it is a PDF.
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(UNTAGGED);
    } else if (url === "/guide-pdf") {
      // Named like a document, answers a page.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><h1>Guide</h1></body></html>");
    } else if (url === "/leave") {
      res.writeHead(302, { location: "http://localhost:1/elsewhere.pdf" });
      res.end();
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

describe("a link is a document CANDIDATE beyond the .pdf extension", () => {
  it("keeps <a download>, a link whose text / aria-label / title names PDF as a word, and a path or query naming pdf as a token", () => {
    const html = `<html><body>
      <a download href="/api/declaration-pdf?year=2026" aria-label="Télécharger la déclaration 2026 (PDF)">Télécharger</a>
      <a href="/telecharger/42">Télécharger le récépissé (PDF, 120 Ko)</a>
      <a href="/fiche/7" title="Version PDF de la fiche">Fiche</a>
      <a href="/export?format=pdf">Exporter</a>
      <a href="/api/transmitted-pdf">Accusé</a>
      <a download href="/export.csv">CSV</a>
      <a href="/pdfs/catalogue">Catalogue (a path token that only contains the letters)</a>
      <a href="/aide">Aide sur les PDFium et autres</a>
      <a href="https://ailleurs.example/doc" download>a third party, even with download</a>
      <a href="/plain">Accueil</a></body></html>`;
    expect(pdfLinksIn(html, "https://site.example/start")).toEqual([
      "https://site.example/api/declaration-pdf?year=2026",
      "https://site.example/api/transmitted-pdf",
      "https://site.example/export.csv",
      "https://site.example/export?format=pdf",
      "https://site.example/fiche/7",
      "https://site.example/telecharger/42",
    ]);
  });

  it("is one decision, shared by the HTML parser and the browser (absolute hrefs, no base)", () => {
    const page = new URL("https://site.example/a/b");
    expect(documentCandidate({ href: "https://site.example/api/declaration-pdf?year=2026" }, page)).toBe("https://site.example/api/declaration-pdf?year=2026");
    expect(documentCandidate({ href: "/x#frag", download: true }, page)).toBe("https://site.example/x");
    expect(documentCandidate({ href: "/x", ariaLabel: "Rapport (pdf)" }, page)).toBe("https://site.example/x");
    expect(documentCandidate({ href: "/x", text: "Rapport" }, page)).toBeUndefined();
    expect(documentCandidate({ href: "javascript:void(0)", download: true }, page)).toBeUndefined();
    expect(documentCandidate({ href: "https://other.example/x.pdf" }, page)).toBeUndefined();
  });

  it("counts a response as a PDF only on its Content-Type or its %PDF- header", () => {
    expect(looksLikePdf("application/pdf; charset=binary", Buffer.from("garbage"))).toBe(true);
    expect(looksLikePdf("application/octet-stream", UNTAGGED)).toBe(true);
    expect(looksLikePdf(undefined, UNTAGGED)).toBe(true);
    expect(looksLikePdf("text/html", Buffer.from("<html>PDF</html>"))).toBe(false);
  });
});

describe("downloading the candidates", () => {
  it("keeps a route that answers a PDF, refuses one that answers HTML as « not a PDF », and never follows a redirect off the origin", async () => {
    hits.length = 0;
    const html = `<a href="/telecharger/42">Récépissé (PDF)</a><a href="/guide-pdf">Guide</a><a href="/leave" download>Ailleurs</a>`;
    const r = await downloadLinkedDocuments(join(root, "routes"), [{ id: "p", url: `${origin}/p`, html }]);
    expect(r.files).toHaveLength(1);
    expect(readFileSync(r.files[0]!)).toEqual(UNTAGGED);
    expect(readDocumentOrigin(r.files[0]!)).toEqual({ url: `${origin}/telecharger/42`, pages: ["p"] });
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.url.replace(origin, ""), s.reason]));
    expect(reasons["/guide-pdf"]).toMatch(/^not a PDF/);
    expect(reasons["/leave"]).toMatch(/redirected off-origin to http:\/\/localhost:1\/elsewhere\.pdf/);
    expect(hits.map((h) => h.url).sort()).toEqual(["/guide-pdf", "/leave", "/telecharger/42"]);
  });
});

describe("an authenticated document, reached with the storage state's cookies", () => {
  const link = `<a download href="/api/declaration-pdf?year=2026" aria-label="Télécharger la déclaration 2026 (PDF)">Télécharger</a>`;
  const state = (cookies: object[]): string => {
    const file = join(root, `state-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify({ cookies, origins: [] }));
    return file;
  };

  it("is refused without a session — the login page is « not a PDF »", async () => {
    const r = await downloadLinkedDocuments(join(root, "anon"), [{ id: "declaration", url: `${origin}/declaration`, html: link }]);
    expect(r.files).toEqual([]);
    expect(r.skipped).toEqual([{ url: `${origin}/api/declaration-pdf?year=2026`, reason: expect.stringMatching(/^not a PDF/) }]);
  });

  it("is downloaded with --storage-state, sending only the cookies that match the document URL", async () => {
    hits.length = 0;
    const storageState = state([
      { name: "session", value: "ok", domain: "127.0.0.1", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
      { name: "other-host", value: "x", domain: "example.org", path: "/", expires: -1 },
      { name: "other-path", value: "x", domain: "127.0.0.1", path: "/admin", expires: -1 },
    ]);
    const r = await downloadLinkedDocuments(join(root, "auth"), [{ id: "declaration", url: `${origin}/declaration`, html: link }], { storageState });
    expect(r.skipped).toEqual([]);
    expect(r.files).toHaveLength(1);
    expect(readFileSync(r.files[0]!)).toEqual(UNTAGGED);
    expect(readDocumentOrigin(r.files[0]!)).toEqual({ url: `${origin}/api/declaration-pdf?year=2026`, pages: ["declaration"] });
    expect(hits.map((h) => h.cookie)).toEqual(["session=ok"]);
  });

  it("uses a sample page's own storage state over the run-wide one", async () => {
    const anon = state([]);
    const user = state([{ name: "session", value: "ok", domain: "127.0.0.1", path: "/", expires: -1 }]);
    const r = await downloadLinkedDocuments(join(root, "per-page"), [{ id: "declaration", url: `${origin}/declaration`, html: link }], {
      storageState: anon,
      storageStateFor: (id) => (id === "declaration" ? user : undefined),
    });
    expect(r.files).toHaveLength(1);
  });

  it("drops an expired cookie", async () => {
    const storageState = state([{ name: "session", value: "ok", domain: "127.0.0.1", path: "/", expires: Math.floor(Date.now() / 1000) - 60 }]);
    const r = await downloadLinkedDocuments(join(root, "expired"), [{ id: "declaration", url: `${origin}/declaration`, html: link }], { storageState });
    expect(r.files).toEqual([]);
    expect(r.skipped[0]?.reason).toMatch(/^not a PDF/);
  });
});

describe("which storage-state cookies a document request carries", () => {
  const now = Date.UTC(2026, 10, 2);
  const c = (o: Record<string, unknown>) => ({ name: "n", value: "v", domain: "site.example", path: "/", expires: -1, secure: false, ...o });

  it("matches the domain: host-only exactly, a dotted domain on itself and its subdomains", () => {
    expect(cookieHeaderFor([c({ domain: "site.example" })], "https://site.example/d", now)).toBe("n=v");
    expect(cookieHeaderFor([c({ domain: "site.example" })], "https://www.site.example/d", now)).toBeUndefined();
    expect(cookieHeaderFor([c({ domain: ".site.example" })], "https://www.site.example/d", now)).toBe("n=v");
    expect(cookieHeaderFor([c({ domain: ".site.example" })], "https://site.example/d", now)).toBe("n=v");
    expect(cookieHeaderFor([c({ domain: ".site.example" })], "https://evilsite.example/d", now)).toBeUndefined();
  });

  it("matches the path on a segment boundary", () => {
    expect(cookieHeaderFor([c({ path: "/api" })], "https://site.example/api/doc", now)).toBe("n=v");
    expect(cookieHeaderFor([c({ path: "/api" })], "https://site.example/api", now)).toBe("n=v");
    expect(cookieHeaderFor([c({ path: "/api" })], "https://site.example/apix/doc", now)).toBeUndefined();
    expect(cookieHeaderFor([c({ path: "/api/" })], "https://site.example/api/doc", now)).toBe("n=v");
  });

  it("sends a Secure cookie over https (and to a loopback host, as a browser does), never over plain http", () => {
    expect(cookieHeaderFor([c({ secure: true })], "https://site.example/d", now)).toBe("n=v");
    expect(cookieHeaderFor([c({ secure: true })], "http://site.example/d", now)).toBeUndefined();
    expect(cookieHeaderFor([c({ secure: true, domain: "localhost" })], "http://localhost:3000/d", now)).toBe("n=v");
  });

  it("drops expired cookies, keeps session ones, and orders the longest path first", () => {
    expect(cookieHeaderFor([c({ expires: now / 1000 - 1 })], "https://site.example/d", now)).toBeUndefined();
    expect(cookieHeaderFor([c({ expires: now / 1000 + 3600 })], "https://site.example/d", now)).toBe("n=v");
    expect(cookieHeaderFor([c({ name: "a", path: "/" }), c({ name: "b", path: "/api" })], "https://site.example/api/d", now)).toBe("b=v; a=v");
  });

  it("reads nothing but well-formed cookies from a storage state, and nothing at all from an unreadable one", () => {
    const file = join(root, "mixed-state.json");
    writeFileSync(file, JSON.stringify({ cookies: [{ name: "ok", value: "1", domain: "a.example" }, { name: 3 }, "x"], origins: [] }));
    expect(readStorageCookies(file).map((k) => k.name)).toEqual(["ok"]);
    expect(readStorageCookies(join(root, "missing.json"))).toEqual([]);
  });
});

describe("the HTML report renders the documents section the Markdown has", () => {
  const audit = runAudit({ inputs: [join(FIX, "untagged.pdf"), join(FIX, "tagged-ua1.pdf"), join(FIX, "encrypted.pdf")] });
  const table = (blocks: Block[]): Extract<Block, { kind: "table" }> | undefined => {
    const at = blocks.findIndex((b) => b.kind === "heading" && b.id === "downloadable-documents");
    return blocks.slice(at).find((b): b is Extract<Block, { kind: "table" }> => b.kind === "table");
  };

  for (const lang of ["fr", "en"] as const) {
    it(`same rows, same outcomes, same caveat (${lang})`, () => {
      const model = documentsModel(audit, lang)!;
      expect(model.rows).toHaveLength(3);
      const md = renderReport(audit, lang);
      for (const doc of [compositeDoc(audit, { lang }), indexDoc(audit, { lang })]) {
        const heading = doc.blocks.find((b) => b.kind === "heading" && b.id === "downloadable-documents");
        expect(heading, "no documents heading in the HTML").toMatchObject({ text: model.title });
        expect(md).toContain(model.title);
        const t = table(doc.blocks)!;
        expect(t.columns.map((col) => col.text)).toEqual(model.columns);
        // An unreadable document's verdict spans the check columns (one cell, colspan) where the
        // Markdown pads them empty: the same text, cell for cell.
        expect(t.rows.map((row) => row.map((cell) => cell.text))).toEqual(model.rows.map((row) => (row.unreadable ? row.cells.slice(0, 3) : row.cells)));
        expect(JSON.stringify(doc.blocks)).toContain("veraPDF");
        // Every cell the HTML shows is a cell the Markdown shows.
        for (const row of model.rows) for (const cell of row.cells) if (cell) expect(md).toContain(cell.split(" — ")[0]!);
      }
      const unreadable = model.rows.find((row) => row.cells.some((cell) => /illisible|unreadable/.test(cell)));
      expect(unreadable).toBeDefined();
    });
  }

  it("is absent when the run read no document", () => {
    const none = runAudit({ inputs: [join(import.meta.dirname, "fixtures", "conforming")] });
    expect(documentsModel(none, "fr")).toBeUndefined();
    expect(compositeDoc(none, { lang: "fr" }).blocks.some((b) => b.kind === "heading" && b.id === "downloadable-documents")).toBe(false);
  });
});
