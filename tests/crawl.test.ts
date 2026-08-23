import { describe, it, expect } from "vitest";
import { parseSitemapUrls, extractLinks, crawlUrls, canonicalUrl, crawlBound, isDownloadUrl } from "../src/crawl.js";

describe("parseSitemapUrls", () => {
  it("extracts every <loc> from a urlset, trimming whitespace", () => {
    const xml = `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://exemple.fr/</loc></url>
        <url><loc>
          https://exemple.fr/contact
        </loc></url>
      </urlset>`;
    expect(parseSitemapUrls(xml)).toEqual(["https://exemple.fr/", "https://exemple.fr/contact"]);
  });
  it("returns an empty list for a document with no <loc>", () => {
    expect(parseSitemapUrls("<urlset></urlset>")).toEqual([]);
  });
});

describe("extractLinks", () => {
  const base = "https://exemple.fr/blog/";
  it("resolves relative links to absolute, same-origin only", () => {
    const html = `<a href="article">A</a> <a href="/about">B</a> <a href="https://exemple.fr/c">C</a>`;
    expect(extractLinks(html, base)).toEqual(["https://exemple.fr/blog/article", "https://exemple.fr/about", "https://exemple.fr/c"]);
  });
  it("drops cross-origin, mailto/tel, pure fragments, and strips hashes; de-duplicates", () => {
    const html = `
      <a href="https://autre.fr/x">ext</a>
      <a href="mailto:a@b.fr">mail</a>
      <a href="#section">frag</a>
      <a href="/page#top">hash</a>
      <a href="/page">dup</a>`;
    expect(extractLinks(html, base)).toEqual(["https://exemple.fr/page"]);
  });

  // A DOWNLOAD IS NOT A PAGE, and enqueueing one costs a crawl slot to learn nothing.
  //
  // Chromium answers a PDF link with a download rather than a navigation, so `page.goto` either
  // times out or lands on about:blank. Measured on tests/fixtures/realworld: a documents page
  // with four download links ate three of the twelve crawl slots and printed three
  // « non enregistrée — HTTP 404 » warnings, which read as a broken site rather than as a
  // crawler following links it should never have followed.
  it("does not enqueue links to files a browser downloads instead of rendering", () => {
    const html = `
      <a href="/rapport.pdf">Rapport</a>
      <a href="/contrat.docx">Contrat</a>
      <a href="/annexe.XLSX">Annexe</a>
      <a href="/archive.zip">Archive</a>
      <a href="/demo.mp4">Démo</a>
      <a href="/logo.svg">Logo</a>
      <a href="/tarifs">Tarifs</a>`;
    expect(extractLinks(html, base)).toEqual(["https://exemple.fr/tarifs"]);
  });

  it("keeps a page whose path merely CONTAINS a document extension", () => {
    // The match is anchored at the end of the path: `/guide-pdf` and `/pdf/lecteur` are pages,
    // and a filter that matched anywhere would silently drop a whole section of a site.
    const html = `<a href="/guide-pdf">Guide</a><a href="/pdf/lecteur">Lecteur</a><a href="/a.pdf?v=2">Fichier</a>`;
    expect(extractLinks(html, base)).toEqual(["https://exemple.fr/guide-pdf", "https://exemple.fr/pdf/lecteur"]);
  });

  it("exposes the same judgement on its own, so a caller never re-implements the list", () => {
    expect(isDownloadUrl("https://exemple.fr/a.pdf")).toBe(true);
    expect(isDownloadUrl("/dossier/b.DOCX")).toBe(true);
    expect(isDownloadUrl("https://exemple.fr/contact")).toBe(false);
    expect(isDownloadUrl("/")).toBe(false);
  });
});

