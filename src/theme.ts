// THE THEME — the one place the HTML tier's look is decided.
//
// Every HTML surface (the report's `index.html`, its composite, its page sheets, and the
// pages `ultra11y serve` renders or exports) is drawn by src/html.ts from a structural `Doc`,
// then dressed by ONE stylesheet. It lives here, apart from the renderer, so the look can be
// swapped — a different `Theme` passed to `renderHtmlDocument` — without touching the markup
// that carries the accessibility guarantees (landmarks, captions, `scope`, status letters).
//
// The default is deliberately NEUTRAL: system fonts, a small palette, no third-party design
// system. The State design system (DSFR) is OPT-IN (`--theme dsfr`, #212) and is NEVER shipped
// by ultra11y: `@gouvfr/dsfr` is etalab-2.0 but carries binding terms of use (its
// doc/legal/cgu.md) — clause [14] reserves it to sites on `.gouv.fr` and forbids modifying its
// Fundamentals, clause [18] forbids any use that could be confused with an official service.
// So `loadDsfrTheme` reads the stylesheet from the AUDITED PROJECT's own installation — the
// project that accepted those terms (`.dsfr.yml`) — inlines its files byte for byte, and fails
// loudly when the package is absent. It never downloads, never falls back.
//
// A theme changes the look and the CLASS NAMES only (`markup`). It must keep every status
// distinguishable WITHOUT colour (the letters do that, in the markup) and keep the contrast of
// its own palette at AA — a report whose own page fails 1.4.3 has no standing. The structure
// that carries the accessibility guarantees (landmarks, captions, `scope`, one h1, skip link,
// `lang`) is the same in every theme: src/html.ts emits it, the theme does not.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import type { Lang } from "./types.js";

