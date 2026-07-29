// `audit` — run the static engine over the inputs and aggregate findings into an
// AuditResult: a preliminary, engine-only verdict per criterion (C/NC/NA for the
// static criteria it can decide; "manual" for everything needing rendering or
// judgment, surfaced as residual risks). `report` renders this; Claude completes
// the manual criteria.
import { createHash } from "node:crypto";
import type { AuditResult, CriterionResult, Finding, ResidualRisk, Status, GuidelineTally } from "./types.js";
import { VERSION, SCHEMA_VERSION } from "./types.js";
import { allSC, allGuidelines } from "./wcag.js";
import { parseSource } from "./parse/source.js";
import { attachSignals } from "./snapshot.js";
import { attr, elementsByTag, type Doc, type CaptureProvenance } from "./parse/html.js";
import { computeCaptureCoverage, enrichCaptureOrigins, readCaptureDir, capturesForSources } from "./capture.js";
import { isFullDocument } from "./rules/rule.js";
import { runRules } from "./rules/registry.js";
import { runCrossRules } from "./rules/cross-registry.js";
import { listPacks } from "./standards/registry.js";
import { runPackRules } from "./standards/pack-rules.js";
import { buildGraphAndDocs } from "./graph/build.js";
import type { DepGraph } from "./graph/graph.js";
import { discover } from "./discover.js";
import { GRAPH_ONLY_EXT } from "./glob.js";
import { readText, today } from "./util.js";

export type DedupMode = "exact" | "normalized" | "off";

export interface AuditInput {
  inputs: string[];
  stdin?: string;
  forceJsx?: boolean;
  include?: string[];
  exclude?: string[];
  ext?: string[];
  // scale controls
  changed?: boolean; // audit only git-changed files
  since?: string; // git ref to diff against (implies changed)
  staged?: boolean; // audit exactly the staged index snapshot (strict pre-commit scope)
  dedup?: DedupMode; // collapse identical files to one canonical audit (default exact)
  maxFiles?: number; // hard cap on canonical files audited (logged truncation)
  graph?: boolean; // also run cross-file rules over a dependency graph (--graph)
  captureCoverage?: boolean; // compute scope.captureCoverage (implies a graph pass)
  captureDir?: string; // dir scanned for the repo-wide capture set (coverage); default .ultra11y/captures
  // In --changed/--since/--staged mode, also ingest the captures under `captureDir`
  // whose provenance sourceFile matches one of the diffed files (capturesForSources) —
  // a capture is rarely itself part of the diff, so the audit would otherwise stay
  // blind to the real rendered DOM for a touched component. No-op outside diff mode
  // (a full scan's capture ingestion is the CLI appending captureDir as a top-level
  // input instead — see cmdAudit's `useCaptures`).
  captureDiff?: boolean;
  noDefaultExcludes?: boolean; // also audit test/spec/story/__tests__ markup
  onWarn?: (msg: string) => void;
}

const has = (d: Doc, ...tags: string[]): boolean => d.elements.some((e) => tags.includes(e.tag));

// Applicability predicate per STATIC success criterion (the only SCs the engine
// reports Conforming when clean): is there any relevant element to check? If not,
// the SC is NA rather than a hollow "C". WCAG SCs are coarser than the rules, so the
// static set is deliberately tiny (see scripts/build-standards.mjs); every other
// mapped SC raises only DEFINITE non-conformities and stays "manual" otherwise.
const APPLICABLE: Record<string, (d: Doc) => boolean> = {
  "1.4.2": (d) => has(d, "audio", "video"), // Audio Control — autoplay-media (audio branch)
  "2.4.2": (d) => isFullDocument(d), // Page Titled — title-missing-empty
  "3.1.1": (d) => isFullDocument(d), // Language of Page — html-lang-missing / lang-invalid
};

