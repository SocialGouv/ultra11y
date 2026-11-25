// ACT conformance — measuring this engine against a corpus nobody here wrote.
//
// The engine's own recall suite seeds one fixture per rule that EXISTS, so it can only
// ever prove "our rules fire on the defects we wrote for them". The W3C ACT-Rules
// Community Group publishes ~90 rules with ~1100 `passed` / `failed` / `inapplicable`
// examples, authored independently of this project against the ACT Rules Format. Running
// the engine over them is the only external yardstick available here, and it measures the
// two things that matter in opposite directions:
//
//   • recall    — a `failed` example must produce a finding from a rule that claims it;
//   • precision — a `passed` / `inapplicable` example must produce NONE.
//
// Honest scoping matters more than a big number:
//   1. An ACT example asserts something about ITS OWN rule and nothing else. An example
//      for "image has an accessible name" says nothing about `<main>` or `<title>`, so a
//      test case is only ever judged with the engine rules MAPPED to that ACT rule
//      (`ACT_RULES` below) — never with the whole engine.
//   2. Only NORMATIVE findings count. ultra11y's `advisory` findings deliberately never
//      flip a criterion, so they cannot make a case "fail" either.
//   3. A rule this engine cannot decide from source (computed contrast, keyboard traps,
//      whether a transcript is accurate) is declared `rendered` or `judgment` and is NOT
//      scored — it is routed to the `scan` tier or to the agent's adjudication. Declaring
//      it beats quietly scoring 0.
//   4. `gap: true` marks a rule that IS statically decidable and simply is not implemented
//      yet. Those are the honest to-do list, not hidden behind an "out of scope" label.
//
// Verdicts follow the ACT Rules Format's own vocabulary: a tool that never reports a false
// positive but does not catch everything is *partially consistent*, not wrong.
import { parseSource } from "./parse/source.js";
import { runRules } from "./rules/registry.js";

/** Why an ACT rule is or is not scored against the static engine. */
export type ActScope =
  | "static" // decidable from source — scored
  | "rendered" // needs a browser: computed style, focus, media playback → the `scan` tier
  | "judgment" // needs a human/AI call: is this text descriptive, is that transcript accurate
  | "deprecated"; // withdrawn upstream — scoring it would be noise

export interface ActMapping {
  /** Engine rules that test the SAME thing as this ACT rule. Deliberately conservative:
   *  a loosely-related rule would manufacture false "inconsistent" verdicts. */
  engineRules: string[];
  scope: ActScope;
  /** In-scope and statically decidable, but not implemented yet. */
  gap?: boolean;
  /** Why the mapping is what it is — divergences are documented, never silent. */
  note?: string;
  /** Test cases where this engine KNOWINGLY reports while ACT does not, keyed by test-case
   *  id with the reason. Every entry is a deliberate, argued position — typically "the fact
   *  that clears this example is not in the source" (a silent media file, a custom control
   *  wired in JS) or "this project holds a stricter line than the ACT rule". Listing them
   *  is what keeps the precision gate meaningful: an unexplained false positive still fails,
   *  a reasoned divergence is on the record. */
  divergences?: Record<string, string>;
}

