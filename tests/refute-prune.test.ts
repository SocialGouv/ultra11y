// THE REFUTATION HAS TO REPAIR, NOT ONLY REFUSE.
//
// `verify --apply` counted the refuted claims and exited non-zero. That is the right gate for
// a human-adjudicated run — someone reads the failure and fixes the report. It is the wrong
// shape for the run this exists to make safe: a cheap adjudicator over-accuses as a matter of
// course (74 non-conformities where a stronger model found 57), so the refutation pass fires
// every time, and a pipeline that can only go red is a pipeline nobody runs twice.
//
// So `--prune` applies what the trial decided, along the two axes the verdicts already
// distinguish — and they are NOT symmetric:
//
//   a refuted NON-CONFORMITY is deleted; if it was the criterion's last one, the criterion
//   goes back to « to assess », NOT to conforming — nobody established that it passes;
//
//   a refuted CONFORMITY sends its criterion back to « to assess » too, and never to NC —
//   refuting a conformity proves nothing against the criterion.
//
// Both land on « to assess » from opposite directions, which is the honest answer in both:
// the claim was withdrawn, and no other claim took its place.
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAudit } from "../src/audit.js";
import { buildAdjudicationWorklist, applyAdjudication, type AdjudicationFile, type AdjudicationItem } from "../src/adjudicate.js";
import { pruneRefuted } from "../src/refute.js";
import type { VerifyItem } from "../src/verify.js";
import type { AuditResult } from "../src/types.js";
import { derivePackResults } from "../src/standards/index.js";

const dir = mkdtempSync(join(tmpdir(), "u11y-prune-"));
const PAGE = join(dir, "page.html");
writeFileSync(
  PAGE,
  `<!doctype html><html lang="fr"><head><title>Boutique</title></head><body><main>
<h1>Bienvenue</h1>
<img src="hero.png" alt="Un randonneur sur une crête">
<label for="email">Email</label><input id="email" type="email">
<a href="/aide">Contacter le support</a>
</main></body></html>`,
);

const audit = () => runAudit({ inputs: [PAGE] });

const adjFile = (items: AdjudicationItem[]): AdjudicationFile => ({
  tool: "ultra11y",
  kind: "adjudication",
  schemaVersion: 2,
  standard: "rgaa",
  auditDate: "2026-08-24",
  items,
});

const clear = (it: AdjudicationItem): AdjudicationItem =>
  it.evidence.length
    ? { ...it, verdict: "C" as const, justification: "vérifié sur la page", citations: [it.evidence[0]!] }
    : { ...it, verdict: "manual" as const, reason: "undecidable" };

/** An audit where 11.2 is an agent NC and every other criterion an agent C. */
function adjudicated(): AuditResult {
  const items = buildAdjudicationWorklist(audit(), { standard: "rgaa" });
  const ev = items.find((i) => i.criteriaId === "11.2")!.evidence[0]!;
  const r = applyAdjudication(
    audit(),
    adjFile(
      items.map((it) =>
        it.criteriaId === "11.2"
          ? ({
              ...it,
              verdict: "NC" as const,
              findings: [
                { file: ev.file, line: ev.line, selector: ev.selector, snippet: ev.snippet, message: "étiquette non pertinente", normativeRef: "11.2.1" },
              ],
            } as AdjudicationItem)
          : clear(it),
      ),
    ),
    { cwd: dir },
  );
  expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
  return r.audit;
}

const packCrit = (a: AuditResult, id: string) => a.packAdjudication?.criteria.find((c) => c.id === id);

/** A verdicts file refuting exactly the claims named. */
function verdicts(a: AuditResult, ncIds: string[], cIds: string[], verdict: "refuted" | "unsupported" | "supported" = "refuted"): VerifyItem[] {
  const out: VerifyItem[] = [];
  for (const id of ncIds) {
    const f = packCrit(a, id)!.findings[0]!;
    out.push({
      n: out.length + 1,
      criteriaId: id,
      file: f.file,
      line: f.line,
      selector: f.selectorHint,
      claim: f.message,
      verdict,
      note: "mal rattaché",
      kind: "nc",
    });
  }
  for (const id of cIds) {
    const c = packCrit(a, id)!.citations![0]!;
    out.push({
      n: out.length + 1,
      criteriaId: id,
      file: c.file,
      line: c.line,
      selector: c.selector,
      claim: packCrit(a, id)!.justification ?? "",
      verdict,
      note: "présence, pas pertinence",
      kind: "c",
    });
  }
  return out;
}

describe("a refuted non-conformity is deleted", () => {
  const base = adjudicated();
  const r = pruneRefuted(base, "rgaa", verdicts(base, ["11.2"], []), "fr");

  it("removes the finding from the flat list every surface reads", () => {
    expect(base.findings.some((f) => f.criteriaId === "11.2")).toBe(true);
    expect(r.audit.findings.some((f) => f.criteriaId === "11.2")).toBe(false);
    expect(r.removedFindings).toBe(1);
  });

  it("removes it from the criterion too", () => {
    expect(packCrit(r.audit, "11.2")?.findings).toEqual([]);
  });

  it("sends the criterion back to « to assess » — deleting a failure does not establish a pass", () => {
    expect(packCrit(r.audit, "11.2")?.status).toBe("manual");
    expect(packCrit(r.audit, "11.2")?.decidedBy).toBeUndefined();
    expect(r.reopenedCriteria).toEqual(["11.2"]);
  });

  it("says why, in the criterion's own justification", () => {
    expect(packCrit(r.audit, "11.2")?.justification ?? "").toMatch(/réfut/i);
  });

  it("does not leave the audit claiming it conforms", () => {
    expect(packCrit(r.audit, "11.2")?.status).not.toBe("C");
  });
});

