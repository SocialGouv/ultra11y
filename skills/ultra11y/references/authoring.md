# Écrire / relire du HTML/CSS accessible (sans régression)

Doctrine : **HTML natif sémantique d’abord, ARIA en dernier** (natif d’abord, ARIA en dernier).
N’ajoutez ARIA que lorsqu’aucun élément natif ne convient, et ne dupliquez jamais la sémantique
implicite (voir `references/forbidden-patterns.md`).

## Boucle de relecture

1. **Structure et régions** — un seul `<main>`, `<header>/<nav>/<footer>`, des titres `h1…h6`
   sans saut de niveau, de vraies listes (`ul/ol/dl`).
2. **Noms accessibles** — chaque lien/bouton a un intitulé ; chaque champ a un `<label>`
   associé (pas seulement un `placeholder`).
3. **Images et icônes** — un `alt` pertinent si l’image est informative, `alt=""` si elle est
   décorative, un nom sur les contrôles composés d’une seule icône.
4. **Tableaux** — `<caption>`, `<th scope>`, association cellule↔en-tête.
5. **Clavier** — tout est atteignable et utilisable au clavier ; aucun `tabindex` positif ;
   focus visible (à vérifier au rendu) ; un lien d’évitement qui fonctionne.
6. **Langue et titre** — `<html lang>`, un `<title>` pertinent, changements de langue
   signalés.

## Repérer les régressions tôt

Avant de livrer le code, auditez l’extrait :
```
node scripts/ultra11y.mjs audit - < component.html
node scripts/ultra11y.mjs audit "src/components/**/*.tsx" --jsx
```
Corrigez par priorité : sémantique native → noms/intitulés → clavier → focus → information
non portée par la seule couleur/forme → médias.

## Définition de « terminé »

Une modification est « terminée » quand : la sémantique native est correcte, les noms
accessibles sont présents, l’accès clavier est préservé, aucune régression n’est introduite,
et les points non vérifiables statiquement (contraste, focus visible, zoom) sont **signalés
comme risques résiduels** au lieu d’être supposés OK.

Pour le sens exact d’un critère : `node scripts/ultra11y.mjs criteria <sc>`.
