// Importing someone else's audit, and holding it against ours. The fixture is the shape ARA's
// own AuditReportDto declares (DISIC/Ara, confiture-rest-api/src/audits/dto/audit-report.dto.ts)
// — the adapter is pinned to a real schema, never a guessed one.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { araAdapter } from "../src/external/adapters/ara.js";
import { createAdapter, isExternalSource } from "../src/external/registry.js";
import { diffSides, sideOfExternal, type DiffSide } from "../src/external/diff.js";
import type { Status } from "../src/types.js";

const raw = JSON.parse(readFileSync(join(__dirname, "fixtures/external/ara-report.json"), "utf8"));
const parse = (r: unknown = raw) =>
  araAdapter.parse(r, { importedAt: "2026-08-13T00:00:00.000Z", url: "https://ara.numerique.gouv.fr/api/reports/aBcDeF123456" });

describe("the ARA adapter", () => {
  it("parses a real report into the tool-neutral model", () => {
    const res = parse();
    expect(res.ok, res.ok ? "" : res.issues.join("\n")).toBe(true);
    if (!res.ok) return;
    expect(res.audit.standard).toBe("rgaa");
    expect(res.audit.source).toMatchObject({ adapter: "ara", id: "aBcDeF123456" });
    expect(res.audit.date).toBe("2026-03-09");
    expect(res.audit.auditor).toBe("A. Auditrice");
  });

  it("joins a result to its page through the numeric sample id", () => {
    const res = parse();
    if (!res.ok) throw new Error("parse failed");
    expect(res.audit.pages.map((p) => p.id)).toEqual(["accueil", "parcours-conformite-etape-2"]);
    const funnel = res.audit.results.filter((r) => r.page === "parcours-conformite-etape-2");
    expect(funnel.map((r) => r.criterion).sort()).toEqual(["10.11", "10.12"]);
  });

  it("builds the criterion id from topic + criterium, RGAA's own numbering", () => {
    const res = parse();
    if (!res.ok) throw new Error("parse failed");
    expect(res.audit.results.map((r) => r.criterion)).toContain("10.11");
    expect(res.audit.results.map((r) => r.criterion)).toContain("1.1");
  });

  it("keeps the source's own token beside the mapped status", () => {
    const res = parse();
    if (!res.ok) throw new Error("parse failed");
    const untested = res.audit.results.find((r) => r.rawStatus === "NOT_TESTED")!;
    // Mapped to "undecided" — but a diff must still be able to say « non retesté », which is why
    // the raw token survives the mapping.
    expect(untested.status).toBe("manual");
    expect(res.audit.results.find((r) => r.criterion === "5.1")).toMatchObject({ status: "NA", rawStatus: "NOT_APPLICABLE" });
  });

  it("carries the auditor's prose verbatim, including the impact they recorded", () => {
    const res = parse();
    if (!res.ok) throw new Error("parse failed");
    const r = res.audit.results.find((x) => x.criterion === "10.11")!;
    expect(r.comment).toContain("tronquée à 320px");
    expect(r.userImpact).toBe("BLOCKING");
  });

  it("REFUSES an unknown status token instead of defaulting it to undecided", () => {
    const mutated = structuredClone(raw);
    mutated.results[0].status = "PROBABLY_FINE";
    const res = parse(mutated);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.join(" ")).toContain("PROBABLY_FINE");
  });

  it("REFUSES a criterion the pack does not define, rather than dropping it silently", () => {
    const mutated = structuredClone(raw);
    mutated.results[0].topic = 99;
    const res = parse(mutated);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.join(" ")).toContain("99.1");
  });

  it("REFUSES a result pointing at a page the report never declared", () => {
    const mutated = structuredClone(raw);
    mutated.results[0].pageId = 999;
    const res = parse(mutated);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.issues.join(" ")).toContain("999");
  });

  it("never throws on malformed input — it reports", () => {
    for (const bad of [null, 42, "nope", [], {}]) {
      const res = parse(bad);
      expect(res.ok).toBe(false);
    }
  });
});

