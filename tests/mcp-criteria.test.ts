// `ultra11y_criteria` answers about the standard you ASKED for.
//
// It used to call the WCAG core unconditionally and echo `standard` back untouched, so
// `{ standard: "rgaa", sc: "8.3" }` came back "no such success criterion: 8.3" — a question
// about RGAA answered from a different standard entirely. These are the cases that fix.
import { describe, expect, it } from "vitest";
import { callTool } from "../src/mcp/handlers.js";
import { formatPackCriterion, formatSC } from "../src/criteria.js";
import { getCriterion, loadPack } from "../src/standards/index.js";
import { getSC } from "../src/wcag.js";

async function criteria(args: Record<string, unknown>): Promise<any> {
  return JSON.parse((await callTool("ultra11y_criteria", args)).text);
}

describe("a country standard's own criteria", () => {
  it("returns RGAA 8.3 with its numbered tests, techniques and WCAG mapping", async () => {
    const r = await criteria({ standard: "rgaa", sc: "8.3", lang: "fr" });
    expect(r.standard).toBe("rgaa");
    expect(r.standardLabel).toBe("RGAA 4.1.2");
    expect(r.criterion.kind).toBe("pack");
    expect(r.criterion.id).toBe("8.3");
    expect(r.criterion.theme).toMatchObject({ number: 8, name: "Éléments obligatoires" });
    expect(r.criterion.title).toContain("langue par défaut");
    expect(r.criterion.tests[0].id).toBe("8.3.1");
    expect(r.criterion.tests[0].lines.length).toBeGreaterThan(1);
    expect(r.criterion.techniques).toContain("H57");
    expect(r.criterion.wcag[0]).toMatchObject({ sc: "3.1.1", inCore: true });
  });

  it("accepts `criterion` as an alias for `sc`", async () => {
    const a = await criteria({ standard: "rgaa", criterion: "8.3" });
    const b = await criteria({ standard: "rgaa", sc: "8.3" });
    expect(a.criterion.id).toBe(b.criterion.id);
  });

  it("attaches the normative glossary definitions the criterion's tests cite", async () => {
    // RGAA 1.1's tests lean on "image porteuse d'information" and "alternative textuelle",
    // and those definitions decide the verdict. A lookup that omitted them would leave the
    // reader guessing at what the standard means.
    const r = await criteria({ standard: "rgaa", sc: "1.1", lang: "fr" });
    const anchors = r.criterion.glossary.map((g: { anchor: string }) => g.anchor);
    expect(anchors).toContain("image-porteuse-d-information");
    expect(anchors).toContain("alternative-textuelle-image");
    expect(r.criterion.glossary[0].body.length).toBeGreaterThan(20);
  });

  it("names the theme's criteria when asked for a theme", async () => {
    const r = await criteria({ standard: "rgaa", theme: 8 });
    expect(r.kind).toBe("theme");
    expect(r.criteria.map((c: { id: string }) => c.id)).toContain("8.3");
  });

  it("indexes the standard, with the counts an auditor plans against", async () => {
    const r = await criteria({ standard: "rgaa" });
    expect(r.kind).toBe("index");
    expect(r.counts).toMatchObject({ themes: 13, criteria: 106 });
    // 56 of 106 RGAA criteria declare that NO engine rule can evidence them. Surfacing that
    // is the difference between a plan and a false sense of coverage. It was 58 until the
    // doctype (8.1) got an instrument of its own; 10.5 correctly lost contrast-ratio rules,
    // because it asks about paired CSS declarations instead.
    expect(r.counts.noEngineRule).toBe(56);
    expect(r.groups).toHaveLength(13);
  });

  it("refuses an id the standard does not define, naming the standard", async () => {
    await expect(criteria({ standard: "rgaa", sc: "99.9" })).rejects.toThrow(/no such RGAA criterion: 99\.9/);
  });
});

