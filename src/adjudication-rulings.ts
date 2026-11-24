// HOW THE STANDARD'S OWN TEXT SETTLES THE CASES ADJUDICATORS KEEP GETTING WRONG (#183).
//
// The brief already carries every word of a pack criterion: its tests, the official test
// methodology under each test, the technical note, the particular cases and the glossary
// terms the tests are written in. A field review still found verdicts and severities the
// method does not support, on a handful of criteria, always the same way: the deciding
// sentence was in the brief, but nothing pointed at it, and the model reached for the
// broader reading.
//
//   • 9.4 — a glossary tooltip's definition, a paraphrased law and a page title were ruled
//     « citations », and a `<blockquote>` was proposed inside a `<span>`;
//   • 10.10 — a reference that NAMES its target (by a since-renamed label) was ruled an
//     indication « by position »;
//   • 10.11 — a decorative image overflowing by a few pixels was ruled a loss of
//     information, and a shared header was charged once per page;
//   • 6.1 — placeholder links meaningless to every reader were ruled bloquant, where the
//     criterion's own particular case makes them NA;
//   • 12.3 — the same placeholder links were charged again, majeur, in the site map.
//
// Each entry below is a ruling NOTE, not a new rule: `grounds` holds the standard's own words
// it rests on, copied verbatim from the vendored pack (src/data/standards/rgaa.json and its
// glossary), and tests/adjudication-rulings.test.ts fails the moment a quote stops occurring
// there — so a note can never drift into doctrine the referential does not state. Where a
// note is a REPORTING convention of this tool rather than the standard's (one finding per
// shared component), it says so.
import type { Lang } from "./types.js";

export type LocaleText = { fr: string; en: string };

export interface PackRuling {
  /** How to read the criterion on the recurring cases — one note per case. */
  notes: LocaleText[];
  /** The standard's own words each note rests on, VERBATIM (French, as the pack vendors them). */
  grounds: string[];
}

const q = (fr: string, en: string): LocaleText => ({ fr, en });

/** Pack key → criterion id → ruling notes. Only the criteria a field review showed being
 *  misread are here; every other criterion is read from its brief alone. */
