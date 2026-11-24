// #184 — what the rendered tier hands the adjudicator, browser-free.
//
//   • A consent placeholder is the capture's STATE, not the page's content: a headless browser
//     never accepts cookies, and the DSFR « … est désactivé » placeholder was judged as a 9.1
//     heading. Every anchor harvested inside one is tagged « état sans consentement ».
//   • A 320px overflow on a SHARED component (the same footer logo on every page) is one thing
//     to judge, stated once with its pages — and the brief says whether any text or control is
//     beyond the viewport, or only boxes overflow.
// Fixtures are synthetic: no third-party page content is copied here.
import { describe, expect, it } from "vitest";

import { harvestSubjects, SUBJECTS } from "../src/adjudicate-subjects.js";
import { consentContainerOf, consentMarkerFor } from "../src/consent.js";
import { resolveMessage } from "../src/messages.js";
import { elementsByTag, parseHtml } from "../src/parse/html.js";
import { reflowClippedParams } from "../src/probes.js";
import { validateSnapshotMeta } from "../src/snapshot.js";
import type { ReflowClipped } from "../src/types.js";

const page = (body: string) => `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1>${body}</main></body></html>`;

describe("consent placeholders are tagged « état sans consentement » (#184)", () => {
  it("recognises the consent managers named in the issue, and leaves a form's own consent checkbox alone", () => {
    expect(consentMarkerFor("", ["fr-consent-placeholder"])).toEqual({ vendor: "dsfr", kind: "placeholder" });
    expect(consentMarkerFor("sliding-popup", [])).toMatchObject({ vendor: "eu-cookie-compliance", kind: "banner" });
    expect(consentMarkerFor("tarteaucitronRoot", [])).toMatchObject({ vendor: "tarteaucitron" });
    expect(consentMarkerFor("didomi-host", [])).toMatchObject({ vendor: "didomi" });
    expect(consentMarkerFor("axeptio_overlay", [])).toMatchObject({ vendor: "axeptio" });
    expect(consentMarkerFor("", ["video-consent-placeholder"])).toEqual({ vendor: "generic", kind: "placeholder" });
    expect(consentMarkerFor("", ["cookie-consent-banner"])).toEqual({ vendor: "generic", kind: "banner" });
    // Page content that merely mentions consent.
    expect(consentMarkerFor("", ["consent-checkbox"])).toBeUndefined();
    expect(consentMarkerFor("consent", ["form-group"])).toBeUndefined();
  });

  it("tags a heading harvested inside a DSFR placeholder, and only that one", () => {
    const doc = parseHtml(
      page(`<div class="fr-consent-placeholder"><h3 class="fr-h6">Video service disabled</h3><button>Allow</button></div><h2>Real section</h2>`),
      ".ultra11y/pages/home/dom.html",
    );
    const headings = harvestSubjects(["headings"], [doc]);
    const inside = headings.find((x) => (x.ev.note ?? "").includes("Video service disabled"));
    const outside = headings.find((x) => (x.ev.note ?? "").includes("Real section"));
    expect(inside, "the placeholder's heading was not harvested at all").toBeDefined();
    expect(inside!.ev.note).toContain("état sans consentement");
    expect(inside!.ev.note).toContain("dsfr");
    expect(outside).toBeDefined();
    expect(outside!.ev.note).not.toContain("état sans consentement");
  });

  it("finds the container from any descendant", () => {
    const doc = parseHtml(page(`<div id="tarteaucitronRoot"><div><p id="x">Cookies</p></div></div>`), "p.html");
    const p = elementsByTag(doc, "p").find((e) => e.attribs.id === "x")!;
    expect(consentContainerOf(p)).toMatchObject({ vendor: "tarteaucitron", kind: "banner" });
    expect(consentContainerOf(elementsByTag(doc, "h1")[0]!)).toBeUndefined();
  });

  it("keeps `consent` and its markers through the meta whitelist", () => {
    const v = validateSnapshotMeta({
      v: 1,
      id: "home",
      name: "Home",
      url: "https://example.test/",
      consent: "none",
      consentMarkers: ["placeholder dsfr div.fr-consent-placeholder"],
    });
    expect(v.ok).toBe(true);
    expect(v.meta?.consent).toBe("none");
    expect(v.meta?.consentMarkers).toEqual(["placeholder dsfr div.fr-consent-placeholder"]);
    expect(validateSnapshotMeta({ v: 1, id: "home", name: "Home", url: "https://example.test/", consent: "maybe" }).ok).toBe(false);
  });
});

describe("the 320px reflow measure in the brief and in the finding (#184)", () => {
  const logo = { selector: "footer img.logo", html: '<img class="logo" src="l.svg">', detail: "déborde de 8px à droite (largeur 328px)" };
  const none: ReflowClipped = { text: [], textCount: 0, controls: [], controlCount: 0 };
  const snap = (id: string, reflow: unknown) => {
    const d = parseHtml(page("<p>x</p>"), `.ultra11y/pages/${id}/dom.html`);
    d.signals = { probes: { probed: ["1.4.10"], reflow } } as typeof d.signals;
    return d;
  };

  it("states a component shared by several pages once, with its pages", () => {
    const docs = ["a", "b", "c"].map((id) => snap(id, { horizontalScroll: true, widening: [logo], clipped: none }));
    const out = SUBJECTS["rendered:1.4.10"]!(docs);
    const shared = out.filter((x) => (x.ev.note ?? "").startsWith("shared component"));
    expect(shared).toHaveLength(1);
    expect(shared[0]!.ev.note).toContain("3 pages (a, b, c)");
    expect(shared[0]!.ev.note).toContain("footer img.logo");
    const perPage = out.filter((x) => (x.ev.note ?? "").startsWith('page="'));
    expect(perPage.every((x) => (x.ev.note ?? "").includes("[shared component]"))).toBe(true);
    expect(perPage.every((x) => (x.ev.note ?? "").includes("content beyond the viewport: NONE"))).toBe(true);
  });

  it("names the clipped text when there is some", () => {
    const text: ReflowClipped = {
      text: [{ selector: "p.intro", html: '<p class="intro">', detail: "texte « Lorem » posé 280px au-delà du bord droit du viewport" }],
      textCount: 1,
      controls: [],
      controlCount: 0,
    };
    const out = SUBJECTS["rendered:1.4.10"]!([snap("a", { horizontalScroll: true, widening: [], clipped: text })]);
    const line = out.find((x) => (x.ev.note ?? "").startsWith('page="a"'))!;
    expect(line.ev.note).toContain("1 text block(s) — p.intro");
    expect(out.some((x) => (x.ev.note ?? "").startsWith("shared component"))).toBe(false);
  });

  it("says in the finding's sentence whether content is out of reach, and nothing on an older capture", () => {
    const fr = (clipped?: ReflowClipped) =>
      resolveMessage({ message: "", msg: { id: "dyn-reflow", params: { widening: "footer img.logo", ...reflowClippedParams(clipped) } } }, "fr");
    expect(fr(none)).toContain("seules des boîtes débordent");
    expect(fr({ ...none, textCount: 2, controlCount: 1 })).toContain("2 bloc(s) de texte et 1 contrôle(s)");
    expect(fr(undefined)).toBe("Défilement horizontal à 320px de large — la page est élargie par footer img.logo.");
  });
});
