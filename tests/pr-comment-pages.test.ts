// THE PAGE-BY-PAGE PULL-REQUEST COMMENT.
//
// The property that motivates the whole surface: a workflow whose code gate and page sweep
// both comment on one pull request must not have the second overwrite the first. That is a
// fact about the MARKERS, so it is pinned here rather than left to the action's YAML.
//
// The rest is the honesty posture every page surface shares: a page nobody snapshotted cannot
// be conforming by silence, a page the browser refused is named rather than missing, and the
// size clamp drops whole blocks — never a byte slice that would ship a broken table.
import { describe, it, expect } from "vitest";
import { pagesComment } from "../src/annotate.js";
import { COMMENT_MARKER, commentKindFrom, pickExistingComment, stickyBody } from "../src/pr-comment.js";
import type { AuditResult, CriterionResult, Finding, PageScope } from "../src/types.js";

const F = (over: Partial<Finding> = {}): Finding => ({
  ruleId: "img-alt-missing",
  criteriaId: "1.1.1",
  file: "src/a.html",
  line: 1,
  col: 1,
  selectorHint: "img",
  severity: "bloquant",
  message: "image sans alternative",
  remediation: "ajouter un alt",
  snippet: "",
  ...over,
});

const C = (id: string, status: CriterionResult["status"], findings: Finding[] = []): CriterionResult => ({
  id,
  guideline: id.split(".").slice(0, 2).join("."),
  status,
  findings,
});

const PAGES: PageScope[] = [
  { id: "accueil", name: "Accueil", url: "https://x/", sources: ["app/page.tsx"], basis: "snapshot" },
  { id: "contact", name: "Contact", url: "https://x/contact", sources: ["app/contact/page.tsx"], basis: "snapshot" },
];

const audit = (over: Partial<AuditResult> = {}): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    date: "2026-08-17",
    scope: { inputs: [], files: 2, pages: PAGES },
    criteria: [C("1.1.1", "NC", [F({ page: "contact" })]), C("1.3.1", "C")],
    guidelines: [],
    findings: [F({ page: "contact" })],
    residualRisks: [],
    conformancePct: 50,
    ...over,
  }) as unknown as AuditResult;

describe("the two stickies cannot overwrite one another", () => {
  it("keys the digest on the historical marker, byte for byte", () => {
    // A sticky already posted must keep being EDITED. Re-keying it would orphan the existing
    // comment and post a duplicate beside it on every open pull request in the wild.
    expect(COMMENT_MARKER("rgaa")).toBe('<!-- ultra11y:report standard="rgaa" -->');
    expect(COMMENT_MARKER("rgaa", "digest")).toBe(COMMENT_MARKER("rgaa"));
  });

  it("gives the page grid its own key", () => {
    expect(COMMENT_MARKER("rgaa", "pages")).not.toBe(COMMENT_MARKER("rgaa"));
  });

  it("neither marker is a substring of the other — pickExistingComment matches with includes", () => {
    // THE regression. `pickExistingComment` does `body.includes(marker)`: if one key were a
    // prefix of the other, the sweep would adopt and overwrite the gate's comment, which is
    // exactly the bug this kind parameter exists to fix.
    const digest = COMMENT_MARKER("rgaa", "digest");
    const pages = COMMENT_MARKER("rgaa", "pages");
    expect(pages.includes(digest)).toBe(false);
    expect(digest.includes(pages)).toBe(false);

    const posted = [
      { id: 1, body: stickyBody("gate", "rgaa", "digest") },
      { id: 2, body: stickyBody("grid", "rgaa", "pages") },
    ];
    expect(pickExistingComment(posted, digest)?.id).toBe(1);
    expect(pickExistingComment(posted, pages)?.id).toBe(2);
  });

  it("resolves an unset or misspelled kind to the digest, never to silence", () => {
    expect(commentKindFrom(undefined)).toBe("digest");
    expect(commentKindFrom("")).toBe("digest");
    expect(commentKindFrom("page")).toBe("digest");
    expect(commentKindFrom("pages")).toBe("pages");
  });
});

