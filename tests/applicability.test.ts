import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAudit } from "../src/audit.js";
import { derivePackResults } from "../src/standards/index.js";
import type { Status } from "../src/types.js";

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
    for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).toBe("NA");
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

  // Each of these must keep the criteria OPEN. Over-inclusion is the safe direction: an
  // <iframe> is usually not media, and it still counts, because being wrong the other way
  // publishes "not applicable" over a real video.
  for (const [label, markup] of [
    ["a <video>", '<video src="v.mp4"></video>'],
    ["an <audio>", '<audio src="a.mp3"></audio>'],
    ["a stray <track>", '<track kind="captions" src="c.vtt">'],
    ["an <iframe> that might be an embed", '<iframe src="https://example.org/player" title="Player"></iframe>'],
    ["an <object>", '<object data="x.swf"></object>'],
    ["an <embed>", '<embed src="x.mp4">'],
    ["a <canvas>", "<canvas></canvas>"],
  ] as const) {
    it(`keeps the media criteria open when the page has ${label}`, () => {
      const r = audit(doc(markup));
      for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe("NA");
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
    for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe("NA");
  });
});

describe("user input (WCAG 3.3.x + 1.3.5)", () => {
  it("closes the form criteria as NA when nothing in scope takes input", () => {
    const r = audit(doc("<p>Read-only content.</p>"));
    for (const sc of FORM_SCS) expect(statusOf(r, sc), `SC ${sc}`).toBe("NA");
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
      for (const sc of FORM_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe("NA");
    });
  }
});

describe("motion actuation (WCAG 2.5.4)", () => {
  it("is NA when no device-motion API is used", () => {
    const r = audit(doc("<p>Static.</p>"));
    expect(statusOf(r, "2.5.4")).toBe("NA");
    expect(justificationOf(r, "2.5.4")).toMatch(/no motion actuation in scope/i);
  });

  for (const api of ["devicemotion", "deviceorientation", "DeviceOrientationEvent", "new Accelerometer()"]) {
    it(`stays open when the source mentions ${api}`, () => {
      const r = audit(doc(`<script>${api}</script>`));
      expect(statusOf(r, "2.5.4")).not.toBe("NA");
    });
  }
});

describe("an NA never replaces a real verdict", () => {
  it("never turns into a C — NA says the criterion does not apply, not that it is met", () => {
    const r = audit(doc("<p>Text only.</p>"));
    for (const sc of [...MEDIA_SCS, ...FORM_SCS, "2.5.4"]) expect(statusOf(r, sc), `SC ${sc}`).not.toBe("C");
  });

  it("loses to a normative finding: a criterion a rule failed stays NC", () => {
    // An autoplaying video with no controls fails 2.2.2 — and the presence of the <video>
    // also keeps the media criteria open, so nothing here can be NA by accident.
    const r = audit(doc('<video src="v.mp4" autoplay></video>'));
    expect(statusOf(r, "2.2.2")).toBe("NC");
    for (const sc of MEDIA_SCS) expect(statusOf(r, sc), `SC ${sc}`).not.toBe("NA");
  });

  it("leaves the criteria with no subject-matter predicate exactly as they were", () => {
    // 1.3.1, 2.4.4, 4.1.2 and friends are about the whole document; nothing lets the engine
    // rule them out of scope, so they must still arrive as « to assess ».
    const r = audit(doc("<p>Text only.</p>"));
    for (const sc of ["1.3.1", "2.4.4", "4.1.2", "1.4.3"]) expect(statusOf(r, sc), `SC ${sc}`).toBe("manual");
  });

  it("keeps every NA out of the automatic pass rate", () => {
    const bare = audit(doc("<p>Text only.</p>"));
    // conformancePct is C ÷ (C+NC): a pile of new NAs must not move it.
    expect(bare.conformancePct).toBe(100);
    expect(bare.criteria.filter((c) => c.status === "NA").length).toBeGreaterThan(10);
  });
});

describe("the RGAA projection carries the NA through", () => {
  it("reports theme 4 (Multimédia) criteria as not applicable on a media-free page", () => {
    const r = audit(doc("<p>Texte seulement.</p>"));
    const derived = derivePackResults(r, "rgaa");
    const theme4 = derived.filter((c) => c.id.startsWith("4."));

    expect(theme4.filter((c) => c.status === "NA").length).toBeGreaterThan(0);
    // …and none of them was quietly upgraded to conforming.
    expect(theme4.every((c) => c.status !== "C")).toBe(true);
  });

  it("shrinks the « to assess » bucket rather than the non-conformity one", () => {
    const bare = derivePackResults(audit(doc("<p>Texte seulement.</p>")), "rgaa");
    const naCount = bare.filter((c) => c.status === "NA").length;
    const manualCount = bare.filter((c) => c.status === "manual").length;

    expect(naCount).toBeGreaterThan(1); // before this change, only RGAA 4.10 could be NA
    expect(naCount + manualCount).toBeLessThanOrEqual(106);
  });
});
