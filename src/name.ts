// Accessible-name computation — a pragmatic subset of the ARIA accname algorithm,
// enough for the link/button/image/control naming rules. Not a full implementation
// (no rendered CSS), so it stays conservative: it only claims a name it can see.
import type { Doc, El, HNode } from "./parse/html.js";
import { attr, hasAttr, boundAttr, hasBoundAttr, descendants, ancestors } from "./parse/html.js";
import { isIntrinsic } from "./parse/jsx-bridge.js";

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
const BUTTON_INPUT = new Set(["button", "submit", "reset"]);

/** Native input types whose `value` is visibly rendered as the button label. */
export function isButtonInput(el: El): boolean {
  return el.tag === "input" && BUTTON_INPUT.has((attr(el, "type") ?? "text").trim().toLowerCase());
}

/** JSX/SFC: the element's content/name may be injected at runtime in a way the static
 *  parse can't see — a `<slot>` projection or a child component (which can render
 *  anything). Rules that assert "this element is empty / unnamed" must bail on these. */
export function mayInjectContent(el: El): boolean {
  return descendants(el).some((d) => d.tag === "slot" || (d.tag !== "#fragment" && !isIntrinsic(d.tag)));
}

// Inline style declarations that take an element (and its subtree) out of the
// accessibility tree entirely. Only INLINE styles are visible to a static parse — a
// class-driven `display:none` is invisible here, which is why this stays a narrow,
// high-confidence suppression rather than a general visibility model.
const HIDDEN_STYLE = /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*(hidden|collapse))\s*(;|$)/i;

function isLocallyDisplayHidden(el: El): boolean {
  const hidden = attr(el, "hidden");
  // A literal HTML/JSX boolean attribute is definitely hidden. A JSX expression such as
  // `hidden={busy}` is conditional, though: treating mere attribute presence as always
  // hidden can erase the only possible label of a control and create a false positive.
  const staticallyHidden = hidden !== undefined && !hidden.includes("{");
  return staticallyHidden || HIDDEN_STYLE.test(attr(el, "style") ?? "");
}

/** Is the element not rendered at all — `[hidden]`, or an inline `display:none` /
 *  `visibility:hidden` on itself or an ancestor? Such an element is in no focus order and
 *  exposes nothing, whatever its ARIA says. */
export function isDisplayHidden(el: El): boolean {
  for (const node of [el, ...ancestors(el)]) {
    if (isLocallyDisplayHidden(node)) return true;
  }
  return false;
}

/** Is this element removed from the accessibility tree by something the source shows —
 *  `hidden`, an inline `display:none`/`visibility:hidden`, or an `aria-hidden="true"`
 *  ancestor? Such an element exposes no name to anyone, so a rule demanding one would be
 *  reporting a defect nobody can experience. (`aria-hidden` on the element ITSELF is
 *  included; a rule whose subject IS aria-hidden must use `isDisplayHidden` instead.) */
export function isHiddenFromAT(el: El): boolean {
  if (isDisplayHidden(el)) return true;
  return [el, ...ancestors(el)].some((node) => attr(node, "aria-hidden") === "true");
}

/** `role="presentation"`/`role="none"` — the author has explicitly removed the element's
 *  semantics, so it exposes no name to remove. */
export function isPresentational(el: El): boolean {
  return ["presentation", "none"].includes((attr(el, "role") ?? "").trim().toLowerCase());
}

/** Should a rule that demands an accessible name stay silent on this element? True when
 *  the element is not in the accessibility tree at all, or is explicitly presentational.
 *  Reporting either would be a defect no user can experience — the precision failure the
 *  W3C ACT corpus catches most often. */
export function isNameExempt(el: El): boolean {
  return isHiddenFromAT(el) || isPresentational(el);
}

