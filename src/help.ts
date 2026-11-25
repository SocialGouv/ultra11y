// The CLI help, in both output languages. French is the default (no flag, or `--lang fr`);
// `--help --lang en` prints the English one. Both list exactly the same commands, flags,
// placeholders and examples — only the prose differs — so a doc citing a flag finds it in
// either (tests/skill-md.test.ts reads the default `--help`; tests/help.test.ts pins the parity).
import { VERSION, type Lang } from "./types.js";
import { DEFAULT_SAMPLE_SIZE } from "./sample-propose.js";

export const HELP_EN = `ultra11y v${VERSION}
Audit a site against RGAA 4.1.2, the French State's accessibility standard, and
produce a dated conformance report, or author/review accessible markup
(native-HTML-first). A deterministic, install-free static engine plus your judgment,
with check/verify gates against hallucinated non-conformities: nothing is declared
conforming that was not verified. Every output speaks RGAA 4.1.2; WCAG appears only
as the mapping each RGAA criterion cites (« RGAA 1.1 (WCAG 1.1.1) »).

Usage:
  ultra11y audit    <globs… | -> [--out <dir>] [--include <glob>] [--exclude <glob>] [--ext <list>] [--jsx] [--graph] [--json] [--lang auto|en|fr] [--no-default-excludes]
  ultra11y audit    [--changed | --since <ref> | --staged] [--max-files <n>] [--dedup exact|normalized|off] [--fail-on blocking|major|minor]
  ultra11y audit    [--captures <dir>] [--no-captures] [--require-captures]   (rendered-DOM captures + .ultra11y/pages snapshots: audit real HTML)
  ultra11y audit    --in <audit.json> [--fail-on blocking|major|minor]   (re-gate an audit already computed — e.g. one carrying adjudicated verdicts — without a second detection pass)
  ultra11y report   --in <audit.json> [--out <dir>] [--standard rgaa] [--lang auto|en|fr]
  ultra11y report   --in <audit.json> [--evidence [--evidence-max <n>]] [--out <dir>]   (the Markdown report, illustrated with annotated crops)
  ultra11y report   --in <audit.json> --html [--evidence] [--inline-budget <bytes>] [--theme neutral|dsfr [--root <dir>]] [--out <dir>]   (index.html + a printable single file)
  ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc] [--no-technical] [--standard rgaa] [--lang auto|en|fr]
  ultra11y tickets  --in <audit.json> [--provider auto|github|gitlab|jira] [--grain criterion|page|page-criterion|single|file] [--transport auto|cli|rest]
  ultra11y tickets  [--out <dir>] [--max-tickets <n>] [--dry-run] [--json] [--standard rgaa] [--no-technical] [--lang auto|en|fr]
  ultra11y render   [<dir>] [--transpiler esbuild|typescript|sucrase] [--timeout <ms>] [--include <glob>] [--exclude <glob>] [--no-stories] [--no-snapshots] [--browser-path <file>] [--json]   (ultra11y's render engine: components, pages, stories → .ultra11y/captures + .ultra11y/render.json + .ultra11y/render-snapshots)
  ultra11y render   [<dir>] --detect | --coverage | --storybook [--captures <dir>] [--json] [--lang auto|en|fr]
  ultra11y criteria [<sc>] [--list] [--standard rgaa] [--theme <N>] [--generate] [--json] [--lang auto|en|fr]
  ultra11y criteria --glossary [<term>]   (the terms the standard DEFINES — its tests depend on them)
  ultra11y criteria [--standard rgaa] --plan [--json]   (the work plan: which criteria the engine settles from source, which need a page, a browser, or judgment)
  ultra11y check    --report <md> [--standard rgaa] [--in <audit.json>] [--semantic [--verdicts <file>]] [--quiet] [--json]
  ultra11y check    --in <audit.json> --require-decided [--standard rgaa] [--allow-undecided <file>]   (fail while any criterion is still « to assess »)
  ultra11y verify   --report <md> [--standard rgaa] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--out <dir>] [--json]
  ultra11y verify   --report <md> [--conformities <ledger|adjudication.json> | --no-conformities]   (also put the claimed CONFORMITIES on trial — on by default when a ledger exists)
  ultra11y verify   --report <md> --in <audit.json> --manual [--out <dir>] [--json]   (adjudicate the manual criteria)
  ultra11y verify   --apply <adjudication.json> --in <audit.json> [--out <dir>]        (fold the adjudication into the audit)
  ultra11y verify   --apply <VERIFY.todo.json> --report <md> --in <audit.json> --out <dir> --prune   (APPLY the trial: delete refuted non-conformities, send refuted conformities back to « à évaluer »)
  ultra11y verify   --summary --verdicts <VERIFY.todo.json> --report <md> --in <audit.json> [--pruned <audit.json>] [--out <dir>] [--json]   (read-only bilan of the trial → TRIAL.md: confirmed, withdrawn/applied, contested engine decisions, coverage, gate)
  ultra11y orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list] [--lang auto|en|fr]
  ultra11y orchestrate --run <dir> --manifest [--json]   (the loop as data: each step's command/argv, inputs, outputs, exit contract, next step — for any orchestrator)
  ultra11y fix      <globs… | -> [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--include <glob>] [--exclude <glob>] [--ext <list>] [--only <ids>] [--jsx] [--json] [--lang auto|en|fr]
  ultra11y init     [--hook] [--fail-on blocking|major|minor]
  ultra11y scan     <url|file…> [--cwd <dir>] [--browser-path <file>] [--root <dir>] [--storage-state <file>] [--no-interact] [--interact-clicks] [--no-snapshot] [--no-pdf] [--max-pdf <n>] [--merge <audit.json>] [--out <dir>] [--json]
  ultra11y scan     --sample [--cwd <dir>] [--root <dir>] [--storage-state <file>] [--all-routes [--max-routes <n>]] [--merge <audit.json>] [--json]   (scan the .ultra11yrc.json page sample, then the rest of the route inventory)
  ultra11y scan     --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--cwd <dir>] [--root <dir>] [--merge <audit.json>] [--json]
  ultra11y scan     --since <ref> --base-url <url> [--baseline <scan.json>] [--fail-on blocking|major|minor] [--max-routes <n>] [--json]   (render only the pages the diff reaches; with --baseline, fail only on NEW non-conformities)
  ultra11y affected [--since <ref>] [--base-url <url>] [--root <dir>] [--json]   (the pages a diff reaches, over the import graph and the route inventory)
  ultra11y journey  run [<name>… | --all] [--keyboard] [--base-url <url>] [--storage-state <file>] [--cwd <dir>] [--root <dir>] [--merge <audit.json>] [--out <dir>] [--json]   (replay .ultra11y/journeys/<name>.json with axe + keyboard checks)
  ultra11y journey  list [--root <dir>] [--json]
  ultra11y sample   check [--standard rgaa] [--json]   (lint the .ultra11yrc.json page sample vs the standard's required page kinds)
  ultra11y snapshot write [--root <dir>] [--fail-on blocking|major|minor] [--json]   (payload on stdin → .ultra11y/pages/<id>/ + audit it)
  ultra11y snapshot list  [--root <dir>] [--json]
  ultra11y pages    --in <audit.json> [--standard rgaa] [--json [--out <dir>]] [--lang auto|en|fr]   (the per-page criterion grid; --json --out also writes <dir>/pages.json)
  ultra11y pages    --in <audit.json> --format report [--split page] [--out <dir>]        (the per-page report, with screenshots)
  ultra11y pages    --in <audit.json> --format report --out <dir> [--evidence [--evidence-max <n>]] [--html]   (annotated crops of each non-conformity, and the HTML site)
  ultra11y pages    discover --sitemap <url> | --crawl <url> | --from-snapshots [--depth <n>] [--max <n>] [--propose [--sample-size <n>] [--search-query <q>]] [--write | --routes-only] [--json]   (build the page sample and the route inventory)
  ultra11y hook     --claude-code|--codex|--opencode   (internal: the PreToolUse hook; payload on stdin)
  ultra11y install   --claude-code | --codex | --opencode | --agents-md | --all  [--project] [--dry-run] [--no-skills] [--opencode-version 1|2]
  ultra11y uninstall --claude-code | --codex | --opencode | --agents-md | --all  [--project]
  ultra11y status   [--json] [--project] [--browser [--cwd <dir>]]   (doctor: which agents run the review; --browser asks whether the scan tier resolves here)
  ultra11y serve    [--in <dir>] [--root <dir>] [--port <n>] [--host <addr>] [--theme neutral|dsfr] [--lang auto|en|fr]   (local, read-only results site over audits/ and its history)
  ultra11y serve    [--in <dir>] [--root <dir>] --static <dir> [--theme neutral|dsfr] [--lang auto|en|fr]   (the same pages as a static export, relative links only — GitHub Pages, iterion)

Commands:
  audit      Run the static engine over the inputs (files/globs, or '-' for stdin)
             and emit the RGAA 4.1.2 audit JSON, keyed by RGAA criterion
             (consumed by 'report'). Without --json, prints a summary in --lang
             (default auto: repo <html lang> → the active standard's default locale
             → French). The engine decides the machine-detectable criteria; the AI
             agent adjudicates the judgment ones (verify --manual, gated) and the
             scan tier decides the needs-rendering ones.
  report     Render an audit into a dated RGAA 4.1.2 conformance report
             (audits/rgaa-YYYY-MM-DD.md): metadata, per-theme synthesis table,
             non-conformities by priority, conforming + not-applicable lists.
  prd        Turn an AuditResult into an AUDITOR conformance backlog
             (audits/prd-YYYY-MM-DD.md), one entry per criterion rendered with the
             RGAA vocabulary ("Thématique/Critère/Test") — theme, criterion +
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
             Then each capture is opened in Chromium (when Playwright and a browser
             are available — otherwise it says so and the static captures stand):
             a screenshot and an axe pass, with the project's global CSS when found
             (root layout/_app/main imports, linked public/ stylesheets, a build's
             compiled CSS for Tailwind/Sass sources). Written to
             .ultra11y/render-snapshots/ (PNG + index.json) and shown in the report.
             These are ISOLATED component renders: page-level axe rules are set
             aside, style-dependent ones too without the full CSS, and no snapshot
             observation ever decides a criterion. --no-snapshots skips the pass.
             --detect prints the framework's build→audit recipe instead.
             --coverage reports which components have a rendered capture vs
             which are still opaque-source-only blind spots. --storybook attributes
             per-story HTML (via a storybook-static index) back to source components.
             To check a PAGE during an existing Playwright/Cypress run, use the
             ultra11y/playwright or ultra11y/cypress package exports. Then audit, and
             use scan for the needs-rendering criteria.
  criteria   Look up the RGAA 4.1.2 reference offline: one criterion (criteria 1.1),
             a theme (--theme N), or the theme list. Carries the WCAG mapping each
             criterion cites + automatability class; a WCAG success-criterion id
             (criteria 1.4.3) prints that mapping target.
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
  journey    Replay the user journeys the agent wrote (.ultra11y/journeys/<name>.json:
             startUrl + steps goto|click|fill|select|check|press|waitFor|expect on
             role/label/text locators) in the local Playwright. Every step records a
             page-state snapshot (.ultra11y/pages/<journey>-<nn>-<slug>/) measured
             with the pinned axe-core and the live probes, plus what only a journey
             sees: --keyboard reaches each control with Tab (a control never reached
             is 2.1.1, a region Tab and Shift+Tab cannot leave is 2.1.2), focus into
             and back out of dialogs (2.4.3), errors tied to no field (3.3.1), text
             appearing outside a live region (4.1.3). A failing step stops its journey
             with the reason; the annex lists every step done / failed / not run.
             Exit 1 when a journey failed.
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
  affected   The pages a change can reach: from each file changed since --since
             (default: the repository's default branch, merge-base semantics), walk
             the reverse import graph up to the route files (Next.js app/ and pages/,
             layouts selecting every page below them) and the sources the sample
             declares, then name their URLs — dynamic routes resolved against the
             route inventory (.ultra11y/routes.json) and the sample. 'scan --since'
             renders exactly these pages.
  pages      The per-page criterion grid — RGAA is a per-page norm, the engine's
             verdict is scope-wide, and this bridges the two. One row per criterion
             (RGAA's), one column per page URL. Rebuilt from a
             committed audit.json alone: no snapshots on disk, no browser.
             Two honesty rules: a finding is attributed to a page only when something
             SAYS so (the snapshot it was raised on, the scanned URL, the sample page
             name, or the page's recorded source files) — anything else is reported as
             UNATTRIBUTED, never spread across pages; and "no finding here" means
             conforming only for a page whose real rendered DOM was audited. A page
             known only by source attribution keeps its undecided criteria "to assess".
  serve      The audit results as a small local site: every audit found in --in
             (default: audits; any current audit JSON up to three levels deep, so
             dated copies like audits/2026-09-01/audit-latest.json form the HISTORY),
             each with its dashboard and grid of the 106 criteria, the conformity
             rate and the mean page rate (the report's own figures), one sheet per
             page with its screenshot, the journeys, the component snapshots and its
             files; and, between two successive audits, the evolution: each criterion
             whose status changed and the rate change in points. Read-only, node:http
             only, bound to 127.0.0.1 (--host to open it), on --port (default 4711;
             the next free port when busy). It serves files from the audits dir,
             .ultra11y/pages and .ultra11y/render-snapshots only, never lists a
             directory, and refuses any path that escapes them, links included.
             --static <dir> writes the same pages as plain files with relative links,
             so they publish as they are under a sub-path (GitHub Pages, iterion).

Options:
  --out <dir>        output dir (report/prd/scan default: audits); for audit, persist
                     audit-latest.json here — a plain audit writes nothing without it.
                     For audit, a value ending in .json is a FILE target (written exactly);
                     the path actually written is echoed on stderr
  --in <file>        report: the AuditResult JSON to render ('-' for stdin)
                     · serve: the audits DIRECTORY to read (default: audits)
  --port <n>         serve: the port to listen on (default 4711; 0 = any free port)
  --host <addr>      serve: the address to bind (default 127.0.0.1; anything else exposes the
                     results to the network — opt in knowingly)
  --static <dir>     serve: write a static export of the site to <dir> instead of serving
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
                     · scan/affected: the pages the files changed since <ref> reach
  --staged           audit/fix: only STAGED files, read from the index blob (exact commit snapshot; wins over --changed)
  --max-files <n>    audit: cap canonical files audited (logged truncation, no silent drop)
  --dedup <mode>     audit: collapse identical files — exact|normalized|off  (default: exact)
  --standard rgaa    RGAA 4.1.2, the default and only standard (accepted for scripts that
                     pass it explicitly; --standard wcag was removed and exits 2)
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
  --no-snapshots     render: skip the visual pass (screenshot + axe of each capture in Chromium). Env: ULTRA11Y_RENDER_SNAPSHOTS=off
  --coverage         render: report rendered-capture coverage (covered vs blind-spot components); with --json emits the coverage object
  --storybook        render: attribute per-story HTML (via storybook-static index.json) into .ultra11y/captures (point the HTML dir with --captures)
  --captures <dir>   audit/render: rendered-capture dir to ingest (default: .ultra11y/captures)
  --no-captures      audit: do NOT auto-detect/ingest .ultra11y/captures nor .ultra11y/pages
  --root <dir>       snapshot, scan, serve, --theme dsfr: project root holding
                     .ultra11y/pages and .ultra11yrc.json (default: . — scan writes the
                     snapshots it collects under it)
  --glossary [<t>]   criteria: look up a term the country standard defines (or list all)
  --require-captures audit: gate — fail if any opaque/control component lacks a rendered capture (implies --graph)
  --write            fix: apply fixes to disk (default is a dry-run diff)
  --iterate          fix: with --write, re-audit + re-apply mechanical fixes until stable (bounded)
  --dry-run          fix: preview only — never write (this is the default)
  --safe             fix: apply only genuinely-automatic codemods (skip TODO placeholders / judgment proposals)
  --only <ids>       fix: limit auto-fixes to these rule ids (comma-separated)
  --baseline <file>  scan: a previous 'scan --json' of the same pages (e.g. on the base
                     branch's deployment); exit 1 only on findings it does not hold
  --base-url <url>   scan --since / affected: the deployment the pages are rendered on;
                     journey run: the base a relative startUrl resolves against
  --fail-on <sev>    audit/init/snapshot/scan --baseline: gate severity — blocking|major|minor (fr aliases accepted)  (default: blocking)
  --hook             init: write a git pre-commit accessibility gate (staged snapshot + auto-fix by default)
  --report <file>    check/verify: the report markdown to gate
  --theme <N>        criteria: list RGAA theme N
  --theme <name>     report --html, pages --html, serve: the HTML look — neutral (default) or
                     dsfr, read from the PROJECT's own @gouvfr/dsfr (resolved from --root);
                     ultra11y never ships nor downloads it (its terms reserve it to .gouv.fr
                     sites). Package missing: exit 2. Also .ultra11yrc.json "html.theme"
  --plan             criteria: the work plan — criteria per evidence tier (source,
                     cross-file, rendered-page, browser, judgment, out-of-scope)
  --list             criteria: print the RGAA themes
  --generate         criteria: emit the bundled references/criteria.md (the WCAG mapping table)
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
  --browser-path <file>  scan / render / status --browser: launch THIS browser executable (e.g. a
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
                     carrying the refusal, and every verdict that proved itself lands;
                     any refusal still exits 1 (incomplete fold, partial audit written)
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
  --lang auto|en|fr  output language                (default: auto — French; --lang en for
                     English. Unset: repo <html lang> → the standard's default locale (fr for
                     RGAA) → fr. An AI caller should pass --lang explicitly to match the chat)
  --json             machine-readable output
  --quiet            check: exit code only, no output
  -h, --help         show this help (in French by default; --help --lang en: in English)
  -v, --version      print version

Data: WCAG 2.2 © W3C (W3C Document License). RGAA 4.1.2 pack © DINUM, Licence Ouverte / Etalab 2.0 (see NOTICE).`;

