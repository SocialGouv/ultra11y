<!-- GENERATED from src/data/adjudication.json by `pnpm run build:adjudication` — do not edit by hand. -->

# Deciding the criteria the engine hands you

The static engine decides 3 of the 55 WCAG 2.2 AA success criteria outright. The other 52
come back as residual risks: 14 need a rendered page (the `scan` tier), 38 are judgment
calls. This page is the decision rule for each of them — what makes it Conforming, when
`NA` is legitimate, and the questions that get you there.

It is the same dataset `verify --manual` loads into `ADJUDICATE.md`, so the worklist and
this page can never disagree. Two rules govern every verdict below:

- **A non-conformity must cite a normative test that resolves.** The worklist proposes the
  criterion's W3C techniques; `verify --apply` rejects a `normativeRef` that does not exist.
- **A good practice with no failing test is a recommendation**, not a non-conformity — it
  never flips a criterion, never enters the conformance rate.

## 1.1 Text Alternatives

### 1.1.1 — Non-text Content  ·  A  ·  _judgment_

**Decide.** Conforming when EVERY non-text content carries an alternative serving the same purpose: a description of the meaning for an informative image, alt="" for a decorative one, a description of the action for a control. Non-conforming as soon as one alternative is missing, empty on a meaningful image, or off-topic (a file name, "image", "logo").

**Not applicable when.** No non-text content in scope.

**Ask.**

- For each alt: does it describe what the image CONTRIBUTES here, rather than what it depicts? The same photo can need two different alternatives in two contexts.
- Do the purely decorative images carry alt="" (not a missing alt)? A named decorative image is as harmful as a silent informative one.
- For a chart or infographic: does the alternative give the DATA (or point to an equivalent table), or does it merely name the chart?

**Citable references.** ARIA10, ARIA4, ARIA6, ARIA7, ARIA8, ARIA9, C9, F15, F19, F20, F3, F30 … (`criteria 1.1.1`)

## 1.2 Time-based Media

### 1.2.1 — Audio-only and Video-only (Prerecorded)  ·  A  ·  _judgment_

**Decide.** Conforming when every audio-only media has a text transcript, and every video-only media a transcript OR an equivalent audio track. Non-conforming when the media carries information available nowhere else.

**Not applicable when.** No audio-only or video-only media.

**Ask.**

- Is the transcript reachable from the media's own page (an adjacent link, a disclosure panel) rather than buried elsewhere?
- Does it cover ALL the content, including speaker identification and meaningful sounds?

**Citable references.** F30, F67, G158, G159, G166, G173, G58, G69, G78, G8, H96, SM6 … (`criteria 1.2.1`)

### 1.2.2 — Captions (Prerecorded)  ·  A  ·  _judgment_

**Decide.** Conforming when every prerecorded video carrying speech has synchronized captions (a <track kind="captions">, captions embedded in the container, or a player supplying them). Non-conforming when the speech is restituted by no caption at all.

**Not applicable when.** No prerecorded video carrying meaningful audio.

**Ask.**

- Does a missing <track> really prove there are no captions? Check the container and the player: captions can be embedded — which is why the engine does not class this as a non-conformity.
- Do the captions also cover meaningful non-speech sounds (music, alarm, laughter)?

**Citable references.** F74, F75, F8, G58, G87, G93, H95, SM11, SM12

### 1.2.3 — Audio Description or Media Alternative (Prerecorded)  ·  A  ·  _judgment_

**Decide.** Conforming when every prerecorded video with audio offers audio description OR a complete text alternative describing the visual information. Non-conforming when information carried only by the picture is restituted nowhere.

**Not applicable when.** No prerecorded video with audio.

**Ask.**

- What information exists ONLY in the picture (on-screen text, a demonstration, a chart)? Is it spoken or described elsewhere?

**Citable references.** F30, F67, G158, G159, G166, G173, G58, G69, G78, G8, H96, SM6 … (`criteria 1.2.3`)

### 1.2.4 — Captions (Live)  ·  AA  ·  _judgment_

**Decide.** Conforming when every live audio broadcast has real-time captions. Non-conforming otherwise.

**Not applicable when.** No live broadcast.

**Ask.**

- Is there a live stream (a webinar, a broadcast, an embedded conference) in scope? Is the captioning provider in place for EVERY session?

### 1.2.5 — Audio Description (Prerecorded)  ·  AA  ·  _judgment_

