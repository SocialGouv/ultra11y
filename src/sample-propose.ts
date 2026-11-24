// A DETERMINISTIC page-sample proposal: the same site gives the same sample, whatever model or
// person runs the discovery.
//
// `pages discover` used to keep every discovered URL (hundreds on a real site) and leave the
// choice of the representative pages to whoever read the list. Two runs on the same site then
// audited different pages — 11 against 13, a different search query, a page only one of them
// sampled — and their verdicts could not be compared: a non-conformity existed only where one
// run happened to pick the page that carried it.
//
// The proposal is a pure function of the discovered pages (URL, title, HTML, snapshot skeleton):
//   1. every input is sorted first, so the order the crawl or the sitemap listed them in never
//      matters;
//   2. each required page kind of the standard (its sampleMethodology) is matched by keyword on
//      the URL path and the title, the shallowest match winning, ties broken by URL;
//   3. the search kind is reached through the site's own search form (or a discovered search
//      URL) with a FIXED query, so two runs search for the same thing;
//   4. the remaining pages are grouped into template clusters — the URL pattern with ids, slugs
//      and dates normalized, or the DOM-skeleton fingerprint when a snapshot gives one — and one
//      page per cluster is taken, the largest clusters first, ties broken by pattern then URL;
//   5. the size is bounded; the required kinds are never cut by the bound.
// Each pick carries its reason in `notes`, and a required kind nothing matched is written to
// `sample.absent` with the reason, so the omission is recorded rather than silent.
//
// Standard-agnostic: the kinds and their keywords come from the pack. Only the conventional
// ids are read for the three kinds that are not keyword lookups (search, documents, and the
// representative / transverse kinds), the same id test `lintSample` applies.
import { createHash } from "node:crypto";
import type { SampleAbsent, SampleConfig, SamplePage } from "./types.js";
import type { SampleMethodology, SampleRequiredKind } from "./standards/types.js";
import { isDownloadUrl, nameFromUrl } from "./crawl.js";
import { slugifyPageId } from "./snapshot.js";
import { ancestors, attr, descendants, parseHtml, type El, type HNode } from "./parse/html.js";
import { carryAbsent, isRepresentativeKind, isTransverseKind, keywordMatches, kindLabel, norm, safeDecode } from "./sample.js";

/** Default bound on the proposed sample: the required kinds plus a dozen templates is the size of
 *  an RGAA sample for most sites. `--sample-size` changes it. */
export const DEFAULT_SAMPLE_SIZE = 20;
/** The query the search kind is audited with. Fixed, so two runs audit the same results page;
 *  a common word most sites answer, and one that spells no required kind (a query of
 *  « accessibilite » made the search URL credit the accessibility-statement kind). */
export const FIXED_SEARCH_QUERY = "information";
/** Every note and every `absent` reason the proposal writes starts with this, which is how a
 *  re-run tells its own words from a human's. */
export const PROPOSAL_NOTE = "proposal: ";
/** Children of one parent path from which the last segment counts as a slug (`/actualites/a`,
 *  `/actualites/b`, `/actualites/c` → `/actualites/:slug`). Never applied at the root, where
 *  `/contact` and `/aide` are different pages, not three values of one parameter. */
export const SLUG_SIBLINGS = 3;

export interface ProposalInput {
  url: string;
  title?: string;
  /** The page's HTML, when it was fetched or snapshotted: read for its search form and the
   *  documents it links. */
  html?: string;
  /** A DOM-skeleton fingerprint (`skeletonOf`), when a snapshot of the page exists. */
  skeleton?: string;
}

export interface ProposalOptions {
  methodology: SampleMethodology;
  size?: number;
  searchQuery?: string;
  /** Locale of the kind labels written into the notes. */
  locale?: string;
}

export interface ProposalCluster {
  key: string; // "url:<pattern>" or "template:<fingerprint>"
  pattern: string; // the URL pattern, or the patterns the template spans
  size: number;
  representative?: string; // the URL taken, when the cluster is represented
}

