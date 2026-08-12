// THE TICKET ENGINE'S CONTRACT — deliberately provider-neutral.
//
// A ticket is what a tracker files. It is NOT a report: `report`/`prd` render Markdown to
// disk and push nothing, `tickets` builds Tickets and pushes them and writes no Markdown.
// That split is the whole point of this package; keep it.
//
// Two invariants govern every type below:
//
//   1. THE TITLE IS THE DE-DUPE KEY. No hidden marker, no state file, no id map. It is the
//      only identifier that survives a round-trip through GitHub, GitLab AND Jira without
//      persisting anything. `list()` returns titles; the comparison is EXACT and happens
//      client-side, in a pure function — which is what lets Jira participate despite JQL's
//      `~` being a fuzzy, punctuation-stripping text match (its search only narrows the
//      candidate set, it never decides).
//
//   2. THE INTERFACE STAYS NARROW. Jira's project key, issue type and priority are provider
//      CONFIG, mapped inside src/tickets/providers/jira.ts. Widening TicketProvider for one
//      tracker's field set is exactly the coupling this seam exists to prevent.
import type { Lang, Severity } from "../types.js";
import type { StandardId } from "../standards/index.js";

export type ProviderId = "github" | "gitlab" | "jira";
export type TransportMode = "auto" | "cli" | "rest";
export type TicketGrain = "criterion" | "page" | "page-criterion" | "single" | "file";

export const ALL_PROVIDERS: readonly ProviderId[] = ["github", "gitlab", "jira"];
export const ALL_GRAINS: readonly TicketGrain[] = ["criterion", "page", "page-criterion", "single", "file"];

/** The id used in a page-grain title when a finding belongs to no page. Part of the de-dupe
 *  grain, so it must never drift. */
export const UNATTRIBUTED_ID = "unattributed";

/** What produced a ticket. Carried for `--json` and for provider-specific field mapping;
 *  never part of the de-dupe key (the title already carries everything that identifies it). */
export type TicketScope =
  | { grain: "criterion"; criteriaId: string }
  | { grain: "single" }
  | { grain: "page"; pageId: string; pageName: string; url: string; auth?: boolean; basis: "snapshot" | "attributed" | "none" }
  | { grain: "page-criterion"; pageId: string; pageName: string; url: string; auth?: boolean; basis: "snapshot" | "attributed"; criteriaId: string }
  | { grain: "file"; file: string };

export interface Ticket {
  /** The tracker title AND the de-dupe key. Stable across re-runs, disjoint across grains. */
  title: string;
  body: string;
  labels: string[];
  severity: Severity;
  /** True when every finding behind this ticket is non-normative: a recommendation, never
   *  a non-conformity. Routed to the `recommendation` label, never the NC channel. */
  advisory: boolean;
  scope: TicketScope;
}

export interface GrainOptions {
  grain: TicketGrain;
  standard: StandardId;
  lang: Lang;
  /** Mirrors `prd --format`: the auditor block (default) or the legacy dev body. */
  format?: "audit" | "remediation";
  /** Provider body budget in characters; bodies are clamped to it. */
  bodyLimit?: number;
  /** Emit the technical ticket sections (Partie technique / Contexte de reproduction). */
  technical?: boolean;
}

export interface TicketPlan {
  tickets: Ticket[];
  /** Findings no page claimed (page grains only). Surfaced, never dropped, never spread. */
  unattributed: number;
  /** A grain that cannot be built from this audit. The CLI turns it into an exit code and a
   *  remedy; `buildTickets` never throws and never prints. */
  error?: "no-pages";
}

// ---- provider side -----------------------------------------------------------------------

export interface ProviderCapabilities {
  /** Body budget in characters. GitHub 65536, GitLab 1000000, Jira 32767. */
  bodyLimit: number;
  /** False ⇒ the driver drops `labels` and says so ONCE, instead of losing them silently. */
  labels: boolean;
}

export interface ExistingTicket {
  title: string;
  id?: string;
  url?: string;
}

export interface CreateOutcome {
  ok: boolean;
  id?: string;
  url?: string;
  /** A concise, single-line reason. MUST NEVER contain a token value. */
  reason?: string;
}

export interface TicketProvider {
  readonly id: ProviderId;
  /** The transport actually resolved — never "auto". Surfaced in `--json` and `--dry-run`. */
  readonly transport: "cli" | "rest";
  readonly capabilities: ProviderCapabilities;
  /** Configured AND reachable here. Pure of console; never throws. */
  available(): boolean;
  /** Why not — surfaced verbatim. Names the missing ENV VAR, never its value. */
  unavailableReason(): string | undefined;
  /** Existing tickets, for de-dupe. MUST return [] on ANY failure rather than throw: a
   *  listing failure degrades to "create", the same trade-off `pushPrComment` already makes
   *  (a duplicate ticket is a far smaller harm than dropping the whole backlog). */
  list(): Promise<ExistingTicket[]>;
  create(t: Ticket): Promise<CreateOutcome>;
}

export interface PushResult {
  created: number;
  skipped: number;
  failed: number;
  createdTitles: string[];
  createdUrls: string[];
  /** Concise, de-duplicated provider failure reasons (empty when nothing failed). */
  errors: string[];
}
