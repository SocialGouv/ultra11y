// `ultra11y serve`: the history, the evolution, the file guard, the server and the static export.
//
// The two audits under tests/fixtures/serve/audits are real engine output (`audit --json` over
// two versions of a two-page site), with the page scope stamped on by hand. The older one fails
// 1.1 on the home page and 6.2 on its empty link; the newer one fixes both there and adds an
// image without alternative on the contact page, plus a replayed journey.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { runAudit } from "../src/audit.js";
import { main } from "../src/cli.js";
import { classifyChange, discoverAudits, evolution, summarize } from "../src/serve-history.js";
import { buildSite, exportStatic, parseRequestPath, relHref, resolveUnder, startServer, type RunningServer } from "../src/serve.js";
import { averageConformanceRate, packReportRates } from "../src/report.js";
import { derivePages, pagesOf } from "../src/pages.js";
import { loadPack } from "../src/standards/index.js";
import { findingsForStandard } from "../src/standards/derive.js";

const FIX = join(import.meta.dirname, "fixtures", "serve");
const AUDITS = join(FIX, "audits");

const tmp = (): string => mkdtempSync(join(tmpdir(), "ultra11y-serve-"));

describe("audit history", () => {
  it("finds every current audit under the directory, oldest first, with date ids", () => {
    const h = discoverAudits(AUDITS);
    expect(h.map((e) => [e.id, e.rel])).toEqual([
      ["2026-09-01", "2026-09-01/audit-latest.json"],
      ["2026-10-15", "audit-latest.json"],
    ]);
  });

  it("counts an identical copy once, ignores non-audit JSON, and suffixes a shared date", () => {
    const dir = tmp();
    try {
      const raw = readFileSync(join(AUDITS, "audit-latest.json"), "utf8");
      writeFileSync(join(dir, "audit-latest.json"), raw);
      mkdirSync(join(dir, "copy"));
      writeFileSync(join(dir, "copy", "audit-latest.json"), raw);
      writeFileSync(join(dir, "pages.json"), JSON.stringify({ tool: "ultra11y", pages: [] }));
      writeFileSync(join(dir, "broken.json"), '{"tool": "ultra11y", ');
      // Same date, different content: a second audit of that day.
      const other = JSON.parse(raw);
      other.core.findings = [];
      mkdirSync(join(dir, "b"));
      writeFileSync(join(dir, "b", "audit.json"), JSON.stringify(other));
      const h = discoverAudits(dir);
      expect(h).toHaveLength(2);
      expect(h.map((e) => e.id).sort()).toEqual(["2026-10-15", "2026-10-15-2"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reuses the report's rates instead of recomputing them", () => {
    for (const e of discoverAudits(AUDITS)) {
      const s = summarize(e, "rgaa", "fr");
      expect(s.rows).toHaveLength(106);
      const { conformance } = packReportRates(e.result, loadPack("rgaa"));
      expect(s.rate).toEqual(conformance);
      expect(s.average).toEqual(averageConformanceRate(e.result, derivePages(e.result, pagesOf(e.result)), "rgaa", "fr"));
    }
  });

  it("computes the evolution: status changes per criterion, rate deltas, page deltas", () => {
    const [a, b] = discoverAudits(AUDITS).map((e) => summarize(e, "rgaa", "fr"));
    const evo = evolution(a!, b!);
    expect(evo.grid).toHaveLength(106);
    expect(evo.changes.map((c) => [c.id, c.before, c.after, c.kind])).toEqual([["6.2", "NC", "manual", "reopened"]]);
    expect(evo.rateDelta).toBe(b!.rate!.pct - a!.rate!.pct);
    expect(evo.averageDelta).toBe(b!.average!.pct! - a!.average!.pct!);
    expect(evo.averageDelta).toBe(17);
    const pages = Object.fromEntries(evo.pages.map((p) => [p.id, [p.before?.pct, p.after?.pct, p.delta]]));
    expect(pages).toEqual({ accueil: [50, 100, 50], contact: [67, 50, -17] });
  });

  it("names every kind of change by what it means, never only by its colour", () => {
    expect(classifyChange("NC", "C")).toBe("fixed");
    expect(classifyChange("NC", "NA")).toBe("fixed");
    expect(classifyChange("C", "NC")).toBe("regressed");
    expect(classifyChange("manual", "NC")).toBe("regressed");
    expect(classifyChange("manual", "C")).toBe("decided");
    expect(classifyChange("C", "manual")).toBe("reopened");
    expect(classifyChange("C", "NA")).toBe("requalified");
    expect(classifyChange(undefined, "C")).toBe("added");
    expect(classifyChange("C", undefined)).toBe("removed");
    expect(classifyChange("C", "C")).toBeUndefined();
  });
});

describe("paths", () => {
  it("links relatively from any page to any page", () => {
    expect(relHref("index.html", "audits/a/index.html")).toBe("audits/a/index.html");
    expect(relHref("audits/a/index.html", "index.html")).toBe("../../index.html");
    expect(relHref("audits/a/pages/x.html", "audits/a/index.html")).toBe("../index.html");
    expect(relHref("audits/a/index.html", "audits/a/index.html")).toBe("index.html");
    expect(relHref("audits/a/files.html", "files/audits/my file#1.md")).toBe("../../files/audits/my%20file%231.md");
  });

  it("parses the raw request path and refuses anything that could climb", () => {
    expect(parseRequestPath("/")).toEqual([""]);
    expect(parseRequestPath("/audits/a/index.html?x=1#y")).toEqual(["audits", "a", "index.html"]);
    expect(parseRequestPath("/audits/a/")).toEqual(["audits", "a", ""]);
    for (const bad of [
      undefined,
      "audits",
      "/files/audits/../x",
      "/files/audits/%2e%2e/x",
      "/files/audits/..%2fx",
      "/files/audits/a%5cb",
      "/files/audits/a%00b",
      "/files//x",
      "/files/audits/.env",
      "/%E0%A4%A",
    ])
      expect(parseRequestPath(bad), String(bad)).toBeNull();
  });
});

describe("the file guard", () => {
  let dir: string;
  let outside: string;
  beforeAll(() => {
    dir = tmp();
    outside = tmp();
    writeFileSync(join(outside, "secret.json"), "{}");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "ok.json"), "{}");
    writeFileSync(join(dir, "run.sh"), "echo");
    writeFileSync(join(dir, ".env.json"), "{}");
    symlinkSync(join(outside, "secret.json"), join(dir, "link.json"));
    symlinkSync(outside, join(dir, "linkdir"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("serves a regular file of a served type under the root", () => {
    // Real paths: on macOS the temporary directory itself sits behind a link (/var → /private/var).
    expect(resolveUnder(dir, ["sub", "ok.json"])).toBe(join(realpathSync(dir), "sub", "ok.json"));
  });

  it("refuses traversal, links escaping the root, directories, dot-files and unserved types", () => {
    expect(resolveUnder(dir, ["..", "x.json"])).toBeUndefined();
    expect(resolveUnder(join(dir, "sub"), ["..", "sub", "ok.json"])).toBeUndefined();
    expect(resolveUnder(dir, ["link.json"])).toBeUndefined();
    expect(resolveUnder(dir, ["linkdir", "secret.json"])).toBeUndefined();
    expect(resolveUnder(dir, ["sub"])).toBeUndefined();
    expect(resolveUnder(dir, [".env.json"])).toBeUndefined();
    expect(resolveUnder(dir, ["run.sh"])).toBeUndefined();
    expect(resolveUnder(dir, [])).toBeUndefined();
  });
});

/** A raw request: `fetch` would normalise `..` before the server ever saw it. */
function raw(
  port: number,
  path: string,
  opts: { method?: string; host?: string } = {},
): Promise<{ status: number; type: string; headers: Record<string, unknown>; body: string }> {
  return new Promise((ok, ko) => {
    const req = request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", ...(opts.host ? { headers: { host: opts.host } } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        ok({
          status: res.statusCode ?? 0,
          type: String(res.headers["content-type"] ?? ""),
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        }),
      );
    });
    req.on("error", ko);
    req.end();
  });
}

