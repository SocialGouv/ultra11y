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
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AxeEngineInfo } from "./types.js";

export type { AxeEngineInfo };

/** The axe rule tags every tier runs: WCAG 2.0/2.1/2.2 A and AA, plus axe's best practices
 *  (folded as advisory recommendations, never as non-conformities — src/axe-map.ts). AAA rules
 *  are out: the referential is AA, and an AAA hit would only ever be noise in the report.
 *  `color-contrast`, the rule AXE_DECIDES relies on (src/axe-map.ts), is tagged `wcag2aa`. */
export const AXE_TAGS: readonly string[] = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/** The axe-core version ultra11y pins — the exact `axe-core` dependency in package.json, baked
 *  into the source (and so into every bundle) the way `VERSION` is, and held in lockstep with
 *  package.json by tests/axe-engine.test.ts. It is what « ultra11y's pinned copy » is checked
 *  against: a copy that merely resolves from ultra11y's code is not, by that alone, the pinned
 *  one — the standalone skill bundle runs from `<project>/.codex/skills/…` or
 *  `.opencode/skills/…`, and from there module resolution walks up into the PROJECT's
 *  node_modules. */
export const AXE_CORE_PIN = "4.13.0";

/** Whose copy of axe-core ran: ultra11y's own pinned one, ultra11y's own at another version
 *  ("unpinned"), or the audited project's. */
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
  /** Set when the copy is not ultra11y's pinned one — the visible half of the fallback. */
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

/** Whether `anchor` lies inside ultra11y's own package: the nearest package.json above it is
 *  ultra11y's. False for the standalone skill bundle copied into a project's skills directory —
 *  its nearest package.json is the project's, and whatever it resolves is the project's. */
function insideUltra11y(anchor: string): boolean {
  let dir: string;
  try {
    dir = dirname(anchor.startsWith("file:") ? fileURLToPath(anchor) : anchor);
  } catch {
    return false;
  }
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      try {
        return (JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown }).name === "ultra11y";
      } catch {
        return false;
      }
    }
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
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
  // « ultra11y's pinned copy » only when both hold: the copy was resolved from ultra11y's own
  // package, AND it is the version ultra11y pins. Resolving from this module's URL is not enough
  // — from a skills directory inside a project it reaches the project's node_modules.
  const origin: AxeOrigin = own && insideUltra11y(self) ? (located.version === AXE_CORE_PIN ? "ultra11y" : "unpinned") : "project";
  const note =
    origin === "project"
      ? `ultra11y: its own axe-core ${AXE_CORE_PIN} is not resolvable here — running the audited project's axe-core ${located.version} (${located.path}). Results are recorded with that version; install ultra11y with its dependencies to run the pinned one.`
      : origin === "unpinned"
        ? `ultra11y: the axe-core resolved from ultra11y's own package is ${located.version}, not the pinned ${AXE_CORE_PIN} (${located.path}). Results are recorded with that version; reinstall ultra11y's dependencies to run the pinned one.`
        : undefined;
  return {
    AxeBuilder,
    source,
    sourcePath: located.path,
    version: located.version,
    origin,
    ...(note ? { note } : {}),
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
