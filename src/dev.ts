// `dev` — the development side-car: see accessibility defects on the page you are building,
// while you build it, and a dashboard of the whole project's RGAA grid.
//
// Two halves, deliberately separate:
//   • this Node server (node:http, a builtin — the zero-dependency promise holds). It receives
//     collected pages from the browser, writes them as snapshots, audits them, and serves the
//     dashboard.
//   • an OVERLAY injected into the app in dev. It is framework-agnostic vanilla JS: the Next
//     component below is a four-line wrapper around it, and the same overlay would serve Vite
//     or anything else.
//
// SECURITY. The server writes files and returns audit results, so it binds to 127.0.0.1 only
// — never 0.0.0.0. It is a development tool and must not be reachable from the network. CORS
// is permissive on purpose (the app runs on a different port) but the loopback bind is what
// actually contains it.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { runAudit } from "./audit.js";
import { resolveMessage } from "./messages.js";
import { packCriteriaForFinding } from "./standards/derive.js";
import { attributePages, derivePages, pageScopesFrom } from "./pages.js";
import { readSnapshots, validateSnapshotMeta, writeSnapshot, type AxNode, type BoxDigest, type CssDigest, type StyleDigest } from "./snapshot.js";
import { CORE, type StandardId, isCore, loadPack, themeName } from "./standards/index.js";
import { derivePackResults } from "./standards/index.js";
import type { AuditResult, Finding, Lang, PageResult, Status } from "./types.js";
import { COLLECT_SNAPSHOT } from "./snapshot.js";

export const DEV_DEFAULT_PORT = 4111;

/** The criterion label to show in the terminal: the pack's own id when projected. */
function criterionLabel(f: Finding, standard: StandardId): string {
  if (isCore(standard)) return `WCAG ${f.criteriaId}`;
  const pack = loadPack(standard);
  const ids = packCriteriaForFinding(pack, f);
  return ids.length ? `${pack.name} ${ids.join(", ")}` : `WCAG ${f.criteriaId}`;
}

// ---- the browser overlay ------------------------------------------------------------------

