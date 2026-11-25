<!-- GÉNÉRÉ depuis src/data/adjudication.json, src/adjudication-rulings.ts et le pack RGAA par `pnpm run build:adjudication` — ne pas modifier à la main. -->

# Trancher les critères que le moteur vous confie

Le RGAA 4.1.2 compte 106 critères. Chacun de ceux que le moteur ne peut pas trancher seul revient
dans `ADJUDICATE.md` avec son propre brief : ses tests numérotés, la méthodologie de test officielle
du référentiel sous chaque test, les termes du glossaire qu’ils citent, et ses preuves. Ce texte
est la règle : un verdict repose sur lui, et sur rien d’autre.

Cette page rassemble, critère par critère, ce que chaque brief porte à côté : les tests citables,
les notes de décision sur les cas récurrents et — pour les 100 critères rattachés à l’un des
45 critères de succès WCAG que le moteur ne peut pas décider — le protocole de décision de ce
critère de succès (ce qui le rend conforme, quand `NA` est légitime, les questions qui y mènent).
Un protocole est donné en entier sous le premier critère qui en hérite, puis renvoyé.
C’est un complément pour mener l’examen : un critère de succès pose souvent une question plus
large que le critère qui lui est rattaché, et le texte du référentiel prime.

C’est le même jeu de données que `verify --manual` charge dans `ADJUDICATE.md` : la liste de
travail et cette page ne peuvent jamais diverger. Trois règles gouvernent chaque verdict :

- **Une non-conformité doit citer un test normatif qui se résout** — l’un des tests numérotés
  du critère ; `verify --apply` rejette un `normativeRef` qui n’existe pas.
- **Une bonne pratique sans test en échec est une recommandation**, pas une non-conformité — elle
  ne fait jamais basculer un critère et n’entre jamais dans le taux de conformité.
- **Un verdict tranché peut statuer sur chaque page de l’audit** (#197) : une table `pages`
  facultative, indexée par identifiant de page auditée, porte des résultats par page, chacun
  passant le même contrôle fermé par défaut, restreint à cette page — chaque citation et chaque
  constat nomme la capture propre de la page ou une source qu’elle déclare. Un `NC` de page exige
  un `NC` global. Une page non nommée garde le verdict global ; une page dont le sujet est sain
  reçoit son propre `C`, une page dont le sujet échoue son propre `NC`.

## Thématique 1 — Images

### RGAA 1.1 — Chaque image porteuse d’information a-t-elle une alternative textuelle ?

**Tests citables.** `1.1.1`, `1.1.2`, `1.1.3`, `1.1.4`, `1.1.5`, `1.1.6`, `1.1.7`, `1.1.8`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel).**

**Trancher.** Conforme si CHAQUE contenu non textuel porte une alternative qui remplit la même fonction : description du sens pour une image informative, alt="" pour une image décorative, description de l'action pour un contrôle. Non conforme dès qu'une alternative est absente, vide alors que l'image porte du sens, ou hors sujet (nom de fichier, « image », « logo »).

**Non applicable quand.** Aucun contenu non textuel dans le périmètre.

**Se demander.**

- Pour chaque alt : décrit-il ce que l'image APPORTE ici, et non ce qu'elle montre ? Une même photo peut demander deux alternatives différentes selon le contexte.
- Les images purement décoratives ont-elles alt="" (et non un alt absent) ? Une image de décoration nommée pollue autant qu'une image informative muette.
- Pour un graphique ou une infographie : l'alternative donne-t-elle la DONNÉE (ou renvoie-t-elle à un tableau équivalent), ou se contente-t-elle de nommer le graphique ?

### RGAA 1.2 — Chaque image de décoration est-elle correctement ignorée par les technologies d’assistance ?

**Tests citables.** `1.2.1`, `1.2.2`, `1.2.3`, `1.2.4`, `1.2.5`, `1.2.6`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur).**

**Trancher.** Conforme si chaque composant d'interface expose un nom, un rôle et — quand il porte un état — une valeur, tenus à jour. Non conforme pour un widget custom sans rôle, sans nom, ou dont l'état ARIA ne suit pas l'état réel.

**Se demander.**

- Pour chaque widget custom : le rôle correspond-il au comportement réel, et l'état (`aria-expanded`, `aria-checked`, `aria-selected`) suit-il l'interaction ?
- Le nom accessible correspond-il à ce que l'utilisateur voit et dirait ?

### RGAA 1.3 — Pour chaque image porteuse d’information ayant une alternative textuelle, cette alternative est-elle pertinente (hors cas particuliers) ?

**Tests citables.** `1.3.1`, `1.3.2`, `1.3.3`, `1.3.4`, `1.3.5`, `1.3.6`, `1.3.7`, `1.3.8`, `1.3.9`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 1.4 — Pour chaque image utilisée comme CAPTCHA ou comme image-test, ayant une alternative textuelle, cette alternative permet-elle d’identifier la nature et la fonction de l’image ?

**Tests citables.** `1.4.1`, `1.4.2`, `1.4.3`, `1.4.4`, `1.4.5`, `1.4.6`, `1.4.7`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 1.5 — Pour chaque image utilisée comme CAPTCHA, une solution d’accès alternatif au contenu ou à la fonction du CAPTCHA est-elle présente ?

**Tests citables.** `1.5.1`, `1.5.2`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 1.6 — Chaque image porteuse d’information a-t-elle, si nécessaire, une description détaillée ?

**Tests citables.** `1.6.1`, `1.6.2`, `1.6.3`, `1.6.4`, `1.6.5`, `1.6.6`, `1.6.7`, `1.6.8`, `1.6.9`, `1.6.10`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 1.7 — Pour chaque image porteuse d’information ayant une description détaillée, cette description est-elle pertinente ?

**Tests citables.** `1.7.1`, `1.7.2`, `1.7.3`, `1.7.4`, `1.7.5`, `1.7.6`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 1.8 — Chaque image texte porteuse d’information, en l’absence d’un mécanisme de remplacement, doit si possible être remplacée par du texte stylé. Cette règle est-elle respectée (hors cas particuliers) ?

**Tests citables.** `1.8.1`, `1.8.2`, `1.8.3`, `1.8.4`, `1.8.5`, `1.8.6`

**Protocole hérité — critère de succès WCAG 1.4.5 (Texte sous forme d’image).**

**Trancher.** Conforme si le texte est du vrai texte, sauf logotype ou présentation essentielle. Non conforme pour un titre, un bouton ou une citation composés en image.

**Se demander.**

- L'image de texte est-elle un logo (exempté) ou une mise en forme qui pourrait être obtenue en CSS ?

### RGAA 1.9 — Chaque légende d’image est-elle, si nécessaire, correctement reliée à l’image correspondante ?

**Tests citables.** `1.9.1`, `1.9.2`, `1.9.3`, `1.9.4`, `1.9.5`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

## Thématique 2 — Cadres

### RGAA 2.1 — Chaque cadre a-t-il un titre de cadre ?

**Tests citables.** `2.1.1`

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 2.2 — Pour chaque cadre ayant un titre de cadre, ce titre de cadre est-il pertinent ?

**Tests citables.** `2.2.1`

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

## Thématique 3 — Couleurs

### RGAA 3.1 — Dans chaque page web, l’information ne doit pas être donnée uniquement par la couleur. Cette règle est-elle respectée ?

**Tests citables.** `3.1.1`, `3.1.2`, `3.1.3`, `3.1.4`, `3.1.5`, `3.1.6`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations).**

**Trancher.** Conforme si chaque relation et structure perçue visuellement (titres, listes, tableaux, groupes de champs, régions) est déterminable par programme. Non conforme dès qu'une relation n'existe que visuellement — un « titre » en <div> gras, une liste faite de <br>, un couple libellé/valeur en <span>.

**Se demander.**

