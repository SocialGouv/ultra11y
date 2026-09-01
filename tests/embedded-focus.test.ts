// AN ELEMENT WE CANNOT SEE INSIDE MUST NOT BE ACCUSED OF ANYTHING.
//
// `iframe`, `audio[controls]` and `video[controls]` were added to the tagging selector because
// they really are focusable and leaving them out let a page be cleared without them. The walk
// that follows, though, only ever sees the PARENT document's `activeElement` — and while the
// user tabs through the controls inside an embedded document, that stays the host element,
// press after press.
//
// The keyboard-trap walk reads exactly that pattern as a cage: focus that will not move. So a
// page carrying a video player, a payment frame, a map or a support widget was reported as a
// `bloquant` 2.1.2 non-conformity — a blocker manufactured out of our own blindness, on
// perfectly ordinary markup, and one that can fail a consumer's gate.
//
// The measurement we cannot make is not a finding. The three tags leave the tagging pass, and
// the walk's existing untagged detection then does the honest thing: Tab crosses something
// nothing measured, so the page is not cleared either.
import { describe, expect, it } from "vitest";

import { focusSetupExpr, probeKeyboardTrapRing } from "../src/probes.js";

/** A page whose tab ring is a script, in the shape `FOCUS_WHERE_PROBE` returns. */
function ringPage(count: number, ring: (string | null)[]) {
  let i = 0;
  return {
    keyboard: {
      press: async (k: string) => {
        if (k === "Tab") i++;
      },
    },
    evaluate: async (expr: string) => {
      if (expr.includes("const focusables")) return { n: count, total: count };
      const key = ring[Math.min(i, ring.length) - 1] ?? null;
      return key === null ? null : { key, tagged: true, selector: `#${key}`, html: `<${key}>`, segments: 1 };
    },
  };
}

describe("the tagging selector stops at what this engine can measure", () => {
  // The selector line itself, not the whole expression: the comment above it names the tags it
  // deliberately leaves out, and matching on prose would pass for the wrong reason.
  const sel = /const sel = '([^']+)'/.exec(focusSetupExpr())?.[1] ?? "";

  it("is found at all", () => {
    expect(sel).toContain("button:not([disabled])");
  });

  it("still tags the native focusables the selector used to miss", () => {
    for (const tag of ["summary", "area[href]", '[contenteditable]:not([contenteditable="false"])']) {
      expect(sel, `${tag} is an ordinary in-document focusable`).toContain(tag);
    }
  });

  it("does NOT tag an element whose focus lives in another document", () => {
    // A tagged iframe is focus we can see arrive and never see move — which the trap walk reads
    // as a cage, at `bloquant`.
    for (const tag of ["iframe", "audio[controls]", "video[controls]"]) {
      expect(sel, `${tag} holds focus this walk cannot follow, so tagging it manufactures findings`).not.toContain(tag);
    }
  });
});

describe("the walk that used to manufacture the blocker", () => {
  it("reports a real cage — focus that does not move on a page with other focusables", async () => {
    const r = await probeKeyboardTrapRing(ringPage(4, ["a", "b", "b", "b", "b", "b", "b"]));
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]?.selector).toBe("#b");
  });

  it("still lets an ordinary ring through", async () => {
    const r = await probeKeyboardTrapRing(ringPage(3, ["a", "b", "c", null]));
    expect(r.hits).toEqual([]);
    expect(r.complete).toBe(true);
  });
});
