// Theme 11 — Forms: every field has a programmatic label + group/structure checks.
import type { Doc, El } from "../parse/html.js";
import { attr, hasAttr, hasDynamicSpread, descendants, ancestors, visibleText, textContent } from "../parse/html.js";
import { isIntrinsic } from "../parse/jsx-bridge.js";
import { controlLabel, isFormField, mayInjectContent, isNameExempt } from "../name.js";
import { isValidAutocomplete, CREDENTIAL_FIELDS } from "../autofill.js";

// The element's WHOLE content is a slot/snippet passthrough — a DIRECT `<slot>` child or
// a `{@render …}`/`{children}` render-expression text node — so the legend the caller
// provides is invisible here. (Must be a direct child: a fieldset that merely *contains*
// component fields with no legend is a real violation, not a passthrough.)
function contentInjected(el: El): boolean {
  return el.children.some((c) => (c.type === "element" && c.tag === "slot") || (c.type === "text" && /\{@render|\{children/.test(c.data)));
}
import type { Rule, RuleFinding } from "./rule.js";

// title/placeholder are NOT real labels for these rules
const REAL_LABEL = new Set(["for", "wrapping", "aria-label", "aria-labelledby"]);

const controlLabelMissing: Rule = {
  id: "control-label-missing",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isFormField(el)) continue;
      if (isNameExempt(el)) continue; // not exposed, or explicitly presentational
      const { via } = controlLabel(el, doc);
      if (via && REAL_LABEL.has(via)) continue;
      // title yields an accessible name (accname fallback / WCAG H65) — a weak one, surfaced
      // as a minor control-name-title-only finding, not a blocking "no label".
      if (via === "title") continue;
      // A spread (JSX {...props} / Vue v-bind="…" / Svelte {...rest}) may inject
      // aria-label/aria-labelledby we can't see — don't assert a missing label.
      if (hasDynamicSpread(el)) continue;
      if (hasAttr(el, "placeholder")) continue; // reported by placeholder-as-label
      out.push({
        criteriaId: "4.1.2",
        el,
        msgId: "control-label-missing",
        params: { tag: el.tag },
      });
    }
    return out;
  },
};

const placeholderAsLabel: Rule = {
  id: "placeholder-as-label",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isFormField(el)) continue;
      if (!hasAttr(el, "placeholder")) continue;
      const { via } = controlLabel(el, doc);
      if (via && REAL_LABEL.has(via)) continue;
      out.push({
        criteriaId: "4.1.2",
        el,
        msgId: "placeholder-as-label",
        params: { value: attr(el, "placeholder") ?? "" },
      });
    }
    return out;
  },
};

const fieldsetLegendMissing: Rule = {
  id: "fieldset-legend-missing",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "fieldset") continue;
      const legend = el.children.find((c) => c.type === "element" && c.tag === "legend");
      if (legend && legend.type === "element" && visibleText(legend)) continue;
      if (hasAttr(el, "aria-label") || hasAttr(el, "aria-labelledby")) continue;
      if (contentInjected(el)) continue; // legend supplied via slot/{@render children()}/a component
      out.push({
        criteriaId: "1.3.1",
        el,
        msgId: "fieldset-legend-missing",
      });
    }
    return out;
  },
};

const formFieldMultipleLabels: Rule = {
  id: "form-field-multiple-labels",
  criteria: ["4.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const counts = new Map<string, number>();
    for (const el of doc.elements) {
      if (el.tag !== "label") continue;
      const f = attr(el, "for");
      if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isFormField(el)) continue;
      const id = attr(el, "id");
      if (id && (counts.get(id) ?? 0) > 1) {
        out.push({
          criteriaId: "4.1.2",
          el,
          msgId: "form-field-multiple-labels",
          params: { tag: el.tag, count: counts.get(id) ?? 0, id },
        });
      }
    }
    return out;
  },
};

