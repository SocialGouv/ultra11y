// WAI-ARIA 1.2 reference tables — the vocabulary the ARIA validation rules check against.
// Kept in one module (rather than scattered across rules) because these are FACTS about the
// specification, not policy: every entry is a state/property, value type, required-state or
// required-context relationship defined by https://www.w3.org/TR/wai-aria-1.2/.
//
// Deliberately conservative on two axes:
//   • only relationships the spec states outright are listed — a "should" is not encoded
//     here, because a rule built on one manufactures false positives;
//   • deprecated-but-still-defined attributes (aria-dropeffect, aria-grabbed) count as
//     DEFINED: reporting them as unknown would be wrong, and deprecation is not a WCAG
//     failure.

/** Every state and property defined by WAI-ARIA 1.2. */
export const ARIA_ATTRS = new Set([
  "aria-activedescendant",
  "aria-atomic",
  "aria-autocomplete",
  "aria-braillelabel",
  "aria-brailleroledescription",
  "aria-busy",
  "aria-checked",
  "aria-colcount",
  "aria-colindex",
  "aria-colindextext",
  "aria-colspan",
  "aria-controls",
  "aria-current",
  "aria-describedby",
  "aria-description",
  "aria-details",
  "aria-disabled",
  "aria-dropeffect",
  "aria-errormessage",
  "aria-expanded",
  "aria-flowto",
  "aria-grabbed",
  "aria-haspopup",
  "aria-hidden",
  "aria-invalid",
  "aria-keyshortcuts",
  "aria-label",
  "aria-labelledby",
  "aria-level",
  "aria-live",
  "aria-modal",
  "aria-multiline",
  "aria-multiselectable",
  "aria-orientation",
  "aria-owns",
  "aria-placeholder",
  "aria-posinset",
  "aria-pressed",
  "aria-readonly",
  "aria-relevant",
  "aria-required",
  "aria-roledescription",
  "aria-rowcount",
  "aria-rowindex",
  "aria-rowindextext",
  "aria-rowspan",
  "aria-selected",
  "aria-setsize",
  "aria-sort",
  "aria-valuemax",
  "aria-valuemin",
  "aria-valuenow",
  "aria-valuetext",
]);

export type AriaValueType =
  | { kind: "token"; values: string[] } // one of a fixed set
  | { kind: "tokenlist"; values: string[] } // space-separated, each from a fixed set
  | { kind: "integer" } // a whole number
  | { kind: "number" } // a real number
  | { kind: "string" } // anything, including empty
  | { kind: "idref" } // a single element id
  | { kind: "idrefs" }; // space-separated element ids

const BOOL = ["true", "false"];

/** Value type per attribute. Attributes absent from this map accept any string. */
export const ARIA_VALUE_TYPE: Record<string, AriaValueType> = {
  "aria-atomic": { kind: "token", values: BOOL },
  "aria-busy": { kind: "token", values: BOOL },
  "aria-disabled": { kind: "token", values: BOOL },
  "aria-modal": { kind: "token", values: BOOL },
  "aria-multiline": { kind: "token", values: BOOL },
  "aria-multiselectable": { kind: "token", values: BOOL },
  "aria-readonly": { kind: "token", values: BOOL },
  "aria-required": { kind: "token", values: BOOL },
  // `undefined` is a legal literal value for these three (it means "not applicable").
  "aria-hidden": { kind: "token", values: [...BOOL, "undefined"] },
  "aria-expanded": { kind: "token", values: [...BOOL, "undefined"] },
  "aria-selected": { kind: "token", values: [...BOOL, "undefined"] },
  "aria-grabbed": { kind: "token", values: [...BOOL, "undefined"] },
  // tristate
  "aria-checked": { kind: "token", values: [...BOOL, "mixed", "undefined"] },
  "aria-pressed": { kind: "token", values: [...BOOL, "mixed", "undefined"] },
  // enumerations
  "aria-autocomplete": { kind: "token", values: ["inline", "list", "both", "none"] },
  "aria-current": { kind: "token", values: [...BOOL, "page", "step", "location", "date", "time"] },
  "aria-haspopup": { kind: "token", values: [...BOOL, "menu", "listbox", "tree", "grid", "dialog"] },
  "aria-invalid": { kind: "token", values: [...BOOL, "grammar", "spelling"] },
  "aria-live": { kind: "token", values: ["off", "polite", "assertive"] },
  "aria-orientation": { kind: "token", values: ["horizontal", "vertical", "undefined"] },
  "aria-sort": { kind: "token", values: ["ascending", "descending", "none", "other"] },
  "aria-dropeffect": { kind: "tokenlist", values: ["copy", "execute", "link", "move", "none", "popup"] },
  "aria-relevant": { kind: "tokenlist", values: ["additions", "all", "removals", "text"] },
  // numeric
  "aria-colcount": { kind: "integer" },
  "aria-colindex": { kind: "integer" },
  "aria-colspan": { kind: "integer" },
  "aria-level": { kind: "integer" },
  "aria-posinset": { kind: "integer" },
  "aria-rowcount": { kind: "integer" },
  "aria-rowindex": { kind: "integer" },
  "aria-rowspan": { kind: "integer" },
  "aria-setsize": { kind: "integer" },
  "aria-valuemax": { kind: "number" },
  "aria-valuemin": { kind: "number" },
  "aria-valuenow": { kind: "number" },
  // references
  "aria-activedescendant": { kind: "idref" },
  "aria-details": { kind: "idref" },
  "aria-errormessage": { kind: "idref" },
  "aria-controls": { kind: "idrefs" },
  "aria-describedby": { kind: "idrefs" },
  "aria-flowto": { kind: "idrefs" },
  "aria-labelledby": { kind: "idrefs" },
  "aria-owns": { kind: "idrefs" },
};

