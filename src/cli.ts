import { realpathSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  VERSION,
  type Lang,
  type AuditResult,
  type DynamicResult,
  type Finding,
  type PageResult,
  type SampleConfig,
  type SamplePage,
  type ScanRedirect,
} from "./types.js";
import { runAudit } from "./audit.js";
import { decide, type PreToolUsePayload } from "./hook.js";
import {
  averageConformanceRate,
  averageRateLine,
  foldRates,
  pageConformanceCell,
  writeReportFiles,
  packPartialAudit,
  packReportRates,
  partialAuditBanner,
  ranBrowser,
  withReportAnnexes,
  renderReasonLabel,
} from "./report.js";
import { writePrd, prdUnits, type PrdFormat } from "./prd.js";
import { buildTickets } from "./tickets/grain.js";
import { pushTickets } from "./tickets/push.js";
import { autoProvider, createProvider, isProviderId } from "./tickets/registry.js";
import { ALL_GRAINS, ALL_PROVIDERS, TICKET_SET_SCHEMA_VERSION, type TicketGrain, type TicketSetFile, type TransportMode } from "./tickets/types.js";
import { detectFrameworks, renderPlan, parseStorybookIndex, storyProvenance, type Detection } from "./render.js";
import {
  DEFAULT_RENDER_TIMEOUT_MS,
  RENDER_MANIFEST,
  TRANSPILERS,
  renderCounts,
  renderScopeFor,
  runRenderEngine,
  type TranspilerName,
} from "./render-engine.js";
import { CAPTURES_DIR, computeCaptureCoverage, parseCaptureProvenance, formatCaptureComment, type CaptureEntry } from "./capture.js";
import { buildGraphStreaming } from "./graph/build.js";
import { discover } from "./discover.js";
import { toPosix, GRAPH_ONLY_EXT } from "./glob.js";
import { runCriteria, renderCriteriaReference } from "./criteria.js";
import { checkSampleCaptured, checkDecided, checkRendered, checkReport, checkSemantic, isUndecidedFile, type UndecidedFile } from "./check.js";
import {
  buildWorklist,
  buildConformityWorklist,
  conformityClaimsFromAudit,
  writeWorklist,
  applyVerdicts,
  VERIFY_MAX,
  type ConformityClaim,
  type ConformitySource,
  type VerifyItem,
  verifyGroundingInputs,
  readVerifyContext,
  writeVerifyContext,
} from "./verify.js";
import { pruneRefuted, type PruneResult } from "./refute.js";
import { groundItems } from "./grounding.js";
import {
  buildAdjudicationWorklist,
  writeAdjudication,
  applyAdjudication,
  hydrateAdjudication,
  unrenderedResidual,
  adjudicationLimits,
  evidenceFallback,
  evidenceForCriteria,
  type AdjudicationFile,
} from "./adjudicate.js";
import {
  emptyLedger,
  entriesFrom,
  isLedger,
  ledgerPath,
  mergeLedger,
  pruneLedger,
  readLedger,
  replayLedger,
  unreadableCaptures,
  type VerdictLedger,
  writeLedger,
} from "./ledger.js";
import { combineDynamic, mergeDynamic, mergeSnapshotAudit, scanPageSummary } from "./scan.js";
import { resolveAxeEngine } from "./axe-engine.js";
import { ALL_ROUTES_MAX, type ObservedPage, type RouteSource, readRoutes, routeCounts, routeCoverage, routePath, routesToScan, writeRoutes } from "./routes.js";
import type { SampleMethodology } from "./standards/types.js";
import { applyProposal, DEFAULT_SAMPLE_SIZE, type ProposalInput, proposeSample, type SampleProposal, skeletonOf } from "./sample-propose.js";
import { DOCUMENTS_DIR, downloadSnapshotDocuments } from "./documents.js";
import { runScanLocal, runScanManyLocal, runCrawlScanLocal, runSampleScanLocal, localTierStatus } from "./scan-local.js";
import { validateSample, lintSample, kindLabel, isTransverseKind, proposeSamplePages, mergeSample, sampleFromSnapshots, unionSample } from "./sample.js";
import { runFix, fixSummary } from "./fix.js";
import { findingId, parseFailOn, findingsAtOrAbove } from "./baseline.js";
import { repoRoot, resolveEnginePath, writeHook } from "./init.js";
import { installForTargets, parseTargets, statusReport, uninstallForTargets } from "./install/index.js";
import { agentsMdBlock } from "./install/agents-md.js";
import { parseOpencodeMajorFlag } from "./install/opencode.js";
import { auditSummary, captureCoverageSummary } from "./output.js";
import { evidenceNotice, writeEvidence } from "./evidence.js";
import { writeHtml } from "./html-emit.js";
import {
  PAGES_DIR,
  readSnapshots,
  type SnapshotProbes,
  validateSnapshotMeta,
  pageScreenshot,
  writeSnapshot,
  type AxNode,
  type BoxDigest,
  type CssDigest,
  type StyleDigest,
} from "./snapshot.js";
import { attributePages, derivePages, pageScopesFrom, pagesOf, renderPageGrid, unattributedFindings } from "./pages.js";
import { pagesForStandard, renderPageDocument, renderPagesDocument, renderPagesIndex } from "./pages-report.js";
import { crawlBound, crawlUrls, extractTitle, parseSitemapUrls } from "./crawl.js";
import { resolveStandard, getPack, isCore, loadPack, findingsForStandard, type StandardId } from "./standards/index.js";
import { auditDocumentFor, packAuditDocument, unwrapAudit } from "./standards/document.js";
import { loadRuntimeStandards, loadConfig, type Ultra11yConfig } from "./config.js";
import { runPackCheck, packScaffold } from "./pack.js";
import { buildManifest, listPhases, orchestrateRun, PHASES } from "./orchestrate.js";
import { buildTrialSummary, formatTrialSummary } from "./trial-summary.js";
import { readStdin, readText } from "./util.js";
import type { RenderSignals } from "./types.js";

const HELP = `ultra11y v${VERSION}
Audit a site against RGAA 4.1.2, the French State's accessibility standard, on a
WCAG 2.2 AA core, and produce a dated conformance report, or author/review accessible
markup (native-HTML-first). A deterministic, install-free static engine plus your
judgment, with check/verify gates against hallucinated non-conformities: nothing is
declared conforming that was not verified. --standard rgaa selects the RGAA pack;
WCAG is the worldwide core, other country standards are pluggable packs.

Usage:
  ultra11y audit    <globs… | -> [--out <dir>] [--include <glob>] [--exclude <glob>] [--ext <list>] [--jsx] [--graph] [--json] [--lang auto|en|fr] [--no-default-excludes]
  ultra11y audit    [--changed | --since <ref> | --staged] [--max-files <n>] [--dedup exact|normalized|off] [--fail-on blocking|major|minor]
  ultra11y audit    [--captures <dir>] [--no-captures] [--require-captures]   (rendered-DOM captures + .ultra11y/pages snapshots: audit real HTML)
  ultra11y audit    --in <audit.json> [--fail-on blocking|major|minor]   (re-gate an audit already computed — e.g. one carrying adjudicated verdicts — without a second detection pass)
  ultra11y report   --in <audit.json> [--out <dir>] [--standard <pack>] [--lang auto|en|fr]
  ultra11y report   --in <audit.json> [--evidence [--evidence-max <n>]] [--out <dir>]   (the Markdown report, illustrated with annotated crops)
  ultra11y report   --in <audit.json> --html [--evidence] [--inline-budget <bytes>] [--out <dir>]   (index.html + a printable single file)
  ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc] [--no-technical] [--standard <pack>] [--lang auto|en|fr]
  ultra11y tickets  --in <audit.json> [--provider auto|github|gitlab|jira] [--grain criterion|page|page-criterion|single|file] [--transport auto|cli|rest]
  ultra11y tickets  [--out <dir>] [--max-tickets <n>] [--dry-run] [--json] [--standard <pack>] [--no-technical] [--lang auto|en|fr]
  ultra11y render   [<dir>] [--transpiler esbuild|typescript|sucrase] [--timeout <ms>] [--include <glob>] [--exclude <glob>] [--no-stories] [--json]   (ultra11y's render engine: components, pages, stories → .ultra11y/captures + .ultra11y/render.json)
  ultra11y render   [<dir>] --detect | --coverage | --storybook [--captures <dir>] [--json] [--lang auto|en|fr]
  ultra11y criteria [<sc>] [--list] [--standard <pack> [--theme <N>]] [--generate] [--json] [--lang auto|en|fr]
  ultra11y criteria --standard <pack> --glossary [<term>]   (the terms the standard DEFINES — its tests depend on them)
  ultra11y criteria [--standard <pack>] --plan [--json]   (the work plan: which criteria the engine settles from source, which need a page, a browser, or judgment)
  ultra11y check    --report <md> [--standard <pack>] [--in <audit.json>] [--semantic [--verdicts <file>]] [--quiet] [--json]
  ultra11y check    --in <audit.json> --require-decided [--standard <pack>] [--allow-undecided <file>]   (fail while any criterion is still « to assess »)
  ultra11y verify   --report <md> [--standard <pack>] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--out <dir>] [--json]
  ultra11y verify   --report <md> [--conformities <ledger|adjudication.json> | --no-conformities]   (also put the claimed CONFORMITIES on trial — on by default when a ledger exists)
  ultra11y verify   --report <md> --in <audit.json> --manual [--out <dir>] [--json]   (adjudicate the manual criteria)
  ultra11y verify   --apply <adjudication.json> --in <audit.json> [--out <dir>]        (fold the adjudication into the audit)
  ultra11y verify   --apply <VERIFY.todo.json> --report <md> --in <audit.json> --out <dir> --prune   (APPLY the trial: delete refuted non-conformities, send refuted conformities back to « à évaluer »)
  ultra11y verify   --summary --verdicts <VERIFY.todo.json> --report <md> --in <audit.json> [--pruned <audit.json>] [--out <dir>] [--json]   (read-only bilan of the trial → TRIAL.md: confirmed, withdrawn/applied, contested engine decisions, coverage, gate)
  ultra11y orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list] [--lang auto|en|fr]
  ultra11y orchestrate --run <dir> --manifest [--json]   (the loop as data: each step's command/argv, inputs, outputs, exit contract, next step — for any orchestrator)
  ultra11y fix      <globs… | -> [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--include <glob>] [--exclude <glob>] [--ext <list>] [--only <ids>] [--jsx] [--json] [--lang auto|en|fr]
  ultra11y init     [--hook] [--fail-on blocking|major|minor]
  ultra11y pack     check <pack.json> [--guidance <g.json>] [--json]  |  pack scaffold
  ultra11y scan     <url|file…> [--cwd <dir>] [--browser-path <file>] [--root <dir>] [--storage-state <file>] [--no-interact] [--interact-clicks] [--no-snapshot] [--no-pdf] [--max-pdf <n>] [--merge <audit.json>] [--out <dir>] [--json]
  ultra11y scan     --sample [--cwd <dir>] [--root <dir>] [--storage-state <file>] [--all-routes [--max-routes <n>]] [--merge <audit.json>] [--json]   (scan the .ultra11yrc.json page sample, then the rest of the route inventory)
  ultra11y scan     --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--cwd <dir>] [--root <dir>] [--merge <audit.json>] [--json]
  ultra11y sample   check [--standard <pack>] [--json]   (lint the .ultra11yrc.json page sample vs the standard's required page kinds)
  ultra11y snapshot write [--root <dir>] [--fail-on blocking|major|minor] [--json]   (payload on stdin → .ultra11y/pages/<id>/ + audit it)
  ultra11y snapshot list  [--root <dir>] [--json]
  ultra11y pages    --in <audit.json> [--standard <pack>] [--json [--out <dir>]] [--lang auto|en|fr]   (the per-page criterion grid; --json --out also writes <dir>/pages.json)
  ultra11y pages    --in <audit.json> --format report [--split page] [--out <dir>]        (the per-page report, with screenshots)
  ultra11y pages    --in <audit.json> --format report --out <dir> [--evidence [--evidence-max <n>]] [--html]   (annotated crops of each non-conformity, and the HTML site)
  ultra11y pages    discover --sitemap <url> | --crawl <url> | --from-snapshots [--depth <n>] [--max <n>] [--propose [--sample-size <n>] [--search-query <q>]] [--write | --routes-only] [--json]   (build the page sample and the route inventory)
  ultra11y hook     --claude-code|--codex|--opencode   (internal: the PreToolUse hook; payload on stdin)
  ultra11y install   --claude-code | --codex | --opencode | --agents-md | --all  [--project] [--dry-run] [--no-skills] [--opencode-version 1|2]
  ultra11y uninstall --claude-code | --codex | --opencode | --agents-md | --all  [--project]
  ultra11y status   [--json] [--project] [--browser [--cwd <dir>]]   (doctor: which agents run the review; --browser asks whether the scan tier resolves here)

Commands:
  audit      Run the static engine over the inputs (files/globs, or '-' for stdin)
             and emit an AuditResult JSON keyed by WCAG 2.2 success criteria
             (consumed by 'report'). Without --json, prints a summary in --lang
             (default auto: repo <html lang> → the active standard's default locale
             → English). The engine decides the machine-detectable criteria; the AI
             agent adjudicates the judgment ones (verify --manual, gated) and the
             scan tier decides the needs-rendering ones.
  report     Render an AuditResult into a dated WCAG 2.2 AA compliance report
             (audits/wcag-YYYY-MM-DD.md): metadata, per-guideline synthesis table,
             non-conformities by priority, conforming + not-applicable lists.
             --standard <pack> writes a derived report for a country standard
             (e.g. --standard rgaa → audits/rgaa-YYYY-MM-DD.md).
  prd        Turn an AuditResult into an AUDITOR conformance backlog
             (audits/prd-YYYY-MM-DD.md), one entry per criterion rendered with the
             active standard's vocabulary (RGAA "Thématique/Critère/Test", WCAG core
             "Principle·Guideline/Success criterion/Technique") — theme, criterion +
             official wording, test(s), WCAG mapping + level, finding, expected state,
             verification. --split criterion writes one file per criterion.
             It writes MARKDOWN only — filing tickets is the 'tickets' command.
  tickets    File the audit as TRACKER TICKETS — GitHub, GitLab or Jira. Reads an
             audit.json and pushes; it writes no markdown, exactly as prd/report
             write markdown and push nothing. --grain chooses what ONE ticket is:
             per criterion (default), per page, per page+criterion, per file, or one
             consolidated. De-dupe is by exact title, so re-running never duplicates.
             --dry-run prints the plan without creating anything.
  render     ultra11y's own render engine: get the RENDERED HTML of a project's
             components, so component libraries like DSFR are checked as the HTML
             they emit, not their JSX sources. It finds the .tsx/.jsx modules (their
             default and PascalCase component exports), the framework pages (Next.js
             app/ and pages/) and the Storybook stories (rendered with their args),
             and renders each with the PROJECT'S OWN react-dom/server, no props, in a
             throwaway harness: a child process per file, TSX transpiled in memory by
             the project's esbuild/typescript/sucrase, no project file written, a
             --timeout per unit (default 10000 ms). It never reads or runs the
             project's tests or snapshots. Each render lands in .ultra11y/captures
             (provenance: source, component, renderer, styles="none"); every unit,
             rendered, skipped with the reason, or not attempted, is listed in
             .ultra11y/render.json, which 'audit' reads into the report's annex.
             --detect prints the framework's build→audit recipe instead.
             --coverage reports which components have a rendered capture vs
             which are still opaque-source-only blind spots. --storybook attributes
             per-story HTML (via a storybook-static index) back to source components.
             To check a PAGE during an existing Playwright/Cypress run, use the
             ultra11y/playwright or ultra11y/cypress package exports. Then audit, and
             use scan for the needs-rendering criteria.
  criteria   Look up the reference offline. Core: one WCAG success criterion
             (criteria 1.4.3) or the full list grouped by guideline (--list).
             --standard <pack>: a pack criterion, a pack theme (--theme N), or its
             theme list. Carries the WCAG↔pack cross-refs + automatability class.
             --glossary [<term>] looks up a term the standard DEFINES (RGAA ships
             119). These definitions are normative — what "if necessary" or
             "relevant" mean in a test is decided there — and the adjudication
             worklist now inlines the ones each criterion's own tests cite. With no
             term, lists them all. Resolves by anchor or title, accent-insensitive;
             an unknown term errors with suggestions rather than a near-miss.
             --plan prints the work plan: per evidence tier (source, cross-file,
             rendered page, browser, judgment, out of scope), how many criteria it
             settles — the engine's own rule applicability, not a reading of the
             wording. RGAA: 104 of 106 need more than source to earn C.
  check      Integrity gate on a produced report: every cited criterion resolves,
             every NA is justified, sections + pass-rate maths are well-formed.
             --standard tells it which id grammar/registry to validate against.
  verify     Adversarial claim↔criterion worklist, then (--apply) gate on
             refuted/unsupported claims. Covers BOTH directions: the report's
             non-conformities (is this failure real?) and the ledger's
             agent-adjudicated conformities (does the cited evidence ESTABLISH the
             criterion, or only show its subject exists?). A refuted conformity
             sends its criterion back to « to assess », never to NC.
  orchestrate  Emit the run's multi-agent orchestration from its CURRENT worklists:
             per ready phase (adjudicate over ADJUDICATE.todo.json, verify-report
             over VERIFY.todo.json) a harness-neutral <phase>.batches.json, one
             self-contained prompt per batch under <phase>/ (hand it verbatim to
             any subagent), and the Claude Code Workflow script rendered from the
             same batches; the agents/<role>.md dispatch contracts, and a
             sequential RUNBOOK.md fallback — absolute paths and the real worklist
             ids baked in. Subagents only RETURN verdict fragments; you (the caller) stay
             the sole writer and fold them via verify --apply. --eco emits only
             the RUNBOOK + contracts (the explicit low-token path); --list prints
             the phases and their readiness as JSON. Re-run after a worklist
             changes — emission is deterministic and idempotent.
  fix        Put the fixes in place (hybrid, native-first): apply deterministic
             codemods (tabindex, redundant role, viewport zoom), insert fill-in
             placeholders (alt/lang/title TODO) for the agent to complete, and list
             judgment-only proposals. --dry-run (default) prints a diff; --write
             applies, but only after a re-audit proves no new NC; on real-AST JSX
             only jsxSafe codemods apply (never name-rewriting). --iterate loops to a fixpoint.
  init       Wire ultra11y into the repo (zero-dep, no husky). Default --hook is a git
             pre-commit gate over the STRICT STAGED SNAPSHOT: audits exactly the staged
             index blobs, auto-applies safe fixes (fix --staged --write --safe) and
             re-stages them, blocking only on issues that need judgment. CI is not
             wired here: it runs through iterion's rgaa-audit bot.
  pack       Author/verify a runtime standards pack. 'pack check <pack.json>
             [--guidance <g.json>]' runs the validator + guidance gate (every
             criterion maps to well-formed WCAG SCs, every guidance entry resolves to
             a real criterion, every code example parses) — the anti-hallucination
             gate for AI-ingested packs. 'pack scaffold' prints a blank pack to fill.
             Load packs at audit/report time with --pack (or .ultra11yrc.json).
  scan       OPTIONAL dynamic tier: run axe-core in a headless browser to decide the
             needs-rendering criteria the static engine can't — computed contrast
             (1.4.3), 320px reflow (1.4.10) — over a URL or HTML file. It runs on the
             local Playwright (resolved from --cwd, then from ultra11y's own
             dependencies), and additionally probes focus visibility (2.4.7), focus not
             obscured (2.4.11 — is the focused component entirely hidden behind a
             sticky header / cookie banner? measured on the same walk of the tab
             ring), 200% zoom (1.4.4), text spacing (1.4.12), content on hover
             (1.4.13) and target size (2.5.8), and accepts --storage-state for
             authenticated pages.
             By default the scan is STATEFUL: it types long values into
             inputs and flags any that clip at 320px/200%/text-spacing (1.4.10/1.4.4/
             1.4.12 — esp. inputs inside table cells), opens closed dialogs to re-check
             focus, and drives SAFE interactions (fill / toggle / click type=button —
             never a link, submit or navigation; destructive-named buttons are never
             clicked) to spot content updated outside a live region (4.1.3). On an
             AUTHENTICATED scan (--storage-state) the button clicks are skipped too,
             unless --interact-clicks opts back in. --no-interact disables all of that
             (pristine-page probes only). --merge folds the findings into a static
             AuditResult (manual → C/NC).
             --sitemap/--crawl scan many pages (every sitemap URL, or same-origin
             links BFS-crawled from a start URL) and aggregate the findings.
             --sample scans the NORMATIVE page sample declared in .ultra11yrc.json
             (representative pages + transverse elements); each page's own
             storage-state overrides --storage-state, and the report groups the
             findings « Constats par page ».
  sample     Normative page-sample (échantillon) helper. 'sample check' lints the
             .ultra11yrc.json sample block against the active standard's required
             page kinds (RGAA: accueil, contact, mentions légales, déclaration
             d'accessibilité, plan du site, aide, authentification, pages
             représentatives + éléments transverses) — advisory, never a gate.
  snapshot   Persist a rendered PAGE (.ultra11y/pages/<id>/: documentElement DOM +
             computed-style digest + boxes + a11y tree) and audit it. 'snapshot write'
             reads the collected payload on stdin, so a browser-side producer (the
             ultra11y/playwright and ultra11y/cypress exports) needs to know nothing about the
             on-disk format — one process per checked page. 'snapshot list' shows what
             has been captured. Because a snapshot is a FULL document (a component
             capture is a fragment), the page-scoped rules run on it: that is where
             html lang (RGAA 8.3) and page title (8.5/8.6) become decidable.
  hook       INTERNAL — the decision half of the Claude Code plugin's PreToolUse
             hook. Reads the payload on stdin; when a pending 'git commit', 'git
             push' or 'gh pr create' carries findings >= the threshold, prints the
             hook JSON that gets the review-a11y skill invoked, and prints nothing
             otherwise. Threshold: ULTRA11Y_HOOK_FAIL_ON, else hook.failOn in
             .ultra11yrc.json, else blocking. Disable with ULTRA11Y_HOOK=off or
             SKIP_A11Y=1. Called by hooks/pre-tool-use.mjs, not by hand.
  pages      The per-page criterion grid — RGAA is a per-page norm, the engine's
             verdict is scope-wide, and this bridges the two. One row per criterion
             (the pack's own under --standard), one column per page URL. Rebuilt from a
             committed audit.json alone: no snapshots on disk, no browser.
             Two honesty rules: a finding is attributed to a page only when something
             SAYS so (the snapshot it was raised on, the scanned URL, the sample page
             name, or the page's recorded source files) — anything else is reported as
             UNATTRIBUTED, never spread across pages; and "no finding here" means
             conforming only for a page whose real rendered DOM was audited. A page
             known only by source attribution keeps its undecided criteria "to assess".

Options:
  --out <dir>        output dir (report/prd/scan default: audits); for audit, persist
                     audit-latest.json here — a plain audit writes nothing without it.
                     For audit, a value ending in .json is a FILE target (written exactly);
                     the path actually written is echoed on stderr
  --in <file>        report: the AuditResult JSON to render ('-' for stdin)
  --include <glob>   audit/fix: only include paths matching (comma-separated)
  --exclude <glob>   audit/fix: skip paths matching (comma-separated)
  --ext <list>       audit/fix: extra file extensions to walk (e.g. .twig,.erb);
                     .html/.htm/.xhtml/.jsx/.tsx/.vue/.svelte/.astro are built-in
  --no-default-excludes  audit/fix: also audit test/spec/story/__tests__ markup
                     (excluded by default; logged, never a silent drop)
  --jsx              audit/fix: force JSX/TSX parsing for inputs of any extension
  --graph            audit: also resolve imports + run cross-file rules (alias --cross-file)
  --cross-file       audit: alias of --graph
  --changed          audit/fix: only files changed vs HEAD (git; staged+unstaged+untracked, working tree)
  --since <ref>      audit/fix: only files changed vs the given git ref
  --staged           audit/fix: only STAGED files, read from the index blob (exact commit snapshot; wins over --changed)
  --max-files <n>    audit: cap canonical files audited (logged truncation, no silent drop)
  --dedup <mode>     audit: collapse identical files — exact|normalized|off  (default: exact)
  --standard <pack>  report/prd/criteria/check/verify: WCAG core (default) or a pack
                     key (rgaa, …); contribute a country via a pack (see CONTRIBUTING.md)
  --pack <paths>     load external standards pack(s) at runtime (no rebuild): a pack JSON
                     file, or a dir with pack.json (+ glossary.json/guidance.json);
                     comma-separated, validated before use (see references/packs.md)
  --override         --pack: allow a runtime pack key to replace a built-in/loaded standard
  --guidance <file>  pack check: the guidance dataset JSON to gate alongside the pack
  --format <mode>    prd: 'audit' (default) emits the auditor conformance block (per
                     the active standard's vocabulary) for the backlog AND GitHub issues;
                     'doc' emits a product-requirements document (epics, user stories,
                     Given/When/Then)
                     · pages: 'grid' (default) emits the criteria × pages matrix;
                     'report' emits the per-page DOSSIER — one section per page with its
                     screenshot, every criterion of the standard, and the auditor block
                     for each non-conformity
  --split <mode>     prd: split the backlog — currently only 'criterion' (one file per criterion)
                     · pages --format report: 'page' writes <out>/page-<id>.md per page
                     plus <out>/index.md (recommended past 3–4 pages: RGAA is 106 criteria)
  --no-technical     prd (audit format): omit the technical ticket sections (Partie
                     technique + Contexte de reproduction) for a pure-auditor block
  --provider <id>    tickets: auto|github|gitlab|jira. 'auto' reads ULTRA11Y_TICKET_PROVIDER,
                     then .ultra11yrc.json, then the git remote (Jira is never auto-detected)
  --grain <mode>     tickets: what one ticket is — criterion (default) | page | page-criterion | single | file
  --transport <t>    tickets: auto|cli|rest. 'auto' prefers the CLI (gh/glab),
                     falling back to REST when only a token is available. Jira is REST-only
  --max-tickets <n>  tickets: refuse to file more than n tickets in one run (default 200)
                     tickets --out <dir> also writes the tracker-agnostic set to
                     <dir>/issues-<date>.json, for a workflow engine to file itself
  --detect           render: detect the framework and print the build→audit recipe (renders nothing)
  --timeout <ms>     render: per-unit render budget (default 10000); a unit past it is recorded as a timeout
  --transpiler <t>   render: esbuild|typescript|sucrase — the project's transpiler to load TSX/JSX with (default: the first resolvable)
  --no-stories       render: leave the Storybook stories out
  --coverage         render: report rendered-capture coverage (covered vs blind-spot components); with --json emits the coverage object
  --storybook        render: attribute per-story HTML (via storybook-static index.json) into .ultra11y/captures (point the HTML dir with --captures)
  --captures <dir>   audit/render: rendered-capture dir to ingest (default: .ultra11y/captures)
  --no-captures      audit: do NOT auto-detect/ingest .ultra11y/captures nor .ultra11y/pages
  --root <dir>       snapshot, scan: project root holding
                     .ultra11y/pages and .ultra11yrc.json (default: . — scan writes the
                     snapshots it collects under it)
  --glossary [<t>]   criteria: look up a term the country standard defines (or list all)
  --require-captures audit: gate — fail if any opaque/control component lacks a rendered capture (implies --graph)
  --write            fix: apply fixes to disk (default is a dry-run diff)
  --iterate          fix: with --write, re-audit + re-apply mechanical fixes until stable (bounded)
  --dry-run          fix: preview only — never write (this is the default)
  --safe             fix: apply only genuinely-automatic codemods (skip TODO placeholders / judgment proposals)
  --only <ids>       fix: limit auto-fixes to these rule ids (comma-separated)
  --fail-on <sev>    audit/init/snapshot: gate severity — blocking|major|minor (fr aliases accepted)  (default: blocking)
  --hook             init: write a git pre-commit accessibility gate (staged snapshot + auto-fix by default)
  --report <file>    check/verify: the report markdown to gate
  --theme <N>        criteria: with --standard <pack>, list the pack's theme N
  --plan             criteria: the work plan — criteria per evidence tier (source,
                     cross-file, rendered-page, browser, judgment, out-of-scope)
  --list             criteria: print the WCAG success criteria grouped by guideline
  --generate         criteria: emit the bundled references/criteria.md (WCAG 2.2 AA)
  --apply <file>     verify: reduce a filled verdicts file to a pass/fail gate
                     (requires --report — coverage is re-derived from the report, uncapped)
                     Also accepts an ADJUDICATION (--in <audit.json>), or a VERDICT LEDGER,
                     which it REPLAYS onto the audit with no model in the loop
                     Retained conformities are grounded the way the fold grounded them:
                     a citation that is one of its criterion's own harvested anchors
                     (--in <audit.json>) falls back to that anchor, so a retyping the
                     fold accepted is not refused again at trial; without the audit the
                     cited snippet must match the source literally
  --ledger <file>    verify --apply: record the verdicts the fold ACCEPTED,
                     so a later run replays them for free (default:
                     .ultra11y/verdicts/<standard>.json). Replay re-derives the evidence
                     and re-runs the same gate; a verdict whose evidence changed is
                     dropped as stale and its criterion says so. With verify --prune,
                     withdrawn claims are removed from the ledger as well
  --conformities <file>
                     verify: the CLAIMED CONFORMITIES to put on trial — an audit, verdict
                     ledger or adjudication file. Defaults to --in's current audit, then the
                     standard's ledger (.ultra11y/verdicts/<standard>.json), so the conformity
                     half of the gate runs without being asked for: nothing used to challenge
                     an agent's C verdict, and a criterion cleared because its subject was
                     PRESENT rather than RIGHT shipped as a conformance claim. Each cited anchor
                     becomes an item asking whether the evidence ESTABLISHES the criterion.
                     A refuted one sends its criterion back to « to assess » — never to NC
  --no-conformities  verify: do not put the ledger's conformities on trial
  --max-verify <n>   verify: cap the worklist size; 0 = no cap           (default: 40, NCs only)
                     Claimed conformities are uncapped unless this is set; whatever a cap
                     drops is named on stderr and fails --apply as missing
  --verdicts <file>  check --semantic: the adjudicated verdicts artifact
  --require-sample   check: fail while a page DECLARED in .ultra11yrc.json has no capture under
                     .ultra11y/pages/. Coverage, one level below --require-decided: a sweep that
                     loses pages produces a report that is merely SHORTER, and a shorter
                     deliverable reads exactly like a complete one.
  --require-rendered check: fail while a criterion that NEEDS a rendered page is still « to
                     assess » and this run snapshotted no page at all. Asks about the
                     INSTRUMENT, not the answer: a run that rendered a page and still could
                     not settle a criterion passes. Needs --in <audit.json>; honours
                     --allow-undecided.
  --require-decided[=pages]
                     check: fail while ANY criterion of the standard is still « to assess ».
                     '=pages' also holds EVERY page's own grid to the same bar — a criterion
                     failing on one route is settled for the run and may still be undecided on
                     the routes it never fired on, which is what a per-page deliverable is
                     judged on.
                     Needs --in. A green job does not otherwise mean the grid was filled:
                     --fail-on governs non-conformities, and an adjudication that lands
                     nothing only warns.
  --allow-undecided <file>
                     check --require-decided: criteria this project declares it cannot
                     decide, as {"entries":[{"criteriaId","reason"}]}. A NAMED list, never a
                     tolerance: a threshold would hide exactly the criteria nobody could
                     decide. An entry with no reason fails the gate, and one whose criterion
                     now carries a verdict fails it too.
                     (default: VERIFY.todo.json next to the report)
  --allow-stale-undecided
                     check --require-decided: ignore named allowances whose criteria gained a
                     verdict in THIS refresh. Intended for paid adjudication refreshes; the
                     default remains strict so stale exceptions are cleaned from the repo.
  --run <dir>        orchestrate: the run dir holding the worklists (ADJUDICATE.todo.json,
                     VERIFY.todo.json); artifacts land under <dir>/orchestration/
  --phase <name>     orchestrate: emit one phase only — adjudicate | verify-report
                     (exit 2 with the producing command if its worklist is missing)
  --eco              orchestrate: emit only RUNBOOK.md + agents/*.md (no batches, no workflow) — the explicit
                     sequential low-token path (also what a no-subagent harness follows)
  --merge <file>     scan: fold dynamic findings into this AuditResult JSON. With --json the
                     printed document opens with a 'pages' summary of the run —
                     {sample, recorded, refused:[{id, reason}]} — beside the document
  --sitemap <url>    scan: scan every URL listed in a sitemap.xml
  --crawl <url>      scan: BFS same-origin links from a start URL (served HTML)
  --depth <n>        scan: crawl link-hop depth from the start URL   (default: no limit; 0 = no limit)
  --max <n>          scan: cap on pages scanned (sitemap/crawl)      (default: no limit; 0 = no limit)
  --runtime <mode>   scan: local (the default and only runtime: the host/target Playwright;
                     'auto' is accepted as its alias)
  --local            scan: alias of --runtime local
  --cwd <dir>        scan: resolves @playwright/test + @axe-core/playwright (and the
                     browser) from here first (e.g. --cwd packages/app)
  --browser-path <file>  scan / status --browser: launch THIS browser executable (e.g. a
                     distribution's /usr/bin/chromium) instead of the one Playwright resolves.
                     Explicit: never replaced by a fallback. Env: ULTRA11Y_BROWSER_PATH
  --storage-state <file>  scan: Playwright storageState JSON for
                     authenticated pages (e.g. test-results/.auth/user.json). Its cookies
                     that match a linked document's URL (domain, path, secure, expiry) are
                     also sent when downloading it — to the audited origin only
  --no-interact      scan: disable the STATEFUL probes (fill inputs,
                     open dialogs, live-region). Default is ON; the interactions are
                     strictly non-navigating (fill text inputs, toggle checkbox/radio,
                     click button[type=button] — never a link/submit/navigation, and
                     never a button whose accessible name matches a destructive verb:
                     supprimer, retirer, effacer, envoyer, valider, confirmer, payer,
                     delete, remove, send, submit, confirm, pay, …) and restore page
                     state, asserting location.href is unchanged after each action
  --interact-clicks  scan: allow the live-region probe's
                     button[type=button] clicks on an AUTHENTICATED scan
                     (--storage-state). Skipped by default there: a click can trigger
                     a server mutation (delete/send) invisible to the location.href
                     assertion. Unauthenticated scans keep clicks on regardless; the
                     destructive-name skip above applies in every case
  --write            pages discover: merge the discovered pages into .ultra11yrc.json
                     (sample.pages). Without it the proposal is printed and nothing is
                     written. Pages already declared are kept verbatim — auth, storageState
                     and notes are human work and are never overwritten. Also records every
                     discovered route in the inventory .ultra11y/routes.json
  --routes-only      pages discover: record the route inventory (.ultra11y/routes.json) and
                     leave the sample untouched — the RGAA sample stays the one you chose,
                     and the report's annex lists every other route with how it was observed
  --from-snapshots   pages discover: build the sample from .ultra11y/pages instead of crawling —
                     the only route that sees a state-reached page (a modal, a funnel step)
  --propose          pages discover: propose a DETERMINISTIC sample instead of every page —
                     the required kinds of the standard (--standard, default rgaa) matched by
                     keyword on the sorted URLs and titles, the search page with a fixed
                     query, then one page per template cluster (URL pattern with ids, slugs
                     and dates normalized; DOM skeleton when a snapshot exists), largest
                     first, ties broken by URL. Each pick's reason goes to \`notes\`, each kind
                     with no page to \`sample.absent\`. With --write it REPLACES the declared
                     pages, keeping those that carry auth, storageState, sources or notes
  --sample-size <n>  pages discover --propose: most pages proposed (default: ${DEFAULT_SAMPLE_SIZE});
                     the required kinds are never cut
  --search-query <q> pages discover --propose: the search query (default: "information")
  --all-routes      scan: after the sample (with --sample), scan every route of the inventory
                     (.ultra11y/routes.json) the sample does not hold — except the routes your
                     E2E run already captured, which win. Each route is then listed in the
                     annex: captured, scanned, source only, or not reached
  --max-routes <n>   scan --all-routes: most routes scanned beyond the sample (default: 50);
                     the routes left out are listed « not reached », never dropped
  --sample           scan: scan the NORMATIVE page sample from .ultra11yrc.json (its
                     sample.pages), per-page storage-state overriding --storage-state,
                     aggregating one result with per-page provenance for the report
  --no-snapshot      scan: do NOT persist each scanned page to .ultra11y/pages/<id>/.
                     Snapshots are ON by default: the browser is already on the page, and
                     without one the page can never be re-audited offline nor earn a
                     per-page verdict (its criteria stay « to assess » forever)
  --no-pdf           scan: do NOT download the same-origin PDF documents the scanned pages
                     link to (into .ultra11y/documents/<sha256>.pdf, with a sidecar naming
                     the URL and the pages linking it). A link is a candidate when its path
                     ends in .pdf, it declares type=application/pdf or download, its text /
                     aria-label / title names PDF, or its path or query does (/api/x-pdf);
                     it is kept only if the response is application/pdf or starts %PDF-.
                     With --storage-state, the session's matching cookies are sent.
                     audit: do not ingest that directory. PDF inputs named explicitly are
                     always audited
  --max-pdf <n>      scan: most PDF documents downloaded per run (default 20; each one
                     capped at 20 MiB)
  --strict           verify --apply: all-or-nothing fold — one refused
                     verdict discards the whole adjudication. The default folds PER
                     VERDICT: a refusal costs its own criterion, which stays to assess
                     carrying the refusal, and every verdict that proved itself lands
  --semantic         verify: fold the support-check into one pass
                     check: engage the semantic gate — requires an adjudicated verdicts
                     artifact (fails closed when absent) and re-grounds every passing
                     verdict content-level against the cited source
  --manual           verify: with --in <audit.json>, emit an adjudication worklist over the
                     audit's residual (judgment / needs-rendering) criteria for the agent to rule
  --web / --no-web   verify --manual: whether each brief may INVITE a lookup of the
                     criterion's official page (the URL itself is always printed).
                     Default: on, except under CI — where the adjudicator holds
                     Read/Grep/Glob/Edit/Write and offering a web tool only costs turns.
                     The vendored normative text always decides, and no web page is ever
                     an acceptable normativeRef
  --lang auto|en|fr  output language                (default: auto — conversation/repo
                     language: an AI caller should pass --lang explicitly to match the
                     chat; unset resolves repo <html lang> → standard's default locale → en)
  --json             machine-readable output
  --quiet            check: exit code only, no output
  -h, --help         show this help
  -v, --version      print version

Data: WCAG 2.2 © W3C (W3C Document License). RGAA 4.1.2 pack © DINUM, Licence Ouverte / Etalab 2.0 (see NOTICE).`;

