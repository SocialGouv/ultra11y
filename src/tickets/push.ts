// THE DRIVER — the one place that turns a Ticket[] into tracker state.
//
// It is split in two on purpose: `planPush` is PURE (it decides create-vs-skip and is the
// thing worth testing exhaustively), `pushTickets` is the thin async shell that actually
// calls the provider. De-dupe therefore has no dependency on any tracker's search semantics.
import type { CreateOutcome, ExistingTicket, PushResult, Ticket, TicketProvider } from "./types.js";

export interface PlannedTicket {
  ticket: Ticket;
  action: "create" | "skip";
}

/** Decide, for each ticket, whether it already exists. EXACT title comparison — never a
 *  fuzzy one, whatever the tracker's own search does (Jira's JQL `~` strips punctuation and
 *  would happily call two distinct criteria the same ticket).
 *
 *  The `seen` set also guards WITHIN a run: two identical titles in one batch create once. */
export function planPush(tickets: Ticket[], existing: ExistingTicket[]): PlannedTicket[] {
  const seen = new Set(existing.map((e) => e.title));
  return tickets.map((ticket) => {
    if (seen.has(ticket.title)) return { ticket, action: "skip" as const };
    seen.add(ticket.title);
    return { ticket, action: "create" as const };
  });
}

function emptyResult(): PushResult {
  return { created: 0, skipped: 0, failed: 0, createdTitles: [], createdUrls: [], errors: [] };
}

/** Record a failure, keeping distinct reasons (de-duplicated) for surfacing. */
function recordFailure(result: PushResult, reason?: string): void {
  result.failed++;
  if (reason && !result.errors.includes(reason)) result.errors.push(reason);
}

export interface PushOptions {
  /** Build the plan and report it, create nothing. */
  dryRun?: boolean;
}

export interface PushOutcome {
  plan: PlannedTicket[];
  result: PushResult;
  /** False when the existing-ticket listing failed or was skipped, so the caller can say
   *  "skipped counts are unverified" instead of implying it checked. */
  dedupeChecked: boolean;
}

/** List, plan, then create. Creation is SEQUENTIAL: deterministic ordering and rate-limit
 *  safety beat parallel speed when the side effect is somebody's issue tracker. */
export async function pushTickets(tickets: Ticket[], provider: TicketProvider, opts: PushOptions = {}): Promise<PushOutcome> {
  const result = emptyResult();
  if (!tickets.length) return { plan: [], result, dedupeChecked: false };

  // A listing failure degrades to "create everything" rather than dropping the backlog —
  // the same trade-off pushPrComment makes. `list()` is contractually non-throwing, but a
  // provider bug must not take the run down, so it is guarded anyway.
  let existing: ExistingTicket[] = [];
  let dedupeChecked = false;
  try {
    existing = await provider.list();
    dedupeChecked = true;
  } catch {
    dedupeChecked = false;
  }

  const plan = planPush(tickets, existing);
  if (opts.dryRun) {
    result.skipped = plan.filter((p) => p.action === "skip").length;
    return { plan, result, dedupeChecked };
  }

  for (const { ticket, action } of plan) {
    if (action === "skip") {
      result.skipped++;
      continue;
    }
    let outcome: CreateOutcome;
    try {
      outcome = await provider.create(ticket);
    } catch (e) {
      outcome = { ok: false, reason: e instanceof Error ? e.message.split("\n")[0] : String(e) };
    }
    if (outcome.ok) {
      result.created++;
      result.createdTitles.push(ticket.title);
      if (outcome.url) result.createdUrls.push(outcome.url);
    } else {
      recordFailure(result, outcome.reason);
    }
  }
  return { plan, result, dedupeChecked };
}
