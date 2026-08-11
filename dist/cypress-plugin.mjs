// src/integrations/cypress-plugin.ts
import { readFileSync } from "fs";

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

// src/integrations/cypress-plugin.ts
function register(on) {
  const shots = /* @__PURE__ */ new Map();
  on("after:screenshot", (details) => {
    if (details?.name && details.path) shots.set(details.name, details.path);
    return details;
  });
  on("task", {
    ultra11ySnapshot(payload) {
      const withShot = { ...payload };
      const path = payload.screenshotName ? shots.get(payload.screenshotName) : void 0;
      if (path) {
        try {
          withShot.screenshot = readFileSync(path).toString("base64");
        } catch {
        }
      }
      const result = auditSnapshot(withShot);
      const failOn = payload.failOn === void 0 ? "blocking" : payload.failOn;
      const failing = failOn === false ? [] : failingFindings(result, failOn);
      return {
        findings: result.findings ?? [],
        failing,
        message: failing.length ? formatFailure(String(payload.meta.name), failing) : ""
      };
    }
  });
}
export {
  register as default
};