export const COMMANDS = [
  "audit",
  "report",
  "prd",
  "tickets",
  "render",
  "criteria",
  "check",
  "verify",
  "scan",
  "sample",
  "snapshot",
  "pages",
  "fix",
  "init",
  "pack",
  "orchestrate",
  "hook",
  "install",
  "uninstall",
  "status",
] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(s: string | undefined): s is Command {
  return !!s && (COMMANDS as readonly string[]).includes(s);
}

const VALUE_FLAGS = new Set([
  // `install --opencode --opencode-version 1|2`: the OpenCode major to wire for, instead of
  // asking the `opencode` on PATH.
  "opencode-version",
  "out",
  "provider",
  "grain",
  "max-tickets",
  "in",
  "include",
  "exclude",
  "ext",
  "report",
  "theme",
  "apply",
  "verdicts",
  // `verify --summary`: the audit `verify --apply … --prune` wrote, to show which withdrawals landed.
  "pruned",
  // `check --require-decided`: the criteria a project declares it cannot decide.
  "allow-undecided",
  "max-verify",
  "lang",
  "merge",
  "sitemap",
  "crawl",
  "depth",
  "max",
  // `pages discover --propose`: the bound on the proposed sample, and its fixed search query.
  "sample-size",
  "search-query",
  // `scan --all-routes`: the most inventory routes visited beyond the sample (src/routes.ts).
  "max-routes",
  // `scan`: most linked PDF documents downloaded per run.
  "max-pdf",
  "since",
  "max-files",
  "dedup",
  "only",
  "standard",
  // `verify --apply`: where to RECORD the verdicts the fold accepted, so a
  // later run can replay them without a model (src/ledger.ts). A path; empty falls back to the
  // standard's default location under .ultra11y/verdicts/.
  "ledger",
  // `verify`: where the CLAIMED CONFORMITIES to put on trial come from — a verdict ledger or an
  // adjudication file. Empty/absent falls back to the standard's default ledger, which is why
  // the conformity half of the gate runs without anyone asking for it.
  "conformities",
  "fail-on",
  "split",
  "pack",
  "format",
  // Bytes of image data the single-file HTML report may carry inline (src/html-emit.ts).
  "inline-budget",
  // Hard cap on the crops one run writes (src/evidence.ts `DEFAULT_CAPS.total`).
  "evidence-max",
  "guidance",
  "runtime",
  "cwd",
  // `scan` / `status --browser`: an explicit browser executable (a distribution's Chromium),
  // launched as given and never replaced by Playwright's fallbacks. Env: ULTRA11Y_BROWSER_PATH.
  "browser-path",
  "storage-state",
  "captures",
  // `render`: per-unit budget and the project's transpiler to use.
  "timeout",
  "transpiler",
  "run",
  "phase",
  "root",
  "glossary",
  // `tickets --transport auto|cli|rest`.
  "transport",
]);
// Boolean flags documented in HELP (every valid flag that is NOT a value flag).
// Paired with VALUE_FLAGS this is the full set of recognised long flags, used to
// warn on unknown/misspelled ones instead of silently accepting them as no-ops.
const BOOLEAN_FLAGS = new Set([
  // `verify --apply … --prune`: apply what the refutation trial decided to the audit, instead
  // of only reporting it (src/refute.ts).
  "prune",
  // `verify --summary`: the read-only bilan of a counter-review (src/trial-summary.ts).
  "summary",
  "changed",
  "staged",
  "jsx",
  "graph",
  "cross-file",
  "json",
  "quiet",
  // The visual tier. Both must be declared here or `parseArgs` swallows the value that
  // follows and the run prints "unknown flag (ignored)" for a flag that in fact works.
  "html",
  "evidence",
  "no-default-excludes",
  "no-captures",
  "require-captures",
  "storybook",
  "coverage",
  // `render`: print the framework recipe instead of rendering; leave the stories out.
  "detect",
  "no-stories",
  "write",
  // `pages discover`: build the sample from the snapshots the E2E producer already wrote,
  // instead of crawling — the only route that can see a state-reached page.
  "from-snapshots",
  // `pages discover`: record the route inventory (.ultra11y/routes.json) without touching the sample.
  "routes-only",
  // `pages discover`: a deterministic RGAA sample (src/sample-propose.ts) instead of every page.
  "propose",
  // `scan`: cover every route of the inventory, beyond the sample (bounded by --max-routes).
  "all-routes",
  "dry-run",
  "iterate",
  "safe",
  "hook",
  "list",
  // `criteria --plan`: the work plan per evidence tier (src/criteria.ts runPlan).
  "plan",
  "generate",
  "semantic",
  // `check`: fail while any criterion of the standard is still « to assess ».
  "require-decided",
  "require-sample",
  "require-rendered",
  "allow-stale-undecided",
  "manual",
  // `verify --apply`: restore the all-or-nothing fold, where one refused
  // verdict discards the whole adjudication. The default is per-verdict.
  "strict",
  // `verify --manual`: whether the brief may invite a web lookup of the criterion's official
  // page. Default: on outside CI, off under it — see `webAllowed`.
  "web",
  "no-web",
  // `verify`: opt OUT of putting the ledger's claimed conformities on trial. There is no
  // positive twin because the answer is yes by default — a gate you have to remember to turn
  // on is a gate that does not run.
  "no-conformities",
  "no-technical",
  "override",
  // `scan --local`: alias of `--runtime local`, the only runtime — accepted, changes nothing.
  "local",
  "no-interact",
  "interact-clicks",
  "no-snapshot",
  // `scan`/`audit`: do not download (scan) or ingest (audit) the PDF documents pages link to.
  "no-pdf",
  "sample",
  "eco",
  // `orchestrate --manifest`: print the loop's step graph as JSON (src/orchestrate.ts buildManifest).
  "manifest",
  "help",
  "version",
  // Harness selectors, shared by `hook` and `install`/`uninstall`/`status`. Without these
  // the parser warned "unknown flag --claude-code" on stderr on EVERY guarded shell call.
  "claude-code",
  "codex",
  "opencode",
  "agents-md",
  "all",
  "project",
  // `status`: ALSO ask whether the browser tier resolves here — the question `scan --runtime
  // local` answers for itself, exposed so a caller (a CI harness such as iterion's rgaa-audit bot) can branch on it
  // instead of re-deriving it in shell.
  "browser",
  "no-skills",
]);
const KNOWN_FLAGS: ReadonlySet<string> = new Set<string>([...VALUE_FLAGS, ...BOOLEAN_FLAGS]);
// Long flags whose repetition should accumulate (comma-joined) rather than last-wins,
// so `--include a --include b` keeps both. Non-list value flags stay last-wins.
const LIST_FLAGS = new Set(["include", "exclude", "ext"]);

export interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
  /** long flags that are not recognised (neither value nor boolean) — main() warns. */
  unknown: string[];
}

/** Is this token the NEXT FLAG rather than the previous flag's value?
 *
 *  Several value flags take an OPTIONAL value — `--ledger` bare means the standard's default
 *  path, `--require-decided` bare means the run's grid — and the bare form is almost always
 *  followed by another flag. Consumed blindly, the next flag became the value:
 *  `verify --apply … --ledger --lang fr` wrote a 33 KB verdict ledger to a file literally
 *  named `--lang`, never wrote `.ultra11y/verdicts/rgaa.json`, and — `--lang` having been
 *  eaten — printed the run in the wrong language. Nothing failed and nothing warned; the next
 *  run simply paid for the whole adjudication again, which is the cost the ledger exists to
 *  remove.
 *
 *  Only `--` counts. A single dash is the stdin positional, and a value may legitimately be
 *  negative or start with one. */
function looksLikeFlag(token: string | undefined): boolean {
  return token?.startsWith("--") ?? false;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const valueFlags = VALUE_FLAGS;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const unknown: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      // Support both `--key value` and `--key=value`. Splitting on the first `=`
      // means `--standard=rgaa` / `--out=audits` are parsed as values, not swallowed
      // whole into a boolean no-op key ("standard=rgaa").
      const eq = a.indexOf("=");
      const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const inlineVal = eq === -1 ? undefined : a.slice(eq + 1);
      let val: string | boolean;
      if (inlineVal !== undefined) val = inlineVal;
      else if (valueFlags.has(key) && !looksLikeFlag(rest[i + 1])) val = rest[++i] ?? "";
      else val = true;
      const prev = flags[key];
      if (LIST_FLAGS.has(key) && typeof prev === "string" && typeof val === "string") {
        flags[key] = prev ? `${prev},${val}` : val; // accumulate repeated list flags
      } else {
        flags[key] = val;
      }
      if (!KNOWN_FLAGS.has(key)) unknown.push(key);
    } else if (a.startsWith("-") && a !== "-") {
      // No single-dash short flags are defined (only `-` = stdin, handled below), so `-grph`
      // is a typo for `--graph` — set it for backward-compat but surface it as unknown.
      flags[a.slice(1)] = true;
      unknown.push(a.slice(1));
    } else {
      positionals.push(a);
    }
  }
  return { command: command ?? "", positionals, flags, unknown };
}

/** Resolve the output language. `--lang fr|en` explicit always wins. Otherwise
 *  (`auto` or the flag absent): the repo's detected language wins if it is fr/en
 *  (the majority entry of an audit's `scope.langs`, set by `runAudit`), else the
 *  active standard pack's `defaultLocale` if fr/en (the WCAG core has none, so
 *  it is skipped), else `en`. The CLI's conversational caller (an AI agent) is
 *  expected to pass `--lang` explicitly matching the conversation language —
 *  this fallback chain only covers a bare/scripted invocation. */
function resolveLang(flags: Record<string, string | boolean>, ctx: { audit?: AuditResult; standard?: StandardId } = {}): Lang {
  if (flags.lang === "fr" || flags.lang === "en") return flags.lang;
  const top = ctx.audit?.scope.langs?.[0];
  if (top === "fr" || top === "en") return top;
  const locale = ctx.standard ? getPack(ctx.standard)?.defaultLocale : undefined;
  if (locale === "fr" || locale === "en") return locale;
  return "en";
}

function asList(v: string | boolean | undefined): string[] | undefined {
  return typeof v === "string" && v ? [v] : undefined;
}

/** Read a `--report`/`--in` file, printing a clean CLI error and returning null (so the
 *  caller can exit 2) instead of surfacing a raw ENOENT stack trace. */
function readInputFile(path: string, cmd: string, flag: string): string | null {
  try {
    return readText(path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | undefined)?.code;
    console.error(
      code === "ENOENT"
        ? `ultra11y ${cmd}: ${flag} file not found: ${path}.`
        : `ultra11y ${cmd}: cannot read ${flag} ${path}: ${e instanceof Error ? e.message : String(e)}.`,
    );
    return null;
  }
}

/** Read a `--report` for a gate: the report AND the technical annex it links to, joined as
 *  `renderReport` joins them. A linked annex that cannot be read fails the command — the
 *  occurrences every non-conformity is verified against live there. */