describe("the server", () => {
  let srv: RunningServer;
  let escapeDir: string;
  let outside: string;
  beforeAll(async () => {
    srv = await startServer({ auditsDir: AUDITS, root: FIX, lang: "fr", port: 0 });
    // A copy of the audits with a link pointing out of it, to prove the server refuses it.
    escapeDir = tmp();
    outside = tmp();
    writeFileSync(join(outside, "secret.md"), "secret");
    cpSync(AUDITS, join(escapeDir, "audits"), { recursive: true });
    symlinkSync(join(outside, "secret.md"), join(escapeDir, "audits", "leak.md"));
  });
  afterAll(async () => {
    await srv.close();
    rmSync(escapeDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("binds to loopback on an ephemeral port", () => {
    expect(srv.host).toBe("127.0.0.1");
    expect(srv.url).toBe(`http://127.0.0.1:${srv.port}/`);
  });

  it("routes the site's pages as HTML with a strict policy", async () => {
    for (const path of [
      "/",
      "/index.html",
      "/audits/2026-10-15/",
      "/audits/2026-10-15/index.html",
      "/audits/2026-10-15/pages/index.html",
      "/audits/2026-10-15/pages/accueil.html",
      "/audits/2026-10-15/evolution.html",
      "/audits/2026-10-15/journeys.html",
      "/audits/2026-10-15/components.html",
      "/audits/2026-10-15/files.html",
      "/audits/2026-09-01/index.html",
    ]) {
      const r = await raw(srv.port, path);
      expect(r.status, path).toBe(200);
      expect(r.type).toBe("text/html; charset=utf-8");
      expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(r.headers["x-content-type-options"]).toBe("nosniff");
      expect(r.body).toContain('<html lang="fr">');
    }
    // The first audit has nothing to compare with.
    expect((await raw(srv.port, "/audits/2026-09-01/evolution.html")).status).toBe(404);
  });

  it("shows the 106-criteria grid, the rates and the evolution", async () => {
    const dash = (await raw(srv.port, "/audits/2026-10-15/index.html")).body;
    expect(dash.match(/<th scope="row">RGAA \d+\.\d+ — /g)).toHaveLength(106);
    const evo = (await raw(srv.port, "/audits/2026-10-15/evolution.html")).body;
    expect(evo).toContain("Rouvert, à évaluer");
    expect(evo).toContain("+17 points");
    const sheet = (await raw(srv.port, "/audits/2026-10-15/pages/accueil.html")).body;
    expect(sheet).toContain('src="../../../files/pages/accueil/screen.png"');
  });

  it("serves raw files with their content type, and nothing else", async () => {
    const png = await raw(srv.port, "/files/pages/accueil/screen.png");
    expect(png.status).toBe(200);
    expect(png.type).toBe("image/png");
    const json = await raw(srv.port, "/files/audits/2026-09-01/audit-latest.json");
    expect(json.status).toBe(200);
    expect(json.type).toBe("application/json; charset=utf-8");
    expect((await raw(srv.port, "/files/components/src-button-Button.png")).type).toBe("image/png");
    expect((await raw(srv.port, "/files/components/index.json")).type).toBe("application/json; charset=utf-8");
    // No directory listing, no unknown mount, nothing outside the mounts.
    expect((await raw(srv.port, "/files/audits/2026-09-01/")).status).toBe(404);
    expect((await raw(srv.port, "/files/audits/2026-09-01")).status).toBe(404);
    expect((await raw(srv.port, "/files/etc/passwd")).status).toBe(404);
    expect((await raw(srv.port, "/package.json")).status).toBe(404);
  });

  it("refuses traversal in every spelling", async () => {
    for (const path of [
      "/files/audits/../../../package.json",
      "/files/audits/%2e%2e/%2e%2e/package.json",
      "/files/audits/..%2f..%2fpackage.json",
      "/files/audits/..%5c..%5cpackage.json",
    ]) {
      const r = await raw(srv.port, path);
      expect(r.status, path).toBe(400);
      expect(r.body).not.toContain('"name": "ultra11y"');
    }
  });

  it("refuses a link that escapes the audits directory", async () => {
    const s = await startServer({ auditsDir: join(escapeDir, "audits"), root: escapeDir, lang: "fr", port: 0 });
    try {
      expect((await raw(s.port, "/files/audits/leak.md")).status).toBe(404);
      expect((await raw(s.port, "/files/audits/audit-latest.json")).status).toBe(200);
    } finally {
      await s.close();
    }
  });

  it("is read-only, answers HEAD without a body, and refuses a foreign Host", async () => {
    const post = await raw(srv.port, "/", { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    const head = await raw(srv.port, "/", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.body).toBe("");
    expect((await raw(srv.port, "/", { host: "evil.example:80" })).status).toBe(403);
    expect((await raw(srv.port, "/", { host: `localhost:${srv.port}` })).status).toBe(200);
  });

  it("falls back to the next port when the requested one is busy", async () => {
    const other = await startServer({ auditsDir: AUDITS, root: FIX, lang: "en", port: srv.port, portTries: 5 });
    try {
      expect(other.port).toBeGreaterThan(srv.port);
      expect((await raw(other.port, "/")).body).toContain('<html lang="en">');
    } finally {
      await other.close();
    }
  });
});

/** Every href/src of an HTML page, fragments-only and data: URIs aside. */
function refs(html: string): string[] {
  return [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&")).filter((r) => !r.startsWith("#") && !r.startsWith("data:"));
}

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".html"))
    .map((f) => join(dir, f));
}

describe("the static export", () => {
  let out: string;
  beforeAll(() => {
    out = tmp();
    exportStatic({ auditsDir: AUDITS, root: FIX, lang: "fr", outDir: out });
  });
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("writes every page of the site and the files they show", () => {
    const site = buildSite({ auditsDir: AUDITS, root: FIX, lang: "fr" });
    for (const path of site.routes.keys()) expect(existsSync(join(out, path)), path).toBe(true);
    expect(statSync(join(out, "files", "pages", "accueil", "screen.png")).size).toBeGreaterThan(0);
    expect(existsSync(join(out, "files", "components", "src-button-Button.png"))).toBe(true);
    expect(existsSync(join(out, ".nojekyll"))).toBe(true);
  });

  it("links only relatively, and every link resolves inside the export", () => {
    const pages = htmlFiles(out);
    expect(pages.length).toBeGreaterThan(10);
    for (const page of pages) {
      const html = readFileSync(page, "utf8");
      for (const ref of refs(html)) {
        expect(ref, `${page}: ${ref}`).not.toMatch(/^[a-z][a-z0-9+.-]*:|^\/|^\/\//i);
        const target = resolve(dirname(page), decodeURIComponent(ref.split("#")[0]!));
        expect(target.startsWith(out), `${page}: ${ref}`).toBe(true);
        expect(existsSync(target), `${page}: ${ref} → ${target}`).toBe(true);
      }
    }
  });

  it("works from a sub-path: no link climbs above the export root", () => {
    for (const page of htmlFiles(out)) {
      const depth = posix.relative(out, page).split("/").length - 1;
      for (const ref of refs(readFileSync(page, "utf8"))) expect(ref.split("/").filter((s) => s === "..").length).toBeLessThanOrEqual(depth);
    }
  });

  it("refuses to export into, or around, the audits directory", () => {
    expect(() => exportStatic({ auditsDir: AUDITS, root: FIX, lang: "fr", outDir: join(AUDITS, "site") })).toThrow(/must not/);
    expect(() => exportStatic({ auditsDir: AUDITS, root: FIX, lang: "fr", outDir: FIX })).toThrow(/must not/);
  });

  it("every page passes the engine's own audit", () => {
    for (const page of htmlFiles(out)) {
      const html = readFileSync(page, "utf8");
      const found = findingsForStandard(runAudit({ inputs: ["-"], stdin: html }), "rgaa").filter((f) => !f.advisory);
      expect(
        found.map((f) => `${f.ruleId} ${f.selectorHint}`),
        page,
      ).toEqual([]);
    }
  });
});

describe("the serve command", () => {
  it("fails cleanly without audits", async () => {
    const dir = tmp();
    try {
      expect(await main(["serve", "--in", join(dir, "missing")])).toBe(2);
      expect(await main(["serve", "--in", dir])).toBe(2);
      expect(await main(["serve", "--in", AUDITS, "--port", "70000"])).toBe(2);
      expect(await main(["serve", "--in", AUDITS, "--static"])).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes the static export", async () => {
    const dir = tmp();
    try {
      expect(await main(["serve", "--in", AUDITS, "--root", FIX, "--static", join(dir, "site"), "--lang", "en"])).toBe(0);
      expect(readFileSync(join(dir, "site", "index.html"), "utf8")).toContain('<html lang="en">');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