describe("the page-by-page comment", () => {
  it("names every page in scope", () => {
    const md = pagesComment(audit(), { lang: "fr" });
    expect(md).toContain("Accueil");
    expect(md).toContain("Contact");
  });

  it("scores a page in COUNTS, never a percentage", () => {
    // A rate over the decided criteria alone reads as a page score. With the judgment criteria
    // unruled — the normal state, and where a rejected adjudication lands — every page showed
    // « 50 % (4/106) »: 2 C and 2 NC out of 106. Same cell on a good page and a bad one.
    const md = pagesComment(audit(), { standard: "rgaa", lang: "fr" });
    const scoreboard = md.slice(md.indexOf("| Page |"), md.indexOf("<details>") >>> 0 || md.length);
    expect(scoreboard).not.toMatch(/\d+\s?%/);
    // Two columns, C and NC — and NO third one for what nobody ruled on. A number in a column
    // is something a reader learns to skip; the undecided criteria are NAMED instead, in a
    // block that disappears entirely once the grid is complete.
    expect(scoreboard).toContain("| C | NC |");
    expect(scoreboard).not.toContain("À évaluer");
    expect(md).toContain("Critères non tranchés");
    // And the legend says what the columns are, so the counts are not left to inference.
    expect(md).toMatch(/Pas de pourcentage ici/);
  });

  it("details the non-conforming criteria of a failing page, and only those", () => {
    const md = pagesComment(audit(), { lang: "fr" });
    expect(md).toContain("<details>");
    expect(md).toContain("1.1.1");
    // The conforming criterion is counted in the tally sentence, not listed as a defect.
    expect(md).toContain("conforme(s)");
  });

  it("opens a page block only for a page that actually fails", () => {
    const md = pagesComment(audit(), { lang: "fr" });
    // Counted on the PAGE blocks specifically: the document also folds the full criterion grid
    // into a <details> of its own, which is not a page and must not be mistaken for one.
    // A page block is the one whose summary carries the severity counts; the grid's does not.
    const pageBlocks = [...md.matchAll(/<summary><b>([^<]*)<\/b>[^\n]*🔴[^\n]*<\/summary>/g)].map((m) => m[1]);
    expect(pageBlocks).toEqual(["Contact"]);
  });

  it("counts a page in the ACTIVE standard's criteria, not in WCAG's", () => {
    // Shipped and caught on a real PR: the row was computed from `PageResult`, which is always
    // WCAG-keyed, so a page under RGAA was scored against the core's 55 while its own sheet in
    // the artifact counted the same verdicts against 106.
    const only: PageScope[] = [{ id: "contact", name: "Contact", url: "https://x/contact", sources: ["app/contact/page.tsx"], basis: "snapshot" }];
    const one = { scope: { inputs: [], files: 1, pages: only } } as Partial<AuditResult>;
    const rgaa = pagesComment(audit(one), { standard: "rgaa", lang: "fr" });
    const core = pagesComment(audit(one), { lang: "fr" });
    // RGAA has 106 criteria to the core's 55, so the projection must count against the pack's
    // own set. The scoreboard no longer carries a "to assess" column, so the discriminator is
    // the block that NAMES what is open: more criteria under RGAA than under the core. The
    // same number under both standards is the bug this pins.
    const openCount = (md: string): number => (md.match(/^- \*\*.+\*\* : `|^- .*critère\(s\)\./gm) ?? []).length + (md.match(/`\d+(?:\.\d+)+`/g) ?? []).length;
    expect(openCount(rgaa)).toBeGreaterThan(openCount(core));
  });

  it("agrees with its own detail block on what the page's standing is", () => {
    // ONE page, so the scoreboard row and the detail block below it describe the same thing —
    // the scoreboard is in scope order while the blocks are sorted worst-first.
    const only: PageScope[] = [{ id: "contact", name: "Contact", url: "https://x/contact", sources: ["app/contact/page.tsx"], basis: "snapshot" }];
    const md = pagesComment(audit({ scope: { inputs: [], files: 1, pages: only } } as Partial<AuditResult>), { standard: "rgaa", lang: "fr" });
    const row = /\| instantané \| (\d+) \| (\d+) \|/.exec(md);
    const tally = /(\d+) conforme\(s\) · (\d+) non conforme\(s\) · (\d+) non applicable\(s\) · (\d+) à évaluer/.exec(md);
    expect(row).not.toBeNull();
    expect(tally).not.toBeNull();
    expect(row?.[1]).toBe(tally?.[1]); // C
    expect(row?.[2]).toBe(tally?.[2]); // NC
  });

  it("explains a count the criteria cannot account for, instead of an empty block", () => {
    // Under a pack, a finding whose rule sits outside every criterion's applicability is
    // counted in the severity columns and turns no criterion NC. Silence there leaves a
    // « 🟠 1 » a reader can only guess at. Reachable for real: RGAA 3.2 lists the contrast
    // rules it applies to, so a contrast finding under any OTHER rule id decides nothing.
    const f = F({ page: "contact", severity: "majeur", criteriaId: "1.4.3", ruleId: "contrast-not-in-any-pack-scope" });
    const md = pagesComment(audit({ findings: [f], criteria: [C("1.4.3", "NC", [f])] } as Partial<AuditResult>), { standard: "rgaa", lang: "fr" });
    expect(md).toContain("<details>");
    expect(md).toMatch(/ne rendent aucun critère/);
  });

  it("leaves a blank line after <summary> so GFM renders the table", () => {
    // Without it the table ships as literal pipes.
    const md = pagesComment(audit(), { lang: "fr" });
    expect(md).toMatch(/<\/summary>\n\n/);
  });

  it("carries the caveat of a page that has no snapshot", () => {
    const pages: PageScope[] = [{ id: "accueil", name: "Accueil", url: "https://x/", sources: ["app/page.tsx"], basis: "attributed" }];
    const md = pagesComment(audit({ scope: { inputs: [], files: 1, pages } } as Partial<AuditResult>), { lang: "fr" });
    expect(md).toMatch(/n'a pas d'instantané|source/i);
  });

  it("names a page the browser refused, instead of shipping a shorter report", () => {
    const r = audit({
      scope: {
        inputs: [],
        files: 2,
        pages: PAGES,
        redirected: [{ id: "parcours", name: "Parcours de conformité", requested: "/parcours", landed: "/etape-6", reason: "redirect" }],
      },
    } as Partial<AuditResult>);
    const md = pagesComment(r, { lang: "fr" });
    expect(md).toContain("Parcours de conformité");
    expect(md).toContain("/etape-6");
  });

  it("says the sweep produced nothing, rather than rendering an empty scoreboard", () => {
    const md = pagesComment(audit({ scope: { inputs: [], files: 1 } } as Partial<AuditResult>), { lang: "fr" });
    expect(md).toMatch(/Aucune page/);
    expect(md).not.toContain("<details>");
  });

  it("links the artifact and the run, since the full grid lives there", () => {
    const md = pagesComment(audit(), { lang: "fr", artifactName: "ultra11y-pages-rgaa", runUrl: "https://gh/run/1" });
    expect(md).toContain("ultra11y-pages-rgaa");
    expect(md).toContain("https://gh/run/1");
  });

  it("stays under GitHub's limit by dropping WHOLE blocks, and says how many", () => {
    // 400 failing pages: far past 64 KiB, so the clamp has to bite.
    const many: PageScope[] = Array.from({ length: 400 }, (_, i) => ({
      id: `p${i}`,
      name: `Page numéro ${i} au nom délibérément long pour peser`,
      url: `https://x/page-${i}`,
      sources: [`app/p${i}/page.tsx`],
      basis: "snapshot" as const,
    }));
    const findings = many.map((p) => F({ page: p.id }));
    const md = pagesComment(
      audit({ scope: { inputs: [], files: 400, pages: many }, findings, criteria: [C("1.1.1", "NC", findings)] } as Partial<AuditResult>),
      {
        lang: "fr",
      },
    );
    expect(md.length).toBeLessThanOrEqual(65_536);
    // Whole blocks: every opened <details> is closed. A byte slice would leave a dangling one.
    expect([...md.matchAll(/<details>/g)].length).toBe([...md.matchAll(/<\/details>/g)].length);
    // And it never drops silently.
    expect(md).toMatch(/retiré/);
  });

  it("renders in English too", () => {
    const md = pagesComment(audit(), { lang: "en" });
    expect(md).toContain("page by page");
    expect(md).toMatch(/to assess/);
  });
});

