// How the visual snapshots of the render engine's captures (src/render-snapshot.ts) reach the
// reader: a subsection of the technical annex's render table (Markdown), and a section of the
// HTML composite. Both read `scope.renders.snapshots` and nothing else.
//
// The reader looks at the RENDERING of each component, not its JSX — and is told, every time,
// what that rendering is: an isolated component render, with or without the project's CSS,
// whose axe observations are to confirm on the real page and decide no verdict.
//
// Worklist-inert and criterion-free, like the render table it follows: no checkbox, no
// criterion number (an RGAA deliverable must not cite WCAG success criteria where it cites none
// of its own), so `check` reads nothing into it.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { Block, Run } from "./html.js";
import type { AuditResult, Lang, RenderSnapshotIndex, RenderSnapshotUnit } from "./types.js";

/** Observations listed per component before the rest is summarized. */
const PER_UNIT_MAX = 8;

const L = {
  fr: {
    title: "Rendus visuels des composants (rendu isolé)",
    htmlTitle: "Composants rendus — instantanés visuels",
    intro: (n: number, browser: string) =>
      `Chaque capture du moteur de rendu a été ouverte dans un navigateur${browser ? ` (${browser})` : ""} : ${n} instantané(s), avec une capture d'écran et une passe axe-core. Ce sont des RENDUS ISOLÉS — le composant seul, sans props, sans fournisseur de contexte, hors de la page qui le monte. Ce qu'axe y observe est à confirmer sur la page réelle : aucune de ces observations ne fonde un verdict, et leur absence ne prouve aucune conformité.`,
    styles: {
      project: (n: number) => `Styles : le CSS global du projet (${n} feuille(s) chargée(s)).`,
      partial: (n: number, k: number) =>
        `Styles : une PARTIE du CSS du projet seulement (${n} feuille(s) chargée(s), ${k} écartée(s)). Les règles qui dépendent du style (contraste, taille des cibles…) sont écartées.`,
      none: () =>
        "Styles : AUCUN — pas de feuille de style globale trouvée dans le projet. Les captures d'écran montrent les styles par défaut du navigateur, pas le produit ; leurs contrastes ne sont pas une preuve et les règles qui dépendent du style sont écartées.",
    } as Record<string, (n: number, k: number) => string>,
    skippedReason: {
      "tailwind-source": "source Tailwind non compilée",
      preprocessor: "source Sass/Less non compilée",
      unresolved: "introuvable",
      unreadable: "illisible",
    } as Record<string, string>,
    skippedList: (items: string) => `Feuilles écartées : ${items}.`,
    unavailable: (why: string) =>
      `Instantanés visuels non pris : pas de navigateur disponible (${why}). Les captures HTML statiques ont été auditées comme d'habitude ; installez Chromium pour Playwright puis relancez \`ultra11y render\` pour voir les rendus.`,
    noUnits: "Aucune capture à ouvrir.",
    failed: (why: string) => `Instantané en échec : ${why}`,
    observations: (n: number) => `${n} observation(s) axe sur ce rendu isolé, à confirmer sur la page réelle :`,
    noObservation: "Aucune observation axe retenue sur ce rendu isolé (ce qui ne prouve rien pour la page réelle).",
    setAside: (page: number, style: number) =>
      [
        page ? `${page} écartée(s) car propre(s) à une page entière (repères, titre, langue, ordre des titres…)` : "",
        style ? `${style} écartée(s) faute du CSS complet (contraste, taille des cibles…)` : "",
      ]
        .filter(Boolean)
        .join(" ; "),
    advisory: "bonne pratique",
    more: (n: number) => `… et ${n} autre(s) — voir \`.ultra11y/render-snapshots/index.json\`.`,
    alt: (name: string, styled: boolean) => `Rendu isolé du composant ${name}${styled ? "" : ", sans le CSS du projet"}`,
    caption: (styled: boolean) => (styled ? "Rendu isolé, avec le CSS du projet" : "Rendu isolé, SANS le CSS du projet (styles par défaut du navigateur)"),
    linked: (n: number) => `${n} image(s) dépassent le budget d'inclusion : elles sont liées depuis \`assets/components/\` au lieu d'être incluses.`,
    kind: { component: "composant", page: "page", story: "story" } as Record<string, string>,
  },
  en: {
    title: "Visual renders of the components (isolated render)",
    htmlTitle: "Rendered components — visual snapshots",
    intro: (n: number, browser: string) =>
      `Each capture of the render engine was opened in a browser${browser ? ` (${browser})` : ""}: ${n} snapshot(s), with a screenshot and an axe-core pass. These are ISOLATED RENDERS — the component alone, with no props, no context provider, outside the page that mounts it. What axe observes on them is to confirm on the real page: none of these observations decides a verdict, and their absence proves no conformity.`,
    styles: {
      project: (n: number) => `Styles: the project's global CSS (${n} stylesheet(s) loaded).`,
      partial: (n: number, k: number) =>
        `Styles: only PART of the project's CSS (${n} stylesheet(s) loaded, ${k} left out). Style-dependent rules (contrast, target size…) are set aside.`,
      none: () =>
        "Styles: NONE — no global stylesheet was found in the project. The screenshots show the browser's default styles, not the product; their contrast is no evidence and style-dependent rules are set aside.",
    } as Record<string, (n: number, k: number) => string>,
    skippedReason: {
      "tailwind-source": "uncompiled Tailwind source",
      preprocessor: "uncompiled Sass/Less source",
      unresolved: "not found",
      unreadable: "unreadable",
    } as Record<string, string>,
    skippedList: (items: string) => `Stylesheets left out: ${items}.`,
    unavailable: (why: string) =>
      `Visual snapshots not taken: no browser available (${why}). The static HTML captures were audited as usual; install Chromium for Playwright and re-run \`ultra11y render\` to see the renders.`,
    noUnits: "No capture to open.",
    failed: (why: string) => `Snapshot failed: ${why}`,
    observations: (n: number) => `${n} axe observation(s) on this isolated render, to confirm on the real page:`,
    noObservation: "No axe observation kept on this isolated render (which proves nothing about the real page).",
    setAside: (page: number, style: number) =>
      [
        page ? `${page} set aside as whole-page rules (landmarks, title, language, heading order…)` : "",
        style ? `${style} set aside for want of the full CSS (contrast, target size…)` : "",
      ]
        .filter(Boolean)
        .join("; "),
    advisory: "best practice",
    more: (n: number) => `… and ${n} more — see \`.ultra11y/render-snapshots/index.json\`.`,
    alt: (name: string, styled: boolean) => `Isolated render of the ${name} component${styled ? "" : ", without the project's CSS"}`,
    caption: (styled: boolean) => (styled ? "Isolated render, with the project's CSS" : "Isolated render, WITHOUT the project's CSS (browser default styles)"),
    linked: (n: number) => `${n} image(s) exceed the inline budget: they are linked from \`assets/components/\` instead of embedded.`,
    kind: { component: "component", page: "page", story: "story" } as Record<string, string>,
  },
} as const;

