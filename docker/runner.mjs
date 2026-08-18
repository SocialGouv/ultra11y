import { chromium } from "playwright";
import axe from "axe-core";
const target = process.argv[2];
const isFile = target.startsWith("/work/");
const SNAPSHOT = process.env.ULTRA11Y_SNAPSHOT !== "0";
const COLLECT = "(() => {\n  const PROPS = [\"color\",\"backgroundColor\",\"backgroundImage\",\"fontSize\",\"fontWeight\",\"fontStyle\",\"textDecorationLine\",\"textTransform\",\"lineHeight\",\"letterSpacing\",\"wordSpacing\",\"whiteSpace\",\"display\",\"visibility\",\"opacity\",\"position\",\"overflowX\",\"overflowY\",\"outlineStyle\",\"outlineWidth\",\"outlineColor\",\"borderTopStyle\",\"borderRightStyle\",\"borderBottomStyle\",\"borderLeftStyle\",\"borderTopWidth\",\"borderRightWidth\",\"borderBottomWidth\",\"borderLeftWidth\",\"borderTopColor\",\"borderRightColor\",\"borderBottomColor\",\"borderLeftColor\",\"boxShadow\",\"cursor\"];\n  const MAX = 5000;\n  const els = document.querySelectorAll('*');\n  const styles = [];\n  const boxes = [];\n  const n = Math.min(els.length, MAX);\n  for (let i = 0; i < n; i++) {\n    const el = els[i];\n    const tag = el.tagName.toLowerCase();\n    const cs = getComputedStyle(el);\n    const css = {};\n    for (const p of PROPS) {\n      const v = cs[p];\n      if (v !== undefined && v !== null && v !== '') css[p] = String(v);\n    }\n    styles.push({ i: i, tag: tag, css: css });\n    const r = el.getBoundingClientRect();\n    boxes.push({ i: i, tag: tag, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });\n  }\n  // The page's own stylesheets. Some criteria are properties of the STYLESHEET rather than of\n  // any element's computed style — focus styling removed with no replacement (2.4.7), a media\n  // query that locks the orientation (1.3.4) — and this is the only place they exist.\n  // A cross-origin sheet throws on .cssRules: COUNT those instead of ignoring them, so a rule\n  // reading this digest can tell \"nothing there\" apart from \"I could not look\".\n  // The cap is on the ORDINARY pool only, and the traversal never stops early.\n  //\n  // It used to return the moment the pool filled, which abandoned every remaining sheet —\n  // and on a design-system app the pool fills long before the end. Measured on a real capture\n  // of 38 pages: all 38 came back truncated, so rendered-focus-not-visible declined on every\n  // one of them and 2.4.7 could never be decided by any number of scans. The rule was right to\n  // decline (a :focus rule might have been among the dropped ones); the collector was wrong to\n  // make that unavoidable.\n  //\n  // So the rules a rendered criterion actually READS — :focus styling, orientation locks,\n  // pinned positioning, animation — are kept whatever the pool is doing, and truncated now\n  // means \"some ordinary rule was dropped\", which is a much weaker statement. A rule can then\n  // ask for what it needs instead of refusing on a cap that never concerned it.\n  const cssRules = [];\n  let unreadable = 0;\n  let dropped = 0;\n  const MAXR = 4000;\n  const camel = (p) => p.replace(/-([a-z])/g, (_, c) => c.toUpperCase());\n  const KEEP_SELECTOR = /:focus|:target|:active/i;\n  const KEEP_PROP = /^(?:outline|position|animation|transition|transform)/;\n  const walk = (list, media) => {\n    for (const r of list) {\n      if (typeof r.selectorText === 'string' && r.style) {\n        const decls = {};\n        for (let i = 0; i < r.style.length; i++) {\n          const prop = r.style[i];\n          decls[camel(prop)] = r.style.getPropertyValue(prop);\n        }\n        const keep = KEEP_SELECTOR.test(r.selectorText) || Object.keys(decls).some((k) => KEEP_PROP.test(k));\n        if (cssRules.length >= MAXR && !keep) { dropped++; continue; }\n        cssRules.push(media ? { selector: r.selectorText, media: media, decls: decls } : { selector: r.selectorText, decls: decls });\n      } else if (r.cssRules) {\n        const cond = r.conditionText || (r.media && r.media.mediaText) || media;\n        walk(r.cssRules, cond);\n      }\n    }\n  };\n  for (const sheet of document.styleSheets) {\n    try {\n      walk(sheet.cssRules, undefined);\n    } catch (e) {\n      unreadable++;\n    }\n  }\n\n  const truncated = els.length > MAX;\n  return {\n    dom: document.documentElement.outerHTML,\n    css: { v: 1, rules: cssRules, unreadable: unreadable, truncated: dropped > 0, dropped: dropped },\n    title: document.title,\n    // The doctype is NOT part of documentElement.outerHTML, so a capture that records only\n    // the DOM drops it — and RGAA 8.1 (is a doctype present, valid, and before <html>?) then\n    // has nothing to look at. Recorded as its own field for that reason.\n    doctype: document.doctype ? '<!DOCTYPE ' + document.doctype.name + (document.doctype.publicId ? ' PUBLIC \"' + document.doctype.publicId + '\"' : '') + (document.doctype.systemId ? ' \"' + document.doctype.systemId + '\"' : '') + '>' : '',\n    lang: document.documentElement.getAttribute('lang') || '',\n    url: location.href,\n    viewport: { width: window.innerWidth, height: window.innerHeight },\n    styles: { v: 1, entries: styles, truncated: truncated },\n    boxes: { v: 1, entries: boxes, truncated: truncated }\n  };\n})()";
const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
try {
  const page = await browser.newPage();
  await page.goto(isFile ? "file://" + target : target, { waitUntil: "load", timeout: 45000 });
  // Collected FIRST, on the pristine page: axe's injected source and the 320px reflow
  // resize both come after, and a snapshot must be the page as the browser built it.
  let snapshot;
  if (SNAPSHOT) {
    try {
      snapshot = await page.evaluate(COLLECT);
      try { snapshot.screenshot = (await page.screenshot({ fullPage: false })).toString("base64"); } catch {}
    } catch {}
  }
  await page.addScriptTag({ content: axe.source });
  const axeRes = await page.evaluate(async () => await window.axe.run(document, { resultTypes: ["violations"] }));
  await page.setViewportSize({ width: 320, height: 800 });
  const reflow = await page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return { horizontalScroll: el.scrollWidth > el.clientWidth + 2 };
  });
  const violations = axeRes.violations.map((v) => ({
    id: v.id, impact: v.impact, help: v.help, tags: v.tags,
    nodes: v.nodes.slice(0, 10).map((n) => ({ target: n.target, html: (n.html || "").slice(0, 200) })),
  }));
  console.log(JSON.stringify({ url: target, violations, reflow, snapshot }));
} finally {
  await browser.close();
}
