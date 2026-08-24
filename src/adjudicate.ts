// `adjudicate` — the AI-adjudication workflow for the criteria the static engine cannot
// decide. Where the engine leaves a judgment/needs-rendering success criterion as a
// `manual` residual risk, this turns it into a WORKLIST: one entry per manual criterion,
// pre-loaded with the concrete evidence the engine already captured (every image's alt,
// every link's text + context, literal colour pairs, control labels…). The AI agent reads
// the evidence and records a verdict — C / NC / NA / manual — with a justification (for C
// and NA), a groundable finding (for NC), or a reason (for a still-`manual` residual that
// truly needs a rendered DOM via `scan`, or is genuinely undecidable). `applyAdjudication`
// folds the verdicts back into the audit, FAIL-CLOSED: no null verdict, no unjustified
// C/NA, no ungroundable NC, no reasonless manual, full coverage of the residual set. The
// decisions are the AGENT's, statically, gated — not a deferral to a human.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AuditResult, Automatability, CriterionCitation, Finding, Lang, PackCriterionAdjudication, ResidualRisk, Severity, Status } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";
import { discover } from "./discover.js";
import { readText } from "./util.js";
import { parseSource } from "./parse/source.js";
import { attachSignals, snapshotPageId } from "./snapshot.js";
import { loadConfig } from "./config.js";
import { type Harvested, harvestSubjects, isSnapshotFile, PACK_SUBJECTS, pageOfDoc, SC_SUBJECTS } from "./adjudicate-subjects.js";
import type { Doc } from "./parse/html.js";
import { ADJUDICATION, adjudicationForWcagRefs } from "./adjudication-data.js";
import { scTitle, getSC, hasSC, techniquesFor, allSC, guidelineTitle, understanding } from "./wcag.js";
import { groundFinding, type GroundingSummary } from "./grounding.js";
import {
  type StandardId,
  CORE,
  isCore,
  loadPack,
  hasId,
  getCriterion,
  derivePackResults,
  criterionUrl,
  glossaryAnchorsOf,
  localize,
  resolveGlossary,
  siblingCriteria,
  type StandardPack,
  type PackCriterion,
} from "./standards/index.js";
import { guidanceForCriterion } from "./guidance/index.js";
import { guidanceExampleBlock } from "./prd.js";
import { INAPPLICABLE_STATUS } from "./types.js";

/** Cap on CONTENT CLASSES shown per criterion — not on anchors.
 *
 *  The distinction is the whole point. A cap on anchors makes the evidence a sample, and a
 *  `C` over a sample is a conformity claim about elements nobody looked at. A cap on classes
 *  bounds the reading while keeping the population complete, because the population collapses:
 *  887 links over 38 captured pages are 97 distinct (text, href) pairs. When even the class
 *  count exceeds this, `evidenceComplete` goes false and the fold refuses a `C` outright —
 *  an incomplete reading may still find a real failure, it may never clear one. */
export const ADJUDICATE_MAX_EVIDENCE_CLASSES = 1200;

// The number is set by what a real application actually contains, measured, and then given
// room to grow. On a 338-file product with 38 captured pages the largest per-criterion
// populations run to 592 classes (what survives when CSS is off), 531 (reading order) and 487
// (structure) — and those ARE the populations, not samples of them.
//
// The headroom is the point. A cap sitting just above today's largest criterion is a gate
// that flips the day someone adds a heading: the criterion becomes unclearable for reasons of
// VOLUME rather than of uncertainty, which is the wrong reason to refuse a verdict and an
// especially confusing one, since nothing about the code got worse. Refusing to conclude is
// honest only when something really was not looked at.

/** Sibling anchors RENDERED per class. The data keeps them all — the citation gate reads that
 *  list to decide whether an anchor belongs to the criterion, so a bound here would make the
 *  gate refuse real occurrences for being ninth. Measured on a real run: 31 of 37 refusals
 *  were citations of elements the criterion genuinely carried. Only the reading is bounded. */
const ALSO_AT_SHOWN = 8;

/** Lines a citation may sit from the anchor it was given and still count as citing it. */
const CITE_DRIFT_DEFAULT = 10;

/** How much there actually was to look at, so a reader can tell a complete reading from a
 *  glance at the first few. */
export interface EvidencePopulation {
  /** Distinct content classes — what the agent is shown, one representative each. */
  classes: number;
  /** Raw anchors behind them. `occurrences` per class sums to this. */
  occurrences: number;
  files: number;
  pages: number;
}

export interface Evidence {
  file: string;
  line: number;
  selector: string;
  snippet: string;
  note?: string; // extra context the harvester surfaced (e.g. a link's nearest heading)
  /** Anchors sharing this content class — the same header link on 38 pages is one decision,
   *  not 38. Absent when the class has a single anchor. */
  occurrences?: number;
  /** Every other anchor of this class, as `file:line`. Complete on purpose: the citation gate
   *  reads it to decide membership, so a bound here would refuse real occurrences. The
   *  worklist renders only the first few (ALSO_AT_SHOWN). */
  alsoAt?: string[];
  /** Page ids this class appears on, when it was harvested from rendered captures. */
  pages?: string[];
}

export type CriterionVerdict = "C" | "NC" | "NA" | "manual" | null;

/** An agent-declared non-conformity — same shape a `Finding` needs to render + re-gate. */
export interface AgentFinding {
  file: string;
  line: number;
  selector?: string;
  message: string;
  snippet?: string;
  severity?: Severity;
  // The precise normative test the agent cites for an NC verdict — a WCAG SC id for the
  // core (e.g. "1.1.1"), or a pack criterion / test id when adjudicating a pack standard
  // (e.g. "1.1" or "1.1.1"). REQUIRED for any NC finding: `applyAdjudication` fail-closes
  // when it is absent or does not resolve against the active standard. A recommendation
  // (advisory) needs none — a good practice has no normative test by definition.
  normativeRef?: string;
}

export interface AdjudicationItem {
  criteriaId: string;
  automatability: Automatability;
  title?: string;
  evidence: Evidence[];
  /** What the harvest actually found, before collapsing to classes. */
  population?: EvidencePopulation;
  /** False when even the CLASS count exceeded the cap, so some distinct thing was never
   *  shown. A `C` is refused on such an item: a reading that skipped part of the population
   *  can report a failure it saw, but it cannot clear what it never looked at. */
  evidenceComplete?: boolean;
  evidenceTruncated?: { shown: number; total: number };
  /** The markup the harvest actually found, as flat tokens (see `Harvested.markup`). Read by
   *  the brief to say which of the criterion's numbered tests the evidence TOUCHES — never to
   *  say which it does not. Derived, so `hydrateAdjudication` restores it with the evidence. */
  markup?: string[];
  verdict: CriterionVerdict; // the agent fills this
  justification: string; // REQUIRED for C and NA
  reason: string | null; // REQUIRED for a still-`manual` verdict ("needs-rendered-dom" | "undecidable")
  findings: AgentFinding[]; // REQUIRED (≥1, groundable, each with a normativeRef) for NC
  // What the agent CLEARED, for a C (or ruled out of scope, for an NA). The mirror image of
  // `findings`, and required for the same reason: without a slot to cite in, a conforming
  // verdict was pure prose, and the gate could only ever check that the prose was non-empty
  // — so a model answering "C" to everything with the justification "x" passed, and the
  // report published 91 conformant criteria nobody had assessed.
  //
  // Each citation must ground (the file/line/snippet must resolve, exactly like an NC
  // finding) AND match one of this item's own `evidence` anchors by file+line — that pairing
  // is what turns "cite something real" into "cite the evidence you were shown". When the
  // harvester found no evidence at all there is nothing to clear, and the honest verdicts
  // are `manual` or `NA`, never `C`.
  // Objects are what the contract asks for; a bare `"file:line"` string is accepted too,
  // because that is the shape the worklist's own `alsoAt` uses and a real run reached for it.
  // See `readCitation` — the gate is identical either way, a string just carries no snippet.
  citations?: (Evidence | string)[];
  // Non-normative good practices the agent noted on this criterion — folded back into the
  // audit as ADVISORY findings (grounded exactly like an NC finding, but never affecting
  // status: they cannot flip the criterion to NC nor enter conformancePct). Optional.
  recommendations?: AgentFinding[];
  decidedBy: "agent";
}

export interface AdjudicationFile {
  tool: "ultra11y";
  kind: "adjudication";
  schemaVersion: number;
  standard: StandardId;
  auditDate: string;
  // The contract, carried BY the worklist. Whoever fills this file — an agent in a coding
  // harness, an orchestrator's tool node, a script — reads the file, not ultra11y's source,
  // so the file has to say what a verdict may be and what each one additionally requires.
  // Advisory to the reader, never read back by `applyAdjudication` (which validates against
  // its own constants), so a hand-edited or stale header can never widen what is accepted.
  contract?: AdjudicationContract;
  items: AdjudicationItem[];
}

/** What the filler of an adjudication file is allowed to write, stated in the file. */
export interface AdjudicationContract {
  verdicts: readonly string[];
  manualReasons: readonly string[];
  requires: Record<string, string>;
}

/** The contract as written into every worklist. Derived from the same constants the gate
 *  validates against, so the two cannot drift. */
export function adjudicationContract(): AdjudicationContract {
  return {
    verdicts: [...VERDICTS],
    manualReasons: [...MANUAL_REASON_VALUES],
    requires: {
      C: "a non-empty justification AND citations[] naming the harvested evidence it cleared (each anchor resolvable and drawn from this criterion's own evidence, and about the same kind of element the harvest recorded there — copy the evidence's own `snippet` rather than retyping the element); a criterion with no harvested evidence cannot be C at all",
      NA: "a non-empty justification, and citations[] whenever evidence was presented — a criterion whose subject exists NOWHERE in the audited scope is NA, never NC",
      NC: "at least one groundable finding, each naming the `file` it was observed in (an NC with no location is refused as flatly as an uncited C — and a non-conformity that rests on an ABSENCE is still observed on an element of a page, so cite that element) and each citing a normativeRef that resolves against the active standard",
      manual: `a reason ∈ {${MANUAL_REASON_VALUES.join(", ")}}`,
    },
  };
}

/** Resolve the audit's scope inputs back to parsed docs (harvesting reads the same files
 *  the audit did — run `verify --manual` from the audit's cwd). Best-effort: unreadable /
 *  vanished files are skipped, exactly like the audit's own read loop. */
function docsForAudit(audit: AuditResult, cwd?: string): Doc[] {
  const inputs = audit.scope.inputs.filter((i) => i !== "-" && i !== "<stdin>");
  if (!inputs.length) return [];
  const { files } = discover(inputs, {});
  const docs: Doc[] = [];
  for (const f of files) {
    try {
      // `resolve`, not `join`: a cwd resolves RELATIVE paths and must leave an absolute one
      // alone. `join("/repo", "/tmp/x/page.html")` produced `/repo/tmp/x/page.html`, which is
      // unreadable — and the catch below swallows it, so every criterion silently arrived with
      // ZERO evidence. The gate then refused each C verdict for "no evidence harvested",
      // blaming the adjudicator for a path bug. Grounding has always used `resolve` for the
      // same reason; these two must agree, since one harvests the anchors the other checks.
      const doc = parseSource(readText(cwd ? resolve(cwd, f) : f), f);
      // A page snapshot is a DIRECTORY of signals (computed styles, boxes, stylesheets, the
      // screenshot), not a lone .html — and `parseSource` only reads the DOM. Without this
      // call the harvest sees every captured page as inert markup, so a criterion decided on
      // what the browser MEASURED (an image of text, a target's size, a sticky header over a
      // focused element) arrived with nothing to rule on. `runAudit` has always attached them
      // (src/audit.ts); the two must agree, since one harvests the anchors the other checks.
      attachSignals(doc);
      docs.push(doc);
    } catch {
      /* unreadable — skip, mirrors runAudit */
    }
  }
  return docs;
}

/** The numbers that decide how much of a criterion is shown and how strictly a citation is
 *  read. Every one of them was a constant compiled into the engine, and every one is a
 *  judgement about a CODEBASE rather than a fact about accessibility — so the audited
 *  repository owns them, through `.ultra11yrc.json`. Absent ⇒ these defaults, which is what
 *  every repository that never opens the question keeps. */
export interface AdjudicationLimits {
  maxClasses: number;
  showAlsoAt: number;
  citationDrift: number;
}

export const ADJUDICATION_DEFAULTS: AdjudicationLimits = {
  maxClasses: ADJUDICATE_MAX_EVIDENCE_CLASSES,
  showAlsoAt: ALSO_AT_SHOWN,
  citationDrift: CITE_DRIFT_DEFAULT,
};

/** Read them from the audited repository, falling back to the defaults per field — a config
 *  that sets one number must not silently reset the others. */
export function adjudicationLimits(cwd?: string): AdjudicationLimits {
  const cfg = loadConfig(cwd ?? ".")?.adjudication;
  if (!cfg) return ADJUDICATION_DEFAULTS;
  const positive = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback);
  return {
    maxClasses: positive(cfg.maxClasses, ADJUDICATION_DEFAULTS.maxClasses),
    showAlsoAt: positive(cfg.showAlsoAt, ADJUDICATION_DEFAULTS.showAlsoAt),
    // 0 is meaningful here (exact-anchor matching), so it is allowed through.
    citationDrift:
      typeof cfg.citationDrift === "number" && Number.isFinite(cfg.citationDrift) && cfg.citationDrift >= 0
        ? Math.floor(cfg.citationDrift)
        : ADJUDICATION_DEFAULTS.citationDrift,
  };
}

/** Collapse harvested anchors to one representative per CONTENT CLASS, and record how big
 *  the population really was.
 *
 *  The old shape was `harvested.slice(0, 30)` — a SAMPLE. A `C` over a sample is a claim
 *  about a population nobody looked at, and the numbers were not close: measured on a real
 *  audit, RGAA 11.1 was ruled on 30 of 2652 anchors, none of them from a rendered page. But
 *  the population is only large when counted as occurrences. 887 links across 38 captured
 *  pages are 97 distinct (text, href) pairs; 47 images are 8 distinct (alt, src) pairs. One
 *  representative per class, with its occurrence count, is therefore the WHOLE population,
 *  said once per distinct thing — which is what makes an honest `C` reachable at all. */
