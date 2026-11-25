// Whole-application route coverage (src/routes.ts): every route of the inventory is either
// observed — captured by the E2E run, scanned, seen in source — or listed as not reached, with
// the reason. Never silently omitted. And the axe-core build that produced the axe verdicts is
// recorded with the captures and the scans, and named in the annex.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAudit } from "../src/audit.js";
import { main, stampRoutes } from "../src/cli.js";
import { renderReportDocuments } from "../src/report.js";
import { ALL_ROUTES_MAX, readRoutes, routeCoverage, routePath, routesToScan, writeRoutes } from "../src/routes.js";
import { combineDynamic, mergeDynamic } from "../src/scan.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import type { DynamicResult } from "../src/types.js";
import { unwrapAudit } from "../src/standards/document.js";

const DOM = (title: string) =>
  `<!DOCTYPE html><html lang="fr"><head><title>${title}</title></head><body><main><h1>${title}</h1><p>Texte.</p></main></body></html>`;
const ENGINE = { version: "4.13.0", origin: "ultra11y" as const, runner: "playwright" };

afterEach(() => vi.restoreAllMocks());

describe("routePath", () => {
  it("matches a route across hosts, trailing slashes and index files", () => {
    expect(routePath("https://prod.example/contact/")).toBe("/contact");
    expect(routePath("http://localhost:3000/contact")).toBe("/contact");
    expect(routePath("http://localhost:3000/index.html")).toBe("/");
    expect(routePath("https://x/")).toBe("/");
    expect(routePath("https://x/search?q=a")).toBe("/search?q=a");
  });
});

describe("routeCoverage", () => {
  const inventory = {
    v: 1 as const,
    routes: ["/", "/contact", "/tarifs", "/plan", "/secret", "/aide"].map((p) => ({ url: `https://prod.example${p}`, via: ["sitemap" as const] })),
  };

  it("labels every route — captured, scanned, source only, not reached — and omits none", () => {
    const rows = routeCoverage({
      inventory,
      sample: [
        { id: "accueil", url: "https://prod.example/" },
        { id: "aide", url: "https://prod.example/aide", sources: ["src/Aide.tsx"] },
      ],
      pages: [
        { id: "accueil", url: "http://localhost:3000/", runner: "playwright" },
        { id: "tarifs", url: "https://prod.example/tarifs", runner: "scan" },
        // The same route, captured by the E2E run AND scanned: the capture wins.
        { id: "contact-scan", url: "https://prod.example/contact", runner: "scan" },
        { id: "contact", url: "http://localhost:3000/contact/", runner: "playwright" },
      ],
      refused: [
        { id: "secret", name: "secret", requested: "https://prod.example/secret", landed: "https://prod.example/secret", reason: "http-status", status: 404 },
      ],
      bounded: ["https://prod.example/plan"],
      max: 3,
    });
    const by = Object.fromEntries(rows.map((r) => [r.path, r]));
    expect(rows).toHaveLength(6);
    expect(by["/"]).toMatchObject({ sample: true, observed: "captured", page: "accueil" });
    expect(by["/aide"]).toMatchObject({ sample: true, observed: "source" });
    expect(by["/contact"]).toMatchObject({ sample: false, observed: "captured", page: "contact" });
    expect(by["/tarifs"]).toMatchObject({ sample: false, observed: "scanned", page: "tarifs" });
    expect(by["/secret"]).toMatchObject({ observed: "not-reached", why: { reason: "http-status", detail: "404" } });
    expect(by["/plan"]).toMatchObject({ observed: "not-reached", why: { reason: "max-routes", detail: "3" } });
    // Sample routes come first.
    expect(rows.slice(0, 2).every((r) => r.sample)).toBe(true);
  });

  it("adds a recorded page the inventory never listed, rather than losing it", () => {
    const rows = routeCoverage({ inventory: { v: 1, routes: [] }, pages: [{ id: "modale", url: "http://localhost/compte?modal=1", runner: "playwright" }] });
    expect(rows).toEqual([{ path: "/compte?modal=1", url: "http://localhost/compte?modal=1", sample: false, observed: "captured", page: "modale" }]);
  });
});