describe("a refuted conformity goes back to « to assess », never to NC", () => {
  const base = adjudicated();
  const cleared = base.packAdjudication!.criteria.find((c) => c.status === "C" && c.decidedBy === "agent" && c.citations?.length)!.id;
  const r = pruneRefuted(base, "rgaa", verdicts(base, [], [cleared]), "fr");

  it("reopens the criterion", () => {
    expect(packCrit(base, cleared)?.status).toBe("C");
    expect(packCrit(r.audit, cleared)?.status).toBe("manual");
    expect(r.clearedConformities).toEqual([cleared]);
  });

  it("never turns it into a non-conformity — refuting a conformity proves nothing against it", () => {
    expect(packCrit(r.audit, cleared)?.status).not.toBe("NC");
    expect(packCrit(r.audit, cleared)?.findings ?? []).toEqual([]);
  });

  it("drops the citations it was cleared on, so nothing re-reads a withdrawn claim", () => {
    expect(packCrit(r.audit, cleared)?.citations).toBeUndefined();
  });
});

describe("it applies only what was actually refuted", () => {
  const base = adjudicated();

  it("leaves a supported non-conformity exactly where it is", () => {
    const r = pruneRefuted(base, "rgaa", verdicts(base, ["11.2"], [], "supported"), "fr");
    expect(packCrit(r.audit, "11.2")?.status).toBe("NC");
    expect(r.removedFindings).toBe(0);
  });

  it("treats `unsupported` the same as `refuted` — neither establishes the claim", () => {
    const r = pruneRefuted(base, "rgaa", verdicts(base, ["11.2"], [], "unsupported"), "fr");
    expect(packCrit(r.audit, "11.2")?.status).toBe("manual");
  });

  it("never mutates the audit it was given", () => {
    pruneRefuted(base, "rgaa", verdicts(base, ["11.2"], []), "fr");
    expect(packCrit(base, "11.2")?.status).toBe("NC");
    expect(base.findings.some((f) => f.criteriaId === "11.2")).toBe(true);
  });

  it("refuses to rewrite an ENGINE verdict, and says how many it left alone", () => {
    // Its own page, with a defect the static engine finds on its own: a criterion the engine
    // decided is recomputed from source every run, so pruning it here would be undone by the
    // next audit — and a rule that produces a false positive is a bug in the rule.
    const broken = join(dir, "broken.html");
    writeFileSync(
      broken,
      `<!doctype html><html lang="fr"><head><title>Contact</title></head><body><main><h1>Contact</h1>\n<input id="courriel" type="email">\n</main></body></html>`,
    );
    const plain = runAudit({ inputs: [broken] });
    const engineNc = plain.criteria.find((c) => c.status === "NC" && c.findings.length);
    expect(engineNc, "the fixture no longer produces an engine non-conformity").toBeDefined();
    const f = engineNc!.findings[0]!;
    const item: VerifyItem = {
      n: 1,
      criteriaId: engineNc!.id,
      file: f.file,
      line: f.line,
      selector: f.selectorHint,
      claim: f.message,
      verdict: "refuted",
      note: "",
      kind: "nc",
    };
    const r = pruneRefuted(plain, "wcag", [item], "fr");
    expect(r.removedFindings).toBe(0);
    expect(r.skippedEngine).toBe(1);
    expect(r.audit.criteria.find((c) => c.id === engineNc!.id)?.status).toBe("NC");
  });
});

describe("a refutation it cannot act on is REPORTED, never swallowed", () => {
  // Found by running the real recipe rather than the unit: under `--standard rgaa` on an audit
  // with no adjudication at all, `packAdjudication` is absent, so neither loop iterates and a
  // refuted engine non-conformity produced « 0 deleted, 0 back to to assess » and no warning.
  // The count is now taken from the withdrawn claims, not from inside the loops.
  it("counts a withdrawn claim on a pack criterion that has no adjudication record", () => {
    const plain = audit();
    const nc = derivePackResults(plain, "rgaa").find((c) => c.status === "NC" && c.findings.length)!;
    const f = nc.findings[0]!;
    const r = pruneRefuted(
      plain,
      "rgaa",
      [{ n: 1, criteriaId: nc.id, file: f.file, line: f.line, selector: f.selectorHint, claim: f.message, verdict: "refuted", note: "", kind: "nc" }],
      "fr",
    );
    expect(r.skippedEngine).toBe(1);
    expect(r.removedFindings).toBe(0);
    expect(derivePackResults(r.audit, "rgaa").find((c) => c.id === nc.id)?.status).toBe("NC");
  });
});

describe("the core branch behaves the same way", () => {
  it("reopens a refuted agent conformity on a WCAG success criterion", () => {
    const items = buildAdjudicationWorklist(audit());
    const r = applyAdjudication(audit(), { ...adjFile(items.map(clear)), standard: "wcag" }, { cwd: dir });
    expect(r.rejectedCriteria, r.issues.join("\n")).toEqual([]);
    const c = r.audit.criteria.find((x) => x.decidedBy === "agent" && x.status === "C" && x.citations?.length)!;
    const cite = c.citations![0]!;
    const pruned = pruneRefuted(
      r.audit,
      "wcag",
      [
        {
          n: 1,
          criteriaId: c.id,
          file: cite.file,
          line: cite.line,
          selector: cite.selector,
          claim: c.justification ?? "",
          verdict: "refuted",
          note: "",
          kind: "c",
        },
      ],
      "fr",
    );
    expect(pruned.audit.criteria.find((x) => x.id === c.id)?.status).toBe("manual");
    expect(pruned.clearedConformities).toEqual([c.id]);
  });
});