function collapse(
  harvested: Harvested[],
  limits: AdjudicationLimits,
): { evidence: Evidence[]; population: EvidencePopulation; complete: boolean; markup: string[] } {
  const byClass = new Map<string, Harvested[]>();
  for (const item of harvested) {
    const g = byClass.get(item.cls);
    if (g) g.push(item);
    else byClass.set(item.cls, [item]);
  }
  const groups = [...byClass.values()];
  const evidence = groups.slice(0, limits.maxClasses).map((group) => {
    // Prefer a RENDERED anchor as the representative: it proves what the browser actually
    // produced, and it is intrinsically page-scoped. The source anchor that produced it is
    // not lost — it travels in `alsoAt`, which is what someone editing the fix needs.
    const rep = group.find((x) => isSnapshotFile(x.ev.file)) ?? group[0]!;
    const others = group.filter((x) => x !== rep);
    const pages = [...new Set(group.map((x) => pageOfDoc(x.ev.file)).filter((x): x is string => x !== undefined))];
    return {
      ...rep.ev,
      ...(group.length > 1 ? { occurrences: group.length } : {}),
      ...(others.length ? { alsoAt: others.map((x) => `${x.ev.file}:${x.ev.line}`) } : {}),
      ...(pages.length ? { pages } : {}),
    };
  });
  return {
    evidence,
    population: {
      classes: groups.length,
      occurrences: harvested.length,
      files: new Set(harvested.map((x) => x.ev.file)).size,
      pages: new Set(harvested.map((x) => pageOfDoc(x.ev.file)).filter((x) => x !== undefined)).size,
    },
    complete: groups.length <= limits.maxClasses,
    // Over the WHOLE harvest, not the shown representatives: the cap drops classes, and a
    // mechanism that exists in the audited scope must not stop being reported because its
    // class fell past the limit. This only ever LIGHTS a test up, so erring wide is the safe
    // direction — see `testMarkupTokens`.
    markup: [...new Set(harvested.flatMap((x) => x.markup ?? []))].sort(),
  };
}

/** A pack criterion's automatability: the WORST among the success criteria it maps to. One
 *  needing a rendered DOM for any of them needs one, full stop. A criterion whose SCs are all
 *  outside the core (RGAA 8.1 → the removed 4.1.1) is still the agent's to decide from source.
 *
 *  Exported because the pack audit DOCUMENT (src/standards/document.ts) has to label its
 *  residual risks the same way this worklist labels its items — two answers for one criterion
 *  would have `audit --standard rgaa` and `verify --manual --standard rgaa` disagree about
 *  whether a browser is needed. */
export function packAutomatability(scs: readonly string[]): Automatability {
  const autos = scs.map((sc) => getSC(sc)?.automatability).filter((a): a is Automatability => !!a);
  return autos.includes("needs-rendering") ? "needs-rendering" : "judgment";
}

function blankItem(
  criteriaId: string,
  automatability: Automatability,
  title: string | undefined,
  harvested: Harvested[],
  limits: AdjudicationLimits,
): AdjudicationItem {
  const { evidence, population, complete, markup } = collapse(harvested, limits);
  return {
    criteriaId,
    automatability,
    ...(title ? { title } : {}),
    evidence,
    ...(markup.length ? { markup } : {}),
    population,
    evidenceComplete: complete,
    ...(complete ? {} : { evidenceTruncated: { shown: evidence.length, total: population.classes } }),
    verdict: null,
    justification: "",
    reason: null,
    findings: [],
    recommendations: [],
    decidedBy: "agent" as const,
  };
}

/** The subjects that decide a success criterion. Empty ⇒ the criterion has none declared,
 *  which `tests/harvest-coverage.test.ts` refuses for any criterion the engine hands over. */
const subjectsForSc = (sc: string): string[] => SC_SUBJECTS[sc] ?? [];

/** The subjects that decide a PACK criterion: its own when it declares them, else the union
 *  of its mapped success criteria's. The override is what stops RGAA 11.1 (are the fields
 *  labelled?) from being handed the page's heading outline because 1.3.1 happens to come
 *  first in its `wcag` list. */
function subjectsForPackCriterion(standard: StandardId, id: string, scs: string[]): string[] {
  const own = PACK_SUBJECTS[standard]?.[id];
  if (own) return own;
  const out: string[] = [];
  for (const sc of scs) for (const subject of subjectsForSc(sc)) if (!out.includes(subject)) out.push(subject);
  return out;
}

/** Build the adjudication worklist.
 *
 *  For the WCAG core: one item per residual-risk (manual) success criterion.
 *
 *  For a COUNTRY STANDARD: one item per PACK criterion that derives `manual` — which is where
 *  almost the whole standard lives (99 of RGAA's 106 criteria can only ever derive `manual`).
 *  Keying by the pack's own criteria is not cosmetic: it is what lets an item carry the
 *  criterion's numbered tests, and therefore what lets `normativeRefResolves` check a citation
 *  against THIS criterion's tests instead of accepting any id of the right shape. */
export function buildAdjudicationWorklist(audit: AuditResult, opts: { cwd?: string; standard?: StandardId } = {}): AdjudicationItem[] {
  const docs = docsForAudit(audit, opts.cwd);
  const standard = opts.standard;
  const limits = adjudicationLimits(opts.cwd);

  if (standard !== undefined && !isCore(standard)) {
    const pack = loadPack(standard);
    return derivePackResults(audit, standard)
      .filter((pc) => pc.status === "manual")
      .map((pc) => {
        const crit = getCriterion(pack, pc.id);
        const scs = crit?.wcag ?? pc.scs;
        return blankItem(
          pc.id,
          packAutomatability(scs),
          // THE STANDARD'S OWN LOCALE, not a literal "fr". Identical output for RGAA, which
          // publishes in French and only in French — but the PACK is what says so, and a
          // standard publishing in another language must not be titled through a locale this
          // call happened to name. `localize` rather than `titlePlain` because a pack's
          // locales are not the UI frame's `Lang`: casting one to the other to satisfy a
          // signature would be asserting something about a country standard that is not true.
          crit ? localize(pack, crit.titlePlain, pack.defaultLocale) : undefined,
          harvestSubjects(subjectsForPackCriterion(standard, pc.id, scs), docs),
          limits,
        );
      });
  }

  return audit.residualRisks.map((r: ResidualRisk) =>
    blankItem(r.criteriaId, r.automatability, scTitle(r.criteriaId) ?? undefined, harvestSubjects(subjectsForSc(r.criteriaId), docs), limits),
  );
}

/** THE CRITERIA THIS RUN COULD NOT POSSIBLY HAVE DECIDED — because nothing was rendered.
 *
 *  `applyAdjudication` already refuses a `needs-rendered-dom` verdict whose own evidence sits
 *  in a page capture: that is a deferral to a tier which has already run. This is the mirror,
 *  and it was the more expensive failure of the two. Measured on the 2026-08-20 RGAA cascade —
 *  three passes, 311 turns, $24.90 — seven criteria came back `needs-rendered-dom` and every
 *  one of them was RIGHT: the workflow audited sources only, and no page was ever snapshotted.
 *  Nothing in the run said so, so the bill bought the news that a step nobody had run had not
 *  run.
 *
 *  `scope.pagesAudited` is the evidence, and `undefined` is read as UNKNOWN rather than as
 *  none: an audit written before that field existed knows nothing either way, and a warning
 *  that fires on "unknown" is a warning people learn to scroll past. So the answer is empty
 *  unless we can say positively that no page's real DOM was read.
 *
 *  Advisory by construction — it returns a list, it does not refuse anything. A source-only
 *  audit is a legitimate thing to want, and a worklist is not where a project's scope gets
 *  decided; `check --require-rendered` is the opt-in that fails. */
export function unrenderedResidual(audit: AuditResult, items: AdjudicationItem[]): string[] {
  const audited = audit.scope.pagesAudited;
  const readSomePage = audited === undefined ? (audit.scope.pages ?? []).length > 0 : audited.length > 0;
  if (readSomePage) return [];
  return items.filter((it) => it.automatability === "needs-rendering").map((it) => it.criteriaId);
}

/** Read a citation whichever way it was written.
 *
 *  The contract asks for `{file, line, …}`, and a real run wrote `"src/Foo.tsx:15"` instead —
 *  63 verdicts refused for a shape, not for a claim. It is an unambiguous form and the
 *  worklist itself is full of it (`alsoAt` is exactly `file:line`), so an adjudicator
 *  reaching for it is being consistent, not careless.
 *
 *  Nothing about the gate moves: membership and grounding run on the result either way. A
 *  string simply carries no snippet, so grounding falls back to its selector/line checks —
 *  weaker evidence, and the reason the object form stays what the contract asks for. */
export function readCitation(c: Evidence | string): Evidence | null {
  if (typeof c !== "string") return c;
  const at = c.lastIndexOf(":");
  if (at <= 0) return null;
  const line = Number.parseInt(c.slice(at + 1), 10);
  if (!Number.isFinite(line)) return null;
  return { file: c.slice(0, at), line, selector: "", snippet: "" };
}

/** The files this audit actually read. Computed from the audit's own scope inputs, so it is
 *  the same set the harvest walked — `discover` only globs, it does not parse, so this costs
 *  little and is memoised per fold. */
function auditFiles(audit: AuditResult, cwd?: string): Set<string> {
  const inputs = audit.scope.inputs.filter((i) => i !== "-" && i !== "<stdin>");
  if (!inputs.length) return new Set();
  try {
    void cwd; // `discover` returns the same repo-relative paths the harvest anchors use
    return new Set(discover(inputs, {}).files);
  } catch {
    return new Set();
  }
}

/** Does this citation name evidence the criterion actually carries?
 *
 *  Same file, and within the drift `groundFinding` already tolerates. Exact line equality was
 *  too literal to be useful: the harvest anchors a <table> at line 19, the agent cites the
 *  <caption> at line 20 — which is the very thing RGAA 5.4 asks about, inside the element it
 *  was shown — and the gate called it fabricated. Measured on a real run, that class of
 *  refusal cost more criteria than every other cause combined.
 *
 *  What the check still catches is what it was written for: a citation pointing at a file the
 *  criterion was never given. And it is only half the gate — `groundFinding` still has to find
 *  the cited content in the real source, so a plausible-looking file:line in the right
 *  neighbourhood proves nothing on its own. */
/** The tag a citation or an anchor is about, from its snippet first and its selector second.
 *  Lowercased — HTML tag names are case-insensitive. Undefined when neither says. */
function tagOf(x: { snippet?: string; selector?: string }): string | undefined {
  const fromSnippet = /<\s*([a-zA-Z][\w-]*)/.exec(x.snippet ?? "");
  if (fromSnippet) return fromSnippet[1]!.toLowerCase();
  const fromSelector = /^\s*([a-zA-Z][\w-]*)/.exec(x.selector ?? "");
  return fromSelector ? fromSelector[1]!.toLowerCase() : undefined;
}

/** The distinctive words of a markup fragment: attribute VALUES and text, minus the noise.
 *
 *  Values and text, never attribute names — every `<a>` has an `href`, so names carry no
 *  identity. Short tokens go too: `""`, `en`, `0` are shared by half a document. */
function contentTokens(markup: string): Set<string> {
  const out = new Set<string>();
  const withoutTags = markup.replace(/<[^>]*>/g, " ");
  for (const m of markup.matchAll(/=\s*"([^"]*)"|=\s*'([^']*)'/g)) {
    for (const w of (m[1] ?? m[2] ?? "").split(/[\s/_-]+/)) if (w.length >= 3) out.add(w.toLowerCase());
  }
  for (const w of withoutTags.split(/[\s/_-]+/)) if (w.length >= 3) out.add(w.toLowerCase());
  return out;
}

/** Is the citation RECOGNISABLY the element the harvest recorded at that anchor?
 *
 *  This is what survives when byte-exact snippet matching is given up, and it has to do two
 *  jobs at once. An adjudicator that retypes an element — attributes reordered, `class` left
 *  off — named the right thing and must not be refused. An adjudicator that writes down a
 *  DIFFERENT element at the same anchor (another link, another href, another label) has not
 *  read what it claims to have read, and must be.
 *
 *  So: same tag, and at least one distinctive word in common — an attribute value or a word of
 *  the text. `<img alt="" src="/assets/help.svg">` against
 *  `<img src="/assets/help.svg" alt="" class="fr-responsive-img">` shares `assets` and
 *  `help.svg`; `<a href="/invented">Nowhere</a>` against `<a href="/pricing">Read more</a>`
 *  shares nothing at all.
 *
 *  Silence is not contradiction: a citation with no snippet, or an anchor whose markup carries
 *  no distinctive word (`<br>`), is judged on the tag alone. Membership and the anchor's own
 *  grounding still stand behind every one of them. */
function recognisablySame(cite: { snippet?: string; selector?: string }, anchor: { snippet?: string; selector?: string }): boolean {
  const ta = tagOf(cite);
  const tb = tagOf(anchor);
  if (ta !== undefined && tb !== undefined && ta !== tb) return false;
  if (!cite.snippet || !anchor.snippet) return true;
  const want = contentTokens(anchor.snippet);
  if (!want.size) return true;
  const got = contentTokens(cite.snippet);
  if (!got.size) return true;
  for (const w of got) if (want.has(w)) return true;
  return false;
}

/** How much of the anchor's distinctive content the citation repeats. 0 = nothing in common. */
function overlap(cite: { snippet?: string }, anchor: { snippet?: string }): number {
  if (!cite.snippet || !anchor.snippet) return 0;
  const want = contentTokens(anchor.snippet);
  if (!want.size) return 0;
  let n = 0;
  for (const w of contentTokens(cite.snippet)) if (want.has(w)) n++;
  return n;
}

/** The harvested anchor a citation resolves to, or undefined.
 *
 *  Two shapes, because a class carries two kinds of anchor. The REPRESENTATIVE has a snippet
 *  the engine read out of the file itself; a SIBLING in `alsoAt` is a bare `file:line` — the
 *  same content class at another occurrence, with no snippet recorded. Which one matched
 *  decides what can be grounded, so the caller is told.
 *
 *  CONTENT BREAKS THE TIE, because the line often cannot. A page snapshot is
 *  `documentElement.outerHTML`: one line, the whole document. Every anchor harvested from it
 *  therefore sits at line 2, so "the anchor at the cited line" names dozens of elements at
 *  once and taking the first is a coin toss — measured on a real run, that is how a citation
 *  of an `<img>` came to be checked against an `<svg>` and refused for describing the wrong
 *  element. So among the anchors the line admits, the one the citation actually describes
 *  wins; ties and empty overlaps keep document order, which is what a single-anchor file
 *  always did. */
function anchorFor(
  evidence: Evidence[],
  c: { file: string; line: number; snippet?: string },
  drift: number,
): { at: Evidence; representative: boolean } | undefined {
  const reps = evidence.filter((e) => e.file === c.file && Math.abs(e.line - c.line) <= drift);
  const best = (cands: Evidence[]): Evidence | undefined => {
    let top: Evidence | undefined;
    let score = -1;
    for (const e of cands) {
      const n = overlap(c, e);
      if (n > score) {
        score = n;
        top = e;
      }
    }
    return top;
  };
  const rep = best(reps);
  if (rep) return { at: rep, representative: true };
  const siblings = evidence.filter((e) => cites0(e.alsoAt ?? [], c, drift));
  const sib = best(siblings);
  return sib ? { at: sib, representative: false } : undefined;
}

