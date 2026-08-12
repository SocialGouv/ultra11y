// The grain is the flagship of the ticket engine: a PURE function from an audit to tickets.
// Zero vi.mock, zero I/O — if a test here needs a mock, the purity has been lost.
import { describe, it, expect } from "vitest";
import { buildTickets } from "../src/tickets/grain.js";
import { RECOMMENDATION_SUFFIX } from "../src/tickets/render.js";
import { ALL_GRAINS, type TicketGrain } from "../src/tickets/types.js";
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
  remediation: "Ajoutez un attribut alt",
  snippet: "<img>",
  ...over,
});

const C = (id: string, status: CriterionResult["status"], findings: Finding[] = []): CriterionResult => ({
  id,
  guideline: id.split(".").slice(0, 2).join("."),
  status,
  findings,
});

const audit = (over: Partial<AuditResult> = {}): AuditResult =>
  ({
    tool: "ultra11y",
    standard: "wcag",
    version: "3.0.0",
    schemaVersion: 2,
    date: "2026-08-12",
    scope: { inputs: ["."], files: 2 },
    criteria: [],
    guidelines: [],
    findings: [],
    residualRisks: [],
    conformancePct: 100,
    ...over,
  }) as unknown as AuditResult;

const PAGES: PageScope[] = [
  { id: "accueil", name: "Accueil", url: "https://x/", sources: ["app/page.tsx"], basis: "snapshot" },
  { id: "contact", name: "Contact", url: "https://x/contact", sources: ["app/contact/page.tsx"], auth: true, basis: "attributed" },
];

/** An audit with two pages, one finding on each, plus one orphan no page can claim. */
function pagedAudit(): AuditResult {
  const a = F({ file: "app/page.tsx", criteriaId: "1.1.1" });
  const b = F({ file: "app/contact/page.tsx", criteriaId: "2.4.4", severity: "majeur", selectorHint: "a" });
  const orphan = F({ file: "src/shared/Icon.tsx", criteriaId: "4.1.2", severity: "mineur" });
  return audit({
    scope: { inputs: ["."], files: 3, pages: PAGES } as AuditResult["scope"],
    findings: [a, b, orphan],
    criteria: [C("1.1.1", "NC", [a]), C("2.4.4", "NC", [b]), C("4.1.2", "NC", [orphan])],
  });
}

const opts = (grain: TicketGrain) => ({ grain, standard: "wcag", lang: "fr" as const });

describe("the grain is pure", () => {
  it("never mutates the findings it was handed, beyond the documented page stamping", () => {
    const r = audit({ findings: [F()], criteria: [C("1.1.1", "NC", [F()])] });
    const before = JSON.stringify(r);
    buildTickets(r, opts("criterion"));
    expect(JSON.stringify(r)).toBe(before);
  });

  it("is deterministic: two runs produce identical titles in identical order", () => {
    const one = buildTickets(pagedAudit(), opts("page-criterion")).tickets.map((t) => t.title);
    const two = buildTickets(pagedAudit(), opts("page-criterion")).tickets.map((t) => t.title);
    expect(one).toEqual(two);
    expect(one.length).toBeGreaterThan(0);
  });
});