function residualReason(automatability: string): string {
  return automatability === "needs-rendering"
    ? "Needs a rendered DOM (contrast, focus visibility, zoom/reflow, target size) — decide via `scan`."
    : "Judgement criterion — adjudicated by the agent from source/context (`verify --manual`, gated).";
}

// Streaming accumulator: parse → run rules → fold → DISCARD each Doc, so the
// engine never holds a whole repo in memory. The only cross-document state is
// (a) the flat findings list (bounded by finding count, not source size) and
// (b) per-criterion applicability, OR-folded across docs (NA only if NO doc made
// the criterion applicable — never because findings happened to be absent).
interface Accum {
  byCriterion: Map<string, Finding[]>;
  applicable: Map<string, boolean>; // static criteria only
  allFindings: Finding[];
  packFindings: Finding[]; // declarative pack-rule findings (namespaced pack:<key>:<id>)
  fileCount: number;
  opaqueLibs: Set<string>; // component-library specifiers rendered but not source-analysable
  opaqueFiles: number; // count of source files that render such components
  sfcFiles: number; // .vue/.svelte/.astro source templates audited (verdicts preliminary)
  sfcExts: Set<string>; // which SFC extensions were seen
  captures: { file: string; provenance: CaptureProvenance }[]; // rendered capture files audited
  langCounts: Map<string, number>; // <html lang> primary subtags seen, for repo-language detection
}

// Precompute the static success criteria + their applicability predicates once.
const STATIC_PREDS: ReadonlyArray<readonly [string, (d: Doc) => boolean]> = allSC()
  .filter((c) => c.automatability === "static")
  .map((c) => [c.sc, APPLICABLE[c.sc] ?? isFullDocument] as const);

function newAccum(): Accum {
  return {
    byCriterion: new Map(),
    applicable: new Map(),
    allFindings: [],
    packFindings: [],
    fileCount: 0,
    opaqueLibs: new Set(),
    opaqueFiles: 0,
    sfcFiles: 0,
    sfcExts: new Set(),
    captures: [],
    langCounts: new Map(),
  };
}

// Primary subtag of an `<html lang>`/`xml:lang` value: "fr-FR" → "fr", "en" → "en".
// Mirrors the BCP47 primary-subtag reading the html-lang-missing/lang-invalid rules use.
function primarySubtag(lang: string): string | undefined {
  const m = lang.trim().match(/^[a-z]{1,8}/i);
  return m ? m[0].toLowerCase() : undefined;
}

/** Fold one parsed document into the accumulator, then let it be GC'd. When a
 *  graph is supplied, cross-file findings are added and graph-proven false
 *  positives are suppressed (matched by ruleId + line on this same doc). */
export function foldDoc(acc: Accum, doc: Doc, graph?: DepGraph): void {
  let findings = runRules(doc);
  if (graph) {
    const cross = runCrossRules(doc, graph);
    if (cross.suppress.length) {
      findings = findings.filter((f) => !cross.suppress.some((s) => s.ruleId === f.ruleId && s.line === f.line));
    }
    findings = findings.concat(cross.findings);
    // A cross finding is evidence its criterion is applicable here (the per-doc
    // static predicates only know native elements, not resolved components).
    for (const f of cross.findings) acc.applicable.set(f.criteriaId, true);
  }
  for (const f of findings) {
    acc.allFindings.push(f);
    const arr = acc.byCriterion.get(f.criteriaId) ?? [];
    arr.push(f);
    acc.byCriterion.set(f.criteriaId, arr);
  }
  // Declarative pack rules run AFTER the core rules over the same Doc. Their findings are
  // collected SEPARATELY (never into byCriterion/allFindings) so the core WCAG verdict is
  // untouched — they surface only when a pack projection is derived. A pack without rules
  // is an instant no-op.
  for (const pack of listPacks()) {
    if (pack.rules?.length) acc.packFindings.push(...runPackRules(doc, pack));
  }
  for (const [id, pred] of STATIC_PREDS) {
    if (!acc.applicable.get(id) && pred(doc)) acc.applicable.set(id, true);
  }
  if (doc.opaqueComponents?.length) {
    for (const lib of doc.opaqueComponents) acc.opaqueLibs.add(lib);
    acc.opaqueFiles++;
  }
  if (doc.kind === "sfc") {
    acc.sfcFiles++;
    const e = doc.file.toLowerCase().match(/\.[a-z]+$/)?.[0];
    if (e) acc.sfcExts.add(e);
  }
  if (doc.capture) acc.captures.push({ file: doc.file, provenance: doc.capture });
  const html = elementsByTag(doc, "html")[0];
  const htmlLang = html ? (attr(html, "lang") ?? attr(html, "xml:lang") ?? "").trim() : "";
  const subtag = htmlLang ? primarySubtag(htmlLang) : undefined;
  if (subtag) acc.langCounts.set(subtag, (acc.langCounts.get(subtag) ?? 0) + 1);
  acc.fileCount++;
}