function cites0(anchors: string[], c: { file: string; line: number }, drift: number): boolean {
  for (const a of anchors) {
    const at = a.lastIndexOf(":");
    if (at < 0) continue;
    if (a.slice(0, at) !== c.file) continue;
    const line = Number.parseInt(a.slice(at + 1), 10);
    if (Number.isFinite(line) && Math.abs(line - c.line) <= drift) return true;
  }
  return false;
}

export interface ApplyAdjudicationResult {
  ok: boolean;
  audit: AuditResult;
  issues: string[];
  applied: number;
  stillManual: number;
  /** Criteria whose verdict was REFUSED by the gate and therefore not applied. They stay
   *  « to assess », each carrying the refusal as its residual reason. Always 0 in strict mode,
   *  where a single refusal discards the whole fold. */
  rejected: number;
  /** The ids behind `rejected`, in file order — so a caller can name them without re-parsing
   *  `issues` (one criterion can raise several). */
  rejectedCriteria: string[];
  grounding: GroundingSummary;
}

const NC_SEVERITY_DEFAULT: Severity = "majeur";
const MANUAL_REASONS = new Set(["needs-rendered-dom", "undecidable"]);

/** The verdicts an adjudication may carry, in the exact spelling the file must use. Exported
 *  because it is a CONTRACT, not an implementation detail: the worklist declares it in its own
 *  header and the rejection message names it, so whoever fills the file never has to read this
 *  source to learn what they are allowed to write. */
export const VERDICTS = ["C", "NC", "NA", "manual"] as const;
/** The reasons a still-`manual` verdict may cite — same contract, same reason to export it. */
export const MANUAL_REASON_VALUES = ["needs-rendered-dom", "undecidable"] as const;

/** Canonicalise a verdict written in any case ("na", "Nc", "MANUAL" → "NA", "NC", "manual").
 *
 *  Three of the four verdicts are upper-case and the fourth is not, which is exactly the kind
 *  of detail an agent filling the worklist gets wrong — and it used to cost the entire run,
 *  because `applyAdjudication` fail-closes on an unknown verdict. Case carries no meaning
 *  here: "na" can only ever mean NA. What stays rejected is a verdict outside the vocabulary,
 *  which is a real disagreement about the contract rather than a spelling accident. Returns
 *  undefined when there is no match. */
export function normalizeVerdict(v: unknown): Exclude<CriterionVerdict, null> | undefined {
  if (typeof v !== "string") return undefined;
  const k = v.trim().toLowerCase();
  return VERDICTS.find((x) => x.toLowerCase() === k);
}

/** The same tolerance for a `manual` verdict's reason. */
function normalizeManualReason(r: unknown): string | undefined {
  if (typeof r !== "string") return undefined;
  const k = r.trim().toLowerCase();
  return MANUAL_REASON_VALUES.find((x) => x === k);
}

/** Rewrite an adjudication's verdicts and manual reasons into their canonical spelling, in
 *  place. Anything unrecognised is left untouched, so the per-item validation below still
 *  reports it as the contract violation it is — this normalises spelling, it never invents a
 *  decision the file did not carry. */
export function canonicalizeAdjudication(adj: AdjudicationFile): AdjudicationFile {
  for (const it of adj.items) {
    if (it.verdict !== null) {
      const v = normalizeVerdict(it.verdict);
      if (v !== undefined) it.verdict = v;
    }
    if (it.reason !== null && it.reason !== undefined) {
      const r = normalizeManualReason(it.reason);
      if (r !== undefined) it.reason = r;
    }
  }
  return adj;
}

/** Does an NC finding's `normativeRef` resolve against the ACTIVE standard?
 *
 *  Core: a real success-criterion id (reuses `hasSC`).
 *
 *  Pack: the criterion the ref names must be `itemCriterionId` ITSELF — either cited bare
 *  ("11.2") or as one of its own tests ("11.2.1").
 *
 *  That last constraint is load-bearing, not pedantry. A pack test id has the same `N.N.N`
 *  shape as a WCAG success criterion, so a laxer check accepted the WCAG id an agent would
 *  naturally reach for and silently read it as an unrelated pack test: citing "1.4.3"
 *  (Contrast Minimum) resolved as RGAA test 1.4.3, which is about CAPTCHA images. Binding the
 *  citation to the item's own criterion removes the collision entirely.
 *
 *  Fail-closed: an absent/blank/unresolvable ref fails the whole adjudication (mirrors
 *  verify.ts). */
function normativeRefResolves(ref: string | undefined, standard: StandardId, itemCriterionId?: string): boolean {
  const r = (ref ?? "").trim();
  if (!r) return false;
  if (isCore(standard)) return hasSC(r);
  const pack = loadPack(standard);
  // Which criterion does the ref name? Either the criterion itself, or "<criterion>.<test>".
  let critId = hasId(pack, r) ? r : undefined;
  let testKey: string | undefined;
  if (critId === undefined) {
    const dot = r.lastIndexOf(".");
    if (dot <= 0) return false;
    const head = r.slice(0, dot);
    if (!hasId(pack, head)) return false;
    critId = head;
    testKey = r.slice(dot + 1);
  }
  const crit = getCriterion(pack, critId);
  if (!crit) return false;
  if (testKey !== undefined && !(crit.tests && Object.hasOwn(crit.tests, testKey))) return false;
  // The citation must belong to the criterion being adjudicated.
  return itemCriterionId === undefined || critId === itemCriterionId;
}

/** Fold an adjudication file back into the audit. Returns a NEW AuditResult with the decided
 *  statuses, agent findings, recomputed conformancePct, a shrunk residual set, and the
 *  `adjudicated` marker.
 *
 *  FAIL-CLOSED PER VERDICT, which is not the same thing as fail-closed per FILE. Every check
 *  below is unchanged and no refused verdict is ever applied — but a refusal now costs its own
 *  criterion and nothing else. The all-or-nothing fold was measured to be worse than useless:
 *  a CI run that filled 95 of 96 verdicts correctly had all 96 discarded, so the audit paid a
 *  full adjudication and published « to assess » across the board. Since the point of the gate
 *  is to keep an unproven verdict out of the report — not to punish the ones that proved
 *  themselves — a refused criterion simply stays « to assess », carrying the refusal as its
 *  residual reason so the next run knows what to fix.
 *
 *  `strict: true` restores the old file-level behaviour for a caller that genuinely wants
 *  all-or-nothing (a conformance deliverable signed off in one pass). */
