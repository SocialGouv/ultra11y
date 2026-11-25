<!-- GÉNÉRÉ depuis src/data/adjudication.json et src/adjudication-rulings.ts par `pnpm run build:adjudication` — ne pas modifier à la main. -->

# Trancher les critères que le moteur vous confie

Le moteur statique tranche d’emblée 3 des 55 critères de succès WCAG 2.2 AA. Les 52 autres
reviennent comme risques résiduels : 14 exigent une page rendue (le tiers `scan`), 38 relèvent
du jugement. Cette page donne la règle de décision de chacun — ce qui le rend conforme, quand
`NA` est légitime, et les questions qui y mènent.

C’est le même jeu de données que `verify --manual` charge dans `ADJUDICATE.md` : la liste de
travail et cette page ne peuvent jamais diverger. Trois règles gouvernent chaque verdict ci-dessous :

- **Une non-conformité doit citer un test normatif qui se résout.** La liste de travail propose
  les techniques W3C du critère ; `verify --apply` rejette un `normativeRef` qui n’existe pas.
- **Une bonne pratique sans test en échec est une recommandation**, pas une non-conformité — elle
  ne fait jamais basculer un critère et n’entre jamais dans le taux de conformité.
- **Un verdict tranché peut statuer sur chaque page de l’audit** (#197) : une table `pages`
  facultative, indexée par identifiant de page auditée, porte des résultats par page, chacun
  passant le même contrôle fermé par défaut, restreint à cette page — chaque citation et chaque
  constat nomme la capture propre de la page ou une source qu’elle déclare. Un `NC` de page exige
  un `NC` global. Une page non nommée garde le verdict global ; une page dont le sujet est sain
  reçoit son propre `C`, une page dont le sujet échoue son propre `NC`.

## 1.1 Équivalents textuels

### 1.1.1 — Contenu non textuel  ·  A  ·  _judgment_

**Trancher.** Conforme si CHAQUE contenu non textuel porte une alternative qui remplit la même fonction : description du sens pour une image informative, alt="" pour une image décorative, description de l'action pour un contrôle. Non conforme dès qu'une alternative est absente, vide alors que l'image porte du sens, ou hors sujet (nom de fichier, « image », « logo »).

**Non applicable quand.** Aucun contenu non textuel dans le périmètre.

**Se demander.**

- Pour chaque alt : décrit-il ce que l'image APPORTE ici, et non ce qu'elle montre ? Une même photo peut demander deux alternatives différentes selon le contexte.
- Les images purement décoratives ont-elles alt="" (et non un alt absent) ? Une image de décoration nommée pollue autant qu'une image informative muette.
- Pour un graphique ou une infographie : l'alternative donne-t-elle la DONNÉE (ou renvoie-t-elle à un tableau équivalent), ou se contente-t-elle de nommer le graphique ?

**Références citables.** ARIA10, ARIA4, ARIA6, ARIA7, ARIA8, ARIA9, C9, F15, F19, F20, F3, F30 … (`criteria 1.1.1`)

## 1.2 Média temporel

### 1.2.1 — Contenus seulement audio et seulement vidéo (pré-enregistrés)  ·  A  ·  _judgment_

**Trancher.** Conforme si chaque média audio-seul dispose d'une transcription textuelle, et chaque média vidéo-seul d'une transcription OU d'une piste audio équivalente. Non conforme si le média porte de l'information disponible nulle part ailleurs.

**Non applicable quand.** Aucun média audio-seul ou vidéo-seul.

**Se demander.**

- La transcription est-elle atteignable depuis la page du média (lien adjacent, panneau dépliant), et non enfouie ailleurs ?
- Couvre-t-elle TOUT le contenu, y compris l'identification des locuteurs et les sons signifiants ?

**Références citables.** F30, F67, G158, G159, G166, G173, G58, G69, G78, G8, H96, SM6 … (`criteria 1.2.1`)

### 1.2.2 — Sous-titres (pré-enregistrés)  ·  A  ·  _judgment_

**Trancher.** Conforme si toute vidéo pré-enregistrée porteuse de parole dispose de sous-titres synchronisés (piste <track kind="captions">, sous-titres intégrés au conteneur, ou lecteur en fournissant). Non conforme si la parole n'est restituée par aucun sous-titre.

**Non applicable quand.** Aucune vidéo pré-enregistrée porteuse de son signifiant.

**Se demander.**

- L'absence de <track> prouve-t-elle vraiment l'absence de sous-titres ? Vérifiez le conteneur et le lecteur : les sous-titres peuvent être intégrés — c'est pourquoi le moteur ne classe pas ce cas en non-conformité.
- Les sous-titres couvrent-ils aussi les sons non verbaux signifiants (musique, alarme, rire) ?

**Références citables.** F74, F75, F8, G58, G87, G93, H95, SM11, SM12

### 1.2.3 — Audio-description ou version de remplacement pour un média temporel (pré-enregistré)  ·  A  ·  _judgment_

**Trancher.** Conforme si chaque vidéo pré-enregistrée sonore offre une audiodescription OU une alternative textuelle complète décrivant l'information visuelle. Non conforme si l'information portée par l'image seule n'est restituée nulle part.

**Non applicable quand.** Aucune vidéo pré-enregistrée sonore.

**Se demander.**

- Quelle information n'existe QUE dans l'image (texte à l'écran, démonstration, graphique) ? Est-elle dite ou décrite ailleurs ?

**Références citables.** F30, F67, G158, G159, G166, G173, G58, G69, G78, G8, H96, SM6 … (`criteria 1.2.3`)

### 1.2.4 — Sous-titres (en direct)  ·  AA  ·  _judgment_

**Trancher.** Conforme si tout contenu audio diffusé en direct dispose de sous-titres en temps réel. Non conforme sinon.

**Non applicable quand.** Aucune diffusion en direct.

**Se demander.**

- Y a-t-il un flux live (webinaire, direct, visioconférence intégrée) dans le périmètre ? Le prestataire de sous-titrage est-il en place pour CHAQUE session ?

### 1.2.5 — Audio-description (pré-enregistrée)  ·  AA  ·  _judgment_

**Trancher.** Conforme si chaque vidéo pré-enregistrée sonore dispose d'une audiodescription (piste dédiée ou version audiodécrite). Attention : au niveau AA, l'alternative textuelle seule ne suffit plus, contrairement à 1.2.3.

**Non applicable quand.** Aucune vidéo pré-enregistrée sonore.

**Se demander.**

- Une piste d'audiodescription existe-t-elle réellement, ou seule la transcription de 1.2.3 est-elle fournie ?

**Références citables.** G173, G58, G78, G8, H96, SM1, SM2, SM6, SM7

## 1.3 Adaptable

### 1.3.1 — Information et relations  ·  A  ·  _judgment_

**Trancher.** Conforme si chaque relation et structure perçue visuellement (titres, listes, tableaux, groupes de champs, régions) est déterminable par programme. Non conforme dès qu'une relation n'existe que visuellement — un « titre » en <div> gras, une liste faite de <br>, un couple libellé/valeur en <span>.

**Se demander.**

- Cohérence des techniques (RGAA 9.1) : la MÊME technique de structuration (hn vs caption, balisage ul/ol/dl) est-elle employée sur TOUS les tableaux/pages similaires — pas au cas par cas ?
- Champs présentés en div (RGAA 8.9) : pour chaque paire libellé/valeur affichée avec des <div>/<span>, la relation est-elle autre chose que visuelle (<dl>/<dt>/<dd> ou association ARIA) ?
- Le contenu lu sans CSS garde-t-il le même sens et le même ordre ?

**Références citables.** ARIA11, ARIA12, ARIA14, ARIA16, ARIA17, ARIA4, ARIA6, ARIA9, C18, C22, C6, C8 … (`criteria 1.3.1`)

### 1.3.2 — Ordre séquentiel logique  ·  A  ·  _judgment_

**Trancher.** Conforme si l'ordre de lecture du DOM produit une séquence qui garde le sens. Non conforme quand l'ordre visuel et l'ordre DOM divergent au point de changer le sens (colonnes réordonnées en CSS, `order`/`flex-direction: *-reverse`, positionnement absolu).

**Se demander.**

- En lisant le DOM de haut en bas, la séquence reste-t-elle compréhensible — ou une colonne latérale s'intercale-t-elle au milieu d'un texte ?
- Un `order` CSS ou un `flex-direction` inversé déplace-t-il visuellement des éléments porteurs de sens ?

**Références citables.** ARIA4, C18, C22, C6, C8, F1, F15, F32, F33, F34, F48, F49 … (`criteria 1.3.2`)

### 1.3.3 — Caractéristiques sensorielles  ·  A  ·  _judgment_

**Trancher.** Conforme si aucune instruction ne repose UNIQUEMENT sur une caractéristique sensorielle (forme, couleur, taille, position, son). Non conforme pour « cliquez sur le bouton vert », « voir l'encadré à droite », « le champ ci-dessous » sans autre repère.

**Se demander.**

- Chaque instruction nomme-t-elle aussi la cible (libellé, intitulé) en plus de sa position ou de sa couleur ?

**Références citables.** F14, F26, G140, G96

### 1.3.4 — Orientation  ·  AA  ·  _needs-rendering_

**Trancher.** Conforme si le contenu s'affiche dans les deux orientations. Non conforme si l'affichage est verrouillé (CSS `transform`/`orientation` media query bloquante, verrouillage applicatif) sans que l'orientation soit essentielle.

**Se demander.**

- L'orientation est-elle vraiment ESSENTIELLE (piano, chèque à photographier), ou juste un choix de mise en page ?

### 1.3.5 — Identifier la finalité de la saisie  ·  AA  ·  _judgment_

**Trancher.** Conforme si chaque champ collectant une information SUR L'UTILISATEUR déclare sa finalité avec un token `autocomplete` de la liste WCAG. Non conforme si le token manque ou n'appartient pas au vocabulaire.

**Non applicable quand.** Aucun champ ne collecte d'information sur l'utilisateur.

**Se demander.**

- Le champ collecte-t-il une donnée de l'UTILISATEUR (nom, e-mail, adresse, téléphone) — et non une donnée métier (n° de commande, mot-clé de recherche) ?

**Références citables.** H98

## 1.4 Distinguable

### 1.4.1 — Utilisation de la couleur  ·  A  ·  _needs-rendering_

**Trancher.** Conforme si aucune information n'est donnée par la couleur SEULE. Non conforme pour un lien dans un paragraphe distingué par la seule couleur, un statut « rouge/vert » sans texte ni icône, un champ en erreur signalé par une bordure colorée uniquement.

**Se demander.**

- Vu en niveaux de gris, chaque information reste-t-elle distinguable ?

**Références citables.** C15, F14, F26, F73, F78, G111, G117, G138, G14, G140, G149, G165 … (`criteria 1.4.1`)

### 1.4.3 — Contraste (minimum)  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu (`scan`) : 4,5:1 pour le texte courant, 3:1 pour le texte large (≥ 18,66 px gras ou ≥ 24 px). Le moteur tranche le sous-ensemble des couleurs littérales en style inline ; tout le reste exige les styles calculés.

**Se demander.**

- Les états (survol, focus, désactivé) et le texte sur image/dégradé ont-ils été mesurés, pas seulement l'état au repos ?

**Références citables.** C29, F24, G136, G145, G148, G174, G18

### 1.4.4 — Redimensionnement du texte  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : à 200 % de zoom texte, aucun contenu ni fonctionnalité n'est perdu, tronqué ou superposé. Non conforme si un `meta viewport` bloque le zoom.

**Se demander.**

- À 200 %, des textes se chevauchent-ils, ou des boutons sortent-ils de leur conteneur ?

**Références citables.** C12, C13, C14, C17, C28, F69, F80, G146, G179, SCR34

### 1.4.5 — Texte sous forme d’image  ·  AA  ·  _needs-rendering_

**Trancher.** Conforme si le texte est du vrai texte, sauf logotype ou présentation essentielle. Non conforme pour un titre, un bouton ou une citation composés en image.

**Se demander.**

- L'image de texte est-elle un logo (exempté) ou une mise en forme qui pourrait être obtenue en CSS ?

**Références citables.** C22, C30, G136, G140

### 1.4.10 — Redistribution  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : à 320 px de large (équivalent 400 % sur 1280 px), aucun défilement bidirectionnel n'est requis, sauf pour un contenu qui l'exige par nature (carte, tableau de données larges).

**Se demander.**

- Le défilement horizontal restant concerne-t-il un contenu réellement exempté, ou toute la page ?
- Une information ou une fonctionnalité est-elle réellement perdue (texte coupé, contrôle rogné ou hors d'atteinte) ? Le petit débordement d'une image décorative, ou d'une boîte seule dont le texte et les contrôles restent disponibles, est une recommandation, pas une non-conformité — et un composant partagé (en-tête, pied de page) fait un seul constat, pas un par page.

**Références citables.** C34, C37

### 1.4.11 — Contraste du contenu non textuel  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : 3:1 pour les composants d'interface (bordure de champ, contour de bouton, indicateur de focus) et pour les parties signifiantes des graphiques.

**Se demander.**

- La bordure qui identifie un champ, et l'indicateur de focus, atteignent-ils 3:1 contre leur fond ?

**Références citables.** F78, G145, G174, G18, G183, G195, G207

### 1.4.12 — Espacement du texte  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : en forçant hauteur de ligne 1,5×, espacement de paragraphe 2×, lettres 0,12× et mots 0,16×, aucun contenu n'est perdu ni tronqué.

**Se demander.**

- Des conteneurs à hauteur fixe coupent-ils le texte une fois l'espacement augmenté ?

**Références citables.** C21, C35, C36, C8

### 1.4.13 — Contenu au survol ou au focus  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : tout contenu additionnel apparu au survol ou au focus doit être masquable (Échap), survolable (le pointeur peut l'atteindre) et persistant (il ne disparaît pas tout seul).

**Se demander.**

- L'infobulle survit-elle au déplacement du pointeur vers elle, et Échap la ferme-t-il sans déplacer le focus ?

**Références citables.** F95

## 2.1 Accessibilité au clavier

### 2.1.1 — Clavier  ·  A  ·  _judgment_

**Trancher.** Conforme si toute fonctionnalité est utilisable au clavier seul. Non conforme dès qu'une action n'existe qu'à la souris (handler sur un élément non interactif, glisser-déposer sans équivalent, survol obligatoire).

**Se demander.**

- Chaque `onClick`/`onMouseEnter` sur un élément non natif a-t-il un équivalent clavier (élément natif, ou role + tabindex + gestion Entrée/Espace) ?
- Les widgets composites (menu, onglets, combobox) suivent-ils le contrat clavier attendu (flèches, Échap, Origine/Fin) ?

**Références citables.** F10, F42, F54, F55, G202, G21, G4, G90, H91, SCR2, SCR20, SCR29 … (`criteria 2.1.1`)

### 2.1.2 — Pas de piège au clavier  ·  A  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : le focus doit pouvoir ENTRER et SORTIR de chaque composant au clavier seul. Non conforme pour une modale, un lecteur embarqué ou un éditeur qui capture le focus définitivement.

**Se demander.**

- Dans chaque modale et chaque iframe tierce, Tab finit-il par ressortir — et Échap rend-il la main ?

**Références citables.** F10, G202, G21, G4, G90, H91

### 2.1.4 — Raccourcis clavier utilisant des caractères  ·  A  ·  _judgment_

**Trancher.** Conforme si tout raccourci composé d'un seul caractère imprimable peut être désactivé, remappé, ou n'est actif qu'au focus du composant concerné. Non conforme s'il est global et non désactivable.

**Non applicable quand.** Aucun raccourci à caractère unique.

**Se demander.**

- Un utilisateur de reconnaissance vocale qui dicte du texte peut-il déclencher ce raccourci par accident ?

**Références citables.** F99, G217

## 2.2 Délai suffisant

### 2.2.1 — Réglage du délai  ·  A  ·  _judgment_

**Trancher.** Conforme si toute limite de temps peut être désactivée, ajustée (×10) ou prolongée sur demande. Exemptions : temps réel, événement essentiel, limite > 20 heures.

**Non applicable quand.** Aucune limite de temps.

**Se demander.**

- La session expire-t-elle ? L'utilisateur est-il averti AVANT expiration et peut-il prolonger ?

**Références citables.** F16, F4, F40, F41, F47, F50, F58, F61, F7, G11, G110, G133 … (`criteria 2.2.1`)

### 2.2.2 — Mettre en pause, arrêter, masquer  ·  A  ·  _judgment_

**Trancher.** Conforme si tout contenu en mouvement, clignotant ou défilant qui dure plus de 5 secondes et démarre automatiquement peut être mis en pause, arrêté ou masqué. Idem pour toute mise à jour automatique.

**Non applicable quand.** Aucun contenu en mouvement ni mise à jour automatique.

**Se demander.**

- Carrousels, animations et bandeaux défilants ont-ils un contrôle de pause atteignable au clavier ?

**Références citables.** F16, F4, F40, F41, F47, F50, F58, F61, F7, G11, G110, G133 … (`criteria 2.2.2`)

## 2.3 Crises et réactions physiques

### 2.3.1 — Pas plus de trois flashs ou sous le seuil critique  ·  A  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : rien ne clignote plus de 3 fois par seconde, sauf sous les seuils de flash général et de flash rouge.

**Non applicable quand.** Aucun contenu clignotant.

**Se demander.**

- Une vidéo ou une animation contient-elle des flashs rapides (explosions, stroboscope) ?

**Références citables.** G15, G176, G19

## 2.4 Navigable

### 2.4.1 — Contourner des blocs  ·  A  ·  _judgment_

**Trancher.** Conforme si un mécanisme permet d'éviter les blocs répétés : lien d'évitement fonctionnel, ou structuration en régions (landmarks) et en titres. Non conforme si l'utilisateur doit traverser la navigation à chaque page.

**Se demander.**

- Le lien d'évitement est-il le PREMIER élément focalisable, visible au focus, et sa cible reçoit-elle réellement le focus ?

**Références citables.** ARIA11, ARIA12, ARIA4, F15, F66, G1, G10, G115, G123, G124, G130, G135 … (`criteria 2.4.1`)

### 2.4.3 — Parcours du focus  ·  A  ·  _judgment_

**Trancher.** Conforme si l'ordre de tabulation préserve le sens et l'opérabilité. Non conforme quand le focus saute de façon incohérente, entre dans un contenu masqué, ou ne suit pas l'ordre visuel là où celui-ci porte le sens.

**Se demander.**

- SPA (RGAA 12.8) : après une navigation partielle, le focus est-il déplacé vers le nouveau contenu (et non laissé sur le lien cliqué ni renvoyé en haut) ?
- À l'ouverture d'une modale, le focus entre-t-il dedans ; à la fermeture, revient-il sur le déclencheur ?

**Références citables.** C27, F1, F15, F44, F66, F85, G1, G10, G123, G124, G135, G140 … (`criteria 2.4.3`)

### 2.4.4 — Fonction du lien (selon le contexte)  ·  A  ·  _judgment_

**Trancher.** Conforme si la fonction de chaque lien se comprend depuis son intitulé seul, ou depuis son intitulé + son contexte immédiat (phrase, item de liste, cellule + en-têtes). Non conforme pour « en savoir plus », « cliquez ici », une URL brute, ou deux liens de même intitulé menant ailleurs.

**Se demander.**

- Lu hors contexte, l'intitulé dit-il OÙ le lien mène ou CE QU'il déclenche ?
- Deux liens portant le même intitulé mènent-ils à la même destination ?
- Un lien de téléchargement annonce-t-il le format et le poids (recommandation, non normatif) ?

**Références citables.** ARIA7, ARIA8, F63, F89, G53, G91, H30, H78, H79, H80, H81

### 2.4.5 — Accès multiples  ·  AA  ·  _judgment_

**Trancher.** Conforme si au moins DEUX moyens permettent d'atteindre chaque page : moteur de recherche, plan du site, navigation principale, fil d'Ariane, index. Exemption : une page qui est une étape d'un processus.

**Se demander.**

- Les deux moyens existent-ils sur l'ENSEMBLE du site, ou seulement sur l'accueil ?

**Références citables.** G161, G61, G63, G64

### 2.4.6 — En-têtes et étiquettes  ·  AA  ·  _judgment_

**Trancher.** Conforme si chaque titre décrit la section qu'il introduit et chaque libellé décrit ce que le champ attend. Non conforme pour un titre générique (« Section 2 »), un libellé vague (« Valeur »), ou un intitulé qui ne correspond pas au contenu.

**Se demander.**

- La suite des titres, lue seule, donne-t-elle un plan compréhensible de la page ?
- Concision des titres de tableaux (RGAA 5.5) : chaque <caption> est-il un intitulé COURT et pertinent ? Un titre clair mais verbeux doit devenir une brève introduction, les détails étant déportés dans un texte associé via aria-labelledby/aria-describedby.

**Références citables.** ARIA12, ARIA14, ARIA16, ARIA4, ARIA6, ARIA9, F68, F82, F86, G115, G130, G131 … (`criteria 2.4.6`)

### 2.4.7 — Visibilité du focus  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : chaque élément focalisable montre un indicateur de focus visible. Non conforme pour un `outline: none` non remplacé.

**Se demander.**

- L'indicateur est-il visible sur TOUS les fonds (thème sombre, survol, éléments sur image) ?

**Références citables.** C15, F42, F54, F55, F73, F78, G149, G165, G183, G195, G202, G90 … (`criteria 2.4.7`)

### 2.4.11 — Focus non masqué (minimum)  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : l'élément qui reçoit le focus n'est pas entièrement masqué par un contenu créé par l'auteur (en-tête collant, bandeau de cookies, barre d'action).

**Se demander.**

- En tabulant vers le bas puis vers le haut, un en-tête ou un pied collant recouvre-t-il l'élément focalisé ?

## 2.5 Modalités d’entrée

### 2.5.1 — Gestes pour le contrôle du pointeur  ·  A  ·  _judgment_

**Trancher.** Conforme si toute fonctionnalité utilisant un geste multipoint ou basé sur un tracé dispose d'une alternative à pointeur unique. Non conforme pour un pincement, un balayage ou un tracé sans équivalent bouton.

**Non applicable quand.** Aucun geste complexe.

**Se demander.**

- Carrousels, cartes et curseurs offrent-ils des boutons en plus du geste ?

**Références citables.** G215, G216

### 2.5.2 — Annulation de l’action du pointeur  ·  A  ·  _judgment_

**Trancher.** Conforme si aucune fonctionnalité ne s'exécute à l'APPUI (down-event), ou si elle est annulable/réversible. Non conforme pour une action déclenchée dès `mousedown`/`touchstart` sans possibilité d'annuler en éloignant le pointeur.

**Se demander.**

- Des handlers `onMouseDown`/`onTouchStart` déclenchent-ils l'action au lieu de `onClick` ?

### 2.5.3 — Étiquette dans le nom  ·  A  ·  _judgment_

**Trancher.** Conforme si, pour chaque contrôle portant un libellé textuel visible, ce texte est CONTENU dans le nom accessible. Non conforme quand `aria-label` remplace le texte visible par un autre libellé : la commande vocale ne trouve plus la cible.

**Se demander.**

- Le nom accessible COMMENCE-t-il idéalement par le texte visible, pour que la commande vocale corresponde au premier mot prononcé ?

**Références citables.** ARIA14, ARIA16, ARIA18, ARIA19, ARIA4, ARIA5, ARIA6, ARIA7, ARIA8, ARIA9, F15, F19 … (`criteria 2.5.3`)

### 2.5.4 — Activation par le mouvement  ·  A  ·  _judgment_

**Trancher.** Conforme si toute fonctionnalité déclenchée par un mouvement de l'appareil (secousse, inclinaison) dispose d'un équivalent dans l'interface ET peut être désactivée.

**Non applicable quand.** Aucune activation par mouvement.

**Se demander.**

- Un écouteur `devicemotion`/`deviceorientation` déclenche-t-il une action sans bouton équivalent ?

### 2.5.7 — Mouvements de glissement  ·  AA  ·  _judgment_

**Trancher.** Conforme si toute action réalisée par glissement dispose d'une alternative à pointeur unique sans glissement (boutons, champ de saisie, menu). Non conforme pour un réordonnancement, un curseur ou un kanban glisser-déposer seul.

**Non applicable quand.** Aucune interaction par glissement.

**Se demander.**

- Les listes réordonnables offrent-elles des boutons « monter »/« descendre » en plus du glissement ?

### 2.5.8 — Taille de la cible (minimum)  ·  AA  ·  _needs-rendering_

**Trancher.** Décidé sur le rendu : la cible de pointage fait au moins 24×24 px CSS, sauf espacement suffisant, équivalent ailleurs, cible en ligne dans du texte, ou taille imposée par la loi.

**Se demander.**

- Les petites icônes (fermer, éditer, supprimer) atteignent-elles 24 px, ou bénéficient-elles de l'exception d'espacement ?

## 3.1 Lisible

### 3.1.2 — Langue d’un passage  ·  AA  ·  _judgment_

**Trancher.** Conforme si chaque passage dans une langue différente de celle de la page porte un `lang` correct. Exemptions : noms propres, termes techniques, mots passés dans l'usage.

**Non applicable quand.** Aucun changement de langue.

**Se demander.**

- Les citations, titres d'œuvres et expressions étrangères sont-ils marqués — et le sous-tag correspond-il vraiment à la langue du texte ?

**Références citables.** H58

## 3.2 Prévisible

### 3.2.1 — Au focus  ·  A  ·  _judgment_

**Trancher.** Conforme si recevoir le focus ne déclenche AUCUN changement de contexte. Non conforme si le focus ouvre une fenêtre, soumet un formulaire ou déplace le focus ailleurs.

**Se demander.**

- Des handlers `onFocus` naviguent-ils, ouvrent-ils une modale ou déplacent-ils le focus ?

**Références citables.** F22, F36, F37, F41, F55, F9, G107, G13, G76, G80, H32, H84 … (`criteria 3.2.1`)

### 3.2.2 — À la saisie  ·  A  ·  _judgment_

**Trancher.** Conforme si modifier la valeur d'un contrôle ne déclenche pas seul un changement de contexte, ou si l'utilisateur en a été averti avant. Non conforme pour un `<select>` qui navigue au changement.

**Se demander.**

- Le changement est-il annoncé AVANT (texte d'aide au-dessus du champ), ou l'utilisateur le découvre-t-il après coup ?

**Références citables.** F22, F36, F37, F41, F9, G107, G13, G76, G80, H32, H84, SCR19

### 3.2.3 — Navigation cohérente  ·  AA  ·  _judgment_

**Trancher.** Conforme si les mécanismes de navigation répétés apparaissent dans le MÊME ordre relatif d'une page à l'autre. Non conforme si l'ordre des entrées du menu change selon les pages.

**Se demander.**

- Sur l'échantillon de pages, la navigation principale, le fil d'Ariane et le pied de page gardent-ils le même ordre ?

**Références citables.** F66, G1, G123, G124, G59, G61, G63, SCR28

### 3.2.4 — Identification cohérente  ·  AA  ·  _judgment_

**Trancher.** Conforme si les composants de même fonction sont identifiés de la même manière partout (même intitulé, même icône, même nom accessible). Non conforme si « Rechercher » devient « Trouver » selon les pages.

**Se demander.**

- Les icônes récurrentes (imprimer, partager, télécharger) portent-elles partout le même nom accessible ?

**Références citables.** F31

### 3.2.6 — Aide cohérente  ·  A  ·  _judgment_

**Trancher.** Conforme si, quand un mécanisme d'aide (contact, chat, FAQ, aide contextuelle) est présent sur plusieurs pages, il apparaît dans le même ordre relatif. Nouveauté WCAG 2.2.

**Non applicable quand.** Aucun mécanisme d'aide.

**Se demander.**

- Le lien de contact ou le widget de chat occupe-t-il la même position relative sur toutes les pages qui le portent ?

## 3.3 Assistance à la saisie

### 3.3.1 — Identification des erreurs  ·  A  ·  _judgment_

**Trancher.** Conforme si chaque erreur de saisie détectée automatiquement est identifiée EN TEXTE et le champ fautif désigné. Non conforme pour une bordure rouge seule, ou un message non relié au champ.

**Non applicable quand.** Aucune détection d'erreur de saisie.

**Se demander.**

- Le message d'erreur est-il relié au champ (`aria-describedby`/`aria-errormessage`) et annoncé au moment où il apparaît ?

**Références citables.** ARIA1, ARIA16, ARIA2, ARIA21, ARIA6, ARIA9, F81, G184, G83, G84, G85, G89 … (`criteria 3.3.1`)

### 3.3.2 — Étiquettes ou instructions  ·  A  ·  _judgment_

**Trancher.** Conforme si chaque champ porte un libellé ou une instruction quand une saisie est attendue. Non conforme si le format attendu (date, mot de passe, téléphone) n'est indiqué nulle part avant l'erreur.

**Se demander.**

- Le format et les contraintes sont-ils annoncés AVANT la saisie, et non seulement dans le message d'erreur ?

**Références citables.** ARIA1, ARIA14, ARIA16, ARIA17, ARIA2, ARIA21, ARIA6, ARIA9, F68, F81, F82, F86 … (`criteria 3.3.2`)

### 3.3.3 — Suggestion après une erreur  ·  AA  ·  _judgment_

**Trancher.** Conforme si, quand la correction est connue, une suggestion est proposée. Non conforme pour un « champ invalide » qui ne dit pas ce qui est attendu, sauf si le suggérer compromettrait la sécurité.

**Non applicable quand.** Aucune erreur de saisie détectée automatiquement.

**Se demander.**

- Le message dit-il COMMENT corriger (« la date doit être au format JJ/MM/AAAA »), ou seulement que c'est faux ?

**Références citables.** G177, G84, G85, G89, H89

### 3.3.4 — Prévention des erreurs (juridiques, financières, de données)  ·  AA  ·  _judgment_

**Trancher.** Conforme si les envois à portée juridique, financière ou modifiant des données sont réversibles, vérifiés, ou confirmés. Non conforme pour une suppression ou une commande définitive en un clic.

**Non applicable quand.** Aucune transaction à portée juridique, financière ou modifiant des données.

**Se demander.**

- L'utilisateur peut-il relire et corriger avant validation définitive ?

**Références citables.** G155, G164, G168, G98, G99

### 3.3.7 — Saisie redondante  ·  A  ·  _judgment_

**Trancher.** Conforme si aucune information déjà saisie dans le même processus n'est redemandée, sauf ressaisie essentielle (confirmation de mot de passe) ou information devenue invalide. Nouveauté WCAG 2.2.

**Se demander.**

- Un tunnel multi-étapes redemande-t-il l'adresse ou l'e-mail déjà saisis, sans pré-remplissage ni sélection ?

### 3.3.8 — Authentification accessible (minimum)  ·  AA  ·  _judgment_

**Trancher.** Conforme si aucune étape d'authentification n'exige un test de fonction cognitive (mémoriser, transcrire, résoudre), sauf alternative, aide, reconnaissance d'objet ou contenu fourni par l'utilisateur. Le collage et le remplissage automatique doivent rester possibles. Nouveauté WCAG 2.2.

**Non applicable quand.** Aucune authentification.

**Se demander.**

- Le collage est-il possible dans les champs d'identification, et le gestionnaire de mots de passe peut-il les remplir ?
- Un CAPTCHA de transcription ou un code à ressaisir de mémoire est-il imposé sans alternative ?

## 4.1 Compatible

### 4.1.2 — Nom, rôle et valeur  ·  A  ·  _judgment_

**Trancher.** Conforme si chaque composant d'interface expose un nom, un rôle et — quand il porte un état — une valeur, tenus à jour. Non conforme pour un widget custom sans rôle, sans nom, ou dont l'état ARIA ne suit pas l'état réel.

**Se demander.**

- Pour chaque widget custom : le rôle correspond-il au comportement réel, et l'état (`aria-expanded`, `aria-checked`, `aria-selected`) suit-il l'interaction ?
- Le nom accessible correspond-il à ce que l'utilisateur voit et dirait ?

**Références citables.** ARIA10, ARIA11, ARIA12, ARIA14, ARIA16, ARIA18, ARIA19, ARIA4, ARIA5, ARIA6, ARIA9, C9 … (`criteria 4.1.2`)

### 4.1.3 — Messages d’état  ·  AA  ·  _judgment_

**Trancher.** Conforme si chaque message de statut (succès, erreur, résultat de recherche, chargement) est exposé par un rôle ou une propriété permettant l'annonce SANS recevoir le focus. Non conforme pour un message inséré dans un conteneur ordinaire.

**Non applicable quand.** Aucun message de statut.

**Se demander.**

- La région live existe-t-elle DANS LE DOM avant l'insertion du message (une région créée en même temps que son contenu n'est pas annoncée) ?
- La politesse est-elle adaptée : `polite` pour un statut, `alert`/`assertive` pour une erreur bloquante ?

**Références citables.** ARIA19, ARIA22, ARIA23

## Gravité

Chaque constat NC porte une `severity`. Le barème est celui de cet outil — les référentiels statuent sur la conformité, pas sur la gravité :

- **`bloquant`** — aucun accès, aucun contournement;
- **`majeur`** — accès au prix d'un effort supplémentaire important;
- **`mineur`** — une gêne;

Un défaut observé au même ancrage sous deux critères garde UNE seule gravité, la plus haute, pas une par
critère — l’agrégation avertit quand il est compté deux fois. Une recommandation n’est jamais au-dessus
de `mineur` : un défaut qui ne laisse aucun accès fait échouer un test, et c’est une NC.

## RGAA 4.1.2 — comment le texte même du référentiel tranche les cas récurrents

Chaque note repose sur les mots cités du référentiel (ses tests, sa méthodologie, ses cas particuliers
ou son glossaire), et le brief du critère l’imprime sous le texte propre du critère.

### RGAA 4.1.2 6.1

- Un lien dont l'intitulé ne signifie rien pour PERSONNE — un lien de remplissage (« Inaccessible », « Lien », « XXX ») que ni son intitulé ni son contexte n'expliquent à un lecteur sans limitation fonctionnelle — est le cas « ambigu pour tout le monde » : 6.1.1 à 6.1.4 sont NON APPLICABLES pour ce lien, pas bloquants. Il vaut au plus une recommandation (remplacer ou retirer le lien) ; s'il est cassé, c'est l'affaire d'un autre critère (12.3.2 dans un plan du site, par exemple).
- L'attribut `title` n'est PAS un contexte du lien : le glossaire en énumère six (la phrase, le paragraphe, l'item de liste, le titre précédent, l'en-tête et la cellule de tableau), et `title` n'en fait pas partie. Il n'entre dans l'intitulé que comme dernier recours du nom accessible, quand le lien n'a aucun contenu — un `title` ne rend donc pas explicite un lien dont le contenu est ambigu.

**Fondements.** « Il existe une gestion de cas particuliers pour les tests 6.1.1, 6.1.2, 6.1.3 et 6.1.4 lorsque le lien est ambigu pour tout le monde. Dans cette situation, où il n’est pas possible de rendre le lien explicite dans son contexte, le critère est non applicable. » · « un lecteur sans limitation fonctionnelle ne connaîtrait pas la fonction d’un lien avant de l’activer » · « Note 1 : l’un des 6 contextes de lien combiné à l’ intitulé du lien doit permettre de comprendre la fonction et la destination du lien. » · « sinon, contenu de l’attribut title »

### RGAA 4.1.2 8.7

- Les « passages candidats » de la moisson sont des PISTES, jamais des NC : un nom propre, un mot d'origine étrangère présent dans le dictionnaire de la langue de la page, ou un mot passé dans l'usage courant dont la prononciation ne gêne pas la compréhension sont exemptés. Une NC 8.7.1 exige un passage réellement en langue étrangère, sans `lang` sur lui ni sur un parent, dont la restitution vocale serait incompréhensible (« deep linking » lu à la française, une phrase entière en anglais).

**Fondements.** « Des mots d’origine étrangère et d’usage courant dont la prononciation ne provoque pas d’incompréhension. » · « le critère est applicable, uniquement lorsque l’absence d’indication de langue peut provoquer une incompréhension pour la restitution. »

### RGAA 4.1.2 9.4

- Une citation, ce sont les mots d'un TIERS, présentés comme reproduits à l'identique, dans le contenu courant de la page. Le glossaire du référentiel ne définit pas « citation » : le mot garde ce sens ordinaire. N'en sont PAS : la définition d'un terme dans une infobulle de glossaire, la paraphrase ou le résumé d'un texte de loi, un titre de page ou de section, une étiquette, un nom de clé ou de champ, un slogan entre guillemets. Au plus une recommandation, jamais une NC.
- Une citation EN LIGNE (dans une phrase) ne peut échouer qu'à 9.4.1 (`<q>`). 9.4.2 porte sur un BLOC de citation : ne le citez jamais pour un texte pris dans un paragraphe.
- Ne proposez jamais `<blockquote>` là où seul du contenu phrasé est permis (dans un `<span>`, un `<a>`, un `<label>`, un titre ou un `<p>`) : HTML l'y interdit, et la correction serait elle-même une erreur de balisage. Une citation en ligne se corrige par `<q>`.

**Fondements.** « Retrouver dans le document les citations courtes (ou en ligne) ; » · « Dans chaque page web, chaque citation courte utilise-t-elle une balise `<q>` ? » · « Dans chaque page web, chaque bloc de citation utilise-t-il une balise `<blockquote>` ? »

### RGAA 4.1.2 10.10

- 10.10 n'échoue que si l'information est donnée UNIQUEMENT par la forme, la taille ou la position. Une référence qui NOMME sa cible (« le bouton Outils d'accessibilité », « voir la rubrique Contact ») est précisément le moyen alternatif : elle est conforme, même quand le nom employé est périmé (un bouton renommé depuis). Un nom périmé relève de l'exactitude du contenu : une recommandation, pas une NC 10.10.
- Une NC 10.10 se cite sur une consigne qui ne renvoie qu'à une forme, une taille ou une position (« cliquez sur le bouton de droite », « l'onglet actif est celui en avant-plan ») sans aucun autre moyen de retrouver l'information.

**Fondements.** « vérifier que le moyen alternatif de récupérer cette information est pertinent, c’est-à-dire qu’il permet de transmettre l’information dans tous les contextes de consultation et pour tous les utilisateurs. » · « l’information ne doit pas être donnée uniquement [par la forme, taille ou position] »

### RGAA 4.1.2 10.11

- Une NC exige qu'à 320 px une INFORMATION ou une FONCTIONNALITÉ ne soit plus disponible sans défilement horizontal : un texte coupé, un contrôle rogné ou hors d'atteinte. Le petit débordement d'une image décorative, ou d'une boîte seule (fond, bordure) alors que tout son texte et ses contrôles restent disponibles, est une recommandation. Images, graphiques, vidéos, tableaux de données et interfaces à ascenseur horizontal sont des exceptions du critère.
- Convention de ce rapport (pas une règle du référentiel) : un composant partagé (en-tête, pied de page, navigation rendus sur chaque page) fait UN constat, ancré sur le composant ou sur la première page où il est observé — pas un par page. Nommez les autres pages dans le message.

**Fondements.** « l’ensemble des informations et des fonctionnalités sont-elles disponibles sans aucun défilement horizontal (hors cas particuliers) ? » · « sans perte d’information ou de fonctionnalité » · « - Les images, les graphiques ou les vidéos ; »

### RGAA 4.1.2 12.3

- Des entrées de remplissage dans un plan du site (un intitulé qui ne nomme aucune page, un `href="#"`) valent AU PLUS une NC mineure sur 12.3.3 — un lien qui ne conduit pas à la page indiquée par son intitulé —, citée une fois sur ces entrées, ou une recommandation. Et seulement APRÈS avoir vérifié où mènent les liens : un lien en erreur relève de 12.3.2, et un plan qui omet des pages reste conforme à 12.3.1 si elles sont atteignables autrement.
- Ce sont les mêmes liens que ceux que 6.1 juge « ambigus pour tout le monde » : ne les facturez pas une seconde fois avec une autre gravité.

**Fondements.** « Les liens du plan du site renvoient-ils bien vers les pages indiquées par l’intitulé ? » · « vérifier qu’ils sont à jour (ni obsolètes ni en erreur) et conduisent à la page indiquée par leur intitulé » · « Il n'est pas obligatoire que toutes les pages soient présentes dans le plan du site si elles peuvent être atteintes, par exemple, à partir de la page d'accueil d'une rubrique ou d'un catalogue. »
