// SARIF 2.1.0 output — the machine-readable shape GitHub code scanning ingests, so a
// non-conformity lands as an INLINE ANNOTATION on the right line of a pull request
// instead of a bare exit code. Nothing new is computed here: a `Finding` already carries
// everything SARIF needs (ruleId, criteriaId, file/line/col, severity, message,
// remediation, source range). This is a pure projection.
//
// Two deliberate choices:
//  • Fingerprints reuse `findingId` (src/baseline.ts) — the SAME identity the regression
//    gate uses — so GitHub's alert de-duplication survives line drift exactly like the
//    baseline does, and an alert is not re-raised because a line moved.
//  • A URL-keyed finding (a dynamic `scan` result the host-anchor resolver could not map
//    back to a source file) gets NO physical location rather than a fabricated one. The
//    URL is preserved in `properties.url`. Inventing a file:line here would be the same
//    class of error the whole engine is built to refuse.
import { findingId } from "./baseline.js";
import { resolveMessage, resolveRemediation } from "./messages.js";
import { packCriteriaForFinding } from "./standards/derive.js";
import { CORE, type StandardId, isCore, loadPack } from "./standards/index.js";
import type { AuditResult, Finding, Lang, Severity } from "./types.js";
import { VERSION } from "./types.js";
import { isUrlPath, repoRelative } from "./util.js";
import { scTitle, understanding } from "./wcag.js";

const INFO_URI = "https://github.com/maxgfr/ultra11y";
const SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";
const FINGERPRINT_KEY = "ultra11yFindingId/v1";

export type SarifLevel = "error" | "warning" | "note";

export interface SarifRule {
  id: string;
  name?: string;
  shortDescription: { text: string };
  fullDescription?: { text: string };
  helpUri?: string;
  defaultConfiguration: { level: SarifLevel };
  properties?: { tags: string[]; "problem.severity": SarifLevel };
}

export interface SarifPhysicalLocation {
  artifactLocation: { uri: string };
  region?: { startLine: number; startColumn: number; snippet?: { text: string } };
}

export interface SarifLocation {
  physicalLocation: SarifPhysicalLocation;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: { text: string };
  locations: SarifLocation[];
  relatedLocations?: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  properties?: Record<string, string | boolean>;
}

export interface SarifRun {
  tool: { driver: { name: string; version: string; informationUri: string; rules: SarifRule[] } };
  automationDetails?: { id: string };
  results: SarifResult[];
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

export interface SarifOptions {
  standard?: StandardId;
  lang?: Lang;
  /** Root the artifact URIs are made relative to. Defaults to the process CWD. */
  baseDir?: string;
}

// Advisory findings are non-normative recommendations: whatever their severity rank, they
// must never surface as an `error` in a PR. Everything else maps by severity.
const LEVEL: Record<Severity, SarifLevel> = { bloquant: "error", majeur: "warning", mineur: "note" };

function levelFor(f: Finding): SarifLevel {
  return f.advisory ? "note" : LEVEL[f.severity];
}

const toUri = repoRelative;
const isUrl = isUrlPath;

function physicalLocation(f: Finding, baseDir: string): SarifLocation[] {
  if (isUrl(f.file)) return [];
  return [
    {
      physicalLocation: {
        artifactLocation: { uri: toUri(f.file, baseDir) },
        region: {
          // SARIF regions are 1-based. A merged dynamic finding can carry line 0 when the
          // host-anchor resolver declined to guess (src/scan.ts resolveHostAnchor) — clamp
          // rather than emit an invalid region.
          startLine: Math.max(1, f.line),
          startColumn: Math.max(1, f.col),
          ...(f.snippet ? { snippet: { text: f.snippet } } : {}),
        },
      },
    },
  ];
}

/** The cross-file context a graph rule attaches (a single related site, not a list). */
function relatedLocations(f: Finding, baseDir: string): SarifLocation[] | undefined {
  const r = f.related;
  if (!r || isUrl(r.file)) return undefined;
  return [
    { physicalLocation: { artifactLocation: { uri: toUri(r.file, baseDir) }, region: { startLine: Math.max(1, r.line), startColumn: Math.max(1, r.col) } } },
  ];
}

/** The criterion label a message should speak: the pack's own id when a standard is
 *  projected (RGAA 1.1), else the bare WCAG success criterion. */
function criterionLabel(f: Finding, standard: StandardId): string {
  if (isCore(standard)) return `WCAG ${f.criteriaId}`;
  const pack = loadPack(standard);
  const ids = packCriteriaForFinding(pack, f);
  return ids.length ? `${pack.name} ${ids.join(", ")}` : `WCAG ${f.criteriaId}`;
}

function ruleFor(f: Finding, standard: StandardId, lang: Lang): SarifRule {
  const sc = f.criteriaId;
  const title = scTitle(sc, lang);
  const tags = ["accessibility", `wcag:${sc}`];
  if (!isCore(standard)) {
    const pack = loadPack(standard);
    for (const id of packCriteriaForFinding(pack, f)) tags.push(`${pack.key}:${id}`);
  }
  if (f.advisory) tags.push("recommendation");
  const level = levelFor(f);
  return {
    id: f.ruleId,
    shortDescription: { text: title ? `${f.ruleId} — WCAG ${sc} ${title}` : `${f.ruleId} — WCAG ${sc}` },
    fullDescription: { text: resolveRemediation(f, lang) },
    ...(understanding(sc) ? { helpUri: understanding(sc) } : {}),
    defaultConfiguration: { level },
    properties: { tags, "problem.severity": level },
  };
}

/** Project an AuditResult onto a SARIF 2.1.0 log. Pure — writes nothing. */
export function toSarif(result: AuditResult, opts: SarifOptions = {}): SarifLog {
  const standard = opts.standard ?? CORE;
  const lang = opts.lang ?? "en";
  const baseDir = opts.baseDir ?? process.cwd();

  const rules: SarifRule[] = [];
  const indexOf = new Map<string, number>();
  const results: SarifResult[] = [];

  for (const f of result.findings) {
    let idx = indexOf.get(f.ruleId);
    if (idx === undefined) {
      idx = rules.length;
      indexOf.set(f.ruleId, idx);
      rules.push(ruleFor(f, standard, lang));
    }
    const related = relatedLocations(f, baseDir);
    const page = f.sample?.page;
    const properties: Record<string, string | boolean> = { criterion: criterionLabel(f, standard) };
    if (isUrl(f.file)) properties.url = f.file;
    if (page) properties.page = page;
    if (f.advisory) properties.advisory = true;
    if (f.preliminary) properties.preliminary = true;
    results.push({
      ruleId: f.ruleId,
      ruleIndex: idx,
      level: levelFor(f),
      message: { text: `[${criterionLabel(f, standard)}] ${resolveMessage(f, lang)} — ${resolveRemediation(f, lang)}` },
      locations: physicalLocation(f, baseDir),
      ...(related ? { relatedLocations: related } : {}),
      partialFingerprints: { [FINGERPRINT_KEY]: findingId(f) },
      properties,
    });
  }

  return {
    $schema: SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "ultra11y", version: VERSION, informationUri: INFO_URI, rules } },
        // Distinguishes concurrent uploads in one PR (source audit vs page scan) so
        // GitHub keeps them as separate analyses instead of overwriting one another.
        automationDetails: { id: `ultra11y/${standard}/` },
        results,
      },
    ],
  };
}