export function applyAdjudication(
  audit: AuditResult,
  adj: AdjudicationFile,
  opts: {
    cwd?: string;
    strict?: boolean;
    /** Criteria the caller KNOWS this adjudication does not cover, each with the reason to
     *  record. A ledger replay supplies them (« stale », « never adjudicated ») so an absence
     *  it fully expected is not reported as a coverage violation — while the criterion still
     *  stays to assess, carrying that reason instead of a blank cell. */
    residualReasons?: Record<string, string>;
  } = {},
): ApplyAdjudicationResult {
  const issues: string[] = [];
  const expected = opts.residualReasons ?? {};
  // Per-criterion attribution. The gate used to collect one flat list, which is why it could
  // only ever reject the whole file: an issue did not know which verdict it condemned.
  const itemIssues = new Map<string, string[]>();
  // Criteria that will NOT fold and must keep `manual` with a reason — the refused ones plus
  // the ones the caller declared uncovered.
  const notFolded = new Set<string>();
  const blame = (criteriaId: string, issue: string) => {
    issues.push(issue);
    notFolded.add(criteriaId);
    const list = itemIssues.get(criteriaId);
    if (list) list.push(issue);
    else itemIssues.set(criteriaId, [issue]);
  };
  /** An open criterion this adjudication deliberately does not carry. Not a gate violation. */
  const uncovered = (criteriaId: string) => notFolded.add(criteriaId);
  // Spelling first, decisions second: "na" is NA, and rejecting the run over the case of a
  // verdict taught the caller nothing about accessibility. Everything below stays fail-closed.
  canonicalizeAdjudication(adj);
  const byId = new Map(adj.items.map((it) => [it.criteriaId, it]));

  // Coverage. Under the core that means every residual success criterion; under a pack it
  // means every pack criterion that derives `manual` — the pack's own granularity, which is
  // what the worklist was built at.
  const packMode = !isCore(adj.standard);
  const open = new Set<string>();
  if (packMode) {
    for (const pc of derivePackResults(audit, adj.standard)) {
      if (pc.status !== "manual") continue;
      open.add(pc.id);
      if (byId.has(pc.id)) continue;
      if (Object.hasOwn(expected, pc.id)) uncovered(pc.id);
      else blame(pc.id, `criterion ${pc.id}: missing from the adjudication (coverage gap)`);
    }
  } else {
    for (const r of audit.residualRisks) {
      open.add(r.criteriaId);
      if (byId.has(r.criteriaId)) continue;
      if (Object.hasOwn(expected, r.criteriaId)) uncovered(r.criteriaId);
      else blame(r.criteriaId, `criterion ${r.criteriaId}: missing from the adjudication (coverage gap)`);
    }
  }

  // …and the other direction. The coverage check above only proves every open criterion was
  // ruled on; it says nothing about a SURPLUS item. That mattered: the fold resolved a
  // criterion by id against the whole audit, so an extra `{criteriaId: "3.1.1", verdict:
  // "C"}` overwrote a non-conformity the deterministic engine had decided — no finding, no
  // citation, no normativeRef. Adjudication may only ever decide what the engine left open.
  for (const it of adj.items) {
    if (!open.has(it.criteriaId)) {
      blame(it.criteriaId, `criterion ${it.criteriaId}: not open for adjudication — the engine already decided it, or it is not part of ${adj.standard}`);
    }
  }

  // Per-item fail-closed validation. Grounding inputs are collected PER ITEM (not into one
  // flat list) for the same reason as `blame`: a failed citation has to condemn its own
  // criterion and no other.
  type Ground = { file: string; line: number; selector?: string; snippet?: string };
  const groundInputs = new Map<string, { g: Ground; fallback?: Ground }[]>();
  // Memoised: only a citation that missed its criterion's own anchors ever asks for it.
  let scopeCache: Set<string> | undefined;
  const { citationDrift } = adjudicationLimits(opts.cwd);
  const scopeFiles = (): Set<string> => (scopeCache ??= auditFiles(audit, opts.cwd));
  // Which pack criteria the ENGINE already ruled non-conformant, indexed by the exact anchor
  // it ruled them on. Memoised: only an NC on a criterion that HAS a mechanical neighbour ever
  // asks for it, which is a minority of a worklist. `agent:` findings are excluded on purpose
  // — this asks what the deterministic engine established, not what a previous pass claimed.
  let engineNcCache: Map<string, Set<string>> | undefined;
  const engineNcAt = (key: string): ReadonlySet<string> => {
    if (!engineNcCache) {
      engineNcCache = new Map();
      if (!isCore(adj.standard)) {
        for (const pc of derivePackResults(audit, adj.standard)) {
          if (pc.status !== "NC") continue;
          for (const f of pc.findings) {
            if (f.advisory || f.ruleId.startsWith("agent:")) continue;
            const k = anchorKey(f.file, f.line, f.selectorHint);
            (engineNcCache.get(k) ?? engineNcCache.set(k, new Set()).get(k)!).add(pc.id);
          }
        }
      }
    }
    return engineNcCache.get(key) ?? EMPTY_IDS;
  };
  const toGround = (
    criteriaId: string,
    g: { file: string; line: number; selector?: string; snippet?: string },
    fallback?: { file: string; line: number; selector?: string; snippet?: string },
  ) => {
    const entry = { g, ...(fallback ? { fallback } : {}) };
    const list = groundInputs.get(criteriaId);
    if (list) list.push(entry);
    else groundInputs.set(criteriaId, [entry]);
  };
  for (const it of adj.items) {
    const v = it.verdict;
    if (v === null) {
      blame(it.criteriaId, `criterion ${it.criteriaId}: unadjudicated (verdict is null)`);
    } else if (v === "C" || v === "NA") {
      if (!it.justification?.trim()) blame(it.criteriaId, `criterion ${it.criteriaId}: a ${v} verdict requires a justification`);
      // A clearing verdict is gated exactly like an accusing one. Before this, the only
      // check was "the justification is a non-empty string", so `"x"` cleared a criterion —
      // and a model answering C to everything published a conformance nobody had assessed.
      const cites = (it.citations ?? []).map(readCitation).filter((c): c is Evidence => c !== null);
      // An INCOMPLETE reading may report a failure it saw; it may never clear what it never
      // looked at. Before class-based harvesting the evidence was a 30-anchor sample of a
      // population that ran to thousands, so a `C` was routinely a conformity claim over
      // elements nobody had been shown. Clearing is the direction that needs the whole set.
      if (v === "C" && it.evidenceComplete === false) {
        blame(
          it.criteriaId,
          `criterion ${it.criteriaId}: a C verdict needs the COMPLETE evidence set, and this criterion's harvest was capped at ${it.evidence.length} of ${it.population?.classes ?? "?"} content classes — record "manual", or "NC" if what you did see fails`,
        );
      }
      if (it.evidence.length === 0) {
        // Nothing was harvested for this criterion, so there is nothing the agent could have
        // read to clear it. `NA` is still legitimate (the honest "no element in scope is
        // concerned"); `C` is not — it must stay `manual` and be ruled on against the
        // criterion's own tests, from a rendered capture or by hand.
        if (v === "C") {
          blame(
            it.criteriaId,
            `criterion ${it.criteriaId}: a C verdict needs evidence to cite, and none was harvested for this criterion — record "manual" (reason "undecidable"), or "NA" if nothing in scope is concerned`,
          );
        }
      } else if (cites.length === 0 && v === "C") {
        // Only a `C` must cite. A `C` says "everything here conforms", so it has to name what
        // it cleared; an `NA` says "none of this is what the criterion is about", and there is
        // nothing to clear — asking it to cite the very elements it just ruled out of scope is
        // a contradiction, and one the engine does not hold ITSELF to: an engine-proved NA
        // (src/audit.ts subjectMatterReason) carries a justification naming what was searched
        // for, and no citations at all. Measured on a real run, six criteria were refused for
        // this alone, each of them an honest NA.
        //
        // The justification is what keeps an NA falsifiable, and it is still required above.
        blame(
          it.criteriaId,
          `criterion ${it.criteriaId}: a C verdict must cite at least one of the ${it.evidence.length} evidence item(s) it was shown (citations: [{file, line, …}])`,
        );
      } else if (cites.length > 0) {
        // Each citation must name evidence THIS item carried. Grounding alone would only
        // prove the anchor exists somewhere in the tree; the pairing proves the agent ruled
        // on what it was actually given.
        // The anchor set is every occurrence of a class this criterion carries — the
        // representative AND its siblings — not the representatives alone.
        //
        // The check proves "you ruled on what you were given". Matching only representatives
        // proved something narrower and wrong: a class holds one anchor per rendered page, an
        // agent with file access naturally cites the occurrence it opened, and the gate then
        // called a real, grounded `file:line` fabricated. Measured on a real run, that is
        // exactly how RGAA 5.8, 9.2 and 11.1 were refused. Membership was the defect;
        // grounding — which proves the citation resolves against real source — is unchanged
        // and still runs on every one of them.
        const anchors = it.evidence.flatMap((e) => [`${e.file}:${e.line}`, ...(e.alsoAt ?? [])]);
        for (const c of cites) {
          // Two ways to belong, and the second one is what a good adjudicator does.
          //
          // The harvest anchors a rendered page (`.ultra11y/pages/<id>/dom.html`) because that
          // is what proves the browser's output — but the place a reader goes to FIX it is the
          // component that produced it, and that is what the agent naturally cites. Measured
          // on a real run: 15 of the 16 citations still refused after the drift tolerance were
          // in files this audit had read, pointing at the source behind the evidence. Refusing
          // them called correct work fabricated.
          //
          // So a citation also belongs when it lands in a file the audit read. That is a real
          // bound — a file outside the audited scope is still refused — and it is not the last
          // one: `groundFinding` below still has to find the cited content at that file:line in
          // the real source, which is what "not fabricated" actually means.
          if (!cites0(anchors, c, citationDrift) && !scopeFiles().has(c.file)) {
            blame(it.criteriaId, `criterion ${it.criteriaId}: citation ${c.file}:${c.line} is not among this criterion's harvested evidence (fabricated?)`);
          }
          // GROUND THE ANCHOR, NOT THE TRANSCRIPTION.
          //
          // Once a citation lands on evidence this criterion was shown, the harvested anchor is
          // the ground truth: the engine read it out of the file, so it is there by
          // construction. Re-checking the agent's RETYPING of it against the file tests
          // spelling, not evidence — and it fails constantly, because an adjudicator writes the
          // element out from the brief rather than copying the `snippet` field byte for byte.
          //
          // Measured on a real run: 81 criteria adjudicated, 78 of 82 citations landing exactly
          // on a harvested anchor, and 54 verdicts refused — every one of them for
          // `cited snippet not found`. A rendered snapshot serializes the document on ONE line,
          // so its anchors all sit at line 2 and the grounding window is the whole page: what
          // failed was never the location, only the transcription of it.
          //
          // A sibling from `alsoAt` carries no snippet (it is a bare `file:line`), so there is
          // nothing authoritative to ground — the selector probe runs against the real file
          // instead, which is the same check a citation with no snippet has always had.
          //
          // Anything OUTSIDE the harvest keeps the strict check below, unchanged. That is where
          // a fabricated location would hide, and this must not become a way to launder one.
          // THE CITATION FIRST, THE ANCHOR ONLY AS A FALLBACK — and the order is the whole
          // point.
          //
          // Whatever the agent wrote is checked against the real file, exactly as before. That
          // is the strongest proof there is, and it covers the case the drift window exists
          // for: RGAA 5.2 asks about a table's summary, the harvest anchors the `<table>`, and
          // the honest citation is the `<caption>` a line below. Grounding the anchor INSTEAD
          // refused precisely that — measured on a real run, 5.2, 5.4, 5.5, 11.6, 11.7 and
          // 11.9 all died on it, each a correct citation of a neighbour.
          //
          // Only when the citation does not ground — which is what a RETYPING looks like, and
          // on a one-line snapshot that is most of them — does the harvested anchor stand in.
          // It is authoritative there: the engine read it out of the file itself. And only
          // then does recognisability have anything to say, because only then is the anchor
          // being used to vouch for something the file did not confirm on its own.
          const anchor = anchorFor(it.evidence, c, citationDrift);
          const cite = { file: c.file, line: c.line, selector: c.selector, snippet: c.snippet };
          if (anchor && recognisablySame(c, anchor.at)) {
            toGround(
              it.criteriaId,
              cite,
              anchor.representative
                ? { file: anchor.at.file, line: anchor.at.line, selector: anchor.at.selector ?? c.selector, snippet: anchor.at.snippet }
                : { file: c.file, line: c.line, selector: anchor.at.selector ?? c.selector },
            );
          } else {
            toGround(it.criteriaId, cite);
          }
        }
      }
    } else if (v === "NC") {
      if (!it.findings || it.findings.length === 0)
        blame(
          it.criteriaId,
          `criterion ${it.criteriaId}: an NC verdict requires at least one groundable finding — { file, line, message, snippet, normativeRef } pointing at a real anchor from this criterion's own evidence`,
        );
      for (const f of it.findings ?? []) {
        // AN NC NOBODY CAN OPEN IS NOT A FINDING. Checked before the normativeRef, because a
        // finding with no file cannot be grounded at all — there is nothing to go and read.
        // Measured once: a model returned an NC with no `file`, the fold minted it anyway, and
        // it reached `repoRelative`, which crashed on `undefined.split` and took SARIF, the
        // annotations, the comment, the report, the HTML and the artifact upload with it.
        if (typeof f.file !== "string" || !f.file.trim()) {
          blame(
            it.criteriaId,
            `criterion ${it.criteriaId}: an NC finding must name the file it was observed in — nobody can act on a non-conformity with no location. An absence is still observed somewhere: cite the element and the page you observed it on, with the file, line and snippet copied from this criterion's own evidence. If the subject exists nowhere in scope, the verdict is NA with a justification, not NC.`,
          );
          continue;
        }
        // FAIL-CLOSED: every NC finding must cite a precise, resolvable test of the active
        // standard. A good practice with no normative test is a recommendation, not an NC.
        if (!f.normativeRef?.trim()) {
          blame(it.criteriaId, `criterion ${it.criteriaId}: an NC finding requires a normativeRef citing the failed test of the active standard`);
        } else if (!normativeRefResolves(f.normativeRef, adj.standard, isCore(adj.standard) ? undefined : it.criteriaId)) {
          blame(
            it.criteriaId,
            isCore(adj.standard)
              ? `criterion ${it.criteriaId}: normativeRef "${f.normativeRef}" does not resolve to a test of ${adj.standard} (fabricated?)`
              : `criterion ${it.criteriaId}: normativeRef "${f.normativeRef}" is not a test of ${adj.standard} ${it.criteriaId} — cite one of its own tests (e.g. "${it.criteriaId}.1"); a WCAG id looks alike but denotes an unrelated test`,
          );
        }
        // THE SAME DEFECT, CHARGED TWICE.
        //
        // A field with no label is RGAA 11.1's non-conformity, and the engine finds it with no
        // model in the loop. 11.2 asks whether the label is RELEVANT, and every one of its six
        // tests opens on a label that exists — so on that field it has no subject, and « no
        // label here » filed under 11.2 is the neighbour's finding wearing the wrong number.
        // The gate above cannot see it: 11.2.1 really is a test of 11.2, and the citation
        // really does ground.
        //
        // Narrow on purpose, and this is the one check here that could refuse a true finding.
        // It fires only when all three hold: the criterion under verdict has a MECHANICAL
        // neighbour (`siblingCriteria` — same theme, shared success criterion, opposite side of
        // the line, which by construction means this criterion carries no engine rule of its
        // own), the engine has already ruled that neighbour non-conformant, and the anchor is
        // literally the same file, line and selector. Two criteria failing the same element for
        // genuinely different reasons keep different anchors, or the neighbour is not
        // mechanical, and neither reaches here.
        //
        // Refused per verdict like everything else: the criterion returns to « to assess »
        // carrying the reason, naming the neighbour, so the next pass can file it correctly.
        if (!isCore(adj.standard) && f.file?.trim()) {
          const mechanical = siblingCriteria(loadPack(adj.standard), it.criteriaId).filter((sib) => sib.role === "mechanical");
          if (mechanical.length) {
            const owners = engineNcAt(anchorKey(f.file, f.line, f.selector ?? ""));
            const clash = mechanical.find((sib) => owners.has(sib.id));
            if (clash)
              blame(
                it.criteriaId,
                `criterion ${it.criteriaId}: this anchor (${f.file}:${f.line}) is already the engine's non-conformity on ${adj.standard} ${clash.id} — « ${clash.title} ». ${it.criteriaId} asks the NEXT question about the same subject and presupposes it is there, so on this element it is not non-conformant: it has no subject. Report it on ${clash.id} (the engine already did), or rule ${it.criteriaId} on a different element.`,
              );
          }
        }
        toGround(it.criteriaId, { file: f.file, line: f.line, selector: f.selector, snippet: f.snippet });
      }
    } else if (v === "manual") {
      if (!it.reason || !MANUAL_REASONS.has(it.reason))
        blame(it.criteriaId, `criterion ${it.criteriaId}: a manual verdict requires reason ∈ {${MANUAL_REASON_VALUES.join(", ")}}`);
      // `needs-rendered-dom` IS A DEFERRAL TO THE RENDERED TIER, and it is unfounded once the
      // rendered page is on disk.
      //
      // The worklist already tells the adjudicator so, in both languages: « `needs-rendered-dom`
      // reste la bonne réponse pour un critère dont aucune capture ne porte le sujet, et pour
      // lui seul ». Nothing enforced it, so a pass could hand the criterion back to a tier that
      // has already run and the criterion stayed « à évaluer » forever. Measured on egapro:
      // RGAA 3.1 came back `needs-rendered-dom` on an audit carrying 37 captures, with its own
      // evidence anchored in `.ultra11y/pages/<id>/dom.html` — the very files it said it needed.
      //
      // Refused, so the criterion returns to the next pass carrying the refusal. `undecidable`
      // stays available and is the honest answer when the capture genuinely does not settle it
      // — what is refused is the deferral, not the difficulty.
      else if (it.reason === "needs-rendered-dom" && it.evidence.some((e) => snapshotPageId(e.file) !== undefined))
        blame(
          it.criteriaId,
          `criterion ${it.criteriaId}: "needs-rendered-dom", but this criterion's own evidence is anchored in a page capture — the rendered page is on disk under .ultra11y/pages/<id>/ (dom.html, styles.json, boxes.json, axtree.json, screen.png). Decide it from those files, or answer "undecidable" and say what the capture does not settle.`,
        );
    } else {
      // Name the vocabulary in the rejection. The caller is usually a model that has just
      // spent a whole worklist filling this file; "unknown verdict" alone told it nothing
      // about how to be right on the retry.
      blame(it.criteriaId, `criterion ${it.criteriaId}: unknown verdict "${String(v)}" — expected one of ${VERDICTS.join(" | ")}`);
    }
    // Recommendations are independent of the verdict (a C criterion may still carry a good
    // practice) and are grounded exactly like an NC finding — no normativeRef required, as
    // a recommendation has no normative test by definition.
    for (const rec of it.recommendations ?? []) {
      // Same contract, same reason: a recommendation is rendered through the very surfaces an
      // NC is, so one with no location breaks them just as thoroughly.
      if (typeof rec.file !== "string" || !rec.file.trim()) {
        blame(
          it.criteriaId,
          `criterion ${it.criteriaId}: a recommendation must name the file it was observed in — copy a file and line from this criterion's own evidence, or drop the recommendation`,
        );
        continue;
      }
      toGround(it.criteriaId, { file: rec.file, line: rec.line, selector: rec.selector, snippet: rec.snippet });
    }
  }

  // Content-level grounding of every agent NC finding, every C/NA citation, and every
  // recommendation — the same check, whichever direction the verdict points. Walked per
  // criterion so a failure is attributable; the aggregate summary is identical to what the
  // flat `groundItems` produced.
  const grounding: GroundingSummary = { grounded: 0, moved: 0, failed: 0, issues: [] };
  for (const [criteriaId, inputs] of groundInputs) {
    for (const { g, fallback } of inputs) {
      let r = groundFinding(g, { cwd: opts.cwd });
      // The harvested anchor vouches for a citation the file could not confirm on its own —
      // an adjudicator's retyping of an element it did read. `moved` either way: what
      // grounded is not verbatim what was cited.
      if (!r.ok && fallback) {
        const viaAnchor = groundFinding(fallback, { cwd: opts.cwd });
        if (viaAnchor.ok) r = { ok: true, moved: true };
      }
      if (r.ok) {
        grounding.grounded++;
        if (r.moved) grounding.moved++;
      } else {
        grounding.failed++;
        if (r.issue) {
          grounding.issues.push(r.issue);
          blame(criteriaId, r.issue);
        }
      }
    }
  }

  // STRICT: the historical file-level fold. One refusal, nothing lands.
  if (opts.strict && issues.length) {
    return { ok: false, audit, issues, applied: 0, stillManual: 0, rejected: 0, rejectedCriteria: [], grounding };
  }
  // PARTIAL: a refused criterion is dropped, the rest folds. `rejectedCriteria` keeps file
  // order and de-duplicates, since one criterion can raise several issues. It counts only the
  // criteria the gate REFUSED — an uncovered one the caller already declared is not a refusal.
  const rejectedCriteria = adj.items.map((it) => it.criteriaId).filter((id) => itemIssues.has(id));
  for (const id of itemIssues.keys()) if (!rejectedCriteria.includes(id)) rejectedCriteria.push(id);
  const rejectedSet = notFolded;
  const rejectedWhy = (id: string) => expected[id] ?? residualRejectedReason(itemIssues.get(id)?.[0] ?? "refused by the gate");

  // Apply: clone the audit, update the decided criteria + append agent findings.
  const next: AuditResult = structuredClone(audit);
  const critById = new Map(next.criteria.map((c) => [c.id, c]));
  const newFindings: Finding[] = [];
  let applied = 0;
  let stillManual = 0;

  // PACK MODE. The items are the pack's own criteria, which have no counterpart in
  // `next.criteria` (a WCAG-keyed list). Recording them there would be wrong twice over: it
  // would let a pack decision rewrite the WCAG core verdict, and — since 1.1.1 alone fans out
  // to 19 RGAA criteria — it would let those criteria overwrite one another on a shared
  // success criterion. They get their own layer, which `derivePackResults` then prefers.
  if (packMode) {
    const decided: PackCriterionAdjudication[] = [];
    for (const it of adj.items) {
      // A refused verdict does not land. It is recorded as still-`manual` carrying the
      // refusal, so the page grid and the report say WHY this criterion is still to assess
      // instead of leaving a blank cell.
      if (rejectedSet.has(it.criteriaId)) {
        if (!open.has(it.criteriaId)) continue; // surplus item: not ours to record at all
        decided.push({
          id: it.criteriaId,
          status: "manual",
          reason: "undecidable",
          justification: rejectedWhy(it.criteriaId),
          findings: [],
        });
        continue;
      }
      if (it.verdict === "manual") {
        stillManual++;
        decided.push({
          id: it.criteriaId,
          status: "manual",
          reason: it.reason === "needs-rendered-dom" ? "needs-rendered-dom" : "undecidable",
          justification: it.reason === "needs-rendered-dom" ? residualScanReason() : residualUndecidableReason(),
          findings: [],
          decidedBy: "agent",
        });
        continue;
      }
      applied++;
      const fs = it.verdict === "NC" ? it.findings.map((f) => agentFinding(it.criteriaId, f)) : [];
      const recs = (it.recommendations ?? []).map((rec) => agentFinding(it.criteriaId, rec, true));
      newFindings.push(...fs, ...recs);
      decided.push({
        id: it.criteriaId,
        status: it.verdict as Status,
        ...(it.verdict === "C" || it.verdict === "NA" ? { justification: it.justification.trim(), ...citationsOf(it) } : {}),
        findings: [...fs, ...recs],
        decidedBy: "agent",
      });
    }
    // An OPEN criterion the file never mentioned — a coverage gap, or one the caller declared
    // uncovered — also has to say why it is still to assess; the loop above only walks the
    // items that exist.
    const alreadyDecided = new Set(
      audit.packAdjudication?.standard === adj.standard ? audit.packAdjudication.criteria.filter((c) => c.status !== "manual").map((c) => c.id) : [],
    );
    for (const id of notFolded) {
      if (byId.has(id) || !open.has(id)) continue;
      // …and never over a verdict an earlier pass already landed: this loop exists to explain
      // an OPEN criterion, not to reopen a closed one.
      if (alreadyDecided.has(id)) continue;
      decided.push({ id, status: "manual", reason: "undecidable", justification: rejectedWhy(id), findings: [] });
    }
    // MERGE, never replace. A fold used to write `packAdjudication` from the file it was
    // given and nothing else, which is fine for one fold and wrong for two: a later pass
    // re-derives its worklist from what is STILL open, so a criterion decided earlier is
    // ABSENT from it by construction — and rewriting the set dropped it back to « à évaluer ».
    //
    // Measured on the first three-pass run: 47 criteria, 5 refused → 41 left; the next pass
    // ruled those, 4 refused → and the third opened with 47 again. Each pass was undoing the
    // one before it, so the tier could never converge however much it was allowed to spend.
    //
    // What the file rules wins for its own criteria — a pass that names a criterion decides it,
    // even against an earlier verdict — and everything else it does not mention stays as it
    // was. Only entries of the SAME standard carry over; a pack change starts a clean sheet.
    const carried = new Map<string, PackCriterionAdjudication>();
    if (audit.packAdjudication?.standard === adj.standard) {
      for (const c of audit.packAdjudication.criteria) carried.set(c.id, c);
    }
    for (const c of decided) carried.set(c.id, c);
    next.packAdjudication = { standard: adj.standard, criteria: [...carried.values()] };
    // The agent's findings still join the flat list so grounding, `check` and the reports can
    // resolve them — but they never touch a WCAG criterion's status.
    next.findings = [...next.findings, ...newFindings];
    next.adjudicated = { date: adj.auditDate, applied, stillManual, ...(rejectedCriteria.length ? { rejected: rejectedCriteria.length } : {}) };
    return { ok: issues.length === 0, audit: next, issues, applied, stillManual, rejected: rejectedCriteria.length, rejectedCriteria, grounding };
  }

  for (const it of adj.items) {
    const c = critById.get(it.criteriaId);
    if (!c) continue; // an item for a non-residual criterion — ignore (coverage already gated)
    if (rejectedSet.has(it.criteriaId)) continue; // refused: the criterion keeps its `manual` status
    if (it.verdict === "manual") {
      c.status = "manual";
      c.decidedBy = "agent";
      c.justification = it.reason === "needs-rendered-dom" ? residualScanReason() : residualUndecidableReason();
      stillManual++;
      continue;
    }
    applied++;
    // An `NA` verdict — from a model, or from a ledger written before this tool stopped
    // reporting a third column — means "nothing of that kind is in scope", which this engine
    // now reports as conforming (INAPPLICABLE_STATUS). Folded on the way in rather than
    // refused: the claim is unchanged, only the label it lands under.
    c.status = (it.verdict === "NA" ? INAPPLICABLE_STATUS : it.verdict) as Status;
    c.decidedBy = "agent";
    // Whatever it was closed for before, it now carries a ruling of its own.
    delete c.inapplicable;
    if (it.verdict === "C" || it.verdict === "NA") {
      c.justification = it.justification.trim();
      const cites = citationsOf(it);
      if (cites.citations) c.citations = cites.citations;
      else delete c.citations;
    }
    if (it.verdict === "NC") {
      const fs: Finding[] = it.findings.map((f) => agentFinding(it.criteriaId, f));
      c.findings = fs;
      newFindings.push(...fs);
      delete c.justification;
      // An NC is anchored by its findings, each carrying its own `normativeRef`. Leaving a
      // previous run's citations behind would offer `verify --report` a conformity to attack
      // on a criterion that is no longer claimed conforming.
      delete c.citations;
    }
  }

  // Fold recommendations as ADVISORY findings on their criterion — status-neutral (they
  // ride alongside whatever verdict was applied, incl. C/NA/manual) and never enter NC or
  // conformancePct. A separate pass so a `manual` item (which `continue`s above) still
  // gets its recommendations, and an NC item's reset `c.findings` keeps them appended last.
  for (const it of adj.items) {
    const c = critById.get(it.criteriaId);
    if (!c || rejectedSet.has(it.criteriaId)) continue;
    for (const rec of it.recommendations ?? []) {
      const f = agentFinding(it.criteriaId, rec, true);
      c.findings.push(f);
      newFindings.push(f);
    }
  }

  next.findings = [...next.findings, ...newFindings];
  // Residual set now holds every criterion still to assess: the ones ruled `manual` by the
  // adjudication, AND the ones whose verdict the gate refused. A refused criterion keeps its
  // place in the residual set with the refusal as its reason — dropping it would report it as
  // decided, and blanking the reason is exactly the empty cell this release is removing.
  next.residualRisks = next.residualRisks
    .filter((r) => byId.get(r.criteriaId)?.verdict === "manual" || rejectedSet.has(r.criteriaId))
    .map((r) => (rejectedSet.has(r.criteriaId) ? { ...r, reason: rejectedWhy(r.criteriaId) } : r));
  recomputeTallies(next);
  next.adjudicated = { date: adj.auditDate, applied, stillManual, ...(rejectedCriteria.length ? { rejected: rejectedCriteria.length } : {}) };
  return { ok: issues.length === 0, audit: next, issues, applied, stillManual, rejected: rejectedCriteria.length, rejectedCriteria, grounding };
}

