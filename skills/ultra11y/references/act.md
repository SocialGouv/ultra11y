<!-- GENERATED from the vendored W3C ACT corpus by `pnpm run build:act` — do not edit by hand. -->

# ACT conformance — how this engine scores against a corpus it did not write

The recall matrix in this repository proves that each rule fires on the defect written FOR it.
That is circular. The [W3C ACT-Rules Community Group](https://act-rules.github.io) publishes rules
with `passed` / `failed` / `inapplicable` examples authored independently of this project, so running
the engine over them measures something a self-authored fixture cannot.

**How to read this.** An ACT example asserts something about ITS OWN rule and nothing else, so each
case is judged only with the engine rules mapped to that ACT rule — never with the whole engine.
Only normative findings count (an `advisory` recommendation never flips a criterion, so it cannot
fail a case either). Rules needing a rendered page or a human call are declared, not scored — saying
so beats quietly scoring zero.

## Summary

| | |
|---|---|
| Corpus | 1134 examples across 91 ACT rules |
| Source | https://act-rules.github.io/testcases.json |
| Rules scored | **32** |
| Failed examples caught | **103 / 149** |
| Clean examples left alone | **291 / 291** — no unexplained false positive |
| Consistent | 5 |
| Divergent (documented, 9 cases) | 3 |
| Partially consistent | 24 |
| **Inconsistent** | **0** |
| Declared gaps (static, not implemented) | 13 |

*Partially consistent* is the ACT Rules Format's own term for a tool that never reports a false
positive but does not catch everything — it is a coverage statement, not an error. *Divergent* means
every deviation on that rule is listed below with the argument for it.

## Scored rules

| ACT rule | WCAG | Engine rules | Verdict | Caught |
|---|---|---|---|---|
| [Image has non-empty accessible name](https://act-rules.github.io/rules/23a2a8) | 1.1.1 | `img-alt-missing` | 🟨 partially consistent | 4/5 |
| [HTML page has non-empty title](https://act-rules.github.io/rules/2779a5) | 2.4.2 | `title-missing-empty` | 🟨 partially consistent | 4/5 |
| [Visible label is part of accessible name](https://act-rules.github.io/rules/2ee8b8) | 2.5.3 | `label-in-name-mismatch` | 🟦 divergent (documented) | 3/3 |
| [Id attribute value is unique](https://act-rules.github.io/rules/3ea0c8) | 4.1.1 | `duplicate-id` | ✅ consistent | 3/3 |
| [Audio or video element that plays automatically has a control mechanism](https://act-rules.github.io/rules/4c31df) | — | `autoplay-media` | 🟦 divergent (documented) | 5/5 |
| [Element with role attribute has required states and properties](https://act-rules.github.io/rules/4e8ab6) | 4.1.2 | `aria-required-attr` | 🟨 partially consistent | 1/2 |
| [Image button has non-empty accessible name](https://act-rules.github.io/rules/59796f) | 1.1.1, 4.1.2 | `input-image-alt-missing` | 🟨 partially consistent | 2/3 |
| [ARIA state or property is permitted](https://act-rules.github.io/rules/5c01ea) | — | `aria-prohibited-attr` | 🟨 partially consistent | 0/2 |
| [ARIA attribute is defined in WAI-ARIA](https://act-rules.github.io/rules/5f99a7) | — | `invalid-aria-attr` | ✅ consistent | 2/2 |
| [Role attribute has valid value](https://act-rules.github.io/rules/674b10) | 1.3.1 | `invalid-aria-role` | ✅ consistent | 2/2 |
| [ARIA state or property has valid value](https://act-rules.github.io/rules/6a7281) | — | `invalid-aria-value`, `live-region-conflict` | 🟨 partially consistent | 9/10 |
| [Element with aria-hidden has no content in sequential focus navigation](https://act-rules.github.io/rules/6cfa84) | 4.1.2 | `aria-hidden-focusable` | 🟨 partially consistent | 5/6 |
| [Autocomplete attribute has valid value](https://act-rules.github.io/rules/73f2c2) | 1.3.5 | `autocomplete-token-invalid` | ✅ consistent | 5/5 |
| [SVG element with explicit role has non-empty accessible name](https://act-rules.github.io/rules/7d6734) | 1.1.1 | `img-alt-missing` | 🟨 partially consistent | 2/4 |
| [Audio or video element avoids automatically playing audio](https://act-rules.github.io/rules/80f0bf) | 1.4.2 | `autoplay-media` | 🟦 divergent (documented) | 2/2 |
| [Object element rendering non-text content has non-empty accessible name](https://act-rules.github.io/rules/8fc3b6) | 1.1.1 | `object-embed-no-name` | 🟨 partially consistent | 2/4 |
| [Button has non-empty accessible name](https://act-rules.github.io/rules/97a4e1) | 4.1.2 | `button-empty-name`, `icon-only-control-unnamed` | 🟨 partially consistent | 4/5 |
| [Headers attribute specified on a cell refers to cells in the same table element](https://act-rules.github.io/rules/a25f45) | 1.3.1 | `headers-attr-dangling` | ✅ consistent | 4/4 |
| [Meta viewport allows for zoom](https://act-rules.github.io/rules/b4f0c3) | 1.4.4 | `meta-viewport-zoom-block` | 🟨 partially consistent | 3/4 |
| [HTML page has lang attribute](https://act-rules.github.io/rules/b5c3f8) | 3.1.1 | `html-lang-missing` | 🟨 partially consistent | 3/4 |
| [ARIA required owned elements](https://act-rules.github.io/rules/bc4a75) | 1.3.1 | `aria-required-children` | 🟨 partially consistent | 3/7 |
| [Meta element has no refresh delay](https://act-rules.github.io/rules/bc659a) | 2.2.1, 2.2.4, 3.2.5 | `meta-refresh-redirect` | 🟨 partially consistent | 3/4 |
| [HTML page lang attribute has valid language tag](https://act-rules.github.io/rules/bf051a) | 3.1.1 | `lang-invalid` | 🟨 partially consistent | 1/4 |
| [Meta element has no refresh delay (no exception)](https://act-rules.github.io/rules/bisz58) | 2.2.4, 3.2.5 | `meta-refresh-redirect` | 🟨 partially consistent | 2/4 |
| [Link has non-empty accessible name](https://act-rules.github.io/rules/c487ae) | 2.4.4, 2.4.9, 4.1.2 | `link-empty-name`, `icon-only-control-unnamed` | 🟨 partially consistent | 7/11 |
| [Iframe element has non-empty accessible name](https://act-rules.github.io/rules/cae760) | 4.1.2 | `iframe-title-missing` | 🟨 partially consistent | 3/4 |
| [Table header cell has assigned cells](https://act-rules.github.io/rules/d0f69e) | 1.3.1 | `th-no-data-cells` | 🟨 partially consistent | 0/3 |
| [Element with lang attribute has valid language tag](https://act-rules.github.io/rules/de46e4) | 3.1.2 | `lang-invalid`, `inline-lang-change-missing` | 🟨 partially consistent | 6/9 |
| [Form field has non-empty accessible name](https://act-rules.github.io/rules/e086e5) | 4.1.2 | `control-label-missing` | 🟨 partially consistent | 4/7 |
| [Video element auditory content has captions](https://act-rules.github.io/rules/f51b46) | — | `media-no-track` | 🟨 partially consistent | 0/4 |
| [ARIA required context role](https://act-rules.github.io/rules/ff89c9) | 1.3.1 | `aria-required-parent` | 🟨 partially consistent | 2/4 |
| [Heading has non-empty accessible name](https://act-rules.github.io/rules/ffd0e9) | 1.3.1 | `empty-heading` | 🟨 partially consistent | 7/8 |

### Notes and documented divergences

- **Visible label is part of accessible name** · reports on *Passed Example 6*: an icon FONT renders the text 'search' as a glyph, so the visible label is not the text in the DOM — a fact only the rendered page carries
- **Audio or video element that plays automatically has a control mechanism** · reports on *Inapplicable Example 2*: the source cannot tell that the referenced media has no audio track
- **Audio or video element that plays automatically has a control mechanism** · reports on *Passed Example 3*: the pause mechanism is a custom button wired in JavaScript, not a native `controls` attribute
- **ARIA state or property is permitted** — covers the name-prohibited roles; the full per-role permitted-attribute matrix is not encoded
- **Element with aria-hidden has no content in sequential focus navigation** · reports on *Passed Example 4*: a focus-sentinel link inside an aria-hidden wrapper: it IS reachable by Tab, and only a runtime focus handler bounces it back — the same call axe-core makes
- **SVG element with explicit role has non-empty accessible name** — role=img on <svg> is handled by the same rule
- **Audio or video element avoids automatically playing audio** · reports on *Inapplicable Example 2*: the source cannot tell that the referenced media file is silent
- **Audio or video element avoids automatically playing audio** · reports on *Passed Example 3*: the pause mechanism is a custom button wired in JavaScript, not a native `controls` attribute
- **Audio or video element avoids automatically playing audio** · reports on *Passed Example 2*: a #t= media fragment shortening playback below 3s is not resolvable from source
- **Meta element has no refresh delay (no exception)** — this variant drops the >20h exception the engine honours, so long delays are knowingly not reported
- **Iframe element has non-empty accessible name** · reports on *Inapplicable Example 3*: a tabindex=-1 iframe is still exposed to assistive tech and still needs a title (RGAA 2.1 requires one unconditionally)
- **Table header cell has assigned cells** — only the explicit `headers`-wired shape is decided; scope-based assignment needs a full table model
- **Element with lang attribute has valid language tag** · reports on *Inapplicable Example 2*: lang="" on an element carrying text declares no language for that text; ACT deems the rule inapplicable, this engine reports it under 3.1.2
- **Form field has non-empty accessible name** — `placeholder-as-label` is deliberately NOT mapped: a placeholder does contribute to the accessible name, so ACT passes it — ultra11y still reports it, as a stricter house rule under 3.3.2.
- **Video element auditory content has captions** — presence of a caption track; whether the captions are accurate is a judgment call

## Declared gaps — statically decidable, not implemented yet

| ACT rule | WCAG | Why it is not covered |
|---|---|---|
| [Document has heading for non-repeated content](https://act-rules.github.io/rules/047fe0) | — | a heading for the non-repeated content (h1-missing is advisory, so it does not count) |
| [Letter spacing in style attributes is not !important](https://act-rules.github.io/rules/24afc2) | 1.4.12 | letter-spacing:!important in a style attribute |
| [Element with presentational children has no focusable content](https://act-rules.github.io/rules/307n5z) | 4.1.2 | presentational-children conflict |
| [Element marked as decorative is not exposed](https://act-rules.github.io/rules/46ca7f) | — | an element marked decorative that is still exposed (focusable, or with a name) |
| [HTML page lang and xml:lang attributes have matching values](https://act-rules.github.io/rules/5b7ae0) | 3.1.1 | lang vs xml:lang mismatch |
| [Line height in style attributes is not !important](https://act-rules.github.io/rules/78fd32) | 1.4.12 | line-height:!important in a style attribute |
| [Word spacing in style attributes is not !important](https://act-rules.github.io/rules/9e45ec) | 1.4.12 | word-spacing:!important in a style attribute |
| [Document has a landmark with non-repeated content](https://act-rules.github.io/rules/b40fd1) | — | ACT asks that the non-repeated content sit in SOME landmark — a weaker claim than `missing-main-landmark`, which requires a <main>, so the two are not equivalent |
| [Bypass Blocks of Repeated Content](https://act-rules.github.io/rules/cf77f2) | 2.4.1 | presence of a bypass mechanism (landmark or skip link) |
| [Attribute is not duplicated](https://act-rules.github.io/rules/e6952f) | 4.1.1 | duplicate attributes are collapsed by the parser; needs a raw-source scan |
| [No keyboard shortcut uses only printable characters](https://act-rules.github.io/rules/ffbc54) | 2.1.4 | 2.1.4 single-character keyboard shortcuts |
| [Menuitem has non-empty accessible name](https://act-rules.github.io/rules/m6b1q3) | 4.1.2 | role-specific accessible name (menuitem) |
| [Document has an instrument to move focus to non-repeated content](https://act-rules.github.io/rules/ye5d6e) | — | presence of a bypass instrument |

## Out of the static engine's reach — routed, not ignored

| ACT rule | WCAG | Decided by |
|---|---|---|
| [Text has enhanced contrast](https://act-rules.github.io/rules/09o5cg) | 1.4.6 | rendered (`scan`) — AAA enhanced contrast — outside the AA core |
| [Scrollable element is keyboard accessible](https://act-rules.github.io/rules/0ssw9k) | 2.1.1, 2.1.3 | rendered (`scan`) |
| [HTML graphics contain no text](https://act-rules.github.io/rules/0va7u6) | 1.4.5, 1.4.9 | rendered (`scan`) — text baked into a graphic |
| [Audio and visuals of video element have transcript](https://act-rules.github.io/rules/1a02b0) | 1.2.8 | judgment (agent) |
| [Video element visual content has audio description](https://act-rules.github.io/rules/1ea59c) | — | judgment (agent) |
| [Video element visual content has strict accessible alternative](https://act-rules.github.io/rules/1ec09b) | 1.2.5 | judgment (agent) |
| [Audio element content has transcript](https://act-rules.github.io/rules/2eb176) | — | judgment (agent) |
| [Error message describes invalid form field value](https://act-rules.github.io/rules/36b590) | 3.3.1 | judgment (agent) |
| [Block of repeated content is collapsible](https://act-rules.github.io/rules/3e12e1) | — | rendered (`scan`) |
| [Iframe elements with identical accessible names have equivalent purpose](https://act-rules.github.io/rules/4b1c6c) | 4.1.2 | judgment (agent) |
| [Zoomed text node is not clipped with CSS overflow](https://act-rules.github.io/rules/59br37) | 1.4.4 | rendered (`scan`) — clipping under zoom — probed by scan --runtime local |
| [Link in context is descriptive](https://act-rules.github.io/rules/5effbb) | 2.4.4, 2.4.9 | judgment (agent) — link purpose in context (2.4.4) |
| [Device motion based changes to the content can also be created from the user interface](https://act-rules.github.io/rules/7677a9) | 2.5.4 | judgment (agent) |
| [Focusable element has no keyboard trap](https://act-rules.github.io/rules/80af7b) | 2.1.2 | rendered (`scan`) |
| [Content has alternative for visual reference](https://act-rules.github.io/rules/9bd38c) | 1.3.3 | judgment (agent) — sensory characteristics (1.3.3) |
| [DEPRECATED — Image filename is accessible name for image](https://act-rules.github.io/rules/9eb3f6) | 1.1.1 | withdrawn upstream |
| [Focusable element has no keyboard trap via standard navigation](https://act-rules.github.io/rules/a1b64e) | — | rendered (`scan`) |
| [Audio or video element that plays automatically has no audio that lasts more than 3 seconds](https://act-rules.github.io/rules/aaa1bf) | — | rendered (`scan`) — needs the media's duration |
| [Video element content is media alternative for text](https://act-rules.github.io/rules/ab4d13) | — | judgment (agent) |
| [DEPRECATED — Video element visual-only content has description track](https://act-rules.github.io/rules/ac7dc6) | — | withdrawn upstream |
| [Audio element content is media alternative for text](https://act-rules.github.io/rules/afb423) | — | judgment (agent) |
| [Text has minimum contrast](https://act-rules.github.io/rules/afw4f7) | 1.4.3, 1.4.6 | rendered (`scan`) — computed contrast; only inline literal colour pairs are decided statically (contrast-literal) |
| [Link is descriptive](https://act-rules.github.io/rules/aizyf1) | 2.4.9 | judgment (agent) |
| [Iframe with negative tabindex has no interactive elements](https://act-rules.github.io/rules/akn7bn) | 2.1.1 | rendered (`scan`) — needs the iframe's own document |
| [Links with identical accessible names have equivalent purpose](https://act-rules.github.io/rules/b20e66) | 2.4.9 | judgment (agent) |
| [Orientation of the page is not restricted using CSS transform property](https://act-rules.github.io/rules/b33eff) | 1.3.4 | rendered (`scan`) — orientation lock via CSS transform |
| [Heading is descriptive](https://act-rules.github.io/rules/b49b2e) | 2.4.6 | judgment (agent) — is the heading descriptive (2.4.6) |
| [Device motion based changes to the content can be disabled](https://act-rules.github.io/rules/c249d5) | 2.5.4 | judgment (agent) |
| [Video element visual-only content has accessible alternative](https://act-rules.github.io/rules/c3232f) | 1.2.1 | judgment (agent) |
| [HTML page title is descriptive](https://act-rules.github.io/rules/c4a8a4) | 2.4.2 | judgment (agent) |
| [Video element visual content has accessible alternative](https://act-rules.github.io/rules/c5a4ea) | 1.2.3, 1.2.5, 1.2.8 | judgment (agent) |
| [Form field label is descriptive](https://act-rules.github.io/rules/cc0f0a) | 2.4.6 | judgment (agent) |
| [Video element visual-only content has audio track alternative](https://act-rules.github.io/rules/d7ba54) | — | judgment (agent) |
| [Audio element content has text alternative](https://act-rules.github.io/rules/e7aa44) | 1.2.1 | judgment (agent) |
| [Image not in the accessibility tree is decorative](https://act-rules.github.io/rules/e88epe) | 1.1.1 | judgment (agent) — is the image genuinely decorative |
| [Video element auditory content has accessible alternative](https://act-rules.github.io/rules/eac66b) | 1.2.2 | judgment (agent) |
| [Focusable element has no keyboard trap via non-standard navigation](https://act-rules.github.io/rules/ebe86a) | — | rendered (`scan`) |
| [Video element visual-only content has transcript](https://act-rules.github.io/rules/ee13b5) | — | judgment (agent) |
| [Text content that changes automatically can be paused, stopped or hidden](https://act-rules.github.io/rules/efbfc7) | 2.2.2 | rendered (`scan`) |
| [DEPRECATED — Video element visual content has description track](https://act-rules.github.io/rules/f196ce) | — | withdrawn upstream |
| [Video element visual-only content is media alternative for text](https://act-rules.github.io/rules/fd26cf) | — | judgment (agent) |
| [Links with identical accessible names and same context serve equivalent purpose](https://act-rules.github.io/rules/fd3a94) | 2.4.4, 2.4.9 | judgment (agent) |
| [HTML element language subtag matches language](https://act-rules.github.io/rules/off6ek) | 3.1.2 | judgment (agent) — does the subtag match the actual text language |
| [Element in sequential focus order has visible focus](https://act-rules.github.io/rules/oj04fd) | 2.4.7 | rendered (`scan`) — visible focus (2.4.7) — probed by scan --runtime local |
| [Image accessible name is descriptive](https://act-rules.github.io/rules/qt1vmo) | 1.1.1 | judgment (agent) — is the alt relevant (1.1.1) |
| [HTML page language subtag matches default language](https://act-rules.github.io/rules/ucwvc8) | 3.1.1 | judgment (agent) |

The corpus is vendored at `scripts/vendor/act-testcases.json` (refreshed by
`pnpm run build:act:refresh`, and daily by the act-refresh workflow) so the suite stays
offline and deterministic.
ACT-Rules Community Group test cases are © their contributors under the W3C Software and
Document License — see `NOTICE`.