const styled = (idx: RenderSnapshotIndex): boolean => idx.styles.status !== "none";

function unitLabel(u: RenderSnapshotUnit, lang: Lang): string {
  const name = u.kind === "story" ? `${u.component} · ${u.export}` : u.component;
  return `${name} (${L[lang].kind[u.kind] ?? u.kind})`;
}

/** Units with something to confirm first, then the rest, then the failures. */
function ordered(idx: RenderSnapshotIndex): RenderSnapshotUnit[] {
  const counted = (u: RenderSnapshotUnit) => u.violations.filter((v) => v.counted).length;
  const rank = (u: RenderSnapshotUnit) => (u.status === "failed" ? 2 : counted(u) ? 0 : 1);
  return [...idx.units].sort((a, b) => rank(a) - rank(b) || counted(b) - counted(a) || a.file.localeCompare(b.file) || a.export.localeCompare(b.export));
}

/** The prose that frames every view of the snapshots: what they are, with which styles. */
function framing(idx: RenderSnapshotIndex, lang: Lang): string[] {
  const s = L[lang];
  const done = idx.units.filter((u) => u.status === "snapshotted").length;
  const out = [s.intro(done, idx.browser ?? ""), (s.styles[idx.styles.status] ?? s.styles.none!)(idx.styles.files.length, idx.styles.skipped.length)];
  if (idx.styles.skipped.length) out.push(s.skippedList(idx.styles.skipped.map((k) => `\`${k.file}\` (${s.skippedReason[k.reason] ?? k.reason})`).join(", ")));
  return out;
}

function observationLines(u: RenderSnapshotUnit, lang: Lang): { head: string; items: string[]; tail: string[] } {
  const s = L[lang];
  const kept = u.violations.filter((v) => v.counted);
  const page = u.violations.filter((v) => v.setAside === "page-context").length;
  const style = u.violations.filter((v) => v.setAside === "styles").length;
  const items = kept
    .slice(0, PER_UNIT_MAX)
    .map(
      (v) =>
        `${v.help} (axe${lang === "fr" ? " " : ""}: ${v.rule}${v.impact ? `, ${v.impact}` : ""}${v.advisory ? `, ${s.advisory}` : ""}) — ${v.nodes} ${lang === "fr" ? "nœud(s)" : "node(s)"}`,
    );
  const tail: string[] = [];
  if (kept.length > PER_UNIT_MAX) tail.push(s.more(kept.length - PER_UNIT_MAX));
  const aside = s.setAside(page, style);
  if (aside) tail.push(aside);
  return { head: kept.length ? s.observations(kept.length) : s.noObservation, items, tail };
}

