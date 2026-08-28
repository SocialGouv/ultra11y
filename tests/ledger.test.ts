import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AdjudicationFile, type AdjudicationItem, applyAdjudication, buildAdjudicationWorklist } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import {
  emptyLedger,
  entriesFrom,
  evidenceFingerprint,
  isLedger,
  ledgerPath,
  mergeLedger,
  pruneLedger,
  readLedger,
  replayLedger,
  writeLedger,
} from "../src/ledger.js";
import { PAGES_DIR } from "../src/snapshot.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-ledger-"));

const PAGE_HTML = `<!doctype html>
<html lang="en">
<head><title>Shop</title></head>
<body>
<main>
<h1>Welcome</h1>
<img src="hero.png" alt="A hiker on a ridge at sunrise">
<a href="/pricing">Read more</a>
<label for="email">Email</label><input id="email" type="email">
</main>
</body>
</html>
`;

/** A page written under its own name, so each test owns its file and can rewrite it. */
function page(name: string, html = PAGE_HTML): string {
  const f = join(dir, name);
  writeFileSync(f, html);
  return f;
}

const auditOf = (f: string) => runAudit({ inputs: [f] });

const file = (items: AdjudicationItem[], auditDate = "2026-08-17"): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "wcag",
  auditDate,
  items,
});

/** Fill a worklist the way a well-behaved adjudicator would: clear the criteria that carry
 *  evidence (citing it), and leave the rest explicitly manual. */
function adjudicate(items: AdjudicationItem[], maxCleared = 6): AdjudicationItem[] {
  let cleared = 0;
  return items.map((i) => {
    if (i.evidence.length && cleared < maxCleared) {
      cleared++;
      return { ...i, verdict: "C" as const, justification: "Assessed conforming against the harvested evidence.", citations: [i.evidence[0]!] };
    }
    return { ...i, verdict: "manual" as const, reason: "undecidable" };
  });
}

/** Adjudicate an audit and record the accepted verdicts, exactly as `verify --apply --ledger`
 *  does — the fold decides what is allowed into the ledger, never the caller. */
function recordLedger(f: string) {
  const audit = auditOf(f);
  const adj = file(adjudicate(buildAdjudicationWorklist(audit)));
  const r = applyAdjudication(audit, adj, { cwd: process.cwd() });
  const refused = new Set(r.rejectedCriteria);
  const accepted = new Set(adj.items.map((i) => i.criteriaId).filter((id) => !refused.has(id)));
  return { audit, adj, applied: r, ledger: mergeLedger(undefined, "wcag", entriesFrom(adj, accepted, audit.date)) };
}

const gridOf = (a: { criteria: { id: string; status: string; decidedBy?: string }[] }) =>
  a.criteria
    .map((c) => `${c.id}=${c.status}/${c.decidedBy ?? "engine"}`)
    .sort()
    .join("\n");