// Keyed by ACT rule id. Every rule in the vendored corpus must appear here
// (tests/act-official.test.ts fails on drift), so a new upstream rule cannot slip in
// unclassified.
export const ACT_RULES: Record<string, ActMapping> = {
  // ---- covered: the engine implements an equivalent check -------------------------
  "23a2a8": { engineRules: ["img-alt-missing", "img-alt-missing-decorative"], scope: "static" },
  "59796f": { engineRules: ["input-image-alt-missing"], scope: "static" },
  "8fc3b6": { engineRules: ["object-embed-no-name"], scope: "static" },
  "7d6734": { engineRules: ["img-alt-missing"], scope: "static", note: "role=img on <svg> is handled by the same rule" },
  "97a4e1": { engineRules: ["button-empty-name", "icon-only-control-unnamed"], scope: "static" },
  c487ae: { engineRules: ["link-empty-name", "icon-only-control-unnamed"], scope: "static" },
  cae760: {
    engineRules: ["iframe-title-missing"],
    scope: "static",
    divergences: {
      "394132219ba385a90dda40efe822ab8db0cc9483":
        "a tabindex=-1 iframe is still exposed to assistive tech and still needs a title (RGAA 2.1 requires one unconditionally)",
    },
  },
  e086e5: {
    engineRules: ["control-label-missing"],
    scope: "static",
    note: "`placeholder-as-label` is deliberately NOT mapped: a placeholder does contribute to the accessible name, so ACT passes it — ultra11y still reports it, as a stricter house rule under 3.3.2.",
  },
  ffd0e9: { engineRules: ["empty-heading"], scope: "static" },
  b5c3f8: {
    engineRules: ["html-lang-missing"],
    scope: "static",
  },
  bf051a: {
    engineRules: ["lang-invalid"],
    scope: "static",
    note: "beyond syntax, a primary subtag is checked against the closed two-letter registry and the ISO 639-2 spellings of languages that have one (`eng`, `fre`); the deprecated grandfathered `i-*` tags (`i-lux`) are knowingly accepted",
  },
  de46e4: {
    engineRules: ["lang-invalid", "inline-lang-change-missing"],
    scope: "static",
    note: "same registry check as the page language; the deprecated grandfathered `i-*` tags are knowingly accepted",
    divergences: {
      "949f41987201e52f8404c1246d1229eec06dea08":
        'lang="" on an element carrying text declares no language for that text; ACT deems the rule inapplicable, this engine reports it under 3.1.2',
    },
  },
  "2779a5": { engineRules: ["title-missing-empty"], scope: "static" },
  "3ea0c8": { engineRules: ["duplicate-id"], scope: "static" },
  "674b10": { engineRules: ["invalid-aria-role"], scope: "static" },
  bc4a75: { engineRules: ["aria-required-children"], scope: "static" },
  "6cfa84": {
    engineRules: ["aria-hidden-focusable"],
    scope: "static",
    divergences: {
      "4cfb71fcbfb617bb32540826847a8d6af7890fd4":
        "a focus-sentinel link inside an aria-hidden wrapper: it IS reachable by Tab, and only a runtime focus handler bounces it back — the same call axe-core makes",
    },
  },
  "6a7281": { engineRules: ["invalid-aria-value", "live-region-conflict"], scope: "static" },
  b40fd1: {
    engineRules: ["bypass-blocks-missing"],
    scope: "static",
    note: 'decided only where a <nav> marks the repeated block and no landmark, heading or skip link exists at all; which block is repeated is otherwise a cross-page judgment. `missing-main-landmark` is NOT mapped: it requires a <main>, a stricter claim than ACT\'s "some landmark"',
  },
  "80f0bf": {
    engineRules: ["autoplay-media"],
    scope: "static",
    divergences: {
      "6a0fc31d6bea6ceced58d1ef97713935e4fd2717": "the source cannot tell that the referenced media file is silent",
      cc5c2900c8d128d3ca25d8443f1f3e0a0e5f58e6: "a #t= media fragment shortening playback below 3s is not resolvable from source",
      "85c01775d802057e6f43c2248b8a5eb916c50c74": "the pause mechanism is a custom button wired in JavaScript, not a native `controls` attribute",
    },
  },
  "4c31df": {
    engineRules: ["autoplay-media"],
    scope: "static",
    divergences: {
      b13d65523ad27d9c763caca8bcc0fcce4b5ca5fb: "the source cannot tell that the referenced media has no audio track",
      cf4bc23e70caa9b42a6f82739a8492cb51393dbc: "the pause mechanism is a custom button wired in JavaScript, not a native `controls` attribute",
    },
  },
  bc659a: { engineRules: ["meta-refresh-redirect"], scope: "static" },
  bisz58: {
    engineRules: ["meta-refresh-redirect"],
    scope: "static",
    note: "this variant drops the >20h exception the engine honours, so long delays are knowingly not reported",
  },
  b4f0c3: { engineRules: ["meta-viewport-zoom-block"], scope: "static" },
  f51b46: {
    engineRules: ["media-no-track"],
    scope: "static",
    note: "`media-no-track` is advisory by design — captions can be embedded in the media file and its audio track may be silent, neither visible in source — so it never counts as a catch here; whether captions exist and are accurate is decided by the agent against the media",
  },

  "2ee8b8": {
    engineRules: ["label-in-name-mismatch", "link-label-in-name-mismatch"],
    scope: "static",
    divergences: {
      "65be0004543e57d44dd4a53d9f582c482503727c":
        "an icon FONT renders the text 'search' as a glyph, so the visible label is not the text in the DOM — a fact only the rendered page carries",
    },
  },
  "73f2c2": { engineRules: ["autocomplete-token-invalid"], scope: "static" },
  "5f99a7": { engineRules: ["invalid-aria-attr"], scope: "static" },
  "5c01ea": {
    engineRules: ["aria-prohibited-attr"],
    scope: "static",
    note: "covers the name-prohibited roles and a closed set of role-specific properties (aria-sort, aria-orientation, aria-value*, aria-pressed, aria-modal…) on roles the source makes certain; the full permitted-attribute matrix is not encoded",
  },
  "4e8ab6": { engineRules: ["aria-required-attr"], scope: "static" },
  ff89c9: {
    engineRules: ["aria-required-parent"],
    scope: "static",
    note: "ownership assembled in script (a shadow root built at runtime) is not in the source",
  },
  "307n5z": { engineRules: ["presentational-children-focusable"], scope: "static" },
  a25f45: { engineRules: ["headers-attr-dangling"], scope: "static" },
  d0f69e: {
    engineRules: ["th-no-data-cells"],
    scope: "static",
    note: "decided for a fully `headers`-wired table, and for a simple grid (no row/col spans, leading header rows, nothing templated); other shapes need a full table model",
  },
  e6952f: { engineRules: ["duplicate-attribute"], scope: "static" },
  "5b7ae0": { engineRules: ["html-lang-xml-lang-mismatch"], scope: "static" },
  m6b1q3: { engineRules: ["menuitem-empty-name"], scope: "static" },
  ye5d6e: {
    engineRules: ["bypass-blocks-missing"],
    scope: "static",
    note: "decided only when the page has no in-page link at all; whether an existing skip link lands on the non-repeated content, or what is repeated without a <nav> marking it, is a judgment",
  },
  cf77f2: {
    engineRules: ["bypass-blocks-missing"],
    scope: "static",
    note: "decided only where a <nav> marks the repeated block; the corpus' failing page has none, so identifying its repeated block is left to the agent",
  },
  "047fe0": {
    engineRules: ["bypass-blocks-missing"],
    scope: "static",
    note: "decided only where a <nav> marks the repeated block and no heading, landmark or skip link exists outside it (h1-missing is advisory, so it does not count); an off-screen heading needs the rendered page",
  },
  "24afc2": {
    engineRules: ["letter-spacing-important"],
    scope: "static",
    note: "definite below-threshold author-important values; computed-unit cases remain rendered",
  },
  "78fd32": {
    engineRules: ["line-height-important"],
    scope: "static",
    note: "definite below-threshold author-important values (em, unitless, or a percentage of the own font size); a `px` value against a stylesheet font size needs the cascade and remains rendered",
  },
  "9e45ec": {
    engineRules: ["word-spacing-important"],
    scope: "static",
    note: "definite below-threshold author-important values; computed-unit cases remain rendered",
  },
  "46ca7f": { engineRules: ["decorative-marked-exposed"], scope: "static" },

  // ---- needs a rendered page: routed to the `scan` tier ---------------------------
  afw4f7: { engineRules: [], scope: "rendered", note: "computed contrast; only inline literal colour pairs are decided statically (contrast-literal)" },
  "09o5cg": { engineRules: [], scope: "rendered", note: "AAA enhanced contrast — outside the AA core" },
  oj04fd: { engineRules: [], scope: "rendered", note: "visible focus (2.4.7) — probed by scan --runtime local" },
  "80af7b": { engineRules: [], scope: "rendered" },
  a1b64e: { engineRules: [], scope: "rendered" },
  ebe86a: { engineRules: [], scope: "rendered" },
  "0ssw9k": { engineRules: [], scope: "rendered" },
  "59br37": { engineRules: [], scope: "rendered", note: "clipping under zoom — probed by scan --runtime local" },
  b33eff: { engineRules: [], scope: "rendered", note: "orientation lock via CSS transform" },
  "3e12e1": { engineRules: [], scope: "rendered" },
  efbfc7: { engineRules: [], scope: "rendered" },
  akn7bn: { engineRules: [], scope: "rendered", note: "needs the iframe's own document" },
  aaa1bf: { engineRules: [], scope: "rendered", note: "needs the media's duration" },
  "0va7u6": { engineRules: [], scope: "rendered", note: "text baked into a graphic" },

  // ---- needs a human/AI judgment: routed to the adjudication phase ----------------
  qt1vmo: { engineRules: [], scope: "judgment", note: "is the alt relevant (1.1.1)" },
  e88epe: { engineRules: [], scope: "judgment", note: "is the image genuinely decorative" },
  "5effbb": { engineRules: [], scope: "judgment", note: "link purpose in context (2.4.4)" },
  ffbc54: {
    engineRules: [],
    scope: "judgment",
    note: "2.1.4 single-character shortcuts are registered and disarmed in script (a keydown handler, a settings toggle); whether one exists and can be turned off or remapped is read from the behaviour, not the markup",
  },
  aizyf1: { engineRules: [], scope: "judgment" },
  b20e66: { engineRules: [], scope: "judgment" },
  fd3a94: { engineRules: [], scope: "judgment" },
  "4b1c6c": { engineRules: [], scope: "judgment" },
  b49b2e: { engineRules: [], scope: "judgment", note: "is the heading descriptive (2.4.6)" },
  cc0f0a: { engineRules: [], scope: "judgment" },
  c4a8a4: { engineRules: [], scope: "judgment" },
  "36b590": { engineRules: [], scope: "judgment" },
  "9bd38c": { engineRules: [], scope: "judgment", note: "sensory characteristics (1.3.3)" },
  off6ek: { engineRules: [], scope: "judgment", note: "does the subtag match the actual text language" },
  ucwvc8: { engineRules: [], scope: "judgment" },
  "7677a9": { engineRules: [], scope: "judgment" },
  c249d5: { engineRules: [], scope: "judgment" },
  "1a02b0": { engineRules: [], scope: "judgment" },
  e7aa44: { engineRules: [], scope: "judgment" },
  "2eb176": { engineRules: [], scope: "judgment" },
  afb423: { engineRules: [], scope: "judgment" },
  eac66b: { engineRules: [], scope: "judgment" },
  ab4d13: { engineRules: [], scope: "judgment" },
  c5a4ea: { engineRules: [], scope: "judgment" },
  "1ea59c": { engineRules: [], scope: "judgment" },
  "1ec09b": { engineRules: [], scope: "judgment" },
  c3232f: { engineRules: [], scope: "judgment" },
  d7ba54: { engineRules: [], scope: "judgment" },
  ee13b5: { engineRules: [], scope: "judgment" },
  fd26cf: { engineRules: [], scope: "judgment" },

  // ---- withdrawn upstream --------------------------------------------------------
  "9eb3f6": { engineRules: [], scope: "deprecated" },
  f196ce: { engineRules: [], scope: "deprecated" },
  ac7dc6: { engineRules: [], scope: "deprecated" },
};

