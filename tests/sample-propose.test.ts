import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli.js";
import { SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import { getPack } from "../src/standards/index.js";
import { lintSample, validateSample } from "../src/sample.js";
import {
  applyProposal,
  DEFAULT_SAMPLE_SIZE,
  FIXED_SEARCH_QUERY,
  normalizeSegment,
  PROPOSAL_NOTE,
  proposeSample,
  type ProposalInput,
  skeletonOf,
  urlPatterns,
} from "../src/sample-propose.js";
import type { SampleConfig } from "../src/types.js";

// The same site must give the same sample whatever runs the discovery. Two models auditing one
// site sampled 11 and 13 pages, with a different search query and a page only one of them took —
// and a non-conformity that existed only where that page was sampled. These tests pin the
// proposal as a pure function of the SET of discovered pages. All data below is synthetic.

const methodology = getPack("rgaa")!.sampleMethodology!;
const O = "https://commune.example";

/** A synthetic site: the required pages, a news section, an agenda keyed by date, a few pages. */
function site(): ProposalInput[] {
  const pages: ProposalInput[] = [
    { url: `${O}/`, title: "Accueil — Commune d'Exemple" },
    { url: `${O}/nous-contacter`, title: "Nous écrire — Commune d'Exemple" },
    { url: `${O}/mentions-legales`, title: "Mentions légales — Commune d'Exemple" },
    { url: `${O}/accessibilite`, title: "Déclaration d'accessibilité — Commune d'Exemple" },
    { url: `${O}/plan-du-site`, title: "Plan du site — Commune d'Exemple" },
    { url: `${O}/faq`, title: "Questions fréquentes — Commune d'Exemple" },
    { url: `${O}/connexion`, title: "Se connecter — Commune d'Exemple" },
    { url: `${O}/publications`, title: "Publications — Commune d'Exemple" },
    { url: `${O}/demarches`, title: "Démarches — Commune d'Exemple" },
    { url: `${O}/elus`, title: "Vos élus — Commune d'Exemple" },
  ];
  for (const slug of ["fete-de-la-musique", "travaux-rue-haute", "nouvelle-mediatheque", "marche-de-noel"])
    pages.push({ url: `${O}/actualites/${slug}`, title: `${slug} — Commune d'Exemple` });
  for (const day of ["2026-11-02", "2026-11-09", "2026-11-16"]) pages.push({ url: `${O}/agenda/${day}`, title: `Agenda du ${day} — Commune d'Exemple` });
  return pages;
}

/** A deterministic shuffle (no Math.random in a test that is about determinism). */
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe("proposeSample — the same site gives the same sample", () => {
  it("is identical whatever order the URLs arrive in", () => {
    const base = proposeSample(site(), { methodology });
    for (const seed of [1, 7, 42, 2026]) {
      expect(proposeSample(shuffled(site(), seed), { methodology })).toEqual(base);
    }
    expect(proposeSample([...site()].reverse(), { methodology })).toEqual(base);
  });

  it("is identical when the input carries duplicates", () => {
    const base = proposeSample(site(), { methodology });
    expect(proposeSample([...site(), ...shuffled(site(), 3)], { methodology })).toEqual(base);
  });

  it("finds the required kinds, from the title when the URL says nothing", () => {
    const { sample } = proposeSample(site(), { methodology });
    const byUrl = new Map(sample.pages.map((p) => [p.url, p.notes ?? ""]));
    expect(byUrl.get(`${O}/`)).toContain("Page d’accueil");
    // « /nous-contacter » is found by its URL; « /faq » by the « faq » keyword of aide.
    expect(byUrl.get(`${O}/nous-contacter`)).toContain('"Contact"');
    expect(byUrl.get(`${O}/faq`)).toContain('"Aide"');
    // « /connexion » by URL; « Se connecter » would also have matched the title.
    expect(byUrl.get(`${O}/connexion`)).toContain('"Authentification"');
    expect(byUrl.get(`${O}/publications`)).toContain('"Documents téléchargeables"');
  });

  it("matches a kind on the title alone, the site name stripped", () => {
    const inputs: ProposalInput[] = [
      { url: `${O}/`, title: "Bienvenue — Aide Sociale du Val" },
      { url: `${O}/p/1`, title: "Nous joindre — Aide Sociale du Val" },
      { url: `${O}/p/2`, title: "Nos mentions obligatoires — Aide Sociale du Val" },
      { url: `${O}/p/3`, title: "Une page — Aide Sociale du Val" },
    ];
    const { sample } = proposeSample(inputs, { methodology });
    const legal = sample.pages.find((p) => p.url === `${O}/p/2`);
    expect(legal?.notes).toContain('"Mentions légales", keyword "mentions" in the title');
    // The site is called « Aide Sociale »: that is the site's name, not an aide page.
    expect(sample.absent?.map((a) => a.kind)).toContain("aide");
  });

  it("takes one representative per template cluster, the first by URL", () => {
    const { sample, clusters } = proposeSample(site(), { methodology });
    const news = sample.pages.filter((p) => p.url.includes("/actualites/"));
    expect(news.map((p) => p.url)).toEqual([`${O}/actualites/fete-de-la-musique`]);
    expect(news[0]!.notes).toContain("/actualites/:slug, 4 page(s), first by URL");
    const agenda = sample.pages.filter((p) => p.url.includes("/agenda/"));
    expect(agenda.map((p) => p.url)).toEqual([`${O}/agenda/2026-11-02`]);
    expect(clusters.find((c) => c.pattern === "/agenda/:date")?.size).toBe(3);
  });

  it("clusters by DOM skeleton when snapshots give one", () => {
    const article = (n: number) =>
      `<html><body><header><nav></nav></header><main><article><h1>Titre ${n}</h1><p>${"texte ".repeat(n)}</p></article></main><footer></footer></body></html>`;
    const agenda = "<html><body><header><nav></nav></header><main><table><tr><td>1</td></tr></table></main><footer></footer></body></html>";
    expect(skeletonOf(article(1))).toBe(skeletonOf(article(9)));
    expect(skeletonOf(article(1))).not.toBe(skeletonOf(agenda));
    const inputs: ProposalInput[] = [
      { url: `${O}/`, title: "Accueil" },
      { url: `${O}/histoire`, skeleton: skeletonOf(article(1)) },
      { url: `${O}/patrimoine`, skeleton: skeletonOf(article(2)) },
      { url: `${O}/jumelage`, skeleton: skeletonOf(article(3)) },
      { url: `${O}/calendrier`, skeleton: skeletonOf(agenda) },
    ];
    const urls = proposeSample(inputs, { methodology }).sample.pages.map((p) => p.url);
    expect(urls).toContain(`${O}/histoire`); // first by URL of the article template
    expect(urls).not.toContain(`${O}/patrimoine`);
    expect(urls).not.toContain(`${O}/jumelage`);
    expect(urls).toContain(`${O}/calendrier`); // its own template
  });

  it("searches the same fixed query through the site's own form", () => {
    const home = `<html><body><header><form role="search" action="/rechercher"><input type="search" name="terms"></form></header></body></html>`;
    const { sample } = proposeSample([{ url: `${O}/`, title: "Accueil", html: home }, ...site().slice(1)], { methodology });
    const search = sample.pages.find((p) => p.notes?.includes('"Recherche"'));
    expect(search?.url).toBe(`${O}/rechercher?terms=${FIXED_SEARCH_QUERY}`);
    expect(search?.notes).toContain(`fixed query "${FIXED_SEARCH_QUERY}"`);
    const custom = proposeSample([{ url: `${O}/`, html: home }], { methodology, searchQuery: "piscine" });
    expect(custom.sample.pages.some((p) => p.url === `${O}/rechercher?terms=piscine`)).toBe(true);
  });

  it("rewrites a discovered search URL to the fixed query", () => {
    const { sample } = proposeSample([...site(), { url: `${O}/recherche?q=impots&page=2` }], { methodology });
    expect(sample.pages.some((p) => p.url === `${O}/recherche?q=${FIXED_SEARCH_QUERY}`)).toBe(true);
  });

  it("records a kind it finds no page for in `absent`, with the reason", () => {
    const { sample } = proposeSample(site(), { methodology });
    const search = sample.absent?.find((a) => a.kind === "recherche");
    expect(search?.reason.startsWith(PROPOSAL_NOTE)).toBe(true);
    expect(search?.reason).toContain('"search"');
  });

  it("is bounded, and the bound never cuts a required kind", () => {
    const many: ProposalInput[] = [...site()];
    for (let i = 0; i < 40; i++) many.push({ url: `${O}/rubrique-${String.fromCharCode(97 + (i % 26))}${i}` });
    const def = proposeSample(many, { methodology });
    expect(def.sample.pages.length).toBe(DEFAULT_SAMPLE_SIZE);
    expect(def.leftOut).toBeGreaterThan(0);
    const tiny = proposeSample(many, { methodology, size: 2 });
    // eight required kinds found, the bound of 2 notwithstanding
    expect(tiny.sample.pages.filter((p) => p.notes?.includes("required kind")).length).toBe(8);
    expect(tiny.sample.pages.some((p) => p.notes?.includes("template"))).toBe(false);
  });

  it("never samples a document URL as a page", () => {
    const { sample, documents } = proposeSample([...site(), { url: `${O}/files/budget-2026.pdf` }], { methodology });
    expect(documents).toBe(1);
    expect(sample.pages.some((p) => p.url.endsWith(".pdf"))).toBe(false);
  });

  it("produces a valid sample that `sample check` finds complete", () => {
    const { sample } = proposeSample(site(), { methodology });
    const v = validateSample({ ...sample, transverse: ["En-tête", "Pied de page"] });
    expect(v.ok).toBe(true);
    const lint = lintSample(v.sample!, methodology);
    expect(lint.missing).toEqual([]);
    expect(lint.waived.map((w) => w.kind.id)).toEqual(["recherche"]);
  });
});

describe("URL patterns", () => {
  it("normalizes dates, wherever the URL puts them", () => {
    expect(normalizeSegment("2026-11-24", false)).toBe(":date");
    expect(normalizeSegment("20261124", false)).toBe(":date");
    expect(normalizeSegment("2026", false)).toBe(":date");
    expect(normalizeSegment("11", true)).toBe(":date");
    expect(normalizeSegment("2026-11-24-conseil-municipal", false)).toBe(":slug");
    expect(normalizeSegment("12345", false)).toBe(":id");
    expect(normalizeSegment("contact", false)).toBe("contact");
    const p = urlPatterns([`${O}/agenda/2026/11/24`, `${O}/agenda/2025/01/03`, `${O}/evenements?date=2026-11-24`, `${O}/evenements?date=2026-12-01`]);
    expect(p.get(`${O}/agenda/2026/11/24`)).toBe("/agenda/:date");
    expect(p.get(`${O}/agenda/2025/01/03`)).toBe("/agenda/:date");
    expect(p.get(`${O}/evenements?date=2026-11-24`)).toBe("/evenements?date=:date");
    expect(p.get(`${O}/evenements?date=2026-12-01`)).toBe("/evenements?date=:date");
  });

  it("turns a segment into a slug only when siblings say so, never at the root", () => {
    const p = urlPatterns([`${O}/contact`, `${O}/aide`, `${O}/elus`, `${O}/blog/a`, `${O}/blog/b`, `${O}/blog/c`, `${O}/equipe/x`]);
    expect(p.get(`${O}/contact`)).toBe("/contact");
    expect(p.get(`${O}/blog/b`)).toBe("/blog/:slug");
    expect(p.get(`${O}/equipe/x`)).toBe("/equipe/x");
  });
});

describe("applyProposal — the proposal replaces the list, not the human work", () => {
  const proposal = (): SampleConfig => proposeSample(site(), { methodology }).sample;

  it("drops discovered pages that carry nothing, keeps hand-added ones with a reason", () => {
    const existing: SampleConfig = {
      pages: [
        { id: "vieux", name: "Vieille page", url: `${O}/vieille-page` },
        { id: "compte", name: "Mon compte", url: `${O}/compte`, auth: true, storageState: ".auth/u.json" },
        { id: "simulateur", name: "Simulateur", url: `${O}/simulateur`, notes: "parcours clé du service" },
        { id: "home", name: "Ma page d'accueil", url: `${O}/`, notes: "page d'entrée des usagers" },
      ],
      transverse: ["En-tête"],
    };
    const { sample, kept, dropped } = applyProposal(existing, proposal());
    expect(dropped.map((p) => p.id)).toEqual(["vieux"]);
    expect(kept.map((p) => p.id)).toEqual(["compte", "simulateur"]);
    const home = sample.pages.find((p) => p.url === `${O}/`)!;
    expect(home.id).toBe("home");
    expect(home.name).toBe("Ma page d'accueil");
    expect(home.notes?.startsWith("page d'entrée des usagers | proposal: ")).toBe(true);
    expect(sample.transverse).toEqual(["En-tête"]);
  });

  it("re-running on its own output changes nothing", () => {
    const once = applyProposal(undefined, proposal()).sample;
    const twice = applyProposal(once, proposal()).sample;
    expect(twice).toEqual(once);
    const withHuman = applyProposal(
      { ...once, pages: once.pages.map((p, i) => (i === 0 ? { ...p, notes: `vu en comité | ${p.notes}` } : p)) },
      proposal(),
    ).sample;
    expect(applyProposal(withHuman, proposal()).sample).toEqual(withHuman);
  });

  it("keeps a human `absent` reason over the proposal's", () => {
    const human = { kind: "recherche", reason: "le site n'a pas de moteur de recherche" };
    const { sample } = applyProposal({ pages: [], absent: [human] } as unknown as SampleConfig, proposal());
    expect(sample.absent?.filter((a) => a.kind === "recherche")).toEqual([human]);
  });
});

describe("lintSample — a dropped kind needs a recorded reason", () => {
  it("flags a hand-edited proposal that drops a required kind without a reason", () => {
    const { sample } = proposeSample(site(), { methodology });
    const edited: SampleConfig = { ...sample, pages: sample.pages.filter((p) => !p.url.endsWith("/mentions-legales")), transverse: ["Pied de page"] };
    expect(lintSample(edited, methodology).missing.map((k) => k.id)).toEqual(["mentions-legales"]);
    const explained: SampleConfig = {
      ...edited,
      absent: [...(edited.absent ?? []), { kind: "mentions-legales", reason: "page servie par le portail national" }],
    };
    const lint = lintSample(explained, methodology);
    expect(lint.missing).toEqual([]);
    expect(lint.waived.map((w) => [w.kind.id, w.reason])).toContainEqual(["mentions-legales", "page servie par le portail national"]);
  });

  it("validates `absent`: a kind without a reason is malformed", () => {
    expect(validateSample({ pages: [{ id: "a", name: "A", url: `${O}/` }], absent: [{ kind: "aide" }] }).ok).toBe(false);
    expect(validateSample({ pages: [{ id: "a", name: "A", url: `${O}/` }], absent: [{ kind: "aide", reason: "pas d'aide" }] }).sample?.absent).toEqual([
      { kind: "aide", reason: "pas d'aide" },
    ]);
  });
});

describe("`pages discover --from-snapshots --propose` (CLI)", () => {
  const run = async (argv: string[]): Promise<{ code: number; out: string; err: string }> => {
    const out: string[] = [];
    const err: string[] = [];
    const lo = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void out.push(a.join(" ")));
    const le = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void err.push(a.join(" ")));
    try {
      return { code: await main(argv), out: out.join("\n"), err: err.join("\n") };
    } finally {
      lo.mockRestore();
      le.mockRestore();
    }
  };
  const page = (title: string, body: string) =>
    `<html><head><title>${title}</title></head><body><header></header><main>${body}</main><footer></footer></body></html>`;

  it("writes the same sample twice, keeps a hand-added page with a reason, drops the rest", async () => {
    const cwd = process.cwd();
    const d = mkdtempSync(join(tmpdir(), "u11y-propose-"));
    try {
      process.chdir(d);
      const snaps: [string, string, string][] = [
        ["accueil", "/", page("Accueil", "<p>bienvenue</p>")],
        ["contact", "/contact", page("Contact", "<form><input name=nom></form>")],
        ["a", "/actualites/a", page("A", "<article><h1>A</h1></article>")],
        ["b", "/actualites/b", page("B", "<article><h1>B</h1></article>")],
        ["c", "/actualites/c", page("C", "<article><h1>C</h1></article>")],
      ];
      for (const [id, path, dom] of snaps)
        writeSnapshot(d, { meta: { v: SNAPSHOT_VERSION, id, name: id, url: `${O}${path}` }, dom } as Parameters<typeof writeSnapshot>[1]);
      writeFileSync(
        join(d, ".ultra11yrc.json"),
        JSON.stringify({
          standard: "rgaa",
          sample: {
            pages: [
              { id: "x", name: "Ancienne", url: `${O}/ancienne` },
              { id: "simul", name: "Simulateur", url: `${O}/simulateur`, notes: "parcours clé" },
            ],
          },
        }),
      );
      const first = await run(["pages", "discover", "--from-snapshots", "--propose", "--write"]);
      expect(first.code).toBe(0);
      const written = readFileSync(join(d, ".ultra11yrc.json"), "utf8");
      const cfg = JSON.parse(written) as { standard: string; sample: SampleConfig };
      expect(cfg.standard).toBe("rgaa");
      expect(cfg.sample.pages.map((p) => p.url)).toEqual([`${O}/`, `${O}/contact`, `${O}/actualites/a`, `${O}/simulateur`]);
      expect(cfg.sample.absent?.map((a) => a.kind)).toContain("mentions-legales");
      const second = await run(["pages", "discover", "--from-snapshots", "--propose", "--write"]);
      expect(second.code).toBe(0);
      expect(readFileSync(join(d, ".ultra11yrc.json"), "utf8")).toBe(written);
      expect((await run(["pages", "discover", "--from-snapshots", "--propose", "--sample-size", "0"])).code).toBe(2);
    } finally {
      process.chdir(cwd);
      rmSync(d, { recursive: true, force: true });
    }
  });
});
