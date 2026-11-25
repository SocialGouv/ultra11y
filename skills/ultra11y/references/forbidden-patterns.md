# Anti-patterns interdits (HTML/CSS accessible)

15 pièges courants. Format : ❌ mauvais → pourquoi → ✅ correctif natif → critère de succès WCAG
(règle du moteur quand c’est détecté statiquement).

### 1. `<div>`/`<span>` cliquable
❌ `<div onClick={…}>` → non focalisable, non utilisable au clavier, sans rôle.
✅ `<button type="button">` natif. WCAG 2.1.1 / 4.1.2 (`clickable-noninteractive`).

### 2. `<html>` sans `lang`
❌ langue par défaut non déclarée → mauvaise prononciation par le lecteur d’écran.
✅ `<html lang="en">`. WCAG 3.1.1 (`html-lang-missing`).

### 3. Page sans `<title>` (ou vide)
❌ titre d’onglet/d’historique absent. ✅ un `<title>` pertinent. WCAG 2.4.2 (`title-missing-empty`).

### 4. Lien ou bouton vide
❌ `<a href="/"></a>`, `<button></button>` → pas de nom accessible.
✅ texte visible, ou `aria-label`. WCAG 2.4.4 / 4.1.2 (`link-empty-name`, `button-empty-name`).

### 5. Contrôle icône seule sans nom
❌ `<button><svg/></button>` sans nom. ✅ `aria-label` ou texte masqué visuellement.
WCAG 2.4.4 / 4.1.2 (`icon-only-control-unnamed`).

### 6. `<label>` non associé au champ
❌ une étiquette visuelle sans `for` ni enveloppement. ✅ `<label for="id">` ou un label englobant.
WCAG 4.1.2 (`control-label-missing`).

### 7. `placeholder` utilisé comme étiquette
❌ placeholder seul → disparaît à la saisie, ce n’est pas une étiquette. ✅ un vrai `<label>`.
WCAG 4.1.2 (`placeholder-as-label`).

### 8. `outline: none` / `outline: 0` sur un élément focalisable
❌ supprime l’indicateur de focus clavier. ✅ conserver/styler un focus visible.
WCAG 2.4.7 (nécessite le rendu — vérifier manuellement).

### 9. `tabindex` positif
❌ `tabindex="1"` casse l’ordre logique du DOM. ✅ `tabindex="0"` ou rien.
WCAG 2.4.3 (`positive-tabindex`).

### 10. Texte informatif incrusté dans une image
❌ texte en image sans alternative. ✅ du vrai texte stylé en CSS. WCAG 1.4.5 (jugement).

### 11. Sens porté par le CSS seul (`::before`/`::after`)
❌ information injectée uniquement par les styles. ✅ le texte dans le HTML. WCAG 1.3.1 (jugement/rendu).

### 12. Lien d’évitement masqué avec `display:none`
❌ cible absente ou lien d’évitement non focalisable. ✅ une vraie cible + visible au focus.
WCAG 2.4.1 (`skip-link-target-missing` pour la cible).

### 13. Navigation non structurée en liste
❌ une suite de liens sans `<ul>`. ✅ `<nav><ul><li>…`. WCAG 1.3.1 (jugement).

### 14. Tableau de données sans en-têtes
❌ `<table>` sans `<th>`/`scope`/`<caption>`. ✅ en-têtes + `scope` + titre (caption).
WCAG 1.3.1 (`data-table-no-headers`, `table-caption-missing`).

### 15. ARIA redondant ou cassé
❌ `<button role="button">`, `aria-labelledby="nonexistent-id"`, un rôle inventé.
✅ sémantique native ; références ARIA valides. WCAG 4.1.2 (`redundant-aria`,
`aria-ref-missing-id`, `invalid-aria-role`).
