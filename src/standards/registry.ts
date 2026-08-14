// The standards registry: the WCAG 2.2 core ("wcag", canonical, lives in src/wcag.ts)
// plus the statically-imported country PACKS. Adding a country = drop a pack JSON under
// src/data/standards/ and add one `register(...)` line here (static imports are required
// so tsup inlines every pack into the single zero-dependency bundle — no runtime fs/glob).
import { AsyncLocalStorage } from "node:async_hooks";
import rgaaPack from "../data/standards/rgaa.json";
import rgaaGlossary from "../data/standards/rgaa.glossary.json";
import type { LocaleString, StandardPack } from "./types.js";
import type { Glossary } from "../types.js";
import { validatePack, type PackValidation } from "./validate.js";

export const CORE_KEY = "wcag";

interface Registered {
  pack: StandardPack;
  glossary: Glossary;
}

const registry = new Map<string, Registered>();

// ---- project scopes -------------------------------------------------------
//
// The registry above is process-wide, which is right for a CLI run: one process,
// one project, packs resolved once at startup. A long-lived MCP server is the
// other shape — it takes a `cwd` PER CALL, so two projects can each declare a
// pack under the same key, and the second must not overwrite the first.
//
// So a scope is an OVERLAY: packs registered for one project root, consulted
// before the global registry and invisible to every other root. Nothing that
// runs outside a scope changes behaviour.
//
// The ambient scope travels in an AsyncLocalStorage rather than a module-level
// variable, and that is load-bearing. The `audit()` helper in src/mcp/handlers.ts
// gets away with a process-global `process.chdir` only because `runAudit` is
// synchronous — no await point between the chdir and its `finally`, so the event
// loop cannot interleave another project. The MCP dispatch IS async: a plain
// "current scope" variable would race across concurrent project roots.
const overlays = new Map<string, Map<string, Registered>>();
const scopeStore = new AsyncLocalStorage<string>();

function currentOverlay(): Map<string, Registered> | undefined {
  const scope = scopeStore.getStore();
  return scope === undefined ? undefined : overlays.get(scope);
}

/** The overlay's entry for `key`, else the global one. */
function lookup(key: string): Registered | undefined {
  return currentOverlay()?.get(key) ?? registry.get(key);
}

/** Global registrations, with the current scope's overlay laid on top. */
function visible(): Map<string, Registered> {
  const overlay = currentOverlay();
  if (!overlay?.size) return registry;
  const merged = new Map(registry);
  for (const [key, entry] of overlay) merged.set(key, entry);
  return merged;
}

/** Run `fn` with `scope`'s packs laid over the global registry. No scope ⇒ unchanged. */
export function withScope<T>(scope: string | undefined, fn: () => T): T {
  return scope === undefined ? fn() : scopeStore.run(scope, fn);
}

/**
 * Register an external pack INTO one project scope — `registerRuntimePack`'s per-project
 * counterpart, with the same validation guardrail. Collisions are judged against what THIS
 * scope can see (the core, the built-ins, and packs already in this overlay), so two
 * projects may each ship a different `section508` without either shadowing the other.
 */
export function registerScoped(scope: string, raw: unknown, glossary: Glossary = {}, opts: { override?: boolean } = {}): PackValidation {
  const overlay = ensureScope(scope);
  const known = new Set([CORE_KEY, ...registry.keys(), ...overlay.keys()]);
  const v = validatePack(raw, { knownKeys: known, allowOverride: opts.override });
  if (v.ok && v.pack) overlay.set(v.pack.key, { pack: v.pack, glossary });
  return v;
}

/**
 * The pack object to MUTATE — `enableSecondaryMapping`'s copy-on-write guard.
 *
 * Inside a project scope, a built-in resolves from the shared global registry, and
 * `enableSecondaryMapping` edits its `secondaryMappings` in place. One project's
 * `.ultra11yrc.json` would then re-key the built-in RGAA pack for every OTHER project the
 * same server is serving — a silently different projection, which is precisely the failure
 * this tool must never produce. So a global pack is cloned into the overlay first, and the
 * project edits its own copy.
 */
function packForMutation(key: string): StandardPack {
  const overlay = currentOverlay();
  if (!overlay) return loadPack(key);
  const own = overlay.get(key);
  if (own) return own.pack;
  const shared = registry.get(key);
  if (!shared) return loadPack(key); // throws, with the known-packs list
  const copy: Registered = { pack: structuredClone(shared.pack), glossary: shared.glossary };
  overlay.set(key, copy);
  return copy.pack;
}

