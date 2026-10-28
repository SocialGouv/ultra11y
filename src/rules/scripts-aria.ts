// Theme 7 — Scripts / ARIA correctness (the statically-checkable slice).
import type { Doc, El } from "../parse/html.js";
import { attr, hasAttr, hasBoundAttr, hasDynamicSpread, descendants, ancestors } from "../parse/html.js";
import { isIntrinsic } from "../parse/jsx-bridge.js";
import { accessibleName, mayInjectContent, isHiddenFromAT, isDisplayHidden, isPresentational } from "../name.js";
import { ARIA_ATTRS, ARIA_REQUIRED_ATTRS, ARIA_REQUIRED_PARENT, IMPLICIT_CONTAINER_ROLE, NAME_PROHIBITED_ROLES, isValidAriaValue } from "../aria.js";
import type { Rule, RuleFinding } from "./rule.js";

const INTERACTIVE_ROLES = [
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "switch",
  "textbox",
  "combobox",
  "slider",
  "spinbutton",
];

function isInteractive(el: El): boolean {
  if (el.tag === "a") return hasAttr(el, "href");
  if (["button", "select", "textarea"].includes(el.tag)) return true;
  if (el.tag === "input") return (attr(el, "type") ?? "text").toLowerCase() !== "hidden";
  return INTERACTIVE_ROLES.includes((attr(el, "role") ?? "").trim());
}

const DISABLEABLE = new Set(["button", "input", "select", "textarea", "fieldset", "optgroup", "option"]);
const isDisabled = (el: El): boolean => DISABLEABLE.has(el.tag) && hasAttr(el, "disabled");

function isFocusable(el: El): boolean {
  // An explicit tabindex wins: -1 removes an element from the tab order (not keyboard-
  // focusable), >=0 puts it in — even on an intrinsically-interactive element.
  const tiRaw = attr(el, "tabindex");
  if (tiRaw !== undefined) {
    const ti = Number(tiRaw.trim());
    if (!Number.isNaN(ti)) return ti >= 0;
  }
  if (isDisabled(el)) return false; // a disabled control is not focusable
  if (isInteractive(el)) return true;
  // A <details>' first <summary> child is its disclosure button, focusable by default.
  if (el.tag === "summary" && el.parent?.tag === "details") {
    return el.parent.children.find((c): c is El => c.type === "element" && c.tag === "summary") === el;
  }
  return hasAttr(el, "contenteditable") && attr(el, "contenteditable") !== "false";
}

// Concrete WAI-ARIA 1.2 roles (abstract roles like "widget"/"range" are invalid as author values).
const VALID_ROLES = new Set([
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
]);

const IDREF_ATTRS = ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-details", "aria-errormessage", "aria-flowto"];
const IDREF_SINGLE = ["aria-activedescendant"];

const invalidAriaRole: Rule = {
  id: "invalid-aria-role",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue; // a component's `role` is a prop, not the HTML role attr
      const role = (attr(el, "role") ?? "").trim();
      if (!role) continue;
      if (role.includes("{")) continue; // dynamic role expression (role={…}) — value unknown, can't validate
      // A `role` attribute is a FALLBACK LIST: the first token that names a real role
      // wins, so `role="doc-biblioref link"` is valid even though the first token is not
      // a concrete WAI-ARIA role here. Only a list where NOTHING resolves is a defect.
      const tokens = role.split(/\s+/);
      const bad = tokens.filter((t) => !VALID_ROLES.has(t.toLowerCase()));
      if (bad.length === tokens.length) {
        out.push({
          criteriaId: "4.1.2",
          el,
          msgId: "invalid-aria-role",
          params: { roles: bad.join(" ") },
        });
      }
    }
    return out;
  },
};

