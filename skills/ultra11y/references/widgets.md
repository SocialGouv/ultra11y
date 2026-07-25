# Composite widgets — keyboard contracts, ARIA state, focus management

The engine sees structure; it cannot press Tab. When a component is not a native element,
its accessibility IS its keyboard contract, and that contract is what you adjudicate under
2.1.1, 2.4.3, 4.1.2 and 4.1.3. This page is the reference for what each pattern owes,
following the ARIA Authoring Practices Guide (APG).

**The rule that precedes all of them: use the native element.** `<button>`, `<select>`,
`<details>`, `<dialog>`, `<input type="checkbox">` ship every behaviour below for free and
cannot drift out of sync. Reach for ARIA only when no native element fits.

## Keyboard contracts

| Pattern | Roles | Keys it must handle | State it must keep in sync |
|---|---|---|---|
| **Disclosure** (show/hide) | `button` + controlled region | `Enter`, `Space` | `aria-expanded` on the button, `aria-controls` → region id |
| **Accordion** | `button` inside a heading, per panel | `Enter`/`Space`; `↑`/`↓` between headers (optional) | `aria-expanded` per header |
| **Tabs** | `tablist` > `tab`, plus `tabpanel` | `←`/`→` (or `↑`/`↓` if vertical) move between tabs, `Home`/`End`; `Tab` leaves the tablist | `aria-selected` on the active tab, `aria-controls` → panel, roving `tabindex` |
| **Menu / menubar** | `menu`/`menubar` > `menuitem` | `↑`/`↓` within, `←`/`→` across a menubar, `Enter` activates, `Esc` closes and returns focus, `Home`/`End` | `aria-expanded` on the trigger, roving `tabindex` |
| **Listbox** | `listbox` > `option` | `↑`/`↓`, `Home`/`End`, type-ahead; `Space` toggles in a multi-select | `aria-selected` per option, `aria-multiselectable` |
| **Combobox** | `combobox` + popup `listbox` | `↓` opens and moves into the list, `Esc` closes, `Enter` commits, `Alt+↓`/`Alt+↑` | `aria-expanded`, `aria-controls`, `aria-activedescendant` → the focused option |
| **Dialog / modal** | `dialog` (+ `aria-modal="true"`) | `Esc` closes; `Tab` cycles WITHIN the dialog | A name (`aria-label`/`aria-labelledby`); background made `inert` |
| **Tooltip** | `tooltip` | `Esc` dismisses without moving focus | `aria-describedby` on the trigger; shown on focus AND hover |
| **Tree** | `tree` > `treeitem` (+ `group`) | `↑`/`↓` between visible nodes, `→` expands, `←` collapses/goes to parent | `aria-expanded` per branch, `aria-selected`, roving `tabindex` |
| **Slider** | `slider` | `←`/`→`/`↑`/`↓` step, `Home`/`End`, `PageUp`/`PageDown` | `aria-valuenow`/`valuemin`/`valuemax`, `aria-valuetext` when the number needs words |
| **Grid / data grid** | `grid` > `row` > `gridcell` | Arrow keys move by cell, `Home`/`End` per row, `Ctrl+Home`/`Ctrl+End` | `aria-rowcount`/`colcount` when virtualised, `aria-sort` on sortable headers |
| **Carousel** | group of slides + controls | Controls reachable by `Tab`; a pause control when it auto-rotates (2.2.2) | `aria-live="off"` while auto-rotating, `polite` once paused |

**Roving tabindex** means exactly one element in the widget is `tabindex="0"` and the rest
are `tabindex="-1"`; the arrow keys move both the DOM focus and that `0`. It is what makes a
30-item menu one `Tab` stop instead of thirty. The alternative — `aria-activedescendant` —
keeps DOM focus on the container and points at the active child by id; use it for
combobox/listbox, where focus must stay in the text input.

## Focus management recipes

```js
// Dialog: move focus IN, trap it, and give it back on close.
function openDialog(dialog, trigger) {
  dialog.dataset.returnTo = trigger.id;            // remember who opened it
  document.getElementById('app').inert = true;      // everything behind is unreachable
  dialog.hidden = false;
  // First focusable, or the dialog itself (tabindex="-1") when it has none.
  (dialog.querySelector('[autofocus]') ?? dialog).focus();
}
function closeDialog(dialog) {
  document.getElementById('app').inert = false;
  dialog.hidden = true;
  document.getElementById(dialog.dataset.returnTo)?.focus();  // 2.4.3: focus never vanishes
}
```

`inert` is the correct tool for "everything behind the modal": it removes the subtree from
the focus order AND the accessibility tree in one attribute. Hiding the background with
`aria-hidden="true"` alone leaves it tabbable — the very defect `aria-hidden-focusable`
reports. Native `<dialog>.showModal()` does all of this for you.

**Never leave focus nowhere.** Removing the focused element (closing a panel, deleting a
row) drops focus to `<body>` and the user loses their place. Move focus deliberately: to the
next row, or to the container with `tabindex="-1"`.

## SPA route changes — the defect class no static rule can see

A client-side navigation replaces the content without a page load. Nothing is announced,
focus stays where it was, and the title still describes the previous page.

```js
router.afterEach((to) => {
  document.title = `${to.meta.title} — Acme`;        // 2.4.2, on every route
  const h1 = document.querySelector('main h1');
  if (h1) { h1.tabIndex = -1; h1.focus(); }          // 2.4.3, focus enters the new content
  announce(`${to.meta.title} loaded`);                // 4.1.3, for those who did not follow focus
});
```

Do not focus `<body>` (announces nothing) and do not scroll without moving focus (sighted
keyboard users end up typing into the old page).

## Live regions — 4.1.3 Status Messages

```html
<!-- Present in the DOM from the start, EMPTY. A region created together with its -->
<!-- content is not announced: the observer has nothing to observe.               -->
<div id="status" role="status" aria-live="polite" aria-atomic="true"></div>
<div id="errors" role="alert"></div>   <!-- assertive: interrupts, for blocking errors only -->
```

| Situation | Politeness |
|---|---|
| Search results count, "Saved", progress | `role="status"` / `aria-live="polite"` |
| Form submission blocked, session expiring | `role="alert"` (implies assertive) |
| A message that also takes focus (a dialog) | No live region — focus already announces it |

Common failures: a region injected with its text in the same tick; `aria-live` on a wrapper
that gets replaced wholesale rather than updated; `assertive` on everything, which trains
users to ignore it. Engine rules: `live-region-conflict`, `status-message-not-assertive`.

## Adjudicating a widget

1. **Read the whole component**, not the flagged line — handlers, effects, state.
2. Check the **role** against the table above: does it match the actual behaviour?
3. Check the **keyboard contract**, key by key. A missing `Esc` is a real 2.1.1 failure.
4. Check **state sync**: does `aria-expanded` change when the panel opens, every time?
5. Check **focus**: where does it go on open, on close, on delete?
6. What needs the rendered page (visible focus, target size) goes to `scan` — see
   `references/dynamic.md`. Record every verdict; never leave a criterion silently green.
