// src/integrations/playwright.ts
import { readFileSync } from "fs";
import { createRequire as createRequire2 } from "module";
import { join } from "path";

// src/collector.ts
var COLLECTED_CSS = [
  "color",
  "backgroundColor",
  "backgroundImage",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "textDecorationLine",
  "textTransform",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "whiteSpace",
  "display",
  "visibility",
  "opacity",
  "position",
  "overflowX",
  "overflowY",
  "outlineStyle",
  "outlineWidth",
  "outlineColor",
  // All four borders + the box shadow: WCAG 1.4.11 asks whether a control's BOUNDARY is
  // perceivable, and a boundary can be drawn by any side, by the fill, by an outline or by a
  // shadow. Collecting only one side would manufacture non-conformities on the other three.
  "borderTopStyle",
  "borderRightStyle",
  "borderBottomStyle",
  "borderLeftStyle",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "boxShadow",
  "cursor"
];
var COLLECT_MAX_ELEMENTS = 5e3;
var COLLECT_SNAPSHOT = `(() => {
  const PROPS = ${JSON.stringify(COLLECTED_CSS)};
  const MAX = ${COLLECT_MAX_ELEMENTS};
  const els = document.querySelectorAll('*');
  const styles = [];
  const boxes = [];
  const n = Math.min(els.length, MAX);
  for (let i = 0; i < n; i++) {
    const el = els[i];
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);
    const css = {};
    for (const p of PROPS) {
      const v = cs[p];
      if (v !== undefined && v !== null && v !== '') css[p] = String(v);
    }
    styles.push({ i: i, tag: tag, css: css });
    const r = el.getBoundingClientRect();
    boxes.push({ i: i, tag: tag, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  }
  // The page's own stylesheets. Some criteria are properties of the STYLESHEET rather than of
  // any element's computed style \u2014 focus styling removed with no replacement (2.4.7), a media
  // query that locks the orientation (1.3.4) \u2014 and this is the only place they exist.
  // A cross-origin sheet throws on .cssRules: COUNT those instead of ignoring them, so a rule
  // reading this digest can tell "nothing there" apart from "I could not look".
  const cssRules = [];
  let unreadable = 0;
  const MAXR = 4000;
  const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const walk = (list, media) => {
    for (const r of list) {
      if (cssRules.length >= MAXR) return;
      if (typeof r.selectorText === 'string' && r.style) {
        const decls = {};
        for (let i = 0; i < r.style.length; i++) {
          const prop = r.style[i];
          decls[camel(prop)] = r.style.getPropertyValue(prop);
        }
        cssRules.push(media ? { selector: r.selectorText, media: media, decls: decls } : { selector: r.selectorText, decls: decls });
      } else if (r.cssRules) {
        const cond = r.conditionText || (r.media && r.media.mediaText) || media;
        walk(r.cssRules, cond);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, undefined);
    } catch (e) {
      unreadable++;
    }
  }

  const truncated = els.length > MAX;
  return {
    dom: document.documentElement.outerHTML,
    css: { v: 1, rules: cssRules, unreadable: unreadable, truncated: cssRules.length >= MAXR },
    title: document.title,
    // The doctype is NOT part of documentElement.outerHTML, so a capture that records only
    // the DOM drops it \u2014 and RGAA 8.1 (is a doctype present, valid, and before <html>?) then
    // has nothing to look at. Recorded as its own field for that reason.
    doctype: document.doctype ? '<!DOCTYPE ' + document.doctype.name + (document.doctype.publicId ? ' PUBLIC "' + document.doctype.publicId + '"' : '') + (document.doctype.systemId ? ' "' + document.doctype.systemId + '"' : '') + '>' : '',
    lang: document.documentElement.getAttribute('lang') || '',
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    styles: { v: 1, entries: styles, truncated: truncated },
    boxes: { v: 1, entries: boxes, truncated: truncated }
  };
})()`;

// src/integrations/core.ts
import { spawnSync } from "child_process";
import { createRequire } from "module";

// src/integrations/payload.ts
var RANK = { bloquant: 0, majeur: 1, mineur: 2 };
var THRESHOLD = { blocking: 0, bloquant: 0, major: 1, majeur: 1, minor: 2, mineur: 2 };
function failingFindings(result, failOn) {
  const max = THRESHOLD[failOn];
  if (max === void 0) throw new Error(`ultra11y: failOn must be blocking|major|minor (got "${failOn}")`);
  return (result.findings ?? []).filter((f) => !f.advisory && (RANK[f.severity] ?? 99) <= max);
}
function formatFailure(pageName, failing) {
  const lines = [`ultra11y: ${failing.length} accessibility non-conformity(ies) on "${pageName}":`];
  for (const f of failing.slice(0, 20)) {
    lines.push(`  [${f.severity}] ${f.ruleId} (WCAG ${f.criteriaId}) \u2014 ${f.origin?.sourceFile ?? f.file} \u2014 ${f.message}`);
  }
  if (failing.length > 20) lines.push(`  \u2026 and ${failing.length - 20} more.`);
  lines.push("Full detail: .ultra11y/pages/ \u2014 re-audit offline with `ultra11y audit`.");
  return lines.join("\n");
}
function slugify(url) {
  let path = url;
  try {
    path = new URL(url).pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
    }
  } catch {
  }
  const slug = path.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || (path === "/" || path === "" ? "accueil" : "page");
}
function stayedOnPage(expected, actual) {
  if (!expected || !actual) return true;
  const path = (u) => {
    try {
      return new URL(u, "http://x.invalid").pathname.replace(/\/+$/, "");
    } catch {
      return void 0;
    }
  };
  const a = path(expected);
  const b = path(actual);
  if (a === void 0 || b === void 0) return true;
  return a === b;
}
function buildPayload(collected, url, runner, opts, screenshot) {
  const id = opts.as || slugify(url);
  return {
    meta: {
      v: 1,
      id,
      name: opts.name || collected.title || id,
      url,
      runner,
      viewport: collected.viewport,
      capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
      ...opts.auth !== void 0 ? { auth: opts.auth } : {},
      ...opts.sources ? { sources: opts.sources } : {},
      ...opts.notes ? { notes: opts.notes } : {}
    },
    dom: collected.dom,
    styles: collected.styles,
    boxes: collected.boxes,
    css: collected.css,
    ...screenshot ? { screenshot } : {}
  };
}
function gate(result, pageName, failOn) {
  const threshold = failOn === void 0 ? "blocking" : failOn;
  if (threshold === false) return;
  const failing = failingFindings(result, threshold);
  if (failing.length) throw new Error(formatFailure(pageName, failing));
}

