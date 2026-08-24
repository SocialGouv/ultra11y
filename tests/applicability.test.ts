import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";
import type { Status } from "../src/types.js";
import { INAPPLICABLE_STATUS } from "../src/types.js";

// A judgment or rendering criterion used to have exactly two outcomes: NC when a rule fired,
// « to assess » otherwise. So a repository with no audio and no video still reported all five
// time-based-media criteria as « to assess » — 13 of them once RGAA's theme 4 projects from
// them. « Not applicable » is a real normative verdict, and the engine can prove it whenever a
// criterion's subject matter is a thing you can look for in the source.
//
// The dangerous direction is the one these tests spend most of their effort on: a WRONG NA is a
// non-conformity hidden inside a report someone signs, so every predicate must stay open on
// anything ambiguous.

const dir = mkdtempSync(join(tmpdir(), "u11y-applic-"));

function audit(html: string, name = `p${Math.random().toString(36).slice(2)}.html`) {
  const f = join(dir, name);
  writeFileSync(f, html);
  return runAudit({ inputs: [f] });
}

const doc = (body: string) => `<!doctype html>
<html lang="en">
<head><title>Page</title></head>
<body><main><h1>Title</h1>${body}</main></body>
</html>
`;

const statusOf = (r: ReturnType<typeof runAudit>, id: string): Status | undefined => r.criteria.find((c) => c.id === id)?.status;
const justificationOf = (r: ReturnType<typeof runAudit>, id: string) => r.criteria.find((c) => c.id === id)?.justification;

const MEDIA_SCS = ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5"];
const FORM_SCS = ["1.3.5", "3.3.1", "3.3.2", "3.3.3", "3.3.4", "3.3.7", "3.3.8"];

describe("time-based media (WCAG 1.2.x)", () => {
  it("closes every media criterion as NA when nothing in scope carries media", () => {
    const r = audit(doc("<p>Text only.</p>"));
    for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).toBe(INAPPLICABLE_STATUS);
  });

  it("justifies each NA by naming what was searched for, so a reader can falsify it", () => {
    const r = audit(doc("<p>Text only.</p>"));
    for (const sc of MEDIA_SCS) {
      const j = justificationOf(r, sc) ?? "";
      expect(j, `SC ${sc}`).toMatch(/no time-based media in scope/i);
      expect(j, `SC ${sc}`).toMatch(/<video>/); // the elements it looked for
      expect(j, `SC ${sc}`).toMatch(/file\(s\) audited/); // and the scope of the claim
    }
  });

  // Each of these must keep the criteria OPEN — either it IS media, or it is genuinely
  // uncertain, and being wrong that way publishes "not applicable" over a real video.
  for (const [label, markup] of [
    ["a <video>", '<video src="v.mp4"></video>'],
    ["an <audio>", '<audio src="a.mp3"></audio>'],
    ["a stray <track>", '<track kind="captions" src="c.vtt">'],
    ["a bare <source>", '<source src="v.webm">'],
    ["a YouTube embed", '<iframe src="https://www.youtube.com/embed/abc" title="Démo"></iframe>'],
    ["an iframe whose title says video", '<iframe src="https://example.org/x" title="Vidéo de présentation"></iframe>'],
    ["an iframe serving an .mp4", '<iframe src="https://cdn.example.org/clip.mp4"></iframe>'],
    ["an <object> of unknown type", '<object data="x.swf"></object>'],
    ["an <embed> declaring video", '<embed src="x" type="video/mp4">'],
  ] as const) {
    it(`keeps the media criteria open when the page has ${label}`, () => {
      const r = audit(doc(markup));
      for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe(INAPPLICABLE_STATUS);
    });
  }

  // …and these must NOT hold them open. "Over-inclusion is the safe direction" is a rule about
  // UNCERTAINTY, not a licence to treat every embed as a video. Measured on a real audit: one
  // <iframe> holding an analytics opt-out widget kept all 12 RGAA multimedia criteria « to
  // assess » across a codebase with no audio and no video anywhere — twelve criteria a human
  // then reads through to reach the same "nothing here" the engine could have proved.
  for (const [label, markup] of [
    ["an analytics opt-out iframe", '<iframe src="https://matomo.example.fr/index.php?module=CoreAdminHome" title="Gestion du suivi"></iframe>'],
    ["a map iframe", '<iframe src="https://maps.example.org/embed?q=Paris" title="Carte"></iframe>'],
    ["a <canvas> — it can carry no caption or audio description", "<canvas></canvas>"],
    ["a <marquee> — moving content is 2.2.2, not 1.2.x", "<marquee>Actu</marquee>"],
  ] as const) {
    it(`still closes the media criteria as NA with ${label}`, () => {
      const r = audit(doc(markup));
      for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).toBe(INAPPLICABLE_STATUS);
    });
  }

  it("keeps them open for the WHOLE audit when a single other file carries media", () => {
    // Applicability is OR-folded across the scope: NA means "nothing, anywhere in what was
    // audited" — never "nothing in this file".
    const a = join(dir, "text.html");
    const b = join(dir, "player.html");
    writeFileSync(a, doc("<p>Text only.</p>"));
    writeFileSync(b, doc('<video src="v.mp4"></video>'));
    const r = runAudit({ inputs: [a, b] });
    for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe(INAPPLICABLE_STATUS);
  });
});

