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
// in size. A link is a CANDIDATE (src/document-store.ts — the extension, `download`, a text or a
// route naming PDF), and only a response that proves a PDF (`application/pdf` or a `%PDF-`
// header) is kept. Anything refused is reported, never silently dropped.
//
// The only credential ever sent is the one the caller handed `scan`: with `--storage-state`, the
// cookies of that Playwright session file that match the document URL (domain, path, `secure`,
// expiry) — the same ones the browser sent for the page that links it. They go to the audited
// origin only (a redirect off it is refused before it is requested) and are never written
// anywhere. Without a session, an authenticated document answers its login page and is skipped
// as « not a PDF ». The Playwright fixture downloads through its own request context instead
// (src/integrations/playwright.ts), which carries the test's session by construction.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_COUNT,
  DOCUMENT_TIMEOUT_MS,
  type DocFetcher,
  documentCandidate,
  fetchDocument,
  hasPdfHeader,
  readDocumentOrigin,
  storeDocument,
} from "./document-store.js";
import { attr, elementsByTag, hasAttr, parseHtml, visibleText, type Doc } from "./parse/html.js";
import { PDF_MAX_BYTES, readPdf } from "./parse/pdf.js";
import { PAGES_DIR } from "./snapshot.js";
import type { DocumentOrigin } from "./types.js";

export { DOCUMENTS_DIR, readDocumentOrigin } from "./document-store.js";

/** The engine reads a PDF from its extension; content sniffing would mean reading every file. */
export function isPdfPath(file: string): boolean {
  return /\.pdf$/i.test(file);
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

/** Same-origin document CANDIDATES in a page's DOM, resolved against the page URL (and its
 *  `<base href>`): a path ending in `.pdf`, `type="application/pdf"`, `<a download>`, a visible
 *  text / `aria-label` / `title` naming PDF as a word, or a path or query naming it as a token
 *  (src/document-store.ts `documentCandidate`, the one decision the fixture shares). */
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
    const url = documentCandidate(
      {
        href: attr(a, "href") ?? "",
        download: hasAttr(a, "download"),
        type: attr(a, "type") ?? "",
        text: visibleText(a),
        ariaLabel: attr(a, "aria-label") ?? "",
        title: attr(a, "title") ?? "",
      },
      page,
      base,
    );
    if (url) out.add(url);
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
  /** A Playwright storageState FILE (`scan --storage-state`): its cookies that match a document
   *  URL are sent with the request for it. */
  storageState?: string;
  /** A page's own storageState (a sample page's), overriding `storageState` for the documents
   *  that page links. */
  storageStateFor?: (pageId: string) => string | undefined;
}

export interface DocumentDownloadResult {
  /** The PDF files written (paths under `<root>/.ultra11y/documents`). */
  files: string[];
  /** Links not downloaded, and why. */
  skipped: { url: string; reason: string }[];
}

// ---------------------------------------------------------------------------------------------
// The storage state's cookies
// ---------------------------------------------------------------------------------------------

/** A cookie as Playwright's storageState records it. */
export interface StorageCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  /** Seconds since the epoch; `-1` (or absent) for a session cookie. */
  expires?: number;
  secure?: boolean;
}

/** The well-formed cookies of a storageState file — none when it cannot be read. The values are
 *  only ever put on a request to the origin they match; nothing here logs or writes them. */
export function readStorageCookies(path: string): StorageCookie[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const cookies = (raw as { cookies?: unknown })?.cookies;
  if (!Array.isArray(cookies)) return [];
  return cookies.filter(
    (c): c is StorageCookie =>
      !!c && typeof c === "object" && typeof c.name === "string" && typeof c.value === "string" && typeof c.domain === "string" && c.domain !== "",
  );
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** The `Cookie` header a browser would send for `url` from these cookies (RFC 6265 §5.4):
 *  domain-match (a host-only cookie on its host exactly, a `.domain` one on it and its
 *  subdomains), path-match on a segment boundary, `secure` over https only (a loopback host
 *  counts, as it does for a browser), expired ones dropped, the longest path first. */
export function cookieHeaderFor(cookies: readonly StorageCookie[], url: string, nowMs = Date.now()): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname || "/";
  const matched = cookies.filter((c) => {
    let d = c.domain.toLowerCase();
    if (d.startsWith(".")) {
      d = d.slice(1);
      if (host !== d && !host.endsWith(`.${d}`)) return false;
    } else if (host !== d) return false;
    const cp = c.path || "/";
    if (path !== cp && !(path.startsWith(cp) && (cp.endsWith("/") || path[cp.length] === "/"))) return false;
    if (c.secure && u.protocol !== "https:" && !LOOPBACK.has(host)) return false;
    if (typeof c.expires === "number" && c.expires > 0 && c.expires * 1000 <= nowMs) return false;
    return true;
  });
  if (!matched.length) return undefined;
  return matched
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (b.c.path || "/").length - (a.c.path || "/").length || a.i - b.i)
    .map(({ c }) => `${c.name}=${c.value}`)
    .join("; ");
}

