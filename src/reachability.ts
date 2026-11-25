// IS THIS URL A PAGE OF THE SITE? — the one question discovery has to ask before proposing it.
//
// A crawl follows links, and links rot. `pages discover` used to put every URL it walked into
// the sample, whatever the server answered: a dead link came back as a page named after the
// server's error page (« Error response »), a directory path as the static server's file
// listing, and `sample check` then pronounced the sample complete. The scan refuses those pages
// later (references/pages.md, rule 0), but by then they are declared pages, and a sample whose
// pages cannot be audited is not a sample.
//
// This module holds the decision both ends share: discovery (`pages discover`) and the scan
// (`scan --sample`) compare the requested address with the one reached by the SAME rule
// (`landedOnRequestedPage`), so the two cannot disagree about what « it moved » means.
// Zero dependencies: Node's global fetch.
import type { Lang } from "./types.js";

/** Did the browser (or fetch) end up on the page we ASKED for?
 *
 *  A sample page's declared id/name is the identity the report and the per-page grid speak,
 *  and it is applied to whatever the browser had on screen. So a route that redirects — an
 *  expired session bouncing to /login, a wizard step the application state does not open —
 *  gets recorded under the requested page's name while showing another screen entirely.
 *  Nothing about the resulting document looks wrong, which is what makes it the worst
 *  failure mode an accessibility report has: a reader sees a page sheet, a screenshot and a
 *  conformance rate, and none of it describes the page named at the top.
 *
 *  What counts as "the same page" is decided per component, because which component carries
 *  the route is the app's choice, not ours:
 *
 *  - **path** always, trailing slash folded (`/aide/` ≡ `/aide`). A server that answers
 *    `/documents` with a 301 to `/documents/` is canonicalising a directory, not sending the
 *    reader elsewhere — so it is FOLLOWED, and the caller records the LANDING address (the
 *    snapshot's url, the base its links resolve against), never the requested one.
 *  - **fragment** only when the REQUEST had one. That is the hash-router case, where the
 *    fragment IS the route: asking for `#/admin` and landing on `#/login` is precisely the
 *    bounce this guard exists to catch, and comparing paths alone (both empty) would miss it.
 *    When the request carried no fragment, one the app appended to its own route is noise.
 *  - **query** on the same rule, for `?page=admin` style routing.
 *  - **host** always, since a same-path bounce to an IdP or a maintenance host is exactly the
 *    misattribution above. Only the scheme, the port and a `www.` prefix may differ — those
 *    are canonicalisation, not another page.
 *
 *  `requested` must be the RESOLVED navigation target, not the raw config value: a relative
 *  `dist/index.html` becomes `file:///abs/dist/index.html` before `goto`, and comparing the
 *  two forms would drop every relative file target. Anything unparseable is treated as a
 *  match — this guard catches a redirect, it does not invent one. */
export function landedOnRequestedPage(requested: string, landed: string): boolean {
  if (!landed || requested === landed) return true;
  const parse = (u: string): URL | undefined => {
    try {
      return new URL(u, "http://x.invalid");
    } catch {
      return undefined;
    }
  };
  const a = parse(requested);
  const b = parse(landed);
  if (!a || !b) return true;

  const path = (u: URL): string => u.pathname.replace(/\/+$/, "");
  if (path(a) !== path(b)) return false;

  // `www.` is canonicalisation; a different host is a different site.
  const host = (u: URL): string => u.hostname.replace(/^www\./, "");
  if (host(a) !== host(b)) return false;

  // Only compared when the REQUEST carried one — see the doc block.
  if (a.hash && a.hash !== b.hash) return false;
  if (a.search && a.search !== b.search) return false;
  return true;
}

/** A static server's generated file listing — `python -m http.server` (« Directory listing
 *  for /documents/ »), Apache and nginx (« Index of /documents/ »), `serve` (« Files within
 *  documents/ »). It answers 200 and is a full document, so no status can tell it from a page;
 *  its title can, and it is never a page anyone designed. Read on the title alone: matching on
 *  the body would catch a real page that happens to list files. */