describe("routesToScan (scan --all-routes)", () => {
  const inventory = { v: 1 as const, routes: Array.from({ length: 8 }, (_, i) => ({ url: `https://x/p${i}`, via: ["crawl" as const] })) };

  it("skips the sample and the E2E captures, and bounds the rest by max", () => {
    const plan = routesToScan(inventory, {
      sample: [{ url: "https://x/p0" }],
      captured: [
        { id: "p1", url: "http://localhost/p1", runner: "playwright" },
        // A page ultra11y's own scan recorded is not a capture: it is rescanned.
        { id: "p2", url: "https://x/p2", runner: "scan" },
      ],
      max: 3,
    });
    expect(plan.captured).toEqual(["https://x/p1"]);
    expect(plan.scan).toEqual(["https://x/p2", "https://x/p3", "https://x/p4"]);
    expect(plan.bounded).toEqual(["https://x/p5", "https://x/p6", "https://x/p7"]);
  });

  it("has a sane default bound", () => {
    expect(ALL_ROUTES_MAX).toBe(50);
    const big = { v: 1 as const, routes: Array.from({ length: 70 }, (_, i) => ({ url: `https://x/r${i}`, via: ["crawl" as const] })) };
    const plan = routesToScan(big, {});
    expect(plan.scan).toHaveLength(50);
    expect(plan.bounded).toHaveLength(20);
  });
});

describe("the route inventory file", () => {
  it("unions discoveries by path and keeps every source", () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-routes-"));
    expect(writeRoutes(root, ["https://prod.example/", "https://prod.example/a"], "sitemap")).toMatchObject({ added: 2, total: 2 });
    expect(writeRoutes(root, ["http://localhost:3000/a/", "http://localhost:3000/b"], "snapshots")).toMatchObject({ added: 1, total: 3 });
    const inv = readRoutes(root)!;
    expect(inv.routes.map((r) => routePath(r.url))).toEqual(["/", "/a", "/b"]);
    expect(inv.routes.find((r) => routePath(r.url) === "/a")?.via).toEqual(["sitemap", "snapshots"]);
  });
});

describe("the annex lists every route and the axe-core that ran", () => {
  it("from `audit` over captures + an inventory, end to end", async () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-annex-"));
    for (const [id, url, runner] of [
      ["accueil", "http://localhost:3000/", "playwright"],
      ["tarifs", "http://localhost:3000/tarifs", "scan"],
    ] as const) {
      writeSnapshot(root, {
        meta: { v: SNAPSHOT_VERSION, id, name: id, url, runner },
        dom: DOM(id),
        axe: { ran: true, violations: [], engine: { ...ENGINE, runner } },
      });
    }
    writeRoutes(root, ["https://prod.example/", "https://prod.example/tarifs", "https://prod.example/contact", "https://prod.example/plan"], "sitemap");

    const cwd = process.cwd();
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    let code: number;
    try {
      process.chdir(root);
      code = await main(["audit", PAGES_DIR, "--json"]);
    } finally {
      process.chdir(cwd);
    }
    expect(code).toBe(0);
    const audit = unwrapAudit(JSON.parse(out.join("\n")));
    expect(audit.scope.axe).toEqual([{ version: "4.13.0", origin: "ultra11y", runner: "playwright,scan" }]);
    const obs = Object.fromEntries(audit.scope.routes.map((r: { path: string; observed: string }) => [r.path, r.observed]));
    expect(obs).toEqual({ "/": "captured", "/tarifs": "scanned", "/contact": "not-reached", "/plan": "not-reached" });

    const { annex } = renderReportDocuments(audit, "en");
    expect(annex).toContain("**axe-core engine** : `axe-core@4.13.0` (ultra11y's pinned copy ; playwright, scan)");
    // `check` reads "<x.y.z> —" as a cited criterion: the version must never be written that way.
    expect(annex).not.toMatch(/4\.13\.0\s*—/);
    expect(annex).toContain("## F. Application routes — coverage");
    expect(annex).toMatch(/\| `\/contact` \| beyond the sample \| not reached \|/);
    expect(annex).toMatch(/\| `\/` \| beyond the sample \| captured \(E2E tests\) \| `accueil` \|/);
    expect(annex).toContain("2 route(s) not reached");
    const fr = renderReportDocuments(audit, "fr").annex;
    expect(fr).toContain("## F. Routes de l'application — couverture");
    expect(fr).toContain("non atteinte");
  });

  it("claims no route captured or scanned when the audit left the snapshots out (--no-captures)", async () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-nocapt-"));
    for (const [id, url, runner] of [
      ["accueil", "http://localhost:3000/", "playwright"],
      ["tarifs", "http://localhost:3000/tarifs", "scan"],
    ] as const) {
      writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id, name: id, url, runner }, dom: DOM(id), axe: { ran: true, violations: [], engine: ENGINE } });
    }
    writeFileSync(join(root, "index.html"), DOM("source"));
    writeRoutes(root, ["https://prod.example/", "https://prod.example/tarifs"], "sitemap");

    const cwd = process.cwd();
    const out: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation(() => {});
    let code: number;
    try {
      process.chdir(root);
      code = await main(["audit", "index.html", "--no-captures", "--json"]);
    } finally {
      process.chdir(cwd);
    }
    expect(code).toBe(0);
    const audit = JSON.parse(out.join("\n"));
    const obs = Object.fromEntries(audit.scope.routes.map((r: { path: string; observed: string }) => [r.path, r.observed]));
    // The snapshots are on disk, but nothing in THIS audit measured them.
    expect(obs).toEqual({ "/": "not-reached", "/tarifs": "not-reached" });
  });

  it("stampRoutes: skips the recorded pages on request, and labels the URLs a run scanned without snapshotting", () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-stamp-"));
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: "accueil", name: "accueil", url: "http://localhost:3000/", runner: "playwright" },
      dom: DOM("accueil"),
      axe: { ran: true, violations: [], engine: ENGINE },
    });
    writeRoutes(root, ["https://prod.example/", "https://prod.example/aide", "https://prod.example/plan"], "sitemap");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = () => runAudit({ inputs: [join(import.meta.dirname, "fixtures", "non-conforming", "bad.html")] });
    const obs = (r: ReturnType<typeof runAudit>) => Object.fromEntries(r.scope.routes!.map((x) => [x.path, [x.observed, x.page]]));

    const all = fixture();
    stampRoutes(all, root, "en");
    expect(obs(all)).toEqual({ "/": ["captured", "accueil"], "/aide": ["not-reached", undefined], "/plan": ["not-reached", undefined] });

    const skipped = fixture();
    stampRoutes(skipped, root, "en", { recorded: false });
    expect(obs(skipped)).toEqual({ "/": ["not-reached", undefined], "/aide": ["not-reached", undefined], "/plan": ["not-reached", undefined] });

    const scanned = fixture();
    stampRoutes(scanned, root, "en", { recorded: false, scanned: ["http://127.0.0.1:4000/aide"] });
    // Scanned, but with no page id: no snapshot was written for it.
    expect(obs(scanned)).toEqual({ "/": ["not-reached", undefined], "/aide": ["scanned", undefined], "/plan": ["not-reached", undefined] });
  });

  it("leaves an audit with no inventory unchanged", () => {
    const r = runAudit({ inputs: [join(import.meta.dirname, "fixtures", "non-conforming", "bad.html")] });
    expect(r.scope.routes).toBeUndefined();
    expect(renderReportDocuments(r, "en").annex).not.toContain("Application routes");
  });

  it("names the bound in the reason of a route --max-routes left out", () => {
    const r = runAudit({ inputs: [join(import.meta.dirname, "fixtures", "non-conforming", "bad.html")] });
    r.scope.routes = routeCoverage({ inventory: { v: 1, routes: [{ url: "https://x/far", via: ["crawl"] }] }, bounded: ["https://x/far"], max: 10 });
    expect(renderReportDocuments(r, "fr").annex).toContain("au-delà de --max-routes 10");
  });
});