const ariaRefMissingId: Rule = {
  id: "aria-ref-missing-id",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const refs: { attr: string; ids: string[] }[] = [];
      for (const a of IDREF_ATTRS) {
        const v = attr(el, a);
        // A JSX expression value (e.g. aria-describedby={err ? "x" : undefined}) is dynamic,
        // not a literal id list — never split/verify it (would yield garbage ids).
        if (v && !v.includes("{")) refs.push({ attr: a, ids: v.split(/\s+/).filter(Boolean) });
      }
      for (const a of IDREF_SINGLE) {
        const v = (attr(el, a) ?? "").trim();
        if (v && !v.includes("{")) refs.push({ attr: a, ids: [v] });
      }
      for (const { attr: a, ids } of refs) {
        const missing = ids.filter((id) => !doc.byId.has(id));
        if (missing.length) {
          out.push({
            criteriaId: "4.1.2",
            el,
            msgId: "aria-ref-missing-id",
            params: { attr: a, ids: missing.map((m) => `#${m}`).join(", ") },
          });
        }
      }
    }
    return out;
  },
};

// implicit roles that make role="…" redundant
const IMPLICIT_ROLE: Record<string, string> = {
  button: "button",
  nav: "navigation",
  main: "main",
  ul: "list",
  ol: "list",
  li: "listitem",
  table: "table",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  form: "form",
  article: "article",
  aside: "complementary",
  dialog: "dialog",
  figure: "figure",
};

const redundantAria: Rule = {
  id: "redundant-aria",
  criteria: ["4.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const role = (attr(el, "role") ?? "").trim().toLowerCase();
      if (!role) continue;
      let implicit = IMPLICIT_ROLE[el.tag];
      if (el.tag === "a" && hasAttr(el, "href")) implicit = "link";
      if (implicit && implicit === role) {
        out.push({
          criteriaId: "4.1.2",
          el,
          msgId: "redundant-aria",
          params: { role, tag: el.tag },
        });
      }
    }
    return out;
  },
};

const NONINTERACTIVE = new Set(["div", "span"]);

const clickableNoninteractive: Rule = {
  id: "clickable-noninteractive",
  criteria: ["4.1.2", "2.1.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!NONINTERACTIVE.has(el.tag)) continue;
      if (!hasAttr(el, "onclick")) continue;
      const role = (attr(el, "role") ?? "").trim();
      // Keyboard-focusable via tabindex means value >= 0 (a negative tabindex is not in the
      // tab order); check the VALUE, not mere presence.
      const tiRaw = (attr(el, "tabindex") ?? "").trim();
      const hasTab = tiRaw !== "" && Number(tiRaw) >= 0;
      const interactiveRole = INTERACTIVE_ROLES.includes(role); // the canonical list (radio/slider/…), not an ad-hoc subset
      if (interactiveRole && hasTab) continue; // properly upgraded (interactive role + keyboard-focusable)
      const noKeyboard = !hasTab;
      out.push({
        criteriaId: noKeyboard ? "2.1.1" : "4.1.2",
        el,
        msgId: "clickable-noninteractive",
        params: { tag: el.tag, focusIssue: noKeyboard ? "no-tabindex" : "no-role" },
      });
    }
    return out;
  },
};

const REQUIRED_CHILDREN: Record<string, string[]> = {
  list: ["listitem"],
  tablist: ["tab"],
  radiogroup: ["radio"],
  tree: ["treeitem"],
  menu: ["menuitem", "menuitemcheckbox", "menuitemradio"],
  menubar: ["menuitem", "menuitemcheckbox", "menuitemradio"],
};

function satisfiesChild(d: El, reqRoles: string[]): boolean {
  const role = (attr(d, "role") ?? "").trim();
  if (reqRoles.includes(role)) return true;
  if (reqRoles.includes("listitem") && d.tag === "li") return true;
  if (reqRoles.includes("radio") && d.tag === "input" && (attr(d, "type") ?? "").toLowerCase() === "radio") return true;
  if (!role && (d.tag === "td" || d.tag === "th") && reqRoles.some((r) => r === "cell" || r === "gridcell" || r === "columnheader" || r === "rowheader"))
    return true;
  return false;
}