describe("evidenceFingerprint", () => {
  const ev = (over: Partial<{ file: string; line: number; selector: string; snippet: string }> = {}) => ({
    file: "a.html",
    line: 7,
    selector: "img",
    snippet: '<img alt="x">',
    ...over,
  });

  it("ignores line numbers — a reformatting must not invalidate a verdict", () => {
    expect(evidenceFingerprint([ev()])).toBe(evidenceFingerprint([ev({ line: 412 })]));
  });

  it("ignores order — the harvester's traversal is not a property of the code", () => {
    const a = ev();
    const b = ev({ selector: "a", snippet: "<a>x</a>" });
    expect(evidenceFingerprint([a, b])).toBe(evidenceFingerprint([b, a]));
  });

  it("changes when the snippet, the selector, the file or the count changes", () => {
    const base = evidenceFingerprint([ev()]);
    expect(evidenceFingerprint([ev({ snippet: '<img alt="y">' })])).not.toBe(base);
    expect(evidenceFingerprint([ev({ selector: "figure" })])).not.toBe(base);
    expect(evidenceFingerprint([ev({ file: "b.html" })])).not.toBe(base);
    expect(evidenceFingerprint([ev(), ev({ selector: "a" })])).not.toBe(base);
  });

  it("normalises whitespace, so a re-indent is not a change", () => {
    expect(evidenceFingerprint([ev({ snippet: '<img    alt="x">' })])).toBe(evidenceFingerprint([ev({ snippet: '<img\n  alt="x">' })]));
  });

  it("ignores the checkout prefix of a page snapshot, but keeps its page identity", () => {
    const a = ev({ file: `/tmp/runner-a/repo/${PAGES_DIR}/accueil/dom.html` });
    const b = ev({ file: `/home/runner/work/repo/${PAGES_DIR}/accueil/dom.html` });
    const other = ev({ file: `/home/runner/work/repo/${PAGES_DIR}/contact/dom.html` });
    expect(evidenceFingerprint([a])).toBe(evidenceFingerprint([b]));
    expect(evidenceFingerprint([a])).not.toBe(evidenceFingerprint([other]));
  });

  it("ignores a capture header's transport URL but not the captured page identity", () => {
    const atA = ev({
      file: `${PAGES_DIR}/accueil/dom.html`,
      snippet: '<!-- ultra11y:capture v="1" page="accueil" url="http://127.0.0.1:8932/" -->',
    });
    const atB = ev({
      file: `${PAGES_DIR}/accueil/dom.html`,
      snippet: '<!-- ultra11y:capture v="1" page="accueil" url="https://ci.example.test/" -->',
    });
    const other = ev({ ...atB, file: `${PAGES_DIR}/contact/dom.html` });
    expect(evidenceFingerprint([atA])).toBe(evidenceFingerprint([atB]));
    expect(evidenceFingerprint([atA])).not.toBe(evidenceFingerprint([other]));
  });
});