// French editions of the project-authored notes and divergence reasons above, for the
// committed (French) references/act.md. Keyed like ACT_RULES (rule id) and like
// `divergences` (test-case id). A missing entry falls back to the English text;
// tests/act-matrix-sync.test.ts fails if one is missing, so the published doc never mixes.
export const ACT_NOTES_FR: Record<string, string> = {
  "7d6734": "role=img sur un <svg> est traité par la même règle",
  e086e5:
    "`placeholder-as-label` n’est volontairement PAS rattachée : un placeholder contribue bien au nom accessible, donc ACT valide le cas — ultra11y le signale quand même, en règle maison plus stricte sous 3.3.2.",
  bf051a:
    "au-delà de la syntaxe, la sous-étiquette principale est vérifiée contre le registre fermé des codes à deux lettres et les graphies ISO 639-2 des langues qui en ont une (`eng`, `fre`) ; les étiquettes héritées dépréciées `i-*` (`i-lux`) sont acceptées en connaissance de cause",
  de46e4: "même vérification de registre que pour la langue de la page ; les étiquettes héritées dépréciées `i-*` sont acceptées en connaissance de cause",
  b40fd1:
    "tranché seulement quand un <nav> marque le bloc répété et qu’aucune région, aucun titre ni aucun lien d’évitement n’existe ; sinon, savoir quel bloc se répète relève d’un jugement inter-pages. `missing-main-landmark` n’est PAS rattachée : elle exige un <main>, exigence plus stricte que « une région quelconque » chez ACT",
  bisz58: "cette variante supprime l’exception des plus de 20 h que le moteur respecte : les longs délais ne sont donc pas signalés, en connaissance de cause",
  f51b46:
    "`media-no-track` est consultative par conception — les sous-titres peuvent être incrustés dans le fichier média et sa piste audio peut être muette, deux faits invisibles dans le source — elle ne compte donc jamais comme une détection ici ; l’existence et l’exactitude des sous-titres sont tranchées par l’agent face au média",
  "5c01ea":
    "couvre les rôles qui interdisent un nom et un ensemble fermé de propriétés propres à un rôle (aria-sort, aria-orientation, aria-value*, aria-pressed, aria-modal…) sur des rôles que le source rend certains ; la matrice complète des attributs autorisés n’est pas encodée",
  ff89c9: "la parenté assemblée par script (une racine fantôme construite à l’exécution) n’est pas dans le source",
  d0f69e:
    "tranché pour un tableau entièrement câblé par `headers` et pour une grille simple (sans fusion de lignes ou de colonnes, avec les lignes d’en-tête en tête, rien de généré par gabarit) ; les autres formes exigent un modèle de tableau complet",
  ye5d6e:
    "tranché seulement quand la page n’a aucun lien interne ; savoir si un lien d’évitement existant mène au contenu non répété, ou ce qui se répète sans <nav> pour le marquer, relève du jugement",
  cf77f2:
    "tranché seulement quand un <nav> marque le bloc répété ; la page en échec du corpus n’en a pas, l’identification de son bloc répété est donc laissée à l’agent",
  "047fe0":
    "tranché seulement quand un <nav> marque le bloc répété et qu’aucun titre, aucune région ni aucun lien d’évitement n’existe hors de lui (h1-missing est consultative, elle ne compte donc pas) ; un titre hors écran exige la page rendue",
  "24afc2": "valeurs auteur `!important` certainement sous le seuil ; les cas en unités calculées restent du ressort du rendu",
  "78fd32":
    "valeurs auteur `!important` certainement sous le seuil (em, sans unité, ou pourcentage de la taille de police propre) ; une valeur en `px` face à une taille de police de feuille de style exige la cascade et reste du ressort du rendu",
  "9e45ec": "valeurs auteur `!important` certainement sous le seuil ; les cas en unités calculées restent du ressort du rendu",
  afw4f7: "contraste calculé ; seules les paires de couleurs littérales en ligne sont tranchées statiquement (contrast-literal)",
  "09o5cg": "contraste renforcé AAA — hors du socle AA",
  oj04fd: "focus visible (2.4.7) — sondé par scan --runtime local",
  "59br37": "rognage sous zoom — sondé par scan --runtime local",
  b33eff: "verrouillage de l’orientation par transformation CSS",
  akn7bn: "exige le document propre de l’iframe",
  aaa1bf: "exige la durée du média",
  "0va7u6": "texte incrusté dans une image",
  qt1vmo: "l’alternative est-elle pertinente (1.1.1)",
  e88epe: "l’image est-elle réellement décorative",
  "5effbb": "fonction du lien en contexte (2.4.4)",
  ffbc54:
    "les raccourcis à un seul caractère de 2.1.4 sont enregistrés et désactivés par script (un gestionnaire keydown, un réglage) ; savoir s’il en existe un et s’il peut être désactivé ou remappé se lit dans le comportement, pas dans le balisage",
  b49b2e: "le titre est-il descriptif (2.4.6)",
  "9bd38c": "caractéristiques sensorielles (1.3.3)",
  off6ek: "la sous-étiquette correspond-elle à la langue réelle du texte",
};

