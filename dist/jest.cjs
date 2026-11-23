"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/integrations/jest.ts
var jest_exports = {};
__export(jest_exports, {
  checkA11y: () => checkA11y,
  toBeAccessible: () => toBeAccessible
});
module.exports = __toCommonJS(jest_exports);

// node_modules/.pnpm/tsup@8.5.1_postcss@8.5.15_typescript@6.0.3_yaml@2.9.0/node_modules/tsup/assets/cjs_shims.js
var getImportMetaUrl = () => typeof document === "undefined" ? new URL(`file:${__filename}`).href : document.currentScript && document.currentScript.tagName.toUpperCase() === "SCRIPT" ? document.currentScript.src : new URL("main.js", document.baseURI).href;
var importMetaUrl = /* @__PURE__ */ getImportMetaUrl();

// src/integrations/unit.ts
var import_node_path = require("path");

// src/integrations/core.ts
var import_node_child_process = require("child_process");
var import_node_module = require("module");

// src/integrations/payload.ts
var RANK = { bloquant: 0, majeur: 1, mineur: 2 };
var THRESHOLD = { blocking: 0, bloquant: 0, major: 1, majeur: 1, minor: 2, mineur: 2 };
function failingFindings(result, failOn) {
  const max = THRESHOLD[failOn];
  if (max === void 0) throw new Error(`ultra11y: failOn must be blocking|major|minor (got "${failOn}")`);
  return (result.findings ?? []).filter((f) => !f.advisory && (RANK[f.severity] ?? 99) <= max);
}
function formatFailure(pageName, failing, where = ".ultra11y/pages/") {
  const lines = [`ultra11y: ${failing.length} accessibility non-conformity(ies) on "${pageName}":`];
  for (const f of failing.slice(0, 20)) {
    lines.push(`  [${f.severity}] ${f.ruleId} (WCAG ${f.criteriaId}) \u2014 ${f.origin?.sourceFile ?? f.file} \u2014 ${f.message}`);
  }
  if (failing.length > 20) lines.push(`  \u2026 and ${failing.length - 20} more.`);
  lines.push(`Full detail: ${where} \u2014 re-audit offline with \`ultra11y audit\`.`);
  return lines.join("\n");
}