describe("crawlUrls", () => {
  const pages: Record<string, string> = {
    "https://exemple.fr/": `<a href="/a">a</a><a href="/b">b</a>`,
    "https://exemple.fr/a": `<a href="/c">c</a><a href="/">home</a>`,
    "https://exemple.fr/b": `<a href="/a">a</a>`,
    "https://exemple.fr/c": `<a href="/a">a</a>`,
  };
  const fetchHtml = async (url: string): Promise<string> => pages[url] ?? "";

  it("BFS-discovers same-origin pages up to the depth limit, start first, de-duplicated", async () => {
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml, depth: 1, max: 50 });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/a", "https://exemple.fr/b"]);
  });
  it("goes one level deeper at depth 2 (reaches /c via /a)", async () => {
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml, depth: 2, max: 50 });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/a", "https://exemple.fr/b", "https://exemple.fr/c"]);
  });
  it("honours the max-pages cap regardless of depth", async () => {
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml, depth: 5, max: 2 });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/a"]);
  });

  // A BOUND IS SOMETHING YOU ASK FOR.
  //
  // The old defaults (50 pages, 2 hops) truncated a sweep in silence, and a deliverable
  // shorter than the site reads exactly like a complete one — the failure mode this tool
  // exists to prevent. Unbounded is now the default, and `0` says it explicitly. Termination
  // comes from the crawl's own invariants, not from the cap: same origin, and de-duplication
  // by canonical URL.
  it("crawls the whole site when no bound is given", async () => {
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/a", "https://exemple.fr/b", "https://exemple.fr/c"]);
  });
  it("reads 0 as 'no bound', for max and for depth alike", async () => {
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml, depth: 0, max: 0 });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/a", "https://exemple.fr/b", "https://exemple.fr/c"]);
  });
  it("still terminates on a cycle, because identity is the canonical URL", async () => {
    const loop: Record<string, string> = {
      "https://exemple.fr/": `<a href="/x">x</a>`,
      "https://exemple.fr/x": `<a href="/">home</a><a href="/index.html">home again</a><a href="/x#top">self</a>`,
    };
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml: async (u) => loop[u] ?? "", depth: 0, max: 0 });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/x"]);
  });

  // An unbounded crawl must never be a silent one: it is the only thing standing between a
  // reader and a job that looks hung. The reporter is the caller's, so the library keeps no
  // opinion about where the line goes.
  it("reports each page as it is reached, with its running count", async () => {
    const seen: string[] = [];
    await crawlUrls("https://exemple.fr/", { fetchHtml, onPage: (url, n) => seen.push(`${n} ${url}`) });
    expect(seen).toEqual(["1 https://exemple.fr/", "2 https://exemple.fr/a", "3 https://exemple.fr/b", "4 https://exemple.fr/c"]);
  });
});

describe("crawlBound", () => {
  it("reads absent, 0 and negative as unbounded, and a positive number as itself", () => {
    expect(crawlBound(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(crawlBound(0)).toBe(Number.POSITIVE_INFINITY);
    expect(crawlBound(-1)).toBe(Number.POSITIVE_INFINITY);
    expect(crawlBound(Number.NaN)).toBe(Number.POSITIVE_INFINITY);
    expect(crawlBound(20)).toBe(20);
  });
});

// A crawl reaches the home page twice on almost every real site: the entry point is `/` and
// the site's own nav links to `/index.html`. Measured on a three-page test site, the
// deliverable came back with FOUR pages — two of them the same screen, two identical columns
// in the grid, and its criteria weighted double in every per-page aggregate.
describe("canonicalUrl", () => {
  it("folds the directory index onto its directory", () => {
    expect(canonicalUrl("https://exemple.fr/index.html")).toBe("https://exemple.fr/");
    expect(canonicalUrl("https://exemple.fr/index.htm")).toBe("https://exemple.fr/");
    expect(canonicalUrl("https://exemple.fr/blog/index.html")).toBe("https://exemple.fr/blog/");
    expect(canonicalUrl("https://exemple.fr/INDEX.HTML")).toBe("https://exemple.fr/");
  });

  it("strips the fragment, which is the same page by definition", () => {
    expect(canonicalUrl("https://exemple.fr/a#contenu")).toBe("https://exemple.fr/a");
  });

  // The narrow rule is deliberate: merging two pages that really are different is the worse
  // error of the two, because a page merged away is a page nobody audits — and silently.
  it("touches nothing else", () => {
    for (const url of [
      "https://exemple.fr/a",
      "https://exemple.fr/index.html.old",
      "https://exemple.fr/reindex.html",
      "https://exemple.fr/a?index.html",
      "https://exemple.fr/produits/index.php",
    ]) {
      expect(canonicalUrl(url)).toBe(url);
    }
  });

  it("hands back a string it cannot parse, rather than losing it", () => {
    expect(canonicalUrl("pas une url")).toBe("pas une url");
  });
});

describe("crawlUrls folds the home page's two addresses into one", () => {
  const pages: Record<string, string> = {
    "https://exemple.fr/": '<a href="/index.html">Accueil</a><a href="/a">a</a>',
    "https://exemple.fr/a": '<a href="/index.html">Accueil</a>',
  };
  const fetchHtml = async (url: string): Promise<string> => pages[url] ?? "";

  it("never queues /index.html beside /", async () => {
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml, depth: 3, max: 50 });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/a"]);
  });

  it("…and starting FROM /index.html lands on the same identity", async () => {
    const urls = await crawlUrls("https://exemple.fr/index.html", { fetchHtml, depth: 3, max: 50 });
    expect(urls[0]).toBe("https://exemple.fr/");
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/a"]);
  });
});
