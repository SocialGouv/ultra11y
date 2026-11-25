// THE THEME — the one place the HTML tier's look is decided.
//
// Every HTML surface (the report's `index.html`, its composite, its page sheets, and the
// pages `ultra11y serve` renders or exports) is drawn by src/html.ts from a structural `Doc`,
// then dressed by ONE stylesheet. It lives here, apart from the renderer, so the look can be
// swapped — a different `Theme` passed to `renderHtmlDocument` — without touching the markup
// that carries the accessibility guarantees (landmarks, captions, `scope`, status letters).
//
// The default is deliberately NEUTRAL: system fonts, a small palette, no third-party design
// system. A State design system (DSFR) would be the natural candidate for a swap, and is
// blocked on its licensing (#212) — which is precisely why the stylesheet is isolated.
//
// A theme replaces the CSS only. It must keep every status distinguishable WITHOUT colour (the
// letters do that, in the markup) and keep the contrast of its own palette at AA in both
// colour schemes — a report whose own page fails 1.4.3 has no standing.

/** A named stylesheet for the HTML tier. */
export interface Theme {
  name: string;
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