export interface SampleProposal {
  sample: SampleConfig; // pages + absent
  clusters: ProposalCluster[]; // every cluster, in the order they were considered
  considered: number; // distinct pages read (documents excluded)
  documents: number; // discovered document URLs (never sampled as pages)
  leftOut: number; // clusters the size bound left without a representative
}

// ---- deterministic ordering ----------------------------------------------------------------

/** Code-unit comparison: `localeCompare` depends on the machine's ICU data and locale, which is
 *  exactly the variation a deterministic proposal cannot afford. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
function cmpTuple(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? "";
    const y = b[i] ?? "";
    const c = typeof x === "number" && typeof y === "number" ? x - y : cmp(String(x), String(y));
    if (c !== 0) return c;
  }
  return 0;
}

// ---- URL patterns --------------------------------------------------------------------------

interface Parsed {
  url: string;
  path: string; // decoded pathname, "/" for the root
  segments: string[]; // decoded, non-empty path segments
  query: [string, string][];
  origin?: string;
}

function parseUrl(url: string): Parsed {
  try {
    const u = new URL(url);
    const path = safeDecode(u.pathname) || "/";
    return { url, path, segments: path.split("/").filter(Boolean), query: [...u.searchParams.entries()], origin: u.origin };
  } catch {
    const [p = url, q = ""] = url.split("?", 2);
    return { url, path: p, segments: p.split(/[/\\]/).filter(Boolean), query: [...new URLSearchParams(q).entries()] };
  }
}

const DATE = ":date";
const YEAR = /^(19|20)\d{2}$/;
const FULL_DATE = /^(19|20)\d{2}[-_.]?(0[1-9]|1[0-2])([-_.]?(0[1-9]|[12]\d|3[01]))?$/;
const EMBEDDED_DATE = /(19|20)\d{2}[-_.](0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One path segment with its variable part normalized: a date (`2026`, `2026-11-24`, the month
 *  and day after a year) becomes `:date`, a number or a hash `:id`, a slug carrying a date or a
 *  trailing number `:slug`. A date in a URL changes every day; a pattern must not. */
export function normalizeSegment(seg: string, afterDate: boolean): string {
  const s = seg.replace(/\.x?html?$/i, "");
  if (YEAR.test(s) || FULL_DATE.test(s)) return DATE;
  if (afterDate && /^\d{1,2}$/.test(s)) return DATE;
  if (/^\d+$/.test(s) || UUID.test(s) || (/^[0-9a-f]{12,}$/i.test(s) && /\d/.test(s))) return ":id";
  if (EMBEDDED_DATE.test(s) || /[-_]\d+$/.test(s)) return ":slug";
  return seg;
}

/** A query value with its variable part normalized, for the pattern (dates and numbers). */
function normalizeQueryValue(v: string): string {
  if (YEAR.test(v) || FULL_DATE.test(v) || EMBEDDED_DATE.test(v)) return DATE;
  if (/^\d+$/.test(v)) return ":id";
  return ":v";
}

/** The URL pattern of every page, ids, slugs and dates normalized. Pure function of the SET of
 *  URLs: the sibling count that turns a last segment into `:slug` is taken over all of them. */
export function urlPatterns(urls: readonly string[]): Map<string, string> {
  const parsed = [...new Set(urls)].sort(cmp).map(parseUrl);
  const segs = parsed.map((p) => {
    const out: string[] = [];
    for (const s of p.segments) {
      const n = normalizeSegment(s, out[out.length - 1] === DATE);
      if (n === DATE && out[out.length - 1] === DATE) continue; // 2026/11/24 is ONE date
      out.push(n);
    }
    return out;
  });
  // Left to right, so a collapsed parent groups its children: /blog/a/x, /blog/b/y, /blog/c/z →
  // /blog/:slug/:slug. Never at depth 0.
  const depth = Math.max(0, ...segs.map((s) => s.length));
  for (let i = 1; i < depth; i++) {
    const values = new Map<string, Set<string>>();
    for (const s of segs) {
      const v = s[i];
      if (v === undefined || v.startsWith(":")) continue;
      const prefix = s.slice(0, i).join("/");
      let set = values.get(prefix);
      if (!set) values.set(prefix, (set = new Set()));
      set.add(v);
    }
    for (const s of segs) {
      const v = s[i];
      if (v === undefined || v.startsWith(":")) continue;
      if ((values.get(s.slice(0, i).join("/"))?.size ?? 0) >= SLUG_SIBLINGS) s[i] = ":slug";
    }
  }
  const out = new Map<string, string>();
  parsed.forEach((p, i) => {
    const keys = [...new Set(p.query.map(([k, v]) => `${k}=${normalizeQueryValue(v)}`))].sort(cmp);
    out.set(p.url, `/${segs[i]!.join("/")}${keys.length ? `?${keys.join("&")}` : ""}`);
  });
  return out;
}

