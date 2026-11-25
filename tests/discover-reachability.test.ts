// Issue #224 — discovery trusted pages that answer 404 or redirect elsewhere.
//
// Found by a full skill-driven audit run against a static server: `pages discover --crawl
// --propose` declared pages named after the server's error page and a directory listing, and
// `sample check` called the sample complete. These tests drive a REAL HTTP server (node:http) —
// a 404, a trailing-slash 301 onto a directory listing, a trailing-slash 301 onto a real page, a
// 302 to another path — because a fake fetch cannot answer a status or a redirect.
import { createServer, type Server } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { crawlUrls } from "../src/crawl.js";
import { classifyProbe, landedOnRequestedPage, looksLikeDirectoryListing, probePage } from "../src/reachability.js";
import { readRoutes, unreachableSamplePages, writeRoutes } from "../src/routes.js";
import type { SampleConfig } from "../src/types.js";

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="fr"><head><title>${title}</title></head><body><main>${body}</main></body></html>`;

let server: Server;
let O = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = (status: number, body: string, headers: Record<string, string> = {}): void => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(body);
    };
    switch (req.url) {
      case "/":
        return html(
          200,
          page(
            "Accueil",
            '<a href="/contact">Contact</a> <a href="/introuvable">Lien mort</a> <a href="/documents">Documents</a> <a href="/aide">Aide</a> <a href="/ancien">Ancienne page</a> <a href="/mentions-legales">Mentions légales</a>',
          ),
        );
      case "/contact":
        return html(200, page("Nous contacter", "<p>Écrivez-nous.</p>"));
      case "/mentions-legales":
        return html(200, page("Mentions légales", "<p>Éditeur.</p>"));
      // The static server's own error page: a full document, at the requested address.
      case "/introuvable":
        return html(404, page("Error response", "<h1>Error response</h1><p>Error code: 404</p>"));
      // A directory: canonicalised with a trailing slash, then listed by the server.
      case "/documents":
        res.writeHead(301, { location: "/documents/" });
        return void res.end();
      case "/documents/":
        // Relative link: it resolves to /documents/sous/ only against the LANDING address.
        return html(
          200,
          page("Directory listing for /documents/", '<ul><li><a href="sous/">sous/</a></li><li><a href="formulaire.pdf">formulaire.pdf</a></li></ul>'),
        );
      case "/documents/sous/":
        return html(200, page("Sous-dossier", "<p>Une vraie page.</p>"));
      // A real page whose address the server canonicalises.
      case "/aide":
        res.writeHead(301, { location: "/aide/" });
        return void res.end();
      case "/aide/":
        return html(200, page("Aide", '<p>Questions fréquentes.</p><a href="faq">FAQ</a>'));
      case "/aide/faq":
        return html(200, page("FAQ", "<p>Réponses.</p>"));
      // Moved elsewhere: not the page asked for.
      case "/ancien":
        res.writeHead(302, { location: "/contact" });
        return void res.end();
      default:
        return html(404, page("Error response", "<p>404</p>"));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  O = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
  const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
  try {
    return { code: await main(argv), out: out.join("\n"), err: err.join("\n") };
  } finally {
    lo.mockRestore();
    le.mockRestore();
  }
}

/** Run `fn` from a fresh temporary directory (the CLI reads and writes .ultra11yrc.json there). */
async function inTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const cwd = process.cwd();
  const d = mkdtempSync(join(tmpdir(), "u11y-reach-"));
  try {
    process.chdir(d);
    return await fn(d);
  } finally {
    process.chdir(cwd);
    rmSync(d, { recursive: true, force: true });
  }
}

describe("classifyProbe — is this URL a page of the site?", () => {
  it("refuses a 404 with its status, whatever document came with it", async () => {
    expect(classifyProbe(await probePage(`${O}/introuvable`))).toMatchObject({ ok: false, reason: "http-status", status: 404 });
  });

  it("refuses a directory listing reached through a trailing-slash redirect", async () => {
    const probe = await probePage(`${O}/documents`);
    expect(probe.status).toBe(200);
    expect(probe.url).toBe(`${O}/documents/`);
    expect(classifyProbe(probe)).toMatchObject({ ok: false, reason: "directory-listing" });
  });

  it("follows a trailing-slash redirect onto a real page, at its landing address", async () => {
    expect(classifyProbe(await probePage(`${O}/aide`))).toEqual({ ok: true, url: `${O}/aide/`, status: 200 });
  });

  it("refuses a redirect to another path, naming where it lands", async () => {
    expect(classifyProbe(await probePage(`${O}/ancien`))).toMatchObject({ ok: false, reason: "redirect", landed: `${O}/contact` });
  });

  it("refuses a URL nothing answers", async () => {
    expect(classifyProbe(await probePage("http://127.0.0.1:1/"))).toMatchObject({ ok: false, reason: "error" });
  });

  it("reads a listing from the title only", () => {
    expect(looksLikeDirectoryListing("<title>Index of /pub/</title>")).toBe(true);
    expect(looksLikeDirectoryListing("<title>Directory listing for /</title>")).toBe(true);
    expect(looksLikeDirectoryListing("<title>Files within documents/</title>")).toBe(true);
    expect(looksLikeDirectoryListing("<title>Index des documents</title><ul><li>a.pdf</li></ul>")).toBe(false);
    expect(looksLikeDirectoryListing("<title>Documents</title><h1>Index of /documents/</h1>")).toBe(false);
  });

  it("keeps the scan's comparison: a trailing slash is the same page, another path is not", () => {
    expect(landedOnRequestedPage(`${O}/documents`, `${O}/documents/`)).toBe(true);
    expect(landedOnRequestedPage(`${O}/ancien`, `${O}/contact`)).toBe(false);
  });
});

describe("the crawl resolves links against the address a page was served from", () => {
  it("walks /documents/sous/ from a /documents → /documents/ redirect, not /sous/", async () => {
    const fetchHtml = async (url: string) => {
      const p = await probePage(url);
      return { html: p.html, url: p.url };
    };
    const urls = await crawlUrls(`${O}/documents`, { fetchHtml });
    expect(urls).toContain(`${O}/documents/sous/`);
    expect(urls).not.toContain(`${O}/sous/`);
  });
});

describe("`pages discover --crawl` leaves out what is not a page (CLI)", () => {
  it("proposes no 404, no listing, no redirect elsewhere — and says which, in French", async () => {
    await inTmp(async (d) => {
      const r = await run(["pages", "discover", "--crawl", `${O}/`, "--propose", "--write", "--lang", "fr"]);
      expect(r.code).toBe(0);
      const cfg = JSON.parse(readFileSync(join(d, ".ultra11yrc.json"), "utf8")) as { sample: SampleConfig };
      const urls = cfg.sample.pages.map((p) => p.url);
      expect(urls).not.toContain(`${O}/introuvable`);
      expect(urls).not.toContain(`${O}/documents`);
      expect(urls).not.toContain(`${O}/documents/`);
      expect(urls).not.toContain(`${O}/ancien`);
      expect(cfg.sample.pages.map((p) => p.name)).not.toContain("Error response");
      // The canonicalised page is declared at the address it is served from.
      expect(urls).toContain(`${O}/aide/`);
      expect(urls).not.toContain(`${O}/aide`);
      // …and its relative link was followed from there, not from /aide (→ /faq, a 404).
      expect(r.err).toContain(`${O}/aide/faq`);
      expect(r.err).not.toContain(`— ${O}/faq`);

      expect(r.err).toContain(`écartée de l'échantillon — ${O}/introuvable a répondu HTTP 404`);
      expect(r.err).toContain(`${O}/documents est un listing de répertoire`);
      expect(r.err).toContain(`${O}/ancien redirige vers ${O}/contact`);

      // The inventory keeps every route, with what it answered.
      const inv = readRoutes(d)!;
      const byUrl = new Map(inv.routes.map((x) => [x.url, x]));
      expect(byUrl.get(`${O}/introuvable`)).toMatchObject({ status: 404, refused: "http-status" });
      expect(byUrl.get(`${O}/documents`)).toMatchObject({ status: 200, landed: `${O}/documents/`, refused: "directory-listing" });
      expect(byUrl.get(`${O}/ancien`)).toMatchObject({ refused: "redirect", landed: `${O}/contact` });
      expect(byUrl.get(`${O}/contact`)).toMatchObject({ status: 200 });
      expect(byUrl.get(`${O}/contact`)?.refused).toBeUndefined();
      expect(byUrl.get(`${O}/aide`)).toMatchObject({ status: 200, landed: `${O}/aide/` });
      expect(byUrl.get(`${O}/aide`)?.refused).toBeUndefined();

      // The proposal's JSON names them too.
      const j = await run(["pages", "discover", "--crawl", `${O}/`, "--propose", "--json"]);
      const doc = JSON.parse(j.out) as { unreachable: { url: string; reason: string }[] };
      expect(doc.unreachable.map((u) => [u.url, u.reason]).sort()).toEqual(
        [
          [`${O}/ancien`, "redirect"],
          [`${O}/documents`, "directory-listing"],
          [`${O}/introuvable`, "http-status"],
        ].sort(),
      );
    });
  });

  it("applies the same rule without --propose", async () => {
    await inTmp(async (d) => {
      const r = await run(["pages", "discover", "--crawl", `${O}/`, "--write"]);
      expect(r.code).toBe(0);
      const cfg = JSON.parse(readFileSync(join(d, ".ultra11yrc.json"), "utf8")) as { sample: SampleConfig };
      const urls = cfg.sample.pages.map((p) => p.url);
      expect(urls).toContain(`${O}/contact`);
      expect(urls).toContain(`${O}/aide/`);
      for (const bad of ["/introuvable", "/documents", "/documents/", "/ancien"]) expect(urls).not.toContain(`${O}${bad}`);
    });
  });

  it("fails when no discovered URL answers as a page", async () => {
    await inTmp(async () => {
      const r = await run(["pages", "discover", "--crawl", `${O}/introuvable`, "--lang", "fr"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("ne répond comme une page du site");
    });
  });
});