/** A severity the ENGINE understands, from whatever the model wrote.
 *
 *  `AgentFinding.severity` is typed `Severity`, and the type is a promise about our own code,
 *  not about a JSON file a model produced — or a verdict ledger replaying one it produced
 *  months ago. A run wrote `"moderate"`, axe's vocabulary, which a model reaches for naturally;
 *  it travelled through every renderer keyed on the three French levels and came out as
 *  « undefined moderate » in a pull-request comment, with no icon and no ordering. The same
 *  value would have produced an empty SARIF level and an unsorted annotation.
 *
 *  axe's four levels map the way `severityFromImpact` already maps them, so a model using them
 *  gets what it meant. Anything else falls back to the SAME default an absent severity gets —
 *  never to `mineur`, which would silently downgrade a non-conformity because a model misspelt
 *  a word. */
export function agentSeverity(v: unknown, advisory: boolean): Severity {
  if (v === "bloquant" || v === "majeur" || v === "mineur") return v;
  if (v === "critical" || v === "serious") return "bloquant";
  if (v === "moderate") return "majeur";
  if (v === "minor") return "mineur";
  return advisory ? "mineur" : NC_SEVERITY_DEFAULT;
}

/** One element, keyed the way the double-charge check compares them: file, line and selector,
 *  all three, trimmed. Deliberately EXACT — a looser key (file+line alone) would refuse two
 *  criteria that legitimately fail different aspects of one line, and this check's whole
 *  licence to refuse a verdict rests on the anchors being literally the same. */
const anchorKey = (file: string, line: number, selector: string): string => `${file.trim()}|${line}|${selector.trim()}`;

/** Shared empty set, so the memoised lookup never allocates on the common miss. */
const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

/** The anchors a `C`/`NA` was settled on, narrowed to what the audit document persists.
 *
 *  Returns a SPREADABLE object rather than an array so an item that cited nothing writes no
 *  key at all: `citations: []` on a criterion would read as « cleared on nothing », which is
 *  the one thing the gate refuses a `C` for. The harvester's class bookkeeping
 *  (`occurrences`/`alsoAt`/`pages`) is dropped on purpose — it describes the evidence the
 *  citation was drawn from, not the claim, and it is what made these too heavy to persist. */
function citationsOf(it: AdjudicationItem): { citations?: CriterionCitation[] } {
  const cites = (it.citations ?? [])
    .map((c) => (typeof c === "string" ? readCitation(c) : c))
    .filter((c): c is Evidence => c !== null && c !== undefined)
    .map(({ file, line, selector, snippet, note }) => ({ file, line, selector, snippet, ...(note ? { note } : {}) }));
  return cites.length ? { citations: cites } : {};
}

function agentFinding(criteriaId: string, f: AgentFinding, advisory = false): Finding {
  return {
    ruleId: `agent:${criteriaId}`,
    criteriaId,
    file: f.file,
    line: f.line,
    col: 1,
    selectorHint: f.selector ?? "",
    severity: agentSeverity(f.severity, advisory),
    message: f.message,
    remediation: getSC(criteriaId)?.understanding ? `See WCAG ${criteriaId}.` : "Address the reported non-conformity.",
    snippet: f.snippet ?? "",
    // The gate immediately above this fold spent real effort proving this reference resolves
    // to a test of THIS criterion (`normativeRefResolves`); dropping it here is what made the
    // deliverable print all three tests of RGAA 11.1 under a finding that failed only 11.1.2.
    // A recommendation carries none by definition — a good practice has no normative test.
    ...(f.normativeRef && !advisory ? { normativeRef: f.normativeRef.trim() } : {}),
    ...(advisory ? { advisory: true } : {}),
  };
}

/** Recompute guideline tallies + conformancePct after statuses changed. Mirrors the
 *  finalize() logic in src/audit.ts so an adjudicated audit is internally consistent. */
function recomputeTallies(a: AuditResult): void {
  for (const g of a.guidelines) {
    const inG = a.criteria.filter((c) => c.guideline === g.key);
    g.c = inG.filter((c) => c.status === "C").length;
    g.nc = inG.filter((c) => c.status === "NC").length;
    g.na = inG.filter((c) => c.status === "NA").length;
    g.manual = inG.filter((c) => c.status === "manual").length;
  }
  // `conformancePct` is labelled everywhere as the AUTOMATIC static-check pass rate, so an
  // agent's C must not enter it — otherwise one adjudication pass turns a judgement into a
  // machine-verified number, which is exactly the claim the label denies. An agent NC does
  // count: a non-conformity is evidenced (grounded finding + normativeRef) and reporting
  // it lowers the rate, which is the safe direction.
  const decided = a.criteria.filter((c) => c.status === "NC" || (c.status === "C" && c.decidedBy !== "agent"));
  const conform = decided.filter((c) => c.status === "C").length;
  a.conformancePct = decided.length === 0 ? 100 : Math.round((conform / decided.length) * 100);
}

const residualScanReason = () => "Rendering criterion — decide on the rendered DOM (`scan`).";
const residualUndecidableReason = () => "Left as an explicit residual risk (not decidable from the available evidence).";
/** Why a criterion is still to assess after a PARTIAL fold: its verdict was refused. Carries
 *  the first refusal verbatim, so the reader (and the next adjudication pass) sees the actual
 *  contract violation rather than a bare « to assess ». */
const residualRejectedReason = (why: string) => `Adjudication refused by the gate — ${why.replace(/^criterion \S+: /, "")}. Re-adjudicate this criterion.`;

/** Characters of a harvested snippet the brief prints. Long enough that the element is
 *  unmistakable — its tag and its first distinctive attributes — and short enough that a page
 *  snapshot's markup does not swamp a model's context. */
const SNIPPET_SHOWN = 200;