- Cohérence des techniques (RGAA 9.1) : la MÊME technique de structuration (hn vs caption, balisage ul/ol/dl) est-elle employée sur TOUS les tableaux/pages similaires — pas au cas par cas ?
- Champs présentés en div (RGAA 8.9) : pour chaque paire libellé/valeur affichée avec des <div>/<span>, la relation est-elle autre chose que visuelle (<dl>/<dt>/<dd> ou association ARIA) ?
- Le contenu lu sans CSS garde-t-il le même sens et le même ordre ?

**Protocole hérité — critère de succès WCAG 1.4.1 (Utilisation de la couleur).**

**Trancher.** Conforme si aucune information n'est donnée par la couleur SEULE. Non conforme pour un lien dans un paragraphe distingué par la seule couleur, un statut « rouge/vert » sans texte ni icône, un champ en erreur signalé par une bordure colorée uniquement.

**Se demander.**

- Vu en niveaux de gris, chaque information reste-t-elle distinguable ?

### RGAA 3.2 — Dans chaque page web, le contraste entre la couleur du texte et la couleur de son arrière-plan est-il suffisamment élevé (hors cas particuliers) ?

**Tests citables.** `3.2.1`, `3.2.2`, `3.2.3`, `3.2.4`, `3.2.5`

**Protocole hérité — critère de succès WCAG 1.4.3 (Contraste (minimum)).**

**Trancher.** Décidé sur le rendu (`scan`) : 4,5:1 pour le texte courant, 3:1 pour le texte large (≥ 18,66 px gras ou ≥ 24 px). Le moteur tranche le sous-ensemble des couleurs littérales en style inline ; tout le reste exige les styles calculés.

**Se demander.**

- Les états (survol, focus, désactivé) et le texte sur image/dégradé ont-ils été mesurés, pas seulement l'état au repos ?

### RGAA 3.3 — Dans chaque page web, les couleurs utilisées dans les composants d’interface ou les éléments graphiques porteurs d’informations sont-elles suffisamment contrastées (hors cas particuliers) ?

**Tests citables.** `3.3.1`, `3.3.2`, `3.3.3`, `3.3.4`

**Protocole hérité — critère de succès WCAG 1.4.11 (Contraste du contenu non textuel).**

**Trancher.** Décidé sur le rendu : 3:1 pour les composants d'interface (bordure de champ, contour de bouton, indicateur de focus) et pour les parties signifiantes des graphiques.

**Se demander.**

- La bordure qui identifie un champ, et l'indicateur de focus, atteignent-ils 3:1 contre leur fond ?

## Thématique 4 — Multimédia

### RGAA 4.1 — Chaque média temporel pré-enregistré a-t-il, si nécessaire, une transcription textuelle ou une audiodescription (hors cas particuliers) ?

**Tests citables.** `4.1.1`, `4.1.2`, `4.1.3`

**Protocole hérité — critère de succès WCAG 1.2.1 (Contenus seulement audio et seulement vidéo (pré-enregistrés)).**

**Trancher.** Conforme si chaque média audio-seul dispose d'une transcription textuelle, et chaque média vidéo-seul d'une transcription OU d'une piste audio équivalente. Non conforme si le média porte de l'information disponible nulle part ailleurs.

**Non applicable quand.** Aucun média audio-seul ou vidéo-seul.

**Se demander.**

- La transcription est-elle atteignable depuis la page du média (lien adjacent, panneau dépliant), et non enfouie ailleurs ?
- Couvre-t-elle TOUT le contenu, y compris l'identification des locuteurs et les sons signifiants ?

**Protocole hérité — critère de succès WCAG 1.2.3 (Audio-description ou version de remplacement pour un média temporel (pré-enregistré)).**

**Trancher.** Conforme si chaque vidéo pré-enregistrée sonore offre une audiodescription OU une alternative textuelle complète décrivant l'information visuelle. Non conforme si l'information portée par l'image seule n'est restituée nulle part.

**Non applicable quand.** Aucune vidéo pré-enregistrée sonore.

**Se demander.**

