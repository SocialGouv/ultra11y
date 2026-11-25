# Méthodologie et format du rapport

## Statuts par critère

- **C** — conforme (chaque test applicable est réussi).
- **NC** — non conforme (au moins un test échoue ; un constat cite `file:line`).
- **NA** — non applicable (aucun élément du périmètre n’est concerné — justifié).
- **À évaluer (manuel)** — un critère que le moteur ne peut pas décider seul : l’agent IA
  arbitre lui-même ceux qui relèvent du *jugement* (`verify --manual`, sous garde-fou) ; ceux
  qui relèvent du *rendu* sont décidés par le niveau `scan`. Seul le résidu encore indécidable
  reste listé ici.

## Taux de réussite

Taux de conformité = **critères conformes ÷ critères applicables × 100**.

Le moteur ne calcule que le **taux de réussite des contrôles statiques automatiques**, sur le
petit sous-ensemble décidable par la machine qu’il peut réellement trancher : `C ÷ (C + NC)`.
Comme les critères de succès WCAG sont plus larges que les règles du moteur, ce dénominateur
est volontairement petit — ce n’est **pas** un taux de conformité complet. Une conformité
complète WCAG 2.2 AA exige de compléter à la main les critères « à évaluer ».

Ce taux reste disponible dans l’artefact complet, à côté de sa qualification. Les synthèses
(la synthèse console d’`audit`, le décompte de `check --require-decided`) ne l’affichent **pas** : elles affichent `decided/total`, la
répartition par provenance (`engine`, `scan`, `agent`) et le nombre restant. Cela évite qu’un
résultat statique comme 11 conformités et 1 non-conformité soit lu comme « 92 % RGAA » alors
que seuls 12 des 106 critères RGAA ont réellement été décidés.

Les 81 contrôles statiques fournis sont des **règles, pas des critères**. Leur relation est
de plusieurs à plusieurs : plusieurs règles peuvent servir de preuve à un critère, et un pack
peut rattacher une règle à plusieurs de ses propres critères. Nombre de règles, couverture des
critères et taille de la liste de travail de l’agent ne doivent jamais être substitués l’un à
l’autre.

## Priorités des non-conformités

- 🔴 **Bloquant** — empêche l’accès à un contenu ou une fonction (ex. alt manquant, champ
  sans étiquette, lien vide).
- 🟠 **Majeur** — impact fort mais contournable (ordre des titres, contraste, focus
  invisible).
- 🟡 **Mineur** — gêne légère (légende manquante, ARIA redondant).

## La répartition du travail (statique / rendu / jugement)

ultra11y est honnête sur ce qu’un analyseur statique peut décider :

- **Automatisable (statique)** — décidé par le moteur : alt/lang/title manquants, champs sans
  étiquette, `iframe` sans titre, liens/boutons vides, tableaux sans en-têtes, sauts de
  niveaux de titre, `id` dupliqués, ARIA invalide ou cassé, `tabindex` positif, lecture
  automatique…
- **Nécessite le rendu** — contraste calculé (1.4.3), focus visible (2.4.7), zoom/redistribution
  (1.4.4/1.4.10), contenu au survol ou au focus (1.4.13). **Hors du moteur** : décidé par le
  niveau `scan` (axe-core dans un vrai navigateur), signalé comme risque résiduel d’ici là.
- **Jugement de l’agent** — pertinence de l’alt (1.1.1), fonction du lien dans son contexte
  (2.4.4), ordre de lecture et de tabulation, cohérence de la navigation, exactitude des
  sous-titres… : l’agent IA les arbitre lui-même à partir des preuves que le moteur collecte
  (`verify --manual`, sous garde-fou), jamais « conforme » en silence.

Voir le tableau complet des 55 critères de succès WCAG 2.2 AA dans `references/criteria.md`.

**Constats préliminaires.** Un constat relevé sur un template source `.vue`/`.svelte`/`.astro`
(ou sur du JSX rendu par une bibliothèque) porte `preliminary: true` dans la sortie `--json`,
et l’exécution ajoute une réserve `scope.sourceTemplate` (ou `scope.rendered`) : l’analyse
statique ne voit pas le contenu des slots ni le contenu dynamique, le verdict est donc
provisoire — confirmez-le sur le DOM rendu ou réfutez-le (`references/rendered.md`,
`references/false-positives.md`). Il n’est jamais traité comme définitif en silence.

## Format du rapport (`report`)

`report` écrit DEUX fichiers côte à côte, à partir d’une seule dérivation :

**`audits/<standard>-YYYY-MM-DD.md` — le rapport, pour tous les lecteurs** (product owner,
chef de projet, référent accessibilité). Il dit où en est le site, ce qu’il faut corriger et
sur quelles pages — jamais de `file:line`, de sélecteurs, de méthode outillée ni de
commandes :

