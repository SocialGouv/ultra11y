// ANNEX I, THE APPLICATION MAP (#208): every page and page state the audit read, where it comes
// from, which instrument saw it and what it recorded; the rendered units by route; and per
// evidence source, what this audit saw of it and the criteria it can reach. It states facts and
// decides nothing — so it must exist only when there is something to map, and never invent a
// capture a page does not have.
import { describe, expect, it } from "vitest";

import { renderAppMap } from "../src/app-map.js";
import type { AuditResult } from "../src/types.js";

function audit(): AuditResult {
  return {
    scope: {
      inputs: ["."],
      files: 12,
      pages: [
        { id: "contact", name: "Contact", url: "https://x.test/contact", basis: "snapshot" },
        { id: "contact-01-click-button-envoyer", name: "Contact — envoi", url: "https://x.test/contact", basis: "snapshot" },
        { id: "aide", name: "Aide", url: "https://x.test/aide", basis: "attributed" },
      ],
      pageCoverage: {
        contact: { dom: true, axe: true, scs: ["1.4.4", "1.4.10"], captures: ["axe.json", "probes.json", "sr.json", "axtree.json", "media.json"] },
        "contact-01-click-button-envoyer": { dom: true, axe: true, captures: ["sr.json"] },
      },
      routes: [
        { path: "/contact", url: "https://x.test/contact", sample: true, observed: "scanned", page: "contact" },
        { path: "/aide", url: "https://x.test/aide", sample: false, observed: "source", page: "aide" },
      ],
      journeys: {
        manifest: ".ultra11y/journey-runs.json",
        journeys: [
          {
            name: "contact",
            file: ".ultra11y/journeys/contact.json",
            keyboard: true,
            status: "done",
            steps: [{ n: 1, action: "click", label: 'click button "Envoyer"', status: "done", page: "contact-01-click-button-envoyer" }],
          },
        ],
      },
      renders: {
        manifest: ".ultra11y/render.json",
        rendered: 2,
        skipped: 1,
        notAttempted: 0,
        units: [
          { id: "a", file: "src/Button.tsx", export: "default", component: "Button", kind: "component", status: "rendered" },
          { id: "b", file: "app/contact/page.tsx", export: "default", component: "ContactPage", kind: "page", route: "/contact", status: "rendered" },
          { id: "c", file: "src/Map.tsx", export: "default", component: "Map", kind: "component", status: "skipped", reason: "browser-api" },
        ],
      },
    },
  } as unknown as AuditResult;
}

describe("renderAppMap", () => {
  const md = renderAppMap(audit(), "rgaa", [{ id: "13.7", status: "NA", decidedBy: "agent" }], "fr").join("\n");

  it("lists every page and state with its origin, its instrument and what it recorded", () => {
    expect(md).toMatch(/^## I\. Carte de l'application — ce qui a été vu, et comment$/m);
    expect(md).toContain(
      "| `contact` | `/contact` | route de l'échantillon | navigateur (scan) | DOM, axe-core, sondes : 2 critère(s) WCAG mesuré(s), arbre d'accessibilité, lecteur d'écran simulé, médias et flashs |",
    );
    expect(md).toContain(
      '| `contact-01-click-button-envoyer` | `https://x.test/contact` | parcours **contact**, étape 1 : click button "Envoyer" | navigateur (journey run) | DOM, lecteur d\'écran simulé |',
    );
    // A page only source findings were mapped onto was seen by no browser, and records nothing.
    expect(md).toContain("| `aide` | `/aide` | route hors échantillon | code source seulement | — |");
  });

  it("groups the rendered units by route, never a unit that did not render", () => {
    expect(md).toContain("| `/contact` | ContactPage (`app/contact/page.tsx`) |");
    expect(md).toContain("| composants isolés | Button (`src/Button.tsx`) |");
    expect(md).not.toContain("Map (");
  });

  it("names, per evidence source, what this audit saw and the criteria it reaches, with how many are decided", () => {
    expect(md).toMatch(/^\| Statique \(code source, `audit`\) \| 12 fichier\(s\) lu\(s\) \| `1\.1` · /m);
    expect(md).toMatch(
      /^\| Navigateur \(`scan`, `journey run`\) \| 2 page\(s\) et état\(s\) mesuré\(s\) par axe-core, dont 1 état\(s\) de parcours \| .*`13\.7`.* \| 1 \/ \d+ \|$/m,
    );
    expect(md).toMatch(/^\| Jugement \(`verify --manual`\) \| 1 critère\(s\) tranché\(s\) par l'adjudicateur \|/m);
  });

  it("writes nothing when the audit read no page and knows no route", () => {
    expect(renderAppMap({ scope: { inputs: [], files: 3 } } as unknown as AuditResult, "rgaa", [], "fr")).toEqual([]);
  });

  it("speaks English too", () => {
    expect(renderAppMap(audit(), "rgaa", [], "en").join("\n")).toMatch(/^## I\. Application map — what was seen, and how$/m);
  });
});
