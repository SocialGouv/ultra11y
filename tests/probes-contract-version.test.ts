// THE COVERAGE CONTRACT IN A `probes.json` HAS A VERSION NOW, AND IT HAS ONE IN BOTH
// DIRECTIONS — because a snapshot outlives the engine that wrote it, and the two disagreements
// it can produce are both false conformities.
//
// READING AN OLD CAPTURE. Up to 5.42.0, `probed` was written for a walk of the tab ring, of the
// hover triggers or of the page's interactions WITHOUT ANY completeness check: a ring cut off
// at the tagging cap, a hover pass that opened ten of eleven tooltips, a live-region pass that
// pressed no button all wrote the same claim as a whole one. This engine now tracks that — but
// only for what it measures itself. Believing an older file's claim for those criteria replays
// the very defect the version exists to close.
//
// BEING READ BY AN OLD ENGINE. The reverse case is the same shape from the other side: an
// Action still on 5.41.x folds `focusVisible`, `hover`, `reflowZoom` and `textSpacing` and
// knows nothing of `focusObscured`, `keyboardTrap`, `liveRegion` or the three `inputOverflow`
// buckets — while trusting `probed` completely. Hand it a capture where a browser recorded a
// blocking keyboard trap and it publishes `C`. Nothing in a future version can fix a reader
// that already shipped; what a WRITER can do is not claim a criterion is measured when the
// evidence for it lives somewhere that reader will not look.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { PROBES_VERSION, PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import { runLiveProbes } from "../src/probes.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-pv-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const DOM = `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1><p>Bonjour</p></main></body></html>`;
// The walk-dependent criteria a SNAPSHOT alone can close. 4.1.3 is walk-dependent too but the
// offline tier never concludes it on its own — it needs the merged `scope.scan.testedScs` —
// so it is `manual` either way here and would make the assertion say nothing.
const WALKED = ["1.4.13", "2.1.2", "2.4.7", "2.4.11"];

function auditWith(probes: Record<string, unknown>) {
  writeSnapshot(root, { meta: { v: SNAPSHOT_VERSION, id: "p0", name: "P0", url: "https://x/0" }, dom: DOM, probes: probes as never });
  return runAudit({ inputs: [join(root, PAGES_DIR)] });
}
const of = (r: ReturnType<typeof runAudit>, sc: string) => r.criteria.find((c) => c.id === sc);

describe("an old capture's coverage claim is not believed for what it never checked", () => {
  it("credits a versioned capture", () => {
    const r = auditWith({ v: PROBES_VERSION, probed: [...WALKED, "1.4.10"] });
    for (const sc of WALKED) expect(of(r, sc)?.status, sc).toBe("C");
  });

  it("does NOT credit an unversioned one for the criteria whose completeness it never tracked", () => {
    const r = auditWith({ probed: [...WALKED, "1.4.10"] });
    for (const sc of WALKED) expect(of(r, sc)?.status, sc).toBe("manual");
  });

  it("…but keeps believing it for the ones a partial walk cannot affect", () => {
    // 1.4.10 is one `evaluate` at 320px: it either ran or it did not, and there is no half of
    // it to have been cut short. Withholding it would cost coverage for nothing.
    expect(of(auditWith({ probed: ["1.4.10"] }), "1.4.10")?.status).toBe("C");
  });
});

describe("a writer does not claim coverage an older reader would misread", () => {
  /** A page whose live-region pass finds a status message announced to nobody. */
  function page(hits: unknown[]) {
    return {
      viewportSize: () => ({ width: 1280, height: 900 }),
      setViewportSize: async () => {},
      addStyleTag: async () => ({}),
      hover: async () => {},
      waitForTimeout: async () => {},
      keyboard: { press: async () => {} },
      mouse: { move: async () => {} },
      evaluate: async (script: string) => {
        if (script.includes("horizontalScroll")) return { horizontalScroll: false };
        if (script.includes("const focusables")) return { n: 0, total: 0 };
        if (script.includes("MutationObserver")) return { hits, untried: 0, navigated: false };
        return [];
      },
    };
  }

  it("withholds the criterion whose only evidence sits in a bucket an old reader ignores", async () => {
    const hit = [{ selector: "div.alert", html: "<div>", detail: "hors région live" }];
    const r = await runLiveProbes(page(hit), { liveRegion: true, only: ["4.1.3"] });
    expect(r.liveRegion, "the finding itself is kept — it is the CLAIM that is withheld").toHaveLength(1);
    expect(r.probed, "an engine that cannot see `liveRegion` must not read this silence as conformity").not.toContain("4.1.3");
  });

  it("claims it normally when there is nothing an old reader could miss", async () => {
    const r = await runLiveProbes(page([]), { liveRegion: true, only: ["4.1.3"] });
    expect(r.probed).toContain("4.1.3");
  });
});
