// Which external audit tools can be imported. A CLOSED union that throws on an unknown id —
// the same posture `resolveStandard` and the ticket provider registry take. A registry that fell
// back to some default adapter would parse an ARA report with a Wave parser and report the
// resulting nonsense as an audit.
import type { ExternalAdapter } from "./types.js";
import { araAdapter } from "./adapters/ara.js";

export const EXTERNAL_SOURCES = ["ara"] as const;
export type ExternalSourceId = (typeof EXTERNAL_SOURCES)[number];

export function isExternalSource(x: string): x is ExternalSourceId {
  return (EXTERNAL_SOURCES as readonly string[]).includes(x);
}

export function createAdapter(id: string): ExternalAdapter {
  switch (id) {
    case "ara":
      return araAdapter;
    default:
      throw new Error(`unknown external audit source "${id}" — expected one of: ${EXTERNAL_SOURCES.join(", ")}`);
  }
}