/** Is `value` a legal literal for `attr`? Unknown attributes and free-form strings pass. */
export function isValidAriaValue(attrName: string, value: string): boolean {
  const type = ARIA_VALUE_TYPE[attrName];
  if (!type) return true;
  const v = value.trim();
  switch (type.kind) {
    case "token":
      return type.values.includes(v.toLowerCase());
    case "tokenlist": {
      const parts = v.split(/\s+/).filter(Boolean);
      return parts.length > 0 && parts.every((p) => type.values.includes(p.toLowerCase()));
    }
    case "integer":
      return /^-?\d+$/.test(v);
    case "number":
      return /^-?\d+(\.\d+)?$/.test(v);
    case "idref":
      // A single-reference property pointing at several ids resolves to nothing.
      // (Whether the id EXISTS is aria-ref-missing-id's business, not this rule's.)
      return v.split(/\s+/).filter(Boolean).length <= 1;
    default:
      // idrefs/string: emptiness and resolution are other rules' business.
      return true;
  }
}

/** Roles whose ARIA definition REQUIRES these states — without them the widget's state is
 *  simply not exposed. Only roles the spec marks "Required States and Properties". */
export const ARIA_REQUIRED_ATTRS: Record<string, string[]> = {
  checkbox: ["aria-checked"],
  combobox: ["aria-expanded", "aria-controls"],
  heading: ["aria-level"],
  menuitemcheckbox: ["aria-checked"],
  menuitemradio: ["aria-checked"],
  meter: ["aria-valuenow"],
  option: ["aria-selected"],
  radio: ["aria-checked"],
  scrollbar: ["aria-controls", "aria-valuenow"],
  slider: ["aria-valuenow"],
  switch: ["aria-checked"],
};

/** Roles that are only meaningful inside a specific container role ("Required Context
 *  Role"). Values are the accepted container roles, including the implicit ones a native
 *  element provides. */
export const ARIA_REQUIRED_PARENT: Record<string, string[]> = {
  columnheader: ["row"],
  gridcell: ["row"],
  listitem: ["list", "directory"],
  menuitem: ["menu", "menubar", "group"],
  menuitemcheckbox: ["menu", "menubar", "group"],
  menuitemradio: ["menu", "menubar", "group"],
  option: ["listbox", "group"],
  row: ["grid", "rowgroup", "table", "treegrid"],
  rowgroup: ["grid", "table", "treegrid"],
  rowheader: ["row"],
  tab: ["tablist"],
  treeitem: ["tree", "group"],
};

/** Native elements that carry an implicit CONTAINER role, for the required-context check.
 *  Only the unambiguous cases — a role that depends on attributes or ancestry is left out. */
export const IMPLICIT_CONTAINER_ROLE: Record<string, string> = {
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  thead: "rowgroup",
  tbody: "rowgroup",
  tfoot: "rowgroup",
  tr: "row",
  td: "cell",
  th: "columnheader",
  datalist: "listbox",
  optgroup: "group",
  option: "option",
  fieldset: "group",
};

/** Roles that PROHIBIT an author-provided name: naming them exposes text the platform has
 *  nowhere to put, and assistive tech either drops it or announces it out of context. */
export const NAME_PROHIBITED_ROLES = new Set([
  "caption",
  "code",
  "deletion",
  "emphasis",
  "generic",
  "insertion",
  "mark",
  "none",
  "paragraph",
  "presentation",
  "strong",
  "subscript",
  "superscript",
  "term",
  "time",
]);
