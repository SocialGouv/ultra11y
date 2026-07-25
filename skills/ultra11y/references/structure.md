# Structure — headings, landmarks, lists, tables

1.3.1 is the criterion that fails most often in real audits, because it covers everything a
sighted user reads from layout alone. The test is always the same: **is the relationship I
can see also programmatically determinable?**

## Headings

Headings are the primary navigation aid for screen-reader users — most jump between them
rather than reading linearly. Judge the OUTLINE, not the styling.

```html
<h1>Quarterly report</h1>
  <h2>Revenue</h2>
    <h3>Europe</h3>
    <h3>Asia</h3>
  <h2>Costs</h2>
```

- Never skip a level going down (`h2` → `h4`). Going back up is fine (`h3` → `h2`).
- Style with CSS, not by picking a level. A "small heading" is still an `h2` if it opens a
  second-level section.
- A visually styled `<div class="title">` is not a heading. Either mark it up, or accept it
  is not part of the outline.
- One `<h1>` per page is a convention, not a rule — the engine reports it as a
  recommendation, never a non-conformity.

Engine rules: `heading-order-skip`, `empty-heading`; `h1-missing`/`h1-multiple` (advisory).
Yours: whether each heading actually **describes** its section (2.4.6).

## Landmarks

```html
<header>            <!-- banner -->
  <nav aria-label="Main">…</nav>
</header>
<main id="content"> <!-- exactly one per page -->
  …
</main>
<aside aria-label="Related articles">…</aside>  <!-- complementary -->
<footer>…</footer>  <!-- contentinfo -->
```

- Every piece of content should sit inside a landmark; text stranded between them is
  unreachable by landmark navigation.
- Name repeated landmarks: two `<nav>`s need `aria-label` to be told apart. One `<nav>`
  needs no label — "Navigation navigation" is what a redundant one produces.
- `<main>` is the target of the skip link, and needs `tabindex="-1"` to accept focus.

Engine rules: `missing-main-landmark`, `multiple-main-landmark`, `nav-landmark-missing`,
`nav-landmark-unnamed`, `skip-link-target-missing`.

## Lists

```html
<ul>                       <!-- unordered: order carries no meaning -->
  <li>Coffee</li>
</ul>
<ol>                       <!-- ordered: steps, rankings -->
  <li>Preheat the oven</li>
</ol>
<dl>                       <!-- name/value pairs: glossary, spec sheet, recap screens -->
  <dt>Weight</dt><dd>1.2 kg</dd>
  <div><dt>Colour</dt><dd>Black</dd></div>   <!-- a grouping <div> is allowed -->
</dl>
```

Screen readers announce "list, 5 items" — that count is the information. A run of `<div>`s
separated by `<br>` announces nothing. Only `<li>` (and `<script>`/`<template>`) may be a
direct child of `<ul>`/`<ol>`; only `<dt>`/`<dd>` (optionally wrapped in a `<div>`) of `<dl>`.

**The recap-screen pattern** is the one most often got wrong: a "Your details" summary built
from `<div class="label">` / `<div class="value">` pairs conveys the relationship visually
only. Use `<dl>`, or associate the pair programmatically. Engine rules: `list-structure`,
`dl-structure`.

## Tables

A table is for **data**. Using one for layout is not a failure in itself, but it must then
be marked `role="presentation"` and carry no data markup.

```html
<table>
  <caption>Rainfall by city, 2025</caption>   <!-- the table's accessible name -->
  <thead>
    <tr><th scope="col">City</th><th scope="col">January</th></tr>
  </thead>
  <tbody>
    <tr><th scope="row">Paris</th><td>52 mm</td></tr>
  </tbody>
</table>
```

- `scope` takes exactly `col`, `row`, `colgroup`, `rowgroup`. `scope="column"` is invalid and
  silently does nothing (engine rule: `scope-value-invalid` is a declared gap — check it by
  eye until it lands).
- `<caption>` is the name; keep it SHORT. A long explanation belongs in a paragraph
  associated via `aria-describedby`, not in the caption (RGAA 5.5).

**Complex tables** — irregular headers, spans, two header rows — need explicit wiring, since
`scope` can no longer express the relationship:

```html
<table>
  <caption>Opening hours</caption>
  <tr><td></td><th id="morning">Morning</th><th id="afternoon">Afternoon</th></tr>
  <tr><th id="mon">Monday</th>
      <td headers="mon morning">9–12</td>
      <td headers="mon afternoon">14–18</td></tr>
</table>
```

Every `headers` id must name a header cell **of the same table** (engine rule:
`headers-attr-dangling`), and a header no cell references heads nothing (`th-no-data-cells`).
Mixing `scope` and `headers` in one table is where associations quietly get lost — pick one.

`colspan`/`rowspan` are fine in a simple table; once they make the header structure
irregular, switch to `headers`/`id`. Engine rules: `data-table-no-headers`,
`table-caption-missing`, `layout-table-data-markup`, `sortable-header-no-aria-sort`.

## 1.3.2 Meaningful Sequence

The DOM order is the reading order. CSS that reorders content visually
(`order`, `flex-direction: row-reverse`, `position: absolute`, `grid-area`) makes the two
diverge, and the divergence becomes a failure when it changes the meaning.

Test: read the DOM top to bottom. Does the sequence still make sense? A sidebar declared
between two paragraphs of an article will be read in the middle of the article.

## What the engine settles, and what stays yours

| Decided by the engine | Yours to adjudicate |
|---|---|
| Heading level skips, empty headings, malformed lists and description lists | Whether a heading **describes** its section (2.4.6) |
| Missing/duplicate `<main>`, unnamed repeated `<nav>`, broken skip-link target | Whether every region of content sits in a landmark |
| Data table with no headers, no caption, dangling `headers`, unreferenced `<th>` | Whether a table is data or layout in the first place |
| — | Whether a visual relationship (recap screens, columns) exists programmatically (1.3.1) |
| — | Whether the DOM order preserves meaning (1.3.2) |