export const ACT_DIVERGENCES_FR: Record<string, string> = {
  "394132219ba385a90dda40efe822ab8db0cc9483":
    "une iframe en tabindex=-1 reste exposée aux technologies d’assistance et doit toujours avoir un titre (le RGAA 2.1 l’exige sans condition)",
  "949f41987201e52f8404c1246d1229eec06dea08":
    'lang="" sur un élément qui porte du texte ne déclare aucune langue pour ce texte ; ACT juge la règle non applicable, ce moteur le signale sous 3.1.2',
  "4cfb71fcbfb617bb32540826847a8d6af7890fd4":
    "un lien sentinelle de focus dans un conteneur aria-hidden : il EST atteignable au Tab, et seul un gestionnaire de focus à l’exécution le renvoie — le même choix qu’axe-core",
  "6a0fc31d6bea6ceced58d1ef97713935e4fd2717": "le source ne peut pas savoir que le fichier média référencé est muet",
  cc5c2900c8d128d3ca25d8443f1f3e0a0e5f58e6: "un fragment média #t= qui ramène la lecture sous 3 s ne se résout pas depuis le source",
  "85c01775d802057e6f43c2248b8a5eb916c50c74": "le mécanisme de pause est un bouton personnalisé câblé en JavaScript, pas un attribut natif `controls`",
  b13d65523ad27d9c763caca8bcc0fcce4b5ca5fb: "le source ne peut pas savoir que le média référencé n’a pas de piste audio",
  cf4bc23e70caa9b42a6f82739a8492cb51393dbc: "le mécanisme de pause est un bouton personnalisé câblé en JavaScript, pas un attribut natif `controls`",
  "65be0004543e57d44dd4a53d9f582c482503727c":
    "une POLICE d’icônes affiche le texte « search » sous forme de glyphe : l’étiquette visible n’est donc pas le texte du DOM — un fait que seule la page rendue porte",
};

