// Runtime configuration so external standards PACKS + GUIDANCE can be plugged WITHOUT
// rebuilding the bundle. Two explicit sources — no fs glob, no auto-discovery walk:
//   • a `.ultra11yrc.json` in the cwd: { packs?: string[]; guidance?: string[]; standard?: string }
//   • repeated/comma-separated `--pack <path>` flags on the CLI
// A pack path is either a pack JSON file, or a directory holding pack.json (+ optional
// glossary.json / guidance.json). Every pack is run through `validatePack` before it is
// registered (src/standards/validate.ts); an invalid pack is a HARD error returned to the
// caller, never a silent skip.
import { existsSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { readText } from "./util.js";
import { registerRuntimePack, getPack, enableSecondaryMapping } from "./standards/registry.js";
import { formatIssues } from "./standards/validate.js";
import { checkGuidance } from "./pack.js";
import { registerRuntimeGuidance, hasGuidance } from "./guidance/index.js";
import type { GuidanceDataset } from "./guidance/types.js";
import type { LocaleString } from "./standards/types.js";
import type { Glossary, SampleConfig } from "./types.js";

export interface Ultra11yConfig {
  packs?: string[];
  guidance?: string[];
  standard?: string;
  // Normative page sample (échantillon) — standard-agnostic mechanics. Validated by
  // `validateSample` (src/sample.ts) when a `scan --sample` / `sample check` reads it; NOT
  // validated at pack-load time (an audit with no sample block is the common case).
  sample?: SampleConfig;
  // Opt-in SECONDARY crosswalk mappings to activate (see src/standards/types.ts
  // SecondaryMapping). Each entry names a registered `standard` (pack key), a `ruleId`, and
  // the additional `criterion` it should also project onto, with an optional localized
  // `note`. Applied AFTER packs are registered (registry.enableSecondaryMapping): a pack
  // ships the mapping DISABLED; this flips it on (or appends a new enabled one).
  secondaryMappings?: Array<{ standard: string; ruleId: string; criterion: string; note?: LocaleString }>;
  // The Claude Code PreToolUse hook (src/hook.ts), shipped by the plugin. `failOn` is the
  // severity at which a pending commit/push/PR asks the agent for a11y review; "off"
  // disables the hook for this repo. Absent ⇒ "blocking", matching `init --hook`.
  hook?: { failOn?: string };
  // Defaults for `ultra11y tickets` (src/tickets/), so a repo declares its tracker once
  // instead of repeating flags in every CI step. Flags always win, the same precedence
  // `standard` has. CREDENTIALS ARE NOT ALLOWED HERE: this file is committed, so a token
  // key in this block is a hard error — they belong in the environment.
  tickets?: {
    provider?: "github" | "gitlab" | "jira";
    grain?: "criterion" | "page" | "page-criterion" | "single" | "file";
    transport?: "auto" | "cli" | "rest";
    maxTickets?: number;
  };
}

export interface LoadResult {
  defaultStandard?: string; // config.standard, if set (applied when no --standard flag)
  errors: string[]; // fatal: a bad config or an invalid pack
  loadedPacks: string[];
  loadedGuidance: string[];
}

const CONFIG_FILE = ".ultra11yrc.json";

export function loadConfig(cwd: string): Ultra11yConfig | null {
  const p = join(cwd, CONFIG_FILE);
  if (!existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readText(p));
  } catch {
    throw new Error(`${CONFIG_FILE}: not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${CONFIG_FILE}: must be a JSON object`);
  }
  return parsed as Ultra11yConfig;
}

/** A --pack path: a .json file IS the pack; a directory holds pack.json (+ optional
 *  glossary.json / guidance.json). Returns the resolved file paths, or null if absent. */
function packPaths(path: string): { pack: string; glossary?: string; guidance?: string } | null {
  if (!existsSync(path)) return null;
  if (statSync(path).isDirectory()) {
    const pack = join(path, "pack.json");
    if (!existsSync(pack)) return null;
    const glossary = join(path, "glossary.json");
    const guidance = join(path, "guidance.json");
    return {
      pack,
      glossary: existsSync(glossary) ? glossary : undefined,
      guidance: existsSync(guidance) ? guidance : undefined,
    };
  }
  return { pack: path };
}

/** Load + register every configured/flagged pack (and its guidance) into the registries.
 *  Must run BEFORE any `resolveStandard`/`loadPack` so a runtime pack is resolvable. */