describe("the scan's axe-core reaches the audit", () => {
  const dyn = (over: Partial<DynamicResult>): DynamicResult => ({ tool: "ultra11y", engine: "local", target: "t", date: "2026-01-01", findings: [], ...over });

  it("mergeDynamic records the version the scan injected", () => {
    const base = runAudit({ inputs: [join(import.meta.dirname, "fixtures", "non-conforming", "bad.html")] });
    const merged = mergeDynamic(base, dyn({ axe: { version: "4.13.0", origin: "ultra11y", runner: "scan" } }));
    expect(merged.scope.axe).toEqual([{ version: "4.13.0", origin: "ultra11y", runner: "scan" }]);
  });

  it("an --all-routes run keeps the declared sample as the sample, and adds the rest as pages", () => {
    const sample = dyn({
      sample: { pages: [{ id: "a", name: "A", url: "https://x/a" }] },
      snapshots: ["a"],
      axe: { version: "4.13.0", origin: "ultra11y", runner: "scan" },
    });
    const rest = dyn({ snapshots: ["b"], redirected: [{ id: "c", name: "c", requested: "https://x/c", landed: "https://x/c", reason: "error" }] });
    const both = combineDynamic(sample, rest);
    expect(both.sample?.pages.map((p) => p.id)).toEqual(["a"]);
    expect(both.snapshots).toEqual(["a", "b"]);
    expect(both.redirected?.map((r) => r.id)).toEqual(["c"]);
    expect(both.axe?.version).toBe("4.13.0");
  });

  it("the capture's axe.json carries the engine as written", () => {
    const root = mkdtempSync(join(tmpdir(), "u11y-axejson-"));
    writeSnapshot(root, {
      meta: { v: SNAPSHOT_VERSION, id: "p", name: "p", url: "https://x/p" },
      dom: DOM("p"),
      axe: { ran: true, violations: [], engine: ENGINE },
    });
    expect(JSON.parse(readFileSync(join(root, PAGES_DIR, "p", "axe.json"), "utf8")).engine).toEqual(ENGINE);
  });
});
