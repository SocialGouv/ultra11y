// A vendored dataset carries the day it was fetched (`fetchedAt`, or a dated `provenance`
// sentence). Stamping it with TODAY on every refresh made the daily cron commit eight files a
// day — the four vendored sources and the engine bundles that embed them, three of 3.7 MB —
// for a one-line diff that said nothing had changed. A stamp is a fact about the DATA: it
// moves when the data moves, and stays put when a refresh fetched the same bytes again.
import { readFileSync } from "node:fs";

/** The stamp field, by default `fetchedAt` — a bare date. */
const DEFAULT_STAMP = "fetchedAt";

/** A dated sentence (the universe's `provenance`) is the same stamp when only its date differs. */
const DATE_RE = /\d{4}-\d{2}-\d{2}/g;
export const sameButForTheDate = (a, b) => typeof a === "string" && typeof b === "string" && a.replace(DATE_RE, "<date>") === b.replace(DATE_RE, "<date>");

/** Return `next` carrying the stamp the committed file at `path` already has, when everything
 *  BUT the stamp is identical to that file — so a refresh that fetched the same source again
 *  writes the same bytes again. Any difference in the data, a missing or unreadable file, or
 *  a stamp that is not merely re-dated (`sameStamp`), hands back `next` untouched.
 *
 *  Identity is the serialised object minus the stamp, in the writer's own key order: the
 *  committed file was produced by the same writer, so a byte-level comparison is exact and
 *  needs no deep-equality rules of its own. */
export function withPreviousStamp(path, next, { stamp = DEFAULT_STAMP, sameStamp = () => true } = {}) {
  if (!(stamp in next)) return next;
  let prev;
  try {
    prev = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return next;
  }
  if (!prev || typeof prev !== "object" || !(stamp in prev)) return next;
  if (!sameStamp(prev[stamp], next[stamp])) return next;
  const strip = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== stamp)));
  if (strip(prev) !== strip(next)) return next;
  return { ...next, [stamp]: prev[stamp] };
}
