import { realpathSync, writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync, copyFileSync } from "node:fs";
import { join, relative, resolve, sep, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  VERSION,
  type Lang,
  type AuditResult,
  type DynamicResult,
  type Finding,
  type PageResult,
  type PageScope,
  type SampleConfig,
  type SamplePage,
  type Severity,
  type Status,
} from "./types.js";
import { runAudit } from "./audit.js";
import { decide, type PreToolUsePayload } from "./hook.js";
import { writeReport, untestedNeedsRendering, partialAuditBanner } from "./report.js";
import { writePrd, prdUnits, type PrdFormat } from "./prd.js";
import { commentKindFrom, pushPrComment } from "./pr-comment.js";
import { buildTickets } from "./tickets/grain.js";
import { pushTickets } from "./tickets/push.js";
import { autoProvider, createProvider, isProviderId } from "./tickets/registry.js";
import { ALL_GRAINS, ALL_PROVIDERS, TICKET_SET_SCHEMA_VERSION, type TicketGrain, type TicketSetFile, type TransportMode } from "./tickets/types.js";
import {
  detectFrameworks,
  renderPlan,
  ssrHarness,
  captureSetup,
  captureSetupPlan,
  detectTestRunner,
  parseStorybookIndex,
  storyProvenance,
  type Detection,
} from "./render.js";
import { CAPTURES_DIR, computeCaptureCoverage, parseCaptureProvenance, formatCaptureComment, type CaptureEntry } from "./capture.js";
import { buildGraphStreaming } from "./graph/build.js";
import { discover } from "./discover.js";
import { toPosix, GRAPH_ONLY_EXT } from "./glob.js";
import { runCriteria, renderCriteriaReference } from "./criteria.js";
import { checkSampleCaptured, checkDecided, checkReport, checkSemantic, isUndecidedFile, type UndecidedFile } from "./check.js";
import { buildWorklist, writeWorklist, applyVerdicts, VERIFY_MAX, type VerifyItem } from "./verify.js";
import { groundItems } from "./grounding.js";
import {
  buildAdjudicationWorklist,
  formatAdjudication,
  writeAdjudication,
  applyAdjudication,
  hydrateAdjudication,
  type AdjudicationFile,
} from "./adjudicate.js";
import { entriesFrom, isLedger, ledgerPath, mergeLedger, readLedger, replayLedger, type VerdictLedger, writeLedger } from "./ledger.js";
import { BATCH_SIZE, apiKeyFromEnv, applyRawVerdicts, judgeAll, modelFromEnv } from "./llm.js";
import { runScan, runScanMany, runCrawlScan, runSampleScan, mergeDynamic, mergeSnapshotAudit, cleanDynamic, dockerAvailable } from "./scan.js";
import { runScanLocal, runScanManyLocal, runCrawlScanLocal, runSampleScanLocal, localAvailable, localTierStatus } from "./scan-local.js";
import { validateSample, lintSample, kindLabel, proposeSamplePages, mergeSample, sampleFromSnapshots, unionSample } from "./sample.js";
import { createAdapter } from "./external/registry.js";
import { diffSides, sideOfExternal, type DiffBucket } from "./external/diff.js";
import type { ExternalAdapter, ExternalAudit } from "./external/types.js";
import { runFix, fixSummary } from "./fix.js";
import { diffAgainstBaseline, baselineSummary, findingId, parseFailOn, findingsAtOrAbove } from "./baseline.js";
import { repoRoot, resolveEnginePath, writeHook, writeCi } from "./init.js";
import { installForTargets, parseTargets, statusReport, uninstallForTargets } from "./install/index.js";
import { agentsMdBlock } from "./install/agents-md.js";
import { auditSummary, captureCoverageSummary } from "./output.js";
import { toSarif } from "./sarif.js";
import { annotations, pagesComment, prComment, stepSummary } from "./annotate.js";
import { evidenceNotice, writeEvidence } from "./evidence.js";
import { writeHtml } from "./html-emit.js";
import {
  PAGES_DIR,
  readSnapshots,
  type SnapshotProbes,
  validateSnapshotMeta,
  writeSnapshot,
  type AxNode,
  type BoxDigest,
  type CssDigest,
  type StyleDigest,
} from "./snapshot.js";
import { attributePages, derivePages, pageScopesFrom, pageView, pagesOf, renderPageGrid, unattributedFindings } from "./pages.js";
import { pagesForStandard, renderPageDocument, renderPagesDocument, renderPagesIndex } from "./pages-report.js";
import { crawlUrls, extractTitle, parseSitemapUrls } from "./crawl.js";
import { DEV_DEFAULT_PORT, nextOverlayComponent, startDevServer, type DevServer } from "./dev.js";
import { cypressCommands, cypressPlugin, detectE2eRunner, e2eSetupPlan, playwrightFixture, type E2ePaths, type E2eRunner } from "./e2e.js";
import { resolveStandard, getPack, isCore, CORE, derivePackResults, type StandardId } from "./standards/index.js";
import { loadRuntimeStandards, loadConfig, type Ultra11yConfig } from "./config.js";
import { runPackCheck, packScaffold } from "./pack.js";
import { listPhases, orchestrateRun, PHASES } from "./orchestrate.js";
import { readStdin, readText } from "./util.js";
import { runStdioServer } from "./mcp/stdio.js";
import { startHttpServer } from "./mcp/http.js";
import type { RenderSignals } from "./types.js";