- **En-tête** — date, les pages auditées (les pages de l’échantillon ; les états de parcours et
  les routes hors échantillon sont listés à part, sur leur propre ligne), ou « code source
  uniquement », le taux principal
  (pour un rapport de pack : le taux de conformité propre au référentiel, validés ÷
  applicables, et juste en dessous, quand des pages sont dans le périmètre, le « taux moyen de
  conformité » — la moyenne des taux des pages de l’échantillon, chacun valant conformes ÷
  (conformes + non conformes) sur sa page, les critères encore à évaluer étant comptés à côté),
  les réserves
  qui changent
  ce qu’un lecteur peut conclure, et le lien vers l’annexe.
- **Synthèse** — le niveau sur l’échelle publiée du référentiel (`conformityLevels` dans le
  pack ; RGAA : non conforme < 50 % ≤ partiellement conforme < 100 % = totalement conforme),
  ou un verdict atteinte / non atteinte / non établie pour le socle WCAG ; un tableau « Ce
  qu'il faut corriger » (« What to fix » en anglais : priorité, critère, occurrences, les
  pages où il a été relevé — en lien, ou « toutes les pages (N/N) » — et la correction
  attendue) ; et les prochaines étapes : ce que la correction des non-conformités change au
  taux, combien de critères le niveau suivant demande, les critères encore à évaluer. Tant
  que des critères restent ouverts, chaque chiffre tiré du taux global est un plancher, et
  les taux par page et leur moyenne sont provisoires.
- **Les 5 sections sous garde-fou** : (1) synthèse par règle WCAG / thématique
  (C/NC/NA/à évaluer), (2) non-conformités par priorité — par critère : le problème relevé
  (la formulation propre du moteur ; les messages anglais d’axe-core et sa remédiation
  standard sont laissés à l’annexe), les pages concernées avec leur URL et leur nombre
  d’occurrences, un recadrage de preuve quand `--evidence` en a produit un, la correction
  attendue — (3) critères conformes, (4) critères non applicables justifiés, (5) critères à
  évaluer. Les recommandations, les taux par page (page, URL, taux), la grille repliée
  critères × pages et, pour chaque page, sa capture d’écran et les critères qui y échouent
  se placent entre (2) et (3).

**`audits/annexe-technique-<standard>-YYYY-MM-DD.md`** (`technical-annex-…` en anglais) **— l’annexe
technique**, pour le développeur et l’auditeur : outil, fichiers du périmètre, calcul du
taux, provenance des décisions, taux automatique, contrat d’automatisation, chaque réserve
avec sa commande ; (A) le bloc auditeur compact de chaque non-conformité avec sa liste de
contrôle d’occurrences `file:line`, construit à partir des MÊMES unités que celles émises par
`prd` et `tickets` (voir `references/tickets.md`) ; (B) les recommandations avec leurs
fichiers ; (C) pour chaque page, sa base de jugement et ses constats avec sélecteurs ; (D) la
procédure pour les critères à évaluer ; (E) la grille exhaustive.

Le rapport renvoie vers l’annexe par son simple nom de fichier, et `check` et `verify`
les lisent comme un seul document : la structure et le taux principal sont dans le rapport,
les occurrences que `verify` arbitre et le taux automatique que `check` recalcule sont dans
l’annexe. Un rapport dont l’annexe liée est absente est refusé (exit 2) — gardez les deux
fichiers ensemble.

Les pages proviennent d’instantanés de page capturés (`.ultra11y/pages/`) ou d’un
`scan --sample` fusionné. Un audit sur le seul code source n’en a aucune, et sa synthèse le
dit au lieu d’afficher une colonne vide (l’annexe donne la commande). Déclarez les `sources`
de chaque page de l’échantillon dans `.ultra11yrc.json` pour que les constats relevés sur le
code source arrivent aussi sur leur page ; une liste de pages n’est marquée « (au moins) »
que lorsque le défaut se trouve dans une source que plusieurs pages déclarent, car un tel
constat est rattaché à la première d’entre elles.

## RGAA 4.1.2, avec WCAG comme correspondance

Chaque livrable (`report` → `rgaa-YYYY-MM-DD.md`, `pages`, `prd`, `tickets`, `check`,
`verify`) est en RGAA 4.1.2 : le référentiel par défaut et le seul. WCAG 2.2 niveau AA est la
clé interne du moteur, et n’atteint un lecteur que sous la forme de la correspondance que
cite chaque critère RGAA (« RGAA 1.1 (WCAG 1.1.1) »). Voir `references/standards.md`.
