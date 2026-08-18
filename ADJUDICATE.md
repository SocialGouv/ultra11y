# Criteria adjudication (ultra11y)

For EACH criterion, read the evidence below (harvested from the audited source) and set a verdict in `ADJUDICATE.todo.json` (field `verdict`):

- `C` — conformant (fill `justification` AND `citations[]`: the evidence you cleared, `file`/`line` copied from the criterion's own list);
- `NC` — non-conformant (add at least one `findings[]`: file/line/message, with a groundable `snippet` AND a `normativeRef` citing the precise failed test);
- `NA` — not applicable (fill `justification`; when evidence is presented, cite it too in `citations[]` to say which items are out of scope);
- `manual` — not statically decidable (fill `reason`: `needs-rendered-dom` → `scan`, or `undecidable`).

> Report NC only if a precise test of the active standard fails — cite it (`normativeRef`). A good practice without a normative test is a recommendation (`recommendations[]`, non-normative). A purely UX concern is neither.
>
> A `C` is cited the same way an NC is: name the evidence you cleared in `citations[]`. **A criterion presented with no evidence at all cannot be `C`** — record `manual` (`undecidable`), or `NA` if nothing in scope is concerned.

Then: `ultra11y verify --apply ADJUDICATE.todo.json --in <audit.json> --out <dir>` (fails if any verdict lacks its justification, citations, finding or reason).

## 1.1.1 — Non-text Content  _(judgment)_

> Evidence (0) — 0 distinct content classes, 0 occurrences:

(no automatic evidence — decide from source, or leave `manual` with a reason)

> **Decision rule** — Conforming when EVERY non-text content carries an alternative serving the same purpose: a description of the meaning for an informative image, alt="" for a decorative one, a description of the action for a control. Non-conforming as soon as one alternative is missing, empty on a meaningful image, or off-topic (a file name, "image", "logo").

> **Not applicable when** — No non-text content in scope.

> To verify manually:

- For each alt: does it describe what the image CONTRIBUTES here, rather than what it depicts? The same photo can need two different alternatives in two contexts.
- Do the purely decorative images carry alt="" (not a missing alt)? A named decorative image is as harmful as a silent informative one.
- For a chart or infographic: does the alternative give the DATA (or point to an equivalent table), or does it merely name the chart?

> Normative references you may cite (this criterion's W3C techniques/failures): ARIA10, ARIA4, ARIA6, ARIA7, ARIA8, ARIA9, C9, F15, F19, F20, F3, F30 … (`criteria 1.1.1`)

## 1.2.1 — Audio-only and Video-only (Prerecorded)  _(judgment)_

> Evidence (0) — 0 distinct content classes, 0 occurrences:

(no automatic evidence — decide from source, or leave `manual` with a reason)

> **Decision rule** — Conforming when every audio-only media has a text transcript, and every video-only media a transcript OR an equivalent audio track. Non-conforming when the media carries information available nowhere else.

> **Not applicable when** — No audio-only or video-only media.

> To verify manually:

- Is the transcript reachable from the media's own page (an adjacent link, a disclosure panel) rather than buried elsewhere?
- Does it cover ALL the content, including speaker identification and meaningful sounds?

> Normative references you may cite (this criterion's W3C techniques/failures): F30, F67, G158, G159, G166, G173, G58, G69, G78, G8, H96, SM6 … (`criteria 1.2.1`)