**Decide.** Conforming when every prerecorded video with audio has audio description (a dedicated track or an audio-described version). Note: at AA a text alternative alone no longer suffices, unlike 1.2.3.

**Not applicable when.** No prerecorded video with audio.

**Ask.**

- Does an audio-description track actually exist, or is only the 1.2.3 transcript provided?

**Citable references.** G173, G58, G78, G8, H96, SM1, SM2, SM6, SM7

## 1.3 Adaptable

### 1.3.1 — Info and Relationships  ·  A  ·  _judgment_

**Decide.** Conforming when every relationship and structure conveyed visually (headings, lists, tables, field groups, regions) is programmatically determinable. Non-conforming as soon as a relationship exists visually only — a bold <div> acting as a heading, a list built from <br>, a label/value pair in <span>s.

**Ask.**

- Technique consistency (RGAA 9.1): is the SAME structuring technique (hn vs caption, ul/ol/dl markup) used across ALL similar tables/pages — not instance by instance?
- Div-presented fields (RGAA 8.9): for each label/value pair shown with <div>/<span>, is the relationship anything other than visual (<dl>/<dt>/<dd> or an ARIA association)?
- Read without CSS, does the content keep the same meaning and the same order?

**Citable references.** ARIA11, ARIA12, ARIA14, ARIA16, ARIA17, ARIA4, ARIA6, ARIA9, C18, C22, C6, C8 … (`criteria 1.3.1`)

### 1.3.2 — Meaningful Sequence  ·  A  ·  _judgment_

**Decide.** Conforming when the DOM reading order produces a sequence that preserves meaning. Non-conforming when the visual and DOM orders diverge enough to change the meaning (columns reordered in CSS, `order`/`flex-direction: *-reverse`, absolute positioning).

**Ask.**

- Reading the DOM top to bottom, does the sequence stay understandable — or does a side column cut through the middle of a text?
- Does a CSS `order` or a reversed `flex-direction` visually move meaning-bearing elements?

**Citable references.** ARIA4, C18, C22, C6, C8, F1, F15, F32, F33, F34, F48, F49 … (`criteria 1.3.2`)

### 1.3.3 — Sensory Characteristics  ·  A  ·  _judgment_

**Decide.** Conforming when no instruction relies SOLELY on a sensory characteristic (shape, colour, size, position, sound). Non-conforming for "click the green button", "see the box on the right", "the field below" with no other cue.

**Ask.**

- Does each instruction also name its target (a label, a heading) in addition to its position or colour?

**Citable references.** F14, F26, G140, G96

### 1.3.4 — Orientation  ·  AA  ·  _needs-rendering_

**Decide.** Conforming when the content displays in both orientations. Non-conforming when display is locked (a blocking CSS `transform`/orientation media query, an app-level lock) without the orientation being essential.

**Ask.**

- Is the orientation genuinely ESSENTIAL (a piano keyboard, a cheque to photograph), or merely a layout choice?

### 1.3.5 — Identify Input Purpose  ·  AA  ·  _judgment_

**Decide.** Conforming when every field collecting information ABOUT THE USER declares its purpose with an `autocomplete` token from the WCAG list. Non-conforming when the token is missing or outside the vocabulary.

**Not applicable when.** No field collects information about the user.

**Ask.**

- Does the field collect data about the USER (name, email, address, phone) — rather than business data (an order number, a search keyword)?

**Citable references.** H98

## 1.4 Distinguishable

### 1.4.1 — Use of Color  ·  A  ·  _needs-rendering_

**Decide.** Conforming when no information is conveyed by colour ALONE. Non-conforming for an in-paragraph link distinguished only by colour, a red/green status with no text or icon, a field error signalled only by a coloured border.

**Ask.**

- Seen in greyscale, does every piece of information stay distinguishable?

**Citable references.** C15, F14, F26, F73, F78, G111, G117, G138, G14, G140, G149, G165 … (`criteria 1.4.1`)

### 1.4.3 — Contrast (Minimum)  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render (`scan`): 4.5:1 for body text, 3:1 for large text (>= 18.66px bold or >= 24px). The engine settles the inline-literal colour subset; everything else needs computed styles.

**Ask.**

- Have the states (hover, focus, disabled) and text over images/gradients been measured, not just the resting state?

**Citable references.** C29, F24, G136, G145, G148, G174, G18

### 1.4.4 — Resize Text  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: at 200% text zoom no content or functionality is lost, truncated or overlapped. Non-conforming when a `meta viewport` blocks zooming.