const selectHasOption: Rule = {
  id: "select-has-option",
  criteria: ["4.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "select") continue;
      if (descendants(el).some((d) => d.tag === "option")) continue;
      if (mayInjectContent(el) || contentInjected(el)) continue; // options injected via <slot>/component/{@render}
      out.push({
        criteriaId: "4.1.2",
        el,
        msgId: "select-has-option",
      });
    }
    return out;
  },
};

// An attribute key that carries an element id (`id`, `inputId`, `data-testid`, `htmlFor`…):
// the signature a design-system component uses to hand an id down to the control it renders.
const ID_ATTR_KEY = /id/i;

// A <label for="x"> whose target id exists nowhere in the document — the visible label
// is not programmatically associated with any field (a common typo'd for/id pairing).
// Same-document only; cross-file label/field association is out of scope (see references/cross-file.md).
const labelForDangling: Rule = {
  id: "label-for-dangling",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    // value -> the elements carrying it under an id-bearing attribute key, built ONCE
    // and only when a dangling `for` is actually seen. The probe below used to be a full
    // `doc.elements.some(... Object.entries(e.attribs) ...)` scan *inside* the label loop:
    // quadratic, and on a form-heavy page it dominated the entire audit (~8 s for 8k labels).
    let idProps: Map<string, El[]> | undefined;
    const idPropCarriers = (value: string): El[] | undefined => {
      if (!idProps) {
        idProps = new Map();
        for (const e of doc.elements) {
          for (const k in e.attribs) {
            if (!ID_ATTR_KEY.test(k)) continue;
            const v = e.attribs[k];
            if (!v) continue;
            const bucket = idProps.get(v);
            // Attributes of one element are consecutive, so comparing the tail is enough
            // to keep an element from being counted twice (e.g. id="x" AND data-id="x").
            if (!bucket) idProps.set(v, [e]);
            else if (bucket[bucket.length - 1] !== e) bucket.push(e);
          }
        }
      }
      return idProps.get(value);
    };
    for (const el of doc.elements) {
      if (el.tag !== "label") continue;
      const f = (attr(el, "for") ?? "").trim();
      if (!f || f.includes("{")) continue; // empty, or a JSX expression remnant (dynamic for=)
      if (doc.byId.has(f)) continue;
      // Wired via an id-bearing prop on a sibling component? Design-system field/upload
      // components take the input id as a prop (e.g. <FileUpload inputId="x"/>) and render
      // the <input id="x"> internally — the association is real, just not a literal id here.
      const passedAsIdProp = idPropCarriers(f)?.some((e) => e !== el) ?? false;
      if (passedAsIdProp) continue;
      out.push({
        criteriaId: "1.3.1",
        el,
        msgId: "label-for-dangling",
        params: { id: f },
      });
    }
    return out;
  },
};

// WCAG 3.3.1 Error Identification: a control flagged aria-invalid="true" must point AT
// the error text (aria-describedby or aria-errormessage) so assistive tech can restitute
// *why* it is invalid. aria-invalid alone announces "invalid" with no reason — the error
// is signalled but not associated (cross-referenced by RGAA 11.10). The inverse case
// (visible error text not linked at all) is a judgment call left to the auditor.
const ariaInvalidNoDescription: Rule = {
  id: "aria-invalid-no-description",
  criteria: ["3.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isFormField(el)) continue;
      const invalid = attr(el, "aria-invalid");
      if (invalid === undefined || invalid.includes("{")) continue; // absent or dynamic value — nothing to assert
      if (invalid.trim().toLowerCase() !== "true") continue; // "false"/"grammar"/"spelling" are not unlinked errors
      if (hasAttr(el, "aria-describedby") || hasAttr(el, "aria-errormessage")) continue; // error text is linked
      if (hasDynamicSpread(el)) continue; // a spread (JSX {...props} / v-bind) may inject the description
      out.push({
        criteriaId: "3.3.1",
        el,
        msgId: "aria-invalid-no-description",
        params: { tag: el.tag },
      });
    }
    return out;
  },
};