function readReportInput(path: string, cmd: string): string | null {
  const md = readInputFile(path, cmd, "--report");
  if (md === null) return null;
  try {
    return withReportAnnexes(md, path, readText);
  } catch (e) {
    console.error(`ultra11y ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Resolve `--standard`; prints the error and returns null on an unknown standard. */
/** Whether an adjudication brief may invite a web lookup of the criterion's official page.
 *
 *  `--web` and `--no-web` are both explicit and win in either direction. With neither, the
 *  answer is read off the environment: CI runners set `CI`, and there the adjudicator is
 *  handed Read/Grep/Glob/Edit/Write and no network — telling it to consult a page it cannot
 *  fetch buys nothing and spends turns it needs elsewhere. Everywhere else — a coding agent,
 *  a local session — a web tool is usually there, so the offer is worth making.
 *
 *  Note this only ever gates ONE SENTENCE. The criterion's URL is printed either way: it
 *  says where the vendored normative text came from, which is a fact and not an instruction. */
function webAllowed(flags: Record<string, string | boolean>): boolean {
  if (flags["no-web"] === true) return false;
  if (flags.web === true) return true;
  return !process.env.CI;
}

function stdOf(p: ParsedArgs, cmd: string): StandardId | null {
  try {
    return resolveStandard(p.flags.standard);
  } catch (e) {
    console.error(`ultra11y ${cmd}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Current ultra11y AuditResult: WCAG-keyed, schema v2+. Rejects stale (pre-v2,
 *  RGAA-keyed) JSON so it is never silently mis-processed against the WCAG engine. */
function isCurrentAudit(r: unknown): r is AuditResult {
  const a = r as Partial<AuditResult> | null;
  return (
    !!a &&
    a.tool === "ultra11y" &&
    a.standard === "wcag" &&
    typeof a.schemaVersion === "number" &&
    a.schemaVersion >= 2 &&
    Array.isArray(a.criteria) &&
    // Require the fields the renderers dereference, so a shallow-fabricated object is
    // rejected cleanly here instead of crashing report/prd with a raw TypeError.
    typeof a.scope === "object" &&
    a.scope !== null &&
    Array.isArray(a.findings) &&
    Array.isArray(a.residualRisks) &&
    Array.isArray(a.guidelines)
  );
}

/** Best-effort load of a `scan --merge <file>` AuditResult, used ONLY to inform
 *  `resolveLang` before the dynamic scan runs (so a French repo's `scope.langs`
 *  picks the output language same as `report`/`prd` do). Never throws/reports —
 *  the actual merge step re-reads and validates the file for real, with the
 *  original error messages, so an invalid/missing file still fails there. */
function peekMergeAudit(mergeIn: string | boolean | undefined): AuditResult | undefined {
  if (typeof mergeIn !== "string" || !mergeIn) return undefined;
  try {
    const parsed: unknown = unwrapAudit(JSON.parse(readText(mergeIn)));
    return isCurrentAudit(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// `audit --in <audit.json>` — RE-GATE an audit that was already computed, instead of
// computing one. It exists for one caller: a pipeline that folded ADJUDICATED verdicts into
// audit-latest.json and now wants the same severity gate applied to that result. Re-running
// detection there would be wrong twice over — it would not see the verdicts, and it would
// spend a second full pass to reach a conclusion the file already holds.
//
// Deliberately narrow: this path GATES and RENDERS, nothing else. Every flag that would
// change what is audited is refused rather than ignored, because a gate that silently drops
// your scoping is a gate nobody can trust. Re-running detection is what `audit <globs>` is
// for.
async function cmdAuditFromFile(p: ParsedArgs, inPath: string): Promise<number> {
  const scoping = [
    "since",
    "changed",
    "staged",
    "graph",
    "cross-file",
    "jsx",
    "include",
    "exclude",
    "ext",
    "max-files",
    "dedup",
    "captures",
    "no-captures",
    "require-captures",
    "no-default-excludes",
    "out",
  ];
  const offenders = scoping.filter((f) => p.flags[f] !== undefined);
  if (p.positionals.length) offenders.unshift("<paths>");
  if (offenders.length) {
    console.error(
      `ultra11y audit: --in re-gates an audit that already exists, so these have nothing left to change: ${offenders.join(", ")}. Drop them, or run a fresh audit without --in.`,
    );
    return 2;
  }

  let result: AuditResult;
  try {
    const parsed = unwrapAudit(JSON.parse(inPath === "-" ? await readStdin() : readText(inPath))) as unknown;
    if (!isCurrentAudit(parsed)) {
      console.error("ultra11y audit: --in is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
      return 2;
    }
    result = parsed;
  } catch {
    console.error(`ultra11y audit: --in file not found or not valid JSON: ${inPath}.`);
    return 2;
  }

  // Same standard resolution as a fresh audit — this path is the CI gate (`audit --in
  // audits/audit-latest.json --fail-on …`), and a gate that counts the core's findings while
  // the report beside it counts the standard's is two numbers for one run.
  const standard = stdOf(p, "audit");
  if (standard === null) return 2;
  const lang = resolveLang(p.flags, { audit: result, standard });

  const failOnRaw = p.flags["fail-on"];
  const failOnParsed = parseFailOn(failOnRaw);
  if (failOnRaw !== undefined && failOnParsed === null) {
    console.error(`ultra11y audit: --fail-on must be blocking|major|minor (got "${String(failOnRaw)}").`);
    return 2;
  }

  const failOnSet = failOnRaw !== undefined;
  const failOn = failOnSet ? (failOnParsed ?? "bloquant") : undefined;
  const failing = failOn ? findingsAtOrAbove(findingsForStandard(result, standard), failOn) : [];

  if (p.flags.json) console.log(JSON.stringify(auditDocumentFor(result, standard, lang), null, 2));
  else {
    console.log(auditSummary(result, lang, standard));
    if (failOnSet && failing.length)
      console.error(lang === "fr" ? `✗ ${failing.length} non-conformité(s) ≥ ${failOn}.` : `✗ ${failing.length} non-conformity(ies) ≥ ${failOn}.`);
  }
  return failing.length ? 1 : 0;
}

async function cmdAudit(p: ParsedArgs): Promise<number> {
  const inFlag = p.flags.in;
  if (typeof inFlag === "string" && inFlag) return cmdAuditFromFile(p, inFlag);

  const inputs = p.positionals.length ? p.positionals : ["."];
  if (inputs.length === 0) {
    console.error("ultra11y audit: provide files/globs, or '-' to read stdin.");
    return 2;
  }
  const stdin = inputs.includes("-") ? await readStdin() : undefined;
  const since = typeof p.flags.since === "string" ? (p.flags.since as string) : undefined;
  const dedupFlag = p.flags.dedup;
  // THE ACTIVE STANDARD. `audit` used to take none by design and the engine's WCAG keying was
  // taken to settle the question for every surface too — so a project declaring
  // `.ultra11yrc.json { "standard": "rgaa" }` still got « WCAG 2.2 AA audit » with `[3.1.1]`
  // tags, in English, while `report --standard rgaa` two commands later spoke RGAA in French.
  // The engine stays WCAG-keyed (a pack criterion is DEFINED as a projection of success
  // criteria); what the standard now decides is the DOCUMENT and every rendering of it.
  const standard = stdOf(p, "audit");
  if (standard === null) return 2;
  // Pre-audit: no scope.langs yet, so this is the flag-or-standard-locale fallback — used
  // only by messages emitted before runAudit returns. Recomputed with the audit's own
  // detection right after.
  let lang = resolveLang(p.flags, { standard });

  // Rendered captures: ingest the .ultra11y/captures dir (or --captures <dir>) alongside
  // the source so the audit covers the REAL DOM component libraries/SFCs emit. In a full
  // scan the whole dir is appended as a top-level input; in --staged/--changed mode a
  // capture is rarely itself part of the diff (the SOURCE changed, not its
  // already-committed capture), so runAudit's `captureDiff` instead pulls in just the
  // captures relevant to the diffed files (capturesForSources). --no-captures opts out
  // of both.
  const requireCaptures = p.flags["require-captures"] === true;
  const capturesFlag = typeof p.flags.captures === "string" && p.flags.captures ? p.flags.captures : undefined;
  const capturesDir = capturesFlag ?? CAPTURES_DIR;
  const scopedToDiff = p.flags.changed === true || p.flags.staged === true || since !== undefined;
  const capturesWanted = p.flags["no-captures"] !== true && !inputs.includes("-") && (capturesFlag !== undefined || existsSync(capturesDir));
  const useCaptures = capturesWanted && !scopedToDiff && !inputs.includes(capturesDir);
  // PAGE SNAPSHOTS (.ultra11y/pages/<id>/dom.html) are captures too — full rendered
  // documents carrying page identity — so the same ingestion applies. They are kept in a
  // separate tree because a snapshot is a directory of signals (dom + styles + boxes +
  // screenshot), not a lone .html. --no-captures opts out of both.
  const pagesWanted = p.flags["no-captures"] !== true && !inputs.includes("-") && existsSync(PAGES_DIR);
  // `usePages` decides whether to APPEND the pages dir to the inputs — it must not fire when
  // the caller already named it, or every snapshot would be audited twice.
  const usePages = pagesWanted && !scopedToDiff && !inputs.includes(PAGES_DIR);
  // Whether the snapshots are IN the audit at all, however they got there. Recording the page
  // scope keyed on `usePages` alone meant that naming the pages directory explicitly — the
  // most page-centric thing a caller can do, and what the e2e plugins' report option does —
  // silently produced an audit with no pages in scope, so `pages` then refused to render.
  const pagesInScope = pagesWanted && !scopedToDiff;
  // DOWNLOADED DOCUMENTS (.ultra11y/documents/*.pdf, written by `scan`): the PDFs the captured
  // pages link to, re-read offline like the snapshots themselves. `--no-pdf` opts out.
  const documentsGlob = `${DOCUMENTS_DIR}/*.pdf`;
  const useDocuments =
    p.flags["no-pdf"] !== true &&
    !inputs.includes("-") &&
    !scopedToDiff &&
    existsSync(DOCUMENTS_DIR) &&
    !inputs.includes(documentsGlob) &&
    !inputs.includes(DOCUMENTS_DIR);
  const auditInputs = [...inputs, ...(useCaptures ? [capturesDir] : []), ...(usePages ? [PAGES_DIR] : []), ...(useDocuments ? [documentsGlob] : [])];
  if (useCaptures)
    console.error(
      lang === "fr" ? `ultra11y audit : captures rendues ingérées depuis ${capturesDir}.` : `ultra11y audit: ingesting rendered captures from ${capturesDir}.`,
    );
  if (usePages)
    console.error(
      lang === "fr" ? `ultra11y audit : instantanés de page ingérés depuis ${PAGES_DIR}.` : `ultra11y audit: ingesting page snapshots from ${PAGES_DIR}.`,
    );
  if (useDocuments)
    console.error(
      lang === "fr" ? `ultra11y audit : documents PDF ingérés depuis ${DOCUMENTS_DIR}.` : `ultra11y audit: ingesting PDF documents from ${DOCUMENTS_DIR}.`,
    );

  const result = runAudit({
    inputs: auditInputs,
    stdin,
    forceJsx: p.flags.jsx === true,
    include: asList(p.flags.include),
    exclude: asList(p.flags.exclude),
    ext: asList(p.flags.ext),
    changed: p.flags.changed === true || since !== undefined,
    since,
    staged: p.flags.staged === true,
    dedup: dedupFlag === "normalized" || dedupFlag === "off" ? dedupFlag : undefined,
    maxFiles: typeof p.flags["max-files"] === "string" ? Number(p.flags["max-files"]) : undefined,
    graph: p.flags.graph === true || p.flags["cross-file"] === true || requireCaptures,
    captureCoverage: requireCaptures,
    captureDir: capturesDir,
    captureDiff: capturesWanted && scopedToDiff,
    noDefaultExcludes: p.flags["no-default-excludes"] === true,
    onWarn: (m) => console.error(m),
  });
  // Re-resolve with the audit's own repo-language detection (scope.langs) now that
  // it's available — every message from here on uses this, not the pre-audit fallback.
  lang = resolveLang(p.flags, { audit: result, standard });

  // Record the pages in scope + attribute the source findings to them, so the per-page grid
  // rebuilds later from this JSON alone (no snapshots on disk, no browser).
  if (pagesInScope) {
    const scope = pageScopesFrom(readSnapshots("."));
    if (scope.length) {
      result.scope.pages = scope;
      attributePages(result, scope);
    }
  }
  // Every route of the inventory, when there is one, with how it was observed.
  // Only the snapshots this audit actually read count as observations: under --no-captures or a
  // diff scope they were left out, and a route must not read « capturée » / « scannée » then.
  stampRoutes(result, ".", lang, { recorded: pagesInScope });
  // What ultra11y's render engine did, whenever its manifest is there and the captures are in
  // scope — NOT gated on the captures directory existing: a run where every unit failed or was
  // not attempted writes no capture at all, and that is exactly when its reasons must reach
  // the audit (scope.renders → annex G). --no-captures, stdin and a diff scope leave it out.
  const rendersInScope = p.flags["no-captures"] !== true && !inputs.includes("-") && !scopedToDiff;
  if (rendersInScope || inputs.includes(capturesDir)) {
    const renders = renderScopeFor(capturesDir);
    if (renders) result.scope.renders = renders;
  }

  // Only persist audit-latest.json when an output dir is explicitly requested. A plain
  // `audit` streams to stdout (--json / text summary) and must NOT litter the CWD with an
  // audits/ folder. Chain via `audit … --out audits` when you want the file (e.g. for
  // `scan --merge audits/audit-latest.json` or `report --in audits/audit-latest.json`).
  // R6: an `--out` value ending in `.json` is a FILE target (write exactly there);
  // otherwise it's a directory and the canonical `audit-latest.json` lands inside it — so
  // `--out run.json` no longer surprises the user with `run.json/audit-latest.json`.
  // THE DOCUMENT this run publishes. Under the core it is the AuditResult itself; under a
  // pack it is that result re-keyed onto the pack's own criteria, carrying the core inside
  // (see src/standards/document.ts). Written to `--out`, printed by `--json`, and read back
  // by every `--in` consumer through `unwrapAudit`.
  const document = isCore(standard) ? result : packAuditDocument(result, standard, lang);

  if (typeof p.flags.out === "string") {
    const out = p.flags.out;
    const asFile = out.toLowerCase().endsWith(".json");
    const target = asFile ? out : join(out, "audit-latest.json");
    try {
      mkdirSync(asFile ? dirname(out) : out, { recursive: true });
      writeFileSync(target, JSON.stringify(document, null, 2) + "\n");
      // Report the path actually written on STDERR so `--json` stdout stays parseable.
      console.error(lang === "fr" ? `→ audit écrit dans ${target}` : `→ audit written to ${target}`);
    } catch {
      /* non-fatal: still print the result */
    }
  }

  // Validate --fail-on ONCE (strict): an unrecognized value must error, not silently
  // degrade the gate to blocking-only.
  const failOnRaw = p.flags["fail-on"];
  const failOnParsed = parseFailOn(failOnRaw);
  if (failOnRaw !== undefined && failOnParsed === null) {
    console.error(`ultra11y audit: --fail-on must be blocking|major|minor (got "${String(failOnRaw)}").`);
    return 2;
  }

  // Standalone gates (linter-style, no baseline): `--fail-on` gates the whole audit by
  // finding severity; `--require-captures` gates on rendered-capture blind spots. Both
  // compose; a plain audit (neither flag) always exits 0.
  const failOnSet = failOnRaw !== undefined;
  const failOn = failOnSet ? (failOnParsed ?? "bloquant") : undefined;
  // Gate on THIS standard's findings. Under the core that is the engine's own list; under a
  // pack it also carries the pack's declarative-rule findings, which are part of its verdict
  // and were previously invisible to the gate for want of a `--standard` to select them.
  const failing = failOn ? findingsAtOrAbove(findingsForStandard(result, standard), failOn) : [];
  const blindSpots = requireCaptures ? (result.scope.captureCoverage?.blindSpots ?? []) : [];

  if (p.flags.json) console.log(JSON.stringify(document, null, 2));
  else {
    console.log(auditSummary(result, lang, standard));
    if (requireCaptures && result.scope.captureCoverage) console.error(captureCoverageSummary(result.scope.captureCoverage, lang));
    if (failOnSet && failing.length)
      console.error(lang === "fr" ? `✗ ${failing.length} non-conformité(s) ≥ ${failOn}.` : `✗ ${failing.length} non-conformity(ies) ≥ ${failOn}.`);
    if (requireCaptures && blindSpots.length)
      console.error(
        lang === "fr" ? `✗ ${blindSpots.length} composant(s) sans capture rendue.` : `✗ ${blindSpots.length} component(s) without a rendered capture.`,
      );
  }
  if (!failOnSet && !requireCaptures) return 0;
  return failing.length || blindSpots.length ? 1 : 0;
}

// `pages discover` — turn ONE entry point into the declared page sample.
//
// The crawler and the sitemap parser already existed, but they only ever fed a single scan:
// nothing was persisted, so the multi-page contract stayed a `sample.pages` block written by
// hand. That is the step that stops people auditing more than one page. This writes the block
// for them — and then `sample check`, `scan --sample` and `pages` all work off it.
//
// The pages already declared are NEVER touched: `auth`, `storageState` and `notes` are human
// work (someone worked out how to reach that page), so re-running discovery appends and
// never overwrites.
async function cmdPagesDiscover(p: ParsedArgs): Promise<number> {
  const lang = resolveLang(p.flags, {});
  const sitemap = typeof p.flags.sitemap === "string" ? (p.flags.sitemap as string) : undefined;
  const crawl = typeof p.flags.crawl === "string" ? (p.flags.crawl as string) : undefined;

  // FROM THE SNAPSHOTS the test suite already produces — no network, no crawl. This is the
  // "one inventory" route: the E2E producer knows every route it captured, including the
  // state-reached ones a URL crawl can never find (a modal, a funnel step behind a client-side
  // transition), and this is what folds that knowledge back into the declared sample.
  if (p.flags["from-snapshots"] === true) {
    const root = typeof p.flags.root === "string" && p.flags.root ? p.flags.root : ".";
    const recorded = readSnapshots(root);
    const snaps = sampleFromSnapshots(recorded);
    if (!snaps.length) {
      console.error(
        lang === "fr"
          ? `ultra11y pages discover : aucun instantané sous ${join(root, PAGES_DIR)} — lancez d'abord vos tests E2E avec checkA11y, ou \`scan --sample\`.`
          : `ultra11y pages discover: no snapshot under ${join(root, PAGES_DIR)} — run your E2E tests with checkA11y first, or \`scan --sample\`.`,
      );
      return 1;
    }
    recordRouteInventory(
      p,
      lang,
      snaps.map((s) => s.url),
      "snapshots",
    );
    if (p.flags["routes-only"] === true) return 0;
    if (p.flags.propose === true)
      return writeProposedSample(
        p,
        lang,
        recorded.map((s) => ({
          id: s.meta.id,
          url: s.meta.url,
          title: extractTitle(s.dom) ?? s.meta.name,
          html: s.dom,
          skeleton: skeletonOf(s.dom),
          ...(s.meta.auth !== undefined ? { auth: s.meta.auth } : {}),
        })),
      );
    return writeDiscoveredSample(p, lang, snaps, snaps.length);
  }

  if (!sitemap && !crawl) {
    console.error(
      lang === "fr"
        ? "ultra11y pages discover : passez --sitemap <url>, --crawl <url> ou --from-snapshots."
        : "ultra11y pages discover: pass --sitemap <url>, --crawl <url> or --from-snapshots.",
    );
    return 2;
  }
  const depth = typeof p.flags.depth === "string" ? Number(p.flags.depth) : undefined;
  const max = typeof p.flags.max === "string" ? Number(p.flags.max) : undefined;

  // The crawl fetches every page it walks in order to read its links. Memoize those
  // responses so the titles cost NOTHING extra — only the leaves (and every sitemap URL,
  // which is never fetched during discovery) need a request of their own.
  const cache = new Map<string, string>();
  const fetchHtml = async (url: string): Promise<string> => {
    const hit = cache.get(url);
    if (hit !== undefined) return hit;
    let html = "";
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (res.ok) html = await res.text();
    } catch {
      /* unreachable page — it still belongs in the sample, it simply gets no title */
    }
    cache.set(url, html);
    return html;
  };

  let urls: string[];
  try {
    // Unbounded unless asked (`crawlBound`): discovery that silently stopped at 50 URLs wrote
    // a `sample.pages` block shorter than the site, and every later `scan --sample` inherited
    // that truncation without a word.
    const cap = crawlBound(max);
    urls = sitemap
      ? ((u) => (Number.isFinite(cap) ? u.slice(0, cap) : u))(parseSitemapUrls(await fetchHtml(sitemap)))
      : await crawlUrls(crawl!, { fetchHtml, depth, max, onPage: (url, n) => console.error(`ultra11y pages discover: ${n} — ${url}`) });
  } catch (e) {
    console.error(`ultra11y pages discover: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (!urls.length) {
    console.error(
      lang === "fr"
        ? "ultra11y pages discover : aucune URL trouvée (sitemap vide/injoignable, ou page d'entrée sans lien de même origine). Note : un SPA rendu côté client n'expose pas ses routes dans le HTML servi — utilisez un sitemap."
        : "ultra11y pages discover: no URL found (empty/unreachable sitemap, or entry page with no same-origin link). Note: a client-rendered SPA does not expose its routes in the served HTML — use a sitemap.",
    );
    return 1;
  }

  // The inventory first: it is every route found, whatever the sample keeps of them.
  recordRouteInventory(p, lang, urls, sitemap ? "sitemap" : "crawl");
  if (p.flags["routes-only"] === true) return 0;

  // Titles, bounded and best-effort: a page whose document has none keeps a name humanized
  // from its path rather than an invented one.
  const titles = new Map<string, string>();
  const CONCURRENCY = 6;
  const queue = [...urls];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        const t = extractTitle(await fetchHtml(url));
        if (t) titles.set(url, t);
      }
    }),
  );

  if (p.flags.propose === true) {
    // The template fingerprint comes from a snapshot when the project has one for the route:
    // the served HTML of a client-rendered page is a shell, the snapshot is what it renders.
    const root = typeof p.flags.root === "string" && p.flags.root ? p.flags.root : ".";
    // The snapshot also lends its id (the directory the page is captured under) and its auth
    // flag, so the declared page stays aligned with its capture. Several snapshots on one route
    // (a base page and its state-reached pages): the shortest id, then the smallest, is the base.
    const snapshotOf = new Map<string, { id: string; skeleton: string; auth?: boolean }>();
    const recorded = readSnapshots(root).sort((a, b) => a.meta.id.length - b.meta.id.length || (a.meta.id < b.meta.id ? -1 : a.meta.id > b.meta.id ? 1 : 0));
    for (const s of recorded) {
      const key = routePath(s.meta.url);
      if (!snapshotOf.has(key))
        snapshotOf.set(key, { id: s.meta.id, skeleton: skeletonOf(s.dom), ...(s.meta.auth !== undefined ? { auth: s.meta.auth } : {}) });
    }
    const inputs: ProposalInput[] = urls.map((url) => {
      const html = cache.get(url);
      const title = titles.get(url);
      const snap = snapshotOf.get(routePath(url));
      return {
        url,
        ...(title ? { title } : {}),
        ...(html ? { html } : {}),
        ...(snap ? { id: snap.id, skeleton: snap.skeleton, ...(snap.auth !== undefined ? { auth: snap.auth } : {}) } : {}),
      };
    });
    return writeProposedSample(p, lang, inputs);
  }
  return writeDiscoveredSample(p, lang, proposeSamplePages(urls, titles), urls.length);
}

/** `pages discover --propose`: the deterministic sample (src/sample-propose.ts), printed, or
 *  written over the declared pages with --write (human work kept — see applyProposal). */
function writeProposedSample(p: ParsedArgs, lang: Lang, inputs: ProposalInput[]): number {
  const key = typeof p.flags.standard === "string" && p.flags.standard ? p.flags.standard : "rgaa";
  let methodology: SampleMethodology | undefined;
  let locale = "fr";
  try {
    const standard = resolveStandard(key);
    const pack = isCore(standard) ? null : getPack(standard);
    methodology = pack?.sampleMethodology;
    locale = pack?.defaultLocale ?? "fr";
  } catch (e) {
    console.error(`ultra11y pages discover: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (!methodology) {
    console.error(
      lang === "fr"
        ? `ultra11y pages discover : --propose suit la méthodologie d'échantillon d'un référentiel, et « ${key} » n'en définit pas (essayez --standard rgaa).`
        : `ultra11y pages discover: --propose follows a standard's sample methodology, and "${key}" defines none (try --standard rgaa).`,
    );
    return 2;
  }
  const sizeFlag = p.flags["sample-size"];
  const size = typeof sizeFlag === "string" ? Number(sizeFlag) : DEFAULT_SAMPLE_SIZE;
  if (!Number.isInteger(size) || size < 1) {
    console.error(`ultra11y pages discover: --sample-size expects a positive integer, got "${String(sizeFlag)}".`);
    return 2;
  }
  const searchQuery = typeof p.flags["search-query"] === "string" ? (p.flags["search-query"] as string) : undefined;
  const proposal = proposeSample(inputs, { methodology, size, locale, ...(searchQuery ? { searchQuery } : {}) });

  let existing: SampleConfig | undefined;
  try {
    existing = loadConfig(process.cwd())?.sample;
  } catch (e) {
    console.error(`ultra11y pages discover: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const applied = applyProposal(existing, proposal.sample);
  const v = validateSample(applied.sample);
  if (!v.ok || !v.sample) {
    console.error(lang === "fr" ? "ultra11y pages discover : échantillon proposé invalide :" : "ultra11y pages discover: the proposed sample is invalid:");
    for (const i of v.issues) console.error(`  ✗ ${i.path ? `${i.path}: ` : ""}${i.message}`);
    return 1;
  }
  const summary = proposalSummary(lang, proposal, applied);
  // A declared page leaves the sample by name, never in silence.
  for (const d of applied.dropped)
    console.error(
      lang === "fr"
        ? `ultra11y pages discover : retirée de l'échantillon — ${d.id} (${d.url}), hors proposition et sans auth, storageState, sources ni notes${p.flags.write === true ? "" : " (rien n'est écrit sans --write)"}`
        : `ultra11y pages discover: dropped from the sample — ${d.id} (${d.url}), outside the proposal and carrying no auth, storageState, sources or notes${p.flags.write === true ? "" : " (nothing is written without --write)"}`,
    );
  if (p.flags.json)
    console.log(
      JSON.stringify(
        {
          sample: v.sample,
          considered: proposal.considered,
          documents: proposal.documents,
          clusters: proposal.clusters,
          leftOut: proposal.leftOut,
          kept: applied.kept.map((x) => ({ id: x.id, url: x.url })),
          dropped: applied.dropped.map((x) => ({ id: x.id, url: x.url })),
        },
        null,
        2,
      ),
    );
  if (p.flags.write !== true) {
    if (!p.flags.json) {
      console.log(JSON.stringify({ sample: v.sample }, null, 2));
      console.log(
        `\n${summary}\n${lang === "fr" ? "Rien n'a été écrit — relancez avec --write pour remplacer l'échantillon de .ultra11yrc.json." : "Nothing was written — re-run with --write to replace the sample in .ultra11yrc.json."}`,
      );
    }
    return 0;
  }
  const file = persistSample(v.sample);
  if (file === undefined) return 2;
  if (!p.flags.json)
    console.log(
      `${summary} → ${file}\n${
        lang === "fr"
          ? "Gardez cet échantillon : toute modification à la main consigne sa raison (`notes` de la page, ou `sample.absent` pour un type de page retiré). Puis `ultra11y sample check --standard rgaa` et `ultra11y scan --sample`."
          : "Keep this sample: any hand edit records its reason (the page's `notes`, or `sample.absent` for a page kind taken out). Then `ultra11y sample check --standard rgaa` and `ultra11y scan --sample`."
      }`,
    );
  return 0;
}

function proposalSummary(lang: Lang, proposal: SampleProposal, applied: ReturnType<typeof applyProposal>): string {
  const n = proposal.sample.pages.length;
  const represented = proposal.clusters.filter((c) => c.representative).length;
  const absent = (proposal.sample.absent ?? []).map((a) => a.kind).join(", ");
  return lang === "fr"
    ? `${n} page(s) proposée(s) sur ${proposal.considered} découverte(s) · ${represented}/${proposal.clusters.length} gabarit(s) représenté(s)${proposal.leftOut ? ` (${proposal.leftOut} laissé(s) par --sample-size)` : ""}${absent ? ` · sans page : ${absent}` : ""}${applied.kept.length ? ` · ${applied.kept.length} page(s) déclarée(s) conservée(s)` : ""}${applied.dropped.length ? ` · ${applied.dropped.length} retirée(s)` : ""}`
    : `${n} page(s) proposed out of ${proposal.considered} discovered · ${represented}/${proposal.clusters.length} template(s) represented${proposal.leftOut ? ` (${proposal.leftOut} left out by --sample-size)` : ""}${absent ? ` · no page for: ${absent}` : ""}${applied.kept.length ? ` · ${applied.kept.length} declared page(s) kept` : ""}${applied.dropped.length ? ` · ${applied.dropped.length} dropped` : ""}`;
}

/** Write `sample` into `.ultra11yrc.json`, every other key untouched. Undefined when the file
 *  is not JSON (it is then left alone). */
function persistSample(sample: SampleConfig): string | undefined {
  const file = join(process.cwd(), ".ultra11yrc.json");
  let doc: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readText(file)) as Record<string, unknown>;
    } catch {
      console.error("ultra11y pages discover: .ultra11yrc.json is not valid JSON — refusing to overwrite it.");
      return undefined;
    }
  }
  doc.sample = sample;
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return file;
}

/** Merge proposed pages into `.ultra11yrc.json` (or print them), shared by every discovery
 *  route — sitemap, crawl and snapshots. `mergeSample` keeps what is already declared, so a
 *  re-run never overwrites the human work of describing how a page is reached. */
/** Stamp `scope.routes` — every route of the inventory, the sample and the recorded pages, with
 *  how each was observed (src/routes.ts). A no-op without an inventory, so an audit of a project
 *  that never ran `pages discover --write` is unchanged. */
export interface StampRoutesExtra {
  refused?: ScanRedirect[];
  bounded?: string[];
  max?: number;
  /** Read the pages recorded under `<root>/.ultra11y/pages` as observations. Default true. False
   *  when this audit left the snapshots out (`--no-captures`, `--changed`/`--staged`/`--since`):
   *  a route is then never labelled captured or scanned on the strength of a page nothing in
   *  this run measured — it is source-only or not reached. */
  recorded?: boolean;
  /** The URLs this run's browser actually scanned (DynamicResult.scanned), labelled scanned
   *  whether or not a snapshot was persisted for them (`scan --no-snapshot`). */
  scanned?: readonly string[];
}

export function stampRoutes(result: AuditResult, root: string, lang: Lang, extra: StampRoutesExtra = {}): void {
  const inventory = readRoutes(root);
  if (!inventory) return;
  let sample: SamplePage[] | undefined;
  try {
    sample = loadConfig(process.cwd())?.sample?.pages;
  } catch {
    /* an unreadable config has no sample to label — every route is then « hors échantillon » */
  }
  const pages: ObservedPage[] =
    extra.recorded === false ? [] : readSnapshots(root).map((s) => ({ id: s.meta.id, url: s.meta.url, ...(s.meta.runner ? { runner: s.meta.runner } : {}) }));
  for (const url of extra.scanned ?? []) pages.push({ url, runner: "scan" });
  result.scope.routes = routeCoverage({
    inventory,
    ...(sample ? { sample } : {}),
    pages,
    refused: [...(result.scope.redirected ?? []), ...(extra.refused ?? [])],
    ...(extra.bounded ? { bounded: extra.bounded } : {}),
    ...(extra.max !== undefined ? { max: extra.max } : {}),
  });
  const n = routeCounts(result.scope.routes);
  console.error(
    lang === "fr"
      ? `ultra11y : ${result.scope.routes.length} route(s) — ${n.captured} capturée(s) (E2E), ${n.scanned} scannée(s), ${n.source} source seule, ${n["not-reached"]} non atteinte(s).`
      : `ultra11y: ${result.scope.routes.length} route(s) — ${n.captured} captured (E2E), ${n.scanned} scanned, ${n.source} source only, ${n["not-reached"]} not reached.`,
  );
}

/** Persist the discovered routes to `.ultra11y/routes.json` (with `--write` or `--routes-only`).
 *  The inventory is the whole application; the sample is what the verdicts are stated over.
 *  Every later audit lists each inventory route with how it was observed (src/routes.ts). */
function recordRouteInventory(p: ParsedArgs, lang: Lang, urls: readonly string[], via: RouteSource): void {
  if (p.flags.write !== true && p.flags["routes-only"] !== true) return;
  const root = typeof p.flags.root === "string" && p.flags.root ? p.flags.root : ".";
  const { file, added, total } = writeRoutes(root, urls, via);
  console.error(
    lang === "fr"
      ? `ultra11y pages discover : inventaire des routes → ${file} (${total} route(s), ${added} nouvelle(s)). \`ultra11y scan --sample --all-routes\` couvre l'échantillon puis le reste.`
      : `ultra11y pages discover: route inventory → ${file} (${total} route(s), ${added} new). \`ultra11y scan --sample --all-routes\` covers the sample, then the rest.`,
  );
}

function writeDiscoveredSample(p: ParsedArgs, lang: Lang, proposed: SamplePage[], found: number): number {
  let existing: SampleConfig | undefined;
  try {
    existing = loadConfig(process.cwd())?.sample;
  } catch (e) {
    console.error(`ultra11y pages discover: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const merged = mergeSample(existing, proposed);

  // Validate BEFORE writing: a malformed block would make every later `scan --sample` and
  // `sample check` a hard error, and the user would have no idea this command caused it.
  const v = validateSample(merged.sample);
  if (!v.ok || !v.sample) {
    console.error(lang === "fr" ? "ultra11y pages discover : échantillon proposé invalide :" : "ultra11y pages discover: the proposed sample is invalid:");
    for (const i of v.issues) console.error(`  ✗ ${i.path ? `${i.path}: ` : ""}${i.message}`);
    return 1;
  }

  if (p.flags.json) console.log(JSON.stringify({ sample: v.sample, added: merged.added, kept: merged.kept }, null, 2));

  if (p.flags.write !== true) {
    if (!p.flags.json) {
      console.log(JSON.stringify({ sample: v.sample }, null, 2));
      console.log(
        lang === "fr"
          ? `\n${found} page(s) découverte(s), ${merged.added.length} nouvelle(s). Rien n'a été écrit — relancez avec --write pour fusionner dans .ultra11yrc.json.`
          : `\n${found} page(s) discovered, ${merged.added.length} new. Nothing was written — re-run with --write to merge into .ultra11yrc.json.`,
      );
    }
    return 0;
  }

  const file = persistSample(v.sample);
  if (file === undefined) return 2;
  if (!p.flags.json)
    console.log(
      lang === "fr"
        ? `${merged.added.length} page(s) ajoutée(s), ${merged.kept} conservée(s) → ${file}\nVérifiez la couverture : \`ultra11y sample check --standard rgaa\`, puis scannez : \`ultra11y scan --sample\`.`
        : `${merged.added.length} page(s) added, ${merged.kept} kept → ${file}\nLint the coverage: \`ultra11y sample check --standard rgaa\`, then scan: \`ultra11y scan --sample\`.`,
    );
  return 0;
}

// `pages` — the per-page criterion grid. RGAA is a per-page norm; the engine's verdict is
// scope-wide. Everything needed to bridge the two is already on the AuditResult, so this
// rebuilds the grid offline from a committed audit.json — no snapshots, no browser.
async function cmdPages(p: ParsedArgs): Promise<number> {
  // `pages discover` takes no audit — it BUILDS the sample the later commands read.
  if (p.positionals[0] === "discover") return cmdPagesDiscover(p);
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error("ultra11y pages: --in <audit.json> is required ('-' for stdin), or use `pages discover`.");
    return 2;
  }
  const standard = stdOf(p, "pages");
  if (standard === null) return 2;
  const raw = inFlag === "-" ? await readStdin() : readInputFile(inFlag, "pages", "--in");
  if (raw === null) return 2;
  let result: unknown;
  try {
    result = unwrapAudit(JSON.parse(raw));
  } catch {
    console.error("ultra11y pages: --in is not valid JSON (expected an AuditResult).");
    return 2;
  }
  if (!isCurrentAudit(result)) {
    console.error("ultra11y pages: input is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
    return 2;
  }
  const lang = resolveLang(p.flags, { audit: result, standard });
  const scope = pagesOf(result);
  if (!scope.length) {
    console.error(
      lang === "fr"
        ? "ultra11y pages : aucune page dans le périmètre. Capturez des instantanés (ultra11y/playwright ou ultra11y/cypress) ou scannez un échantillon (scan --sample)."
        : "ultra11y pages: no page in scope. Capture snapshots (ultra11y/playwright or ultra11y/cypress) or scan a sample (scan --sample).",
    );
    return 1;
  }
  attributePages(result, scope);

  if (p.flags.json) {
    // Projected onto the ACTIVE standard, like every rendered surface — see pagesForStandard.
    const derived = derivePages(result, scope);
    // Under a pack, the RGAA « taux moyen » and the per-page rates it averages (src/report.ts
    // `averageConformanceRate`) — the same figures the report prints beside its global rate.
    const doc = {
      pages: pagesForStandard(result, derived, standard, lang),
      unattributed: unattributedFindings(result).length,
      ...(isCore(standard) ? {} : { averageRate: averageConformanceRate(result, derived, standard, lang) }),
    };
    const json = JSON.stringify(doc, null, 2);
    console.log(json);
    // AND ON DISK, WHEN THERE IS A DIRECTORY TO PUT IT IN.
    //
    // The grid, the sheets and the HTML are all documents for a human. This is the same
    // projection for a machine — a later job, a badge, a dashboard — and stdout alone cannot
    // serve it: in CI the caller is an orchestrator step, a step output is size-capped,
    // and a criterion × page matrix is not a scalar. So `--json --out <dir>` also writes
    // `<dir>/pages.json`, which the artifact then carries beside the sheets it mirrors.
    const outDir = typeof p.flags.out === "string" && p.flags.out ? p.flags.out : "";
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "pages.json"), `${json}\n`);
    }
    return 0;
  }

  const format = typeof p.flags.format === "string" ? (p.flags.format as string) : "grid";
  if (!["grid", "report"].includes(format)) {
    console.error(`ultra11y pages: --format must be grid or report (got "${format}").`);
    return 2;
  }
  if (format === "grid") {
    console.log(renderPageGrid(result, scope, standard, lang));
    // Under a pack, the « taux moyen » under the grid, with the per-page rate each page
    // contributes to it — the same rate as the grid's own rate row.
    if (!isCore(standard)) {
      const avg = averageConformanceRate(result, derivePages(result, scope), standard, lang);
      const rated = new Map(avg.pages.map((pg) => [pg.id, pg]));
      const cells = derivePages(result, scope).map((pg) => `${pg.name} ${pageConformanceCell(rated.get(pg.id), lang)}`);
      console.log(`${averageRateLine(avg, lang)}\n\n> ${cells.join(" · ")}\n`);
    }
    return 0;
  }

  // --format report — the per-page DOSSIER (issue #4052): one section per page with its
  // screenshot, the standard's criteria in full, and every non-conformity as the shared
  // auditor block. Nothing is re-decided here; see src/pages-report.ts.
  const derived = derivePages(result, scope);
  const split = p.flags.split === "page";
  const outDir = typeof p.flags.out === "string" && p.flags.out ? (p.flags.out as string) : undefined;

  // The screenshot lives beside the snapshot, in `.ultra11y/pages/`. Referencing it
  // relatively is right when the report is read in place, and wrong the moment the report
  // DIRECTORY travels on its own: CI uploads `audits/` as the artifact, and a
  // `../../.ultra11y/…` link then points outside it — every image broken in the artifact
  // the reviewer actually opens. So when writing to a directory we copy each screenshot
  // into it (`assets/<page-id>.png`) and link that; stdout mode keeps the relative
  // reference, since there is no output directory to be self-contained.
  // The whole page when the producer took it (#135), the viewport shot otherwise.
  const shotOf = (id: string): string => pageScreenshot(PAGES_DIR, id) ?? join(PAGES_DIR, id, "screen.png");
  const shotsRelative = (fileDir: string): Map<string, string> => {
    const m = new Map<string, string>();
    for (const pg of derived) {
      if (existsSync(shotOf(pg.id))) m.set(pg.id, relative(fileDir, shotOf(pg.id)).split("\\").join("/"));
    }
    return m;
  };
  // The screenshots that EXIST, as absolute-ish source paths. The HTML tier needs the bytes
  // (to weigh them against the inline budget); the Markdown tier needs the href. Same set,
  // two questions, so the membership test is written once.
  const shotPaths = (pages: PageResult[]): Map<string, string> => {
    const m = new Map<string, string>();
    for (const pg of pages) if (existsSync(shotOf(pg.id))) m.set(pg.id, shotOf(pg.id));
    return m;
  };
  const shotsCopiedInto = (dir: string): Map<string, string> => {
    const m = new Map<string, string>();
    const assets = join(dir, "assets");
    for (const pg of derived) {
      const src = shotOf(pg.id);
      if (!existsSync(src)) continue;
      mkdirSync(assets, { recursive: true });
      copyFileSync(src, join(assets, `${pg.id}.png`));
      m.set(pg.id, `./assets/${pg.id}.png`);
    }
    return m;
  };

  const wantEvidence = p.flags.evidence === true;
  const wantHtml = p.flags.html === true;

  if (!outDir) {
    // No --out: stream the whole document to stdout. Screenshots are resolved against the
    // CWD, which is where a reader piping this would sit.
    if (wantEvidence || wantHtml) {
      console.error(
        lang === "fr"
          ? "ultra11y pages : --evidence et --html demandent --out <dir>. Le mode stdout n'a pas de répertoire où écrire des images ni être auto-suffisant."
          : "ultra11y pages: --evidence and --html require --out <dir>. Stdout mode has no directory to write images into, nor to be self-contained in.",
      );
      return 2;
    }
    console.log(renderPagesDocument(result, derived, { standard, lang, screenshots: shotsRelative(".") }));
    return 0;
  }

  mkdirSync(outDir, { recursive: true });

  // THE EVIDENCE TIER. Annotated crops, derived at render time from the snapshot the finding
  // was raised on — never stamped on the finding, because a rectangle in pixels is a property
  // of the image and goes silently wrong the moment the audit is re-rendered against another
  // capture. `writeEvidence` reports what it could NOT draw, and that refusal is printed.
  const manifest = wantEvidence ? writeEvidence(result, { outDir, ...evidenceCapsOf(p) }) : undefined;
  const cropFor = manifest
    ? (f: Finding) => {
        const c = manifest.crops.get(findingId(f));
        return c ? { href: c.href, alt: c.alt[lang] } : undefined;
      }
    : undefined;
  if (manifest) {
    const total = evidenceNotice(manifest, null, lang);
    console.error(
      lang === "fr"
        ? `ultra11y : ${manifest.totals.imaged} vignette(s) écrite(s) dans ${join(outDir, "assets")}.`
        : `ultra11y: ${manifest.totals.imaged} crop(s) written to ${join(outDir, "assets")}.`,
    );
    for (const line of total) console.error(line);
  }
  // ONE object, both paths. The split path used to assemble its own notice and the combined
  // path silently went without — so the deliverable that fits in a single file was the one
  // that never said what it had not illustrated.
  const evidenceOpts = {
    ...(cropFor ? { cropFor } : {}),
    ...(manifest ? { evidenceNotice: (id: string) => evidenceNotice(manifest, id, lang) } : {}),
  };

  if (!split) {
    const file = join(outDir, `pages-${result.date}.md`);
    writeFileSync(file, `${renderPagesDocument(result, derived, { standard, lang, screenshots: shotsCopiedInto(outDir), ...evidenceOpts })}\n`);
    const html = wantHtml
      ? emitHtml(result, {
          outDir,
          standard,
          lang,
          layout: "pages",
          pages: true,
          screenshots: shotPaths(derived),
          ...(manifest ? { evidence: manifest } : {}),
          inlineBudget: budgetOf(p),
        })
      : undefined;
    console.log(file);
    return html?.imagesDropped ? 1 : 0;
  }

  const shots = shotsCopiedInto(outDir);
  // Sheets are `page-<id>.md`, never `<id>.md`: a page whose id is `index` — the ordinary id
  // for an `index.html` target — would otherwise be written to the same path as the index and
  // one of the two would silently vanish. The prefix makes the collision impossible by
  // construction rather than by hoping no page is called that.
  const sheet = (id: string): string => `page-${id}.md`;
  const hrefs = new Map(derived.map((pg) => [pg.id, `./${sheet(pg.id)}`]));
  for (const pg of derived) {
    writeFileSync(join(outDir, sheet(pg.id)), `${renderPageDocument(result, pg, { standard, lang, screenshots: shots, ...evidenceOpts })}\n`);
  }
  const index = join(outDir, "index.md");
  writeFileSync(index, `${renderPagesIndex(result, derived, { standard, lang, hrefs })}\n`);
  const html = wantHtml
    ? emitHtml(result, {
        outDir,
        standard,
        lang,
        layout: "pages",
        pages: true,
        screenshots: shotPaths(derived),
        ...(manifest ? { evidence: manifest } : {}),
        inlineBudget: budgetOf(p),
      })
    : undefined;
  console.log(index);
  return html?.imagesDropped ? 1 : 0;
}

/** A positive integer flag, or undefined for the module default. A malformed value is
 *  REPORTED, never coerced: silently falling back to the default on a typo is how a run
 *  appears to honour a limit it never read — the same class of defect as an input the
 *  action declares and no step passes. */
function positiveIntFlag(p: ParsedArgs, name: string): number | undefined {
  const raw = p.flags[name];
  if (typeof raw !== "string" || !raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  console.error(`ultra11y: --${name} expects a positive integer (got "${raw}"). Ignored — the default applies.`);
  return undefined;
}

/** `--inline-budget` in bytes, or undefined for the module default. */
function budgetOf(p: ParsedArgs): number | undefined {
  return positiveIntFlag(p, "inline-budget");
}

/** `--evidence-max` as the evidence tier's cap override. Only the RUN-WIDE total is exposed:
 *  the per-rule and per-page caps are what make one image stand for a repeated defect, and a
 *  user raising them would get back the 472-pictures-of-one-defect artifact the caps exist to
 *  prevent. What a user actually needs to control is how big the upload gets — that is the
 *  total, and it is the only one that is a size fuse rather than a de-duplication rule. */
function evidenceCapsOf(p: ParsedArgs): { caps: { total: number } } | Record<string, never> {
  const total = positiveIntFlag(p, "evidence-max");
  return total === undefined ? {} : { caps: { total } };
}

/** Write the HTML documents and report the budget ladder. Shared by `pages` and `report`, so
 *  the two commands cannot degrade images differently.
 *
 *  It writes to STDERR only. Stdout carries one thing on these commands — the path the caller
 *  captures (an orchestrator reads it into a variable) — and a second line there would break it. */
function emitHtml(result: AuditResult, opts: Parameters<typeof writeHtml>[1]): ReturnType<typeof writeHtml> {
  const res = writeHtml(result, opts);
  for (const n of res.notices) console.error(`ultra11y: ${n}`);
  console.error(`ultra11y: ${res.index}`);
  if (res.composite) console.error(`ultra11y: ${res.composite}`);
  return res;
}

// `snapshot write` — the single surface every browser-side producer writes through (the E2E
// integrations, ultra11y/playwright and ultra11y/cypress). It takes the collected payload on stdin, persists the snapshot
// and audits it, so a producer needs to know NOTHING about the on-disk format, the
// provenance comment or the audit. One process per checked page, not three.
async function cmdSnapshot(p: ParsedArgs): Promise<number> {
  const sub = p.positionals[0];
  const root = typeof p.flags.root === "string" && p.flags.root ? p.flags.root : ".";
  const lang = resolveLang(p.flags, {});

  if (sub === "list") {
    const snaps = readSnapshots(root);
    if (p.flags.json)
      console.log(
        JSON.stringify(
          snaps.map((s) => s.meta),
          null,
          2,
        ),
      );
    else if (!snaps.length) console.log(lang === "fr" ? `Aucun instantané dans ${join(root, PAGES_DIR)}.` : `No snapshot in ${join(root, PAGES_DIR)}.`);
    else for (const s of snaps) console.log(`${s.meta.id}\t${s.meta.name}\t${s.meta.url}${s.meta.auth ? "\t[auth]" : ""}`);
    return 0;
  }

  if (sub !== "write") {
    console.error("ultra11y snapshot: expected `snapshot write` (payload on stdin) or `snapshot list`.");
    return 2;
  }

  const raw = await readStdin();
  if (!raw.trim()) {
    console.error("ultra11y snapshot write: no payload on stdin (expected {meta, dom, styles?, boxes?, axtree?}).");
    return 2;
  }
  let payload: {
    meta?: unknown;
    dom?: unknown;
    styles?: StyleDigest;
    boxes?: BoxDigest;
    axtree?: AxNode;
    css?: CssDigest;
    screenshot?: unknown;
    screenshotFull?: unknown;
    probes?: SnapshotProbes;
    axe?: unknown;
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    console.error("ultra11y snapshot write: stdin is not valid JSON.");
    return 2;
  }
  const v = validateSnapshotMeta(payload.meta);
  if (!v.ok || !v.meta) {
    for (const i of v.issues) console.error(`ultra11y snapshot write: ${i.path} — ${i.message}`);
    return 2;
  }
  if (typeof payload.dom !== "string" || !payload.dom.trim()) {
    console.error("ultra11y snapshot write: `dom` must be the serialized documentElement.outerHTML.");
    return 2;
  }

  let dir: string;
  try {
    dir = writeSnapshot(root, {
      meta: v.meta,
      dom: payload.dom,
      ...(payload.styles ? { styles: payload.styles } : {}),
      ...(payload.boxes ? { boxes: payload.boxes } : {}),
      ...(payload.axtree ? { axtree: payload.axtree } : {}),
      ...(payload.css ? { css: payload.css } : {}),
      // What the live probes measured, when the producer ran them. Persisted beside the DOM
      // because the audit that folds them runs later, in another process — a measurement
      // that lives only in the producer's memory decides nothing.
      ...(payload.probes ? { probes: payload.probes } : {}),
      // Same reason, for the axe pass: what a rule engine found in the browser has to survive
      // the process that found it, or the offline re-audit sees a page nobody ran axe on.
      ...(payload.axe ? { axe: payload.axe as RenderSignals["axe"] } : {}),
      // The screenshot rides in as base64 (a producer has bytes, not a path) and powers the
      // pixel tier. writeSnapshot owns the decoding, so every producer — this command,
      // `scan` — writes it the one same way.
      ...(typeof payload.screenshot === "string" && payload.screenshot ? { screenshotBase64: payload.screenshot } : {}),
      // The whole page, for the report's reader — never read by a rule.
      ...(typeof payload.screenshotFull === "string" && payload.screenshotFull ? { screenshotFullBase64: payload.screenshotFull } : {}),
    });
  } catch (e) {
    console.error(`ultra11y snapshot write: could not write the snapshot: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  // Audit exactly this page's DOM — not the whole pages tree — so a producer checking one
  // page is never failed by another page's backlog.
  const result = runAudit({ inputs: [join(dir, "dom.html")], onWarn: (m) => console.error(m) });

  // parseFailOn returns "bloquant" for an ABSENT flag (its "flag present, no value" default),
  // so the gate must key on presence — otherwise a plain `snapshot write` would exit 1 on any
  // page with a blocking finding, and a producer that only wants to RECORD would fail.
  const failOnRaw = p.flags["fail-on"];
  const failOnParsed = parseFailOn(failOnRaw);
  if (failOnRaw !== undefined && failOnParsed === null) {
    console.error(`ultra11y snapshot write: --fail-on must be blocking|major|minor (got "${String(failOnRaw)}").`);
    return 2;
  }
  const failing = failOnRaw !== undefined ? findingsAtOrAbove(result.findings, failOnParsed ?? "bloquant").filter((f) => !f.advisory) : [];

  if (p.flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(lang === "fr" ? `→ instantané écrit dans ${dir}` : `→ snapshot written to ${dir}`);
    console.log(auditSummary(result, lang));
  }
  return failing.length ? 1 : 0;
}

function cmdInit(p: ParsedArgs): number {
  const root = repoRoot() ?? process.cwd();
  const engineRel = resolveEnginePath(root);
  const failOnParsed = parseFailOn(p.flags["fail-on"]);
  if (p.flags["fail-on"] !== undefined && failOnParsed === null) {
    console.error(`ultra11y init: --fail-on must be blocking|major|minor (got "${String(p.flags["fail-on"])}").`);
    return 2;
  }
  const failOn = failOnParsed ?? "bloquant";
  // `init` wires exactly one thing: the strict-staged, auto-fixing pre-commit gate. CI runs
  // through iterion's rgaa-audit bot, so there is no workflow to generate here.
  console.log(`ultra11y init: wrote ${writeHook(root, engineRel, failOn)}`);
  console.log(`ultra11y init: done. The pre-commit gate audits staged changes and auto-applies safe fixes (bypass once with SKIP_A11Y=1).`);
  return 0;
}

/** `hook --claude-code|--codex|--opencode` — the decision half of the PreToolUse hook.
 *  Reads the payload on stdin, emits when the pending commit/push/PR should get an
 *  accessibility review first, and emits NOTHING otherwise. Not meant to be run by hand:
 *  `hooks/pre-tool-use.mjs` (Claude Code, Codex) and `.opencode/plugins/ultra11y.js`
 *  (OpenCode) are what call it, and only once their cheap prefilter has passed. Always
 *  exits 0 — see src/hook.ts for why.
 *
 *  Two output shapes:
 *  - `--claude-code` / `--codex`: the `hookSpecificOutput` JSON envelope. Codex's PreToolUse
 *    is a clone of Claude Code's and accepts exactly the one decision this emits (`deny`),
 *    so the two are the same code path today. The flag is kept distinct anyway: it gives
 *    `status` a marker to grep for, and it is where the branch goes the day they diverge.
 *  - `--opencode`: plain text. OpenCode has no permission-decision channel — its plugin
 *    blocks by throwing, with the message shown to the agent — so the message is assembled
 *    here, in typed code, rather than in a committed .js file no type-checker covers. */
async function cmdHook(p: ParsedArgs): Promise<number> {
  const opencode = p.flags.opencode === true;
  if (!opencode && p.flags["claude-code"] !== true && p.flags.codex !== true) {
    console.error("ultra11y hook: expected `hook --claude-code`, `--codex` or `--opencode` (the payload is read on stdin).");
    return 2;
  }
  try {
    const decision = decide(JSON.parse(await readStdin()) as PreToolUsePayload);
    if (!decision) return 0;
    const out = decision.hookSpecificOutput;
    process.stdout.write(opencode ? `${out.permissionDecisionReason}\n\n${out.additionalContext}` : JSON.stringify(decision));
  } catch {
    /* unreadable payload, engine failure — stay silent rather than break a git flow */
  }
  return 0;
}

const TARGET_FLAGS = "--claude-code | --codex | --opencode | --agents-md | --all";

/** `install --<harness>` — wire the automatic review into an agent on this machine.
 *
 *  The native route is better where it exists (`/plugin install` on Claude Code,
 *  `codex plugin add` on Codex): a plugin carries the skills and the hook together and
 *  updates as one thing. This exists for what a plugin cannot do — wiring the gate for an
 *  npm install, and the AGENTS.md fallback on harnesses with no plugin system at all. */
function cmdInstall(p: ParsedArgs): number {
  const targets = parseTargets(p.flags);
  if (!targets) {
    console.error(`ultra11y install: pick at least one target: ${TARGET_FLAGS}`);
    console.error("  --all covers the agent harnesses; --agents-md is separate because it writes a tracked file into your repository.");
    return 2;
  }
  const dryRun = p.flags["dry-run"] === true;
  // --dry-run on the AGENTS.md target prints the block itself: it is the one output a user
  // may want to paste elsewhere (CLAUDE.md, GEMINI.md, .cursor/rules) by hand.
  if (dryRun && targets.includes("agents-md")) {
    console.log(agentsMdBlock(repoRoot() ?? process.cwd()));
    if (targets.length === 1) return 0;
  }
  // OpenCode 1 and 2 load the plugin from different directories; detected unless given.
  const oc = parseOpencodeMajorFlag(p.flags["opencode-version"]);
  if (oc.error) {
    console.error(`ultra11y install: ${oc.error}`);
    return 2;
  }
  const results = installForTargets({
    targets,
    project: p.flags.project === true,
    dryRun,
    skills: p.flags["no-skills"] !== true,
    opencodeVersion: oc.major,
  });
  return reportInstall(results, dryRun ? "would wire" : "wired");
}

function cmdUninstall(p: ParsedArgs): number {
  const targets = parseTargets(p.flags);
  if (!targets) {
    console.error(`ultra11y uninstall: pick at least one target: ${TARGET_FLAGS}`);
    return 2;
  }
  return reportInstall(uninstallForTargets({ targets, project: p.flags.project === true }), "removed");
}

/** Shared printer. Exit 0 when every target succeeded, 1 when some did not — so a script
 *  can tell "wired three of three" from "wired two and one is broken". */
function reportInstall(results: ReturnType<typeof installForTargets>, verb: string): number {
  let failed = 0;
  for (const r of results) {
    if (r.error) {
      failed++;
      console.error(`ultra11y: ${r.error}`);
      continue;
    }
    const changed = r.reports.filter((x) => x.changed);
    if (changed.length === 0) console.log(`ultra11y ${r.target}: already ${verb} (nothing to do)`);
    for (const x of changed) console.log(`ultra11y ${r.target}: ${verb} ${x.path}${x.backup ? ` (backed up to ${x.backup})` : ""}`);
    for (const g of r.guidance) console.log(`  ${g}`);
  }
  return failed ? 1 : 0;
}

/** The browser executable the caller named, if any: `--browser-path` first, then the
 *  `ULTRA11Y_BROWSER_PATH` environment variable — the form a runner image or an orchestrator
 *  sets once for every engine call. Read in ONE place so `status --browser` and `scan` answer
 *  from the same choice; `scan-local.ts` only ever sees the resolved value. */
export function browserPathOf(flags: Record<string, string | boolean>, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (typeof flags["browser-path"] === "string" && flags["browser-path"]) return flags["browser-path"] as string;
  const fromEnv = env.ULTRA11Y_BROWSER_PATH;
  return typeof fromEnv === "string" && fromEnv.trim() ? fromEnv.trim() : undefined;
}

/** `status` — the doctor. Answers "is the automatic review actually going to fire?", which
 *  is otherwise invisible until a commit that should have been stopped goes through. */
function cmdStatus(p: ParsedArgs): number {
  const rows = statusReport({ project: p.flags.project === true });
  // --browser: CAN THE SCAN TIER RUN HERE? Asked of the engine, answered by the very function
  // `scan --runtime local` acts on (`localTierStatus`), so a caller that branches on this
  // cannot end up disagreeing with the command it is branching for. A second implementation
  // of "does Playwright resolve?" — in a shell script, say — is a second answer.
  //
  // Opt-in, because resolving two packages and stat-ing a browser binary is work the harness
  // doctor has no reason to do. Exit code stays 0 either way: this is a QUESTION, and a doctor
  // that exits non-zero is one nobody can put in an `if`.
  const browser =
    p.flags.browser === true
      ? localTierStatus(typeof p.flags.cwd === "string" && p.flags.cwd ? p.flags.cwd : ".", { browserPath: browserPathOf(p.flags) })
      : undefined;
  // The axe-core build `scan` and `ultra11y/playwright` would inject from here (src/axe-engine.ts).
  const axe = browser ? axeStatus(typeof p.flags.cwd === "string" && p.flags.cwd ? p.flags.cwd : ".") : undefined;
  if (p.flags.json === true) {
    console.log(JSON.stringify({ version: VERSION, targets: rows, ...(browser ? { browser } : {}), ...(axe ? { axe } : {}) }, null, 2));
    return 0;
  }
  console.log(`ultra11y ${VERSION}`);
  for (const r of rows) {
    console.log(`  ${r.target.padEnd(12)} ${r.wired ? "wired    " : "not wired"}  ${r.path}`);
    if (r.note) console.log(`  ${"".padEnd(12)} ${r.note}`);
  }
  if (browser) {
    console.log(
      `  ${"browser".padEnd(12)} ${browser.ok ? "available" : "unavailable"}  ${browser.ok ? "@playwright/test + @axe-core/playwright" : browser.reason}`,
    );
  }
  if (axe) console.log(`  ${"axe-core".padEnd(12)} ${axe.ok ? `${axe.version} (${axe.origin})` : "unavailable"}  ${axe.ok ? axe.path : axe.reason}`);
  return 0;
}

/** Which axe-core the browser tiers would run from `cwd`: ultra11y's pinned copy, or the project's. */
function axeStatus(cwd: string): { ok: true; version: string; origin: string; path: string } | { ok: false; reason: string } {
  try {
    const e = resolveAxeEngine({ cwd });
    return { ok: true, version: e.version, origin: e.origin, path: e.sourcePath };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function cmdCriteria(p: ParsedArgs): number {
  // --generate: emit the bundled WCAG references/criteria.md (no trailing newline; the
  // shell redirect / committed file owns that). Used by `pnpm run build:criteria`.
  if (p.flags.generate === true) {
    process.stdout.write(renderCriteriaReference());
    return 0;
  }
  const standard = stdOf(p, "criteria");
  if (standard === null) return 2;
  const themeFlag = p.flags.theme;
  return runCriteria({
    id: p.positionals[0],
    theme: typeof themeFlag === "string" && themeFlag ? Number(themeFlag) : undefined,
    list: p.flags.list === true,
    plan: p.flags.plan === true,
    json: p.flags.json === true,
    lang: resolveLang(p.flags, { standard }),
    standard,
    ...(p.flags.glossary !== undefined ? { glossary: p.flags.glossary } : {}),
  });
}

async function cmdReport(p: ParsedArgs): Promise<number> {
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error("ultra11y report: --in <audit.json> is required ('-' for stdin).");
    return 2;
  }
  const standard = stdOf(p, "report");
  if (standard === null) return 2;
  const raw = inFlag === "-" ? await readStdin() : readInputFile(inFlag, "report", "--in");
  if (raw === null) return 2;
  let result: unknown;
  try {
    result = unwrapAudit(JSON.parse(raw));
  } catch {
    console.error("ultra11y report: --in is not valid JSON (expected an AuditResult).");
    return 2;
  }
  if (!isCurrentAudit(result)) {
    console.error("ultra11y report: input is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
    return 2;
  }
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : "audits";
  const lang = resolveLang(p.flags, { audit: result, standard });

  // `report` renders documents only (Markdown, --html). The CI renderings (--format
  // sarif|github) were removed: CI runs through iterion's rgaa-audit bot, which reads the JSON.
  if (p.flags.format !== undefined) {
    console.error(`ultra11y report: --format is not supported (got "${String(p.flags.format)}"); report writes Markdown, or HTML with --html.`);
    return 2;
  }

  // THE EVIDENCE TIER, before anything is rendered — because BOTH deliverables read it. The
  // crops are written once into `<out>/assets/<page>/`; the Markdown report references them
  // as files and the composite inlines the same bytes as data: URIs, because only the
  // composite has to travel alone. Rendering the Markdown first is what left those files
  // referenced by no document at all while the composite carried a second copy of each.
  const manifest = p.flags.evidence === true ? writeEvidence(result, { outDir: out, ...evidenceCapsOf(p) }) : undefined;
  if (manifest) {
    for (const line of evidenceNotice(manifest, null, lang)) console.error(line);
  }
  const cropFor = manifest
    ? (f: Finding) => {
        const c = manifest.crops.get(findingId(f));
        return c ? { href: c.href, alt: c.alt[lang] } : undefined;
      }
    : undefined;

  const { path, annexPath } = writeReportFiles(result, { out, lang, standard, ...(cropFor ? { cropFor } : {}) });
  // The HTML tier: the artifact's front door plus the detachable, printable composite. Written
  // beside the Markdown, in the same `--out`, so the directory stays one self-contained root.
  let html: ReturnType<typeof writeHtml> | undefined;
  if (p.flags.html === true) {
    html = emitHtml(result, { outDir: out, standard, lang, ...(manifest ? { evidence: manifest } : {}), inlineBudget: budgetOf(p) });
  }
  // Partial-audit advisory (owner decision): a pack (RGAA) report whose scan coverage
  // leaves needs-rendering criteria untested — warn prominently on the CLI, naming exactly
  // which criteria lack a dynamic verdict (the report itself carries the matching banner).
  // Scan stays opt-in but strongly advised.
  // The SAME list the document prints (#100): before, the CLI ignored the verdicts the pack grid
  // rules on and contradicted the report it had just written.
  const untested = isCore(standard) ? [] : packPartialAudit(result, standard);
  const partial = untested.length > 0;
  if (partial && !p.flags.json) console.error(`🚨 ${partialAuditBanner(lang, untested, { scanned: ranBrowser(result) })}`);
  // The rate the document headlines, never another one (#116): a pack report prints its own
  // conformity rate (validated ÷ applicable) over its own grid, not the WCAG core's
  // `conformancePct`. Its operands travel with it — and `null`, not 100, when nothing is
  // applicable, as the report itself refuses to print « 100 % (0 ÷ 0) ».
  const rates = isCore(standard) ? undefined : packReportRates(result, loadPack(standard));
  if (p.flags.json)
    console.log(
      JSON.stringify(
        {
          path,
          annexPath,
          conformancePct: rates ? (rates.conformance.applicable === 0 ? null : rates.conformance.pct) : result.conformancePct,
          ...(rates ? { conformance: rates.conformance, automaticPct: rates.automatic.pct, automatic: rates.automatic } : {}),
          date: result.date,
          // The resolved key (`--standard RGAA` → "rgaa"), never the raw flag.
          standard,
          ...(html ? { htmlPath: html.index, htmlSinglePath: html.composite } : {}),
          ...(partial ? { partialAudit: true, untestedCriteria: untested } : {}),
        },
        null,
        2,
      ),
    );
  else console.log(path);
  // Images degrade, non-conformities never — but a composite that could not carry ONE
  // illustration is a degraded deliverable, and the caller is told with an exit code rather
  // than a line it may not be reading.
  return html?.imagesDropped ? 1 : 0;
}

async function cmdPrd(p: ParsedArgs): Promise<number> {
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error("ultra11y prd: --in <audit.json> is required ('-' for stdin).");
    return 2;
  }
  const standard = stdOf(p, "prd");
  if (standard === null) return 2;
  const raw = inFlag === "-" ? await readStdin() : readInputFile(inFlag, "prd", "--in");
  if (raw === null) return 2;
  let result: unknown;
  try {
    result = unwrapAudit(JSON.parse(raw));
  } catch {
    console.error("ultra11y prd: --in is not valid JSON (expected an AuditResult).");
    return 2;
  }
  if (!isCurrentAudit(result)) {
    console.error("ultra11y prd: input is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
    return 2;
  }
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : "audits";
  const lang = resolveLang(p.flags, { audit: result, standard });
  const split = p.flags.split === "criterion" ? "criterion" : undefined;
  const format: PrdFormat = p.flags.format === "doc" ? "doc" : "audit";
  // Technical ticket sections (Partie technique + Contexte de reproduction) are ON by default;
  // `--no-technical` suppresses them for a pure-auditor consumption of the audit block.
  const technical = p.flags["no-technical"] !== true;
  const paths = writePrd(result, { out, lang, split, format, standard, technical });
  const json = p.flags.json === true;
  if (!json) for (const path of paths) console.log(path);

  // `prd` writes MARKDOWN. It files nothing: ticket creation is `ultra11y tickets`, which
  // reads the same audit.json and writes no markdown. That split is deliberate — you could
  // not previously push without also producing a document, nor produce a document without
  // risking a push.
  if (json) console.log(JSON.stringify({ paths, units: prdUnits(result, standard, lang) }, null, 2));
  return 0;
}

const CI_NOTE = "CI runs through iterion's rgaa-audit bot (https://github.com/SocialGouv/iterion/tree/main/bots/rgaa-audit)";
const TICKETS_V3 = "removed in v3 — ticket creation is now its own command. Use:";

/** Flags that USED to exist, mapped to the message that names what replaces them. Checked
 *  before the generic unknown-flag warning so a removal is loud on the first run, not
 *  discovered later from an empty tracker or a green job that gated nothing. */
export const REMOVED_FLAGS: Record<string, string> = {
  "gh-issues": `${TICKETS_V3} ultra11y tickets --in <audit.json> --provider github --grain criterion`,
  "gh-single": `${TICKETS_V3} ultra11y tickets --in <audit.json> --provider github --grain single`,
  // The tracker-agnostic export moved WITH ticket filing: `tickets --out` writes the same
  // envelope (and a superset of the payload) at any grain, so an orchestrator still reads
  // one stable path — just not from the command that renders documents.
  "issues-json": `${TICKETS_V3} ultra11y tickets --in <audit.json> --out <dir> --grain criterion`,
  // The CI-only surfaces, removed when ultra11y refocused on the skill.
  lite: `removed with audit --lite (the rendered regression gate). ${CI_NOTE}.`,
  baseline: `removed (the baseline regression gate). Gate with --fail-on, or wire init --hook; ${CI_NOTE}.`,
  "write-baseline": `removed with audit --lite. ${CI_NOTE}.`,
  "baseline-approximate": `removed with audit --lite. ${CI_NOTE}.`,
  "require-sampled": `removed with the affected command. ${CI_NOTE}.`,
  ci: `removed: init no longer writes a workflow. ${CI_NOTE}.`,
  e2e: "removed: use the ultra11y/playwright or ultra11y/cypress package exports to check pages during an E2E run.",
  diff: "removed with pages --diff (the comparison against an imported external audit).",
  docker: "removed with the Docker runtime: scan runs on the local Playwright (pass --cwd <dir> to resolve it from a project).",
  clean: "removed with the Docker runtime: there is no image to clean.",
  // The render paths that left the rendering to the project, replaced by ultra11y's own engine.
  scaffold:
    "removed: ultra11y renders the components itself. Run `ultra11y render [<dir>]` — it finds the components, pages and stories and renders them with the project's own react-dom/server.",
  setup:
    "removed with the test-render capture harvester: ultra11y no longer reads or runs the project's tests. Run `ultra11y render [<dir>]`, ultra11y's own render engine.",
};

/** Flag VALUES that used to exist, mapped to what replaces them — same reason as
 *  REMOVED_FLAGS: the flag itself is still valid on some command, so a removed value would
 *  otherwise only earn the generic "using the default" warning and a green exit. Keyed by
 *  flag, then value. Checked before dispatch, so a value listed here must be valid on NO
 *  command any more. */
export const REMOVED_FLAG_VALUES: Record<string, Record<string, string>> = {
  format: {
    sarif: `removed with the CI renderings (audit/report --format sarif|github). ${CI_NOTE}, which reads the JSON — get it with audit --json.`,
    github: `removed with the CI renderings (audit/report --format sarif|github). ${CI_NOTE}, which reads the JSON — get it with audit --json.`,
    remediation:
      "removed with the remediation backlog. Write the backlog with `ultra11y prd --in <audit.json>` (--format audit|doc), and file tickets with `ultra11y tickets --in <audit.json>`.",
  },
};

/** Commands that USED to exist, mapped to what replaces them — same reason as REMOVED_FLAGS:
 *  a script calling one must fail with a pointer, not a bare "unknown command". */
export const REMOVED_COMMANDS: Record<string, string> = {
  mcp: "the MCP server was removed. Look criteria up with `ultra11y criteria`, and drive the engine through the CLI or the skill.",
  dev: "the dev side-car was removed. Check pages during your tests with the ultra11y/playwright or ultra11y/cypress package exports.",
  judge:
    "the headless judge was removed. The agent adjudicates through `verify --manual` / `verify --apply` (fanned out with `orchestrate`); in CI, iterion's rgaa-audit bot does.",
  affected: `the diff-to-pages selector was removed. ${CI_NOTE}.`,
  import: "importing an external audit (and pages --diff) was removed.",
  capture:
    "`capture write` was removed with the ultra11y/vitest and ultra11y/jest helpers: ultra11y no longer reads or runs the project's tests. Run `ultra11y render [<dir>]`, ultra11y's own render engine.",
};

/** Config keys that must NEVER appear in `.ultra11yrc.json` — a committed credential is a
 *  leaked credential. Named explicitly rather than pattern-matched, so the error can say what
 *  to do instead. */
const SECRET_CONFIG_KEYS = ["token", "apiToken", "api_token", "password", "secret"];

async function cmdTickets(p: ParsedArgs): Promise<number> {
  const standard = stdOf(p, "tickets");
  if (standard === null) return 2;
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error("ultra11y tickets: --in <audit.json> is required ('-' for stdin). Run `audit --out` first.");
    return 2;
  }
  const raw = inFlag === "-" ? await readStdin() : readInputFile(inFlag, "tickets", "--in");
  if (raw === null) return 2;
  let result: unknown;
  try {
    result = unwrapAudit(JSON.parse(raw));
  } catch {
    console.error("ultra11y tickets: --in is not valid JSON (expected an AuditResult).");
    return 2;
  }
  if (!isCurrentAudit(result)) {
    console.error("ultra11y tickets: input is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
    return 2;
  }
  const lang = resolveLang(p.flags, { audit: result, standard });
  const fr = lang === "fr";
  const json = p.flags.json === true;
  const dryRun = p.flags["dry-run"] === true;

  let config: Ultra11yConfig["tickets"];
  try {
    config = loadConfig(process.cwd())?.tickets;
  } catch (e) {
    console.error(`ultra11y tickets: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  for (const key of SECRET_CONFIG_KEYS) {
    if (config && key in (config as Record<string, unknown>)) {
      console.error(
        `ultra11y tickets: .ultra11yrc.json must not carry a "${key}" — credentials belong in the environment (see references/tickets.md). Remove it and rotate that value.`,
      );
      return 2;
    }
  }

  // --- usage, before any I/O --------------------------------------------------------------
  // Everything decidable from the argv alone is decided HERE, ahead of provider resolution.
  // Resolving a provider spawns `git config --get remote.origin.url`, and an `auto`
  // transport probes `gh`/`glab auth status` — which reaches the network. A mistyped
  // `--grain` should never cost a subprocess, let alone a network round-trip, and the error
  // the caller gets should name what they typed rather than a tracker they never mentioned.
  //
  // It was also a real flake: `tickets --grain nope` spent its whole 5s test budget in those
  // probes on a loaded CI runner, and the release gate went red on a purely syntactic error.
  const grainFlag = typeof p.flags.grain === "string" ? (p.flags.grain as string) : (config?.grain ?? "criterion");
  if (!(ALL_GRAINS as readonly string[]).includes(grainFlag)) {
    console.error(`ultra11y tickets: --grain must be one of ${ALL_GRAINS.join("|")} (got "${grainFlag}").`);
    return 2;
  }
  const transportFlag = typeof p.flags.transport === "string" ? (p.flags.transport as string) : (config?.transport ?? "auto");
  if (!["auto", "cli", "rest"].includes(transportFlag)) {
    console.error(`ultra11y tickets: --transport must be auto, cli or rest (got "${transportFlag}").`);
    return 2;
  }
  const maxTickets = Number.parseInt(String(p.flags["max-tickets"] ?? config?.maxTickets ?? 200), 10);
  if (!Number.isFinite(maxTickets) || maxTickets < 1) {
    console.error("ultra11y tickets: --max-tickets must be a positive integer.");
    return 2;
  }

  // --- provider ---------------------------------------------------------------------------
  const providerFlag = typeof p.flags.provider === "string" ? (p.flags.provider as string) : "auto";
  const providerId = providerFlag === "auto" ? autoProvider(process.env, config?.provider) : isProviderId(providerFlag) ? providerFlag : undefined;
  if (!providerId) {
    console.error(
      providerFlag === "auto"
        ? "ultra11y tickets: could not tell which tracker to file into — pass --provider github|gitlab|jira (Jira is never auto-detected: it owns no git remote)."
        : `ultra11y tickets: --provider "${providerFlag}" is not one of ${ALL_PROVIDERS.join("|")}.`,
    );
    return 2;
  }

  const provider = createProvider(providerId, { transport: transportFlag as TransportMode });

  // --- the plan ---------------------------------------------------------------------------
  const plan = buildTickets(result, {
    grain: grainFlag as TicketGrain,
    standard,
    lang,
    bodyLimit: provider.capabilities.bodyLimit,
    baseDir: process.cwd(),
    technical: p.flags["no-technical"] !== true,
  });

  if (plan.error === "no-pages") {
    console.error(
      fr
        ? "ultra11y tickets : aucune page dans le périmètre. Capturez des instantanés (ultra11y/playwright ou ultra11y/cypress) ou scannez un échantillon (scan --sample) avant d'utiliser --grain page."
        : "ultra11y tickets: no page in scope. Capture snapshots (ultra11y/playwright or ultra11y/cypress) or scan a sample (scan --sample) before using --grain page.",
    );
    return 1;
  }

  // A creation is hard to undo, and `page-criterion` on a large audit runs to the hundreds.
  // Refuse rather than flood somebody's tracker; never silently truncate.
  if (plan.tickets.length > maxTickets) {
    console.error(
      fr
        ? `ultra11y tickets : ${plan.tickets.length} tickets pour --grain ${grainFlag}, au-delà de la limite de ${maxTickets}. Relancez avec --max-tickets ${plan.tickets.length}, un grain plus grossier, ou --dry-run pour inspecter.`
        : `ultra11y tickets: ${plan.tickets.length} tickets for --grain ${grainFlag}, past the limit of ${maxTickets}. Re-run with --max-tickets ${plan.tickets.length}, a coarser grain, or --dry-run to inspect.`,
    );
    return 2;
  }

  // `--out` writes the tracker-agnostic SET to a stable path, for a workflow engine that
  // files the items itself. It is not a document — it is the ticket payload — which is why
  // it lives here rather than on `prd`. Writing it never files anything.
  const ticketsOut = typeof p.flags.out === "string" && p.flags.out ? (p.flags.out as string) : undefined;
  let setPath: string | undefined;
  if (ticketsOut) {
    mkdirSync(ticketsOut, { recursive: true });
    setPath = join(ticketsOut, `issues-${result.date}.json`);
    const payload: TicketSetFile = {
      tool: "ultra11y",
      kind: "issues",
      schemaVersion: TICKET_SET_SCHEMA_VERSION,
      standard,
      grain: grainFlag as TicketGrain,
      date: result.date,
      count: plan.tickets.length,
      issues: plan.tickets,
    };
    writeFileSync(setPath, `${JSON.stringify(payload, null, 2)}\n`);
    if (!json) console.log(setPath);
  }

  if (!plan.tickets.length) {
    if (!json)
      console.log(
        fr
          ? "ultra11y tickets : rien à déposer — l'audit ne relève aucune non-conformité."
          : "ultra11y tickets: nothing to file — the audit found no non-conformity.",
      );
    if (json)
      console.log(
        JSON.stringify(
          {
            provider: providerId,
            transport: provider.transport,
            grain: grainFlag,
            standard,
            dryRun,
            ...(setPath ? { setPath } : {}),
            tickets: [],
            unattributed: plan.unattributed,
            result: { created: 0, skipped: 0, failed: 0, createdTitles: [], createdUrls: [], errors: [] },
          },
          null,
          2,
        ),
      );
    return 0;
  }

  // A push command that files nothing and reports green is a silent failure — unlike the old
  // `prd --gh-issues`, whose push was an optional extra on top of a document.
  if (!provider.available() && !dryRun) {
    console.error(`ultra11y tickets: ${providerId} is not usable here — ${provider.unavailableReason()}.`);
    return 1;
  }

  const { plan: planned, result: pushed, dedupeChecked } = await pushTickets(plan.tickets, provider, { dryRun: dryRun || !provider.available() });

  if (json) {
    console.log(
      JSON.stringify(
        {
          provider: providerId,
          transport: provider.transport,
          grain: grainFlag,
          standard,
          dryRun,
          ...(setPath ? { setPath } : {}),
          dedupeChecked,
          tickets: planned.map(({ ticket, action }) => ({
            title: ticket.title,
            labels: ticket.labels,
            severity: ticket.severity,
            advisory: ticket.advisory,
            scope: ticket.scope,
            bodyChars: ticket.body.length,
            action,
            // The body rides along ONLY under --dry-run: an agent inspecting the plan wants
            // it, a 200-ticket push payload does not.
            ...(dryRun ? { body: ticket.body } : {}),
          })),
          unattributed: plan.unattributed,
          result: pushed,
        },
        null,
        2,
      ),
    );
  } else if (dryRun || !provider.available()) {
    const create = planned.filter((x) => x.action === "create").length;
    console.log(
      fr
        ? `ultra11y tickets : simulation (${providerId}/${provider.transport}, grain ${grainFlag}) — ${create} à créer, ${pushed.skipped} déjà présent(s).`
        : `ultra11y tickets: dry run (${providerId}/${provider.transport}, grain ${grainFlag}) — ${create} to create, ${pushed.skipped} already there.`,
    );
    for (const { ticket, action } of planned) console.log(`  ${action === "create" ? "+" : "="} ${ticket.title}`);
    if (!dedupeChecked)
      console.error(
        fr
          ? "ultra11y tickets : l'existant n'a pas pu être listé — le compte « déjà présent » n'est pas vérifié."
          : 'ultra11y tickets: could not list existing tickets — the "already there" count is unverified.',
      );
    if (!provider.available()) console.error(`ultra11y tickets: ${providerId} — ${provider.unavailableReason()}.`);
  } else {
    console.log(
      fr
        ? `ultra11y tickets : ${providerId} — ${pushed.created} créé(s), ${pushed.skipped} déjà présent(s)${pushed.failed ? `, ${pushed.failed} en échec` : ""}.`
        : `ultra11y tickets: ${providerId} — ${pushed.created} created, ${pushed.skipped} already there${pushed.failed ? `, ${pushed.failed} failed` : ""}.`,
    );
    for (const u of pushed.createdUrls) console.log(`  ${u}`);
    for (const e of pushed.errors) console.error(fr ? `ultra11y tickets : échec — ${e}` : `ultra11y tickets: failed — ${e}`);
    if (plan.unattributed) {
      console.error(
        fr
          ? `ultra11y tickets : ${plan.unattributed} constat(s) non rattaché(s) à une page — déposés dans leur propre ticket, jamais répartis d'office.`
          : `ultra11y tickets: ${plan.unattributed} finding(s) attributed to no page — filed as their own ticket, never spread.`,
      );
    }
  }
  return pushed.failed > 0 ? 1 : 0;
}

async function cmdRender(p: ParsedArgs): Promise<number> {
  const root = p.positionals[0] ?? ".";
  const lang = resolveLang(p.flags, {}); // render has no --standard and no audit in hand

  if (p.flags.storybook === true || typeof p.flags.storybook === "string") {
    const sbDir = p.positionals[0] ?? "storybook-static";
    const indexPath = existsSync(join(sbDir, "index.json")) ? join(sbDir, "index.json") : join(sbDir, "stories.json");
    if (!existsSync(indexPath)) {
      console.error(
        lang === "fr"
          ? `ultra11y render : aucun index Storybook (index.json/stories.json) dans ${sbDir}.`
          : `ultra11y render: no Storybook index (index.json/stories.json) in ${sbDir}.`,
      );
      return 1;
    }
    const stories = parseStorybookIndex(readText(indexPath));
    const provById = new Map(stories.map((s) => [s.id, storyProvenance(s)] as const));
    const capturesFlag = typeof p.flags.captures === "string" && p.flags.captures ? p.flags.captures : undefined;
    const htmlDir = capturesFlag ?? sbDir;
    const htmlFiles = existsSync(htmlDir) ? discover([htmlDir]).files.filter((f) => /\.html?$/i.test(f)) : [];
    const outDir = ".ultra11y/captures";
    let attributed = 0;
    let skipped = 0;
    for (const f of htmlFiles) {
      const raw = readText(f);
      if (parseCaptureProvenance(raw)) {
        skipped++; // already attributed (its own provenance wins)
        continue;
      }
      const base = f.replace(/^.*[/\\]/, "").replace(/\.html?$/i, "");
      // Match the file to a story: exact basename, else the LONGEST story id that is a
      // boundary-suffix of the basename (so one id never matches inside another's).
      let hitId = provById.has(base) ? base : undefined;
      if (!hitId) {
        const cands = stories
          .filter((s) => s.id && base.endsWith(s.id) && (base.length === s.id.length || /[^a-z0-9]/i.test(base[base.length - s.id.length - 1] ?? "")))
          .sort((a, b) => b.id.length - a.id.length);
        hitId = cands[0]?.id;
      }
      const prov = hitId ? provById.get(hitId) : undefined;
      if (!prov?.sourceFile) {
        skipped++;
        continue;
      }
      try {
        mkdirSync(outDir, { recursive: true });
        // Name the output by the unique story id (not the flattened basename) so two
        // story files with the same basename in different dirs never clobber.
        writeFileSync(join(outDir, `${hitId}.html`), `${formatCaptureComment(prov)}\n${raw}${raw.endsWith("\n") ? "" : "\n"}`);
        attributed++;
      } catch {
        skipped++;
      }
    }
    // Honest failure: HTML candidates existed (a bare `storybook build` output, e.g. the
    // iframe/index shell) but NONE could be attributed to a story — a plain static build
    // never emits per-story HTML on its own, so silently exiting 0 here would look like
    // success. 0 candidates at all (nothing under htmlDir) stays exit 0 — there was
    // simply nothing to attribute, a different situation from "tried and failed".
    const remedy =
      lang === "fr"
        ? `Aucun HTML de story attribuable dans ${htmlDir}. Rendez les stories avec le moteur ultra11y (\`render\`), ou produisez le HTML par story (@storybook/test-runner) et pointez --captures <dir>.`
        : `No attributable per-story HTML in ${htmlDir}. Render the stories with ultra11y's engine (\`render\`), or produce per-story HTML (@storybook/test-runner) and point --captures <dir>.`;
    const failed = attributed === 0 && htmlFiles.length > 0;
    if (p.flags.json) console.log(JSON.stringify({ attributed, skipped, stories: stories.length, outDir, ...(failed ? { remedy } : {}) }, null, 2));
    else
      console.log(
        lang === "fr"
          ? `Storybook : ${attributed} capture(s) attribuée(s), ${skipped} ignorée(s) → ${outDir} (${stories.length} stories)`
          : `Storybook: ${attributed} capture(s) attributed, ${skipped} skipped → ${outDir} (${stories.length} stories)`,
      );
    if (failed) {
      console.error(remedy);
      return 1;
    }
    return 0;
  }
  if (p.flags.coverage === true) {
    const capturesFlag = typeof p.flags.captures === "string" && p.flags.captures ? p.flags.captures : undefined;
    const capturesDir = capturesFlag ?? join(root, ".ultra11y/captures");
    // Widen to GRAPH_ONLY_EXT (.ts/.js/.mjs/.cjs) so a barrel/plain-JS module resolves
    // cross-file too — same rule as audit --graph (see src/audit.ts).
    const graphExt = [...GRAPH_ONLY_EXT, ...(asList(p.flags.ext) ?? [])];
    const sourceFiles = discover([root], { include: asList(p.flags.include), exclude: asList(p.flags.exclude), ext: graphExt }).files;
    const graph = buildGraphStreaming(sourceFiles);
    const capFiles = existsSync(capturesDir) ? discover([capturesDir]).files : [];
    const entries: CaptureEntry[] = capFiles.map((f) => ({ file: toPosix(f), provenance: parseCaptureProvenance(readText(f)) }));
    const cov = computeCaptureCoverage(graph, entries);
    if (p.flags.json) console.log(JSON.stringify(cov, null, 2));
    else console.log(captureCoverageSummary(cov, lang));
    return 0;
  }
  if (p.flags.detect !== true) return cmdRenderEngine(p, root, lang);
  let deps: Record<string, string> = {};
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readText(pkgPath)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    } catch {
      /* not fatal — detection just sees no deps */
    }
  }
  const detection: Detection = detectFrameworks(deps, (f) => existsSync(join(root, f)));
  if (p.flags.json) console.log(JSON.stringify(detection, null, 2));
  else console.log(renderPlan(detection, lang));
  return 0;
}

/** `render [<dir>]` — ultra11y's own render engine (src/render-engine.ts). */
async function cmdRenderEngine(p: ParsedArgs, root: string, lang: Lang): Promise<number> {
  const fr = lang === "fr";
  if (!existsSync(root)) {
    console.error(fr ? `ultra11y render : dossier introuvable : ${root}.` : `ultra11y render: no such directory: ${root}.`);
    return 2;
  }
  const tFlag = p.flags.transpiler;
  if (tFlag !== undefined && !(typeof tFlag === "string" && (TRANSPILERS as readonly string[]).includes(tFlag))) {
    console.error(`ultra11y render: --transpiler must be ${TRANSPILERS.join("|")} (got "${String(tFlag)}").`);
    return 2;
  }
  const timeoutRaw = p.flags.timeout;
  const timeoutMs = typeof timeoutRaw === "string" ? Number(timeoutRaw) : DEFAULT_RENDER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`ultra11y render: --timeout must be a positive number of milliseconds (got "${String(timeoutRaw)}").`);
    return 2;
  }
  const manifest = await runRenderEngine({
    root,
    timeoutMs,
    ...(typeof tFlag === "string" ? { transpiler: tFlag as TranspilerName } : {}),
    include: asList(p.flags.include),
    exclude: asList(p.flags.exclude),
    stories: p.flags["no-stories"] !== true,
    onProgress: p.flags.json ? undefined : (done, total, file) => console.error(`ultra11y render: [${done}/${total}] ${file}`),
  });
  const n = renderCounts(manifest.units);
  // A run with units that rendered none of them fails, so it is never a green no-op: a CI step
  // must see it. The manifest is written either way, and `audit` reports every reason.
  const code = manifest.units.length > 0 && n.rendered === 0 ? 1 : 0;
  if (p.flags.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return code;
  }
  const out: string[] = [];
  out.push(
    fr
      ? `ultra11y render : ${n.rendered} rendu(s), ${n.skipped} échec(s) avec la raison, ${n.notAttempted} non tenté(s) — ${manifest.renderer ?? "aucun moteur de rendu React"}, ${manifest.transpiler ?? "aucun transpileur"}.`
      : `ultra11y render: ${n.rendered} rendered, ${n.skipped} failed with the reason, ${n.notAttempted} not attempted — ${manifest.renderer ?? "no React renderer"}, ${manifest.transpiler ?? "no transpiler"}.`,
  );
  const statusWord: Record<string, string> = fr ? { skipped: "échec", "not-attempted": "non tenté" } : { skipped: "failed", "not-attempted": "not attempted" };
  for (const u of manifest.units) {
    if (u.status === "rendered") continue;
    out.push(
      `  - ${u.file}${u.export === "*" ? "" : `#${u.export}`} — ${statusWord[u.status] ?? u.status}: ${u.reason ? renderReasonLabel(u.reason, lang) : "?"}${u.detail ? ` — ${u.detail}` : ""}`,
    );
  }
  if (manifest.testFilesIgnored)
    out.push(
      fr
        ? `  ${manifest.testFilesIgnored} fichier(s) de test, de mock ou d'instantané laissé(s) de côté sans être lus.`
        : `  ${manifest.testFilesIgnored} test, mock or snapshot file(s) left out, unread.`,
    );
  out.push(
    fr
      ? `→ captures dans ${join(root, CAPTURES_DIR)}, manifeste ${join(root, RENDER_MANIFEST)}. Puis : ultra11y audit (depuis ${root}).`
      : `→ captures in ${join(root, CAPTURES_DIR)}, manifest ${join(root, RENDER_MANIFEST)}. Then: ultra11y audit (from ${root}).`,
  );
  console.log(out.join("\n"));
  if (code)
    console.error(
      fr
        ? `ultra11y render : aucune unité rendue sur ${manifest.units.length} — chaque raison est dans ${join(root, RENDER_MANIFEST)} et dans l'audit.`
        : `ultra11y render: no unit rendered out of ${manifest.units.length} — every reason is in ${join(root, RENDER_MANIFEST)} and in the audit.`,
    );
  return code;
}