// What each container may OWN (WAI-ARIA 1.2 "Required Owned Elements"). Used for the
// second test below — "owns an element whose role it does not allow" — which runs only on
// containers whose owned set is closed in practice. A `group` is not listed: it is looked
// THROUGH, so a list owning a group of listitems is fine and a menu whose group owns a
// treeitem is not, which is how WAI-ARIA reads `group → listitem`.
// (`radiogroup` is deliberately absent: its owned elements are routinely labels and
// headings, and only the "owns no radio at all" test is decisive for it.)
const OWNED_ALLOWED: Record<string, string[]> = {
  // `separator` is not in ARIA 1.2's list for menus but every APG menu example uses one;
  // allowing it can only under-report.
  menu: ["menuitem", "menuitemcheckbox", "menuitemradio", "separator"],
  menubar: ["menuitem", "menuitemcheckbox", "menuitemradio", "separator"],
  tablist: ["tab"],
  list: ["listitem"],
  tree: ["treeitem"],
  row: ["cell", "columnheader", "gridcell", "rowheader"],
  grid: ["row", "rowgroup"],
  treegrid: ["row", "rowgroup"],
  table: ["row", "rowgroup"],
  rowgroup: ["row"],
};
// First test, "owns none of its required elements": the historical containers, plus a row,
// which must own at least one cell — a row of plain text is not a row of anything.
const REQUIRED_ANY: Record<string, string[]> = { ...REQUIRED_CHILDREN, row: OWNED_ALLOWED.row! };

// The native roles an owned element can carry that matter for these containers. Only the
// unambiguous ones: an element whose role depends on context is "unknown" and never judged.
function nativeOwnedRole(el: El): string | undefined {
  if (el.tag === "li") return "listitem";
  if (el.tag === "tr") return "row";
  if (el.tag === "td") return "cell";
  if (el.tag === "button") return "button";
  if (el.tag === "a" && hasAttr(el, "href")) return "link";
  if (/^h[1-6]$/.test(el.tag)) return "heading";
  if (el.tag === "input") {
    const type = (attr(el, "type") ?? "text").trim().toLowerCase();
    if (type === "radio") return "radio";
    if (type === "checkbox") return "checkbox";
  }
  return undefined;
}

// Tags with no role of their own: ownership passes straight through them.
const GENERIC_TAGS = new Set(["div", "span", "b", "i", "u", "small", "font", "bdi", "bdo"]);

/** The elements `el` OWNS in the accessibility tree, each with its role: the first
 *  descendants that carry a role — generic and presentational wrappers, and groups, being
 *  looked through. `"?"` marks an owned element whose role is not decidable here;
 *  `undefined` means the owned set itself is not knowable (an unresolvable aria-owns). */
function ownedElements(el: El, doc: Doc): { el: El; role: string }[] | undefined {
  const out: { el: El; role: string }[] = [];
  const visit = (c: El): void => {
    if (isHiddenFromAT(c) || c.tag === "script" || c.tag === "template" || c.tag === "style") return;
    const explicit = (attr(c, "role") ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
    if (explicit === "group") {
      walk(c);
      return;
    }
    if (explicit === "none" || explicit === "presentation" || explicit === "generic" || (!explicit && GENERIC_TAGS.has(c.tag))) {
      // a generic wrapper carrying ARIA attributes is itself in the tree — not transparent
      if (!explicit && Object.keys(c.attribs).some((k) => k.startsWith("aria-"))) out.push({ el: c, role: "?" });
      else walk(c);
      return;
    }
    if (!isIntrinsic(c.tag)) {
      out.push({ el: c, role: "?" }); // a component renders whatever it renders
      return;
    }
    out.push({ el: c, role: explicit && VALID_ROLES.has(explicit) ? explicit : (nativeOwnedRole(c) ?? "?") });
  };
  const walk = (n: El): void => {
    for (const c of n.children) if (c.type === "element") visit(c);
  };
  walk(el);
  const owns = attr(el, "aria-owns");
  if (owns !== undefined) {
    // Resolvable only when the whole page is in hand and every id exists.
    if (owns.includes("{") || doc.kind !== "html") return undefined;
    for (const id of owns.split(/\s+/).filter(Boolean)) {
      const ref = doc.byId.get(id);
      if (!ref) return undefined;
      visit(ref);
    }
  }
  return out;
}

const ariaRequiredChildren: Rule = {
  id: "aria-required-children",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const role = (attr(el, "role") ?? "").trim();
      const req = REQUIRED_ANY[role];
      const allowed = OWNED_ALLOWED[role];
      if (!req && !allowed) continue;
      if (attr(el, "aria-busy") === "true") continue; // still loading — the tree is knowingly incomplete
      if (isHiddenFromAT(el)) continue; // not exposed: no owned elements to require
      if (mayInjectContent(el)) continue; // required children injected via <slot>/component/{@render}
      // 1. owns none of its required elements (aria-owns may supply them from elsewhere)
      if (req && !hasAttr(el, "aria-owns") && !descendants(el).some((d) => satisfiesChild(d, req))) {
        out.push({ criteriaId: "4.1.2", el, msgId: "aria-required-children", params: { role, req: req.join("/") } });
        continue;
      }
      // 2. owns an element whose role the container does not allow
      if (!allowed) continue;
      const bad = ownedElements(el, doc)?.find((o) => o.role !== "?" && !allowed.includes(o.role));
      if (bad) {
        out.push({ criteriaId: "4.1.2", el, msgId: "aria-required-children.forbidden-child", params: { role, child: bad.role, req: allowed.join("/") } });
      }
    }
    return out;
  },
};

