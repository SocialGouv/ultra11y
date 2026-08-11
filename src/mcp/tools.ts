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
const standardProp: JsonSchemaProp = {
  type: "string",
  enum: ["wcag", "rgaa"],
  description: "Which standard to report against. Default: wcag (WCAG 2.2 AA).",
};
const langProp: JsonSchemaProp = { type: "string", enum: ["en", "fr"], description: "Language for the rendered prose. Default: en." };

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
      properties: { cwd: cwdProp, globs: globsProp, standard: standardProp, lang: langProp },
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
    name: "ultra11y_criteria",
    title: "The offline standards reference",
    description:
      "Look up what a success criterion actually requires — its exact wording, how it is tested, and what counts as a failure. Offline and authoritative; " +
      "use it instead of recalling a criterion from memory, which is how invented non-conformities get written.",
    inputSchema: {
      type: "object",
      properties: {
        sc: { type: "string", description: "A success criterion number (e.g. '1.1.1'). Omit to list them all." },
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

// Behavioural hints clients use to decide what needs a confirmation prompt.
//
// The read-only line is drawn at the USER'S project. Every tool in TOOLS reads
// markup and returns a result; `fix`, `scan` and `init` change files there.
export const TOOL_META: Record<string, { write?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }> = {
  ultra11y_audit: { openWorld: false },
  ultra11y_report: { openWorld: false },
  ultra11y_prd: { openWorld: false },
  ultra11y_criteria: { openWorld: false },
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
}

// The tool list as one client should see it: gated on what the server was
// started with, and on how new the negotiated protocol is.
export function toolsFor(protocolVersion: ProtocolVersion, opts: ToolsForOptions = {}): ToolDecl[] {
  const base = opts.allowWrite ? [...TOOLS, ...WRITE_TOOLS] : TOOLS;
  const withAnnotations = protocolVersion >= ANNOTATIONS_SINCE;
  const withRich = protocolVersion >= RICH_TOOLS_SINCE;

  return base.map((t) => {
    const decl: ToolDecl = {
      name: t.name,
      description: t.description,
      inputSchema: applyDefaultCwd(t.inputSchema, opts.defaultCwd),
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
