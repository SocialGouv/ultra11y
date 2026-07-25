// The HTML autofill vocabulary — the basis for WCAG 1.3.5 "Identify Input Purpose".
//
// 1.3.5 asks that a field collecting information ABOUT THE USER declare its purpose with a
// token from the WCAG "Input Purposes for User Interface Components" list, which is a
// subset of HTML's autofill field names. A misspelled or invented token is worse than no
// token at all: it looks compliant, silently autofills nothing and helps nobody.
//
// Source: https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill
//         https://www.w3.org/TR/WCAG22/#input-purposes

/** Autofill field names that identify information about the user (WCAG §7). */
export const AUTOFILL_FIELD_NAMES = new Set([
  "name",
  "honorific-prefix",
  "given-name",
  "additional-name",
  "family-name",
  "honorific-suffix",
  "nickname",
  "organization-title",
  "username",
  "new-password",
  "current-password",
  "one-time-code",
  "organization",
  "street-address",
  "address-line1",
  "address-line2",
  "address-line3",
  "address-level4",
  "address-level3",
  "address-level2",
  "address-level1",
  "country",
  "country-name",
  "postal-code",
  "cc-name",
  "cc-given-name",
  "cc-additional-name",
  "cc-family-name",
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-type",
  "transaction-currency",
  "transaction-amount",
  "language",
  "bday",
  "bday-day",
  "bday-month",
  "bday-year",
  "sex",
  "url",
  "photo",
  "tel",
  "tel-country-code",
  "tel-national",
  "tel-area-code",
  "tel-local",
  "tel-local-prefix",
  "tel-local-suffix",
  "tel-extension",
  "email",
  "impp",
]);

// Contact-type qualifiers, legal only in front of tel/email/impp-family field names.
const CONTACT_TOKENS = new Set(["home", "work", "mobile", "fax", "pager"]);
// Address-purpose qualifiers, legal in front of any field name.
const PURPOSE_TOKENS = new Set(["shipping", "billing"]);
// Field names that accept a contact qualifier.
const CONTACTABLE = /^(tel|email|impp)(-|$)/;

/** Is `value` a well-formed autocomplete attribute? Follows the HTML grammar:
 *  `[section-*] [shipping|billing] [home|work|mobile|fax|pager] <field-name> [webauthn]`,
 *  plus the standalone `on` / `off` switches. */
export function isValidAutocomplete(value: string): boolean {
  const tokens = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length === 1 && (tokens[0] === "on" || tokens[0] === "off")) return true;

  let i = 0;
  if (tokens[i]?.startsWith("section-") && tokens[i]!.length > "section-".length) i++;
  if (tokens[i] && PURPOSE_TOKENS.has(tokens[i]!)) i++;
  const contactAt = i;
  if (tokens[i] && CONTACT_TOKENS.has(tokens[i]!)) i++;

  const field = tokens[i];
  if (!field || !AUTOFILL_FIELD_NAMES.has(field)) return false;
  // A contact qualifier only makes sense on the tel/email/impp family.
  if (contactAt !== i && !CONTACTABLE.test(field)) return false;
  i++;

  if (tokens[i] === "webauthn") i++;
  return i === tokens.length;
}

/** Credential fields whose autofill must NOT be suppressed: blocking the password manager
 *  is what WCAG 2.2's 3.3.8 Accessible Authentication is about. */
export const CREDENTIAL_FIELDS = new Set(["username", "current-password", "new-password", "one-time-code", "email"]);
