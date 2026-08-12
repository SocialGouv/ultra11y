// Task 5 — the standard-agnostic page-sample lint (src/sample.ts lintSample) and the
// storageState-dropping projection (sampleScope), plus the RGAA pack's normative
// sampleMethodology emitted by scripts/build-pack-rgaa.mjs.
import { describe, it, expect } from "vitest";
import { lintSample, sampleFromSnapshots, sampleScope, kindLabel, unionSample } from "../src/sample.js";
import { loadPack } from "../src/standards/index.js";
import type { SampleConfig } from "../src/types.js";

const rgaa = loadPack("rgaa");
const methodology = rgaa.sampleMethodology!;

describe("RGAA pack carries a normative sampleMethodology", () => {
  it("emits the required page kinds (accueil, contact, mentions légales, …)", () => {
    expect(methodology).toBeTruthy();
    const ids = methodology.requiredKinds.map((k) => k.id);
    expect(ids).toContain("accueil");
    expect(ids).toContain("mentions-legales");
    expect(ids).toContain("declaration-accessibilite");
    expect(ids).toContain("authentification");
    expect(ids).toContain("elements-transverses");
  });
});

describe("lintSample — which required page kinds a sample lacks (fuzzy, accent-insensitive)", () => {
  it("lists a missing kind (no « mentions légales » page in the sample)", () => {
    const sample: SampleConfig = {
      pages: [
        { id: "accueil", name: "Accueil", url: "https://example.fr/" },
        { id: "contact", name: "Contact", url: "https://example.fr/contact" },
      ],
    };
    const { missing } = lintSample(sample, methodology);
    const missingIds = missing.map((k) => k.id);
    expect(missingIds).toContain("mentions-legales");
    // Configured kinds are NOT reported missing.
    expect(missingIds).not.toContain("accueil");
    expect(missingIds).not.toContain("contact");
  });

  it("matches accent-insensitively via a page's notes and treats a non-empty transverse list as covering « éléments transverses »", () => {
    const sample: SampleConfig = {
      pages: [{ id: "ml", name: "Page legale", url: "https://example.fr/ml", notes: "Mentions Légales et CGU" }],
      transverse: ["En-tête", "Pied de page"],
    };
    const missingIds = lintSample(sample, methodology).missing.map((k) => k.id);
    expect(missingIds).not.toContain("mentions-legales"); // matched via notes ("mentions legales")
    expect(missingIds).not.toContain("elements-transverses"); // covered by the transverse list
  });

  it("kindLabel resolves the localized RGAA label", () => {
    const ml = methodology.requiredKinds.find((k) => k.id === "mentions-legales")!;
    expect(kindLabel(ml, "fr")).toBe("Mentions légales");
  });

  // Fix round 1 — lint precision: short keywords match whole words only, and the ambiguous
  // generic words ("plan", "support") are no longer keywords at all.
  it('does NOT credit plan-du-site for "Plan de formation" nor aide for "Support RH"', () => {
    const sample: SampleConfig = {
      pages: [
        { id: "pf", name: "Plan de formation", url: "https://example.fr/formation" },
        { id: "rh", name: "Support RH", url: "https://example.fr/rh" },
      ],
    };
    const missingIds = lintSample(sample, methodology).missing.map((k) => k.id);
    expect(missingIds).toContain("plan-du-site");
    expect(missingIds).toContain("aide");
  });

  it('short keywords are whole-word: "plaide" does not credit aide, "Page d\'aide" does', () => {
    const noAide: SampleConfig = { pages: [{ id: "x", name: "Il plaide coupable", url: "https://example.fr/x" }] };
    expect(lintSample(noAide, methodology).missing.map((k) => k.id)).toContain("aide");
    const withAide: SampleConfig = { pages: [{ id: "x", name: "Page d'aide", url: "https://example.fr/x" }] };
    expect(lintSample(withAide, methodology).missing.map((k) => k.id)).not.toContain("aide");
  });

  it('"Plan du site" still credits plan-du-site (canonical multi-word phrase)', () => {
    const sample: SampleConfig = { pages: [{ id: "plan", name: "Plan du site", url: "https://example.fr/plan-site" }] };
    expect(lintSample(sample, methodology).missing.map((k) => k.id)).not.toContain("plan-du-site");
  });

  // Fix round 1 — a multi-page sample de facto carries representative pages (documented
  // heuristic: ≥ 2 pages credit the kind), so it stops being a constant false nag.
  it("credits pages-representatives once the sample holds ≥ 2 pages, not for a single page", () => {
    const one: SampleConfig = { pages: [{ id: "a", name: "Accueil", url: "https://example.fr/" }] };
    expect(lintSample(one, methodology).missing.map((k) => k.id)).toContain("pages-representatives");
    const two: SampleConfig = {
      pages: [
        { id: "a", name: "Accueil", url: "https://example.fr/" },
        { id: "b", name: "Contact", url: "https://example.fr/contact" },
      ],
    };
    expect(lintSample(two, methodology).missing.map((k) => k.id)).not.toContain("pages-representatives");
  });
});

