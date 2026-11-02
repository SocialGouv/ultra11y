// DOWNLOADABLE DOCUMENTS — how a PDF reaches the engine, and how `scan` fetches the ones a page
// links to.
//
// Two routes, one Doc. A PDF named as an audit input (`audit report.pdf`, `audit "docs/**/*.pdf"`)
// is read from disk. A PDF a captured page LINKS to is downloaded by `scan` into
// `.ultra11y/documents/<sha256>.pdf`, beside a `<sha256>.json` sidecar recording the URL it came
// from and the pages that link it — so `audit` can re-read it offline later, and every finding
// it raises is attributed to the pages a reader reaches it from.
//
// The download is deliberately narrow: same-origin links only (a third-party PDF is not the
// audited site's document), http(s) or a local file next to a local page, bounded in count and
// in size, and only bytes that start with `%PDF-` are kept. Anything refused is reported, never
// silently dropped. No credential is ever sent: an authenticated document that answers with a
// login page is skipped as « not a PDF », which is the honest outcome when the session is the
// browser's and not this process's.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { attr, elementsByTag, parseHtml, type Doc } from "./parse/html.js";
import { PDF_MAX_BYTES, readPdf } from "./parse/pdf.js";
import { PAGES_DIR } from "./snapshot.js";
import type { DocumentOrigin } from "./types.js";

export const DOCUMENTS_DIR = ".ultra11y/documents";

/** The engine reads a PDF from its extension; content sniffing would mean reading every file. */
export function isPdfPath(file: string): boolean {
  return /\.pdf$/i.test(file);
}

/** The sidecar `scan` wrote beside a downloaded document, when there is one. */
export function readDocumentOrigin(pdfPath: string): DocumentOrigin | undefined {
  const side = pdfPath.replace(/\.pdf$/i, ".json");
  if (side === pdfPath || !existsSync(side)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(side, "utf8")) as { url?: unknown; pages?: unknown };
    const url = typeof raw.url === "string" ? raw.url : undefined;
    const pages = Array.isArray(raw.pages) ? raw.pages.filter((p): p is string => typeof p === "string") : undefined;
    return { ...(url ? { url } : {}), ...(pages?.length ? { pages: [...new Set(pages)].sort() } : {}) };
  } catch {
    return undefined;
  }
}

/** A document Doc from the file's bytes: no markup, its facts in `pdf`. `source` is the file's
 *  `%PDF-x.y` header — the line a citation of this file grounds on (src/grounding.ts). */
export function pdfDocFromBytes(bytes: Buffer, file: string, origin?: DocumentOrigin): Doc {
  const facts = readPdf(bytes);
  const header = /%PDF-\d\.\d/.exec(bytes.toString("latin1", 0, Math.min(bytes.length, 1024)))?.[0] ?? "";
  return {
    file,
    source: header,
    lossy: false,
    kind: "pdf",
    pdf: facts,
    ...(origin && (origin.url || origin.pages?.length) ? { document: origin } : {}),
    roots: [],
    elements: [],
    byId: new Map(),
    lineStarts: [0],
  };
}

/** Read a PDF from disk into a document Doc (sidecar included). A file too large to read is a
 *  Doc too — an unreadable one — so the audit reports it rather than skipping it. */
export function loadPdfDoc(path: string, file = path): Doc {
  const size = statSync(path).size;
  if (size > PDF_MAX_BYTES) {
    const doc = pdfDocFromBytes(Buffer.alloc(0), file, readDocumentOrigin(path));
    if (doc.pdf) doc.pdf = { ...doc.pdf, unreadable: "too-large", detail: `file is ${size} bytes; the reader stops at ${PDF_MAX_BYTES}` };
    return doc;
  }
  return pdfDocFromBytes(readFileSync(path), file, readDocumentOrigin(path));
}

// ---------------------------------------------------------------------------------------------
// Links → downloads
// ---------------------------------------------------------------------------------------------

/** Same-origin links to a PDF in a page's DOM, resolved against the page URL (and its
 *  `<base href>`). A link counts when its path ends in `.pdf` or it declares
 *  `type="application/pdf"`. */
export function pdfLinksIn(html: string, pageUrl: string): string[] {
  let page: URL;
  try {
    page = new URL(pageUrl);
  } catch {
    return [];
  }
  const doc = parseHtml(html, "<page>");
  const baseHref = elementsByTag(doc, "base")
    .map((b) => attr(b, "href"))
    .find((h): h is string => !!h);
  let base = page;
  if (baseHref) {
    try {
      base = new URL(baseHref, page);
    } catch {
      /* keep the page URL */
    }
  }
  const out = new Set<string>();
  for (const a of elementsByTag(doc, "a")) {
    const href = (attr(a, "href") ?? "").trim();
    if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel|data|blob):/i.test(href)) continue;
    let u: URL;
    try {
      u = new URL(href, base);
    } catch {
      continue;
    }
    const isPdf = /\.pdf$/i.test(u.pathname) || (attr(a, "type") ?? "").trim().toLowerCase() === "application/pdf";
    if (!isPdf) continue;
    if (u.protocol !== page.protocol) continue;
    if ((u.protocol === "http:" || u.protocol === "https:") && u.host !== page.host) continue;
    if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "file:") continue;
    u.hash = "";
    out.add(u.href);
  }
  return [...out].sort();
}

