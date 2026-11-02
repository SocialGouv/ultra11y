// WHICH LINKS ARE A DOCUMENT, HOW A RESPONSE PROVES IT IS ONE, AND WHERE IT IS KEPT — the half of
// the document download that `scan` (src/documents.ts) and the Playwright fixture
// (src/integrations/playwright.ts) share.
//
// Node built-ins only, and nothing from the engine: the fixture bundle imports this file, and a
// test run must not pull an HTML parser or the PDF reader in to save a few bytes to disk. The
// fixture lists its links in the browser (resolved by the browser, `<base>` included); `scan`
// lists them from the recorded DOM. Both hand the same facts to `documentCandidate`, so a link is
// a document on one path exactly when it is one on the other.
//
// A link is only ever a CANDIDATE. Generated documents live behind routes
// (`/api/declaration-pdf?year=2026`), so the extension proves nothing either way; the response
// does. A candidate is kept when it answers `Content-Type: application/pdf` or bytes carrying a
// `%PDF-` header, and refused « not a PDF » otherwise — never audited as one.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DocumentOrigin } from "./types.js";

export const DOCUMENTS_DIR = ".ultra11y/documents";
/** Most documents fetched in one run. */
export const DOCUMENT_MAX_COUNT = 20;
/** Largest document kept, in bytes. */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
/** Per-request timeout. */
export const DOCUMENT_TIMEOUT_MS = 20_000;

/** What decides whether a link is a document candidate. `href` is the raw attribute (resolved
 *  against `base`) or, from a browser, the already-resolved `a.href`. */
export interface LinkFacts {
  href: string;
  download?: boolean;
  type?: string;
  text?: string;
  ariaLabel?: string;
  title?: string;
}

/** `PDF` as a WORD — « Télécharger (PDF, 120 Ko) », « Version pdf » — never inside one (PDFium). */
const PDF_WORD = /(?:^|[^\p{L}\p{N}])pdf(?:$|[^\p{L}\p{N}])/iu;

function namesPdf(s: string | undefined): boolean {
  return !!s && PDF_WORD.test(s);
}

/** The path or the query names the format as a token: `/x.pdf`, `/api/declaration-pdf`,
 *  `?format=pdf` — but not `/pdfs/`. */
function urlNamesPdf(u: URL): boolean {
  let s = `${u.pathname}${u.search}`;
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep it encoded */
  }
  return s.split(/[^\p{L}\p{N}]+/u).some((tok) => tok.toLowerCase() === "pdf");
}

/** The candidate URL (fragment dropped) for a link on a page, or `undefined`. Same-origin only —
 *  a third-party document is not the audited site's — and http(s), or a local file next to a
 *  local page. */
export function documentCandidate(link: LinkFacts, page: URL, base: URL = page): string | undefined {
  const href = (link.href ?? "").trim();
  if (!href || href.startsWith("#") || /^(?:javascript|mailto|tel|data|blob):/i.test(href)) return undefined;
  let u: URL;
  try {
    u = new URL(href, base);
  } catch {
    return undefined;
  }
  if (u.protocol !== page.protocol) return undefined;
  if (u.protocol !== "http:" && u.protocol !== "https:" && u.protocol !== "file:") return undefined;
  if ((u.protocol === "http:" || u.protocol === "https:") && u.host !== page.host) return undefined;
  const candidate =
    /\.pdf$/i.test(u.pathname) ||
    (link.type ?? "").trim().toLowerCase() === "application/pdf" ||
    link.download === true ||
    namesPdf(link.text) ||
    namesPdf(link.ariaLabel) ||
    namesPdf(link.title) ||
    urlNamesPdf(u);
  if (!candidate) return undefined;
  u.hash = "";
  return u.href;
}

/** Bytes carrying a PDF header: `%PDF-` within the first KiB (ISO 32000 tolerates a preamble). */
export function hasPdfHeader(bytes: Buffer): boolean {
  return bytes.toString("latin1", 0, Math.min(bytes.length, 1024)).includes("%PDF-");
}

/** The response PROVES a document: it says `application/pdf`, or its bytes start like one. */
export function looksLikePdf(contentType: string | undefined, bytes: Buffer): boolean {
  const ct = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  return ct === "application/pdf" || hasPdfHeader(bytes);
}

/** A redirect target the document request may follow: the origin it started on, or that
 *  origin upgraded from http to https on the same host name. */
export function sameOriginHop(start: URL, next: URL): boolean {
  if (next.protocol !== "http:" && next.protocol !== "https:") return false;
  if (next.origin === start.origin) return true;
  return start.protocol === "http:" && next.protocol === "https:" && next.hostname === start.hostname;
}

/** One HTTP response, whoever made the request (Node's `fetch`, Playwright's request context). */
export interface DocResponse {
  status: number;
  header(name: string): string | undefined;
  /** The body, or `undefined` when it exceeds `maxBytes` (reading stops there when it can). */
  body(maxBytes: number): Promise<Buffer | undefined>;
  /** Release a body that will not be read (a redirect). */
  discard?(): Promise<void>;
}

/** Issue ONE request, redirects NOT followed — `fetchDocument` follows them itself, so a hop off
 *  the origin is refused before it is requested, and each hop gets its own cookies. */
