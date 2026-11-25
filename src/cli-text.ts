// CLI messages that several commands print word for word, in both output languages (#214:
// French by default, English with `--lang en`). Command-specific messages stay inline in
// src/cli.ts with the `lang === "fr" ? fr : en` pattern; only the repeated ones live here so
// the wording cannot drift between commands. Each takes the command name as it is shown
// after `ultra11y ` (e.g. "report", "scan", "journey run").
import type { Lang } from "./types.js";

const fr = (lang: Lang): boolean => lang === "fr";

export const M = {
  /** `--in` is missing. `hint` is appended verbatim (already localized by the caller). */
  inRequired: (cmd: string, lang: Lang, hint = ""): string =>
    fr(lang)
      ? `ultra11y ${cmd} : --in <audit.json> est obligatoire ('-' pour stdin).${hint}`
      : `ultra11y ${cmd}: --in <audit.json> is required ('-' for stdin).${hint}`,
  /** A `--in`/`--merge` payload that does not parse. */
  notJsonAudit: (cmd: string, flag: string, lang: Lang): string =>
    fr(lang)
      ? `ultra11y ${cmd} : ${flag} n'est pas du JSON valide (un AuditResult est attendu).`
      : `ultra11y ${cmd}: ${flag} is not valid JSON (expected an AuditResult).`,
  /** A payload that parses but is not a current audit. `what` is "input", "--in" or "--merge input". */
  notCurrentAudit: (cmd: string, lang: Lang, what: "input" | "--in" | "--merge" = "input"): string =>
    fr(lang)
      ? `ultra11y ${cmd} : ${what === "input" ? "l'entrée" : what === "--in" ? "--in" : "l'entrée --merge"} n'est pas un AuditResult ultra11y à jour (indexé WCAG, schéma v2). Relancez \`audit\`.`
      : `ultra11y ${cmd}: ${what === "input" ? "input" : what === "--in" ? "--in" : "--merge input"} is not a current ultra11y AuditResult (WCAG-keyed, schema v2). Re-run \`audit\`.`,
  /** `--fail-on` with a value that is not a severity. */
  failOnInvalid: (cmd: string, raw: unknown, lang: Lang): string =>
    fr(lang)
      ? `ultra11y ${cmd} : --fail-on doit valoir blocking|major|minor (reçu "${String(raw)}").`
      : `ultra11y ${cmd}: --fail-on must be blocking|major|minor (got "${String(raw)}").`,
  /** A file flag whose file is missing or unparsable. */
  fileNotFoundOrInvalid: (cmd: string, flag: string, path: string, lang: Lang): string =>
    fr(lang)
      ? `ultra11y ${cmd} : fichier ${flag} introuvable ou JSON invalide : ${path}.`
      : `ultra11y ${cmd}: ${flag} file not found or not valid JSON: ${path}.`,
  fileNotFound: (cmd: string, flag: string, path: string, lang: Lang): string =>
    fr(lang) ? `ultra11y ${cmd} : fichier ${flag} introuvable : ${path}.` : `ultra11y ${cmd}: ${flag} file not found: ${path}.`,
  fileUnreadable: (cmd: string, flag: string, path: string, reason: string, lang: Lang): string =>
    fr(lang) ? `ultra11y ${cmd} : impossible de lire ${flag} ${path} : ${reason}.` : `ultra11y ${cmd}: cannot read ${flag} ${path}: ${reason}.`,
  fileNotJson: (cmd: string, flag: string, lang: Lang): string =>
    fr(lang) ? `ultra11y ${cmd} : le fichier ${flag} n'est pas du JSON valide.` : `ultra11y ${cmd}: ${flag} file is not valid JSON.`,
  /** A count flag that must be a non-negative integer. */
  nonNegativeInt: (cmd: string, flag: string, raw: unknown, lang: Lang): string =>
    fr(lang)
      ? `ultra11y ${cmd} : ${flag} doit être un entier positif ou nul (reçu "${String(raw)}").`
      : `ultra11y ${cmd}: ${flag} must be a non-negative integer (got "${String(raw)}").`,
  runDirNotFound: (path: string, lang: Lang): string =>
    fr(lang) ? `ultra11y orchestrate : dossier de run introuvable : ${path}.` : `ultra11y orchestrate: run dir not found: ${path}.`,
} as const;
