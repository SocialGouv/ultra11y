// THE DEFINITIONS THAT DECIDE THE VERDICT ARE PRINTED WHOLE (#182).
//
// The brief used to keep five glossary terms and cut each definition at 420 characters,
// mid-note. A field review traced most disputed non-conformities to exactly that cut: the
// sentence lost was the one the criterion turns on. These tests pin the sentences named in the
// issue, then check the property for every RGAA criterion: each cited term is printed, and
// each printed definition is the pack's full text.
//
// The briefs are rendered from synthetic items (a criterion id, no evidence): the glossary
// block depends on the criterion alone, never on the page.
import { describe, it, expect } from "vitest";
import { type AdjudicationItem, formatAdjudication, glossaryAnchorsOf } from "../src/adjudicate.js";
import { getCriterion, loadPack, resolveGlossary } from "../src/standards/index.js";

const pack = loadPack("rgaa");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const item = (criteriaId: string): AdjudicationItem =>
  ({ criteriaId, automatability: "judgment", verdict: "manual", reason: "needs-judgment", evidence: [] }) as unknown as AdjudicationItem;
const brief = (id: string, lang: "fr" | "en" = "fr") => formatAdjudication([item(id)], lang, "rgaa", { preamble: false, contract: false });

/** The printed glossary block: from its heading to the first blank line. */
function glossaryLines(md: string): string[] {
  const block = md.split("**Termes définis par le référentiel**")[1]?.split("\n\n").slice(1, 2)[0] ?? "";
  return block.split("\n").filter((l) => l.startsWith("- **"));
}

describe("the sentences the verdict turns on are in the brief", () => {
  it.each([
    ["11.5", "intitulés de label ne sont pas suffisants"],
    ["6.1", "Ambigu pour tout le monde"],
    ["9.3", "toutes les listes ne nécessitent pas obligatoirement une structure de liste"],
    ["7.4", "Un changement de contenu n’est pas toujours un changement de contexte"],
  ])("RGAA %s carries « %s »", (id, sentence) => {
    expect(norm(brief(id))).toContain(sentence);
  });

  it("RGAA 8.9 carries Note 1 of « Uniquement à des fins de présentation » in full", () => {
    const body = norm(resolveGlossary("rgaa", "uniquement-a-des-fins-de-presentation")!.body);
    const note1 = body.slice(body.indexOf("Note 1 :"), body.indexOf("Note 2 :")).trim();
    expect(note1.length).toBeGreaterThan(100);
    expect(norm(brief("8.9"))).toContain(note1);
  });

  it("prints the definitions in an English brief too — the glossary is the pack's text", () => {
    expect(norm(brief("11.5", "en"))).toContain("intitulés de label ne sont pas suffisants");
  });
});

describe("no definition in any RGAA brief is cut", () => {
  const ids = pack.criteria.map((c) => c.id);

  it("covers all 106 criteria", () => {
    expect(ids).toHaveLength(106);
  });

  it.each(ids)("RGAA %s: every cited term is printed, each one whole", (id) => {
    const lines = glossaryLines(brief(id));
    const expected = glossaryAnchorsOf(getCriterion(pack, id))
      .map((a) => resolveGlossary("rgaa", a))
      .filter((e) => e !== undefined)
      .map((e) => `- **${e.title}** — ${norm(e.body)}`);
    expect(lines).toEqual(expected);
  });
});

describe("the refuter's objection is a claim to re-check, not a ruling", () => {
  const withReview = (lang: "fr" | "en") =>
    formatAdjudication([{ ...item("7.4"), previousReview: "Contre-expertise : synthetic objection text." }], lang, "rgaa", {
      preamble: false,
      contract: false,
    });

  it("frames it as an objection to re-check against the definitions and evidence (fr)", () => {
    const md = withReview("fr");
    expect(md).toMatch(/à revérifier, pas à appliquer/);
    expect(md).toMatch(/définitions du référentiel et les évidences citées/);
    expect(md).toContain("synthetic objection text.");
    expect(md).not.toContain("Retour de la contre-expertise");
  });

  it("frames it as an objection to re-check against the definitions and evidence (en)", () => {
    const md = withReview("en");
    expect(md).toMatch(/re-check it, do not apply it/);
    expect(md).toMatch(/definitions and the cited evidence/);
    expect(md).toContain("synthetic objection text.");
  });
});