const ariaHiddenFocusable: Rule = {
  id: "aria-hidden-focusable",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (attr(el, "aria-hidden") !== "true") continue;
      // `aria-hidden` is this rule's subject, so the shared exposure guard cannot apply —
      // but an element the source hides outright (inline display:none, [hidden]) is not in
      // the focus order either, and reporting it would be a defect nobody can reach.
      if (isDisplayHidden(el)) continue;
      const focusable = (n: El): boolean => isFocusable(n) && !isDisplayHidden(n);
      const focusableHere = focusable(el) || descendants(el).some(focusable);
      if (!focusableHere) continue;
      out.push({
        criteriaId: "4.1.2",
        el,
        msgId: "aria-hidden-focusable",
      });
    }
    return out;
  },
};

// Roles whose descendants are forced presentational by WAI-ARIA. A focusable descendant
// cannot be made presentational, so the browser exposes a conflicting accessibility tree.
const PRESENTATIONAL_CHILDREN = new Set([
  "button",
  "checkbox",
  "img",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "option",
  "progressbar",
  "radio",
  "scrollbar",
  "separator",
  "slider",
  "switch",
  "tab",
]);

const presentationalChildrenFocusable: Rule = {
  id: "presentational-children-focusable",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      // A native <button> carries the button role (and its presentational children) with
      // no `role` attribute at all; an explicit role on it replaces that.
      const explicit = (attr(el, "role") ?? "").trim().toLowerCase();
      const role = explicit || (el.tag === "button" ? "button" : "");
      if (!PRESENTATIONAL_CHILDREN.has(role) || isHiddenFromAT(el)) continue;
      const child = descendants(el).find((node) => isFocusable(node) && !isDisplayHidden(node));
      if (child) out.push({ criteriaId: "4.1.2", el: child, msgId: "presentational-children-focusable", params: { role } });
    }
    return out;
  },
};

/** ACT 46ca7f: an author explicitly marked an element decorative, but another property makes
 * that marking ineffective and exposes it. The author intent is explicit, so this can
 * evidence RGAA 1.2 without guessing whether an ordinary image is decorative. */
const decorativeMarkedExposed: Rule = {
  id: "decorative-marked-exposed",
  criteria: ["1.1.1", "4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      const role = (attr(el, "role") ?? "").trim().toLowerCase();
      const decorative = role === "none" || role === "presentation" || (el.tag === "img" && attr(el, "alt") === "");
      if (!decorative || isDisplayHidden(el)) continue;
      const named = (attr(el, "aria-label") ?? "").trim() || (attr(el, "aria-labelledby") ?? "").trim() || (attr(el, "title") ?? "").trim();
      if (!isFocusable(el) && !named) continue;
      const nonText = ["img", "svg", "canvas", "object", "embed"].includes(el.tag);
      out.push({ criteriaId: nonText ? "1.1.1" : "4.1.2", el, msgId: "decorative-marked-exposed", params: { tag: el.tag } });
    }
    return out;
  },
};

const menuitemEmptyName: Rule = {
  id: "menuitem-empty-name",
  criteria: ["4.1.2"],
  severity: "bloquant",
  run(doc: Doc): RuleFinding[] {
    return doc.elements
      .filter((el) => ["menuitem", "menuitemcheckbox", "menuitemradio"].includes((attr(el, "role") ?? "").trim().toLowerCase()))
      .filter((el) => !isHiddenFromAT(el) && !hasDynamicSpread(el) && !mayInjectContent(el) && accessibleName(el, doc).trim() === "")
      .map((el) => ({ criteriaId: "4.1.2", el, msgId: "menuitem-empty-name" }));
  },
};

