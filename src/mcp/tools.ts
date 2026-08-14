import { ANNOTATIONS_SINCE, RICH_TOOLS_SINCE, type JsonSchema, type JsonSchemaProp, type ProtocolVersion } from "./protocol.js";

// What the server advertises. Pure data — nothing here imports the audit
// engine, so the declarations can be asserted in a test without parsing any
// markup. handlers.ts is where these names become work.

export interface ToolDecl {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  title?: string;
  outputSchema?: JsonSchema;
  annotations?: Record<string, boolean>;
}

const cwdProp: JsonSchemaProp = { type: "string", description: "Absolute path to the project root the paths are relative to." };
const globsProp: JsonSchemaProp = {
  type: "array",
  items: { type: "string" },
  description: "Files or globs to audit (e.g. ['src/**/*.tsx']). Relative to the project root.",
};
// Declared WITHOUT an enum. The set of standards is not a constant: `rgaa` ships built in,
// but a country pack loaded from `--pack` or a project's `.ultra11yrc.json` is just as real
// a standard. `toolsFor` pins the enum when — and only when — the server knows the set is
// closed (see `applyStandards`).
const standardProp: JsonSchemaProp = {
  type: "string",
  description: "Which standard to report against. Default: wcag (WCAG 2.2 AA).",
};
const langProp: JsonSchemaProp = { type: "string", enum: ["en", "fr"], description: "Language for the rendered prose. Default: en." };
// A BOOLEAN, not a `format` value. On `report`, `format` names a CI channel (SARIF,
// annotations); on `pages` it names which document. Widening either enum would make
// `prd --format html` parse in silence.
const htmlProp: JsonSchemaProp = {
  type: "boolean",
  description:
    "Also return the report as a self-contained HTML page (no script, no external asset). Images are not embedded — this returns a string, not files.",
};

// The sentence that keeps this server honest. The engine decides 3 of the 55
// WCAG 2.2 AA criteria on its own; `scan` decides 14 from a real browser; the
// remaining 38 are judgment calls that only the model can make. A client that
// misses this reads a clean static audit as a clean audit.
const COVERAGE_NOTE =
  "Static analysis alone decides only a few of the 55 WCAG 2.2 AA criteria — most need YOUR judgment (is this alt text actually relevant? " +
  "is this link's purpose clear in context?) and some need a real browser (ultra11y_scan). A silent criterion is untested, never conformant.";

