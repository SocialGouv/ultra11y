# Accessible names — how one is computed, and how to get it right

Most of what an audit calls "4.1.2" is a naming problem. This page is the reference for
what a name IS, so a verdict rests on the computation rather than on the markup's appearance.

## The precedence chain (accname), highest first

A control's accessible name is the FIRST of these that yields non-empty text:

| # | Source | Notes |
|---|---|---|
| 1 | `aria-labelledby` | Wins over everything, including visible content. Concatenates the text of every id, in the order listed. A dangling id contributes nothing — an all-dangling list leaves the element unnamed. |
| 2 | `aria-label` | Replaces the visible text entirely. This is what breaks 2.5.3 (see below). |
| 3 | Native host semantics | `<label for>` / wrapping `<label>` for form fields, `alt` for `<img>`, `<legend>` for `<fieldset>`, `<caption>` for `<table>`, `<figcaption>` for `<figure>`, `value` for `<input type="submit">`. |
| 4 | Text content | For elements whose role allows "name from content": button, link, heading, menuitem, tab, option… NOT for a `<div>` or an `<input>`. |
| 5 | `title` | Last resort. Hover-only: absent on touch, unevenly announced. A name that exists but should not be the plan. |

Two consequences worth stating explicitly, because both produce confident wrong verdicts:

- **A name that exists is not a name that works.** `aria-label="Button"` satisfies "has a
  name" and helps nobody. Judge relevance, not presence.
- **The chain stops at the first hit.** `<button aria-label="Close">Save</button>` is named
  "Close". The visible word "Save" never enters the computation.

## 2.5.3 Label in Name — the rule voice control depends on

When a control shows visible text, that text must be **contained in** the accessible name.
A speech-input user says what they see; if the name differs, the command silently does nothing.

```html
<!-- ✗ the spoken "click Send" matches nothing -->
<button aria-label="Submit form">Send</button>

<!-- ✓ the visible text is contained, and comes first -->
<button aria-label="Send message to support">Send</button>

<!-- ✓ best: no override at all — the text names the button -->
<button>Send</button>
```

Rule of thumb: if you find yourself writing `aria-label` on an element that already shows
text, you are usually about to break 2.5.3. Prefer `aria-describedby` for the extra detail.
Engine rule: `label-in-name-mismatch`.

## Visually-hidden text — the CSS that actually works

Naming an icon control with text only screen readers reach is the native-first answer.
`display:none` and `visibility:hidden` remove the text from the accessibility tree too;
`text-indent:-9999px` breaks in RTL; `font-size:0` is unreliable.

```css
/* The only clipping recipe that survives every engine, and stays focusable. */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
/* Skip links: visible again once focused. */
.visually-hidden:focus-visible {
  position: static;
  width: auto;
  height: auto;
  clip-path: none;
  white-space: normal;
}
```

## Naming non-text content

```html
<!-- Informative image: describe the MEANING in context, not the picture -->
<img src="chart.png" alt="Sales up 25% in Q3 2025">

<!-- Decorative image: an explicit empty alt, never a missing one -->
<img src="divider.png" alt="">

<!-- Icon control: the name describes the ACTION, not the glyph -->
<button aria-label="Delete this comment"><svg aria-hidden="true" focusable="false">…</svg></button>

<!-- Inline SVG treated as an image -->
<svg role="img" aria-labelledby="logo-title"><title id="logo-title">Acme</title>…</svg>

<!-- Decorative SVG: hide it and make sure it is not a tab stop in IE-era engines -->
<svg aria-hidden="true" focusable="false">…</svg>

<!-- Figure: the caption is visible text AND the accessible name -->
<figure>
  <img src="plan.png" alt="Ground floor: reception, then three meeting rooms along a corridor">
  <figcaption>Ground floor plan</figcaption>
</figure>

<!-- Abbreviation: expand on first use in text; title alone is hover-only -->
<p>The <abbr title="World Wide Web Consortium">W3C</abbr> publishes WCAG.</p>
```

**Charts.** An `alt` naming the chart ("Sales chart") is not an alternative — it names the
container and drops the data. Either put the figures in the alt, or point at an equivalent
table nearby. Engine rule: `chart-no-accessible-name`.

## What the engine settles, and what stays yours

| Decided by the engine | Yours to adjudicate |
|---|---|
| Name **absent** (`img-alt-missing`, `button-empty-name`, `link-empty-name`, `control-label-missing`, `iframe-title-missing`, `icon-only-control-unnamed`) | Whether the name is **relevant** (1.1.1, 2.4.4, 2.4.6) — the engine cannot read meaning |
| Name provided only by `title` (`control-name-title-only`, `img-alt-missing.title-only` as a recommendation) | Whether an `alt=""` image is genuinely decorative |
| Visible text not contained in the name (`label-in-name-mismatch`) | Whether an icon font makes the DOM text invisible (then 2.5.3 does not apply) |
| Names prohibited by the role (`aria-prohibited-attr`) | Whether two same-named links share a destination (2.4.4) |

Cross-file: under `--graph` the engine resolves a name passed as a prop into a component,
and flags one that gets lost on the way (`cross-prop-drilled-name-lost`). See
`references/cross-file.md`.