const UNCLASSIFIED_NOTE = { en: "unclassified — new upstream rule", fr: "non classée — nouvelle règle en amont" } as const;

export interface ActTestcase {
  ruleId: string;
  ruleName: string;
  testcaseId: string;
  title: string;
  expected: "passed" | "failed" | "inapplicable";
  wcag: string[];
  html: string;
}

/** ACT Rules Format consistency, as measured here. */
export type ActVerdict =
  | "consistent" // every `failed` caught, zero finding on `passed`/`inapplicable`
  | "partially-consistent" // zero unexplained false positive, but some `failed` not caught
  | "divergent" // every `failed` caught; the only reports on clean cases are argued below
  | "inconsistent" // at least one UNEXPLAINED `passed`/`inapplicable` reported as failing
  | "not-scored"; // rendered / judgment / deprecated / not implemented

export interface ActRuleResult {
  ruleId: string;
  ruleName: string;
  wcag: string[];
  mapping: ActMapping;
  verdict: ActVerdict;
  failed: number;
  caught: number;
  clean: number; // passed + inapplicable
  falsePositives: { testcaseId: string; title: string; ruleIds: string[] }[];
  /** Clean cases this engine reports on DELIBERATELY, each with its recorded reason. */
  divergences: { testcaseId: string; title: string; ruleIds: string[]; reason: string }[];
  missed: { testcaseId: string; title: string }[];
}