describe("the WCAG core keeps its shape", () => {
  it("still answers a success criterion, with `sc` for older clients", async () => {
    const r = await criteria({ sc: "1.1.1" });
    expect(r.standard).toBe("wcag");
    expect(r.sc).toBe("1.1.1");
    expect(r.criterion.kind).toBe("wcag");
    expect(r.criterion.level).toBe("A");
  });

  it("keeps the existing error message for an unknown success criterion", async () => {
    await expect(criteria({ sc: "9.9.9" })).rejects.toThrow(/no such success criterion: 9\.9\.9/);
  });

  it("carries the decision protocol, which stands in for the Understanding prose", async () => {
    // src/data/wcag.json deliberately vendors no normative SC text, only a URL. The
    // per-SC decide/na/questions dataset is what an offline agent rules from.
    const r = await criteria({ sc: "1.4.3" });
    expect(r.criterion.adjudication.decide).toBeTruthy();
    expect(r.criterion.adjudication.questions.length).toBeGreaterThan(0);
  });

  it("names the country criteria that map onto it", async () => {
    const r = await criteria({ sc: "1.4.3" });
    expect(r.criterion.mappedBy).toContainEqual({ standard: "rgaa", criteria: ["3.2", "10.5"] });
  });

  it("rejects a theme, because WCAG groups by guideline", async () => {
    await expect(criteria({ theme: 8 })).rejects.toThrow(/WCAG has no themes/);
  });
});

describe("the human rendering has exactly one implementation", () => {
  it("returns the same text the CLI prints, for both standards", async () => {
    // The MCP surface and `criteria --standard rgaa 8.3` cannot drift, because `text` IS
    // the CLI's formatter output.
    const pack = loadPack("rgaa");
    const rgaa = await criteria({ standard: "rgaa", sc: "8.3", lang: "fr" });
    expect(rgaa.text).toBe(formatPackCriterion(pack, getCriterion(pack, "8.3")!, "fr"));

    const wcag = await criteria({ sc: "1.1.1", lang: "en" });
    expect(wcag.text).toBe(formatSC(getSC("1.1.1")!, "en"));
  });
});

describe("the glossary is reachable", () => {
  it("resolves a term and names the criteria it governs", async () => {
    const r = await criteria({ standard: "rgaa", glossary: "lien" });
    expect(r.kind).toBe("glossary-term");
    expect(r.anchor).toBe("lien");
    expect(r.body.length).toBeGreaterThan(20);
    expect(r.citedBy).toContain("6.1");
  });

  it("lists every term when asked for none", async () => {
    const r = await criteria({ standard: "rgaa", glossary: "" });
    expect(r.kind).toBe("glossary-index");
    expect(r.count).toBe(119);
  });

  it("suggests near matches rather than guessing at a different normative term", async () => {
    // "textuel" is a substring of several anchors but the prefix of none. Resolution goes
    // exact-anchor → exact-title → prefix, and stops: handing back the definition of a
    // DIFFERENT normative term would be worse than admitting the miss.
    await expect(criteria({ standard: "rgaa", glossary: "textuel" })).rejects.toThrow(/Did you mean/);
  });
});

describe("guidance is opt-in, and says where it came from", () => {
  it("omits guidance by default", async () => {
    const r = await criteria({ standard: "rgaa", sc: "1.1" });
    expect(r.criterion.guidance).toEqual([]);
  });

  it("marks an entry inherited through the WCAG mapping as inherited", async () => {
    // This is what makes a newly added country pack useful on day one — and why an
    // inherited example must never read as the national standard's own doctrine.
    const r = await criteria({ standard: "rgaa", sc: "1.1", include_guidance: true });
    const inherited = r.criterion.guidance.filter((g: { inherited: boolean }) => g.inherited);
    expect(inherited.length).toBeGreaterThan(0);
    expect(inherited[0].via).toMatch(/^wcag:/);
    const pinned = r.criterion.guidance.filter((g: { inherited: boolean }) => !g.inherited);
    expect(pinned[0].via).toBe("pack");
  });
});
