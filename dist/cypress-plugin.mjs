// src/integrations/cypress-plugin.ts
import { readFileSync } from "fs";

// src/integrations/core.ts
import { spawnSync } from "child_process";
import { createRequire } from "module";

// src/messages.ts
var MSG_CATALOG = {
  // ---- Document rules (src/rules/pdf.ts) ----
  "pdf-untagged": {
    message: {
      fr: (p) => `Document PDF non balis\xE9 (PDF ${p.version}) \u2014 ${p.marked === "yes" ? "/MarkInfo d\xE9clare le balisage" : "pas de /MarkInfo << /Marked true >>"}, ${p.structTree === "yes" ? "un arbre de structure existe" : "pas d'arbre de structure (/StructTreeRoot)"} : une technologie d'assistance lit un flux de texte sans titres, listes ni tableaux.`,
      en: (p) => `Untagged PDF document (PDF ${p.version}) \u2014 ${p.marked === "yes" ? "/MarkInfo declares it marked" : "no /MarkInfo << /Marked true >>"}, ${p.structTree === "yes" ? "a structure tree exists" : "no structure tree (/StructTreeRoot)"}: assistive technology reads a flat stream of text with no headings, lists or tables.`
    },
    remediation: {
      fr: () => `Produisez un PDF balis\xE9 (PDF/UA-1) depuis l'outil source, ou proposez une version alternative accessible (HTML ou document balis\xE9) ; v\xE9rifiez le r\xE9sultat avec veraPDF ou PAC. En JavaScript, utilisez PDFKit (https://github.com/foliojs/pdfkit) : options \`subset: 'PDF/UA'\`, \`tagged: true\`, \`displayTitle: true\`, \`lang\`, un titre dans \`info\`, des polices TrueType ou OpenType incorpor\xE9es, et tout le contenu balis\xE9 ou marqu\xE9 comme artefact. PDFKit ne balise ni les annotations (dont les liens) ni les formulaires : pour ces contenus, pr\xE9voyez une version alternative accessible.`,
      en: () => `Produce a tagged PDF (PDF/UA-1) from the source tool, or offer an accessible alternative version (HTML or a tagged document); check the result with veraPDF or PAC. In JavaScript, use PDFKit (https://github.com/foliojs/pdfkit): options \`subset: 'PDF/UA'\`, \`tagged: true\`, \`displayTitle: true\`, \`lang\`, a title in \`info\`, embedded TrueType or OpenType fonts, and all content tagged or marked as an artifact. PDFKit does not tag annotations (links included) or forms: for those, provide an accessible alternative version.`
    }
  },
  "pdf-lang-missing": {
    message: {
      fr: () => `Le document PDF ne d\xE9clare pas de langue (/Lang absent du catalogue) \u2014 la synth\xE8se vocale ne sait pas dans quelle langue le lire.`,
      en: () => `The PDF document declares no language (no /Lang in the catalog) \u2014 speech synthesis cannot tell which language to read it in.`
    },
    remediation: {
      fr: () => `D\xE9clarez la langue du document (ex. /Lang (fr-FR)) dans l'outil qui produit le PDF.`,
      en: () => `Declare the document language (e.g. /Lang (en-GB)) in the tool that produces the PDF.`
    }
  },
  "pdf-title-missing": {
    message: {
      fr: (p) => p.titleState === "not-displayed" ? `Le document PDF a un titre (\xAB ${p.title} \xBB) mais /ViewerPreferences /DisplayDocTitle n'est pas vrai \u2014 le lecteur affiche le nom du fichier \xE0 la place.` : `Le document PDF n'a pas de titre (ni /Title dans les m\xE9tadonn\xE9es, ni dc:title XMP).`,
      en: (p) => p.titleState === "not-displayed" ? `The PDF document has a title ("${p.title}") but /ViewerPreferences /DisplayDocTitle is not true \u2014 the viewer shows the file name instead.` : `The PDF document has no title (no /Title in its metadata, no XMP dc:title).`
    },
    remediation: {
      fr: () => `Renseignez un titre pertinent dans les m\xE9tadonn\xE9es du document et activez l'affichage du titre (DisplayDocTitle).`,
      en: () => `Set a relevant title in the document metadata and turn on title display (DisplayDocTitle).`
    }
  },
  "pdf-no-text": {
    message: {
      fr: (p) => `Document PDF sans texte extractible (${p.pages} page(s), ${p.images} image(s), aucune police ni op\xE9rateur de texte) \u2014 un document num\xE9ris\xE9 dont le contenu est inaccessible \xE0 une technologie d'assistance.`,
      en: (p) => `PDF document with no extractable text (${p.pages} page(s), ${p.images} image(s), no font and no text operator) \u2014 a scanned document whose content assistive technology cannot reach.`
    },
    remediation: {
      fr: () => `Fournissez le document source en texte r\xE9el (ou passez-le en reconnaissance de caract\xE8res puis balisez-le), ou proposez une version alternative accessible.`,
      en: () => `Provide the source document as real text (or OCR it and then tag it), or offer an accessible alternative version.`
    }
  },
  "pdf-structure-shallow": {
    message: {
      fr: (p) => p.gap === "table-no-th" ? `Le document PDF est balis\xE9, mais ${p.without} tableau(x) sur ${p.tables} n'a(ont) aucune cellule d'en-t\xEAte (TH).` : `Le document PDF est balis\xE9, mais son arbre de structure (${p.elements} \xE9l\xE9ment(s)) ne contient aucun titre (H, H1\u2013H6).`,
      en: (p) => p.gap === "table-no-th" ? `The PDF document is tagged, but ${p.without} of its ${p.tables} table(s) have no header cell (TH).` : `The PDF document is tagged, but its structure tree (${p.elements} element(s)) holds no heading (H, H1\u2013H6).`
    },
    remediation: {
      fr: (p) => p.gap === "table-no-th" ? `Balisez les cellules d'en-t\xEAte des tableaux de donn\xE9es en TH (avec /Scope), si le tableau en a.` : `Balisez les intertitres du document en titres (H1\u2013H6), s'il en comporte.`,
      en: (p) => p.gap === "table-no-th" ? `Tag data-table header cells as TH (with /Scope), where the table has them.` : `Tag the document's headings as H1\u2013H6, where it has any.`
    }
  },
  "document-language-missing": {
    message: {
      fr: () => `La page n'a pas de langue par d\xE9faut sur <html> et au moins un texte visible n'h\xE9rite d'aucun attribut lang/xml:lang.`,
      en: () => `The page has no default language on <html>, and at least one visible text node inherits no lang/xml:lang attribute.`
    },
    remediation: {
      fr: () => `D\xE9clarez lang sur <html>, ou sur chaque texte (ou l'un de ses anc\xEAtres) conform\xE9ment au test RGAA 8.3.1.`,
      en: () => `Declare lang on <html>, or on every text node (or one of its ancestors) as allowed by RGAA test 8.3.1.`
    }
  },
  "html-lang-xml-lang-mismatch": {
    message: {
      fr: (p) => `lang="${p.lang}" et xml:lang="${p.xmlLang}" se contredisent sur <html>.`,
      en: (p) => `lang="${p.lang}" and xml:lang="${p.xmlLang}" conflict on <html>.`
    },
    remediation: {
      fr: () => `Utilisez le m\xEAme code de langue valide et pertinent dans les deux attributs, ou conservez seulement lang en HTML5.`,
      en: () => `Use the same valid and relevant language tag in both attributes, or keep only lang in HTML5.`
    }
  },
  "duplicate-attribute": {
    message: {
      fr: (p) => `L'attribut ${p.attr} est d\xE9clar\xE9 plusieurs fois sur la m\xEAme balise \u2014 le code g\xE9n\xE9r\xE9 est invalide.`,
      en: (p) => `The ${p.attr} attribute is declared more than once on the same tag \u2014 the generated markup is invalid.`
    },
    remediation: {
      fr: (p) => `Conservez une seule d\xE9claration de ${p.attr}.`,
      en: (p) => `Keep a single ${p.attr} declaration.`
    }
  },
  "presentational-children-focusable": {
    message: {
      fr: (p) => `Un descendant focalisable est plac\xE9 dans role="${p.role}", dont les enfants sont pr\xE9sentatifs \u2014 l'arbre d'accessibilit\xE9 est contradictoire.`,
      en: (p) => `A focusable descendant sits inside role="${p.role}", whose children are presentational \u2014 the accessibility tree conflicts.`
    },
    remediation: {
      fr: () => `Placez l'\xE9l\xE9ment interactif hors du composant, ou impl\xE9mentez l'interaction sur le composant ARIA lui-m\xEAme.`,
      en: () => `Move the interactive element outside the component, or implement the interaction on the ARIA component itself.`
    }
  },
  "decorative-marked-exposed": {
    message: {
      fr: (p) => `Ce <${p.tag}> est explicitement d\xE9coratif mais reste expos\xE9 par son nom ou sa pr\xE9sence dans l'ordre de tabulation.`,
      en: (p) => `This <${p.tag}> is explicitly decorative but remains exposed by its name or sequential focusability.`
    },
    remediation: {
      fr: () => `Retirez le nom et la focalisation de l'\xE9l\xE9ment d\xE9coratif, ou retirez son marquage d\xE9coratif s'il porte r\xE9ellement une fonction.`,
      en: () => `Remove the decorative element's name and focusability, or remove the decorative marking if it actually has a function.`
    }
  },
  "menuitem-empty-name": {
    message: {
      fr: () => `Cet \xE9l\xE9ment de menu n'a aucun nom accessible.`,
      en: () => `This menu item has no accessible name.`
    },
    remediation: {
      fr: () => `Fournissez un texte visible ou un nom accessible pertinent \xE0 l'\xE9l\xE9ment de menu.`,
      en: () => `Give the menu item visible text or a relevant accessible name.`
    }
  },
  "text-spacing-important": {
    message: {
      fr: (p) => `${p.property}: ${p.value} !important emp\xEAche l'espacement RGAA requis (minimum ${p.minimum}).`,
      en: (p) => `${p.property}: ${p.value} !important prevents the required RGAA spacing override (minimum ${p.minimum}).`
    },
    remediation: {
      fr: (p) => `Retirez !important de ${p.property}, ou utilisez une valeur au moins \xE9gale au seuil requis.`,
      en: (p) => `Remove !important from ${p.property}, or use a value at least equal to the required threshold.`
    }
  },
  "table-scope-invalid": {
    message: {
      fr: (p) => `scope="${p.scope}" n'est pas une valeur d'association d'en-t\xEAte valide.`,
      en: (p) => `scope="${p.scope}" is not a valid header-association value.`
    },
    remediation: {
      fr: () => `Utilisez scope="row", "col", "rowgroup" ou "colgroup" selon la port\xE9e r\xE9elle de l'en-t\xEAte.`,
      en: () => `Use scope="row", "col", "rowgroup", or "colgroup" according to the header's actual reach.`
    }
  },
  // ---- Theme 1 — Images (src/rules/images.ts) ---------------------------------
  "img-alt-missing": {
    message: {
      fr: (p) => `<${p.tag}> sans attribut alt ni nom accessible \u2014 alternative textuelle manquante.`,
      en: (p) => `<${p.tag}> has no alt attribute or accessible name \u2014 missing text alternative.`
    },
    remediation: {
      fr: () => `Ajoutez alt="\u2026" (description si l'image porte de l'information, alt="" si elle est d\xE9corative).`,
      en: () => `Add alt="\u2026" (a description if the image conveys information, alt="" if it is decorative).`
    }
  },
  "img-alt-missing-decorative": {
    message: {
      fr: (p) => `<${p.tag}> sans attribut alt dans un lien ou un bouton d\xE9j\xE0 intitul\xE9 par son texte \u2014 l'image le r\xE9p\xE8te, elle est d\xE9corative et doit \xEAtre ignor\xE9e.`,
      en: (p) => `<${p.tag}> has no alt attribute inside a link or button its own text already names \u2014 the image repeats it, so it is decorative and must be ignored.`
    },
    remediation: {
      fr: () => `Ajoutez alt="" (ou aria-hidden="true") ; si l'image apporte une information que le texte n'a pas, d\xE9crivez-la dans alt="\u2026".`,
      en: () => `Add alt="" (or aria-hidden="true"); if the image carries information the text does not, describe it in alt="\u2026".`
    }
  },
  "autocomplete-token-invalid": {
    message: {
      fr: (p) => `autocomplete="${p.value}" n'appartient pas au vocabulaire HTML \u2014 la finalit\xE9 du champ n'est pas identifiable.`,
      en: (p) => `autocomplete="${p.value}" is not in the HTML autofill vocabulary \u2014 the field's purpose is not identifiable.`
    },
    remediation: {
      fr: () => `Utilisez un token de la liste WCAG \xAB Input Purposes \xBB (par ex. given-name, email, tel, postal-code, current-password).`,
      en: () => `Use a token from the WCAG "Input Purposes" list (e.g. given-name, email, tel, postal-code, current-password).`
    }
  },
  "credential-entry-blocked.paste": {
    message: {
      fr: (p) => `Le collage est bloqu\xE9 sur ce champ <input type="${p.type}"> \u2014 la saisie du secret devient un test de m\xE9moire.`,
      en: (p) => `Paste is blocked on this <input type="${p.type}"> \u2014 entering the secret becomes a memory test.`
    },
    remediation: {
      fr: () => `Retirez le gestionnaire qui annule l'\xE9v\xE9nement paste : les gestionnaires de mots de passe doivent pouvoir remplir le champ.`,
      en: () => `Remove the handler cancelling the paste event: password managers must be able to fill the field.`
    }
  },
  "credential-entry-blocked.autocomplete": {
    message: {
      fr: (p) => `autocomplete="off" sur un champ d'identification (<input type="${p.type}">) \u2014 le remplissage automatique est d\xE9sactiv\xE9.`,
      en: (p) => `autocomplete="off" on a credential field (<input type="${p.type}">) \u2014 automatic filling is disabled.`
    },
    remediation: {
      fr: () => `D\xE9clarez la finalit\xE9 r\xE9elle (autocomplete="username" / "current-password" / "one-time-code") au lieu de "off".`,
      en: () => `Declare the real purpose (autocomplete="username" / "current-password" / "one-time-code") instead of "off".`
    }
  },
  "on-input-context-change": {
    message: {
      fr: (p) => `Changer la valeur de ce <${p.tag}> d\xE9clenche seul un changement de contexte (envoi/navigation).`,
      en: (p) => `Changing this <${p.tag}>'s value alone triggers a change of context (submit/navigation).`
    },
    remediation: {
      fr: () => `Attendez une action explicite (bouton \xAB Valider \xBB), ou annoncez le changement avant qu'il ne survienne.`,
      en: () => `Wait for an explicit action (a "Submit" button), or announce the change before it happens.`
    }
  },
  "label-in-name-mismatch": {
    message: {
      fr: (p) => `Le libell\xE9 visible \xAB ${p.visible} \xBB n'est pas contenu dans le nom accessible \xAB ${p.name} \xBB \u2014 la commande vocale \xE9choue.`,
      en: (p) => `The visible label "${p.visible}" is not contained in the accessible name "${p.name}" \u2014 voice control fails.`
    },
    remediation: {
      fr: (p) => `Faites commencer aria-label par le texte visible (\xAB ${p.visible} \u2026 \xBB), ou retirez aria-label et laissez le texte nommer le contr\xF4le.`,
      en: (p) => `Start aria-label with the visible text ("${p.visible} \u2026"), or drop aria-label and let the text name the control.`
    }
  },
  "field-label-in-name-mismatch": {
    message: {
      fr: (p) => `L'\xE9tiquette visible du champ \xAB ${p.visible} \xBB n'est pas contenue dans son nom accessible \xAB ${p.name} \xBB : l'aria-label la remplace (test RGAA 11.2.5).`,
      en: (p) => `The field's visible label "${p.visible}" is not contained in its accessible name "${p.name}": the aria-label replaces it.`
    },
    remediation: {
      fr: () => `Retirez l'aria-label pour que le <label> nomme le champ, ou faites-le contenir l'\xE9tiquette visible.`,
      en: () => `Drop the aria-label so the <label> names the field, or make it contain the visible label.`
    }
  },
  "headers-attr-dangling": {
    message: {
      fr: (p) => `headers="${p.ids}" ne d\xE9signe aucune cellule d'en-t\xEAte de ce tableau \u2014 l'association n'existe pas.`,
      en: (p) => `headers="${p.ids}" points at no header cell of this table \u2014 the association does not exist.`
    },
    remediation: {
      fr: () => `Faites pointer headers vers les id de <th> du M\xCAME tableau, ou utilisez scope="col"/"row".`,
      en: () => `Point headers at the ids of <th> cells in the SAME table, or use scope="col"/"row".`
    }
  },
  "th-no-data-cells": {
    message: {
      fr: () => `Cet en-t\xEAte n'est r\xE9f\xE9renc\xE9 par aucune cellule de donn\xE9es alors que le tableau utilise headers \u2014 il n'en-t\xEAte rien.`,
      en: () => `This header is referenced by no data cell although the table uses headers \u2014 it heads nothing.`
    },
    remediation: {
      fr: () => `Ajoutez son id au headers des cellules qu'il en-t\xEAte, ou retirez-le s'il ne sert qu'\xE0 la mise en forme.`,
      en: () => `Add its id to the headers of the cells it heads, or remove it if it is purely presentational.`
    }
  },
  "dl-structure.foreign-child": {
    message: {
      fr: (p) => `<${p.tag}> comme enfant direct de <dl> \u2014 seuls <dt>, <dd> (et <div> les groupant) sont admis.`,
      en: (p) => `<${p.tag}> as a direct child of <dl> \u2014 only <dt>, <dd> (and a grouping <div>) are allowed.`
    },
    remediation: {
      fr: () => `D\xE9placez le contenu dans un <dd>, ou sortez-le de la liste de d\xE9finitions.`,
      en: () => `Move the content into a <dd>, or take it out of the description list.`
    }
  },
  "dl-structure.orphan": {
    message: {
      fr: (p) => `<${p.tag}> hors de tout <dl> \u2014 la relation terme/description n'est pas expos\xE9e.`,
      en: (p) => `<${p.tag}> outside any <dl> \u2014 the term/description relationship is not exposed.`
    },
    remediation: {
      fr: (p) => `Enveloppez les paires <dt>/<dd> dans un <dl> (le <${p.tag}> seul n'a aucune s\xE9mantique).`,
      en: (p) => `Wrap the <dt>/<dd> pairs in a <dl> (a lone <${p.tag}> carries no semantics).`
    }
  },
  "invalid-aria-attr": {
    message: {
      fr: (p) => `Attribut ${p.attr} inconnu de WAI-ARIA \u2014 il est ignor\xE9 par les navigateurs et n'expose rien.`,
      en: (p) => `${p.attr} is not a WAI-ARIA attribute \u2014 browsers ignore it, so it exposes nothing.`
    },
    remediation: {
      fr: (p) => `Corrigez l'orthographe de ${p.attr} (par ex. aria-labelledby, aria-describedby) ou retirez l'attribut.`,
      en: (p) => `Fix the spelling of ${p.attr} (e.g. aria-labelledby, aria-describedby) or remove the attribute.`
    }
  },
  "invalid-aria-value": {
    message: {
      fr: (p) => `${p.attr}="${p.value}" n'est pas une valeur admise \u2014 l'\xE9tat est trait\xE9 comme absent.`,
      en: (p) => `${p.attr}="${p.value}" is not an allowed value \u2014 the state is treated as absent.`
    },
    remediation: {
      fr: (p) => `Utilisez une valeur d\xE9finie par WAI-ARIA pour ${p.attr} (par ex. true/false, ou un entier pour aria-level).`,
      en: (p) => `Use a value WAI-ARIA defines for ${p.attr} (e.g. true/false, or an integer for aria-level).`
    }
  },
  "invalid-aria-value.dangling-required": {
    message: {
      fr: (p) => `role="${p.role}" exige ${p.attr}, mais ${p.attr}="${p.value}" ne d\xE9signe aucun \xE9l\xE9ment de la page \u2014 la relation requise n'existe pas.`,
      en: (p) => `role="${p.role}" requires ${p.attr}, but ${p.attr}="${p.value}" names no element of the page \u2014 the required relationship does not exist.`
    },
    remediation: {
      fr: (p) => `Faites pointer ${p.attr} vers l'id d'un \xE9l\xE9ment pr\xE9sent dans la page.`,
      en: (p) => `Point ${p.attr} at the id of an element present in the page.`
    }
  },
  "aria-prohibited-attr.unsupported": {
    message: {
      fr: (p) => `${p.attrs} n'est pas pris en charge par le r\xF4le ${p.role} \u2014 la propri\xE9t\xE9 est ignor\xE9e et l'\xE9tat voulu n'est pas restitu\xE9.`,
      en: (p) => `${p.attrs} is not supported by the ${p.role} role \u2014 the property is dropped and the intended state never reaches the user.`
    },
    remediation: {
      fr: (p) => `Retirez ${p.attrs}, ou donnez \xE0 l'\xE9l\xE9ment le r\xF4le qui porte cette propri\xE9t\xE9.`,
      en: (p) => `Remove ${p.attrs}, or give the element the role that carries this property.`
    }
  },
  "aria-required-attr": {
    message: {
      fr: (p) => `role="${p.role}" sans ${p.attrs} \u2014 l'\xE9tat requis par ce r\xF4le n'est pas expos\xE9.`,
      en: (p) => `role="${p.role}" without ${p.attrs} \u2014 the state this role requires is not exposed.`
    },
    remediation: {
      fr: (p) => `Ajoutez ${p.attrs} et tenez la valeur \xE0 jour, ou utilisez l'\xE9l\xE9ment natif \xE9quivalent qui g\xE8re l'\xE9tat seul.`,
      en: (p) => `Add ${p.attrs} and keep it in sync, or use the native element, which manages the state on its own.`
    }
  },
  "aria-required-parent": {
    message: {
      fr: (p) => `role="${p.role}" hors de son conteneur requis (${p.parents}) \u2014 le r\xF4le n'est pas expos\xE9.`,
      en: (p) => `role="${p.role}" outside its required container (${p.parents}) \u2014 the role is not exposed.`
    },
    remediation: {
      fr: (p) => `Placez l'\xE9l\xE9ment dans un conteneur ${p.parents}, ou reliez-le via aria-owns.`,
      en: (p) => `Put the element inside a ${p.parents} container, or wire it up with aria-owns.`
    }
  },
  "aria-prohibited-attr": {
    message: {
      fr: (p) => `role="${p.role}" interdit un nom d'auteur, mais ${p.attrs} en fournit un \u2014 restitution impr\xE9visible.`,
      en: (p) => `role="${p.role}" prohibits an author-provided name, yet ${p.attrs} supplies one \u2014 restitution is unpredictable.`
    },
    remediation: {
      fr: (p) => `Retirez ${p.attrs}, ou donnez \xE0 l'\xE9l\xE9ment un r\xF4le qui accepte d'\xEAtre nomm\xE9.`,
      en: (p) => `Remove ${p.attrs}, or give the element a role that accepts a name.`
    }
  },
  "img-alt-missing.title-only": {
    message: {
      fr: (p) => `<${p.tag}> sans alt : le nom accessible vient du seul title, restitu\xE9 de fa\xE7on peu fiable (survol uniquement).`,
      en: (p) => `<${p.tag}> has no alt: its accessible name comes from title alone, which is restituted unreliably (hover only).`
    },
    remediation: {
      fr: () => `Recommandation : d\xE9placez le texte du title vers alt="\u2026" (alt="" si l'image est d\xE9corative).`,
      en: () => `Recommendation: move the title text into alt="\u2026" (alt="" if the image is decorative).`
    }
  },
  "decorative-alt-misuse.empty-but-named": {
    message: {
      fr: () => `Image d\xE9corative (alt="") mais nomm\xE9e par aria-label/title \u2014 incoh\xE9rence d\xE9coratif/informatif.`,
      en: () => `Decorative image (alt="") but named via aria-label/title \u2014 decorative/informative inconsistency.`
    },
    remediation: {
      fr: () => `Si l'image est d\xE9corative, retirez aria-label/title ; sinon donnez un alt descriptif.`,
      en: () => `If the image is decorative, remove aria-label/title; otherwise give it a descriptive alt.`
    }
  },
  "decorative-alt-misuse.role-but-alt": {
    message: {
      fr: (p) => `Image en role="${p.role}" mais porteuse d'un alt non vide \u2014 d\xE9clar\xE9e d\xE9corative pourtant nomm\xE9e.`,
      en: (p) => `Image with role="${p.role}" but carrying a non-empty alt \u2014 declared decorative yet named.`
    },
    remediation: {
      fr: (p) => `Retirez role="${p.role}" si l'image est informative, ou videz l'alt si elle est d\xE9corative.`,
      en: (p) => `Remove role="${p.role}" if the image is informative, or empty the alt if it is decorative.`
    }
  },
  "canvas-fallback-missing": {
    message: {
      fr: () => `<canvas> sans contenu alternatif ni nom accessible.`,
      en: () => `<canvas> has no fallback content or accessible name.`
    },
    remediation: {
      fr: () => `Placez un contenu de repli entre <canvas>\u2026</canvas> ou ajoutez role="img" + aria-label.`,
      en: () => `Place fallback content between <canvas>\u2026</canvas>, or add role="img" + aria-label.`
    }
  },
  "input-image-alt-missing": {
    message: {
      fr: () => `<input type="image"> sans alt ni nom accessible \u2014 le bouton image n'a pas d'alternative textuelle.`,
      en: () => `<input type="image"> has no alt or accessible name \u2014 the image button has no text alternative.`
    },
    remediation: {
      fr: () => `Ajoutez alt="\u2026" d\xE9crivant l'action du bouton (ex. alt="Rechercher").`,
      en: () => `Add alt="\u2026" describing the button's action (e.g. alt="Search").`
    }
  },
  "object-embed-no-name": {
    message: {
      fr: (p) => `<${p.tag}> sans nom accessible ni contenu de repli \u2014 m\xE9dia embarqu\xE9 sans alternative textuelle.`,
      en: (p) => `<${p.tag}> has no accessible name or fallback content \u2014 embedded media with no text alternative.`
    },
    remediation: {
      fr: () => `Ajoutez aria-label/title d\xE9crivant le contenu (et un contenu de repli textuel dans <object>\u2026</object>), ou aria-hidden="true" si d\xE9coratif.`,
      en: () => `Add aria-label/title describing the content (and text fallback content inside <object>\u2026</object>), or aria-hidden="true" if decorative.`
    }
  },
  "figure-caption-unassociated": {
    message: {
      fr: (p) => {
        const m = String(p.missing).split(",");
        const parts = [
          m.includes("role") ? `pas de role="figure" ou "group"` : "",
          m.includes("aria-label") ? "pas d'aria-label" : "",
          m.includes("aria-label-mismatch") ? "un aria-label diff\xE9rent de la l\xE9gende" : ""
        ].filter(Boolean);
        return `<figure> l\xE9gend\xE9e (\xAB ${p.caption} \xBB) : ${parts.join(", ")} \u2014 la l\xE9gende n'est pas reli\xE9e \xE0 l'image (test RGAA 1.9.1).`;
      },
      en: (p) => {
        const m = String(p.missing).split(",");
        const parts = [
          m.includes("role") ? `no role="figure" or "group"` : "",
          m.includes("aria-label") ? "no aria-label" : "",
          m.includes("aria-label-mismatch") ? "an aria-label that differs from the caption" : ""
        ].filter(Boolean);
        return `Captioned <figure> ("${p.caption}"): ${parts.join(", ")} \u2014 the caption is not tied to the image.`;
      }
    },
    remediation: {
      fr: (p) => `Ajoutez role="figure" et aria-label="${p.caption}" sur la balise <figure>, identique au contenu du <figcaption>.`,
      en: (p) => `Add role="figure" and aria-label="${p.caption}" to the <figure>, identical to the <figcaption> content.`
    }
  },
  "chart-no-accessible-name": {
    message: {
      fr: (p) => `Graphique (<${p.tag}> ${p.cls}) sans nom accessible \u2014 alternative textuelle manquante.`,
      en: (p) => `Chart (<${p.tag}> ${p.cls}) has no accessible name \u2014 missing text alternative.`
    },
    remediation: {
      fr: () => `Enveloppez le graphique dans <div role="img" aria-label="\u2026"> d\xE9crivant la tendance (ou ajoutez un <title>/aria-label).`,
      en: () => `Wrap the chart in <div role="img" aria-label="\u2026"> describing the trend (or add a <title>/aria-label).`
    }
  },
  // ---- Theme 2 — Frames (src/rules/frames.ts) ---------------------------------
  "iframe-title-missing": {
    message: {
      fr: () => `<iframe> sans attribut title \u2014 le cadre n'a pas de titre.`,
      en: () => `<iframe> has no title attribute \u2014 the frame has no title.`
    },
    remediation: {
      fr: () => `Ajoutez un title d\xE9crivant le contenu du cadre, ex. title="Carte de localisation".`,
      en: () => `Add a title describing the frame's content, e.g. title="Location map".`
    }
  },
  // ---- Theme 3 — Colours (src/rules/colors.ts) --------------------------------
  "contrast-literal": {
    message: {
      fr: (p) => `Contraste insuffisant : ratio ${p.ratio}:1 entre le texte et son fond (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}).`,
      en: (p) => `Insufficient contrast: ${p.ratio}:1 ratio between the text and its background (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text).`
    },
    remediation: {
      fr: (p) => `Assombrissez le texte ou \xE9claircissez le fond pour atteindre au moins ${p.min}:1 (contraste calcul\xE9 sur des couleurs inline litt\xE9rales).`,
      en: (p) => `Darken the text or lighten the background to reach at least ${p.min}:1 (contrast computed from literal inline colours).`
    }
  },
  // ---- Rendered tier (src/rules/rendered.ts) — decided from a page snapshot's signals -----
  // These say WHERE the measurement came from, because that is what makes them auditable: a
  // computed style, or a region of the screenshot. An auditor can go and re-check either.
  "rendered-contrast": {
    message: {
      fr: (p) => `Contraste insuffisant au rendu : ratio ${p.ratio}:1 entre le texte et son fond effectif (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}).`,
      en: (p) => `Insufficient contrast at render: ${p.ratio}:1 between the text and its effective background (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text).`
    },
    remediation: {
      fr: (p) => `Assombrissez le texte ou \xE9claircissez le fond pour atteindre au moins ${p.min}:1 (mesur\xE9 sur les styles calcul\xE9s de la page rendue).`,
      en: (p) => `Darken the text or lighten the background to reach at least ${p.min}:1 (measured from the rendered page's computed styles).`
    }
  },
  "rendered-contrast-pixel": {
    message: {
      fr: (p) => `Contraste insuffisant mesur\xE9 sur la capture d'\xE9cran : ratio ${p.ratio}:1 (minimum ${p.min}:1 pour du texte ${p.textSize === "large" ? "large" : "normal"}). Le fond vient d'une image ou d'un d\xE9grad\xE9, invisible aux styles calcul\xE9s.`,
      en: (p) => `Insufficient contrast measured on the screenshot: ${p.ratio}:1 (minimum ${p.min}:1 for ${p.textSize === "large" ? "large" : "normal"} text). The background comes from an image or gradient, which computed styles cannot express.`
    },
    remediation: {
      fr: (p) => `Garantissez au moins ${p.min}:1 sur toute la zone : ajoutez un fond opaque sous le texte, un voile, ou une ombre port\xE9e. Le fond a \xE9t\xE9 mesur\xE9 sur les pixels de la zone occup\xE9e par le texte.`,
      en: (p) => `Guarantee at least ${p.min}:1 across the whole area: add an opaque backing behind the text, a scrim, or a text shadow. The background was measured on the pixels of the text's own box.`
    }
  },
  "rendered-link-colour-only": {
    message: {
      fr: (p) => `Lien dans un bloc de texte distingu\xE9 par la COULEUR SEULE (\xE9cart de ${p.ratio}:1 avec le texte environnant, sans soulignement, bordure ni fond) \u2014 invisible pour qui ne per\xE7oit pas cette diff\xE9rence de couleur.`,
      en: (p) => `Link inside a text block distinguished by COLOUR ALONE (${p.ratio}:1 apart from the surrounding text, with no underline, border or background) \u2014 invisible to anyone who does not perceive that colour difference.`
    },
    remediation: {
      fr: () => `Ajoutez un indice non chromatique : text-decoration: underline (le plus simple), une bordure basse, ou une graisse nettement sup\xE9rieure. \xC0 d\xE9faut, un contraste d'au moins 3:1 avec le texte environnant ET un indice au survol/focus.`,
      en: () => `Add a non-colour cue: text-decoration: underline (simplest), a bottom border, or a distinctly heavier weight. Failing that, at least 3:1 contrast with the surrounding text AND a cue on hover/focus.`
    }
  },
  "rendered-nontext-contrast": {
    message: {
      fr: (p) => `Limite du composant <${p.control}> non perceptible : ni son fond (${p.ratio}:1 avec l'environnement) ni sa bordure n'atteignent 3:1 \u2014 rien n'indique visuellement o\xF9 commence le champ.`,
      en: (p) => `The <${p.control}> boundary is not perceivable: neither its fill (${p.ratio}:1 against its surroundings) nor its border reaches 3:1 \u2014 nothing shows visually where the control begins.`
    },
    remediation: {
      fr: () => `Donnez au composant une bordure visible contrastant \xE0 3:1 avec le fond environnant, ou un fond distinct du fond environnant \xE0 3:1. Un box-shadow ou un outline visible conviennent aussi.`,
      en: () => `Give the control a visible border at 3:1 against the surrounding background, or a fill distinct from it at 3:1. A visible box-shadow or outline also qualifies.`
    }
  },
  "rendered-focus-not-visible": {
    message: {
      fr: (p) => `La feuille de styles supprime l'indicateur de focus (\`${p.selector}\`) et aucune r\xE8gle \`:focus\` ne le remplace \u2014 un utilisateur au clavier ne peut plus savoir o\xF9 il se trouve.`,
      en: (p) => `The stylesheet removes the focus indicator (\`${p.selector}\`) and no \`:focus\` rule puts one back \u2014 a keyboard user can no longer tell where they are.`
    },
    remediation: {
      fr: () => `Ne supprimez jamais outline sans remplacement. Si le style par d\xE9faut ne convient pas, remplacez-le : \`:focus-visible { outline: 2px solid <couleur contrast\xE9e>; outline-offset: 2px }\`.`,
      en: () => `Never remove outline without a replacement. If the default does not fit, replace it: \`:focus-visible { outline: 2px solid <contrasting colour>; outline-offset: 2px }\`.`
    }
  },
  "rendered-orientation-lock": {
    message: {
      fr: (p) => `Le contenu est verrouill\xE9 dans une seule orientation : \`@media ${p.media}\` applique \`transform: ${p.transform}\` au document \u2014 l'utilisateur ne peut pas consulter la page dans l'orientation de son choix.`,
      en: (p) => `Content is locked to a single orientation: \`@media ${p.media}\` applies \`transform: ${p.transform}\` to the document \u2014 the user cannot view the page in the orientation they need.`
    },
    remediation: {
      fr: () => `Supprimez la rotation et rendez la mise en page responsive dans les deux orientations. Un verrouillage n'est admis que si l'orientation est essentielle (piano, ch\xE8que bancaire).`,
      en: () => `Remove the rotation and make the layout work in both orientations. Locking is only acceptable where the orientation is essential (a piano keyboard, a bank cheque).`
    }
  },
  // ---- Theme 5 — Data tables (src/rules/tables.ts) ----------------------------
  "data-table-no-headers.no-th": {
    message: {
      fr: () => `Tableau de donn\xE9es sans <th> \u2014 en-t\xEAtes de colonne/ligne non d\xE9clar\xE9s.`,
      en: () => `Data table with no <th> \u2014 column/row headers are not declared.`
    },
    remediation: {
      fr: () => `D\xE9clarez les en-t\xEAtes avec <th>, et associez-les via scope="col"/"row" (ou headers/id).`,
      en: () => `Declare headers with <th>, and associate them via scope="col"/"row" (or headers/id).`
    }
  },
  "data-table-no-headers.no-assoc": {
    message: {
      fr: () => `Tableau de donn\xE9es avec <th> mais sans scope/headers \u2014 association cellule\u2194en-t\xEAte absente.`,
      en: () => `Data table with <th> but no scope/headers \u2014 the cell\u2194header association is missing.`
    },
    remediation: {
      fr: () => `Ajoutez scope="col"/"row" sur les <th> (ou headers="\u2026"/id sur cellules complexes).`,
      en: () => `Add scope="col"/"row" on the <th> elements (or headers="\u2026"/id for complex cells).`
    }
  },
  "table-caption-missing": {
    message: {
      fr: () => `Tableau de donn\xE9es sans <caption> ni nom accessible \u2014 titre du tableau absent.`,
      en: () => `Data table with no <caption> or accessible name \u2014 the table has no title.`
    },
    remediation: {
      fr: () => `Ajoutez un <caption> en premi\xE8re position du <table> (ou aria-label/aria-labelledby).`,
      en: () => `Add a <caption> as the first child of the <table> (or aria-label/aria-labelledby).`
    }
  },
  "layout-table-data-markup": {
    message: {
      fr: (p) => `Tableau de mise en forme (role="${p.role}") utilisant du balisage de donn\xE9es (th/caption/scope).`,
      en: (p) => `Layout table (role="${p.role}") using data markup (th/caption/scope).`
    },
    remediation: {
      fr: () => `Retirez th/caption/scope/headers d'un tableau de pr\xE9sentation, ou faites-en un vrai tableau de donn\xE9es.`,
      en: () => `Remove th/caption/scope/headers from a presentation table, or turn it into a real data table.`
    }
  },
  "sortable-header-no-aria-sort": {
    message: {
      fr: () => `En-t\xEAte de colonne triable sans aria-sort \u2014 l'\xE9tat de tri (croissant/d\xE9croissant) n'est pas restitu\xE9.`,
      en: () => `Sortable column header with no aria-sort \u2014 the sort state (ascending/descending) is not conveyed.`
    },
    remediation: {
      fr: () => `Ajoutez aria-sort="none|ascending|descending" sur le <th> tri\xE9, et masquez le glyphe de tri (aria-hidden="true").`,
      en: () => `Add aria-sort="none|ascending|descending" on the sorted <th>, and hide the sort glyph (aria-hidden="true").`
    }
  },
  "table-empty-data-cell": {
    message: {
      fr: () => `Cellule de donn\xE9es vide (ou r\xE9duite \xE0 \xAB - \xBB) : restitu\xE9e \xAB vide \xBB par les lecteurs d'\xE9cran.`,
      en: () => `Empty data cell (or reduced to "-"): announced as "blank" by screen readers.`
    },
    remediation: {
      fr: () => `Ajoutez un texte masqu\xE9 (classe sr-only) pr\xE9cisant l'absence de valeur, ex. \xAB Non renseign\xE9 \xBB.`,
      en: () => `Insert hidden text (an sr-only class) stating the absence of a value, e.g. "Not provided".`
    }
  },
  // ---- Theme 6/7 — Links & buttons (src/rules/links.ts) -----------------------
  "link-empty-name": {
    message: {
      fr: () => `Lien sans intitul\xE9 \u2014 aucun nom accessible.`,
      en: () => `Link with no label \u2014 no accessible name.`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 textuel au lien (texte visible, ou aria-label si vraiment n\xE9cessaire).`,
      en: () => `Give the link a text label (visible text, or aria-label if truly necessary).`
    }
  },
  "button-empty-name": {
    message: {
      fr: () => `Bouton sans intitul\xE9 \u2014 aucun nom accessible.`,
      en: () => `Button with no label \u2014 no accessible name.`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 au bouton (texte, value, ou aria-label).`,
      en: () => `Give the button a label (text, value, or aria-label).`
    }
  },
  "icon-only-control-unnamed": {
    message: {
      fr: (p) => `${p.kind === "link" ? "Lien" : "Bouton"} avec une ic\xF4ne seule (img/svg/i) sans nom accessible.`,
      en: (p) => `${p.kind === "link" ? "Link" : "Button"} with an icon only (img/svg/i) and no accessible name.`
    },
    remediation: {
      fr: () => `Ajoutez un alt/aria-label sur l'ic\xF4ne ou un texte masqu\xE9 visuellement (classe visually-hidden).`,
      en: () => `Add an alt/aria-label on the icon, or a visually-hidden text (visually-hidden class).`
    }
  },
  "control-name-title-only": {
    message: {
      fr: (p) => `${p.kind === "link" ? "Lien" : p.kind === "field" ? "Champ de formulaire" : "Bouton"} dont le seul nom accessible vient de l'attribut title \u2014 title n'est pas restitu\xE9 de fa\xE7on fiable (survol uniquement).`,
      en: (p) => `${p.kind === "link" ? "Link" : p.kind === "field" ? "Form field" : "Button"} whose only accessible name comes from the title attribute \u2014 title is not reliably conveyed (hover only).`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 via texte visible ou aria-label ; r\xE9servez title \xE0 une information compl\xE9mentaire.`,
      en: () => `Give it a label via visible text or aria-label; reserve title for supplementary information.`
    }
  },
  // ---- Theme 7 — Scripts / ARIA (src/rules/scripts-aria.ts) -------------------
  "invalid-aria-role": {
    message: {
      fr: (p) => `R\xF4le ARIA invalide : "${p.roles}" n'est pas un r\xF4le WAI-ARIA valide.`,
      en: (p) => `Invalid ARIA role: "${p.roles}" is not a valid WAI-ARIA role.`
    },
    remediation: {
      fr: () => `Utilisez un r\xF4le ARIA valide ou un \xE9l\xE9ment HTML natif \xE9quivalent.`,
      en: () => `Use a valid ARIA role, or an equivalent native HTML element.`
    }
  },
  "aria-ref-missing-id": {
    message: {
      fr: (p) => `${p.attr} r\xE9f\xE9rence un id inexistant : ${p.ids}.`,
      en: (p) => `${p.attr} references a non-existent id: ${p.ids}.`
    },
    remediation: {
      fr: () => `Corrigez la r\xE9f\xE9rence ou ajoutez l'\xE9l\xE9ment cible avec l'id attendu.`,
      en: () => `Fix the reference, or add the target element with the expected id.`
    }
  },
  "redundant-aria": {
    message: {
      fr: (p) => `role="${p.role}" est redondant : <${p.tag}> a d\xE9j\xE0 ce r\xF4le implicite.`,
      en: (p) => `role="${p.role}" is redundant: <${p.tag}> already has this implicit role.`
    },
    remediation: {
      fr: () => `Retirez l'attribut role redondant et laissez la s\xE9mantique native.`,
      en: () => `Remove the redundant role attribute and let the native semantics apply.`
    }
  },
  "clickable-noninteractive": {
    message: {
      fr: (p) => `<${p.tag}> avec onClick mais ${p.focusIssue === "no-tabindex" ? "non focalisable (tabindex absent)" : "sans r\xF4le interactif"} \u2014 contr\xF4le non accessible au clavier/AT.`,
      en: (p) => `<${p.tag}> has onClick but ${p.focusIssue === "no-tabindex" ? "is not focusable (no tabindex)" : "has no interactive role"} \u2014 control not accessible via keyboard/AT.`
    },
    remediation: {
      fr: () => `Utilisez <button>/<a> natif, ou ajoutez role + tabindex="0" + gestion clavier (Enter/Espace).`,
      en: () => `Use a native <button>/<a>, or add role + tabindex="0" + keyboard handling (Enter/Space).`
    }
  },
  "aria-required-children": {
    message: {
      fr: (p) => `role="${p.role}" sans enfant requis (${p.req}) \u2014 structure ARIA incompl\xE8te.`,
      en: (p) => `role="${p.role}" with no required child (${p.req}) \u2014 incomplete ARIA structure.`
    },
    remediation: {
      fr: () => `Ajoutez les \xE9l\xE9ments enfants au r\xF4le appropri\xE9, ou utilisez les \xE9l\xE9ments HTML natifs.`,
      en: () => `Add child elements with the appropriate role, or use native HTML elements.`
    }
  },
  "aria-required-children.forbidden-child": {
    message: {
      fr: (p) => `role="${p.role}" poss\xE8de un \xE9l\xE9ment de r\xF4le ${p.child}, qu'il n'admet pas (attendus : ${p.req}) \u2014 structure ARIA invalide.`,
      en: (p) => `role="${p.role}" owns an element with role ${p.child}, which it does not allow (expected: ${p.req}) \u2014 invalid ARIA structure.`
    },
    remediation: {
      fr: () => `Sortez cet \xE9l\xE9ment du conteneur, ou donnez-lui un r\xF4le que le conteneur admet.`,
      en: () => `Move that element out of the container, or give it a role the container allows.`
    }
  },
  "aria-hidden-focusable": {
    message: {
      fr: () => `aria-hidden="true" sur (ou contenant) un \xE9l\xE9ment focalisable \u2014 pi\xE8ge pour les technologies d'assistance.`,
      en: () => `aria-hidden="true" on (or containing) a focusable element \u2014 a trap for assistive technology.`
    },
    remediation: {
      fr: () => `Retirez aria-hidden, ou rendez l'\xE9l\xE9ment non focalisable (tabindex="-1", disabled).`,
      en: () => `Remove aria-hidden, or make the element non-focusable (tabindex="-1", disabled).`
    }
  },
  "nested-interactive": {
    message: {
      fr: (p) => `\xC9l\xE9ment interactif <${p.tag}> imbriqu\xE9 dans un autre \xE9l\xE9ment interactif \u2014 non restitu\xE9 correctement.`,
      en: (p) => `Interactive element <${p.tag}> nested inside another interactive element \u2014 not conveyed correctly.`
    },
    remediation: {
      fr: () => `Ne pas imbriquer des contr\xF4les interactifs (lien/bouton) ; mettez-les c\xF4te \xE0 c\xF4te.`,
      en: () => `Do not nest interactive controls (link/button); place them side by side instead.`
    }
  },
  "live-region-conflict.invalid-value": {
    message: {
      fr: (p) => `aria-live="${p.value}" invalide \u2014 seules les valeurs off, polite, assertive sont restitu\xE9es.`,
      en: (p) => `aria-live="${p.value}" is invalid \u2014 only the values off, polite, assertive are honoured.`
    },
    remediation: {
      fr: () => `Utilisez aria-live="polite" (associ\xE9 \xE0 aria-atomic="true") \u2014 ou role="alert" pour une erreur ; toute autre valeur est ignor\xE9e.`,
      en: () => `Use aria-live="polite" (paired with aria-atomic="true") \u2014 or role="alert" for an error; any other value is ignored.`
    }
  },
  "live-region-conflict.mismatch": {
    message: {
      fr: (p) => `role="${p.role}" implique aria-live="${p.want}" mais aria-live="${p.live}" \u2014 message de statut restitu\xE9 de fa\xE7on incoh\xE9rente.`,
      en: (p) => `role="${p.role}" implies aria-live="${p.want}" but aria-live="${p.live}" \u2014 status message conveyed inconsistently.`
    },
    remediation: {
      fr: (p) => p.want === "assertive" ? `Laissez role="${p.role}" g\xE9rer la restitution (retirez aria-live) ou utilisez aria-live="assertive".` : `Alignez aria-live sur "${p.want}" (avec aria-atomic="true"), coh\xE9rent avec role="${p.role}", ou retirez-le.`,
      en: (p) => p.want === "assertive" ? `Let role="${p.role}" drive the announcement (remove aria-live), or use aria-live="assertive".` : `Align aria-live with "${p.want}" (with aria-atomic="true"), consistent with role="${p.role}", or remove it.`
    }
  },
  "status-message-not-assertive": {
    message: {
      fr: () => `Conteneur d'erreur/alerte en aria-live="polite" \u2014 un message d'erreur doit \xEAtre restitu\xE9 de fa\xE7on assertive.`,
      en: () => `Error/alert container with aria-live="polite" \u2014 an error message must be conveyed assertively.`
    },
    remediation: {
      fr: () => `Utilisez role="alert" seul (restitution assertive imm\xE9diate) plut\xF4t qu'aria-live="polite" ; ne d\xE9placez pas aussi le focus vers ce conteneur \u2014 soit un m\xE9canisme aria-live/role="alert", soit un d\xE9placement du focus, jamais les deux.`,
      en: () => `Use role="alert" alone (immediate assertive restitution) rather than aria-live="polite"; do not also move focus to that container \u2014 a live region OR a focus move, never both.`
    }
  },
  // ---- Theme 8 — Mandatory elements (src/rules/mandatory.ts) ------------------
  "html-lang-missing": {
    message: {
      fr: () => `<html> sans attribut lang \u2014 la langue par d\xE9faut de la page n'est pas d\xE9clar\xE9e.`,
      en: () => `<html> has no lang attribute \u2014 the page's default language is not declared.`
    },
    remediation: {
      fr: () => `Ajoutez lang sur <html>, ex. <html lang="fr">.`,
      en: () => `Add lang on <html>, e.g. <html lang="en">.`
    }
  },
  "title-missing-empty": {
    message: {
      fr: (p) => p.titleState === "empty" ? `<title> vide \u2014 le titre de la page est absent de contenu.` : `<title> absent \u2014 la page n'a pas de titre.`,
      en: (p) => p.titleState === "empty" ? `<title> is empty \u2014 the page title has no content.` : `<title> is missing \u2014 the page has no title.`
    },
    remediation: {
      fr: () => `Ajoutez un <title> non vide et pertinent dans <head>.`,
      en: () => `Add a non-empty, relevant <title> in <head>.`
    }
  },
  "duplicate-id": {
    message: {
      fr: (p) => `id="${p.id}" dupliqu\xE9 \u2014 un id doit \xEAtre unique dans la page (HTML invalide).`,
      en: (p) => `id="${p.id}" duplicated \u2014 an id must be unique in the page (invalid HTML).`
    },
    remediation: {
      fr: () => `Donnez un id unique \xE0 chaque \xE9l\xE9ment ; ajustez les r\xE9f\xE9rences (label[for], aria-*).`,
      en: () => `Give each element a unique id; adjust references accordingly (label[for], aria-*).`
    }
  },
  "inline-lang-change-missing": {
    message: {
      fr: (p) => `Attribut lang vide sur <${p.tag}> \u2014 changement de langue mal indiqu\xE9.`,
      en: (p) => `Empty lang attribute on <${p.tag}> \u2014 the language change is not properly indicated.`
    },
    remediation: {
      fr: () => `Renseignez un code de langue valide (ex. lang="en") ou retirez l'attribut.`,
      en: () => `Provide a valid language code (e.g. lang="en") or remove the attribute.`
    }
  },
  "lang-invalid": {
    message: {
      fr: (p) => `Code de langue invalide lang="${p.lang}" sur <${p.tag}> \u2014 n'est pas un code BCP 47 valide.`,
      en: (p) => `Invalid language code lang="${p.lang}" on <${p.tag}> \u2014 not a valid BCP 47 code.`
    },
    remediation: {
      fr: () => `Utilisez un code de langue valide (ex. "fr", "en", "fr-CA").`,
      en: () => `Use a valid language code (e.g. "en", "fr", "en-US").`
    }
  },
  // ---- Theme 9 — Headings (src/rules/headings.ts) -----------------------------
  "heading-order-skip": {
    message: {
      fr: (p) => `Saut de niveau de titre : <h${p.level}> apr\xE8s <h${p.prev}> (niveau h${p.expected} attendu).`,
      en: (p) => `Heading level skip: <h${p.level}> after <h${p.prev}> (level h${p.expected} expected).`
    },
    remediation: {
      fr: () => `Ne sautez pas de niveau : encha\xEEnez les titres sans omettre de palier.`,
      en: () => `Do not skip a level: chain heading levels without omitting a step.`
    }
  },
  // ADVISORY (non-normative): "start the page at h1" is not required by HTML, WCAG, or
  // SEO — a single, well-structured heading hierarchy (covered normatively by
  // heading-order-skip) is what matters. Worded as a recommendation, not a constat.
  "h1-missing": {
    message: {
      fr: () => `Recommandation : la page ne commence par aucun <h1>. Un <h1> d\xE9crivant le contenu principal aide au rep\xE9rage, mais d\xE9marrer \xE0 h1 n'est requis ni par HTML, ni par l'accessibilit\xE9, ni par le SEO.`,
      en: () => `Recommendation: the page starts with no <h1>. An <h1> naming the main content aids orientation, but starting at h1 is not required by HTML, accessibility, or SEO.`
    },
    remediation: {
      fr: () => `Envisagez d'ajouter un <h1> d\xE9crivant le contenu principal ; la hi\xE9rarchie des titres (sans saut de niveau) reste l'exigence normative.`,
      en: () => `Consider adding an <h1> describing the page's main content; a heading hierarchy with no level skip stays the normative requirement.`
    }
  },
  // ADVISORY (non-normative): "a single h1 per page" is not a rule in HTML, accessibility,
  // or SEO. Multiple h1 are valid (HTML5 sectioning) — worded as a recommendation.
  "h1-multiple": {
    message: {
      fr: (p) => `Recommandation : plusieurs <h1> dans la page (${p.count}). Un titre de niveau 1 unique clarifie souvent la structure, mais \xAB un seul <h1> par page \xBB n'est une r\xE8gle ni en HTML, ni en accessibilit\xE9, ni en SEO.`,
      en: (p) => `Recommendation: multiple <h1> in the page (${p.count}). A single level-1 heading often clarifies structure, but "one h1 per page" is not a rule in HTML, accessibility, or SEO.`
    },
    remediation: {
      fr: () => `Envisagez de conserver un unique <h1> et de hi\xE9rarchiser le reste avec h2\u2026h6 ; ce n'est pas une non-conformit\xE9.`,
      en: () => `Consider keeping a single <h1> and structuring the rest with h2\u2026h6; this is not a non-conformity.`
    }
  },
  "list-structure.invalid-child": {
    message: {
      fr: (p) => `<${p.childTag}> enfant direct de <${p.parentTag}> \u2014 une liste ne doit contenir que des <li>.`,
      en: (p) => `<${p.childTag}> is a direct child of <${p.parentTag}> \u2014 a list must only contain <li>.`
    },
    remediation: {
      fr: (p) => `Enveloppez le contenu dans des <li>, ou utilisez un autre \xE9l\xE9ment que <${p.parentTag}>.`,
      en: (p) => `Wrap the content in <li> elements, or use a different element than <${p.parentTag}>.`
    }
  },
  "list-structure.li-outside-list": {
    message: {
      fr: (p) => `<li> hors d'une liste (<${p.parentTag}> parent) \u2014 structure de liste invalide.`,
      en: (p) => `<li> outside a list (<${p.parentTag}> parent) \u2014 invalid list structure.`
    },
    remediation: {
      fr: () => `Placez chaque <li> directement dans un <ul>, <ol> ou <menu>.`,
      en: () => `Place each <li> directly inside a <ul>, <ol> or <menu>.`
    }
  },
  "empty-heading": {
    message: {
      fr: (p) => `Titre <${p.tag}> de niveau ${p.level} vide \u2014 un titre sans intitul\xE9 d\xE9soriente la navigation au clavier/lecteur d'\xE9cran.`,
      en: (p) => `Empty level-${p.level} <${p.tag}> heading \u2014 a heading with no label disorients keyboard/screen-reader navigation.`
    },
    remediation: {
      fr: () => `Donnez un intitul\xE9 textuel au titre, ou retirez-le s'il est purement d\xE9coratif.`,
      en: () => `Give the heading a text label, or remove it if it is purely decorative.`
    }
  },
  // ---- Theme 10 — Presentation / zoom (src/rules/presentation.ts) -------------
  "meta-viewport-zoom-block": {
    message: {
      fr: (p) => `<meta viewport> bloque le zoom (${p.blockedBy === "user-scalable" ? "user-scalable=no" : `maximum-scale=${p.maxScale}`}) \u2014 agrandissement \xE0 200% emp\xEAch\xE9.`,
      en: (p) => `<meta viewport> blocks zoom (${p.blockedBy === "user-scalable" ? "user-scalable=no" : `maximum-scale=${p.maxScale}`}) \u2014 200% zoom is prevented.`
    },
    remediation: {
      fr: () => `Retirez user-scalable=no et maximum-scale (ou maximum-scale \u2265 2) du content du viewport.`,
      en: () => `Remove user-scalable=no and maximum-scale (or set maximum-scale \u2265 2) from the viewport content.`
    }
  },
  "presentational-element": {
    message: {
      fr: (p) => `<${p.tag}> est une balise de pr\xE9sentation \u2014 la mise en forme doit passer par CSS (test RGAA 10.1.1).`,
      en: (p) => `<${p.tag}> is a presentational element \u2014 styling belongs in CSS (RGAA test 10.1.1).`
    },
    remediation: {
      fr: (p) => `Remplacez <${p.tag}> par un \xE9l\xE9ment porteur de sens (ou un <span>/<div> neutre) et d\xE9placez la mise en forme dans la feuille de styles.`,
      en: (p) => `Replace <${p.tag}> with a meaningful element (or a neutral <span>/<div>) and move the styling to the stylesheet.`
    }
  },
  "presentational-attribute": {
    message: {
      fr: (p) => `Attribut de pr\xE9sentation ${p.attr} sur <${p.tag}> \u2014 la mise en forme doit passer par CSS (test RGAA 10.1.2).`,
      en: (p) => `Presentational attribute ${p.attr} on <${p.tag}> \u2014 styling belongs in CSS (RGAA test 10.1.2).`
    },
    remediation: {
      fr: (p) => `Retirez ${p.attr} de <${p.tag}> et exprimez la m\xEAme mise en forme dans la feuille de styles.`,
      en: (p) => `Remove ${p.attr} from <${p.tag}> and express the same styling in the stylesheet.`
    }
  },
  "presentational-spacing": {
    message: {
      fr: (p) => p.how === "spelled-out" ? `Mot dont les lettres sont s\xE9par\xE9es par des espaces \u2014 restitu\xE9 lettre \xE0 lettre par un lecteur d'\xE9cran (test RGAA 10.1.3).` : `Suite d'espaces ins\xE9cables utilis\xE9e comme mise en page (test RGAA 10.1.3).`,
      en: (p) => p.how === "spelled-out" ? `A word whose letters are separated by spaces \u2014 a screen reader reads it out letter by letter (RGAA test 10.1.3).` : `A run of non-breaking spaces used as layout (RGAA test 10.1.3).`
    },
    remediation: {
      fr: (p) => p.how === "spelled-out" ? `\xC9crivez le mot normalement et obtenez l'espacement avec letter-spacing en CSS.` : `Remplacez les espaces ins\xE9cables par une mise en page CSS (grille, colonnes, marges).`,
      en: (p) => p.how === "spelled-out" ? `Write the word normally and get the spacing from CSS letter-spacing.` : `Replace the non-breaking spaces with CSS layout (grid, columns, margins).`
    }
  },
  "css-generated-content-informative": {
    message: {
      fr: (p) => `Contenu g\xE9n\xE9r\xE9 en CSS porteur de texte (content: "${p.text}") : invisible pour les technologies d'assistance.`,
      en: (p) => `CSS generated content carrying text (content: "${p.text}"): invisible to assistive technologies.`
    },
    remediation: {
      fr: () => `D\xE9placez ce texte informatif dans le DOM ; r\xE9servez content aux \xE9l\xE9ments purement d\xE9coratifs.`,
      en: () => `Move this informative text into the DOM; keep content for purely decorative elements.`
    }
  },
  // ---- Theme 11 — Forms (src/rules/forms.ts) ----------------------------------
  "control-label-missing": {
    message: {
      fr: (p) => `Champ de formulaire <${p.tag}> sans \xE9tiquette \u2014 aucun label associ\xE9.`,
      en: (p) => `Form field <${p.tag}> has no label \u2014 no associated label.`
    },
    remediation: {
      fr: () => `Associez un <label for="\u2026"> (ou enveloppez le champ d'un <label>, ou aria-label/aria-labelledby).`,
      en: () => `Associate a <label for="\u2026"> (or wrap the field in a <label>, or use aria-label/aria-labelledby).`
    }
  },
  "placeholder-as-label": {
    message: {
      fr: (p) => `placeholder="${p.value}" utilis\xE9 comme seule \xE9tiquette \u2014 le placeholder n'est pas un label.`,
      en: (p) => `placeholder="${p.value}" used as the only label \u2014 a placeholder is not a label.`
    },
    remediation: {
      fr: () => `Ajoutez un <label> r\xE9el ; le placeholder ne doit que compl\xE9ter, pas remplacer l'\xE9tiquette.`,
      en: () => `Add a real <label>; the placeholder should only supplement, not replace, the label.`
    }
  },
  "fieldset-legend-missing": {
    message: {
      fr: () => `<fieldset> sans <legend> (ou l\xE9gende vide) \u2014 regroupement de champs sans l\xE9gende.`,
      en: () => `<fieldset> has no <legend> (or an empty one) \u2014 a field group with no legend.`
    },
    remediation: {
      fr: () => `Ajoutez un <legend> non vide en premier enfant du <fieldset>.`,
      en: () => `Add a non-empty <legend> as the first child of the <fieldset>.`
    }
  },
  "form-field-multiple-labels": {
    message: {
      fr: (p) => `Champ <${p.tag}> r\xE9f\xE9renc\xE9 par ${p.count} <label for="${p.id}"> \u2014 \xE9tiquettes multiples ambigu\xEBs.`,
      en: (p) => `Field <${p.tag}> referenced by ${p.count} <label for="${p.id}"> \u2014 ambiguous multiple labels.`
    },
    remediation: {
      fr: () => `Un seul <label> doit cibler le champ ; fusionnez ou retirez les \xE9tiquettes superflues.`,
      en: () => `A single <label> should target the field; merge or remove the superfluous labels.`
    }
  },
  "select-has-option": {
    message: {
      fr: () => `<select> sans aucune <option> \u2014 liste de choix vide.`,
      en: () => `<select> has no <option> at all \u2014 empty choice list.`
    },
    remediation: {
      fr: () => `Ajoutez des <option> (et un <optgroup>/option par d\xE9faut si pertinent).`,
      en: () => `Add <option> elements (and an <optgroup>/default option if relevant).`
    }
  },
  "label-for-dangling": {
    message: {
      fr: (p) => `<label for="${p.id}"> ne cible aucun \xE9l\xE9ment \u2014 aucun champ n'a id="${p.id}".`,
      en: (p) => `<label for="${p.id}"> targets no element \u2014 no field has id="${p.id}".`
    },
    remediation: {
      fr: (p) => `Donnez au champ id="${p.id}", corrigez l'attribut for, ou enveloppez le champ dans le <label>.`,
      en: (p) => `Give the field id="${p.id}", fix the for attribute, or wrap the field inside the <label>.`
    }
  },
  "aria-invalid-no-description": {
    message: {
      fr: (p) => `<${p.tag}> a aria-invalid="true" mais aucun aria-describedby/aria-errormessage \u2014 l'erreur est signal\xE9e sans \xEAtre reli\xE9e \xE0 son message.`,
      en: (p) => `<${p.tag}> has aria-invalid="true" but no aria-describedby/aria-errormessage \u2014 the error is signalled without being linked to its message.`
    },
    remediation: {
      fr: () => `Reliez le message d'erreur au champ via aria-describedby (ou aria-errormessage) pointant vers le texte d'erreur.`,
      en: () => `Link the error message to the field via aria-describedby (or aria-errormessage) pointing at the error text.`
    }
  },
  "error-not-associated": {
    message: {
      fr: (p) => `Message d'erreur (id="${p.id}") reli\xE9 \xE0 aucun champ \u2014 aucun aria-describedby/aria-errormessage ne le r\xE9f\xE9rence.`,
      en: (p) => `Error message (id="${p.id}") linked to no field \u2014 no aria-describedby/aria-errormessage references it.`
    },
    remediation: {
      fr: (p) => `Sur le champ concern\xE9, ajoutez aria-describedby="${p.id}" (ou aria-errormessage) et aria-invalid="true" ; restituez l'erreur via role="alert" (pas aria-live="polite"), sans \xE0 la fois d\xE9placer le focus et recourir \xE0 aria-live/role="alert".`,
      en: (p) => `On the relevant field, add aria-describedby="${p.id}" (or aria-errormessage) and aria-invalid="true"; announce the error via role="alert" (not aria-live="polite"), without both moving focus and using a live region.`
    }
  },
  "field-purpose-incomplete.autocomplete": {
    message: {
      fr: (p) => `Champ d'identification (${p.type === "email" || p.type === "tel" ? `type="${p.type}"` : "name/id"}) sans autocomplete \u2014 objet du champ non expos\xE9.`,
      en: (p) => `Identification field (${p.type === "email" || p.type === "tel" ? `type="${p.type}"` : "name/id"}) with no autocomplete \u2014 the field's purpose is not exposed.`
    },
    remediation: {
      // No trailing criterion reference: every rendering already states the criterion this
      // remediation belongs to, and under a country standard the hard-coded « WCAG 1.3.5 »
      // named a referential the rest of the deliverable no longer mentions.
      fr: () => `Ajoutez un autocomplete appropri\xE9 (ex. email, tel, name, postal-code, street-address).`,
      en: () => `Add an appropriate autocomplete (e.g. email, tel, name, postal-code, street-address).`
    }
  },
  "field-purpose-incomplete.aria-required": {
    message: {
      fr: (p) => `Widget personnalis\xE9 (role="${p.role}") requis sans aria-required \u2014 l'\xE9tat requis n'est pas restitu\xE9.`,
      en: (p) => `Custom widget (role="${p.role}") is required but has no aria-required \u2014 the required state is not conveyed.`
    },
    remediation: {
      fr: () => `Ajoutez aria-required="true" sur le widget personnalis\xE9 requis.`,
      en: () => `Add aria-required="true" on the required custom widget.`
    }
  },
  "disabled-context-content.fieldset": {
    message: {
      fr: () => `<fieldset disabled> encapsulant des champs en lecture seule \u2014 le contenu risque d'\xEAtre ignor\xE9 par les technologies d'assistance.`,
      en: () => `<fieldset disabled> wrapping read-only fields \u2014 the content may be ignored by assistive technologies.`
    },
    remediation: {
      fr: () => `Remplacez le conteneur d\xE9sactiv\xE9 par un <div> (ou aria-disabled="true" + gestion clavier en JS) afin que le contenu reste restitu\xE9.`,
      en: () => `Replace the disabled container with a <div> (or aria-disabled="true" + JS keyboard handling) so the content stays exposed.`
    }
  },
  "disabled-context-content.inert": {
    message: {
      fr: () => `Conteneur [inert] encapsulant des champs de formulaire \u2014 leur contenu est retir\xE9 de l'arbre d'accessibilit\xE9.`,
      en: () => `[inert] container wrapping form fields \u2014 their content is taken out of the accessibility tree.`
    },
    remediation: {
      fr: () => `Retirez [inert] du conteneur en lecture seule (ou aria-disabled="true" + JS) pour que le contenu reste restitu\xE9.`,
      en: () => `Take [inert] off the read-only container (or use aria-disabled="true" + JS) so the content stays exposed.`
    }
  },
  "radio-checkbox-group-ungrouped": {
    message: {
      fr: (p) => `${p.count} champs ${p.type} partageant name="${p.name}" hors de tout <fieldset>/role="radiogroup"/role="group" \u2014 regroupement absent.`,
      en: (p) => `${p.count} ${p.type} fields sharing name="${p.name}" outside any <fieldset>/role="radiogroup"/role="group" \u2014 grouping is missing.`
    },
    remediation: {
      fr: () => `Regroupez ces champs de m\xEAme nature dans un <fieldset> avec <legend> (ou un role="radiogroup"/role="group" nomm\xE9).`,
      en: () => `Group these same-nature fields in a <fieldset> with a <legend> (or a named role="radiogroup"/role="group").`
    }
  },
  "date-fields-ungrouped": {
    message: {
      fr: (p) => `${p.count} champs de date adjacents hors de tout <fieldset>/role="group" \u2014 champs de m\xEAme nature non regroup\xE9s.`,
      en: (p) => `${p.count} adjacent date fields outside any <fieldset>/role="group" \u2014 same-nature fields left ungrouped.`
    },
    remediation: {
      fr: () => `Regroupez les champs de date (jour/mois/ann\xE9e, d\xE9but/fin) dans un <fieldset> avec une <legend> d\xE9crivant la p\xE9riode.`,
      en: () => `Group the date fields (day/month/year, start/end) in a <fieldset> with a <legend> describing the period.`
    }
  },
  // ---- Theme 12 — Navigation & landmarks (src/rules/navigation.ts) ------------
  "bypass-blocks-missing": {
    message: {
      fr: () => `La page r\xE9p\xE8te un bloc de navigation avant son contenu sans aucun moyen de le contourner : ni titre hors de la navigation, ni r\xE9gion (main, aside, section\u2026) autour du contenu, ni lien d'\xE9vitement.`,
      en: () => `The page repeats a navigation block before its content with no way to bypass it: no heading outside the navigation, no landmark (main, aside, section\u2026) around the content, and no skip link.`
    },
    remediation: {
      fr: () => `Placez le contenu principal dans <main>, ouvrez-le par un titre, et/ou ajoutez en t\xEAte de page un lien d'\xE9vitement vers lui.`,
      en: () => `Wrap the main content in <main>, start it with a heading, and/or add a skip link to it at the top of the page.`
    }
  },
  "skip-link-target-missing": {
    message: {
      fr: (p) => `Lien interne href="${p.href}" \u2014 la cible #${p.id} n'existe pas dans la page (lien d'\xE9vitement/ancre cass\xE9).`,
      en: (p) => `Internal link href="${p.href}" \u2014 target #${p.id} does not exist in the page (broken skip link/anchor).`
    },
    remediation: {
      fr: (p) => `Ajoutez un \xE9l\xE9ment avec id="${p.id}" (ex. <main id="${p.id}">) ou corrigez l'ancre.`,
      en: (p) => `Add an element with id="${p.id}" (e.g. <main id="${p.id}">) or fix the anchor.`
    }
  },
  "positive-tabindex": {
    message: {
      fr: (p) => `tabindex="${p.value}" positif \u2014 force un ordre de tabulation incoh\xE9rent avec l'ordre du DOM.`,
      en: (p) => `Positive tabindex="${p.value}" \u2014 forces a tab order inconsistent with DOM order.`
    },
    remediation: {
      fr: () => `Utilisez tabindex="0" (ou pas de tabindex) et ordonnez via le DOM ; r\xE9servez les valeurs >0.`,
      en: () => `Use tabindex="0" (or no tabindex) and order via the DOM; reserve values >0.`
    }
  },
  "missing-main-landmark": {
    message: {
      fr: () => `Aucun rep\xE8re <main> dans la page \u2014 le contenu principal n'est pas identifi\xE9 (et la cible d'un lien d'\xE9vitement manque).`,
      en: () => `No <main> landmark in the page \u2014 the main content is not identified (and a skip link's target is missing).`
    },
    remediation: {
      fr: () => `Enveloppez le contenu principal dans un <main id="content"> (unique par page).`,
      en: () => `Wrap the main content in a <main id="content"> (unique per page).`
    }
  },
  "multiple-main-landmark": {
    message: {
      fr: (p) => `Plusieurs rep\xE8res <main> dans la page (${p.count}) \u2014 un seul contenu principal est autoris\xE9.`,
      en: (p) => `Multiple <main> landmarks in the page (${p.count}) \u2014 only one main content area is allowed.`
    },
    remediation: {
      fr: () => `Conservez un unique <main>/role="main" ; structurez le reste avec <section>/<aside>.`,
      en: () => `Keep a single <main>/role="main"; structure the rest with <section>/<aside>.`
    }
  },
  "nav-landmark-missing": {
    message: {
      fr: (p) => `Groupe de ${p.count} liens de navigation dans <${p.region}> sans rep\xE8re de navigation (<nav> ou role="navigation") dans la page.`,
      en: (p) => `A cluster of ${p.count} navigation links in <${p.region}> with no navigation landmark (<nav> or role="navigation") in the page.`
    },
    remediation: {
      fr: () => `Encapsulez les liens de navigation dans un <nav> (ou role="navigation") pour exposer un rep\xE8re de navigation.`,
      en: () => `Wrap the navigation links in a <nav> (or role="navigation") to expose a navigation landmark.`
    }
  },
  "nav-landmark-unnamed": {
    message: {
      fr: () => `Plusieurs rep\xE8res de navigation dans la page ; celui-ci n'a ni aria-label ni aria-labelledby pour le distinguer.`,
      en: () => `Several navigation landmarks in the page; this one has neither aria-label nor aria-labelledby to tell them apart.`
    },
    remediation: {
      fr: () => `Donnez \xE0 chaque <nav> un aria-label (ou aria-labelledby) distinct, ex. \xAB Menu principal \xBB / \xAB Fil d'Ariane \xBB.`,
      en: () => `Give each <nav> a distinct aria-label (or aria-labelledby), e.g. "Primary" / "Breadcrumb".`
    }
  },
  // ---- Theme 4/13 — Multimedia (src/rules/multimedia.ts) ----------------------
  "autoplay-media.muted-video": {
    message: {
      fr: () => `<video autoplay> d\xE9marre automatiquement \u2014 contenu en mouvement non contr\xF4l\xE9.`,
      en: () => `<video autoplay> starts automatically \u2014 uncontrolled moving content.`
    },
    remediation: {
      fr: () => `\xC9vitez l'autoplay ou fournissez un contr\xF4le pause/stop accessible (et controls).`,
      en: () => `Avoid autoplay, or provide an accessible pause/stop control (and controls).`
    }
  },
  "autoplay-media.audible": {
    message: {
      fr: (p) => `<${p.tag} autoplay> d\xE9marre automatiquement ${p.tag === "audio" ? "du son" : "une vid\xE9o sonore"} \u2014 non contr\xF4lable par l'utilisateur.`,
      en: (p) => `<${p.tag} autoplay> automatically starts ${p.tag === "audio" ? "sound" : "a video with sound"} \u2014 not controllable by the user.`
    },
    remediation: {
      fr: () => `Retirez autoplay, ou ajoutez un contr\xF4le de lecture (controls + pause/stop) facilement accessible.`,
      en: () => `Remove autoplay, or add an easily accessible playback control (controls + pause/stop).`
    }
  },
  "media-no-track": {
    message: {
      fr: () => `<video> sans \xE9l\xE9ment <track> \u2014 aucune piste de sous-titres/l\xE9gendes synchronis\xE9es.`,
      en: () => `<video> has no <track> element \u2014 no synchronized captions/subtitles track.`
    },
    remediation: {
      fr: () => `Ajoutez <track kind="captions" src="\u2026" srclang="fr" label="Fran\xE7ais"> (ou subtitles) pour le m\xE9dia synchronis\xE9.`,
      en: () => `Add <track kind="captions" src="\u2026" srclang="en" label="English"> (or subtitles) for the synchronized media.`
    }
  },
  // ---- Theme 13 — Timing & moving content (src/rules/timing.ts) ---------------
  "meta-refresh-redirect": {
    message: {
      fr: (p) => `<meta http-equiv="refresh" content="${p.content}"> impose un d\xE9lai de ${p.seconds}s \u2014 rafra\xEEchissement/redirection temporis\xE9 non contr\xF4lable.`,
      en: (p) => `<meta http-equiv="refresh" content="${p.content}"> imposes a ${p.seconds}s delay \u2014 an uncontrollable timed refresh/redirect.`
    },
    remediation: {
      fr: () => `Supprimez le meta refresh temporis\xE9, ou laissez l'utilisateur contr\xF4ler/d\xE9sactiver/prolonger le d\xE9lai.`,
      en: () => `Remove the timed meta refresh, or let the user control/disable/extend the delay.`
    }
  },
  "blink-marquee": {
    message: {
      fr: (p) => `<${p.tag}> \u2014 contenu en mouvement/clignotant automatique sans m\xE9canisme de pause.`,
      en: (p) => `<${p.tag}> \u2014 automatic moving/blinking content with no pause mechanism.`
    },
    remediation: {
      fr: (p) => `Remplacez <${p.tag}> par du contenu statique, ou fournissez un contr\xF4le pause/stop/masquer.`,
      en: (p) => `Replace <${p.tag}> with static content, or provide a pause/stop/hide control.`
    }
  },
  // ---- Cross-file rules (src/rules/cross-registry.ts) -------------------------
  "cross-icon-only-unnamed": {
    message: {
      fr: (p) => `<${p.tag}> rend un contr\xF4le \xE0 ic\xF4ne seule mais est utilis\xE9 sans nom accessible (aucun aria-label/title/texte pass\xE9).`,
      en: (p) => `<${p.tag}> renders an icon-only control but is used with no accessible name (no aria-label/title/text passed).`
    },
    remediation: {
      fr: (p) => `Passez un nom au composant \xE0 cet endroit, p. ex. <${p.tag} aria-label="\u2026" /> (le composant ${p.defName} rend une ic\xF4ne sans texte).`,
      en: (p) => `Pass a name to the component at this usage, e.g. <${p.tag} aria-label="\u2026" /> (the component ${p.defName} renders an icon with no text).`
    }
  },
  "cross-prop-drilled-name-lost": {
    message: {
      fr: (p) => `<${p.tag} ${p.passed}="\u2026"> mais ${p.defName} ne transmet pas ce nom au contr\xF4le rendu \u2014 le nom accessible est perdu.`,
      en: (p) => `<${p.tag} ${p.passed}="\u2026"> but ${p.defName} does not forward this name to the rendered control \u2014 the accessible name is lost.`
    },
    remediation: {
      fr: (p) => `Dans ${p.defName}, transmettez ${p.passed} (ou {...props}) au <button>/<a> rendu, ou nommez le contr\xF4le directement.`,
      en: (p) => `In ${p.defName}, forward ${p.passed} (or {...props}) to the rendered <button>/<a>, or name the control directly.`
    }
  },
  // ---- Dynamic tier (src/scan.ts mergeDynamic) ---------------------------------
  // `scan --merge` folds axe-core/probe findings into a static AuditResult. Their
  // MESSAGE is either ultra11y's own authored prose (the 320px reflow check) or the
  // rendering engine's own text (axe-core's English violation help, or a probe's own
  // detail string) — never ultra11y prose in the latter case. Only the REMEDIATION
  // is always ultra11y-authored. Both entries below give these findings a `msg.id`
  // (set in mergeDynamic) so a LATER `report`/`prd --lang` re-render can still
  // resolve the OTHER language, instead of staying stuck in whatever language was
  // baked at merge/scan time.
  // `widening` — the selectors of the boxes the probe found wider than the viewport. Absent on a
  // finding recorded before the probe named causes, or by a producer that did not look: the sentence then states
  // the scroll and nothing else, never a cause nobody measured.
  "dyn-reflow": {
    message: {
      fr: (p) => `D\xE9filement horizontal \xE0 320px de large${p.widening ? ` \u2014 la page est \xE9largie par ${String(p.widening)}` : ""}${p.clippedText === void 0 ? "" : p.clippedCapped !== void 0 ? ` ; mesure du contenu hors viewport INCOMPL\xC8TE (arr\xEAt\xE9e apr\xE8s ${String(p.clippedCapped)} n\u0153uds de texte) : au moins ${String(p.clippedText)} bloc(s) de texte et ${String(p.clippedControls)} contr\xF4le(s) ou \xE9l\xE9ment(s) remplac\xE9(s) pos\xE9s au-del\xE0 du viewport` : p.clippedText === "0" && p.clippedControls === "0" ? " ; aucun texte ni contr\xF4le n'est pos\xE9 au-del\xE0 du viewport : seules des bo\xEEtes d\xE9bordent" : ` ; ${String(p.clippedText)} bloc(s) de texte et ${String(p.clippedControls)} contr\xF4le(s) ou \xE9l\xE9ment(s) remplac\xE9(s) pos\xE9s au-del\xE0 du viewport`}.`,
      en: (p) => `Horizontal scrolling at 320px width${p.widening ? ` \u2014 the page is widened by ${String(p.widening)}` : ""}${p.clippedText === void 0 ? "" : p.clippedCapped !== void 0 ? `; the measure of content beyond the viewport is INCOMPLETE (stopped after ${String(p.clippedCapped)} text nodes): at least ${String(p.clippedText)} text block(s) and ${String(p.clippedControls)} control(s) or replaced element(s) lie beyond the viewport` : p.clippedText === "0" && p.clippedControls === "0" ? "; no text or control lies beyond the viewport: only boxes overflow" : `; ${String(p.clippedText)} text block(s) and ${String(p.clippedControls)} control(s) or replaced element(s) lie beyond the viewport`}.`
    },
    remediation: {
      fr: () => `V\xE9rifi\xE9 au rendu par axe-core ; corrigez l'\xE9l\xE9ment cit\xE9.`,
      en: () => `Verified at render time by axe-core; fix the cited element.`
    }
  },
  // ---- Journey observations (`journey run`, src/journey-run.ts) ----
  // Worded once, in the run's language, into the probe hit's `detail` — the same channel the
  // live probes use — so a snapshot re-audited offline carries the sentence the replay wrote.
  "journey-keyboard-unreachable": {
    message: {
      fr: (p) => `${p.control} n'a jamais re\xE7u le focus : ${p.tabs} appui(s) sur Tab ont parcouru tout l'ordre de tabulation sans l'atteindre. L'\xE9tape \xAB ${p.step} \xBB n'est pas r\xE9alisable au clavier seul (elle a \xE9t\xE9 jou\xE9e au pointeur pour poursuivre le parcours).`,
      en: (p) => `${p.control} never received focus: ${p.tabs} Tab press(es) walked the whole tab order without reaching it. The step "${p.step}" cannot be performed with the keyboard alone (it was played with the pointer so the journey could go on).`
    },
    remediation: {
      fr: () => `Utilisez un \xE9l\xE9ment natif (<button>, <a href>) ou donnez au composant tabindex="0", un r\xF4le et la gestion des touches Entr\xE9e et Espace.`,
      en: () => `Use a native element (<button>, <a href>), or give the component tabindex="0", a role and Enter/Space key handling.`
    }
  },
  "journey-keyboard-trap": {
    message: {
      fr: (p) => `Pi\xE8ge clavier : le focus reste sur ${p.region} (${p.count} \xE9l\xE9ment(s)) \u2014 ni Tab ni Maj+Tab ne permettent d'en sortir, alors que la page compte ${p.total} \xE9l\xE9ment(s) focalisable(s).`,
      en: (p) => `Keyboard trap: focus stays within ${p.region} (${p.count} element(s)) \u2014 neither Tab nor Shift+Tab moves it out, while the page has ${p.total} focusable element(s).`
    },
    remediation: {
      fr: () => `Laissez Tab et Maj+Tab sortir du composant, ou annoncez une touche standard (\xC9chap) qui rend le focus \xE0 la page.`,
      en: () => `Let Tab and Shift+Tab leave the component, or announce a standard key (Escape) that hands focus back to the page.`
    }
  },
  "journey-dialog-focus-in": {
    message: {
      fr: (p) => `La bo\xEEte de dialogue ${p.dialog} s'est ouverte, mais le focus est rest\xE9 sur ${p.focus} : il n'a pas \xE9t\xE9 d\xE9plac\xE9 dans la bo\xEEte.`,
      en: (p) => `The dialog ${p.dialog} opened, but focus stayed on ${p.focus}: it was not moved into the dialog.`
    },
    remediation: {
      fr: () => `\xC0 l'ouverture, d\xE9placez le focus sur le premier \xE9l\xE9ment pertinent de la bo\xEEte de dialogue (ou sur la bo\xEEte elle-m\xEAme, tabindex="-1").`,
      en: () => `On opening, move focus to the first relevant element of the dialog (or to the dialog itself, tabindex="-1").`
    }
  },
  "journey-dialog-focus-return": {
    message: {
      fr: (p) => `La bo\xEEte de dialogue ${p.dialog} s'est ferm\xE9e, mais le focus n'est pas revenu sur ${p.trigger} qui l'avait ouverte (il est sur ${p.focus}).`,
      en: (p) => `The dialog ${p.dialog} closed, but focus did not return to ${p.trigger}, which opened it (it is on ${p.focus}).`
    },
    remediation: {
      fr: () => `\xC0 la fermeture, rendez le focus \xE0 l'\xE9l\xE9ment qui a ouvert la bo\xEEte de dialogue.`,
      en: () => `On closing, return focus to the element that opened the dialog.`
    }
  },
  "journey-error-unassociated": {
    message: {
      fr: (p) => `Message d'erreur affich\xE9 apr\xE8s l'action \xAB ${p.step} \xBB (\xAB ${p.text} \xBB) sans lien programmatique avec ${p.field} : ni aria-describedby, ni aria-errormessage, ni <label> ne le relient au champ.`,
      en: (p) => `Error message shown after the action "${p.step}" ("${p.text}") with no programmatic link to ${p.field}: no aria-describedby, aria-errormessage or <label> ties it to the field.`
    },
    remediation: {
      fr: () => `Reliez le message au champ par aria-describedby (ou aria-errormessage avec aria-invalid="true"), ou placez-le dans son <label>.`,
      en: () => `Tie the message to its field with aria-describedby (or aria-errormessage with aria-invalid="true"), or put it inside its <label>.`
    }
  },
  "journey-status-message": {
    message: {
      fr: (p) => `Apr\xE8s l'action \xAB ${p.step} \xBB, le texte \xAB ${p.text} \xBB est apparu hors de tout conteneur aria-live (ou role=status|alert|log) \u2014 probablement non restitu\xE9 aux technologies d'assistance.`,
      en: (p) => `After the action "${p.step}", the text "${p.text}" appeared outside any live region (aria-live / role=status|alert|log) \u2014 likely not announced to assistive technology.`
    },
    remediation: {
      fr: () => `Si ce texte est un message de statut, placez-le dans un conteneur role="status" (ou aria-live="polite") pr\xE9sent avant la mise \xE0 jour.`,
      en: () => `If this text is a status message, render it inside a role="status" (or aria-live="polite") container that exists before the update.`
    }
  },
  "dyn-remediation": {
    // Covers axe-core findings and the residual-criteria probes (focus-visible,
    // text-spacing, hover, reflow-zoom). Their message is authored by the engine
    // itself, not by ultra11y — it passes through UNCHANGED in both languages (never
    // translated; axe-core only ever speaks English), carried verbatim via `params.
    // message`. This is the documented "axe's own English messages stay as-is".
    message: {
      fr: (p) => String(p.message ?? ""),
      en: (p) => String(p.message ?? "")
    },
    remediation: {
      fr: () => `V\xE9rifi\xE9 au rendu par axe-core ; corrigez l'\xE9l\xE9ment cit\xE9.`,
      en: () => `Verified at render time by axe-core; fix the cited element.`
    }
  }
};
function entryFor(id) {
  return id === void 0 ? void 0 : MSG_CATALOG[id];
}
function resolveMessage(f, lang) {
  const localized = f.i18n?.message?.[lang];
  if (localized) return localized;
  const entry = entryFor(f.msg?.id);
  return entry ? entry.message[lang](f.msg?.params ?? {}) : f.message;
}

