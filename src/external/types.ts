// AN AUDIT SOMEONE ELSE PERFORMED — the (page, criterion, status) record this engine lacked.
//
// A human auditor's verdict is EVIDENCE, not a measurement this tool can redo. So everything
// here is deliberately inert: an ExternalAudit is read, compared and reported, and never folded
// into an AuditResult, never written into `packAdjudication`, never allowed to change a status
// the engine decided. `src/external/` is a leaf.
//
// The shape is tool-neutral on purpose. ARA is the first adapter because its reports are public
// over a stable API, but the model is (page, criterion, status) — any external audit expressible
// that way fits, and only the adapter under `adapters/` ever knows the source's own vocabulary.
import type { Status } from "../types.js";

/** The status the source itself recorded, kept verbatim beside the mapped one.
 *
 *  Mapping is lossy in a way that MATTERS: a criterion the external auditor left untested and one
 *  they could not decide both become `manual` here, and the difference between "nobody looked"
 *  and "looked, could not rule" is the whole point of the `not-retested` bucket in a diff. The
 *  raw token is what lets the diff tell them apart, and what lets a reader audit the mapping. */
export interface ExternalCriterionResult {
  page: string; // an id from ExternalAudit.pages
  criterion: string; // the PACK's own criterion id, verbatim (RGAA "1.1", "10.11", …)
  status: Status; // mapped — never guessed; an unknown source token is an error, not a default
  rawStatus: string; // the source's own token ("NOT_TESTED", …)
  comment?: string; // the auditor's prose, VERBATIM — never summarised, never rewritten
  userImpact?: string; // the source's own impact token, when it records one
}

export interface ExternalAudit {
  tool: "ultra11y";
  kind: "external-audit";
  schemaVersion: 1;
  source: {
    adapter: string; // which adapter parsed it ("ara")
    id?: string; // the source's own report id
    url?: string; // where it came from
    importedAt: string; // ISO — supplied by the caller, never invented in a pure function
  };
  standard: string; // pack key; MUST resolve through the standards registry
  standardVersion?: string;
  date?: string; // the EXTERNAL audit's own date (YYYY-MM-DD), when the source states one
  procedure?: string; // what was audited, in the source's words
  auditor?: string;
  pages: { id: string; name: string; url: string }[];
  results: ExternalCriterionResult[];
}

/** One source's translator, and the ONLY module that knows that source's vocabulary.
 *
 *  `parse` is pure and total: it either returns an audit or the list of reasons it refused. It
 *  never throws on bad input and never fills a gap with a plausible default — an unrecognised
 *  status token, a criterion id the active pack does not define, a result pointing at a page the
 *  report never declared: each is REPORTED. Silently dropping any of them would produce a diff
 *  that looks complete and is not. */
export interface ExternalAdapter {
  id: string;
  parse(raw: unknown, opts: { importedAt: string; url?: string }): { ok: true; audit: ExternalAudit } | { ok: false; issues: string[] };
  /** The URL a bare report id resolves to. The one place a source's host is spelled out. */
  fetchUrl?(id: string): string;
}