interface FinalizeExtra {
  truncated?: { limit: number; total: number; skipped: number };
  dedup?: { canonicalFiles: number; duplicateFiles: number };
}

function finalize(acc: Accum, inputs: string[], extra: FinalizeExtra = {}): AuditResult {
  const criteria: CriterionResult[] = [];
  const residualRisks: ResidualRisk[] = [];

  for (const c of allSC()) {
    const fs = acc.byCriterion.get(c.sc) ?? [];
    // ONLY normative findings drive status + conformancePct. Advisory findings (non-normative
    // recommendations) stay attached to the criterion and in the flat list, but can never
    // flip it to NC — a criterion whose findings are ALL advisory keeps its automatability-
    // driven status (C/NA for static, manual for judgment/needs-rendering).
    const normativeFs = fs.filter((f) => !f.advisory);
    let status: Status;
    let justification: string | undefined;

    if (c.automatability === "static") {
      const applicable = acc.applicable.get(c.sc) ?? false;
      if (!applicable) {
        status = "NA";
        justification = "No element in scope is concerned by this success criterion.";
      } else if (normativeFs.length > 0) {
        status = "NC";
      } else {
        status = "C";
      }
    } else if (normativeFs.length > 0) {
      // a rule on a needs-rendering / judgment SC raised a DEFINITE failure
      status = "NC";
    } else {
      // engine can't decide — leave it for the agent to adjudicate (`verify --manual`,
      // gated) or the `scan` tier (rendering criteria); never a silent conforming.
      status = "manual";
      residualRisks.push({ criteriaId: c.sc, reason: residualReason(c.automatability), automatability: c.automatability });
    }
    criteria.push({ id: c.sc, guideline: c.guideline, status, findings: fs, ...(justification ? { justification } : {}) });
  }

  const guidelines: GuidelineTally[] = allGuidelines().map((g) => {
    const inG = criteria.filter((c) => c.guideline === g.number);
    return {
      key: g.number,
      title: g.title,
      c: inG.filter((c) => c.status === "C").length,
      nc: inG.filter((c) => c.status === "NC").length,
      na: inG.filter((c) => c.status === "NA").length,
      manual: inG.filter((c) => c.status === "manual").length,
    };
  });

  const decided = criteria.filter((c) => c.status === "C" || c.status === "NC");
  const conform = decided.filter((c) => c.status === "C").length;
  const conformancePct = decided.length === 0 ? 100 : Math.round((conform / decided.length) * 100);

  return {
    tool: "ultra11y",
    standard: "wcag",
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    date: today(),
    scope: {
      inputs,
      files: acc.fileCount,
      ...(extra.truncated ? { truncated: extra.truncated } : {}),
      ...(extra.dedup ? { dedup: extra.dedup } : {}),
      ...(acc.opaqueLibs.size ? { rendered: { opaqueLibraries: [...acc.opaqueLibs].sort(), files: acc.opaqueFiles } } : {}),
      ...(acc.sfcFiles ? { sourceTemplate: { files: acc.sfcFiles, extensions: [...acc.sfcExts].sort() } } : {}),
      ...(acc.captures.length
        ? {
            captures: {
              files: acc.captures.length,
              components: [...new Set(acc.captures.map((c) => c.provenance.component).filter((x): x is string => !!x))].sort(),
            },
          }
        : {}),
      ...(acc.langCounts.size ? { langs: [...acc.langCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([lang]) => lang) } : {}),
    },
    guidelines,
    criteria,
    findings: acc.allFindings,
    ...(acc.packFindings.length ? { packFindings: acc.packFindings } : {}),
    residualRisks,
    conformancePct,
  };
}