/** Normative findings from the mapped engine rules only — see the header for why. */
function mappedFindings(html: string, testcaseId: string, engineRules: string[]): string[] {
  if (!engineRules.length) return [];
  const only = new Set(engineRules);
  return [
    ...new Set(
      runRules(parseSource(html, `${testcaseId}.html`), only)
        .filter((f) => !f.advisory)
        .map((f) => f.ruleId),
    ),
  ].sort();
}

type ActLang = "fr" | "en";

const VERDICT_LABEL: Record<ActLang, Record<ActVerdict, string>> = {
  en: {
    consistent: "✅ consistent",
    divergent: "🟦 divergent (documented)",
    "partially-consistent": "🟨 partially consistent",
    inconsistent: "❌ inconsistent",
    "not-scored": "—",
  },
  fr: {
    consistent: "✅ cohérente",
    divergent: "🟦 divergente (documentée)",
    "partially-consistent": "🟨 partiellement cohérente",
    inconsistent: "❌ incohérente",
    "not-scored": "—",
  },
};

const SCOPE_LABEL: Record<ActLang, Record<ActScope, string>> = {
  en: {
    static: "source",
    rendered: "rendered (`scan`)",
    judgment: "judgment (agent)",
    deprecated: "withdrawn upstream",
  },
  fr: {
    static: "source",
    rendered: "rendu (`scan`)",
    judgment: "jugement (agent)",
    deprecated: "retirée en amont",
  },
};

/** Fixed prose of the ACT matrix, per language. ACT rule names and test-case titles are
 *  W3C source data and are never translated. */
const ACT_TEXT = {
  en: {
    header: "<!-- GENERATED from the vendored W3C ACT corpus by `pnpm run build:act` — do not edit by hand. -->",
    title: "# ACT conformance — how this engine scores against a corpus it did not write",
    intro: [
      "The recall matrix in this repository proves that each rule fires on the defect written FOR it.",
      "That is circular. The [W3C ACT-Rules Community Group](https://act-rules.github.io) publishes rules",
      "with `passed` / `failed` / `inapplicable` examples authored independently of this project, so running",
      "the engine over them measures something a self-authored fixture cannot.",
      "",
      "**How to read this.** An ACT example asserts something about ITS OWN rule and nothing else, so each",
      "case is judged only with the engine rules mapped to that ACT rule — never with the whole engine.",
      "Only normative findings count (an `advisory` recommendation never flips a criterion, so it cannot",
      "fail a case either). Rules needing a rendered page or a human call are declared, not scored — saying",
      "so beats quietly scoring zero.",
    ],
    summary: "## Summary",
    corpus: (n: number, r: number) => `| Corpus | ${n} examples across ${r} ACT rules |`,
    source: "Source",
    scored: "Rules scored",
    caught: "Failed examples caught",
    clean: (c: number) => `| Clean examples left alone | **${c} / ${c}** — no unexplained false positive |`,
    consistent: "Consistent",
    divergent: (d: number) => `Divergent (documented, ${d} case${d === 1 ? "" : "s"})`,
    partial: "Partially consistent",
    inconsistent: "**Inconsistent**",
    gapsRow: "Declared gaps (static, not implemented)",
    verdicts: [
      "*Partially consistent* is the ACT Rules Format's own term for a tool that never reports a false",
      "positive but does not catch everything — it is a coverage statement, not an error. *Divergent* means",
      "every deviation on that rule is listed below with the argument for it.",
    ],
    scoredTitle: "## Scored rules",
    scoredHead: "| ACT rule | WCAG | Engine rules | Verdict | Caught |",
    notesTitle: "### Notes and documented divergences",
    reportsOn: (title: string, reason: string) => `reports on *${title}*: ${reason}`,
    gapsTitle: "## Declared gaps — statically decidable, not implemented yet",
    gapsHead: "| ACT rule | WCAG | Why it is not covered |",
    outTitle: "## Out of the static engine's reach — routed, not ignored",
    outHead: "| ACT rule | WCAG | Decided by |",
    footer: [
      "The corpus is vendored at `scripts/vendor/act-testcases.json` (refreshed by",
      "`pnpm run build:act:refresh`, and daily by the act-refresh workflow) so the suite stays",
      "offline and deterministic.",
      "ACT-Rules Community Group test cases are © their contributors under the W3C Software and",
      "Document License — see `NOTICE`.",
    ],
  },
  fr: {
    header: "<!-- GÉNÉRÉ depuis le corpus W3C ACT embarqué par `pnpm run build:act` — ne pas modifier à la main. -->",
    title: "# Conformité ACT — comment ce moteur se mesure à un corpus qu’il n’a pas écrit",
    intro: [
      "La matrice de rappel de ce dépôt prouve que chaque règle se déclenche sur le défaut écrit POUR elle.",
      "C’est circulaire. Le [W3C ACT-Rules Community Group](https://act-rules.github.io) publie des règles",
      "avec des exemples `passed` / `failed` / `inapplicable` rédigés indépendamment de ce projet : faire",
      "tourner le moteur dessus mesure ce qu’une fixture écrite maison ne peut pas mesurer.",
      "",
      "**Comment lire ce document.** Un exemple ACT affirme quelque chose sur SA PROPRE règle et rien d’autre :",
      "chaque cas n’est donc jugé qu’avec les règles du moteur rattachées à cette règle ACT — jamais avec tout",
      "le moteur. Seuls les constats normatifs comptent (une recommandation `advisory` ne fait jamais basculer",
      "un critère, elle ne peut donc pas non plus faire échouer un cas). Les règles qui exigent une page rendue",
      "ou un jugement humain sont déclarées, pas notées — le dire vaut mieux que noter zéro en silence.",
    ],
    summary: "## Synthèse",
    corpus: (n: number, r: number) => `| Corpus | ${n} exemples sur ${r} règles ACT |`,
    source: "Source",
    scored: "Règles notées",
    caught: "Exemples en échec détectés",
    clean: (c: number) => `| Exemples sains laissés intacts | **${c} / ${c}** — aucun faux positif inexpliqué |`,
    consistent: "Cohérentes",
    divergent: (d: number) => `Divergentes (documentées, ${d} cas)`,
    partial: "Partiellement cohérentes",
    inconsistent: "**Incohérentes**",
    gapsRow: "Lacunes déclarées (statiques, non implémentées)",
    verdicts: [
      "*Partiellement cohérente* est le terme du format ACT Rules lui-même pour un outil qui ne signale jamais",
      "de faux positif mais ne détecte pas tout — c’est un constat de couverture, pas une erreur. *Divergente*",
      "signifie que chaque écart sur cette règle est listé plus bas avec l’argument qui le justifie.",
    ],
    scoredTitle: "## Règles notées",
    scoredHead: "| Règle ACT | WCAG | Règles du moteur | Verdict | Détectés |",
    notesTitle: "### Notes et divergences documentées",
    reportsOn: (title: string, reason: string) => `signale sur *${title}* : ${reason}`,
    gapsTitle: "## Lacunes déclarées — décidables statiquement, pas encore implémentées",
    gapsHead: "| Règle ACT | WCAG | Pourquoi elle n’est pas couverte |",
    outTitle: "## Hors de portée du moteur statique — aiguillées, pas ignorées",
    outHead: "| Règle ACT | WCAG | Tranchée par |",
    footer: [
      "Le corpus est embarqué dans `scripts/vendor/act-testcases.json` (rafraîchi par",
      "`pnpm run build:act:refresh`, et chaque jour par le workflow act-refresh) pour que la suite reste",
      "hors ligne et déterministe.",
      "Les cas de test de l’ACT-Rules Community Group sont © leurs contributeurs, sous la W3C Software and",
      "Document License — voir `NOTICE`.",
    ],
  },
} as const;

