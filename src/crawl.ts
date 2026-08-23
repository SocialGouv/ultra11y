// Zero-dependency page discovery for the dynamic tier: turn one entry point into
// the set of URLs to scan, either from a sitemap.xml or by breadth-first crawling
// the same-origin links found in the SERVED HTML. The latter sees links present in
// the response body (SSR/MPA); pure client-rendered SPA routes should come from a
// sitemap instead. The actual axe run per URL stays in the Docker tier (scan.ts).

/** Pull every `<loc>` value out of a sitemap.xml (urlset or sitemapindex). */
export function parseSitemapUrls(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]!);
  return out;
}

/** Extensions a crawl must never enqueue: they are DOWNLOADS, not pages.
 *
 *  A link to a PDF or a spreadsheet is a link off the web: Chromium answers it with a download
 *  rather than a navigation, so `page.goto` either times out or lands on `about:blank`, and the
 *  crawl spends a slot of its `--max` budget to learn nothing. Measured on
 *  tests/fixtures/realworld: a documents page with four download links ate three of the twelve
 *  crawl slots and printed three « non enregistrée — HTTP 404 » warnings, which read as a
 *  broken site rather than as a crawler following links it should never have followed.
 *
 *  Those documents are not dropped from the audit — RGAA 13.3/13.4 are about them, and the
 *  LINK is still audited on the page that carries it (`pack:rgaa:download-link-format` fires
 *  there). What is refused is treating the file itself as a page of the site.
 *
 *  The vocabulary is the RGAA pack's own download list (`download-link-format` in
 *  src/data/standards/rgaa.json), widened to the archive, media and asset types a crawl meets.
 *  A crawler that skipped a different set from the one the pack calls a document would
 *  disagree with the report about what a document is. */
const DOWNLOAD_EXT =
  /\.(?:pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|csv|zip|rar|7z|gz|tar|epub|dmg|exe|pkg|mp3|mp4|m4a|m4v|avi|mov|wmv|webm|ogg|wav|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf)$/i;

/** Whether a URL points at a file to download rather than a page to crawl. */
export function isDownloadUrl(url: string): boolean {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* not absolute — match on the raw string, which is what a relative href looks like */
  }
  return DOWNLOAD_EXT.test(path);
}

/** Same-origin, hash-stripped, de-duplicated absolute links from a page's HTML.
 *  Links to downloadable files are left out — see DOWNLOAD_EXT. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const origin = new URL(baseUrl).origin;
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]!.trim();
    if (!href || href.startsWith("#")) continue; // pure fragment → current page
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      continue;
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue; // mailto/tel/js
    if (abs.origin !== origin) continue;
    if (isDownloadUrl(abs.pathname)) continue; // a download, not a page — see DOWNLOAD_EXT
    abs.hash = "";
    const url = abs.href;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** The served page's `<title>`, collapsed and entity-decoded for the few entities a title
 *  realistically carries. It is what a human reads in the sample and the report, so it is
 *  worth taking from the page rather than inventing one from the URL — but a page without
 *  one gets `undefined`, never a guess. */
export function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  const text = m[1]!
    // Numeric references first: they cover any character, so a French title written
    // `Caf&#233;` reads as "Café" instead of leaking markup into the report. `&amp;` is
    // decoded LAST so `&amp;#233;` — a literal, escaped "&#233;" — is not double-decoded.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

/** A readable page name derived from a URL path, for a page whose document carries no
 *  `<title>`. `/nous-contacter` → "Nous contacter"; the root is the home page. */
export function nameFromUrl(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* not a URL — humanize the raw string */
  }
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return "Accueil";
  const words = last
    .replace(/\.x?html?$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (!words) return "Accueil";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `/index.html` and `/` are the same document on every conventional server, and a crawl
 *  reaches both: the entry point is `/` while the site's own nav links to `/index.html`.
 *  Left distinct they become two pages in the deliverable — the same screen audited twice,
 *  two identical columns in the grid, and its criteria weighted double in every per-page
 *  aggregate. Measured on a three-page test site: four pages reported, two of them the home
 *  page.
 *
 *  Only the DIRECTORY-INDEX filenames, and only as a whole path segment. Whatever else a
 *  server may alias is its own business: guessing there would merge two pages that really
 *  are different, and a page merged away is a page nobody audits — the worse error of the
 *  two, and a silent one. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.pathname = u.pathname.replace(/(^|\/)index\.x?html?$/i, "$1");
    return u.href;
  } catch {
    return url; // not a URL — the caller's own string is the best identity available
  }
}

/** A crawl bound, read from a caller that is allowed to say "no bound".
 *
 *  `0` is the sentinel, and an absent value now means the same thing: **unbounded**. The old
 *  defaults (50 pages, 2 hops) truncated a sweep in silence, and a deliverable shorter than
 *  the site it claims to audit reads exactly like a complete one — which is the failure mode
 *  this whole tool exists to prevent. A bound is now something you ASK for.
 *
 *  A negative or non-finite value is unbounded too, rather than an error: it can only reach
 *  here from a caller doing arithmetic on its own input, and refusing the run over it would
 *  cost more than covering more pages does. */
export function crawlBound(n: number | undefined): number {
  return n === undefined || !Number.isFinite(n) || n <= 0 ? Number.POSITIVE_INFINITY : n;
}

export interface CrawlOpts {
  fetchHtml: (url: string) => Promise<string>;
  /** Link hops to follow. Absent or 0 ⇒ unbounded (see `crawlBound`). */
  depth?: number;
  /** Cap on pages visited. Absent or 0 ⇒ unbounded (see `crawlBound`). */
  max?: number;
  /** Called as each page is reached, with the running count. An unbounded crawl must never
   *  be a silent one — it is the only thing between a reader and a job that looks hung. The
   *  library holds no opinion about where the line goes, so the caller supplies this. */
  onPage?: (url: string, n: number) => void;
}

/** Breadth-first crawl from `start`, following same-origin links in served HTML.
 *
 *  Visits the start URL first. `depth` (link hops) and `max` (pages) bound it when the caller
 *  asks; unbounded by default. Termination does not depend on either: the frontier is
 *  same-origin only and every URL is de-duplicated by its CANONICAL form, so a cycle — or a
 *  site that links `/` and `/index.html` at once — is visited exactly once. */
export async function crawlUrls(start: string, opts: CrawlOpts): Promise<string[]> {
  const depth = crawlBound(opts.depth);
  const max = crawlBound(opts.max);
  const order: string[] = [];
  const first = canonicalUrl(start);
  const seen = new Set<string>([first]);
  const queue: { url: string; d: number }[] = [{ url: first, d: 0 }];

  while (queue.length > 0 && order.length < max) {
    const { url, d } = queue.shift()!;
    order.push(url);
    opts.onPage?.(url, order.length);
    if (d >= depth) continue;
    let html = "";
    try {
      html = await opts.fetchHtml(url);
    } catch {
      continue;
    }
    for (const link of extractLinks(html, url)) {
      const canon = canonicalUrl(link);
      if (seen.has(canon)) continue;
      seen.add(canon);
      queue.push({ url: canon, d: d + 1 });
    }
  }
  return order;
}
