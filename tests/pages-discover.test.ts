import { describe, it, expect } from "vitest";
import { extractTitle, nameFromUrl, crawlUrls, parseSitemapUrls } from "../src/crawl.js";
import { proposeSamplePages, mergeSample, validateSample } from "../src/sample.js";
import type { SampleConfig } from "../src/types.js";

// `pages discover` turns one entry point into the declared sample. The crawler and the
// sitemap parser already existed but only ever fed a single scan — nothing was persisted, so
// the multi-page contract stayed a block written by hand. These tests pin the two things
// that make writing it safe: a name taken from the page rather than invented, and a merge
// that never destroys the human work already in the config.

describe("extractTitle", () => {
  it("reads the document title and collapses its whitespace", () => {
    expect(extractTitle("<html><head><title>\n  Nous\n contacter </title></head></html>")).toBe("Nous contacter");
  });
  it("decodes the entities a title realistically carries", () => {
    expect(extractTitle("<title>R&quot;A&quot; &lt;b&gt;</title>")).toBe('R"A" <b>');
    expect(extractTitle("<title>Nous&nbsp;contacter</title>")).toBe("Nous contacter");
  });

  it("decodes numeric references, so an accented title is not leaked as markup", () => {
    expect(extractTitle("<title>Caf&#233; &#38; th&#xe9;</title>")).toBe("Café & thé");
  });

  it("does not double-decode an escaped ampersand", () => {
    // `&amp;#233;` is a literal "&#233;" the page wanted to SHOW, not an é.
    expect(extractTitle("<title>&amp;#233;</title>")).toBe("&#233;");
  });
  it("returns undefined rather than an empty name", () => {
    expect(extractTitle("<html><head><title>  </title></head></html>")).toBeUndefined();
    expect(extractTitle("<html><head></head></html>")).toBeUndefined();
  });
  it("survives attributes on the tag", () => {
    expect(extractTitle('<title data-x="1">Accueil</title>')).toBe("Accueil");
  });
});

describe("nameFromUrl", () => {
  it("humanizes the last path segment", () => {
    expect(nameFromUrl("https://exemple.fr/nous-contacter")).toBe("Nous contacter");
    expect(nameFromUrl("https://exemple.fr/mentions_legales.html")).toBe("Mentions legales");
  });
  it("names the root the home page", () => {
    expect(nameFromUrl("https://exemple.fr/")).toBe("Accueil");
    expect(nameFromUrl("https://exemple.fr")).toBe("Accueil");
  });
});

describe("proposeSamplePages", () => {
  it("prefers the served title over a name derived from the path", () => {
    const pages = proposeSamplePages(["https://exemple.fr/contact"], new Map([["https://exemple.fr/contact", "Nous contacter — Ma boutique"]]));
    expect(pages[0]!.name).toBe("Nous contacter — Ma boutique");
  });

  it("falls back to the path when the document has no title", () => {
    expect(proposeSamplePages(["https://exemple.fr/aide"])[0]!.name).toBe("Aide");
  });

  it("disambiguates colliding ids instead of dropping a page", () => {
    // Both slugify to `contact`; a sample that silently lost one would be smaller than the
    // site it claims to cover, and duplicate ids are a hard validation error anyway.
    const pages = proposeSamplePages(["https://exemple.fr/a/contact", "https://exemple.fr/b/contact"]);
    expect(pages.map((p) => p.id)).toEqual(["a-contact", "b-contact"]);
    const pages2 = proposeSamplePages(["https://exemple.fr/contact", "https://exemple.fr/contact/"]);
    expect(new Set(pages2.map((p) => p.id)).size).toBe(2);
  });

  it("produces a sample the validator accepts", () => {
    const sample = { pages: proposeSamplePages(["https://exemple.fr/", "https://exemple.fr/contact"]) };
    expect(validateSample(sample).ok).toBe(true);
  });
});

describe("mergeSample", () => {
  const existing: SampleConfig = {
    pages: [{ id: "mon-compte", name: "Mon compte", url: "https://exemple.fr/compte", auth: true, storageState: ".auth/user.json", notes: "Se connecter." }],
    transverse: ["En-tête", "Pied de page"],
  };

  it("never overwrites a declared page — auth, storageState and notes are human work", () => {
    const r = mergeSample(existing, proposeSamplePages(["https://exemple.fr/compte"], new Map([["https://exemple.fr/compte", "Compte"]])));
    expect(r.added).toEqual([]);
    expect(r.sample.pages).toHaveLength(1);
    expect(r.sample.pages[0]).toEqual(existing.pages[0]);
  });

  it("appends genuinely new URLs and keeps the transverse elements", () => {
    const r = mergeSample(existing, proposeSamplePages(["https://exemple.fr/", "https://exemple.fr/compte"]));
    expect(r.added.map((p) => p.url)).toEqual(["https://exemple.fr/"]);
    expect(r.kept).toBe(1);
    expect(r.sample.transverse).toEqual(["En-tête", "Pied de page"]);
  });

  it("re-runs idempotently", () => {
    const proposed = proposeSamplePages(["https://exemple.fr/", "https://exemple.fr/aide"]);
    const once = mergeSample(existing, proposed);
    const twice = mergeSample(once.sample, proposed);
    expect(twice.added).toEqual([]);
    expect(twice.sample.pages).toHaveLength(once.sample.pages.length);
  });

  it("suffixes a new page whose id collides with a declared one", () => {
    const withAccueil: SampleConfig = { pages: [{ id: "accueil", name: "Vieille accueil", url: "https://autre.fr/" }] };
    const r = mergeSample(withAccueil, proposeSamplePages(["https://exemple.fr/"]));
    expect(r.sample.pages.map((p) => p.id)).toEqual(["accueil", "accueil-2"]);
    expect(validateSample(r.sample).ok).toBe(true);
  });

  it("works from no config at all", () => {
    const r = mergeSample(undefined, proposeSamplePages(["https://exemple.fr/"]));
    expect(r.sample.pages).toHaveLength(1);
    expect(r.kept).toBe(0);
  });
});

describe("discovery sources", () => {
  it("crawls the served HTML for same-origin links", async () => {
    const pages: Record<string, string> = {
      "https://exemple.fr/": '<title>Accueil</title><a href="/contact">c</a><a href="https://ailleurs.fr/x">x</a>',
      "https://exemple.fr/contact": "<title>Contact</title>",
    };
    const urls = await crawlUrls("https://exemple.fr/", { fetchHtml: async (u) => pages[u] ?? "", depth: 2 });
    expect(urls).toEqual(["https://exemple.fr/", "https://exemple.fr/contact"]);
  });

  it("reads every <loc> of a sitemap", () => {
    const xml = "<urlset><url><loc>https://exemple.fr/</loc></url><url><loc>https://exemple.fr/aide</loc></url></urlset>";
    expect(parseSitemapUrls(xml)).toEqual(["https://exemple.fr/", "https://exemple.fr/aide"]);
  });
});