**Ask.**

- At 200%, does any text overlap, or any button escape its container?

**Citable references.** C12, C13, C14, C17, C28, F69, F80, G146, G179, SCR34

### 1.4.5 — Images of Text  ·  AA  ·  _needs-rendering_

**Decide.** Conforming when text is real text, except for a logotype or an essential presentation. Non-conforming for a heading, a button or a quotation baked into an image.

**Ask.**

- Is the image of text a logo (exempt), or a styling that CSS could reproduce?

**Citable references.** C22, C30, G136, G140

### 1.4.10 — Reflow  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: at 320 CSS px wide (equivalent to 400% on 1280px), no two-dimensional scrolling is required, except for content that inherently needs it (a map, a wide data table).

**Ask.**

- Does the remaining horizontal scrolling apply to genuinely exempt content, or to the whole page?

**Citable references.** C34, C37

### 1.4.11 — Non-text Contrast  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: 3:1 for user-interface components (a field border, a button outline, the focus indicator) and for the meaningful parts of graphics.

**Ask.**

- Do the border identifying a field, and the focus indicator, reach 3:1 against their background?

**Citable references.** F78, G145, G174, G18, G183, G195, G207

### 1.4.12 — Text Spacing  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: forcing line height 1.5x, paragraph spacing 2x, letter spacing 0.12x and word spacing 0.16x, no content is lost or clipped.

**Ask.**

- Do any fixed-height containers clip text once the spacing is increased?

**Citable references.** C21, C35, C36, C8

### 1.4.13 — Content on Hover or Focus  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: any additional content shown on hover or focus must be dismissible (Escape), hoverable (the pointer can reach it) and persistent (it does not vanish on its own).

**Ask.**

- Does the tooltip survive the pointer moving onto it, and does Escape close it without moving focus?

**Citable references.** F95

## 2.1 Keyboard Accessible

### 2.1.1 — Keyboard  ·  A  ·  _judgment_

**Decide.** Conforming when every function is operable with the keyboard alone. Non-conforming as soon as an action exists only for the mouse (a handler on a non-interactive element, drag-and-drop with no equivalent, mandatory hover).

**Ask.**

- Does each `onClick`/`onMouseEnter` on a non-native element have a keyboard equivalent (a native element, or role + tabindex + Enter/Space handling)?
- Do the composite widgets (menu, tabs, combobox) follow the expected keyboard contract (arrows, Escape, Home/End)?

**Citable references.** F10, F42, F54, F55, G202, G21, G4, G90, H91, SCR2, SCR20, SCR29 … (`criteria 2.1.1`)

### 2.1.2 — No Keyboard Trap  ·  A  ·  _needs-rendering_

**Decide.** Decided on the render: focus must be able to ENTER and LEAVE every component with the keyboard alone. Non-conforming for a modal, an embedded player or an editor that captures focus permanently.

**Ask.**

- In every modal and third-party iframe, does Tab eventually get out — and does Escape hand control back?

**Citable references.** F10, G202, G21, G4, G90, H91

### 2.1.4 — Character Key Shortcuts  ·  A  ·  _judgment_

**Decide.** Conforming when every single-printable-character shortcut can be turned off, remapped, or is active only while its component has focus. Non-conforming when it is global and cannot be disabled.

**Not applicable when.** No single-character shortcut.

**Ask.**

- Could a speech-input user dictating text trigger this shortcut by accident?

**Citable references.** F99, G217

## 2.2 Enough Time

### 2.2.1 — Timing Adjustable  ·  A  ·  _judgment_

**Decide.** Conforming when every time limit can be turned off, adjusted (x10) or extended on request. Exemptions: real-time activity, an essential event, a limit longer than 20 hours.

**Not applicable when.** No time limit.

**Ask.**

- Does the session expire? Is the user warned BEFORE it does, and can they extend it?

**Citable references.** F16, F4, F40, F41, F47, F50, F58, F61, F7, G11, G110, G133 … (`criteria 2.2.1`)

### 2.2.2 — Pause, Stop, Hide  ·  A  ·  _judgment_

**Decide.** Conforming when any moving, blinking or scrolling content lasting more than 5 seconds and starting automatically can be paused, stopped or hidden. Same for any auto-updating content.

**Not applicable when.** No moving content and no automatic updates.

**Ask.**

- Do carousels, animations and scrolling banners have a pause control reachable by keyboard?

