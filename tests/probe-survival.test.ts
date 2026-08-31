// WHAT A BROWSER MEASURED HAS TO SURVIVE THE TRIP TO THE AUDIT — or the measurement becomes
// a silent conformity.
//
// The probes decide five criteria by acting on a rendered page, and `probed` is what lets
// their silence be read as conformity. Two of the families they produce — `focusObscured`
// (2.4.11) and `keyboardTrap` (2.1.2) — were declared in `LiveProbeResult`, written into
// `probes.json` by every producer, and then dropped on the way back in: the snapshot format
// did not name them and `probeFindings` did not fold them. The criteria were still credited
// as `probed`.
//
// That is the worst shape of defect this tool can have. A false POSITIVE is noisy and gets
// argued away in review; a false CONFORME is invisible, and it is what a declaration of
// accessibility then repeats. A page with a real keyboard trap came back `C` on 2.1.2, from a
// run that had walked its tab ring and found the trap.
//
// egapro is exactly this path: it captures its 37 pages with the Playwright plugin, outside
// the Action, and re-ingests them with `audit`.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-survive-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const DOM = `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1><p>Bonjour</p></main></body></html>`;

/** The criteria one full walk of the tab ring is entitled to speak for, plus the digest ones,
 *  so the fixture matches what a real producer reports. */
const PROBED = ["1.4.4", "1.4.10", "1.4.12", "1.4.13", "2.1.2", "2.4.7", "2.4.11"];

function auditWith(probes: Record<string, unknown>) {
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "p0", name: "P0", url: "https://x/0" },
    dom: DOM,
    probes: probes as never,
  });
  return runAudit({ inputs: [join(root, PAGES_DIR)] });
}

const of = (r: ReturnType<typeof runAudit>, sc: string) => r.criteria.find((c) => c.id === sc);

describe("a probe hit persisted in a snapshot is a non-conformity after re-ingestion", () => {
  it("folds a keyboard trap into 2.1.2 instead of clearing the criterion", () => {
    const r = auditWith({
      probed: PROBED,
      keyboardTrap: [{ selector: "#confirmation", html: "<input id=confirmation>", detail: "Le focus reste sur cet élément après 3 appuis sur Tab." }],
    });
    expect(r.findings.some((f) => f.ruleId === "dyn-keyboard-trap" && f.criteriaId === "2.1.2")).toBe(true);
    expect(of(r, "2.1.2")?.status).toBe("NC");
  });

  it("folds an obscured focus into 2.4.11 instead of clearing the criterion", () => {
    const r = auditWith({
      probed: PROBED,
      focusObscured: [{ selector: "a.nav", html: "<a class=nav>", detail: "Le composant qui reçoit le focus est entièrement masqué par un bandeau." }],
    });
    expect(r.findings.some((f) => f.ruleId === "dyn-focus-obscured" && f.criteriaId === "2.4.11")).toBe(true);
    expect(of(r, "2.4.11")?.status).toBe("NC");
  });

  // The same defect, in the family that measures a page AFTER an interaction. `probed` claims
  // 4.1.3 and the three input-overflow stresses claim 1.4.4 / 1.4.10 / 1.4.12 — so a hit that
  // does not survive the snapshot is a conformity published over an observed failure. Which
  // document the measurement is attached to is an attribution question; dropping it is a
  // correctness one, and only one of the two can produce a false « conforme ».
  it("folds a status message announced to nobody into 4.1.3", () => {
    const r = auditWith({
      probed: [...PROBED, "4.1.3"],
      liveRegion: [{ selector: "div.fr-alert", html: "<div class=fr-alert>", detail: "Mise à jour de contenu hors d'une région live." }],
    });
    expect(r.findings.some((f) => f.ruleId === "dyn-live-region" && f.criteriaId === "4.1.3")).toBe(true);
    expect(of(r, "4.1.3")?.status).toBe("NC");
  });

  it("folds a typed value clipped under each stress onto the criterion that stress evidences", () => {
    const hit = (d: string) => [{ selector: "input#x", html: "<input id=x>", detail: d }];
    const r = auditWith({
      probed: PROBED,
      inputOverflowReflow: hit("valeur saisie tronquée à 320 px"),
      inputOverflowZoom: hit("valeur saisie tronquée à 200 %"),
      inputOverflowSpacing: hit("valeur saisie tronquée sous l'espacement forcé"),
    });
    const stresses: [string, string][] = [
      ["dyn-input-overflow-reflow", "1.4.10"],
      ["dyn-input-overflow-zoom", "1.4.4"],
      ["dyn-input-overflow-spacing", "1.4.12"],
    ];
    for (const [rule, sc] of stresses) {
      expect(
        r.findings.some((f) => f.ruleId === rule && f.criteriaId === sc),
        `${rule} was dropped`,
      ).toBe(true);
      expect(of(r, sc)?.status, sc).toBe("NC");
    }
  });

  it("still clears both when the walk was complete and found nothing", () => {
    // The other half: this must not turn into a blanket refusal to conclude. A ring that was
    // walked with no hit is a measurement, and it is allowed to say so.
    const r = auditWith({ probed: PROBED, keyboardTrap: [], focusObscured: [] });
    expect(of(r, "2.1.2")?.status).toBe("C");
    expect(of(r, "2.4.11")?.status).toBe("C");
  });
});
