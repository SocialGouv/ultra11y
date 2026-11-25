# Médias, saisie par pointeur et mouvement

Les critères de cette page sont ceux qu’un audit de la seule source est le moins à même de
trancher : ce que contient réellement une vidéo, la taille d’une cible une fois rendue, si une
animation dure cinq secondes. Chaque entrée dit ce qui la tranche — vous, le niveau `scan` ou le
moteur.

## Médias temporels (1.2.x)

| Média | Ce dont il a besoin | Niveau |
|---|---|---|
| Audio seul, préenregistré | Une transcription textuelle | A (1.2.1) |
| Vidéo seule, préenregistrée | Une transcription OU une piste audio équivalente | A (1.2.1) |
| Vidéo avec son, préenregistrée | Des sous-titres synchronisés | A (1.2.2) |
| Vidéo avec son, préenregistrée | Une audiodescription OU une alternative textuelle complète | A (1.2.3) |
| Vidéo avec son, préenregistrée | Une audiodescription — une transcription ne suffit plus | **AA (1.2.5)** |
| Tout audio en direct | Des sous-titres en temps réel | AA (1.2.4) |

```html
<video controls>
  <source src="talk.mp4" type="video/mp4">
  <track kind="captions" src="talk.en.vtt" srclang="en" label="English" default>
  <track kind="descriptions" src="talk.desc.vtt" srclang="en" label="Audio description">
</video>
<p><a href="talk-transcript.html">Read the transcript of this talk</a></p>
```

`kind` compte : `captions` inclut les sons non verbaux et l’identification des locuteurs ;
`subtitles` est une traduction destinée aux personnes qui entendent ; `descriptions` raconte
l’image. Une piste `subtitles` ne satisfait pas le 1.2.2.

**Pourquoi le moteur se contente ici de recommander.** Une `<video>` sans `<track>` peut tout de
même porter des sous-titres intégrés au conteneur, et sa piste audio peut être muette. Ni l’un ni
l’autre ne peut être connu à partir de la source, donc `media-no-track` est une
**recommandation** : le 1.2.2 reste à vous d’arbitrer au regard du média réel. Vérifiez le
fichier et le lecteur avant d’écrire un verdict.

Également dans le périmètre : les contrôles propres d’un lecteur multimédia doivent être
utilisables au clavier et nommés (2.1.1, 4.1.2) — un lecteur personnalisé est un widget
composite, voir `references/widgets.md`.

## Lecture automatique (1.4.2, 2.2.2)

Un son qui se lance automatiquement pendant plus de 3 secondes nécessite un mécanisme pour le
mettre en pause, l’arrêter ou contrôler son volume, indépendamment du volume système. Les
`controls` natifs sont ce mécanisme.

```html
<video autoplay muted playsinline>…</video>   <!-- no audio: 1.4.2 not engaged -->
<audio src="jingle.mp3" autoplay controls>     <!-- ✓ a stop mechanism exists -->
```

Règle du moteur : `autoplay-media` — normative uniquement en l’absence de `controls` et de
`muted` ; le cas de la vidéo muette est soulevé comme recommandation, puisque la source ne peut
pas montrer si le mouvement dure les 5 secondes qu’exige le 2.2.2.

## Saisie par pointeur (2.5.x)

