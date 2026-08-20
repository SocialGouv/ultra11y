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

/** Same-origin, hash-stripped, de-duplicated absolute links from a page's HTML. */
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

export interface CrawlOpts {
  fetchHtml: (url: string) => Promise<string>;
  depth?: number;
  max?: number;
}

/** Breadth-first crawl from `start`, following same-origin links in served HTML.
 *  Visits the start URL first; bounded by `depth` (link hops) and `max` (pages). */
export async function crawlUrls(start: string, opts: CrawlOpts): Promise<string[]> {
  const depth = opts.depth ?? 1;
  const max = opts.max ?? 50;
  const order: string[] = [];
  const first = canonicalUrl(start);
  const seen = new Set<string>([first]);
  const queue: { url: string; d: number }[] = [{ url: first, d: 0 }];

  while (queue.length > 0 && order.length < max) {
    const { url, d } = queue.shift()!;
    order.push(url);
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