// ---- what a reviewer can ACT on --------------------------------------------------------
//
// Measured on a real pull request (SocialGouv/egapro#4169): the page-by-page comment ran to
// 506 lines, named 35 pages, listed their non-conforming criteria — and contained not one
// file, not one line number, not one selector, not one description of what was wrong. A
// reviewer read « 3.3 — les couleurs utilisées … sont-elles suffisamment contrastées ? » and
// had to download a 4 MB artifact to learn which element, on which page, at which ratio.
//
// The digest comment has done this properly since it existed: location, defect, occurrences.
// The page comment is the SAME audit read page-first; there is no reason for it to be the
// half that says nothing. The criterion answers "what standard did we fail"; the finding
// answers "what do I change", and only the second is work a reviewer can start.
describe("the page comment says what is actually wrong, not only which criterion failed", () => {
  const withDefects = () =>
    audit({
      criteria: [
        C("1.1.1", "NC", [
          F({ page: "contact", file: "src/modules/Contact.tsx", line: 42, selectorHint: "img.hero", message: "image sans alternative textuelle" }),
        ]),
        C("1.3.1", "NC", [
          F({
            page: "contact",
            criteriaId: "1.3.1",
            ruleId: "dl-orphan",
            file: "src/modules/Contact.tsx",
            line: 88,
            selectorHint: "dd",
            severity: "majeur",
            message: "<dd> hors de tout <dl>",
          }),
        ]),
      ],
      findings: [
        F({ page: "contact", file: "src/modules/Contact.tsx", line: 42, selectorHint: "img.hero", message: "image sans alternative textuelle" }),
        F({
          page: "contact",
          criteriaId: "1.3.1",
          ruleId: "dl-orphan",
          file: "src/modules/Contact.tsx",
          line: 88,
          selectorHint: "dd",
          severity: "majeur",
          message: "<dd> hors de tout <dl>",
        }),
      ],
    } as Partial<AuditResult>);

  it("names the file and line of each defect", () => {
    const md = pagesComment(withDefects(), { lang: "fr" });
    expect(md).toContain("src/modules/Contact.tsx:42");
    expect(md).toContain("src/modules/Contact.tsx:88");
  });

  it("says what the defect IS, in words a reviewer can act on", () => {
    const md = pagesComment(withDefects(), { lang: "fr" });
    expect(md).toContain("image sans alternative textuelle");
    // …and the tags it names SURVIVE the trip. Written bare into Markdown, GitHub parses them
    // away and the reader gets « hors de tout » with both elements deleted (src/md.ts).
    expect(md).toContain("`<dd>` hors de tout `<dl>`");
    expect(md.replace(/`[^`]*`/g, "")).not.toContain("<dd>");
  });

  it("carries the selector, so the element is identifiable in a rendered page", () => {
    expect(pagesComment(withDefects(), { lang: "fr" })).toContain("img.hero");
  });

  it("still names the criterion — the defect says what to change, the criterion says why", () => {
    const md = pagesComment(withDefects(), { standard: "rgaa", lang: "fr" });
    expect(md).toMatch(/1\.1|Chaque image/);
  });

  it("folds repeated occurrences of one defect instead of printing them all", () => {
    // The same design-system defect on twenty rows of one page is ONE thing to fix. Printing
    // twenty identical lines is how a comment becomes unreadable and then gets muzzled.
    const many = Array.from({ length: 20 }, (_, i) =>
      F({ page: "contact", file: "src/modules/Table.tsx", line: 10, selectorHint: "th", message: "en-tête non référencé" }),
    );
    const md = pagesComment(audit({ criteria: [C("1.1.1", "NC", many)], findings: many } as Partial<AuditResult>), { lang: "fr" });
    expect((md.match(/src\/modules\/Table\.tsx:10/g) ?? []).length).toBe(1);
    expect(md).toMatch(/20/);
  });

  it("keeps a page with many distinct defects from crowding out every other page", () => {
    const distinct = Array.from({ length: 40 }, (_, i) =>
      F({ page: "contact", file: `src/m/F${i}.tsx`, line: i + 1, selectorHint: `img.n${i}`, message: `défaut ${i}` }),
    );
    const md = pagesComment(audit({ criteria: [C("1.1.1", "NC", distinct)], findings: distinct } as Partial<AuditResult>), { lang: "fr" });
    expect(md.length).toBeLessThan(65_536);
    // …and it says what it did not print, rather than trailing off.
    expect(md).toMatch(/autre|more/i);
  });
});

// THE COMMENT IS NOW THE ONLY ONE POSTED, so everything a reviewer needs has to be in it.
//
// egapro ran two stickies — a code digest and this grid — and two full report artifacts, and a
// reader who wanted « the accessibility report of this run » had to guess which. Collapsing to
// one producer is only safe if this document stops relying on the other one existing: the
// defects no page could claim were named ONLY in the digest, and the undecided criteria were a
// number in a column nobody acted on.
describe("the single deliverable", () => {
  it("names the criteria nobody ruled on, instead of counting them in a column", () => {
    const md = pagesComment(audit(), { standard: "rgaa", lang: "fr" });
    expect(md).toContain("Critères non tranchés");
    // Stated ONCE when it is the same everywhere — thirty-seven identical rows is a wall.
    expect(md).toMatch(/Sur \*\*toutes\*\* les pages : \d+ critère\(s\)\./);
  });

  it("says nothing at all when the grid is complete", () => {
    // The block must DISAPPEAR on a full grid: a section that is always there, even empty,
    // teaches the reader to scroll past it — which is exactly what happened to the column it
    // replaces. Every criterion decided here, so there is nothing to name.
    // STATIC criteria, deliberately: they are the ones a snapshot page can earn by silence
    // (src/pages.ts honesty rule 3), which is what "complete" looks like without a model.
    const nc = F({ page: "contact", criteriaId: "2.4.2", ruleId: "title-missing-empty" });
    const complete = audit({ criteria: [C("2.4.2", "NC", [nc]), C("3.1.1", "C")], findings: [nc] } as Partial<AuditResult>);
    expect(pagesComment(complete, { lang: "fr" })).not.toContain("Critères non tranchés");
    // …and the same document DOES name them the moment one criterion is left open.
    const withOpen = audit({ criteria: [C("2.4.2", "NC", [nc]), C("3.1.1", "manual")], findings: [nc] } as Partial<AuditResult>);
    expect(pagesComment(withOpen, { lang: "fr" })).toContain("Critères non tranchés");
  });

  it("shows the defects no page could claim, rather than only counting them", () => {
    const orphan = F({ file: "src/shared/Header.tsx", selectorHint: "img.logo", message: "logo sans alternative" });
    const md = pagesComment(audit({ criteria: [C("1.1.1", "NC", [orphan])], findings: [orphan] } as Partial<AuditResult>), { lang: "fr" });
    expect(md).toContain("Constats rattachés à aucune page");
    expect(md).toContain("src/shared/Header.tsx");
    expect(md).toContain("logo sans alternative");
  });

  it("separates blocking from non-blocking, and serves blocking first", () => {
    const blocking = F({ page: "contact", file: "src/b.html", selectorHint: "img.b", message: "défaut bloquant" });
    const minor = F({ page: "contact", file: "src/c.html", selectorHint: "a.c", severity: "mineur", message: "défaut mineur" });
    const md = pagesComment(audit({ criteria: [C("1.1.1", "NC", [blocking, minor])], findings: [blocking, minor] } as Partial<AuditResult>), { lang: "fr" });
    expect(md).toContain("🔴 Non-conformités bloquantes");
    expect(md).toContain("🟠🟡 Non-conformités non bloquantes");
    expect(md.indexOf("🔴 Non-conformités bloquantes")).toBeLessThan(md.indexOf("🟠🟡 Non-conformités non bloquantes"));
    expect(md.indexOf("défaut bloquant")).toBeLessThan(md.indexOf("défaut mineur"));
  });

  it("gives blocking defects the budget before the non-blocking ones", () => {
    // Eight distinct blocking defects and one minor: the blocking half fills the budget, and
    // what it held back is stated. The minor one may be crowded out — that is the point.
    const many = Array.from({ length: 8 }, (_, i) => F({ page: "contact", file: `src/b${i}.html`, selectorHint: `img.b${i}`, message: `bloquant ${i}` }));
    const minor = F({ page: "contact", file: "src/z.html", selectorHint: "a.z", severity: "mineur", message: "mineur unique" });
    const all = [...many, minor];
    const md = pagesComment(audit({ criteria: [C("1.1.1", "NC", all)], findings: all } as Partial<AuditResult>), { lang: "fr" });
    expect(md).toContain("bloquant 0");
    expect(md).toMatch(/autre\(s\) défaut\(s\) distinct\(s\)/);
  });

  it("clamps on the bytes GitHub actually receives, not on UTF-16 units", () => {
    // A French RGAA comment is ~4 % larger in UTF-8 — every « é », every em dash, every
    // severity emoji. A document that fits `.length` can still be 66 KB on the wire.
    const wide = Array.from({ length: 60 }, (_, i) =>
      F({ page: "contact", file: `src/é${i}.html`, line: i + 1, selectorHint: `img.é${i}`, message: `défaut « ${i} » — non conforme 🔴`.repeat(30) }),
    );
    const md = pagesComment(audit({ criteria: [C("1.1.1", "NC", wide)], findings: wide } as Partial<AuditResult>), { lang: "fr" });
    expect(new TextEncoder().encode(md).length).toBeLessThanOrEqual(65_536);
  });
});
