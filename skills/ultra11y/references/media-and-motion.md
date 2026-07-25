# Media, pointer input and motion

The criteria in this page are the ones a source-only audit is least able to settle: what a
video actually contains, how big a target renders, whether an animation lasts five seconds.
Each entry says what decides it — you, the `scan` tier, or the engine.

## Time-based media (1.2.x)

| Media | What it needs | Level |
|---|---|---|
| Audio-only, prerecorded | A text transcript | A (1.2.1) |
| Video-only, prerecorded | A transcript OR an equivalent audio track | A (1.2.1) |
| Video with audio, prerecorded | Synchronized captions | A (1.2.2) |
| Video with audio, prerecorded | Audio description OR a full text alternative | A (1.2.3) |
| Video with audio, prerecorded | Audio description — a transcript no longer suffices | **AA (1.2.5)** |
| Any live audio | Real-time captions | AA (1.2.4) |

```html
<video controls>
  <source src="talk.mp4" type="video/mp4">
  <track kind="captions" src="talk.en.vtt" srclang="en" label="English" default>
  <track kind="descriptions" src="talk.desc.vtt" srclang="en" label="Audio description">
</video>
<p><a href="talk-transcript.html">Read the transcript of this talk</a></p>
```

`kind` matters: `captions` include non-speech sounds and speaker identification;
`subtitles` are a translation for people who can hear; `descriptions` narrate the picture.
A `subtitles` track does not satisfy 1.2.2.

**Why the engine only recommends here.** A `<video>` without `<track>` may still carry
captions embedded in the container, and its audio track may be silent. Neither is knowable
from source, so `media-no-track` is a **recommendation**: 1.2.2 stays yours to adjudicate
against the real media. Check the file and the player before writing a verdict.

Also in scope: a media player's own controls must be keyboard-operable and named (2.1.1,
4.1.2) — a custom player is a composite widget, see `references/widgets.md`.

## Autoplay (1.4.2, 2.2.2)

Audio that plays automatically for more than 3 seconds needs a mechanism to pause, stop or
control its volume, independent of the system volume. Native `controls` is that mechanism.

```html
<video autoplay muted playsinline>…</video>   <!-- no audio: 1.4.2 not engaged -->
<audio src="jingle.mp3" autoplay controls>     <!-- ✓ a stop mechanism exists -->
```

Engine rule: `autoplay-media` — normative only when there is no `controls` and no `muted`;
the muted-video case is raised as a recommendation, since the source cannot show whether the
movement lasts the 5 seconds 2.2.2 requires.

## Pointer input (2.5.x)

| SC | Requirement | How to satisfy it |
|---|---|---|
| **2.5.1** Pointer Gestures | No function requires a multipoint or path-based gesture | Add buttons beside the swipe/pinch: carousel arrows, map zoom controls |
| **2.5.2** Pointer Cancellation | No function executes on the DOWN event, or it is abortable | Act on `click`/`pointerup`, not `pointerdown`; allow the user to slide off to abort |
| **2.5.3** Label in Name | Visible label contained in the accessible name | See `references/naming.md` |
| **2.5.4** Motion Actuation | Motion-triggered functions have a UI equivalent AND can be disabled | Keep a button for "shake to undo"; offer a setting |
| **2.5.7** Dragging Movements (2.2) | Every drag has a single-pointer alternative | "Move up"/"Move down" buttons beside a drag handle; a numeric input beside a slider |
| **2.5.8** Target Size (2.2) | Targets are at least 24×24 CSS px | Or spaced so 24px circles do not overlap; inline links in text are exempt |

```html
<!-- ✓ drag remains, but is never the only way -->
<li draggable="true">
  Task one
  <button aria-label="Move “Task one” up">↑</button>
  <button aria-label="Move “Task one” down">↓</button>
</li>
```

2.5.8 is decided on the render — `scan` measures it through axe's `target-size` rule.

## Orientation, reflow, spacing, zoom (1.3.4, 1.4.4, 1.4.10, 1.4.12)

All four are decided on the rendered page (`scan --runtime local` probes zoom, spacing and
overflow). What to check:

- **1.3.4 Orientation** — the content works in both portrait and landscape, unless the
  orientation is genuinely essential (a piano keyboard, a cheque to photograph). A CSS
  `transform` or a blocking orientation media query is the usual culprit.
- **1.4.4 Resize Text** — at 200% text zoom nothing is lost, clipped or overlapped. A
  `meta viewport` blocking zoom fails outright (engine rule: `meta-viewport-zoom-block`).
- **1.4.10 Reflow** — at **320 CSS px** wide (the equivalent of 400% zoom on a 1280px
  viewport) no two-dimensional scrolling is required, except for content that inherently
  needs it: maps, data tables, diagrams, code.
- **1.4.12 Text Spacing** — forcing line height 1.5×, paragraph spacing 2×, letter spacing
  0.12× and word spacing 0.16× loses no content. Fixed-height containers are what break.

## Motion and vestibular safety (2.3.1, 2.2.2)

```css
/* Respect the OS-level preference — a one-line win that costs nothing */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

`prefers-reduced-motion` is not itself a WCAG 2.2 AA requirement, but large parallax,
auto-playing motion and full-page transitions trigger vestibular disorders, and honouring it
is how you avoid the 2.2.2 problem entirely. 2.3.1 (nothing flashes more than three times a
second) is decided on the render.

## What the engine settles, and what stays yours

| Decided by the engine | Decided by `scan` | Yours to adjudicate |
|---|---|---|
| `autoplay` with no stop mechanism; `meta viewport` blocking zoom; `blink`/`marquee`; timed `meta refresh` | Zoom 200%, reflow 320px, text spacing, target size, flashing | Whether captions/audio description/transcripts exist and are accurate (1.2.x) |
| Missing `<track>` — as a recommendation, not a failure | — | Whether a gesture, a drag or a motion trigger has an alternative (2.5.1/2.5.2/2.5.4/2.5.7) |
| — | — | Whether an orientation is genuinely essential (1.3.4) |