function cmdCheck(p: ParsedArgs): number {
  const standard = stdOf(p, "check");
  if (standard === null) return 2;
  // --require-decided gates the AUDIT, not the report: it asks whether every criterion of the
  // active standard carries a verdict. It therefore needs --in and not --report, and stands on
  // its own — a project can demand a complete grid long before it publishes a deliverable.
  // `--require-decided` on its own asks the RUN's grid; `--require-decided pages` also asks
  // every page's. They are different questions: a criterion non-conforming somewhere is settled
  // for the run and may still be nobody's verdict on the pages the failure did not fire on, so
  // a per-page deliverable can be incomplete under a complete run grid. Measured on egapro:
  // 104/106 for the run, 8 to 11 open on each of its 37 pages.
  const decidedFlag = p.flags["require-decided"];
  const requireDecided = decidedFlag === true || decidedFlag === "pages" || decidedFlag === "true";
  const requireDecidedPages = decidedFlag === "pages";
  if (typeof decidedFlag === "string" && decidedFlag !== "pages" && decidedFlag !== "true") {
    console.error(`ultra11y check: --require-decided takes no value, or 'pages' — got '${decidedFlag}'.`);
    return 2;
  }
  // Same reasoning for coverage: whether the sweep captured every declared page is a fact
  // about the working tree, answerable long before there is a deliverable to validate.
  const requireSample = p.flags["require-sample"] === true;
  // And one level below THAT: were the criteria needing a browser given one at all? A
  // property of the audit, like completeness — so it needs `--in`, not a report.
  const requireRendered = p.flags["require-rendered"] === true;
  const rep = p.flags.report;
  if (typeof rep !== "string" || !rep) {
    if (!requireDecided && !requireSample && !requireRendered) {
      console.error("ultra11y check: --report <md> is required.");
      return 2;
    }
  }
  const lang = resolveLang(p.flags, { standard });
  const md = typeof rep === "string" && rep ? readReportInput(rep, "check") : "";
  if (md === null) return 2;
  // --in <audit.json>: enable the pack applicability gate (R1) — re-derive from the audit
  // and fail on any NC criterion the report over-/under-projects.
  let audit: AuditResult | undefined;
  const inFlag = p.flags.in;
  if (typeof inFlag === "string" && inFlag) {
    let rawAudit: string;
    try {
      rawAudit = readText(inFlag);
    } catch {
      console.error(`ultra11y check: --in file not found: ${inFlag}.`);
      return 2;
    }
    try {
      audit = unwrapAudit(JSON.parse(rawAudit)) as AuditResult;
    } catch {
      console.error("ultra11y check: --in file is not valid JSON.");
      return 2;
    }
  }
  if (requireDecided && !audit) {
    console.error("ultra11y check: --require-decided needs --in <audit.json> — completeness is a property of the audit, not of the report.");
    return 2;
  }
  if (requireRendered && !audit) {
    console.error("ultra11y check: --require-rendered needs --in <audit.json> — what a run rendered is a property of the audit, not of the report.");
    return 2;
  }
  // The declared-undecidable list, when one is given. Deliberately a NAMED list rather than a
  // tolerance: a threshold passes whatever it has to in order to stay green, and the criteria
  // it would hide are exactly the ones nobody could decide.
  let allow: UndecidedFile | undefined;
  const allowFlag = p.flags["allow-undecided"];
  if (typeof allowFlag === "string" && allowFlag) {
    try {
      const parsed = JSON.parse(readText(allowFlag)) as unknown;
      if (!isUndecidedFile(parsed)) {
        console.error(`ultra11y check: --allow-undecided file has no "entries" array: ${allowFlag}.`);
        return 2;
      }
      allow = parsed;
    } catch {
      console.error(`ultra11y check: --allow-undecided file not found or not valid JSON: ${allowFlag}.`);
      return 2;
    }
  }
  const decided =
    requireDecided && audit
      ? checkDecided(audit, standard, lang, { allow, pages: requireDecidedPages, allowStale: p.flags["allow-stale-undecided"] === true })
      : null;
  // COVERAGE, one level below completeness: did the run capture every page it says it audits?
  // Needs no audit JSON — it holds the repository's declared sample against the snapshots on
  // disk, which is what a sweep either produced or did not.
  const covered = requireSample ? checkSampleCaptured(".", lang) : null;
  // THE INSTRUMENT, one level below coverage: were the criteria needing a browser given one?
  const renderedGate = requireRendered && audit ? checkRendered(audit, standard, lang, { allow }) : null;
  const res = md ? checkReport(md, standard, lang, { audit }) : { ok: true, issues: [] };
  // --semantic: the support-level gate ON TOP of the structural check. Fails closed —
  // a green exit must always mean the gate engaged (family P0: never green-but-inactive).
  // `--semantic` reads the report, so it only applies when there IS one.
  const sem =
    p.flags.semantic === true && typeof rep === "string" && rep
      ? checkSemantic(md, {
          reportPath: rep,
          verdictsPath: typeof p.flags.verdicts === "string" && p.flags.verdicts ? p.flags.verdicts : undefined,
          standard,
          lang,
        })
      : null;
  const ok =
    res.ok && (sem === null || sem.ok) && (decided === null || decided.ok) && (covered === null || covered.ok) && (renderedGate === null || renderedGate.ok);
  if (p.flags.json) {
    console.log(
      JSON.stringify(
        {
          ...res,
          ok,
          ...(sem ? { semantic: sem } : {}),
          ...(decided ? { decided } : {}),
          ...(covered ? { covered } : {}),
          ...(renderedGate ? { rendered: renderedGate } : {}),
        },
        null,
        2,
      ),
    );
  } else if (!p.flags.quiet) {
    if (decided) {
      // Say what the gate engaged on, green or red. A completeness gate that reports only its
      // failures is one nobody can tell apart from a gate that never ran.
      const allowedNote = decided.allowed.length
        ? lang === "fr"
          ? ` (${decided.allowed.length} critère(s) déclaré(s) indécidable(s) : ${decided.allowed.map((a) => `${a.criteriaId} — ${a.reason}`).join(" · ")})`
          : ` (${decided.allowed.length} criterion(ia) declared undecidable: ${decided.allowed.map((a) => `${a.criteriaId} — ${a.reason}`).join(" · ")})`
        : "";
      if (decided.ok)
        console.log(
          lang === "fr"
            ? `✓ Grille complète : les ${decided.total} critères portent un verdict${allowedNote}.`
            : `✓ Complete grid: all ${decided.total} criteria carry a verdict${allowedNote}.`,
        );
      // WHO SETTLED THEM — printed green OR red, because the question « did all 106 run? » is
      // asked of both outcomes and was until now answered by hand, by counting ledger entries
      // against a worklist. That hand count answers the wrong thing: a criterion the static
      // engine decided appears in neither. It is also the number to watch between runs — every
      // criterion that moves from `agent` to `engine` or `scan` is one nobody pays a model for.
      const pv = decided.provenance;
      console.log(
        lang === "fr"
          ? `  ${pv.total} critères — ${pv.engine} moteur, ${pv.scan} mesure (scan), ${pv.agent} agent, ${pv.human ? `${pv.human} auditeur humain, ` : ""}${pv.declared} déclaré(s) indécidable(s), ${pv.undecided} sans verdict.`
          : `  ${pv.total} criteria — ${pv.engine} engine, ${pv.scan} measured (scan), ${pv.agent} agent, ${pv.human ? `${pv.human} human auditor, ` : ""}${pv.declared} declared undecidable, ${pv.undecided} with no verdict.`,
      );
    }
    if (covered?.ok) {
      // Green or red, say what it engaged on — a gate that reports only its failures cannot be
      // told apart from one that never ran.
      console.log(
        lang === "fr"
          ? `✓ Échantillon couvert : les ${covered.declared} page(s) déclarée(s) ont une capture.`
          : `✓ Sample covered: all ${covered.declared} declared page(s) have a capture.`,
      );
    }
    if (renderedGate?.ok) {
      // Same rule: say what it engaged on. It has two green shapes and they mean different
      // things — pages were rendered, or there was no rendering criterion left to answer for.
      console.log(
        lang === "fr"
          ? `✓ Rendu : ${renderedGate.pagesAudited} page(s) réellement auditée(s) — les critères de rendu ont eu un navigateur.`
          : `✓ Rendered: ${renderedGate.pagesAudited} page(s) actually audited — the rendering criteria were given a browser.`,
      );
    }
    if (ok)
      console.log(
        sem
          ? lang === "fr"
            ? `✓ Rapport valide + gate sémantique engagée : ${sem.total} verdict(s), ${sem.grounded} ancré(s) dans la source${sem.moved ? ` (${sem.moved} déplacé(s))` : ""}.`
            : `✓ Report valid + semantic gate engaged: ${sem.total} verdict(s), ${sem.grounded} grounded in source${sem.moved ? ` (${sem.moved} moved)` : ""}.`
          : lang === "fr"
            ? "✓ Rapport valide : sections, critères cités et justifications NA cohérents."
            : "✓ Report valid: sections, cited criteria and NA justifications are consistent.",
      );
    else
      for (const i of [...res.issues, ...(sem?.issues ?? []), ...(decided?.issues ?? []), ...(covered?.issues ?? []), ...(renderedGate?.issues ?? [])])
        console.error(`✗ ${i}`);
  }
  return ok ? 0 : 1;
}

