// THE SCREEN-READER SIMULATION (#208).
//
// `scan` and `journey run` record the accessibility tree Chromium computed (`axtree.json`) and
// derive from it what a screen reader would announce (`sr.json`). This pins the pure half: the
// DOM walk that joins a tree node to its element by the same ordinal styles.json uses, the tree
// built from the DevTools protocol's flat node list, the announcements in reading order, and the
// evidence they become for RGAA 7.x and 11.x — on its element, or saying it could not be placed.
// The browser half runs for real in tests/full-audit.e2e.test.ts.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAdjudicationWorklist, captureFilesPresent } from "../src/adjudicate.js";
import { runAudit } from "../src/audit.js";
import { parseHtml } from "../src/parse/html.js";
import { SR_MAX_ENTRIES, announce, buildAxTree, ordinalsOf } from "../src/screen-reader.js";
import { PAGES_DIR, SNAPSHOT_VERSION, readSnapshot, writeSnapshot } from "../src/snapshot.js";
import type { AxNode } from "../src/types.js";

const DOM = `<html lang="fr"><head><title>Contact</title></head><body><main>
<h1>Nous contacter</h1>
<button type="button" id="menu" aria-expanded="false">Rubriques</button>
<form><label for="nom">Nom</label><input id="nom" required>
<input name="courriel" type="email">
<p id="statut" role="status">Envoyé</p></form>
</main></body></html>`;

const ordinal = (pick: (attribs: Record<string, string>, tag: string) => boolean): { i: number; tag: string } => {
  const doc = parseHtml(DOM, "x.html");
  const i = doc.elements.findIndex((e) => pick(e.attribs, e.tag));
  if (i < 0) throw new Error("no such element");
  return { i, tag: doc.elements[i]!.tag };
};