**Citable references.** F16, F4, F40, F41, F47, F50, F58, F61, F7, G11, G110, G133 … (`criteria 2.2.2`)

## 2.3 Seizures and Physical Reactions

### 2.3.1 — Three Flashes or Below Threshold  ·  A  ·  _needs-rendering_

**Decide.** Decided on the render: nothing flashes more than three times per second, unless it stays below the general and red flash thresholds.

**Not applicable when.** No flashing content.

**Ask.**

- Does any video or animation contain rapid flashes (explosions, strobe effects)?

**Citable references.** G15, G176, G19

## 2.4 Navigable

### 2.4.1 — Bypass Blocks  ·  A  ·  _judgment_

**Decide.** Conforming when a mechanism bypasses repeated blocks: a working skip link, or a structure of landmarks and headings. Non-conforming when the user must traverse the navigation on every page.

**Ask.**

- Is the skip link the FIRST focusable element, visible on focus, and does its target actually receive focus?

**Citable references.** ARIA11, ARIA12, ARIA4, F15, F66, G1, G10, G115, G123, G124, G130, G135 … (`criteria 2.4.1`)

### 2.4.3 — Focus Order  ·  A  ·  _judgment_

**Decide.** Conforming when the tab order preserves meaning and operability. Non-conforming when focus jumps incoherently, enters hidden content, or departs from the visual order where that order carries meaning.

**Ask.**

- SPA (RGAA 12.8): after a partial navigation, is focus moved to the new content (not left on the clicked link, nor reset to the top)?
- When a modal opens, does focus move into it; when it closes, does it return to the trigger?

**Citable references.** C27, F1, F15, F44, F66, F85, G1, G10, G123, G124, G135, G140 … (`criteria 2.4.3`)

### 2.4.4 — Link Purpose (In Context)  ·  A  ·  _judgment_

**Decide.** Conforming when each link's purpose is understandable from its text alone, or from its text plus its immediate context (sentence, list item, cell + headers). Non-conforming for "read more", "click here", a bare URL, or two identically-named links going to different destinations.

**Ask.**

- Read out of context, does the text say WHERE the link goes or WHAT it triggers?
- Do two links with the same text lead to the same destination?
- Does a download link state the format and size (a recommendation, not normative)?

**Citable references.** ARIA7, ARIA8, F63, F89, G53, G91, H30, H78, H79, H80, H81

### 2.4.5 — Multiple Ways  ·  AA  ·  _judgment_

**Decide.** Conforming when at least TWO ways lead to each page: a search engine, a site map, the main navigation, a breadcrumb, an index. Exemption: a page that is a step in a process.

**Ask.**

- Do the two ways exist across the WHOLE site, or only on the home page?

**Citable references.** G161, G61, G63, G64

### 2.4.6 — Headings and Labels  ·  AA  ·  _judgment_

**Decide.** Conforming when each heading describes the section it introduces and each label describes what the field expects. Non-conforming for a generic heading ("Section 2"), a vague label ("Value"), or a heading that does not match its content.

**Ask.**

- Read on their own, do the headings give an understandable outline of the page?
- Table-title concision (RGAA 5.5): is each <caption> a SHORT, relevant title? A clear but verbose title should become a brief intro, with the details moved into text associated via aria-labelledby/aria-describedby.

**Citable references.** ARIA12, ARIA14, ARIA16, ARIA4, ARIA6, ARIA9, F68, F82, F86, G115, G130, G131 … (`criteria 2.4.6`)

### 2.4.7 — Focus Visible  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: every focusable element shows a visible focus indicator. Non-conforming for an unreplaced `outline: none`.

**Ask.**

- Is the indicator visible on ALL backgrounds (dark theme, hover, elements over images)?

**Citable references.** C15, F42, F54, F55, F73, F78, G149, G165, G183, G195, G202, G90 … (`criteria 2.4.7`)

### 2.4.11 — Focus Not Obscured (Minimum)  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: the element receiving focus is not entirely hidden by author-created content (a sticky header, a cookie banner, an action bar).

**Ask.**

- Tabbing down then up, does a sticky header or footer cover the focused element?

## 2.5 Input Modalities

### 2.5.1 — Pointer Gestures  ·  A  ·  _judgment_

**Decide.** Conforming when every function using a multipoint or path-based gesture has a single-pointer alternative. Non-conforming for a pinch, a swipe or a path with no button equivalent.

**Not applicable when.** No complex gesture.

**Ask.**

- Do carousels, maps and sliders offer buttons in addition to the gesture?

