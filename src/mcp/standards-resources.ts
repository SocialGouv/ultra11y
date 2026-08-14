// The standards themselves, served as MCP resources under `std://`.
//
// In MCP, documentation is a RESOURCE, not a tool call. A client that wants to read what
// criterion 8.3 requires should be able to fetch it the way it fetches a file, without
// spending a tool call and without the model having to decide to make one.
//
// Deliberately NOT part of src/mcp/resources.ts. That module serves `skill://` off the
// filesystem, and its entire correctness argument is realpath containment — a path that
// normalizes cleanly can still escape through a symlink. Standards data is tsup-inlined
// JSON with no file behind it. Putting a non-filesystem branch inside a path-containment
// function is exactly where a containment bug hides later.
import { criteriaIndex, criterionView, CriteriaLookupError, glossaryView, themeView } from "../criteria-view.js";
import { methodView } from "../method-view.js";
import { isCore, listStandards, loadPack, packGlossary, standardLabel } from "../standards/index.js";
import { coreGlossary } from "../wcag.js";
import { ResourceError, type ResourceDecl, type ResourceContents } from "./resources.js";
import type { Lang } from "../types.js";

const SCHEME = "std://";
const MIME = "application/json";

export interface ResourceTemplateDecl {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType: string;
}

/** Does this standard ship any normative term definitions? */
function hasGlossary(key: string): boolean {
  return Object.keys(isCore(key) ? coreGlossary() : (packGlossary(key) ?? {})).length > 0;
}

/**
 * The enumerable entries: one small, bounded set per registered standard.
 *
 * The per-criterion URIs are NOT enumerated. RGAA alone would contribute 106 criteria plus
 * 119 glossary terms, which would bloat every client's `resources/list` and go stale the
 * moment a project's own pack registers. Those are templates instead.
 */
export function listStandardResources(): ResourceDecl[] {
  const out: ResourceDecl[] = [];
  for (const key of listStandards()) {
    const label = standardLabel(key);
    out.push({
      uri: `${SCHEME}${key}/criteria`,
      name: `${key}/criteria`,
      title: `${label}: every criterion`,
      description: `The full criterion index for ${label}, with the evidence tier each one needs.`,
      mimeType: MIME,
    });
    out.push({
      uri: `${SCHEME}${key}/method`,
      name: `${key}/method`,
      title: `${label}: the audit work plan`,
      description: `Which ${label} criteria the engine decides from source, which need a rendered page or a browser, and which are judgment calls.`,
      mimeType: MIME,
    });
    if (hasGlossary(key)) {
      out.push({
        uri: `${SCHEME}${key}/glossary`,
        name: `${key}/glossary`,
        title: `${label}: the terms it defines`,
        description: `The terms ${label} defines normatively — the definitions that decide its verdicts.`,
        mimeType: MIME,
      });
    }
    if (!isCore(key)) {
      out.push({
        uri: `${SCHEME}${key}/pack.json`,
        name: `${key}/pack.json`,
        title: `${label}: the standards pack`,
        description: `The whole ${label} pack as ultra11y loads it, including its licence and attribution.`,
        mimeType: MIME,
      });
    }
  }
  return out;
}

/** The per-item URIs, as templates — four entries instead of several hundred. */
export function listStandardResourceTemplates(): ResourceTemplateDecl[] {
  return [
    {
      uriTemplate: `${SCHEME}{standard}/criteria/{id}`,
      name: "criterion",
      title: "One criterion of one standard",
      description: "A criterion in full: its wording, its numbered tests, the terms it leans on, and what it takes to decide it.",
      mimeType: MIME,
    },
    {
      uriTemplate: `${SCHEME}{standard}/themes/{number}`,
      name: "theme",
      title: "One theme of a country standard",
      description: "The criteria grouped under one theme of a country standard. WCAG groups by guideline instead.",
      mimeType: MIME,
    },
    {
      uriTemplate: `${SCHEME}{standard}/glossary/{term}`,
      name: "glossary-term",
      title: "A term a standard normatively defines",
      description: "The normative definition of a term, and the criteria it governs.",
      mimeType: MIME,
    },
    {
      uriTemplate: `${SCHEME}{standard}/guidance/{criterion}`,
      name: "guidance",
      title: "Implementation guidance for a criterion",
      description: "Before/after examples for a criterion, including those inherited through its WCAG mapping.",
      mimeType: MIME,
    },
  ];
}

export function isStandardUri(uri: string): boolean {
  return uri.startsWith(SCHEME);
}

function body(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Read a `std://` resource. Every branch delegates to the same view functions the tools
 * call, so a resource and its tool can never disagree about what a criterion says.
 */
export function readStandardResource(uri: string, lang: Lang = "en"): ResourceContents {
  const rest = uri.slice(SCHEME.length);
  const parts = rest.split("/").filter(Boolean);
  const standard = parts[0];
  if (!standard) throw new ResourceError(`no standard named in "${uri}" (expected ${SCHEME}<standard>/…)`);
  if (!listStandards().includes(standard)) {
    throw new ResourceError(`unknown standard "${standard}" (known: ${listStandards().join(", ")})`);
  }

  const decode = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };

  try {
    const [, section, ...tail] = parts;
    const key = tail.length ? decode(tail.join("/")) : undefined;

    if (section === undefined) return { uri, mimeType: MIME, text: body(criteriaIndex(standard, lang)) };
    if (section === "criteria") {
      return { uri, mimeType: MIME, text: body(key ? criterionView(standard, key, lang, true) : criteriaIndex(standard, lang)) };
    }
    if (section === "themes") {
      if (!key) throw new ResourceError(`no theme named in "${uri}"`);
      return { uri, mimeType: MIME, text: body(themeView(standard, Number(key), lang)) };
    }
    if (section === "glossary") return { uri, mimeType: MIME, text: body(glossaryView(standard, key, lang)) };
    if (section === "guidance") {
      if (!key) throw new ResourceError(`no criterion named in "${uri}"`);
      const view = criterionView(standard, key, lang, true);
      return { uri, mimeType: MIME, text: body({ standard, criterion: key, entries: (view.criterion as { guidance: unknown[] }).guidance }) };
    }
    if (section === "method") return { uri, mimeType: MIME, text: body(methodView(standard, lang)) };
    if (section === "pack.json") {
      if (isCore(standard)) throw new ResourceError("the WCAG core is not a standards pack — read std://wcag/criteria instead");
      return { uri, mimeType: MIME, text: body(loadPack(standard)) };
    }
    throw new ResourceError(`unknown standards resource: ${uri}`);
  } catch (e) {
    // A lookup the client got wrong is a client bug, the same as an unknown tool.
    if (e instanceof CriteriaLookupError) throw new ResourceError(e.message);
    throw e;
  }
}