describe("the source registry", () => {
  it("resolves the sources it knows and throws on the rest", () => {
    expect(isExternalSource("ara")).toBe(true);
    expect(isExternalSource("wave")).toBe(false);
    expect(createAdapter("ara").id).toBe("ara");
    expect(() => createAdapter("wave")).toThrow(/unknown external audit source/);
  });
});

describe("the diff", () => {
  const side = (rows: [string, string, Status][]): DiffSide => {
    const byPage = new Map<string, Map<string, Status>>();
    for (const [page, criterion, status] of rows) {
      const m = byPage.get(page) ?? new Map<string, Status>();
      m.set(criterion, status);
      byPage.set(page, m);
    }
    return { byPage };
  };

  it("sorts a pair into each of the five reconciliation buckets", () => {
    const left = side([
      ["accueil", "1.1", "NC"],
      ["accueil", "3.2", "NC"],
      ["accueil", "5.1", "C"],
      ["accueil", "8.9", "C"],
      ["accueil", "10.11", "NC"],
    ]);
    const right = side([
      ["accueil", "1.1", "C"], // fixed
      ["accueil", "3.2", "NA"], // decided, still not conforming
      ["accueil", "5.1", "NC"], // regressed
      ["accueil", "8.9", "C"], // unchanged
      ["accueil", "10.11", "manual"], // was NC, nobody ruled again
    ]);
    const d = diffSides(left, right);
    expect(d.counts.fixed).toBe(1);
    expect(d.counts["partially-fixed"]).toBe(1);
    expect(d.counts.regressed).toBe(1);
    expect(d.counts.unchanged).toBe(1);
    expect(d.counts["not-retested"]).toBe(1);
  });

  it("NOT-RETESTED is its own bucket — neither confirmed fixed nor confirmed broken", () => {
    // Four criteria were non-conforming in the first audit and left NOT_TESTED in the second.
    // Folding them into "fixed" is how a remediation claims wins it did not earn.
    const d = diffSides(side([["p", "1.1", "NC"]]), side([["p", "1.1", "manual"]]));
    expect(d.rows[0]!.bucket).toBe("not-retested");
    expect(d.counts.fixed).toBe(0);
  });

  it("says when THEIR audit rules on a page or criterion OUR grid has nothing for", () => {
    // The reported failure mode: 10.11 was NC on the funnel, and the grid had nothing there.
    const d = diffSides(side([["accueil", "1.1", "C"]]), side([["funnel", "10.11", "NC"]]));
    expect(d.counts["only-right"]).toBe(1);
    expect(d.pagesOnlyRight).toEqual(["funnel"]);
    expect(d.pagesOnlyLeft).toEqual(["accueil"]);
  });

  it("never reads `manual` as agreement — an undecided criterion is not a verdict", () => {
    const d = diffSides(side([["p", "1.1", "manual"]]), side([["p", "1.1", "C"]]));
    expect(d.rows[0]!.bucket).toBe("only-right");
    expect(d.counts.unchanged).toBe(0);
  });

  it("drops nothing: one row per (page, criterion) either side ruled on", () => {
    const d = diffSides(
      side([
        ["p", "1.1", "C"],
        ["p", "2.1", "NC"],
      ]),
      side([
        ["p", "2.1", "C"],
        ["q", "3.1", "NC"],
      ]),
    );
    expect(d.rows).toHaveLength(3);
    expect(Object.values(d.counts).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("indexes an imported audit for the join, comments included", () => {
    const res = parse();
    if (!res.ok) throw new Error("parse failed");
    const s = sideOfExternal(res.audit);
    expect(s.byPage.get("parcours-conformite-etape-2")?.get("10.11")).toBe("NC");
    expect(s.comments?.get("parcours-conformite-etape-2")?.get("10.11")).toContain("320px");
  });
});
