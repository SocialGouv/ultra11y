# Formulaires, erreurs et authentification

Les formulaires sont l’endroit où les défauts d’accessibilité coûtent le plus cher : une image
cassée est une gêne, un formulaire inutilisable est une transaction que l’utilisateur ne peut pas
mener à bien. Cette page couvre 1.3.5, 3.2.2, 3.3.1–3.3.4 et les 3.3.7/3.3.8 des WCAG 2.2.

## Étiquettes et instructions (3.3.2, 4.1.2)

```html
<!-- ✓ the association is programmatic, and clicking the text focuses the field -->
<label for="email">Email address</label>
<input id="email" type="email" name="email" autocomplete="email"
       aria-describedby="email-hint" required>
<p id="email-hint">We use it only to send your receipt.</p>
```

- Un `placeholder` n’est **pas** une étiquette : il disparaît à la saisie, a souvent un contraste
  trop faible et est restitué de façon inégale. Réservez-le à un exemple
  (`e.g. name@example.com`), jamais à l’étiquette. Règle du moteur : `placeholder-as-label`.
- Indiquez le format **avant** l’erreur, pas seulement dans celle-ci : `aria-describedby` sur le
  champ.
- C’est le `required` sur le contrôle que les technologies d’assistance restituent. Un astérisque
  rouge seul est aussi un défaut au titre du 1.4.1 — associez-le à du texte (« Les champs
  obligatoires sont marqués d’un * », ou un vrai mot).
- Regroupez les contrôles liés : boutons radio et cases à cocher dans `<fieldset><legend>`, de
  même pour une date répartie sur trois champs. Règles du moteur : `fieldset-legend-missing`,
  `radio-checkbox-group-ungrouped`, `date-fields-ungrouped`.

## 1.3.5 Identifier la finalité des champs — la liste des jetons

Un champ qui collecte des informations **sur l’utilisateur** doit déclarer sa finalité. Le jeton
doit provenir du vocabulaire d’autocomplétion HTML ; un jeton inventé a l’air conforme et ne
remplit rien (règle du moteur : `autocomplete-token-invalid`).

| Groupe | Jetons |
|---|---|
| Identité | `name` `honorific-prefix` `given-name` `additional-name` `family-name` `honorific-suffix` `nickname` `organization-title` `organization` `sex` `bday` `bday-day` `bday-month` `bday-year` `photo` `language` |
| Identifiants | `username` `new-password` `current-password` `one-time-code` |
| Adresse | `street-address` `address-line1` `address-line2` `address-line3` `address-level1`…`address-level4` `country` `country-name` `postal-code` |
| Paiement | `cc-name` `cc-given-name` `cc-additional-name` `cc-family-name` `cc-number` `cc-exp` `cc-exp-month` `cc-exp-year` `cc-csc` `cc-type` `transaction-currency` `transaction-amount` |
| Contact | `tel` `tel-country-code` `tel-national` `tel-area-code` `tel-local` `tel-local-prefix` `tel-local-suffix` `tel-extension` `email` `impp` `url` |

Des qualificatifs peuvent précéder le jeton : `section-*` (pour séparer deux adresses dans un même
formulaire), puis `shipping`/`billing`, puis `home`/`work`/`mobile`/`fax`/`pager` (champs de
contact uniquement).

```html
<input autocomplete="shipping postal-code">      <!-- ✓ -->
<input autocomplete="section-work work email">   <!-- ✓ -->
<input autocomplete="postcode">                  <!-- ✗ not a token -->
```

**Applicabilité :** le critère couvre les données propres de l’UTILISATEUR. Un numéro de
commande, un terme de recherche ou une quantité ne sont pas dans le périmètre — c’est un `NA`
légitime sur le champ.

## 3.3.1 / 3.3.3 — identifier et corriger les erreurs

```html
<label for="dob">Date of birth</label>
<input id="dob" name="dob" aria-invalid="true"
       aria-describedby="dob-err" aria-errormessage="dob-err">
<p id="dob-err">Enter the date as DD/MM/YYYY — for example 04/03/1990.</p>
```

- L’erreur doit être **sous forme de texte**, pas seulement une bordure rouge (1.4.1 + 3.3.1).
- Elle doit être **associée** à son champ. Règles du moteur : `error-not-associated`,
  `aria-invalid-no-description`.