// src/integrations/core.ts
function enginePath() {
  if (process.env.ULTRA11Y) return process.env.ULTRA11Y;
  try {
    return createRequire(import.meta.url).resolve("ultra11y/scripts/ultra11y.mjs");
  } catch {
    return new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
  }
}
function auditSnapshot(payload, engine = enginePath()) {
  const res = spawnSync(process.execPath, [engine, "snapshot", "write", "--json"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 192 * 1024 * 1024
  });
  if (res.error) throw new Error(`ultra11y: could not run the engine at ${engine} \u2014 ${res.error.message}`);
  if (!res.stdout) throw new Error(`ultra11y: the engine produced no output (exit ${res.status})
${res.stderr || ""}`);
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`ultra11y: could not parse the engine output
${res.stdout.slice(0, 500)}`);
  }
}
function writePagesReport(opts = {}, engine = enginePath()) {
  const args = [engine, "pages", "--in", "-", "--format", "report"];
  if (opts.split !== false) args.push("--split", "page");
  args.push("--out", opts.out ?? "audits/pages");
  if (opts.standard) args.push("--standard", opts.standard);
  if (opts.lang) args.push("--lang", opts.lang);
  const audit = spawnSync(process.execPath, [engine, "audit", ".ultra11y/pages", "--json"], { encoding: "utf8", maxBuffer: 192 * 1024 * 1024 });
  if (audit.error || !audit.stdout) return void 0;
  const res = spawnSync(process.execPath, args, { input: audit.stdout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) return void 0;
  return res.stdout.trim() || void 0;
}

// src/integrations/playwright.ts
async function checkA11y(page, opts = {}) {
  const collected = await page.evaluate(COLLECT_SNAPSHOT);
  let shot;
  if (opts.screenshot !== false) {
    try {
      shot = (await page.screenshot({ fullPage: false })).toString("base64");
    } catch {
    }
  }
  const url = collected.url || page.url();
  if (opts.expectPath && !stayedOnPage(opts.expectPath, url)) {
    throw new Error(
      `ultra11y: ${opts.expectPath} landed on ${url} \u2014 not recording it as "${opts.as ?? opts.name ?? "this page"}". The state that opens this route is not the one the test built; seed it first, or drop the page from the sample.`
    );
  }
  const payload = buildPayload(collected, url, "playwright", opts, shot);
  const result = auditSnapshot(payload);
  if (opts.report) writePagesReport(typeof opts.report === "object" ? opts.report : {});
  gate(result, String(payload.meta.name), opts.failOn);
  return result;
}
var test = (() => {
  const load = (from) => createRequire2(from)("@playwright/test");
  for (const from of [`${process.cwd()}/package.json`, import.meta.url]) {
    try {
      const base = load(from).test;
      if (!base?.extend) continue;
      return base.extend({
        // biome-ignore lint/suspicious/noExplicitAny: same
        ultra11y: async ({ page }, use) => {
          await use((opts) => checkA11y(page, opts));
        }
      });
    } catch {
    }
  }
  return void 0;
})();
function samplePagesFor(opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  let declared;
  try {
    const raw = readFileSync(join(cwd, ".ultra11yrc.json"), "utf8");
    declared = JSON.parse(raw).sample?.pages ?? [];
  } catch {
    throw new Error(`ultra11y: no readable .ultra11yrc.json in ${cwd} \u2014 sweepSample reads the page sample from it.`);
  }
  return declared.filter((p) => opts.only?.(p) ?? true);
}
function sweepTarget(url) {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}
function sweepSample(opts = {}) {
  const pages = samplePagesFor(opts);
  const t = test;
  if (!t) throw new Error("ultra11y: @playwright/test could not be resolved \u2014 sweepSample needs it.");
  if (!pages.length) return;
  for (const p of pages) {
    const target = sweepTarget(p.url);
    t(`a11y \u2014 ${p.name}`, async ({ page }) => {
      const response = await page.goto(target);
      if (opts.settle) await opts.settle(page);
      const landed = page.url();
      t.skip(!stayedOnPage(target, landed), `${target} landed on ${landed} \u2014 the current state does not open this screen; nothing to record as "${p.name}"`);
      const status = response?.status();
      t.skip(
        status !== void 0 && status >= 400,
        `${target} answered HTTP ${status} \u2014 an error page at the requested address; nothing to record as "${p.name}"`
      );
      await checkA11y(page, {
        failOn: false,
        ...opts.check,
        as: p.id,
        name: p.name,
        ...p.auth !== void 0 ? { auth: p.auth } : {},
        ...p.notes ? { notes: p.notes } : {},
        ...p.sources ? { sources: p.sources } : {},
        expectPath: target
      });
    });
  }
}
export {
  checkA11y,
  samplePagesFor,
  sweepSample,
  sweepTarget,
  test
};