export const TOOLS: ToolDecl[] = [
  {
    name: "ultra11y_audit",
    title: "Audit markup against WCAG 2.2 AA",
    description:
      "Run the static engine over HTML/CSS/JSX and return the findings keyed by WCAG success criterion. Fast and offline — no browser, no network, no keys. " +
      "This is the entry point. " +
      COVERAGE_NOTE,
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        globs: globsProp,
        changed: { type: "boolean", description: "Audit only the files git reports as changed." },
        since: { type: "string", description: "Audit only what changed since this git ref." },
        staged: { type: "boolean", description: "Audit exactly the staged index snapshot." },
        include: { type: "array", items: { type: "string" }, description: "Extra globs to include." },
        exclude: { type: "array", items: { type: "string" }, description: "Globs to skip." },
        jsx: { type: "boolean", description: "Force JSX parsing for files the extension does not imply." },
        graph: { type: "boolean", description: "Also run cross-file rules over the dependency graph — catches a label defined in another file." },
        max_files: { type: "number", description: "Hard cap on files audited (truncation is reported, never silent)." },
      },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_report",
    title: "Render a dated conformance report",
    description:
      "Turn an audit into the auditor-facing conformance report: one section per success criterion, with the evidence and the verdict. Says explicitly " +
      "which criteria were not tested, because a report silent about its own coverage reads as a clean bill of health.",
    inputSchema: {
      type: "object",
      properties: { cwd: cwdProp, globs: globsProp, standard: standardProp, lang: langProp, html: htmlProp },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_prd",
    title: "Turn findings into a remediation backlog",
    description:
      "Convert an audit into actionable work: one unit per non-conformity, with the criterion it violates, the fix, and an effort estimate. Use it to hand " +
      "accessibility debt to a team rather than a wall of violations.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        globs: globsProp,
        standard: standardProp,
        lang: langProp,
        split: { type: "string", enum: ["criterion"], description: "Emit one unit per criterion instead of one document." },
      },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_tickets",
    title: "Preview the tracker tickets an audit would file",
    description:
      "Show the GitHub/GitLab/Jira tickets this audit would open, at a granularity you choose: one per criterion (default), per page, per page+criterion, per " +
      "file, or one consolidated. Returns the plan ONLY — it never creates anything; filing stays a deliberate `ultra11y tickets` run.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        globs: globsProp,
        standard: standardProp,
        lang: langProp,
        grain: {
          type: "string",
          enum: ["criterion", "page", "page-criterion", "single", "file"],
          description: "What ONE ticket is. Default 'criterion'.",
        },
      },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_criteria",
    title: "The offline standards reference",
    description:
      "Look up what a criterion actually requires — its exact wording, its numbered tests, the terms the standard defines for it, and what it takes to " +
      "decide it. Works for WCAG success criteria AND for any country standard's own criteria (RGAA 8.3, and whatever packs this project loads). " +
      "Offline and authoritative; use it instead of recalling a criterion from memory, which is how invented non-conformities get written.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: {
          type: "string",
          description: "Absolute path to the project root. Optional — it decides which standards packs are loaded, not which files are read.",
        },
        sc: { type: "string", description: "A criterion id: a WCAG success criterion ('1.1.1') or a pack criterion ('8.3'). Omit to list them all." },
        criterion: { type: "string", description: "Alias for `sc`, for a standard whose criteria are not WCAG success criteria." },
        theme: { type: "number", description: "List one theme of a country standard (e.g. 8). Not applicable to WCAG, which groups by guideline." },
        glossary: {
          type: "string",
          description: "Look up a term the standard normatively DEFINES. Pass a term, or an empty string to list every term.",
        },
        include_guidance: {
          type: "boolean",
          description: "Also attach before/after implementation examples for the criterion. Default false — they are large.",
        },
        standard: standardProp,
        lang: langProp,
      },
      required: [],
    },
  },
  {
    name: "ultra11y_check",
    title: "The anti-hallucination gate",
    description:
      "Validate a report you wrote: every criterion it cites must exist, every non-conformity must trace to a real finding, and nothing may be asserted " +
      "conformant that was never tested. A result with ok:false is a real verdict, not a tool failure — it means the report claims more than the evidence carries.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        report_text: { type: "string", description: "The report markdown to validate. Preferred over report_file." },
        report_file: { type: "string", description: "Absolute path to a report file to validate instead." },
        standard: standardProp,
        lang: langProp,
      },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_verify",
    title: "Build a claim-evidence worklist",
    description:
      "Emit a claim-by-evidence worklist from a report, for you to adjudicate each pair. This is where the 38 judgment criteria get decided: read the real " +
      "markup and rule on whether the alt text is relevant, the link purpose is clear, the reading order makes sense.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        report_text: { type: "string", description: "The report markdown to build the worklist from." },
        report_file: { type: "string", description: "Absolute path to a report file to use instead." },
        standard: standardProp,
        max_verify: { type: "number", description: "Cap on the number of claim/evidence pairs emitted." },
        lang: langProp,
      },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_adjudicate",
    title: "Worklist for the judgment criteria",
    description:
      "Emit the criteria the engine CANNOT decide, with the evidence needed to decide them: alt-text relevance, link purpose in context, heading structure, " +
      "reading order, label-in-name. Most of WCAG lives here — this is the tool that makes an audit real rather than a lint run.",
    inputSchema: {
      type: "object",
      properties: { cwd: cwdProp, globs: globsProp, standard: standardProp, lang: langProp },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_pack_check",
    title: "Validate a country standards pack",
    description:
      "Check that a country standards pack (RGAA and friends) matches what the published standard actually ships, so a localized audit cannot be graded " +
      "against invented criteria. Reads the pack; changes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        pack: { type: "string", description: "Absolute path to the pack JSON." },
        guidance: { type: "string", description: "Absolute path to its guidance file." },
      },
      required: ["cwd", "pack"],
    },
  },
  {
    name: "ultra11y_sample_check",
    title: "Lint the normative page sample",
    description:
      "Validate a project's `.ultra11yrc.json` page sample against the methodology: a conformance claim covering only the pages that happened to be easy " +
      "is not a conformance claim. Reads the config; changes nothing.",
    inputSchema: { type: "object", properties: { cwd: cwdProp }, required: ["cwd"] },
  },
  {
    name: "ultra11y_pages",
    title: "The per-page view of the audit",
    description:
      "RGAA — like every country standard — is a PER-PAGE norm, but the engine's verdict is scope-wide. This projects the audit onto the pages it covers: " +
      "the criterion × page grid, or the per-page report (one dossier per page, every criterion of the standard with its status on THAT page). " +
      "Two rules make it trustworthy: a finding belongs to a page only when something says so — never spread across pages — and a criterion is conforming " +
      "by silence only on a page whose real rendered DOM was audited, and only for the criteria the engine can actually decide. Everything else stays " +
      "« to assess », which is what it is. Pages come from snapshots (.ultra11y/pages) or a scanned sample; with neither, there is nothing to project.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        globs: globsProp,
        standard: standardProp,
        lang: langProp,
        format: {
          type: "string",
          enum: ["grid", "report"],
          description: "`grid` (default) is the criterion × page matrix; `report` is the per-page dossiers.",
        },
        html: htmlProp,
      },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_read",
    title: "Read a file from the project",
    description:
      "Read a file, or a line range of one, from the audited project. Use it to see the real markup behind a finding before judging it. Reads are confined " +
      "to the project root; anything else is your own file tool's job.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        path: { type: "string", description: "Path relative to the project root, or an absolute path inside it." },
        start_line: { type: "number", description: "First line to return, 1-based (default 1)." },
        end_line: { type: "number", description: "Last line to return, inclusive (default: end of file, capped)." },
      },
      required: ["cwd", "path"],
    },
    outputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "number" },
        end_line: { type: "number" },
        total_lines: { type: "number" },
        truncated: { type: "boolean" },
        content: { type: "string" },
      },
      required: ["path", "start_line", "end_line", "total_lines", "truncated", "content"],
    },
  },
];