// Injected into the app in DEV ONLY. It renders inside a shadow root so the app's CSS cannot
// reach it and its own CSS cannot leak.
//
// The subtle part: the overlay is DOM, and the collector serializes DOM. Left in place it
// would be captured, audited, and would report non-conformities about ITSELF — and, worse,
// its element would shift every document-order index by one, breaking the join between the
// styles digest and the DOM. So the host is REMOVED from the document for the duration of the
// collection and re-attached immediately after. That keeps `querySelectorAll` and
// `documentElement.outerHTML` in perfect agreement, which is what the whole signal join rests
// on.
export function overlayJs(): string {
  return `(() => {
  const ENDPOINT = window.__ULTRA11Y_ENDPOINT__ || "http://127.0.0.1:${DEV_DEFAULT_PORT}";
  const HOST_ID = "__ultra11y_overlay";
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = \`
    :host { all: initial; }
    .bar { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
    button.fab { border: 0; border-radius: 999px; padding: 10px 14px; cursor: pointer;
      background: #1c1c1e; color: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.35); }
    button.fab[data-state="ok"] { background: #0a7d33; }
    button.fab[data-state="bad"] { background: #b3261e; }
    .panel { position: fixed; right: 16px; bottom: 64px; width: min(460px, calc(100vw - 32px));
      max-height: min(60vh, 560px); overflow: auto; background: #fff; color: #111;
      border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.28); padding: 12px 14px; }
    @media (prefers-color-scheme: dark) { .panel { background: #1c1c1e; color: #f2f2f7; } }
    h2 { font-size: 13px; margin: 0 0 8px; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { padding: 7px 0; border-top: 1px solid rgba(127,127,127,.25); }
    .sev { font-weight: 700; margin-right: 6px; }
    .b { color: #b3261e; } .m { color: #b06000; } .n { color: #666; }
    a { color: inherit; }
    code { font: 11px/1.4 ui-monospace, monospace; opacity: .8; }
    .empty { opacity: .75; }
  \`;
  const root = document.createElement("div");
  root.className = "bar";
  const fab = document.createElement("button");
  fab.className = "fab";
  fab.type = "button";
  fab.textContent = "a11y …";
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;
  root.append(fab, panel);
  shadow.append(style, root);
  document.body.appendChild(host);

  fab.addEventListener("click", () => { panel.hidden = !panel.hidden; });

  const SEV = { bloquant: ["b", "BLOQUANT"], majeur: ["m", "MAJEUR"], mineur: ["n", "mineur"] };

  function render(findings, error) {
    if (error) {
      fab.textContent = "a11y ?";
      fab.dataset.state = "";
      panel.innerHTML = "<h2>ultra11y</h2><p class='empty'>" + String(error) + "</p>";
      return;
    }
    const nc = findings.filter((f) => !f.advisory);
    fab.textContent = nc.length ? "a11y " + nc.length : "a11y ✓";
    fab.dataset.state = nc.length ? "bad" : "ok";
    if (!findings.length) {
      panel.innerHTML = "<h2>ultra11y</h2><p class='empty'>No non-conformity detected on this page by the static engine. The judgment criteria remain yours.</p>";
      return;
    }
    const h = document.createElement("h2");
    h.textContent = "ultra11y — " + nc.length + " non-conformity(ies) on this page";
    const ul = document.createElement("ul");
    for (const f of findings.slice(0, 60)) {
      const li = document.createElement("li");
      const s = SEV[f.severity] || ["n", f.severity];
      const sev = document.createElement("span");
      sev.className = "sev " + s[0];
      sev.textContent = f.advisory ? "reco" : s[1];
      li.append(sev, document.createTextNode(f.message));
      const where = (f.origin && f.origin.sourceFile) || f.file;
      const line = (f.origin && f.origin.sourceLine) || f.line || 1;
      if (where && !/^https?:/.test(where)) {
        const a = document.createElement("a");
        // Next exposes this endpoint in dev; it opens the file in the configured editor.
        a.href = "/__nextjs_launch-editor?file=" + encodeURIComponent(where + ":" + line + ":1");
        a.textContent = where + ":" + line;
        a.addEventListener("click", (e) => { e.preventDefault(); fetch(a.href).catch(() => {}); });
        const code = document.createElement("code");
        code.append(document.createElement("br"), a);
        li.append(code);
      }
      ul.append(li);
    }
    panel.replaceChildren(h, ul);
  }

  let busy = false;
  async function check() {
    if (busy) return;
    busy = true;
    fab.textContent = "a11y …";
    // Detach the overlay so it is neither serialized nor counted: its presence would shift
    // every document-order index by one and break the styles/DOM join.
    const parent = host.parentNode;
    if (parent) parent.removeChild(host);
    let collected;
    try {
      collected = (0, eval)(${JSON.stringify(COLLECT_SNAPSHOT)});
    } finally {
      if (parent) parent.appendChild(host);
      busy = false;
    }
    try {
      const res = await fetch(ENDPOINT + "/snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meta: { v: 1, id: slug(location.pathname), name: document.title || location.pathname, url: location.href, runner: "dev" },
          dom: collected.dom, styles: collected.styles, boxes: collected.boxes, css: collected.css,
        }),
      });
      const json = await res.json();
      render(json.findings || [], json.error);
    } catch (e) {
      render([], "ultra11y dev server unreachable at " + ENDPOINT + " — run \`ultra11y dev\`.");
    }
  }

  function slug(path) {
    const s = path.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || (path === "/" ? "accueil" : "page");
  }

  // Re-check on client-side navigation: patch the history methods a router uses, plus back/forward.
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(check, 400); };
  for (const m of ["pushState", "replaceState"]) {
    const orig = history[m];
    history[m] = function () { const r = orig.apply(this, arguments); schedule(); return r; };
  }
  addEventListener("popstate", schedule);
  schedule();
})();`;
}

/** The Next component written by `dev --next`. A four-line wrapper: dev-gated, client-side,
 *  and it renders nothing. Deliberately a component the user imports rather than a bundler
 *  hack — that keeps it working across Next versions and under Turbopack, where custom
 *  webpack configuration does not exist. */
export function nextOverlayComponent(port: number): string {
  return `"use client";
// ultra11y dev overlay for Next.js. Generated by \`ultra11y dev --next\`.
//
//   // app/layout.tsx
//   import { Ultra11yOverlay } from "../.ultra11y/next/overlay";
//   …
//   <body>{children}<Ultra11yOverlay /></body>
//
// Renders NOTHING in production: the whole component short-circuits on NODE_ENV, so shipping
// it is inert. Start the side-car with \`ultra11y dev\` for it to have anything to talk to.
import { useEffect } from "react";

export function Ultra11yOverlay({ endpoint = "http://127.0.0.1:${port}" }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (document.getElementById("__ultra11y_overlay_script")) return;
    window.__ULTRA11Y_ENDPOINT__ = endpoint;
    const s = document.createElement("script");
    s.id = "__ultra11y_overlay_script";
    s.src = endpoint + "/overlay.js";
    document.body.appendChild(s);
  }, [endpoint]);
  return null;
}

export default Ultra11yOverlay;
`;
}