// ---- DOM skeleton ------------------------------------------------------------------------

const STRUCTURAL = new Set([
  "header",
  "nav",
  "main",
  "aside",
  "footer",
  "article",
  "section",
  "form",
  "table",
  "dialog",
  "iframe",
  "video",
  "audio",
  "search",
  "fieldset",
  "details",
]);
const ROLE_TAG: Record<string, string> = {
  banner: "header",
  navigation: "nav",
  main: "main",
  complementary: "aside",
  contentinfo: "footer",
  search: "search",
  form: "form",
  dialog: "dialog",
  table: "table",
  grid: "table",
};
const OPAQUE = new Set(["script", "style", "template", "noscript", "svg", "head"]);
const SKELETON_DEPTH = 5;

function skeletonOfNodes(nodes: readonly HNode[], depth: number): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.type !== "element" || OPAQUE.has(n.tag)) continue;
    const role = (attr(n, "role") ?? "").trim().toLowerCase();
    const tag = ROLE_TAG[role] ?? (STRUCTURAL.has(n.tag) ? n.tag : undefined);
    const parts = tag ? (depth < SKELETON_DEPTH ? skeletonOfNodes(n.children, depth + 1) : []) : skeletonOfNodes(n.children, depth);
    if (!tag) {
      for (const p of parts) if (out[out.length - 1] !== p) out.push(p);
      continue;
    }
    const s = parts.length ? `${tag}(${parts.join(",")})` : tag;
    if (out[out.length - 1] !== s) out.push(s); // ten cards in a row are one card
  }
  return out;
}

/** The page's template, as a short fingerprint: the nesting of its landmarks and structural
 *  elements (header, nav, main, form, table…), text and attributes ignored, consecutive repeats
 *  collapsed. Two articles of one blog share it; the agenda's calendar table does not. */
export function skeletonOf(html: string): string {
  const doc = parseHtml(html, "skeleton.html");
  const body = doc.elements.find((e) => e.tag === "body");
  const shape = skeletonOfNodes(body ? body.children : doc.roots, 0).join(",");
  return createHash("sha256").update(shape).digest("hex").slice(0, 12);
}

// ---- reading a page's HTML ---------------------------------------------------------------

/** Query parameter names a search form conventionally uses. */
const SEARCH_PARAMS = new Set([
  "q",
  "s",
  "query",
  "search",
  "recherche",
  "keys",
  "keywords",
  "keyword",
  "term",
  "terms",
  "text",
  "motcle",
  "mot-cle",
  "search_api_fulltext",
]);

interface PageFacts {
  searchForm?: { action: string; param: string };
  documentLinks: number;
}

function readFacts(html: string, pageUrl: string): PageFacts {
  const doc = parseHtml(html, "page.html");
  let origin: string | undefined;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = undefined;
  }
  let documentLinks = 0;
  if (origin) {
    for (const a of doc.elements) {
      if (a.tag !== "a") continue;
      const href = attr(a, "href");
      if (!href) continue;
      try {
        const u = new URL(href, pageUrl);
        if (u.origin === origin && isDownloadUrl(u.href) && /\.(pdf|docx?|odt|xlsx?|ods|pptx?|odp|rtf|csv|epub)$/i.test(u.pathname)) documentLinks++;
      } catch {
        /* an unparsable href links nothing */
      }
    }
  }
  return { documentLinks, ...(origin ? searchFormOf(doc.elements, pageUrl, origin) : {}) };
}