function cmdVerify(p: ParsedArgs): number {
  if (p.flags.summary === true) return cmdVerifySummary(p);
  // --apply has no --standard/audit in hand — resolved below (post-standard) for the --report path.
  const lang = resolveLang(p.flags, {});
  const apply = p.flags.apply;
  if (typeof apply === "string" && apply) {
    // Read and parse separately so a missing file is not mislabeled as bad JSON.
    let raw: string;
    try {
      raw = readText(apply);
    } catch {
      console.error(`ultra11y verify: --apply file not found: ${apply}.`);
      return 2;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("ultra11y verify: --apply file is not valid JSON.");
      return 2;
    }
    // Dispatch on shape: an OBJECT with kind:"adjudication" is a manual-criteria adjudication
    // (src/adjudicate.ts); kind:"verdict-ledger" is a stored one being REPLAYED (src/ledger.ts,
    // no model in the loop); a plain ARRAY is the classic NC-verdicts worklist.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { kind?: string }).kind === "adjudication") {
      return applyAdjudicationFile(p, parsed as AdjudicationFile, lang);
    }
    if (isLedger(parsed)) {
      return replayLedgerFile(p, parsed, lang);
    }
    if (!Array.isArray(parsed)) {
      console.error("ultra11y verify: --apply must be a JSON array of verdicts, or an adjudication object.");
      return 2;
    }
    const items = parsed as VerifyItem[];
    // Coverage gate (fail closed): --report is REQUIRED — without the report the gate
    // cannot know which NCs the verdicts are supposed to cover, and an empty [] would
    // pass green while covering nothing (family P0: a passing exit must mean the gate
    // engaged). Coverage is re-derived UNCAPPED so NCs beyond the worklist cap can't
    // silently escape adjudication.
    const applyReport = p.flags.report;
    if (typeof applyReport !== "string" || !applyReport) {
      console.error(
        lang === "fr"
          ? "ultra11y verify : --apply exige --report <md> (le rapport que les verdicts couvrent) — sans lui la couverture ne peut pas être établie."
          : "ultra11y verify: --apply requires --report <md> (the report the verdicts cover) — without it coverage cannot be established.",
      );
      return 2;
    }
    const standard = stdOf(p, "verify");
    if (standard === null) return 2;
    const repMd = readReportInput(applyReport, "verify");
    if (repMd === null) return 2;
    // Coverage covers BOTH claim kinds. Rebuilt uncapped from the same two sources the
    // worklist was written from, so a verdicts file that quietly dropped every conformity item
    // fails as `missing` rather than passing green over the half it did adjudicate.
    const expectedNc = buildWorklist(repMd, standard, Number.POSITIVE_INFINITY);
    const trial = conformityTrial(p, standard, lang);
    const expected = [...expectedNc, ...buildConformityWorklist(trial.claims, expectedNc.length, Number.POSITIVE_INFINITY)];
    const r = applyVerdicts(items, expected);
    // WHY IS SOMETHING MISSING? (#59) Two causes, two different remedies: a CAP left the claim
    // out — `--max-verify 0` fixes it — or the list was generated from ANOTHER claim source
    // (no `--in`, another audit, a ledger) — where lifting a cap that was never applied fixes
    // nothing. The context recorded beside the list says which; a list written before it was
    // recorded is read from its own content: one carrying no conformity at all, against an apply
    // that expects some, was not capped into that shape by the default cap.
    const ctx = readVerifyContext(dirname(resolve(apply)));
    const absentItems = r.failures.filter((f) => !items.includes(f));
    const absentC = absentItems.filter((f) => f.kind === "c").length;
    const sourceDiffers = ctx ? !sameConformitySource(ctx.conformities, trial.source) : absentC > 0 && !items.some((it) => it.kind === "c");
    const capCould = ctx ? ctx.capped.nc + ctx.capped.c > 0 : !sourceDiffers;
    const missingCause = r.missing ? (capCould ? "cap" : sourceDiffers ? "source" : "other") : undefined;
    // Content-level grounding of every verdict that passed adjudication: the cited
    // file/line/snippet must still exist and match the source (see src/grounding.ts). A
    // RETAINED CONFORMITY IS GROUNDED THE WAY THE FOLD GROUNDED IT: a citation that is one of
    // its criterion's own harvested anchors falls back to the anchor, so a claim `verify
    // --apply <adjudication>` accepted is not refused again here — on every later trial —
    // for the retyping the fold already forgave.
    const passing = items.filter((it) => typeof it.verdict === "string" && ["supported", "partial"].includes(it.verdict.trim().toLowerCase()));
    const grounding = groundItems(verifyGroundingInputs(passing, trialAnchorFallbacks(p, standard, passing)));
    // --prune: APPLY the outcome instead of only reporting it. See src/refute.ts for why a
    // gate that can only go red is the wrong shape for a cheap adjudicator's run, and for the
    // asymmetry between withdrawing a non-conformity and withdrawing a conformity.
    //
    // The exit code changes with it, and deliberately: a refuted claim has been HANDLED, so it
    // no longer fails the gate. An unadjudicated, missing or invalid one still does — nothing
    // was tried there, and pruning cannot stand in for a trial that never ran.
    const pruned = p.flags.prune === true ? applyPrune(p, standard, items, lang, r.conformitiesUntried) : undefined;
    const ok = (pruned ? r.unadjudicated + r.invalid + r.missing === 0 : r.ok) && grounding.failed === 0;
    // A PARTIAL TRIAL IS NOT A WHOLE ONE. With no conformity source (or one explicitly turned
    // off) only the report's non-conformities were tried; a green exit must not read as covering
    // the audit's conformities too.
    const ncOnly = trial.source.source === "none" || trial.source.source === "disabled";
    if (p.flags.json)
      console.log(
        JSON.stringify(
          { ...r, ok, grounding, conformitySource: trial.source, ...(missingCause ? { missingCause } : {}), ...(pruned ? { pruned } : {}) },
          null,
          2,
        ),
      );
    else if (ok)
      console.log(
        pruned
          ? lang === "fr"
            ? `✓ ${r.total} revendication(s) contre-expertisée(s), retraits appliqués et verdicts conservés ancrés dans la source${grounding.moved ? ` (${grounding.moved} déplacé(s))` : ""}.`
            : `✓ ${r.total} claim(s) reviewed, withdrawals applied, and retained verdicts grounded in source${grounding.moved ? ` (${grounding.moved} moved)` : ""}.`
          : lang === "fr"
            ? `✓ ${r.total} revendication(s) vérifiée(s), toutes étayées et ancrées dans la source${grounding.moved ? ` (${grounding.moved} déplacée(s))` : ""}.`
            : `✓ ${r.total} claim(s) verified, all supported and grounded in source${grounding.moved ? ` (${grounding.moved} moved)` : ""}.`,
      );
    else {
      if (!r.ok)
        console.error(
          lang === "fr"
            ? `✗ ${r.failures.length}/${r.total} en échec (refuted ${r.refuted}, unsupported ${r.unsupported}, non statué ${r.unadjudicated}${r.missing ? `, absent(s) ${r.missing}${capCould ? " — régénérez la worklist avec --max-verify 0" : ""}` : ""}${r.invalid ? `, invalide ${r.invalid}` : ""}).`
            : `✗ ${r.failures.length}/${r.total} failed (refuted ${r.refuted}, unsupported ${r.unsupported}, unadjudicated ${r.unadjudicated}${r.missing ? `, missing ${r.missing}${capCould ? " — regenerate the worklist with --max-verify 0" : ""}` : ""}${r.invalid ? `, invalid ${r.invalid}` : ""}).`,
        );
      if (r.missing && !capCould) {
        const regen = `verify --report ${applyReport} ${trialContextFlags(p, standard, trial.source)} --out <dir>`;
        const was = ctx
          ? describeConformitySource(ctx.conformities, lang)
          : lang === "fr"
            ? "inconnue — la worklist ne porte aucune conformité"
            : "unknown — the worklist carries no conformity";
        console.error(
          sourceDiffers
            ? lang === "fr"
              ? `✗ Couverture : la worklist a été générée avec une autre source de conformités (${was}) que cette application (${describeConformitySource(trial.source, lang)}) — ${absentC} conformité(s) revendiquée(s) n'y figurent pas. --max-verify 0 n'y changera rien : régénérez-la avec \`${regen}\`, puis réappliquez avec ces mêmes options.`
              : `✗ Coverage: the worklist was generated from another conformity source (${was}) than this apply (${describeConformitySource(trial.source, lang)}) — ${absentC} claimed conformity(ies) are not in it. --max-verify 0 will not fix that: regenerate it with \`${regen}\`, then apply with the same options.`
            : lang === "fr"
              ? `✗ Couverture : la worklist n'était pas plafonnée — l'écart vient d'un autre rapport ou d'un autre audit que ceux de cette application. Régénérez-la avec \`${regen}\`.`
              : `✗ Coverage: the worklist was not capped — the gap comes from another report or audit than this apply's. Regenerate it with \`${regen}\`.`,
        );
      }
      // NAME THE REFUSED CONFORMITIES SEPARATELY, because the remedy is a different action.
      // A refuted non-conformity is deleted from the report. A refuted conformity sends its
      // criterion back to « à évaluer » — nobody has established it, which is not the same
      // claim as having established that it fails, and turning one into the other would be
      // the mirror image of the fabrication this gate exists to refuse.
      //
      // AND SAY WHAT ACTUALLY HAPPENED TO THEM. Without --prune nothing is written, so the
      // message names the remedy rather than claiming an effect. With --prune it names the
      // effect `applyPrune` really had (and printed above).
      if (r.conformitiesRefused.length) {
        const ids = [...new Set(r.conformitiesRefused.map((f) => f.criteriaId))].join(", ");
        console.error(
          pruned
            ? lang === "fr"
              ? `✗ ${r.conformitiesRefused.length} conformité(s) revendiquée(s) non étayée(s) — ces critères sont revenus à « à évaluer », ils ne deviennent PAS des non-conformités : ${ids}`
              : `✗ ${r.conformitiesRefused.length} claimed conformity(ies) unsupported — those criteria are back to "to assess", they do NOT become non-conformities: ${ids}`
            : lang === "fr"
              ? `✗ ${r.conformitiesRefused.length} conformité(s) revendiquée(s) non étayée(s) — relancez avec --prune pour renvoyer ces critères à « à évaluer » (ils ne deviennent PAS des non-conformités) : ${ids}`
              : `✗ ${r.conformitiesRefused.length} claimed conformity(ies) unsupported — re-run with --prune to send those criteria back to "to assess" (they do NOT become non-conformities): ${ids}`,
        );
      }
      // A conformity nobody ruled on is a different failure: the trial is INCOMPLETE. Under
      // --prune it is sent back to « to assess » too (src/refute.ts) — a claim that stood no
      // trial must not keep counting as conforming through every later `check`.
      if (r.conformitiesUntried.length) {
        const ids = [...new Set(r.conformitiesUntried.map((f) => f.criteriaId))].join(", ");
        const absent = r.conformitiesUntried.some((f) => !items.includes(f));
        const regen =
          absent && capCould ? (lang === "fr" ? " Régénérez la worklist avec --max-verify 0." : " Regenerate the worklist with --max-verify 0.") : "";
        console.error(
          pruned
            ? lang === "fr"
              ? `✗ ${r.conformitiesUntried.length} conformité(s) revendiquée(s) jamais mise(s) à l'épreuve — renvoyée(s) à « à évaluer » : ${ids}.${regen}`
              : `✗ ${r.conformitiesUntried.length} claimed conformity(ies) never tried — sent back to "to assess": ${ids}.${regen}`
            : lang === "fr"
              ? `✗ ${r.conformitiesUntried.length} conformité(s) revendiquée(s) jamais mise(s) à l'épreuve — la contre-expertise est incomplète : ${ids}.${regen}`
              : `✗ ${r.conformitiesUntried.length} claimed conformity(ies) never tried — the trial is incomplete: ${ids}.${regen}`,
        );
      }
      for (const issue of grounding.issues) console.error(`✗ ${issue}`);
    }
    if (ok && ncOnly && !p.flags.json)
      console.error(
        trial.source.source === "disabled"
          ? lang === "fr"
            ? "ⓘ Contre-expertise des non-conformités uniquement (--no-conformities) : les conformités revendiquées de l'audit n'ont pas été mises à l'épreuve."
            : "ⓘ Trial of non-conformities only (--no-conformities): the audit's claimed conformities were not put on trial."
          : lang === "fr"
            ? "ⓘ Contre-expertise des non-conformités uniquement : aucune source de conformités (ni --in, ni --conformities, ni ledger), les conformités revendiquées de l'audit n'ont pas été mises à l'épreuve. Générez et appliquez avec --in <audit.json> pour les couvrir."
            : "ⓘ Trial of non-conformities only: no conformity source (no --in, --conformities or ledger), so the audit's claimed conformities were not put on trial. Generate and apply with --in <audit.json> to cover them.",
      );
    return ok ? 0 : 1;
  }

  return cmdVerifyWorklist(p, lang);
}

