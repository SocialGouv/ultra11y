# Parcours — les chemins utilisateur que vous écrivez, ultra11y les rejoue

`scan` ouvre des pages et n’effectue que des interactions sûres et automatiques. Il ne se connecte
jamais, ne soumet jamais de formulaire, ne parcourt jamais un tunnel. Un **parcours** est cette suite
d’actions, écrite par vous après avoir lu l’application, et rejouée par `journey run` dans le
Playwright local avec l’axe-core épinglé et les sondes en direct. Chaque étape enregistre un état de
page dans `.ultra11y/pages/<journey>-<nn>-<slug>/`, au même format que `scan`, de sorte que chaque état
devient une page auditée de la grille.

```sh
node scripts/ultra11y.mjs journey list
node scripts/ultra11y.mjs journey run --all --keyboard --base-url http://localhost:3000 \
  --merge audits/audit-latest.json --out audits
```

`journey run <name>…` rejoue certains parcours et `--all` les rejoue tous. `--storage-state
<file>` charge une session, et le `storageState` propre à un parcours l’emporte sur elle. `--merge`
replie les états dans l’audit, comme le fait `scan --merge`. La commande sort avec 1 quand un parcours
a échoué.

## Le fichier : `.ultra11y/journeys/<name>.json`

| Clé | |
|---|---|
| `name` | `[a-z0-9-]`, préfixe les ids des étapes |
| `startUrl` | absolue, ou un chemin résolu par rapport à `--base-url` (étape 0) |
| `storageState` | fichier de session Playwright facultatif, relatif à la racine |
| `keyboardOnly` | facultatif, équivaut à `--keyboard` |
| `steps` | `{ action, target?, value?, url?, key?, state?, timeoutMs?, note? }` |

Actions : `goto` (`url`), `click`, `fill` (`value`), `select` (`value`), `check`, `press` (`key` :
`Tab`, `Enter`, `Escape`, `ArrowDown`, avec une cible facultative), `waitFor` et `expect` (`state` :
`visible` par défaut, ou `hidden`, `attached`, `detached`). Une cible est exactement l’une de
`{ "role", "name"?, "exact"? }`, `{ "label" }`, `{ "text" }` ou `{ "css" }`. Préférez le rôle et
l’étiquette : c’est ce que perçoit un utilisateur. Le validateur est strict : une clé inconnue, une
valeur manquante ou une cible ambiguë est une erreur accompagnée de son chemin (`journey list` les
affiche).

## Ce que mesure le rejeu

À chaque étape, il exécute axe, les sondes (zoom, reflow, espacement du texte, visibilité du focus,
piège clavier sur l’anneau, survol), et ces observations de parcours :

| Observation | WCAG | RGAA |
|---|---|---|
| Mode clavier : Tab parcourt tout l’ordre et n’atteint jamais le contrôle | 2.1.1 (bloquant) | 7.3 |
| Ni Tab ni Shift+Tab ne permettent de quitter une région | 2.1.2 (bloquant) | 12.9 |
| Focus non déplacé dans une boîte de dialogue ouverte, ou non rendu à l’élément qui l’a ouverte | 2.4.3 | 12.8 |
| Une erreur affichée après une action, liée à aucun champ (`aria-describedby`, `aria-errormessage`, `<label>`) | 3.3.1 | 11.10 |
| Du texte qui apparaît hors de toute région live après une action | 4.1.3 (mineur) | 7.5 |

En mode clavier, `click`, `check`, `fill` et `select` atteignent d’abord leur cible avec Tab (et
Shift+Tab), puis appuient sur Entrée ou Espace, ou saisissent le texte. Chaque étape enregistre l’ordre
de focus qu’elle a parcouru. Un contrôle qui ne peut pas être atteint est un constat. L’étape est alors
jouée avec le pointeur, pour que le reste du parcours soit quand même mesuré, et l’annexe le signale.

**Honnêteté.** Une étape dont le localisateur ne correspond à rien, dont la navigation échoue ou
aboutit ailleurs, ou qui dépasse son délai arrête son parcours, avec le motif. Les étapes suivantes
sont `not run`. L’annexe H liste chaque parcours et chaque étape : effectuée, en échec (avec le motif)
ou non exécutée. Un fichier de parcours qui n’a jamais été rejoué est listé aussi.

## Exemple — connexion, clavier uniquement

```json
{
  "name": "connexion",
  "startUrl": "/connexion",
  "keyboardOnly": true,
  "steps": [
    { "action": "fill", "target": { "label": "Adresse électronique" }, "value": "test@example.org" },
    { "action": "fill", "target": { "label": "Mot de passe" }, "value": "pas-le-bon" },
    { "action": "click", "target": { "role": "button", "name": "Se connecter" }, "note": "invalid submit" },
    { "action": "expect", "target": { "text": "Identifiants incorrects" } },
    { "action": "fill", "target": { "label": "Mot de passe" }, "value": "motdepasse-de-test" },
    { "action": "click", "target": { "role": "button", "name": "Se connecter" } },
    { "action": "expect", "target": { "role": "heading", "name": "Tableau de bord" } }
  ]
}
```

## Exemple — une modale et un menu

```json
{
  "name": "aide",
  "startUrl": "/",
  "steps": [
    { "action": "click", "target": { "role": "button", "name": "Menu" } },
    { "action": "expect", "target": { "role": "link", "name": "Contact" } },
    { "action": "press", "key": "Escape" },
    { "action": "click", "target": { "role": "button", "name": "Aide" } },
    { "action": "expect", "target": { "role": "dialog", "name": "Aide" } },
    { "action": "press", "key": "Escape", "note": "focus must return to « Aide »" }
  ]
}
```

Utilisez uniquement des comptes de test et des valeurs synthétiques. Ne mettez jamais un vrai
identifiant dans un fichier de parcours : commitez le fichier, pas une session. Passez la session avec
`--storage-state`.