function searchFormOf(elements: readonly El[], pageUrl: string, origin: string): { searchForm?: { action: string; param: string } } {
  for (const form of elements) {
    if (form.tag !== "form") continue;
    if ((attr(form, "method") ?? "get").trim().toLowerCase() !== "get") continue;
    const inSearch = attr(form, "role") === "search" || ancestors(form).some((a) => a.tag === "search" || attr(a, "role") === "search");
    const fields = descendants(form)
      .filter((e) => e.tag === "input" && (attr(e, "name") ?? "").trim() !== "")
      .sort((a, b) => a.start - b.start); // `descendants` walks a stack; document order is what a reader means
    const typed = (e: El) => (attr(e, "type") ?? "text").trim().toLowerCase();
    const field =
      fields.find((e) => typed(e) === "search") ??
      fields.find((e) => (typed(e) === "text" || typed(e) === "search") && SEARCH_PARAMS.has((attr(e, "name") ?? "").toLowerCase()));
    if (!field) continue;
    const param = (attr(field, "name") ?? "").trim();
    if (!inSearch && typed(field) !== "search" && !SEARCH_PARAMS.has(param.toLowerCase())) continue;
    try {
      const u = new URL(attr(form, "action") || pageUrl, pageUrl);
      if (u.origin !== origin || !/^https?:$/.test(u.protocol)) continue;
      return { searchForm: { action: `${u.origin}${u.pathname}`, param } };
    } catch {
      /* an unparsable action reaches nothing */
    }
  }
  return {};
}

/** The URL a search for `query` lands on through `param` at `action`. */
function searchUrl(action: string, param: string, query: string): string {
  return `${action}?${new URLSearchParams([[param, query]]).toString()}`;
}

// ---- titles --------------------------------------------------------------------------------

const TITLE_SEPARATOR = /\s+[-|–—·:»]\s+/;

/** Titles with the part every page repeats (the site name) removed: « Contact — Mairie de
 *  Plaisance » and « Actualités — Mairie de Plaisance » keep « Contact » and « Actualités », so a
 *  site called « Aide sociale » does not make every page an aide page. A part counts as the
 *  site's when at least half of the titles carry it (three titles at least). */
function strippedTitles(titles: Map<string, string>): Map<string, string> {
  const parts = new Map<string, number>();
  for (const t of titles.values()) for (const p of new Set(t.split(TITLE_SEPARATOR).map((x) => x.trim()))) parts.set(p, (parts.get(p) ?? 0) + 1);
  const common = titles.size >= 3 ? new Set([...parts].filter(([, n]) => n * 2 >= titles.size).map(([p]) => p)) : new Set<string>();
  const out = new Map<string, string>();
  for (const [url, t] of titles) {
    const kept = t
      .split(TITLE_SEPARATOR)
      .map((x) => x.trim())
      .filter((x) => x && !common.has(x));
    out.set(url, kept.join(" "));
  }
  return out;
}

// ---- the proposal ------------------------------------------------------------------------

interface Page {
  url: string;
  title?: string;
  html?: string;
  skeleton?: string;
  parsed: Parsed;
  depth: number;
  hasQuery: number;
  urlHay: string;
  titleHay: string;
  facts?: PageFacts;
}

interface Pick {
  url: string;
  title?: string;
  reasons: string[];
}

interface KindMatch {
  page: Page;
  keyword: string;
  where: "URL" | "title";
  rank: (number | string)[];
}

function matchKind(kind: SampleRequiredKind, pages: readonly Page[]): KindMatch | undefined {
  const kws = kind.keywords.map(norm).filter(Boolean);
  let best: KindMatch | undefined;
  for (const page of pages) {
    for (let ki = 0; ki < kws.length; ki++) {
      const k = kws[ki]!;
      const where = keywordMatches(page.urlHay, k) ? "URL" : keywordMatches(page.titleHay, k) ? "title" : undefined;
      if (!where) continue;
      // Shallowest first: /contact before /actualites/contact-presse. Then a page without a
      // query, a URL match before a title match, the more canonical keyword, the shorter URL,
      // and finally the URL itself — a total order, so the pick never depends on input order.
      const rank = [page.depth, page.hasQuery, where === "URL" ? 0 : 1, ki, page.url.length, page.url];
      if (!best || cmpTuple(rank, best.rank) < 0) best = { page, keyword: kind.keywords[ki] ?? k, where, rank };
    }
  }
  return best;
}

