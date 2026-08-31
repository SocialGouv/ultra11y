// THE CRITERIA THAT ARRIVED WITH NOTHING TO LOOK AT.
//
// Measured on `tests/fixtures/realworld`, crawled and scanned: of the 37 criteria the engine
// handed to the adjudicator, five came with an EMPTY harvest — 7.4, 10.1, 13.2, 13.3, 13.4. A
// criterion with no evidence cannot be ruled on: the gate refuses a `C` with nothing cited, so
// the only answers left are `NA` and `manual`, and the model is being billed to guess between
// them. That is not a model failing, it is a criterion nobody gave anything to read.
//
// Three of the five were pointing at the WRONG SUBJECT, inherited through their WCAG mapping:
//
//   10.1  « des feuilles de styles sont-elles utilisées pour contrôler la présentation ? »
//         inherited `readingOrder` from 1.3.2. Its actual tests are the closed list of
//         forbidden presentational elements and attributes, which is markup and mechanical.
//   13.2  « l'ouverture d'une nouvelle fenêtre ne doit pas être déclenchée sans action de
//         l'utilisateur » inherited `contextChange` from 3.2.1 — focus/change handlers, which
//         are a different question from opening a window.
//   7.4   « chaque script qui initie un changement de contexte » had `contextChange`, which
//         looked only for onFocus/onBlur/onChange and so missed submitting, navigating and
//         opening a window — the three ways a script actually changes context.
//
// And 13.3/13.4 had the right subject and no way to conclude from its silence: with no office
// document anywhere in scope, « is there an accessible version? » is a question about nothing.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAudit } from "../src/audit.js";
import { EXISTENCE_SUBJECTS, harvestSubjects, subjectsForPackCriterion } from "../src/adjudicate-subjects.js";
import { parseHtml } from "../src/parse/html.js";
import { formatAdjudication } from "../src/adjudicate.js";
import { derivePackResults } from "../src/standards/derive.js";
import { PAGES_DIR, SNAPSHOT_VERSION, writeSnapshot } from "../src/snapshot.js";
import { loadPack } from "../src/standards/index.js";
import type { AuditResult } from "../src/types.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "u11y-empty-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const page = (body: string) => `<html lang="fr"><head><title>T</title></head><body><main><h1>H</h1>${body}</main></body></html>`;

/** Audit one capture — the shape every one of these criteria is actually decided on. */
function auditPage(body: string): AuditResult {
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "accueil", name: "Accueil", url: "https://example.test/", doctype: "<!DOCTYPE html>" },
    dom: page(body),
  } as Parameters<typeof writeSnapshot>[1]);
  return runAudit({ inputs: [join(root, PAGES_DIR)] });
}

const rgaa = (audit: AuditResult, id: string) => derivePackResults(audit, "rgaa").find((c) => c.id === id)!;
const ruleIds = (audit: AuditResult) => [...audit.findings, ...(audit.packFindings ?? [])].map((f) => f.ruleId);

const subjects = (id: string) => {
  const pc = loadPack("rgaa").criteria.find((c) => c.id === id)!;
  return subjectsForPackCriterion("rgaa", id, pc.wcag);
};
const harvestOn = (id: string, html: string) => harvestSubjects(subjects(id), [parseHtml(page(html), "p.html")]);

