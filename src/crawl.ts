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
  const seen = new Set<string>([start]);
  const queue: { url: string; d: number }[] = [{ url: start, d: 0 }];

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
      if (seen.has(link)) continue;
      seen.add(link);
      queue.push({ url: link, d: d + 1 });
    }
  }
  return order;
}
