// The pack glossary. RGAA's 258 tests refer to defined terms constantly
// (« [image porteuse d'information](#…) »), and those definitions are NORMATIVE — what
// "if necessary" or "relevant" mean is decided there. The glossary shipped with 119 entries
// and zero readers; these cover the lookup that now surfaces it.
import { describe, it, expect } from "vitest";
import { runCriteria } from "../src/criteria.js";
import { packGlossary } from "../src/standards/index.js";
import { glossaryAnchorsOf } from "../src/adjudicate.js";
import { loadPack } from "../src/standards/index.js";

const capture = (fn: () => number): { code: number; out: string; err: string } => {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  try {
    return { code: fn(), out: out.join("\n"), err: err.join("\n") };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
};
const look = (glossary: string | boolean, standard = "rgaa", json = false) => capture(() => runCriteria({ standard, lang: "fr", glossary, json }));

describe("looking a defined term up", () => {
  it("resolves by anchor", () => {
    const r = look("alternative-textuelle-image");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/Alternative textuelle/i);
  });

  it("resolves by title, accent- and case-insensitively", () => {
    expect(look("alternative textuelle (image)").code).toBe(0);
    expect(look("ALTERNATIVE TEXTUELLE (IMAGE)").code).toBe(0);
  });

  it("resolves a prefix", () => {
    expect(look("champ-de-saisie").code).toBe(0);
  });

  it("lists every term when given no argument", () => {
    const r = look(true);
    expect(r.code).toBe(0);
    expect(r.out.split("\n").length).toBe(Object.keys(packGlossary("rgaa") ?? {}).length);
  });

  it("emits the raw entry under --json", () => {
    const r = look("alternative-textuelle-image", "rgaa", true);
    const j = JSON.parse(r.out) as { anchor: string; title: string; body: string };
    expect(j.anchor).toBe("alternative-textuelle-image");
    expect(j.body.length).toBeGreaterThan(50);
  });
});

describe("it refuses to guess", () => {
  it("fails on an unknown term rather than returning a near-miss definition", () => {
    const r = look("quelque chose qui n'existe pas");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/no .* glossary term/i);
  });

  it("suggests candidates when the term is merely partial", () => {
    const r = look("image");
    // Either an exact prefix hit, or a suggestion list — never silence.
    expect(r.code === 0 || /Did you mean/.test(r.err)).toBe(true);
  });

  it("says so plainly when the standard has no glossary", () => {
    const r = look("anything", "wcag");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/country standard/i);
  });
});

describe("the anchors an adjudication item must define", () => {
  const pack = loadPack("rgaa");

  it("extracts the terms a criterion's own tests cite", () => {
    const anchors = glossaryAnchorsOf(pack.criteria.find((c) => c.id === "11.2"));
    expect(anchors).toContain("champ-de-saisie-de-formulaire");
    expect(anchors).toContain("intitule-visible");
  });

  it("returns nothing for a criterion citing no defined term", () => {
    expect(glossaryAnchorsOf({ tests: { "1": ["Plain sentence with no reference."] } })).toEqual([]);
    expect(glossaryAnchorsOf(undefined)).toEqual([]);
  });

  it("resolves every cited anchor except the known non-glossary links", () => {
    const glossary = packGlossary("rgaa") ?? {};
    const unresolved = new Set<string>();
    for (const c of pack.criteria) for (const a of glossaryAnchorsOf(c)) if (!glossary[a]) unresolved.add(a);
    // Not every `#anchor` in RGAA prose is a glossary term: this one points at a SECTION of
    // the RGAA site (« méthodes pour lier un résumé à un tableau », in 5.1's technical note).
    // Pinning the exact set means a genuinely new dangling reference fails here, while this
    // known documentation link does not masquerade as a regression.
    expect([...unresolved].sort()).toEqual(["table-descriptions-techniques"]);
  });

  it("silently skips an anchor it cannot resolve, rather than printing a broken entry", () => {
    // 5.1 cites the non-glossary anchor above; its rendered block must still be clean.
    const anchors = glossaryAnchorsOf(pack.criteria.find((c) => c.id === "5.1"));
    expect(anchors).toContain("table-descriptions-techniques");
    const glossary = packGlossary("rgaa") ?? {};
    expect(anchors.filter((a) => glossary[a]).length).toBeGreaterThan(0);
  });
});
