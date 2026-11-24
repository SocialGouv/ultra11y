// JOURNEYS — the user paths the agent writes and ultra11y replays in a browser (#189).
//
// `scan` opens pages and performs only safe, automatic interactions. It never logs in, never
// submits a form, never walks a funnel: the states an application only reaches through a
// sequence of actions stay out of every audit. A journey is that sequence, written down by the
// agent that read the application (`.ultra11y/journeys/<name>.json`), and replayed by
// `ultra11y journey run` with the local Playwright, the pinned axe-core and the live probes —
// one page-state snapshot per step.
//
// This module is the browser-free half: the file format and its strict validator, where the
// files live, the run manifest (`.ultra11y/journey-runs.json`) and the coverage scope the
// report's annex reads. The replay itself is src/journey-run.ts.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JourneyRecord, JourneyScope, JourneyStepRecord } from "./types.js";

export const JOURNEYS_DIR = ".ultra11y/journeys";
export const JOURNEY_RUNS_FILE = ".ultra11y/journey-runs.json";

export const JOURNEY_ACTIONS = ["goto", "click", "fill", "select", "check", "press", "waitFor", "expect"] as const;
export type JourneyAction = (typeof JOURNEY_ACTIONS)[number];

/** What a step acts on. Accessible locators first — the ones a user perceives — and `css` as
 *  the escape hatch for an element that exposes no role, label or text (which is itself
 *  usually the finding). Exactly one kind per target. */
export type JourneyTarget =
  | { role: string; name?: string; exact?: boolean }
  | { label: string; exact?: boolean }
  | { text: string; exact?: boolean }
  | { css: string };

export interface JourneyStep {
  action: JourneyAction;
  target?: JourneyTarget;
  /** `fill` / `select`: the value typed or chosen. */
  value?: string;
  /** `goto`: the address, absolute or relative to the current page. */
  url?: string;
  /** `press`: a Playwright key name — `Tab`, `Enter`, `Escape`, `ArrowDown`, `Shift+Tab`. */
  key?: string;
  /** `waitFor` / `expect`: the state awaited (default `visible`). */
  state?: "visible" | "hidden" | "attached" | "detached";
  /** How long the step may wait for its target, in ms (default 5000, at most 60000). */
  timeoutMs?: number;
  /** Why the step is there — shown in the annex beside it. */
  note?: string;
}

export interface Journey {
  name: string;
  /** The first page: an absolute http(s) URL, or a path resolved against `--base-url`. */
  startUrl: string;
  /** A Playwright storageState file (a session), relative to the root. Never read here. */
  storageState?: string;
  /** Replay every click, check and fill with the keyboard alone. `--keyboard` forces it. */
  keyboardOnly?: boolean;
  description?: string;
  steps: JourneyStep[];
}

export interface JourneyIssue {
  path: string;
  message: string;
}

export interface JourneyValidation {
  ok: boolean;
  issues: JourneyIssue[];
  journey?: Journey;
}

// A journey name becomes a snapshot id prefix, hence a directory name.
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const MAX_STEPS = 200;
const MAX_TIMEOUT = 60_000;
const TOP_KEYS = new Set(["$schema", "name", "description", "startUrl", "storageState", "keyboardOnly", "steps"]);
const STEP_KEYS = new Set(["action", "target", "value", "url", "key", "state", "timeoutMs", "note"]);
const STATES = new Set(["visible", "hidden", "attached", "detached"]);
const NEEDS_TARGET = new Set<JourneyAction>(["click", "fill", "select", "check", "waitFor", "expect"]);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

function validateTarget(raw: unknown, path: string, err: (p: string, m: string) => void): JourneyTarget | undefined {
  if (!isObj(raw)) {
    err(path, 'target must be an object: { "role", "name"? } | { "label" } | { "text" } | { "css" }');
    return undefined;
  }
  const kinds = ["role", "label", "text", "css"].filter((k) => raw[k] !== undefined);
  if (kinds.length !== 1) {
    err(path, `target must name exactly one of role, label, text or css (got ${kinds.length ? kinds.join(" + ") : "none"})`);
    return undefined;
  }
  const kind = kinds[0]!;
  const allowed = kind === "role" ? ["role", "name", "exact"] : kind === "css" ? ["css"] : [kind, "exact"];
  for (const k of Object.keys(raw)) if (!allowed.includes(k)) err(`${path}.${k}`, `unknown key "${k}" for a ${kind} target (allowed: ${allowed.join(", ")})`);
  if (!nonEmpty(raw[kind])) err(`${path}.${kind}`, `${kind} must be a non-empty string`);
  if (raw.name !== undefined && !nonEmpty(raw.name)) err(`${path}.name`, "name must be a non-empty string");
  if (raw.exact !== undefined && typeof raw.exact !== "boolean") err(`${path}.exact`, "exact must be a boolean");
  return raw as JourneyTarget;
}