const LISTING_TITLE = /^\s*(?:directory listing for|index of|listing directory|files within)\s+\S/i;

export function looksLikeDirectoryListing(html: string): boolean {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return !!m && LISTING_TITLE.test(m[1]!);
}

/** What one GET of a discovered URL answered. `url` is the address the response came from
 *  after redirects (fetch follows them), `status` its HTTP status; both absent on a network
 *  error, which `error` then names. `html` is the body of a 2xx answer only — an error page's
 *  links are not the site's. */
export interface PageProbe {
  requested: string;
  url: string;
  status?: number;
  html: string;
  error?: string;
}

/** GET one URL, following redirects, and say what came back. Never throws. */
export async function probePage(url: string): Promise<PageProbe> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const ok = res.status >= 200 && res.status < 300;
    const html = ok ? await res.text() : "";
    if (!ok) await res.body?.cancel().catch(() => {});
    return { requested: url, url: res.url || url, status: res.status, html };
  } catch (e) {
    return { requested: url, url, html: "", error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
}

/** Why discovery left a URL out of the sample. Same vocabulary as the scan's refusals
 *  (ScanRedirect.reason), plus the listing, which only a title read can see. */
export type UnreachableReason = "http-status" | "redirect" | "error" | "directory-listing";

export interface Unreachable {
  url: string;
  reason: UnreachableReason;
  status?: number;
  landed?: string;
  detail?: string;
}

export type ProbeVerdict = { ok: true; url: string; status?: number } | ({ ok: false } & Unreachable);

/** A page of the site, or the reason it is not one.
 *
 *  - a network error, or any final status outside 2xx → refused, with the status;
 *  - a redirect to another page (`landedOnRequestedPage` false) → refused, with the landing
 *    address: the scan would refuse it too, and the page to declare is the one it lands on;
 *  - a directory listing → refused: a server artefact, not a page;
 *  - otherwise a page, at its LANDING address — a redirect that only adds or removes a trailing
 *    slash is followed, and the sample declares the address the server canonicalises to, so the
 *    scan opens it directly and its links resolve against the right base. */
export function classifyProbe(p: PageProbe): ProbeVerdict {
  if (p.status === undefined) return { ok: false, url: p.requested, reason: "error", ...(p.error ? { detail: p.error } : {}) };
  if (p.status < 200 || p.status >= 300) {
    return { ok: false, url: p.requested, reason: "http-status", status: p.status, ...(p.url !== p.requested ? { landed: p.url } : {}) };
  }
  if (!landedOnRequestedPage(p.requested, p.url)) return { ok: false, url: p.requested, reason: "redirect", status: p.status, landed: p.url };
  if (looksLikeDirectoryListing(p.html)) return { ok: false, url: p.requested, reason: "directory-listing", status: p.status };
  return { ok: true, url: p.url || p.requested, status: p.status };
}

/** One line naming a URL discovery left out, and why — French by default like every
 *  user-facing line, English on `--lang en`. */
export function describeUnreachable(u: Unreachable, lang: Lang): string {
  const fr = lang === "fr";
  switch (u.reason) {
    case "http-status":
      return fr ? `${u.url} a répondu HTTP ${u.status}` : `${u.url} answered HTTP ${u.status}`;
    case "redirect":
      return fr ? `${u.url} redirige vers ${u.landed} (une autre page)` : `${u.url} redirects to ${u.landed} (another page)`;
    case "directory-listing":
      return fr
        ? `${u.url} est un listing de répertoire généré par le serveur, pas une page du site`
        : `${u.url} is a directory listing generated by the server, not a page of the site`;
    default:
      return fr ? `${u.url} est injoignable${u.detail ? ` — ${u.detail}` : ""}` : `${u.url} is unreachable${u.detail ? ` — ${u.detail}` : ""}`;
  }
}