/** The themes the HTML tier knows. `neutral` is the default and needs nothing installed. */
export const THEME_NAMES = ["neutral", "dsfr"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

export const isThemeName = (v: unknown): v is ThemeName => typeof v === "string" && (THEME_NAMES as readonly string[]).includes(v);

/** A named stylesheet for the HTML tier. */
export interface Theme {
  name: ThemeName;
  /** The markup flavour src/html.ts emits. `dsfr` maps the same structure onto DSFR classes
   *  (fr-table, fr-badge, fr-callout…); the accessibility structure is identical in both. */
  markup: "neutral" | "dsfr";
  /** A print-only sheet, inlined into a `<style media="print">`. */
  printCss?: string;
  /** Inlined into each page's `<style>`: pages are opened from file:// and artifact viewers,
   *  so a linked stylesheet would be one more file that can go missing. */
  css: string;
}

/** The neutral stylesheet. Light and dark, and a print sheet that turns the document into
 *  something an auditor can hand to a client on paper.
 *
 *  The dark status colours are NOT the light ones: `#0a7d33`, `#b3261e` and `#b06000` measure
 *  3.50, 2.81 and 3.96 against `#141416`, all below AA. Measured with src/color.ts's own
 *  `contrastRatio` — an accessibility report whose own palette fails 1.4.3 has no standing. */
export const NEUTRAL_THEME: Theme = {
  name: "neutral",
  markup: "neutral",
  css: `
 :root { color-scheme: light dark; --bg:#fff; --fg:#111; --line:#e3e3e6; --mut:#666; --soft:#f6f6f8;
         --c:#0a7d33; --nc:#b3261e; --m:#b06000; --accent:#0b5fa5; }
 @media (prefers-color-scheme: dark) { :root { --bg:#141416; --fg:#f2f2f7; --line:#2c2c2e; --mut:#a1a1a6; --soft:#1c1c1f;
         --c:#3fbf6f; --nc:#ff6b5e; --m:#d99a2b; --accent:#6cb6ff; } }
 * { box-sizing:border-box; }
 body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif; }
 .skip { position:absolute; left:-9999px; top:0; padding:8px 14px; background:var(--bg); color:var(--fg); border:2px solid var(--accent); z-index:9; }
 .skip:focus { left:8px; top:8px; }
 .wrap { max-width:78ch; margin:0 auto; padding:32px 20px 64px; }
 header.top { border-bottom:1px solid var(--line); }
 h1 { font-size:26px; line-height:1.25; margin:0 0 6px; }
 h2 { font-size:20px; margin:36px 0 10px; padding-top:8px; border-top:1px solid var(--line); }
 h3 { font-size:17px; margin:26px 0 8px; }
 h4 { font-size:15px; margin:20px 0 6px; }
 p { margin:0 0 12px; } p.sub { color:var(--mut); margin:0 0 4px; }
 a { color:var(--accent); }
 a:focus-visible, summary:focus-visible { outline:3px solid var(--accent); outline-offset:2px; }
 nav.docs ul { list-style:none; display:flex; flex-wrap:wrap; gap:6px 16px; margin:12px 0 0; padding:0; }
 nav.docs [aria-current="page"] { font-weight:700; }
 code, .mono { font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
 ul.body { margin:0 0 12px; padding-left:22px; }
 .note { margin:0 0 14px; padding:10px 14px; border-left:4px solid var(--mut); background:var(--soft); }
 .note.warn { border-left-color:var(--m); }
 .tw { overflow-x:auto; margin:0 0 18px; }
 table { border-collapse:collapse; width:100%; font-size:14px; }
 caption { text-align:left; font-weight:600; padding:0 0 8px; }
 th, td { padding:6px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
 thead th { border-bottom:2px solid var(--line); background:var(--soft); }
 td.end, th.end { text-align:right; }
 tr.group th { background:var(--soft); font-weight:700; }
 .st { font-weight:700; }
 .st-c{color:var(--c)} .st-nc{color:var(--nc)} .st-na{color:var(--mut)} .st-m{color:var(--m)}
 figure { margin:0 0 18px; }
 figure img { max-width:100%; height:auto; border:1px solid var(--line); }
 figcaption { color:var(--mut); font-size:13px; margin-top:6px; }
 details { margin:0 0 14px; border:1px solid var(--line); padding:8px 12px; }
 summary { cursor:pointer; font-weight:600; }
 footer.bot { margin-top:48px; padding-top:12px; border-top:1px solid var(--line); color:var(--mut); font-size:13px; }
 @media print {
   :root { --bg:#fff; --fg:#000; --line:#bbb; --mut:#444; --soft:#f2f2f2; --c:#0a7d33; --nc:#b3261e; --m:#8a4b00; --accent:#00449e; }
   .skip, nav.docs { display:none; }
   .wrap { max-width:none; padding:0; }
   body { font-size:11pt; }
   /* One criterion per block, never split across a page break — the whole point of a
      printable deliverable is that a finding and its evidence stay on the same sheet. */
   h2, h3 { break-after:avoid-page; page-break-after:avoid; }
   figure, table, .note, details { break-inside:avoid-page; page-break-inside:avoid; }
   details { border:0; padding:0; } details > summary { list-style:none; }
   /* A collapsed section would print as a title with nothing under it. */
   details[open], details:not([open]) > *:not(summary) { display:revert; }
   figure img { max-width:16cm; }
   a { color:inherit; text-decoration:underline; }
 }`,
};

/** ultra11y's OWN additions to the DSFR theme, appended after the project's DSFR stylesheet and
 *  kept apart from it: the DSFR files themselves are inlined unmodified (CGU clause [14]). Only
 *  what DSFR has no class for — a table's group row, the current document in the navigation,
 *  the native `<details>` (DSFR's accordion needs its JavaScript, and this page carries none)
 *  and the print rules that keep a finding with its evidence. Colours come from DSFR's own
 *  tokens, so the contrast stays the one DSFR guarantees. */
const DSFR_COMPANION_CSS = `
 .fr-table tr.u11y-group th { background:var(--background-alt-grey); font-weight:700; }
 .u11y-docs [aria-current="page"] { font-weight:700; }
 .u11y-details { margin:0 0 1.5rem; border:1px solid var(--border-default-grey); padding:.5rem 1rem; }
 .u11y-details > summary { cursor:pointer; font-weight:700; }
 .fr-content-media img { max-width:100%; height:auto; border:1px solid var(--border-default-grey); }
 code { overflow-wrap:anywhere; }
 @media print {
   .fr-skiplinks, .u11y-docs { display:none; }
   h2, h3 { break-after:avoid-page; page-break-after:avoid; }
   figure, table, .fr-callout, .fr-alert, details { break-inside:avoid-page; page-break-inside:avoid; }
   details[open], details:not([open]) > *:not(summary) { display:revert; }
 }`;

/** Raised when `--theme dsfr` cannot use the DSFR of the audited project. Its message is meant
 *  for the person running the command, in their language. */
export class DsfrUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DsfrUnavailableError";
  }
}

const DSFR_PACKAGE = "@gouvfr/dsfr";
/** The official full bundle (core + every component + utilities) and its print sheet — the two
 *  files DSFR's own documentation tells a site to link. Taken whole: trimming them down to the
 *  components this page uses would be modifying the package's files. */