export const PACK_RULINGS: Record<string, Record<string, PackRuling>> = {
  rgaa: {
    "6.1": {
      notes: [
        q(
          "Un lien dont l'intitulé ne signifie rien pour PERSONNE — un lien de remplissage (« Inaccessible », « Lien », « XXX ») que ni son intitulé ni son contexte n'expliquent à un lecteur sans limitation fonctionnelle — est le cas « ambigu pour tout le monde » : 6.1.1 à 6.1.4 sont NON APPLICABLES pour ce lien, pas bloquants. Il vaut au plus une recommandation (remplacer ou retirer le lien) ; s'il est cassé, c'est l'affaire d'un autre critère (12.3.2 dans un plan du site, par exemple).",
          "A link whose label means nothing to ANYONE — a placeholder link (« Inaccessible », « Lien », « XXX ») that neither its label nor its context explains to a reader with no functional limitation — is the « ambigu pour tout le monde » case: 6.1.1 to 6.1.4 are NOT APPLICABLE to that link, not blocking. It is worth a recommendation at most (replace or remove the link); if it is broken, another criterion owns that (12.3.2 in a site map, for instance).",
        ),
        q(
          "L'attribut `title` n'est PAS un contexte du lien : le glossaire en énumère six (la phrase, le paragraphe, l'item de liste, le titre précédent, l'en-tête et la cellule de tableau), et `title` n'en fait pas partie. Il n'entre dans l'intitulé que comme dernier recours du nom accessible, quand le lien n'a aucun contenu — un `title` ne rend donc pas explicite un lien dont le contenu est ambigu.",
          "The `title` attribute is NOT a link context: the glossary lists six (the sentence, the paragraph, the list item, the preceding heading, the table header and the table cell), and `title` is not among them. It enters the label only as the last fallback of the accessible name, when the link has no content — so a `title` does not make explicit a link whose content is ambiguous.",
        ),
      ],
      grounds: [
        "Il existe une gestion de cas particuliers pour les tests 6.1.1, 6.1.2, 6.1.3 et 6.1.4 lorsque le lien est [ambigu pour tout le monde](#ambigu-pour-tout-le-monde). Dans cette situation, où il n’est pas possible de rendre le lien explicite dans son contexte, le critère est non applicable.",
        "un lecteur sans limitation fonctionnelle ne connaîtrait pas la fonction d’un lien avant de l’activer",
        "Note 1 : l’un des 6 contextes de lien combiné à l’ intitulé du lien doit permettre de comprendre la fonction et la destination du lien.",
        "sinon, contenu de l’attribut title",
      ],
    },
    "8.7": {
      notes: [
        q(
          "Les « passages candidats » de la moisson sont des PISTES, jamais des NC : un nom propre, un mot d'origine étrangère présent dans le dictionnaire de la langue de la page, ou un mot passé dans l'usage courant dont la prononciation ne gêne pas la compréhension sont exemptés. Une NC 8.7.1 exige un passage réellement en langue étrangère, sans `lang` sur lui ni sur un parent, dont la restitution vocale serait incompréhensible (« deep linking » lu à la française, une phrase entière en anglais).",
          "The harvest's « candidate passages » are LEADS, never NCs: a proper noun, a foreign-origin word present in the dictionary of the page's language, or a word in common use whose pronunciation causes no misunderstanding is exempt. An 8.7.1 NC needs a passage genuinely in a foreign language, with no `lang` on it or on a parent, whose speech rendering would be unintelligible (« deep linking » read with French phonetics, a whole English sentence).",
        ),
      ],
      grounds: [
        "Des mots d’origine étrangère et d’usage courant dont la prononciation ne provoque pas d’incompréhension.",
        "le critère est applicable, uniquement lorsque l’absence d’indication de langue peut provoquer une incompréhension pour la restitution.",
      ],
    },
    "9.4": {
      notes: [
        q(
          "Une citation, ce sont les mots d'un TIERS, présentés comme reproduits à l'identique, dans le contenu courant de la page. Le glossaire du référentiel ne définit pas « citation » : le mot garde ce sens ordinaire. N'en sont PAS : la définition d'un terme dans une infobulle de glossaire, la paraphrase ou le résumé d'un texte de loi, un titre de page ou de section, une étiquette, un nom de clé ou de champ, un slogan entre guillemets. Au plus une recommandation, jamais une NC.",
          "A citation is the words of a THIRD PARTY, presented as reproduced verbatim, in the page's running content. The standard's glossary does not define « citation », so the word keeps that ordinary sense. NOT a citation: the definition of a term in a glossary tooltip, a paraphrase or summary of a law, a page or section title, a label, a key or field name, a slogan in quotation marks. A recommendation at most, never an NC.",
        ),
        q(
          "Une citation EN LIGNE (dans une phrase) ne peut échouer qu'à 9.4.1 (`<q>`). 9.4.2 porte sur un BLOC de citation : ne le citez jamais pour un texte pris dans un paragraphe.",
          "An INLINE quotation (inside a sentence) can only fail 9.4.1 (`<q>`). 9.4.2 is about a BLOCK of quotation: never cite it for text inside a paragraph.",
        ),
        q(
          "Ne proposez jamais `<blockquote>` là où seul du contenu phrasé est permis (dans un `<span>`, un `<a>`, un `<label>`, un titre ou un `<p>`) : HTML l'y interdit, et la correction serait elle-même une erreur de balisage. Une citation en ligne se corrige par `<q>`.",
          "Never propose `<blockquote>` where only phrasing content is allowed (inside a `<span>`, an `<a>`, a `<label>`, a heading or a `<p>`): HTML forbids it there, and the fix would itself be a markup error. An inline quotation is fixed with `<q>`.",
        ),
      ],
      grounds: [
        "Retrouver dans le document les citations courtes (ou en ligne) ;",
        "Dans chaque page web, chaque citation courte utilise-t-elle une balise `<q>` ?",
        "Dans chaque page web, chaque bloc de citation utilise-t-il une balise `<blockquote>` ?",
      ],
    },
    "10.10": {
      notes: [
        q(
          "10.10 n'échoue que si l'information est donnée UNIQUEMENT par la forme, la taille ou la position. Une référence qui NOMME sa cible (« le bouton Outils d'accessibilité », « voir la rubrique Contact ») est précisément le moyen alternatif : elle est conforme, même quand le nom employé est périmé (un bouton renommé depuis). Un nom périmé relève de l'exactitude du contenu : une recommandation, pas une NC 10.10.",
          "10.10 fails only when the information is given ONLY by shape, size or position. A reference that NAMES its target (« the Accessibility tools button », « see the Contact section ») is precisely the alternative means: it passes, even when the name it uses is stale (a button since relabelled). A stale name is a matter of content accuracy: a recommendation, not a 10.10 NC.",
        ),
        q(
          "Une NC 10.10 se cite sur une consigne qui ne renvoie qu'à une forme, une taille ou une position (« cliquez sur le bouton de droite », « l'onglet actif est celui en avant-plan ») sans aucun autre moyen de retrouver l'information.",
          "A 10.10 NC is cited on an instruction that points only at a shape, a size or a position (« click the button on the right », « the active tab is the one in front ») with no other way to recover the information.",
        ),
      ],
      grounds: [
        "vérifier que le moyen alternatif de récupérer cette information est pertinent, c’est-à-dire qu’il permet de transmettre l’information dans tous les contextes de consultation et pour tous les utilisateurs.",
        "l’information ne doit pas être donnée uniquement [par la forme, taille ou position]",
      ],
    },
    "10.11": {
      notes: [
        q(
          "Une NC exige qu'à 320 px une INFORMATION ou une FONCTIONNALITÉ ne soit plus disponible sans défilement horizontal : un texte coupé, un contrôle rogné ou hors d'atteinte. Le petit débordement d'une image décorative, ou d'une boîte seule (fond, bordure) alors que tout son texte et ses contrôles restent disponibles, est une recommandation. Images, graphiques, vidéos, tableaux de données et interfaces à ascenseur horizontal sont des exceptions du critère.",
          "An NC requires that at 320 px some INFORMATION or FUNCTION is no longer available without horizontal scrolling: text cut off, a control clipped or out of reach. A small overflow of a decorative image, or of a box alone (a background, a border) while all its text and controls stay available, is a recommendation. Images, graphics, videos, data tables and interfaces that need a horizontal scrollbar are the criterion's own exceptions.",
        ),
        q(
          "Convention de ce rapport (pas une règle du référentiel) : un composant partagé (en-tête, pied de page, navigation rendus sur chaque page) fait UN constat, ancré sur le composant ou sur la première page où il est observé — pas un par page. Nommez les autres pages dans le message.",
          "A convention of this report (not a rule of the standard): a shared component (a header, footer or navigation rendered on every page) is ONE finding, anchored on the component or on the first page it is observed on — not one per page. Name the other pages in the message.",
        ),
      ],
      grounds: [
        "l’ensemble des informations et des fonctionnalités sont-elles disponibles sans aucun défilement horizontal (hors cas particuliers) ?",
        "sans perte d’information ou de fonctionnalité",
        "- Les images, les graphiques ou les vidéos ;",
      ],
    },
    "12.3": {
      notes: [
        q(
          'Des entrées de remplissage dans un plan du site (un intitulé qui ne nomme aucune page, un `href="#"`) valent AU PLUS une NC mineure sur 12.3.3 — un lien qui ne conduit pas à la page indiquée par son intitulé —, citée une fois sur ces entrées, ou une recommandation. Et seulement APRÈS avoir vérifié où mènent les liens : un lien en erreur relève de 12.3.2, et un plan qui omet des pages reste conforme à 12.3.1 si elles sont atteignables autrement.',
          'Placeholder entries in a site map (a label that names no page, an `href="#"`) are AT MOST one minor (`mineur`) NC on 12.3.3 — a link that does not lead to the page its label indicates —, cited once on those entries, or a recommendation. And only AFTER checking where the links lead: a link in error belongs to 12.3.2, and a site map that omits pages still passes 12.3.1 if they can be reached otherwise.',
        ),
        q(
          "Ce sont les mêmes liens que ceux que 6.1 juge « ambigus pour tout le monde » : ne les facturez pas une seconde fois avec une autre gravité.",
          "These are the very links 6.1 rules « ambigu pour tout le monde »: do not charge them a second time with another severity.",
        ),
      ],
      grounds: [
        "Les liens du [plan du site](#page-plan-du-site) renvoient-ils bien vers les pages indiquées par l’intitulé ?",
        "vérifier qu’ils sont à jour (ni obsolètes ni en erreur) et conduisent à la page indiquée par leur intitulé",
        "Il n'est pas obligatoire que toutes les pages soient présentes dans le plan du site si elles peuvent être atteintes, par exemple, à partir de la page d'accueil d'une rubrique ou d'un catalogue.",
      ],
    },
  },
};