**Citable references.** G215, G216

### 2.5.2 — Pointer Cancellation  ·  A  ·  _judgment_

**Decide.** Conforming when no function executes on the DOWN event, or when it is abortable/reversible. Non-conforming for an action fired on `mousedown`/`touchstart` with no way to abort by moving the pointer away.

**Ask.**

- Do any `onMouseDown`/`onTouchStart` handlers fire the action instead of `onClick`?

### 2.5.3 — Label in Name  ·  A  ·  _judgment_

**Decide.** Conforming when, for every control with a visible text label, that text is CONTAINED in the accessible name. Non-conforming when `aria-label` replaces the visible text with a different wording: voice control can no longer find the target.

**Ask.**

- Does the accessible name ideally START with the visible text, so voice control matches the first spoken word?

**Citable references.** ARIA14, ARIA16, ARIA18, ARIA19, ARIA4, ARIA5, ARIA6, ARIA7, ARIA8, ARIA9, F15, F19 … (`criteria 2.5.3`)

### 2.5.4 — Motion Actuation  ·  A  ·  _judgment_

**Decide.** Conforming when every function triggered by device motion (shake, tilt) has an equivalent in the interface AND can be disabled.

**Not applicable when.** No motion actuation.

**Ask.**

- Does a `devicemotion`/`deviceorientation` listener trigger an action with no equivalent button?

### 2.5.7 — Dragging Movements  ·  AA  ·  _judgment_

**Decide.** Conforming when every dragging action has a single-pointer alternative that does not require dragging (buttons, an input, a menu). Non-conforming for reordering, a slider or a kanban that only supports drag-and-drop.

**Not applicable when.** No dragging interaction.

**Ask.**

- Do the reorderable lists offer "move up"/"move down" buttons in addition to dragging?

### 2.5.8 — Target Size (Minimum)  ·  AA  ·  _needs-rendering_

**Decide.** Decided on the render: the pointer target is at least 24x24 CSS px, unless there is sufficient spacing, an equivalent elsewhere, an inline-in-text target, or a legally mandated size.

**Ask.**

- Do the small icons (close, edit, delete) reach 24px, or do they benefit from the spacing exception?

## 3.1 Readable

### 3.1.2 — Language of Parts  ·  AA  ·  _judgment_

**Decide.** Conforming when every passage in a language other than the page's carries a correct `lang`. Exemptions: proper nouns, technical terms, words that have entered the vernacular.

**Not applicable when.** No change of language.

**Ask.**

- Are quotations, work titles and foreign expressions marked — and does the subtag actually match the text's language?

**Citable references.** H58

## 3.2 Predictable

### 3.2.1 — On Focus  ·  A  ·  _judgment_

**Decide.** Conforming when receiving focus triggers NO change of context. Non-conforming when focus opens a window, submits a form or moves focus elsewhere.

**Ask.**

- Do any `onFocus` handlers navigate, open a modal or move focus?

**Citable references.** F22, F36, F37, F41, F55, F9, G107, G13, G76, G80, H32, H84 … (`criteria 3.2.1`)

### 3.2.2 — On Input  ·  A  ·  _judgment_

**Decide.** Conforming when changing a control's value does not by itself trigger a change of context, or when the user was warned beforehand. Non-conforming for a `<select>` that navigates on change.

**Ask.**

- Is the change announced BEFORE (help text above the field), or does the user discover it afterwards?

**Citable references.** F22, F36, F37, F41, F9, G107, G13, G76, G80, H32, H84, SCR19

### 3.2.3 — Consistent Navigation  ·  AA  ·  _judgment_

**Decide.** Conforming when repeated navigation mechanisms appear in the SAME relative order from page to page. Non-conforming when the menu entries reorder across pages.

**Ask.**

- Across the page sample, do the main navigation, the breadcrumb and the footer keep the same order?

**Citable references.** F66, G1, G123, G124, G59, G61, G63, SCR28

### 3.2.4 — Consistent Identification  ·  AA  ·  _judgment_

**Decide.** Conforming when components with the same function are identified the same way everywhere (same wording, same icon, same accessible name). Non-conforming when "Search" becomes "Find" from page to page.

**Ask.**

- Do the recurring icons (print, share, download) carry the same accessible name everywhere?

**Citable references.** F31

### 3.2.6 — Consistent Help  ·  A  ·  _judgment_