const DSFR_CSS = "dist/dsfr.min.css";
const DSFR_PRINT_CSS = "dist/dsfr.print.min.css";

function dsfrMessage(lang: Lang, root: string, detail: string): string {
  return lang === "fr"
    ? `ultra11y : le thème « dsfr » charge le Système de design de l'État (${DSFR_PACKAGE}) depuis l'installation du projet audité, et ${detail} (racine du projet : ${root}). ` +
        "ultra11y ne fournit pas le DSFR et ne le télécharge jamais : ses conditions d'utilisation (doc/legal/cgu.md du paquet) en réservent l'usage aux sites en .gouv.fr, " +
        "interdisent d'en modifier les Fondamentaux et toute confusion avec un service officiel. " +
        `Si votre site y a droit, installez-le dans le projet (\`npm install ${DSFR_PACKAGE}\`, qui demande d'accepter ces conditions dans un fichier .dsfr.yml), ` +
        "puis relancez depuis sa racine ou avec --root <projet>. Sinon, gardez le thème par défaut (--theme neutral)."
    : `ultra11y: the "dsfr" theme loads the French State design system (${DSFR_PACKAGE}) from the audited project's own installation, and ${detail} (project root: ${root}). ` +
        "ultra11y does not ship the DSFR and never downloads it: its terms of use (the package's doc/legal/cgu.md) reserve it to .gouv.fr websites, " +
        "forbid modifying its Fundamentals and any confusion with an official service. " +
        `If your site is entitled to it, install it in the project (\`npm install ${DSFR_PACKAGE}\`, which asks you to accept those terms in a .dsfr.yml file), ` +
        "then run again from its root or with --root <project>. Otherwise keep the default theme (--theme neutral).";
}

/** Where the project's DSFR lives, resolved exactly as the project's own code would resolve
 *  it — Node's module resolution from `<root>/package.json` — so npm, pnpm (symlinked) and
 *  hoisted workspaces all work. ultra11y's own dependencies are never consulted. */
export function resolveDsfrDir(root: string): string | undefined {
  try {
    const req = createRequire(join(resolve(root), "package.json"));
    return dirname(req.resolve(`${DSFR_PACKAGE}/package.json`));
  } catch {
    return undefined;
  }
}

/** The DSFR theme, built from the project's installed `@gouvfr/dsfr`. Throws
 *  `DsfrUnavailableError` — never a silent fallback to the neutral look — when the package is
 *  absent or its bundle is not where DSFR publishes it. */
export function loadDsfrTheme(root: string, lang: Lang = "fr"): Theme {
  const abs = resolve(root);
  const fail = (fr: string, en: string): DsfrUnavailableError => new DsfrUnavailableError(dsfrMessage(lang, abs, lang === "fr" ? fr : en));
  const dir = resolveDsfrDir(abs);
  if (!dir) throw fail(`${DSFR_PACKAGE} y est introuvable`, `${DSFR_PACKAGE} cannot be found there`);
  let name: unknown;
  try {
    name = (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: unknown }).name;
  } catch {
    name = undefined;
  }
  if (name !== DSFR_PACKAGE) throw fail(`${dir} n'est pas le paquet ${DSFR_PACKAGE}`, `${dir} is not the ${DSFR_PACKAGE} package`);
  const cssPath = join(dir, DSFR_CSS);
  if (!existsSync(cssPath)) throw fail(`son fichier ${DSFR_CSS} est absent (${cssPath})`, `its ${DSFR_CSS} is missing (${cssPath})`);
  const css = readFileSync(cssPath, "utf8");
  const printPath = join(dir, DSFR_PRINT_CSS);
  const printCss = existsSync(printPath) ? readFileSync(printPath, "utf8") : undefined;
  // Inlined into a <style>: a stylesheet that could close the element would inject markup. The
  // files are never edited to make them fit (clause [14]) — such a file is refused instead.
  for (const [p, text] of [
    [cssPath, css],
    [printPath, printCss ?? ""],
  ] as const) {
    if (/<\/style/i.test(text))
      throw fail(`${p} contient « </style » et ne peut pas être inclus tel quel`, `${p} contains "</style" and cannot be inlined as is`);
  }
  return { name: "dsfr", markup: "dsfr", css: `${css}\n${DSFR_COMPANION_CSS}`, ...(printCss ? { printCss } : {}) };
}

/** The theme a command renders with: `neutral` needs nothing; `dsfr` reads the project at `root`. */
export function resolveTheme(name: ThemeName, root: string, lang: Lang = "fr"): Theme {
  return name === "dsfr" ? loadDsfrTheme(root, lang) : NEUTRAL_THEME;
}