/** Validate a journey file's content. Strict: an unknown key is an error, because a typo in a
 *  hand- or agent-written file (`targt`, `vaule`) would otherwise replay a different journey
 *  than the one written, silently. Every issue is reported, with its path. */
export function validateJourney(raw: unknown): JourneyValidation {
  const issues: JourneyIssue[] = [];
  const err = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  if (!isObj(raw)) {
    err("", "a journey must be a JSON object { name, startUrl, steps: [...] }");
    return { ok: false, issues };
  }
  for (const k of Object.keys(raw)) if (!TOP_KEYS.has(k)) err(k, `unknown key "${k}" (allowed: ${[...TOP_KEYS].join(", ")})`);
  if (!nonEmpty(raw.name)) err("name", "name must be a non-empty string");
  else if (!NAME_RE.test(raw.name)) err("name", `name "${raw.name}" must match ${NAME_RE} (it prefixes the snapshot ids of its steps)`);
  if (!nonEmpty(raw.startUrl)) err("startUrl", "startUrl must be a non-empty string (an http(s) URL, or a path resolved against --base-url)");
  if (raw.storageState !== undefined && !nonEmpty(raw.storageState)) err("storageState", "storageState must be a non-empty path");
  if (raw.keyboardOnly !== undefined && typeof raw.keyboardOnly !== "boolean") err("keyboardOnly", "keyboardOnly must be a boolean");
  if (raw.description !== undefined && typeof raw.description !== "string") err("description", "description must be a string");
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) err("steps", "steps must be a non-empty array");
  else if (raw.steps.length > MAX_STEPS) err("steps", `a journey holds at most ${MAX_STEPS} steps (got ${raw.steps.length}); split it`);
  else
    raw.steps.forEach((s: unknown, i: number) => {
      const at = `steps[${i}]`;
      if (!isObj(s)) {
        err(at, "a step must be an object { action, target?, value?, url?, key?, … }");
        return;
      }
      for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) err(`${at}.${k}`, `unknown key "${k}" (allowed: ${[...STEP_KEYS].join(", ")})`);
      const action = s.action as JourneyAction;
      if (!(JOURNEY_ACTIONS as readonly string[]).includes(String(s.action))) {
        err(`${at}.action`, `action must be one of ${JOURNEY_ACTIONS.join(", ")} (got ${JSON.stringify(s.action)})`);
        return;
      }
      if (NEEDS_TARGET.has(action)) {
        if (s.target === undefined) err(`${at}.target`, `a ${action} step needs a target`);
        else validateTarget(s.target, `${at}.target`, err);
      } else if (s.target !== undefined) {
        if (action === "goto") err(`${at}.target`, "a goto step takes a url, not a target");
        else validateTarget(s.target, `${at}.target`, err);
      }
      if (action === "goto" && !nonEmpty(s.url)) err(`${at}.url`, "a goto step needs a url");
      if (action !== "goto" && s.url !== undefined) err(`${at}.url`, `url belongs to a goto step, not a ${action} step`);
      if ((action === "fill" || action === "select") && typeof s.value !== "string") err(`${at}.value`, `a ${action} step needs a string value`);
      if (action !== "fill" && action !== "select" && s.value !== undefined) err(`${at}.value`, `value belongs to a fill or select step, not a ${action} step`);
      if (action === "press" && !nonEmpty(s.key)) err(`${at}.key`, 'a press step needs a key (e.g. "Escape", "Enter", "ArrowDown")');
      if (action !== "press" && s.key !== undefined) err(`${at}.key`, `key belongs to a press step, not a ${action} step`);
      if (s.state !== undefined) {
        if (action !== "waitFor" && action !== "expect") err(`${at}.state`, `state belongs to a waitFor or expect step, not a ${action} step`);
        else if (!STATES.has(String(s.state))) err(`${at}.state`, `state must be one of ${[...STATES].join(", ")}`);
      }
      if (s.timeoutMs !== undefined && (!Number.isInteger(s.timeoutMs) || (s.timeoutMs as number) <= 0 || (s.timeoutMs as number) > MAX_TIMEOUT))
        err(`${at}.timeoutMs`, `timeoutMs must be an integer between 1 and ${MAX_TIMEOUT}`);
      if (s.note !== undefined && typeof s.note !== "string") err(`${at}.note`, "note must be a string");
    });
  if (issues.length) return { ok: false, issues };
  const { $schema: _schema, ...journey } = raw as unknown as Journey & { $schema?: string };
  return { ok: true, issues, journey };
}

/** A step's target, in words: `button "Envoyer"`, `label "Courriel"`, `css #menu`. */
export function targetLabel(t: JourneyTarget | undefined): string {
  if (!t) return "";
  if ("role" in t) return t.name ? `${t.role} "${t.name}"` : t.role;
  if ("label" in t) return `label "${t.label}"`;
  if ("text" in t) return `text "${t.text}"`;
  return `css ${t.css}`;
}

