// Theme 6 / 7 — Links & buttons: accessible-name presence (empty-name + icon-only).
import type { Doc, El } from "../parse/html.js";
import { attr, boundAttr, hasAttr, hasBoundAttr, ancestors, descendants, visibleText } from "../parse/html.js";
import { isIntrinsic } from "../parse/jsx-bridge.js";
import { accessibleName, mayInjectContent, isButtonInput, isFormField, controlLabel, isNameExempt, visibleLabelText } from "../name.js";
import type { Rule, RuleFinding } from "./rule.js";

function hasIconChild(el: El): boolean {
  return descendants(el).some((d) => {
    if (d.tag === "img") {
      const a = attr(d, "alt");
      return a === undefined || a.trim() === "";
    }
    if (d.tag === "svg") {
      const titled = descendants(d).some((x) => x.tag === "title" && visibleText(x));
      return !titled && !(attr(d, "aria-label") ?? "").trim();
    }
    if (d.tag === "i") return /(^|\s|-)(icon|fa|glyphicon|material-icons)/.test((attr(d, "class") ?? "").toLowerCase());
    return false;
  });
}

const isButton = (el: El): boolean => {
  if (el.tag === "button") return true;
  if ((attr(el, "role") ?? "") === "button") return true;
  if (el.tag === "input") return isButtonInput(el) || (attr(el, "type") ?? "").trim().toLowerCase() === "image";
  return false;
};

/** Resolve the HTML form owner far enough to distinguish RGAA theme 11 buttons from
 * script/UI controls. `undefined` is deliberately undecidable: a dynamic `form={...}` /
 * `:form="..."` binding must stay in the generic WCAG rule instead of being credited to a
 * concrete form. */
function formOwner(el: El, doc: Doc): El | null | undefined {
  const literal = attr(el, "form");
  if (literal === undefined && hasBoundAttr(el, "form")) return undefined;
  if (literal !== undefined) {
    const explicit = literal.trim();
    if (explicit.includes("{")) return undefined;
    if (!explicit) return null;
    const owner = doc.byId.get(explicit);
    return owner?.tag === "form" ? owner : null;
  }
  return ancestors(el).find((ancestor) => ancestor.tag === "form") ?? null;
}

/** RGAA 11.9 is scoped to buttons of a form. A native button whose explicit role changes
 * its semantics (menuitem/tab/…) belongs to theme 7 even if its tag happens to be button. */
function isFormButton(el: El, doc: Doc): boolean {
  if (!isButton(el)) return false;
  const role = (attr(el, "role") ?? "").trim().toLowerCase();
  if (role && role !== "button") return false;
  return formOwner(el, doc)?.tag === "form";
}

const linkEmptyName: Rule = {
  id: "link-empty-name",
  criteria: ["2.4.4"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (el.tag !== "a" || !hasAttr(el, "href")) continue;
      if (isNameExempt(el)) continue; // not exposed, or explicitly presentational
      if (accessibleName(el, doc) !== "") continue;
      if (mayInjectContent(el)) continue; // name supplied by a <slot>/child component
      if (hasIconChild(el)) continue; // handled by icon-only-control-unnamed
      out.push({
        criteriaId: "2.4.4",
        el,
        msgId: "link-empty-name",
      });
    }
    return out;
  },
};

function emptyButtonFindings(doc: Doc, formSpecific: boolean): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const el of doc.elements) {
    if (!isButton(el)) continue;
    if (isFormButton(el, doc) !== formSpecific) continue;
    if (isNameExempt(el)) continue; // not exposed, or explicitly presentational
    if (accessibleName(el, doc) !== "") continue;
    if (mayInjectContent(el)) continue; // name supplied by a <slot>/child component
    if (hasIconChild(el)) continue; // handled by icon-only-control-unnamed
    out.push({
      criteriaId: "4.1.2",
      el,
      msgId: "button-empty-name",
    });
  }
  return out;
}

const buttonEmptyName: Rule = {
  id: "button-empty-name",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run: (doc) => emptyButtonFindings(doc, false),
};

const formButtonEmptyName: Rule = {
  id: "form-button-empty-name",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run: (doc) => emptyButtonFindings(doc, true),
};

const iconOnlyControlUnnamed: Rule = {
  id: "icon-only-control-unnamed",
  criteria: ["2.4.4", "4.1.2"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const link = el.tag === "a" && hasAttr(el, "href");
      const button = isButton(el);
      if (!link && !button) continue;
      if (isNameExempt(el)) continue; // not exposed, or explicitly presentational
      if (accessibleName(el, doc) !== "") continue;
      if (mayInjectContent(el)) continue; // name supplied by a <slot>/child component
      if (!hasIconChild(el)) continue;
      out.push({
        criteriaId: link ? "2.4.4" : "4.1.2",
        el,
        msgId: "icon-only-control-unnamed",
        params: { kind: link ? "link" : "button" },
      });
    }
    return out;
  },
};