export type DocFetcher = (url: string) => Promise<DocResponse>;

/** Fetch a candidate within the bounds, and keep it only if the response proves a PDF. */
export async function fetchDocument(
  url: string,
  fetcher: DocFetcher,
  opts: { maxBytes?: number; maxRedirects?: number } = {},
): Promise<{ bytes: Buffer; url: string } | { reason: string }> {
  const maxBytes = opts.maxBytes ?? DOCUMENT_MAX_BYTES;
  const maxRedirects = opts.maxRedirects ?? 5;
  let start: URL;
  try {
    start = new URL(url);
  } catch {
    return { reason: `unreadable URL ${url}` };
  }
  let current = url;
  for (let hop = 0; ; hop++) {
    let res: DocResponse;
    try {
      res = await fetcher(current);
    } catch (e) {
      return { reason: `request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (res.status >= 300 && res.status < 400 && res.header("location")) {
      await res.discard?.().catch(() => undefined);
      if (hop >= maxRedirects) return { reason: `more than ${maxRedirects} redirects` };
      let next: URL;
      try {
        next = new URL(res.header("location")!, current);
      } catch {
        return { reason: `unreadable redirect to ${res.header("location")}` };
      }
      // EVERY HOP is checked before it is requested. A redirect that leaves the origin is a
      // third-party document after all — and following it first and looking afterwards had
      // already sent the GET there (a cloud metadata address, an intranet host), the session's
      // cookies with it. A downgrade to plain http on the same host is refused for the same
      // reason; the one change allowed is the upgrade of an http origin to https on its host.
      if (!sameOriginHop(start, next)) return { reason: `redirected off-origin to ${next.href}` };
      current = next.href;
      continue;
    }
    if (res.status < 200 || res.status >= 300) {
      await res.discard?.().catch(() => undefined);
      return { reason: `HTTP ${res.status}` };
    }
    const declared = Number(res.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.discard?.().catch(() => undefined);
      return { reason: `larger than ${maxBytes} bytes` };
    }
    let bytes: Buffer | undefined;
    try {
      bytes = await res.body(maxBytes);
    } catch (e) {
      return { reason: `request failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!bytes) return { reason: `larger than ${maxBytes} bytes` };
    const type = res.header("content-type");
    if (!looksLikePdf(type, bytes))
      return { reason: `not a PDF — the response is ${type ? type.split(";")[0]!.trim() : "untyped"} with no %PDF- header (a login page, an error page?)` };
    return { bytes, url: current };
  }
}

/** What a sidecar says it is. The reader checks it: a PDF the user named sits beside whatever
 *  `<name>.json` their project keeps, and that file's `url` / `pages` must never be read as where
 *  the document came from. */
export const SIDECAR_KIND = "ultra11y-document";
export const SIDECAR_VERSION = 1;

/** The sidecar `scan` or the fixture wrote beside a downloaded document, when there is one —
 *  `kind` + `v` checked. A sidecar from before `kind` existed (5.55: `{ v: 1, url, pages }`) is
 *  still read, but only beside a file named by its SHA-256, which is how they were stored. */
export function readDocumentOrigin(pdfPath: string): DocumentOrigin | undefined {
  const side = pdfPath.replace(/\.pdf$/i, ".json");
  if (side === pdfPath || !existsSync(side)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(side, "utf8")) as { kind?: unknown; v?: unknown; url?: unknown; pages?: unknown };
    if (!raw || typeof raw !== "object" || raw.v !== SIDECAR_VERSION) return undefined;
    if (raw.kind !== SIDECAR_KIND && !(raw.kind === undefined && /(?:^|[\\/])[0-9a-f]{64}\.pdf$/i.test(pdfPath))) return undefined;
    const url = typeof raw.url === "string" ? raw.url : undefined;
    const pages = Array.isArray(raw.pages) ? raw.pages.filter((p): p is string => typeof p === "string") : undefined;
    return { ...(url ? { url } : {}), ...(pages?.length ? { pages: [...new Set(pages)].sort() } : {}) };
  } catch {
    return undefined;
  }
}

/** Add the pages linking a stored document to its sidecar. Pages accumulate across runs; the
 *  first URL seen is kept. */
export function recordDocumentPages(file: string, url: string, pageIds: Iterable<string>): void {
  const prev = readDocumentOrigin(file);
  const pages = [...new Set([...(prev?.pages ?? []), ...pageIds])].sort();
  writeFileSync(file.replace(/\.pdf$/i, ".json"), `${JSON.stringify({ kind: SIDECAR_KIND, v: SIDECAR_VERSION, url: prev?.url ?? url, pages }, null, 2)}\n`);
}

/** Store a document under `<root>/.ultra11y/documents/<sha256>.pdf` with its sidecar. Named by its
 *  bytes, so the same document linked from many pages (or fetched again next run) is one file. */
export function storeDocument(root: string, url: string, bytes: Buffer, pageIds: Iterable<string>): string {
  const dir = join(root, DOCUMENTS_DIR);
  const sha = createHash("sha256").update(bytes).digest("hex");
  const file = join(dir, `${sha}.pdf`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, bytes);
  recordDocumentPages(file, url, pageIds);
  return file;
}