// Registered only when the server is started with --allow-write. All three
// change the USER'S project, and `scan` additionally drives a real browser.
export const WRITE_TOOLS: ToolDecl[] = [
  {
    name: "ultra11y_fix",
    title: "Apply safe accessibility codemods",
    description:
      "WRITES TO THE PROJECT: apply the mechanical fixes — the ones with exactly one correct answer, like a missing lang attribute or a button with no " +
      "accessible name. Dry-run by default; with write:true it re-audits afterwards and refuses to keep a change that introduced a new non-conformity. " +
      "It never invents alt text: that is a judgment call and it leaves a TODO for you.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        globs: globsProp,
        write: { type: "boolean", description: "Actually apply the changes (default: dry-run, returns the diff)." },
        only: { type: "array", items: { type: "string" }, description: "Apply only these rule ids." },
        changed: { type: "boolean", description: "Fix only the files git reports as changed." },
      },
      required: ["cwd"],
    },
  },
  {
    name: "ultra11y_scan",
    title: "Audit the rendered page in a real browser",
    description:
      "SLOW: launches a headless browser (optionally via Docker) and runs axe-core against the RENDERED DOM, then merges the result into the static audit. " +
      "This is the only way to decide the 14 rendering criteria — contrast, focus visibility, zoom, reflow, hover, target size — which no static analysis " +
      "can reach. Expect tens of seconds per page, more on a first run that pulls an image.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        target: { type: "string", description: "A URL or a local HTML file to render." },
        runtime: { type: "string", enum: ["auto", "local", "docker"], description: "Where to get the browser. Default: auto." },
        merge: { type: "boolean", description: "Merge the rendered findings into the existing static audit." },
      },
      required: ["cwd", "target"],
    },
  },
  {
    name: "ultra11y_init",
    title: "Install the accessibility gate",
    description:
      "WRITES TO THE PROJECT: install a git pre-commit hook, a CI job, and/or a baseline so accessibility regressions fail the build instead of accumulating. " +
      "Modifies files in the repository — review the result before committing it.",
    inputSchema: {
      type: "object",
      properties: {
        cwd: cwdProp,
        hook: { type: "boolean", description: "Install the git pre-commit hook." },
        ci: { type: "boolean", description: "Install the CI workflow." },
        baseline: { type: "boolean", description: "Record the current findings as the accepted baseline." },
        fail_on: { type: "string", enum: ["error", "warning", "notice"], description: "Severity that fails the gate." },
      },
      required: ["cwd"],
    },
  },
];