describe("title grammars", () => {
  const r = audit({ findings: [F()], criteria: [C("1.1.1", "NC", [F()])] });

  // The pre-v3 --gh-issues grammar, pinned as a literal. De-dupe matches the EXACT title, so
  // one changed byte re-files every ticket in every repo that already ran it.
  it("keeps the criterion title byte-identical to the pre-v3 --gh-issues one", () => {
    expect(buildTickets(r, { ...opts("criterion"), lang: "en" }).tickets[0]?.title).toBe("[a11y] WCAG 1.1.1 — Non-text Content");
    expect(buildTickets(r, opts("criterion")).tickets[0]?.title).toBe("[a11y] WCAG 1.1.1 — Contenu non textuel");
  });

  it("keeps the single title byte-identical to the pre-v3 --gh-single one", () => {
    const [t] = buildTickets(r, opts("single")).tickets;
    expect(t?.title).toBe("[a11y] WCAG — Accessibility audit");
  });

  it("namespaces the page grain and keeps the audit frame in English at --lang fr", () => {
    const tickets = buildTickets(pagedAudit(), opts("page")).tickets;
    expect(tickets.map((t) => t.title)).toContain("[a11y] WCAG [page:accueil] — Accessibility audit");
  });

  it("carries both the page and the criterion in the page-criterion grain", () => {
    const tickets = buildTickets(pagedAudit(), opts("page-criterion")).tickets;
    expect(tickets.map((t) => t.title)).toContain("[a11y] WCAG [page:accueil] 1.1.1 — Contenu non textuel");
  });

  it("namespaces the file grain by source path", () => {
    const tickets = buildTickets(pagedAudit(), opts("file")).tickets;
    expect(tickets.map((t) => t.title)).toContain("[a11y] WCAG [file:app/page.tsx] — Accessibility audit");
  });

  // An absolute path in a title makes the de-dupe key machine-specific: a CI checkout at a
  // different path would re-file every ticket.
  it("relativises the file path, so the de-dupe key is not machine-specific", () => {
    const f = F({ file: "/build/ci/workspace/src/a.html" });
    const r2 = audit({ findings: [f], criteria: [C("1.1.1", "NC", [f])] });
    const titles = buildTickets(r2, { ...opts("file"), baseDir: "/build/ci/workspace" }).tickets.map((t) => t.title);
    expect(titles).toContain("[a11y] WCAG [file:src/a.html] — Accessibility audit");
  });

  it("leaves a path outside the repo alone rather than inventing one", () => {
    const f = F({ file: "/elsewhere/x.html" });
    const r2 = audit({ findings: [f], criteria: [C("1.1.1", "NC", [f])] });
    const titles = buildTickets(r2, { ...opts("file"), baseDir: "/build/ci/workspace" }).tickets.map((t) => t.title);
    expect(titles).toContain("[a11y] WCAG [file:/elsewhere/x.html] — Accessibility audit");
  });

  it("credits a capture finding to its SOURCE component, not the capture file", () => {
    const f = F({ file: ".ultra11y/captures/x.html", origin: { capture: ".ultra11y/captures/x.html", sourceFile: "src/Button.tsx" } });
    const r2 = audit({ findings: [f], criteria: [C("1.1.1", "NC", [f])] });
    expect(buildTickets(r2, opts("file")).tickets.map((t) => t.title)).toContain("[a11y] WCAG [file:src/Button.tsx] — Accessibility audit");
  });
});

describe("de-dupe keys never collide", () => {
  it("is unique WITHIN every grain", () => {
    for (const grain of ALL_GRAINS) {
      const titles = buildTickets(pagedAudit(), opts(grain)).tickets.map((t) => t.title);
      expect(new Set(titles).size, `duplicate title in the "${grain}" grain`).toBe(titles.length);
    }
  });

  it("never lets one grain's title land in another's, except the shared orphan ticket", () => {
    const byGrain = new Map(ALL_GRAINS.map((g) => [g, buildTickets(pagedAudit(), opts(g)).tickets.map((t) => t.title)]));
    const all = [...byGrain.values()].flat();
    const repeated = all.filter((t, i) => all.indexOf(t) !== i);
    // The ONE deliberate overlap: both page grains emit the same unattributed-findings
    // ticket, so switching granularity re-uses that backlog instead of duplicating it.
    expect([...new Set(repeated)]).toEqual(["[a11y] WCAG [unattributed] — Accessibility audit"]);
  });

  it("keeps the two legacy grammars clear of the three namespaced ones", () => {
    const legacy = [...buildTickets(pagedAudit(), opts("criterion")).tickets, ...buildTickets(pagedAudit(), opts("single")).tickets].map((t) => t.title);
    expect(legacy.every((t) => !t.includes("[page:") && !t.includes("[file:") && !t.includes("[unattributed]"))).toBe(true);
  });
});

describe("advisory units stay out of the non-conformity channel", () => {
  const adv = F({ advisory: true, ruleId: "one-h1", criteriaId: "1.3.1" });
  const r = audit({ findings: [adv], criteria: [C("1.3.1", "NC", [adv])] });

  it("suffixes the title and labels it a recommendation", () => {
    const [t] = buildTickets(r, opts("criterion")).tickets;
    expect(t?.title.endsWith(RECOMMENDATION_SUFFIX)).toBe(true);
    expect(t?.advisory).toBe(true);
    expect(t?.labels).toContain("recommendation");
  });

  it("labels a normative unit without the recommendation tag", () => {
    const n = audit({ findings: [F()], criteria: [C("1.1.1", "NC", [F()])] });
    const [t] = buildTickets(n, opts("criterion")).tickets;
    expect(t?.labels).toEqual(["accessibility", "wcag", "bloquant"]);
    expect(t?.advisory).toBe(false);
  });
});

