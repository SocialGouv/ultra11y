// The worldwide core carries its own normative text.
//
// The dataset used to ship ids, titles and an Understanding URL — so an offline agent could
// NAME a criterion but not read it, and had to recall the requirement from memory. That is
// exactly how invented non-conformities get written. Meanwhile the RGAA pack shipped its
// full criterion text and a 119-entry glossary, which made the French standard richer than
// the worldwide one it is derived from.
import { describe, expect, it } from "vitest";
import { allSC, coreGlossary, getSC, scText } from "../src/wcag.js";
import { criterionView } from "../src/criteria-view.js";

describe("every shipped success criterion carries its normative wording", () => {
  it("leaves none of the 55 without text", () => {
    const missing = allSC()
      .filter((c) => !c.text?.trim())
      .map((c) => c.sc);
    expect(missing).toEqual([]);
  });

  it("reproduces the requirement, not a paraphrase", () => {
    // Verbatim from the W3C source, so a reader can rule against the actual words.
    expect(getSC("1.4.3")!.text).toContain("contrast ratio of at least 4.5:1");
    expect(getSC("1.1.1")!.text).toContain("text alternative that serves the equivalent purpose");
  });

  it("keeps the exceptions as their own labelled lines", () => {
    // An exception's NAME decides whether the exception applies. Flattening
    // "Large Text: …" into the sentence above it would lose that.
    const text = getSC("1.4.3")!.text!;
    expect(text).toMatch(/^Large Text:$/m);
    expect(text).toMatch(/^Logotypes:$/m);
  });

  it("labels a note as a note", () => {
    expect(getSC("1.4.10")!.text).toMatch(/^Note: /m);
  });

  it("drops the fragment's own chrome", () => {
    // The <h4> title, the conformance level and the 2.2 "New" marker are metadata the
    // dataset already carries in typed fields — repeating them as prose is noise.
    const focus = getSC("2.4.11")!;
    expect(focus.text).not.toMatch(/^New$/m);
    expect(focus.text).not.toContain("Focus Not Obscured");
  });
});

describe("the WCAG glossary", () => {
  it("ships the terms WCAG defines", () => {
    const g = coreGlossary();
    expect(Object.keys(g).length).toBeGreaterThan(90);
    expect(g["large-scale"]?.body).toMatch(/18 point/);
    expect(g["text-alternative"]?.title).toBe("text alternative");
  });

  it("attaches to a criterion only the terms its wording actually links", () => {
    // Resolved from the W3C source's own `<a>` term links, never by matching words against
    // prose — a definition must be attached because the criterion cites it.
    const r = criterionView("wcag", "1.4.3", "en");
    const anchors = (r.criterion as { glossary: { anchor: string }[] }).glossary.map((g) => g.anchor);
    expect(anchors).toContain("large-scale");
    expect(anchors).toContain("contrast-ratio");
    expect(anchors).not.toContain("captcha");
  });

  it("resolves every term a criterion cites", () => {
    const g = coreGlossary();
    for (const c of allSC()) {
      for (const slug of c.terms ?? []) {
        expect(g[slug], `${c.sc} cites "${slug}"`).toBeTruthy();
      }
    }
  });
});

describe("the core reference is now as rich as the country pack derived from it", () => {
  it("gives a WCAG criterion text, terms and a decision protocol", () => {
    const r = criterionView("wcag", "1.1.1", "en");
    const c = r.criterion as { text?: string; glossary: unknown[]; adjudication?: unknown };
    expect(c.text).toBeTruthy();
    expect(c.glossary.length).toBeGreaterThan(0);
    expect(c.adjudication).toBeTruthy();
  });
});

describe("the French frame is French all the way down", () => {
  it("carries the authorized French body for every shipped criterion", () => {
    const missing = allSC()
      .filter((c) => !c.textFr?.trim())
      .map((c) => c.sc);
    expect(missing).toEqual([]);
  });

  it("renders the requirement in French under a French heading", () => {
    // The half-translation an RGAA auditor reads first: French title, French labels, then
    // English requirement prose. `scText` resolves the language the caller asked for.
    expect(scText("1.4.3", "fr")).toContain("rapport de contraste d’au moins 4,5:1");
    expect(scText("1.4.3", "fr")).not.toContain("contrast ratio");
    expect(scText("1.4.3", "en")).toContain("contrast ratio of at least 4.5:1");
  });

  it("ships a French glossary, keyed by the French page's OWN slugs", () => {
    // The two W3C pages do not agree on slugs: the FR page names several definitions in the
    // plural ("user-agents" vs the English file "user-agent") and a few differently outright
    // ("purpose-of-each-link" vs "link-purpose"). Each language therefore keeps its own
    // keys — mapping them onto each other would be a guess, and a wrong one drops
    // definitions silently.
    const en = coreGlossary("en");
    const fr = coreGlossary("fr");
    expect(Object.keys(en).length).toBeGreaterThan(90);
    expect(Object.keys(fr).length).toBeGreaterThan(90);
    expect(fr["large-scale"]!.body).toContain("18 points");
    expect(en["large-scale"]!.body).toContain("18 point");
    expect(fr["user-agents"]).toBeTruthy();
    expect(en["user-agent"]).toBeTruthy();
  });

  it("resolves every term a criterion cites, in that criterion's own language", () => {
    const en = coreGlossary("en");
    const fr = coreGlossary("fr");
    for (const c of allSC()) {
      for (const slug of c.terms ?? []) expect(en[slug], `${c.sc} cites en "${slug}"`).toBeTruthy();
      for (const slug of c.termsFr ?? []) expect(fr[slug], `${c.sc} cites fr "${slug}"`).toBeTruthy();
    }
  });

  it("attaches a criterion's defined terms in the frame's language", () => {
    const fr = criterionView("wcag", "1.4.3", "fr");
    const terms = (fr.criterion as { glossary: { anchor: string; title: string }[] }).glossary;
    expect(terms.find((t) => t.anchor === "large-scale")!.title).toBe("(texte) agrandi");

    const en = criterionView("wcag", "1.4.3", "en");
    const enTerms = (en.criterion as { glossary: { anchor: string; title: string }[] }).glossary;
    expect(enTerms.find((t) => t.anchor === "large-scale")!.title).toBe("large scale");
  });
});