// ---- worklist file rendering ----
const T = {
  fr: {
    title: "# Adjudication des critères à évaluer (ultra11y)",
    intro:
      "Pour CHAQUE critère, lisez les évidences ci-dessous (extraites de la source auditée) et attribuez un verdict dans `ADJUDICATE.todo.json` (champ `verdict`) :",
    verdicts: [
      "- `C` — conforme (renseignez `justification` ET `citations[]` : les évidences que vous avez levées, `file`/`line` recopiés depuis la liste du critère) ;",
      "- `NC` — non conforme (ajoutez au moins un `findings[]` : file/line/message, avec un `snippet` groundable ET un `normativeRef` citant le test précis échoué) ;",
      "- `NA` — non applicable (renseignez `justification` ; si des évidences sont présentées, citez-les aussi dans `citations[]` pour dire lesquelles sortent du périmètre) ;",
      "- `manual` — indécidable statiquement (renseignez `reason` : `needs-rendered-dom` → `scan`, ou `undecidable`).",
    ],
    rule: "> Ne signalez une NC que si un test précis du référentiel actif échoue — citez-le (`normativeRef`). Une bonne pratique sans test normatif est une recommandation (`recommendations[]`, non normative). Une simple préoccupation UX n'est ni l'un ni l'autre.\n>\n> Symétriquement, un `C` se cite comme une NC : il faut nommer dans `citations[]` les évidences levées. **Un critère présenté sans aucune évidence ne peut pas être `C`** — c'est `manual` (`undecidable`), ou `NA` si rien n'est concerné.",
    then: "Puis : `ultra11y verify --apply ADJUDICATE.todo.json --in <audit.json> --out <dir>` (échoue si un verdict manque sa justification, ses citations, son finding ou sa raison).",
    evidence: "Évidences",
    classes: "classes de contenu distinctes",
    occurrences: "occurrences",
    pagesWord: "page(s)",
    on: "sur",
    alsoAt: "aussi en",
    snippetLabel: "`snippet` à copier dans la citation",
    renderedAvailable:
      "**RENDU DISPONIBLE.** Cet audit a ingéré des captures de page : le rendu de la page est sur le disque, sous `.ultra11y/pages/<id>/` — `dom.html` (le DOM sérialisé par le navigateur), `styles.json` (les styles calculés), `boxes.json` (les boîtes et positions), `axtree.json` (l'arbre d'accessibilité) et `screen.png`. Un critère « à restituer » — information par la couleur, opérabilité clavier d'un script, geste au pointeur — se tranche DEPUIS CES FICHIERS : lisez-les comme vous liriez la source. `needs-rendered-dom` reste la bonne réponse pour un critère dont aucune capture ne porte le sujet, et pour lui seul.",
    nothingRendered: (ids: string[]): string =>
      `**AUCUN RENDU DANS CETTE PORTÉE.** ${ids.length} critère(s) exigent une page rendue, et aucune page n'a été instantanée ici : personne ne peut les trancher depuis la source, et \`needs-rendered-dom\` est pour eux la seule réponse honnête. Rendez AVANT d'adjuger — \`ultra11y scan <url> --merge <audit.json>\` (ou \`scan --sample\`) — puis reconstruisez cette liste : la mesure en ferme la plupart sans modèle, donc sans facture. Concernés : ${ids.map((id) => `\`${id}\``).join(" · ")}`,
    briefContract:
      "> **CONTRAT DE VERDICT** — le pli est FERMÉ : un verdict auquel il manque son champ obligatoire est refusé, et son critère retourne « à évaluer » en portant le refus. Renseignez le verdict de CE critère, ici :",
    absenceRule:
      "> **UNE NC EN FORME D'ABSENCE S'ANCRE QUAND MÊME.** « Il n'y a pas de second système de navigation », « il n'y a pas de moteur de recherche », « aucun message d'erreur ne suggère le format attendu » : une absence se CONSTATE quelque part. Citez l'élément et la page où vous l'avez constatée — le `<nav>`, le `<header>`, le formulaire — avec son `file`, sa `line` et son `snippet`. Une NC sans `file` est refusée aussi sûrement qu'un `C` sans citations. Et si le sujet du critère n'existe nulle part dans le périmètre audité, le verdict n'est pas `NC` : c'est `NA`, avec sa justification.",
    incomplete: "LECTURE INCOMPLÈTE — un « C » sera refusé sur ce critère",
    // WHAT AN EMPTY HARVEST MAY BE ANSWERED WITH, said outright.
    //
    // It used to read « décidez depuis la source, ou laissez `manual` avec une raison », which
    // invites the one answer the gate always refuses: a `C` with nothing to cite. Measured on
    // run 32508717451 (Sonnet, RGAA, 3 passes): 10.1 and 13.2 both arrived with an empty
    // harvest, both were ruled `C`, and the gate refused them — twice for 13.2, three times for
    // 10.1, which never closed. The model was not being careless; it was told to decide, and it
    // decided. So the two answers that ARE accepted are named, and the difference between them
    // is spelled out, because it is a real one.
    none: "**AUCUNE ÉVIDENCE MOISSONNÉE POUR CE CRITÈRE.** Un `C` sera REFUSÉ ici quelle que soit la justification : la porte exige au moins une citation, et il n'y a rien à citer. Deux réponses sont acceptées, et elles ne disent pas la même chose — `NA` : rien dans le périmètre audité n'est concerné (aucun script, aucun document, aucun composant de ce type) ; `manual` avec `reason: \"undecidable\"` : le sujet existe peut-être, mais rien ici ne permet de le voir.",
    questions: "À vérifier manuellement",
    decide: "Règle de décision",
    na: "Non applicable si",
    refs: "Références normatives mobilisables (techniques/échecs W3C de ce critère)",
    packRefs: (name: string) => `Références normatives mobilisables (les tests ${name} de ce critère, et eux seuls)`,
    packIntro: (name: string) =>
      `Référentiel actif : **${name}**. Les items ci-dessous sont des critères ${name}, pas des critères de succès WCAG. Un \`normativeRef\` DOIT citer un test du critère de l'item (par ex. \`11.2.1\`) — un id WCAG y ressemble mais désigne un tout autre test et sera rejeté.`,
    packTests: (name: string, id: string) => `Tests ${name} ${id} à trancher`,
    methodology: "Méthodologie de test officielle",
    touched: "la source moissonnée porte ce mécanisme",
    touchedLegend:
      "« ⬤ » signale les tests dont le MÉCANISME apparaît dans la source moissonnée (la balise ou l'attribut que le test nomme lui-même). C'est une aide à la lecture, pas un verdict : **l'absence de marque n'affirme rien** — un test non marqué reste à trancher comme les autres, et beaucoup de tests portent sur autre chose que du balisage (un intitulé visible, un bouton adjacent, un comportement).",
    inheritedDecide: (sc: string) =>
      `Règle de décision (héritée du critère de succès WCAG ${sc}, qui pose une question plus large — le texte du référentiel prime)`,
    officialSource: (name: string, id: string) => `Texte officiel du critère ${name} ${id}`,
    webLookup:
      "Le texte ci-dessus est celui du référentiel : c'est LUI qui tranche. Si une formulation reste ambiguë et que vous disposez d'un outil web, vous POUVEZ consulter la page officielle ci-dessus pour la lever — jamais pour la contredire, jamais pour élargir un test, et une page web n'est jamais un `normativeRef` : seules les références normatives listées ci-dessous en sont.",
    technicalNote: "Note technique",
    particularCases: "Cas particuliers",
    glossary: "Termes définis par le référentiel",
    neighbours: "Ce constat appartient-il bien ici ?",
    neighboursLead: (name: string) =>
      `${name} sépare en critères distincts des questions que WCAG pose d'un bloc : l'un demande si une chose EXISTE, l'autre si elle est PERTINENTE. Les critères ci-dessous, de la même thématique, portent la question voisine de celle-ci. Un constat d'absence ou de forme appartient au critère « mécanique » ; un jugement de pertinence appartient au critère « jugement ». Aide à la lecture : cela ne préjuge d'aucun verdict, et ne dispense d'aucun test de CE critère.`,
    roleMechanical: "mécanique — existence / forme",
    roleJudgment: "jugement — pertinence",
  },
  en: {
    title: "# Criteria adjudication (ultra11y)",
    intro: "For EACH criterion, read the evidence below (harvested from the audited source) and set a verdict in `ADJUDICATE.todo.json` (field `verdict`):",
    verdicts: [
      "- `C` — conformant (fill `justification` AND `citations[]`: the evidence you cleared, `file`/`line` copied from the criterion's own list);",
      "- `NC` — non-conformant (add at least one `findings[]`: file/line/message, with a groundable `snippet` AND a `normativeRef` citing the precise failed test);",
      "- `NA` — not applicable (fill `justification`; when evidence is presented, cite it too in `citations[]` to say which items are out of scope);",
      "- `manual` — not statically decidable (fill `reason`: `needs-rendered-dom` → `scan`, or `undecidable`).",
    ],
    rule: "> Report NC only if a precise test of the active standard fails — cite it (`normativeRef`). A good practice without a normative test is a recommendation (`recommendations[]`, non-normative). A purely UX concern is neither.\n>\n> A `C` is cited the same way an NC is: name the evidence you cleared in `citations[]`. **A criterion presented with no evidence at all cannot be `C`** — record `manual` (`undecidable`), or `NA` if nothing in scope is concerned.",
    then: "Then: `ultra11y verify --apply ADJUDICATE.todo.json --in <audit.json> --out <dir>` (fails if any verdict lacks its justification, citations, finding or reason).",
    evidence: "Evidence",
    classes: "distinct content classes",
    occurrences: "occurrences",
    pagesWord: "page(s)",
    on: "on",
    alsoAt: "also at",
    snippetLabel: "`snippet` to copy into the citation",
    renderedAvailable:
      "**THE RENDERED PAGE IS AVAILABLE.** This audit ingested page captures: the rendered page is on disk under `.ultra11y/pages/<id>/` — `dom.html` (the DOM the browser serialized), `styles.json` (computed styles), `boxes.json` (boxes and positions), `axtree.json` (the accessibility tree) and `screen.png`. A needs-rendering criterion — information by colour, keyboard operability of a script, a pointer gesture — is decided FROM THOSE FILES: read them as you would read the source. `needs-rendered-dom` stays the right answer for a criterion no capture carries the subject of, and for that alone.",
    nothingRendered: (ids: string[]): string =>
      `**NOTHING WAS RENDERED IN THIS SCOPE.** ${ids.length} criteria need a rendered page, and no page was snapshotted here: nobody can settle them from source, and \`needs-rendered-dom\` is the only honest answer for them. Render BEFORE adjudicating — \`ultra11y scan <url> --merge <audit.json>\` (or \`scan --sample\`) — then rebuild this worklist: the measurement closes most of them with no model in the loop, and so with no bill. Affected: ${ids.map((id) => `\`${id}\``).join(" · ")}`,
    briefContract:
      "> **VERDICT CONTRACT** — the fold is FAIL-CLOSED: a verdict missing its required field is refused, and its criterion goes back to « to assess » carrying the refusal. Record THIS criterion's verdict, here:",
    absenceRule:
      "> **AN NC SHAPED LIKE AN ABSENCE STILL HAS TO BE ANCHORED.** « There is no second navigation system », « there is no search engine », « no error message suggests the expected format »: an absence is OBSERVED somewhere. Cite the element and the page you observed it on — the `<nav>`, the `<header>`, the form — with its `file`, `line` and `snippet`. An NC with no `file` is refused exactly as surely as a `C` with no citations. And when the criterion's subject exists nowhere in the audited scope, the verdict is not `NC`: it is `NA`, with its justification.",
    incomplete: "INCOMPLETE READING — a C will be refused on this criterion",
    none: '**NO EVIDENCE WAS HARVESTED FOR THIS CRITERION.** A `C` will be REFUSED here however good the justification: the gate requires at least one citation and there is nothing to cite. Two answers are accepted, and they say different things — `NA`: nothing in the audited scope is concerned (no script, no document, no component of that kind); `manual` with `reason: "undecidable"`: the subject may exist, but nothing here lets you see it.',
    questions: "To verify manually",
    decide: "Decision rule",
    na: "Not applicable when",
    refs: "Normative references you may cite (this criterion's W3C techniques/failures)",
    packRefs: (name: string) => `Normative references you may cite (this criterion's own ${name} tests, and nothing else)`,
    packIntro: (name: string) =>
      `Active standard: **${name}**. The items below are ${name} criteria, not WCAG success criteria. A \`normativeRef\` MUST cite a test OF THE ITEM'S CRITERION (e.g. \`11.2.1\`) — a WCAG id looks alike but denotes an unrelated test and will be rejected.`,
    packTests: (name: string, id: string) => `${name} ${id} tests to rule on`,
    methodology: "Official test methodology",
    touched: "the harvested source carries this mechanism",
    touchedLegend:
      "« ⬤ » marks the tests whose MECHANISM appears in the harvested source (the tag or attribute the test itself names). It is a reading aid, not a verdict: **an unmarked test asserts nothing** — it is still yours to rule on, and plenty of tests are about something other than markup (a visible label, an adjacent button, a behaviour).",
    inheritedDecide: (sc: string) =>
      `Decision rule (inherited from WCAG success criterion ${sc}, which asks a broader question — the standard's own text prevails)`,
    officialSource: (name: string, id: string) => `Official text of ${name} criterion ${id}`,
    webLookup:
      "The text above is the standard's own, and it is what decides. If a wording stays ambiguous and you have a web tool, you MAY consult the official page above to settle it — never to contradict it, never to widen a test, and a web page is never a `normativeRef`: only the normative references listed below are.",
    technicalNote: "Technical note",
    particularCases: "Particular cases",
    glossary: "Terms the standard defines",
    neighbours: "Does this observation belong here?",
    neighboursLead: (name: string) =>
      `${name} splits into separate criteria what WCAG states in one: one asks whether a thing EXISTS, the other whether it is RELEVANT. The criteria below, from this same theme, carry the question adjacent to this one. An observation of absence or of malformed markup belongs to the « mechanical » criterion; a judgement of relevance belongs to the « judgment » one. A reading aid: it prejudges no verdict, and excuses no test of THIS criterion.`,
    roleMechanical: "mechanical — existence / form",
    roleJudgment: "judgment — relevance",
  },
} as const;

// SC-keyed adjudication protocol (src/data/adjudication.json, built by
// scripts/build-adjudication.mjs): for every criterion the static engine cannot settle, the
// rule that decides Conforming vs Non-conforming, when NA is legitimate, and the concrete
// questions that get you there. Rendered per residual item in both languages — a criterion
// handed to the agent with no stated decision rule is where an audit turns into an opinion.
// The dataset itself lives in src/adjudication-data.ts, so a criterion lookup can read the
// decision protocol without importing this module's engine dependencies.

/** Cap on techniques listed per criterion: 1.1.1 alone carries 52, which would bury the
 *  decision rule under a wall of ids. The full list stays in `criteria <sc>`. */
const MAX_REFS = 12;

/** Render the per-criterion decision protocol as a standalone reference
 *  (skills/ultra11y/references/adjudication.md). Generated from the same dataset the
 *  worklist uses, so the page an agent reads and the prompt it answers can never drift. */