describe("the page honesty rules survive into the ticket", () => {
  it("warns on an `attributed` page that absence of a finding is not conformity", () => {
    const t = buildTickets(pagedAudit(), opts("page")).tickets.find((x) => x.title.includes("[page:contact]"));
    expect(t?.body).toContain("n'a pas d'instantané");
  });

  it("does not warn on a `snapshot` page, which needs no caveat", () => {
    const t = buildTickets(pagedAudit(), opts("page")).tickets.find((x) => x.title.includes("[page:accueil]"));
    expect(t?.body).not.toContain("n'a pas d'instantané");
  });

  it("carries the page URL and the auth flag into the body", () => {
    const t = buildTickets(pagedAudit(), opts("page")).tickets.find((x) => x.title.includes("[page:contact]"));
    expect(t?.body).toContain("https://x/contact");
    expect(t?.body).toContain("Authentification requise");
  });

  it("files unattributed findings as their OWN ticket rather than dropping or spreading them", () => {
    const plan = buildTickets(pagedAudit(), opts("page"));
    expect(plan.unattributed).toBe(1);
    const orphan = plan.tickets.find((t) => t.title.includes("[unattributed]"));
    expect(orphan).toBeDefined();
    expect(orphan?.body).toContain("jamais répartis d'office");
    // and it never lands on a real page
    for (const t of plan.tickets.filter((x) => x !== orphan)) expect(t.body).not.toContain("4.1.2");
  });

  it("emits the orphan ticket under page-criterion too, so granularity never loses findings", () => {
    const plan = buildTickets(pagedAudit(), opts("page-criterion"));
    expect(plan.tickets.some((t) => t.title.includes("[unattributed]"))).toBe(true);
  });

  it("reports `no-pages` instead of silently filing nothing when no page is in scope", () => {
    const r = audit({ findings: [F()], criteria: [C("1.1.1", "NC", [F()])] });
    const plan = buildTickets(r, opts("page"));
    expect(plan.error).toBe("no-pages");
    expect(plan.tickets).toEqual([]);
  });
});

describe("severity roll-up", () => {
  it("takes the most severe unit for a multi-criterion ticket", () => {
    const [t] = buildTickets(pagedAudit(), opts("single")).tickets;
    expect(t?.severity).toBe("bloquant");
  });

  it("files nothing at all when the audit found nothing", () => {
    expect(buildTickets(audit(), opts("single")).tickets).toEqual([]);
    expect(buildTickets(audit(), opts("criterion")).tickets).toEqual([]);
  });
});

describe("bodies", () => {
  const r = audit({ findings: [F()], criteria: [C("1.1.1", "NC", [F()])] });

  it("uses the shared auditor block, not a second template", () => {
    const [t] = buildTickets(r, opts("criterion")).tickets;
    expect(t?.body).toContain("**Critère de succès** : 1.1.1");
    expect(t?.body).toContain("- [ ] `src/a.html:1`");
  });

  it("honours --format remediation", () => {
    const [t] = buildTickets(r, { ...opts("criterion"), format: "remediation" }).tickets;
    expect(t?.body).toContain("**Correction**");
    expect(t?.body).not.toContain("**Critère de succès**");
  });

  it("clamps an oversized body and points at the PRD instead of blowing the tracker limit", () => {
    const many = Array.from({ length: 400 }, (_, i) => F({ line: i + 1 }));
    const big = audit({ findings: many, criteria: [C("1.1.1", "NC", many)] });
    const [t] = buildTickets(big, { ...opts("criterion"), bodyLimit: 2000 }).tickets;
    expect(t!.body.length).toBeLessThanOrEqual(2000);
    expect(t?.body).toContain("tronqué");
  });

  it("leaves a body under the limit untouched", () => {
    const [t] = buildTickets(r, { ...opts("criterion"), bodyLimit: 65536 }).tickets;
    expect(t?.body).not.toContain("tronqué");
  });

  it("states that a file carries no conformance rate", () => {
    const [t] = buildTickets(r, opts("file")).tickets;
    expect(t?.body).toContain("Un fichier n'est pas une page");
  });
});