// ---- the dashboard -------------------------------------------------------------------------

const MARK: Record<Status, string> = { C: "C", NC: "NC", NA: "—", manual: "?" };
const CLASS: Record<Status, string> = { C: "c", NC: "nc", NA: "na", manual: "m" };

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The per-page grid as a self-contained HTML page (no external asset, light and dark). */
export function dashboardHtml(result: AuditResult | null, pages: PageResult[], standard: StandardId, lang: Lang): string {
  const fr = lang === "fr";
  const stdLabel = isCore(standard) ? "WCAG 2.2 AA" : loadPack(standard).name;
  const head = `<!doctype html><html lang="${fr ? "fr" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ultra11y — ${esc(stdLabel)}</title>
<style>
 :root { color-scheme: light dark; --bg:#fff; --fg:#111; --line:#e3e3e6; --mut:#666; }
 @media (prefers-color-scheme: dark) { :root { --bg:#141416; --fg:#f2f2f7; --line:#2c2c2e; --mut:#a1a1a6; } }
 body { margin:0; padding:24px; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif,system-ui,sans-serif; }
 h1 { font-size:18px; margin:0 0 4px; } p.sub { color:var(--mut); margin:0 0 20px; }
 table { border-collapse:collapse; width:100%; } th,td { padding:5px 8px; border-bottom:1px solid var(--line); text-align:left; }
 th { position:sticky; top:0; background:var(--bg); }
 td.c,td.nc,td.na,td.m { text-align:center; font-weight:600; width:80px; }
 td.c{color:#0a7d33} td.nc{color:#b3261e} td.na{color:var(--mut)} td.m{color:#b06000}
 tr.theme td { font-weight:700; background:color-mix(in srgb, var(--fg) 6%, transparent); }
 .rate { font-size:22px; font-weight:700; }
 .empty { color:var(--mut); max-width:60ch; }
 code { font:12px ui-monospace,monospace; color:var(--mut); }
</style></head><body>`;

  if (!result || !pages.length) {
    return `${head}<h1>ultra11y</h1>
<p class="empty">${
      fr
        ? "Aucune page capturée pour l'instant. Ouvrez votre application avec l'overlay actif : chaque page visitée apparaîtra ici."
        : "No page captured yet. Open your app with the overlay active: every page you visit shows up here."
    }</p></body></html>`;
  }

  const rows: { id: string; label: string; group: string }[] = [];
  const status = new Map<string, Map<string, Status>>();
  if (isCore(standard)) {
    for (const c of result.criteria) rows.push({ id: c.id, label: c.id, group: c.guideline });
    for (const p of pages) for (const c of p.criteria) (status.get(c.id) ?? status.set(c.id, new Map()).get(c.id)!).set(p.id, c.status);
  } else {
    const pack = loadPack(standard);
    for (const pc of pack.criteria) rows.push({ id: pc.id, label: pc.id, group: `${pc.theme}. ${themeName(pack, pc.theme, lang) ?? ""}` });
    for (const p of pages) {
      const view = { ...result, criteria: p.criteria, findings: p.findings } as AuditResult;
      for (const pc of derivePackResults(view, standard)) (status.get(pc.id) ?? status.set(pc.id, new Map()).get(pc.id)!).set(p.id, pc.status);
    }
  }

  const out: string[] = [head];
  out.push(`<h1>ultra11y — ${esc(stdLabel)}</h1>`);
  out.push(`<p class="sub">${pages.length} ${fr ? "page(s) capturée(s)" : "page(s) captured"} · <code>${esc(result.date)}</code></p>`);
  out.push("<table><thead><tr><th></th>");
  for (const p of pages) out.push(`<th>${esc(p.name)}${p.auth ? " 🔒" : ""}<br><code>${esc(p.url)}</code></th>`);
  out.push("</tr></thead><tbody>");
  out.push(`<tr><td>${fr ? "Taux" : "Rate"}</td>${pages.map((p) => `<td class="rate">${p.conformancePct}%</td>`).join("")}</tr>`);
  let group = "";
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      out.push(`<tr class="theme"><td colspan="${pages.length + 1}">${esc(group)}</td></tr>`);
    }
    const cells = pages.map((p) => {
      const s = status.get(row.id)?.get(p.id) ?? "manual";
      return `<td class="${CLASS[s]}">${MARK[s]}</td>`;
    });
    out.push(`<tr><td>${esc(row.label)}</td>${cells.join("")}</tr>`);
  }
  out.push("</tbody></table></body></html>");
  return out.join("\n");
}