/** Build an AuditResult from already-parsed docs (eager path; used by tests and
 *  any in-memory caller). The streaming runAudit produces an identical result. */
export function buildAudit(docs: Doc[], inputs: string[]): AuditResult {
  const acc = newAccum();
  for (const d of docs) foldDoc(acc, d);
  return finalize(acc, inputs);
}

function hashContent(content: string, mode: Exclude<DedupMode, "off">): string {
  const norm = mode === "normalized" ? content.replace(/>\s+</g, "><").trim() : content;
  return createHash("sha1").update(norm).digest("hex");
}

/** Resolve inputs and audit them in a single streaming pass: read → (dedup) →
 *  parse → fold → discard. Bounded memory, deterministic order. */
export function runAudit(opts: AuditInput): AuditResult {
  const acc = newAccum();
  // Content dedup is off in --changed/--staged mode: a changed file must always be
  // audited, and it could otherwise collapse against an unchanged file we never read.
  const dedupMode: DedupMode = opts.changed || opts.since || opts.staged ? "off" : (opts.dedup ?? "exact");
  const seen = new Set<string>();
  let duplicateFiles = 0;
  let truncated: FinalizeExtra["truncated"];

  // `--graph` expands the same inputs twice (markup, then markup + .ts/.js). The tree
  // walk is the identical, extension-agnostic part of both — share it.
  const walkCache = new Map<string, string[]>();

  const {
    files: discovered,
    gitUnavailable,
    stagedContent,
  } = discover(opts.inputs, {
    include: opts.include,
    exclude: opts.exclude,
    ext: opts.ext,
    changed: opts.changed,
    since: opts.since,
    staged: opts.staged,
    noDefaultExcludes: opts.noDefaultExcludes,
    onWarn: opts.onWarn,
    walkCache,
  });
  // In staged mode, read the index blob (from discovery) instead of the working tree.
  const useStaged = opts.staged === true && !gitUnavailable;

  // Diff-scoped mode (--changed/--since/--staged): a capture is rarely itself part of
  // the diff (the SOURCE changed; its already-committed capture usually didn't), so
  // pull in just the captures relevant to the diffed files (capturesForSources) — read
  // from the working tree/disk even in --staged mode (an unchanged capture's staged
  // blob and working-tree copy are identical). Extra files, never removed from the
  // diff's own scope; a full scan's capture ingestion is the CLI appending captureDir
  // as a top-level input instead (see cmdAudit's `useCaptures`).
  const diffMode = opts.changed || opts.since || opts.staged;
  const relevantCaptures =
    opts.captureDiff && diffMode && opts.captureDir ? capturesForSources(opts.captureDir, discovered).filter((c) => !discovered.includes(c)) : [];
  const files = relevantCaptures.length ? [...discovered, ...relevantCaptures] : discovered;

  // Cross-file pass: build the dependency graph over the FULL scope (so a changed
  // file's references resolve into unchanged definitions), then run cross rules in
  // the audit loop below. Off by default — a plain audit is byte-identical. The
  // graph's OWN discovery always widens to GRAPH_ONLY_EXT (.ts/.js/.mjs/.cjs) on top
  // of whatever --ext adds — a barrel/plain-JS module is never an audit target (see
  // `files` above), but it is real cross-file structure the graph resolves through.
  let graph: DepGraph | undefined;
  // Docs the graph pass already parsed, handed over so the audit loop below does not
  // read and parse the very same markup a second time. Never used in --staged mode:
  // there the audit must see the INDEX blob while the graph pass read the working
  // tree, so the two can legitimately differ. Nor under --jsx, which forces a parser
  // the graph pass does not apply.
  let carried: Map<string, Doc> | undefined;
  if (opts.graph || opts.captureCoverage) {
    const graphExt = [...GRAPH_ONLY_EXT, ...(opts.ext ?? [])];
    const graphFiles = discover(opts.inputs, {
      include: opts.include,
      exclude: opts.exclude,
      ext: graphExt,
      noDefaultExcludes: opts.noDefaultExcludes,
      walkCache,
    }).files;
    const built = buildGraphAndDocs(graphFiles, { carryDocs: !useStaged && !opts.forceJsx });
    graph = built.graph;
    if (built.docs.size) carried = built.docs;
  }

  for (let i = 0; i < files.length; i++) {
    if (opts.maxFiles && opts.maxFiles > 0 && acc.fileCount >= opts.maxFiles) {
      // skipped = candidates not audited (reconciles: audited + skipped == total),
      // counting both never-examined files and any read failures along the way.
      const skipped = files.length - acc.fileCount;
      truncated = { limit: opts.maxFiles, total: files.length, skipped };
      opts.onWarn?.(
        `ultra11y: --max-files=${opts.maxFiles} reached; audited ${acc.fileCount}/${files.length} files (highest-priority first). Skipped ${skipped}.`,
      );
      break;
    }
    const file = files[i]!;
    let content: string;
    const staged = useStaged ? stagedContent?.get(file) : undefined;
    // A carried Doc already holds the file's source, so a hit skips the read entirely.
    const reused = staged === undefined ? carried?.get(file) : undefined;
    if (staged !== undefined) {
      content = staged;
    } else if (reused) {
      content = reused.source;
    } else {
      try {
        content = readText(file);
      } catch {
        continue; // unreadable / vanished between discovery and read
      }
    }
    if (dedupMode !== "off") {
      const h = hashContent(content, dedupMode);
      if (seen.has(h)) {
        duplicateFiles++;
        continue; // identical to an already-audited file — cite the canonical one
      }
      seen.add(h);
    }
    const doc = reused ?? parseSource(content, file, { forceJsx: opts.forceJsx });
    // A page snapshot carries browser-only signals beside its dom.html (computed styles,
    // boxes, a11y tree, screenshot). Attaching them here — after the parse, where file IO
    // already lives — is what lets the rendered rules decide criteria the source cannot,
    // OFFLINE and with no browser. A no-op for every other file.
    attachSignals(doc);
    foldDoc(acc, doc, graph);
  }

  const canonicalFiles = acc.fileCount;
  // Respect --max-files for stdin too (don't let the stdin doc push past the cap).
  if (opts.inputs.includes("-") && opts.stdin !== undefined && !(opts.maxFiles && opts.maxFiles > 0 && acc.fileCount >= opts.maxFiles)) {
    foldDoc(acc, parseSource(opts.stdin, "<stdin>", { forceJsx: opts.forceJsx }), graph);
  }

  const result = finalize(acc, opts.inputs, {
    ...(truncated ? { truncated } : {}),
    ...(duplicateFiles > 0 ? { dedup: { canonicalFiles, duplicateFiles } } : {}),
  });
  if (graph) {
    enrichCaptureOrigins(result.findings, graph); // anchor capture findings at the source component line
    // Coverage is a repo-wide property: read the FULL capture set from the captures dir,
    // not acc.captures (which is scoped to what THIS run audited — empty in --changed/--staged).
    if (opts.captureCoverage) result.scope.captureCoverage = computeCaptureCoverage(graph, readCaptureDir(opts.captureDir ?? ".ultra11y/captures"));
  }
  return result;
}