/** The tree a capture of DOM would record. */
function tree(): AxNode {
  return {
    role: "RootWebArea",
    name: "Contact",
    children: [
      {
        role: "main",
        ...ordinal((_, t) => t === "main"),
        children: [
          { role: "heading", name: "Nous contacter", level: 1, ...ordinal((_, t) => t === "h1"), children: [{ role: "StaticText", name: "Nous contacter" }] },
          {
            role: "button",
            name: "Rubriques",
            states: ["collapsed"],
            ...ordinal((a) => a.id === "menu"),
            children: [{ role: "StaticText", name: "Rubriques" }],
          },
          {
            role: "form",
            ...ordinal((_, t) => t === "form"),
            children: [
              { role: "StaticText", name: "Nom" },
              { role: "textbox", name: "Nom", states: ["required"], ...ordinal((a) => a.id === "nom") },
              { role: "textbox", value: "pas-une-adresse", states: ["invalid"], ...ordinal((a) => a.name === "courriel") },
              {
                role: "status",
                name: "",
                states: ["live=polite", "atomic"],
                ...ordinal((a) => a.id === "statut"),
                children: [{ role: "StaticText", name: "Envoyé" }],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("ordinalsOf mirrors ELEMENT_WALK on the DevTools DOM tree", () => {
  const el = (backendNodeId: number, localName: string, children: unknown[] = [], extra: object = {}) => ({
    nodeType: 1,
    localName,
    backendNodeId,
    children,
    ...extra,
  });
  it("numbers elements in pre-order from <html>, skips raw-text content and descends <template> content", () => {
    const root = {
      nodeType: 9,
      backendNodeId: 1,
      children: [
        { nodeType: 10, backendNodeId: 2 },
        el(3, "html", [
          el(4, "head", [el(5, "script", [el(99, "nextjs-portal")])]),
          el(6, "body", [el(7, "template", [], { templateContent: { nodeType: 11, backendNodeId: 8, children: [el(9, "p")] } }), el(10, "main")]),
        ]),
      ],
    };
    const map = ordinalsOf(root as never)!;
    expect([...map.entries()].map(([id, v]) => `${id}:${v.i}:${v.tag}`)).toEqual([
      "3:0:html",
      "4:1:head",
      "5:2:script",
      "6:3:body",
      "7:4:template",
      "9:5:p",
      "10:6:main",
    ]);
  });
  it("gives no ordinal at all once a <noscript> holds markup as text: the walk would drift", () => {
    const root = {
      nodeType: 9,
      backendNodeId: 1,
      children: [el(2, "html", [el(3, "body", [el(4, "noscript", [{ nodeType: 3, backendNodeId: 5, nodeValue: "<img src=x>" }])])])],
    };
    expect(ordinalsOf(root as never)).toBeUndefined();
  });
});

describe("buildAxTree keeps what a reader is told, joined to the DOM", () => {
  it("hoists ignored nodes and silent containers, keeps states, level, value and the element", () => {
    const nodes = [
      { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "Contact" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", parentId: "1", role: { value: "generic" }, name: { value: "" }, childIds: ["3", "4"], backendDOMNodeId: 10 },
      { nodeId: "3", parentId: "2", ignored: true, role: { value: "none" }, childIds: ["5"] },
      {
        nodeId: "4",
        parentId: "2",
        role: { value: "button" },
        name: { value: "Rubriques" },
        properties: [
          { name: "expanded", value: { value: true } },
          { name: "focusable", value: { value: true } },
          { name: "focused", value: { value: true } },
        ],
        backendDOMNodeId: 11,
      },
      {
        nodeId: "5",
        parentId: "3",
        role: { value: "textbox" },
        name: { value: "Courriel" },
        value: { value: "x" },
        properties: [
          { name: "required", value: { value: true } },
          { name: "invalid", value: { value: "true" } },
        ],
        backendDOMNodeId: 12,
      },
    ];
    const t = buildAxTree(nodes, new Map([[11, { i: 7, tag: "button" }]]))!;
    expect(t.role).toBe("RootWebArea");
    // The generic wrapper and the ignored node are gone; their children are the root's.
    expect(t.children?.map((c) => c.role)).toEqual(["textbox", "button"]);
    expect(t.children?.[0]).toEqual({ role: "textbox", name: "Courriel", value: "x", states: ["required", "invalid"] });
    // `focused` is where the capture's own focus was, never a property of the page.
    expect(t.children?.[1]).toEqual({ role: "button", name: "Rubriques", focusable: true, states: ["expanded"], i: 7, tag: "button" });
  });
});

describe("announce reads the tree out in reading order", () => {
  it("names role, name, value, states and description, and never repeats the text a name already carries", () => {
    const sr = announce(tree());
    expect(sr.entries.map((e) => e.text)).toEqual([
      "main",
      'heading level 1 "Nous contacter"',
      'button "Rubriques", collapsed',
      "form",
      '"Nom"',
      'textbox "Nom", required',
      'textbox = "pas-une-adresse", invalid',
      "status, live=polite, atomic",
      '"Envoyé"',
    ]);
    expect(sr.entries.find((e) => e.role === "button")).toMatchObject({ i: ordinal((a) => a.id === "menu").i, tag: "button" });
  });
  it("is bounded, and says so", () => {
    const wide: AxNode = { role: "RootWebArea", children: Array.from({ length: SR_MAX_ENTRIES + 10 }, (_, k) => ({ role: "link", name: `L${k}` })) };
    const sr = announce(wide);
    expect(sr.entries).toHaveLength(SR_MAX_ENTRIES);
    expect(sr.truncated).toBe(true);
  });
  it("announces nothing from no tree", () => {
    expect(announce(undefined)).toEqual({ v: 1, entries: [] });
  });
});

function capture(axtree?: AxNode): string {
  const root = mkdtempSync(join(tmpdir(), "u11y-sr-"));
  writeSnapshot(root, {
    meta: { v: SNAPSHOT_VERSION, id: "contact", name: "Contact", url: "https://exemple.test/contact" },
    dom: DOM,
    ...(axtree ? { axtree } : {}),
  });
  return root;
}

const evidenceOf = (root: string, id: string): string[] =>
  (buildAdjudicationWorklist(runAudit({ inputs: [join(root, PAGES_DIR)] }), { standard: "rgaa" }).find((i) => i.criteriaId === id)?.evidence ?? []).map(
    (e) => `${e.selector} :: ${e.note ?? ""}`,
  );

describe("sr.json is written beside the tree and reaches the criteria it informs", () => {
  it("is derived when the tree is written, read back, and named among the capture files", () => {
    const dir = join(capture(tree()), PAGES_DIR, "contact");
    expect(JSON.parse(readFileSync(join(dir, "sr.json"), "utf8")).entries).toHaveLength(9);
    expect(readSnapshot(dir)?.sr?.entries[2]?.text).toBe('button "Rubriques", collapsed');
    expect(captureFilesPresent([join(dir, "dom.html")])).toEqual(expect.arrayContaining(["axtree.json", "sr.json"]));
  });

  it("puts each form field's announcement on its element under 11.2, a nameless one said to have no name", () => {
    const ev = evidenceOf(capture(tree()), "11.2");
    expect(ev).toContain(
      'input#nom :: page="contact" a screen reader would announce (simulated from the captured accessibility tree): textbox "Nom", required',
    );
    expect(ev.some((e) => e.startsWith("input :: ") && e.endsWith('textbox = "pas-une-adresse", invalid — NO accessible name'))).toBe(true);
  });

  it("gives 7.1 the stateful widget and 7.5 the status, each with the page's coverage line", () => {
    const root = capture(tree());
    const w = evidenceOf(root, "7.1");
    expect(w.some((e) => e.startsWith("sr:widgets :: ") && /1 scripted widget or stateful control announced/.test(e))).toBe(true);
    expect(w.some((e) => e.startsWith("button#menu :: ") && e.endsWith('button "Rubriques", collapsed'))).toBe(true);
    const l = evidenceOf(root, "7.5");
    expect(l.some((e) => e.startsWith("p#statut :: ") && e.endsWith("status, live=polite, atomic — NO accessible name"))).toBe(true);
  });

  it("never places an announcement on the wrong element: a tag that does not match the ordinal is left unjoined", () => {
    const t = tree();
    const form = t.children![0]!.children![2]!;
    form.children![1] = { ...form.children![1]!, tag: "select" };
    const ev = evidenceOf(capture(t), "11.2");
    expect(ev.some((e) => e.startsWith("sr:textbox :: ") && e.endsWith("[not joined to an element of dom.html]"))).toBe(true);
  });

  it("adds nothing to a capture with no tree, and an absent tree keeps an empty form scope NA-able", () => {
    const root = capture();
    expect(evidenceOf(root, "7.1").some((e) => e.startsWith("sr:"))).toBe(false);
  });
});
