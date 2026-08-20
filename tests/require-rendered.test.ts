// THE RENDER GATE — did anything actually get rendered before we called it undecidable?
//
// `--require-decided` asks whether every criterion carries a verdict. `--require-sample` asks
// whether the run looked at every page it declares. This asks the question underneath both,
// and it is the one that cost real money: were the criteria that NEED a browser given one?
//
// Measured on the 2026-08-20 RGAA cascade — three passes, 311 turns, $24.90 — seven criteria
// came back `needs-rendered-dom` and every one of them was RIGHT: the workflow audited sources
// only and no page was ever snapshotted. The job was green. The report said « à évaluer ». No
// surface anywhere said "because nobody rendered anything", so three passes were bought to
// rediscover it.
//
// Opt-in, like its two siblings: a source-only audit is a legitimate thing to want, and a gate
// that fires on every repository is a gate that gets turned off.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { runAudit } from "../src/audit.js";
import { checkRendered } from "../src/check.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import type { AuditResult } from "../src/types.js";

const DOM = `<!doctype html><html lang="fr"><head><title>Aide</title></head><body><main><h1>Aide</h1><p>Texte</p><a href="/c">Contact</a></main></body></html>`;

/** An audit of a plain source file — no browser anywhere near it. */
function sourceOnly(): AuditResult {
  const dir = mkdtempSync(join(tmpdir(), "u11y-rg-src-"));
  const f = join(dir, "page.html");
  writeFileSync(f, DOM);
  return runAudit({ inputs: [f] });
}

/** An audit that read a page's real serialized DOM. */
function rendered(): AuditResult {
  const root = mkdtempSync(join(tmpdir(), "u11y-rg-snap-"));
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "aide", name: "Aide", url: "https://x/aide" },
    dom: DOM,
    probes: { reflow: { horizontalScroll: false }, probed: ["1.4.4", "1.4.10", "1.4.12", "2.4.7"] },
    axe: { violations: [], ran: true },
  } as Parameters<typeof writeSnapshot>[1]);
  return runAudit({ inputs: [join(root, PAGES_DIR, "aide", "dom.html")] });
}

describe("checkRendered", () => {
  it("fails while a rendering criterion is undecided and nothing was rendered", () => {
    const r = checkRendered(sourceOnly(), "rgaa", "fr");
    expect(r.ok).toBe(false);
    expect(r.pagesAudited).toBe(0);
    // The exact criteria the 2026-08-20 run was left holding.
    expect(r.open).toEqual(expect.arrayContaining(["3.2", "10.4", "10.11", "10.12"]));
  });

  it("names them, and names the command that closes them", () => {
    const r = checkRendered(sourceOnly(), "rgaa", "fr");
    expect(r.issues.join("\n")).toContain("scan");
    expect(r.issues.join("\n")).toContain("3.2");
  });

  it("passes once a page's real DOM was read and the tier decided", () => {
    const r = checkRendered(rendered(), "rgaa", "fr");
    expect(r.pagesAudited).toBe(1);
    expect(r.ok).toBe(true);
    expect(r.open).toEqual([]);
  });

  // The gate asks about the INSTRUMENT, not about the answer. A page was rendered and a
  // criterion still came back undecided — that is the honest residual the whole tool is built
  // to preserve, and failing on it would push a project to fake a verdict.
  it("passes when a page WAS rendered and a rendering criterion is still open", () => {
    const audit = rendered();
    // Five of the fourteen rendering criteria are measured by NO tier at all (1.4.5, 2.1.2,
    // 2.3.1, 2.4.11, 2.5.8), so a rendered run still carries open ones. Which ones is not this
    // test's business — that there ARE some, and that the gate lets them through, is.
    const stillOpen = audit.criteria.filter((c) => c.status === "manual" && ["1.4.5", "2.1.2", "2.3.1", "2.4.11", "2.5.8"].includes(c.id));
    expect(stillOpen.length).toBeGreaterThan(0);
    expect(checkRendered(audit, "rgaa", "fr").ok).toBe(true);
  });

  // Same named-list discipline as `--require-decided`: an exception says why, never a
  // percentage that passes whatever it must to stay green.
  it("honours a declared undecidable, and reports a declaration with no reason", () => {
    const allow = { entries: [{ criteriaId: "3.2", reason: "images de fond fournies par un tiers" }] };
    const r = checkRendered(sourceOnly(), "rgaa", "fr", { allow });
    expect(r.open).not.toContain("3.2");
    expect(r.allowed.map((a) => a.criteriaId)).toEqual(["3.2"]);

    const bad = checkRendered(sourceOnly(), "rgaa", "fr", { allow: { entries: [{ criteriaId: "3.2", reason: "  " }] } });
    expect(bad.issues.join("\n")).toMatch(/sans motif|no reason/i);
  });

  it("says it in English too", () => {
    expect(checkRendered(sourceOnly(), "rgaa", "en").issues.join("\n")).toMatch(/no page|snapshot/i);
  });

  // An audit written before `pagesAudited` existed knows nothing either way, and a gate that
  // fails on "unknown" is a gate that gets turned off on the next run.
  it("stays quiet on an audit that cannot say whether anything was rendered", () => {
    const legacy = sourceOnly();
    legacy.scope.pagesAudited = undefined;
    legacy.scope.pages = [{ id: "aide", name: "Aide", url: "https://x/aide", basis: "snapshot" }];
    expect(checkRendered(legacy, "rgaa", "fr").ok).toBe(true);
  });
});