// THE POINT OF THE WHOLE MECHANISM. A CI job has no model in the loop, so before the ledger it
// could only ever publish « to assess » for every judgment criterion. Replaying has to land the
// same grid a session landed — and it has to do it by re-proving each verdict, not by trusting
// the file.
describe("replayLedger — parity with the adjudicated audit, without a model", () => {
  it("reproduces the adjudicated grid exactly on a fresh audit", () => {
    const f = page("parity.html");
    const { applied, ledger } = recordLedger(f);

    const fresh = auditOf(f); // what CI computes from scratch
    const rp = replayLedger(fresh, ledger, { cwd: process.cwd() });
    const replayed = applyAdjudication(fresh, rp.adj, { cwd: process.cwd(), residualReasons: rp.residualReasons });

    expect(gridOf(replayed.audit)).toBe(gridOf(applied.audit));
    expect(replayed.audit.conformancePct).toBe(applied.audit.conformancePct);
    expect(replayed.audit.residualRisks.length).toBe(applied.audit.residualRisks.length);
    expect(replayed.applied).toBe(applied.applied);
    expect(replayed.rejected).toBe(0);
    expect(rp.stale).toEqual([]);
    expect(rp.missing).toEqual([]);
  });

  it("survives a pure line shift — a comment at the top must not refuse every verdict", () => {
    // Regression: the fingerprint is line-independent but the fold's citation check is exact
    // (`file:line` against the criterion's own anchors). Without re-anchoring, inserting one
    // line refused every stored verdict in the file as fabricated.
    const f = page("shift.html");
    const { ledger } = recordLedger(f);

    // The inserted text must be inert: it has to shift lines WITHOUT adding evidence to any
    // criterion, or the verdict is legitimately stale and the test proves nothing. (The
    // original wording said "below", which the sensory-characteristics harvest reads as a
    // candidate instruction — so 1.3.3 really had gained an anchor.)
    writeFileSync(f, PAGE_HTML.replace('<html lang="en">', '<html lang="en">\n<!-- inert line shift -->'));
    const shifted = auditOf(f);
    const rp = replayLedger(shifted, ledger, { cwd: process.cwd() });
    const r = applyAdjudication(shifted, rp.adj, { cwd: process.cwd(), residualReasons: rp.residualReasons });

    expect(rp.stale).toEqual([]);
    expect(r.rejected).toBe(0);
    expect(r.applied).toBeGreaterThan(0);
  });

  it("reanchors snapshot citations when the same audit is replayed in another checkout", () => {
    const snapshot = (root: string): string => {
      const path = join(root, PAGES_DIR, "accueil", "dom.html");
      mkdirSync(join(root, PAGES_DIR, "accueil"), { recursive: true });
      writeFileSync(path, `<!-- ultra11y:capture v="1" page="accueil" url="https://example.test/" -->\n${PAGE_HTML}`);
      return path;
    };
    const first = snapshot(mkdtempSync(join(tmpdir(), "u11y-ledger-first-")));
    const second = snapshot(mkdtempSync(join(tmpdir(), "u11y-ledger-second-")));
    const { ledger } = recordLedger(first);
    // Claude commonly omits this optional field. The evidence content and location still
    // identify the unique anchor, so checkout portability must not depend on it.
    const image = ledger.entries.find((entry) => entry.criteriaId === "1.1.1");
    if (image?.citations) image.citations = image.citations.map((citation) => ({ ...citation, selector: "" }));
    const audit = auditOf(second);
    const rp = replayLedger(audit, ledger, { cwd: process.cwd() });
    const applied = applyAdjudication(audit, rp.adj, { cwd: process.cwd(), residualReasons: rp.residualReasons });

    expect(rp.stale).toEqual([]);
    expect(applied.rejected).toBe(0);
    expect(applied.applied).toBeGreaterThan(0);
  });

  it("drops a verdict as stale when the evidence it read changed, and says so", () => {
    const f = page("stale.html");
    const { ledger } = recordLedger(f);
    expect(ledger.entries.find((e) => e.criteriaId === "1.1.1")?.verdict).toBe("C");

    writeFileSync(f, PAGE_HTML.replace('alt="A hiker on a ridge at sunrise"', 'alt="img"'));
    const after = auditOf(f);
    const rp = replayLedger(after, ledger, { cwd: process.cwd() });

    expect(rp.stale).toContain("1.1.1");
    expect(rp.fresh).not.toContain("1.1.1");
    expect(rp.residualReasons["1.1.1"]).toMatch(/STALE/);
    expect(rp.residualReasons["1.1.1"]).toMatch(/evidence changed/i);

    // …and the criterion is back to « to assess », carrying that reason rather than a blank.
    const r = applyAdjudication(after, rp.adj, { cwd: process.cwd(), residualReasons: rp.residualReasons });
    expect(r.audit.criteria.find((c) => c.id === "1.1.1")!.status).toBe("manual");
    expect(r.audit.residualRisks.find((x) => x.criteriaId === "1.1.1")!.reason).toMatch(/STALE/);
  });

  it("names an open criterion the ledger never covered, instead of calling it a coverage gap", () => {
    const f = page("missing.html");
    const { audit, ledger } = recordLedger(f);
    const dropped = ledger.entries[0]!.criteriaId;
    const thin = { ...ledger, entries: ledger.entries.slice(1) };

    const rp = replayLedger(audit, thin, { cwd: process.cwd() });
    expect(rp.missing).toContain(dropped);
    expect(rp.residualReasons[dropped]).toMatch(/never been adjudicated/i);

    // An absence the caller declared is not a gate violation: the rest still folds.
    const r = applyAdjudication(audit, rp.adj, { cwd: process.cwd(), residualReasons: rp.residualReasons });
    expect(r.rejected).toBe(0);
    expect(r.issues).toEqual([]);
    expect(r.audit.residualRisks.find((x) => x.criteriaId === dropped)!.reason).toMatch(/never been adjudicated/i);
  });

  it("reports an entry the engine now decides itself as obsolete, and never folds it", () => {
    const f = page("obsolete.html");
    const { audit, ledger } = recordLedger(f);
    // 3.1.1 (Language of Page) is engine-decided on this page — it is not open, so a stored
    // verdict for it must be ignored rather than allowed to overwrite the engine.
    const withIntruder = mergeLedger(ledger, "wcag", [
      { criteriaId: "3.1.1", verdict: "NC", evidenceFingerprint: "sha256:whatever", evidenceCount: 0, date: "2026-08-17", decidedBy: "agent" },
    ]);

    const rp = replayLedger(audit, withIntruder, { cwd: process.cwd() });
    expect(rp.obsolete).toContain("3.1.1");
    expect(rp.adj.items.some((i) => i.criteriaId === "3.1.1")).toBe(false);

    const r = applyAdjudication(audit, rp.adj, { cwd: process.cwd(), residualReasons: rp.residualReasons });
    expect(r.audit.criteria.find((c) => c.id === "3.1.1")!.decidedBy).not.toBe("agent");
  });
});