/** `verify --summary` — the read-only bilan of a counter-review (src/trial-summary.ts, #60).
 *
 *  Every input is required and named: the verdicts, the report they were drawn from, and the
 *  audit under `--in`. No ledger, no `VERIFY.todo.json` next to the report, no default — a
 *  bilan silently associated with the wrong trial is worse than none. `--pruned` is the one
 *  optional input, and without it no withdrawal is reported as applied. Exit 0 once the bilan is
 *  written: it is a report, not a gate — `check --semantic` stays the gate, and the bilan says
 *  what it answered. */
function cmdVerifySummary(p: ParsedArgs): number {
  const standard = stdOf(p, "verify");
  if (standard === null) return 2;
  const lang = resolveLang(p.flags, { standard });
  const need = (flag: string): string | null => {
    const v = p.flags[flag];
    if (typeof v === "string" && v && v !== "-") return v;
    console.error(
      lang === "fr"
        ? `ultra11y verify : --summary exige --verdicts <VERIFY.json>, --report <md> et --in <audit.json> (--${flag} manquant) — le bilan ne devine aucune de ses sources.`
        : `ultra11y verify: --summary requires --verdicts <VERIFY.json>, --report <md> and --in <audit.json> (--${flag} missing) — the summary guesses none of its sources.`,
    );
    return null;
  };
  const verdictsPath = need("verdicts");
  const reportPath = verdictsPath === null ? null : need("report");
  const auditPath = reportPath === null ? null : need("in");
  if (verdictsPath === null || reportPath === null || auditPath === null) return 2;
  const readJson = (path: string, flag: string): unknown => {
    try {
      return JSON.parse(readText(path));
    } catch {
      console.error(`ultra11y verify: --${flag} file not found or not valid JSON: ${path}.`);
      return undefined;
    }
  };
  const verdicts = readJson(verdictsPath, "verdicts");
  if (!Array.isArray(verdicts)) {
    if (verdicts !== undefined) console.error("ultra11y verify: --verdicts must be a JSON array of verdicts (a filled VERIFY.todo.json).");
    return 2;
  }
  const rawAudit = readJson(auditPath, "in");
  if (rawAudit === undefined) return 2;
  const audit = unwrapAudit(rawAudit) as AuditResult;
  let pruned: { audit: AuditResult; path: string } | undefined;
  const prunedFlag = p.flags.pruned;
  if (typeof prunedFlag === "string" && prunedFlag) {
    const raw = readJson(prunedFlag, "pruned");
    if (raw === undefined) return 2;
    pruned = { audit: unwrapAudit(raw) as AuditResult, path: resolve(prunedFlag) };
  }
  const reportMd = readReportInput(reportPath, "verify");
  if (reportMd === null) return 2;
  const gate = checkSemantic(reportMd, { reportPath, verdictsPath, standard, lang });
  const summary = buildTrialSummary({
    standard,
    lang,
    audit,
    auditPath: resolve(auditPath),
    verdicts: verdicts as VerifyItem[],
    verdictsPath: resolve(verdictsPath),
    reportMd,
    reportPath: resolve(reportPath),
    ...(pruned ? { pruned } : {}),
    gate,
  });
  if (p.flags.json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  const out = typeof p.flags.out === "string" && p.flags.out ? (p.flags.out as string) : ".";
  mkdirSync(out, { recursive: true });
  const mdPath = join(out, "TRIAL.md");
  writeFileSync(mdPath, formatTrialSummary(summary, lang));
  console.log(
    summary.validated
      ? lang === "fr"
        ? `✓ Bilan de contre-expertise → ${mdPath} — gate sémantique vert.`
        : `✓ Counter-review summary → ${mdPath} — semantic gate green.`
      : lang === "fr"
        ? `Bilan de contre-expertise → ${mdPath} — audit NON validé (gate ${summary.gate.ok ? "vert" : "en échec"}, ${summary.contestedEngine.length} décision(s) moteur contestée(s), ${summary.untried.length} jamais mise(s) à l'épreuve, ${summary.foreign.length} étrangère(s)).`
        : `Counter-review summary → ${mdPath} — audit NOT validated (gate ${summary.gate.ok ? "green" : "failing"}, ${summary.contestedEngine.length} contested engine decision(s), ${summary.untried.length} never tried, ${summary.foreign.length} foreign).`,
  );
  return 0;
}

/** `verify --apply … --prune`: write back the audit the trial repaired.
 *
 *  Requires `--in`, because there is nothing to prune without the audit, and refuses silently
 *  doing nothing — a flag that was accepted and ignored is the exact shape of a gate that
 *  reports success over work it never did. */
function applyPrune(p: ParsedArgs, standard: StandardId, items: VerifyItem[], lang: Lang, untried: VerifyItem[] = []): PruneResult | undefined {
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag || inFlag === "-") {
    console.error(
      lang === "fr"
        ? "ultra11y verify : --prune exige --in <audit.json> (l'audit que la contre-expertise répare) — sans lui il n'y a rien à réparer."
        : "ultra11y verify: --prune requires --in <audit.json> (the audit the trial repairs) — without it there is nothing to prune.",
    );
    return undefined;
  }
  let audit: AuditResult;
  try {
    audit = unwrapAudit(JSON.parse(readText(inFlag))) as AuditResult;
  } catch {
    console.error(`ultra11y verify: --in file not found or not valid JSON: ${inFlag}.`);
    return undefined;
  }
  const pruned = pruneRefuted(audit, standard, items, lang, untried);
  const ledgerFile = ledgerTarget(p, standard);
  let ledgerRepair: ReturnType<typeof pruneLedger> | undefined;
  if (ledgerFile) {
    // NO LEDGER YET IS NOT AN ERROR. The route that asks for `--prune --ledger` may never have
    // recorded one (the fold ran without `--ledger`), and aborting here used to drop the whole
    // trial on the floor — a refuted conformity stayed `C`. Start an empty one and say so; an
    // unreadable file or one for another standard is still refused, since writing over it
    // would destroy someone's record.
    let ledger = readLedger(ledgerFile);
    if (!ledger && !existsSync(ledgerFile)) {
      ledger = emptyLedger(standard);
      console.error(
        lang === "fr"
          ? `⚠ Aucun registre en ${ledgerFile} — un registre vide est créé. Les verdicts déjà repliés n'y figurent pas : repliez-les avec \`verify --apply <ADJUDICATE.todo.json> --ledger\` pour qu'ils soient rejouables.`
          : `⚠ No ledger at ${ledgerFile} — creating an empty one. Verdicts folded earlier are not in it: fold them with \`verify --apply <ADJUDICATE.todo.json> --ledger\` to make them replayable.`,
      );
    }
    if (!ledger || ledger.standard !== standard) {
      console.error(
        lang === "fr"
          ? `ultra11y verify : registre --ledger introuvable, invalide ou d'un autre référentiel : ${ledgerFile}.`
          : `ultra11y verify: --ledger file missing, invalid, or for another standard: ${ledgerFile}.`,
      );
      return undefined;
    }
    // Keyed on the audited root on both sides: the todo was harvested here, the ledger may
    // have been recorded anywhere.
    const root = typeof p.flags.cwd === "string" ? (p.flags.cwd as string) : ".";
    ledgerRepair = pruneLedger(ledger, items, pruned.reopenedCriteria, pruned.clearedConformities, root);
  }
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : ".";
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "audit-latest.json"), JSON.stringify(auditDocumentFor(pruned.audit, standard, lang), null, 2) + "\n");
  if (ledgerFile && ledgerRepair) {
    writeLedger(ledgerFile, ledgerRepair.ledger);
    if (!p.flags.json)
      console.log(
        lang === "fr"
          ? `✓ Registre réparé : ${ledgerRepair.removedEntries} verdict(s) et ${ledgerRepair.removedFindings} constat(s) retirés → ${ledgerFile}`
          : `✓ Ledger repaired: ${ledgerRepair.removedEntries} verdict(s) and ${ledgerRepair.removedFindings} finding(s) removed → ${ledgerFile}`,
      );
  }
  if (!p.flags.json) {
    const reopened = [...new Set([...pruned.reopenedCriteria, ...pruned.clearedConformities])];
    console.log(
      lang === "fr"
        ? `✓ Contre-expertise appliquée : ${pruned.removedFindings} non-conformité(s) supprimée(s), ${reopened.length} critère(s) de retour à « à évaluer »${pruned.untriedConformities.length ? ` (dont ${pruned.untriedConformities.length} conformité(s) jamais mise(s) à l'épreuve)` : ""}.`
        : `✓ Trial applied: ${pruned.removedFindings} non-conformity(ies) deleted, ${reopened.length} criterion(ia) back to “to assess”${pruned.untriedConformities.length ? ` (${pruned.untriedConformities.length} of them conformity(ies) never tried)` : ""}.`,
    );
    if (reopened.length) console.log(`  ${reopened.join(", ")}`);
    // A withdrawn claim against an ENGINE verdict is left alone on purpose (src/refute.ts),
    // and saying so is the difference between « handled » and « silently dropped ».
    if (pruned.skippedEngine)
      console.error(
        lang === "fr"
          ? `⚠ ${pruned.skippedEngine} verdict(s) réfuté(s) visent une décision du moteur — non modifiés : un critère que le moteur tranche est recalculé à chaque run, et un faux positif se corrige dans la règle.`
          : `⚠ ${pruned.skippedEngine} refuted verdict(s) name an ENGINE decision — left untouched: a criterion the engine decides is recomputed every run, and a false positive is fixed in the rule.`,
      );
    // A named human auditor's verdict is not overturned by the automatic trial: the auditor is
    // the second reader. Said, so the refutation is visibly handled rather than dropped.
    if (pruned.skippedHuman)
      console.error(
        lang === "fr"
          ? `⚠ ${pruned.skippedHuman} verdict(s) réfuté(s) visent une décision d'un auditeur humain nommé — non modifiés : l'auditeur est le second lecteur ; soumettez-lui la contre-expertise.`
          : `⚠ ${pruned.skippedHuman} refuted verdict(s) name a named human auditor's decision — left untouched: the auditor is the second reader; put the refutation to them.`,
      );
  }
  return pruned;
}

/** The `--report` worklist path of `verify`, split out when `--apply` grew a `--prune`. */
function cmdVerifyWorklist(p: ParsedArgs, langIn: Lang): number {
  let lang = langIn;

  const standard = stdOf(p, "verify");
  if (standard === null) return 2;
  lang = resolveLang(p.flags, { standard });
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : ".";

  // --manual: emit an ADJUDICATION worklist over the audit's residual (manual) criteria —
  // the judgment/needs-rendering SCs the engine could not decide — pre-loaded with the
  // evidence the agent rules on. Reads the AUDIT (--in), NOT a report, so --report is
  // not required here (harvesting re-reads the audited source files).
  if (p.flags.manual === true) {
    const inFlag = p.flags.in;
    if (typeof inFlag !== "string" || !inFlag) {
      console.error(
        lang === "fr"
          ? "ultra11y verify : --manual exige --in <audit.json> (l'audit dont les critères résiduels sont à adjuger)."
          : "ultra11y verify: --manual requires --in <audit.json> (the audit whose residual criteria are adjudicated).",
      );
      return 2;
    }
    let audit: AuditResult;
    try {
      audit = unwrapAudit(JSON.parse(readText(inFlag))) as AuditResult;
    } catch {
      console.error(`ultra11y verify: --in file not found or not valid JSON: ${inFlag}.`);
      return 2;
    }
    const adjItems = buildAdjudicationWorklist(audit, { standard });
    // MAY THIS BRIEF INVITE A WEB LOOKUP? The criterion's official URL is printed either
    // way — it is a fact about where the vendored text came from. The sentence telling an
    // adjudicator it may go read it is an instruction, and it is only true where a web tool
    // exists. In CI the adjudicator has Read/Grep/Glob/Edit/Write, so the default follows
    // the environment and `--web` / `--no-web` overrides it either direction.
    const web = webAllowed(p.flags);
    // NOTHING WAS RENDERED, AND THE WORKLIST IS ABOUT TO PRETEND OTHERWISE.
    //
    // Said here, before a model is handed anything, because this is the last moment it costs
    // nothing. On the 2026-08-20 RGAA cascade the same information arrived after three passes
    // and $24.90, as seven correct `needs-rendered-dom` verdicts nobody could act on. A
    // warning, not a refusal: a source-only audit is a legitimate thing to want, and the gate
    // for those who want it to fail is `check --require-rendered`.
    const unrendered = unrenderedResidual(audit, adjItems);
    const w = writeAdjudication(adjItems, out, { standard, auditDate: audit.date, lang, unrendered, web });
    if (unrendered.length) {
      const ids = unrendered.join(" · ");
      console.error(
        lang === "fr"
          ? `ultra11y verify : ${unrendered.length} critère(s) exigent une page rendue et aucune page n'a été instantanée — ils resteront « à évaluer » quoi qu'il arrive. Lancez \`ultra11y scan <url> --merge ${inFlag}\` d'abord. Concernés : ${ids}`
          : `ultra11y verify: ${unrendered.length} criterion(ia) need a rendered page and no page was snapshotted — they will stay "to assess" whatever happens. Run \`ultra11y scan <url> --merge ${inFlag}\` first. Affected: ${ids}`,
      );
    }
    if (adjItems.every((it) => it.evidence.length === 0)) {
      console.error(
        lang === "fr"
          ? `ultra11y verify : aucune évidence n'a pu être extraite (${audit.scope.inputs.join(", ")} introuvable ?) — lancez --manual depuis le répertoire de l'audit.`
          : `ultra11y verify: no evidence could be harvested (${audit.scope.inputs.join(", ")} not found?) — run --manual from the audit's directory.`,
      );
    }
    if (p.flags.json)
      console.log(
        JSON.stringify(
          { mdPath: w.mdPath, todoPath: w.todoPath, itemsDir: w.itemsDir, verdictsPath: w.verdictsPath, count: w.count, items: adjItems },
          null,
          2,
        ),
      );
    else
      console.log(
        lang === "fr" ? `${w.count} critère(s) à adjuger → ${w.mdPath}, ${w.todoPath}` : `${w.count} criterion(ia) to adjudicate → ${w.mdPath}, ${w.todoPath}`,
      );
    // NAME THE FILE THAT CARRIES THE CRITERION. The two documents above hold the evidence and
    // the slots a verdict goes into; the criterion's own wording — its numbered tests, the
    // standard's test methodology, its glossary terms — lives in the per-criterion briefs, and
    // outside CI nothing ever said so. Ruling on a criterion from the name in a JSON item is
    // ruling from memory, which is the one thing this whole pipeline exists to prevent.
    console.error(
      lang === "fr"
        ? `  Le texte de chaque critère (tests numérotés, méthodologie de test du référentiel, glossaire) est dans ${w.itemsDir}/<critère>.md — lisez-le avant de trancher.`
        : `  Each criterion's own text (numbered tests, the standard's test methodology, glossary) is in ${w.itemsDir}/<criterion>.md — read it before ruling.`,
    );
    return 0;
  }

  // Normal NC-verification worklist path — requires --report.
  const rep = p.flags.report;
  if (typeof rep !== "string" || !rep) {
    console.error("ultra11y verify: --report <md> is required (or --apply <verdicts.json>, or --manual --in <audit.json>).");
    return 2;
  }
  // THE CAP. By default it bounds the non-conformity half only: the conformity half is a
  // TRIAL, and a trial silently cut short let every claim past the cap keep counting as
  // conforming (measured: 74 C/NA claims on a 7-page site, 40 tried, 34 never seen). An
  // explicit --max-verify caps both halves — and whatever it drops is named on stderr, and
  // fails `verify --apply` as missing (and, under --prune, sends those conformities back to
  // « to assess »).
  let max = VERIFY_MAX;
  let cMax = Number.POSITIVE_INFINITY;
  const mvFlag = p.flags["max-verify"];
  if (typeof mvFlag === "string" && mvFlag !== "") {
    const n = Number(mvFlag);
    if (!Number.isInteger(n) || n < 0) {
      console.error("ultra11y verify: --max-verify must be a non-negative integer.");
      return 2;
    }
    max = n === 0 ? Number.POSITIVE_INFINITY : n; // 0 = no cap
    cMax = max;
  }
  const repMd = readReportInput(rep, "verify");
  if (repMd === null) return 2;
  const ncItems = buildWorklist(repMd, standard, max);
  const ncAll = Number.isFinite(max) ? buildWorklist(repMd, standard, Number.POSITIVE_INFINITY).length : ncItems.length;
  const trial = conformityTrial(p, standard, lang);
  const conformities = trial.claims;
  const cItems = buildConformityWorklist(conformities, ncItems.length, cMax);
  const cAll = Number.isFinite(cMax) ? buildConformityWorklist(conformities, 0, Number.POSITIVE_INFINITY).length : cItems.length;
  const items = [...ncItems, ...cItems];
  const droppedNc = ncAll - ncItems.length;
  const droppedC = cAll - cItems.length;
  if (droppedNc > 0 || droppedC > 0)
    console.error(
      lang === "fr"
        ? `⚠ Worklist plafonnée par --max-verify : ${[droppedNc ? `${droppedNc}/${ncAll} non-conformité(s)` : "", droppedC ? `${droppedC}/${cAll} conformité(s) revendiquée(s)` : ""].filter(Boolean).join(" et ")} laissée(s) hors du procès. \`verify --apply\` les comptera absentes et échouera${droppedC ? ", et --prune renverra ces conformités à « à évaluer »" : ""}. Relancez avec --max-verify 0 pour tout mettre à l'épreuve.`
        : `⚠ Worklist capped by --max-verify: ${[droppedNc ? `${droppedNc}/${ncAll} non-conformity(ies)` : "", droppedC ? `${droppedC}/${cAll} claimed conformity(ies)` : ""].filter(Boolean).join(" and ")} left out of the trial. \`verify --apply\` will count them missing and fail${droppedC ? ", and --prune will send those conformities back to “to assess”" : ""}. Re-run with --max-verify 0 to try everything.`,
    );
  // SAY IT WHILE IT IS STILL FREE TO FIX. With no conformity source the list tries the report's
  // non-conformities and nothing else, and every conformity the adjudication cleared walks past
  // the trial unseen — which `verify --apply` cannot notice either unless it is handed `--in`.
  if (trial.source.source === "none")
    console.error(
      lang === "fr"
        ? "⚠ Aucune source de conformités (ni --in, ni --conformities, ni ledger) : seules les non-conformités du rapport sont mises à l'épreuve. Passez --in <audit.json> (l'audit dont vient le rapport) pour y inclure les conformités adjugées, ou --no-conformities pour l'exclure explicitement."
        : "⚠ No conformity source (no --in, --conformities or ledger): only the report's non-conformities are put on trial. Pass --in <audit.json> (the audit the report came from) to include the adjudicated conformities, or --no-conformities to opt out explicitly.",
    );
  const { todoPath, mdPath, count } = writeWorklist(items, out, p.flags.semantic === true, standard, lang);
  const inFlag = p.flags.in;
  const contextPath = writeVerifyContext(out, {
    kind: "verify-context",
    standard,
    report: rep === "-" ? rep : resolve(rep),
    ...(typeof inFlag === "string" && inFlag && inFlag !== "-" ? { in: resolve(inFlag) } : {}),
    conformities: trial.source,
    capped: { nc: droppedNc, c: droppedC },
  });
  if (p.flags.json) console.log(JSON.stringify({ mdPath, todoPath, contextPath, count, nc: ncItems.length, conformities: cItems.length, items }, null, 2));
  else
    console.log(
      lang === "fr"
        ? `${ncItems.length} non-conformité(s)${cItems.length ? ` et ${cItems.length} conformité(s) revendiquée(s)` : ""} à vérifier → ${mdPath}, ${todoPath}`
        : `${ncItems.length} non-conformity(ies)${cItems.length ? ` and ${cItems.length} claimed conformity(ies)` : ""} to verify → ${mdPath}, ${todoPath}`,
    );
  return 0;
}

/** The fold's evidence-anchor fallback, rebuilt for the trial (`verify --apply … --report`).
 *
 *  The fold grounds a citation that is one of its criterion's own harvested anchors against
 *  THAT ANCHOR when the literal check fails — an adjudicator's retyping of an element it did
 *  read. The trial of the same report must not refuse the claim one gate later for the
 *  retyping the fold already forgave, so it re-derives the harvest from the audit under `--in`
 *  (the worklist evidence is a pure function of the audit) and grants the same fallback,
 *  through the very same `evidenceFallback` the fold runs. A citation that is NOT one of the
 *  criterion's anchors still fails strictly: without the audit there is nothing to re-derive
 *  and nothing is granted.
 *
 *  Returns the per-citation resolver `verifyGroundingInputs` applies; undefined when there is
 *  nothing to resolve (no conformity on trial, no `--in`, unreadable audit). */
function trialAnchorFallbacks(
  p: ParsedArgs,
  standard: StandardId,
  passing: VerifyItem[],
):
  | ((
      it: VerifyItem,
      cite: { file: string; line: number; selector?: string; snippet?: string },
    ) => { file: string; line: number; selector?: string; snippet?: string } | undefined)
  | undefined {
  const ids = [...new Set(passing.filter((it) => it.kind === "c").map((it) => it.criteriaId))];
  const inFlag = p.flags.in;
  if (!ids.length || typeof inFlag !== "string" || !inFlag || inFlag === "-") return undefined;
  let audit: AuditResult;
  try {
    audit = unwrapAudit(JSON.parse(readText(inFlag))) as AuditResult;
  } catch {
    // The command that owns --in reports malformed input; the trial stays strict.
    return undefined;
  }
  const cwd = typeof p.flags.cwd === "string" ? (p.flags.cwd as string) : undefined;
  const evidence = evidenceForCriteria(audit, ids, { cwd, standard });
  const { citationDrift } = adjudicationLimits(cwd);
  return (it, cite) => evidenceFallback(evidence.get(it.criteriaId) ?? [], cite, citationDrift).fallback;
}