/** Node's `fetch`, one hop at a time, the matching cookies on each hop, the body read up to the
 *  bound and no further. */
function nodeFetcher(timeoutMs: number, cookies: readonly StorageCookie[]): DocFetcher {
  return async (url) => {
    const cookie = cookies.length ? cookieHeaderFor(cookies, url) : undefined;
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), ...(cookie ? { headers: { cookie } } : {}) });
    return {
      status: res.status,
      header: (name) => res.headers.get(name) ?? undefined,
      discard: async () => {
        await res.body?.cancel().catch(() => undefined);
      },
      body: async (maxBytes) => {
        const reader = res.body?.getReader();
        if (!reader) return Buffer.alloc(0);
        const chunks: Buffer[] = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => undefined);
            return undefined;
          }
          chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks);
      },
    };
  };
}

/** A local page's local document: read from disk, same bounds, same proof — and only from the
 *  directory of a page that links it (its subdirectories included). « Next to the page » is the
 *  documented reach; `../../x.pdf` or `/abs/x.pdf` would otherwise copy any `%PDF-` file on the
 *  disk into the audit. Symlinks are resolved before the check, so one cannot point out of it. */
function readLocal(url: string, pageUrls: readonly string[], maxBytes: number): { bytes: Buffer; url: string } | { reason: string } {
  const path = fileURLToPath(url);
  if (!existsSync(path)) return { reason: "not found" };
  const real = realpathSync(path);
  const inside = pageUrls.some((pageUrl) => {
    try {
      const dir = realpathSync(dirname(fileURLToPath(pageUrl)));
      const rel = relative(dir, real);
      return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
    } catch {
      return false;
    }
  });
  if (!inside) return { reason: "outside the linking page's directory" };
  const st = statSync(real);
  if (!st.isFile()) return { reason: "not a file" };
  if (st.size > maxBytes) return { reason: `larger than ${maxBytes} bytes` };
  const bytes = readFileSync(real);
  if (!hasPdfHeader(bytes)) return { reason: "not a PDF — the file has no %PDF- header" };
  return { bytes, url };
}

/** Download the same-origin documents the given pages link to, into `<root>/.ultra11y/documents`.
 *  Each file is named by the SHA-256 of its bytes, so the same document linked from many pages
 *  (or re-fetched on the next run) is one file, and its sidecar lists every page that links it. */
export async function downloadLinkedDocuments(
  root: string,
  pages: { id: string; url: string; html: string }[],
  opts: DocumentDownloadOpts = {},
): Promise<DocumentDownloadResult> {
  const maxCount = opts.maxCount ?? DOCUMENT_MAX_COUNT;
  const maxBytes = opts.maxBytes ?? DOCUMENT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DOCUMENT_TIMEOUT_MS;
  // url → page ids linking it, in page order (and those pages' URLs, which bound a local read).
  const linked = new Map<string, Set<string>>();
  const linkedFrom = new Map<string, string[]>();
  for (const p of pages) {
    for (const url of pdfLinksIn(p.html, p.url)) {
      const set = linked.get(url) ?? new Set<string>();
      set.add(p.id);
      linked.set(url, set);
      linkedFrom.set(url, [...(linkedFrom.get(url) ?? []), p.url]);
    }
  }
  // Each session file is read once, whichever pages share it.
  const jars = new Map<string, StorageCookie[]>();
  const jarOf = (ids: Set<string>): StorageCookie[] => {
    let path: string | undefined;
    for (const id of ids) {
      path = opts.storageStateFor?.(id);
      if (path) break;
    }
    path ??= opts.storageState;
    if (!path) return [];
    if (!jars.has(path)) jars.set(path, readStorageCookies(path));
    return jars.get(path)!;
  };
  const files: string[] = [];
  const skipped: DocumentDownloadResult["skipped"] = [];
  let fetched = 0;
  for (const [url, ids] of linked) {
    if (fetched >= maxCount) {
      skipped.push({ url, reason: `document cap reached (${maxCount})` });
      continue;
    }
    fetched++;
    // ONE BAD LINK IS ONE SKIPPED ENTRY, never the end of the scan: a `file://otherhost/x.pdf`
    // (ERR_INVALID_FILE_URL_HOST), a directory (EISDIR), an unwritable store — each is reported
    // with its reason, and the pages and the other documents are still kept.
    try {
      const r = url.startsWith("file:")
        ? readLocal(url, linkedFrom.get(url) ?? [], maxBytes)
        : await fetchDocument(url, nodeFetcher(timeoutMs, jarOf(ids)), { maxBytes });
      if ("reason" in r) {
        skipped.push({ url, reason: r.reason });
        continue;
      }
      const file = storeDocument(root, url, r.bytes, ids);
      if (!files.includes(file)) files.push(file);
    } catch (e) {
      skipped.push({ url, reason: `failed: ${e instanceof Error ? e.message : String(e)}` });
    }
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