- Quelle information n'existe QUE dans l'image (texte à l'écran, démonstration, graphique) ? Est-elle dite ou décrite ailleurs ?

### RGAA 4.2 — Pour chaque média temporel pré-enregistré ayant une transcription textuelle ou une audiodescription synchronisée, celles-ci sont-elles pertinentes (hors cas particuliers) ?

**Tests citables.** `4.2.1`, `4.2.2`, `4.2.3`

**Protocole hérité — critère de succès WCAG 1.2.1 (Contenus seulement audio et seulement vidéo (pré-enregistrés)) :** voir RGAA 4.1.

**Protocole hérité — critère de succès WCAG 1.2.3 (Audio-description ou version de remplacement pour un média temporel (pré-enregistré)) :** voir RGAA 4.1.

### RGAA 4.3 — Chaque média temporel synchronisé pré-enregistré a-t-il, si nécessaire, des sous-titres synchronisés (hors cas particuliers) ?

**Tests citables.** `4.3.1`, `4.3.2`

**Protocole hérité — critère de succès WCAG 1.2.2 (Sous-titres (pré-enregistrés)).**

**Trancher.** Conforme si toute vidéo pré-enregistrée porteuse de parole dispose de sous-titres synchronisés (piste <track kind="captions">, sous-titres intégrés au conteneur, ou lecteur en fournissant). Non conforme si la parole n'est restituée par aucun sous-titre.

**Non applicable quand.** Aucune vidéo pré-enregistrée porteuse de son signifiant.

**Se demander.**

- L'absence de <track> prouve-t-elle vraiment l'absence de sous-titres ? Vérifiez le conteneur et le lecteur : les sous-titres peuvent être intégrés — c'est pourquoi le moteur ne classe pas ce cas en non-conformité.
- Les sous-titres couvrent-ils aussi les sons non verbaux signifiants (musique, alarme, rire) ?

### RGAA 4.4 — Pour chaque média temporel synchronisé pré-enregistré ayant des sous-titres synchronisés, ces sous-titres sont-ils pertinents ?

**Tests citables.** `4.4.1`

**Protocole hérité — critère de succès WCAG 1.2.2 (Sous-titres (pré-enregistrés)) :** voir RGAA 4.3.

### RGAA 4.5 — Chaque média temporel pré-enregistré a-t-il, si nécessaire, une audiodescription synchronisée (hors cas particuliers) ?

**Tests citables.** `4.5.1`, `4.5.2`

**Protocole hérité — critère de succès WCAG 1.2.5 (Audio-description (pré-enregistrée)).**

**Trancher.** Conforme si chaque vidéo pré-enregistrée sonore dispose d'une audiodescription (piste dédiée ou version audiodécrite). Attention : au niveau AA, l'alternative textuelle seule ne suffit plus, contrairement à 1.2.3.

**Non applicable quand.** Aucune vidéo pré-enregistrée sonore.

**Se demander.**

- Une piste d'audiodescription existe-t-elle réellement, ou seule la transcription de 1.2.3 est-elle fournie ?

### RGAA 4.6 — Pour chaque média temporel pré-enregistré ayant une audiodescription synchronisée, celle-ci est-elle pertinente ?

**Tests citables.** `4.6.1`, `4.6.2`

**Protocole hérité — critère de succès WCAG 1.2.5 (Audio-description (pré-enregistrée)) :** voir RGAA 4.5.

### RGAA 4.7 — Chaque média temporel est-il clairement identifiable (hors cas particuliers) ?

**Tests citables.** `4.7.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 4.8 — Chaque média non temporel a-t-il, si nécessaire, une alternative (hors cas particuliers) ?

**Tests citables.** `4.8.1`, `4.8.2`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 4.9 — Pour chaque média non temporel ayant une alternative, cette alternative est-elle pertinente ?

**Tests citables.** `4.9.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 4.10 — Chaque son déclenché automatiquement est-il contrôlable par l’utilisateur ?

**Tests citables.** `4.10.1`

### RGAA 4.11 — La consultation de chaque média temporel est-elle, si nécessaire, contrôlable par le clavier et tout dispositif de pointage ?

**Tests citables.** `4.11.1`, `4.11.2`, `4.11.3`

**Protocole hérité — critère de succès WCAG 2.1.1 (Clavier).**

**Trancher.** Conforme si toute fonctionnalité est utilisable au clavier seul. Non conforme dès qu'une action n'existe qu'à la souris (handler sur un élément non interactif, glisser-déposer sans équivalent, survol obligatoire).

**Se demander.**

- Chaque `onClick`/`onMouseEnter` sur un élément non natif a-t-il un équivalent clavier (élément natif, ou role + tabindex + gestion Entrée/Espace) ?
- Les widgets composites (menu, onglets, combobox) suivent-ils le contrat clavier attendu (flèches, Échap, Origine/Fin) ?

**Protocole hérité — critère de succès WCAG 2.1.2 (Pas de piège au clavier).**

**Trancher.** Décidé sur le rendu : le focus doit pouvoir ENTRER et SORTIR de chaque composant au clavier seul. Non conforme pour une modale, un lecteur embarqué ou un éditeur qui capture le focus définitivement.

**Se demander.**

- Dans chaque modale et chaque iframe tierce, Tab finit-il par ressortir — et Échap rend-il la main ?

### RGAA 4.12 — La consultation de chaque média non temporel est-elle contrôlable par le clavier et tout dispositif de pointage ?

**Tests citables.** `4.12.1`, `4.12.2`

**Protocole hérité — critère de succès WCAG 2.1.1 (Clavier) :** voir RGAA 4.11.

**Protocole hérité — critère de succès WCAG 2.1.2 (Pas de piège au clavier) :** voir RGAA 4.11.

### RGAA 4.13 — Chaque média temporel et non temporel est-il compatible avec les technologies d’assistance (hors cas particuliers) ?

**Tests citables.** `4.13.1`, `4.13.2`

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

## Thématique 5 — Tableaux

### RGAA 5.1 — Chaque tableau de données complexe a-t-il un résumé ?

**Tests citables.** `5.1.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 5.2 — Pour chaque tableau de données complexe ayant un résumé, celui-ci est-il pertinent ?

**Tests citables.** `5.2.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 5.3 — Pour chaque tableau de mise en forme, le contenu linéarisé reste-t-il compréhensible ?

**Tests citables.** `5.3.1`

**Protocole hérité — critère de succès WCAG 1.3.2 (Ordre séquentiel logique).**

**Trancher.** Conforme si l'ordre de lecture du DOM produit une séquence qui garde le sens. Non conforme quand l'ordre visuel et l'ordre DOM divergent au point de changer le sens (colonnes réordonnées en CSS, `order`/`flex-direction: *-reverse`, positionnement absolu).

**Se demander.**

- En lisant le DOM de haut en bas, la séquence reste-t-elle compréhensible — ou une colonne latérale s'intercale-t-elle au milieu d'un texte ?
- Un `order` CSS ou un `flex-direction` inversé déplace-t-il visuellement des éléments porteurs de sens ?

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 5.4 — Pour chaque tableau de données ayant un titre, le titre est-il correctement associé au tableau de données ?

**Tests citables.** `5.4.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 5.5 — Pour chaque tableau de données ayant un titre, celui-ci est-il pertinent ?

**Tests citables.** `5.5.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 5.6 — Pour chaque tableau de données, chaque en-tête de colonne et chaque en-tête de ligne sont-ils correctement déclarés ?

**Tests citables.** `5.6.1`, `5.6.2`, `5.6.3`, `5.6.4`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 5.7 — Pour chaque tableau de données, la technique appropriée permettant d’associer chaque cellule avec ses en-têtes est-elle utilisée (hors cas particuliers) ?

**Tests citables.** `5.7.1`, `5.7.2`, `5.7.3`, `5.7.4`, `5.7.5`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 5.8 — Chaque tableau de mise en forme ne doit pas utiliser d’éléments propres aux  tableaux de données. Cette règle est-elle respectée ?

**Tests citables.** `5.8.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

## Thématique 6 — Liens

### RGAA 6.1 — Chaque lien est-il explicite (hors cas particuliers) ?

**Tests citables.** `6.1.1`, `6.1.2`, `6.1.3`, `6.1.4`, `6.1.5`

**Notes de décision.**

- Un lien dont l'intitulé ne signifie rien pour PERSONNE — un lien de remplissage (« Inaccessible », « Lien », « XXX ») que ni son intitulé ni son contexte n'expliquent à un lecteur sans limitation fonctionnelle — est le cas « ambigu pour tout le monde » : 6.1.1 à 6.1.4 sont NON APPLICABLES pour ce lien, pas bloquants. Il vaut au plus une recommandation (remplacer ou retirer le lien) ; s'il est cassé, c'est l'affaire d'un autre critère (12.3.2 dans un plan du site, par exemple).
- L'attribut `title` n'est PAS un contexte du lien : le glossaire en énumère six (la phrase, le paragraphe, l'item de liste, le titre précédent, l'en-tête et la cellule de tableau), et `title` n'en fait pas partie. Il n'entre dans l'intitulé que comme dernier recours du nom accessible, quand le lien n'a aucun contenu — un `title` ne rend donc pas explicite un lien dont le contenu est ambigu.

**Fondements.** « Il existe une gestion de cas particuliers pour les tests 6.1.1, 6.1.2, 6.1.3 et 6.1.4 lorsque le lien est ambigu pour tout le monde. Dans cette situation, où il n’est pas possible de rendre le lien explicite dans son contexte, le critère est non applicable. » · « un lecteur sans limitation fonctionnelle ne connaîtrait pas la fonction d’un lien avant de l’activer » · « Note 1 : l’un des 6 contextes de lien combiné à l’ intitulé du lien doit permettre de comprendre la fonction et la destination du lien. » · « sinon, contenu de l’attribut title »

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 2.4.4 (Fonction du lien (selon le contexte)).**

**Trancher.** Conforme si la fonction de chaque lien se comprend depuis son intitulé seul, ou depuis son intitulé + son contexte immédiat (phrase, item de liste, cellule + en-têtes). Non conforme pour « en savoir plus », « cliquez ici », une URL brute, ou deux liens de même intitulé menant ailleurs.

**Se demander.**

- Lu hors contexte, l'intitulé dit-il OÙ le lien mène ou CE QU'il déclenche ?
- Deux liens portant le même intitulé mènent-ils à la même destination ?
- Un lien de téléchargement annonce-t-il le format et le poids (recommandation, non normatif) ?

**Protocole hérité — critère de succès WCAG 2.5.3 (Étiquette dans le nom).**

**Trancher.** Conforme si, pour chaque contrôle portant un libellé textuel visible, ce texte est CONTENU dans le nom accessible. Non conforme quand `aria-label` remplace le texte visible par un autre libellé : la commande vocale ne trouve plus la cible.

**Se demander.**

- Le nom accessible COMMENCE-t-il idéalement par le texte visible, pour que la commande vocale corresponde au premier mot prononcé ?

### RGAA 6.2 — Dans chaque page web, chaque lien a-t-il un intitulé ?

**Tests citables.** `6.2.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 2.4.4 (Fonction du lien (selon le contexte)) :** voir RGAA 6.1.

## Thématique 7 — Scripts

### RGAA 7.1 — Chaque script est-il, si nécessaire, compatible avec les technologies d’assistance ?

**Tests citables.** `7.1.1`, `7.1.2`, `7.1.3`

**Protocole hérité — critère de succès WCAG 2.5.3 (Étiquette dans le nom) :** voir RGAA 6.1.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 7.2 — Pour chaque script ayant une alternative, cette alternative est-elle pertinente ?

**Tests citables.** `7.2.1`, `7.2.2`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 7.3 — Chaque script est-il contrôlable par le clavier et par tout dispositif de pointage (hors cas particuliers) ?

**Tests citables.** `7.3.1`, `7.3.2`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 2.1.1 (Clavier) :** voir RGAA 4.11.

**Protocole hérité — critère de succès WCAG 2.4.7 (Visibilité du focus).**

**Trancher.** Décidé sur le rendu : chaque élément focalisable montre un indicateur de focus visible. Non conforme pour un `outline: none` non remplacé.

**Se demander.**

- L'indicateur est-il visible sur TOUS les fonds (thème sombre, survol, éléments sur image) ?

### RGAA 7.4 — Pour chaque script qui initie un changement de contexte, l’utilisateur est-il averti ou en a-t-il le contrôle ?

**Tests citables.** `7.4.1`

**Protocole hérité — critère de succès WCAG 3.2.1 (Au focus).**

**Trancher.** Conforme si recevoir le focus ne déclenche AUCUN changement de contexte. Non conforme si le focus ouvre une fenêtre, soumet un formulaire ou déplace le focus ailleurs.

**Se demander.**

- Des handlers `onFocus` naviguent-ils, ouvrent-ils une modale ou déplacent-ils le focus ?

**Protocole hérité — critère de succès WCAG 3.2.2 (À la saisie).**

**Trancher.** Conforme si modifier la valeur d'un contrôle ne déclenche pas seul un changement de contexte, ou si l'utilisateur en a été averti avant. Non conforme pour un `<select>` qui navigue au changement.

**Se demander.**

- Le changement est-il annoncé AVANT (texte d'aide au-dessus du champ), ou l'utilisateur le découvre-t-il après coup ?

### RGAA 7.5 — Dans chaque page web, les messages de statut sont-ils correctement restitués par les technologies d’assistance ?

**Tests citables.** `7.5.1`, `7.5.2`, `7.5.3`

**Protocole hérité — critère de succès WCAG 4.1.3 (Messages d’état).**

**Trancher.** Conforme si chaque message de statut (succès, erreur, résultat de recherche, chargement) est exposé par un rôle ou une propriété permettant l'annonce SANS recevoir le focus. Non conforme pour un message inséré dans un conteneur ordinaire.

**Non applicable quand.** Aucun message de statut.

**Se demander.**

- La région live existe-t-elle DANS LE DOM avant l'insertion du message (une région créée en même temps que son contenu n'est pas annoncée) ?
- La politesse est-elle adaptée : `polite` pour un statut, `alert`/`assertive` pour une erreur bloquante ?

## Thématique 8 — Éléments obligatoires

### RGAA 8.1 — Chaque page web est-elle définie par un type de document ?

**Tests citables.** `8.1.1`, `8.1.2`, `8.1.3`

### RGAA 8.2 — Pour chaque page web, le code source généré est-il valide selon le type de document spécifié ?

**Tests citables.** `8.2.1`

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 8.3 — Dans chaque page web, la langue par défaut est-elle présente ?

**Tests citables.** `8.3.1`

### RGAA 8.4 — Pour chaque page web ayant une langue par défaut, le code de langue est-il pertinent ?

**Tests citables.** `8.4.1`

### RGAA 8.5 — Chaque page web a-t-elle un titre de page ?

**Tests citables.** `8.5.1`

### RGAA 8.6 — Pour chaque page web ayant un titre de page, ce titre est-il pertinent ?

**Tests citables.** `8.6.1`

### RGAA 8.7 — Dans chaque page web, chaque changement de langue est-il indiqué dans le code source (hors cas particuliers) ?

**Tests citables.** `8.7.1`

**Notes de décision.**

- Les « passages candidats » de la moisson sont des PISTES, jamais des NC : un nom propre, un mot d'origine étrangère présent dans le dictionnaire de la langue de la page, ou un mot passé dans l'usage courant dont la prononciation ne gêne pas la compréhension sont exemptés. Une NC 8.7.1 exige un passage réellement en langue étrangère, sans `lang` sur lui ni sur un parent, dont la restitution vocale serait incompréhensible (« deep linking » lu à la française, une phrase entière en anglais).

**Fondements.** « Des mots d’origine étrangère et d’usage courant dont la prononciation ne provoque pas d’incompréhension. » · « le critère est applicable, uniquement lorsque l’absence d’indication de langue peut provoquer une incompréhension pour la restitution. »

**Protocole hérité — critère de succès WCAG 3.1.2 (Langue d’un passage).**

**Trancher.** Conforme si chaque passage dans une langue différente de celle de la page porte un `lang` correct. Exemptions : noms propres, termes techniques, mots passés dans l'usage.

**Non applicable quand.** Aucun changement de langue.

**Se demander.**

- Les citations, titres d'œuvres et expressions étrangères sont-ils marqués — et le sous-tag correspond-il vraiment à la langue du texte ?

### RGAA 8.8 — Dans chaque page web, le code de langue de chaque changement de langue est-il valide et pertinent ?

**Tests citables.** `8.8.1`

**Protocole hérité — critère de succès WCAG 3.1.2 (Langue d’un passage) :** voir RGAA 8.7.

### RGAA 8.9 — Dans chaque page web, les balises ne doivent pas être utilisées uniquement à des fins de présentation. Cette règle est-elle respectée ?

**Tests citables.** `8.9.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 8.10 — Dans chaque page web, les changements du sens de lecture sont-ils signalés ?

**Tests citables.** `8.10.1`, `8.10.2`

**Protocole hérité — critère de succès WCAG 1.3.2 (Ordre séquentiel logique) :** voir RGAA 5.3.

## Thématique 9 — Structuration de l’information

### RGAA 9.1 — Dans chaque page web, l’information est-elle structurée par l’utilisation appropriée de titres ?

**Tests citables.** `9.1.1`, `9.1.2`, `9.1.3`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 2.4.1 (Contourner des blocs).**

**Trancher.** Conforme si un mécanisme permet d'éviter les blocs répétés : lien d'évitement fonctionnel, ou structuration en régions (landmarks) et en titres. Non conforme si l'utilisateur doit traverser la navigation à chaque page.

**Se demander.**

- Le lien d'évitement est-il le PREMIER élément focalisable, visible au focus, et sa cible reçoit-elle réellement le focus ?

**Protocole hérité — critère de succès WCAG 2.4.6 (En-têtes et étiquettes).**

**Trancher.** Conforme si chaque titre décrit la section qu'il introduit et chaque libellé décrit ce que le champ attend. Non conforme pour un titre générique (« Section 2 »), un libellé vague (« Valeur »), ou un intitulé qui ne correspond pas au contenu.

**Se demander.**

- La suite des titres, lue seule, donne-t-elle un plan compréhensible de la page ?
- Concision des titres de tableaux (RGAA 5.5) : chaque <caption> est-il un intitulé COURT et pertinent ? Un titre clair mais verbeux doit devenir une brève introduction, les détails étant déportés dans un texte associé via aria-labelledby/aria-describedby.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 9.2 — Dans chaque page web, la structure du document est-elle cohérente (hors cas particuliers) ?

**Tests citables.** `9.2.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 9.3 — Dans chaque page web, chaque liste est-elle correctement structurée ?

**Tests citables.** `9.3.1`, `9.3.2`, `9.3.3`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 9.4 — Dans chaque page web, chaque citation est-elle correctement indiquée ?

**Tests citables.** `9.4.1`, `9.4.2`

**Notes de décision.**

- Une citation, ce sont les mots d'un TIERS, présentés comme reproduits à l'identique, dans le contenu courant de la page. Le glossaire du référentiel ne définit pas « citation » : le mot garde ce sens ordinaire. N'en sont PAS : la définition d'un terme dans une infobulle de glossaire, la paraphrase ou le résumé d'un texte de loi, un titre de page ou de section, une étiquette, un nom de clé ou de champ, un slogan entre guillemets. Au plus une recommandation, jamais une NC.
- Une citation EN LIGNE (dans une phrase) ne peut échouer qu'à 9.4.1 (`<q>`). 9.4.2 porte sur un BLOC de citation : ne le citez jamais pour un texte pris dans un paragraphe.
- Ne proposez jamais `<blockquote>` là où seul du contenu phrasé est permis (dans un `<span>`, un `<a>`, un `<label>`, un titre ou un `<p>`) : HTML l'y interdit, et la correction serait elle-même une erreur de balisage. Une citation en ligne se corrige par `<q>`.

**Fondements.** « Retrouver dans le document les citations courtes (ou en ligne) ; » · « Dans chaque page web, chaque citation courte utilise-t-elle une balise `<q>` ? » · « Dans chaque page web, chaque bloc de citation utilise-t-il une balise `<blockquote>` ? »

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

## Thématique 10 — Présentation de l’information

### RGAA 10.1 — Dans le site web, des feuilles de styles sont-elles utilisées pour contrôler la présentation de l’information ?

**Tests citables.** `10.1.1`, `10.1.2`, `10.1.3`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 1.3.2 (Ordre séquentiel logique) :** voir RGAA 5.3.

### RGAA 10.2 — Dans chaque page web, le contenu visible porteur d’information reste-t-il présent lorsque les feuilles de styles sont désactivées ?

**Tests citables.** `10.2.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 10.3 — Dans chaque page web, l’information reste-t-elle compréhensible lorsque les feuilles de styles sont désactivées ?

**Tests citables.** `10.3.1`

**Protocole hérité — critère de succès WCAG 1.3.2 (Ordre séquentiel logique) :** voir RGAA 5.3.

**Protocole hérité — critère de succès WCAG 2.4.3 (Parcours du focus).**

**Trancher.** Conforme si l'ordre de tabulation préserve le sens et l'opérabilité. Non conforme quand le focus saute de façon incohérente, entre dans un contenu masqué, ou ne suit pas l'ordre visuel là où celui-ci porte le sens.

**Se demander.**

- SPA (RGAA 12.8) : après une navigation partielle, le focus est-il déplacé vers le nouveau contenu (et non laissé sur le lien cliqué ni renvoyé en haut) ?
- À l'ouverture d'une modale, le focus entre-t-il dedans ; à la fermeture, revient-il sur le déclencheur ?

### RGAA 10.4 — Dans chaque page web, le texte reste-t-il lisible lorsque la taille des caractères est augmentée jusqu’à 200 %, au moins (hors cas particuliers) ?

**Tests citables.** `10.4.1`, `10.4.2`

**Protocole hérité — critère de succès WCAG 1.4.4 (Redimensionnement du texte).**

**Trancher.** Décidé sur le rendu : à 200 % de zoom texte, aucun contenu ni fonctionnalité n'est perdu, tronqué ou superposé. Non conforme si un `meta viewport` bloque le zoom.

**Se demander.**

- À 200 %, des textes se chevauchent-ils, ou des boutons sortent-ils de leur conteneur ?

### RGAA 10.5 — Dans chaque page web, les déclarations CSS de couleurs de fond d’élément et de police sont-elles correctement utilisées ?

**Tests citables.** `10.5.1`, `10.5.2`, `10.5.3`

**Protocole hérité — critère de succès WCAG 1.4.3 (Contraste (minimum)) :** voir RGAA 3.2.

### RGAA 10.6 — Dans chaque page web, chaque lien dont la nature n’est pas évidente est-il visible par rapport au texte environnant ?

**Tests citables.** `10.6.1`

**Protocole hérité — critère de succès WCAG 1.4.1 (Utilisation de la couleur) :** voir RGAA 3.1.

### RGAA 10.7 — Dans chaque page web, pour chaque élément recevant le focus, la prise de focus est-elle visible ?

**Tests citables.** `10.7.1`

**Protocole hérité — critère de succès WCAG 1.4.1 (Utilisation de la couleur) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 2.4.7 (Visibilité du focus) :** voir RGAA 7.3.

### RGAA 10.8 — Pour chaque page web, les contenus cachés ont-ils vocation à être ignorés par les technologies d’assistance ?

**Tests citables.** `10.8.1`

**Protocole hérité — critère de succès WCAG 1.3.2 (Ordre séquentiel logique) :** voir RGAA 5.3.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 10.9 — Dans chaque page web, l’information ne doit pas être donnée uniquement par la forme, taille ou position. Cette règle est-elle respectée ?

**Tests citables.** `10.9.1`, `10.9.2`, `10.9.3`, `10.9.4`

**Protocole hérité — critère de succès WCAG 1.3.3 (Caractéristiques sensorielles).**

**Trancher.** Conforme si aucune instruction ne repose UNIQUEMENT sur une caractéristique sensorielle (forme, couleur, taille, position, son). Non conforme pour « cliquez sur le bouton vert », « voir l'encadré à droite », « le champ ci-dessous » sans autre repère.

**Se demander.**

- Chaque instruction nomme-t-elle aussi la cible (libellé, intitulé) en plus de sa position ou de sa couleur ?

**Protocole hérité — critère de succès WCAG 1.4.1 (Utilisation de la couleur) :** voir RGAA 3.1.

### RGAA 10.10 — Dans chaque page web, l’information ne doit pas être donnée par la forme, taille ou position uniquement. Cette règle est-elle implémentée de façon pertinente ?

**Tests citables.** `10.10.1`, `10.10.2`, `10.10.3`, `10.10.4`

**Notes de décision.**

- 10.10 n'échoue que si l'information est donnée UNIQUEMENT par la forme, la taille ou la position. Une référence qui NOMME sa cible (« le bouton Outils d'accessibilité », « voir la rubrique Contact ») est précisément le moyen alternatif : elle est conforme, même quand le nom employé est périmé (un bouton renommé depuis). Un nom périmé relève de l'exactitude du contenu : une recommandation, pas une NC 10.10.
- Une NC 10.10 se cite sur une consigne qui ne renvoie qu'à une forme, une taille ou une position (« cliquez sur le bouton de droite », « l'onglet actif est celui en avant-plan ») sans aucun autre moyen de retrouver l'information.

**Fondements.** « vérifier que le moyen alternatif de récupérer cette information est pertinent, c’est-à-dire qu’il permet de transmettre l’information dans tous les contextes de consultation et pour tous les utilisateurs. » · « l’information ne doit pas être donnée uniquement [par la forme, taille ou position] »

**Protocole hérité — critère de succès WCAG 1.3.3 (Caractéristiques sensorielles) :** voir RGAA 10.9.

**Protocole hérité — critère de succès WCAG 1.4.1 (Utilisation de la couleur) :** voir RGAA 3.1.

### RGAA 10.11 — Pour chaque page web, les contenus peuvent-ils être présentés sans perte d’information ou de fonctionnalité et sans avoir recours soit à un défilement vertical pour une fenêtre ayant une hauteur de 256 px, soit à un défilement horizontal pour une fenêtre ayant une largeur de 320 px (hors cas particuliers) ?

**Tests citables.** `10.11.1`, `10.11.2`

**Notes de décision.**

- Une NC exige qu'à 320 px une INFORMATION ou une FONCTIONNALITÉ ne soit plus disponible sans défilement horizontal : un texte coupé, un contrôle rogné ou hors d'atteinte. Le petit débordement d'une image décorative, ou d'une boîte seule (fond, bordure) alors que tout son texte et ses contrôles restent disponibles, est une recommandation. Images, graphiques, vidéos, tableaux de données et interfaces à ascenseur horizontal sont des exceptions du critère.
- Convention de ce rapport (pas une règle du référentiel) : un composant partagé (en-tête, pied de page, navigation rendus sur chaque page) fait UN constat, ancré sur le composant ou sur la première page où il est observé — pas un par page. Nommez les autres pages dans le message.

**Fondements.** « l’ensemble des informations et des fonctionnalités sont-elles disponibles sans aucun défilement horizontal (hors cas particuliers) ? » · « sans perte d’information ou de fonctionnalité » · « - Les images, les graphiques ou les vidéos ; »

**Protocole hérité — critère de succès WCAG 1.4.10 (Redistribution).**

**Trancher.** Décidé sur le rendu : à 320 px de large (équivalent 400 % sur 1280 px), aucun défilement bidirectionnel n'est requis, sauf pour un contenu qui l'exige par nature (carte, tableau de données larges).

**Se demander.**

- Le défilement horizontal restant concerne-t-il un contenu réellement exempté, ou toute la page ?
- Une information ou une fonctionnalité est-elle réellement perdue (texte coupé, contrôle rogné ou hors d'atteinte) ? Le petit débordement d'une image décorative, ou d'une boîte seule dont le texte et les contrôles restent disponibles, est une recommandation, pas une non-conformité — et un composant partagé (en-tête, pied de page) fait un seul constat, pas un par page.

### RGAA 10.12 — Dans chaque page web, les propriétés d’espacement du texte peuvent-elles être redéfinies par l’utilisateur sans perte de contenu ou de fonctionnalité (hors cas particuliers) ?

**Tests citables.** `10.12.1`

**Protocole hérité — critère de succès WCAG 1.4.12 (Espacement du texte).**

**Trancher.** Décidé sur le rendu : en forçant hauteur de ligne 1,5×, espacement de paragraphe 2×, lettres 0,12× et mots 0,16×, aucun contenu n'est perdu ni tronqué.

**Se demander.**

- Des conteneurs à hauteur fixe coupent-ils le texte une fois l'espacement augmenté ?

### RGAA 10.13 — Dans chaque page web, les contenus additionnels apparaissant à la prise de focus ou au survol d’un composant d’interface sont-ils contrôlables par l’utilisateur (hors cas particuliers) ?

**Tests citables.** `10.13.1`, `10.13.2`, `10.13.3`

**Protocole hérité — critère de succès WCAG 1.4.13 (Contenu au survol ou au focus).**

**Trancher.** Décidé sur le rendu : tout contenu additionnel apparu au survol ou au focus doit être masquable (Échap), survolable (le pointeur peut l'atteindre) et persistant (il ne disparaît pas tout seul).

**Se demander.**

- L'infobulle survit-elle au déplacement du pointeur vers elle, et Échap la ferme-t-il sans déplacer le focus ?

### RGAA 10.14 — Dans chaque page web, les contenus additionnels apparaissant via les styles CSS uniquement peuvent-ils être rendus visibles au clavier et par tout dispositif de pointage ?

**Tests citables.** `10.14.1`, `10.14.2`

**Protocole hérité — critère de succès WCAG 2.1.1 (Clavier) :** voir RGAA 4.11.

## Thématique 11 — Formulaires

### RGAA 11.1 — Chaque champ de formulaire a-t-il une étiquette ?

**Tests citables.** `11.1.1`, `11.1.2`, `11.1.3`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 2.4.6 (En-têtes et étiquettes) :** voir RGAA 9.1.

**Protocole hérité — critère de succès WCAG 3.3.2 (Étiquettes ou instructions).**

**Trancher.** Conforme si chaque champ porte un libellé ou une instruction quand une saisie est attendue. Non conforme si le format attendu (date, mot de passe, téléphone) n'est indiqué nulle part avant l'erreur.

**Se demander.**

- Le format et les contraintes sont-ils annoncés AVANT la saisie, et non seulement dans le message d'erreur ?

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 11.2 — Chaque étiquette associée à un champ de formulaire est-elle pertinente (hors cas particuliers) ?

**Tests citables.** `11.2.1`, `11.2.2`, `11.2.3`, `11.2.4`, `11.2.5`, `11.2.6`

**Protocole hérité — critère de succès WCAG 2.4.6 (En-têtes et étiquettes) :** voir RGAA 9.1.

**Protocole hérité — critère de succès WCAG 2.5.3 (Étiquette dans le nom) :** voir RGAA 6.1.

**Protocole hérité — critère de succès WCAG 3.3.2 (Étiquettes ou instructions) :** voir RGAA 11.1.

### RGAA 11.3 — Dans chaque formulaire, chaque étiquette associée à un champ de formulaire ayant la même fonction et répétée plusieurs fois dans une même page ou dans un ensemble de pages est-elle cohérente ?

**Tests citables.** `11.3.1`, `11.3.2`

**Protocole hérité — critère de succès WCAG 3.2.4 (Identification cohérente).**

**Trancher.** Conforme si les composants de même fonction sont identifiés de la même manière partout (même intitulé, même icône, même nom accessible). Non conforme si « Rechercher » devient « Trouver » selon les pages.

**Se demander.**

- Les icônes récurrentes (imprimer, partager, télécharger) portent-elles partout le même nom accessible ?

### RGAA 11.4 — Dans chaque formulaire, chaque étiquette de champ et son champ associé sont-ils accolés (hors cas particuliers) ?

**Tests citables.** `11.4.1`, `11.4.2`, `11.4.3`

**Protocole hérité — critère de succès WCAG 3.3.2 (Étiquettes ou instructions) :** voir RGAA 11.1.

### RGAA 11.5 — Dans chaque formulaire, les champs de même nature sont-ils regroupés, si nécessaire ?

**Tests citables.** `11.5.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 3.3.2 (Étiquettes ou instructions) :** voir RGAA 11.1.

### RGAA 11.6 — Dans chaque formulaire, chaque regroupement de champs de même nature a-t-il une légende ?

**Tests citables.** `11.6.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 3.3.2 (Étiquettes ou instructions) :** voir RGAA 11.1.

### RGAA 11.7 — Dans chaque formulaire, chaque légende associée à un regroupement de champs de même nature est-elle pertinente ?

**Tests citables.** `11.7.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 3.3.2 (Étiquettes ou instructions) :** voir RGAA 11.1.

### RGAA 11.8 — Dans chaque formulaire, les items de même nature d’une liste de choix sont-ils regroupés de manière pertinente ?

**Tests citables.** `11.8.1`, `11.8.2`, `11.8.3`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

### RGAA 11.9 — Dans chaque formulaire, l’intitulé de chaque bouton est-il pertinent (hors cas particuliers) ?

**Tests citables.** `11.9.1`, `11.9.2`

**Protocole hérité — critère de succès WCAG 2.5.3 (Étiquette dans le nom) :** voir RGAA 6.1.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 11.10 — Dans chaque formulaire, le contrôle de saisie est-il utilisé de manière pertinente (hors cas particuliers) ?

**Tests citables.** `11.10.1`, `11.10.2`, `11.10.3`, `11.10.4`, `11.10.5`, `11.10.6`, `11.10.7`

**Protocole hérité — critère de succès WCAG 3.3.1 (Identification des erreurs).**

**Trancher.** Conforme si chaque erreur de saisie détectée automatiquement est identifiée EN TEXTE et le champ fautif désigné. Non conforme pour une bordure rouge seule, ou un message non relié au champ.

**Non applicable quand.** Aucune détection d'erreur de saisie.

**Se demander.**

- Le message d'erreur est-il relié au champ (`aria-describedby`/`aria-errormessage`) et annoncé au moment où il apparaît ?

**Protocole hérité — critère de succès WCAG 3.3.2 (Étiquettes ou instructions) :** voir RGAA 11.1.

### RGAA 11.11 — Dans chaque formulaire, le contrôle de saisie est-il accompagné, si nécessaire, de suggestions facilitant la correction des erreurs de saisie ?

**Tests citables.** `11.11.1`, `11.11.2`

**Protocole hérité — critère de succès WCAG 3.3.3 (Suggestion après une erreur).**

**Trancher.** Conforme si, quand la correction est connue, une suggestion est proposée. Non conforme pour un « champ invalide » qui ne dit pas ce qui est attendu, sauf si le suggérer compromettrait la sécurité.

**Non applicable quand.** Aucune erreur de saisie détectée automatiquement.

**Se demander.**

- Le message dit-il COMMENT corriger (« la date doit être au format JJ/MM/AAAA »), ou seulement que c'est faux ?

### RGAA 11.12 — Pour chaque formulaire qui modifie ou supprime des données, ou qui transmet des réponses à un test ou à un examen, ou dont la validation a des conséquences financières ou juridiques, les données saisies peuvent-elles être modifiées, mises à jour ou récupérées par l’utilisateur ?

**Tests citables.** `11.12.1`, `11.12.2`

**Protocole hérité — critère de succès WCAG 3.3.4 (Prévention des erreurs (juridiques, financières, de données)).**

**Trancher.** Conforme si les envois à portée juridique, financière ou modifiant des données sont réversibles, vérifiés, ou confirmés. Non conforme pour une suppression ou une commande définitive en un clic.

**Non applicable quand.** Aucune transaction à portée juridique, financière ou modifiant des données.

**Se demander.**

- L'utilisateur peut-il relire et corriger avant validation définitive ?

### RGAA 11.13 — La finalité d’un champ de saisie peut-elle être déduite pour faciliter le remplissage automatique des champs avec les données de l’utilisateur ?

**Tests citables.** `11.13.1`

**Protocole hérité — critère de succès WCAG 1.3.5 (Identifier la finalité de la saisie).**

**Trancher.** Conforme si chaque champ collectant une information SUR L'UTILISATEUR déclare sa finalité avec un token `autocomplete` de la liste WCAG. Non conforme si le token manque ou n'appartient pas au vocabulaire.

**Non applicable quand.** Aucun champ ne collecte d'information sur l'utilisateur.

**Se demander.**

- Le champ collecte-t-il une donnée de l'UTILISATEUR (nom, e-mail, adresse, téléphone) — et non une donnée métier (n° de commande, mot-clé de recherche) ?

## Thématique 12 — Navigation

### RGAA 12.1 — Chaque ensemble de pages dispose-t-il de deux systèmes de navigation différents, au moins (hors cas particuliers) ?

**Tests citables.** `12.1.1`

**Protocole hérité — critère de succès WCAG 2.4.5 (Accès multiples).**

**Trancher.** Conforme si au moins DEUX moyens permettent d'atteindre chaque page : moteur de recherche, plan du site, navigation principale, fil d'Ariane, index. Exemption : une page qui est une étape d'un processus.

**Se demander.**

- Les deux moyens existent-ils sur l'ENSEMBLE du site, ou seulement sur l'accueil ?

### RGAA 12.2 — Dans chaque ensemble de pages, le menu et les barres de navigation sont-ils toujours à la même place (hors cas particuliers) ?

**Tests citables.** `12.2.1`

**Protocole hérité — critère de succès WCAG 3.2.3 (Navigation cohérente).**

**Trancher.** Conforme si les mécanismes de navigation répétés apparaissent dans le MÊME ordre relatif d'une page à l'autre. Non conforme si l'ordre des entrées du menu change selon les pages.

**Se demander.**

- Sur l'échantillon de pages, la navigation principale, le fil d'Ariane et le pied de page gardent-ils le même ordre ?

### RGAA 12.3 — La page « plan du site » est-elle pertinente ?

**Tests citables.** `12.3.1`, `12.3.2`, `12.3.3`

**Notes de décision.**

- Des entrées de remplissage dans un plan du site (un intitulé qui ne nomme aucune page, un `href="#"`) valent AU PLUS une NC mineure sur 12.3.3 — un lien qui ne conduit pas à la page indiquée par son intitulé —, citée une fois sur ces entrées, ou une recommandation. Et seulement APRÈS avoir vérifié où mènent les liens : un lien en erreur relève de 12.3.2, et un plan qui omet des pages reste conforme à 12.3.1 si elles sont atteignables autrement.
- Ce sont les mêmes liens que ceux que 6.1 juge « ambigus pour tout le monde » : ne les facturez pas une seconde fois avec une autre gravité.

**Fondements.** « Les liens du plan du site renvoient-ils bien vers les pages indiquées par l’intitulé ? » · « vérifier qu’ils sont à jour (ni obsolètes ni en erreur) et conduisent à la page indiquée par leur intitulé » · « Il n'est pas obligatoire que toutes les pages soient présentes dans le plan du site si elles peuvent être atteintes, par exemple, à partir de la page d'accueil d'une rubrique ou d'un catalogue. »

**Protocole hérité — critère de succès WCAG 2.4.5 (Accès multiples) :** voir RGAA 12.1.

### RGAA 12.4 — Dans chaque ensemble de pages, la page « plan du site » est-elle accessible à partir d’une fonctionnalité identique ?

**Tests citables.** `12.4.1`, `12.4.2`, `12.4.3`

**Protocole hérité — critère de succès WCAG 2.4.5 (Accès multiples) :** voir RGAA 12.1.

**Protocole hérité — critère de succès WCAG 3.2.3 (Navigation cohérente) :** voir RGAA 12.2.

### RGAA 12.5 — Dans chaque ensemble de pages, le moteur de recherche est-il atteignable de manière identique ?

**Tests citables.** `12.5.1`, `12.5.2`, `12.5.3`

**Protocole hérité — critère de succès WCAG 3.2.3 (Navigation cohérente) :** voir RGAA 12.2.

### RGAA 12.6 — Les zones de regroupement de contenus présentes dans plusieurs pages web (zones d’en-tête, de navigation principale, de contenu principal, de pied de page et de moteur de recherche) peuvent-elles être atteintes ou évitées ?

**Tests citables.** `12.6.1`

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 2.4.1 (Contourner des blocs) :** voir RGAA 9.1.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 12.7 — Dans chaque page web, un lien d’évitement ou d’accès rapide à la zone de contenu principal est-il présent (hors cas particuliers) ?

**Tests citables.** `12.7.1`, `12.7.2`

**Protocole hérité — critère de succès WCAG 2.4.1 (Contourner des blocs) :** voir RGAA 9.1.

**Protocole hérité — critère de succès WCAG 2.4.3 (Parcours du focus) :** voir RGAA 10.3.

**Protocole hérité — critère de succès WCAG 3.2.3 (Navigation cohérente) :** voir RGAA 12.2.

### RGAA 12.8 — Dans chaque page web, l’ordre de tabulation est-il cohérent ?

**Tests citables.** `12.8.1`, `12.8.2`

**Protocole hérité — critère de succès WCAG 2.4.3 (Parcours du focus) :** voir RGAA 10.3.

### RGAA 12.9 — Dans chaque page web, la navigation ne doit pas contenir de piège au clavier. Cette règle est-elle respectée ?

**Tests citables.** `12.9.1`

**Protocole hérité — critère de succès WCAG 2.1.1 (Clavier) :** voir RGAA 4.11.

**Protocole hérité — critère de succès WCAG 2.1.2 (Pas de piège au clavier) :** voir RGAA 4.11.

### RGAA 12.10 — Dans chaque page web, les raccourcis clavier n’utilisant qu’une seule touche (lettre minuscule ou majuscule, ponctuation, chiffre ou symbole) sont-ils contrôlables par l’utilisateur ?

**Tests citables.** `12.10.1`

**Protocole hérité — critère de succès WCAG 2.1.4 (Raccourcis clavier utilisant des caractères).**

**Trancher.** Conforme si tout raccourci composé d'un seul caractère imprimable peut être désactivé, remappé, ou n'est actif qu'au focus du composant concerné. Non conforme s'il est global et non désactivable.

**Non applicable quand.** Aucun raccourci à caractère unique.

**Se demander.**

- Un utilisateur de reconnaissance vocale qui dicte du texte peut-il déclencher ce raccourci par accident ?

### RGAA 12.11 — Dans chaque page web, les contenus additionnels apparaissant au survol, à la prise de focus ou à l’activation d’un composant d’interface sont-ils si nécessaire atteignables au clavier ?

**Tests citables.** `12.11.1`

**Protocole hérité — critère de succès WCAG 2.1.1 (Clavier) :** voir RGAA 4.11.

## Thématique 13 — Consultation

### RGAA 13.1 — Pour chaque page web, l’utilisateur a-t-il le contrôle de chaque limite de temps modifiant le contenu (hors cas particuliers) ?

**Tests citables.** `13.1.1`, `13.1.2`, `13.1.3`, `13.1.4`

**Protocole hérité — critère de succès WCAG 2.2.1 (Réglage du délai).**

**Trancher.** Conforme si toute limite de temps peut être désactivée, ajustée (×10) ou prolongée sur demande. Exemptions : temps réel, événement essentiel, limite > 20 heures.

**Non applicable quand.** Aucune limite de temps.

**Se demander.**

- La session expire-t-elle ? L'utilisateur est-il averti AVANT expiration et peut-il prolonger ?

**Protocole hérité — critère de succès WCAG 2.2.2 (Mettre en pause, arrêter, masquer).**

**Trancher.** Conforme si tout contenu en mouvement, clignotant ou défilant qui dure plus de 5 secondes et démarre automatiquement peut être mis en pause, arrêté ou masqué. Idem pour toute mise à jour automatique.

**Non applicable quand.** Aucun contenu en mouvement ni mise à jour automatique.

**Se demander.**

- Carrousels, animations et bandeaux défilants ont-ils un contrôle de pause atteignable au clavier ?

### RGAA 13.2 — Dans chaque page web, l’ouverture d’une nouvelle fenêtre ne doit pas être déclenchée sans action de l’utilisateur. Cette règle est-elle respectée ?

**Tests citables.** `13.2.1`

**Protocole hérité — critère de succès WCAG 3.2.1 (Au focus) :** voir RGAA 7.4.

### RGAA 13.3 — Dans chaque page web, chaque document bureautique en téléchargement possède-t-il, si nécessaire, une version accessible (hors cas particuliers) ?

**Tests citables.** `13.3.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 1.3.2 (Ordre séquentiel logique) :** voir RGAA 5.3.

**Protocole hérité — critère de succès WCAG 2.4.1 (Contourner des blocs) :** voir RGAA 9.1.

**Protocole hérité — critère de succès WCAG 2.4.3 (Parcours du focus) :** voir RGAA 10.3.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 13.4 — Pour chaque document bureautique ayant une version accessible, cette version offre-t-elle la même information ?

**Tests citables.** `13.4.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

**Protocole hérité — critère de succès WCAG 1.3.1 (Information et relations) :** voir RGAA 3.1.

**Protocole hérité — critère de succès WCAG 1.3.2 (Ordre séquentiel logique) :** voir RGAA 5.3.

**Protocole hérité — critère de succès WCAG 2.4.1 (Contourner des blocs) :** voir RGAA 9.1.

**Protocole hérité — critère de succès WCAG 2.4.3 (Parcours du focus) :** voir RGAA 10.3.

**Protocole hérité — critère de succès WCAG 4.1.2 (Nom, rôle et valeur) :** voir RGAA 1.2.

### RGAA 13.5 — Dans chaque page web, chaque contenu cryptique (art ASCII, émoticône, syntaxe cryptique) a-t-il une alternative ?

**Tests citables.** `13.5.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 13.6 — Dans chaque page web, pour chaque contenu cryptique (art ASCII, émoticône, syntaxe cryptique) ayant une alternative, cette alternative est-elle pertinente ?

**Tests citables.** `13.6.1`

**Protocole hérité — critère de succès WCAG 1.1.1 (Contenu non textuel) :** voir RGAA 1.1.

### RGAA 13.7 — Dans chaque page web, les changements brusques de luminosité ou les effets de flash sont-ils correctement utilisés ?

**Tests citables.** `13.7.1`, `13.7.2`, `13.7.3`

**Protocole hérité — critère de succès WCAG 2.3.1 (Pas plus de trois flashs ou sous le seuil critique).**

**Trancher.** Décidé sur le rendu : rien ne clignote plus de 3 fois par seconde, sauf sous les seuils de flash général et de flash rouge.

**Non applicable quand.** Aucun contenu clignotant.

**Se demander.**

- Une vidéo ou une animation contient-elle des flashs rapides (explosions, stroboscope) ?

### RGAA 13.8 — Dans chaque page web, chaque contenu en mouvement ou clignotant est-il contrôlable par l’utilisateur ?

**Tests citables.** `13.8.1`, `13.8.2`

**Protocole hérité — critère de succès WCAG 2.2.1 (Réglage du délai) :** voir RGAA 13.1.

**Protocole hérité — critère de succès WCAG 2.2.2 (Mettre en pause, arrêter, masquer) :** voir RGAA 13.1.

### RGAA 13.9 — Dans chaque page web, le contenu proposé est-il consultable quelle que soit l’orientation de l’écran (portrait ou paysage) (hors cas particuliers) ?

**Tests citables.** `13.9.1`

**Protocole hérité — critère de succès WCAG 1.3.4 (Orientation).**

**Trancher.** Conforme si le contenu s'affiche dans les deux orientations. Non conforme si l'affichage est verrouillé (CSS `transform`/`orientation` media query bloquante, verrouillage applicatif) sans que l'orientation soit essentielle.

**Se demander.**

- L'orientation est-elle vraiment ESSENTIELLE (piano, chèque à photographier), ou juste un choix de mise en page ?

### RGAA 13.10 — Dans chaque page web, les fonctionnalités utilisables ou disponibles au moyen d’un geste complexe peuvent-elles être également disponibles au moyen d’un geste simple (hors cas particuliers) ?

**Tests citables.** `13.10.1`, `13.10.2`

**Protocole hérité — critère de succès WCAG 2.5.1 (Gestes pour le contrôle du pointeur).**

**Trancher.** Conforme si toute fonctionnalité utilisant un geste multipoint ou basé sur un tracé dispose d'une alternative à pointeur unique. Non conforme pour un pincement, un balayage ou un tracé sans équivalent bouton.

**Non applicable quand.** Aucun geste complexe.

**Se demander.**

- Carrousels, cartes et curseurs offrent-ils des boutons en plus du geste ?

### RGAA 13.11 — Dans chaque page web, les actions déclenchées au moyen d’un dispositif de pointage sur un point unique de l’écran peuvent-elles faire l’objet d’une annulation (hors cas particuliers) ?

**Tests citables.** `13.11.1`

**Protocole hérité — critère de succès WCAG 2.5.2 (Annulation de l’action du pointeur).**

**Trancher.** Conforme si aucune fonctionnalité ne s'exécute à l'APPUI (down-event), ou si elle est annulable/réversible. Non conforme pour une action déclenchée dès `mousedown`/`touchstart` sans possibilité d'annuler en éloignant le pointeur.

**Se demander.**

- Des handlers `onMouseDown`/`onTouchStart` déclenchent-ils l'action au lieu de `onClick` ?

### RGAA 13.12 — Dans chaque page web, les fonctionnalités qui impliquent un mouvement de l’appareil ou vers l’appareil peuvent-elles être satisfaites de manière alternative (hors cas particuliers) ?

**Tests citables.** `13.12.1`, `13.12.2`, `13.12.3`

**Protocole hérité — critère de succès WCAG 2.5.4 (Activation par le mouvement).**

**Trancher.** Conforme si toute fonctionnalité déclenchée par un mouvement de l'appareil (secousse, inclinaison) dispose d'un équivalent dans l'interface ET peut être désactivée.

**Non applicable quand.** Aucune activation par mouvement.

**Se demander.**

- Un écouteur `devicemotion`/`deviceorientation` déclenche-t-il une action sans bouton équivalent ?

## Gravité

Chaque constat NC porte une `severity`. Le barème est celui de cet outil — les référentiels statuent sur la conformité, pas sur la gravité :

- **`bloquant`** — aucun accès, aucun contournement;
- **`majeur`** — accès au prix d'un effort supplémentaire important;
- **`mineur`** — une gêne;

Un défaut observé au même ancrage sous deux critères garde UNE seule gravité, la plus haute, pas une par
critère — l’agrégation avertit quand il est compté deux fois. Une recommandation n’est jamais au-dessus
de `mineur` : un défaut qui ne laisse aucun accès fait échouer un test, et c’est une NC.
