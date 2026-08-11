// The service worker — everything that talks to the local engine.
//
// WHY IT IS HERE AND NOT IN THE PAGE. A content script runs in the audited page's origin, so
// its `fetch` to 127.0.0.1 would be a cross-origin request subject to that page's CSP: on a
// site with a strict `connect-src` the extension would simply stop working, for reasons the
// user cannot see. The service worker has the extension's own origin and the loopback host
// permission, so it is the only reliable place to make the call.
//
// WHAT LEAVES THE BROWSER. The serialized DOM of the page you explicitly asked to audit, to a
// process on YOUR machine that YOU started (`ultra11y dev`). Nothing else, nowhere else — the
// manifest's host permissions are loopback only, so the extension is incapable of sending it
// anywhere but there.

const DEFAULTS = { port: 4111, standard: "wcag", lang: "auto", apiKey: "" };

export async function settings() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

function endpoint(port) {
  return `http://127.0.0.1:${port}`;
}

/** Is the side-car up? Returns its identity, or an error the popup can act on. */
async function health(port) {
  try {
    const res = await fetch(`${endpoint(port)}/health`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, ...(await res.json()) };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

/** The engine's own collector, fetched rather than copied. A second implementation of the
 *  snapshot format living in an extension is how the two drift. */
async function collector(port) {
  const res = await fetch(`${endpoint(port)}/collector.js`, { cache: "no-store" });
  if (!res.ok) throw new Error(`collector unavailable (HTTP ${res.status})`);
  const src = await res.text();
  // The endpoint serves `window.__ULTRA11Y_COLLECT__ = "<expression>";` — take the string.
  const m = /^window\.__ULTRA11Y_COLLECT__\s*=\s*([\s\S]*);\s*$/.exec(src);
  if (!m) throw new Error("collector payload not recognized");
  return JSON.parse(m[1]);
}

/** Slug rule mirrored from the engine (src/snapshot.ts slugifyPageId), percent-decode first. */
function slugify(url) {
  let path = url;
  try {
    path = new URL(url).pathname;
    try {
      path = decodeURIComponent(path);
    } catch {}
  } catch {}
  const slug = path
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || (path === "/" || path === "" ? "accueil" : "page");
}

/** Collect the active tab and hand it to the engine, which persists and audits it. */
async function audit(tab) {
  const cfg = await settings();
  const up = await health(cfg.port);
  if (!up.ok) return { error: "server-down", port: cfg.port };

  const expr = await collector(cfg.port);
  const [{ result: collected } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN", // the page's own realm: an isolated world sees the DOM but not its CSSOM the same way
    args: [expr],
    func: (src) => {
      // biome-ignore lint: the engine's collector, evaluated in the page it describes
      return (0, eval)(src);
    },
  });
  if (!collected?.dom) return { error: "collect-failed" };

  // A viewport screenshot feeds the pixel tier — contrast over a gradient or an image, where
  // no CSSOM analysis can answer. Optional: a failure costs that one criterion, never the audit.
  let screenshot;
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    screenshot = dataUrl.slice(dataUrl.indexOf(",") + 1);
  } catch {}

  const url = collected.url || tab.url;
  const res = await fetch(`${endpoint(cfg.port)}/snapshot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      meta: {
        v: 1,
        id: slugify(url),
        name: collected.title || tab.title || slugify(url),
        url,
        runner: "extension",
        viewport: collected.viewport,
        capturedAt: new Date().toISOString(),
      },
      dom: collected.dom,
      styles: collected.styles,
      boxes: collected.boxes,
      css: collected.css,
      ...(screenshot ? { screenshot } : {}),
    }),
  });
  const json = await res.json();
  if (!res.ok || json.error) return { error: "engine", detail: json.error };
  return { findings: json.findings ?? [], url, name: collected.title || tab.title };
}

/** Ask the engine to adjudicate the judgment criteria. The key is forwarded per request and
 *  never stored server-side; the verdicts pass the engine's ordinary fail-closed gate. */
async function judge() {
  const cfg = await settings();
  const res = await fetch(`${endpoint(cfg.port)}/judge`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cfg.apiKey ? { "x-anthropic-key": cfg.apiKey } : {}) },
    body: "{}",
  });
  return await res.json();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      if (msg.type === "health") reply(await health((await settings()).port));
      else if (msg.type === "audit") reply(await audit(msg.tab));
      else if (msg.type === "judge") reply(await judge());
      else reply({ error: "unknown-message" });
    } catch (e) {
      reply({ error: "exception", detail: String(e && e.message ? e.message : e) });
    }
  })();
  return true; // async reply
});