// A link/button whose ONLY accessible name comes from the title attribute. `title` is
// restituted unreliably (hover only — not on touch, often not by keyboard/AT), so a control
// named solely by it is effectively unlabeled in practice. (link-empty-name/button-empty-name
// skip these because title technically yields a name, so this rule covers the gap.)
const controlNameTitleOnly: Rule = {
  id: "control-name-title-only",
  criteria: ["4.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const link = el.tag === "a" && hasAttr(el, "href");
      const field = !link && !isButton(el) && isFormField(el);
      if (!link && !isButton(el) && !field) continue;
      if (isNameExempt(el)) continue; // not exposed, or explicitly presentational
      const title = (attr(el, "title") ?? "").trim();
      if (!title || title.includes("{")) continue; // no title, or dynamic value
      if (hasAttr(el, "aria-label") || hasAttr(el, "aria-labelledby")) continue; // named by ARIA, title is supplementary
      if (mayInjectContent(el)) continue; // name may come from a <slot>/child component
      if (el.tag === "input" && (attr(el, "type") ?? "").trim().toLowerCase() === "image" && (boundAttr(el, "alt") ?? "").trim()) continue;
      if (el.tag === "input" && (attr(el, "value") ?? "").trim()) continue; // value names the button
      if (el.tag === "input" && ["submit", "reset"].includes((attr(el, "type") ?? "").trim().toLowerCase())) continue; // UA default name
      // A form field is title-only precisely when its resolved label comes from title (a
      // for=/wrapping/aria label wins over title in controlLabel, so via!=="title" means it
      // is otherwise named or unlabeled — control-label-missing's job, not this rule's).
      if (field && controlLabel(el, doc).via !== "title") continue;
      const hasContentName =
        visibleText(el).trim() !== "" ||
        descendants(el).some(
          (d) =>
            (d.tag === "img" && (attr(d, "alt") ?? "").trim() !== "") ||
            (d.tag === "svg" && descendants(d).some((x) => x.tag === "title" && visibleText(x).trim() !== "")),
        );
      if (!field && hasContentName) continue; // visible text / named image already provides the name (fields have no content name)
      out.push({
        criteriaId: "4.1.2",
        el,
        msgId: "control-name-title-only",
        params: { kind: link ? "link" : field ? "field" : "button" },
      });
    }
    return out;
  },
};

/** Normalise for the label-in-name comparison: case, punctuation and whitespace are not
 *  what voice control matches on. */
const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d]/g, "'")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

// WCAG 2.5.3 Label in Name: when a control shows a visible text label, that text must be
// CONTAINED in its accessible name. A voice-control user says what they see ("click Send");
// if the accessible name is "Submit", the command silently does nothing. Only reported when
// both halves are literal text — a dynamic name proves nothing either way.
function labelInNameMismatchFindings(doc: Doc, formSpecific: boolean): RuleFinding[] {
  const out: RuleFinding[] = [];
  for (const el of doc.elements) {
    if (!isIntrinsic(el.tag)) continue;
    const link = el.tag === "a" && hasAttr(el, "href");
    const role = (attr(el, "role") ?? "").trim().toLowerCase();
    if (!link && !isButton(el) && !["button", "link", "menuitem", "tab", "checkbox", "radio", "switch"].includes(role)) continue;
    if (isFormButton(el, doc) !== formSpecific) continue;
    if (isNameExempt(el)) continue;
    // The override must be a LITERAL aria-label: aria-labelledby points at text elsewhere
    // in the page, which the visible label may legitimately extend rather than contradict.
    const ariaLabel = (attr(el, "aria-label") ?? "").trim();
    if (!ariaLabel || ariaLabel.includes("{")) continue;
    if (hasAttr(el, "aria-labelledby")) continue; // labelledby wins over aria-label; different question
    const visible = visibleLabelText(el);
    if (!visible || visible.includes("{")) continue;
    // A one- or two-character run ("X", "OK", "→") is a glyph, not a label a voice-control
    // user would speak — 2.5.3 is about VISIBLE LABEL TEXT, and comparing glyphs to names
    // manufactures noise.
    if (visible.length < 3) continue;
    if (mayInjectContent(el)) continue; // the visible text may come from a slot/component
    const name = normalizeName(ariaLabel);
    const label = normalizeName(visible);
    if (!label || !name || name.includes(label)) continue;
    out.push({
      criteriaId: "2.5.3",
      el,
      msgId: "label-in-name-mismatch",
      params: { visible, name: ariaLabel },
    });
  }
  return out;
}

const labelInNameMismatch: Rule = {
  id: "label-in-name-mismatch",
  criteria: ["2.5.3"],
  severity: "majeur",
  run: (doc) => labelInNameMismatchFindings(doc, false),
};

const formLabelInNameMismatch: Rule = {
  id: "form-label-in-name-mismatch",
  criteria: ["2.5.3"],
  severity: "majeur",
  run: (doc) => labelInNameMismatchFindings(doc, true),
};

export const linksRules: Rule[] = [
  linkEmptyName,
  buttonEmptyName,
  formButtonEmptyName,
  iconOnlyControlUnnamed,
  controlNameTitleOnly,
  labelInNameMismatch,
  formLabelInNameMismatch,
];