export interface DocumentDownloadOpts {
  /** Most documents fetched in one run (default 20). */
  maxCount?: number;
  /** Largest document kept, in bytes (default 20 MiB). */
  maxBytes?: number;
  /** Per-request timeout (default 20 s). */
  timeoutMs?: number;
}

export interface DocumentDownloadResult {
  /** The PDF files written (paths under `<root>/.ultra11y/documents`). */
  files: string[];
  /** Links not downloaded, and why. */
  skipped: { url: string; reason: string }[];
}

interface Fetched {
  bytes: Buffer;
}

async function fetchBounded(url: string, maxBytes: number, timeoutMs: number): Promise<Fetched | { reason: string }> {
  const u = new URL(url);
  if (u.protocol === "file:") {
    const path = fileURLToPath(u);
    if (!existsSync(path)) return { reason: "not found" };
    const size = statSync(path).size;
    if (size > maxBytes) return { reason: `larger than ${maxBytes} bytes` };
    return { bytes: readFileSync(path) };
  }
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { reason: `request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!res.ok) return { reason: `HTTP ${res.status}` };
  // A redirect that LEAVES the origin is a third-party document after all.
  try {
    if (new URL(res.url || url).host !== u.host) return { reason: `redirected off-origin to ${res.url}` };
  } catch {
    /* keep going: res.url is informational */
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { reason: `larger than ${maxBytes} bytes` };
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  if (!reader) return { reason: "empty response" };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { reason: `larger than ${maxBytes} bytes` };
    }
    chunks.push(Buffer.from(value));
  }
  return { bytes: Buffer.concat(chunks) };
}

/** Download the same-origin PDFs the given pages link to, into `<root>/.ultra11y/documents`.
 *  Each file is named by the SHA-256 of its bytes, so the same document linked from many pages
 *  (or re-fetched on the next run) is one file, and its sidecar lists every page that links it. */
export async function downloadLinkedDocuments(
  root: string,
  pages: { id: string; url: string; html: string }[],
  opts: DocumentDownloadOpts = {},
): Promise<DocumentDownloadResult> {
  const maxCount = opts.maxCount ?? 20;
  const maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  // url → page ids linking it, in page order.
  const linked = new Map<string, Set<string>>();
  for (const p of pages) {
    for (const url of pdfLinksIn(p.html, p.url)) {
      const set = linked.get(url) ?? new Set<string>();
      set.add(p.id);
      linked.set(url, set);
    }
  }
  const dir = join(root, DOCUMENTS_DIR);
  const files: string[] = [];
  const skipped: DocumentDownloadResult["skipped"] = [];
  let fetched = 0;
  for (const [url, ids] of linked) {
    if (fetched >= maxCount) {
      skipped.push({ url, reason: `document cap reached (${maxCount})` });
      continue;
    }
    fetched++;
    const r = await fetchBounded(url, maxBytes, timeoutMs);
    if ("reason" in r) {
      skipped.push({ url, reason: r.reason });
      continue;
    }
    if (!r.bytes.toString("latin1", 0, Math.min(r.bytes.length, 1024)).includes("%PDF-")) {
      skipped.push({ url, reason: "the response is not a PDF (a login page, an error page?)" });
      continue;
    }
    const sha = createHash("sha256").update(r.bytes).digest("hex");
    const file = join(dir, `${sha}.pdf`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, r.bytes);
    // Merge with a previous run's sidecar: pages accumulate, the first URL seen is kept.
    const prev = readDocumentOrigin(file);
    const allPages = [...new Set([...(prev?.pages ?? []), ...ids])].sort();
    writeFileSync(join(dir, `${sha}.json`), `${JSON.stringify({ v: 1, url: prev?.url ?? url, pages: allPages }, null, 2)}\n`);
    if (!files.includes(file)) files.push(file);
  }
  return { files, skipped };
}

/** The `scan` step: read back the snapshots this run just wrote (`meta.json` for the URL,
 *  `dom.html` for the links) and download the documents they link to. */
export async function downloadSnapshotDocuments(
  root: string,
  snapshotIds: readonly string[],
  opts: DocumentDownloadOpts = {},
): Promise<DocumentDownloadResult> {
  const pages: { id: string; url: string; html: string }[] = [];
  for (const id of snapshotIds) {
    const dir = join(root, PAGES_DIR, id);
    try {
      const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { url?: unknown };
      if (typeof meta.url !== "string" || !meta.url) continue;
      pages.push({ id, url: meta.url, html: readFileSync(join(dir, "dom.html"), "utf8") });
    } catch {
      /* a snapshot without its files links to nothing we can read */
    }
  }
  return downloadLinkedDocuments(root, pages, opts);
}
