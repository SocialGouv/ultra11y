// THE DASHBOARD MUST STATE THE SAME RUN AS THE REPORT BESIDE IT.
//
// Two defects, both of the shape « two renderers of one fact, and only one of them was right ».
//
// The headline read its DENOMINATOR off the pack's derived criteria and its PERCENTAGE off
// `result.conformancePct`, which is the core audit's ratio over the WCAG success criteria. On
// egapro that put a rate computed over 55 criteria next to a coverage counted over 106, in one
// sentence, as though they were one measurement.
//
// And a page's card built its own view of the audit — `criteria` and `findings` replaced, the
// run-wide `packFindings` kept — so every declarative pack-rule finding was printed on all
// thirty-seven page cards. The Markdown sheet has filtered them by page since it was written.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { compositeDoc, pageDoc } from "../src/html-report.js";
import { attributePages, derivePages, pageScopesFrom, pagesOf } from "../src/pages.js";
import { conformanceRate, packReportGroups, reportTotals } from "../src/report.js";
import { PAGES_DIR, SNAPSHOT_VERSION, readSnapshots, writeSnapshot } from "../src/snapshot.js";
import { loadPack } from "../src/standards/index.js";
import type { Block } from "../src/html.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;
const base = runAudit({ inputs: [`${FIX}non-conforming/bad.html`] });

const text = (blocks: Block[] | { blocks: Block[] }): string => JSON.stringify(blocks);

describe("the dashboard's rate and its denominator describe one set", () => {
  it("shows the standard's OWN conformity rate on a pack dashboard, WITH its own operands", () => {
    const doc = compositeDoc(base, { standard: "rgaa", lang: "fr" });
    const r = conformanceRate(reportTotals(packReportGroups(base, loadPack("rgaa"), "fr")));
    const head = JSON.stringify(doc.subtitle ?? doc.blocks.slice(0, 3));
    expect(head, "the dashboard must not quote the core WCAG ratio over a pack's denominator").toContain(`${r.pct} %`);
    // Half-fixing this was worse than not fixing it: the percentage became the conformity rate
    // while the parenthesis kept `decided/total`, so the header read « 80 % (101/106) ».
    expect(head, "the parenthesis must carry the operands the percentage was computed from").toContain(`(${r.validated}/${r.applicable})`);
    expect(r.pct).not.toBe(base.conformancePct);
  });

  it("leaves the core WCAG dashboard on its own automatic rate", () => {
    const doc = compositeDoc(base, { standard: "wcag", lang: "fr" });
    expect(JSON.stringify(doc.subtitle ?? doc.blocks.slice(0, 3))).toContain(`${base.conformancePct} %`);
  });
});

describe("a page card shows that page's findings and no other page's", () => {
  // REAL SNAPSHOTS, because this defect only exists once a declarative pack rule has actually
  // fired on one capture and not the other. `home` declares a doctype; `other` declares none,
  // which is RGAA 8.1 exactly.
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "u11y-html-"));
    for (const [id, doctype] of [
      ["home", "<!DOCTYPE html>"],
      ["other", ""],
    ]) {
      writeSnapshot(root, {
        meta: { v: SNAPSHOT_VERSION, id: id!, name: id!, url: `https://x/${id}`, doctype },
        dom: `<html lang="fr"><head><title>T</title></head><body><main><h1>H</h1><p>Bonjour</p></main></body></html>`,
      });
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** The audit as the pipeline hands it on: pages recorded and findings attributed, which is
   *  what `cmdScan`/`cmdAudit` do before any report is rendered. */
  const audited = () => {
    const result = runAudit({ inputs: [join(root, PAGES_DIR)] });
    const scope = pageScopesFrom(readSnapshots(root));
    result.scope.pages = scope;
    attributePages(result, scope);
    return result;
  };

  const cardOf = (id: string): string => {
    const result = audited();
    const page = derivePages(result, pagesOf(result)).find((p) => p.id === id);
    expect(page, `fixture must produce the ${id} page`).toBeTruthy();
    return text(pageDoc(result, page!, { standard: "rgaa", lang: "fr" }).blocks);
  };

  /** The doctype finding's own wording, taken from the audit rather than restated here. */
  const doctypeMessage = (): string => {
    const f = (audited().packFindings ?? []).find((x) => x.ruleId === "pack:rgaa:doctype-missing");
    expect(f, "fixture must produce a doctype finding on `other`").toBeTruthy();
    expect(f?.page).toBe("other");
    return f!.message.slice(0, 40);
  };

  it("prints the doctype non-conformity on the page that has no doctype", () => {
    expect(cardOf("other"), "the page whose capture declares no doctype must carry it").toContain(doctypeMessage());
  });

  it("does NOT print it on the page that has one", () => {
    // The card used to replace `criteria` and `findings` and keep the run-wide `packFindings`,
    // so every per-capture finding appeared on every card. On a 37-page audit that is one
    // non-conformity printed thirty-seven times, thirty-six of them about another page.
    //
    // Asserted on the finding's own WORDING, not on the criterion id: the per-page grid lists
    // every criterion of the standard on every card, 8.1 included, and that is correct.
    expect(cardOf("home"), "a pack-rule finding from `other` must not appear on `home`").not.toContain(doctypeMessage());
  });

  it("agrees with `pagesOf`, which is the one funnel every other surface reads", () => {
    const result = audited();
    expect(
      pagesOf(result)
        .map((p) => p.id)
        .sort(),
    ).toEqual(["home", "other"]);
  });
});
