import { isLinkableUrl } from "./util.js";

// MARKDOWN-SAFE TEXT — because a report about HTML has to be able to SAY "h1".
//
// The message catalogue names elements the way a developer reads them: `<h1>`, `<button>`,
// `<th>`, `<dl>`. Rendered into Markdown that is HTML, and GitHub renders it as HTML: the tag
// is parsed and vanishes. Measured on a real pull-request comment, the recommendation
//
//     Recommandation : plusieurs <h1> dans la page (2). […] mais « un seul <h1> par page »
//     n'est une règle ni en HTML, ni en accessibilité, ni en SEO.
//
// reached its reader as « Recommandation : plusieurs / dans la page (2) […] mais « un seul  par
// page » » — a sentence about a tag, with the tag removed, twice. The same happened to every
// constat naming an element: « Limite du composant  non perceptible ».
//
// The fix belongs at the RENDERING boundary, not in the catalogue. The same strings go to a
// terminal (where `<h1>` is exactly right), to SARIF (plain text), to a ticket and to HTML
// (which escapes on its own, src/html.ts). Only the Markdown surfaces need the tag put beyond
// the reach of the HTML parser, and a code span is how Markdown says "this is literal".
const CODE_SPAN = /`[^`]*`/g;
// A tag, as a message actually writes one: `<h1>`, `</canvas>`, `<input type=image>`,
// `<div role="img" aria-label="…">`. The name must follow `<` IMMEDIATELY, which is what keeps
// prose like "ratio < 3:1" and "a < b > c" untouched, and the `>` must be present, which keeps
// "x<y" untouched too.
// A doctype too: `<!DOCTYPE html>` is markup to a Markdown renderer, and a message about the
// missing doctype lost the very word it was about.
const TAG = /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>|<!DOCTYPE(?:\s[^<>]*)?>/gi;

/** One message, safe to drop into Markdown: every bare HTML tag becomes a code span.
 *
 *  Idempotent by construction — a tag already inside backticks is skipped, because the text is
 *  split on code spans first and only the gaps are rewritten. That matters: several callers
 *  compose (a message joined into a table cell, then into a details block), and double-wrapping
 *  would produce ``` ``<h1>`` ``` and render the backticks themselves. */
export function mdText(s: string): string {
  let out = "";
  let last = 0;
  CODE_SPAN.lastIndex = 0;
  for (let m = CODE_SPAN.exec(s); m; m = CODE_SPAN.exec(s)) {
    out += escapeTags(s.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + escapeTags(s.slice(last));
}

function escapeTags(s: string): string {
  return s.replace(TAG, (tag) => `\`${tag}\``);
}

/** A Markdown link whose text and destination survive whatever a page name or URL contains.
 *  The destination goes between angle brackets — CommonMark's form for one with spaces or
 *  parentheses — and the brackets that would close either half early are escaped. */
export function mdLink(text: string, url: string): string {
  const label = text.replace(/([\\[\]])/g, "\\$1");
  if (!isLinkableUrl(url)) return label;
  const dest = url.replace(/</g, "%3C").replace(/>/g, "%3E");
  return `[${label}](<${dest}>)`;
}