export function renderAdjudicationReference(lang: Lang = "en"): string {
  const out: string[] = [];
  out.push("<!-- GENERATED from src/data/adjudication.json by `pnpm run build:adjudication` — do not edit by hand. -->", "");
  out.push("# Deciding the criteria the engine hands you", "");
  out.push(
    "The static engine decides 3 of the 55 WCAG 2.2 AA success criteria outright. The other 52",
    "come back as residual risks: 14 need a rendered page (the `scan` tier), 38 are judgment",
    "calls. This page is the decision rule for each of them — what makes it Conforming, when",
    "`NA` is legitimate, and the questions that get you there.",
    "",
    "It is the same dataset `verify --manual` loads into `ADJUDICATE.md`, so the worklist and",
    "this page can never disagree. Two rules govern every verdict below:",
    "",
    "- **A non-conformity must cite a normative test that resolves.** The worklist proposes the",
    "  criterion's W3C techniques; `verify --apply` rejects a `normativeRef` that does not exist.",
    "- **A good practice with no failing test is a recommendation**, not a non-conformity — it",
    "  never flips a criterion, never enters the conformance rate.",
    "",
  );
  const byGuideline = new Map<string, string[]>();
  for (const sc of allSC()) {
    const protocol = ADJUDICATION[sc.sc];
    if (!protocol) continue;
    const lines = byGuideline.get(sc.guideline) ?? [];
    lines.push(`### ${sc.sc} — ${scTitle(sc.sc, lang) ?? sc.title}  ·  ${sc.level}  ·  _${sc.automatability}_`, "", `**Decide.** ${protocol.decide[lang]}`, "");
    if (protocol.na) lines.push(`**Not applicable when.** ${protocol.na[lang]}`, "");
    if (protocol.questions.length) {
      lines.push("**Ask.**", "");
      for (const q of protocol.questions) lines.push(`- ${q[lang]}`);
      lines.push("");
    }
    const refs = techniquesFor(sc.sc);
    if (refs.length)
      lines.push(`**Citable references.** ${refs.slice(0, MAX_REFS).join(", ")}${refs.length > MAX_REFS ? ` … (\`criteria ${sc.sc}\`)` : ""}`, "");
    byGuideline.set(sc.guideline, lines);
  }
  for (const [guideline, lines] of byGuideline) {
    out.push(`## ${guideline} ${guidelineTitle(guideline, lang) ?? ""}`.trimEnd(), "");
    out.push(...lines);
  }
  return out.join("\n");
}

// A criterion's tests refer constantly to normatively-defined terms
// (`[alternative textuelle](#alternative-textuelle-image)`). The definitions live in the
// pack's glossary — 119 entries for RGAA — which nothing used to read. Attaching the ones
// THIS criterion's tests actually cite makes the item self-sufficient: the agent no longer
// has to guess what the standard means by "image porteuse d'information".
const MAX_GLOSSARY_TERMS = 8;
const MAX_GLOSSARY_CHARS = 600;

/** Characters of an official test methodology the brief prints. RGAA documents all 258 of
 *  its tests and the procedures run 200-900 characters each, so a criterion with eight tests
 *  can carry several kilobytes — read by a model that pays for its context, and batched eight
 *  criteria at a time by `judge`. Generous enough that a whole procedure normally fits, hard
 *  enough that one long one cannot swamp the evidence it is there to help read. */
const MAX_METHODOLOGY_CHARS = 900;

// `glossaryAnchorsOf` now lives in src/standards/pack.ts, next to the glossary it reads —
// the criteria lookup and the MCP reference tools need it too, and none of them should
// have to import the adjudication engine to get at a pure function over a criterion.
// Re-exported here because it was part of this module's surface.
export { glossaryAnchorsOf };

/** « This observation may belong next door. » — rendered from `siblingCriteria`, which derives
 *  the pair from the pack's own data (same theme, shared success criterion, opposite sides of
 *  the mechanical/judgment line).
 *
 *  Deliberately printed BEFORE the numbered tests: the point is to be read while deciding
 *  which criterion the observation belongs to, not after one has been chosen. Like the ⬤
 *  marker it is a reading aid and says so — it never asserts that a verdict is wrong, only
 *  where the adjacent question lives. Nothing is emitted for a criterion with no neighbour. */
function siblingBlock(pack: StandardPack, id: string, lang: Lang, s: (typeof T)[Lang]): string[] {
  const sibs = siblingCriteria(pack, id, lang);
  if (!sibs.length) return [];
  const out: string[] = [`> **${s.neighbours}** — ${s.neighboursLead(pack.name)}`, ""];
  for (const sib of sibs) out.push(`- \`${sib.id}\` — ${plainTest(sib.title)} _(${sib.role === "mechanical" ? s.roleMechanical : s.roleJudgment})_`);
  out.push("");
  return out;
}

function glossaryBlock(pack: StandardPack, crit: PackCriterion | undefined, lang: Lang): string[] {
  const anchors = glossaryAnchorsOf(crit).slice(0, MAX_GLOSSARY_TERMS);
  if (!anchors.length) return [];
  const s = T[lang];
  const out: string[] = [`> **${s.glossary}**`, ""];
  let any = false;
  for (const a of anchors) {
    const entry = resolveGlossary(pack.key, a);
    if (!entry) continue;
    any = true;
    const body = entry.body.replace(/\s+/g, " ").trim();
    out.push(`- **${entry.title}** — ${body.length > MAX_GLOSSARY_CHARS ? `${body.slice(0, MAX_GLOSSARY_CHARS)}…` : body}`);
  }
  out.push("");
  return any ? out : [];
}

/** WHERE THE CRITERION IS PUBLISHED, and what a web lookup is allowed to do with it.
 *
 *  The URL is a FACT and is always rendered: it names the page the vendored text was derived
 *  from, which is as useful to a human reviewing a brief as to a model. The invitation to go
 *  read it is not a fact but an instruction, and it is only true where a web tool exists —
 *  in CI the adjudicator holds Read/Grep/Glob/Edit/Write and nothing else, and proposing a
 *  tool it cannot call costs turns it needs for the 96 criteria in front of it. So the
 *  sentence is gated on `web` and the caller decides (see `--web` / `--no-web`).
 *
 *  What the sentence says matters as much as when it appears: the vendored text decides, a
 *  lookup may only lift an ambiguity, and no web page is ever a `normativeRef` — the gate
 *  would refuse one anyway, and this is where the refusal is explained rather than met. */
/** THE MARKUP A NUMBERED TEST IS WRITTEN ABOUT, read off the test's own wording.
 *
 *  RGAA tests name their mechanism in code spans, and those are the only code spans in the
 *  sentence: « Chaque balise `<label>` permet-elle… », « Chaque étiquette implémentée via
 *  l'attribut WAI-ARIA `aria-label`… », « Chaque bouton de type `image` (balise `<input>` avec
 *  l'attribut `type="image"`) ». The standard therefore already says, per test, what to look
 *  for — no table mapping 258 tests onto anything has to be curated, and none can go stale
 *  when DINUM edits a test.
 *
 *  Three shapes are recognised and everything else is ignored: `<tag>` → the tag,
 *  `attr="value"` → the attribute and, for the value-bearing ones, `attr=value`, and a bare
 *  hyphenated attribute (`aria-labelledby`, `autocomplete`). A span whose value is a family
 *  rather than a literal (`type="image/…"`) keeps only its attribute name.
 *
 *  Deliberately not exhaustive. A test whose subject is prose — « un intitulé visible », « un
 *  bouton adjacent » — yields nothing, and yields nothing rather than a guess. */
export function testMarkupTokens(lines: readonly string[]): string[] {
  const out = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(/`([^`]+)`/g)) {
      const span = (m[1] ?? "").trim();
      const tag = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)\s*\/?>$/.exec(span);
      if (tag?.[1]) {
        out.add(tag[1].toLowerCase());
        continue;
      }
      const pair = /^([a-zA-Z-]+)\s*=\s*["“]?([^"”]*)["”]?$/.exec(span);
      if (pair?.[1]) {
        const name = pair[1].toLowerCase();
        const value = (pair[2] ?? "").trim().toLowerCase();
        out.add(name);
        if (value && !value.includes("…") && !value.includes("...")) out.add(`${name}=${value}`);
        continue;
      }
      if (/^[a-z]+(-[a-z]+)+$/.test(span)) out.add(span.toLowerCase());
    }
  }
  return [...out];
}

function sourceBlock(s: (typeof T)[Lang], name: string, id: string, url: string | undefined, web: boolean): string[] {
  if (!url) return [];
  const out = [`> **${s.officialSource(name, id)}** — ${url}`, ""];
  if (web) out.push(`> ${s.webLookup}`, "");
  return out;
}

/** The pack's own implementation guidance for this criterion (before/after examples). Used by
 *  `prd`/`auditor` for NC units only — a `manual` criterion never reached it, which is exactly
 *  the criterion an adjudicator is looking at. */
function packGuidanceBlock(standard: StandardId, criterionId: string, lang: Lang): string[] {
  const entries = guidanceForCriterion(standard, criterionId);
  if (!entries.length) return [];
  return guidanceExampleBlock(entries, lang);
}

/** Strip a test's glossary cross-references down to their visible label:
 *  `[alternative textuelle](#alternative-textuelle-image)` → `alternative textuelle`. The
 *  definitions themselves are attached separately (see `glossaryBlock`). */
function plainTest(s: string): string {
  return s.replace(/\[([^\]]+)\]\(#[^)]*\)/g, "$1");
}

/** `preamble: false` renders the criterion sections with a COMPRESSED contract instead of the
 *  full preamble.
 *
 *  The full preamble names the file to write into (`ADJUDICATE.todo.json`) and the shell command
 *  to fold with, and both are wrong on a per-criterion brief: the CI adjudicator has no shell and
 *  is told not to open that file. That is why the briefs used to carry no preamble at all — and
 *  it went one step too far. The RULES are not instructions about files; they are the definition
 *  of a valid verdict, and dropping them left the CI adjudicator ruling without ever being shown
 *  what the gate would refuse. So `preamble: false` now keeps the verdict vocabulary, the
 *  grounding rule, the absence rule and the pack warning, and drops only the two lines that were
 *  ever really harness-specific. */
export function formatAdjudication(
  items: AdjudicationItem[],
  lang: Lang = "en",
  standard: StandardId = CORE,
  opts: { preamble?: boolean; cwd?: string; unrendered?: string[]; web?: boolean } = {},
): string {
  const s = T[lang];
  // Display only — the gate always reads the complete sibling set.
  const { showAlsoAt: shown } = adjudicationLimits(opts.cwd);
  const pack = isCore(standard) ? undefined : loadPack(standard);
  // THE CONTRACT TRAVELS WITH THE BRIEF.
  //
  // `preamble: false` used to mean "no contract at all". That became a defect the day CI started
  // telling its adjudicator to read ONLY `adjudicate/<criteriaId>.md`: the verdict vocabulary,
  // the C-needs-citations / NC-needs-a-file rule and the pack's `normativeRef` warning all lived
  // in the preamble of the one file the agent is explicitly forbidden to open. Measured on run
  // 32385981037 (Haiku, RGAA, 3 passes over tests/fixtures/realworld): 12.1 and 12.5 came back
  // NC with no `file`, 11.11 and 11.12 came back `needs-rendered-dom` on capture-anchored
  // evidence — four gate refusals, and all four of them rules the brief never carried. The
  // adjudicator was not ignoring the contract; it had never been shown one.
  //
  // So a per-criterion brief now opens with the same contract, compressed: the four verdicts,
  // the grounding rule and the absence rule. The two notes below are keyed on THESE items, so a
  // one-item brief gets the note when its own evidence earns it, and stays silent otherwise.
  const out: string[] =
    opts.preamble === false
      ? [s.briefContract, "", ...s.verdicts, "", s.rule, "", s.absenceRule, ""]
      : [s.title, "", s.intro, "", ...s.verdicts, "", s.rule, "", s.absenceRule, "", s.then, ""];
  // THE RENDERED PAGE, WHEN THERE IS ONE.
  //
  // A `needs-rendering` criterion used to arrive with one instruction — answer
  // `needs-rendered-dom`, let `scan` deal with it — and on an audit that has just ingested
  // thirty-five snapshots that is simply untrue: the rendered DOM is on disk, with its computed
  // styles, its boxes and its accessibility tree. Measured on a real run, 3.1, 7.3 and 12.9 came
  // back « needs a rendered DOM » while `.ultra11y/pages/` held the very captures that settle
  // them. No budget fixes that; the tool was telling the adjudicator to give up.
  //
  // Keyed on the harvest itself rather than on a flag: if an anchor points into a capture, the
  // capture is there. On a source-only audit the note stays silent, because there
  // `needs-rendered-dom` IS the correct answer and saying otherwise would invite a guess.
  // Keyed on the items in hand, so it is correct on a one-criterion brief too: the gate refuses
  // `needs-rendered-dom` exactly when THAT criterion's own evidence is capture-anchored, and this
  // is the same predicate. Before, the note only ever reached the combined document.
  if (items.some((it) => it.evidence.some((e) => isSnapshotFile(e.file)))) {
    out.push(`> ${s.renderedAvailable}`, "");
  }
  // AND WHEN THERE IS NONE, SAY SO — with the ids, and with the command that closes them.
  //
  // The note above fires on what the harvest CONTAINS; this one on what the run never
  // produced (`unrenderedResidual`). They are mutually exclusive by construction, and the
  // silence between them was what let a $24.90 cascade spend three passes discovering that
  // nothing had been rendered. Opt-in on the caller's side so a brief rendered without an
  // audit in hand (a per-criterion sheet, a test) stays byte-identical.
  if (opts.unrendered?.length) {
    out.push(`> ${s.nothingRendered(opts.unrendered)}`, "");
  }
  // The pack warning belongs in EVERY brief, not only the combined one: `normativeRef` is
  // per-criterion, and a WCAG id looks so much like an RGAA one that the mistake is the default.
  if (pack) out.push(`> ${s.packIntro(pack.name)}`, "");
  for (const it of items) {
    out.push(`## ${pack ? `${pack.name} ` : ""}${it.criteriaId}${it.title ? ` — ${it.title}` : ""}  _(${it.automatability})_`);
    const pop = it.population;
    const popNote = pop
      ? ` — ${pop.classes} ${s.classes}, ${pop.occurrences} ${s.occurrences}${pop.pages ? `, ${pop.pages} ${s.pagesWord}` : ""}${it.evidenceComplete === false ? ` ⚠ ${s.incomplete}` : ""}`
      : "";
    out.push("", `> ${s.evidence} (${it.evidence.length}${it.evidenceTruncated ? ` / ${it.evidenceTruncated.total}` : ""})${popNote}:`, "");
    if (!it.evidence.length) out.push(s.none, "");
    else {
      for (const e of it.evidence) {
        const extra = [
          e.occurrences && e.occurrences > 1 ? `×${e.occurrences}` : "",
          e.pages?.length ? `${s.on} ${e.pages.slice(0, 4).join(", ")}${e.pages.length > 4 ? "…" : ""}` : "",
          e.alsoAt?.length ? `${s.alsoAt} ${e.alsoAt.slice(0, shown).join(", ")}${e.alsoAt.length > shown ? "…" : ""}` : "",
        ]
          .filter(Boolean)
          .join(" ");
        out.push(`- \`${e.file}:${e.line}\` (\`${e.selector}\`)${extra ? ` [${extra}]` : ""}${e.note ? ` — ${e.note}` : ""}`);
        // THE SNIPPET, SHOWN AND NAMED.
        //
        // The contract asks a citation to carry one, and this brief used to end each line with
        // the harvester's NOTE — which for an image subject reads `<svg> alt="" aria-label=""
        // src=""`. That is markup-shaped, and it was the only markup-shaped string on the line.
        // Measured on a real run: the adjudicator copied it into 34 citations, each one a tag
        // glued to three empty attributes, and the fold refused every one — correctly, and
        // uselessly, because a citation that repeats a template proves nothing. The agent was
        // copying the only thing it had been given.
        //
        // Its own line, and labelled, so it cannot be read as more of the note. Bounded because
        // a rendered snapshot's markup can be long and this file is read by a model with a
        // context to spend.
        if (e.snippet?.trim()) {
          const snip = e.snippet.trim().replace(/\s+/g, " ").slice(0, SNIPPET_SHOWN);
          out.push(`  - ${s.snippetLabel} : \`${snip}${e.snippet.trim().length > SNIPPET_SHOWN ? "…" : ""}\``);
        }
      }
      out.push("");
    }
    const crit = pack ? getCriterion(pack, it.criteriaId) : undefined;
    // THE DECISION RULE — the standard's own first, WCAG's only as a labelled fallback.
    //
    // `ADJUDICATION` is keyed by WCAG success criterion: 52 keys, all three-segment. A pack
    // criterion id has two, so this lookup could only ever miss under `--standard rgaa` —
    // and it did, on every one of the 96 criteria an RGAA audit hands over. The brief shipped
    // the numbered tests and no instrument for reading them.
    //
    // Under a pack the instrument is the standard's OWN méthodologie de test, rendered under
    // each test below: it says how THAT test is verified, in the referential's words. Only a
    // criterion that carries none falls back on the mapped SCs' protocols — and then it is
    // announced as inherited, because an SC routinely asks a broader question than the
    // criterion mapped onto it (RGAA 8.6 asks whether the page title is *relevant*; WCAG
    // 2.4.2 only that one exists). Same discipline as `resolveGuidance`, which never lets an
    // inherited example pass for the national standard's own doctrine.
    if (pack) {
      if (!crit?.methodology || Object.keys(crit.methodology).length === 0) {
        for (const p of adjudicationForWcagRefs(crit?.wcag ?? [], lang)) {
          out.push(`> **${s.inheritedDecide(p.sc)}** — ${p.decide}`, "");
          if (p.na) out.push(`> **${s.na}** — ${p.na}`, "");
          if (p.questions.length) {
            out.push(`> ${s.questions}:`, "");
            for (const q of p.questions) out.push(`- ${q}`);
            out.push("");
          }
        }
      }
    } else {
      const protocol = ADJUDICATION[it.criteriaId];
      if (protocol) {
        out.push(`> **${s.decide}** — ${protocol.decide[lang]}`, "");
        if (protocol.na) out.push(`> **${s.na}** — ${protocol.na[lang]}`, "");
        if (protocol.questions.length) {
          out.push(`> ${s.questions}:`, "");
          for (const q of protocol.questions) out.push(`- ${q[lang]}`);
          out.push("");
        }
      }
    }
    // The references a NC on this criterion may legitimately cite. `verify --apply` rejects
    // a normativeRef that does not resolve, so what is proposed here MUST be what the gate
    // accepts — under a pack that is the criterion's own numbered tests, never a W3C
    // technique code (which the pack gate has always refused).
    if (pack) {
      const tests = crit?.tests ?? {};
      const keys = Object.keys(tests);
      // A DEFINITION IS READ BEFORE THE WORDING THAT USES IT. The glossary used to sit below
      // the tests, which is backwards for any criterion whose applicability turns on a defined
      // term — and RGAA 5.1 turns on nothing else: « tableau de données complexe » means one
      // whose headers are NOT confined to the first row and/or first column, and a cheap
      // adjudicator read that inside out and called a table complex for meeting the simple
      // case. The definition cannot be printed under the test that depends on it.
      out.push(...glossaryBlock(pack, crit, lang));
      out.push(...siblingBlock(pack, it.criteriaId, lang, s));
      if (keys.length) {
        // WHICH TESTS THE HARVEST ACTUALLY TOUCHES — additive, and only ever additive.
        //
        // RGAA 11.2 asks the same question six times over six labelling mechanisms; on a page
        // that labels every field with `<label>`, four of those tests are about markup that
        // exists nowhere in scope, and the brief used to present all six identically. The
        // marker is computed by intersecting the markup the TEST names (read off its own
        // wording) with the markup the HARVEST found (read off the parsed source) — both
        // facts, neither a judgement.
        //
        // It can only ADD attention. An unmarked test is never called inapplicable: the
        // legend says so outright, because the one unrecoverable error here would be an
        // adjudicator skipping a test that does apply and publishing a false conformity in a
        // legal deliverable. So a missed mechanism costs a marker, never a verdict.
        const found = new Set(it.markup ?? []);
        const touched = new Map<string, boolean>();
        for (const k of keys) {
          const wanted = testMarkupTokens(tests[k] ?? []);
          touched.set(k, wanted.length > 0 && wanted.some((tok) => found.has(tok)));
        }
        const anyTouched = [...touched.values()].some(Boolean);
        out.push(`> **${s.packTests(pack.name, it.criteriaId)}**`, "");
        if (anyTouched) out.push(`> ${s.touchedLegend}`, "");
        for (const k of keys) {
          const lines = tests[k] ?? [];
          // A RGAA test can carry sub-conditions ("… vérifie-t-il ces conditions ?" followed
          // by the list). Number the test once and indent its conditions, rather than
          // repeating the id and reading like N separate tests.
          const mark = anyTouched && touched.get(k) ? ` ⬤ _(${s.touched})_` : "";
          out.push(`- \`${it.criteriaId}.${k}\`${mark} ${plainTest(lines[0] ?? "")}`);
          for (const line of lines.slice(1)) out.push(`  - ${plainTest(line)}`);
          // AND HOW THAT TEST IS ACTUALLY RUN, in the standard's own words. The test states
          // what is required; this states the procedure — find these elements, check this of
          // each, and the test passes iff. It is the instrument a country-standard criterion
          // used to lack entirely, and it belongs under its own test rather than in a block
          // of its own: eight procedures listed apart from the eight tests they belong to is
          // a matching exercise nobody should have to do while ruling.
          const method = crit?.methodology?.[k];
          if (method?.trim()) {
            const flat = plainTest(method).replace(/\s+/g, " ").trim();
            out.push(`  - _${s.methodology}_ : ${flat.length > MAX_METHODOLOGY_CHARS ? `${flat.slice(0, MAX_METHODOLOGY_CHARS)}…` : flat}`);
          }
        }
        out.push("");
      }
      if (crit?.technicalNote?.length) out.push(`> **${s.technicalNote}** — ${crit.technicalNote.map(plainTest).join(" ")}`, "");
      if (crit?.particularCases?.length) out.push(`> **${s.particularCases}** — ${crit.particularCases.map(plainTest).join(" ")}`, "");
      out.push(...packGuidanceBlock(standard, it.criteriaId, lang));
      out.push(...sourceBlock(s, pack.name, it.criteriaId, criterionUrl(pack, it.criteriaId), opts.web === true));
      // Labelled for the standard in play. The core's wording names W3C techniques, which is
      // exactly what the pack gate refuses — printing it over a list of RGAA test ids told
      // the adjudicator the ids were something they are not.
      if (keys.length) out.push(`> ${s.packRefs(pack.name)}: ${keys.map((k) => `\`${it.criteriaId}.${k}\``).join(", ")}`, "");
    } else {
      out.push(...sourceBlock(s, "WCAG", it.criteriaId, understanding(it.criteriaId), opts.web === true));
      const refs = techniquesFor(it.criteriaId);
      if (refs.length) {
        out.push(`> ${s.refs}: ${refs.slice(0, MAX_REFS).join(", ")}${refs.length > MAX_REFS ? ` … (\`criteria ${it.criteriaId}\`)` : ""}`, "");
      }
    }
  }
  return out.join("\n");
}

export interface WriteAdjudicationResult {
  todoPath: string;
  mdPath: string;
  /** The verdicts-only file, for an adjudicator that cannot edit half a megabyte of JSON. */
  verdictsPath: string;
  /** One small Markdown brief per criterion, for one that cannot read it either. */
  itemsDir: string;
  count: number;
}

export function writeAdjudication(
  items: AdjudicationItem[],
  outDir: string,
  opts: { standard: StandardId; auditDate: string; lang?: Lang; unrendered?: string[]; web?: boolean },
): WriteAdjudicationResult {
  mkdirSync(outDir, { recursive: true });
  const todoPath = join(outDir, "ADJUDICATE.todo.json");
  const mdPath = join(outDir, "ADJUDICATE.md");
  const file: AdjudicationFile = {
    tool: "ultra11y",
    kind: "adjudication",
    schemaVersion: SCHEMA_VERSION,
    standard: opts.standard,
    auditDate: opts.auditDate,
    contract: adjudicationContract(),
    items,
  };
  writeFileSync(todoPath, JSON.stringify(file, null, 2) + "\n");
  writeFileSync(
    mdPath,
    formatAdjudication(items, opts.lang ?? "en", opts.standard, {
      ...(opts.unrendered?.length ? { unrendered: opts.unrendered } : {}),
      ...(opts.web ? { web: true } : {}),
    }),
  );

  // THE SPLIT SURFACE, for an adjudicator that cannot shell out.
  //
  // The two documents above are sized for a session with a shell: 96 RGAA criteria carrying
  // 30 evidence anchors each come to ~540 KB of JSON and ~470 KB of Markdown, and the runbook
  // tells the reader to edit the JSON in place and then run the engine to fold it. That is
  // fine locally. In CI the adjudicator is handed Read/Grep/Glob/Edit/Write and nothing else,
  // and against those tools the same instructions are impossible: reading either document
  // swamps the context, editing 96 verdicts inside half a megabyte of JSON is 96 exact-match
  // edits, and every prescribed `node …` command is denied. Measured on a real run: 17
  // permission denials, 75 of 424 turns used, and a todo file that came back untouched — so
  // the fail-closed fold correctly discarded all 96 and every criterion stayed "to assess".
  //
  // So the same worklist is also written as one small file to WRITE and one small file per
  // criterion to READ. Additive on purpose: the two documents above keep their exact shape and
  // every existing caller, gate and test is untouched.
  const verdictsPath = join(outDir, "ADJUDICATE.verdicts.json");
  writeFileSync(verdictsPath, JSON.stringify({ ...file, items: slimAdjudicationItems(items) }, null, 2) + "\n");
  const itemsDir = join(outDir, "adjudicate");
  mkdirSync(itemsDir, { recursive: true });
  // The per-criterion brief gets its OWN slice of the unrendered residue. A criterion that needs
  // a browser nobody ran must say so on the sheet the adjudicator actually reads — otherwise the
  // one honest `needs-rendered-dom` in the run looks like a guess, and the run before it spent
  // three passes discovering by hand what this line states for free.
  const unrendered = new Set(opts.unrendered ?? []);
  for (const it of items) {
    const mine = unrendered.has(it.criteriaId) ? [it.criteriaId] : [];
    writeFileSync(
      join(itemsDir, `${it.criteriaId}.md`),
      formatAdjudication([it], opts.lang ?? "en", opts.standard, {
        preamble: false,
        ...(mine.length ? { unrendered: mine } : {}),
        ...(opts.web ? { web: true } : {}),
      }),
    );
  }
  return { todoPath, mdPath, verdictsPath, itemsDir, count: items.length };
}

/** The worklist with the evidence stripped: what an adjudicator has to WRITE, without the
 *  bulk it only has to READ. Every field the fold requires — verdict, justification, reason,
 *  findings, citations, recommendations — is kept, so a filled slim file carries a complete
 *  decision. The evidence comes back at fold time via `hydrateAdjudication`. */
/** Representatives pre-cited in the skeleton. Three is enough to show the shape and to stand
 *  for the population; the whole set is in the brief, and `occurrences` travels with each. */
const PREFILLED_CITATIONS = 3;

/** Characters of the snippet a pre-filled citation carries. Enough to identify the element to
 *  a reader of the diff; the grounding matches on the anchor, not on the length. */
const CITATION_SNIPPET_MAX = 120;

export function slimAdjudicationItems(items: AdjudicationItem[]): AdjudicationItem[] {
  return items.map((it) => {
    const { evidence: _evidence, evidenceTruncated: _truncated, ...rest } = it;
    // THE CITATIONS ARRIVE FILLED IN.
    //
    // This file is the only one a CI adjudicator writes, and it used to arrive with no evidence
    // and no citations: clearing a criterion meant authoring
    // `citations: [{file, line, selector, snippet}]` from scratch, by hand, cross-referencing a
    // separate brief, once per criterion. Measured on a real run: thirty criteria came back `C`
    // with a considered justification and no citations at all, and the fold refused every one
    // — « a C verdict must cite at least one of the N evidence item(s) it was shown ». The
    // agent had read the evidence. It had simply not copied an anchor into a second file.
    //
    // Pre-filling decides nothing. The verdict and the justification are still the agent's, and
    // a `C` still has to survive grounding, the coverage check and the complete-evidence rule.
    // What it removes is a transcription step that was costing correct verdicts — the same
    // failure, one level up, as an adjudicator retyping a snippet instead of copying it.
    //
    // `population` and `evidenceComplete` are kept for the same reason they always were: they
    // are two numbers, not bulk, and they tell the adjudicator how much of the subject it is
    // actually looking at.
    // MINIMAL, and that is not a detail: the first cut of this pre-filled the whole Evidence
    // object, `alsoAt` included — 167 sibling anchors on one criterion — and turned the file
    // the prompt calls "the small one to write" into 367 KB. Measured: the adjudicator stopped
    // after 22 turns of a 228 budget, filled nothing, and every criterion came back
    // `unadjudicated`. A citation only ever needs to say WHICH element; the population, the
    // siblings and the note belong to the brief, which is the file to READ.
    const citations = it.evidence.slice(0, PREFILLED_CITATIONS).map((e) => ({
      file: e.file,
      line: e.line,
      ...(e.selector ? { selector: e.selector } : {}),
      ...(e.snippet ? { snippet: e.snippet.slice(0, CITATION_SNIPPET_MAX) } : {}),
    }));
    return { ...rest, evidence: [], ...(citations.length ? { citations } : {}) } as AdjudicationItem;
  });
}

/** Put the evidence back on a slim adjudication, re-derived from the audit it was built from.
 *
 *  Safe because the worklist is a pure function of the audit: same audit, same harvesters, same
 *  anchors. This is what lets `verify --apply` accept a verdicts-only file WITHOUT relaxing a
 *  single check — the citation gate still matches each cited anchor against this criterion's
 *  own harvested evidence, exactly as it does for an inline worklist.
 *
 *  An item the re-derivation does not know is left alone: it is a surplus verdict, and the
 *  coverage check in `applyAdjudication` is what must reject it. */
export function hydrateAdjudication(adj: AdjudicationFile, audit: AuditResult, opts: { cwd?: string } = {}): void {
  const needs = adj.items.filter((it) => !it.evidence || it.evidence.length === 0);
  if (!needs.length) return;
  const derived = new Map(buildAdjudicationWorklist(audit, { ...opts, standard: adj.standard }).map((it) => [it.criteriaId, it]));
  for (const it of needs) {
    const full = derived.get(it.criteriaId);
    if (!full) continue;
    it.evidence = full.evidence;
    if (full.evidenceTruncated) it.evidenceTruncated = full.evidenceTruncated;
    if (full.markup?.length) it.markup = full.markup;
    // The completeness facts travel with the evidence: the `C` gate reads `evidenceComplete`,
    // and leaving it undefined on a re-hydrated item would let an incomplete reading clear a
    // criterion through the slim path that the inline path refuses.
    if (full.population) it.population = full.population;
    it.evidenceComplete = full.evidenceComplete;
  }
}