// The complement of aria-invalid-no-description: a VISIBLE error-text node that carries
// a stable id but is referenced by NO field (no aria-describedby/aria-errormessage points
// at it). The error is shown but not programmatically tied to its field (WCAG 3.3.1).
// Only fired on a literal, present id with no literal referrer — provable, low FP.
const ERROR_TEXT_CLASS = /(^|[-_ ])(fr-error-text|fr-message--error|error-text|error-message|field-error|invalid-feedback)/i;

const errorNotAssociated: Rule = {
  id: "error-not-associated",
  criteria: ["3.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const referenced = new Set<string>();
    // Ids targeted by a same-document in-page anchor (<a href="#id">). An error SUMMARY that
    // a "jump to error" link points at is a page-level status region (G139), not a per-field
    // association gap — its restitution comes from the anchor + role/aria-live, not describedby.
    const anchorTargets = new Set<string>();
    for (const el of doc.elements) {
      if (el.tag === "a") {
        const href = (attr(el, "href") ?? "").trim();
        if (href.startsWith("#") && href.length > 1) anchorTargets.add(href.slice(1));
      }
      for (const a of ["aria-describedby", "aria-errormessage"]) {
        const v = attr(el, a);
        if (!v) continue;
        if (!v.includes("{")) {
          for (const id of v.split(/\s+/).filter(Boolean)) referenced.add(id);
        } else {
          // Dynamic value, e.g. aria-describedby={error ? "women-error" : undefined}. The
          // JSX parser keeps the raw `{…}` slice, so pull out any string-literal ids: a
          // conditionally-applied describedby still associates the error (common React
          // pattern) — otherwise the matching <p id="women-error"> is a false positive.
          for (const m of v.matchAll(/["'`]([^"'`]+)["'`]/g)) for (const id of m[1]!.split(/\s+/).filter(Boolean)) referenced.add(id);
        }
      }
    }
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const cls = attr(el, "class");
      if (!cls || !ERROR_TEXT_CLASS.test(cls)) continue;
      const id = (attr(el, "id") ?? "").trim();
      if (!id || id.includes("{")) continue; // no stable literal id to reference — not provable
      if (referenced.has(id)) continue; // already linked to a field
      // A live/alert summary region announces itself; it is not a per-field association gap.
      const role = (attr(el, "role") ?? "").trim();
      if (role === "alert" || role === "status" || hasAttr(el, "aria-live")) continue;
      if (anchorTargets.has(id)) continue; // an in-page "jump to error" link targets it — a summary, not a field error
      if (hasDynamicSpread(el)) continue;
      out.push({
        criteriaId: "3.3.1",
        el,
        msgId: "error-not-associated",
        params: { id },
      });
    }
    return out;
  },
};

// WCAG 1.3.5 (identify input purpose) + 4.1.2 (state). Two provable, conservative gaps:
//  (i)  an identify-purpose <input> (email/tel, or a purpose token in name/id) with no
//       autocomplete attribute — the field's purpose is not exposed programmatically.
//  (ii) a CUSTOM widget (role=textbox/combobox/checkbox/… on an intrinsic non-native
//       element) marked required by class but missing aria-required — required state lost.
const PURPOSE_TYPES = new Set(["email", "tel"]);
// Whole-token match (split on separators AND camelCase), so `city` doesn't match veloCITY
// and `tel` doesn't match hoTEL — an unanchored substring regex mislabels them 1.3.5 fields.
const PURPOSE_WORDS = new Set(["email", "tel", "telephone", "phone", "mobile", "postal", "zip", "address", "street", "city", "country"]);
const hasPurposeToken = (nameId: string): boolean => nameId.split(/[-_\s]+|(?<=[a-z0-9])(?=[A-Z])/).some((t) => PURPOSE_WORDS.has(t.toLowerCase()));
const SKIP_INPUT_TYPES = new Set(["search", "hidden", "submit", "reset", "button", "password", "checkbox", "radio", "file", "range", "color"]);
const CUSTOM_WIDGET_ROLES = new Set(["textbox", "combobox", "checkbox", "radio", "switch", "spinbutton"]);
const REQUIRED_SIGNAL = /(^|[-_ ])(required|mandatory|is-required)/i;

const fieldPurposeIncomplete: Rule = {
  id: "field-purpose-incomplete",
  criteria: ["1.3.5", "4.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      // (i) identify-purpose input without autocomplete (1.3.5)
      if (el.tag === "input") {
        const type = (attr(el, "type") ?? "text").toLowerCase();
        if (!type.includes("{") && !SKIP_INPUT_TYPES.has(type)) {
          const nameId = `${attr(el, "name") ?? ""} ${attr(el, "id") ?? ""}`;
          const purpose = PURPOSE_TYPES.has(type) || hasPurposeToken(nameId);
          if (purpose && !hasAttr(el, "autocomplete") && !hasDynamicSpread(el)) {
            out.push({
              criteriaId: "1.3.5",
              el,
              msgId: "field-purpose-incomplete.autocomplete",
              params: { type },
            });
          }
        }
      }
      // (ii) custom required widget without aria-required (4.1.2)
      const role = (attr(el, "role") ?? "").trim().toLowerCase();
      if (isIntrinsic(el.tag) && CUSTOM_WIDGET_ROLES.has(role) && REQUIRED_SIGNAL.test(attr(el, "class") ?? "")) {
        if (!hasAttr(el, "aria-required") && !hasAttr(el, "required") && !hasDynamicSpread(el)) {
          out.push({
            criteriaId: "4.1.2",
            el,
            msgId: "field-purpose-incomplete.aria-required",
            params: { role },
          });
        }
      }
    }
    return out;
  },
};

// ---- Grouping / read-only-context checks (RGAA 11.5 / 7.1 / 10.8) ----------------

// A group of controls shares a grouping ancestor when a <fieldset>, role="radiogroup"
// or role="group" wraps them — the relationship AT relies on to announce "1 of N".
const GROUPING_ROLES = new Set(["radiogroup", "group"]);
function inGroupingContext(el: El): boolean {
  return ancestors(el).some((a) => a.tag === "fieldset" || GROUPING_ROLES.has((attr(a, "role") ?? "").trim().toLowerCase()));
}

// A read-only recap wrapped in <fieldset disabled> or an [inert] container still holds
// controls the user perceives, but AT may skip them or announce them as unavailable
// (RGAA 7.1 + 10.8, WCAG 4.1.2). Suppressed when the disable is a TRANSIENT submission
// guard — aria-busy on the container/an ancestor, or a submit/reset control in the group
// (the whole form is momentarily locked while it posts), not a permanent read-only recap.
function isSubmitControl(el: El): boolean {
  if (el.tag === "button") return (attr(el, "type") ?? "submit").trim().toLowerCase() !== "button"; // bare <button> defaults to submit
  if (el.tag === "input") return ["submit", "reset"].includes((attr(el, "type") ?? "").trim().toLowerCase());
  return false;
}
function ariaBusyInScope(el: El): boolean {
  if ((attr(el, "aria-busy") ?? "").trim().toLowerCase() === "true") return true;
  return ancestors(el).some((a) => (attr(a, "aria-busy") ?? "").trim().toLowerCase() === "true");
}

const disabledContextContent: Rule = {
  id: "disabled-context-content",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const isDisabledFieldset = el.tag === "fieldset" && hasAttr(el, "disabled");
      const isInert = hasAttr(el, "inert");
      if (!isDisabledFieldset && !isInert) continue;
      const desc = descendants(el);
      if (!desc.some(isFormField)) continue; // no wrapped controls — nothing removed from the a11y tree
      if (hasDynamicSpread(el)) continue; // a spread may inject aria-disabled semantics we can't see
      if (ariaBusyInScope(el)) continue; // transient submission state, not a read-only recap
      if (desc.some(isSubmitControl)) continue; // a submit/reset in the group ⇒ form locked while posting
      if (isInert) out.push({ criteriaId: "4.1.2", el, msgId: "disabled-context-content.inert" });
      else out.push({ criteriaId: "4.1.2", el, msgId: "disabled-context-content.fieldset" });
    }
    return out;
  },
};

// ≥2 radios (or a same-name checkbox cluster) sharing a `name` but NOT inside a
// <fieldset>/role="radiogroup"/role="group" — the group relationship is lost (RGAA 11.5,
// WCAG 1.3.1/3.3.2). Complements `fieldset-legend-missing` (which fires only once a
// fieldset already exists). Fires once per group, anchored on its first control.
const radioCheckboxGroupUngrouped: Rule = {
  id: "radio-checkbox-group-ungrouped",
  criteria: ["1.3.1", "3.3.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const groups = new Map<string, El[]>();
    for (const el of doc.elements) {
      if (el.tag !== "input") continue;
      const type = (attr(el, "type") ?? "").trim().toLowerCase();
      if (type !== "radio" && type !== "checkbox") continue;
      const name = (attr(el, "name") ?? "").trim();
      if (!name || name.includes("{")) continue; // no name, or a dynamic {expr} — not a provable group
      const key = `${type}::${name}`;
      const list = groups.get(key);
      if (list) list.push(el);
      else groups.set(key, [el]);
    }
    const out: RuleFinding[] = [];
    for (const [key, members] of groups) {
      if (members.length < 2) continue; // a lone control is not a group
      if (members.some(hasDynamicSpread)) continue; // a spread may inject role/group context
      if (members.some(inGroupingContext)) continue; // already grouped
      const type = key.slice(0, key.indexOf("::"));
      out.push({
        criteriaId: "1.3.1",
        el: members[0]!,
        msgId: "radio-checkbox-group-ungrouped",
        params: { type, name: key.slice(key.indexOf("::") + 2), count: members.length },
      });
    }
    return out;
  },
};

// ≥2 sibling date fields ungrouped (RGAA 11.5, WCAG 3.3.2): native type=date/month, or a
// NARROW fr/en date lexicon on the field's name/id/label. Fires once per parent cluster —
// the same-immediate-parent requirement keeps it to tight day/month/year or début/fin
// clusters and off unrelated dates spread across separate rows.
const DATE_TOKENS = new Set(["jour", "mois", "annee", "année", "debut", "début", "fin", "day", "month", "year"]);
const NON_DATE_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "reset",
  "button",
  "checkbox",
  "radio",
  "file",
  "password",
  "range",
  "color",
  "email",
  "tel",
  "url",
  "search",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[-_\s.]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter(Boolean);
}
function fieldText(el: El, doc: Doc): string {
  const id = attr(el, "id");
  const forLabel = id ? doc.elements.find((e) => e.tag === "label" && attr(e, "for") === id) : undefined;
  const wrapping = ancestors(el).find((a) => a.tag === "label");
  const labelText = forLabel ? textContent(forLabel) : wrapping ? textContent(wrapping) : "";
  return `${attr(el, "name") ?? ""} ${attr(el, "id") ?? ""} ${labelText}`;
}
function isDateField(el: El, doc: Doc): boolean {
  if (el.tag !== "input") return false;
  const type = (attr(el, "type") ?? "text").trim().toLowerCase();
  if (type === "date" || type === "month") return true;
  if (type.includes("{") || NON_DATE_INPUT_TYPES.has(type)) return false;
  return tokenize(fieldText(el, doc)).some((t) => DATE_TOKENS.has(t));
}

const dateFieldsUngrouped: Rule = {
  id: "date-fields-ungrouped",
  criteria: ["3.3.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const byParent = new Map<El, El[]>();
    for (const el of doc.elements) {
      if (!isDateField(el, doc)) continue;
      if (hasDynamicSpread(el) || inGroupingContext(el)) continue; // already grouped, or spread-injected context
      const p = el.parent;
      if (!p) continue;
      const list = byParent.get(p);
      if (list) list.push(el);
      else byParent.set(p, [el]);
    }
    const out: RuleFinding[] = [];
    for (const fields of byParent.values()) {
      if (fields.length < 2) continue;
      out.push({ criteriaId: "3.3.2", el: fields[0]!, msgId: "date-fields-ungrouped", params: { count: fields.length } });
    }
    return out;
  },
};

// WCAG 1.3.5 asks for a token from the HTML autofill vocabulary. A MISSPELLED or invented
// value ("nope", "user-name", "emailaddress") is worse than none: it reads as compliant,
// autofills nothing, and no assistive technology can infer the field's purpose from it.
const autocompleteTokenInvalid: Rule = {
  id: "autocomplete-token-invalid",
  criteria: ["1.3.5"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag) || !["input", "select", "textarea"].includes(el.tag)) continue;
      const value = attr(el, "autocomplete");
      if (value === undefined || value.includes("{")) continue; // absent, or a dynamic binding
      if (value.trim() === "") continue; // empty is "no declaration", not a wrong one
      if (hasAttr(el, "disabled") || attr(el, "aria-disabled") === "true") continue; // a disabled control collects nothing
      if (isNameExempt(el)) continue; // not exposed, or explicitly presentational
      if (isValidAutocomplete(value)) continue;
      out.push({ criteriaId: "1.3.5", el, msgId: "autocomplete-token-invalid", params: { value: value.trim() } });
    }
    return out;
  },
};

/** The autofill field name a control declares, ignoring qualifiers. "" when absent. */
function autofillField(el: El): string {
  const tokens = (attr(el, "autocomplete") ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.find((t) => CREDENTIAL_FIELDS.has(t)) ?? "";
}

// WCAG 2.2 — 3.3.8 Accessible Authentication (Minimum). An authentication step must not
// force the user to reproduce a secret from memory or by hand. Blocking paste on a password
// field, or switching autofill off on a credential field, does exactly that: it breaks
// password managers and makes the step a cognitive-function test.
const credentialEntryBlocked: Rule = {
  id: "credential-entry-blocked",
  criteria: ["3.3.8"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag) || el.tag !== "input") continue;
      const type = (attr(el, "type") ?? "text").toLowerCase();
      const field = autofillField(el);
      const isCredential = type === "password" || field !== "";
      if (!isCredential) continue;
      // Paste blocked by a handler that cancels the event. Only a literal, self-evident
      // cancellation counts — an arbitrary handler may well permit the paste.
      const paste = (attr(el, "onpaste") ?? attr(el, "onPaste") ?? "").replace(/\s+/g, "");
      if (/preventDefault|returnfalse/i.test(paste)) {
        out.push({ criteriaId: "3.3.8", el, msgId: "credential-entry-blocked.paste", params: { type } });
        continue;
      }
      if ((attr(el, "autocomplete") ?? "").trim().toLowerCase() === "off") {
        out.push({ criteriaId: "3.3.8", el, msgId: "credential-entry-blocked.autocomplete", params: { type } });
      }
    }
    return out;
  },
};

// WCAG 3.2.2 On Input: changing a control's value must not, on its own, submit the form or
// navigate. Only literal, unmistakable handlers are reported — anything else is the agent's
// call, not the engine's.
const CONTEXT_CHANGE = /\b(submit\(\)|form\.submit|location\s*[.=]|location\.href|window\.open|router\.(push|replace)|navigate\()/;

const onInputContextChange: Rule = {
  id: "on-input-context-change",
  criteria: ["3.2.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag) || !["input", "select", "textarea"].includes(el.tag)) continue;
      for (const key of ["onchange", "onChange"]) {
        const handler = attr(el, key);
        if (!handler || !CONTEXT_CHANGE.test(handler)) continue;
        out.push({ criteriaId: "3.2.2", el, msgId: "on-input-context-change", params: { tag: el.tag } });
        break;
      }
    }
    return out;
  },
};

export const formsRules: Rule[] = [
  controlLabelMissing,
  placeholderAsLabel,
  fieldsetLegendMissing,
  formFieldMultipleLabels,
  selectHasOption,
  labelForDangling,
  ariaInvalidNoDescription,
  errorNotAssociated,
  fieldPurposeIncomplete,
  disabledContextContent,
  radioCheckboxGroupUngrouped,
  dateFieldsUngrouped,
  autocompleteTokenInvalid,
  credentialEntryBlocked,
  onInputContextChange,
];