export function loadRuntimeStandards(cwd: string, packFlags: string[], onWarn: (m: string) => void, override = false): LoadResult {
  const result: LoadResult = { errors: [], loadedPacks: [], loadedGuidance: [] };
  let config: Ultra11yConfig | null = null;
  try {
    config = loadConfig(cwd);
  } catch (e) {
    result.errors.push(e instanceof Error ? e.message : String(e));
    return result;
  }
  result.defaultStandard = config?.standard;

  for (const raw of [...(config?.packs ?? []), ...packFlags]) {
    // Relative pack paths resolve against the working dir (= the config dir), not the
    // process cwd, so `.ultra11yrc.json` entries work regardless of where node runs.
    const paths = packPaths(isAbsolute(raw) ? raw : join(cwd, raw));
    if (!paths) {
      result.errors.push(`--pack ${raw}: not found (expected a pack JSON file or a directory with pack.json)`);
      continue;
    }
    let packObj: unknown;
    try {
      packObj = JSON.parse(readText(paths.pack));
    } catch {
      result.errors.push(`--pack ${paths.pack}: not valid JSON`);
      continue;
    }
    let glossary: Glossary = {};
    if (paths.glossary) {
      try {
        glossary = JSON.parse(readText(paths.glossary)) as Glossary;
      } catch {
        onWarn(`ultra11y: ${paths.glossary} is not valid JSON — ignoring glossary.`);
      }
    }
    const v = registerRuntimePack(packObj, glossary, { override });
    for (const issue of v.issues) if (issue.severity === "warn") onWarn(`ultra11y: ${raw}: ${issue.path ? `${issue.path}: ` : ""}${issue.message}`);
    if (!v.ok || !v.pack) {
      result.errors.push(`--pack ${paths.pack}: invalid pack\n${formatIssues(v.issues).join("\n")}`);
      continue;
    }
    result.loadedPacks.push(v.pack.key);
    if (paths.guidance) loadGuidanceFile(paths.guidance, result, onWarn);
  }

  for (const g of config?.guidance ?? []) loadGuidanceFile(isAbsolute(g) ? g : join(cwd, g), result, onWarn);

  // Activate any opt-in secondary crosswalk mappings — AFTER every pack is registered, so a
  // mapping can target a built-in (rgaa) OR a just-loaded runtime pack. An unknown standard
  // (or the WCAG core, which has no pack criteria) is a hard error, never a silent skip.
  for (const sm of config?.secondaryMappings ?? []) {
    if (!sm || typeof sm.standard !== "string" || typeof sm.ruleId !== "string" || typeof sm.criterion !== "string") {
      result.errors.push("secondaryMappings: each entry must be { standard, ruleId, criterion, note? }");
      continue;
    }
    if (!getPack(sm.standard)) {
      result.errors.push(`secondaryMappings: unknown standard "${sm.standard}" (register its pack first; the WCAG core has no pack criteria)`);
      continue;
    }
    enableSecondaryMapping(sm.standard, { ruleId: sm.ruleId, criterion: sm.criterion, note: sm.note });
  }

  return result;
}

function loadGuidanceFile(path: string, result: LoadResult, onWarn: (m: string) => void): void {
  if (!existsSync(path)) {
    onWarn(`ultra11y: guidance ${path} not found — skipping.`);
    return;
  }
  let ds: GuidanceDataset;
  try {
    ds = JSON.parse(readText(path)) as GuidanceDataset;
  } catch {
    onWarn(`ultra11y: guidance ${path} is not valid JSON — skipping.`);
    return;
  }
  if (!ds || typeof ds.pack !== "string" || !Array.isArray(ds.entries)) {
    onWarn(`ultra11y: guidance ${path} is not a valid dataset (needs { pack, entries[] }) — skipping.`);
    return;
  }
  // Gate runtime guidance the SAME way `pack check` does, so fabrication can't sneak in via
  // the load path (a bogus criterionId / SC, or a malformed entry, is a hard error — never a
  // silent register). When the augmented pack isn't loaded, fall back to a structural check.
  const pack = getPack(ds.pack);
  if (pack) {
    const g = checkGuidance(ds, pack);
    for (const w of g.warnings) onWarn(`ultra11y: guidance ${path}: ${w}`);
    if (g.errors.length) {
      result.errors.push(`guidance ${path}: invalid\n${g.errors.map((e) => `  ✗ ${e}`).join("\n")}`);
      return;
    }
  } else {
    for (const e of ds.entries) {
      if (!Array.isArray(e?.wcag) || !Array.isArray(e?.examples)) {
        onWarn(`ultra11y: guidance ${path}: entry "${e?.id ?? "?"}" missing wcag[]/examples[] — skipping dataset.`);
        return;
      }
    }
  }
  if (hasGuidance(ds.pack)) onWarn(`ultra11y: guidance ${path} overrides the existing guidance for pack "${ds.pack}".`);
  registerRuntimeGuidance(ds);
  result.loadedGuidance.push(path);
}