/** Create the scope's (possibly empty) overlay and return it. */
export function ensureScope(scope: string): Map<string, Registered> {
  let overlay = overlays.get(scope);
  if (!overlay) {
    overlay = new Map();
    overlays.set(scope, overlay);
  }
  return overlay;
}

/** Whether this scope's packs have already been resolved — the memo the MCP server reads. */
export function scopeLoaded(scope: string): boolean {
  return overlays.has(scope);
}

/** Forget one scope, so a failed load is retried rather than memoized as "done". */
export function dropScope(scope: string): void {
  overlays.delete(scope);
}

/** Test seam: forget every project scope. Never call this from product code. */
export function resetScopes(): void {
  overlays.clear();
}

function register(pack: StandardPack, glossary: Glossary): void {
  if (pack.key === CORE_KEY) throw new Error(`pack key "${CORE_KEY}" is reserved for the WCAG core`);
  registry.set(pack.key, { pack, glossary });
}

register(rgaaPack as unknown as StandardPack, rgaaGlossary as unknown as Glossary);

/**
 * Register an EXTERNAL pack at runtime (from `--pack` / `.ultra11yrc.json`) — the
 * pluggable counterpart to the build-time `register` above. It runs the shared
 * `validatePack` guardrail first; on ANY error-severity issue it does not register and
 * returns the validation so the caller can fail loudly (never a silent accept). A key
 * that collides with a built-in/loaded standard is an error unless `opts.override`.
 */
export function registerRuntimePack(raw: unknown, glossary: Glossary = {}, opts: { override?: boolean } = {}): PackValidation {
  const v = validatePack(raw, { knownKeys: new Set(listStandards()), allowOverride: opts.override });
  if (v.ok && v.pack) registry.set(v.pack.key, { pack: v.pack, glossary });
  return v;
}

/**
 * Activate a SECONDARY crosswalk mapping on an already-registered pack (from
 * `.ultra11yrc.json` — see src/config.ts `loadRuntimeStandards`). Flips `enabled: true` on
 * a pack-shipped mapping matching the (ruleId, criterion) pair, or APPENDS a new enabled
 * one when the pack ships none — the opt-in switch that lets a config activate the
 * WCAG-crosswalk-bypassing projection out-of-box packs ship DISABLED. Throws on an unknown
 * pack key (never a silent no-op). Mutates the registered pack in place, by design.
 */
export function enableSecondaryMapping(packKey: string, m: { ruleId: string; criterion: string; note?: LocaleString }): void {
  const pack = packForMutation(packKey); // throws on unknown key
  const list = (pack.secondaryMappings ??= []);
  const existing = list.find((x) => x.ruleId === m.ruleId && x.criterion === m.criterion);
  if (existing) {
    existing.enabled = true;
    if (m.note) existing.note = m.note;
  } else {
    list.push({ ruleId: m.ruleId, criterion: m.criterion, ...(m.note ? { note: m.note } : {}), enabled: true });
  }
}

export function isCore(key: string): boolean {
  return key === CORE_KEY;
}

export function hasStandard(key: string): boolean {
  return key === CORE_KEY || lookup(key) !== undefined;
}

/** Resolve a pack by key; throws on unknown (never silently falls back to the core). */
export function loadPack(key: string): StandardPack {
  const r = lookup(key);
  if (!r) throw new Error(`unknown standards pack "${key}" (known packs: ${[...visible().keys()].join(", ") || "none"})`);
  return r.pack;
}

export function getPack(key: string): StandardPack | undefined {
  return lookup(key)?.pack;
}

export function packGlossary(key: string): Glossary | undefined {
  return lookup(key)?.glossary;
}

/** All standard keys: the core first, then every registered pack. */
export function listStandards(): string[] {
  return [CORE_KEY, ...visible().keys()];
}

export function listPacks(): StandardPack[] {
  return [...visible().values()].map((r) => r.pack);
}

/** Reverse cross-reference: which packs (and their criterion ids) map to a WCAG SC. */
export function packsForSc(sc: string): { key: string; ids: string[] }[] {
  const out: { key: string; ids: string[] }[] = [];
  for (const { pack } of visible().values()) {
    const ids = pack.criteria.filter((c) => c.wcag.includes(sc)).map((c) => c.id);
    if (ids.length) out.push({ key: pack.key, ids });
  }
  return out;
}
