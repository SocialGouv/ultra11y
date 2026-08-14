// Barrel + the `--standard <id>` resolver. `StandardId` is either the reserved core key
// "wcag" or a registered pack key. The default is the WCAG core; an unknown value throws
// (never a silent fallback).
import { CORE_KEY, hasStandard, isCore, listStandards, loadPack } from "./registry.js";

export type StandardId = string;
export const CORE: StandardId = CORE_KEY;

export function resolveStandard(flag: string | boolean | undefined): StandardId {
  if (flag === undefined || flag === true || flag === "") return CORE_KEY;
  const key = String(flag).toLowerCase();
  if (!hasStandard(key)) {
    throw new Error(`unknown standard "${key}" (known: ${listStandards().join(", ")})`);
  }
  return key;
}

/** Display label for the active standard: "WCAG 2.2 AA" for the core, "<pack name>
 *  <baseVersion>" for a pack (e.g. "RGAA 4.1.2"). Was duplicated as `stdLabel()` in both
 *  auditor.ts and prd.ts. */
export function standardLabel(standard: StandardId): string {
  if (isCore(standard)) return "WCAG 2.2 AA";
  const p = loadPack(standard);
  return `${p.name} ${p.baseVersion}`;
}

export * from "./types.js";
export * from "./registry.js";
export * from "./pack.js";
export * from "./derive.js";
export * from "./vocabulary.js";
export * from "./coverage.js";
