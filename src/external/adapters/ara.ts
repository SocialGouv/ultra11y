// ARA (ara.numerique.gouv.fr) — the French state RGAA audit tool. THE ONLY MODULE THAT KNOWS ARA.
//
// Its reports are public over `GET /api/reports/<consultUniqueId>`. The shape parsed here is the
// one its own `AuditReportDto` declares (DISIC/Ara, confiture-rest-api/src/audits/dto), and the
// fixture in tests/fixtures/external/ is what pins it: a schema this file guesses at would
// produce a confidently wrong crosswalk, which is the exact failure class this engine exists to
// prevent.
//
// Two joins matter:
//   • a result names its page by NUMERIC pageId, which indexes `context.samples[].id`;
//   • a result names its criterion as `topic` + `criterium`, which is RGAA's own "8.4" once
//     joined with a dot. No translation table, no fuzzy matching.
import type { ExternalAdapter, ExternalAudit, ExternalCriterionResult } from "../types.js";
import type { Status } from "../../types.js";
import { loadPack } from "../../standards/index.js";
import { slugifyPageId } from "../../snapshot.js";

/** ARA's `CriterionResultStatus`, mapped onto ours. Exhaustive and explicit: a token outside this
 *  table is a hard error naming it, never a silent `manual`. If ARA adds a status, this file must
 *  learn it deliberately — an importer that shrugs at an unknown verdict is an importer that
 *  quietly downgrades non-conformities. */
const ARA_STATUS: Record<string, Status> = {
  COMPLIANT: "C",
  NOT_COMPLIANT: "NC",
  NOT_APPLICABLE: "NA",
  // "the auditor did not test this criterion". `manual` is the honest mapping — undecided — and
  // `rawStatus` is what lets a diff say « non retesté » rather than lumping it with the rest.
  NOT_TESTED: "manual",
};

interface AraSample {
  id: number;
  name?: string;
  url?: string;
}

interface AraResult {
  topic: number;
  criterium: number;
  pageId: number;
  status: string;
  compliantComment?: string | null;
  notApplicableComment?: string | null;
  notCompliantItems?: { title?: string | null; comment?: string | null; userImpact?: string | null }[];
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The auditor's prose for one result, in the source's own words. ARA files a comment under a
 *  different key per status and splits a non-conformity into items, so this assembles the parts
 *  WITHOUT rewriting any of them — the sentence a human wrote is the evidence. */
function commentOf(r: AraResult): string | undefined {
  const items = (r.notCompliantItems ?? []).map((i) => [i.title, i.comment].filter(Boolean).join(" — ")).filter(Boolean);
  const parts = [r.compliantComment, r.notApplicableComment, ...items].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  return parts.length ? parts.join("\n\n") : undefined;
}

/** The worst impact the source recorded across a result's items — ARA files impact per item. */
function impactOf(r: AraResult): string | undefined {
  const order = ["BLOCKING", "MAJOR", "MINOR"];
  const found = (r.notCompliantItems ?? []).map((i) => i.userImpact).filter((x): x is string => typeof x === "string");
  for (const level of order) if (found.includes(level)) return level;
  return undefined;
}

export const araAdapter: ExternalAdapter = {
  id: "ara",

  fetchUrl(id: string): string {
    return `https://ara.numerique.gouv.fr/api/reports/${encodeURIComponent(id)}`;
  },

  parse(raw, opts) {
    const issues: string[] = [];
    if (!isObj(raw)) return { ok: false, issues: ["the report is not a JSON object"] };

    const context = isObj(raw.context) ? raw.context : {};
    const samples = Array.isArray(context.samples) ? (context.samples as AraSample[]) : [];
    if (!samples.length) issues.push("context.samples is empty — the report declares no page, so no result can be located");

    // ARA page ids are numeric and meaningless outside its database. Slugify the name into an id
    // of the same shape the rest of this engine uses, so an imported page can be compared with a
    // snapshot id by a human reading the diff. Collisions get a numeric suffix rather than
    // silently merging two of the auditor's pages into one.
    const seen = new Set<string>();
    const pageById = new Map<number, { id: string; name: string; url: string }>();
    for (const s of samples) {
      if (typeof s?.id !== "number") {
        issues.push(`a page in context.samples has no numeric id: ${JSON.stringify(s)}`);
        continue;
      }
      const name = typeof s.name === "string" && s.name.trim() ? s.name : `page-${s.id}`;
      const url = typeof s.url === "string" ? s.url : "";
      let id = slugifyPageId(name) || `page-${s.id}`;
      for (let n = 2; seen.has(id); n++) id = `${slugifyPageId(name)}-${n}`;
      seen.add(id);
      pageById.set(s.id, { id, name, url });
    }

    const results: ExternalCriterionResult[] = [];
    const rawResults = Array.isArray(raw.results) ? (raw.results as AraResult[]) : [];
    if (!rawResults.length) issues.push("the report carries no `results` array");

    // Every criterion id is checked against the pack. A report naming a criterion RGAA does not
    // define is REPORTED, never dropped: it means the two sides disagree about the standard, and
    // a diff that quietly skipped it would claim agreement it does not have.
    const known = new Set(loadPack("rgaa").criteria.map((c) => c.id));

    for (const r of rawResults) {
      if (!isObj(r)) {
        issues.push(`a result is not an object: ${JSON.stringify(r)}`);
        continue;
      }
      const criterion = `${r.topic}.${r.criterium}`;
      const page = pageById.get(r.pageId);
      if (!page) {
        issues.push(`result ${criterion} names pageId ${r.pageId}, which context.samples never declares`);
        continue;
      }
      if (!known.has(criterion)) {
        issues.push(`result names criterion ${criterion}, which the RGAA pack does not define`);
        continue;
      }
      const status = ARA_STATUS[r.status];
      if (status === undefined) {
        issues.push(`result ${criterion} on ${page.id} carries status "${r.status}" — expected one of ${Object.keys(ARA_STATUS).join(", ")}`);
        continue;
      }
      const comment = commentOf(r);
      const userImpact = impactOf(r);
      results.push({
        page: page.id,
        criterion,
        status,
        rawStatus: r.status,
        ...(comment ? { comment } : {}),
        ...(userImpact ? { userImpact } : {}),
      });
    }

    if (issues.length) return { ok: false, issues };

    const date =
      typeof raw.publishDate === "string" ? raw.publishDate.slice(0, 10) : typeof raw.creationDate === "string" ? raw.creationDate.slice(0, 10) : undefined;
    const audit: ExternalAudit = {
      tool: "ultra11y",
      kind: "external-audit",
      schemaVersion: 1,
      source: {
        adapter: "ara",
        ...(typeof raw.consultUniqueId === "string" ? { id: raw.consultUniqueId } : {}),
        ...(opts.url ? { url: opts.url } : {}),
        importedAt: opts.importedAt,
      },
      standard: "rgaa",
      ...(date ? { date } : {}),
      ...(typeof raw.procedureName === "string" ? { procedure: raw.procedureName } : {}),
      ...(typeof context.auditorName === "string" ? { auditor: context.auditorName } : {}),
      pages: [...pageById.values()],
      results,
    };
    return { ok: true, audit };
  },
};
