// THE DOCUMENT DOWNLOAD STAYS WHERE IT WAS SENT (issue #114). Four holes in the first cut (#98):
// a redirect was checked after it had been followed — the GET had already reached the target, a
// metadata address included, and an https→http downgrade passed; a local page's `../../x.pdf`
// copied any PDF on the disk; one bad link (`file://otherhost/…`, a directory) aborted the whole
// scan; and any sibling `<name>.json` was read as a sidecar.
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { downloadLinkedDocuments } from "../src/documents.js";
import { type DocFetcher, fetchDocument, readDocumentOrigin, sameOriginHop, SIDECAR_KIND } from "../src/document-store.js";

const UNTAGGED = readFileSync(join(import.meta.dirname, "fixtures", "pdf", "untagged.pdf"));
const root = mkdtempSync(join(tmpdir(), "u11y-docs-hard-"));

let site: Server;
let elsewhere: Server;
let origin = "";
let otherOrigin = "";
const elsewhereHits: string[] = [];

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const a = s.address();
  return `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
};

beforeAll(async () => {
  elsewhere = createServer((req, res) => {
    elsewhereHits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end(UNTAGGED);
  });
  otherOrigin = await listen(elsewhere);
  site = createServer((req, res) => {
    const url = req.url ?? "";
    if (url === "/leave.pdf") {
      res.writeHead(302, { location: `${otherOrigin}/metadata.pdf` });
      res.end();
    } else if (url === "/loop.pdf") {
      res.writeHead(302, { location: "/loop.pdf" });
      res.end();
    } else if (url === "/hop.pdf") {
      res.writeHead(301, { location: "/final.pdf" });
      res.end();
    } else if (url === "/final.pdf") {
      res.writeHead(200, { "content-type": "application/pdf" });
      res.end(UNTAGGED);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  origin = await listen(site);
});
afterAll(() => {
  site?.close();
  elsewhere?.close();
  rmSync(root, { recursive: true, force: true });
});

describe("every redirect hop is checked BEFORE it is followed", () => {
  it("never requests an off-origin target, follows a same-origin hop, and bounds the hops", async () => {
    elsewhereHits.length = 0;
    const html = `<a href="/leave.pdf">a</a><a href="/loop.pdf">b</a><a href="/hop.pdf">c</a>`;
    const r = await downloadLinkedDocuments(join(root, "redirects"), [{ id: "p", url: `${origin}/p`, html }]);
    const reasons = Object.fromEntries(r.skipped.map((s) => [s.url.replace(origin, ""), s.reason]));
    expect(reasons["/leave.pdf"]).toBe(`redirected off-origin to ${otherOrigin}/metadata.pdf`);
    expect(elsewhereHits, "the off-origin redirect target was requested").toEqual([]);
    expect(reasons["/loop.pdf"]).toBe("more than 5 redirects");
    expect(r.files).toHaveLength(1);
    expect(readDocumentOrigin(r.files[0]!)?.url).toBe(`${origin}/hop.pdf`);
  });

  it("refuses an https→http downgrade on the same host, and allows only the upgrade", async () => {
    expect(sameOriginHop(new URL("https://site.example/a"), new URL("http://site.example/b"))).toBe(false);
    expect(sameOriginHop(new URL("http://site.example/a"), new URL("https://site.example/b"))).toBe(true);
    expect(sameOriginHop(new URL("https://site.example/a"), new URL("https://site.example:8443/b"))).toBe(false);
    expect(sameOriginHop(new URL("https://site.example/a"), new URL("https://169.254.169.254/latest"))).toBe(false);
    expect(sameOriginHop(new URL("https://site.example/a"), new URL("file:///etc/passwd"))).toBe(false);

    const asked: string[] = [];
    const fetcher: DocFetcher = async (url) => {
      asked.push(url);
      return { status: 302, header: (n) => (n === "location" ? "http://site.example/doc.pdf" : undefined), body: async () => Buffer.alloc(0) };
    };
    expect(await fetchDocument("https://site.example/doc.pdf", fetcher)).toEqual({ reason: "redirected off-origin to http://site.example/doc.pdf" });
    expect(asked).toEqual(["https://site.example/doc.pdf"]);
  });
});

describe("a local page's documents are read from its own directory only", () => {
  const site = join(root, "local", "site");
  const outside = join(root, "local", "outside");
  mkdirSync(join(site, "docs"), { recursive: true });
  mkdirSync(join(site, "folder.pdf"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(site, "docs", "inner.pdf"), UNTAGGED);
  writeFileSync(join(outside, "secret.pdf"), UNTAGGED);
  symlinkSync(join(outside, "secret.pdf"), join(site, "link.pdf"));
  const page = pathToFileURL(join(site, "index.html")).href;

  it("keeps a document beside the page, refuses ../, an absolute path, a symlink out and a directory — and the scan goes on", async () => {
    const html = [
      `<a href="docs/inner.pdf">inner</a>`,
      `<a href="../outside/secret.pdf">up</a>`,
      `<a href="${pathToFileURL(join(outside, "secret.pdf")).href}">absolute</a>`,
      `<a href="link.pdf">symlink</a>`,
      `<a href="folder.pdf">a directory</a>`,
      `<a href="file://otherhost/share/x.pdf">another host</a>`,
    ].join("");
    const r = await downloadLinkedDocuments(join(root, "local", "store"), [{ id: "index", url: page, html }]);
    expect(r.files).toHaveLength(1);
    expect(readDocumentOrigin(r.files[0]!)?.url).toBe(pathToFileURL(join(site, "docs", "inner.pdf")).href);
    const reasons = r.skipped.map((s) => [s.url.split("/").pop(), s.reason]);
    expect(reasons).toEqual(
      expect.arrayContaining([
        ["secret.pdf", "outside the linking page's directory"],
        ["link.pdf", "outside the linking page's directory"],
        ["folder.pdf", "not a file"],
        ["x.pdf", expect.stringMatching(/^failed: /)],
      ]),
    );
    // ../ and the absolute path are the same file: one entry, deduplicated by URL.
    expect(r.skipped).toHaveLength(4);
  });
});

describe("a sidecar says what it is, and the reader checks it", () => {
  const dir = join(root, "sidecars");
  mkdirSync(dir, { recursive: true });

  it("writes kind and v", async () => {
    const r = await downloadLinkedDocuments(join(root, "typed"), [{ id: "p", url: `${origin}/p`, html: `<a href="/final.pdf">x</a>` }]);
    const side = JSON.parse(readFileSync(r.files[0]!.replace(/\.pdf$/, ".json"), "utf8"));
    expect(side).toMatchObject({ kind: SIDECAR_KIND, v: 1, url: `${origin}/final.pdf`, pages: ["p"] });
  });

  it("ignores a project's own <name>.json beside a PDF it names, and a wrong kind or version", () => {
    const pdf = join(dir, "report.pdf");
    writeFileSync(pdf, UNTAGGED);
    writeFileSync(join(dir, "report.json"), JSON.stringify({ url: "https://not-a-sidecar.example", pages: ["x"] }));
    expect(readDocumentOrigin(pdf)).toBeUndefined();
    writeFileSync(join(dir, "report.json"), JSON.stringify({ kind: "something-else", v: 1, url: "https://x.example", pages: ["x"] }));
    expect(readDocumentOrigin(pdf)).toBeUndefined();
    writeFileSync(join(dir, "report.json"), JSON.stringify({ kind: SIDECAR_KIND, v: 2, url: "https://x.example", pages: ["x"] }));
    expect(readDocumentOrigin(pdf)).toBeUndefined();
    writeFileSync(join(dir, "report.json"), JSON.stringify({ kind: SIDECAR_KIND, v: 1, url: "https://x.example", pages: ["x"] }));
    expect(readDocumentOrigin(pdf)).toEqual({ url: "https://x.example", pages: ["x"] });
  });

  it("still reads a 5.55 sidecar (no kind) — only beside a file named by its SHA-256, as they were stored", () => {
    const sha = "a".repeat(64);
    writeFileSync(join(dir, `${sha}.pdf`), UNTAGGED);
    writeFileSync(join(dir, `${sha}.json`), JSON.stringify({ v: 1, url: "https://x.example/r.pdf", pages: ["p"] }));
    expect(readDocumentOrigin(join(dir, `${sha}.pdf`))).toEqual({ url: "https://x.example/r.pdf", pages: ["p"] });
  });
});
