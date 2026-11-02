// EACH SUBJECT HARVESTS ITS CRITERION'S REAL POPULATION, ON THE PAGE THAT RENDERS IT (#130).
//
// Found by a senior-auditor adjudication of a real run (egapro, 39 captures):
//   - 4.8/4.9 were handed a copy of 1.6's image list, without the canvas charts that are the
//     site's non-temporal media;
//   - 4.12/4.13 listed the hidden DSFR pictograms (`svg[aria-hidden]`) as media;
//   - 3.1 was 180 links out of 184 entries, and never a state drawn in colour;
//   - 3.3 cited every component's CSS rule at `accueil/dom.html:1`, rendered there or not;
//   - 11.2/11.4/11.5 folded the step-4 fields named by `aria-labelledby` into a step-1
//     `aria-label` field, so their labels were never shown;
//   - 12.3 had the footer link to the site map, not the site map's own content.
// Every case is pinned in both directions: the right population in, the noise out.
import { describe, expect, it } from "vitest";

import { type Harvested, SUBJECTS, harvestSubjects, subjectsForPackCriterion } from "../src/adjudicate-subjects.js";
import { type Doc, parseHtml } from "../src/parse/html.js";
import { parseSource } from "../src/parse/source.js";
import { loadPack } from "../src/standards/index.js";

const capture = (body: string, page = "p") =>
  parseHtml(`<html lang="fr"><head><title>T</title></head><body>${body}</body></html>`, `.ultra11y/pages/${page}/dom.html`);
const rgaa = (id: string, docs: Doc[]): Harvested[] => {
  const pc = loadPack("rgaa").criteria.find((c) => c.id === id)!;
  return harvestSubjects(subjectsForPackCriterion("rgaa", id, pc.wcag), docs);
};
const notes = (xs: Harvested[]) => xs.map((x) => x.ev.note ?? "");

const CHARTS = `<main>
  <img alt="" src="/illustration.svg">
  <svg aria-hidden="true" class="fr-artwork"><use href="/dsfr/pictogram.svg#a"></use></svg>
  <figure><figcaption class="fr-sr-only">Funnel des déclarations</figcaption>
    <div role="img" aria-label="Funnel principal — toutes les déclarations"><div _echarts_instance_="ec_1793631923033"><canvas width="428"></canvas><canvas width="428"></canvas></div></div>
  </figure>
  <div role="img" aria-label="Taux d'abandon par phase"><svg class="recharts-surface"><g><svg><rect/></svg></g></svg></div>
</main>`;