/** The mapping note in the requested language (English fallback). */
function actNote(r: ActRuleResult, lang: ActLang): string | undefined {
  const note = r.mapping.note;
  if (lang === "en" || note === undefined) return note;
  if (note === UNCLASSIFIED_NOTE.en) return UNCLASSIFIED_NOTE.fr;
  return ACT_NOTES_FR[r.ruleId] ?? note;
}

/** Render the published conformance matrix (skills/ultra11y/references/act.md). Generated,
 *  never hand-written: `tests/act-matrix-sync.test.ts` fails if the committed file drifts
 *  from what the current engine actually scores. French by default (the committed doc);
 *  ACT rule names and test-case titles stay in their W3C source language. */
export function renderActMatrix(testcases: ActTestcase[], source: string, lang: ActLang = "fr"): string {
  const t = ACT_TEXT[lang];
  const rs = evaluateAct(testcases);
  const scored = rs.filter((r) => r.verdict !== "not-scored");
  const caught = scored.reduce((n, r) => n + r.caught, 0);
  const failed = scored.reduce((n, r) => n + r.failed, 0);
  const clean = scored.reduce((n, r) => n + r.clean, 0);
  const divergences = rs.reduce((n, r) => n + r.divergences.length, 0);
  const count = (v: ActVerdict): number => rs.filter((r) => r.verdict === v).length;

  const out: string[] = [];
  out.push(t.header, "");
  out.push(t.title, "");
  out.push(...t.intro, "");
  out.push(t.summary, "");
  out.push(`| | |`, `|---|---|`);
  out.push(t.corpus(testcases.length, new Set(testcases.map((x) => x.ruleId)).size));
  out.push(`| ${t.source} | ${source} |`);
  out.push(`| ${t.scored} | **${scored.length}** |`);
  out.push(`| ${t.caught} | **${caught} / ${failed}** |`);
  out.push(t.clean(clean));
  out.push(`| ${t.consistent} | ${count("consistent")} |`);
  out.push(`| ${t.divergent(divergences)} | ${count("divergent")} |`);
  out.push(`| ${t.partial} | ${count("partially-consistent")} |`);
  out.push(`| ${t.inconsistent} | **${count("inconsistent")}** |`);
  out.push(`| ${t.gapsRow} | ${rs.filter((r) => r.mapping.gap).length} |`);
  out.push("");
  out.push(...t.verdicts, "");

  if (scored.length) {
    out.push(t.scoredTitle, "");
    out.push(t.scoredHead, "|---|---|---|---|---|");
    for (const r of scored) {
      out.push(
        `| [${r.ruleName}](https://act-rules.github.io/rules/${r.ruleId}) | ${r.wcag.join(", ") || "—"} | ` +
          `${r.mapping.engineRules.map((x) => `\`${x}\``).join(", ") || "—"} | ${VERDICT_LABEL[lang][r.verdict]} | ${r.caught}/${r.failed} |`,
      );
    }
    out.push("");
    const notes: string[] = [];
    for (const r of scored) {
      const note = actNote(r, lang);
      if (note) notes.push(`- **${r.ruleName}** — ${note}`);
      for (const d of r.divergences) {
        const reason = lang === "fr" ? (ACT_DIVERGENCES_FR[d.testcaseId] ?? d.reason) : d.reason;
        notes.push(`- **${r.ruleName}** · ${t.reportsOn(d.title, reason)}`);
      }
    }
    if (notes.length) out.push(t.notesTitle, "", ...notes, "");
  }

  const gaps = rs.filter((r) => r.mapping.gap);
  if (gaps.length) {
    out.push(t.gapsTitle, "");
    out.push(t.gapsHead, "|---|---|---|");
    for (const r of gaps)
      out.push(`| [${r.ruleName}](https://act-rules.github.io/rules/${r.ruleId}) | ${r.wcag.join(", ") || "—"} | ${actNote(r, lang) ?? ""} |`);
    out.push("");
  }

  const outOfScope = rs.filter((r) => !r.mapping.gap && r.verdict === "not-scored");
  if (outOfScope.length) {
    out.push(t.outTitle, "");
    out.push(t.outHead, "|---|---|---|");
    for (const r of outOfScope) {
      const note = actNote(r, lang);
      out.push(
        `| [${r.ruleName}](https://act-rules.github.io/rules/${r.ruleId}) | ${r.wcag.join(", ") || "—"} | ${SCOPE_LABEL[lang][r.mapping.scope]}${note ? ` — ${note}` : ""} |`,
      );
    }
    out.push("");
  }
  out.push(...t.footer, "");
  return out.join("\n");
}

export function evaluateAct(testcases: ActTestcase[], map: Record<string, ActMapping> = ACT_RULES): ActRuleResult[] {
  const byRule = new Map<string, ActTestcase[]>();
  for (const tc of testcases) {
    const list = byRule.get(tc.ruleId);
    if (list) list.push(tc);
    else byRule.set(tc.ruleId, [tc]);
  }
  const out: ActRuleResult[] = [];
  for (const [ruleId, cases] of [...byRule].sort((a, b) => a[0].localeCompare(b[0]))) {
    const mapping = map[ruleId] ?? { engineRules: [], scope: "static" as ActScope, gap: true, note: UNCLASSIFIED_NOTE.en };
    const failedCases = cases.filter((c) => c.expected === "failed");
    const cleanCases = cases.filter((c) => c.expected !== "failed");
    const scored = mapping.scope === "static" && mapping.engineRules.length > 0;

    const falsePositives: ActRuleResult["falsePositives"] = [];
    const divergences: ActRuleResult["divergences"] = [];
    const missed: ActRuleResult["missed"] = [];
    let caught = 0;
    if (scored) {
      for (const c of failedCases) {
        const ids = mappedFindings(c.html, c.testcaseId, mapping.engineRules);
        if (ids.length) caught++;
        else missed.push({ testcaseId: c.testcaseId, title: c.title });
      }
      for (const c of cleanCases) {
        const ids = mappedFindings(c.html, c.testcaseId, mapping.engineRules);
        if (!ids.length) continue;
        const reason = mapping.divergences?.[c.testcaseId];
        if (reason) divergences.push({ testcaseId: c.testcaseId, title: c.title, ruleIds: ids, reason });
        else falsePositives.push({ testcaseId: c.testcaseId, title: c.title, ruleIds: ids });
      }
    }
    const verdict: ActVerdict = !scored
      ? "not-scored"
      : falsePositives.length > 0
        ? "inconsistent"
        : caught < failedCases.length
          ? "partially-consistent"
          : divergences.length > 0
            ? "divergent"
            : "consistent";
    out.push({
      ruleId,
      ruleName: cases[0]!.ruleName,
      wcag: cases[0]!.wcag,
      mapping,
      verdict,
      failed: failedCases.length,
      caught,
      clean: cleanCases.length,
      falsePositives,
      divergences,
      missed,
    });
  }
  return out;
}