// ---- the server -----------------------------------------------------------------------------

export interface DevOptions {
  root: string;
  port: number;
  standard: StandardId;
  lang: Lang;
  onLog?: (msg: string) => void;
}

function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "POST, GET, OPTIONS");
}

async function readBody(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = c as Buffer;
    size += buf.length;
    if (size > limit) throw new Error("payload too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Audit one collected page: persist it as a snapshot, then run the engine over its DOM. */
export function auditCollected(
  root: string,
  payload: { meta?: unknown; dom?: unknown; styles?: StyleDigest; boxes?: BoxDigest; axtree?: AxNode; css?: CssDigest },
): { ok: true; result: AuditResult } | { ok: false; error: string } {
  const v = validateSnapshotMeta(payload.meta);
  if (!v.ok || !v.meta) return { ok: false, error: v.issues.map((i) => `${i.path}: ${i.message}`).join("; ") };
  if (typeof payload.dom !== "string" || !payload.dom.trim()) return { ok: false, error: "dom is required" };
  const dir = writeSnapshot(root, {
    meta: v.meta,
    dom: payload.dom,
    ...(payload.styles ? { styles: payload.styles } : {}),
    ...(payload.boxes ? { boxes: payload.boxes } : {}),
    ...(payload.axtree ? { axtree: payload.axtree } : {}),
    ...(payload.css ? { css: payload.css } : {}),
  });
  return { ok: true, result: runAudit({ inputs: [join(dir, "dom.html")] }) };
}

/** The whole project's per-page view, rebuilt from the snapshots on disk. */
export function projectPages(root: string): { result: AuditResult | null; pages: PageResult[] } {
  const snaps = readSnapshots(root);
  if (!snaps.length) return { result: null, pages: [] };
  const scope = pageScopesFrom(snaps);
  const result = runAudit({ inputs: [join(root, ".ultra11y/pages")] });
  result.scope.pages = scope;
  attributePages(result, scope);
  return { result, pages: derivePages(result, scope) };
}

export interface DevServer {
  port: number;
  close(): Promise<void>;
}

/** Start the side-car. Binds to LOOPBACK ONLY — it writes files and returns audits, so it must
 *  never be reachable from the network. */
export function startDevServer(opts: DevOptions): Promise<DevServer> {
  const log = opts.onLog ?? (() => {});
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    cors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/overlay.js") {
      res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" }).end(overlayJs());
      return;
    }
    if (url.pathname === "/snapshot" && req.method === "POST") {
      void (async () => {
        try {
          const body = await readBody(req);
          const payload = JSON.parse(body) as Parameters<typeof auditCollected>[1];
          const r = auditCollected(opts.root, payload);
          if (!r.ok) {
            res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: r.error }));
            return;
          }
          const nc = r.result.findings.filter((f) => !f.advisory);
          const name = (payload.meta as { name?: string } | undefined)?.name ?? "page";
          log(opts.lang === "fr" ? `ultra11y dev : ${name} — ${nc.length} non-conformité(s)` : `ultra11y dev: ${name} — ${nc.length} non-conformity(ies)`);
          // A readable terminal line, NOT the workflow-command form: that one is
          // percent-escaped for GitHub's parser and reads as noise in a shell.
          for (const f of nc.slice(0, 20)) {
            const where = f.origin?.sourceFile ?? f.file;
            log(
              `  ${f.severity} ${criterionLabel(f, opts.standard)} · ${where}:${Math.max(1, f.origin?.sourceLine ?? f.line)} — ${resolveMessage(f, opts.lang)}`,
            );
          }
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ findings: r.result.findings }));
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      })();
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const { result, pages } = projectPages(opts.root);
      res
        .writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
        .end(dashboardHtml(result, pages, opts.standard, opts.lang));
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1, never 0.0.0.0 — see the security note at the top of this file.
    server.listen(opts.port, "127.0.0.1", () => {
      resolve({
        port: (server.address() as { port: number }).port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

export { CORE };