const nestedInteractive: Rule = {
  id: "nested-interactive",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isInteractive(el)) continue;
      if (!ancestors(el).some(isInteractive)) continue;
      out.push({
        criteriaId: "4.1.2",
        el,
        msgId: "nested-interactive",
        params: { tag: el.tag },
      });
    }
    return out;
  },
};

// WAI-ARIA implicit live-region politeness per role. A status message whose role and
// aria-live disagree — or whose aria-live value is invalid — is restituted incoherently
// (an alert announced "polite" is queued and may be missed; an invalid value is ignored).
const ROLE_LIVENESS: Record<string, "assertive" | "polite" | "off"> = {
  alert: "assertive",
  alertdialog: "assertive",
  status: "polite",
  log: "polite",
  timer: "off",
  marquee: "off",
};
const VALID_LIVE = new Set(["off", "polite", "assertive"]);

const liveRegionConflict: Rule = {
  id: "live-region-conflict",
  criteria: ["4.1.3"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue; // a component's aria-live/role is a prop, not the HTML attr
      const liveRaw = attr(el, "aria-live");
      if (liveRaw === undefined || liveRaw.includes("{")) continue; // absent or dynamic value — nothing to assert
      const live = liveRaw.trim().toLowerCase();
      if (!live) continue;
      if (!VALID_LIVE.has(live)) {
        out.push({
          criteriaId: "4.1.3",
          el,
          msgId: "live-region-conflict.invalid-value",
          params: { value: liveRaw },
        });
        continue;
      }
      const role = (attr(el, "role") ?? "").trim().toLowerCase();
      if (role.includes("{")) continue; // dynamic role expression — can't compare
      const want = ROLE_LIVENESS[role];
      // Overriding an 'off'-default role (timer/marquee) up to polite/assertive is a
      // spec-permitted author choice (aria-live overrides the implicit default), not a
      // conflict — so only alert/alertdialog/status/log (want !== "off") are checked.
      if (want && want !== "off" && want !== live) {
        out.push({
          criteriaId: "4.1.3",
          el,
          severity: want === "assertive" ? "majeur" : "mineur",
          msgId: "live-region-conflict.mismatch",
          params: { role, want, live },
        });
      }
    }
    return out;
  },
};

// An error/alert container announced politely (aria-live="polite") instead of
// assertively. A status MESSAGE that reports an error should interrupt
// (role="alert" / aria-live="assertive") so it is not queued and missed. This is the
// `polite`-with-no-role case the existing live-region-conflict (role↔aria-live) leaves
// open; only fired when the container's class/id marks it as an ERROR specifically.
// The bare `alert`/`fr-alert` tokens are intentionally excluded: DSFR (and Bootstrap)
// reuse them for success/info/warning variants — `fr-alert fr-alert--success` with
// aria-live="polite" is the CORRECT status pattern, not a defect. `error`/`danger`/
// `invalid` still match error variants (`fr-alert--error`, `fr-error`, `alert-danger`).
const ERROR_ALERT_CONTAINER = /(^|[-_ ])(error|danger|invalid)/i;

const statusMessageNotAssertive: Rule = {
  id: "status-message-not-assertive",
  criteria: ["4.1.3"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue; // a component's aria-live/role is a prop, not the HTML attr
      const liveRaw = attr(el, "aria-live");
      if (liveRaw === undefined || liveRaw.includes("{")) continue; // absent or dynamic value
      if (liveRaw.trim().toLowerCase() !== "polite") continue; // only polite is at issue here
      if (hasAttr(el, "role")) continue; // role-driven liveness is live-region-conflict's job
      const signal = (attr(el, "class") ?? "") + " " + (attr(el, "id") ?? "");
      if (!ERROR_ALERT_CONTAINER.test(signal)) continue;
      out.push({
        criteriaId: "4.1.3",
        el,
        msgId: "status-message-not-assertive",
      });
    }
    return out;
  },
};