// ---------------------------------------------------------------------------------------
describe("RGAA multimedia subjects stay aligned with the criterion being adjudicated", () => {
  it("gives 4.11 temporal media, not the generic keyboard/pointer union", () => {
    const evidence = harvestOn(
      "4.11",
      '<div onclick="go()">ordinary widget</div><object data="map.svg"></object><audio src="voice.mp3" autoplay></audio><video controls></video>',
    );
    expect(evidence.some((x) => x.ev.selector.startsWith("audio"))).toBe(true);
    expect(evidence.some((x) => x.ev.selector.startsWith("video"))).toBe(true);
    expect(evidence.some((x) => x.ev.selector.startsWith("div"))).toBe(false);
    expect(evidence.some((x) => x.ev.selector.startsWith("object"))).toBe(false);
  });

  it("gives 4.12 non-temporal media, not temporal players or unrelated handlers", () => {
    const evidence = harvestOn(
      "4.12",
      '<div onclick="go()">ordinary widget</div><object data="map.svg"></object><canvas></canvas><svg></svg><audio controls></audio>',
    );
    for (const tag of ["object", "canvas", "svg"]) expect(evidence.some((x) => x.ev.selector.startsWith(tag))).toBe(true);
    expect(evidence.some((x) => x.ev.selector.startsWith("audio"))).toBe(false);
    expect(evidence.some((x) => x.ev.selector.startsWith("div"))).toBe(false);
  });

  it("gives 13.7 flash candidates, without confusing autoplay audio or scrolling text with a flash", () => {
    const evidence = harvestOn(
      "13.7",
      '<audio autoplay></audio><marquee>news</marquee><img src="still.png" alt=""><video src="clip.mp4"></video><canvas></canvas>',
    );
    for (const tag of ["img", "video", "canvas"]) expect(evidence.some((x) => x.ev.selector.startsWith(tag))).toBe(true);
    expect(evidence.some((x) => x.ev.selector.startsWith("audio"))).toBe(false);
    expect(evidence.some((x) => x.ev.selector.startsWith("marquee"))).toBe(false);
  });

  it("recognises script and CSS flash mechanisms as evidence for 13.7", () => {
    const evidence = harvestOn(
      "13.7",
      '<style>.warning { animation: strobe .2s infinite }</style><script>setInterval(() => el.classList.toggle("bright"), 100)</script>',
    );
    expect(evidence.some((x) => x.ev.selector.startsWith("script"))).toBe(true);
    expect(evidence.some((x) => /animation|setInterval|strobe/i.test(`${x.ev.note} ${x.ev.snippet}`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------
describe("RGAA 10.1 — presentational markup, which is a closed list and therefore mechanical", () => {
  // The list is normative and vendored: the RGAA glossary entry « Présentation de
  // l'information » names the forbidden elements and attributes outright.
  it.each(["basefont", "big", "blink", "center", "font", "marquee", "s", "strike", "tt"])("flags <%s>", (tag) => {
    expect(ruleIds(auditPage(`<${tag}>x</${tag}>`))).toContain("presentational-element");
  });

  it("leaves <u> alone — it is legal HTML5, and the RGAA forbids it only under an older doctype", () => {
    expect(ruleIds(auditPage("<u>x</u>"))).not.toContain("presentational-element");
  });

  it("leaves <b> and <i> alone — they carry meaning in HTML5 and are not on the list", () => {
    expect(ruleIds(auditPage("<b>x</b><i>y</i>"))).not.toContain("presentational-element");
  });

  it.each(["align", "bgcolor", "border", "cellpadding", "cellspacing", "clear", "color", "hspace", "valign", "vspace"])("flags the %s attribute", (name) => {
    expect(ruleIds(auditPage(`<p ${name}="x">t</p>`))).toContain("presentational-attribute");
  });

  it("flags width/height on an ordinary element", () => {
    expect(ruleIds(auditPage('<div width="200">t</div>'))).toContain("presentational-attribute");
  });

  it.each(["img", "object", "embed", "canvas", "svg", "video", "iframe"])("leaves width/height alone on <%s>, where HTML5 defines them", (tag) => {
    expect(ruleIds(auditPage(`<${tag} width="200" height="100"${tag === "img" ? ' alt="a" src="s.png"' : ""}></${tag}>`))).not.toContain(
      "presentational-attribute",
    );
  });

  it("flags size outside <select>, and leaves it alone on <select>", () => {
    expect(ruleIds(auditPage('<input size="10" aria-label="a">'))).toContain("presentational-attribute");
    expect(ruleIds(auditPage('<select size="3" aria-label="a"><option>a</option></select>'))).not.toContain("presentational-attribute");
  });

  it("flags a word spelled out with spaces, and runs of non-breaking spaces used as layout", () => {
    expect(ruleIds(auditPage("<p>P a r i s</p>"))).toContain("presentational-spacing");
    expect(ruleIds(auditPage("<p>Nom    Prénom</p>"))).toContain("presentational-spacing");
  });

  it("leaves ordinary prose and indented source alone", () => {
    expect(ruleIds(auditPage("<p>Paris est une ville, et\n      la capitale.</p>"))).not.toContain("presentational-spacing");
    expect(ruleIds(auditPage("<p>a b c</p>"))).not.toContain("presentational-spacing"); // three letters is not a spelled-out word
  });

  it("is NON-CONFORMING when presentational markup is present", () => {
    expect(rgaa(auditPage('<center><font color="red">t</font></center>'), "10.1").status).toBe("NC");
  });

  it("STAYS OPEN on a captured page with none of it — the rule is narrower than the criterion", () => {
    // 10.1 was on the `completeBySilence` allowlist and left it. Every one of the three
    // narrowings above is documented on its own line in this very describe: `<u>` deliberately
    // untouched, `width`/`height` tolerated on nine tags where the glossary names five,
    // « presentation built out of spaces » covered by two heuristics chosen for being
    // distinctive rather than exhaustive.
    //
    // Each is the right call for a FINDING — under-reporting never manufactures a
    // non-conformity — and the wrong one for a CONFORMITY. « This rule found nothing » and
    // « this criterion is satisfied » are not the same claim when the rule was written to look
    // at less than the criterion asks about. The correction costs money: 10.1 now reaches an
    // adjudicator on every run.
    const c = rgaa(auditPage("<p>Du texte ordinaire.</p>"), "10.1");
    expect(c.status).toBe("manual");
  });

  it("no longer inherits `readingOrder`, which answers a different question", () => {
    expect(subjects("10.1")).not.toContain("readingOrder");
  });
});

// ---------------------------------------------------------------------------------------
describe("RGAA 13.2 — opening a window, which is not the same question as changing context", () => {
  it("stops inheriting `contextChange` from 3.2.1", () => {
    expect(subjects("13.2")).toEqual(["newWindow"]);
  });

  it("harvests the ways a window actually gets opened", () => {
    expect(harvestOn("13.2", '<a href="/x" target="_blank">x</a>').length).toBeGreaterThan(0);
    expect(harvestOn("13.2", "<script>window.open('/x')</script>").length).toBeGreaterThan(0);
    expect(harvestOn("13.2", '<meta http-equiv="refresh" content="0;url=/x">').length).toBeGreaterThan(0);
  });

  it("stays silent on a page that opens nothing", () => {
    expect(harvestOn("13.2", '<a href="/x">x</a>')).toEqual([]);
  });

  // AND THAT SILENCE IS A FACT, so the criterion closes on it instead of costing a model turn.
  //
  // 13.2 has exactly one test, and its official methodology is « vérifier qu'à l'ouverture du
  // document, aucune nouvelle fenêtre n'est ouverte ». A page that FAILS it therefore carries
  // one of the three things the harvester looks for: a `target` that leaves this browsing
  // context, a meta refresh, or a literal `window.open(`. That is an element/attribute species
  // — the same admission test `downloadDocs` passes — so an empty harvest means « nothing here
  // opens a window », which is the verdict, not a question.
  //
  // Measured on tests/fixtures/realworld, crawled and scanned with the engine at v5.25.0: 13.2
  // was one of only two criteria still reaching the adjudicator with population 0 and
  // `evidenceComplete`, i.e. the engine already KNEW the answer and billed a model to restate
  // it. The other is 7.4, which stays out — see below.
  it("counts a window-opening mechanism as an element species whose absence is a fact", () => {
    expect(EXISTENCE_SUBJECTS.has("newWindow")).toBe(true);
  });

  it("is not applicable on a scope where nothing can open a window", () => {
    const c = rgaa(auditPage('<a href="/contact">Contact</a>'), "13.2");
    expect(c.inapplicable).toBe(true);
    expect(c.status).toBe("C");
  });

  it("stays the agent's the moment something can", () => {
    const c = rgaa(auditPage('<a href="/x" target="_blank">x</a>'), "13.2");
    expect(c.inapplicable).toBeUndefined();
    expect(c.status).toBe("manual");
  });
});

// ---------------------------------------------------------------------------------------
describe("RGAA 7.4 — the three ways a script changes context", () => {
  it("harvests a handler that submits, navigates, or opens a window", () => {
    expect(harvestOn("7.4", "<script>el.onchange = () => form.submit()</script>").length).toBeGreaterThan(0);
    expect(harvestOn("7.4", "<script>function go(){ location.href = '/x' }</script>").length).toBeGreaterThan(0);
    expect(harvestOn("7.4", "<script>btn.onclick = () => window.open('/x')</script>").length).toBeGreaterThan(0);
  });

  it("still harvests the focus and change handlers it always did", () => {
    expect(harvestOn("7.4", '<input onChange="x()" aria-label="a">').length).toBeGreaterThan(0);
  });

  // IT SEES THE SCRIPT ITSELF, not only the five things a script might go on to do.
  //
  // That was the actual defect, and calling it "a heuristic" excused it for a release.
  // `contextChange` matched onFocus/onBlur/onChange, `.submit(`, `location`, `router.push` and
  // `window.open` — a list of CONSEQUENCES. tests/fixtures/realworld ships LoginForm.tsx whose
  // form carries `onSubmit={(e) => { e.preventDefault(); … }}`: a script, with a handler, doing
  // the very thing 7.4 asks about, and the harvest returned NOTHING. The adjudicator was told
  // "no evidence" about a page containing a submit handler, and billed to guess between NA and
  // manual.
  //
  // So the subject is the SCRIPT now — any `<script>`, any `on*` binding — plus the consequences
  // it already looked for. A page that fails 7.4 has a script by definition, so this subject's
  // silence is a fact about the code rather than a gap in a pattern list. That is what makes it
  // admissible below, and it is a different claim from the one this file used to make.
  it("harvests a submit handler — the one the fixture ships and the old list walked past", () => {
    expect(harvestOn("7.4", '<form onSubmit="go()"><button>x</button></form>').length).toBeGreaterThan(0);
  });

  it("harvests a click handler, and a script element carrying no handler at all", () => {
    expect(harvestOn("7.4", '<button onClick="go()">x</button>').length).toBeGreaterThan(0);
    expect(harvestOn("7.4", "<script>const a = 1</script>").length).toBeGreaterThan(0);
  });

  it("counts a script as an element species whose absence is a fact", () => {
    expect(EXISTENCE_SUBJECTS.has("contextChange")).toBe(true);
  });

  it("is not applicable on a scope that runs no script at all", () => {
    const c = rgaa(auditPage("<p>Rien que du texte.</p>"), "7.4");
    expect(c.inapplicable).toBe(true);
    expect(c.status).toBe("C");
  });

  it("stays the agent's the moment a script exists, whatever it does", () => {
    const c = rgaa(auditPage('<form onSubmit="go()"><button>Envoyer</button></form>'), "7.4");
    expect(c.inapplicable).toBeUndefined();
    expect(c.status).toBe("manual");
  });
});

// ---------------------------------------------------------------------------------------
describe("RGAA 7.2 — scripts and their alternatives", () => {
  it("uses script evidence instead of the inherited ARIA population", () => {
    expect(subjects("7.2")).toEqual(["scriptAlternatives"]);
    const evidence = harvestOn("7.2", '<div aria-label="generic" onclick="go()">Go</div>');
    expect(evidence).toHaveLength(1);
    expect(evidence.some((x) => x.ev.note?.includes("script handler"))).toBe(true);
  });

  it("shows both a script and its explicit noscript alternative", () => {
    const evidence = harvestOn("7.2", '<script src="app.js"></script><noscript><a href="/simple">Version simple</a></noscript>');
    expect(evidence.some((x) => x.ev.selector === "script")).toBe(true);
    expect(evidence.some((x) => x.ev.selector === "noscript")).toBe(true);
  });

  it("closes as not applicable only when the scope runs no script", () => {
    expect(EXISTENCE_SUBJECTS.has("scriptAlternatives")).toBe(true);
    const absent = rgaa(auditPage("<p>Rien que du texte.</p>"), "7.2");
    expect(absent.inapplicable).toBe(true);
    expect(absent.status).toBe("C");

    const present = rgaa(auditPage('<button onclick="go()">Go</button>'), "7.2");
    expect(present.inapplicable).toBeUndefined();
    expect(present.status).toBe("manual");
  });
});

// ---------------------------------------------------------------------------------------
describe("RGAA 13.3 / 13.4 — a question about nothing, when nothing is downloadable", () => {
  it("counts an office document as an element species whose absence is a fact", () => {
    expect(EXISTENCE_SUBJECTS.has("downloadDocs")).toBe(true);
  });

  it.each(["13.3", "13.4"])("is not applicable on a scope with no downloadable document (%s)", (id) => {
    const c = rgaa(auditPage('<a href="/contact">Contact</a>'), id);
    expect(c.inapplicable).toBe(true);
    expect(c.status).toBe("C");
  });

  it.each(["13.3", "13.4"])("stays the agent's the moment one exists (%s)", (id) => {
    const c = rgaa(auditPage('<a href="/rapport.pdf">Rapport</a>'), id);
    expect(c.inapplicable).toBeUndefined();
    expect(c.status).toBe("manual");
  });
});

// ---------------------------------------------------------------------------------------
// And when a harvest is legitimately empty — the fixture runs no script that opens a window,
// so 13.2 has nothing to show — the brief has to say what the gate will take. It used to say
// « decide from source, or leave manual with a reason », which invites the one answer that is
// always refused. Measured on run 32508717451: two criteria arrived empty, both were ruled `C`,
// and the gate refused every one of the five attempts across three passes.
describe("a brief with nothing in it names the answers the gate accepts", () => {
  const brief = (lang: "fr" | "en") =>
    formatAdjudication(
      [
        {
          criteriaId: "13.2",
          title: "Fenêtres",
          automatability: "judgment",
          evidence: [],
          verdict: null,
          justification: "",
          reason: null,
          findings: [],
          recommendations: [],
          decidedBy: "agent",
        } as never,
      ],
      lang,
      "rgaa",
      { preamble: false },
    );

  it.each(["fr", "en"] as const)("refuses to invite a C it will reject (%s)", (lang) => {
    const text = brief(lang);
    expect(text).toMatch(lang === "fr" ? /AUCUNE ÉVIDENCE MOISSONNÉE/ : /NO EVIDENCE WAS HARVESTED/);
    expect(text).toMatch(lang === "fr" ? /`C` sera REFUSÉ/ : /`C` will be REFUSED/);
  });

  it.each(["fr", "en"] as const)("names both accepted answers, and distinguishes them (%s)", (lang) => {
    const text = brief(lang);
    expect(text).toContain("`NA`");
    expect(text).toContain("undecidable");
  });
});
