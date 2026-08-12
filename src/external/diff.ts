// AN EXTERNAL VERDICT, HELD AGAINST OURS — and against a previous external one.
//
// NOTHING IS RE-DECIDED HERE. Both sides arrive already decided: the left from
// `derivePackResults(pageView(...))`, the right from an adapter. This module joins them on
// (page, criterion) and sorts the pairs into buckets. It never adjusts a status, never resolves a
// disagreement, and never lets one side's silence stand for the other's verdict — a criterion
// only one side ruled on lands in `only-*`, which is a finding about COVERAGE, not conformity.
//
// The buckets exist because reconciling two audits by hand always produces the same five
// questions, and the fifth is the one no report answers: a criterion that was non-conforming and
// is now untested is neither fixed nor broken, and reading it as either is how a remediation
// claims wins it did not earn.
import type { Status } from "../types.js";
import type { ExternalAudit } from "./types.js";

export type DiffBucket =
  | "fixed" // was NC, now C
  | "unchanged" // same status on both sides
  | "partially-fixed" // was NC, now decided but still not conforming (NA is not a fix)
  | "regressed" // was C or NA, now NC
  | "not-retested" // was NC, and the later side never ruled on it again
  | "only-left" // ours ruled, theirs did not
  | "only-right"; // theirs ruled, ours did not — the "your grid has nothing there" case

export interface DiffRow {
  page: string;
  criterion: string;
  left: Status | null; // null = this side never ruled
  right: Status | null;
  leftRaw?: string;
  rightRaw?: string;
  bucket: DiffBucket;
  comment?: string; // the external auditor's prose, carried through verbatim
}

export interface DiffResult {
  rows: DiffRow[];
  counts: Record<DiffBucket, number>;
  /** Pages one side knows and the other does not — the coverage question the buckets cannot
   *  express, and the one that caught a criterion reported on a funnel and ticketed against a
   *  stats page. */
  pagesOnlyLeft: string[];
  pagesOnlyRight: string[];
}

export interface DiffSide {
  /** page id → criterion id → status */
  byPage: Map<string, Map<string, Status>>;
  raw?: Map<string, Map<string, string>>;
  comments?: Map<string, Map<string, string>>;
}

/** Index an imported audit for the join. Exported so both `pages --diff` (external vs ours) and
 *  an audit-vs-audit comparison use ONE indexing, not two that can disagree. */
export function sideOfExternal(a: ExternalAudit): DiffSide {
  const byPage = new Map<string, Map<string, Status>>();
  const raw = new Map<string, Map<string, string>>();
  const comments = new Map<string, Map<string, string>>();
  for (const r of a.results) {
    const put = <T>(m: Map<string, Map<string, T>>, v: T): void => {
      const inner = m.get(r.page) ?? new Map<string, T>();
      inner.set(r.criterion, v);
      m.set(r.page, inner);
    };
    put(byPage, r.status);
    put(raw, r.rawStatus);
    if (r.comment) put(comments, r.comment);
  }
  return { byPage, raw, comments };
}

/** A status nobody ruled on. `manual` is "undecided", so it is NOT a verdict to compare — reading
 *  it as one is how "to assess" quietly becomes "agrees with you". */
const ruled = (s: Status | undefined): s is Status => s !== undefined && s !== "manual";

function bucketOf(left: Status | null, right: Status | null, rightRaw: string | undefined): DiffBucket {
  if (left === null && right === null) return "unchanged"; // neither ruled — nothing to say
  if (right === null) {
    // The left side found a non-conformity and the right never came back to it. That is the
    // bucket that goes missing in every hand reconciliation.
    return left === "NC" ? "not-retested" : "only-left";
  }
  if (left === null) return "only-right";
  if (left === right) return "unchanged";
  if (left === "NC") return right === "C" ? "fixed" : "partially-fixed";
  return right === "NC" ? "regressed" : "unchanged";
}

const EMPTY_COUNTS = (): Record<DiffBucket, number> => ({
  fixed: 0,
  unchanged: 0,
  "partially-fixed": 0,
  regressed: 0,
  "not-retested": 0,
  "only-left": 0,
  "only-right": 0,
});

/** Join two decided sides on (page, criterion).
 *
 *  `left` is the earlier / reference side (our grid, or audit N−1), `right` the later one. Every
 *  (page, criterion) either side ruled on produces exactly one row, so the row count is the size
 *  of the union and nothing can be dropped by being absent from one side. */
export function diffSides(left: DiffSide, right: DiffSide): DiffResult {
  const pages = [...new Set([...left.byPage.keys(), ...right.byPage.keys()])].sort();
  const rows: DiffRow[] = [];
  const counts = EMPTY_COUNTS();

  for (const page of pages) {
    const l = left.byPage.get(page);
    const r = right.byPage.get(page);
    const criteria = [...new Set([...(l?.keys() ?? []), ...(r?.keys() ?? [])])].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    for (const criterion of criteria) {
      const lv = l?.get(criterion);
      const rv = r?.get(criterion);
      const leftStatus = ruled(lv) ? lv : null;
      const rightStatus = ruled(rv) ? rv : null;
      const rightRaw = right.raw?.get(page)?.get(criterion);
      const bucket = bucketOf(leftStatus, rightStatus, rightRaw);
      // Two criteria neither side ruled on carry no information; keeping them would bury the
      // rows that do under a hundred rows of "à évaluer both sides".
      if (leftStatus === null && rightStatus === null) continue;
      counts[bucket]++;
      rows.push({
        page,
        criterion,
        left: leftStatus,
        right: rightStatus,
        ...(left.raw?.get(page)?.get(criterion) ? { leftRaw: left.raw.get(page)!.get(criterion)! } : {}),
        ...(rightRaw ? { rightRaw } : {}),
        bucket,
        ...(right.comments?.get(page)?.get(criterion) ? { comment: right.comments.get(page)!.get(criterion)! } : {}),
      });
    }
  }

  return {
    rows,
    counts,
    pagesOnlyLeft: [...left.byPage.keys()].filter((p) => !right.byPage.has(p)).sort(),
    pagesOnlyRight: [...right.byPage.keys()].filter((p) => !left.byPage.has(p)).sort(),
  };
}