/** What a step does, in words — the annex row and the snapshot's name. */
export function stepLabel(s: JourneyStep): string {
  if (s.action === "goto") return `goto ${s.url}`;
  if (s.action === "press") return `press ${s.key}${s.target ? ` on ${targetLabel(s.target)}` : ""}`;
  const value = s.action === "fill" || s.action === "select" ? ` = "${s.value}"` : "";
  const state = s.state && s.state !== "visible" ? ` (${s.state})` : "";
  return `${s.action} ${targetLabel(s.target)}${value}${state}`;
}

/** The snapshot id of a step's page state: `<journey>-<nn>-<slug>`. */
export function stepPageId(journey: string, n: number, s: JourneyStep): string {
  // A navigation is named after where it goes, never after the host and port it ran on.
  let words = stepLabel(s);
  if (n === 0) words = "start";
  else if (s.action === "goto") {
    try {
      const u = new URL(s.url ?? "", "http://x.invalid");
      words = `goto ${u.pathname}${u.hash}`;
    } catch {
      /* keep the label */
    }
  }
  const slug = words
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${journey}-${String(n).padStart(2, "0")}${slug ? `-${slug}` : ""}`;
}

export interface JourneyFile {
  /** Relative to the root, posix. */
  file: string;
  /** The file name without `.json`. */
  base: string;
  validation: JourneyValidation;
}

/** Every `.json` under `<root>/.ultra11y/journeys`, validated, sorted by file name. */
export function listJourneyFiles(root: string): JourneyFile[] {
  const dir = join(root, JOURNEYS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const file = `${JOURNEYS_DIR}/${f}`;
      let validation: JourneyValidation;
      try {
        validation = validateJourney(JSON.parse(readFileSync(join(dir, f), "utf8")));
      } catch (e) {
        validation = { ok: false, issues: [{ path: "", message: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` }] };
      }
      return { file, base: f.replace(/\.json$/, ""), validation };
    });
}

/** Journey names declared by more than one file, with those files. A name is the identity of
 *  a journey's snapshots (`<name>-<nn>-…`) and of its run record, so two files sharing one
 *  would overwrite each other's page states and findings, silently. */
export function duplicateJourneyNames(files: readonly JourneyFile[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const f of files) {
    const name = f.validation.journey?.name;
    if (name) byName.set(name, [...(byName.get(name) ?? []), f.file]);
  }
  return new Map([...byName].filter(([, list]) => list.length > 1));
}

export interface JourneyRunsManifest {
  v: 1;
  journeys: JourneyRecord[];
}

export function readJourneyRuns(root: string): JourneyRunsManifest | undefined {
  const file = join(root, JOURNEY_RUNS_FILE);
  if (!existsSync(file)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<JourneyRunsManifest>;
    if (!Array.isArray(raw.journeys)) return undefined;
    return { v: 1, journeys: raw.journeys.filter((j): j is JourneyRecord => isObj(j) && typeof j.name === "string" && Array.isArray(j.steps)) };
  } catch {
    return undefined;
  }
}

/** Record the journeys just replayed, keeping the last record of every other journey. */
export function writeJourneyRuns(root: string, records: readonly JourneyRecord[]): string {
  const file = join(root, JOURNEY_RUNS_FILE);
  const byName = new Map((readJourneyRuns(root)?.journeys ?? []).map((j) => [j.name, j]));
  for (const r of records) byName.set(r.name, r);
  const journeys = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ v: 1, journeys }, null, 2)}\n`);
  return file;
}

/** The record of a journey that was never replayed: every step `not-run`. */
export function notRunRecord(file: string, journey: Journey | undefined, base: string, reason?: string): JourneyRecord {
  const steps: JourneyStepRecord[] = (journey?.steps ?? []).map((s, i) => ({ n: i + 1, action: s.action, label: stepLabel(s), status: "not-run" }));
  return {
    name: journey?.name ?? base,
    file,
    keyboard: journey?.keyboardOnly === true,
    status: "not-run",
    ...(reason ? { reason } : {}),
    steps,
  };
}

/** `scope.journeys`: every journey file, with its last replay when there is one, and every
 *  replayed journey whose file is gone. Undefined when the project has no journey at all, so
 *  an audit of a project that never wrote one is unchanged. */
export function journeyScopeFor(root: string): JourneyScope | undefined {
  const files = listJourneyFiles(root);
  const runs = readJourneyRuns(root)?.journeys ?? [];
  if (!files.length && !runs.length) return undefined;
  const byName = new Map(runs.map((r) => [r.name, r]));
  const out: JourneyRecord[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const j = f.validation.journey;
    const name = j?.name ?? f.base;
    seen.add(name);
    if (!j) {
      out.push(
        notRunRecord(
          f.file,
          undefined,
          f.base,
          `invalid journey file: ${f.validation.issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")}`,
        ),
      );
      continue;
    }
    out.push(byName.get(name) ?? notRunRecord(f.file, j, f.base));
  }
  for (const r of runs) if (!seen.has(r.name)) out.push(r);
  return { manifest: JOURNEY_RUNS_FILE, journeys: out.sort((a, b) => a.name.localeCompare(b.name)) };
}