describe("the ledger records only what the fold accepted", () => {
  it("never stores a refused verdict — it would be laundered back on the next replay", () => {
    const f = page("refused.html");
    const audit = auditOf(f);
    // A C verdict citing evidence it was never shown: the fabrication check refuses it.
    const items = buildAdjudicationWorklist(audit).map((i) =>
      i.criteriaId === "2.4.4"
        ? { ...i, verdict: "C" as const, justification: "looks fine", citations: [{ file: f, line: 999, selector: "a", snippet: "invented" }] }
        : { ...i, verdict: "manual" as const, reason: "undecidable" },
    );
    const adj = file(items);
    const r = applyAdjudication(audit, adj, { cwd: process.cwd() });
    expect(r.rejectedCriteria).toContain("2.4.4");

    const refused = new Set(r.rejectedCriteria);
    const accepted = new Set(adj.items.map((i) => i.criteriaId).filter((id) => !refused.has(id)));
    const entries = entriesFrom(adj, accepted, audit.date);
    expect(entries.some((e) => e.criteriaId === "2.4.4")).toBe(false);
  });

  it("skips an unadjudicated item", () => {
    const f = page("null.html");
    const audit = auditOf(f);
    const adj = file(buildAdjudicationWorklist(audit)); // every verdict null
    const all = new Set(adj.items.map((i) => i.criteriaId));
    expect(entriesFrom(adj, all, audit.date)).toEqual([]);
  });
});

describe("mergeLedger", () => {
  const entry = (criteriaId: string, date: string, verdict: "C" | "NA" = "C") => ({
    criteriaId,
    verdict,
    evidenceFingerprint: `sha256:${criteriaId}`,
    evidenceCount: 1,
    date,
    decidedBy: "agent" as const,
  });

  it("keeps entries a partial refresh did not touch", () => {
    const base = mergeLedger(undefined, "wcag", [entry("1.1.1", "2026-01-01"), entry("2.4.4", "2026-01-01")]);
    const merged = mergeLedger(base, "wcag", [entry("2.4.4", "2026-08-17", "NA")]);

    expect(merged.entries).toHaveLength(2);
    expect(merged.entries.find((e) => e.criteriaId === "1.1.1")!.date).toBe("2026-01-01");
    expect(merged.entries.find((e) => e.criteriaId === "2.4.4")!.verdict).toBe("NA");
  });

  it("starts fresh when the standard changed — an RGAA verdict is not a WCAG one", () => {
    const rgaa = mergeLedger(undefined, "rgaa", [entry("1.1", "2026-01-01")]);
    const merged = mergeLedger(rgaa, "wcag", [entry("1.1.1", "2026-08-17")]);
    expect(merged.standard).toBe("wcag");
    expect(merged.entries.map((e) => e.criteriaId)).toEqual(["1.1.1"]);
  });
});