/** The ruling notes for one pack criterion, or undefined when it has none. */
export function packRuling(standard: string, criterionId: string): PackRuling | undefined {
  return PACK_RULINGS[standard]?.[criterionId];
}

/** The notes in one language, in order. */
export function packRulingNotes(standard: string, criterionId: string, lang: Lang): string[] {
  return packRuling(standard, criterionId)?.notes.map((n) => n[lang]) ?? [];
}

// THE SEVERITY RUBRIC — the same three words in every surface that asks for a severity.
//
// `severity` used to be optional and undefined: the contract offered the enum and nothing
// else, so the same defect (a duplicate id on a heading and its parent) came back majeur in one
// run and mineur in the others, and placeholder links came back bloquant. The rubric is this
// tool's, not the standard's — RGAA rules conformity, not severity — so it is stated as such.
export const SEVERITY_RUBRIC: Record<"bloquant" | "majeur" | "mineur", LocaleText> = {
  bloquant: q("aucun accès, aucun contournement", "no access, no workaround"),
  majeur: q("accès au prix d'un effort supplémentaire important", "access at the cost of a significant extra effort"),
  mineur: q("une gêne", "a nuisance"),
};

/** The rubric as one line, for a brief or a contract. */
export function severityRubricLine(lang: Lang): string {
  const r = SEVERITY_RUBRIC;
  return lang === "fr"
    ? `**GRAVITÉ** (\`severity\`, sur chaque constat NC) — \`bloquant\` : ${r.bloquant.fr} ; \`majeur\` : ${r.majeur.fr} ; \`mineur\` : ${r.mineur.fr}. Un défaut constaté au même endroit sous deux critères garde UNE gravité, la plus haute, pas une par critère. Une recommandation n'est jamais au-dessus de \`mineur\`.`
    : `**SEVERITY** (\`severity\`, on every NC finding) — \`bloquant\`: ${r.bloquant.en}; \`majeur\`: ${r.majeur.en}; \`mineur\`: ${r.mineur.en}. A defect observed at the same place under two criteria keeps ONE severity, the highest, not one per criterion. A recommendation is never above \`mineur\`.`;
}