// ---- ARIA vocabulary validation (WAI-ARIA 1.2 tables live in src/aria.ts) -------------

/** Every literal `aria-*` attribute on an element, skipping dynamic bindings whose value
 *  (or very presence) the static parse cannot resolve. */
function literalAriaAttrs(el: El): [string, string][] {
  const out: [string, string][] = [];
  for (const key in el.attribs) {
    const k = key.toLowerCase();
    if (!k.startsWith("aria-")) continue;
    const v = el.attribs[key] ?? "";
    if (v.includes("{")) continue; // JSX/SFC expression — value unknown, never guess
    out.push([k, v]);
  }
  return out;
}

// A MISSPELLED aria-* attribute (`aria-labeledby`, `aria-role`) is inert: the browser
// exposes nothing, and the author believes the element is named. Only literal, intrinsic
// elements are checked — a component prop named `aria-foo` is that component's business.
const invalidAriaAttr: Rule = {
  id: "invalid-aria-attr",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue;
      for (const [name] of literalAriaAttrs(el)) {
        if (ARIA_ATTRS.has(name)) continue;
        out.push({ criteriaId: "4.1.2", el, msgId: "invalid-aria-attr", params: { attr: name } });
      }
    }
    return out;
  },
};

/** An ID-reference property the element's role REQUIRES (`aria-controls` on a scrollbar)
 *  whose ids name no element of the page: the required relationship is not there at all.
 *  Decided only in a plain HTML document, where the whole page is in hand — a component may
 *  reference an id another component renders. A combobox that is not expanded is exempt:
 *  its popup legitimately does not exist yet. */
function requiredIdrefDangling(el: El, doc: Doc, name: string, value: string): boolean {
  if (doc.kind !== "html" || !IDREF_ATTRS.includes(name)) return false;
  const role = (attr(el, "role") ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
  if (!ARIA_REQUIRED_ATTRS[role]?.includes(name)) return false;
  if (role === "combobox" && (attr(el, "aria-expanded") ?? "").trim().toLowerCase() !== "true") return false;
  const ids = value.split(/\s+/).filter(Boolean);
  return ids.length > 0 && ids.every((id) => !doc.byId.has(id));
}

// An out-of-vocabulary VALUE (`aria-expanded="yes"`, `aria-level="0"`) is treated as if the
// attribute were absent, so the state the author meant to expose never reaches the user.
const invalidAriaValue: Rule = {
  id: "invalid-aria-value",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue;
      for (const [name, value] of literalAriaAttrs(el)) {
        if (!ARIA_ATTRS.has(name)) continue; // invalid-aria-attr owns unknown names
        if (hasBoundAttr(el, name) && !value) continue; // dynamically bound: present, value unknown
        if (!isValidAriaValue(name, value)) {
          out.push({ criteriaId: "4.1.2", el, msgId: "invalid-aria-value", params: { attr: name, value } });
        } else if (requiredIdrefDangling(el, doc, name, value)) {
          out.push({
            criteriaId: "4.1.2",
            el,
            msgId: "invalid-aria-value.dangling-required",
            params: { attr: name, value, role: (attr(el, "role") ?? "").trim() },
          });
        }
      }
    }
    return out;
  },
};

/** Does the element's NATIVE semantics already expose this state? A `<input
 *  type="checkbox">` maintains its own checked state, an `<h2>` its own level — re-declaring
 *  the role does not create an obligation to also hand-maintain the ARIA mirror. */
function nativelyProvides(el: El, ariaAttr: string): boolean {
  const type = (attr(el, "type") ?? "").toLowerCase();
  switch (ariaAttr) {
    case "aria-checked":
      return el.tag === "input" && (type === "checkbox" || type === "radio");
    case "aria-level":
      return /^h[1-6]$/.test(el.tag);
    case "aria-valuenow":
      return el.tag === "progress" || el.tag === "meter" || (el.tag === "input" && type === "range");
    case "aria-selected":
      return el.tag === "option";
    case "aria-expanded":
      return el.tag === "details" || el.tag === "select";
    default:
      return false;
  }
}