// The reference-tool block. These answer from the vendored standard, not the project tree,
// so `cwd` is optional on all four — it decides which standards packs are loaded, nothing
// more. Declared after WRITE_TOOLS so the read/write split above stays readable.
const referenceCwdProp: JsonSchemaProp = {
  type: "string",
  description: "Absolute path to the project root. Optional — it decides which standards packs are loaded, not which files are read.",
};

export const REFERENCE_TOOLS: ToolDecl[] = [
  {
    name: "ultra11y_standards",
    title: "The standards this project can be audited against",
    description:
      "List every standard available here: the WCAG 2.2 AA core, the country packs built into this build, and any pack the project's .ultra11yrc.json or " +
      "--pack loaded. Each carries its own coverage arithmetic — how many criteria it has, and how many of them any engine could ever decide. Standards " +
      "are per-project: a pack another project declares is not yours. Call this before assuming a standard exists.",
    inputSchema: {
      type: "object",
      properties: { cwd: referenceCwdProp, lang: langProp },
      required: [],
    },
  },
  {
    name: "ultra11y_glossary",
    title: "The terms a standard normatively defines",
    description:
      "A standard's tests lean constantly on terms it defines itself — 'informative image', 'relevant', 'if necessary'. Those definitions are normative: " +
      "they decide the verdict, and the everyday meaning of the word is not what is being asked. Look one up rather than assuming, and see which criteria " +
      "it governs.",
    inputSchema: {
      type: "object",
      properties: {
        standard: standardProp,
        term: { type: "string", description: "A term or its anchor. Omit to list every term the standard defines." },
        cwd: referenceCwdProp,
        lang: langProp,
      },
      required: ["standard"],
    },
  },
  {
    name: "ultra11y_guidance",
    title: "Before/after implementation guidance for a criterion",
    description:
      "The concrete how-to-implement rule for a criterion: a non-compliant snippet, the compliant fix, and the note explaining the difference. A country " +
      "criterion with no guidance of its own inherits what is keyed to the WCAG success criteria it maps to, marked as inherited. Guidance ILLUSTRATES — " +
      "it never decides a verdict and never turns into a non-conformity.",
    inputSchema: {
      type: "object",
      properties: {
        standard: standardProp,
        criterion: { type: "string", description: "The criterion id to fetch guidance for (a WCAG SC, or a pack criterion like '1.2')." },
        sc: { type: "string", description: "Alias for `criterion`." },
        cwd: referenceCwdProp,
        lang: langProp,
      },
      required: [],
    },
  },
  {
    name: "ultra11y_method",
    title: "The audit work plan for a standard",
    description:
      "Get the plan before auditing anything: which of this standard's criteria the static engine decides from source alone, which need a captured page or " +
      "a real browser, and which are judgment calls only you can make — each with the evidence to gather and the tool that produces it. Derived from this " +
      "engine's own per-criterion rule applicability and WCAG automatability data, not from guessing at the wording of a test. A criterion nobody tested is " +
      "untested, never conformant.",
    inputSchema: {
      type: "object",
      properties: {
        standard: standardProp,
        cwd: referenceCwdProp,
        lang: langProp,
        tier: {
          type: "string",
          enum: ["source", "cross-file", "rendered-page", "browser", "judgment", "out-of-scope"],
          description: "Return only the criteria in this evidence tier.",
        },
        detail: {
          type: "string",
          enum: ["summary", "full"],
          description: "'summary' (default) is counts plus criterion ids; 'full' adds each criterion's title, rules and reason.",
        },
      },
      required: [],
    },
  },
];

