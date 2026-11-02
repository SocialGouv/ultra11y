// veraPDF — AN EXTERNAL VALIDATOR, READ WHEN IT IS INSTALLED, NEVER RELIED ON.
//
// The engine reads a PDF for its gross failures (untagged, no language, no title, no text) and
// says, every time, that this is never PDF/UA conformance: only a validator establishes that.
// When that validator is on the machine, the 13.3 brief can carry its result beside the
// engine's checks, so the adjudicator does not have to run it by hand (#131).
//
// It is strictly OPTIONAL and strictly EXTERNAL:
//   • nothing is installed, bundled or required — absent, the brief is exactly what it was;
//   • its result is labelled as another tool's, is no evidence the gate can be cited on, and
//     decides nothing: PDF/UA-1 is not RGAA 13.3 (an accessible alternative version satisfies
//     13.3 whatever the PDF is, and a PDF/UA-valid file can still fail a reader);
//   • a run that fails is said to have failed — never read as « compliant ».
//
// Discovery: `ULTRA11Y_VERAPDF` names the executable, or is `off`/`0`/`false` to disable it;
// unset, `verapdf` is looked up on PATH.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

export interface VeraPdfRule {
  clause: string;
  testNumber: number;
  description: string;
  failedChecks: number;
}

export interface VeraPdfResult {
  /** The path as the caller gave it. */
  file: string;
  /** `true`/`false`: veraPDF's own verdict on its profile. Absent when the file was not validated. */
  compliant?: boolean;
  profile?: string;
  failedRules: VeraPdfRule[];
  /** Why there is no verdict (the run failed, the file was not parsed…). */
  error?: string;
}

export interface VeraPdfReport {
  command: string;
  version?: string;
  results: VeraPdfResult[];
}

const OFF = /^(?:off|0|false|no)$/i;

/** The veraPDF executable to run, or undefined when there is none (or it is disabled). */
export function veraPdfCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pinned = env.ULTRA11Y_VERAPDF?.trim();
  if (pinned) return OFF.test(pinned) ? undefined : pinned;
  const names = process.platform === "win32" ? ["verapdf.bat", "verapdf.exe", "verapdf"] : ["verapdf"];
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const n of names) {
      const p = join(dir, n);
      try {
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch {
        /* unreadable PATH entry — keep looking */
      }
    }
  }
  return undefined;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Parse veraPDF's `--format json` report. Pure: a job it cannot read is reported as such. */
export function parseVeraPdfJson(stdout: string, files: string[], absolute: string[]): Omit<VeraPdfReport, "command"> {
  let report: Json | undefined;
  try {
    report = obj(obj(JSON.parse(stdout))?.report);
  } catch {
    report = undefined;
  }
  const results = new Map<string, VeraPdfResult>();
  const version = arr(obj(report?.buildInformation)?.releaseDetails)
    .map(obj)
    .find((d) => d?.id === "apps")?.version;
  for (const job of arr(report?.jobs).map(obj)) {
    const name = obj(job?.itemDetails)?.name;
    const i = typeof name === "string" ? absolute.indexOf(resolve(name)) : -1;
    if (i < 0) continue;
    const file = files[i]!;
    const v = arr(job?.validationResult).map(obj)[0] ?? obj(job?.validationResult);
    if (!v || typeof v.compliant !== "boolean") {
      const why = obj(arr(job?.taskResult)[0])?.exceptionMessage ?? obj(job?.taskException)?.message ?? job?.jobEndStatus;
      results.set(file, { file, failedRules: [], error: typeof why === "string" && why ? why : "not validated" });
      continue;
    }
    const failedRules = arr(obj(v.details)?.ruleSummaries)
      .map(obj)
      .filter((r): r is Json => r !== undefined && (r.status === "failed" || r.ruleStatus === "FAILED"))
      .map((r) => ({
        clause: String(r.clause ?? "?"),
        testNumber: Number(r.testNumber ?? 0),
        description: String(r.description ?? ""),
        failedChecks: Number(r.failedChecks ?? 0),
      }));
    results.set(file, { file, compliant: v.compliant, ...(typeof v.profileName === "string" ? { profile: v.profileName } : {}), failedRules });
  }
  return {
    ...(typeof version === "string" ? { version } : {}),
    results: files.map(
      (file) => results.get(file) ?? { file, failedRules: [], error: report ? "absent from veraPDF's report" : "veraPDF produced no readable report" },
    ),
  };
}

const cache = new Map<string, VeraPdfReport | undefined>();

/** Validate `files` (paths relative to `cwd`) against PDF/UA-1 with the installed veraPDF, in
 *  one run. Undefined when no veraPDF is available. Cached per process on the files' paths,
 *  sizes and mtimes — the combined worklist and each criterion's brief ask for the same set. */
export function runVeraPdf(files: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): VeraPdfReport | undefined {
  const command = veraPdfCommand(opts.env);
  if (!command || !files.length) return undefined;
  const absolute = files.map((f) => resolve(opts.cwd ?? process.cwd(), f));
  const key = JSON.stringify([
    command,
    absolute.map((p) => {
      try {
        const st = statSync(p);
        return `${p}|${st.size}|${st.mtimeMs}`;
      } catch {
        return `${p}|missing`;
      }
    }),
  ]);
  if (cache.has(key)) return cache.get(key);
  const run = spawnSync(command, ["--flavour", "ua1", "--format", "json", ...absolute], {
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    ...(process.platform === "win32" ? { shell: true } : {}),
  });
  // veraPDF exits non-zero when a file is NOT compliant, so the exit code is no failure signal:
  // the report is. Only a run that produced none is one.
  let report: VeraPdfReport;
  if (run.error || !run.stdout?.trim()) {
    const why = run.error?.message ?? (run.stderr?.trim().split("\n")[0] || `exit ${run.status}`);
    report = { command, results: files.map((file) => ({ file, failedRules: [], error: `veraPDF did not run: ${why}` })) };
  } else {
    report = { command, ...parseVeraPdfJson(run.stdout, files, absolute) };
  }
  cache.set(key, report);
  return report;
}
