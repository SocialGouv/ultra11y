// THE GRAIN — one PURE function from an audit to a list of tickets.
//
// No fs, no network, no console, no process.exit, no Date.now. Everything it needs is on the
// AuditResult. That is what makes the ticket engine testable without a tracker, and what
// makes "decoupled" mean something: the providers below it never see a Finding, and this
// file never sees an HTTP request.
//
// It takes an AuditResult and NOT a PrdUnit[] on purpose: the page and file grains need
// `scope.pages`, `packFindings` and `pageView`, all of which `prdUnits()` has already
// discarded by the time it returns.
import type { AuditResult, Finding, PageResult, Severity } from "../types.js";
import { repoRelative } from "../util.js";
import { type PrdUnit, prdUnits } from "../prd.js";
import { renderAuditorBacklog } from "../auditor.js";
import { attributePages, derivePages, pageBasisWarning, pageView, pagesOf, unattributedFindings, unattributedNote } from "../pages.js";
import { type GrainOptions, type Ticket, type TicketPlan, UNATTRIBUTED_ID } from "./types.js";
import {
  clampBody,
  criterionTitle,
  fileTitle,
  filePreamble,
  labelsFor,
  pageCriterionTitle,
  pagePreamble,
  pageTitle,
  renderCriterionBody,
  singleTitle,
  standardTag,
  unattributedTitle,
} from "./render.js";

const SEV_RANK: Record<Severity, number> = { bloquant: 0, majeur: 1, mineur: 2 };

/** The most severe severity in a set — the ticket's own. Empty ⇒ `mineur`, the least
 *  alarming default, so an empty group can never masquerade as blocking. */
function worstOf(items: { severity: Severity }[]): Severity {
  return items.reduce<Severity>((worst, x) => (SEV_RANK[x.severity] < SEV_RANK[worst] ? x.severity : worst), "mineur");
}

/** A view of the audit restricted to one FILE. Deliberately does NOT touch `criteria`: a file
 *  is not a page and earns no conformance verdict. Kept private so nobody is tempted to
 *  compute a per-file rate from it. */
function fileView(result: AuditResult, file: string, baseDir: string): AuditResult {
  const owns = (f: Finding): boolean => sourceOf(f, baseDir) === file;
  return {
    ...result,
    findings: result.findings.filter(owns),
    ...(result.packFindings ? { packFindings: result.packFindings.filter(owns) } : {}),
  };
}

/** The file a finding belongs to, REPO-RELATIVE. A finding raised on a RENDERED capture is
 *  credited to the source component that produced it, not to the capture file nobody edits.
 *  The path is relativised because it lands in the ticket TITLE, which is the de-dupe key: an
 *  absolute path would make that key machine-specific and re-file everything from CI. */
function sourceOf(f: Finding, baseDir: string): string {
  return repoRelative(f.origin?.sourceFile ?? f.file, baseDir);
}

