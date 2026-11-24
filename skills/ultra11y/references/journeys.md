# Journeys — user paths you write, ultra11y replays

`scan` opens pages and performs only safe, automatic interactions. It never logs in, never
submits a form, never walks a funnel. A **journey** is that sequence of actions, written by you
after reading the application, and replayed by `journey run` in the local Playwright with the
pinned axe-core and the live probes. Every step records a page state in
`.ultra11y/pages/<journey>-<nn>-<slug>/`, in the same format as `scan`, so each state becomes an
audited page of the grid.

```sh
node scripts/ultra11y.mjs journey list
node scripts/ultra11y.mjs journey run --all --keyboard --base-url http://localhost:3000 \
  --merge audits/audit-latest.json --out audits
```

`journey run <name>…` replays some journeys and `--all` replays every one. `--storage-state
<file>` loads a session, and a journey's own `storageState` wins over it. `--merge` folds the
states into the audit, as `scan --merge` does. The command exits 1 when a journey failed.

## The file: `.ultra11y/journeys/<name>.json`

| Key | |
|---|---|
| `name` | `[a-z0-9-]`, prefixes the step ids |
| `startUrl` | absolute, or a path resolved against `--base-url` (step 0) |
| `storageState` | optional Playwright session file, relative to the root |
| `keyboardOnly` | optional, same as `--keyboard` |
| `steps` | `{ action, target?, value?, url?, key?, state?, timeoutMs?, note? }` |

Actions: `goto` (`url`), `click`, `fill` (`value`), `select` (`value`), `check`, `press` (`key`:
`Tab`, `Enter`, `Escape`, `ArrowDown`, with an optional target), `waitFor` and `expect` (`state`:
`visible` by default, or `hidden`, `attached`, `detached`). A target is exactly one of
`{ "role", "name"?, "exact"? }`, `{ "label" }`, `{ "text" }` or `{ "css" }`. Prefer role and
label: they are what a user perceives. The validator is strict: an unknown key, a missing
value or an ambiguous target is an error with its path (`journey list` shows them).

## What the replay measures

At every step it runs axe, the probes (zoom, reflow, text spacing, focus visibility, keyboard
trap on the ring, hover), and these journey observations:

| Observation | WCAG | RGAA |
|---|---|---|
| Keyboard mode: Tab walks the whole order and never reaches the control | 2.1.1 (bloquant) | 7.3 |
| Neither Tab nor Shift+Tab can leave a region | 2.1.2 (bloquant) | 12.9 |
| Focus not moved into an opened dialog, or not returned to its opener | 2.4.3 | 12.8 |
| An error shown after an action, tied to no field (`aria-describedby`, `aria-errormessage`, `<label>`) | 3.3.1 | 11.10 |
| Text that appears outside any live region after an action | 4.1.3 (mineur) | 7.5 |

In keyboard mode, `click`, `check`, `fill` and `select` first reach their target with Tab (and
Shift+Tab), then press Enter or Space, or type. Each step records the focus order it walked. A
control that cannot be reached is a finding. The step is then played with the pointer, so the
rest of the journey is still measured, and the annex says so.

**Honesty.** A step whose locator matches nothing, whose navigation fails or lands elsewhere, or
that times out stops its journey, with the reason. Later steps are `not run`. Annex H lists every
journey and every step: done, failed (with the reason) or not run. A journey file that was never
replayed is listed too.

## Example — sign in, keyboard only

```json
{
  "name": "connexion",
  "startUrl": "/connexion",
  "keyboardOnly": true,
  "steps": [
    { "action": "fill", "target": { "label": "Adresse électronique" }, "value": "test@example.org" },
    { "action": "fill", "target": { "label": "Mot de passe" }, "value": "pas-le-bon" },
    { "action": "click", "target": { "role": "button", "name": "Se connecter" }, "note": "invalid submit" },
    { "action": "expect", "target": { "text": "Identifiants incorrects" } },
    { "action": "fill", "target": { "label": "Mot de passe" }, "value": "motdepasse-de-test" },
    { "action": "click", "target": { "role": "button", "name": "Se connecter" } },
    { "action": "expect", "target": { "role": "heading", "name": "Tableau de bord" } }
  ]
}
```

## Example — a modal and a menu

```json
{
  "name": "aide",
  "startUrl": "/",
  "steps": [
    { "action": "click", "target": { "role": "button", "name": "Menu" } },
    { "action": "expect", "target": { "role": "link", "name": "Contact" } },
    { "action": "press", "key": "Escape" },
    { "action": "click", "target": { "role": "button", "name": "Aide" } },
    { "action": "expect", "target": { "role": "dialog", "name": "Aide" } },
    { "action": "press", "key": "Escape", "note": "focus must return to « Aide »" }
  ]
}
```

Use test accounts and synthetic values only. Never put a real credential in a journey file:
commit the file, not a session. Pass the session with `--storage-state`.