describe("4.8/4.9 — the non-temporal media themselves", () => {
  it("names its own subject instead of inheriting the image list", () => {
    expect(subjectsForPackCriterion("rgaa", "4.8", ["1.1.1"])).toEqual(["nonTemporalMedia"]);
    expect(subjectsForPackCriterion("rgaa", "4.9", ["1.1.1"])).toEqual(["nonTemporalMedia"]);
  });

  it("harvests each chart once, named by its container — and no decorative image", () => {
    const n = notes(rgaa("4.8", [capture(CHARTS)]));
    expect(n).toHaveLength(2);
    expect(n.some((x) => /<canvas> in <div role="img"> name="Funnel principal/.test(x))).toBe(true);
    expect(n.some((x) => /<svg> in <div role="img"> name="Taux d'abandon par phase"/.test(x))).toBe(true);
    expect(n.some((x) => /illustration|pictogram|alt=/.test(x))).toBe(false);
  });

  it("a chart component in source is a medium too, its dynamic name shown as such", () => {
    const doc = parseSource(
      `import ReactECharts from "echarts-for-react";\nexport function C({ caption }) { return (<div aria-label={caption} role="img"><ReactECharts option={{}} /></div>); }\n`,
      "src/C.tsx",
    );
    const n = notes(rgaa("4.8", [doc]));
    expect(n).toHaveLength(1);
    expect(n[0]).toMatch(/chart component <ReactECharts> in <div role="img"> name="\{caption\}"/);
  });
});

describe("4.12/4.13 — hidden decoration is not media", () => {
  it("drops `svg[aria-hidden]` and keeps the charts", () => {
    for (const id of ["4.12", "4.13"]) {
      const n = notes(rgaa(id, [capture(CHARTS)])).filter((x) => /non-temporal media/.test(x));
      expect(n).toHaveLength(2);
      expect(n.some((x) => /fr-artwork|pictogram/.test(x))).toBe(false);
    }
  });

  it("…but an informative SVG that is not hidden stays", () => {
    const n = notes(SUBJECTS.nonTemporalMediaControls!([capture(`<main><svg role="img" aria-label="Carte des régions"><path d="M0 0"/></svg></main>`)]));
    expect(n.some((x) => /name="Carte des régions"/.test(x))).toBe(true);
  });
});

describe("3.1 — states drawn in colour", () => {
  const page = capture(`<main>
    <div class="fr-stepper"><h2 class="fr-stepper__title">Écart<span class="fr-stepper__state">Étape 2 sur 6</span></h2><div class="fr-stepper__steps" data-fr-current-step="2" data-fr-steps="6"></div></div>
    <p class="fr-badge fr-badge--success">Transmise</p>
    <nav><a href="/a" aria-current="page">Accueil</a><a href="/b">Aide</a></nav>
    <div class="fr-mt-4w fr-col-md-6 fr-grid-row--gutters"><p>Rien</p></div>
  </main>`);

  it("surfaces the stepper's current step, a status badge and the current page, before the links", () => {
    const xs = rgaa("3.1", [page]);
    const n = notes(xs);
    expect(n.some((x) => /data-fr-current-step="2"/.test(x))).toBe(true);
    expect(n.some((x) => /class "fr-badge--success" text="Transmise"/.test(x))).toBe(true);
    expect(n.some((x) => /aria-current="page" text="Accueil"/.test(x))).toBe(true);
    expect(n.findIndex((x) => /state drawn by/.test(x))).toBeLessThan(n.findIndex((x) => /^text=/.test(x)));
  });

  it("layout and spacing utilities are no state", () => {
    expect(notes(SUBJECTS.colourState!([page])).some((x) => /fr-mt-4w|fr-col-md-6|gutters/.test(x))).toBe(false);
  });

  it("in source, a class chosen by a condition is surfaced; a fixed one is not", () => {
    const doc = parseSource(
      `export function C({ over }) { return (<div><span className={over ? styles.barAlert : styles.bar}>12 %</span><span className={styles.bar}>3 %</span></div>); }\n`,
      "src/C.tsx",
    );
    const n = notes(SUBJECTS.colourState!([doc]));
    expect(n).toHaveLength(1);
    expect(n[0]).toMatch(/class chosen by a condition/);
  });

  it("charts, which encode their series in colour, are part of 3.1's population", () => {
    expect(notes(rgaa("3.1", [capture(CHARTS)])).some((x) => /<canvas> in <div role="img">/.test(x))).toBe(true);
  });
});

describe("3.3 — a stylesheet rule is cited on the page that renders it", () => {
  const rules = [
    { selector: ".Home-module-scss-module__a1__hero", decls: { color: "rgb(0, 0, 145)" } },
    { selector: ".FileUpload-module-scss-module__oViVnW__selectButton:hover", decls: { color: "var(--text-action-high-blue-france)", backgroundColor: "" } },
    { selector: ".FileUpload-module-scss-module__oViVnW__dropzoneDragging", decls: { backgroundColor: "var(--background-alt-blue-france)" } },
    { selector: ".FileUpload-module-scss-module__oViVnW__dropzone", decls: { backgroundColor: "" } },
    { selector: ".Ghost-module-scss-module__zz__panel", decls: { color: "red" } },
  ];
  const withCss = (d: Doc): Doc => Object.assign(d, { signals: { css: { v: 1, rules, unreadable: 0 } } });
  const home = withCss(capture(`<main><div class="Home-module-scss-module__a1__hero">Accueil</div></main>`, "accueil"));
  const upload = withCss(
    capture(
      `<main><section class="FileUpload-module-scss-module__oViVnW__dropzone"><button class="FileUpload-module-scss-module__oViVnW__selectButton">Parcourir</button></section></main>`,
      "declaration-etape-5",
    ),
  );
  const css = () => rgaa("3.3", [home, upload]).filter((x) => x.ev.selector.startsWith("css:"));
  const at = (sel: string) =>
    css()
      .filter((x) => x.ev.selector.includes(sel))
      .map((x) => `${x.ev.file.split("/")[2]} ${x.ev.note}`);

  it("a component's rule goes to the page that renders the component, not to the first page", () => {
    expect(at("selectButton")).toEqual([expect.stringMatching(/^declaration-etape-5 .*\[component FileUpload\]$/)]);
    expect(at("__hero")).toEqual([expect.stringMatching(/^accueil /)]);
  });

  it("a state class the capture never saw goes to the page carrying its component, and says so", () => {
    expect(at("dropzoneDragging")).toEqual([expect.stringMatching(/^declaration-etape-5 .*the state this rule targets was not captured/)]);
  });

  it("a rule no captured page renders is never dropped: kept once, and labelled", () => {
    expect(at("Ghost")).toEqual([expect.stringMatching(/^accueil .*no captured page renders an element this rule targets/)]);
  });

  it("an empty longhand is no colour declaration", () => {
    expect(at("__dropzone").filter((x) => !/Dragging/.test(x))).toEqual([]);
  });
});

describe("11.2/11.4/11.5 — every naming mechanism is part of a field's identity", () => {
  const step1 = capture(
    `<main><input type="text" class="fr-input" id="w" aria-label="Rémunération annuelle — Nombre de femmes"></main>`,
    "declaration-etape-1",
  );
  const step4 = capture(
    `<main><span id="q1-max-label">Seuil maximum 1er quartile annuel</span><input type="text" class="fr-input" id="q1-max" aria-labelledby="q1-max-label"></main>`,
    "declaration-etape-4",
  );

  it("a field named by aria-labelledby is not folded into one named by aria-label", () => {
    const xs = rgaa("11.2", [step1, step4]).filter((x) => x.cls.startsWith("control|"));
    expect(new Set(xs.map((x) => x.cls)).size).toBe(2);
    expect(xs.some((x) => x.ev.file.includes("declaration-etape-4") && /labelledby-text="Seuil maximum 1er quartile annuel"/.test(x.ev.note ?? ""))).toBe(true);
  });

  it("…while the same field on two pages is still ONE class", () => {
    const again = capture(
      `<main><input type="text" class="fr-input" id="w" aria-label="Rémunération annuelle — Nombre de femmes"></main>`,
      "declaration-recapitulatif",
    );
    const xs = rgaa("11.2", [step1, again]).filter((x) => x.cls.startsWith("control|"));
    expect(new Set(xs.map((x) => x.cls)).size).toBe(1);
  });

  it("in source, fields that differ only by a dynamic aria-labelledby stay distinct", () => {
    const doc = parseSource(
      `export function Row({ idMax, idF }) { return (<tr><td><input aria-labelledby={\`\${idMax}-label\`} type="text" /></td><td><input aria-labelledby={\`\${idF}-label\`} type="text" /></td></tr>); }\n`,
      "src/QuartileTableRow.tsx",
    );
    expect(new Set(SUBJECTS.controls!([doc]).map((x) => x.cls)).size).toBe(2);
  });
});

describe("12.3 — the site map page's own content", () => {
  const sitemap = capture(
    `<header><a href="/">Accueil</a></header><main><nav aria-label="vous êtes ici :" class="fr-breadcrumb"><a href="/">Accueil</a></nav><h1>Plan du site</h1><h2>Pages principales</h2><ul><li><a href="/aide">Aide et ressources</a></li><li><a href="/faq">Questions fréquentes</a></li></ul></main><footer><a href="/plan-du-site">Plan du site</a></footer>`,
    "plan-du-site",
  );
  const other = capture(`<main><h1>Aide</h1><a href="/faq">FAQ</a></main><footer><a href="/plan-du-site">Plan du site</a></footer>`, "aide");

  it("lists every entry of the site map, under its section, before the link that leads to it", () => {
    const n = notes(rgaa("12.3", [other, sitemap]));
    expect(n[0]).toMatch(/^page="plan-du-site" — THE SITE MAP PAGE: 2 entries: "Aide et ressources" → \/aide, "Questions fréquentes" → \/faq/);
    expect(n.some((x) => /site-map entry text="Aide et ressources" href="\/aide" section="Pages principales"/.test(x))).toBe(true);
    expect(n.some((x) => /site map \/ index link/.test(x))).toBe(true);
  });

  it("takes neither the page chrome nor the breadcrumb for an entry, and reads no other page", () => {
    const n = notes(SUBJECTS.siteMapPage!([other, sitemap]));
    expect(n.filter((x) => x.startsWith("site-map entry"))).toHaveLength(2);
    expect(SUBJECTS.siteMapPage!([other])).toEqual([]);
  });
});