export const HELP_FR = `ultra11y v${VERSION}
Audite un site au regard du RGAA 4.1.2, le référentiel d'accessibilité de l'État
français, et produit un rapport de conformité daté, ou rédige/relit du balisage
accessible (HTML natif d'abord). Un moteur statique déterministe, sans installation,
plus votre jugement, avec des barrières check/verify contre les non-conformités
inventées : rien n'est déclaré conforme sans avoir été vérifié. Toutes les sorties
parlent RGAA 4.1.2 ; le WCAG n'apparaît que comme la correspondance citée par chaque
critère RGAA (« RGAA 1.1 (WCAG 1.1.1) »).

Usage :
  ultra11y audit    <globs… | -> [--out <dir>] [--include <glob>] [--exclude <glob>] [--ext <list>] [--jsx] [--graph] [--json] [--lang auto|en|fr] [--no-default-excludes]
  ultra11y audit    [--changed | --since <ref> | --staged] [--max-files <n>] [--dedup exact|normalized|off] [--fail-on blocking|major|minor]
  ultra11y audit    [--captures <dir>] [--no-captures] [--require-captures]   (captures du DOM rendu + instantanés .ultra11y/pages : auditer le vrai HTML)
  ultra11y audit    --in <audit.json> [--fail-on blocking|major|minor]   (rejouer la barrière sur un audit déjà calculé — par exemple porteur de verdicts arbitrés — sans seconde passe de détection)
  ultra11y report   --in <audit.json> [--out <dir>] [--standard rgaa] [--lang auto|en|fr]
  ultra11y report   --in <audit.json> [--evidence [--evidence-max <n>]] [--out <dir>]   (le rapport Markdown, illustré de recadrages annotés)
  ultra11y report   --in <audit.json> --html [--evidence] [--inline-budget <bytes>] [--theme neutral|dsfr [--root <dir>]] [--out <dir>]   (index.html + un fichier unique imprimable)
  ultra11y prd      --in <audit.json> [--out <dir>] [--split criterion] [--format audit|doc] [--no-technical] [--standard rgaa] [--lang auto|en|fr]
  ultra11y tickets  --in <audit.json> [--provider auto|github|gitlab|jira] [--grain criterion|page|page-criterion|single|file] [--transport auto|cli|rest]
  ultra11y tickets  [--out <dir>] [--max-tickets <n>] [--dry-run] [--json] [--standard rgaa] [--no-technical] [--lang auto|en|fr]
  ultra11y render   [<dir>] [--transpiler esbuild|typescript|sucrase] [--timeout <ms>] [--include <glob>] [--exclude <glob>] [--no-stories] [--no-snapshots] [--browser-path <file>] [--json]   (le moteur de rendu d'ultra11y : composants, pages, stories → .ultra11y/captures + .ultra11y/render.json + .ultra11y/render-snapshots)
  ultra11y render   [<dir>] --detect | --coverage | --storybook [--captures <dir>] [--json] [--lang auto|en|fr]
  ultra11y criteria [<sc>] [--list] [--standard rgaa] [--theme <N>] [--generate] [--json] [--lang auto|en|fr]
  ultra11y criteria --glossary [<term>]   (les termes que le référentiel DÉFINIT — ses tests en dépendent)
  ultra11y criteria [--standard rgaa] --plan [--json]   (le plan de travail : quels critères le moteur tranche depuis le source, lesquels demandent une page, un navigateur ou du jugement)
  ultra11y check    --report <md> [--standard rgaa] [--in <audit.json>] [--semantic [--verdicts <file>]] [--quiet] [--json]
  ultra11y check    --in <audit.json> --require-decided [--standard rgaa] [--allow-undecided <file>]   (échoue tant qu'un critère est encore « à évaluer »)
  ultra11y verify   --report <md> [--standard rgaa] [--semantic] [--apply <verdicts.json>] [--max-verify <n>] [--out <dir>] [--json]
  ultra11y verify   --report <md> [--conformities <ledger|adjudication.json> | --no-conformities]   (met aussi en procès les CONFORMITÉS revendiquées — actif par défaut quand un registre existe)
  ultra11y verify   --report <md> --in <audit.json> --manual [--out <dir>] [--json]   (arbitrer les critères manuels)
  ultra11y verify   --apply <adjudication.json> --in <audit.json> [--out <dir>]        (intégrer l'arbitrage à l'audit)
  ultra11y verify   --apply <VERIFY.todo.json> --report <md> --in <audit.json> --out <dir> --prune   (APPLIQUER le procès : supprimer les non-conformités réfutées, renvoyer les conformités réfutées « à évaluer »)
  ultra11y verify   --summary --verdicts <VERIFY.todo.json> --report <md> --in <audit.json> [--pruned <audit.json>] [--out <dir>] [--json]   (bilan en lecture seule du procès → TRIAL.md : confirmées, retirées/appliquées, décisions du moteur contestées, couverture, barrière)
  ultra11y orchestrate --run <dir> [--phase adjudicate|verify-report] [--eco] [--list] [--lang auto|en|fr]
  ultra11y orchestrate --run <dir> --manifest [--json]   (la boucle sous forme de données : commande/argv de chaque étape, entrées, sorties, contrat de sortie, étape suivante — pour tout orchestrateur)
  ultra11y fix      <globs… | -> [--write] [--iterate] [--changed | --since <ref> | --staged] [--safe] [--include <glob>] [--exclude <glob>] [--ext <list>] [--only <ids>] [--jsx] [--json] [--lang auto|en|fr]
  ultra11y init     [--hook] [--fail-on blocking|major|minor]
  ultra11y scan     <url|file…> [--cwd <dir>] [--browser-path <file>] [--root <dir>] [--storage-state <file>] [--no-interact] [--interact-clicks] [--no-snapshot] [--no-pdf] [--max-pdf <n>] [--merge <audit.json>] [--out <dir>] [--json]
  ultra11y scan     --sample [--cwd <dir>] [--root <dir>] [--storage-state <file>] [--all-routes [--max-routes <n>]] [--merge <audit.json>] [--json]   (scanner l'échantillon de pages de .ultra11yrc.json, puis le reste de l'inventaire des routes)
  ultra11y scan     --sitemap <url> | --crawl <url> [--depth <n>] [--max <n>] [--cwd <dir>] [--root <dir>] [--merge <audit.json>] [--json]
  ultra11y scan     --since <ref> --base-url <url> [--baseline <scan.json>] [--fail-on blocking|major|minor] [--max-routes <n>] [--json]   (ne rendre que les pages atteintes par le diff ; avec --baseline, n'échouer que sur les NOUVELLES non-conformités)
  ultra11y affected [--since <ref>] [--base-url <url>] [--root <dir>] [--json]   (les pages qu'un diff atteint, via le graphe d'imports et l'inventaire des routes)
  ultra11y journey  run [<name>… | --all] [--keyboard] [--base-url <url>] [--storage-state <file>] [--cwd <dir>] [--root <dir>] [--merge <audit.json>] [--out <dir>] [--json]   (rejouer .ultra11y/journeys/<name>.json avec axe + contrôles clavier)
  ultra11y journey  list [--root <dir>] [--json]
  ultra11y sample   check [--standard rgaa] [--json]   (vérifier l'échantillon de pages de .ultra11yrc.json au regard des types de pages exigés par le référentiel)
  ultra11y snapshot write [--root <dir>] [--fail-on blocking|major|minor] [--json]   (charge utile sur stdin → .ultra11y/pages/<id>/ + audit)
  ultra11y snapshot list  [--root <dir>] [--json]
  ultra11y pages    --in <audit.json> [--standard rgaa] [--json [--out <dir>]] [--lang auto|en|fr]   (la grille des critères par page ; --json --out écrit aussi <dir>/pages.json)
  ultra11y pages    --in <audit.json> --format report [--split page] [--out <dir>]        (le rapport par page, avec captures d'écran)
  ultra11y pages    --in <audit.json> --format report --out <dir> [--evidence [--evidence-max <n>]] [--html]   (recadrages annotés de chaque non-conformité, et le site HTML)
  ultra11y pages    discover --sitemap <url> | --crawl <url> | --from-snapshots [--depth <n>] [--max <n>] [--propose [--sample-size <n>] [--search-query <q>]] [--write | --routes-only] [--json]   (construire l'échantillon de pages et l'inventaire des routes)
  ultra11y hook     --claude-code|--codex|--opencode   (interne : le hook PreToolUse ; charge utile sur stdin)
  ultra11y install   --claude-code | --codex | --opencode | --agents-md | --all  [--project] [--dry-run] [--no-skills] [--opencode-version 1|2]
  ultra11y uninstall --claude-code | --codex | --opencode | --agents-md | --all  [--project]
  ultra11y status   [--json] [--project] [--browser [--cwd <dir>]]   (diagnostic : quels agents lancent la revue ; --browser demande si le palier scan est disponible ici)
  ultra11y serve    [--in <dir>] [--root <dir>] [--port <n>] [--host <addr>] [--theme neutral|dsfr] [--lang auto|en|fr]   (site local, en lecture seule, des résultats de audits/ et de leur historique)
  ultra11y serve    [--in <dir>] [--root <dir>] --static <dir> [--theme neutral|dsfr] [--lang auto|en|fr]   (les mêmes pages en export statique, liens relatifs uniquement — GitHub Pages, iterion)

Commandes :
  audit      Lance le moteur statique sur les entrées (fichiers/globs, ou '-' pour stdin)
             et émet le JSON d'audit RGAA 4.1.2, indexé par critère RGAA
             (consommé par 'report'). Sans --json, affiche un résumé dans la langue
             --lang (par défaut auto : <html lang> du dépôt → locale par défaut du
             référentiel actif → français). Le moteur tranche les critères détectables
             par la machine ; l'agent IA arbitre ceux qui relèvent du jugement
             (verify --manual, sous barrière) et le palier scan tranche ceux qui
             demandent un rendu.
  report     Transforme un audit en rapport de conformité RGAA 4.1.2 daté
             (audits/rgaa-AAAA-MM-JJ.md) : métadonnées, tableau de synthèse par
             thématique, non-conformités par priorité, listes des critères conformes
             et non applicables.
  prd        Transforme un AuditResult en backlog de conformité d'AUDITEUR
             (audits/prd-AAAA-MM-JJ.md), une entrée par critère rédigée avec le
             vocabulaire RGAA (« Thématique/Critère/Test ») — thématique, critère +
             intitulé officiel, test(s), correspondance WCAG + niveau, constat, état
             attendu, vérification. --split criterion écrit un fichier par critère.
             Il n'écrit QUE du Markdown — créer les tickets, c'est la commande 'tickets'.
  tickets    Dépose l'audit sous forme de TICKETS — GitHub, GitLab ou Jira. Lit un
             audit.json et pousse ; il n'écrit aucun Markdown, exactement comme
             prd/report écrivent du Markdown et ne poussent rien. --grain choisit ce
             qu'est UN ticket : par critère (défaut), par page, par page+critère, par
             fichier, ou un seul consolidé. Le dédoublonnage se fait sur le titre
             exact : relancer ne crée jamais de doublon. --dry-run affiche le plan sans
             rien créer.
  render     Le moteur de rendu propre à ultra11y : obtenir le HTML RENDU des
             composants d'un projet, pour que des bibliothèques comme le DSFR soient
             vérifiées sur le HTML qu'elles émettent, pas sur leurs sources JSX. Il
             trouve les modules .tsx/.jsx (leurs exports de composant par défaut et en
             PascalCase), les pages du framework (app/ et pages/ de Next.js) et les
             stories Storybook (rendues avec leurs args), et rend chacun avec le
             react-dom/server DU PROJET, sans props, dans un harnais jetable : un
             processus enfant par fichier, TSX transpilé en mémoire par
             l'esbuild/typescript/sucrase du projet, aucun fichier du projet écrit, un
             --timeout par unité (10000 ms par défaut). Il ne lit ni n'exécute jamais
             les tests ou snapshots du projet. Chaque rendu arrive dans .ultra11y/captures
             (provenance : source, composant, moteur de rendu, styles="none") ; chaque
             unité, rendue, ignorée avec sa raison, ou non tentée, est listée dans
             .ultra11y/render.json, que 'audit' reprend dans l'annexe du rapport.
             Puis chaque capture est ouverte dans Chromium (quand Playwright et un
             navigateur sont disponibles — sinon il le dit et les captures statiques
             restent) : une capture d'écran et une passe axe, avec le CSS global du
             projet quand il est trouvé (imports du layout racine/_app/main, feuilles
             public/ liées, CSS compilé d'un build pour des sources Tailwind/Sass).
             Écrit dans .ultra11y/render-snapshots/ (PNG + index.json) et montré dans
             le rapport. Ce sont des rendus de composants ISOLÉS : les règles axe de
             niveau page sont écartées, celles qui dépendent du style aussi faute du CSS
             complet, et aucune observation d'instantané ne tranche jamais un critère.
             --no-snapshots saute cette passe.
             --detect affiche à la place la recette build→audit du framework.
             --coverage indique quels composants ont une capture rendue et lesquels
             restent des angles morts au source opaque. --storybook rattache le HTML de
             chaque story (via un index storybook-static) à ses composants sources.
             Pour vérifier une PAGE pendant un run Playwright/Cypress existant, utilisez
             les exports de paquet ultra11y/playwright ou ultra11y/cypress. Ensuite
             auditez, et utilisez scan pour les critères qui demandent un rendu.
  criteria   Consulte le référentiel RGAA 4.1.2 hors ligne : un critère (criteria 1.1),
             une thématique (--theme N), ou la liste des thématiques. Donne la
             correspondance WCAG citée par chaque critère + sa classe d'automatisabilité ;
             un identifiant de critère de succès WCAG (criteria 1.4.3) affiche cette
             cible de correspondance.
             --glossary [<term>] cherche un terme que le référentiel DÉFINIT (le RGAA en
             compte 119). Ces définitions sont normatives — ce que « si nécessaire » ou
             « pertinent » veulent dire dans un test se décide là — et la liste de
             travail d'arbitrage intègre désormais celles que citent les tests de chaque
             critère. Sans terme, les liste toutes. Résout par ancre ou par titre, sans
             tenir compte des accents ; un terme inconnu renvoie une erreur avec des
             suggestions plutôt qu'un quasi-homonyme.
             --plan affiche le plan de travail : par palier de preuve (source,
             inter-fichiers, page rendue, navigateur, jugement, hors périmètre), combien
             de critères il tranche — selon l'applicabilité des règles du moteur, pas une
             lecture de l'intitulé. RGAA : 104 sur 106 demandent plus que le source pour
             obtenir C.
  check      Barrière d'intégrité sur un rapport produit : chaque critère cité se
             résout, chaque NA est justifié, les sections et le calcul des taux sont
             bien formés. --standard indique la grammaire d'identifiants/le registre à
             utiliser pour valider.
  verify     Liste de travail contradictoire affirmation↔critère, puis (--apply)
             barrière sur les affirmations réfutées/non étayées. Couvre les DEUX sens :
             les non-conformités du rapport (cet échec est-il réel ?) et les conformités
             arbitrées par l'agent dans le registre (la preuve citée ÉTABLIT-elle le
             critère, ou montre-t-elle seulement que son objet existe ?). Une conformité
             réfutée renvoie son critère « à évaluer », jamais en NC.
  orchestrate  Émet l'orchestration multi-agents du run depuis ses listes de travail
             ACTUELLES : pour chaque phase prête (adjudicate sur ADJUDICATE.todo.json,
             verify-report sur VERIFY.todo.json) un <phase>.batches.json neutre vis-à-vis
             du harnais, un prompt autonome par lot sous <phase>/ (à transmettre tel quel
             à n'importe quel sous-agent), et le script Workflow Claude Code rendu depuis
             les mêmes lots ; les contrats de répartition agents/<role>.md, et un repli
             séquentiel RUNBOOK.md — chemins absolus et vrais identifiants de la liste de
             travail intégrés. Les sous-agents ne font que RENVOYER des fragments de
             verdict ; vous (l'appelant) restez le seul rédacteur et les intégrez via
             verify --apply. --eco n'émet que le RUNBOOK + les contrats (la voie
             explicite économe en tokens) ; --list affiche les phases et leur état de
             préparation en JSON. Relancez après tout changement d'une liste de travail —
             l'émission est déterministe et idempotente.
  fix        Met les corrections en place (hybride, HTML natif d'abord) : applique des
             codemods déterministes (tabindex, rôle redondant, zoom du viewport), insère
             des espaces réservés à compléter (alt/lang/title TODO) pour l'agent, et liste
             les propositions qui relèvent du jugement. --dry-run (défaut) affiche un
             diff ; --write applique, mais seulement après qu'un nouvel audit a prouvé
             l'absence de nouvelle NC ; sur du JSX à AST réel, seuls les codemods jsxSafe
             s'appliquent (jamais de réécriture de nom). --iterate boucle jusqu'à un
             point fixe.
  init       Branche ultra11y dans le dépôt (zéro dépendance, pas de husky). Par défaut,
             --hook est une barrière git pre-commit sur l'INSTANTANÉ STAGED STRICT : il
             audite exactement les blobs indexés, applique automatiquement les
             corrections sûres (fix --staged --write --safe) et les remet en staging, et
             ne bloque que sur ce qui demande du jugement. La CI n'est pas branchée ici :
             elle passe par le bot rgaa-audit d'iterion.
  scan       Palier dynamique OPTIONNEL : lance axe-core dans un navigateur sans
             interface pour trancher les critères qui demandent un rendu et que le moteur
             statique ne peut pas trancher — contraste calculé (1.4.3), redistribution à
             320px (1.4.10) — sur une URL ou un fichier HTML. Il tourne sur le Playwright
             local (résolu depuis --cwd, puis depuis les dépendances d'ultra11y), et
             sonde en plus la visibilité du focus (2.4.7), le focus non masqué (2.4.11 —
             le composant qui a le focus est-il entièrement caché derrière un en-tête
             collant / un bandeau cookies ? mesuré pendant le même parcours de la
             tabulation), le zoom à 200% (1.4.4), l'espacement du texte (1.4.12), le
             contenu au survol (1.4.13) et la taille des cibles (2.5.8), et accepte
             --storage-state pour les pages authentifiées.
             Par défaut le scan est AVEC ÉTAT : il saisit de longues valeurs dans les
             champs et signale ceux qui sont tronqués à 320px/200%/espacement du texte
             (1.4.10/1.4.4/1.4.12 — surtout les champs dans des cellules de tableau),
             ouvre les dialogues fermés pour revérifier le focus, et mène des
             interactions SÛRES (saisir / basculer / cliquer type=button — jamais un
             lien, une soumission ou une navigation ; les boutons au nom destructeur ne
             sont jamais cliqués) pour repérer un contenu mis à jour hors d'une région
             live (4.1.3). Sur un scan AUTHENTIFIÉ (--storage-state), les clics de bouton
             sont aussi sautés, sauf si --interact-clicks les réactive. --no-interact
             désactive tout cela (sondes sur la page vierge uniquement). --merge intègre
             les constats dans un AuditResult statique (manuel → C/NC).
             --sitemap/--crawl scannent de nombreuses pages (chaque URL du sitemap, ou
             les liens de même origine parcourus en largeur depuis une URL de départ) et
             agrègent les constats.
             --sample scanne l'échantillon NORMATIF de pages déclaré dans
             .ultra11yrc.json (pages représentatives + éléments transverses) ; le
             storage-state propre à chaque page l'emporte sur --storage-state, et le
             rapport regroupe les constats « Constats par page ».
  journey    Rejoue les parcours utilisateur écrits par l'agent
             (.ultra11y/journeys/<name>.json : startUrl + étapes
             goto|click|fill|select|check|press|waitFor|expect sur des localisateurs
             role/label/text) dans le Playwright local. Chaque étape enregistre un
             instantané de l'état de la page (.ultra11y/pages/<journey>-<nn>-<slug>/)
             mesuré avec l'axe-core épinglé et les sondes en direct, plus ce que seul un
             parcours voit : --keyboard atteint chaque contrôle avec Tab (un contrôle
             jamais atteint relève du 2.1.1, une zone que Tab et Maj+Tab ne peuvent pas
             quitter du 2.1.2), le focus qui entre dans les dialogues et en ressort
             (2.4.3), les erreurs liées à aucun champ (3.3.1), le texte qui apparaît hors
             d'une région live (4.1.3). Une étape en échec arrête son parcours avec la
             raison ; l'annexe liste chaque étape faite / en échec / non jouée.
             Code de sortie 1 quand un parcours a échoué.
  sample     Assistant de l'échantillon de pages normatif. 'sample check' vérifie le
             bloc sample de .ultra11yrc.json au regard des types de pages exigés par le
             référentiel actif (RGAA : accueil, contact, mentions légales, déclaration
             d'accessibilité, plan du site, aide, authentification, pages
             représentatives + éléments transverses) — indicatif, jamais une barrière.
  snapshot   Conserve une PAGE rendue (.ultra11y/pages/<id>/ : DOM du documentElement +
             condensé des styles calculés + boîtes + arbre d'accessibilité) et l'audite.
             'snapshot write' lit la charge utile collectée sur stdin, de sorte qu'un
             producteur côté navigateur (les exports ultra11y/playwright et
             ultra11y/cypress) n'a rien à savoir du format sur disque — un processus par
             page vérifiée. 'snapshot list' montre ce qui a été capturé. Comme un
             instantané est un document COMPLET (une capture de composant est un
             fragment), les règles de niveau page s'y appliquent : c'est là que la langue
             html (RGAA 8.3) et le titre de page (8.5/8.6) deviennent décidables.
  hook       INTERNE — la moitié décisionnelle du hook PreToolUse du plugin Claude
             Code. Lit la charge utile sur stdin ; quand un 'git commit', 'git push' ou
             'gh pr create' en attente porte des constats >= au seuil, affiche le JSON
             de hook qui fait invoquer la skill review-a11y, et n'affiche rien sinon.
             Seuil : ULTRA11Y_HOOK_FAIL_ON, sinon hook.failOn dans .ultra11yrc.json,
             sinon blocking. Désactivable avec ULTRA11Y_HOOK=off ou SKIP_A11Y=1. Appelé
             par hooks/pre-tool-use.mjs, pas à la main.
  affected   Les pages qu'un changement peut atteindre : depuis chaque fichier modifié
             depuis --since (par défaut : la branche par défaut du dépôt, sémantique
             merge-base), remonte le graphe d'imports inverse jusqu'aux fichiers de route
             (app/ et pages/ de Next.js, les layouts sélectionnant toutes les pages
             en dessous) et aux sources que l'échantillon déclare, puis nomme leurs URL —
             routes dynamiques résolues avec l'inventaire des routes
             (.ultra11y/routes.json) et l'échantillon. 'scan --since' rend exactement ces
             pages.
  pages      La grille des critères par page — le RGAA est une norme par page, le
             verdict du moteur porte sur tout le périmètre, et cette commande fait le
             pont entre les deux. Une ligne par critère (ceux du RGAA), une colonne par
             URL de page. Reconstruite à partir du seul audit.json commité : pas
             d'instantanés sur disque, pas de navigateur.
             Deux règles d'honnêteté : un constat n'est attribué à une page que lorsque
             quelque chose le DIT (l'instantané sur lequel il a été levé, l'URL scannée,
             le nom de page de l'échantillon, ou les fichiers sources enregistrés de la
             page) — tout le reste est signalé NON ATTRIBUÉ, jamais réparti entre les
             pages ; et « aucun constat ici » ne vaut conformité que pour une page dont
             le vrai DOM rendu a été audité. Une page connue seulement par attribution de
             source garde ses critères non tranchés « à évaluer ».
  serve      Les résultats d'audit sous forme d'un petit site local : chaque audit
             trouvé dans --in (par défaut : audits ; tout JSON d'audit courant jusqu'à
             trois niveaux de profondeur, si bien que des copies datées comme
             audits/2026-09-01/audit-latest.json forment l'HISTORIQUE), chacun avec son
             tableau de bord et sa grille des 106 critères, le taux de conformité et le
             taux moyen par page (les chiffres du rapport lui-même), une fiche par page
             avec sa capture d'écran, les parcours, les instantanés de composants et ses
             fichiers ; et, entre deux audits successifs, l'évolution : chaque critère
             dont le statut a changé et l'écart de taux en points. Lecture seule,
             node:http uniquement, lié à 127.0.0.1 (--host pour l'ouvrir), sur --port
             (4711 par défaut ; le port libre suivant s'il est occupé). Il ne sert que
             des fichiers du dossier audits, de .ultra11y/pages et de
             .ultra11y/render-snapshots, ne liste jamais un dossier, et refuse tout chemin
             qui en sort, liens compris.
             --static <dir> écrit les mêmes pages en fichiers simples avec des liens
             relatifs, pour qu'elles se publient telles quelles sous un sous-chemin
             (GitHub Pages, iterion).

Options :
  --out <dir>        dossier de sortie (report/prd/scan, par défaut : audits) ; pour audit,
                     y conserver audit-latest.json — un audit simple n'écrit rien sans lui.
                     Pour audit, une valeur finissant par .json est un FICHIER cible (écrit
                     tel quel) ; le chemin réellement écrit est rappelé sur stderr
  --in <file>        report : le JSON AuditResult à rendre ('-' pour stdin)
                     · serve : le DOSSIER d'audits à lire (par défaut : audits)
  --port <n>         serve : le port d'écoute (4711 par défaut ; 0 = n'importe quel port libre)
  --host <addr>      serve : l'adresse d'écoute (127.0.0.1 par défaut ; toute autre expose les
                     résultats au réseau — à activer en connaissance de cause)
  --static <dir>     serve : écrire un export statique du site dans <dir> au lieu de le servir
  --include <glob>   audit/fix : n'inclure que les chemins correspondants (séparés par des virgules)
  --exclude <glob>   audit/fix : ignorer les chemins correspondants (séparés par des virgules)
  --ext <list>       audit/fix : extensions de fichiers supplémentaires à parcourir (ex. .twig,.erb) ;
                     .html/.htm/.xhtml/.jsx/.tsx/.vue/.svelte/.astro sont intégrées
  --no-default-excludes  audit/fix : auditer aussi le balisage test/spec/story/__tests__
                     (exclu par défaut ; journalisé, jamais écarté en silence)
  --jsx              audit/fix : forcer l'analyse JSX/TSX des entrées, quelle que soit l'extension
  --graph            audit : résoudre aussi les imports + lancer les règles inter-fichiers (alias --cross-file)
  --cross-file       audit : alias de --graph
  --changed          audit/fix : seulement les fichiers modifiés par rapport à HEAD (git ; staged+non staged+non suivis, arbre de travail)
  --since <ref>      audit/fix : seulement les fichiers modifiés par rapport à la ref git donnée
                     · scan/affected : les pages qu'atteignent les fichiers modifiés depuis <ref>
  --staged           audit/fix : seulement les fichiers STAGED, lus depuis le blob de l'index (instantané exact du commit ; l'emporte sur --changed)
  --max-files <n>    audit : plafonner les fichiers canoniques audités (troncature journalisée, jamais silencieuse)
  --dedup <mode>     audit : fusionner les fichiers identiques — exact|normalized|off  (par défaut : exact)
  --standard rgaa    RGAA 4.1.2, le référentiel par défaut et le seul (accepté pour les scripts
                     qui le passent explicitement ; --standard wcag a été retiré et sort en 2)
  --format <mode>    prd : 'audit' (défaut) émet le bloc de conformité d'auditeur (selon le
                     vocabulaire du référentiel actif) pour le backlog ET les issues GitHub ;
                     'doc' émet un document d'exigences produit (epics, user stories,
                     Given/When/Then)
                     · pages : 'grid' (défaut) émet la matrice critères × pages ;
                     'report' émet le DOSSIER par page — une section par page avec sa
                     capture d'écran, chaque critère du référentiel, et le bloc d'auditeur
                     de chaque non-conformité
  --split <mode>     prd : découper le backlog — pour l'instant seulement 'criterion' (un fichier par critère)
                     · pages --format report : 'page' écrit <out>/page-<id>.md par page
                     plus <out>/index.md (recommandé au-delà de 3–4 pages : le RGAA compte 106 critères)
  --no-technical     prd (format audit) : omettre les sections techniques du ticket (Partie
                     technique + Contexte de reproduction) pour un bloc d'auditeur pur
  --provider <id>    tickets : auto|github|gitlab|jira. 'auto' lit ULTRA11Y_TICKET_PROVIDER,
                     puis .ultra11yrc.json, puis le remote git (Jira n'est jamais détecté automatiquement)
  --grain <mode>     tickets : ce qu'est un ticket — criterion (défaut) | page | page-criterion | single | file
  --transport <t>    tickets : auto|cli|rest. 'auto' préfère la CLI (gh/glab),
                     et se rabat sur REST quand seul un jeton est disponible. Jira est en REST uniquement
  --max-tickets <n>  tickets : refuser de déposer plus de n tickets en un run (200 par défaut)
                     tickets --out <dir> écrit aussi l'ensemble indépendant du gestionnaire dans
                     <dir>/issues-<date>.json, pour qu'un moteur de workflow le dépose lui-même
  --detect           render : détecter le framework et afficher la recette build→audit (ne rend rien)
  --timeout <ms>     render : budget de rendu par unité (10000 par défaut) ; une unité qui le dépasse est enregistrée en timeout
  --transpiler <t>   render : esbuild|typescript|sucrase — le transpileur du projet avec lequel charger le TSX/JSX (par défaut : le premier résolu)
  --no-stories       render : laisser de côté les stories Storybook
  --no-snapshots     render : sauter la passe visuelle (capture d'écran + axe de chaque capture dans Chromium). Env : ULTRA11Y_RENDER_SNAPSHOTS=off
  --coverage         render : rendre compte de la couverture des captures rendues (composants couverts vs angles morts) ; avec --json émet l'objet de couverture
  --storybook        render : rattacher le HTML de chaque story (via le index.json de storybook-static) dans .ultra11y/captures (désigner le dossier HTML avec --captures)
  --captures <dir>   audit/render : dossier de captures rendues à intégrer (par défaut : .ultra11y/captures)
  --no-captures      audit : NE PAS détecter/intégrer automatiquement .ultra11y/captures ni .ultra11y/pages
  --root <dir>       snapshot, scan, serve, --theme dsfr : racine du projet contenant
                     .ultra11y/pages et .ultra11yrc.json (par défaut : . — scan y écrit les
                     instantanés qu'il collecte)
  --glossary [<t>]   criteria : chercher un terme que définit le référentiel national (ou tous les lister)
  --require-captures audit : barrière — échoue si un composant opaque/de contrôle n'a pas de capture rendue (implique --graph)
  --write            fix : écrire les corrections sur disque (par défaut, un diff en dry-run)
  --iterate          fix : avec --write, ré-auditer + réappliquer les corrections mécaniques jusqu'à stabilité (borné)
  --dry-run          fix : aperçu seulement — n'écrit jamais (c'est le défaut)
  --safe             fix : n'appliquer que les codemods vraiment automatiques (sans espaces réservés TODO ni propositions de jugement)
  --only <ids>       fix : limiter les corrections automatiques à ces identifiants de règle (séparés par des virgules)
  --baseline <file>  scan : un 'scan --json' antérieur des mêmes pages (par exemple sur le
                     déploiement de la branche de base) ; sortie en 1 seulement sur les constats qu'il ne contient pas
  --base-url <url>   scan --since / affected : le déploiement sur lequel les pages sont rendues ;
                     journey run : la base contre laquelle se résout un startUrl relatif
  --fail-on <sev>    audit/init/snapshot/scan --baseline : sévérité de la barrière — blocking|major|minor (alias français acceptés)  (par défaut : blocking)
  --hook             init : écrire une barrière git pre-commit d'accessibilité (instantané staged + correction automatique par défaut)
  --report <file>    check/verify : le rapport Markdown à contrôler
  --theme <N>        criteria : lister la thématique RGAA N
  --theme <nom>      report --html, pages --html, serve : l'apparence HTML — neutral (par défaut)
                     ou dsfr, lu dans le @gouvfr/dsfr DU PROJET (résolu depuis --root) ;
                     ultra11y ne le fournit ni ne le télécharge (ses conditions le réservent
                     aux sites en .gouv.fr). Paquet absent : code 2. Aussi « html.theme » dans .ultra11yrc.json
  --plan             criteria : le plan de travail — critères par palier de preuve (source,
                     inter-fichiers, page rendue, navigateur, jugement, hors périmètre)
  --list             criteria : afficher les thématiques RGAA
  --generate         criteria : émettre le references/criteria.md embarqué (la table de correspondance WCAG)
  --apply <file>     verify : réduire un fichier de verdicts rempli à une barrière succès/échec
                     (exige --report — la couverture est re-dérivée du rapport, sans plafond)
                     Accepte aussi un ARBITRAGE (--in <audit.json>), ou un REGISTRE DE
                     VERDICTS, qu'il REJOUE sur l'audit sans modèle dans la boucle
                     Les conformités retenues sont ancrées comme l'intégration les a ancrées :
                     une citation qui est l'une des ancres récoltées de son propre critère
                     (--in <audit.json>) se rabat sur cette ancre, de sorte qu'une ressaisie
                     acceptée par l'intégration n'est pas refusée à nouveau au procès ; sans
                     l'audit, l'extrait cité doit correspondre littéralement au source
  --ledger <file>    verify --apply : enregistrer les verdicts que l'intégration a ACCEPTÉS,
                     pour qu'un run ultérieur les rejoue gratuitement (par défaut :
                     .ultra11y/verdicts/<standard>.json). Le rejeu re-dérive les preuves
                     et relance la même barrière ; un verdict dont la preuve a changé est
                     écarté comme périmé et son critère le signale. Avec verify --prune,
                     les affirmations retirées sont aussi supprimées du registre
  --conformities <file>
                     verify : les CONFORMITÉS REVENDIQUÉES à mettre en procès — un audit, un
                     registre de verdicts ou un fichier d'arbitrage. Par défaut, l'audit
                     courant de --in, puis le registre du référentiel
                     (.ultra11y/verdicts/<standard>.json), pour que la moitié conformité de la
                     barrière tourne sans qu'on la demande : rien ne contestait le verdict C
                     d'un agent, et un critère validé parce que son objet était PRÉSENT plutôt
                     que JUSTE partait comme une déclaration de conformité. Chaque ancre citée
                     devient un élément demandant si la preuve ÉTABLIT le critère.
                     Une conformité réfutée renvoie son critère « à évaluer » — jamais en NC
  --no-conformities  verify : ne pas mettre en procès les conformités du registre
  --max-verify <n>   verify : plafonner la taille de la liste de travail ; 0 = sans plafond           (par défaut : 40, NC seulement)
                     Les conformités revendiquées sont sans plafond sauf si ce drapeau est
                     donné ; tout ce qu'un plafond écarte est nommé sur stderr et fait échouer
                     --apply comme manquant
  --verdicts <file>  check --semantic : l'artefact des verdicts arbitrés
  --require-sample   check : échoue tant qu'une page DÉCLARÉE dans .ultra11yrc.json n'a pas de
                     capture sous .ultra11y/pages/. Couverture, un cran en dessous de
                     --require-decided : un balayage qui perd des pages produit un rapport
                     simplement PLUS COURT, et un livrable plus court se lit exactement comme
                     un livrable complet.
  --require-rendered check : échoue tant qu'un critère qui DEMANDE une page rendue est encore
                     « à évaluer » et que ce run n'a pris aucun instantané de page. Porte sur
                     l'INSTRUMENT, pas sur la réponse : un run qui a rendu une page et n'a
                     toujours pas pu trancher un critère passe. Exige --in <audit.json> ;
                     respecte --allow-undecided.
  --require-decided[=pages]
                     check : échoue tant qu'UN critère du référentiel est encore « à évaluer ».
                     '=pages' tient aussi la grille propre à CHAQUE page au même niveau — un
                     critère en échec sur une route est tranché pour le run et peut encore être
                     non tranché sur les routes où il ne s'est jamais déclenché, et c'est sur
                     cela qu'un livrable par page est jugé.
                     Exige --in. Sinon, un job vert ne veut pas dire que la grille est remplie :
                     --fail-on régit les non-conformités, et un arbitrage qui n'aboutit à rien
                     ne fait qu'avertir.
  --allow-undecided <file>
                     check --require-decided : les critères que ce projet déclare ne pas pouvoir
                     trancher, sous la forme {"entries":[{"criteriaId","reason"}]}. Une liste
                     NOMMÉE, jamais une tolérance : un seuil cacherait justement les critères que
                     personne n'a pu trancher. Une entrée sans raison fait échouer la barrière,
                     et une entrée dont le critère porte désormais un verdict aussi.
                     (par défaut : VERIFY.todo.json à côté du rapport)
  --allow-stale-undecided
                     check --require-decided : ignorer les exemptions nommées dont les critères
                     ont obtenu un verdict lors de CE rafraîchissement. Prévu pour les
                     rafraîchissements d'arbitrage payants ; le défaut reste strict pour que les
                     exceptions périmées soient nettoyées du dépôt.
  --run <dir>        orchestrate : le dossier du run contenant les listes de travail (ADJUDICATE.todo.json,
                     VERIFY.todo.json) ; les artefacts arrivent sous <dir>/orchestration/
  --phase <name>     orchestrate : n'émettre qu'une phase — adjudicate | verify-report
                     (sortie en 2 avec la commande productrice si sa liste de travail manque)
  --eco              orchestrate : n'émettre que RUNBOOK.md + agents/*.md (ni lots, ni workflow) — la voie
                     séquentielle explicite économe en tokens (aussi celle que suit un harnais sans sous-agents)
  --merge <file>     scan : intégrer les constats dynamiques à ce JSON AuditResult. Avec --json, le
                     document affiché commence par un résumé 'pages' du run —
                     {sample, recorded, refused:[{id, reason}]} — à côté du document
  --sitemap <url>    scan : scanner chaque URL listée dans un sitemap.xml
  --crawl <url>      scan : parcourir en largeur les liens de même origine depuis une URL de départ (HTML servi)
  --depth <n>        scan : profondeur de sauts de liens du crawl depuis l'URL de départ   (par défaut : sans limite ; 0 = sans limite)
  --max <n>          scan : plafond de pages scannées (sitemap/crawl)      (par défaut : sans limite ; 0 = sans limite)
  --runtime <mode>   scan : local (l'environnement d'exécution par défaut et le seul : le Playwright
                     de l'hôte/de la cible ; 'auto' est accepté comme alias)
  --local            scan : alias de --runtime local
  --cwd <dir>        scan : résout @playwright/test + @axe-core/playwright (et le
                     navigateur) d'abord depuis ce dossier (ex. --cwd packages/app)
  --browser-path <file>  scan / render / status --browser : lancer CET exécutable de navigateur (ex. le
                     /usr/bin/chromium d'une distribution) au lieu de celui que résout Playwright.
                     Explicite : jamais remplacé par un repli. Env : ULTRA11Y_BROWSER_PATH
  --storage-state <file>  scan : JSON storageState de Playwright pour les
                     pages authentifiées (ex. test-results/.auth/user.json). Ses cookies
                     qui correspondent à l'URL d'un document lié (domaine, chemin, secure,
                     expiration) sont aussi envoyés lors de son téléchargement — vers l'origine
                     auditée uniquement
  --no-interact      scan : désactiver les sondes AVEC ÉTAT (saisie dans les champs,
                     ouverture des dialogues, région live). Actives par défaut ; les
                     interactions ne naviguent jamais (saisir dans les champs texte, basculer
                     case à cocher/bouton radio, cliquer button[type=button] — jamais un
                     lien/une soumission/une navigation, et jamais un bouton dont le nom
                     accessible correspond à un verbe destructeur : supprimer, retirer,
                     effacer, envoyer, valider, confirmer, payer, delete, remove, send,
                     submit, confirm, pay, …) et restaurent l'état de la page, en vérifiant
                     que location.href n'a pas changé après chaque action
  --interact-clicks  scan : autoriser les clics button[type=button] de la sonde de région live
                     sur un scan AUTHENTIFIÉ (--storage-state). Sautés par défaut dans ce cas :
                     un clic peut déclencher une mutation côté serveur (suppression/envoi)
                     invisible pour la vérification de location.href. Les scans non
                     authentifiés gardent les clics de toute façon ; l'exclusion des noms
                     destructeurs ci-dessus s'applique dans tous les cas
  --write            pages discover : fusionner les pages découvertes dans .ultra11yrc.json
                     (sample.pages). Sans lui, la proposition est affichée et rien n'est
                     écrit. Les pages déjà déclarées sont gardées telles quelles — auth,
                     storageState et notes sont du travail humain et ne sont jamais écrasés.
                     Enregistre aussi chaque route découverte dans l'inventaire
                     .ultra11y/routes.json
  --routes-only      pages discover : enregistrer l'inventaire des routes (.ultra11y/routes.json) et
                     laisser l'échantillon intact — l'échantillon RGAA reste celui que vous avez
                     choisi, et l'annexe du rapport liste chaque autre route avec la façon dont
                     elle a été observée
  --from-snapshots   pages discover : construire l'échantillon à partir de .ultra11y/pages au lieu de
                     crawler — la seule voie qui voit une page atteinte par un état (une modale,
                     une étape de tunnel)
  --propose          pages discover : proposer un échantillon DÉTERMINISTE plutôt que toutes les
                     pages — les types exigés par le référentiel (--standard, rgaa par défaut)
                     repérés par mot-clé sur les URL et titres triés, la page de recherche avec
                     une requête fixe, puis une page par groupe de gabarit (motif d'URL avec
                     identifiants, slugs et dates normalisés ; squelette DOM quand un instantané
                     existe), les plus gros d'abord, égalités départagées par URL. La raison de
                     chaque choix va dans \`notes\`, chaque type sans page dans \`sample.absent\`.
                     Avec --write, il REMPLACE les pages déclarées, en gardant celles qui portent
                     auth, storageState, sources ou notes
  --sample-size <n>  pages discover --propose : nombre maximal de pages proposées (par défaut : ${DEFAULT_SAMPLE_SIZE}) ;
                     les types exigés ne sont jamais coupés
  --search-query <q> pages discover --propose : la requête de recherche (par défaut : "information")
  --all-routes      scan : après l'échantillon (avec --sample), scanner chaque route de l'inventaire
                     (.ultra11y/routes.json) que l'échantillon ne contient pas — sauf les routes
                     que votre run E2E a déjà capturées, qui l'emportent. Chaque route est ensuite
                     listée en annexe : capturée, scannée, source seulement, ou non atteinte
  --max-routes <n>   scan --all-routes : nombre maximal de routes scannées au-delà de l'échantillon
                     (50 par défaut) ; les routes laissées de côté sont listées « non atteintes »,
                     jamais écartées
  --sample           scan : scanner l'échantillon de pages NORMATIF de .ultra11yrc.json (son
                     sample.pages), le storage-state de chaque page l'emportant sur
                     --storage-state, en agrégeant un résultat avec la provenance par page pour
                     le rapport
  --no-snapshot      scan : NE PAS conserver chaque page scannée dans .ultra11y/pages/<id>/.
                     Les instantanés sont actifs par défaut : le navigateur est déjà sur la page,
                     et sans instantané la page ne peut jamais être ré-auditée hors ligne ni
                     obtenir de verdict par page (ses critères restent « à évaluer » pour
                     toujours)
  --no-pdf           scan : NE PAS télécharger les documents PDF de même origine vers lesquels
                     pointent les pages scannées (dans .ultra11y/documents/<sha256>.pdf, avec un
                     fichier annexe nommant l'URL et les pages qui y renvoient). Un lien est
                     candidat quand son chemin finit par .pdf, qu'il déclare
                     type=application/pdf ou download, que son texte / aria-label / title nomme
                     PDF, ou que son chemin ou sa requête le fait (/api/x-pdf) ; il n'est gardé
                     que si la réponse est application/pdf ou commence par %PDF-.
                     Avec --storage-state, les cookies correspondants de la session sont envoyés.
                     audit : ne pas intégrer ce dossier. Les entrées PDF nommées explicitement
                     sont toujours auditées
  --max-pdf <n>      scan : nombre maximal de documents PDF téléchargés par run (20 par défaut ;
                     chacun plafonné à 20 Mio)
  --strict           verify --apply : intégration tout ou rien — un verdict refusé écarte tout
                     l'arbitrage. Par défaut, l'intégration se fait PAR VERDICT : un refus ne
                     coûte que son propre critère, qui reste à évaluer en portant le refus, et
                     chaque verdict qui a fait ses preuves est intégré ; tout refus sort
                     quand même en 1 (repli incomplet, audit partiel écrit)
  --semantic         verify : intégrer la vérification d'étayage en une seule passe
                     check : activer la barrière sémantique — exige un artefact de verdicts
                     arbitrés (échoue s'il est absent) et ré-ancre chaque verdict positif au
                     niveau du contenu contre le source cité
  --manual           verify : avec --in <audit.json>, émettre une liste de travail d'arbitrage sur
                     les critères résiduels de l'audit (jugement / rendu nécessaire) que l'agent
                     doit trancher
  --web / --no-web   verify --manual : si chaque brief peut INVITER à consulter la page
                     officielle du critère (l'URL elle-même est toujours affichée).
                     Par défaut : oui, sauf en CI — où l'arbitre dispose de
                     Read/Grep/Glob/Edit/Write et où proposer un outil web ne coûte que des tours.
                     Le texte normatif embarqué décide toujours, et aucune page web n'est jamais
                     un normativeRef acceptable
  --lang auto|en|fr  langue de sortie                (par défaut : auto — français ; --lang en
                     pour l'anglais. Sans drapeau : <html lang> du dépôt → locale par défaut du
                     référentiel (fr pour le RGAA) → fr. Un appelant IA doit passer --lang
                     explicitement pour suivre la langue de la conversation)
  --json             sortie lisible par une machine
  --quiet            check : code de sortie seulement, aucune sortie
  -h, --help         afficher cette aide (--help --lang en : en anglais)
  -v, --version      afficher la version

Données : WCAG 2.2 © W3C (W3C Document License). Pack RGAA 4.1.2 © DINUM, Licence Ouverte / Etalab 2.0 (voir NOTICE).`;

/** The help text in `lang`. */
export function helpText(lang: Lang): string {
  return lang === "en" ? HELP_EN : HELP_FR;
}
