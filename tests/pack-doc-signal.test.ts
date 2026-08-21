// DOCUMENT-LEVEL pack rules, and the criterion that needed them: RGAA 8.1.
//
// Every declarative pack rule until now matched an ELEMENT. That is enough for almost
// everything a national standard asks, and not enough for the handful of criteria whose
// subject is the document itself. RGAA 8.1 — « chaque page web est-elle définie par un type de
// document ? » — is the pure case: the doctype is not an element, it is not part of
// `documentElement.outerHTML`, and it maps onto WCAG 4.1.1, which WCAG 2.2 REMOVED. So the
// engine had no instrument for it and `derivePackResults` classed it out of scope: « à
// évaluer » on every page, of every run, of every project, for ever — closable only by paying
// a model to read a capture and answer a yes/no question.
//
// The three things this file pins, because each of them is a way the fix could go wrong:
//  1. the rule fires ONLY on a capture that recorded the field. A source file has no doctype
//     and never should; a capture written before the field existed did not record one. Both
//     are silence, not a non-conformity.
//  2. the rule claims PAGE COVERAGE only where it ran, so `measuredRescue` cannot conclude
//     conformity on a page nobody captured.
//  3. RGAA 8.1 stops being out-of-scope — but only because the pack brought its own
//     instrument. A criterion with no instrument stays out of scope, and stays the agent's.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { checkDecided } from "../src/check.js";
import { derivePackResults } from "../src/standards/derive.js";
import { PAGES_DIR, SNAPSHOT_VERSION, validateSnapshotMeta, writeSnapshot } from "../src/snapshot.js";
import { writeRunnerSnapshot } from "../src/scan.js";
import type { AuditResult } from "../src/types.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-doctype-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const DOM = `<html lang="fr"><head><title>T</title></head><body><main><h1>H</h1><p>x</p></main></body></html>`;

/** Write one capture and audit the pages tree. `doctype` is passed exactly as the collector
 *  records it: a string (possibly empty) when it looked, absent when the capture predates the
 *  field. */
function auditCapture(pages: { id: string; doctype?: string }[]): AuditResult {
  for (const p of pages) {
    writeSnapshot(root, {
      meta: {
        v: SNAPSHOT_VERSION,
        id: p.id,
        name: p.id,
        url: `https://example.test/${p.id}`,
        ...(p.doctype !== undefined ? { doctype: p.doctype } : {}),
      },
      dom: DOM,
    } as Parameters<typeof writeSnapshot>[1]);
  }
  return runAudit({ inputs: [join(root, PAGES_DIR)] });
}

const rgaa = (audit: AuditResult, id: string, pageId?: string) => derivePackResults(audit, "rgaa", pageId).find((c) => c.id === id)!;

describe("a pack rule over a document-level signal", () => {
  it("fires when the capture recorded a page with NO doctype", () => {
    const audit = auditCapture([{ id: "accueil", doctype: "" }]);
    expect(audit.packFindings?.map((f) => f.ruleId)).toContain("pack:rgaa:doctype-missing");
  });

  it("stays silent when the capture recorded a doctype", () => {
    const audit = auditCapture([{ id: "accueil", doctype: "<!DOCTYPE html>" }]);
    expect(audit.packFindings?.map((f) => f.ruleId) ?? []).not.toContain("pack:rgaa:doctype-missing");
  });

  it("stays silent on a capture that PREDATES the field — an unrecorded doctype is not an absent one", () => {
    const audit = auditCapture([{ id: "accueil" }]);
    expect(audit.packFindings?.map((f) => f.ruleId) ?? []).not.toContain("pack:rgaa:doctype-missing");
  });

  it("never fires on source files, which carry no doctype and never should", () => {
    const audit = runAudit({ inputs: ["tests/fixtures/realworld/LoginForm.tsx"], forceJsx: true });
    expect(audit.packFindings?.map((f) => f.ruleId) ?? []).not.toContain("pack:rgaa:doctype-missing");
  });

  it("claims page coverage only where it ran", () => {
    const audit = auditCapture([
      { id: "with", doctype: "<!DOCTYPE html>" },
      { id: "without" }, // predates the field — measured nothing
    ]);
    expect(audit.scope.pageCoverage?.with?.rules ?? []).toContain("pack:rgaa:doctype-missing");
    expect(audit.scope.pageCoverage?.without?.rules ?? []).not.toContain("pack:rgaa:doctype-missing");
  });
});

