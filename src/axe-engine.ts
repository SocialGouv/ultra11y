// THE AXE RUN ULTRA11Y CONTROLS — one definition, shared by `scan` (src/scan-local.ts) and
// `ultra11y/playwright` (src/integrations/playwright.ts).
//
// Two tiers that both say « axe ran here » must mean the same axe: the same axe-core build and
// the same rule set. Before this module each tier resolved `@axe-core/playwright` on its own,
// project first, and let it inject whatever `axe-core` sat beside it — so the version, and with
// it the rules and their results, varied per audited project, and `ultra11y/playwright` ran
// every default rule while `scan` ran a tag set. A `color-contrast` silence on one tier was
// therefore not the same measurement as on the other.
//
// So the engine is pinned here, by SOURCE rather than by package:
//   • the axe-core build is ultra11y's own dependency (`axe-core`, exact version in
//     package.json), read from `axe-core/axe.min.js` and handed to AxeBuilder as `axeSource` —
//     whichever `@axe-core/playwright` drives the page, the script it injects is this one;
//   • the rule configuration is `AXE_TAGS`, applied in every tier.
// The audited project's copy is used only when ultra11y's own cannot be resolved (the standalone
// skill bundle running with no node_modules beside it), and that fallback is never silent: the
// engine says so, and the version actually used is recorded with every result.
//
// Node builtins only — this file is bundled into the zero-dep engine and into the published
// integration, and must never pull a browser dependency in statically.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { AxeEngineInfo } from "./types.js";

export type { AxeEngineInfo };

/** The axe rule tags every tier runs: WCAG 2.0/2.1/2.2 A and AA, plus axe's best practices
 *  (folded as advisory recommendations, never as non-conformities — src/axe-map.ts). AAA rules
 *  are out: the referential is AA, and an AAA hit would only ever be noise in the report.
 *  `color-contrast`, the rule AXE_DECIDES relies on (src/axe-map.ts), is tagged `wcag2aa`. */
export const AXE_TAGS: readonly string[] = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** Whose copy of axe-core ran: ultra11y's own (the pinned one), or the audited project's. */
export type AxeOrigin = AxeEngineInfo["origin"];

/** A resolved, ready-to-run axe: the builder class, the source it injects, and where both came from. */
export interface AxeEngine {
  // `any`: the builder's shape is axe's, resolved at run time — never a typed dependency.
  AxeBuilder: any;
  /** The text of `axe-core/axe.min.js`, injected as `axeSource`. */
  source: string;
  /** Where that source was read from. */
  sourcePath: string;
  version: string;
  origin: AxeOrigin;
  /** Set when the project's copy had to be used — the visible half of the fallback. */
  note?: string;
}

const BUILDER_SPEC = "@axe-core/playwright";
const SOURCE_SPEC = "axe-core/axe.min.js";
const PACKAGE_SPEC = "axe-core/package.json";

/** Read once per path: axe.min.js is half a megabyte, and a sweep runs it on every page. */
const sourceCache = new Map<string, string>();

interface Located {
  path: string;
  version: string;
}

/** Locate axe-core's minified build from `anchor`: directly, else through the
 *  `@axe-core/playwright` that resolves from it (a strict pnpm layout exposes only the latter). */
function locateSource(anchor: string): Located | undefined {
  const tryFrom = (from: string): Located | undefined => {
    try {
      const req = createRequire(from);
      const path = req.resolve(SOURCE_SPEC);
      const version = (req(PACKAGE_SPEC) as { version?: string }).version ?? "unknown";
      return { path, version };
    } catch {
      return undefined;
    }
  };
  const direct = tryFrom(anchor);
  if (direct) return direct;
  try {
    return tryFrom(createRequire(anchor).resolve(BUILDER_SPEC));
  } catch {
    return undefined;
  }
}

function loadBuilder(anchor: string): any {
  try {
    const mod = createRequire(anchor)(BUILDER_SPEC);
    const B = mod.default ?? mod.AxeBuilder ?? mod;
    return typeof B === "function" ? B : undefined;
  } catch {
    return undefined;
  }
}

export interface ResolveAxeOptions {
  /** The audited project's directory — the fallback anchor. */
  cwd: string;
  /** ultra11y's own anchor. Defaults to this module; a test passes another to simulate a
   *  bundle with no node_modules beside it. */
  self?: string;
}

/** Resolve the axe run ultra11y controls: ultra11y's own `@axe-core/playwright` and `axe-core`
 *  first, the audited project's only when ultra11y's are not resolvable. Throws when neither is. */
export function resolveAxeEngine(opts: ResolveAxeOptions): AxeEngine {
  const self = opts.self ?? import.meta.url;
  const project = join(opts.cwd, "package.json");
  const AxeBuilder = loadBuilder(self) ?? loadBuilder(project);
  if (!AxeBuilder) {
    throw new Error(`${BUILDER_SPEC} resolves neither from ultra11y itself nor from ${opts.cwd}.`);
  }
  const own = locateSource(self);
  const located = own ?? locateSource(project);
  if (!located) throw new Error(`axe-core resolves neither from ultra11y itself nor from ${opts.cwd}.`);
  let source = sourceCache.get(located.path);
  if (source === undefined) {
    source = readFileSync(located.path, "utf8");
    sourceCache.set(located.path, source);
  }
  const origin: AxeOrigin = own ? "ultra11y" : "project";
  return {
    AxeBuilder,
    source,
    sourcePath: located.path,
    version: located.version,
    origin,
    ...(origin === "project"
      ? {
          note: `ultra11y: its own axe-core is not resolvable here — running the audited project's axe-core ${located.version} (${located.path}). Results are recorded with that version; install ultra11y with its dependencies to run the pinned one.`,
        }
      : {}),
  };
}

/** What one axe pass returns, with the engine that produced it. */
export interface AxeRun {
  violations: unknown[];
  engine: AxeEngineInfo;
}

/** Run the controlled axe on a Playwright page: the pinned source, the pinned tags. The version
 *  recorded is the one the injected script reports (`testEngine.version`), so it is the engine
 *  that actually ran, not the one we meant to load. */
export async function runAxe(engine: AxeEngine, page: any, runner?: string): Promise<AxeRun> {
  const res = (await new engine.AxeBuilder({ page, axeSource: engine.source }).withTags([...AXE_TAGS]).analyze()) as {
    violations?: unknown[];
    testEngine?: { version?: string };
  };
  return {
    violations: res.violations ?? [],
    engine: { version: res.testEngine?.version ?? engine.version, origin: engine.origin, ...(runner ? { runner } : {}) },
  };
}

/** Union of engine records, one per (version, origin), runners merged and sorted. */
export function unionAxeEngines(...lists: (readonly AxeEngineInfo[] | undefined)[]): AxeEngineInfo[] {
  const by = new Map<string, { version: string; origin: AxeOrigin; runners: Set<string> }>();
  for (const list of lists)
    for (const e of list ?? []) {
      const key = `${e.version}\n${e.origin}`;
      const hit = by.get(key) ?? { version: e.version, origin: e.origin, runners: new Set<string>() };
      if (e.runner) for (const r of e.runner.split(",")) if (r) hit.runners.add(r);
      by.set(key, hit);
    }
  return [...by.values()]
    .sort((a, b) => a.version.localeCompare(b.version) || a.origin.localeCompare(b.origin))
    .map((e) => ({ version: e.version, origin: e.origin, ...(e.runners.size ? { runner: [...e.runners].sort().join(",") } : {}) }));
}