export function buildTickets(result: AuditResult, opts: GrainOptions): TicketPlan {
  const { grain, standard, lang } = opts;
  const { label, tag } = standardTag(standard);
  const limit = opts.bodyLimit ?? Number.POSITIVE_INFINITY;
  const bodyOpts = {
    ...(opts.format !== undefined ? { format: opts.format } : {}),
    ...(opts.technical !== undefined ? { technical: opts.technical } : {}),
  };
  const backlogOpts = opts.technical !== undefined ? { technical: opts.technical } : {};
  const baseDir = opts.baseDir ?? "";
  const clamp = (body: string): string => clampBody(body, limit, lang);

  const ticketFromUnit = (unit: PrdUnit, title: string, scope: Ticket["scope"]): Ticket => ({
    title,
    body: clamp(renderCriterionBody(unit, standard, lang, bodyOpts)),
    labels: labelsFor(unit.severity, unit.advisory === true, tag),
    severity: unit.severity,
    advisory: unit.advisory === true,
    scope,
  });

  if (grain === "criterion") {
    const tickets = prdUnits(result, standard, lang).map((u) => ticketFromUnit(u, criterionTitle(u, label), { grain: "criterion", criteriaId: u.criteriaId }));
    return { tickets, unattributed: 0 };
  }

  if (grain === "single") {
    const units = prdUnits(result, standard, lang);
    if (!units.length) return { tickets: [], unattributed: 0 };
    return {
      tickets: [
        {
          title: singleTitle(label),
          // renderAuditorBacklog — not a second template. It also fixes a real inconsistency
          // in the pre-v3 consolidated body, which sectioned advisory units AMONG the
          // severity groups instead of isolating them in their own trailing section.
          body: clamp(renderAuditorBacklog(result, lang, standard, backlogOpts)),
          labels: labelsFor(
            worstOf(units),
            units.every((u) => u.advisory === true),
            tag,
          ),
          severity: worstOf(units),
          advisory: units.every((u) => u.advisory === true),
          scope: { grain: "single" },
        },
      ],
      unattributed: 0,
    };
  }

  if (grain === "file") {
    const files = [...new Set(result.findings.map((f) => sourceOf(f, baseDir)))].sort();
    const tickets: Ticket[] = [];
    for (const file of files) {
      const view = fileView(result, file, baseDir);
      const units = prdUnits(view, standard, lang);
      if (!units.length) continue;
      const advisory = units.every((u) => u.advisory === true);
      tickets.push({
        title: fileTitle(file, label),
        body: clamp([...filePreamble(file, lang), renderAuditorBacklog(view, lang, standard, backlogOpts)].join("\n")),
        labels: labelsFor(worstOf(units), advisory, tag),
        severity: worstOf(units),
        advisory,
        scope: { grain: "file", file },
      });
    }
    return { tickets, unattributed: 0 };
  }

  // ---- the page grains -------------------------------------------------------------------
  // Same ordering cmdPages uses: pagesOf → guard → attributePages (which MUTATES `result` by
  // stamping `f.page`) → derivePages. Nothing here re-decides a status.
  const scope = pagesOf(result);
  if (!scope.length) return { tickets: [], unattributed: 0, error: "no-pages" };
  attributePages(result, scope);
  const derived = derivePages(result, scope);
  const orphans = unattributedFindings(result);
  const tickets: Ticket[] = [];

  for (const page of derived) {
    const view = pageView(result, page);
    const units = prdUnits(view, standard, lang);
    if (!units.length) continue;
    const warning = pageBasisWarning(page.basis, lang);
    const preamble = pagePreamble(page, lang, warning);

    if (grain === "page") {
      const advisory = units.every((u) => u.advisory === true);
      tickets.push({
        title: pageTitle(page.id, label),
        body: clamp([...preamble, renderAuditorBacklog(view, lang, standard, backlogOpts)].join("\n")),
        labels: labelsFor(worstOf(units), advisory, tag),
        severity: worstOf(units),
        advisory,
        scope: pageScopeOf(page),
      });
      continue;
    }

    for (const u of units) {
      const t = ticketFromUnit(u, pageCriterionTitle(page.id, u, label), {
        grain: "page-criterion",
        pageId: page.id,
        pageName: page.name,
        url: page.url,
        ...(page.auth !== undefined ? { auth: page.auth } : {}),
        basis: page.basis,
        criteriaId: u.criteriaId,
      });
      tickets.push({ ...t, body: clamp([...preamble, t.body].join("\n")) });
    }
  }

  // Honesty rule 1: findings no page could claim get their OWN ticket. Dropping them would
  // hide non-conformities; spreading them across pages would invent them. Both grains emit
  // it, so the orphan backlog is never a casualty of the chosen granularity.
  if (orphans.length) {
    const view: AuditResult = { ...result, findings: orphans, ...(result.packFindings ? { packFindings: result.packFindings.filter((f) => !f.page) } : {}) };
    const units = prdUnits(view, standard, lang);
    if (units.length) {
      const advisory = units.every((u) => u.advisory === true);
      tickets.push({
        title: unattributedTitle(label),
        body: clamp([`> ${unattributedNote(orphans.length, lang)}`, "", renderAuditorBacklog(view, lang, standard, backlogOpts)].join("\n")),
        labels: labelsFor(worstOf(units), advisory, tag),
        severity: worstOf(units),
        advisory,
        scope: { grain: "page", pageId: UNATTRIBUTED_ID, pageName: UNATTRIBUTED_ID, url: "", basis: "none" },
      });
    }
  }

  return { tickets, unattributed: orphans.length };
}

function pageScopeOf(page: PageResult): Ticket["scope"] {
  return {
    grain: "page",
    pageId: page.id,
    pageName: page.name,
    url: page.url,
    ...(page.auth !== undefined ? { auth: page.auth } : {}),
    basis: page.basis,
  };
}