/**
 * The claimed conformities to put on trial, from the verdict ledger (or an adjudication file).
 *
 * ON BY DEFAULT, and that is the decision worth defending. `verify` attacked only
 * non-conformities, so a cheap adjudicator's `C` was challenged by nothing — a criterion could
 * be cleared because its subject was PRESENT rather than because it was RIGHT, and the
 * conformance claim shipped. A gate that has to be remembered is a gate that does not run, and
 * the failure it guards against is the one nobody notices.
 *
 * It costs nothing when there is nothing to check: no ledger, or a ledger with no agent `C`,
 * and the worklist is exactly what it was. `--no-conformities` opts out; `--conformities <file>`
 * names a source other than the standard's default ledger.
 *
 * Returns WHERE the claims came from too — recorded beside the worklist and compared at apply
 * time, so a coverage gap caused by a different claim source is named as that and not as a
 * cap (#59).
 */
function conformityTrial(p: ParsedArgs, standard: StandardId, lang: Lang): { claims: ConformityClaim[]; source: ConformitySource } {
  if (p.flags.conformities === false || p.flags["no-conformities"] === true) return { claims: [], source: { source: "disabled" } };
  const named = typeof p.flags.conformities === "string" && p.flags.conformities ? p.flags.conformities : undefined;
  // `--in` is the exact audit the report came from, so its current conformance claims outrank
  // a durable ledger that may describe the preceding run. This matters after prune +
  // re-adjudicate: trying the old ledger again can bill the refuter for claims the current
  // audit no longer makes. An explicit --conformities still wins.
  if (!named) {
    const inFlag = p.flags.in;
    if (typeof inFlag === "string" && inFlag && inFlag !== "-") {
      try {
        const audit = unwrapAudit(JSON.parse(readText(inFlag))) as AuditResult;
        if (Array.isArray(audit.criteria)) return { claims: conformityClaimsFromAudit(audit, standard), source: { source: "in", path: resolve(inFlag) } };
      } catch {
        // The command that owns --in reports malformed input; the ledger remains a fallback.
      }
    }
  }
  const path = named ?? ledgerPath(standard);
  const source: ConformitySource = { source: named ? "file" : "ledger", path: resolve(path) };
  if (!existsSync(path)) {
    // Loud when a path WAS named, because a typo there would otherwise verify nothing and
    // report success — and then stop, rather than quietly verifying a different source than
    // the one asked for.
    if (named) {
      console.error(
        lang === "fr" ? `ultra11y verify : fichier --conformities introuvable : ${named}.` : `ultra11y verify: --conformities file not found: ${named}.`,
      );
      return { claims: [], source };
    }
    return { claims: [], source: { source: "none" } };
  }
  try {
    const parsed = JSON.parse(readText(path)) as { entries?: ConformityClaim[]; items?: ConformityClaim[]; criteria?: unknown[] };
    if (parsed.entries) return { claims: parsed.entries, source };
    if (parsed.items) return { claims: parsed.items, source };
    const audit = unwrapAudit(parsed) as AuditResult;
    return { claims: Array.isArray(audit.criteria) ? conformityClaimsFromAudit(audit, standard) : [], source };
  } catch {
    if (named)
      console.error(
        lang === "fr"
          ? `ultra11y verify : le fichier --conformities n'est pas du JSON valide : ${named}.`
          : `ultra11y verify: --conformities file is not valid JSON: ${named}.`,
      );
    return { claims: [], source };
  }
}

const sameConformitySource = (a: ConformitySource, b: ConformitySource): boolean =>
  a.source === b.source && ("path" in a ? a.path : "") === ("path" in b ? b.path : "");

function describeConformitySource(s: ConformitySource, lang: Lang): string {
  const fr = lang === "fr";
  switch (s.source) {
    case "in":
      return `--in ${s.path}`;
    case "file":
      return `--conformities ${s.path}`;
    case "ledger":
      return `ledger ${s.path}`;
    case "disabled":
      return "--no-conformities";
    default:
      return fr ? "aucune — ni --in, ni --conformities, ni ledger" : "none — no --in, --conformities or ledger";
  }
}

/** The `verify --report` flags that reproduce THIS invocation's claim context — what a
 *  regenerated worklist must be built with to cover what this apply expects. */
function trialContextFlags(p: ParsedArgs, standard: StandardId, source: ConformitySource): string {
  const flags = [`--standard ${standard}`];
  const inFlag = p.flags.in;
  if (typeof inFlag === "string" && inFlag && inFlag !== "-") flags.push(`--in ${inFlag}`);
  if (source.source === "file") flags.push(`--conformities ${source.path}`);
  if (source.source === "disabled") flags.push("--no-conformities");
  return flags.join(" ");
}

/** Where to record the verdicts a fold accepted. `--ledger <path>` names a file; `--ledger`
 *  bare takes the standard's default location. Absent ⇒ nothing is recorded, so a caller who
 *  never asked for a ledger never gets a surprise file in their tree. */
function ledgerTarget(p: ParsedArgs, standard: StandardId): string | undefined {
  const flag = p.flags.ledger;
  if (flag === undefined || flag === false) return undefined;
  return typeof flag === "string" && flag ? flag : ledgerPath(standard);
}

/** `verify --apply <ledger.json> --in <audit.json> --out <dir>` — REPLAY stored verdicts onto
 *  a fresh audit, with no model in the loop.
 *
 *  This is the parity mechanism: the same `applyAdjudication` gate runs, on evidence re-derived
 *  from the audit in front of it, so a stored verdict has to prove itself again exactly as it
 *  did the day it was recorded. A verdict whose evidence has since changed is dropped as stale
 *  and its criterion returns to « to assess », saying so. */
function replayLedgerFile(p: ParsedArgs, ledger: VerdictLedger, lang: Lang): number {
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error(
      lang === "fr"
        ? "ultra11y verify : --apply <registre> exige --in <audit.json> (l'audit à mettre à jour)."
        : "ultra11y verify: --apply <ledger> requires --in <audit.json> (the audit to update).",
    );
    return 2;
  }
  let audit: AuditResult;
  try {
    audit = unwrapAudit(JSON.parse(readText(inFlag))) as AuditResult;
  } catch {
    console.error(`ultra11y verify: --in file not found or not valid JSON: ${inFlag}.`);
    return 2;
  }
  const cwd = typeof p.flags.cwd === "string" ? (p.flags.cwd as string) : undefined;
  const standard = resolveStandard(p.flags.standard) ?? ledger.standard;
  const rp = replayLedger(audit, ledger, { cwd, standard });
  const r = applyAdjudication(audit, rp.adj, { cwd, strict: p.flags.strict === true, residualReasons: rp.residualReasons });

  if (!r.ok && (p.flags.strict === true || r.applied + r.stillManual === 0)) {
    if (p.flags.json) console.log(JSON.stringify({ ...r, replay: rp }, null, 2));
    else {
      console.error(lang === "fr" ? `✗ Registre rejeté (${r.issues.length} problème(s)) :` : `✗ Ledger rejected (${r.issues.length} issue(s)):`);
      for (const i of r.issues) console.error(`  ✗ ${i}`);
    }
    return 1;
  }
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : ".";
  mkdirSync(out, { recursive: true });
  const auditPath = join(out, "audit-latest.json");
  writeFileSync(auditPath, `${JSON.stringify(auditDocumentFor(r.audit, standard, lang), null, 2)}\n`);

  if (p.flags.json)
    console.log(
      JSON.stringify(
        {
          ok: true,
          auditPath,
          applied: r.applied,
          stillManual: r.stillManual,
          rejected: r.rejected,
          rejectedCriteria: r.rejectedCriteria,
          notInWorklist: r.notInWorklist,
          replayed: rp.fresh.length,
          stale: rp.stale,
          obsolete: rp.obsolete,
          missing: rp.missing,
          issues: r.issues,
          conformancePct: r.audit.conformancePct,
          ...foldRates(r.audit, standard),
          grounding: r.grounding,
        },
        null,
        2,
      ),
    );
  else {
    console.log(
      lang === "fr"
        ? `✓ ${r.applied} verdict(s) rejoué(s) depuis le registre, ${r.stillManual} laissé(s) en résiduel${r.rejected ? `, ${r.rejected} refusé(s)` : ""} → ${auditPath}`
        : `✓ ${r.applied} verdict(s) replayed from the ledger, ${r.stillManual} left residual${r.rejected ? `, ${r.rejected} refused` : ""} → ${auditPath}`,
    );
    // Named, never merely counted: these are exactly the criteria a refresh pass has to
    // adjudicate, and a silent count is what let a half-covered grid read as complete.
    if (rp.stale.length)
      console.error(
        lang === "fr"
          ? `⚠ ${rp.stale.length} verdict(s) périmé(s) (l'évidence a changé) : ${rp.stale.join(", ")}`
          : `⚠ ${rp.stale.length} stale verdict(s) (the evidence changed): ${rp.stale.join(", ")}`,
      );
    if (rp.missing.length)
      console.error(
        lang === "fr"
          ? `⚠ ${rp.missing.length} critère(s) absent(s) du registre : ${rp.missing.join(", ")}`
          : `⚠ ${rp.missing.length} criterion(ia) absent from the ledger: ${rp.missing.join(", ")}`,
      );
    if (rp.obsolete.length)
      console.error(
        lang === "fr"
          ? `ℹ ${rp.obsolete.length} entrée(s) obsolète(s) (le moteur les décide désormais) : ${rp.obsolete.join(", ")}`
          : `ℹ ${rp.obsolete.length} obsolete entry(ies) (the engine now decides them): ${rp.obsolete.join(", ")}`,
      );
  }
  return 0;
}

/** Name the open criteria a fold did not carry, APART from the refusals. A lot (a partial
 *  worklist) leaves every other criterion out by construction; listing them under « refused by
 *  the gate » read as if verdicts had been turned down that nobody wrote (#132). */
/** One defect, one severity (#183): the anchors the fold saw charged under several criteria.
 *  A warning — nothing was refused — so it goes to stderr beside the other fold notes. */
function reportDuplicateCharges(list: string[] | undefined, lang: Lang): void {
  if (!list?.length) return;
  console.error(
    lang === "fr"
      ? `⚠ ${list.length} ancre(s) facturée(s) sous plusieurs critères — un défaut garde UNE gravité, la plus haute (rien n'a été refusé) :`
      : `⚠ ${list.length} anchor(s) charged under several criteria — one defect keeps ONE severity, the highest (nothing was refused):`,
  );
  for (const d of list.slice(0, 20)) console.error(`  ⚠ ${d}`);
  if (list.length > 20) console.error(`  … +${list.length - 20}`);
}

function reportNotInWorklist(ids: string[], lang: Lang): void {
  if (!ids.length) return;
  const shown = ids.slice(0, 40).join(", ") + (ids.length > 40 ? ` … +${ids.length - 40}` : "");
  console.error(
    lang === "fr"
      ? `ℹ ${ids.length} critère(s) hors de la liste — absent(s) de ce fichier, rien n'a été refusé ; ils restent à évaluer : ${shown}`
      : `ℹ ${ids.length} criterion(ia) not in this worklist — absent from this file, nothing was refused; they stay to assess: ${shown}`,
  );
}

/** `verify --apply <adjudication.json> --in <audit.json> --out <dir>` — fold an AI
 *  adjudication of the manual criteria back into the audit, fail-closed, then rewrite the
 *  audit JSON so `report`/`prd` re-render with the adjudicated statuses. */
function applyAdjudicationFile(p: ParsedArgs, adj: AdjudicationFile, lang: Lang): number {
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error(
      lang === "fr"
        ? "ultra11y verify : --apply <adjudication> exige --in <audit.json> (l'audit à mettre à jour)."
        : "ultra11y verify: --apply <adjudication> requires --in <audit.json> (the audit to update).",
    );
    return 2;
  }
  let audit: AuditResult;
  try {
    audit = unwrapAudit(JSON.parse(readText(inFlag))) as AuditResult;
  } catch {
    console.error(`ultra11y verify: --in file not found or not valid JSON: ${inFlag}.`);
    return 2;
  }
  // A verdicts-only file (`ADJUDICATE.verdicts.json`) carries decisions without the evidence
  // they were made against. Put it back from the audit before folding: the worklist is a pure
  // function of the audit, so this reconstructs the very anchors the citation gate checks
  // against — the fold below is the same fold, with the same refusals.
  const cwd = typeof p.flags.cwd === "string" ? (p.flags.cwd as string) : undefined;
  hydrateAdjudication(adj, audit, { cwd });
  const strict = p.flags.strict === true;
  const r = applyAdjudication(audit, adj, { cwd, strict });
  // STRICT: one refusal discards the file, nothing is persisted — the historical contract.
  // PARTIAL (default): the refusals are reported, the criteria they condemn stay to assess,
  // and everything that proved itself is kept. Only a fold that landed NOTHING is an error;
  // otherwise a single bad verdict would again cost the whole run.
  if (!r.ok && (strict || r.applied + r.stillManual === 0)) {
    if (p.flags.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.error(lang === "fr" ? `✗ Adjudication rejetée (${r.issues.length} problème(s)) :` : `✗ Adjudication rejected (${r.issues.length} issue(s)):`);
      for (const i of r.issues) console.error(`  ✗ ${i}`);
      reportNotInWorklist(r.notInWorklist, lang);
    }
    return 1;
  }
  if (r.rejected > 0 && !p.flags.json) {
    console.error(
      lang === "fr"
        ? `⚠ ${r.rejected} critère(s) refusé(s) par la porte — ils restent à évaluer, avec le motif du refus :`
        : `⚠ ${r.rejected} criterion(ia) refused by the gate — they stay to assess, carrying the refusal:`,
    );
    for (const i of r.issues) console.error(`  ✗ ${i}`);
  }
  if (!p.flags.json) reportNotInWorklist(r.notInWorklist, lang);
  if (!p.flags.json) reportDuplicateCharges(r.duplicateCharges, lang);
  // Persist the updated audit so report/prd re-render with the adjudicated statuses.
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : ".";
  mkdirSync(out, { recursive: true });
  const auditPath = join(out, "audit-latest.json");
  writeFileSync(auditPath, JSON.stringify(auditDocumentFor(r.audit, adj.standard, lang), null, 2) + "\n");
  // Record what landed, so the next run does not have to pay a model to learn it again. Only
  // the ACCEPTED verdicts go in: a refused one in the ledger would be laundered back on the
  // next replay, which is the whole thing the gate exists to prevent.
  const ledgerOut = ledgerTarget(p, adj.standard);
  if (ledgerOut) {
    // A LEDGER WRITTEN WITHOUT THE CAPTURES IS STALE ON ARRIVAL.
    //
    // The fingerprint is over the evidence the harvest READ FROM DISK, so recording a verdict
    // where the audit's page captures are absent fingerprints a strictly smaller set than the
    // one CI rebuilds — and the replay drops it as stale, every run, silently. Measured on a
    // real repository: RGAA 12.3 recorded over 13 evidence items where the run harvests 22.
    // The entry looked well-formed, the fold accepted it, it was committed and reviewed, and
    // it never once replayed.
    //
    // A warning, not a refusal: the verdict itself is sound and still lands on THIS audit, and
    // a caller who genuinely has no captures (a source-only repository) has nothing to fix.
    // What must not happen is writing it and saying nothing.
    const blind = unreadableCaptures(r.audit);
    if (blind.length)
      console.error(
        lang === "fr"
          ? `⚠ Registre écrit sans les instantanés de ${blind.length} page(s) que cet audit dit avoir lues (${blind.slice(0, 5).join(", ")}${blind.length > 5 ? "…" : ""}). L'évidence moissonnée ici est plus petite que celle qu'un run reconstruira, donc ces verdicts seront déclarés PÉRIMÉS au rejeu. Adjugez là où \`.ultra11y/pages/\` existe.`
          : `⚠ Ledger written without the snapshots of ${blind.length} page(s) this audit says it read (${blind.slice(0, 5).join(", ")}${blind.length > 5 ? "…" : ""}). The evidence harvested here is smaller than the one a run will rebuild, so these verdicts will be dropped as STALE on replay. Adjudicate where \`.ultra11y/pages/\` exists.`,
      );
    const refused = new Set(r.rejectedCriteria);
    const accepted = new Set(adj.items.map((it) => it.criteriaId).filter((id) => !refused.has(id)));
    // Paths written relative to the audited root, so the committed ledger names files a
    // reviewer can open and another checkout can replay.
    const fresh = entriesFrom(adj, accepted, r.audit.date, cwd ?? ".");
    writeLedger(ledgerOut, mergeLedger(readLedger(ledgerOut), adj.standard, fresh));
    if (!p.flags.json)
      console.log(
        lang === "fr"
          ? `✓ ${fresh.length} verdict(s) enregistré(s) au registre → ${ledgerOut}`
          : `✓ ${fresh.length} verdict(s) recorded in the ledger → ${ledgerOut}`,
      );
  }
  // Carry the numbers the fold produced. The failure payload has always described its own
  // outcome (`issues`); the success one described only the mechanics, so a caller that gates
  // on the adjudicated result — a CI step, an orchestrator's tool node — had to re-read and
  // re-parse the file it had just been handed the path to.
  if (p.flags.json)
    console.log(
      JSON.stringify(
        {
          ok: true,
          auditPath,
          applied: r.applied,
          stillManual: r.stillManual,
          rejected: r.rejected,
          rejectedCriteria: r.rejectedCriteria,
          notInWorklist: r.notInWorklist,
          issues: r.issues,
          ...(r.duplicateCharges ? { duplicateCharges: r.duplicateCharges } : {}),
          conformancePct: r.audit.conformancePct,
          ...foldRates(r.audit, adj.standard),
          findings: r.audit.findings.length,
          grounding: r.grounding,
        },
        null,
        2,
      ),
    );
  else
    console.log(
      lang === "fr"
        ? `✓ ${r.applied} critère(s) adjugé(s), ${r.stillManual} laissé(s) en résiduel${r.rejected ? `, ${r.rejected} refusé(s)` : ""}${r.notInWorklist.length ? `, ${r.notInWorklist.length} hors de la liste` : ""} → ${auditPath}`
        : `✓ ${r.applied} criterion(ia) adjudicated, ${r.stillManual} left residual${r.rejected ? `, ${r.rejected} refused` : ""}${r.notInWorklist.length ? `, ${r.notInWorklist.length} not in this worklist` : ""} → ${auditPath}`,
    );
  return 0;
}

async function cmdFix(p: ParsedArgs): Promise<number> {
  const inputs = p.positionals.length ? p.positionals : ["."];
  const stdin = inputs.includes("-") ? await readStdin() : undefined;
  const since = typeof p.flags.since === "string" ? (p.flags.since as string) : undefined;
  const write = p.flags.write === true;
  const onlyFlag = p.flags.only;
  if (onlyFlag === "" || (typeof onlyFlag === "string" && !onlyFlag.trim())) {
    console.error("ultra11y fix: --only requires one or more rule ids (comma-separated).");
    return 2;
  }
  // VOCABULARY ONLY. `fix` names the criterion behind each proposed edit, and an agent acting
  // on that output writes the ticket in the standard the project is audited against — so a
  // project on RGAA being told « WCAG 3.1.1 » has to translate before it can file anything.
  // No codemod changes, and no rule is selected or skipped by this.
  const fixStandard = stdOf(p, "fix");
  if (fixStandard === null) return 2;
  const opts = {
    inputs,
    stdin,
    standard: fixStandard,
    forceJsx: p.flags.jsx === true,
    include: asList(p.flags.include),
    exclude: asList(p.flags.exclude),
    ext: asList(p.flags.ext),
    changed: p.flags.changed === true || since !== undefined,
    since,
    staged: p.flags.staged === true,
    safe: p.flags.safe === true,
    noDefaultExcludes: p.flags["no-default-excludes"] === true,
    only:
      typeof onlyFlag === "string"
        ? onlyFlag
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined,
    write,
    onWarn: (m: string) => console.error(m),
  };

  // --iterate: re-audit and re-apply the mechanical fixes until a round writes
  // nothing new (bounded). Each round re-reads files, so it converges quickly —
  // a codemod removes the finding it fixed, so it is not re-applied. Round 1 holds
  // the meaningful diff; later rounds just confirm stability (or catch cascades).
  const result = runFix(opts);
  let rounds = 1;
  let totalWritten = result.totals.filesWritten;
  if (write && p.flags.iterate === true) {
    const MAX_ROUNDS = 5;
    let last = result;
    while (last.totals.filesWritten > 0 && rounds < MAX_ROUNDS) {
      last = runFix(opts);
      rounds++;
      totalWritten += last.totals.filesWritten;
    }
  }

  // `fix` runs its own rule pass (no AuditResult/scope.langs is built internally — see
  // src/fix.ts), so the only language signals are the flag and the active standard's locale.
  const fixLang = resolveLang(p.flags, { standard: fixStandard });
  if (p.flags.json) console.log(JSON.stringify(p.flags.iterate === true ? { ...result, rounds, totalWritten } : result, null, 2));
  else {
    console.log(fixSummary(result, fixLang, write, fixStandard));
    if (write && p.flags.iterate === true)
      console.log(
        fixLang === "fr"
          ? `\nItéré sur ${rounds} passe(s) jusqu'à stabilité — ${totalWritten} fichier(s) écrit(s) au total.`
          : `\nIterated over ${rounds} round(s) to a fixpoint — ${totalWritten} file(s) written in total.`,
      );
  }
  return 0;
}

/** Where `scan` writes the page snapshots it collects: `--root <dir>` when given — the same
 *  contract as `snapshot write` and `pages discover --from-snapshots` — else the
 *  working directory. Absolute either way, as it always was: the merge audits the snapshot
 *  DOMs by this path. Undefined under `--no-snapshot`: nothing is persisted. `--cwd` plays
 *  no part here: it keeps its own meaning, where Playwright resolves from. */
export function scanSnapshotRoot(flags: ParsedArgs["flags"]): string | undefined {
  if (flags["no-snapshot"] === true) return undefined;
  return typeof flags.root === "string" && flags.root ? resolve(flags.root) : process.cwd();
}