// src/integrations/core.ts
function enginePath() {
  if (process.env.ULTRA11Y) return process.env.ULTRA11Y;
  try {
    return (0, import_node_module.createRequire)(importMetaUrl).resolve("ultra11y/scripts/ultra11y.mjs");
  } catch {
    return new URL("../scripts/ultra11y.mjs", importMetaUrl).pathname;
  }
}
function auditCapture(payload, opts = {}, engine = enginePath()) {
  return pipeToEngine(["capture", "write", "--json", ...opts.root ? ["--root", opts.root] : []], payload, engine);
}
function pipeToEngine(args, payload, engine) {
  const res = (0, import_node_child_process.spawnSync)(process.execPath, [engine, ...args], {
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

// src/integrations/unit.ts
var escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function nodeHtml(n) {
  if (n.nodeType === 1 && typeof n.outerHTML === "string") return n.outerHTML;
  if (n.nodeType === 3) return escText(n.textContent ?? "");
  if (n.nodeType === 8) return `<!--${n.data ?? ""}-->`;
  return "";
}
function serializeRender(target) {
  if (typeof target === "string") return target;
  if (target && typeof target === "object") {
    if ("container" in target && target.container) return serializeRender(target.container);
    const n = target;
    if (n.nodeType === 9) return n.body?.innerHTML ?? "";
    if (n.nodeType === 11) return Array.from(n.childNodes ?? [], nodeHtml).join("");
    if (typeof n.outerHTML === "string") return n.outerHTML;
  }
  throw new TypeError(
    "ultra11y: checkA11y expects an Element, a Document, a DocumentFragment, a Testing Library render result ({ container }) or an HTML string."
  );
}
function domEnv(target) {
  let node;
  if (typeof target === "object" && target) node = "container" in target ? target.container : target;
  const g = globalThis;
  const ua = node?.ownerDocument?.defaultView?.navigator?.userAgent ?? node?.defaultView?.navigator?.userAgent ?? g.navigator?.userAgent ?? "";
  if (/jsdom/i.test(ua)) return "jsdom";
  if (/happy-?dom/i.test(ua) || g.happyDOM) return "happy-dom";
  return void 0;
}
function currentTest() {
  const g = globalThis;
  const ex = g.expect ?? g[/* @__PURE__ */ Symbol.for("expect-global")];
  try {
    return ex?.getState?.() ?? {};
  } catch {
    return {};
  }
}
function idSlug(s) {
  const slug = s.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length <= 80) return slug;
  let h = 5381;
  for (let i = 0; i < slug.length; i++) h = (h << 5) + h + slug.charCodeAt(i) >>> 0;
  return `${slug.slice(0, 72).replace(/-+$/, "")}-${h.toString(36)}`;
}
var seen = /* @__PURE__ */ new Map();
function capturePayload(target, opts, runner, ctx = currentTest()) {
  const html = serializeRender(target);
  const root = opts.root ?? process.cwd();
  const rel = (p) => {
    if (!(0, import_node_path.isAbsolute)(p)) return p;
    const fromRoot = (0, import_node_path.relative)(root, p);
    return fromRoot.startsWith("..") ? (0, import_node_path.relative)(process.cwd(), p) : fromRoot;
  };
  const test = ctx.testPath ? rel(ctx.testPath).split("\\").join("/") : void 0;
  const title = ctx.currentTestName;
  let id = opts.as;
  if (!id) {
    const stem = test ? (0, import_node_path.basename)(test).replace(/\.(test|spec)\.[cm]?[jt]sx?$|\.[cm]?[jt]sx?$/i, "") : "";
    const base = idSlug([stem, title].filter(Boolean).join(" ")) || "capture";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    id = n === 1 ? base : `${base}-${n}`;
  }
  const env = domEnv(target);
  return {
    meta: {
      id,
      ...opts.name ?? title ? { name: opts.name ?? title } : {},
      ...opts.component ? { component: opts.component } : {},
      ...opts.source ? { source: opts.source } : {},
      ...test ? { test } : {},
      runner,
      ...env ? { env } : {}
    },
    html
  };
}
var CAPTURES = ".ultra11y/captures/";
function createUnitIntegration(runner) {
  function record(target, opts, ctx) {
    const payload = capturePayload(target, opts, runner, ctx ?? currentTest());
    const result = auditCapture(payload, opts.root ? { root: opts.root } : {});
    const failOn = opts.failOn === void 0 ? "blocking" : opts.failOn;
    const failing = failOn === false ? [] : failingFindings(result, failOn);
    return { result, failing, name: payload.meta.name ?? payload.meta.id };
  }
  async function checkA11y2(target, opts = {}) {
    const { result, failing, name } = record(target, opts);
    if (failing.length) throw new Error(formatFailure(name, failing, CAPTURES));
    return result;
  }
  function toBeAccessible2(received, opts = {}) {
    const ctx = this?.testPath || this?.currentTestName ? { testPath: this.testPath, currentTestName: this.currentTestName } : currentTest();
    const { failing, name } = record(received, opts, ctx);
    const pass = failing.length === 0;
    return {
      pass,
      message: () => pass ? `ultra11y: expected "${name}" to carry a non-conformity at failOn "${opts.failOn ?? "blocking"}", and it carries none.` : formatFailure(name, failing, CAPTURES)
    };
  }
  return { checkA11y: checkA11y2, toBeAccessible: toBeAccessible2 };
}

// src/integrations/jest.ts
var unit = createUnitIntegration("jest");
var checkA11y = unit.checkA11y;
var toBeAccessible = unit.toBeAccessible;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  checkA11y,
  toBeAccessible
});