describe("pruneLedger", () => {
  const entry = (criteriaId: string, verdict: "C" | "NC", findings?: Array<{ file: string; line: number; selector: string; message: string }>) => ({
    criteriaId,
    verdict,
    ...(findings ? { findings } : {}),
    evidenceFingerprint: `sha256:${criteriaId}`,
    evidenceCount: 1,
    date: "2026-08-28",
    decidedBy: "agent" as const,
  });

  it("removes only the withdrawn NC anchor and canonicalizes snapshot checkout prefixes", () => {
    const ledger = mergeLedger(undefined, "rgaa", [
      entry("1.1", "NC", [
        { file: "/runner/a/.ultra11y/pages/home/dom.html", line: 8, selector: "img.hero", message: "bad alt" },
        { file: "src/card.tsx", line: 12, selector: "img.logo", message: "missing alt" },
      ]),
    ]);
    const result = pruneLedger(
      ledger,
      [
        {
          n: 1,
          criteriaId: "1.1",
          file: "/runner/b/.ultra11y/pages/home/dom.html",
          line: 8,
          selector: "img.hero",
          claim: "bad alt",
          verdict: "refuted",
          note: "",
          kind: "nc",
        },
      ],
      [],
      [],
    );
    expect(result.removedFindings).toBe(1);
    expect(result.removedEntries).toBe(0);
    expect(result.ledger.entries[0]!.findings?.map((finding) => finding.message)).toEqual(["missing alt"]);
  });

  it("deletes reopened NC and withdrawn conformity entries so replay cannot resurrect them", () => {
    const ledger = mergeLedger(undefined, "rgaa", [entry("1.1", "NC", []), entry("11.2", "C")]);
    const result = pruneLedger(ledger, [], ["1.1"], ["11.2"]);
    expect(result.removedEntries).toBe(2);
    expect(result.ledger.entries).toEqual([]);
  });
});

describe("the ledger on disk", () => {
  it("round-trips, and sorts entries so the committed diff is stable", () => {
    const p = join(dir, "verdicts.json");
    const unsorted = mergeLedger(undefined, "wcag", [
      { criteriaId: "2.4.4", verdict: "C", evidenceFingerprint: "sha256:b", evidenceCount: 1, date: "2026-08-17", decidedBy: "agent" },
      { criteriaId: "1.1.1", verdict: "C", evidenceFingerprint: "sha256:a", evidenceCount: 1, date: "2026-08-17", decidedBy: "agent" },
      { criteriaId: "1.10.1", verdict: "NA", evidenceFingerprint: "sha256:c", evidenceCount: 0, date: "2026-08-17", decidedBy: "agent" },
    ]);
    writeLedger(p, unsorted);

    // Numeric collation: 1.1.1 before 1.10.1, which a plain string sort gets wrong.
    expect(readLedger(p)!.entries.map((e) => e.criteriaId)).toEqual(["1.1.1", "1.10.1", "2.4.4"]);
    expect(readFileSync(p, "utf8").endsWith("\n")).toBe(true);
  });

  it("returns undefined for an absent, unparseable or foreign file rather than throwing", () => {
    expect(readLedger(join(dir, "nope.json"))).toBeUndefined();
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ not json");
    expect(readLedger(bad)).toBeUndefined();
    const foreign = join(dir, "foreign.json");
    writeFileSync(foreign, JSON.stringify({ tool: "ultra11y", kind: "adjudication", items: [] }));
    expect(readLedger(foreign)).toBeUndefined();
  });

  it("recognises its own shape and rejects everything else", () => {
    expect(isLedger(emptyLedger("rgaa"))).toBe(true);
    expect(isLedger({ tool: "ultra11y", kind: "adjudication", items: [] })).toBe(false);
    expect(isLedger(null)).toBe(false);
    expect(isLedger([])).toBe(false);
  });

  it("puts a standard's ledger in a predictable, committable place", () => {
    expect(ledgerPath("rgaa")).toBe(join(".ultra11y/verdicts", "rgaa.json"));
    expect(ledgerPath("wcag", "/repo")).toBe(join("/repo/.ultra11y/verdicts", "wcag.json"));
  });
});