**Decide.** Conforming when, wherever a help mechanism (contact, chat, FAQ, contextual help) appears on multiple pages, it sits in the same relative order. New in WCAG 2.2.

**Not applicable when.** No help mechanism.

**Ask.**

- Does the contact link or chat widget sit in the same relative position on every page that carries it?

## 3.3 Input Assistance

### 3.3.1 — Error Identification  ·  A  ·  _judgment_

**Decide.** Conforming when every automatically detected input error is identified IN TEXT and the offending field is pointed out. Non-conforming for a red border alone, or a message not associated with its field.

**Not applicable when.** No automatic input-error detection.

**Ask.**

- Is the error message tied to the field (`aria-describedby`/`aria-errormessage`) and announced when it appears?

**Citable references.** ARIA1, ARIA16, ARIA2, ARIA21, ARIA6, ARIA9, F81, G184, G83, G84, G85, G89 … (`criteria 3.3.1`)

### 3.3.2 — Labels or Instructions  ·  A  ·  _judgment_

**Decide.** Conforming when every field carries a label or instruction where input is expected. Non-conforming when the expected format (date, password, phone) is stated nowhere before the error.

**Ask.**

- Are the format and constraints stated BEFORE input, not only in the error message?

**Citable references.** ARIA1, ARIA14, ARIA16, ARIA17, ARIA2, ARIA21, ARIA6, ARIA9, F68, F81, F82, F86 … (`criteria 3.3.2`)

### 3.3.3 — Error Suggestion  ·  AA  ·  _judgment_

**Decide.** Conforming when, where the correction is known, a suggestion is offered. Non-conforming for an "invalid field" that does not say what is expected, unless suggesting it would compromise security.

**Not applicable when.** No automatically detected input error.

**Ask.**

- Does the message say HOW to fix it ("the date must be DD/MM/YYYY"), or only that it is wrong?

**Citable references.** G177, G84, G85, G89, H89

### 3.3.4 — Error Prevention (Legal, Financial, Data)  ·  AA  ·  _judgment_

**Decide.** Conforming when legal, financial or data-modifying submissions are reversible, checked, or confirmed. Non-conforming for a one-click irreversible deletion or order.

**Not applicable when.** No legal, financial or data-modifying transaction.

**Ask.**

- Can the user review and correct before final submission?

**Citable references.** G155, G164, G168, G98, G99

### 3.3.7 — Redundant Entry  ·  A  ·  _judgment_

**Decide.** Conforming when no information already entered in the same process is asked for again, unless re-entry is essential (password confirmation) or the information is no longer valid. New in WCAG 2.2.

**Ask.**

- Does a multi-step flow ask again for an address or email already entered, with no prefill and no selection?

### 3.3.8 — Accessible Authentication (Minimum)  ·  AA  ·  _judgment_

**Decide.** Conforming when no authentication step requires a cognitive function test (memorise, transcribe, solve), unless an alternative, a mechanism, object recognition or user-provided content is available. Pasting and autofill must remain possible. New in WCAG 2.2.

**Not applicable when.** No authentication.

**Ask.**

- Is pasting possible in the credential fields, and can a password manager fill them?
- Is a transcription CAPTCHA or a code to retype from memory imposed with no alternative?

## 4.1 Compatible

### 4.1.2 — Name, Role, Value  ·  A  ·  _judgment_

**Decide.** Conforming when every user-interface component exposes a name, a role and — where it carries state — a value, all kept up to date. Non-conforming for a custom widget with no role, no name, or whose ARIA state does not track the real one.

**Ask.**

- For each custom widget: does the role match the actual behaviour, and does the state (`aria-expanded`, `aria-checked`, `aria-selected`) track the interaction?
- Does the accessible name match what the user sees and would say?

**Citable references.** ARIA10, ARIA11, ARIA12, ARIA14, ARIA16, ARIA18, ARIA19, ARIA4, ARIA5, ARIA6, ARIA9, C9 … (`criteria 4.1.2`)

### 4.1.3 — Status Messages  ·  AA  ·  _judgment_

**Decide.** Conforming when every status message (success, error, search results, loading) is exposed through a role or property allowing announcement WITHOUT receiving focus. Non-conforming for a message inserted into an ordinary container.

**Not applicable when.** No status message.

**Ask.**

- Does the live region exist IN THE DOM before the message is inserted (a region created together with its content is not announced)?
- Is the politeness right: `polite` for a status, `alert`/`assertive` for a blocking error?

**Citable references.** ARIA19, ARIA22, ARIA23
