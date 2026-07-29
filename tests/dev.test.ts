import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { parse } from "@babel/parser";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditCollected, dashboardHtml, nextOverlayComponent, overlayJs, projectPages, startDevServer, type DevServer } from "../src/dev.js";
import { PAGES_DIR } from "../src/snapshot.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-dev-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const PAGE = {
  meta: { v: 1, id: "accueil", name: "Accueil", url: "https://x/" },
  dom: "<!doctype html><html><head></head><body><img src=a.png></body></html>",
};

describe("the injected overlay", () => {
  const src = overlayJs();

  it("is valid browser JavaScript (parsed, never executed here)", () => {
    expect(() => parse(src, { sourceType: "script" })).not.toThrow();
  });

  it("renders inside a shadow root, so the app's CSS cannot reach it and its own cannot leak", () => {
    expect(src).toContain("attachShadow");
  });

  it("REMOVES itself from the document before collecting — otherwise it audits itself", () => {
    // This is the whole reason the overlay is safe: its presence would also shift every
    // document-order index by one and break the styles/DOM join.
    expect(src).toContain("removeChild(host)");
    expect(src).toContain("appendChild(host)");
  });

  it("re-checks on client-side navigation, not just the first paint", () => {
    expect(src).toContain("pushState");
    expect(src).toContain("popstate");
  });

  it("links a finding to its source, preferring the component over the snapshot file", () => {
    expect(src).toContain("__nextjs_launch-editor");
    expect(src).toContain("origin.sourceFile");
  });

  it("says the side-car is down rather than failing silently", () => {
    expect(src).toMatch(/unreachable/i);
  });
});

describe("the Next component", () => {
  const src = nextOverlayComponent(4111);

  it("is a valid client component", () => {
    expect(() => parse(src, { sourceType: "module", plugins: ["jsx"] })).not.toThrow();
    expect(src.startsWith('"use client"')).toBe(true);
  });

  it("renders nothing outside development, so shipping it is inert", () => {
    expect(src).toContain('process.env.NODE_ENV !== "development"');
    expect(src).toContain("return null");
  });

  it("points at the port it was generated for", () => {
    expect(nextOverlayComponent(5000)).toContain("127.0.0.1:5000");
  });
});

describe("auditing a collected page", () => {
  it("persists a snapshot and returns its audit", () => {
    const r = auditCollected(root, PAGE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.findings.map((f) => f.ruleId)).toContain("img-alt-missing");
    expect(existsSync(join(root, PAGES_DIR, "accueil", "dom.html"))).toBe(true);
  });

  it("refuses an invalid payload with a reason instead of writing rubbish", () => {
    const bad = auditCollected(root, { meta: { v: 1, id: "../escape", name: "x", url: "y" }, dom: "<html></html>" });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error).toContain("meta.id");
  });

  it("refuses a payload with no DOM", () => {
    expect(auditCollected(root, { meta: PAGE.meta, dom: "" }).ok).toBe(false);
  });
});

describe("the project view", () => {
  it("is empty before anything has been visited", () => {
    expect(projectPages(root)).toEqual({ result: null, pages: [] });
  });

  it("accumulates every visited page", () => {
    auditCollected(root, PAGE);
    auditCollected(root, {
      meta: { v: 1, id: "contact", name: "Contact", url: "https://x/contact" },
      dom: '<!doctype html><html lang="fr"><head><title>C</title></head><body><main><h1>C</h1></main></body></html>',
    });
    const { pages } = projectPages(root);
    expect(pages.map((p) => p.id).sort()).toEqual(["accueil", "contact"]);
    expect(pages.find((p) => p.id === "contact")?.conformancePct).toBe(100);
  });
});

describe("the dashboard", () => {
  it("explains what to do when nothing has been captured, rather than showing an empty table", () => {
    const html = dashboardHtml(null, [], "wcag", "en");
    expect(html).toMatch(/no page captured/i);
    expect(html).toContain("overlay");
  });

  it("is a self-contained page — no external stylesheet or script to fetch", () => {
    auditCollected(root, PAGE);
    const { result, pages } = projectPages(root);
    const html = dashboardHtml(result, pages, "rgaa", "fr");
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/https?:\/\/[^"]*\.(css|js)/);
    expect(html).toContain("<style>");
  });

  it("shows one column per page and the RGAA criteria as rows", () => {
    auditCollected(root, PAGE);
    const { result, pages } = projectPages(root);
    const html = dashboardHtml(result, pages, "rgaa", "fr");
    expect(html).toContain("Accueil");
    expect(html).toContain("RGAA");
    expect(html).toContain("Images"); // RGAA theme 1
  });

  it("escapes page names, so a page title cannot inject markup into the dashboard", () => {
    auditCollected(root, { meta: { v: 1, id: "x", name: '<img src=x onerror="alert(1)">', url: "https://x/" }, dom: "<html><body></body></html>" });
    const { result, pages } = projectPages(root);
    const html = dashboardHtml(result, pages, "wcag", "en");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img");
  });
});

describe("the side-car server", () => {
  let server: DevServer;
  afterEach(async () => {
    await server?.close();
  });

  const start = async () => {
    server = await startDevServer({ root, port: 0, standard: "wcag", lang: "en" });
    return `http://127.0.0.1:${server.port}`;
  };

  it("serves the overlay script", async () => {
    const base = await start();
    const res = await fetch(`${base}/overlay.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toContain("attachShadow");
  });

  it("audits a posted page and returns its findings", async () => {
    const base = await start();
    const res = await fetch(`${base}/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(PAGE) });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { findings: { ruleId: string }[] };
    expect(json.findings.map((f) => f.ruleId)).toContain("img-alt-missing");
  });

  it("answers 400 with a reason for a bad payload, never 500", async () => {
    const base = await start();
    const res = await fetch(`${base}/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: "{ not json" });
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toHaveProperty("error");
  });

  it("serves the dashboard", async () => {
    const base = await start();
    await fetch(`${base}/snapshot`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(PAGE) });
    const html = await (await fetch(base)).text();
    expect(html).toContain("Accueil");
  });

  it("sends CORS headers — the app runs on another port", async () => {
    const base = await start();
    expect((await fetch(`${base}/overlay.js`)).headers.get("access-control-allow-origin")).toBe("*");
    expect((await fetch(base, { method: "OPTIONS" })).status).toBe(204);
  });

  it("404s an unknown path instead of leaking anything", async () => {
    const base = await start();
    expect((await fetch(`${base}/../../etc/passwd`)).status).toBe(404);
  });
});
