// 2.1.2 ÉTAIT LE CRITÈRE QUE PERSONNE NE MESURAIT.
//
// `src/report.ts` le disait noir sur blanc : « les cinq critères à restituer qu'AUCUN tier ne
// mesure (1.4.5, 2.1.2, 2.3.1, 2.4.11, 2.5.8) ». Conséquence, RGAA 12.9 — « la navigation ne
// doit pas contenir de piège au clavier » — atteignait un adjudicateur payant à chaque run, en
// portant ce que la source contenait de `preventDefault(`. Un piège n'est pas une propriété du
// code : c'est une propriété de l'anneau de tabulation, et l'anneau n'existe que dans un
// navigateur.
//
// Mesuré sur tests/fixtures/realworld : la worklist RGAA passe de 41 à 38 dès que la sonde
// tourne, et 12.9 se ferme sans modèle.
import { describe, expect, it } from "vitest";

import { probeKeyboardTrap, runLiveProbes } from "../src/probes.js";
import { PROBE_WCAG, PROBE_SEVERITY } from "../src/axe-map.js";

/** A page whose Tab ring is described by a script: `ring` is the sequence of active-element
 *  keys Tab produces, `null` meaning focus left the document. */
function fakePage(count: number, ring: (string | null)[]) {
  let i = 0;
  const log: string[] = [];
  return {
    log,
    keyboard: {
      press: async (k: string) => {
        log.push(`press:${k}`);
        if (k === "Tab") i++;
      },
    },
    evaluate: async (expr: string) => {
      // The setup expression returns the focusable count; the where-probe returns the ring.
      if (expr.includes("data-u11y-fp")) return count;
      const key = ring[Math.min(i, ring.length) - 1] ?? null;
      return key === null ? null : { key, tagged: !key.startsWith("?"), selector: `#${key}`, html: `<button id="${key}">` };
    },
  };
}

describe("probeKeyboardTrap", () => {
  it("reports nothing on a ring that always advances and then lets focus leave", async () => {
    const hits = await probeKeyboardTrap(fakePage(3, ["a", "b", "c", null]));
    expect(hits).toEqual([]);
  });

  it("reports nothing on a ring that wraps round to its first element", async () => {
    expect(await probeKeyboardTrap(fakePage(3, ["a", "b", "c", "a", "b", "c"]))).toEqual([]);
  });

  it("reports a cage: focus that will not move however many times Tab is pressed", async () => {
    const hits = await probeKeyboardTrap(fakePage(4, ["a", "b", "b", "b", "b", "b", "b"]));
    expect(hits).toHaveLength(1);
    expect(hits[0]?.selector).toBe("#b");
    expect(hits[0]?.detail).toMatch(/piège au clavier \(2\.1\.2\)/);
  });

  it("does not accuse a control that swallows ONE keystroke", async () => {
    // A listbox stepping through its options holds focus for a press and then moves on. Calling
    // that a trap would manufacture a blocker out of a widget behaving normally.
    expect(await probeKeyboardTrap(fakePage(4, ["a", "b", "b", "c", "d", null]))).toEqual([]);
  });

  it("refuses to accuse an element the setup pass never tagged", async () => {
    // An untagged element is identified by its selector alone, and a selector is not an
    // identity: two links in one list share one. Comparing them would report a trap on a page
    // whose focus was moving perfectly well. `?` marks an untagged key in this fake.
    expect(await probeKeyboardTrap(fakePage(4, ["?x", "?x", "?x", "?x", "?x"]))).toEqual([]);
  });

  it("never calls a single-focusable page a trap — Tab has nowhere else to go", async () => {
    expect(await probeKeyboardTrap(fakePage(1, ["a", "a", "a", "a"]))).toEqual([]);
  });

  it("is wired to 2.1.2, and as a blocker", () => {
    expect(PROBE_WCAG["keyboard-trap"]).toBe("2.1.2");
    expect(PROBE_SEVERITY["keyboard-trap"]).toBe("bloquant");
  });
});

describe("the probe declares itself, so its silence can be read as conformity", () => {
  it("records 2.1.2 in `probed` when it ran", async () => {
    const page = {
      keyboard: { press: async () => {} },
      evaluate: async (expr: string) => (expr.includes("data-u11y-fp") ? 0 : null),
      setViewportSize: async () => {},
      viewportSize: () => ({ width: 1280, height: 900 }),
      hover: async () => {},
      waitForTimeout: async () => {},
      addStyleTag: async () => ({}),
      mouse: { move: async () => {} },
    };
    const r = await runLiveProbes(page, { only: ["2.1.2"] });
    expect(r.probed).toContain("2.1.2");
    expect(r.keyboardTrap).toEqual([]);
  });

  it("records a SKIP instead, on a page object with no keyboard", async () => {
    const page = {
      evaluate: async () => null,
      setViewportSize: async () => {},
      viewportSize: () => ({ width: 1280, height: 900 }),
      hover: async () => {},
      waitForTimeout: async () => {},
      addStyleTag: async () => ({}),
    };
    const r = await runLiveProbes(page, { only: ["2.1.2"] });
    expect(r.probed).not.toContain("2.1.2");
    expect(r.skipped?.some((s) => s.sc === "2.1.2")).toBe(true);
  });
});