async function cmdScan(p: ParsedArgs): Promise<number> {
  // `scan` takes `--standard` for the same reason `audit` now does: it REWRITES
  // audit-latest.json mid-chain, and a merge that silently re-keyed an RGAA document back to
  // the core would undo the selection one step after it was made. It changes no verdict — the
  // probes measure what they measure — only which standard the merged document speaks.
  const standard = stdOf(p, "scan");
  if (standard === null) return 2;
  // With --merge, peek the target audit's scope.langs BEFORE resolving lang (a French repo
  // audited without --lang must not get English dyn-* text permanently baked with no way back
  // — see peekMergeAudit). --lang stays explicit-wins.
  const mergeAudit = peekMergeAudit(p.flags.merge);
  const lang = resolveLang(p.flags, mergeAudit ? { audit: mergeAudit, standard } : { standard });
  // A local target that does not exist is a user error, independent of the runtime — say
  // so BEFORE probing for Playwright, otherwise a machine without it reports "no runtime
  // available" for what is really a typo in the path.
  for (const target of p.positionals.filter((a) => a !== "-")) {
    if (/^https?:\/\//i.test(target) || existsSync(target)) continue;
    console.error(
      lang === "fr"
        ? `ultra11y scan : fichier introuvable (file not found) : ${target}. Passez une URL http(s):// ou un fichier HTML existant.`
        : `ultra11y scan: File not found: ${target}. Pass an http(s):// URL or an existing HTML file.`,
    );
    return 1;
  }
  // The runtime is the host/target Playwright, resolved from --cwd (then from ultra11y's own
  // dependencies) — the only one there is. `--runtime local|auto` / `--local` stay accepted
  // (they name exactly that runtime); anything else is refused rather than silently scanned
  // some other way. No availability pre-check: the local runner's own launch errors name what
  // to install, and it can still fall back on an installed Google Chrome.
  const cwd = typeof p.flags.cwd === "string" && p.flags.cwd ? (p.flags.cwd as string) : process.cwd();
  const storageState = typeof p.flags["storage-state"] === "string" && p.flags["storage-state"] ? (p.flags["storage-state"] as string) : undefined;
  const browserPath = browserPathOf(p.flags);
  const runtimeFlag = typeof p.flags.runtime === "string" && p.flags.runtime ? (p.flags.runtime as string) : "local";
  if (runtimeFlag !== "local" && runtimeFlag !== "auto") {
    console.error(`ultra11y scan: --runtime must be local (got "${runtimeFlag}"). The Docker runtime was removed; the scan runs on the local Playwright.`);
    return 2;
  }

  // Stateful probes (fill inputs → input-overflow, open dialogs, live-region) are ON by
  // default for the local runtime. SAFETY CONTRACT: they perform only non-navigating
  // actions (fill text inputs, toggle checkbox/radio, click button[type=button]) — never a
  // link, never a submit, never a form submit, never a button whose accessible name matches
  // a destructive verb (fr/en) — and abort+restore if location.href changes. On an
  // AUTHENTICATED scan (--storage-state) the button clicks are additionally skipped by
  // default (a click can trigger a server mutation invisible to the href assertion);
  // `--interact-clicks` opts back in. `--no-interact` disables all stateful probes, leaving
  // only the pristine-page ones.
  const interact = p.flags["no-interact"] !== true;
  const interactClicks = p.flags["interact-clicks"] === true;
  const sitemap = typeof p.flags.sitemap === "string" ? (p.flags.sitemap as string) : undefined;
  const crawl = typeof p.flags.crawl === "string" ? (p.flags.crawl as string) : undefined;
  // Every scanned page is also PERSISTED as a snapshot (.ultra11y/pages/<id>/). The browser
  // is already on the page, so this costs one `evaluate` — and it is what lets the page be
  // re-audited offline and earn a real per-page verdict instead of staying "to assess"
  // forever (src/pages.ts). `--no-snapshot` opts out.
  const snapshotRoot = scanSnapshotRoot(p.flags);

  // --sample: iterate the NORMATIVE page sample from `.ultra11yrc.json` (per-page
  // storageState overrides --storage-state). Loaded + validated here (hard error on a
  // malformed sample). SECURITY: storageState is only ever a path — its content is never read.
  const useSample = p.flags.sample === true;
  let sampleConfig: SampleConfig | undefined;
  if (useSample) {
    let cfg: ReturnType<typeof loadConfig>;
    try {
      cfg = loadConfig(process.cwd());
    } catch (e) {
      console.error(`ultra11y scan: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
    if (!cfg?.sample) {
      console.error(
        lang === "fr"
          ? "ultra11y scan : --sample exige un bloc `sample` dans .ultra11yrc.json (pages de l'échantillon). Voir `ultra11y sample check`."
          : "ultra11y scan: --sample requires a `sample` block in .ultra11yrc.json (the sample pages). See `ultra11y sample check`.",
      );
      return 2;
    }
    const v = validateSample(cfg.sample);
    for (const w of v.warnings) console.error(`⚠ ${w.path ? `${w.path}: ` : ""}${w.message}`);
    if (!v.ok || !v.sample) {
      console.error(lang === "fr" ? "ultra11y scan : bloc `sample` invalide :" : "ultra11y scan: invalid `sample` block:");
      for (const i of v.issues) console.error(`  ✗ ${i.path ? `${i.path}: ` : ""}${i.message}`);
      return 2;
    }
    sampleConfig = v.sample;
  }

  // --all-routes: THE WHOLE APPLICATION, not only the sample. The route inventory
  // (`.ultra11y/routes.json`, written by `pages discover --write`) is walked after the sample:
  // every route the sample does not hold, except those the project's E2E run already captured
  // (that capture holds the state the tests built, and wins). Bounded by --max-routes, and a
  // route the bound leaves out is listed in the report as not reached, never dropped.
  const allRoutes = p.flags["all-routes"] === true;
  // From --root whether or not this run snapshots: `pages discover --root <dir>` wrote the
  // inventory there, and `--no-snapshot` changes what is persisted, not where the project is.
  const routesRoot = typeof p.flags.root === "string" && p.flags.root ? resolve(p.flags.root) : process.cwd();
  let maxRoutes = ALL_ROUTES_MAX;
  let routePlan: ReturnType<typeof routesToScan> | undefined;
  if (allRoutes) {
    const inventory = readRoutes(routesRoot);
    if (!inventory) {
      console.error(
        lang === "fr"
          ? "ultra11y scan : --all-routes lit l'inventaire des routes (.ultra11y/routes.json) — créez-le d'abord avec `ultra11y pages discover --sitemap <url> | --crawl <url> | --from-snapshots --write` (ou `--routes-only`)."
          : "ultra11y scan: --all-routes reads the route inventory (.ultra11y/routes.json) — create it first with `ultra11y pages discover --sitemap <url> | --crawl <url> | --from-snapshots --write` (or `--routes-only`).",
      );
      return 2;
    }
    if (typeof p.flags["max-routes"] === "string") {
      const n = Number(p.flags["max-routes"]);
      if (!Number.isInteger(n) || n < 0) {
        console.error(`ultra11y scan: --max-routes must be a non-negative integer (got "${p.flags["max-routes"]}").`);
        return 2;
      }
      maxRoutes = n;
    }
    const recorded = readSnapshots(routesRoot).map((s) => ({ id: s.meta.id, url: s.meta.url, ...(s.meta.runner ? { runner: s.meta.runner } : {}) }));
    routePlan = routesToScan(inventory, { ...(useSample && sampleConfig ? { sample: sampleConfig.pages } : {}), captured: recorded, max: maxRoutes });
    console.error(
      lang === "fr"
        ? `ultra11y scan : ${inventory.routes.length} route(s) inventoriée(s) — ${useSample && sampleConfig ? `${sampleConfig.pages.length} page(s) d'échantillon, puis ` : ""}${routePlan.scan.length} route(s) hors échantillon à scanner, ${routePlan.captured.length} déjà capturée(s) par les tests E2E${routePlan.bounded.length ? `, ${routePlan.bounded.length} au-delà de --max-routes ${maxRoutes} (listées « non atteintes »)` : ""}.`
        : `ultra11y scan: ${inventory.routes.length} inventoried route(s) — ${useSample && sampleConfig ? `${sampleConfig.pages.length} sample page(s), then ` : ""}${routePlan.scan.length} route(s) beyond the sample to scan, ${routePlan.captured.length} already captured by the E2E tests${routePlan.bounded.length ? `, ${routePlan.bounded.length} beyond --max-routes ${maxRoutes} (listed "not reached")` : ""}.`,
    );
  }

  let dynamic: DynamicResult;
  try {
    if (allRoutes && routePlan) {
      const sampleRun =
        useSample && sampleConfig
          ? await runSampleScanLocal(sampleConfig.pages, { cwd, storageState, lang, interact, interactClicks, snapshotRoot, browserPath })
          : undefined;
      const restRun = routePlan.scan.length
        ? await runScanManyLocal(routePlan.scan, { cwd, storageState, lang, interact, interactClicks, snapshotRoot, browserPath })
        : undefined;
      if (!sampleRun && !restRun) {
        console.error(
          lang === "fr"
            ? "ultra11y scan : rien à scanner — chaque route de l'inventaire est déjà capturée par les tests E2E, ou exclue par --max-routes 0."
            : "ultra11y scan: nothing to scan — every inventory route is already captured by the E2E tests, or excluded by --max-routes 0.",
        );
        return 0;
      }
      dynamic = combineDynamic(sampleRun, restRun);
    } else if (useSample && sampleConfig) {
      dynamic = await runSampleScanLocal(sampleConfig.pages, { cwd, storageState, lang, interact, interactClicks, snapshotRoot, browserPath });
    } else if (sitemap || crawl) {
      const depth = typeof p.flags.depth === "string" ? Number(p.flags.depth) : undefined;
      const max = typeof p.flags.max === "string" ? Number(p.flags.max) : undefined;
      // A sweep is unbounded by default, so it has to SAY what it is walking. On stderr, so
      // `--json` on stdout stays machine-readable, and one line per page: without it a crawl
      // of a large site is indistinguishable from a hung job, which is the only real cost of
      // dropping the cap.
      const onPage = (url: string, n: number): void => console.error(`ultra11y scan: page ${n} — ${url}`);
      dynamic = await runCrawlScanLocal({ sitemap, crawl, depth, max, onPage, cwd, storageState, lang, interact, interactClicks, snapshotRoot, browserPath });
    } else {
      const targets = p.positionals.filter((a) => a !== "-");
      if (targets.length === 0) {
        console.error("ultra11y scan: provide one or more URLs/HTML files, --sitemap <url>, --crawl <url>, or --sample.");
        return 2;
      }
      dynamic =
        targets.length === 1
          ? await runScanLocal({ target: targets[0]!, cwd, storageState, lang, interact, interactClicks, snapshotRoot, browserPath })
          : await runScanManyLocal(targets, { cwd, storageState, lang, interact, interactClicks, snapshotRoot, browserPath });
    }
  } catch (e) {
    console.error(`ultra11y scan: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  // Pages the scan refused to file, because the browser ended up on another route. Loud, and
  // on stderr: a silently shorter sample is indistinguishable from a sample that passed, and
  // the cause is always fixable — an expired session, or state the wizard step needs.
  if (dynamic.redirected?.length) {
    for (const r of dynamic.redirected) {
      const why =
        r.reason === "http-status"
          ? lang === "fr"
            ? `a répondu HTTP ${r.status} à la même adresse`
            : `answered HTTP ${r.status} at the same address`
          : r.reason === "error"
            ? // Named rather than folded into the redirect wording: « a redirigé vers » its own
              // address is a sentence that explains nothing, and the browser's message is the
              // one fact that says which page to go and look at.
              lang === "fr"
              ? `a fait échouer le navigateur${r.detail ? ` — ${r.detail}` : ""}`
              : `made the browser fail${r.detail ? ` — ${r.detail}` : ""}`
            : lang === "fr"
              ? `a redirigé vers ${r.landed}`
              : `redirected to ${r.landed}`;
      console.error(
        lang === "fr"
          ? `⚠️ ultra11y scan : « ${r.name} » (${r.id}) non enregistrée — ${r.requested} ${why}. L'enregistrer aurait décrit cet écran sous le nom demandé.`
          : `⚠️ ultra11y scan: "${r.name}" (${r.id}) not recorded — ${r.requested} ${why}. Recording it would have described that screen under the requested name.`,
      );
    }
    // Every page refused is not a partial result, it is a scan that measured nothing. Exiting
    // 0 there would hand CI a green step and an empty report — the exact shape of a run that
    // passed. The usual cause is one fixable thing (an expired session, a wrong base URL),
    // so failing here is what makes it visible on the first run instead of the tenth.
    const sampleIds = new Set((sampleConfig?.pages ?? []).map((pg) => pg.id));
    if (useSample && sampleConfig && dynamic.redirected.filter((r) => sampleIds.has(r.id)).length === sampleConfig.pages.length) {
      console.error(
        lang === "fr"
          ? `ultra11y scan : aucune des ${sampleConfig.pages.length} pages de l'échantillon n'a pu être enregistrée — rien n'a été mesuré. Vérifiez la session, l'URL de base et l'état applicatif attendu par ces pages.`
          : `ultra11y scan: none of the ${sampleConfig.pages.length} sample pages could be recorded — nothing was measured. Check the session, the base URL, and the application state those pages expect.`,
      );
      return 1;
    }
  }
  // Advisory sample-methodology lint: which normative page KINDS the configured sample
  // lacks. Standard-agnostic mechanics + RGAA-specific required kinds; scan has no
  // --standard, so we lint against the config's default standard (else RGAA if registered).
  // Never a gate — a warning only.
  if (useSample && sampleConfig) {
    const lintKey = typeof p.flags.standard === "string" && p.flags.standard ? p.flags.standard : "rgaa";
    try {
      const pack = getPack(resolveStandard(lintKey));
      const methodology = pack?.sampleMethodology;
      if (methodology) {
        const { missing } = lintSample(sampleConfig, methodology);
        if (missing.length)
          console.error(
            (lang === "fr"
              ? `⚠️ Échantillon incomplet — types de page requis absents (${pack.name}) : `
              : `⚠️ Incomplete sample — required page kinds missing (${pack.name}): `) + missing.map((k) => kindLabel(k, pack.defaultLocale)).join(", "),
          );
      }
    } catch {
      /* unknown standard for lint — skip advisory */
    }
  }
  // THE DOCUMENTS THE PAGES LINK TO. Same-origin candidates (a `.pdf` path, `download`, a text or
  // a route naming PDF) that answer a PDF, bounded in count and size, stored by content hash under
  // .ultra11y/documents with a sidecar naming the URL and the linking pages — so the snapshot audit
  // below reads them, and a later `audit` re-reads them offline. The session that opened the pages
  // opens their documents: `--storage-state` (or a sample page's own) sends its matching cookies.
  let documentFiles: string[] = [];
  if (dynamic.snapshots?.length && p.flags["no-pdf"] !== true) {
    const maxPdf = typeof p.flags["max-pdf"] === "string" ? Number(p.flags["max-pdf"]) : undefined;
    const pageStates = new Map(
      (useSample && sampleConfig ? sampleConfig.pages : []).flatMap((pg) => (pg.storageState ? [[pg.id, pg.storageState] as const] : [])),
    );
    const docs = await downloadSnapshotDocuments(snapshotRoot ?? ".", dynamic.snapshots, {
      ...(maxPdf !== undefined && Number.isFinite(maxPdf) && maxPdf >= 0 ? { maxCount: maxPdf } : {}),
      ...(storageState ? { storageState } : {}),
      ...(pageStates.size ? { storageStateFor: (id: string) => pageStates.get(id) } : {}),
    });
    documentFiles = docs.files;
    if (docs.files.length)
      console.error(
        lang === "fr"
          ? `ultra11y scan : ${docs.files.length} document(s) PDF téléchargé(s) dans ${DOCUMENTS_DIR}/.`
          : `ultra11y scan: ${docs.files.length} PDF document(s) downloaded to ${DOCUMENTS_DIR}/.`,
      );
    for (const s of docs.skipped)
      console.error(
        lang === "fr"
          ? `⚠️ ultra11y scan : document non téléchargé — ${s.url} : ${s.reason}.`
          : `⚠️ ultra11y scan: document not downloaded — ${s.url}: ${s.reason}.`,
      );
  }
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : "audits";
  const mergeIn = p.flags.merge;
  if (typeof mergeIn === "string" && mergeIn) {
    let audit: AuditResult;
    if (mergeAudit) {
      audit = mergeAudit; // already loaded + validated above for lang resolution
    } else {
      let parsed: unknown;
      try {
        parsed = unwrapAudit(JSON.parse(readText(mergeIn)));
      } catch {
        console.error("ultra11y scan: --merge is not valid JSON (expected an AuditResult).");
        return 2;
      }
      if (!isCurrentAudit(parsed)) {
        console.error("ultra11y scan: --merge input is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
        return 2;
      }
      audit = parsed;
    }
    let merged = mergeDynamic(audit, dynamic, lang);
    // Run the STATIC engine over the snapshots this scan just wrote, and fold the result in.
    // Recording the pages without auditing them would grant every clean criterion a `C`
    // nobody measured; auditing them is what makes a scanned page a real per-page verdict —
    // and what finally lets the page-scoped rules (lang, title, main landmark) run at all.
    if (dynamic.snapshots?.length) {
      const doms = dynamic.snapshots.map((id) => join(snapshotRoot ?? ".", PAGES_DIR, id, "dom.html")).filter((f) => existsSync(f));
      if (doms.length) {
        const snapAudit = runAudit({ inputs: [...doms, ...documentFiles], onWarn: (m) => console.error(m) });
        merged = mergeSnapshotAudit(merged, snapAudit);
      }
      // Record the pages in scope so the per-page grid rebuilds from this JSON alone, and
      // attribute the findings that can be attributed. `pageScopesFrom` is what stamps
      // `basis: "snapshot"` — legitimate now, and only now, that the rules have run.
      const scope = pageScopesFrom(readSnapshots(snapshotRoot ?? "."));
      if (scope.length) {
        merged.scope.pages = scope;
        attributePages(merged, scope);
      }
    }
    // Every inventory route, and how it was observed — including the ones this scan refused
    // and the ones --max-routes left out.
    stampRoutes(merged, routesRoot, lang, {
      ...(dynamic.redirected ? { refused: dynamic.redirected } : {}),
      ...(routePlan?.bounded.length ? { bounded: routePlan.bounded, max: maxRoutes } : {}),
      // What this run scanned, read from the run itself rather than from the snapshots on
      // disk: under --no-snapshot there are none, and the routes it visited are still scanned.
      ...(dynamic.scanned?.length ? { scanned: dynamic.scanned } : {}),
    });
    mkdirSync(out, { recursive: true });
    const mergedDocument = auditDocumentFor(merged, standard, lang);
    writeFileSync(join(out, "audit-latest.json"), JSON.stringify(mergedDocument, null, 2) + "\n");
    if (p.flags.json)
      console.log(
        JSON.stringify(
          // `pages` opens the printed document: what this scan recorded (the
          // .ultra11y/pages ids) and refused, which the stderr warnings alone don't make
          // countable. An extra top-level key the `--in` readers never look at, so the
          // document beside it stays pipeable into report/verify — and the file above
          // keeps the plain audit schema.
          { pages: scanPageSummary(dynamic, sampleConfig?.pages.length), ...mergedDocument },
          null,
          2,
        ),
      );
    else {
      console.log(
        lang === "fr"
          ? `Audit statique + dynamique fusionné → ${join(out, "audit-latest.json")} (${merged.conformancePct}% de réussite automatique, ${merged.findings.length} findings).`
          : `Static + dynamic audit merged → ${join(out, "audit-latest.json")} (${merged.conformancePct}% automatic pass rate, ${merged.findings.length} findings).`,
      );
      if (dynamic.snapshots?.length)
        console.log(
          lang === "fr"
            ? `${dynamic.snapshots.length} instantané(s) de page écrit(s) dans ${PAGES_DIR}/ — committez-les pour auditer ces pages hors ligne (\`ultra11y pages\`).`
            : `${dynamic.snapshots.length} page snapshot(s) written to ${PAGES_DIR}/ — commit them to audit those pages offline (\`ultra11y pages\`).`,
        );
    }
    return 0;
  }
  if (p.flags.json) console.log(JSON.stringify(dynamic, null, 2));
  else {
    console.log(
      lang === "fr"
        ? `Audit dynamique (${dynamic.engine}) de ${dynamic.target} — ${dynamic.findings.length} non-conformité(s) :`
        : `Dynamic audit (${dynamic.engine}) of ${dynamic.target} — ${dynamic.findings.length} non-conformity(ies):`,
    );
    for (const f of dynamic.findings.slice(0, 30)) console.log(`  [${f.criteriaId}] ${f.selector} — ${f.message}`);
    if (dynamic.snapshots?.length)
      console.log(
        lang === "fr"
          ? `\n${dynamic.snapshots.length} instantané(s) de page écrit(s) dans ${PAGES_DIR}/ — \`ultra11y audit\` les reprend automatiquement.`
          : `\n${dynamic.snapshots.length} page snapshot(s) written to ${PAGES_DIR}/ — \`ultra11y audit\` picks them up automatically.`,
      );
  }
  return 0;
}

/** `sample check` — advisory lint of the configured page sample (`.ultra11yrc.json`
 *  `sample` block) against a standard's normative methodology: which REQUIRED page kinds it
 *  lacks. A malformed sample is a hard error (exit 2); a merely-incomplete one is advisory
 *  (exit 0) — the sample is opt-in and the missing kinds are guidance, not a gate. */
function cmdSample(p: ParsedArgs): number {
  const action = p.positionals[0];
  // Default the lint standard to the config's default (copied to --standard in main) else
  // RGAA (the standard that ships a sampleMethodology). WCAG core carries none.
  const key = typeof p.flags.standard === "string" && p.flags.standard ? p.flags.standard : "rgaa";
  let standard: StandardId;
  try {
    standard = resolveStandard(key);
  } catch (e) {
    console.error(`ultra11y sample: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  const lang = resolveLang(p.flags, { standard });
  if (action !== "check") {
    console.error("ultra11y sample: expected `sample check [--standard <pack>]`.");
    return 2;
  }
  let cfg: ReturnType<typeof loadConfig>;
  try {
    cfg = loadConfig(process.cwd());
  } catch (e) {
    console.error(`ultra11y sample: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
  if (!cfg?.sample) {
    console.error(
      lang === "fr"
        ? "ultra11y sample : aucun bloc `sample` dans .ultra11yrc.json — ajoutez `sample.pages` (échantillon de pages représentatives)."
        : "ultra11y sample: no `sample` block in .ultra11yrc.json — add `sample.pages` (the representative page sample).",
    );
    return 2;
  }
  const v = validateSample(cfg.sample);
  if (!p.flags.json) for (const w of v.warnings) console.error(`⚠ ${w.path ? `${w.path}: ` : ""}${w.message}`);
  if (!v.ok || !v.sample) {
    if (p.flags.json) console.log(JSON.stringify({ ok: false, issues: v.issues, warnings: v.warnings }, null, 2));
    else {
      console.error(lang === "fr" ? "✗ Bloc `sample` invalide :" : "✗ Invalid `sample` block:");
      for (const i of v.issues) console.error(`  ✗ ${i.path ? `${i.path}: ` : ""}${i.message}`);
    }
    return 2;
  }
  const pack = isCore(standard) ? null : getPack(standard);
  const methodology = pack?.sampleMethodology;
  if (!methodology) {
    if (p.flags.json)
      console.log(
        JSON.stringify({ ok: true, pages: v.sample.pages.length, missing: [], warnings: v.warnings, note: "no sample methodology for this standard" }, null, 2),
      );
    else
      console.log(
        lang === "fr"
          ? `✓ Échantillon valide (${v.sample.pages.length} page(s)). Le référentiel actif (${standardLabelSafe(standard)}) ne définit pas de méthodologie d'échantillon — rien à vérifier.`
          : `✓ Sample valid (${v.sample.pages.length} page(s)). The active standard (${standardLabelSafe(standard)}) defines no sample methodology — nothing to check.`,
      );
    return 0;
  }
  // BOTH INVENTORIES. Linting the declared list alone is how `sample check` pronounced an
  // échantillon "complete" for a configuration that omitted the very URL the certifying audit
  // was run on, while the test suite had been snapshotting that page all along. The union is
  // what the standard is actually checked over; the drift is reported either way.
  const root = typeof p.flags.root === "string" && p.flags.root ? p.flags.root : ".";
  const snapshotted = sampleFromSnapshots(readSnapshots(root));
  const union = unionSample(v.sample, snapshotted);
  const { missing, waived } = lintSample(union.sample, methodology);
  const loc = pack?.defaultLocale ?? "fr";
  const counts = {
    declared: v.sample.pages.length,
    snapshotted: snapshotted.length,
    undeclared: union.undeclared.length,
    uncaptured: union.uncaptured.length,
  };
  if (p.flags.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          pages: union.sample.pages.length,
          ...counts,
          undeclaredPages: union.undeclared.map((x) => ({ id: x.id, url: x.url })),
          uncapturedPages: union.uncaptured.map((x) => ({ id: x.id, url: x.url })),
          missing: missing.map((k) => ({ id: k.id, label: kindLabel(k, loc) })),
          waived: waived.map((w) => ({ id: w.kind.id, label: kindLabel(w.kind, loc), reason: w.reason })),
          warnings: v.warnings,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  // The census prints unconditionally and BEFORE the verdict, so the verdict can never be read
  // as a statement about an inventory it did not see.
  console.log(
    lang === "fr"
      ? `${counts.declared} déclarée(s) · ${counts.snapshotted} instantanée(s) · ${counts.undeclared} instantanée(s) non déclarée(s) · ${counts.uncaptured} déclarée(s) jamais capturée(s)`
      : `${counts.declared} declared · ${counts.snapshotted} snapshotted · ${counts.undeclared} snapshotted but undeclared · ${counts.uncaptured} declared but never captured`,
  );
  // A kind can be absent for a good reason — it cannot be absent for no reason. A recorded one
  // is listed with its reason, so the omission stays visible without nagging.
  for (const w of waived) console.log(`ℹ️ ${kindLabel(w.kind, loc)} — ${lang === "fr" ? "absent, raison consignée" : "absent, reason recorded"} : ${w.reason}`);
  if (missing.length) {
    console.log(
      (lang === "fr"
        ? `⚠️ Échantillon incomplet (${union.sample.pages.length} page(s)) — types de page requis absents (${pack!.name}) :`
        : `⚠️ Incomplete sample (${union.sample.pages.length} page(s)) — required page kinds missing (${pack!.name}):`) +
        ` ${missing.map((k) => kindLabel(k, loc)).join(", ")}`,
    );
    const page = missing.find((k) => !isTransverseKind(k));
    if (page)
      console.log(
        lang === "fr"
          ? `   Ajoutez la page, ou consignez pourquoi l'échantillon n'en a pas : "absent": [{ "kind": "${page.id}", "reason": "…" }] dans le bloc sample (\`pages discover --propose\` le fait pour les types qu'il ne trouve pas).`
          : `   Add the page, or record why the sample has none: "absent": [{ "kind": "${page.id}", "reason": "…" }] in the sample block (\`pages discover --propose\` does so for the kinds it finds no page for).`,
      );
    if (missing.some(isTransverseKind))
      console.log(
        lang === "fr"
          ? `   Les éléments transverses se déclarent dans "transverse": ["En-tête", "Navigation", "Pied de page"].`
          : `   Transverse elements are declared in "transverse": ["Header", "Navigation", "Footer"].`,
      );
  } else if (counts.undeclared > 0) {
    // Complete over the union, but the declared sample is NOT the audited surface. Saying
    // "complete" flat here is the sentence the reporter's project acted on.
    console.log(
      lang === "fr"
        ? `⚠️ Types de page requis couverts, mais l'échantillon déclaré n'est pas la surface auditée : ${counts.undeclared} page(s) instantanée(s) n'y figurent pas (${union.undeclared
            .slice(0, 5)
            .map((x) => x.id)
            .join(", ")}${counts.undeclared > 5 ? ", …" : ""}). Déclarez-les avec \`pages discover --from-snapshots --write\`.`
        : `⚠️ Required page kinds covered, but the declared sample is not the audited surface: ${counts.undeclared} snapshotted page(s) are absent from it (${union.undeclared
            .slice(0, 5)
            .map((x) => x.id)
            .join(", ")}${counts.undeclared > 5 ? ", …" : ""}). Declare them with \`pages discover --from-snapshots --write\`.`,
    );
  } else {
    console.log(
      lang === "fr"
        ? `✓ Échantillon complet (${union.sample.pages.length} page(s)) — tous les types de page requis par ${pack!.name} sont couverts${waived.length ? " ou consignés absents avec leur raison" : ""}.`
        : `✓ Sample complete (${union.sample.pages.length} page(s)) — every page kind ${pack!.name} requires is covered${waived.length ? " or recorded absent with a reason" : ""}.`,
    );
  }
  if (counts.uncaptured > 0) {
    console.log(
      lang === "fr"
        ? `ℹ️ ${counts.uncaptured} page(s) déclarée(s) n'ont aucun instantané — le rapport par page ne pourra rien conclure de leur silence.`
        : `ℹ️ ${counts.uncaptured} declared page(s) have no snapshot — the per-page report can conclude nothing from their silence.`,
    );
  }
  return 0;
}

/** standardLabel that never throws for the core (used in an advisory message). */
function standardLabelSafe(standard: StandardId): string {
  return isCore(standard) ? "WCAG 2.2 AA" : (getPack(standard)?.name ?? standard);
}

function cmdPack(p: ParsedArgs): number {
  const action = p.positionals[0];
  const lang = resolveLang(p.flags, {}); // pack has no --standard (it validates a pack, not runs against one)
  if (action === "scaffold") {
    console.log(packScaffold());
    return 0;
  }
  if (action === "check") {
    const packPath = p.positionals[1];
    if (!packPath) {
      console.error("ultra11y pack check: provide a pack JSON file — `pack check <pack.json> [--guidance <g.json>]`.");
      return 2;
    }
    const guidance = typeof p.flags.guidance === "string" && p.flags.guidance ? (p.flags.guidance as string) : undefined;
    const res = runPackCheck(packPath, guidance);
    if (p.flags.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      for (const w of res.warnings) console.error(`⚠ ${w}`);
      if (res.ok) console.log(lang === "fr" ? `✓ Pack valide${guidance ? " (+ guidance)" : ""}.` : `✓ Pack valid${guidance ? " (+ guidance)" : ""}.`);
      else for (const e of res.errors) console.error(`✗ ${e}`);
    }
    return res.ok ? 0 : 1;
  }
  console.error("ultra11y pack: expected `pack check <pack.json> [--guidance <g.json>]` or `pack scaffold`.");
  return 2;
}

function cmdOrchestrate(p: ParsedArgs): number {
  const lang = resolveLang(p.flags, {});
  const runFlag = p.flags.run;
  if (typeof runFlag !== "string" || !runFlag) {
    console.error(
      lang === "fr"
        ? "ultra11y orchestrate : --run <dir> est requis (le dossier du run contenant les worklists)."
        : "ultra11y orchestrate: --run <dir> is required (the run dir holding the worklists).",
    );
    return 2;
  }
  const engineAbs = realpathSync(fileURLToPath(import.meta.url));
  if (p.flags.list === true) {
    if (!existsSync(runFlag)) {
      console.error(`ultra11y orchestrate: run dir not found: ${runFlag}.`);
      return 2;
    }
    console.log(JSON.stringify({ phases: listPhases(runFlag, engineAbs) }, null, 2));
    return 0;
  }
  // --manifest: the loop as data for an orchestrator that is not Claude Code (#82) — every step's
  // command, inputs/outputs, exit contract and successor. Read-only and always JSON.
  if (p.flags.manifest === true) {
    if (!existsSync(runFlag)) {
      console.error(`ultra11y orchestrate: run dir not found: ${runFlag}.`);
      return 2;
    }
    console.log(JSON.stringify(buildManifest(runFlag, engineAbs), null, 2));
    return 0;
  }
  const res = orchestrateRun(runFlag, engineAbs, {
    phase: typeof p.flags.phase === "string" && p.flags.phase ? p.flags.phase : undefined,
    eco: p.flags.eco === true,
  });
  if (res.exitCode !== 0) {
    for (const e of res.errors) console.error(`ultra11y orchestrate: ${e}`);
    return res.exitCode;
  }
  console.log(lang === "fr" ? "ultra11y orchestrate : généré" : "ultra11y orchestrate: generated");
  for (const w of res.written) console.log(`  ${w}`);
  for (const n of res.notices) console.error(`ultra11y orchestrate: note — ${n}`);
  const workflows = res.written.filter((w) => w.endsWith(".workflow.mjs"));
  const batchFiles = res.written.filter((w) => w.endsWith(".batches.json"));
  if (workflows.length) {
    console.log("");
    for (const b of batchFiles)
      console.log(
        lang === "fr"
          ? `Lots : ${b} — tout harness : confiez chaque prompt de ${b.replace(/\.batches\.json$/, "")}/ tel quel à un sous-agent, et enregistrez son JSON au chemin \`output\` du lot.`
          : `Batches: ${b} — any harness: hand each prompt in ${b.replace(/\.batches\.json$/, "")}/ verbatim to one subagent, and save its JSON at the batch's \`output\` path.`,
      );
    for (const w of workflows) console.log(`Launch: Workflow({ scriptPath: ${JSON.stringify(w)} })`);
    console.log(
      lang === "fr"
        ? "Puis fusionnez les fragments retournés dans la worklist et lancez le `verify --apply` indiqué en fin de prompt ou de workflow (vous restez le seul écrivain)."
        : "Then fold the returned fragments into the worklist and run the `verify --apply` shown at the end of each prompt or workflow (you stay the sole writer).",
    );
  } else {
    console.log(
      lang === "fr"
        ? `Suivez ${join(runFlag, "orchestration", "RUNBOOK.md")} séquentiellement (chemin éco).`
        : `Follow ${join(runFlag, "orchestration", "RUNBOOK.md")} sequentially (the eco path).`,
    );
  }
  // Surface the valid phase names once, so a scripted caller can discover them without --help.
  if (p.flags.phase === undefined && workflows.length === 0 && p.flags.eco !== true) {
    const anyReady = res.phases.some((ph) => ph.ready);
    console.error(
      anyReady
        ? "ultra11y orchestrate: every ready phase has an empty worklist — nothing to fan out (see --list)."
        : `ultra11y orchestrate: no ready phase — phases are ${PHASES.join(", ")} (see --list).`,
    );
  }
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const first = argv[0];

  if (!first || first === "-h" || first === "--help") {
    console.log(HELP);
    return 0;
  }
  if (first === "-v" || first === "--version") {
    console.log(VERSION);
    return 0;
  }
  const removedCommand = REMOVED_COMMANDS[first];
  if (removedCommand) {
    console.error(`ultra11y: "${first}" is no longer a command — ${removedCommand}`);
    return 2;
  }
  if (!isCommand(first)) {
    console.error(`ultra11y: unknown command "${first}". Run \`ultra11y --help\`.`);
    return 2;
  }

  const p = parseArgs(argv);
  // `<cmd> --help` / `<cmd> -h` shows help with NO side effects. Without this every
  // subcommand ignored the flag and ran — and `init --help` would write a hook
  // into the cwd repo.
  if (p.flags.help === true || p.flags.h === true) {
    console.log(HELP);
    return 0;
  }
  // A REMOVED flag must not fall through to the generic "unknown flag (ignored)" warning
  // below: a scripted CI would keep exiting 0 while filing (or gating) nothing at all. Name
  // the replacement and fail.
  for (const f of p.unknown) {
    const replacement = REMOVED_FLAGS[f];
    if (replacement) {
      console.error(`ultra11y: --${f} was ${replacement}`);
      return 2;
    }
  }
  for (const [flag, values] of Object.entries(REMOVED_FLAG_VALUES)) {
    const v = p.flags[flag];
    const replacement = typeof v === "string" && Object.hasOwn(values, v) ? values[v] : undefined;
    if (replacement) {
      console.error(`ultra11y: --${flag} ${v} was ${replacement}`);
      return 2;
    }
  }
  // Warn (never silently ignore) on misspelled/unknown flags so `--grph` or
  // `--standrd rgaa` can't quietly leave cross-file/a standard disabled.
  for (const f of p.unknown) console.error(`ultra11y: unknown flag --${f} (ignored). Run \`ultra11y --help\`.`);

  // Enum-valued flags: warn (never silently coerce) on an unsupported value so `--lang de`
  // or `--dedup fuzzy` is visible instead of quietly falling back to the default.
  // This check runs BEFORE dispatch, so it cannot know which command owns the flag: the
  // allowed set must be the UNION over every command that takes it — listing only one
  // command's values makes the guard cry wolf on valid input, which teaches the reader to
  // ignore the warning that is meant to catch a typo. Per-command validation is each cmdX's
  // own job (cmdReport, cmdPages…), and stays strict.
  const ENUM_FLAGS: Record<string, readonly string[]> = {
    lang: ["auto", "en", "fr"],
    dedup: ["exact", "normalized", "off"],
    format: ["audit", "doc", "grid", "report"],
    split: ["criterion", "page"],
    runtime: ["auto", "local"],
    provider: ["auto", "github", "gitlab", "jira"],
    grain: ["criterion", "page", "page-criterion", "single", "file"],
    transport: ["auto", "cli", "rest"],
  };
  for (const [flag, allowed] of Object.entries(ENUM_FLAGS)) {
    const v = p.flags[flag];
    if (typeof v === "string" && v && !allowed.includes(v)) console.error(`ultra11y: --${flag} "${v}" is not one of ${allowed.join("|")} — using the default.`);
  }

  // Load any runtime standards packs (--pack / .ultra11yrc.json) BEFORE resolving
  // --standard, so an external pack is registered when stdOf/loadPack runs. A bad
  // config or an invalid pack is a hard error (never a silent skip).
  const packList =
    typeof p.flags.pack === "string"
      ? (p.flags.pack as string)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const loaded = loadRuntimeStandards(process.cwd(), packList, (m) => console.error(m), p.flags.override === true);
  if (loaded.errors.length) {
    for (const e of loaded.errors) console.error(`ultra11y: ${e}`);
    return 2;
  }
  if (loaded.defaultStandard && p.flags.standard === undefined) p.flags.standard = loaded.defaultStandard;

  switch (p.command as Command) {
    case "audit":
      return cmdAudit(p);
    case "report":
      return cmdReport(p);
    case "tickets":
      return cmdTickets(p);
    case "prd":
      return cmdPrd(p);
    case "render":
      return cmdRender(p);
    case "criteria":
      return cmdCriteria(p);
    case "check":
      return cmdCheck(p);
    case "verify":
      return cmdVerify(p);
    case "scan":
      return cmdScan(p);
    case "sample":
      return cmdSample(p);
    case "snapshot":
      return cmdSnapshot(p);
    case "pages":
      return cmdPages(p);
    case "fix":
      return cmdFix(p);
    case "init":
      return cmdInit(p);
    case "pack":
      return cmdPack(p);
    case "orchestrate":
      return cmdOrchestrate(p);
    case "hook":
      return cmdHook(p);
    case "install":
      return cmdInstall(p);
    case "uninstall":
      return cmdUninstall(p);
    case "status":
      return cmdStatus(p);
    default:
      console.error(`ultra11y: "${p.command}" is not implemented yet`);
      return 1;
  }
}

// Only run when invoked directly (node scripts/ultra11y.mjs), not when imported
// by tests. Realpath both sides: Node canonicalizes import.meta.url but leaves
// process.argv[1] as-typed, so on a symlinked path (macOS /tmp → /private/tmp)
// a raw URL compare silently fails and main() never runs.
function isInvokedDirectly(): boolean {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    if (realpathSync(argv1) === realpathSync(modulePath)) return true;
  } catch {
    /* a path may be virtual — fall through */
  }
  return import.meta.url === pathToFileURL(argv1).href;
}

// Set `process.exitCode` — never `process.exit()`. On a PIPE, stdout is asynchronous,
// so `process.exit()` tears the process down before the pending writes flush: a large
// `audit --json | jq` used to receive exactly 65536 bytes of truncated, invalid JSON.
// Letting the event loop drain naturally keeps the exit code AND the whole payload.
if (isInvokedDirectly()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