/** The name an embedded image contributes to its container's accessible name. Per the
 *  accname computation an `<img>` is named by aria-labelledby > aria-label > alt > title,
 *  so a link wrapping `<img aria-label="…">` or `<img title="…">` is NOT unnamed.
 *  `doc` resolves an aria-labelledby to the text it points at; without one, the mere
 *  presence of the attribute still counts as "named" (the reference may resolve at
 *  runtime, and aria-ref-missing-id owns the dangling-idref case). */
function embeddedImageName(n: El, doc?: Doc): string {
  const labelled = (attr(n, "aria-labelledby") ?? "").trim();
  if (labelled) return doc ? ariaLabelledbyText(n, doc) || labelled : labelled;
  return (boundAttr(n, "aria-label") ?? attr(n, "alt") ?? attr(n, "title") ?? "").trim();
}

/** Text content of a subtree, with <img> names and <svg><title> folded in. */
function nameFromContent(el: El, doc?: Doc, includeHiddenSubtree = false): string {
  let out = "";
  const walk = (n: HNode): void => {
    if (n.type === "text") {
      out += n.data;
      return;
    }
    // Hidden descendants do not contribute to a name-from-content computation. Check this
    // before the image/SVG branches: an aria-hidden image's alt and a hidden SVG's title are
    // hidden too. Only the descendant's own state is checked here because aria-labelledby is
    // allowed to reference a hidden root; its otherwise-exposed descendants still name it.
    if (!includeHiddenSubtree && (isLocallyDisplayHidden(n) || attr(n, "aria-hidden") === "true")) return;
    if (n.tag === "img") {
      const a = embeddedImageName(n, doc);
      if (a) out += " " + a;
      return;
    }
    if (n.tag === "svg") {
      const title = descendants(n).find((d) => d.tag === "title");
      if (title && (includeHiddenSubtree || (!isLocallyDisplayHidden(title) && attr(title, "aria-hidden") !== "true"))) {
        out += " " + nameFromContent(title, doc, includeHiddenSubtree);
      }
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const c of el.children) walk(c);
  return collapse(out);
}

/** Literal text that can safely be treated as a control's visible label in source.
 *
 * Hidden subtrees and aria-hidden decoration (including icon-font/SVG text) are excluded:
 * neither can prove a spoken visible label in a static parse. The rendered tier remains the
 * authority when CSS turns source text into a glyph or otherwise changes what is visible. */
export function visibleLabelText(el: El): string {
  let out = "";
  const nonText = new Set(["script", "style", "title", "desc", "noscript", "template", "canvas", "video", "img"]);
  const walk = (n: HNode): void => {
    if (n.type === "text") {
      out += n.data;
      return;
    }
    if (isLocallyDisplayHidden(n) || attr(n, "aria-hidden") === "true" || nonText.has(n.tag)) return;
    for (const child of n.children) walk(child);
  };
  for (const child of el.children) walk(child);
  if (isButtonInput(el)) {
    const value = (attr(el, "value") ?? "").trim();
    if (value && !value.includes("{")) out += ` ${value}`;
  }
  return collapse(out);
}

/** Literal text that can visibly paint, regardless of accessibility-tree exposure.
 * `aria-hidden` removes semantics, not pixels; only rendering-hidden subtrees are excluded. */
export function visuallyRenderedText(el: El): string {
  let out = "";
  const nonText = new Set(["script", "style", "title", "desc", "noscript", "template", "canvas", "video", "img"]);
  const walk = (n: HNode): void => {
    if (n.type === "text") {
      out += n.data;
      return;
    }
    if (isLocallyDisplayHidden(n) || nonText.has(n.tag)) return;
    for (const child of n.children) walk(child);
  };
  for (const child of el.children) walk(child);
  return collapse(out);
}

function ariaLabelledbyText(el: El, doc: Doc): string {
  const ids = attr(el, "aria-labelledby");
  if (!ids) return "";
  const parts: string[] = [];
  for (const id of ids.split(/\s+/).filter(Boolean)) {
    const ref = doc.byId.get(id);
    if (ref) parts.push(nameFromContent(ref, doc, isHiddenFromAT(ref)) || (attr(ref, "aria-label") ?? "").trim());
  }
  return collapse(parts.join(" "));
}

const NAMELESS_BY_DEFAULT = new Set(["submit", "reset"]); // UA supplies a default label

/** Compute the accessible name of an element (links, buttons, images, generic). */
export function accessibleName(el: El, doc: Doc): string {
  // 1. aria-labelledby (a dynamically-bound :aria-labelledby can't be resolved, but it
  //    names the element — treat as present so we don't hallucinate a missing name)
  const labelledby = ariaLabelledbyText(el, doc);
  if (labelledby) return labelledby;
  if (hasBoundAttr(el, "aria-labelledby") && !attr(el, "aria-labelledby")) return " ";
  // 2. aria-label (incl. dynamic `:aria-label`/`v-bind:` binding → value unknown but present)
  const ariaLabel = (boundAttr(el, "aria-label") ?? "").trim();
  if (ariaLabel) return ariaLabel;
  // 3. element-specific
  if (el.tag === "img" || el.tag === "area") {
    return (boundAttr(el, "alt") ?? "").trim(); // alt="" → intentional empty name; :alt="x" → present
  }
  if (el.tag === "input") {
    const type = (attr(el, "type") ?? "text").toLowerCase();
    if (type === "image") return (boundAttr(el, "alt") ?? attr(el, "title") ?? "").trim();
    if (BUTTON_INPUT.has(type)) {
      const value = (attr(el, "value") ?? "").trim();
      if (value) return value;
      if (NAMELESS_BY_DEFAULT.has(type)) return type === "submit" ? "Submit" : "Reset";
      return (attr(el, "title") ?? "").trim();
    }
  }
  // 4. content + title fallback
  const content = nameFromContent(el, doc);
  if (content) return content;
  return (attr(el, "title") ?? "").trim();
}

const FIELD_TAGS = new Set(["input", "select", "textarea"]);
const NON_LABELABLE_INPUT = new Set(["hidden", "submit", "reset", "button", "image"]);

/** Is this a labelable form field (excludes buttons/hidden)? */
export function isFormField(el: El): boolean {
  if (!FIELD_TAGS.has(el.tag)) return false;
  if (hasAttr(el, "hidden")) return false; // a [hidden] field is not an exposed UI control
  if (el.tag === "input") {
    const type = (attr(el, "type") ?? "text").toLowerCase();
    return !NON_LABELABLE_INPUT.has(type);
  }
  return true;
}

export interface LabelInfo {
  hasLabel: boolean;
  via: "for" | "wrapping" | "aria-labelledby" | "aria-label" | "title" | null;
}

/** Does a form field have a programmatic label/name? (placeholder does NOT count.) */
export function controlLabel(el: El, doc: Doc): LabelInfo {
  // Mirror accessibleName's guard: a labelledby is a real label only when it resolves to
  // text, OR is a DYNAMIC binding (present but value unknown). A literal aria-labelledby
  // whose target is missing/empty names nothing — the field is effectively unlabeled.
  if ((attr(el, "aria-labelledby") && ariaLabelledbyText(el, doc)) || (hasBoundAttr(el, "aria-labelledby") && !attr(el, "aria-labelledby")))
    return { hasLabel: true, via: "aria-labelledby" };
  if ((boundAttr(el, "aria-label") ?? "").trim()) return { hasLabel: true, via: "aria-label" };
  const id = attr(el, "id");
  if (id) {
    const lbl = doc.elements.find((e) => e.tag === "label" && attr(e, "for") === id);
    if (lbl) return { hasLabel: true, via: "for" };
  }
  if (ancestors(el).some((a) => a.tag === "label")) return { hasLabel: true, via: "wrapping" };
  if ((attr(el, "title") ?? "").trim()) return { hasLabel: true, via: "title" };
  return { hasLabel: false, via: null };
}