// A role whose ARIA definition REQUIRES a state, used without it: `role="checkbox"` with no
// aria-checked announces a checkbox whose state is unknowable.
const ariaRequiredAttr: Rule = {
  id: "aria-required-attr",
  criteria: ["4.1.2"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue;
      const role = (attr(el, "role") ?? "").trim().toLowerCase();
      if (!role || role.includes("{")) continue;
      const required = ARIA_REQUIRED_ATTRS[role.split(/\s+/)[0] ?? ""];
      if (!required) continue;
      if (isHiddenFromAT(el)) continue; // not exposed: no state to expose
      if (hasDynamicSpread(el)) continue; // a spread may carry the state
      // A literal EMPTY value (`aria-controls=""`) is the same as no attribute: ARIA treats
      // an empty state/property as absent. A dynamic binding stays "present".
      const absent = (a: string): boolean => !hasBoundAttr(el, a) || (attr(el, a) !== undefined && attr(el, a)!.trim() === "");
      const missing = required.filter((a) => absent(a) && !nativelyProvides(el, a));
      if (!missing.length) continue;
      out.push({ criteriaId: "4.1.2", el, msgId: "aria-required-attr", params: { role, attrs: missing.join(", ") } });
    }
    return out;
  },
};

/** The role an element exposes: explicit `role`, else the unambiguous native one. */
function effectiveRole(el: El): string {
  const explicit = (attr(el, "role") ?? "").trim().toLowerCase();
  if (explicit && !explicit.includes("{")) return explicit.split(/\s+/)[0] ?? "";
  return IMPLICIT_CONTAINER_ROLE[el.tag] ?? "";
}

// A role that only means something inside a specific container (`tab` outside a `tablist`,
// `option` outside a `listbox`) is not exposed as that role at all.
const ariaRequiredParent: Rule = {
  id: "aria-required-parent",
  criteria: ["1.3.1"],
  severity: "majeur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue;
      const role = (attr(el, "role") ?? "").trim().toLowerCase();
      if (!role || role.includes("{")) continue;
      const accepted = ARIA_REQUIRED_PARENT[role.split(/\s+/)[0] ?? ""];
      if (!accepted) continue;
      if (isHiddenFromAT(el)) continue;
      const chain = ancestors(el);
      // A component ancestor may render the required container around this element, and
      // aria-owns can supply the relationship from elsewhere — neither is visible here.
      if (chain.some((a) => !isIntrinsic(a.tag))) continue;
      if (doc.elements.some((e) => hasAttr(e, "aria-owns"))) continue;
      // ARIA ownership stops at the first ancestor that DECLARES a role: a `role="listitem"`
      // wrapped in a `role="tabpanel"` is owned by the tabpanel, not by the list further up.
      // Role-less wrapper elements are traversed through — generic <div>s between a list and
      // its items are everywhere in real markup, and browsers repair them.
      // `role="presentation"`/`none` removes the element's semantics, so it is transparent
      // for ownership — the list below it still owns the items.
      // A role-less wrapper is NOT traversed once it carries ARIA attributes of its own
      // (`<div aria-live="polite">`): it is then included in the accessibility tree as a
      // generic node, and that node — not the list above it — owns the item.
      const exposedGeneric = (a: El): boolean =>
        !(attr(a, "role") ?? "").trim() && GENERIC_TAGS.has(a.tag) && literalAriaAttrs(a).some(([k]) => k !== "aria-hidden");
      const owner = chain.find((a) => !isPresentational(a) && ((attr(a, "role") ?? "").trim() !== "" || IMPLICIT_CONTAINER_ROLE[a.tag] || exposedGeneric(a)));
      if (owner && accepted.includes(effectiveRole(owner))) continue;
      if (!owner && chain.some((a) => accepted.includes(effectiveRole(a)))) continue;
      out.push({ criteriaId: "1.3.1", el, msgId: "aria-required-parent", params: { role, parents: accepted.join(" / ") } });
    }
    return out;
  },
};