/** Propose a sample from discovered pages. Deterministic: the same SET of inputs gives the same
 *  sample, whatever order they arrive in. */
export function proposeSample(inputs: readonly ProposalInput[], opts: ProposalOptions): SampleProposal {
  const size = opts.size !== undefined && Number.isFinite(opts.size) && opts.size > 0 ? Math.floor(opts.size) : DEFAULT_SAMPLE_SIZE;
  const query = opts.searchQuery?.trim() || FIXED_SEARCH_QUERY;
  const locale = opts.locale ?? "fr";

  // 1. Sort, then dedupe on the URL (hash dropped). On a duplicate the smallest title / HTML
  //    wins, so even conflicting duplicates resolve the same way every time.
  const sorted = inputs
    .map((i) => ({ ...i, url: i.url.split("#", 1)[0]! }))
    .filter((i) => i.url)
    .sort((a, b) => cmpTuple([a.url, a.title ?? "", a.skeleton ?? "", a.html ?? ""], [b.url, b.title ?? "", b.skeleton ?? "", b.html ?? ""]));
  const unique: ProposalInput[] = [];
  for (const i of sorted) if (unique[unique.length - 1]?.url !== i.url) unique.push(i);
  const documents = unique.filter((i) => isDownloadUrl(i.url));
  const pageInputs = unique.filter((i) => !isDownloadUrl(i.url));

  const titles = new Map<string, string>();
  for (const i of pageInputs) if (i.title?.trim()) titles.set(i.url, i.title.trim());
  const bare = strippedTitles(titles);
  const pages: Page[] = pageInputs.map((i) => {
    const parsed = parseUrl(i.url);
    const words = parsed.segments.map((s) => s.replace(/\.x?html?$/i, "")).join(" ");
    const root = parsed.segments.length === 0 || /^index\.x?html?$/i.test(parsed.segments.join("/"));
    return {
      url: i.url,
      ...(i.title?.trim() ? { title: i.title.trim() } : {}),
      ...(i.html ? { html: i.html } : {}),
      ...(i.skeleton ? { skeleton: i.skeleton } : {}),
      parsed,
      depth: root ? 0 : parsed.segments.length,
      hasQuery: parsed.query.length ? 1 : 0,
      urlHay: norm(`${words.replace(/[-_.+~]+/g, " ")}${root ? " home index" : ""}`),
      titleHay: norm(bare.get(i.url) ?? ""),
      ...(i.html ? { facts: readFacts(i.html, i.url) } : {}),
    };
  });
  const byShallow = [...pages].sort((a, b) => cmpTuple([a.depth, a.hasQuery, a.url], [b.depth, b.hasQuery, b.url]));

  const picks: Pick[] = [];
  const pickOf = new Map<string, Pick>();
  const take = (url: string, title: string | undefined, reason: string): void => {
    const hit = pickOf.get(url);
    if (hit) {
      if (!hit.reasons.includes(reason)) hit.reasons.push(reason);
      return;
    }
    const p: Pick = { url, ...(title ? { title } : {}), reasons: [reason] };
    picks.push(p);
    pickOf.set(url, p);
  };
  const absent: SampleAbsent[] = [];
  const pathOf = (p: Page) => p.parsed.path + (p.parsed.query.length ? `?${new URLSearchParams(p.parsed.query).toString()}` : "");

  // 2–3. The required kinds, in the pack's order.
  for (const kind of opts.methodology.requiredKinds) {
    if (isTransverseKind(kind) || isRepresentativeKind(kind)) continue;
    const label = kindLabel(kind, locale);
    if (/recherche|search/.test(kind.id)) {
      const withForm = byShallow.find((p) => p.facts?.searchForm);
      if (withForm?.facts?.searchForm) {
        const { action, param } = withForm.facts.searchForm;
        take(searchUrl(action, param, query), undefined, `required kind "${label}", fixed query "${query}" through the search form of ${pathOf(withForm)}`);
        continue;
      }
      const withParam = byShallow.find(
        (p) =>
          p.parsed.origin &&
          p.parsed.query.some(([k]) => SEARCH_PARAMS.has(k.toLowerCase())) &&
          kind.keywords.map(norm).some((k) => keywordMatches(p.urlHay, k)),
      );
      const param = withParam?.parsed.query.find(([k]) => SEARCH_PARAMS.has(k.toLowerCase()))?.[0];
      if (withParam && param) {
        take(
          searchUrl(`${withParam.parsed.origin}${new URL(withParam.url).pathname}`, param, query),
          undefined,
          `required kind "${label}", fixed query "${query}" on the discovered search URL ${pathOf(withParam)}`,
        );
        continue;
      }
    }
    const m = matchKind(kind, pages);
    if (m) {
      const extra = /recherche|search/.test(kind.id) ? `; no search parameter known — search "${query}" by hand on this page` : "";
      take(m.page.url, m.page.title, `required kind "${label}", keyword "${m.keyword}" in the ${m.where}${extra}`);
      continue;
    }
    if (/document/.test(kind.id)) {
      const linking = byShallow.find((p) => (p.facts?.documentLinks ?? 0) > 0);
      if (linking) {
        take(linking.url, linking.title, `required kind "${label}", the shallowest page linking downloadable documents (${linking.facts!.documentLinks})`);
        continue;
      }
    }
    absent.push({
      kind: kind.id,
      reason: `${PROPOSAL_NOTE}no discovered URL or title matches ${kind.keywords.map((k) => `"${k}"`).join(", ")}${/document/.test(kind.id) && documents.length ? ` (${documents.length} document URL(s) discovered, no page known to link them)` : ""} — confirm the site has none`,
    });
  }

  // 4. Template clusters. A page with a snapshot skeleton clusters by template; the others by
  //    URL pattern. Largest first: the template most of the site is made of is the first one a
  //    representative sample owes. A cluster one of whose pages is already sampled is covered.
  const patterns = urlPatterns(pages.map((p) => p.url));
  const groups = new Map<string, Page[]>();
  for (const p of pages) {
    const key = p.skeleton ? `template:${p.skeleton}` : `url:${patterns.get(p.url)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(p);
  }
  const clusters = [...groups]
    .map(([key, members]) => ({
      key,
      members: members.sort((a, b) => cmpTuple([a.hasQuery, a.url], [b.hasQuery, b.url])),
      pattern: [...new Set(members.map((m) => patterns.get(m.url)!))].sort(cmp).join(" "),
    }))
    .sort((a, b) => cmpTuple([-a.members.length, a.pattern, a.key], [-b.members.length, b.pattern, b.key]));
  const representativeKind = opts.methodology.requiredKinds.find(isRepresentativeKind);
  const repLabel = representativeKind ? kindLabel(representativeKind, locale) : "representative pages";
  const out: ProposalCluster[] = [];
  let leftOut = 0;
  let represented = 0;
  for (const c of clusters) {
    const sampled = c.members.find((m) => pickOf.has(m.url));
    if (sampled) {
      out.push({ key: c.key, pattern: c.pattern, size: c.members.length, representative: sampled.url });
      continue;
    }
    if (picks.length >= size) {
      out.push({ key: c.key, pattern: c.pattern, size: c.members.length });
      leftOut++;
      continue;
    }
    const rep = c.members[0]!;
    const what = c.key.startsWith("template:") ? `template ${c.key.slice("template:".length)} (${c.pattern})` : `template cluster ${c.pattern}`;
    take(rep.url, rep.title, `${repLabel}: ${what}, ${c.members.length} page(s), first by URL`);
    represented++;
    out.push({ key: c.key, pattern: c.pattern, size: c.members.length, representative: rep.url });
  }
  if (representativeKind && represented === 0 && !leftOut)
    absent.push({
      kind: representativeKind.id,
      reason: `${PROPOSAL_NOTE}every discovered page is already sampled for a required kind — no other template found`,
    });

  // 5. Ids: stable slugs, a numeric suffix on a collision, in pick order (itself deterministic).
  const used = new Set<string>();
  const samplePages: SamplePage[] = picks.map((p) => {
    const base = slugifyPageId(p.url);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { id, name: p.title ?? nameFromUrl(p.url), url: p.url, notes: `${PROPOSAL_NOTE}${p.reasons.join("; ")}` };
  });
  return {
    sample: { pages: samplePages, ...carryAbsent(absent) },
    clusters: out,
    considered: pages.length,
    documents: documents.length,
    leftOut,
  };
}

// ---- folding the proposal into an existing sample ----------------------------------------

/** The part of a page's notes a human wrote (everything but the proposal's own segment). */
export function humanNotes(notes: string | undefined): string {
  return (notes ?? "")
    .split(" | ")
    .filter((s) => s.trim() && !s.startsWith(PROPOSAL_NOTE))
    .join(" | ");
}

export interface ProposalApply {
  sample: SampleConfig;
  kept: SamplePage[]; // declared pages outside the proposal, kept because they carry human work
  dropped: SamplePage[]; // declared pages outside the proposal, carrying nothing to keep
}

/** Replace the declared pages with the proposal, keeping the human work.
 *
 *  The proposal IS the sample: merging it into a list of 359 discovered pages would leave the
 *  359. So a declared page outside the proposal is dropped — unless it carries what someone
 *  wrote: `auth`, a `storageState`, `sources`, or notes of their own (the recorded reason for a
 *  hand-added page). A declared page the proposal also picks keeps its id (its snapshot
 *  directory), its name and that human work, and gets the proposal's reason appended.
 *  `absent` entries the proposal wrote before are replaced; a human's are kept. Re-running on
 *  the result changes nothing. */
export function applyProposal(existing: SampleConfig | undefined, proposal: SampleConfig): ProposalApply {
  const declared = existing?.pages ?? [];
  const byUrl = new Map(declared.map((p) => [p.url, p] as const));
  const proposedUrls = new Set(proposal.pages.map((p) => p.url));
  const humanWork = (p: SamplePage) => p.auth !== undefined || !!p.storageState || !!p.sources?.length || humanNotes(p.notes) !== "";
  const kept = declared.filter((p) => !proposedUrls.has(p.url) && humanWork(p));
  const dropped = declared.filter((p) => !proposedUrls.has(p.url) && !humanWork(p));

  const used = new Set(kept.map((p) => p.id));
  const pages: SamplePage[] = proposal.pages.map((p) => {
    const prior = byUrl.get(p.url);
    const human = humanNotes(prior?.notes);
    const notes = [human, p.notes].filter(Boolean).join(" | ");
    const base = prior?.id ?? p.id;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return {
      id,
      name: prior?.name ?? p.name,
      url: p.url,
      ...(prior?.auth !== undefined ? { auth: prior.auth } : {}),
      ...(prior?.storageState ? { storageState: prior.storageState } : {}),
      ...(notes ? { notes } : {}),
      ...(prior?.sources?.length ? { sources: prior.sources } : {}),
    };
  });
  const humanAbsent = (existing?.absent ?? []).filter((a) => !a.reason.startsWith(PROPOSAL_NOTE));
  const absent = [...humanAbsent, ...(proposal.absent ?? []).filter((a) => !humanAbsent.some((h) => h.kind === a.kind))];
  return {
    sample: {
      pages: [...pages, ...kept],
      ...(existing?.transverse?.length ? { transverse: existing.transverse } : {}),
      ...(existing?.global?.length ? { global: existing.global } : {}),
      ...(existing?.exempt?.length ? { exempt: existing.exempt } : {}),
      ...carryAbsent(absent),
    },
    kept,
    dropped,
  };
}