/** The annex subsection, under the render table. `outDir` set ⇒ each PNG is copied to
 *  `<outDir>/assets/components/<id>.png` so the report directory travels intact, exactly as
 *  the page screenshots are copied to `assets/<id>.png`. */
export function renderSnapshotAnnex(idx: RenderSnapshotIndex, lang: Lang, outDir?: string): string[] {
  const s = L[lang];
  const cell = (t: string) => t.replace(/\n/g, " ");
  const out = [`### ${s.title}`, ""];
  if (idx.unavailable) {
    out.push(`> ${s.unavailable(cell(idx.unavailable))}`, "");
    return out;
  }
  if (!idx.units.length) {
    out.push(s.noUnits, "");
    return out;
  }
  for (const p of framing(idx, lang)) out.push(`> ${p}`, ">");
  out.pop();
  out.push("");
  for (const u of ordered(idx)) {
    out.push("<details>", `<summary>${cell(unitLabel(u, lang))} — <code>${cell(u.file)}</code></summary>`, "");
    if (u.status === "failed") {
      out.push(`_${s.failed(cell(u.error ?? "?"))}_`, "", "</details>", "");
      continue;
    }
    if (u.screenshot && existsSync(u.screenshot)) {
      let href = relative(outDir ?? ".", u.screenshot)
        .split("\\")
        .join("/");
      if (outDir) {
        try {
          mkdirSync(join(outDir, "assets", "components"), { recursive: true });
          copyFileSync(u.screenshot, join(outDir, "assets", "components", `${u.id}.png`));
          href = `./assets/components/${u.id}.png`;
        } catch {
          // Unwritable output dir: keep the relative reference rather than lose the image.
        }
      }
      out.push(`![${s.alt(unitLabel(u, lang), styled(idx))}](${href})`, "", `_${s.caption(styled(idx))}_`, "");
    }
    const o = observationLines(u, lang);
    out.push(o.head);
    if (o.items.length) out.push("", ...o.items.map((i) => `- ${cell(i)}`));
    for (const t of o.tail) out.push("", `_${t}_`);
    out.push("", "</details>", "");
  }
  return out;
}

/** What the HTML composite needs to show a unit's PNG: a data: URI, or a file reference. */
export type SnapshotHref = (u: RenderSnapshotUnit) => string | undefined;

/** The HTML composite's section. Empty when the audit carries no snapshot index. */
export function renderSnapshotBlocks(result: AuditResult, lang: Lang, hrefOf: SnapshotHref, linkedCount = 0): Block[] {
  const idx = result.scope.renders?.snapshots;
  if (!idx) return [];
  const s = L[lang];
  const ticks = (text: string): Run[] => text.split(/`([^`]+)`/).map((t, i) => (i % 2 ? { text: t, mono: true } : { text: t }));
  const blocks: Block[] = [{ kind: "heading", level: 2, text: s.htmlTitle, id: "component-renders" }];
  if (idx.unavailable) return [...blocks, { kind: "note", tone: "warn", runs: ticks(s.unavailable(idx.unavailable)) }];
  if (!idx.units.length) return [...blocks, { kind: "para", runs: [{ text: s.noUnits }] }];
  const [intro, ...rest] = framing(idx, lang);
  blocks.push({ kind: "note", tone: "info", runs: ticks(intro ?? "") });
  for (const p of rest) blocks.push({ kind: "note", tone: idx.styles.status === "project" ? "info" : "warn", runs: ticks(p) });
  if (linkedCount) blocks.push({ kind: "note", tone: "info", runs: ticks(s.linked(linkedCount)) });
  for (const u of ordered(idx)) {
    const inner: Block[] = [{ kind: "para", runs: [{ text: u.file, mono: true }] }];
    if (u.status === "failed") inner.push({ kind: "para", runs: [{ text: s.failed(u.error ?? "?"), em: true }] });
    else {
      const src = hrefOf(u);
      if (src) inner.push({ kind: "figure", src, alt: s.alt(unitLabel(u, lang), styled(idx)), caption: s.caption(styled(idx)) });
      const o = observationLines(u, lang);
      inner.push({ kind: "para", runs: [{ text: o.head }] });
      if (o.items.length) inner.push({ kind: "list", items: o.items.map((i) => ticks(i)) });
      for (const t of o.tail) inner.push({ kind: "para", runs: [...ticks(t).map((r) => ({ ...r, em: true }))] });
    }
    blocks.push({ kind: "details", summary: unitLabel(u, lang), blocks: inner });
  }
  return blocks;
}