// Role-specific (non-global) WAI-ARIA 1.2 properties, with EVERY role that supports or
// inherits them. Only properties whose role set is short and certain are listed — a
// property missing here is never judged, so the list can only under-report.
const ROLE_SPECIFIC_ATTRS: Record<string, string[]> = {
  "aria-sort": ["columnheader", "rowheader"],
  "aria-orientation": ["scrollbar", "select", "separator", "slider", "tablist", "toolbar", "listbox", "menu", "menubar", "radiogroup", "tree", "treegrid"],
  "aria-multiline": ["textbox", "searchbox"],
  "aria-multiselectable": ["grid", "listbox", "tablist", "tree", "treegrid"],
  "aria-modal": ["dialog", "alertdialog"],
  "aria-pressed": ["button"],
  "aria-valuemax": ["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"],
  "aria-valuemin": ["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"],
  "aria-valuenow": ["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"],
  "aria-valuetext": ["meter", "progressbar", "scrollbar", "separator", "slider", "spinbutton"],
};

/** The role an element exposes, when the source makes it certain: a valid explicit role, or
 *  the native role of an element whose mapping does not depend on context. `""` stands for
 *  "no role" (audio/video, which HTML-AAM maps to no ARIA role, and generic div/span).
 *  `undefined` = not decidable here — never judged. */
function decidableRole(el: El): string | undefined {
  const raw = attr(el, "role");
  if (raw !== undefined) {
    const first = raw.trim().toLowerCase().split(/\s+/)[0] ?? "";
    if (!first || !VALID_ROLES.has(first) || first === "none" || first === "presentation") return undefined;
    return first;
  }
  if (el.tag === "button") return "button";
  if (el.tag === "input") {
    const type = (attr(el, "type") ?? "text").trim().toLowerCase();
    return ["button", "submit", "reset", "image"].includes(type) ? "button" : undefined;
  }
  if (el.tag === "a") return hasAttr(el, "href") ? "link" : undefined;
  if (/^h[1-6]$/.test(el.tag)) return "heading";
  if (el.tag === "p") return "paragraph";
  if (el.tag === "audio" || el.tag === "video") return "";
  if (el.tag === "div" || el.tag === "span") return "generic";
  return undefined;
}

// Naming a role that PROHIBITS a name (a paragraph, an emphasis, a presentational element)
// hands assistive tech text it has nowhere to put — dropped by some, announced out of
// context by others. `role="presentation"`/`none` additionally LOSES its own effect as soon
// as it carries a name, so the element silently keeps its semantics.
const ariaProhibitedAttr: Rule = {
  id: "aria-prohibited-attr",
  criteria: ["4.1.2"],
  severity: "mineur",
  run(doc: Doc): RuleFinding[] {
    const out: RuleFinding[] = [];
    for (const el of doc.elements) {
      if (!isIntrinsic(el.tag)) continue;
      const role = (attr(el, "role") ?? "").trim().toLowerCase();
      if (role.includes("{")) continue;
      if (NAME_PROHIBITED_ROLES.has(role)) {
        const named = ["aria-label", "aria-labelledby"].filter((a) => (attr(el, a) ?? "").trim() !== "");
        if (named.length) {
          out.push({ criteriaId: "4.1.2", el, msgId: "aria-prohibited-attr", params: { role, attrs: named.join(", ") } });
          continue;
        }
      }
      // A role-specific property on a role that does not support it is simply dropped.
      const semantics = decidableRole(el);
      if (semantics === undefined || isHiddenFromAT(el) || hasDynamicSpread(el)) continue;
      const unsupported = literalAriaAttrs(el)
        .map(([k]) => k)
        .filter((k) => ROLE_SPECIFIC_ATTRS[k] && !ROLE_SPECIFIC_ATTRS[k]!.includes(semantics));
      if (!unsupported.length) continue;
      out.push({
        criteriaId: "4.1.2",
        el,
        msgId: "aria-prohibited-attr.unsupported",
        params: { role: semantics || el.tag, attrs: unsupported.join(", ") },
      });
    }
    return out;
  },
};

export const scriptsAriaRules: Rule[] = [
  invalidAriaRole,
  ariaRefMissingId,
  redundantAria,
  clickableNoninteractive,
  ariaRequiredChildren,
  ariaHiddenFocusable,
  presentationalChildrenFocusable,
  decorativeMarkedExposed,
  menuitemEmptyName,
  nestedInteractive,
  liveRegionConflict,
  statusMessageNotAssertive,
  invalidAriaAttr,
  invalidAriaValue,
  ariaRequiredAttr,
  ariaRequiredParent,
  ariaProhibitedAttr,
];