- Le 3.3.3 demande la **correction** quand elle peut être connue : « Saisissez JJ/MM/AAAA » vaut
  mieux que « Date invalide ». Ne la taisez que là où la suggérer compromettrait la sécurité.

**Motif du récapitulatif d’erreurs** — pour un formulaire comportant plusieurs erreurs, placez un
récapitulatif en haut, déplacez-y le focus à la soumission, et liez chaque entrée à son champ :

```html
<div role="alert" tabindex="-1" id="errors">
  <h2>There are 2 problems with this form</h2>
  <ul>
    <li><a href="#dob">Date of birth: enter the date as DD/MM/YYYY</a></li>
    <li><a href="#email">Email address: enter an address with an @</a></li>
  </ul>
</div>
```

Donnez le focus au récapitulatif (pas au premier champ) : l’utilisateur entend combien il y a de
problèmes avant d’être déposé dans l’un d’eux.

## 3.2.2 À la saisie / 3.2.1 Au focus

Modifier une valeur, ou simplement recevoir le focus, ne doit pas à lui seul changer le contexte.

```html
<!-- ✗ selecting an option navigates; keyboard users trigger it while browsing the list -->
<select onchange="location = this.value">…</select>

<!-- ✓ the change is explicit, and announced beforehand -->
<label for="lang">Language</label>
<select id="lang">…</select>
<button type="submit">Change language</button>
```

Règle du moteur : `on-input-context-change`. Le passage automatique d’un champ de code à un
caractère au suivant est le même défaut sous un costume plus aimable — autorisez-le, mais gardez
le formulaire utilisable sans lui.

## 3.3.4 Prévention des erreurs (juridiques, financières, données)

Pour les soumissions qui ont une valeur juridique, financière, ou qui modifient/suppriment des
données de l’utilisateur, l’une de ces conditions doit être remplie : **réversible**,
**contrôlée** (erreurs détectées et possibilité de corriger) ou **confirmée** (une étape de
vérification avant la validation finale). Une suppression irréversible en un clic échoue.

## 3.3.7 Saisie redondante (WCAG 2.2)

Une information déjà saisie dans le même processus ne doit pas être redemandée — pré-remplissez-la
ou proposez-la à la sélection. Exceptions : la nouvelle saisie est essentielle (confirmation d’un
mot de passe), l’information antérieure n’est plus valide, ou cela compromettrait la sécurité.

```html
<!-- ✓ the shipping address is offered rather than retyped -->
<label><input type="checkbox" name="same" checked> Billing address is the same as shipping</label>
```

## 3.3.8 Authentification accessible (WCAG 2.2)

Aucune étape d’un processus d’authentification ne peut exiger un **test de fonction cognitive** —
mémoriser, transcrire ou résoudre une énigme — sauf si une alternative, un mécanisme d’aide, une
reconnaissance d’objets ou un contenu fourni par l’utilisateur est disponible.

```html
<!-- ✗ blocking paste turns login into a memory test and breaks password managers -->
<input type="password" onpaste="return false">
<!-- ✗ autofill switched off on a credential field -->
<input type="password" autocomplete="off">

<!-- ✓ declare the real purpose; let the manager fill and the user paste -->
<input type="password" autocomplete="current-password">
<input type="text" inputmode="numeric" autocomplete="one-time-code">
```

Règle du moteur : `credential-entry-blocked`. Également dans le périmètre : un CAPTCHA de
transcription sans alternative, et un code que l’utilisateur doit ressaisir depuis un autre écran
sans possibilité de le coller.

## Ce que le moteur tranche, et ce qui vous revient

| Tranché par le moteur | À vous d’arbitrer |
|---|---|
| Étiquettes manquantes/dupliquées, placeholder utilisé comme étiquette, boutons radio et parties de date non regroupés | Si une étiquette est **descriptive** (2.4.6) et une instruction suffisante (3.3.2) |
| Jeton `autocomplete` hors du vocabulaire | Si le champ collecte bien des données de l’**utilisateur** (applicabilité du 1.3.5) |
| Texte d’erreur non associé, `aria-invalid` sans description | Si le message dit **comment corriger** (3.3.3) |
| Collage/autocomplétion bloqués sur un champ d’identifiant | Si l’ensemble du parcours d’authentification impose un test cognitif (3.3.8) |
| `onchange` qui soumet ou navigue | Si un changement de contexte a été **annoncé au préalable** (3.2.2) |
| — | Saisie redondante dans un parcours en plusieurs étapes (3.3.7) |