describe("sampleScope — the recorded shape drops the storageState PATH (never persisted)", () => {
  it("keeps id/name/url/auth/notes but never storageState", () => {
    const scope = sampleScope({
      pages: [{ id: "c", name: "Compte", url: "https://example.fr/compte", auth: true, storageState: "/secret/session.json", notes: "logged in" }],
      transverse: ["header"],
    });
    expect(scope.pages[0]).toEqual({ id: "c", name: "Compte", url: "https://example.fr/compte", auth: true, notes: "logged in" });
    expect(JSON.stringify(scope)).not.toContain("storageState");
    expect(JSON.stringify(scope)).not.toContain("session.json");
    expect(scope.transverse).toEqual(["header"]);
  });
});

describe("the two inventories", () => {
  const snap = (id: string, url: string, name = id) => ({ meta: { id, name, url } });

  it("reads a sample straight out of the snapshots a test suite produced", () => {
    const pages = sampleFromSnapshots([snap("accueil", "https://x.fr/", "Accueil"), snap("contact", "https://x.fr/contact", "Contact")]);
    expect(pages).toEqual([
      { id: "accueil", name: "Accueil", url: "https://x.fr/" },
      { id: "contact", name: "Contact", url: "https://x.fr/contact" },
    ]);
  });

  it("names the pages the test suite captures and the config never declared", () => {
    // The reported drift: .ultra11yrc.json declared 17 pages, the Playwright specs snapshot 38.
    const declared: SampleConfig = { pages: [{ id: "accueil", name: "Accueil", url: "https://x.fr/" }] };
    const u = unionSample(declared, sampleFromSnapshots([snap("accueil", "https://x.fr/"), snap("etape-2", "https://x.fr/parcours/etape/2")]));
    expect(u.undeclared.map((p) => p.id)).toEqual(["etape-2"]);
    expect(u.uncaptured).toEqual([]);
    expect(u.sample.pages).toHaveLength(2);
  });

  it("names the declared pages no snapshot ever covered", () => {
    const declared: SampleConfig = { pages: [{ id: "aide", name: "Aide", url: "https://x.fr/aide" }] };
    const u = unionSample(declared, sampleFromSnapshots([snap("accueil", "https://x.fr/")]));
    expect(u.uncaptured.map((p) => p.id)).toEqual(["aide"]);
    expect(u.undeclared.map((p) => p.id)).toEqual(["accueil"]);
  });

  it("dedupes on id ALONE, so a state-reached page sharing a URL is not swallowed", () => {
    // A modal has no URL of its own. Keying the union on url — as mergeSample does for a crawl —
    // would drop exactly the pages this exists to surface.
    const declared: SampleConfig = { pages: [{ id: "compte", name: "Mon compte", url: "https://x.fr/compte" }] };
    const u = unionSample(declared, sampleFromSnapshots([snap("compte-modale-infos", "https://x.fr/compte", "Modale mes informations")]));
    expect(u.undeclared.map((p) => p.id)).toEqual(["compte-modale-infos"]);
    expect(u.sample.pages).toHaveLength(2);
  });

  it("lets the DECLARED entry win a collision — auth, notes and the human name are someone's work", () => {
    const declared: SampleConfig = {
      pages: [{ id: "compte", name: "Mon compte", url: "https://x.fr/compte", auth: true, notes: "connecté en tant que testeur" }],
    };
    const u = unionSample(declared, sampleFromSnapshots([snap("compte", "https://x.fr/compte", "compte")]));
    expect(u.sample.pages).toHaveLength(1);
    expect(u.sample.pages[0]).toMatchObject({ name: "Mon compte", auth: true, notes: "connecté en tant que testeur" });
  });

  it("keeps the declared transverse elements, which no snapshot can carry", () => {
    const declared: SampleConfig = { pages: [{ id: "a", name: "A", url: "https://x.fr/" }], transverse: ["header", "footer"] };
    expect(unionSample(declared, []).sample.transverse).toEqual(["header", "footer"]);
  });

  it("lints over the UNION, so the linter stops describing an inventory it never read", () => {
    // The audited surface covers a required kind the declared sample omits. Linting the declared
    // list alone reports it missing; linting the union reports the truth, and the caller still
    // learns about the drift from `undeclared`.
    const declared: SampleConfig = { pages: [{ id: "accueil", name: "Accueil", url: "https://x.fr/" }] };
    const snapshots = sampleFromSnapshots([snap("contact", "https://x.fr/contact", "Contact")]);
    const before = lintSample(declared, methodology).missing.map((k) => k.id);
    const after = lintSample(unionSample(declared, snapshots).sample, methodology).missing.map((k) => k.id);
    expect(before).toContain("contact");
    expect(after).not.toContain("contact");
  });
});