describe("`sample check` does not call a sample complete over pages known to be unreachable", () => {
  it("names the declared 404 and withholds the « complete » verdict", async () => {
    await inTmp(async (d) => {
      const r0 = await run(["pages", "discover", "--crawl", `${O}/`, "--propose", "--write"]);
      expect(r0.code).toBe(0);
      const before = await run(["sample", "check", "--json"]);
      expect((JSON.parse(before.out) as { unreachablePages: unknown[] }).unreachablePages).toEqual([]);

      // A page declared by hand at the dead address (or kept from an earlier sample).
      const cfgFile = join(d, ".ultra11yrc.json");
      const cfg = JSON.parse(readFileSync(cfgFile, "utf8")) as { sample: SampleConfig };
      cfg.sample.pages.push({ id: "formulaires", name: "Formulaires", url: `${O}/introuvable`, notes: "ajoutée à la main" });
      writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));

      const r = await run(["sample", "check", "--lang", "fr"]);
      expect(r.code).toBe(0); // advisory, like every other incomplete sample
      expect(r.out).toContain("Page déclarée injoignable — « Formulaires » (formulaires)");
      expect(r.out).toContain("a répondu HTTP 404");
      expect(r.out).not.toContain("✓ Échantillon complet");

      const j = JSON.parse((await run(["sample", "check", "--json"])).out) as {
        complete: boolean;
        unreachablePages: { id: string; refused: string; status?: number }[];
      };
      expect(j.complete).toBe(false);
      expect(j.unreachablePages).toEqual([{ id: "formulaires", url: `${O}/introuvable`, refused: "http-status", status: 404 }]);
    });
  });

  it("forgets a refusal once a later discovery finds the page answering", () => {
    const d = mkdtempSync(join(tmpdir(), "u11y-reach-routes-"));
    try {
      writeRoutes(d, [`${O}/x`], "crawl", new Map([[`${O}/x`, { status: 404, refused: "http-status" as const }]]));
      expect(unreachableSamplePages(readRoutes(d), [{ id: "x", url: `${O}/x/` }])).toHaveLength(1);
      writeRoutes(d, [`${O}/x`], "crawl", new Map([[`${O}/x`, { status: 200 }]]));
      expect(unreachableSamplePages(readRoutes(d), [{ id: "x", url: `${O}/x` }])).toEqual([]);
      expect(readRoutes(d)!.routes[0]).toEqual({ url: `${O}/x`, via: ["crawl"], status: 200 });
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("`pages discover --from-snapshots --routes-only` on a project without E2E captures", () => {
  it("exits 0 with an informative line — nothing to add is not a failure", async () => {
    await inTmp(async (d) => {
      mkdirSync(join(d, ".ultra11y"), { recursive: true });
      const r = await run(["pages", "discover", "--from-snapshots", "--routes-only", "--lang", "fr"]);
      expect(r.code).toBe(0);
      expect(r.err).toContain("aucun instantané");
      expect(r.err).toContain("Rien n'a été écrit");
      expect(readRoutes(d)).toBeUndefined();
    });
  });

  it("still fails when the SAMPLE is to be built from snapshots that do not exist", async () => {
    await inTmp(async () => {
      expect((await run(["pages", "discover", "--from-snapshots", "--write"])).code).toBe(1);
    });
  });
});