const HELP = `ultra11y v${VERSION}
Audit HTML/CSS/JSX against WCAG 2.2 AA and produce a dated compliance report, or
author/review accessible markup (native-HTML-first). A deterministic, install-free
static engine plus your judgment, with check/verify gates against hallucinated
non-conformities. RGAA (France) and other country standards are pluggable packs
(--standard <pack>); WCAG is the worldwide core.

Usage:
  ultra11y audit    <globs… | -> [--out <dir>] [--include <glob>] [--exclude <glob>] [--ext <list>] [--jsx] [--graph] [--json] [--lang auto|en|fr] [--no-default-excludes]
  ultra11y audit    [--changed | --since <ref> | --staged] [--max-files <n>] [--dedup exact|normalized|off] [--baseline <file>] [--fail-on blocking|major|minor]
  ultra11y audit    [--captures <dir>] [--no-captures] [--require-captures]   (rendered-DOM captures + .ultra11y/pages snapshots: audit real HTML)
  ultra11y audit    [--format sarif|github]        (CI: SARIF for code scanning, or inline annotations + job summary)
  ultra11y audit    --in <audit.json> [--fail-on blocking|major|minor] [--format sarif|github]   (re-gate an audit already computed — e.g. one carrying adjudicated verdicts — without a second detection pass)
  ultra11y report   --in <audit.json> [--out <dir>] [--standard <pack>] [--format sarif|github] [--lang auto|en|fr]
  ultra11y report   --in <audit.json> [--evidence [--evidence-max <n>]] [--out <dir>]   (the Markdown report, illustrated with annotated crops)
  ultra11y report   --in <audit.json> --html [--evidence] [--inline-budget <bytes>] [--out <dir>]   (index.html + a printable single file)
  ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc|remediation] [--no-technical] [--standard <pack>] [--lang auto|en|fr]
  ultra11y tickets  --in <audit.json> [--provider auto|github|gitlab|jira] [--grain criterion|page|page-criterion|single|file] [--transport auto|cli|rest]
  ultra11y tickets  [--out <dir>] [--max-tickets <n>] [--dry-run] [--json] [--standard <pack>] [--format audit|remediation] [--lang auto|en|fr]
  ultra11y render   [<dir>] [--scaffold | --setup | --e2e | --coverage | --storybook] [--runner playwright|cypress|auto] [--captures <dir>] [--out <file>] [--json] [--lang auto|en|fr]
  ultra11y criteria [<sc>] [--list] [--standard <pack> [--theme <N>]] [--generate] [--json] [--lang auto|en|fr]
  ultra11y criteria --standard <pack> --glossary [<term>]   (the terms the standard DEFINES — its tests depend on them)
  ultra11y check    --report <md> [--standard <pack>] [--in <audit.json>] [--semantic [--verdicts <file>]] [--quiet] [--json]
  ultra11y check    --in <audit.json> --require-decided [--standard <pack>] [--allow-undecided <file>]   (fail while any criterion is still « to assess »)
  ultra11y verify   --report <md> [--standard <pack>] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--out <dir>] [--json]
  ultra11y verify   --report <md> --in <audit.json> --manual [--out <dir>] [--json]   (adjudicate the manual criteria)
  ultra11y verify   --apply <adjudication.json> --in <audit.json> [--out <dir>]        (fold the adjudication into the audit)
  ultra11y orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list] [--lang auto|en|fr]
  ultra11y fix      <globs… | -> [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--include <glob>] [--exclude <glob>] [--ext <list>] [--only <ids>] [--jsx] [--json] [--lang auto|en|fr]
  ultra11y init     [--hook] [--ci] [--baseline] [--fail-on blocking|major|minor]
  ultra11y judge    --in <audit.json> [--standard <pack>] [--max <n>] [--model <id>] [--out <dir>] [--apply]   (adjudicate the manual criteria with a model — needs ANTHROPIC_API_KEY)
  ultra11y pack     check <pack.json> [--guidance <g.json>] [--json]  |  pack scaffold
  ultra11y scan     <url|file…> [--runtime auto|local|docker] [--cwd <dir>] [--storage-state <file>] [--no-interact] [--interact-clicks] [--no-snapshot] [--merge <audit.json>] [--out <dir>] [--json]
  ultra11y scan     --sample [--runtime …] [--cwd <dir>] [--storage-state <file>] [--merge <audit.json>] [--json]   (scan the .ultra11yrc.json page sample)
  ultra11y scan     --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--runtime …] [--cwd <dir>] [--merge <audit.json>] [--json]
  ultra11y scan     --clean        (remove the dynamic-tier Docker image + temp contexts)
  ultra11y sample   check [--standard <pack>] [--json]   (lint the .ultra11yrc.json page sample vs the standard's required page kinds)
  ultra11y snapshot write [--root <dir>] [--fail-on blocking|major|minor] [--json]   (payload on stdin → .ultra11y/pages/<id>/ + audit it)
  ultra11y snapshot list  [--root <dir>] [--json]
  ultra11y pages    --in <audit.json> [--standard <pack>] [--json] [--lang auto|en|fr]   (the per-page criterion grid)
  ultra11y pages    --in <audit.json> --format report [--split page] [--out <dir>]        (the per-page report, with screenshots)
  ultra11y pages    --in <audit.json> --format report --out <dir> [--evidence [--evidence-max <n>]] [--html]   (annotated crops of each non-conformity, and the HTML site)
  ultra11y pages    discover --sitemap <url> | --crawl <url> | --from-snapshots [--depth <n>] [--max <n>] [--write] [--json]   (build the page sample)
  ultra11y pages    --in <audit.json> --standard <pack> --diff <external.json>   (hold the grid against an audit someone else performed)
  ultra11y import   --from file <report.json> | --from ara <id> [--source <adapter>] [--out <dir>] [--json]
  ultra11y mcp      [--transport stdio|http] [--cwd <dir>] [--allow-write] [--port <n>] [--bind <addr>] [--allow-remote] [--allow-origin <o>] [--max-response-bytes <n>]
  ultra11y hook     --claude-code|--codex|--opencode   (internal: the PreToolUse hook; payload on stdin)
  ultra11y install   --claude-code | --codex | --opencode | --agents-md | --all  [--project] [--dry-run] [--no-skills]
  ultra11y uninstall --claude-code | --codex | --opencode | --agents-md | --all  [--project]
  ultra11y status   [--json] [--project]        (doctor: which agents will run the review by themselves)
  ultra11y dev      [--port <n>] [--root <dir>] [--standard <pack>] [--lang auto|en|fr]   (dev side-car: live overlay + per-page dashboard)
  ultra11y dev      --next [--port <n>]        (write the Next overlay component, then wire one line into your layout)

Commands:
  audit      Run the static engine over the inputs (files/globs, or '-' for stdin)
             and emit an AuditResult JSON keyed by WCAG 2.2 success criteria
             (consumed by 'report'). Without --json, prints a summary in --lang
             (default auto: repo <html lang> → the active standard's default locale
             → English). The engine decides the machine-detectable criteria; the AI
             agent adjudicates the judgment ones (verify --manual, gated) and the
             scan tier decides the needs-rendering ones. --format sarif|github emits
             the CI rendering instead of the summary (in --baseline gate mode it
             covers exactly the NEW findings, i.e. what the PR introduced).
  report     Render an AuditResult into a dated WCAG 2.2 AA compliance report
             (audits/wcag-YYYY-MM-DD.md): metadata, per-guideline synthesis table,
             non-conformities by priority, conforming + not-applicable lists.
             --standard <pack> writes a derived report for a country standard
             (e.g. --standard rgaa → audits/rgaa-YYYY-MM-DD.md).
             --format renders the same result for CI instead of Markdown: 'sarif'
             (SARIF 2.1.0 for GitHub code scanning, so findings land as inline PR
             annotations) or 'github' (::error:: workflow commands on stdout plus a
             job summary appended to $GITHUB_STEP_SUMMARY). Both honour --standard,
             so this is how you get an RGAA-keyed SARIF — audit itself is WCAG-keyed.
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
  render     Get RENDERED HTML to audit (so component libraries like DSFR are
             checked as the HTML they emit, not their JSX sources): detect the
             framework and print the build→audit recipe, or --scaffold a
             react-dom/server SSR snapshot harness to fill in. --setup installs the
             zero-touch test-render capture harvester (one setupFiles line → every
             component your tests render is snapshotted to .ultra11y/captures and
             audited). --setup captures COMPONENTS from unit tests; --e2e wires the
             audit into an existing Playwright/Cypress run instead, so a targeted PAGE
             is checked during the tests you already have — each checked page is
             persisted to .ultra11y/pages/<id>/ (DOM + computed styles + boxes) and can
             be re-audited later, offline, with no browser.
             --coverage reports which components have a rendered capture vs
             which are still opaque-source-only blind spots. --storybook attributes
             per-story HTML (via a storybook-static index) back to source components.
             Then audit the produced HTML, and use scan for the needs-rendering criteria.
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
  check      Integrity gate on a produced report: every cited criterion resolves,
             every NA is justified, sections + pass-rate maths are well-formed.
             --standard tells it which id grammar/registry to validate against.
  verify     Adversarial claim↔criterion worklist for the report's non-conformities,
             then (--apply) gate on refuted/unsupported findings.
  orchestrate  Emit the run's multi-agent orchestration from its CURRENT worklists:
             one launchable Workflow script per ready phase (adjudicate over
             ADJUDICATE.todo.json, verify-report over VERIFY.todo.json), the
             agents/<role>.md dispatch contracts they reference, and a sequential
             RUNBOOK.md fallback — absolute paths and the real worklist ids baked
             in. Subagents only RETURN verdict fragments; you (the caller) stay
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
             re-stages them, blocking only on issues that need judgment. Opt into the
             legacy regression gate with --baseline (audit --changed vs a committed
             audits/baseline.json, only NEW NCs fail) — also used by the --ci job
             (audit --since the PR base ref).
  pack       Author/verify a runtime standards pack. 'pack check <pack.json>
             [--guidance <g.json>]' runs the validator + guidance gate (every
             criterion maps to well-formed WCAG SCs, every guidance entry resolves to
             a real criterion, every code example parses) — the anti-hallucination
             gate for AI-ingested packs. 'pack scaffold' prints a blank pack to fill.
             Load packs at audit/report time with --pack (or .ultra11yrc.json).
  scan       OPTIONAL dynamic tier: run axe-core in a headless browser to decide the
             needs-rendering criteria the static engine can't — computed contrast
             (1.4.3), 320px reflow (1.4.10) — over a URL or HTML file. The local
             runtime (--runtime local, default when Playwright resolves from --cwd;
             no Docker) additionally probes focus visibility (2.4.7), 200% zoom
             (1.4.4), text spacing (1.4.12), content on hover (1.4.13) and target
             size (2.5.8), and accepts --storage-state for authenticated pages.
             By default the local runtime is STATEFUL: it types long values into
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
             render --e2e fixtures, the dev overlay) needs to know nothing about the
             on-disk format — one process per checked page. 'snapshot list' shows what
             has been captured. Because a snapshot is a FULL document (a component
             capture is a fragment), the page-scoped rules run on it: that is where
             html lang (RGAA 8.3) and page title (8.5/8.6) become decidable.
  dev        Development side-car: see the defects on the page you are BUILDING,
             while you build it. It serves a per-page dashboard on
             http://127.0.0.1:4111 and an overlay the app loads; every page you
             visit is snapshotted, audited and listed in a floating panel, each
             finding linking to its file:line (Next's launch-editor endpoint).
             --next writes the overlay component to wire into your layout — it
             renders NOTHING outside development. LOOPBACK ONLY: the server
             writes files, so it never binds beyond 127.0.0.1.
  mcp        Serve the engine over the Model Context Protocol, so an MCP client
             (Claude Code, an IDE) drives audit/report/criteria as tools instead of
             shelling out. --transport stdio (default) speaks over stdin/stdout;
             --transport http listens on 127.0.0.1 (--port, --bind), and stays
             loopback-only unless you pass --allow-remote. Read-only by default:
             --allow-write opts into the commands that touch files.
  hook       INTERNAL — the decision half of the Claude Code plugin's PreToolUse
             hook. Reads the payload on stdin; when a pending 'git commit', 'git
             push' or 'gh pr create' carries findings >= the threshold, prints the
             hook JSON that gets the review-a11y skill invoked, and prints nothing
             otherwise. Threshold: ULTRA11Y_HOOK_FAIL_ON, else hook.failOn in
             .ultra11yrc.json, else blocking. Disable with ULTRA11Y_HOOK=off or
             SKIP_A11Y=1. Called by hooks/pre-tool-use.mjs, not by hand.
  pages      The per-page criterion grid — RGAA is a per-page norm, the engine's
             verdict is scope-wide, and this bridges the two. One row per criterion
             (the pack's own under --standard), one column per page. Rebuilt from a
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
                     Given/When/Then); 'remediation' emits the legacy dev fix backlog
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
  --transport <t>    tickets: auto|cli|rest (mcp: stdio|http). 'auto' prefers the CLI (gh/glab),
                     falling back to REST when only a token is available. Jira is REST-only
  --max-tickets <n>  tickets: refuse to file more than n tickets in one run (default 200)
                     tickets --out <dir> also writes the tracker-agnostic set to
                     <dir>/issues-<date>.json, for a workflow engine to file itself
  --scaffold         render: write an SSR-snapshot harness (default: ultra11y-render.tsx)
  --setup            render: install the zero-touch test-render capture harvester (.ultra11y/capture-setup.mjs) + print the runner wiring
  --coverage         render: report rendered-capture coverage (covered vs blind-spot components); with --json emits the coverage object
  --storybook        render: attribute per-story HTML (via storybook-static index.json) into .ultra11y/captures (point the HTML dir with --captures)
  --captures <dir>   audit/render: rendered-capture dir to ingest (default: .ultra11y/captures)
  --no-captures      audit: do NOT auto-detect/ingest .ultra11y/captures nor .ultra11y/pages
  --e2e              render: write the Playwright/Cypress fixtures into .ultra11y/e2e/
  --runner <name>    render --e2e: force playwright|cypress instead of auto-detecting
  --root <dir>       snapshot: project root holding .ultra11y/pages (default: .)
  --port <n>         dev: port for the side-car (default: 4111); mcp: HTTP transport port
  --transport <k>    mcp: stdio (default) or http
  --bind <addr>      mcp --transport http: address to bind (default 127.0.0.1)
  --allow-remote     mcp --transport http: accept non-loopback connections (off by default)
  --allow-origin <o> mcp --transport http: an Origin allowed to call the server
  --max-response-bytes <n>  mcp: cap a tool response's size
  --allow-write      mcp: allow the tools that write files (read-only otherwise)
  --glossary [<t>]   criteria: look up a term the country standard defines (or list all)
  --next             dev: write the Next.js overlay component instead of serving
  --require-captures audit: gate — fail if any opaque/control component lacks a rendered capture (implies --graph)
  --write            fix: apply fixes to disk (default is a dry-run diff)
  --iterate          fix: with --write, re-audit + re-apply mechanical fixes until stable (bounded)
  --dry-run          fix: preview only — never write (this is the default)
  --safe             fix: apply only genuinely-automatic codemods (skip TODO placeholders / judgment proposals)
  --only <ids>       fix: limit auto-fixes to these rule ids (comma-separated)
  --baseline <file>  audit/init: regression-gate vs / write this baseline AuditResult
  --fail-on <sev>    audit/init: gate severity — blocking|major|minor (fr aliases accepted)  (default: blocking)
  --hook             init: write a git pre-commit accessibility gate (staged snapshot + auto-fix by default)
  --ci               init: write a GitHub Actions accessibility gate
  --report <file>    check/verify: the report markdown to gate
  --theme <N>        criteria: with --standard <pack>, list the pack's theme N
  --list             criteria: print the WCAG success criteria grouped by guideline
  --generate         criteria: emit the bundled references/criteria.md (WCAG 2.2 AA)
  --apply <file>     verify: reduce a filled verdicts file to a pass/fail gate
                     (requires --report — coverage is re-derived from the report, uncapped)
                     Also accepts an ADJUDICATION (--in <audit.json>), or a VERDICT LEDGER,
                     which it REPLAYS onto the audit with no model in the loop
  --ledger <file>    verify --apply / judge --apply: record the verdicts the fold ACCEPTED,
                     so a later run replays them for free (default:
                     .ultra11y/verdicts/<standard>.json). Replay re-derives the evidence
                     and re-runs the same gate; a verdict whose evidence changed is
                     dropped as stale and its criterion says so
  --max-verify <n>   verify: cap the worklist size; 0 = no cap           (default: 40)
  --verdicts <file>  check --semantic: the adjudicated verdicts artifact
  --require-sample   check: fail while a page DECLARED in .ultra11yrc.json has no capture under
                     .ultra11y/pages/. Coverage, one level below --require-decided: a sweep that
                     loses pages produces a report that is merely SHORTER, and a shorter
                     deliverable reads exactly like a complete one.
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
  --run <dir>        orchestrate: the run dir holding the worklists (ADJUDICATE.todo.json,
                     VERIFY.todo.json); artifacts land under <dir>/orchestration/
  --phase <name>     orchestrate: emit one phase only — adjudicate | verify-report
                     (exit 2 with the producing command if its worklist is missing)
  --eco              orchestrate: emit only RUNBOOK.md + agents/*.md — the explicit
                     sequential low-token path (also what a no-subagent harness follows)
  --merge <file>     scan: fold dynamic findings into this AuditResult JSON
  --sitemap <url>    scan: scan every URL listed in a sitemap.xml
  --crawl <url>      scan: BFS same-origin links from a start URL (served HTML)
  --depth <n>        scan: crawl link-hop depth from the start URL          (default: 2)
  --max <n>          scan: cap on pages scanned (sitemap/crawl)             (default: 50)
  --runtime <mode>   scan: local (host/target Playwright, no Docker) | docker | auto
                     (default: auto — local if Playwright resolves from --cwd, else Docker)
  --local            scan: alias of --runtime local
  --docker           scan: alias of --runtime docker (built on first use)
  --cwd <dir>        scan: --runtime local resolves @playwright/test + @axe-core/playwright
                     (and the browser) from here (e.g. --cwd packages/app)
  --storage-state <file>  scan: --runtime local — Playwright storageState JSON for
                     authenticated pages (e.g. test-results/.auth/user.json)
  --no-interact      scan: --runtime local — disable the STATEFUL probes (fill inputs,
                     open dialogs, live-region). Default is ON; the interactions are
                     strictly non-navigating (fill text inputs, toggle checkbox/radio,
                     click button[type=button] — never a link/submit/navigation, and
                     never a button whose accessible name matches a destructive verb:
                     supprimer, retirer, effacer, envoyer, valider, confirmer, payer,
                     delete, remove, send, submit, confirm, pay, …) and restore page
                     state, asserting location.href is unchanged after each action
  --interact-clicks  scan: --runtime local — allow the live-region probe's
                     button[type=button] clicks on an AUTHENTICATED scan
                     (--storage-state). Skipped by default there: a click can trigger
                     a server mutation (delete/send) invisible to the location.href
                     assertion. Unauthenticated scans keep clicks on regardless; the
                     destructive-name skip above applies in every case
  --write            pages discover: merge the discovered pages into .ultra11yrc.json
  --from-snapshots   pages discover: build the sample from .ultra11y/pages instead of crawling —
                     the only route that sees a state-reached page (a modal, a funnel step)
  --from <src>       import: "file" (a report on disk, the primary route) or an adapter id ("ara",
                     which fetches it and writes the raw response beside the parsed one)
  --source <adapter> import --from file: which adapter reads it (default: ara)
  --diff <file>      pages: compare the grid with an imported external audit — five buckets
                     (fixed · unchanged · partially fixed · regressed · not retested)
                     (sample.pages). Without it the proposal is printed and nothing is
                     written. Pages already declared are kept verbatim — auth, storageState
                     and notes are human work and are never overwritten
  --sample           scan: scan the NORMATIVE page sample from .ultra11yrc.json (its
                     sample.pages), per-page storage-state overriding --storage-state,
                     aggregating one result with per-page provenance for the report
  --no-snapshot      scan: do NOT persist each scanned page to .ultra11y/pages/<id>/.
                     Snapshots are ON by default: the browser is already on the page, and
                     without one the page can never be re-audited offline nor earn a
                     per-page verdict (its criteria stay « to assess » forever)
  --clean            scan: remove the dynamic-tier image + temp contexts, then exit
  --api-key <key>    judge: the Anthropic API key. Defaults to $ANTHROPIC_API_KEY. This is
                     the ONLY place in the tool that takes one — the engine needs no key
  --model <id>       judge: the model to rule with (default $ULTRA11Y_LLM_MODEL, else
                     claude-sonnet-5)
  --apply            judge: fold the verdicts straight into the audit, through the SAME
                     fail-closed gate an agent's verdicts pass (no unjustified C/NA, no
                     ungroundable NC, no unadjudicated criterion)
  --strict           verify --apply / judge --apply: all-or-nothing fold — one refused
                     verdict discards the whole adjudication. The default folds PER
                     VERDICT: a refusal costs its own criterion, which stays to assess
                     carrying the refusal, and every verdict that proved itself lands
  --semantic         verify: fold the support-check into one pass
                     check: engage the semantic gate — requires an adjudicated verdicts
                     artifact (fails closed when absent) and re-grounds every passing
                     verdict content-level against the cited source
  --manual           verify: with --in <audit.json>, emit an adjudication worklist over the
                     audit's residual (judgment / needs-rendering) criteria for the agent to rule
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
  "import",
  "dev",
  "mcp",
  "fix",
  "init",
  "pack",
  "judge",
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
  // `check --require-decided`: the criteria a project declares it cannot decide.
  "allow-undecided",
  "max-verify",
  "lang",
  "merge",
  "sitemap",
  "crawl",
  "depth",
  "max",
  // `import`: which external audit tool the report comes from, and (with `--from file`) which
  // adapter should read it. `pages --diff`: the imported audit to hold the grid against.
  "from",
  "source",
  "diff",
  "since",
  "max-files",
  "dedup",
  "only",
  "standard",
  // `verify --apply` / `judge --apply`: where to RECORD the verdicts the fold accepted, so a
  // later run can replay them without a model (src/ledger.ts). A path; empty falls back to the
  // standard's default location under .ultra11y/verdicts/.
  "ledger",
  "baseline",
  "fail-on",
  "split",
  "api-key",
  "model",
  "pack",
  "format",
  // Bytes of image data the single-file HTML report may carry inline (src/html-emit.ts).
  "inline-budget",
  // Hard cap on the crops one run writes (src/evidence.ts `DEFAULT_CAPS.total`).
  "evidence-max",
  "guidance",
  "runtime",
  "cwd",
  "storage-state",
  "captures",
  "run",
  "phase",
  "root",
  "runner",
  // Shared by `dev` (side-car port) and `mcp` (HTTP transport port) — one entry, both users.
  "port",
  "glossary",
  // `mcp` only. The flag sets are global, so these are accepted (and warned
  // about, never silently ignored) on every command — like --phase already is.
  "transport",
  "bind",
  "allow-origin",
  "max-response-bytes",
]);
// `init` treats --baseline as a boolean selector ("write the baseline"), not a
// path, so it must NOT consume the following token. audit/fix keep it as a value
// flag (`--baseline <file>`). Without this split, `init --baseline --hook` swallows
// --hook, and `init --baseline` never matches the `=== true` selector in cmdInit.
const INIT_VALUE_FLAGS = new Set([...VALUE_FLAGS].filter((f) => f !== "baseline"));
// `verify --apply <file>` takes the verdicts to fold; `judge --apply` is a BOOLEAN — it
// already holds the verdicts it just produced. Left in VALUE_FLAGS it would swallow the next
// token, so `judge --apply --out x` would silently apply nothing and write to the default
// directory. Same reason `init` drops `baseline`.
const JUDGE_VALUE_FLAGS = new Set([...VALUE_FLAGS].filter((f) => f !== "apply"));

function valueFlagsFor(command: string): ReadonlySet<string> {
  if (command === "init") return INIT_VALUE_FLAGS;
  if (command === "judge") return JUDGE_VALUE_FLAGS;
  return VALUE_FLAGS;
}

// Boolean flags documented in HELP (every valid flag that is NOT a value flag).
// Paired with VALUE_FLAGS this is the full set of recognised long flags, used to
// warn on unknown/misspelled ones instead of silently accepting them as no-ops.
const BOOLEAN_FLAGS = new Set([
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
  "scaffold",
  "storybook",
  "setup",
  "e2e",
  "next",
  "coverage",
  "write",
  // `pages discover`: build the sample from the snapshots the E2E producer already wrote,
  // instead of crawling — the only route that can see a state-reached page.
  "from-snapshots",
  "dry-run",
  "iterate",
  "safe",
  "hook",
  "ci",
  "list",
  "generate",
  "semantic",
  // `check`: fail while any criterion of the standard is still « to assess ».
  "require-decided",
  "require-sample",
  "manual",
  // `verify --apply` / `judge --apply`: restore the all-or-nothing fold, where one refused
  // verdict discards the whole adjudication. The default is per-verdict.
  "strict",
  "no-technical",
  "override",
  "local",
  "docker",
  "no-interact",
  "interact-clicks",
  "no-snapshot",
  "clean",
  "sample",
  "eco",
  "help",
  "version",
  "allow-remote",
  "allow-write",
  // Harness selectors, shared by `hook` and `install`/`uninstall`/`status`. Without these
  // the parser warned "unknown flag --claude-code" on stderr on EVERY guarded shell call.
  "claude-code",
  "codex",
  "opencode",
  "agents-md",
  "all",
  "project",
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

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const valueFlags = valueFlagsFor(command ?? "");
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
      else if (valueFlags.has(key)) val = rest[++i] ?? "";
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

/** Resolve `--standard`; prints the error and returns null on an unknown standard. */
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
    const parsed: unknown = JSON.parse(readText(mergeIn));
    return isCurrentAudit(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// ---- CI output formats (`--format`) --------------------------------------------------
// `audit` and `report` can render the SAME AuditResult in a machine-readable CI shape
// instead of their default output. Shared here so the two commands cannot drift.
type CiFormat = "sarif" | "github";

/** undefined = flag absent · null = unrecognized value (the caller reports and exits 2). */
function parseCiFormat(v: string | boolean | undefined): CiFormat | null | undefined {
  if (v === undefined) return undefined;
  if (v === "sarif") return "sarif";
  if (v === "github") return "github";
  return null;
}

/** Emit the CI rendering of an audit. Annotations go to STDOUT — GitHub only reads workflow
 *  commands there — while the job summary is APPENDED to $GITHUB_STEP_SUMMARY when the
 *  runner set it (else printed to stderr so a local run still shows it). */
function emitCiFormat(result: AuditResult, format: CiFormat, standard: StandardId, lang: Lang, failOn?: Severity): void {
  if (format === "sarif") {
    console.log(JSON.stringify(toSarif(result, { standard, lang }), null, 2));
    return;
  }
  for (const line of annotations(result, { standard, lang, failOn })) console.log(line);
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  const md = stepSummary(result, { standard, lang });
  if (summaryPath) {
    try {
      appendFileSync(summaryPath, `${md}\n`);
    } catch {
      /* never fail a run because the job summary could not be written */
    }
  } else {
    console.error(md);
  }
  // Sticky pull-request comment — opt-in, and best-effort: off a PR, or with no `gh`/auth,
  // it simply reports "skipped". A comment is never worth failing a build over.
  //
  // It gets its OWN document, not the summary above. The summary has a 1 MiB budget and a
  // reader who went looking for it; a PR comment has 64 KiB and a reader scanning a diff.
  // Posting one string to both is what turned a 700-finding audit into a wall on the PR.
  if (process.env.ULTRA11Y_PR_COMMENT === "1") {
    // WHICH document this run posts. Anything but an explicit `pages` is the historical
    // digest under the historical marker: an unset — or misspelled — variable must degrade to
    // the behaviour every existing workflow already depends on, never to silence.
    const kind = commentKindFrom(process.env.ULTRA11Y_PR_COMMENT_KIND);
    const render = kind === "pages" ? pagesComment : prComment;
    const body = render(result, {
      standard,
      lang,
      // The run is known before the artifact exists, so the link is always safe. The artifact
      // NAME is only set by the action when it actually uploads one — naming an artifact that
      // was never uploaded sends the reader to a page that does not exist.
      ...(process.env.ULTRA11Y_RUN_URL ? { runUrl: process.env.ULTRA11Y_RUN_URL } : {}),
      ...(process.env.ULTRA11Y_ARTIFACT_NAME ? { artifactName: process.env.ULTRA11Y_ARTIFACT_NAME } : {}),
    });
    const c = pushPrComment(body, standard, kind);
    console.error(
      c.ok
        ? lang === "fr"
          ? `ultra11y : commentaire de PR ${c.action === "updated" ? "mis à jour" : c.action === "created" ? "créé" : "ignoré"}${c.reason ? ` (${c.reason})` : ""}.`
          : `ultra11y: PR comment ${c.action}${c.reason ? ` (${c.reason})` : ""}.`
        : lang === "fr"
          ? `ultra11y : commentaire de PR impossible${c.reason ? ` — ${c.reason}` : ""}.`
          : `ultra11y: PR comment failed${c.reason ? ` — ${c.reason}` : ""}.`,
    );
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
    "baseline",
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
    const parsed = JSON.parse(inPath === "-" ? await readStdin() : readText(inPath)) as unknown;
    if (!isCurrentAudit(parsed)) {
      console.error("ultra11y audit: --in is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
      return 2;
    }
    result = parsed;
  } catch {
    console.error(`ultra11y audit: --in file not found or not valid JSON: ${inPath}.`);
    return 2;
  }

  const lang = resolveLang(p.flags, { audit: result });

  const failOnRaw = p.flags["fail-on"];
  const failOnParsed = parseFailOn(failOnRaw);
  if (failOnRaw !== undefined && failOnParsed === null) {
    console.error(`ultra11y audit: --fail-on must be blocking|major|minor (got "${String(failOnRaw)}").`);
    return 2;
  }
  const ciFormat = parseCiFormat(p.flags.format);
  if (ciFormat === null) {
    console.error(`ultra11y audit: --format must be sarif|github (got "${String(p.flags.format)}").`);
    return 2;
  }

  const failOnSet = failOnRaw !== undefined;
  const failOn = failOnSet ? (failOnParsed ?? "bloquant") : undefined;
  const failing = failOn ? findingsAtOrAbove(result.findings, failOn) : [];

  if (ciFormat) emitCiFormat(result, ciFormat, CORE, lang, failOn);
  else if (p.flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(auditSummary(result, lang));
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
  // Pre-audit: no scope.langs yet (audit itself doesn't take --standard), so this is
  // just the explicit-flag-or-English fallback — used only by messages emitted before
  // runAudit returns (below). Recomputed with the audit's own detection right after.
  let lang = resolveLang(p.flags, {});

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
  const auditInputs = [...inputs, ...(useCaptures ? [capturesDir] : []), ...(usePages ? [PAGES_DIR] : [])];
  if (useCaptures)
    console.error(
      lang === "fr" ? `ultra11y audit : captures rendues ingérées depuis ${capturesDir}.` : `ultra11y audit: ingesting rendered captures from ${capturesDir}.`,
    );
  if (usePages)
    console.error(
      lang === "fr" ? `ultra11y audit : instantanés de page ingérés depuis ${PAGES_DIR}.` : `ultra11y audit: ingesting page snapshots from ${PAGES_DIR}.`,
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
  lang = resolveLang(p.flags, { audit: result });

  // Record the pages in scope + attribute the source findings to them, so the per-page grid
  // rebuilds later from this JSON alone (no snapshots on disk, no browser).
  if (pagesInScope) {
    const scope = pageScopesFrom(readSnapshots("."));
    if (scope.length) {
      result.scope.pages = scope;
      attributePages(result, scope);
    }
  }

  // Only persist audit-latest.json when an output dir is explicitly requested. A plain
  // `audit` streams to stdout (--json / text summary) and must NOT litter the CWD with an
  // audits/ folder. Chain via `audit … --out audits` when you want the file (e.g. for
  // `scan --merge audits/audit-latest.json` or `report --in audits/audit-latest.json`).
  // R6: an `--out` value ending in `.json` is a FILE target (write exactly there);
  // otherwise it's a directory and the canonical `audit-latest.json` lands inside it — so
  // `--out run.json` no longer surprises the user with `run.json/audit-latest.json`.
  if (typeof p.flags.out === "string") {
    const out = p.flags.out;
    const asFile = out.toLowerCase().endsWith(".json");
    const target = asFile ? out : join(out, "audit-latest.json");
    try {
      mkdirSync(asFile ? dirname(out) : out, { recursive: true });
      writeFileSync(target, JSON.stringify(result, null, 2) + "\n");
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

  // CI rendering. `audit` is always WCAG-keyed (it takes no --standard by design), so a
  // pack-tagged SARIF is produced by chaining `report --in … --standard rgaa --format sarif`.
  const ciFormat = parseCiFormat(p.flags.format);
  if (ciFormat === null) {
    console.error(`ultra11y audit: --format must be sarif|github (got "${String(p.flags.format)}").`);
    return 2;
  }

  // Regression-gate mode (used by the init hook / CI): diff against a committed
  // baseline and exit non-zero only on NEW non-conformities at/above --fail-on.
  const baselineFlag = p.flags.baseline;
  if (typeof baselineFlag === "string" && baselineFlag) {
    let baseline: AuditResult | null = null;
    if (existsSync(baselineFlag)) {
      try {
        const parsed: unknown = JSON.parse(readText(baselineFlag));
        if (isCurrentAudit(parsed)) baseline = parsed;
        else
          console.error(
            `ultra11y audit: --baseline ${baselineFlag} is stale (pre-v2 / not WCAG-keyed); treating as empty. Regenerate with \`init --baseline\`.`,
          );
      } catch {
        console.error(`ultra11y audit: --baseline ${baselineFlag} is not valid JSON; treating as empty.`);
      }
    }
    const diff = diffAgainstBaseline(result, baseline, failOnParsed ?? "bloquant");
    const blindSpots = requireCaptures ? (result.scope.captureCoverage?.blindSpots ?? []) : [];
    // In gate mode the subject is the REGRESSION, not the backlog: the CI rendering covers
    // exactly the new findings, so a PR is annotated with what it introduced.
    if (ciFormat) emitCiFormat({ ...result, findings: diff.newFindings }, ciFormat, CORE, lang, failOnParsed ?? "bloquant");
    else if (p.flags.json)
      console.log(JSON.stringify(requireCaptures && result.scope.captureCoverage ? { ...diff, captureCoverage: result.scope.captureCoverage } : diff, null, 2));
    else {
      console.log(baselineSummary(diff, lang));
      if (requireCaptures && result.scope.captureCoverage) console.error(captureCoverageSummary(result.scope.captureCoverage, lang));
    }
    return diff.ok && blindSpots.length === 0 ? 0 : 1;
  }

  // Standalone gates (linter-style, no baseline): `--fail-on` gates the whole audit by
  // finding severity; `--require-captures` gates on rendered-capture blind spots. Both
  // compose; a plain audit (neither flag) always exits 0.
  const failOnSet = failOnRaw !== undefined;
  const failOn = failOnSet ? (failOnParsed ?? "bloquant") : undefined;
  const failing = failOn ? findingsAtOrAbove(result.findings, failOn) : [];
  const blindSpots = requireCaptures ? (result.scope.captureCoverage?.blindSpots ?? []) : [];

  if (ciFormat) emitCiFormat(result, ciFormat, CORE, lang, failOn);
  else if (p.flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(auditSummary(result, lang));
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

// `dev` — the development side-car. Long-running by design: it holds the port until you stop
// it, which is why nothing else in the CLI looks like this.
async function cmdDev(p: ParsedArgs): Promise<number> {
  const root = typeof p.flags.root === "string" && p.flags.root ? p.flags.root : ".";
  const standard = stdOf(p, "dev");
  if (standard === null) return 2;
  const lang = resolveLang(p.flags, { standard });
  const portRaw = p.flags.port;
  const port = typeof portRaw === "string" ? Number.parseInt(portRaw, 10) : DEV_DEFAULT_PORT;
  if (!Number.isFinite(port) || port < 0 || port > 65535) {
    console.error(`ultra11y dev: --port must be a number between 0 and 65535 (got "${String(portRaw)}").`);
    return 2;
  }

  // `--next` writes the component and stops: wiring the app is the user's one-line edit, and
  // doing it for them would mean rewriting their layout.
  if (p.flags.next === true) {
    const dir = join(root, ".ultra11y", "next");
    const rel = ".ultra11y/next/overlay.jsx";
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "overlay.jsx"), nextOverlayComponent(port));
    } catch (e) {
      console.error(`ultra11y dev: could not write ${rel}: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    const fr = lang === "fr";
    console.log(fr ? `Composant overlay écrit : ${rel}` : `Overlay component written: ${rel}`);
    console.log("");
    console.log(fr ? "Ajoutez-le à votre layout racine (app/layout.tsx) :" : "Add it to your root layout (app/layout.tsx):");
    console.log(`  import { Ultra11yOverlay } from "../${rel.replace(/\.jsx$/, "")}";`);
    console.log(`  <body>{children}<Ultra11yOverlay /></body>`);
    console.log("");
    console.log(
      fr
        ? `Puis lancez le side-car : ultra11y dev  (tableau de bord : http://127.0.0.1:${port})`
        : `Then start the side-car: ultra11y dev  (dashboard: http://127.0.0.1:${port})`,
    );
    console.log(fr ? "Le composant ne rend RIEN hors développement." : "The component renders NOTHING outside development.");
    return 0;
  }

  const fr = lang === "fr";
  let server: DevServer;
  try {
    server = await startDevServer({ root, port, standard, lang, onLog: (m) => console.error(m) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      /EADDRINUSE/.test(msg) ? `ultra11y dev: port ${port} is already in use — pass --port <n>.` : `ultra11y dev: could not start the server: ${msg}`,
    );
    return 1;
  }
  console.error(fr ? `ultra11y dev : tableau de bord sur http://127.0.0.1:${server.port}` : `ultra11y dev: dashboard on http://127.0.0.1:${server.port}`);
  console.error(fr ? "Boucle locale uniquement (l'outil écrit des fichiers). Ctrl-C pour arrêter." : "Loopback only (the tool writes files). Ctrl-C to stop.");
  await new Promise<void>((resolve) => {
    const stop = (): void => {
      void server.close().then(resolve);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
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
    const snaps = sampleFromSnapshots(readSnapshots(root));
    if (!snaps.length) {
      console.error(
        lang === "fr"
          ? `ultra11y pages discover : aucun instantané sous ${join(root, PAGES_DIR)} — lancez d'abord vos tests E2E avec checkA11y, ou \`scan --sample\`.`
          : `ultra11y pages discover: no snapshot under ${join(root, PAGES_DIR)} — run your E2E tests with checkA11y first, or \`scan --sample\`.`,
      );
      return 1;
    }
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
    urls = sitemap ? parseSitemapUrls(await fetchHtml(sitemap)).slice(0, max ?? 50) : await crawlUrls(crawl!, { fetchHtml, depth: depth ?? 2, max });
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

  return writeDiscoveredSample(p, lang, proposeSamplePages(urls, titles), urls.length);
}

/** Merge proposed pages into `.ultra11yrc.json` (or print them), shared by every discovery
 *  route — sitemap, crawl and snapshots. `mergeSample` keeps what is already declared, so a
 *  re-run never overwrites the human work of describing how a page is reached. */
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

  const file = join(process.cwd(), ".ultra11yrc.json");
  let doc: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      doc = JSON.parse(readText(file)) as Record<string, unknown>;
    } catch {
      console.error("ultra11y pages discover: .ultra11yrc.json is not valid JSON — refusing to overwrite it.");
      return 2;
    }
  }
  doc.sample = v.sample;
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
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
    result = JSON.parse(raw);
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
        ? "ultra11y pages : aucune page dans le périmètre. Capturez des instantanés (render --e2e) ou scannez un échantillon (scan --sample)."
        : "ultra11y pages: no page in scope. Capture snapshots (render --e2e) or scan a sample (scan --sample).",
    );
    return 1;
  }
  attributePages(result, scope);
  // --diff <external.json> — hold this grid against an audit someone else performed. NOTHING is
  // re-decided: both sides arrive decided, `diffSides` only sorts the pairs. See src/external/.
  if (typeof p.flags.diff === "string" && p.flags.diff) {
    return diffAgainstExternal(p, result, scope, standard, lang, p.flags.diff);
  }

  if (p.flags.json) {
    // Projected onto the ACTIVE standard, like every rendered surface — see pagesForStandard.
    console.log(
      JSON.stringify(
        { pages: pagesForStandard(result, derivePages(result, scope), standard, lang), unattributed: unattributedFindings(result).length },
        null,
        2,
      ),
    );
    return 0;
  }

  const format = typeof p.flags.format === "string" ? (p.flags.format as string) : "grid";
  if (!["grid", "report"].includes(format)) {
    console.error(`ultra11y pages: --format must be grid or report (got "${format}").`);
    return 2;
  }
  if (format === "grid") {
    console.log(renderPageGrid(result, scope, standard, lang));
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
  const shotOf = (id: string): string => join(PAGES_DIR, id, "screen.png");
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
 *  captures (`action.yml` reads it into an output) — and a second line there would break it. */
function emitHtml(result: AuditResult, opts: Parameters<typeof writeHtml>[1]): ReturnType<typeof writeHtml> {
  const res = writeHtml(result, opts);
  for (const n of res.notices) console.error(`ultra11y: ${n}`);
  console.error(`ultra11y: ${res.index}`);
  if (res.composite) console.error(`ultra11y: ${res.composite}`);
  return res;
}

// `snapshot write` — the single surface every browser-side producer writes through (the E2E
// fixtures, the dev sidecar). It takes the collected payload on stdin, persists the snapshot
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
      // pixel tier. writeSnapshot owns the decoding, so every producer — this command, the
      // dev side-car, `scan` — writes it the one same way.
      ...(typeof payload.screenshot === "string" && payload.screenshot ? { screenshotBase64: payload.screenshot } : {}),
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
  // The baseline regression gate is opt-in via --baseline or an explicit --fail-on;
  // otherwise init wires the default strict-staged auto-fixing hook (no baseline needed).
  const legacy = p.flags.baseline === true || p.flags["fail-on"] !== undefined;
  const want = { hook: p.flags.hook === true, ci: p.flags.ci === true, baseline: p.flags.baseline === true };
  if (!want.hook && !want.ci && !want.baseline) want.hook = true; // default: the staged auto-fix gate
  if (legacy) want.baseline = true; // the regression gate needs its committed reference
  const wrote: string[] = [];
  if (want.baseline) {
    const inputs = p.positionals.length ? p.positionals : ["."];
    const result = runAudit({ inputs, onWarn: (m) => console.error(m) });
    mkdirSync(join(root, "audits"), { recursive: true });
    const bp = join(root, "audits", "baseline.json");
    writeFileSync(bp, JSON.stringify(result, null, 2) + "\n");
    wrote.push(bp);
  }
  if (want.hook) wrote.push(writeHook(root, engineRel, failOn, legacy ? "baseline" : "staged"));
  if (want.ci) wrote.push(writeCi(root, engineRel, failOn));
  for (const w of wrote) console.log(`ultra11y init: wrote ${w}`);
  if (want.baseline) console.log(`ultra11y init: done. Commit audits/baseline.json so the gate has a reference.`);
  else console.log(`ultra11y init: done. The pre-commit gate audits staged changes and auto-applies safe fixes (bypass once with SKIP_A11Y=1).`);
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
  const results = installForTargets({ targets, project: p.flags.project === true, dryRun, skills: p.flags["no-skills"] !== true });
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

/** `status` — the doctor. Answers "is the automatic review actually going to fire?", which
 *  is otherwise invisible until a commit that should have been stopped goes through. */
function cmdStatus(p: ParsedArgs): number {
  const rows = statusReport({ project: p.flags.project === true });
  if (p.flags.json === true) {
    console.log(JSON.stringify({ version: VERSION, targets: rows }, null, 2));
    return 0;
  }
  console.log(`ultra11y ${VERSION}`);
  for (const r of rows) {
    console.log(`  ${r.target.padEnd(12)} ${r.wired ? "wired    " : "not wired"}  ${r.path}`);
    if (r.note) console.log(`  ${"".padEnd(12)} ${r.note}`);
  }
  return 0;
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
    result = JSON.parse(raw);
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

  // CI renderings of the same result — no Markdown file is written. This is the path that
  // gives a pack-keyed (RGAA) SARIF, since `audit` itself never takes --standard.
  const ciFormat = parseCiFormat(p.flags.format);
  if (ciFormat === null) {
    console.error(`ultra11y report: --format must be sarif|github (got "${String(p.flags.format)}").`);
    return 2;
  }
  // `--format` on `report` names a CI CHANNEL (annotations, SARIF); `--html` names a
  // DOCUMENT. Asking for both is asking for a file and a stream at once, so it is refused by
  // name rather than resolved by precedence — a silent winner here is a missing deliverable.
  if (ciFormat && p.flags.html === true) {
    console.error(
      lang === "fr"
        ? `ultra11y report : --html et --format ${ciFormat} sont incompatibles. --format nomme un canal CI, --html un document ; choisissez l'un ou l'autre.`
        : `ultra11y report: --html and --format ${ciFormat} are incompatible. --format names a CI channel, --html names a document; pick one.`,
    );
    return 2;
  }
  if (ciFormat) {
    emitCiFormat(result, ciFormat, standard, lang);
    return 0;
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

  const path = writeReport(result, { out, lang, standard, ...(cropFor ? { cropFor } : {}) });
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
  const untested = isCore(standard) ? [] : untestedNeedsRendering(result);
  const partial = untested.length > 0;
  if (partial && !p.flags.json) console.error(`🚨 ${partialAuditBanner(lang, untested)}`);
  if (p.flags.json)
    console.log(
      JSON.stringify(
        {
          path,
          conformancePct: result.conformancePct,
          date: result.date,
          standard: typeof p.flags.standard === "string" ? p.flags.standard : "wcag",
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
    result = JSON.parse(raw);
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
  const format: PrdFormat = p.flags.format === "doc" ? "doc" : p.flags.format === "remediation" ? "remediation" : "audit";
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

/** Flags that USED to exist, mapped to what replaces them. Checked before the generic
 *  unknown-flag warning so a removal is loud on the first run, not discovered later from an
 *  empty tracker. Reusable for the next removal — one table, one place. */
export const REMOVED_FLAGS: Record<string, string> = {
  "gh-issues": "ultra11y tickets --in <audit.json> --provider github --grain criterion",
  "gh-single": "ultra11y tickets --in <audit.json> --provider github --grain single",
  // The tracker-agnostic export moved WITH ticket filing: `tickets --out` writes the same
  // envelope (and a superset of the payload) at any grain, so an orchestrator still reads
  // one stable path — just not from the command that renders documents.
  "issues-json": "ultra11y tickets --in <audit.json> --out <dir> --grain criterion",
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
    result = JSON.parse(raw);
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
  const format = p.flags.format === "remediation" ? "remediation" : "audit";
  const plan = buildTickets(result, {
    grain: grainFlag as TicketGrain,
    standard,
    lang,
    format,
    bodyLimit: provider.capabilities.bodyLimit,
    baseDir: process.cwd(),
    technical: p.flags["no-technical"] !== true,
  });

  if (plan.error === "no-pages") {
    console.error(
      fr
        ? "ultra11y tickets : aucune page dans le périmètre. Capturez des instantanés (render --e2e) ou scannez un échantillon (scan --sample) avant d'utiliser --grain page."
        : "ultra11y tickets: no page in scope. Capture snapshots (render --e2e) or scan a sample (scan --sample) before using --grain page.",
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

/** Merged dependencies of the package.json at `root` (empty when absent/unparseable — the
 *  detectors then simply see no deps). Shared by every `render` detection mode. */
function depsAt(root: string): Record<string, string> {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return {};
  try {
    const pkg = JSON.parse(readText(pkgPath)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

/** The engine path to bake into a generated file: repo-relative when the engine lives inside
 *  the repo, absolute otherwise. Same resolution `init` uses for the git hook. */
function engineRefFor(root: string): string {
  let ref = process.argv[1] ?? "scripts/ultra11y.mjs";
  try {
    const abs = realpathSync(ref);
    ref = abs.startsWith(root + sep) ? relative(root, abs) : abs;
  } catch {
    /* keep as-is */
  }
  return ref;
}

function cmdRender(p: ParsedArgs): number {
  const root = p.positionals[0] ?? ".";
  const lang = resolveLang(p.flags, {}); // render has no --standard and no audit in hand

  // `--e2e` — wire the audit into an EXISTING Cypress/Playwright run, so a targeted page is
  // checked (and snapshotted) during the tests the project already has, rather than by a
  // second browser afterwards. The fixtures are generated files, not a published library.
  if (p.flags.e2e === true) {
    const forced = typeof p.flags.runner === "string" ? p.flags.runner : undefined;
    if (forced !== undefined && forced !== "playwright" && forced !== "cypress" && forced !== "auto") {
      console.error(`ultra11y render: --runner must be playwright|cypress|auto (got "${forced}").`);
      return 2;
    }
    const detected = detectE2eRunner(depsAt(root), (f) => existsSync(join(root, f)));
    const runners: E2eRunner[] = forced && forced !== "auto" ? [forced] : detected;
    if (!runners.length) {
      console.error(e2eSetupPlan([], {}, lang));
      return 1;
    }
    const engineRef = engineRefFor(root);
    const dir = join(root, ".ultra11y", "e2e");
    const paths: E2ePaths = {};
    try {
      mkdirSync(dir, { recursive: true });
      if (runners.includes("playwright")) {
        writeFileSync(join(dir, "playwright.mjs"), playwrightFixture(engineRef));
        paths.playwright = ".ultra11y/e2e/playwright.mjs";
      }
      if (runners.includes("cypress")) {
        writeFileSync(join(dir, "cypress-plugin.mjs"), cypressPlugin(engineRef));
        writeFileSync(join(dir, "cypress-commands.mjs"), cypressCommands());
        paths.cypressPlugin = ".ultra11y/e2e/cypress-plugin.mjs";
        paths.cypressCommands = ".ultra11y/e2e/cypress-commands.mjs";
      }
    } catch (e) {
      console.error(`ultra11y render: could not write the E2E fixtures: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    if (p.flags.json) console.log(JSON.stringify({ runners, paths }, null, 2));
    else console.log(e2eSetupPlan(runners, paths, lang));
    return 0;
  }
  if (p.flags.scaffold === true) {
    const out = typeof p.flags.out === "string" && p.flags.out ? p.flags.out : "ultra11y-render.tsx";
    try {
      writeFileSync(out, ssrHarness());
    } catch (e) {
      console.error(`ultra11y render: could not write ${out}: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    console.log(
      lang === "fr"
        ? `Harnais SSR écrit : ${out} (INERTE tant que COMPONENTS est vide — l'exécuter tel quel ne produit aucun HTML).\nComplétez COMPONENTS, exécutez-le (ex. npx tsx ${out}), puis : node scripts/ultra11y.mjs audit "audits/rendered/**/*.html"`
        : `SSR harness written: ${out} (INERT while COMPONENTS is empty — running it as-is produces no HTML).\nFill in COMPONENTS, run it (e.g. npx tsx ${out}), then: node scripts/ultra11y.mjs audit "audits/rendered/**/*.html"`,
    );
    return 0;
  }
  if (p.flags.setup === true) {
    const rel = ".ultra11y/capture-setup.mjs";
    const out = join(root, rel);
    try {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, captureSetup());
    } catch (e) {
      console.error(`ultra11y render: could not write ${out}: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    let setupDeps: Record<string, string> = {};
    const setupPkg = join(root, "package.json");
    if (existsSync(setupPkg)) {
      try {
        const pkg = JSON.parse(readText(setupPkg)) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
        setupDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      } catch {
        /* detection just sees no deps */
      }
    }
    const tr = detectTestRunner(setupDeps, (f) => existsSync(join(root, f)));
    console.log(captureSetupPlan(tr, rel, lang));

    // Keep committed captures byte-stable cross-platform + marked generated.
    const gaLine = ".ultra11y/captures/*.html text eol=lf linguist-generated=true";
    const gaPath = join(root, ".gitattributes");
    try {
      const existing = existsSync(gaPath) ? readFileSync(gaPath, "utf8") : "";
      if (!existing.includes(".ultra11y/captures/")) {
        appendFileSync(gaPath, (existing && !existing.endsWith("\n") ? "\n" : "") + gaLine + "\n");
        console.log(lang === "fr" ? `.gitattributes : ajouté « ${gaLine} »` : `.gitattributes: added "${gaLine}"`);
      }
    } catch {
      /* non-fatal */
    }
    // Captures must be committed for the gate — warn if .ultra11y is gitignored.
    try {
      const giPath = join(root, ".gitignore");
      if (existsSync(giPath) && /^\s*\/?\.ultra11y(\/\**)?\/?\s*$/m.test(readFileSync(giPath, "utf8")))
        console.error(
          lang === "fr"
            ? "⚠️ .ultra11y semble ignoré par .gitignore — les captures doivent être committées pour le gate (ajoutez « !.ultra11y/captures/ »)."
            : '⚠️ .ultra11y appears gitignored — captures must be committed for the gate (add "!.ultra11y/captures/").',
        );
    } catch {
      /* non-fatal */
    }
    return 0;
  }
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
        ? `Aucun HTML de story attribuable dans ${htmlDir}. Produisez le HTML par story (@storybook/test-runner, ou portable stories + le harvester \`render --setup\`), ou pointez --captures <dir>.`
        : `No attributable per-story HTML in ${htmlDir}. Produce per-story HTML (@storybook/test-runner, or portable stories + the \`render --setup\` harvester), or point --captures <dir>.`;
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
  const rep = p.flags.report;
  if (typeof rep !== "string" || !rep) {
    if (!requireDecided && !requireSample) {
      console.error("ultra11y check: --report <md> is required.");
      return 2;
    }
  }
  const lang = resolveLang(p.flags, { standard });
  const md = typeof rep === "string" && rep ? readInputFile(rep, "check", "--report") : "";
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
      audit = JSON.parse(rawAudit) as AuditResult;
    } catch {
      console.error("ultra11y check: --in file is not valid JSON.");
      return 2;
    }
  }
  if (requireDecided && !audit) {
    console.error("ultra11y check: --require-decided needs --in <audit.json> — completeness is a property of the audit, not of the report.");
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
  const decided = requireDecided && audit ? checkDecided(audit, standard, lang, { allow, pages: requireDecidedPages }) : null;
  // COVERAGE, one level below completeness: did the run capture every page it says it audits?
  // Needs no audit JSON — it holds the repository's declared sample against the snapshots on
  // disk, which is what a sweep either produced or did not.
  const covered = requireSample ? checkSampleCaptured(".", lang) : null;
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
  const ok = res.ok && (sem === null || sem.ok) && (decided === null || decided.ok) && (covered === null || covered.ok);
  if (p.flags.json) {
    console.log(JSON.stringify({ ...res, ok, ...(sem ? { semantic: sem } : {}), ...(decided ? { decided } : {}), ...(covered ? { covered } : {}) }, null, 2));
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
    else for (const i of [...res.issues, ...(sem?.issues ?? []), ...(decided?.issues ?? []), ...(covered?.issues ?? [])]) console.error(`✗ ${i}`);
  }
  return ok ? 0 : 1;
}

function cmdVerify(p: ParsedArgs): number {
  // --apply has no --standard/audit in hand — resolved below (post-standard) for the --report path.
  let lang = resolveLang(p.flags, {});
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
    let repMd: string;
    try {
      repMd = readText(applyReport);
    } catch {
      console.error(`ultra11y verify: --report file not found: ${applyReport}.`);
      return 2;
    }
    const expected = buildWorklist(repMd, standard, Number.POSITIVE_INFINITY);
    const r = applyVerdicts(items, expected);
    // Content-level grounding of every verdict that passed adjudication: the cited
    // file/line/snippet must still exist and match the source (see src/grounding.ts).
    const passing = items.filter((it) => typeof it.verdict === "string" && ["supported", "partial"].includes(it.verdict.trim().toLowerCase()));
    const grounding = groundItems(
      passing.map((it) => ({ file: it.file, line: it.line, selector: it.selector, snippet: (it as { snippet?: string }).snippet })),
    );
    const ok = r.ok && grounding.failed === 0;
    if (p.flags.json) console.log(JSON.stringify({ ...r, ok, grounding }, null, 2));
    else if (ok)
      console.log(
        lang === "fr"
          ? `✓ ${r.total} non-conformités vérifiées, toutes étayées et ancrées dans la source${grounding.moved ? ` (${grounding.moved} déplacée(s))` : ""}.`
          : `✓ ${r.total} non-conformities verified, all supported and grounded in source${grounding.moved ? ` (${grounding.moved} moved)` : ""}.`,
      );
    else {
      if (!r.ok)
        console.error(
          lang === "fr"
            ? `✗ ${r.failures.length}/${r.total} en échec (refuted ${r.refuted}, unsupported ${r.unsupported}, non statué ${r.unadjudicated}${r.missing ? `, absent(s) ${r.missing} — régénérez la worklist avec --max-verify 0` : ""}${r.invalid ? `, invalide ${r.invalid}` : ""}).`
            : `✗ ${r.failures.length}/${r.total} failed (refuted ${r.refuted}, unsupported ${r.unsupported}, unadjudicated ${r.unadjudicated}${r.missing ? `, missing ${r.missing} — regenerate the worklist with --max-verify 0` : ""}${r.invalid ? `, invalid ${r.invalid}` : ""}).`,
        );
      for (const issue of grounding.issues) console.error(`✗ ${issue}`);
    }
    return ok ? 0 : 1;
  }

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
      audit = JSON.parse(readText(inFlag)) as AuditResult;
    } catch {
      console.error(`ultra11y verify: --in file not found or not valid JSON: ${inFlag}.`);
      return 2;
    }
    const adjItems = buildAdjudicationWorklist(audit, { standard });
    const w = writeAdjudication(adjItems, out, { standard, auditDate: audit.date, lang });
    if (adjItems.every((it) => it.evidence.length === 0)) {
      console.error(
        lang === "fr"
          ? `ultra11y verify : aucune évidence n'a pu être extraite (${audit.scope.inputs.join(", ")} introuvable ?) — lancez --manual depuis le répertoire de l'audit.`
          : `ultra11y verify: no evidence could be harvested (${audit.scope.inputs.join(", ")} not found?) — run --manual from the audit's directory.`,
      );
    }
    if (p.flags.json) console.log(JSON.stringify({ mdPath: w.mdPath, todoPath: w.todoPath, count: w.count, items: adjItems }, null, 2));
    else
      console.log(
        lang === "fr" ? `${w.count} critère(s) à adjuger → ${w.mdPath}, ${w.todoPath}` : `${w.count} criterion(ia) to adjudicate → ${w.mdPath}, ${w.todoPath}`,
      );
    return 0;
  }

  // Normal NC-verification worklist path — requires --report.
  const rep = p.flags.report;
  if (typeof rep !== "string" || !rep) {
    console.error("ultra11y verify: --report <md> is required (or --apply <verdicts.json>, or --manual --in <audit.json>).");
    return 2;
  }
  let max = VERIFY_MAX;
  const mvFlag = p.flags["max-verify"];
  if (typeof mvFlag === "string" && mvFlag !== "") {
    const n = Number(mvFlag);
    if (!Number.isInteger(n) || n < 0) {
      console.error("ultra11y verify: --max-verify must be a non-negative integer.");
      return 2;
    }
    max = n === 0 ? Number.POSITIVE_INFINITY : n; // 0 = no cap
  }
  const repMd = readInputFile(rep, "verify", "--report");
  if (repMd === null) return 2;
  const items = buildWorklist(repMd, standard, max);
  const { todoPath, mdPath, count } = writeWorklist(items, out, p.flags.semantic === true, standard, lang);
  if (p.flags.json) console.log(JSON.stringify({ mdPath, todoPath, count, items }, null, 2));
  else
    console.log(
      lang === "fr" ? `${count} non-conformité(s) à vérifier → ${mdPath}, ${todoPath}` : `${count} non-conformity(ies) to verify → ${mdPath}, ${todoPath}`,
    );
  return 0;
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
    audit = JSON.parse(readText(inFlag)) as AuditResult;
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
  writeFileSync(auditPath, `${JSON.stringify(r.audit, null, 2)}\n`);

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
          replayed: rp.fresh.length,
          stale: rp.stale,
          obsolete: rp.obsolete,
          missing: rp.missing,
          issues: r.issues,
          conformancePct: r.audit.conformancePct,
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
    audit = JSON.parse(readText(inFlag)) as AuditResult;
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
  // Persist the updated audit so report/prd re-render with the adjudicated statuses.
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : ".";
  mkdirSync(out, { recursive: true });
  const auditPath = join(out, "audit-latest.json");
  writeFileSync(auditPath, JSON.stringify(r.audit, null, 2) + "\n");
  // Record what landed, so the next run does not have to pay a model to learn it again. Only
  // the ACCEPTED verdicts go in: a refused one in the ledger would be laundered back on the
  // next replay, which is the whole thing the gate exists to prevent.
  const ledgerOut = ledgerTarget(p, adj.standard);
  if (ledgerOut) {
    const refused = new Set(r.rejectedCriteria);
    const accepted = new Set(adj.items.map((it) => it.criteriaId).filter((id) => !refused.has(id)));
    const fresh = entriesFrom(adj, accepted, r.audit.date);
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
          issues: r.issues,
          conformancePct: r.audit.conformancePct,
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
        ? `✓ ${r.applied} critère(s) adjugé(s), ${r.stillManual} laissé(s) en résiduel${r.rejected ? `, ${r.rejected} refusé(s)` : ""} → ${auditPath}`
        : `✓ ${r.applied} criterion(ia) adjudicated, ${r.stillManual} left residual${r.rejected ? `, ${r.rejected} refused` : ""} → ${auditPath}`,
    );
  return 0;
}

// `judge` — adjudicate the manual criteria with a model, for the runs where no coding agent
// is in the loop (CI, a browser extension, an E2E run).
//
// It is a CALLER, not a second judge. The worklist, its harvested evidence, the decision
// protocol and the prompt all come from `verify --manual`'s own machinery, and the verdicts
// go through `applyAdjudication` unchanged — so a model cannot assert a conformance the gate
// refuses: no null verdict, `C`/`NA` justified, an `NC` citing the criterion's OWN test, a
// `manual` carrying a reason, and every `file:line` re-grounded against real source.
//
// Strictly opt-in: with no ANTHROPIC_API_KEY this command explains itself and exits, and no
// other command is affected.
async function cmdJudge(p: ParsedArgs): Promise<number> {
  const standard = stdOf(p, "judge");
  if (standard === null) return 2;
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error("ultra11y judge: --in <audit.json> is required.");
    return 2;
  }
  let audit: AuditResult;
  try {
    const parsed = JSON.parse(inFlag === "-" ? await readStdin() : readText(inFlag)) as unknown;
    if (!isCurrentAudit(parsed)) {
      console.error("ultra11y judge: input is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run `audit`.");
      return 2;
    }
    audit = parsed;
  } catch {
    console.error(`ultra11y judge: --in file not found or not valid JSON: ${inFlag}.`);
    return 2;
  }
  const lang = resolveLang(p.flags, { audit, standard });

  const key = typeof p.flags["api-key"] === "string" && p.flags["api-key"] ? (p.flags["api-key"] as string) : apiKeyFromEnv();
  if (!key) {
    console.error(
      lang === "fr"
        ? "ultra11y judge : aucune clé d'API. Exportez ANTHROPIC_API_KEY (ou passez --api-key).\n" +
            "  C'est le SEUL point de l'outil qui en demande une : le moteur, lui, ne requiert ni clé ni installation.\n" +
            "  Dans un agent de code, utilisez `verify --manual` — c'est l'agent qui tranche, gratuitement."
        : "ultra11y judge: no API key. Export ANTHROPIC_API_KEY (or pass --api-key).\n" +
            "  This is the ONLY place in the tool that asks for one: the engine itself needs no key and no install.\n" +
            "  Inside a coding agent use `verify --manual` instead — the agent rules, at no cost.",
    );
    return 2;
  }

  let items = buildAdjudicationWorklist(audit, { standard });
  if (!items.length) {
    console.log(lang === "fr" ? "Aucun critère à adjuger — rien à faire." : "No criterion left to adjudicate — nothing to do.");
    return 0;
  }
  const max = typeof p.flags.max === "string" ? Number(p.flags.max) : undefined;
  const truncated = max !== undefined && Number.isFinite(max) && max > 0 && items.length > max;
  // `--max` bounds the spend. It used to be refused outright together with `--apply`, and
  // rightly so: the fold was all-or-nothing, so a bounded adjudication could only ever fail on
  // coverage — billing a full run to guarantee a failure. The fold is now per-verdict, so a
  // bounded run lands what it covered and leaves the rest to assess, which is precisely what
  // someone bounding spend is asking for. The pair is impossible only under `--strict`.
  if (truncated && p.flags.apply === true && p.flags.strict === true) {
    console.error(
      lang === "fr"
        ? `ultra11y judge : --max ${max} ne couvre que ${max} des ${items.length} critères, et --apply --strict exige une adjudication COMPLÈTE (le fold tout-ou-rien refuse une couverture partielle).\n` +
            "  Retirez --strict pour appliquer ce qui est couvert, retirez --max pour tout adjuger, ou retirez --apply pour produire la worklist et l'appliquer plus tard."
        : `ultra11y judge: --max ${max} covers only ${max} of ${items.length} criteria, and --apply --strict requires a COMPLETE adjudication (the all-or-nothing fold refuses partial coverage).\n` +
            "  Drop --strict to apply what is covered, drop --max to adjudicate everything, or drop --apply to produce the worklist and apply it later.",
    );
    return 2;
  }
  if (truncated) items = items.slice(0, max);

  // Batch, and render EACH batch through the very worklist formatter the agent reads. There
  // is no second prompt to keep in step with the protocol.
  const batches: { items: typeof items; prompt: string }[] = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const slice = items.slice(i, i + BATCH_SIZE);
    batches.push({ items: slice, prompt: formatAdjudication(slice, lang, standard) });
  }
  const model = typeof p.flags.model === "string" && p.flags.model ? (p.flags.model as string) : modelFromEnv();
  console.error(
    lang === "fr"
      ? `ultra11y judge : ${items.length} critère(s) en ${batches.length} lot(s), modèle ${model}…`
      : `ultra11y judge: ${items.length} criterion(ia) in ${batches.length} batch(es), model ${model}…`,
  );

  const { verdicts, failures } = await judgeAll(batches, {
    apiKey: key,
    model,
    onProgress: (done, total) => console.error(`  ${done}/${total}`),
  });
  for (const f of failures) console.error(`⚠ ${f}`);
  const filled = applyRawVerdicts(items, verdicts);

  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : ".";
  const w = writeAdjudication(items, out, { standard, auditDate: audit.date, lang });
  console.error(
    lang === "fr" ? `${filled}/${items.length} verdict(s) rendu(s) → ${w.todoPath}` : `${filled}/${items.length} verdict(s) returned → ${w.todoPath}`,
  );
  // Say out loud what was NOT covered. A partial adjudication that reads as complete is the
  // failure mode this whole tool exists to prevent.
  if (truncated)
    console.error(
      lang === "fr"
        ? `⚠ --max ${max} : les critères au-delà n'ont pas été soumis et restent à évaluer.`
        : `⚠ --max ${max}: the criteria beyond it were not submitted and stay to assess.`,
    );

  if (p.flags.apply !== true) {
    console.log(w.todoPath);
    if (!p.flags.json)
      console.log(
        lang === "fr"
          ? "Relisez les verdicts, puis appliquez-les : `ultra11y verify --apply ADJUDICATE.todo.json --in <audit.json>`."
          : "Review the verdicts, then apply them: `ultra11y verify --apply ADJUDICATE.todo.json --in <audit.json>`.",
      );
    return 0;
  }

  // --apply runs the SAME gate an agent's verdicts go through. A truncated run cannot pass
  // its coverage check, which is the correct outcome, not a bug.
  const adj = JSON.parse(readText(w.todoPath)) as AdjudicationFile;
  const r = applyAdjudication(audit, adj, { strict: p.flags.strict === true });
  // Same policy as `verify --apply`: a batch the model got wrong costs its own criteria, not
  // the whole paid run. Only a fold that landed nothing at all is an error.
  if (!r.ok && (p.flags.strict === true || r.applied + r.stillManual === 0)) {
    console.error(lang === "fr" ? `✗ Adjudication rejetée (${r.issues.length} problème(s)) :` : `✗ Adjudication rejected (${r.issues.length} issue(s)):`);
    for (const i of r.issues.slice(0, 40)) console.error(`  ✗ ${i}`);
    if (r.issues.length > 40) console.error(`  … +${r.issues.length - 40}`);
    return 1;
  }
  if (r.rejected > 0) {
    console.error(
      lang === "fr"
        ? `⚠ ${r.rejected} critère(s) refusé(s) par la porte — ils restent à évaluer, avec le motif du refus :`
        : `⚠ ${r.rejected} criterion(ia) refused by the gate — they stay to assess, carrying the refusal:`,
    );
    for (const i of r.issues.slice(0, 40)) console.error(`  ✗ ${i}`);
    if (r.issues.length > 40) console.error(`  … +${r.issues.length - 40}`);
  }
  mkdirSync(out, { recursive: true });
  const auditPath = join(out, "audit-latest.json");
  writeFileSync(auditPath, `${JSON.stringify(r.audit, null, 2)}\n`);
  // Same recording as `verify --apply`: what the model paid for, written down where the next
  // run can replay it for free.
  const ledgerOut = ledgerTarget(p, adj.standard);
  if (ledgerOut) {
    const refused = new Set(r.rejectedCriteria);
    const accepted = new Set(adj.items.map((it) => it.criteriaId).filter((id) => !refused.has(id)));
    const fresh = entriesFrom(adj, accepted, r.audit.date);
    writeLedger(ledgerOut, mergeLedger(readLedger(ledgerOut), adj.standard, fresh));
    console.log(
      lang === "fr"
        ? `✓ ${fresh.length} verdict(s) enregistré(s) au registre → ${ledgerOut}`
        : `✓ ${fresh.length} verdict(s) recorded in the ledger → ${ledgerOut}`,
    );
  }
  console.log(
    lang === "fr"
      ? `✓ ${r.applied} critère(s) adjugé(s), ${r.stillManual} laissé(s) en résiduel${r.rejected ? `, ${r.rejected} refusé(s)` : ""} → ${auditPath}`
      : `✓ ${r.applied} criterion(ia) adjudicated, ${r.stillManual} left residual${r.rejected ? `, ${r.rejected} refused` : ""} → ${auditPath}`,
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
  const opts = {
    inputs,
    stdin,
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
  // src/fix.ts), so there is no repo-language signal to feed resolveLang beyond the flag.
  const fixLang = resolveLang(p.flags, {});
  if (p.flags.json) console.log(JSON.stringify(p.flags.iterate === true ? { ...result, rounds, totalWritten } : result, null, 2));
  else {
    console.log(fixSummary(result, fixLang, write));
    if (write && p.flags.iterate === true)
      console.log(
        fixLang === "fr"
          ? `\nItéré sur ${rounds} passe(s) jusqu'à stabilité — ${totalWritten} fichier(s) écrit(s) au total.`
          : `\nIterated over ${rounds} round(s) to a fixpoint — ${totalWritten} file(s) written in total.`,
      );
  }
  return 0;
}

async function cmdScan(p: ParsedArgs): Promise<number> {
  // scan has no --standard. With --merge, peek the target audit's scope.langs BEFORE
  // resolving lang (a French repo audited without --lang must not get English dyn-*
  // text permanently baked with no way back — see peekMergeAudit). --lang stays explicit-wins.
  const mergeAudit = peekMergeAudit(p.flags.merge);
  const lang = resolveLang(p.flags, mergeAudit ? { audit: mergeAudit } : {});
  if (p.flags.clean) {
    const r = cleanDynamic();
    console.log(
      lang === "fr"
        ? `Nettoyage : image dynamique ${r.imageRemoved ? "supprimée" : "absente"}, ${r.tempContextsRemoved} contexte(s) temporaire(s) supprimé(s).`
        : `Cleanup: dynamic image ${r.imageRemoved ? "removed" : "absent"}, ${r.tempContextsRemoved} temp context(s) removed.`,
    );
    return 0;
  }
  // A local target that does not exist is a user error, independent of any runtime — say
  // so BEFORE probing for Playwright/Docker, otherwise a machine with neither reports
  // "no runtime available" for what is really a typo in the path.
  for (const target of p.positionals.filter((a) => a !== "-")) {
    if (/^https?:\/\//i.test(target) || existsSync(target)) continue;
    console.error(
      lang === "fr"
        ? `ultra11y scan : fichier introuvable (file not found) : ${target}. Passez une URL http(s):// ou un fichier HTML existant.`
        : `ultra11y scan: File not found: ${target}. Pass an http(s):// URL or an existing HTML file.`,
    );
    return 1;
  }
  // Resolve the execution runtime. `auto` (default) prefers the local host/target
  // Playwright (no Docker) when it resolves from --cwd, else falls back to Docker.
  const cwd = typeof p.flags.cwd === "string" && p.flags.cwd ? (p.flags.cwd as string) : process.cwd();
  const storageState = typeof p.flags["storage-state"] === "string" && p.flags["storage-state"] ? (p.flags["storage-state"] as string) : undefined;
  const runtimeFlag =
    typeof p.flags.runtime === "string" && p.flags.runtime
      ? (p.flags.runtime as string)
      : p.flags.local === true
        ? "local"
        : p.flags.docker === true
          ? "docker"
          : "auto";
  if (!["auto", "local", "docker"].includes(runtimeFlag)) {
    console.error(`ultra11y scan: --runtime must be local, docker, or auto (got "${runtimeFlag}").`);
    return 2;
  }
  let useLocal: boolean;
  if (runtimeFlag === "local") useLocal = true;
  else if (runtimeFlag === "docker") useLocal = false;
  else if (localAvailable(cwd)) useLocal = true;
  else if (dockerAvailable()) {
    useLocal = false;
    // A silent degrade is indistinguishable from a working fallback — name what was
    // missing, so the one line a reader gets answers "what do I install".
    const s = localTierStatus(cwd);
    console.error(
      lang === "fr"
        ? `ultra11y scan : tier local indisponible${s.ok ? "" : ` (${s.reason})`} — bascule sur Docker. Passez --runtime local pour en faire une erreur.`
        : `ultra11y scan: local tier unavailable${s.ok ? "" : ` (${s.reason})`} — falling back to Docker. Pass --runtime local to make this an error instead.`,
    );
  } else {
    console.error(
      lang === "fr"
        ? "ultra11y scan : aucun runtime disponible — ni Playwright local (passez --cwd vers un projet avec @playwright/test + @axe-core/playwright installés), ni Docker. Voir --runtime."
        : "ultra11y scan: no runtime available — neither a local Playwright (pass --cwd at a project with @playwright/test + @axe-core/playwright installed) nor Docker. See --runtime.",
    );
    return 1;
  }
  if (storageState && !useLocal) {
    // --storage-state + the Docker tier is an unsupported combination, not a
    // degrade-and-continue: the Docker runner has no mechanism to use a Playwright
    // storageState, so scanning unauthenticated would produce MISLEADING results (a login
    // wall instead of the app) while exiting 0. This holds whether Docker was asked for
    // EXPLICITLY (--runtime docker/--docker) or reached as the auto fallback (no local
    // Playwright resolved) — in both cases authenticated scanning needs the local runtime.
    console.error(
      runtimeFlag === "docker"
        ? lang === "fr"
          ? "ultra11y scan : --storage-state n'est pas pris en charge avec --runtime docker (ou --docker) — combinaison non supportée. Utilisez --runtime local avec --cwd."
          : "ultra11y scan: --storage-state is not supported with --runtime docker (or --docker) — unsupported combination. Use --runtime local with --cwd."
        : lang === "fr"
          ? "ultra11y scan : --storage-state exige le runtime local, mais aucun Playwright local n'a été résolu (auto a basculé sur Docker). Passez --runtime local --cwd <projet>, ou retirez --storage-state."
          : "ultra11y scan: --storage-state requires the local runtime, but no local Playwright was resolved (auto fell back to Docker). Pass --runtime local --cwd <project>, or drop --storage-state.",
    );
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
  // only the pristine-page ones. (Docker never interacts.)
  const interact = p.flags["no-interact"] !== true;
  const interactClicks = p.flags["interact-clicks"] === true;
  const sitemap = typeof p.flags.sitemap === "string" ? (p.flags.sitemap as string) : undefined;
  const crawl = typeof p.flags.crawl === "string" ? (p.flags.crawl as string) : undefined;
  // Every scanned page is also PERSISTED as a snapshot (.ultra11y/pages/<id>/). The browser
  // is already on the page, so this costs one `evaluate` — and it is what lets the page be
  // re-audited offline and earn a real per-page verdict instead of staying "to assess"
  // forever (src/pages.ts). `--no-snapshot` opts out.
  const snapshotRoot = p.flags["no-snapshot"] === true ? undefined : process.cwd();

  // --sample: iterate the NORMATIVE page sample from `.ultra11yrc.json` (per-page
  // storageState overrides --storage-state). Loaded + validated here (hard error on a
  // malformed sample). An authenticated page needs the local runtime — the Docker tier has
  // no storageState mechanism, so a sample with any auth page + Docker is refused, not run
  // unauthenticated. SECURITY: storageState is only ever a path — its content is never read.
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
    if (!useLocal && sampleConfig.pages.some((pg) => pg.storageState)) {
      // `--runtime local` is not always the caller's to pass: inside the GitHub Action the
      // scan is invoked for them. On `auto` the runtime fell back to Docker because the local
      // tier could not resolve, so naming the missing dependency is the only actionable half
      // of this message — "use --runtime local" alone sends an Action user to a flag they
      // cannot reach, and telling them to force a runtime that still cannot load would
      // exchange this error for a worse one.
      // `runtimeFlag`, not `p.flags.runtime`: `--docker` is a documented alias, and reading the
      // raw flag would hand a caller who typed it the OTHER half of this message — "install
      // these dependencies" when the fix is to drop the flag they just passed.
      const forced = runtimeFlag === "docker";
      console.error(
        lang === "fr"
          ? `ultra11y scan : l'échantillon comporte des pages authentifiées (storageState), non prises en charge par le runtime Docker.${
              forced
                ? " Retirez --runtime docker."
                : " Le runtime local n'a pas pu être résolu : installez @playwright/test et @axe-core/playwright dans le projet audité (ou pointez --cwd dessus). Via l'Action, ce sont des dépendances du dépôt."
            }`
          : `ultra11y scan: the sample has authenticated pages (storageState), unsupported by the Docker runtime.${
              forced
                ? " Drop --runtime docker."
                : " The local runtime could not be resolved: install @playwright/test and @axe-core/playwright in the audited project (or point --cwd at it). Through the Action, those are dependencies of the repository."
            }`,
      );
      return 2;
    }
  }

  let dynamic: DynamicResult;
  try {
    if (useSample && sampleConfig) {
      dynamic = useLocal
        ? await runSampleScanLocal(sampleConfig.pages, { cwd, storageState, lang, interact, interactClicks, snapshotRoot })
        : runSampleScan(sampleConfig.pages, undefined, snapshotRoot);
    } else if (sitemap || crawl) {
      const depth = typeof p.flags.depth === "string" ? Number(p.flags.depth) : undefined;
      const max = typeof p.flags.max === "string" ? Number(p.flags.max) : undefined;
      dynamic = useLocal
        ? await runCrawlScanLocal({ sitemap, crawl, depth, max, cwd, storageState, lang, interact, interactClicks, snapshotRoot })
        : await runCrawlScan({ sitemap, crawl, depth, max, snapshotRoot });
    } else {
      const targets = p.positionals.filter((a) => a !== "-");
      if (targets.length === 0) {
        console.error("ultra11y scan: provide one or more URLs/HTML files, --sitemap <url>, --crawl <url>, or --clean.");
        return 2;
      }
      if (useLocal) {
        dynamic =
          targets.length === 1
            ? await runScanLocal({ target: targets[0]!, cwd, storageState, lang, interact, interactClicks, snapshotRoot })
            : await runScanManyLocal(targets, { cwd, storageState, lang, interact, interactClicks, snapshotRoot });
      } else {
        dynamic = targets.length === 1 ? runScan({ target: targets[0]!, snapshotRoot }) : runScanMany(targets, undefined, snapshotRoot);
      }
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
    if (useSample && sampleConfig && dynamic.redirected.length === sampleConfig.pages.length) {
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
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : "audits";
  const mergeIn = p.flags.merge;
  if (typeof mergeIn === "string" && mergeIn) {
    let audit: AuditResult;
    if (mergeAudit) {
      audit = mergeAudit; // already loaded + validated above for lang resolution
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readText(mergeIn));
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
        const snapAudit = runAudit({ inputs: doms, onWarn: (m) => console.error(m) });
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
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "audit-latest.json"), JSON.stringify(merged, null, 2) + "\n");
    if (p.flags.json) console.log(JSON.stringify(merged, null, 2));
    else {
      console.log(
        lang === "fr"
          ? `Audit statique + dynamique fusionné → ${join(out, "audit-latest.json")} (${merged.conformancePct}% réussite, ${merged.findings.length} findings).`
          : `Static + dynamic audit merged → ${join(out, "audit-latest.json")} (${merged.conformancePct}% pass rate, ${merged.findings.length} findings).`,
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
  const { missing } = lintSample(union.sample, methodology);
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
  if (missing.length) {
    console.log(
      (lang === "fr"
        ? `⚠️ Échantillon incomplet (${union.sample.pages.length} page(s)) — types de page requis absents (${pack!.name}) :`
        : `⚠️ Incomplete sample (${union.sample.pages.length} page(s)) — required page kinds missing (${pack!.name}):`) +
        ` ${missing.map((k) => kindLabel(k, loc)).join(", ")}`,
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
        ? `✓ Échantillon complet (${union.sample.pages.length} page(s)) — tous les types de page requis par ${pack!.name} sont couverts.`
        : `✓ Sample complete (${union.sample.pages.length} page(s)) — every page kind ${pack!.name} requires is covered.`,
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

const DIFF_LABEL: Record<DiffBucket, { fr: string; en: string }> = {
  fixed: { fr: "Corrigé", en: "Fixed" },
  unchanged: { fr: "Inchangé", en: "Unchanged" },
  "partially-fixed": { fr: "Partiellement corrigé", en: "Partially fixed" },
  regressed: { fr: "Régressé", en: "Regressed" },
  "not-retested": { fr: "Non retesté", en: "Not retested" },
  "only-left": { fr: "Nous seuls", en: "Ours only" },
  "only-right": { fr: "Eux seuls", en: "Theirs only" },
};

/** `pages --diff` — our per-page grid vs an imported external audit.
 *
 *  The LEFT side is `derivePackResults(pageView(...))`, the same projection the report and the
 *  grid use; the RIGHT is the adapter's output. Neither is adjusted here. The output leads with
 *  the pages one side rules on and the other does not, because that is the failure the reporter
 *  actually hit: a criterion reported on the funnel, ticketed against the stats page, closed
 *  without a fix. A count would not have caught it; a page-keyed disagreement would. */
function diffAgainstExternal(p: ParsedArgs, result: AuditResult, scope: PageScope[], standard: StandardId, lang: Lang, file: string): number {
  let ext: ExternalAudit;
  try {
    ext = JSON.parse(readText(file)) as ExternalAudit;
  } catch (e) {
    console.error(`ultra11y pages --diff: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  if (ext?.kind !== "external-audit") {
    console.error(`ultra11y pages --diff: ${file} is not an imported external audit (run \`ultra11y import\` first).`);
    return 2;
  }
  if (isCore(standard)) {
    console.error("ultra11y pages --diff: pass --standard <pack> — an external audit is keyed by the standard's own criterion ids, not by WCAG SCs.");
    return 2;
  }
  if (ext.standard !== standard) {
    console.error(`ultra11y pages --diff: the imported audit is keyed by "${ext.standard}" but --standard is "${standard}".`);
    return 2;
  }

  // Our side, criterion-by-criterion and page-by-page, from the ONE projection.
  const ours = new Map<string, Map<string, Status>>();
  for (const page of derivePages(result, scope)) {
    const m = new Map<string, Status>();
    for (const c of derivePackResults(pageView(result, page), standard, page.id)) m.set(c.id, c.status);
    ours.set(page.id, m);
  }

  const d = diffSides({ byPage: ours }, sideOfExternal(ext));
  if (p.flags.json) {
    console.log(JSON.stringify({ standard, external: ext.source, ...d }, null, 2));
    return 0;
  }

  const fr = lang === "fr";
  console.log(fr ? `# Écart avec l'audit externe (${ext.source.adapter})` : `# Difference against the external audit (${ext.source.adapter})`);
  console.log("");
  const order: DiffBucket[] = ["regressed", "not-retested", "only-right", "partially-fixed", "fixed", "only-left", "unchanged"];
  console.log(order.map((b) => `${DIFF_LABEL[b][fr ? "fr" : "en"]} : ${d.counts[b]}`).join(" · "));
  console.log("");
  if (d.pagesOnlyRight.length) {
    console.log(
      fr
        ? `> ⚠️ ${d.pagesOnlyRight.length} page(s) auditée(s) par l'auditeur externe n'existent pas dans votre grille : ${d.pagesOnlyRight.join(", ")}. Ses constats sur ces pages n'ont rien à quoi se comparer.`
        : `> ⚠️ ${d.pagesOnlyRight.length} page(s) the external auditor ruled on are absent from your grid: ${d.pagesOnlyRight.join(", ")}. Their findings there have nothing to compare against.`,
    );
    console.log("");
  }
  if (d.pagesOnlyLeft.length) {
    console.log(
      fr
        ? `> ℹ️ ${d.pagesOnlyLeft.length} page(s) de votre grille ne figurent pas dans l'audit externe : ${d.pagesOnlyLeft.join(", ")}.`
        : `> ℹ️ ${d.pagesOnlyLeft.length} page(s) in your grid are absent from the external audit: ${d.pagesOnlyLeft.join(", ")}.`,
    );
    console.log("");
  }
  const mark = (s: Status | null): string => (s === null ? "?" : s === "manual" ? "?" : s === "NA" ? "—" : s);
  console.log(fr ? "| Page | Critère | Nous | Eux | Écart | Commentaire de l'auditeur |" : "| Page | Criterion | Ours | Theirs | Bucket | Auditor's comment |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  // Everything but `unchanged`: a reconciliation is about what moved. The count above still
  // reports it, so nothing is hidden — only unlisted.
  for (const r of d.rows.filter((x) => x.bucket !== "unchanged")) {
    const note = (r.comment ?? "").replace(/\s*\n+\s*/g, " ").slice(0, 160);
    console.log(`| ${r.page} | ${r.criterion} | ${mark(r.left)} | ${mark(r.right)} | ${DIFF_LABEL[r.bucket][fr ? "fr" : "en"]} | ${note} |`);
  }
  return 0;
}

/** `import` — read an audit someone else performed into the tool-neutral (page, criterion,
 *  status) model, so it can be held against this engine's own grid.
 *
 *  A FILE is the primary interface and the network is a convenience, not the other way round.
 *  The engine is advertised as install-free and keyless; an importer that only worked online
 *  would make a reproducible audit depend on a third party being up. `--from ara <id>` therefore
 *  writes the RAW response to disk BEFORE parsing it, so what was imported is committable and a
 *  re-import needs no network at all. */
async function cmdImport(p: ParsedArgs): Promise<number> {
  const lang = resolveLang(p.flags, {});
  const from = typeof p.flags.from === "string" ? p.flags.from : undefined;
  const arg = p.positionals[0];
  if (!from || !arg) {
    console.error(
      lang === "fr"
        ? "ultra11y import : usage `import --from file <rapport.json>` ou `import --from ara <id>` (voir --help)."
        : "ultra11y import: usage `import --from file <report.json>` or `import --from ara <id>` (see --help).",
    );
    return 2;
  }

  const outDir = typeof p.flags.out === "string" ? p.flags.out : undefined;
  let rawText: string;
  let sourceUrl: string | undefined;
  let adapterId: string;

  if (from === "file") {
    // The source's own format, on disk. Which adapter reads it is the user's call — guessing
    // would mean sniffing a schema, and a wrong guess is a confidently wrong crosswalk.
    adapterId = typeof p.flags.source === "string" ? p.flags.source : "ara";
    try {
      rawText = arg === "-" ? await readStdin() : readText(arg);
    } catch (e) {
      console.error(`ultra11y import: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  } else {
    adapterId = from;
    let adapter: ExternalAdapter;
    try {
      adapter = createAdapter(adapterId);
    } catch (e) {
      console.error(`ultra11y import: ${e instanceof Error ? e.message : String(e)}`);
      return 2;
    }
    if (!adapter.fetchUrl) {
      console.error(`ultra11y import: the "${adapterId}" adapter has no remote endpoint — use \`--from file <report.json>\`.`);
      return 2;
    }
    sourceUrl = adapter.fetchUrl(arg);
    try {
      const res = await fetch(sourceUrl, { redirect: "follow" });
      if (!res.ok) {
        console.error(`ultra11y import: ${sourceUrl} returned HTTP ${res.status}.`);
        return 1;
      }
      rawText = await res.text();
    } catch (e) {
      console.error(`ultra11y import: could not reach ${sourceUrl} — ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
    // Commit the artefact before interpreting it: what was imported must be inspectable, and a
    // re-import must not need the network again.
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      const rawFile = join(outDir, `external-${adapterId}-${arg}.raw.json`);
      writeFileSync(rawFile, rawText.endsWith("\n") ? rawText : `${rawText}\n`);
      if (!p.flags.json) console.log(rawFile);
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (e) {
    console.error(`ultra11y import: the report is not valid JSON — ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  let adapter: ExternalAdapter;
  try {
    adapter = createAdapter(adapterId);
  } catch (e) {
    console.error(`ultra11y import: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }

  const parsed = adapter.parse(raw, { importedAt: new Date().toISOString(), ...(sourceUrl ? { url: sourceUrl } : {}) });
  if (!parsed.ok) {
    console.error(
      lang === "fr"
        ? `ultra11y import : le rapport n'a pas pu être lu sans perte (${parsed.issues.length} problème(s)) — rien n'est écrit, plutôt qu'un import partiel qui aurait l'air complet :`
        : `ultra11y import: the report could not be read without loss (${parsed.issues.length} issue(s)) — nothing is written, rather than a partial import that would look complete:`,
    );
    for (const i of parsed.issues.slice(0, 20)) console.error(`  ✗ ${i}`);
    if (parsed.issues.length > 20) console.error(`  … ${parsed.issues.length - 20} more`);
    return 1;
  }

  const audit = parsed.audit;
  if (p.flags.json) {
    console.log(JSON.stringify(audit, null, 2));
    return 0;
  }
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, "external-latest.json");
    writeFileSync(file, `${JSON.stringify(audit, null, 2)}\n`);
    console.log(file);
  } else {
    console.log(JSON.stringify(audit, null, 2));
  }
  const decided = audit.results.filter((r) => r.status !== "manual").length;
  console.error(
    lang === "fr"
      ? `${audit.pages.length} page(s), ${audit.results.length} résultat(s) dont ${decided} tranché(s) — audit externe, jamais fusionné dans le verdict du moteur. Comparez : \`pages --in <audit.json> --diff <ce fichier>\`.`
      : `${audit.pages.length} page(s), ${audit.results.length} result(s), ${decided} ruled — an external audit, never merged into the engine's own verdict. Compare with: \`pages --in <audit.json> --diff <this file>\`.`,
  );
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

// Serve the audit over the Model Context Protocol. Returns only when the server
// stops, so main() does not fall through while it is still listening.
async function cmdMcp(p: ParsedArgs): Promise<number> {
  const transport = typeof p.flags.transport === "string" ? p.flags.transport : "stdio";
  if (transport !== "stdio" && transport !== "http") {
    console.error(`ultra11y: invalid --transport "${transport}" (expected: stdio, http)`);
    return 2;
  }
  const maxRaw = typeof p.flags["max-response-bytes"] === "string" ? Number(p.flags["max-response-bytes"]) : undefined;
  if (maxRaw !== undefined && (!Number.isFinite(maxRaw) || maxRaw <= 0)) {
    console.error("ultra11y: invalid --max-response-bytes");
    return 2;
  }
  const options = {
    // A default project root makes `cwd` optional on every tool, for a server
    // dedicated to one project.
    defaultCwd: typeof p.flags.cwd === "string" ? p.flags.cwd : undefined,
    allowWrite: p.flags["allow-write"] === true,
    maxResponseBytes: maxRaw,
  };

  if (transport === "stdio") {
    // Nothing is written to stdout here: from this point stdout carries
    // JSON-RPC frames only, and runStdioServer guards that.
    await runStdioServer(options);
    return 0;
  }

  const port = typeof p.flags.port === "string" ? Number(p.flags.port) : 7341;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("ultra11y: invalid --port");
    return 2;
  }
  const originRaw = typeof p.flags["allow-origin"] === "string" ? p.flags["allow-origin"] : undefined;
  const allowOrigin = originRaw
    ? originRaw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    : undefined;
  let running: Awaited<ReturnType<typeof startHttpServer>>;
  try {
    running = await startHttpServer({
      ...options,
      port,
      bind: typeof p.flags.bind === "string" ? p.flags.bind : undefined,
      allowOrigin,
      allowRemote: p.flags["allow-remote"] === true,
    });
  } catch (e) {
    console.error(`ultra11y: ${(e as Error).message}`);
    return 2;
  }
  // stderr, not stdout: an HTTP server's stdout is not a protocol stream, but
  // keeping the two transports identical here means no one has to remember
  // which is which.
  console.error(`ultra11y: MCP server listening on ${running.url}`);
  console.error(`  client: claude mcp add --transport http ultra11y ${running.url}`);
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void running.close().then(() => process.exit(0));
    });
  }
  await new Promise<void>((res) => running.server.once("close", res));
  return 0;
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
  if (workflows.length) {
    console.log("");
    for (const w of workflows) console.log(`Launch: Workflow({ scriptPath: ${JSON.stringify(w)} })`);
    console.log(
      lang === "fr"
        ? "Puis fusionnez les fragments retournés dans la worklist et lancez le `verify --apply` indiqué en fin de workflow (vous restez le seul écrivain)."
        : "Then fold the returned fragments into the worklist and run the `verify --apply` shown at the end of each workflow (you stay the sole writer).",
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
  if (!isCommand(first)) {
    console.error(`ultra11y: unknown command "${first}". Run \`ultra11y --help\`.`);
    return 2;
  }

  const p = parseArgs(argv);
  // `<cmd> --help` / `<cmd> -h` shows help with NO side effects. Without this every
  // subcommand ignored the flag and ran — and `init --help` would write a hook +
  // baseline into the cwd repo.
  if (p.flags.help === true || p.flags.h === true) {
    console.log(HELP);
    return 0;
  }
  // A REMOVED flag must not fall through to the generic "unknown flag (ignored)" warning
  // below: a scripted CI would keep exiting 0 while filing nothing at all — precisely the
  // silent failure this release exists to end. Name the replacement and fail.
  for (const f of p.unknown) {
    const replacement = REMOVED_FLAGS[f];
    if (replacement) {
      console.error(`ultra11y: --${f} was removed in v3 — ticket creation is now its own command. Use: ${replacement}`);
      return 2;
    }
  }
  // Warn (never silently ignore) on misspelled/unknown flags so `--grph` or
  // `--standrd rgaa` can't quietly leave cross-file/a standard disabled.
  for (const f of p.unknown) console.error(`ultra11y: unknown flag --${f} (ignored). Run \`ultra11y --help\`.`);

  // Enum-valued flags: warn (never silently coerce) on an unsupported value so `--lang de`
  // or `--dedup fuzzy` is visible instead of quietly falling back to the default.
  // This check runs BEFORE dispatch, so it cannot know which command owns the flag: the
  // allowed set must be the UNION over every command that takes it. Listing only one
  // command's values made the guard cry wolf on valid input — `report --format sarif` and
  // `audit --format github` both warned "not one of audit|doc|remediation" while working
  // perfectly, which teaches the reader to ignore the warning that is meant to catch a typo.
  // Per-command validation is each cmdX's own job (parseCiFormat, cmdPages…), and stays strict.
  const ENUM_FLAGS: Record<string, readonly string[]> = {
    lang: ["auto", "en", "fr"],
    dedup: ["exact", "normalized", "off"],
    format: ["audit", "doc", "remediation", "sarif", "github", "grid", "report"],
    split: ["criterion", "page"],
    runtime: ["auto", "local", "docker"],
    provider: ["auto", "github", "gitlab", "jira"],
    grain: ["criterion", "page", "page-criterion", "single", "file"],
    // The union over every command that takes it: `mcp` serves stdio|http, `tickets`
    // picks cli|rest. Listing one command's values made the guard cry wolf on the other.
    transport: ["stdio", "http", "auto", "cli", "rest"],
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
  // `mcp --cwd <dir>` dedicates the server to another project, and a standards pack is
  // that project's configuration — read it from THERE, not from whichever directory node
  // happened to be started in. Every other command works on the process cwd.
  const configRoot = p.command === "mcp" && typeof p.flags.cwd === "string" && p.flags.cwd ? resolve(p.flags.cwd) : process.cwd();
  const loaded = loadRuntimeStandards(configRoot, packList, (m) => console.error(m), p.flags.override === true);
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
    case "import":
      return cmdImport(p);
    case "snapshot":
      return cmdSnapshot(p);
    case "pages":
      return cmdPages(p);
    case "dev":
      return cmdDev(p);
    case "fix":
      return cmdFix(p);
    case "init":
      return cmdInit(p);
    case "pack":
      return cmdPack(p);
    case "judge":
      return cmdJudge(p);
    case "orchestrate":
      return cmdOrchestrate(p);
    case "mcp":
      return cmdMcp(p);
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