describe("user input (WCAG 3.3.x + 1.3.5)", () => {
  it("closes the form criteria as NA when nothing in scope takes input", () => {
    const r = audit(doc("<p>Read-only content.</p>"));
    for (const sc of FORM_SCS) expect(statusOf(r, sc), `SC ${sc}`).toBe(INAPPLICABLE_STATUS);
    expect(justificationOf(r, "3.3.1")).toMatch(/no user input in scope/i);
  });

  for (const [label, markup] of [
    ["a native input", '<label for="e">Email</label><input id="e">'],
    ["a select", '<label for="s">Choice</label><select id="s"><option>a</option></select>'],
    ["a textarea", '<label for="t">Note</label><textarea id="t"></textarea>'],
    ["a bare <form>", "<form></form>"],
    ["an ARIA textbox standing in for a field", '<div role="textbox" aria-label="Name"></div>'],
    ["a contenteditable region", '<div contenteditable="true"></div>'],
  ] as const) {
    it(`keeps the form criteria open when the page has ${label}`, () => {
      const r = audit(doc(markup));
      for (const sc of FORM_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe(INAPPLICABLE_STATUS);
    });
  }
});

describe("motion actuation (WCAG 2.5.4)", () => {
  it("is NA when no device-motion API is used", () => {
    const r = audit(doc("<p>Static.</p>"));
    expect(statusOf(r, "2.5.4")).toBe(INAPPLICABLE_STATUS);
    expect(justificationOf(r, "2.5.4")).toMatch(/no motion actuation in scope/i);
  });

  for (const api of ["devicemotion", "deviceorientation", "DeviceOrientationEvent", "new Accelerometer()"]) {
    it(`stays open when the source mentions ${api}`, () => {
      const r = audit(doc(`<script>${api}</script>`));
      expect(statusOf(r, "2.5.4")).not.toBe(INAPPLICABLE_STATUS);
    });
  }
});

describe("a criterion closed for want of a subject still says so", () => {
  it("reads conforming, but is flagged and justified rather than merely asserted", () => {
    // The tool reports two answers, not four (INAPPLICABLE_STATUS). What separates this
    // conformity from "nobody looked" is not the label — it is the flag that marks it and the
    // justification that names the subject looked for and the scope it was looked for in.
    const r = audit(doc("<p>Text only.</p>"));
    for (const sc of [...MEDIA_SCS, ...FORM_SCS, "2.5.4"]) {
      const c = r.criteria.find((x) => x.id === sc);
      expect(c?.status, `SC ${sc}`).toBe(INAPPLICABLE_STATUS);
      expect(c?.inapplicable, `SC ${sc} must be marked as closed for absence`).toBe(true);
      expect((c?.justification ?? "").length, `SC ${sc} must say what it looked for`).toBeGreaterThan(0);
    }
  });

  it("never outranks a sibling nobody has ruled on", () => {
    // The failure this guards is exact: RGAA 6.1 maps onto an image criterion closed for
    // absence AND a link criterion still open. Letting the first win would publish "conforming"
    // over links no one had read — conforming because nobody looked, in one aggregation.
    const r = audit(doc('<p>Voir <a href="/aide">la page d\'aide</a>.</p>'));
    const c61 = derivePackResults(r, "rgaa").find((c) => c.id === "6.1");
    expect(c61?.status).toBe("manual");
  });

  it("loses to a normative finding: a criterion a rule failed stays NC", () => {
    // An autoplaying video with no controls fails 2.2.2 — and the presence of the <video>
    // also keeps the media criteria open, so nothing here can be NA by accident.
    const r = audit(doc('<video src="v.mp4" autoplay></video>'));
    expect(statusOf(r, "2.2.2")).toBe("NC");
    for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe(INAPPLICABLE_STATUS);
  });

  it("leaves the criteria about the whole document exactly as they were", () => {
    // 1.3.1, 4.1.2, 1.4.3 and friends are about the document itself; nothing lets the engine
    // rule them out of scope, so they must still arrive as « to assess ».
    const r = audit(doc("<p>Text only.</p>"));
    for (const sc of ["1.3.1", "4.1.2", "1.4.3"]) expect(statusOf(r, sc), `SC ${sc}`).toBe("manual");
    // 2.4.4 is NOT one of them, and that is the point of the harvest-subject layer: link
    // purpose is about LINKS, and a page with none has nothing to judge. It used to sit here
    // because the engine had no way to ask "does this page contain a link at all?".
    expect(statusOf(r, "2.4.4")).toBe(INAPPLICABLE_STATUS);
  });

  it("counts in the pass rate, and never as a non-conformity", () => {
    // These ARE conformities now, so they belong in C ÷ (C+NC) — the owner's rule for this
    // tool. The invariant that must not move is the direction: an absent subject can never
    // manufacture a failure, and no criterion carries `NA` any more.
    const bare = audit(doc("<p>Text only.</p>"));
    expect(bare.conformancePct).toBe(100);
    expect(bare.criteria.filter((c) => c.status === "NA")).toEqual([]);
    expect(bare.criteria.filter((c) => c.inapplicable).length).toBeGreaterThan(10);
    for (const c of bare.criteria.filter((x) => x.inapplicable)) expect(c.status).not.toBe("NC");
  });
});

describe("the RGAA projection carries it through", () => {
  it("closes theme 4 (Multimédia) on a media-free page, flagged for what it is", () => {
    const r = audit(doc("<p>Texte seulement.</p>"));
    const theme4 = derivePackResults(r, "rgaa").filter((c) => c.id.startsWith("4."));

    const closed = theme4.filter((c) => c.inapplicable);
    expect(closed.length).toBeGreaterThan(0);
    for (const c of closed) expect(c.status).toBe(INAPPLICABLE_STATUS);
    // A page with no media can never fail a media criterion.
    expect(theme4.every((c) => c.status !== "NC")).toBe(true);
  });

  it("shrinks the « to assess » bucket rather than the non-conformity one", () => {
    const bare = derivePackResults(audit(doc("<p>Texte seulement.</p>")), "rgaa");
    const closed = bare.filter((c) => c.inapplicable).length;
    const manualCount = bare.filter((c) => c.status === "manual").length;
    const ncCount = bare.filter((c) => c.status === "NC").length;

    expect(closed).toBeGreaterThan(1);
    expect(ncCount).toBe(0); // nothing on this page fails anything
    expect(closed + manualCount).toBeLessThanOrEqual(106);
    expect(bare.filter((c) => c.status === "NA")).toEqual([]);
  });
});

// « To assess » used to be a shrug. One generic sentence per tier answered for all 52 undecided
// criteria: "needs a rendered DOM (contrast, focus visibility, zoom/reflow, target size)" was
// printed against 1.4.5 (images of text) as readily as against 1.4.3 (contrast), naming four
// measurements of which at most one was the criterion's. A reader could not tell what was
// missing, and neither could the next run.
describe("every criterion left to assess says why, and where its evidence comes from", () => {
  const r = audit(doc('<p>Text</p><label for="e">Email</label><input id="e"><video src="v.mp4"></video>'));

  it("gives every residual risk a non-empty reason", () => {
    expect(r.residualRisks.length).toBeGreaterThan(0);
    for (const risk of r.residualRisks) {
      expect(risk.reason.trim(), `SC ${risk.criteriaId}`).not.toBe("");
      expect(risk.reason.length, `SC ${risk.criteriaId}`).toBeGreaterThan(20);
    }
  });

  it("names the measurement that decides each rendering criterion, not a generic list", () => {
    const reasonOf = (sc: string) => r.residualRisks.find((x) => x.criteriaId === sc)?.reason ?? "";
    expect(reasonOf("1.4.3")).toMatch(/computed text\/background colours/i);
    expect(reasonOf("1.4.10")).toMatch(/320px viewport/i);
    expect(reasonOf("2.4.7")).toMatch(/:focus/);
    expect(reasonOf("1.4.4")).toMatch(/200% zoom/i);
  });

  it("says plainly when NO automated tier decides a criterion, instead of pointing at `scan`", () => {
    // 1.4.5 is no longer here: its subject is images, and this fixture has none, so it is now
    // « non applicable » and carries no residual risk at all.
    //
    // 2.1.2 left this list the day `probeKeyboardTrap` landed — a tier DOES decide it now, so
    // its reason points at `scan` like every other measured criterion. It is asserted below,
    // with the ones that carry a runnable command, which is the whole difference.
    //
    // 2.4.11 left it the same way, on the same walk of the tab ring as 2.4.7. It mattered more
    // there than anywhere else: with no tier measuring it, the criterion harvested ZERO
    // evidence, so no agent could rule it `C` either — the gate needs a citation and there was
    // nothing to cite. A cell nobody could fill, by any means.
    for (const sc of ["2.3.1"]) {
      expect(r.residualRisks.find((x) => x.criteriaId === sc)?.reason, `SC ${sc}`).toMatch(/no automated tier decides this/i);
    }
    expect(r.residualRisks.some((x) => x.criteriaId === "1.4.5")).toBe(false);
    expect(r.criteria.find((c) => c.id === "1.4.5")?.status).toBe(INAPPLICABLE_STATUS);
  });

  it("carries a runnable command wherever one would actually help", () => {
    for (const sc of ["1.4.3", "1.4.4", "1.4.10", "1.4.12", "1.4.13", "2.1.2", "2.4.7", "2.4.11", "4.1.3"]) {
      expect(r.residualRisks.find((x) => x.criteriaId === sc)?.reason, `SC ${sc}`).toMatch(/`[^`]*(scan|verify)[^`]*`/);
    }
  });
});