// Behavioural hints clients use to decide what needs a confirmation prompt.
//
// The read-only line is drawn at the USER'S project. Every tool in TOOLS reads
// markup and returns a result; `fix`, `scan` and `init` change files there.
export const TOOL_META: Record<string, { write?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }> = {
  ultra11y_audit: { openWorld: false },
  ultra11y_report: { openWorld: false },
  ultra11y_prd: { openWorld: false },
  // READ-ONLY and closed-world by construction: it returns the ticket PLAN and never files
  // anything, so it neither touches the project nor reaches a tracker. Filing stays a
  // deliberate `ultra11y tickets` run — an agent must not be able to open issues in
  // somebody's tracker off the back of a prompt injection.
  ultra11y_tickets: { openWorld: false },
  ultra11y_criteria: { openWorld: false },
  // The reference block: they read the vendored standard and nothing else.
  ultra11y_standards: { openWorld: false },
  ultra11y_glossary: { openWorld: false },
  ultra11y_guidance: { openWorld: false },
  ultra11y_method: { openWorld: false },
  ultra11y_check: { openWorld: false },
  ultra11y_verify: { openWorld: false },
  ultra11y_adjudicate: { openWorld: false },
  ultra11y_pack_check: { openWorld: false },
  ultra11y_sample_check: { openWorld: false },
  ultra11y_pages: { openWorld: false },
  ultra11y_read: { openWorld: false },
  // Rewrites source files. Not destructive in the delete sense, and it verifies
  // its own work — but it is the user's code.
  ultra11y_fix: { write: true, destructive: false, idempotent: true, openWorld: false },
  // Fetches a URL and may pull a Docker image.
  ultra11y_scan: { write: true, destructive: false, idempotent: false, openWorld: true },
  ultra11y_init: { write: true, destructive: false, idempotent: true, openWorld: false },
};

export function annotationsFor(name: string): Record<string, boolean> | undefined {
  const meta = TOOL_META[name];
  if (!meta) return undefined;
  return {
    readOnlyHint: !meta.write,
    ...(meta.write ? { destructiveHint: meta.destructive === true, idempotentHint: meta.idempotent === true } : {}),
    openWorldHint: meta.openWorld === true,
  };
}

export interface ToolsForOptions {
  defaultCwd?: string;
  allowWrite?: boolean;
  /** The standards registered at startup, named in the `standard` description. */
  standards?: string[];
}

// The tool list as one client should see it: gated on what the server was
// started with, and on how new the negotiated protocol is.
export function toolsFor(protocolVersion: ProtocolVersion, opts: ToolsForOptions = {}): ToolDecl[] {
  const base = opts.allowWrite ? [...TOOLS, ...REFERENCE_TOOLS, ...WRITE_TOOLS] : [...TOOLS, ...REFERENCE_TOOLS];
  const withAnnotations = protocolVersion >= ANNOTATIONS_SINCE;
  const withRich = protocolVersion >= RICH_TOOLS_SINCE;

  return base.map((t) => {
    const decl: ToolDecl = {
      name: t.name,
      description: t.description,
      inputSchema: applyStandards(applyDefaultCwd(t.inputSchema, opts.defaultCwd), opts.standards),
    };
    if (withRich && t.title) decl.title = t.title;
    if (withRich && t.outputSchema) decl.outputSchema = t.outputSchema;
    if (withAnnotations) {
      const a = annotationsFor(t.name);
      if (a) decl.annotations = a;
    }
    return decl;
  });
}

// Name the standards this server has loaded SO FAR, in the description — never as an enum.
//
// An enum here would have to be closed at `tools/list` time, and this set is not: a country
// pack arrives with a project, and a tool call names its project by `cwd`. Pinning the enum
// at startup would make the schema reject a pack that is perfectly valid for the project
// being asked about — a wrong refusal, which is worse than no autocomplete. The server also
// declares `tools: { listChanged: false }` and has no server→client notification path, so an
// enum it outgrew could not be retracted.
//
// `standardOf` refuses an unknown key at the handler instead, naming the ones in scope.
function applyStandards(schema: JsonSchema, standards?: string[]): JsonSchema {
  const existing = schema.properties.standard;
  if (!existing?.description || !standards?.length) return schema;
  const standard: JsonSchemaProp = {
    ...existing,
    description: `${existing.description} Loaded here: ${standards.join(", ")}. A project's own packs load with it — call ultra11y_standards to list them.`,
  };
  return { ...schema, properties: { ...schema.properties, standard } };
}

// With a server-level default project root, `cwd` stops being required and its
// description names the default — so a client can call every tool with no cwd
// argument at all.
function applyDefaultCwd(schema: JsonSchema, defaultCwd?: string): JsonSchema {
  const existing = schema.properties.cwd;
  if (!defaultCwd || !existing) return schema;
  return {
    type: "object",
    properties: {
      ...schema.properties,
      cwd: { ...existing, description: `${existing.description} Optional — defaults to ${defaultCwd}.` },
    },
    required: schema.required.filter((r) => r !== "cwd"),
  };
}
