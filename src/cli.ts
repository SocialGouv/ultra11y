import { realpathSync, writeFileSync, mkdirSync, existsSync, readFileSync, appendFileSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VERSION, type Lang, type AuditResult, type DynamicResult, type SampleConfig, type Severity } from "./types.js";
import { runAudit } from "./audit.js";
import { writeReport, untestedNeedsRendering, partialAuditBanner } from "./report.js";
import { writePrd, prdUnits, type PrdFormat } from "./prd.js";
import { ghAvailable, pushIssues, pushPrComment, pushSingleIssue } from "./gh.js";
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
import { computeCaptureCoverage, parseCaptureProvenance, formatCaptureComment, type CaptureEntry } from "./capture.js";
import { buildGraphStreaming } from "./graph/build.js";
import { discover } from "./discover.js";
import { toPosix, GRAPH_ONLY_EXT } from "./glob.js";
import { runCriteria, renderCriteriaReference } from "./criteria.js";
import { checkReport, checkSemantic } from "./check.js";
import { buildWorklist, writeWorklist, applyVerdicts, VERIFY_MAX, type VerifyItem } from "./verify.js";
import { groundItems } from "./grounding.js";
import { buildAdjudicationWorklist, writeAdjudication, applyAdjudication, type AdjudicationFile } from "./adjudicate.js";
import { runScan, runScanMany, runCrawlScan, runSampleScan, mergeDynamic, cleanDynamic, dockerAvailable } from "./scan.js";
import { runScanLocal, runScanManyLocal, runCrawlScanLocal, runSampleScanLocal, localAvailable } from "./scan-local.js";
import { validateSample, lintSample, kindLabel } from "./sample.js";
import { runFix, fixSummary } from "./fix.js";
import { diffAgainstBaseline, baselineSummary, parseFailOn, findingsAtOrAbove } from "./baseline.js";
import { repoRoot, writeHook, writeCi } from "./init.js";
import { auditSummary, captureCoverageSummary } from "./output.js";
import { toSarif } from "./sarif.js";
import { annotations, stepSummary } from "./annotate.js";
import { PAGES_DIR, readSnapshots, validateSnapshotMeta, writeSnapshot, type AxNode, type BoxDigest, type CssDigest, type StyleDigest } from "./snapshot.js";
import { attributePages, derivePages, pageScopesFrom, pagesOf, renderPageGrid, unattributedFindings } from "./pages.js";
import { DEV_DEFAULT_PORT, nextOverlayComponent, startDevServer, type DevServer } from "./dev.js";
import { cypressCommands, cypressPlugin, detectE2eRunner, e2eSetupPlan, playwrightFixture, type E2ePaths, type E2eRunner } from "./e2e.js";
import { resolveStandard, getPack, isCore, CORE, type StandardId } from "./standards/index.js";
import { loadRuntimeStandards, loadConfig } from "./config.js";
import { runPackCheck, packScaffold } from "./pack.js";
import { listPhases, orchestrateRun, PHASES } from "./orchestrate.js";
import { readStdin, readText } from "./util.js";

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
  ultra11y report   --in <audit.json> [--out <dir>] [--standard <pack>] [--format sarif|github] [--lang auto|en|fr]
  ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc|remediation] [--no-technical] [--standard <pack>] [--gh-issues | --gh-single] [--lang auto|en|fr]
  ultra11y render   [<dir>] [--scaffold | --setup | --e2e | --coverage | --storybook] [--runner playwright|cypress|auto] [--captures <dir>] [--out <file>] [--json] [--lang auto|en|fr]
  ultra11y criteria [<sc>] [--list] [--standard <pack> [--theme <N>]] [--generate] [--json] [--lang auto|en|fr]
  ultra11y check    --report <md> [--standard <pack>] [--in <audit.json>] [--semantic [--verdicts <file>]] [--quiet] [--json]
  ultra11y verify   --report <md> [--standard <pack>] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--out <dir>] [--json]
  ultra11y verify   --report <md> --in <audit.json> --manual [--out <dir>] [--json]   (adjudicate the manual criteria)
  ultra11y verify   --apply <adjudication.json> --in <audit.json> [--out <dir>]        (fold the adjudication into the audit)
  ultra11y orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list] [--lang auto|en|fr]
  ultra11y fix      <globs… | -> [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--include <glob>] [--exclude <glob>] [--ext <list>] [--only <ids>] [--jsx] [--json] [--lang auto|en|fr]
  ultra11y init     [--hook] [--ci] [--baseline] [--fail-on blocking|major|minor]
  ultra11y pack     check <pack.json> [--guidance <g.json>] [--json]  |  pack scaffold
  ultra11y scan     <url|file…> [--runtime auto|local|docker] [--cwd <dir>] [--storage-state <file>] [--no-interact] [--interact-clicks] [--merge <audit.json>] [--out <dir>] [--json]
  ultra11y scan     --sample [--runtime …] [--cwd <dir>] [--storage-state <file>] [--merge <audit.json>] [--json]   (scan the .ultra11yrc.json page sample)
  ultra11y scan     --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--runtime …] [--cwd <dir>] [--merge <audit.json>] [--json]
  ultra11y scan     --clean        (remove the dynamic-tier Docker image + temp contexts)
  ultra11y sample   check [--standard <pack>] [--json]   (lint the .ultra11yrc.json page sample vs the standard's required page kinds)
  ultra11y snapshot write [--root <dir>] [--fail-on blocking|major|minor] [--json]   (payload on stdin → .ultra11y/pages/<id>/ + audit it)
  ultra11y snapshot list  [--root <dir>] [--json]
  ultra11y pages    --in <audit.json> [--standard <pack>] [--json] [--lang auto|en|fr]   (the per-page criterion grid)
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
             verification. --split criterion writes one file per criterion;
             --gh-issues files one de-duplicated GitHub issue per criterion, or
             --gh-single files the whole audit as a single issue (gh CLI).
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
  --split <mode>     prd: split the backlog — currently only 'criterion' (one file per criterion)
  --no-technical     prd (audit format): omit the technical ticket sections (Partie
                     technique + Contexte de reproduction) for a pure-auditor block
  --gh-issues        prd: also create one GitHub issue per criterion via the gh CLI (opt-in)
  --gh-single        prd: file the whole audit as ONE consolidated GitHub issue (opt-in; wins over --gh-issues)
  --scaffold         render: write an SSR-snapshot harness (default: ultra11y-render.tsx)
  --setup            render: install the zero-touch test-render capture harvester (.ultra11y/capture-setup.mjs) + print the runner wiring
  --coverage         render: report rendered-capture coverage (covered vs blind-spot components); with --json emits the coverage object
  --storybook        render: attribute per-story HTML (via storybook-static index.json) into .ultra11y/captures (point the HTML dir with --captures)
  --captures <dir>   audit/render: rendered-capture dir to ingest (default: .ultra11y/captures)
  --no-captures      audit: do NOT auto-detect/ingest .ultra11y/captures nor .ultra11y/pages
  --e2e              render: write the Playwright/Cypress fixtures into .ultra11y/e2e/
  --runner <name>    render --e2e: force playwright|cypress instead of auto-detecting
  --root <dir>       snapshot: project root holding .ultra11y/pages (default: .)
  --port <n>         dev: port for the side-car (default: 4111)
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
  --max-verify <n>   verify: cap the worklist size; 0 = no cap           (default: 40)
  --verdicts <file>  check --semantic: the adjudicated verdicts artifact
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
  --sample           scan: scan the NORMATIVE page sample from .ultra11yrc.json (its
                     sample.pages), per-page storage-state overriding --storage-state,
                     aggregating one result with per-page provenance for the report
  --clean            scan: remove the dynamic-tier image + temp contexts, then exit
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

const COMMANDS = [
  "audit",
  "report",
  "prd",
  "render",
  "criteria",
  "check",
  "verify",
  "scan",
  "sample",
  "snapshot",
  "pages",
  "dev",
  "fix",
  "init",
  "pack",
  "orchestrate",
] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(s: string | undefined): s is Command {
  return !!s && (COMMANDS as readonly string[]).includes(s);
}

const VALUE_FLAGS = new Set([
  "out",
  "in",
  "include",
  "exclude",
  "ext",
  "report",
  "theme",
  "apply",
  "verdicts",
  "max-verify",
  "lang",
  "merge",
  "sitemap",
  "crawl",
  "depth",
  "max",
  "since",
  "max-files",
  "dedup",
  "only",
  "standard",
  "baseline",
  "fail-on",
  "split",
  "pack",
  "format",
  "guidance",
  "runtime",
  "cwd",
  "storage-state",
  "captures",
  "run",
  "phase",
  "root",
  "runner",
  "port",
]);
// `init` treats --baseline as a boolean selector ("write the baseline"), not a
// path, so it must NOT consume the following token. audit/fix keep it as a value
// flag (`--baseline <file>`). Without this split, `init --baseline --hook` swallows
// --hook, and `init --baseline` never matches the `=== true` selector in cmdInit.
const INIT_VALUE_FLAGS = new Set([...VALUE_FLAGS].filter((f) => f !== "baseline"));

function valueFlagsFor(command: string): ReadonlySet<string> {
  return command === "init" ? INIT_VALUE_FLAGS : VALUE_FLAGS;
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
  "dry-run",
  "iterate",
  "safe",
  "hook",
  "ci",
  "list",
  "generate",
  "semantic",
  "manual",
  "no-technical",
  "gh-issues",
  "gh-single",
  "override",
  "local",
  "docker",
  "no-interact",
  "interact-clicks",
  "clean",
  "sample",
  "eco",
  "help",
  "version",
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
  if (process.env.ULTRA11Y_PR_COMMENT === "1") {
    const c = pushPrComment(md, standard);
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

async function cmdAudit(p: ParsedArgs): Promise<number> {
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
  const capturesDir = capturesFlag ?? ".ultra11y/captures";
  const scopedToDiff = p.flags.changed === true || p.flags.staged === true || since !== undefined;
  const capturesWanted = p.flags["no-captures"] !== true && !inputs.includes("-") && (capturesFlag !== undefined || existsSync(capturesDir));
  const useCaptures = capturesWanted && !scopedToDiff && !inputs.includes(capturesDir);
  // PAGE SNAPSHOTS (.ultra11y/pages/<id>/dom.html) are captures too — full rendered
  // documents carrying page identity — so the same ingestion applies. They are kept in a
  // separate tree because a snapshot is a directory of signals (dom + styles + boxes +
  // screenshot), not a lone .html. --no-captures opts out of both.
  const pagesWanted = p.flags["no-captures"] !== true && !inputs.includes("-") && existsSync(PAGES_DIR);
  const usePages = pagesWanted && !scopedToDiff && !inputs.includes(PAGES_DIR);
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
  if (usePages) {
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

// `pages` — the per-page criterion grid. RGAA is a per-page norm; the engine's verdict is
// scope-wide. Everything needed to bridge the two is already on the AuditResult, so this
// rebuilds the grid offline from a committed audit.json — no snapshots, no browser.
async function cmdPages(p: ParsedArgs): Promise<number> {
  const inFlag = p.flags.in;
  if (typeof inFlag !== "string" || !inFlag) {
    console.error("ultra11y pages: --in <audit.json> is required ('-' for stdin).");
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
  if (p.flags.json) console.log(JSON.stringify({ pages: derivePages(result, scope), unattributed: unattributedFindings(result).length }, null, 2));
  else console.log(renderPageGrid(result, scope, standard, lang));
  return 0;
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
  let payload: { meta?: unknown; dom?: unknown; styles?: StyleDigest; boxes?: BoxDigest; axtree?: AxNode; css?: CssDigest; screenshot?: unknown };
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
    });
  } catch (e) {
    console.error(`ultra11y snapshot write: could not write the snapshot: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  // The screenshot rides in as base64 (the producer has bytes, not a path). It powers the
  // pixel tier — measuring contrast where the CSSOM cannot, i.e. text over a gradient or an
  // image. A malformed one is dropped rather than fatal: the CSSOM rules still run.
  if (typeof payload.screenshot === "string" && payload.screenshot) {
    try {
      writeFileSync(join(dir, "screen.png"), Buffer.from(payload.screenshot, "base64"));
    } catch {
      console.error("ultra11y snapshot write: the screenshot could not be written — the pixel tier will be skipped for this page.");
    }
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
  let engineRel = process.argv[1] ?? "scripts/ultra11y.mjs";
  try {
    const abs = realpathSync(engineRel);
    engineRel = abs.startsWith(root + sep) ? relative(root, abs) : abs;
  } catch {
    /* keep as-is */
  }
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
  if (ciFormat) {
    emitCiFormat(result, ciFormat, standard, lang);
    return 0;
  }

  const path = writeReport(result, { out, lang, standard });
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
          ...(partial ? { partialAudit: true, untestedCriteria: untested } : {}),
        },
        null,
        2,
      ),
    );
  else console.log(path);
  return 0;
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

  // GitHub: always-written markdown above; issues are opt-in + best-effort.
  // --gh-single → one consolidated issue; --gh-issues → one issue per criterion.
  const ghMode: "single" | "per-criterion" | null = p.flags["gh-single"] === true ? "single" : p.flags["gh-issues"] === true ? "per-criterion" : null;
  let gh: { created: number; skipped: number; failed: number; errors: string[] } | undefined;
  if (ghMode) {
    const flag = ghMode === "single" ? "--gh-single" : "--gh-issues";
    const units = prdUnits(result, standard, lang);
    if (!ghAvailable()) {
      if (!json)
        console.error(`ultra11y prd: ${flag} skipped — \`gh\` is not installed or not authenticated (run \`gh auth login\`). Markdown was still written.`);
    } else if (units.length === 0) {
      if (!json) console.error(`ultra11y prd: ${flag} skipped — no findings to file.`);
    } else {
      const issueFormat = format === "remediation" ? "remediation" : "audit";
      gh = ghMode === "single" ? pushSingleIssue(units, lang, standard, issueFormat) : pushIssues(units, lang, standard, issueFormat);
      if (!json)
        console.log(
          lang === "fr"
            ? `ultra11y prd : issues GitHub — ${gh.created} créée(s), ${gh.skipped} déjà existante(s)${gh.failed ? `, ${gh.failed} en échec` : ""}.`
            : `ultra11y prd: GitHub issues — ${gh.created} created, ${gh.skipped} already existed${gh.failed ? `, ${gh.failed} failed` : ""}.`,
        );
      // Surface WHY gh failed (its stderr, previously swallowed) — always, even in --json
      // mode the reasons ride along in the payload; here we print them for humans.
      if (gh.failed && !json) {
        if (gh.errors.length) for (const e of gh.errors) console.error(lang === "fr" ? `ultra11y prd : gh a échoué — ${e}` : `ultra11y prd: gh failed — ${e}`);
        else console.error(lang === "fr" ? `ultra11y prd : gh a échoué sans message d'erreur.` : `ultra11y prd: gh failed with no error output.`);
      }
    }
  }
  if (json) console.log(JSON.stringify({ paths, units: prdUnits(result, standard, lang), ...(gh ? { gh } : {}) }, null, 2));
  // Markdown was written above regardless; but if issue creation was attempted and had
  // any failures, exit non-zero so a CI step / caller sees the GitHub push did not fully
  // succeed (a total failure previously exited 0 and looked green).
  return gh && gh.failed > 0 ? 1 : 0;
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
  const rep = p.flags.report;
  if (typeof rep !== "string" || !rep) {
    console.error("ultra11y check: --report <md> is required.");
    return 2;
  }
  const standard = stdOf(p, "check");
  if (standard === null) return 2;
  const lang = resolveLang(p.flags, { standard });
  const md = readInputFile(rep, "check", "--report");
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
  const res = checkReport(md, standard, lang, { audit });
  // --semantic: the support-level gate ON TOP of the structural check. Fails closed —
  // a green exit must always mean the gate engaged (family P0: never green-but-inactive).
  const sem =
    p.flags.semantic === true
      ? checkSemantic(md, {
          reportPath: rep,
          verdictsPath: typeof p.flags.verdicts === "string" && p.flags.verdicts ? p.flags.verdicts : undefined,
          standard,
          lang,
        })
      : null;
  const ok = res.ok && (sem === null || sem.ok);
  if (p.flags.json) {
    console.log(JSON.stringify(sem ? { ...res, ok, semantic: sem } : res, null, 2));
  } else if (!p.flags.quiet) {
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
    else for (const i of [...res.issues, ...(sem?.issues ?? [])]) console.error(`✗ ${i}`);
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
    // (src/adjudicate.ts); a plain ARRAY is the classic NC-verdicts worklist.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as { kind?: string }).kind === "adjudication") {
      return applyAdjudicationFile(p, parsed as AdjudicationFile, lang);
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
  const r = applyAdjudication(audit, adj);
  if (!r.ok) {
    if (p.flags.json) console.log(JSON.stringify(r, null, 2));
    else {
      console.error(lang === "fr" ? `✗ Adjudication rejetée (${r.issues.length} problème(s)) :` : `✗ Adjudication rejected (${r.issues.length} issue(s)):`);
      for (const i of r.issues) console.error(`  ✗ ${i}`);
    }
    return 1;
  }
  // Persist the updated audit so report/prd re-render with the adjudicated statuses.
  const out = typeof p.flags.out === "string" ? (p.flags.out as string) : ".";
  mkdirSync(out, { recursive: true });
  const auditPath = join(out, "audit-latest.json");
  writeFileSync(auditPath, JSON.stringify(r.audit, null, 2) + "\n");
  if (p.flags.json) console.log(JSON.stringify({ ok: true, auditPath, applied: r.applied, stillManual: r.stillManual, grounding: r.grounding }, null, 2));
  else
    console.log(
      lang === "fr"
        ? `✓ ${r.applied} critère(s) adjugé(s), ${r.stillManual} laissé(s) en résiduel → ${auditPath}`
        : `✓ ${r.applied} criterion(ia) adjudicated, ${r.stillManual} left residual → ${auditPath}`,
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
  else if (dockerAvailable()) useLocal = false;
  else {
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
      console.error(
        lang === "fr"
          ? "ultra11y scan : l'échantillon comporte des pages authentifiées (storageState), non prises en charge par le runtime Docker. Utilisez --runtime local --cwd <projet>."
          : "ultra11y scan: the sample has authenticated pages (storageState), unsupported by the Docker runtime. Use --runtime local --cwd <project>.",
      );
      return 2;
    }
  }

  let dynamic: DynamicResult;
  try {
    if (useSample && sampleConfig) {
      dynamic = useLocal
        ? await runSampleScanLocal(sampleConfig.pages, { cwd, storageState, lang, interact, interactClicks })
        : runSampleScan(sampleConfig.pages);
    } else if (sitemap || crawl) {
      const depth = typeof p.flags.depth === "string" ? Number(p.flags.depth) : undefined;
      const max = typeof p.flags.max === "string" ? Number(p.flags.max) : undefined;
      dynamic = useLocal
        ? await runCrawlScanLocal({ sitemap, crawl, depth, max, cwd, storageState, lang, interact, interactClicks })
        : await runCrawlScan({ sitemap, crawl, depth, max });
    } else {
      const targets = p.positionals.filter((a) => a !== "-");
      if (targets.length === 0) {
        console.error("ultra11y scan: provide one or more URLs/HTML files, --sitemap <url>, --crawl <url>, or --clean.");
        return 2;
      }
      if (useLocal) {
        dynamic =
          targets.length === 1
            ? await runScanLocal({ target: targets[0]!, cwd, storageState, lang, interact, interactClicks })
            : await runScanManyLocal(targets, { cwd, storageState, lang, interact, interactClicks });
      } else {
        dynamic = targets.length === 1 ? runScan({ target: targets[0]! }) : runScanMany(targets);
      }
    }
  } catch (e) {
    console.error(`ultra11y scan: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
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
    const merged = mergeDynamic(audit, dynamic, lang);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "audit-latest.json"), JSON.stringify(merged, null, 2) + "\n");
    if (p.flags.json) console.log(JSON.stringify(merged, null, 2));
    else
      console.log(
        lang === "fr"
          ? `Audit statique + dynamique fusionné → ${join(out, "audit-latest.json")} (${merged.conformancePct}% réussite, ${merged.findings.length} findings).`
          : `Static + dynamic audit merged → ${join(out, "audit-latest.json")} (${merged.conformancePct}% pass rate, ${merged.findings.length} findings).`,
      );
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
  const { missing } = lintSample(v.sample, methodology);
  const loc = pack?.defaultLocale ?? "fr";
  if (p.flags.json) {
    console.log(
      JSON.stringify(
        { ok: true, pages: v.sample.pages.length, missing: missing.map((k) => ({ id: k.id, label: kindLabel(k, loc) })), warnings: v.warnings },
        null,
        2,
      ),
    );
    return 0;
  }
  if (missing.length === 0) {
    console.log(
      lang === "fr"
        ? `✓ Échantillon complet (${v.sample.pages.length} page(s)) — tous les types de page requis par ${pack!.name} sont couverts.`
        : `✓ Sample complete (${v.sample.pages.length} page(s)) — every page kind ${pack!.name} requires is covered.`,
    );
  } else {
    console.log(
      (lang === "fr"
        ? `⚠️ Échantillon incomplet (${v.sample.pages.length} page(s)) — types de page requis absents (${pack!.name}) :`
        : `⚠️ Incomplete sample (${v.sample.pages.length} page(s)) — required page kinds missing (${pack!.name}):`) +
        ` ${missing.map((k) => kindLabel(k, loc)).join(", ")}`,
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
  // Warn (never silently ignore) on misspelled/unknown flags so `--grph` or
  // `--standrd rgaa` can't quietly leave cross-file/a standard disabled.
  for (const f of p.unknown) console.error(`ultra11y: unknown flag --${f} (ignored). Run \`ultra11y --help\`.`);

  // Enum-valued flags: warn (never silently coerce) on an unsupported value so `--lang de`
  // or `--dedup fuzzy` is visible instead of quietly falling back to the default.
  const ENUM_FLAGS: Record<string, readonly string[]> = {
    lang: ["auto", "en", "fr"],
    dedup: ["exact", "normalized", "off"],
    format: ["audit", "doc", "remediation"],
    split: ["criterion"],
    runtime: ["auto", "local", "docker"],
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
    case "dev":
      return cmdDev(p);
    case "fix":
      return cmdFix(p);
    case "init":
      return cmdInit(p);
    case "pack":
      return cmdPack(p);
    case "orchestrate":
      return cmdOrchestrate(p);
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
