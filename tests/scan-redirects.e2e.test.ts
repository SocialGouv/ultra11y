// Issue #224, the scan half — driven through real Chromium against a real HTTP server.
//
// A full-audit run against a static server showed three things the unit suite cannot see,
// because only a browser follows a redirect and only a server answers one:
//
//   1. `/documents` answered 301 → `/documents/`, and the scan recorded the page under the
//      REQUESTED address. Its document links were then resolved against `/documents`, so
//      `formulaire.pdf` became `/formulaire.pdf` — a 404 — instead of `/documents/formulaire.pdf`.
//   2. A `<base href>` on the page moves that base again; the download must honour it.
//   3. `scan --sample` exited 0 with 9 of 11 sample pages refused. A partial sample is not a
//      pass: it now exits 1, names the refused pages, and still writes what it measured.
//
// It SKIPS rather than fails when no browser is installed, like the rest of the browser tier;
// ULTRA11Y_REQUIRE_BROWSER=1 (set in CI) turns the skip into a failure.
import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { PAGES_DIR } from "../src/snapshot.js";

let chromium: typeof import("@playwright/test").chromium | undefined;
try {
  ({ chromium } = await import("@playwright/test"));
} catch {
  /* not installed — every test below skips */
}
let browserAvailable = false;

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
// Two different files: documents are stored by content hash, so the same bytes twice would be one.
const PDF = readFileSync(join(REPO, "tests", "fixtures", "pdf", "untagged.pdf"));
const NOTICE = readFileSync(join(REPO, "tests", "fixtures", "pdf", "no-lang.pdf"));
const page = (title: string, body: string): string =>
  `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

let server: Server | undefined;
let O = "";
const requested: string[] = [];

beforeAll(async () => {
  if (chromium) {
    try {
      const b = await chromium.launch();
      await b.close();
      browserAvailable = true;
    } catch {
      /* no browser binary — skip */
    }
  }
  if (process.env.ULTRA11Y_REQUIRE_BROWSER === "1" && !browserAvailable) {
    throw new Error("ultra11y: ULTRA11Y_REQUIRE_BROWSER=1 but no Chromium could be launched — the browser tier did not run.");
  }
  server = createServer((req, res) => {
    requested.push(req.url ?? "");
    const html = (status: number, body: string): void => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    };
    switch (req.url) {
      case "/":
        return html(200, page("Accueil", "<p>Bienvenue.</p>"));
      case "/documents":
        res.writeHead(301, { location: "/documents/" });
        return void res.end();
      case "/documents/":
        return html(200, page("Documents", '<p><a href="formulaire.pdf">Formulaire de demande (PDF)</a></p>'));
      case "/documents/formulaire.pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        return void res.end(PDF);
      case "/fichiers/notice.pdf":
        res.writeHead(200, { "content-type": "application/pdf" });
        return void res.end(NOTICE);
      case "/notices":
        return html(200, page("Notices", '<p><a href="notice.pdf">Notice (PDF)</a></p>').replace("<head>", '<head><base href="/fichiers/">'));
      case "/ancien":
        res.writeHead(302, { location: "/" });
        return void res.end();
      default:
        return html(404, page("Error response", "<p>Error code: 404</p>"));
    }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  O = typeof addr === "object" && addr ? `http://127.0.0.1:${addr.port}` : "";
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
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

/** `scan --sample` over `pages`, from a fresh directory holding the sample. */
async function scanSample(pages: { id: string; name: string; url: string }[]) {
  const cwd = process.cwd();
  const work = mkdtempSync(join(tmpdir(), "u11y-scan-redirects-"));
  writeFileSync(join(work, ".ultra11yrc.json"), JSON.stringify({ sample: { pages } }, null, 2));
  try {
    process.chdir(work);
    const r = await run(["scan", "--sample", "--runtime", "local", "--cwd", REPO, "--root", work, "--no-interact", "--lang", "fr"]);
    return { ...r, work };
  } finally {
    process.chdir(cwd);
  }
}

const meta = (work: string, id: string) => JSON.parse(readFileSync(join(work, PAGES_DIR, id, "meta.json"), "utf8")) as { url: string; name: string };
const sidecars = (work: string) => {
  const dir = join(work, ".ultra11y", "documents");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { url: string; pages: string[] });
};

describe("scan --sample follows a canonicalising redirect and records where it landed", () => {
  it("audits /documents at /documents/ and downloads the document its link really points to", async () => {
    if (!browserAvailable) return;
    requested.length = 0;
    const r = await scanSample([
      { id: "accueil", name: "Accueil", url: `${O}/` },
      { id: "documents", name: "Documents", url: `${O}/documents` },
      { id: "notices", name: "Notices", url: `${O}/notices` },
    ]);
    try {
      expect(r.code, r.err).toBe(0);
      // The landing page is what was measured, and the address recorded.
      expect(meta(r.work, "documents")).toMatchObject({ name: "Documents", url: `${O}/documents/` });
      expect(r.err).toContain(`${O}/documents redirige vers ${O}/documents/ (même page, adresse canonicalisée)`);
      // Its relative link resolves against the landing address — and the <base href> on /notices
      // moves the base of that page's links again.
      const urls = sidecars(r.work).map((s) => s.url);
      expect(urls).toContain(`${O}/documents/formulaire.pdf`);
      expect(urls).toContain(`${O}/fichiers/notice.pdf`);
      expect(requested).not.toContain("/formulaire.pdf");
      expect(requested).not.toContain("/notice.pdf");
    } finally {
      rmSync(r.work, { recursive: true, force: true });
    }
  }, 180_000);
});

describe("scan --sample exits non-zero on a partial sample", () => {
  it("refuses the 404 and the redirect elsewhere, names them in French, and exits 1", async () => {
    if (!browserAvailable) return;
    const r = await scanSample([
      { id: "accueil", name: "Accueil", url: `${O}/` },
      { id: "formulaires", name: "Formulaires", url: `${O}/introuvable` },
      { id: "ancienne", name: "Ancienne page", url: `${O}/ancien` },
    ]);
    try {
      expect(r.code).toBe(1);
      expect(r.err).toContain("« Formulaires » (formulaires) non enregistrée");
      expect(r.err).toContain("a répondu HTTP 404");
      expect(r.err).toContain(`a redirigé vers ${O}/`);
      expect(r.err).toContain("échantillon partiel — 2 page(s) sur 3 non enregistrée(s) : « Formulaires » (formulaires), « Ancienne page » (ancienne)");
      // What was measured is still recorded: the exit code is the verdict, not a lost run.
      expect(meta(r.work, "accueil").url).toBe(`${O}/`);
      expect(existsSync(join(r.work, PAGES_DIR, "formulaires"))).toBe(false);
      expect(existsSync(join(r.work, PAGES_DIR, "ancienne"))).toBe(false);
    } finally {
      rmSync(r.work, { recursive: true, force: true });
    }
  }, 180_000);
});