| Critère de succès | Exigence | Comment la satisfaire |
|---|---|---|
| **2.5.1** Gestes de pointage | Aucune fonction n’exige un geste multipoint ou basé sur un tracé | Ajoutez des boutons à côté du balayage/pincement : flèches de carrousel, contrôles de zoom de carte |
| **2.5.2** Annulation de l’action du pointeur | Aucune fonction ne s’exécute sur l’événement DOWN, ou elle peut être annulée | Agissez sur `click`/`pointerup`, pas sur `pointerdown` ; permettez à l’utilisateur de glisser hors de la cible pour annuler |
| **2.5.3** Étiquette dans le nom | L’étiquette visible est contenue dans le nom accessible | Voir `references/naming.md` |
| **2.5.4** Activation par le mouvement | Les fonctions déclenchées par le mouvement ont un équivalent dans l’interface ET peuvent être désactivées | Gardez un bouton pour « secouer pour annuler » ; proposez un réglage |
| **2.5.7** Mouvements de glissement (2.2) | Chaque glissement a une alternative à pointeur unique | Des boutons « Monter »/« Descendre » à côté d’une poignée de glissement ; un champ numérique à côté d’un curseur |
| **2.5.8** Taille de la cible (2.2) | Les cibles mesurent au moins 24×24 px CSS | Ou sont espacées de sorte que des cercles de 24px ne se chevauchent pas ; les liens en ligne dans le texte sont exemptés |

```html
<!-- ✓ drag remains, but is never the only way -->
<li draggable="true">
  Task one
  <button aria-label="Move “Task one” up">↑</button>
  <button aria-label="Move “Task one” down">↓</button>
</li>
```

Le 2.5.8 se tranche sur le rendu — `scan` le mesure via la règle `target-size` d’axe.

## Orientation, redistribution, espacement, zoom (1.3.4, 1.4.4, 1.4.10, 1.4.12)

Les quatre se tranchent sur la page rendue (`scan` sonde le zoom, l’espacement et le
débordement). Ce qu’il faut vérifier :

- **1.3.4 Orientation** — le contenu fonctionne en portrait comme en paysage, sauf si
  l’orientation est réellement essentielle (un clavier de piano, un chèque à photographier). Un
  `transform` CSS ou une media query d’orientation bloquante est le coupable habituel.
- **1.4.4 Redimensionnement du texte** — à 200 % de zoom du texte, rien n’est perdu, tronqué ni
  superposé. Un `meta viewport` qui bloque le zoom échoue d’emblée (règle du moteur :
  `meta-viewport-zoom-block`).
- **1.4.10 Redistribution** — à **320 px CSS** de large (l’équivalent d’un zoom à 400 % sur un
  viewport de 1280px), aucun défilement bidimensionnel n’est requis, sauf pour un contenu qui en a
  intrinsèquement besoin : cartes, tableaux de données, diagrammes, code.
- **1.4.12 Espacement du texte** — forcer une hauteur de ligne de 1,5×, un espacement des
  paragraphes de 2×, un espacement des lettres de 0,12× et un espacement des mots de 0,16× ne fait
  perdre aucun contenu. Ce sont les conteneurs à hauteur fixe qui cassent.

## Mouvement et sécurité vestibulaire (2.3.1, 2.2.2)

```css
/* Respect the OS-level preference — a one-line win that costs nothing */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`prefers-reduced-motion` n’est pas en soi une exigence WCAG 2.2 AA, mais les grands effets de
parallaxe, les mouvements en lecture automatique et les transitions pleine page déclenchent des
troubles vestibulaires, et le respecter est la façon d’éviter entièrement le problème du 2.2.2.
Le 2.3.1 (rien ne flashe plus de trois fois par seconde) se tranche sur le rendu.

## Ce que le moteur tranche, et ce qui vous revient

| Tranché par le moteur | Tranché par `scan` | À vous d’arbitrer |
|---|---|---|
| `autoplay` sans mécanisme d’arrêt ; `meta viewport` qui bloque le zoom ; `blink`/`marquee` ; `meta refresh` temporisé | Zoom à 200 %, redistribution à 320px, espacement du texte, taille de la cible, flashs | Si les sous-titres/l’audiodescription/les transcriptions existent et sont exacts (1.2.x) |
| `<track>` manquant — comme recommandation, pas comme échec | — | Si un geste, un glissement ou un déclencheur par le mouvement a une alternative (2.5.1/2.5.2/2.5.4/2.5.7) |
| — | — | Si une orientation est réellement essentielle (1.3.4) |