describe("RGAA 8.1 — the criterion the instrument was built for", () => {
  it("is NON-CONFORMING on a captured page that declares no doctype", () => {
    const audit = auditCapture([{ id: "accueil", doctype: "" }]);
    const c = rgaa(audit, "8.1");
    expect(c.status).toBe("NC");
    expect(c.outOfScope).toBeUndefined();
    expect(c.findings.map((f) => f.ruleId)).toContain("pack:rgaa:doctype-missing");
  });

  it("is CONFORMING — measured, not inferred — on a captured page that declares one", () => {
    const audit = auditCapture([{ id: "accueil", doctype: "<!DOCTYPE html>" }]);
    const c = rgaa(audit, "8.1");
    expect(c.status).toBe("C");
    expect(c.decidedBy).toBe("scan");
    // The claim has to stay falsifiable: it names the rule a reader can go and check.
    expect(c.justification).toMatch(/pack:rgaa:doctype-missing/);
  });

  it("stays « à évaluer » when nothing captured the page — silence is not conformity", () => {
    const audit = auditCapture([{ id: "accueil" }]);
    expect(rgaa(audit, "8.1").status).toBe("manual");
  });

  it("is decided PER PAGE, so a captured page does not clear an uncaptured one", () => {
    const audit = auditCapture([
      { id: "accueil", doctype: "<!DOCTYPE html>" },
      { id: "contact" }, // predates the field
    ]);
    expect(rgaa(audit, "8.1", "accueil").status).toBe("C");
    expect(rgaa(audit, "8.1", "contact").status).toBe("manual");
  });

  it("no longer costs the run its 106th criterion", () => {
    const audit = auditCapture([{ id: "accueil", doctype: "<!DOCTYPE html>" }]);
    expect(checkDecided(audit, "rgaa").undecided).not.toContain("8.1");
  });
});

// The collector reads the doctype in the browser; every producer has to carry it out. The scan
// path did not — the field simply fell off `writeRunnerSnapshot`, so a page a browser had just
// opened arrived saying "nobody looked" and 8.1 stayed « à évaluer » on it. The same shape of
// defect this function already had once, with `probes` and `axe`.
describe("every producer carries the doctype out of the browser", () => {
  it("scan's snapshot writer forwards what the collector recorded", () => {
    const id = writeRunnerSnapshot(
      root,
      { url: "https://example.test/", violations: [], reflow: { horizontalScroll: false }, snapshot: { dom: DOM, doctype: "<!DOCTYPE html>" } },
      "https://example.test/",
    );
    expect(id).toBeTruthy();
    expect(JSON.parse(readFileSync(join(root, PAGES_DIR, id!, "meta.json"), "utf8")).doctype).toBe("<!DOCTYPE html>");
  });

  it("forwards the empty string too — « the browser looked and found none » is the evidence", () => {
    const id = writeRunnerSnapshot(
      root,
      { url: "https://example.test/x", violations: [], reflow: { horizontalScroll: false }, snapshot: { dom: DOM, doctype: "" } },
      "https://example.test/x",
    );
    expect(JSON.parse(readFileSync(join(root, PAGES_DIR, id!, "meta.json"), "utf8")).doctype).toBe("");
  });

  it("leaves it absent when the producer reported nothing, rather than inventing an empty one", () => {
    const id = writeRunnerSnapshot(
      root,
      { url: "https://example.test/y", violations: [], reflow: { horizontalScroll: false }, snapshot: { dom: DOM } },
      "https://example.test/y",
    );
    expect(JSON.parse(readFileSync(join(root, PAGES_DIR, id!, "meta.json"), "utf8")).doctype).toBeUndefined();
  });
});

// Where the bug actually lived. `validateSnapshotMeta` rebuilds the meta from a whitelist, so
// it dropped every field nobody had thought to name — and it guards BOTH directions: the
// `snapshot write` ingest and the read back off disk. A producer could record the doctype
// perfectly and the audit would still never see one.
describe("the snapshot meta validator keeps the doctype", () => {
  const base = { v: SNAPSHOT_VERSION, id: "p", name: "P", url: "https://x/" };

  it("carries a recorded declaration through", () => {
    expect(validateSnapshotMeta({ ...base, doctype: "<!DOCTYPE html>" }).meta?.doctype).toBe("<!DOCTYPE html>");
  });

  it("carries the empty string through — it is a measurement, not a missing field", () => {
    expect(validateSnapshotMeta({ ...base, doctype: "" }).meta?.doctype).toBe("");
  });

  it("leaves it absent when the producer never recorded one", () => {
    expect(validateSnapshotMeta(base).meta?.doctype).toBeUndefined();
  });

  it("refuses a non-string, like every other field it guards", () => {
    const v = validateSnapshotMeta({ ...base, doctype: 42 });
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.path)).toContain("meta.doctype");
  });
});
