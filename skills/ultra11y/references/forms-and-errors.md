# Forms, errors and authentication

Forms are where accessibility failures cost the most: a broken image is an annoyance, an
unusable form is a transaction the user cannot complete. This page covers 1.3.5, 3.2.2,
3.3.1–3.3.4 and WCAG 2.2's 3.3.7/3.3.8.

## Labels and instructions (3.3.2, 4.1.2)

```html
<!-- ✓ the association is programmatic, and clicking the text focuses the field -->
<label for="email">Email address</label>
<input id="email" type="email" name="email" autocomplete="email"
       aria-describedby="email-hint" required>
<p id="email-hint">We use it only to send your receipt.</p>
```

- A `placeholder` is **not** a label: it disappears on input, is often too low-contrast, and
  is announced inconsistently. Keep it for an example (`e.g. name@example.com`), never for
  the label. Engine rule: `placeholder-as-label`.
- State the format **before** the error, not only in it: `aria-describedby` on the field.
- `required` on the control is what assistive tech announces. A red asterisk alone is a
  1.4.1 failure too — pair it with text ("Required fields are marked *", or a real word).
- Group related controls: radios and checkboxes in `<fieldset><legend>`, a date split across
  three inputs likewise. Engine rules: `fieldset-legend-missing`,
  `radio-checkbox-group-ungrouped`, `date-fields-ungrouped`.

## 1.3.5 Identify Input Purpose — the token list

A field collecting information **about the user** must declare its purpose. The token has to
come from the HTML autofill vocabulary; an invented one reads as compliant and fills nothing
(engine rule: `autocomplete-token-invalid`).

| Group | Tokens |
|---|---|
| Identity | `name` `honorific-prefix` `given-name` `additional-name` `family-name` `honorific-suffix` `nickname` `organization-title` `organization` `sex` `bday` `bday-day` `bday-month` `bday-year` `photo` `language` |
| Credentials | `username` `new-password` `current-password` `one-time-code` |
| Address | `street-address` `address-line1` `address-line2` `address-line3` `address-level1`…`address-level4` `country` `country-name` `postal-code` |
| Payment | `cc-name` `cc-given-name` `cc-additional-name` `cc-family-name` `cc-number` `cc-exp` `cc-exp-month` `cc-exp-year` `cc-csc` `cc-type` `transaction-currency` `transaction-amount` |
| Contact | `tel` `tel-country-code` `tel-national` `tel-area-code` `tel-local` `tel-local-prefix` `tel-local-suffix` `tel-extension` `email` `impp` `url` |

Qualifiers may precede the token: `section-*` (to separate two addresses on one form), then
`shipping`/`billing`, then `home`/`work`/`mobile`/`fax`/`pager` (contact fields only).

```html
<input autocomplete="shipping postal-code">      <!-- ✓ -->
<input autocomplete="section-work work email">   <!-- ✓ -->
<input autocomplete="postcode">                  <!-- ✗ not a token -->
```

**Applicability:** the criterion covers the USER's own data. An order number, a search term
or a quantity is not in scope — that is a legitimate `NA` on the field.

## 3.3.1 / 3.3.3 — identifying and fixing errors

```html
<label for="dob">Date of birth</label>
<input id="dob" name="dob" aria-invalid="true"
       aria-describedby="dob-err" aria-errormessage="dob-err">
<p id="dob-err">Enter the date as DD/MM/YYYY — for example 04/03/1990.</p>
```

- The error must be **in text**, not only a red border (1.4.1 + 3.3.1).
- It must be **associated** with its field. Engine rules: `error-not-associated`,
  `aria-invalid-no-description`.
- 3.3.3 asks for the **correction** when it is knowable: "Enter DD/MM/YYYY" beats "Invalid
  date". Withhold only where suggesting it would compromise security.

**Error summary pattern** — for a form with several errors, put a summary at the top, move
focus to it on submit, and link each entry to its field:

```html
<div role="alert" tabindex="-1" id="errors">
  <h2>There are 2 problems with this form</h2>
  <ul>
    <li><a href="#dob">Date of birth: enter the date as DD/MM/YYYY</a></li>
    <li><a href="#email">Email address: enter an address with an @</a></li>
  </ul>
</div>
```

Focus the summary (not the first field): the user hears how many problems there are before
being dropped into one of them.

## 3.2.2 On Input / 3.2.1 On Focus

Changing a value, or merely receiving focus, must not by itself change the context.

```html
<!-- ✗ selecting an option navigates; keyboard users trigger it while browsing the list -->
<select onchange="location = this.value">…</select>

<!-- ✓ the change is explicit, and announced beforehand -->
<label for="lang">Language</label>
<select id="lang">…</select>
<button type="submit">Change language</button>
```

Engine rule: `on-input-context-change`. Auto-advancing between one-character code fields is
the same failure in a friendlier costume — allow it, but keep the form usable without it.

## 3.3.4 Error Prevention (legal, financial, data)

For submissions that are legally binding, financial, or that modify/delete user data, one of
these must hold: **reversible**, **checked** (errors detected and a chance to correct), or
**confirmed** (a review step before the final commit). A one-click irreversible delete fails.

## 3.3.7 Redundant Entry (WCAG 2.2)

Information already entered in the same process must not be asked for again — auto-populate
it, or offer it for selection. Exceptions: re-entry is essential (confirming a password),
the earlier information is no longer valid, or it would compromise security.

```html
<!-- ✓ the shipping address is offered rather than retyped -->
<label><input type="checkbox" name="same" checked> Billing address is the same as shipping</label>
```

## 3.3.8 Accessible Authentication (WCAG 2.2)

No step of an authentication process may require a **cognitive function test** — memorising,
transcribing, or solving a puzzle — unless an alternative, a mechanism to help, object
recognition, or user-provided content is available.

```html
<!-- ✗ blocking paste turns login into a memory test and breaks password managers -->
<input type="password" onpaste="return false">
<!-- ✗ autofill switched off on a credential field -->
<input type="password" autocomplete="off">

<!-- ✓ declare the real purpose; let the manager fill and the user paste -->
<input type="password" autocomplete="current-password">
<input type="text" inputmode="numeric" autocomplete="one-time-code">
```

Engine rule: `credential-entry-blocked`. Also in scope: a transcription CAPTCHA with no
alternative, and a code the user must retype from another screen with no way to paste.

## What the engine settles, and what stays yours

| Decided by the engine | Yours to adjudicate |
|---|---|
| Missing/duplicate labels, placeholder-as-label, ungrouped radios and date parts | Whether a label is **descriptive** (2.4.6) and an instruction sufficient (3.3.2) |
| `autocomplete` token outside the vocabulary | Whether the field collects **user** data at all (1.3.5 applicability) |
| Error text not associated, `aria-invalid` with no description | Whether the message says **how to fix it** (3.3.3) |
| Paste/autofill blocked on a credential field | Whether the whole auth flow imposes a cognitive test (3.3.8) |
| `onchange` that submits or navigates | Whether a context change was **announced beforehand** (3.2.2) |
| — | Redundant entry across a multi-step flow (3.3.7) |
