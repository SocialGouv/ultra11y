# Focus et logique d’interaction — l’agent lit la source et arbitre la logique d’interaction

Un moteur statique voit la *structure*. Il ne voit pas ce qui se passe quand un utilisateur
**navigue à la tabulation, saisit du texte ou ouvre une boîte de dialogue** — visibilité du
focus, ordre du focus, pièges à focus, ce qui change au focus/à la saisie, existence d’un
équivalent clavier pour une interaction à la souris. ultra11y marque donc chacun de ces
critères **`manual` / risque résiduel** (jamais « conforme » en silence) et le confie à
**l’agent IA**, qui l’arbitre via `verify --manual` (soumis au garde-fou). C’est la moitié
« logique d’interaction » de la répartition du travail, et c’est là que lire la *source réelle*
compte le plus.

> **Lisez le composant entier, pas seulement le rapport.** L’audit analyse chaque élément du
> périmètre (`audit --graph` résout les imports entre fichiers), mais un verdict de
> focus/logique exige de lire la vraie source de chaque composant interactif — le JSX, les
> gestionnaires d’événements, les effets, l’état — et de raisonner sur ce que vit un
> utilisateur au clavier ou au lecteur d’écran.

## Les critères qui vous reviennent (remontés comme risques résiduels)

| CS | Sur quoi raisonner, en lisant la source |
|---|---|
| **2.1.1 Clavier** | Toute action accessible à la souris est accessible au clavier. Les gestionnaires souris seuls (`onMouseEnter`/`onMouseLeave`/`onClick` sur un élément non interactif) demandent un équivalent focus/clavier (`onFocus`/`onKeyDown`) ou un élément interactif natif. |
| **2.1.2 Pas de piège au clavier** | Le focus peut quitter chaque widget (modales, menus, sélecteurs de date, contenus embarqués). Suivez la logique de piège et le chemin Échap/retour. |
| **2.4.3 Parcours du focus** | L’ordre de tabulation suit le sens. Surveillez l’ordre du DOM face à l’ordre visuel, les portails/modales et `tabIndex` (le positif est déjà signalé ; raisonnez sur le `tabIndex` itinérant dans les menus/onglets/grilles). |
| **2.4.7 Visibilité du focus** | Un indicateur de focus visible sur chaque élément focalisable — vérifiez le CSS (`:focus`/`:focus-visible`, jamais un `outline: none` nu) au rendu. |
| **2.4.11 Focus non masqué** | L’élément qui a le focus n’est pas caché derrière des en-têtes/pieds de page collants ou des surcouches. |
| **3.2.1 Au focus / 3.2.2 À la saisie** | Donner le focus à un contrôle ou le modifier ne déclenche pas de changement de contexte inattendu (envoi automatique, navigation, modale surprise). Suivez les gestionnaires `onFocus`/`onChange`. |
| **2.5.3 Étiquette dans le nom** | Le texte de l’étiquette visible est contenu dans le nom accessible (pour que le contrôle vocal fonctionne). |

## Motifs de composants à suivre (là où vit la logique de focus)

- **Boîte de dialogue / modale** : le focus y entre à l’ouverture, y est piégé tant qu’elle
  est ouverte, revient au déclencheur à la fermeture, Échap la ferme, `aria-modal`/`role="dialog"`
  + une étiquette.
- **Menu / liste déroulante / combobox / listbox** : `tabIndex` itinérant (un seul arrêt de
  tabulation), navigation aux flèches, Échap, `aria-expanded`/`aria-activedescendant`, focus
  rendu au déclencheur.
- **Onglets / accordéon** : les flèches déplacent entre les onglets, le focus suit la
  sélection de façon appropriée.
- **Toast / région live** : annoncé sans voler le focus.
- **Contrôles personnalisés bâtis sur `<div>`/`<span>`** : préférez un élément natif ; sinon,
  il leur faut `role`, `tabindex="0"`, des gestionnaires de touches (Entrée/Espace) et l’état
  en ARIA — le moteur signale l’élément non interactif cliquable (2.1.1), mais c’est VOUS qui
  vérifiez le contrat clavier complet.

## Démarche

1. **Auditez tout le périmètre** avec `audit --graph` pour que chaque composant/import soit
   capturé.
2. **Construisez les listes de travail**. `verify --manual --in audit.json` liste chaque
   critère résiduel (manuel) de focus/logique, préchargé avec les preuves récoltées (état
   ARIA, `tabindex`, étiquettes des contrôles), pour que l’agent IA l’arbitre ;
   `verify --report … --semantic` liste les candidats détectés par le moteur (p. ex. un
   élément non interactif cliquable signalé sous 2.1.1) à confirmer ou réfuter — les deux
   s’appuient sur la référence W3C Understanding (voir `references/verify.md` /
   `references/judgment.md`).
3. **Pour chaque élément de focus/logique, ouvrez la vraie source** des composants concernés
   et raisonnez sur le comportement clavier/focus/interaction décrit ci-dessus. Arbitrez un
   critère résiduel dans `ADJUDICATE.todo.json` : `C` (justifié) / `NC` (avec un constat
   ancrable `file:line` : ce que vit l’utilisateur au clavier) / `NA` (justifié) / `manual`
   (avec une `reason`). Confirmez ou réfutez un candidat du moteur dans `VERIFY.todo.json` :
   `supported` / `partial` / `refuted` / `unsupported`, avec une raison concrète et citée. Ce
   qui demande un DOM rendu (focus *visible*, *non masqué*) est marqué `needs-rendered-dom` et
   passe par le niveau dynamique `scan` (`references/dynamic.md`). Le scan **sonde la
   visibilité du focus (2.4.7)** directement — en tabulant à travers les éléments
   focalisables et en signalant ceux dont le style calculé ne change pas au focus — en plus du
   zoom à 200 % (1.4.4), de l’espacement du texte (1.4.12) et du contenu au survol (1.4.13).
   Un constat de sonde est une vraie NC ; une sonde propre laisse quand même le CS en
   `manual` — jamais marqué conforme sur une supposition.
4. **`verify --apply`** pour appliquer le garde-fou en FAIL-CLOSED (en cas de doute,
   refuser) : une affirmation de focus/logique non arbitrée, réfutée ou non étayée — ou un
   verdict d’agent sans sa justification/son constat/sa raison — échoue.

La règle qui ne plie jamais : un critère de focus/interaction que l’agent IA n’a pas pu
trancher en lisant la source (ou le rendu) est un **risque résiduel explicite** avec une raison
consignée, pas un succès silencieux.