// src/integrations/payload.ts
var RANK = { bloquant: 0, majeur: 1, mineur: 2 };
var THRESHOLD = { blocking: 0, bloquant: 0, major: 1, majeur: 1, minor: 2, mineur: 2 };
function failingFindings(result, failOn) {
  const max = THRESHOLD[failOn];
  if (max === void 0) throw new Error(`ultra11y: failOn must be blocking|major|minor (got "${failOn}")`);
  return (result.findings ?? []).filter((f) => !f.advisory && (RANK[f.severity] ?? 99) <= max);
}
var FAILURE = {
  fr: {
    head: (n, page) => `ultra11y : ${n} non-conformit\xE9(s) d'accessibilit\xE9 sur \xAB ${page} \xBB :`,
    more: (n) => `  \u2026 et ${n} de plus.`,
    detail: "D\xE9tail complet : .ultra11y/pages/ \u2014 r\xE9-auditez hors ligne avec `ultra11y audit`."
  },
  en: {
    head: (n, page) => `ultra11y: ${n} accessibility non-conformity(ies) on "${page}":`,
    more: (n) => `  \u2026 and ${n} more.`,
    detail: "Full detail: .ultra11y/pages/ \u2014 re-audit offline with `ultra11y audit`."
  }
};
function formatFailure(pageName, failing, lang = "fr", message = (f, l) => f.i18n?.message?.[l] ?? f.message) {
  const t = FAILURE[lang];
  const lines = [t.head(failing.length, pageName)];
  for (const f of failing.slice(0, 20)) {
    lines.push(`  [${f.severity}] ${f.ruleId} (WCAG ${f.criteriaId}) \u2014 ${f.origin?.sourceFile ?? f.file} \u2014 ${message(f, lang)}`);
  }
  if (failing.length > 20) lines.push(t.more(failing.length - 20));
  lines.push(t.detail);
  return lines.join("\n");
}
function checkLang(result, lang) {
  if (lang === "fr" || lang === "en") return lang;
  const top = result.scope?.langs?.[0];
  return top === "en" ? "en" : "fr";
}
function reportOpts(report, lang) {
  const r = typeof report === "object" ? report : {};
  return r.lang || !lang ? r : { ...r, lang };
}

