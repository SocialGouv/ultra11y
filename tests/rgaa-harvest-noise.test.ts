// WHAT THE ADJUDICATOR IS SHOWN SHOULD BE ABOUT THE CRITERION (issue #65, documentation-site run).
//
// Heuristic subjects read the page's PROSE as if it were code: a table cell quoting the RGAA
// 4.10 title became « moving/auto-updating content » for theme 4 and 13.8; the brand link to
// `index.html` became the site map of 12.1/12.3; 1.2 and 1.9 were handed every ARIA attribute
// of the page beside its images. And two criteria inherited a subject from their WCAG mapping
// that is not theirs, so its absence closed them over content they are about: 4.7 (a video,
// no image) and 13.5/13.6 (an emoticon, no image).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { harvestSubjects, subjectsForPackCriterion } from "../src/adjudicate-subjects.js";
import { runAudit } from "../src/audit.js";
import { parseHtml } from "../src/parse/html.js";
import { derivePackResults, loadPack } from "../src/standards/index.js";

const root = mkdtempSync(join(tmpdir(), "u11y-noise-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const page = (body: string) => `<!doctype html><html lang="fr"><head><title>T</title></head><body><main><h1>H</h1>${body}</main></body></html>`;
const harvest = (id: string, body: string) => {
  const pc = loadPack("rgaa").criteria.find((c) => c.id === id)!;
  return harvestSubjects(subjectsForPackCriterion("rgaa", id, pc.wcag), [parseHtml(page(body), "p.html")]);
};
let n = 0;
const rgaa = (body: string, id: string) => {
  const f = join(root, `p${n++}.html`);
  writeFileSync(f, page(body));
  return derivePackResults(runAudit({ inputs: [f] }), "rgaa").find((r) => r.id === id)!;
};

describe("heuristic subjects read code, not prose", () => {
  it("a sentence about carousels is not moving content; a carousel script is", () => {
    const prose = harvest("13.8", "<table><caption>Critères</caption><tr><td>Chaque carousel ou contenu en autoplay est-il contrôlable ?</td></tr></table>");
    expect(prose.some((x) => x.cls.startsWith("motion|"))).toBe(false);
    const code = harvest("13.8", '<div class="carousel" id="c">1/3</div><script>setInterval(next, 3000); startCarousel();</script>');
    expect(code.some((x) => x.cls.startsWith("motion|"))).toBe(true);
  });

  it("a sentence about flashes is not a flash mechanism", () => {
    const prose = harvest("13.7", "<p>Les effets de flash sont-ils correctement utilisés ?</p>");
    expect(prose.some((x) => x.cls.startsWith("flash-code|"))).toBe(false);
  });

  it("the brand link to index.html is not a site map; « Plan du site » is", () => {
    expect(harvest("12.1", '<a class="brand" href="index.html">ultra11y</a>').some((x) => x.cls.startsWith("sitemap|"))).toBe(false);
    expect(harvest("12.1", '<a href="/plan.html">Plan du site</a>').some((x) => x.cls.startsWith("sitemap|"))).toBe(true);
  });

  it("1.2 and 1.9 are shown images, not the page's ARIA", () => {
    const body = '<nav aria-label="Principale"><a href="/">A</a></nav><button aria-pressed="false">Thème</button><img src="d.png" alt="">';
    for (const id of ["1.2", "1.9"])
      expect(
        harvest(id, body).every((x) => x.cls.startsWith("image|")),
        id,
      ).toBe(true);
  });

  it("an animated GIF is moving content (13.8)", () => {
    expect(harvest("13.8", '<img src="anim.gif" alt="Chargement">').some((x) => x.cls.startsWith("gif|"))).toBe(true);
  });
});

describe("a criterion is not closed by the absence of a subject that is not its own", () => {
  it("4.7 — a page with a video and no image has a medium to identify", () => {
    const r = rgaa('<video src="intro.mp4" controls></video>', "4.7");
    expect(r.inapplicable ?? false).toBe(false);
  });

  it("4.1 — a YouTube player is shown to the transcript criterion", () => {
    expect(harvest("4.1", '<iframe src="https://www.youtube.com/embed/abc" title="Présentation"></iframe>').some((x) => x.cls.startsWith("tmedia|"))).toBe(
      true,
    );
  });

  it("13.5/13.6 — a page with an emoticon and no image has cryptic content to judge", () => {
    for (const id of ["13.5", "13.6"]) expect(rgaa("<p>Inscrivez-vous vite ¯\\_(ツ)_/¯</p>", id).inapplicable ?? false, id).toBe(false);
  });
});