// src/integrations/core.ts
function enginePath() {
  if (process.env.ULTRA11Y) return process.env.ULTRA11Y;
  try {
    return createRequire(import.meta.url).resolve("ultra11y/scripts/ultra11y.mjs");
  } catch {
    return new URL("../scripts/ultra11y.mjs", import.meta.url).pathname;
  }
}
function localizedMessage(f, lang) {
  return resolveMessage(f, lang);
}
function auditSnapshot(payload, engine = enginePath()) {
  const res = spawnSync(process.execPath, [engine, "snapshot", "write", "--json"], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    maxBuffer: 192 * 1024 * 1024
  });
  if (res.error) throw new Error(`ultra11y: could not run the engine at ${engine} \u2014 ${res.error.message}`);
  if (!res.stdout) throw new Error(`ultra11y: the engine produced no output (exit ${res.status})
${res.stderr || ""}`);
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`ultra11y: could not parse the engine output
${res.stdout.slice(0, 500)}`);
  }
}
function writePagesReport(opts = {}, engine = enginePath()) {
  const args = [engine, "pages", "--in", "-", "--format", "report"];
  if (opts.split !== false) args.push("--split", "page");
  args.push("--out", opts.out ?? "audits/pages");
  if (opts.standard) args.push("--standard", opts.standard);
  if (opts.lang) args.push("--lang", opts.lang);
  const audit = spawnSync(process.execPath, [engine, "audit", ".ultra11y/pages", "--json"], { encoding: "utf8", maxBuffer: 192 * 1024 * 1024 });
  if (audit.error || !audit.stdout) return void 0;
  const res = spawnSync(process.execPath, args, { input: audit.stdout, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (res.error || res.status !== 0) return void 0;
  return res.stdout.trim() || void 0;
}

// src/integrations/cypress-plugin.ts
function register(on) {
  const shots = /* @__PURE__ */ new Map();
  on("after:screenshot", (details) => {
    if (details?.name && details.path) shots.set(details.name, details.path);
    return details;
  });
  on("task", {
    ultra11ySnapshot(payload) {
      const withShot = { ...payload };
      const path = payload.screenshotName ? shots.get(payload.screenshotName) : void 0;
      if (path) {
        try {
          withShot.screenshot = readFileSync(path).toString("base64");
        } catch {
        }
      }
      const result = auditSnapshot(withShot);
      if (payload.report) writePagesReport(reportOpts(payload.report, payload.lang));
      const failOn = payload.failOn === void 0 ? "blocking" : payload.failOn;
      const failing = failOn === false ? [] : failingFindings(result, failOn);
      return {
        findings: result.findings ?? [],
        failing,
        message: failing.length ? formatFailure(String(payload.meta.name), failing, checkLang(result, payload.lang), localizedMessage) : ""
      };
    }
  });
}
export {
  register as default
};
