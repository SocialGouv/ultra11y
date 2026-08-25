// `audit` — run the static engine over the inputs and aggregate findings into an
// AuditResult: a preliminary, engine-only verdict per criterion (C/NC/NA for the
// static criteria it can decide; "manual" for everything needing rendering or
// judgment, surfaced as residual risks). `report` renders this; Claude completes
// the manual criteria.
import { createHash } from "node:crypto";
import type {
  AuditResult,
  CriterionResult,
  DynamicEngine,
  Finding,
  PageCoverage,
  RenderSignals,
  ResidualRisk,
  Severity,
  Status,
  GuidelineTally,
} from "./types.js";
import { VERSION, SCHEMA_VERSION } from "./types.js";
import { allSC, allGuidelines } from "./wcag.js";
import { parseSource } from "./parse/source.js";
import { attachSignals, isSnapshotDom, snapshotPageId } from "./snapshot.js";
import { attr, elementsByTag, type Doc, type CaptureProvenance } from "./parse/html.js";
import { CAPTURES_DIR, computeCaptureCoverage, enrichCaptureOrigins, isUnderDir, readCaptureDir, capturesForSources } from "./capture.js";
import { isFullDocument } from "./rules/rule.js";
import { renderedRulesFor, renderedRulesRan, renderedTestedScs } from "./rules/rendered.js";
import { renderedProvesOn } from "./coverage.js";
import { AXE_DECIDES, PROBE_SEVERITY, PROBE_WCAG, isAxeAdvisory, scForAxe, severityFromImpact } from "./axe-map.js";
import { subjectsAbsent, subjectsForSc, subjectsPresentIn } from "./adjudicate-subjects.js";
import { runRules } from "./rules/registry.js";
import { runCrossRules } from "./rules/cross-registry.js";
import { listPacks } from "./standards/registry.js";
import { docRuleRan, runPackRules } from "./standards/pack-rules.js";
import { buildGraphAndDocs } from "./graph/build.js";
import type { DepGraph } from "./graph/graph.js";
import { discover } from "./discover.js";
import { GRAPH_ONLY_EXT } from "./glob.js";
import { readText, today } from "./util.js";
import { INAPPLICABLE_STATUS } from "./types.js";

export type DedupMode = "exact" | "normalized" | "off";

export interface AuditInput {
  inputs: string[];
  stdin?: string;
  forceJsx?: boolean;
  include?: string[];
  exclude?: string[];
  ext?: string[];
  // scale controls
  changed?: boolean; // audit only git-changed files
  since?: string; // git ref to diff against (implies changed)
  staged?: boolean; // audit exactly the staged index snapshot (strict pre-commit scope)
  dedup?: DedupMode; // collapse identical files to one canonical audit (default exact)
  maxFiles?: number; // hard cap on canonical files audited (logged truncation)
  graph?: boolean; // also run cross-file rules over a dependency graph (--graph)
  captureCoverage?: boolean; // compute scope.captureCoverage (implies a graph pass)
  captureDir?: string; // dir scanned for the repo-wide capture set (coverage); default .ultra11y/captures
  // In --changed/--since/--staged mode, also ingest the captures under `captureDir`
  // whose provenance sourceFile matches one of the diffed files (capturesForSources) —
  // a capture is rarely itself part of the diff, so the audit would otherwise stay
  // blind to the real rendered DOM for a touched component. No-op outside diff mode
  // (a full scan's capture ingestion is the CLI appending captureDir as a top-level
  // input instead — see cmdAudit's `useCaptures`).
  captureDiff?: boolean;
  noDefaultExcludes?: boolean; // also audit test/spec/story/__tests__ markup
  onWarn?: (msg: string) => void;
}

const has = (d: Doc, ...tags: string[]): boolean => d.elements.some((e) => tags.includes(e.tag));

// Applicability predicate per STATIC success criterion (the only SCs the engine
// reports Conforming when clean): is there any relevant element to check? If not,
// the SC is NA rather than a hollow "C". WCAG SCs are coarser than the rules, so the
// static set is deliberately tiny (see scripts/build-standards.mjs); every other
// mapped SC raises only DEFINITE non-conformities and stays "manual" otherwise.
const APPLICABLE: Record<string, (d: Doc) => boolean> = {
  "1.4.2": (d) => has(d, "audio", "video"), // Audio Control — autoplay-media (audio branch)
  "2.4.2": (d) => isFullDocument(d), // Page Titled — title-missing-empty
  "3.1.1": (d) => isFullDocument(d), // Language of Page — html-lang-missing / lang-invalid
};

// ---- SUBJECT MATTER: what makes a NON-static criterion applicable at all -----------------
//
// A judgment or rendering criterion used to have exactly two outcomes: `NC` when a rule fired,
// `manual` otherwise. So a repository containing no audio and no video still reported all five
// time-based-media criteria as « to assess » — and under RGAA, whose theme 4 projects from
// them, that is 13 criteria a reader has to work through to discover there was never anything
// to look at. Measured on a real 300-file audit: 96 of 106 criteria « to assess », whole themes
// among them applicable to nothing in scope.
//
// « Not applicable » is a real, normative verdict, and the engine can prove it for a criterion
// whose SUBJECT MATTER is a thing you can look for in the source. So: no media element in the
// whole scope ⇒ the media criteria are NA, with a justification naming the observation.
//
// Three rules keep this honest, because a wrong NA is far worse than an honest « to assess » —
// it is a non-conformity hidden inside a report someone signs:
//
//   1. UNCERTAINTY RESOLVES TOWARDS "APPLICABLE". A predicate answers "could this criterion
//      possibly apply here?", so it says YES whenever it genuinely cannot tell — an `<object>`
//      with no declared `type`, for instance. That is not the same as saying yes to everything:
//      a predicate that treats every embed as a video is not cautious, it is wrong, and it
//      costs a human the work of re-deriving "nothing here". Measured: one analytics `<iframe>`
//      once held all twelve RGAA multimedia criteria open on a codebase with no media at all.
//   2. APPLICABILITY IS OR-FOLDED ACROSS THE WHOLE SCOPE (see `foldDoc`). One document with a
//      `<video>` keeps the media criteria open for the entire audit. NA means "nothing,
//      anywhere in what was audited" — never "nothing in this file".
//   3. THE VERDICT IS SCOPE-BOUND AND SAYS SO. The justification states what was searched and
//      not found, so it is falsifiable by a reader. A scope that cannot see rendered output
//      (an opaque component library) is already flagged on the audit itself, and `check`'s
//      unjustified-NA gate still applies.
const SUBJECT_MATTER: Record<string, (d: Doc) => boolean> = {
  // ---- Time-based media (WCAG 1.2.x → RGAA theme 4) ----
  // Captions, transcripts, audio description and sign language all presuppose a media element.
  // `track` counts on its own: a stray <track> means media is being assembled somewhere.
  "1.2.1": hasMedia,
  "1.2.2": hasMedia,
  "1.2.3": hasMedia,
  "1.2.4": hasMedia,
  "1.2.5": hasMedia,
  // ---- Motion actuation (WCAG 2.5.4) ----
  // Applicable only where device motion drives the interface, which is a source-visible API.
  "2.5.4": hasMotionApi,
  // ---- Forms (WCAG 3.3.x) ----
  // Error identification, labels and instructions, error suggestion, error prevention,
  // redundant entry and accessible authentication all presuppose user input. 3.3.4 and 3.3.8
  // are narrower still (legal/financial transactions, authentication), so "any form control"
  // is the deliberately over-inclusive predicate for them.
  "3.3.1": hasFormControl,
  "3.3.2": hasFormControl,
  "3.3.3": hasFormControl,
  "3.3.4": hasFormControl,
  "3.3.7": hasFormControl,
  "3.3.8": hasFormControl,
  // Identify Input Purpose — about autocomplete on fields collecting user data.
  "1.3.5": hasFormControl,
  // ---- Interaction constructs (WCAG 2.1.4 / 2.2.x / 2.3.1 / 2.5.x) ----
  // Every predicate below searches for a CODE CONSTRUCT, which is what makes proving its
  // absence legitimate: a shortcut, a gesture, a drag, a timer or an animation has to be
  // written to exist. That is not true of subject matter you can only see — "is any passage
  // in another language?" cannot be answered by the absence of a `lang` attribute, so 3.1.2
  // is deliberately NOT here and stays open for the agent to read the text.
  "2.1.4": hasCharShortcut,
  "2.2.1": hasTimeLimit,
  "2.2.2": hasMovingContent,
  "2.3.1": hasFlashCandidate,
  "2.5.1": hasGesture,
  "2.5.2": hasDownEventAction,
  "2.5.7": hasDrag,
};

/** A URL or MIME type that looks like time-based media, or a player embedding one. */
// Accented forms included on purpose: the standards this serves are read in French, so a
// `title="Vidéo de présentation"` must count. `\bvideo\b` did not match it — the boundary falls
// inside the word — and an accent is the last thing that should decide whether a criterion is
// assessed.
const MEDIA_HINT =
  /(youtube|youtu\.be|vimeo|dailymotion|soundcloud|spotify|twitch|wistia|brightcove|jwplayer|videopress|podcast|player|vid[eé]o|audio|baladodiffusion)/i;
const MEDIA_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|avi|mpe?g|mp3|wav|flac|m4a|aac|opus|m3u8|mpd)(?:[?#]|$)/i;

/**
 * Is there time-based media — the subject of WCAG 1.2.x — anywhere in this document?
 *
 * Split in two, because "over-inclusion is the safe direction" is a rule about UNCERTAINTY, not
 * a licence to treat every embed as a video. Measured on a real audit: one `<iframe>` holding an
 * analytics opt-out widget kept all 12 RGAA multimedia criteria « to assess » across a codebase
 * with no audio and no video anywhere. That is not caution, it is a false positive with a cost —
 * twelve criteria a human now has to read through to reach the same "nothing here" the engine
 * could have proved.
 *
 * So:
 *   - `<video>`, `<audio>`, `<track>`, `<source>` are media, full stop.
 *   - `<object>`/`<embed>` are media unless their `type` says otherwise — an unknown type stays
 *     applicable, since that is genuine uncertainty.
 *   - an `<iframe>` counts only when its `src`/`title` actually points at media (a player host,
 *     a media extension, the words video/audio/podcast). A widget iframe does not.
 *   - `<canvas>` and `<marquee>` are NOT here. Neither can carry a caption or an audio
 *     description, which is what 1.2.x is about; moving content is 2.2.2 and flashing is 2.3.1,
 *     and those have their own criteria.
 */
function hasMedia(d: Doc): boolean {
  if (has(d, "audio", "video", "track", "source")) return true;
  return d.elements.some((el) => {
    if (el.tag === "object" || el.tag === "embed") {
      const type = (el.attribs.type ?? "").toLowerCase();
      // A declared non-media type rules it out; anything else is uncertain, so it counts.
      return !type || type.startsWith("audio/") || type.startsWith("video/") || type.startsWith("application/");
    }
    if (el.tag !== "iframe") return false;
    const hay = `${el.attribs.src ?? ""} ${el.attribs.title ?? ""} ${el.attribs.allow ?? ""}`;
    return MEDIA_HINT.test(hay) || MEDIA_EXT.test(el.attribs.src ?? "");
  });
}

/** Device-motion input: the only thing WCAG 2.5.4 is about. */
function hasMotionApi(d: Doc): boolean {
  return /\b(?:devicemotion|deviceorientation|DeviceMotionEvent|DeviceOrientationEvent|Accelerometer|Gyroscope|requestPermission)\b/i.test(d.source);
}

/** A single-printable-character keyboard shortcut: the only thing WCAG 2.1.4 is about.
 *
 *  Safe to prove ABSENT, unlike most subject matter, because the subject IS a code construct.
 *  A shortcut has to be implemented to exist, so searching the source for one is exhaustive in
 *  a way that searching a rendered page for "a passage in another language" never is. */
function hasCharShortcut(d: Doc): boolean {
  return /\b(?:key|code|charCode|which)\s*===?\s*["'][a-zA-Z0-9]["']|\baccessKey\b|\baccesskey=/i.test(d.source);
}

/** A path-based or multipoint gesture (WCAG 2.5.1), or a drag interaction (2.5.7). */
function hasGesture(d: Doc): boolean {
  return /\bon(?:TouchMove|TouchStart|GestureStart|PointerMove)\s*=|\b(?:pinch|swipe|hammerjs|panstart|touchmove)\b/i.test(d.source);
}
function hasDrag(d: Doc): boolean {
  if (d.elements.some((e) => e.attribs.draggable !== undefined)) return true;
  return /\b(?:onDragStart|onDragOver|onDrop|useDrag|useDraggable|DndContext|react-beautiful-dnd|@dnd-kit|sortablejs)\b/.test(d.source);
}

/** An action fired on the DOWN event — the subject of WCAG 2.5.2. */
function hasDownEventAction(d: Doc): boolean {
  return /\bon(?:MouseDown|PointerDown|TouchStart)\s*=|addEventListener\(\s*["'](?:mousedown|pointerdown|touchstart)["']/i.test(d.source);
}

/** A time limit imposed on the user (WCAG 2.2.1): a timer, a meta refresh, a session expiry. */
function hasTimeLimit(d: Doc): boolean {
  if (d.elements.some((e) => e.tag === "meta" && (e.attribs["http-equiv"] ?? "").toLowerCase() === "refresh")) return true;
  return /\b(?:setTimeout|setInterval)\s*\(|\b(?:sessionTimeout|idleTimeout|expiresIn|maxAge|session_max)\b/i.test(d.source);
}

/** Moving, blinking, scrolling or auto-updating content (WCAG 2.2.2), and the flashing subset
 *  (2.3.1). Both are code constructs — an animation has to be declared to run. */
function hasMovingContent(d: Doc): boolean {
  if (has(d, "marquee", "blink", "video", "audio")) return true;
  if (d.elements.some((e) => /animation|transition/i.test(e.attribs.style ?? ""))) return true;
  if ((d.signals?.css?.rules ?? []).some((r) => r.decls.animation !== undefined || r.decls.animationName !== undefined)) return true;
  return /\b(?:carousel|autoplay|requestAnimationFrame|animation-iteration-count|\.gif["']|\bswiper\b)/i.test(d.source);
}

/** Anything that can produce opposing luminance changes over time (WCAG 2.3.1).
 *
 * Sound-only media and scrolling text are motion, not flashes. Conversely, an image, canvas,
 * visual media, script or CSS animation can flash even when no carousel/autoplay keyword is
 * present. Keep this deliberately wider than a detector: it decides applicability only; the
 * agent or a dedicated analyser still decides the frequency and area thresholds. */
function hasFlashCandidate(d: Doc): boolean {
  if (has(d, "video", "img", "svg", "canvas", "embed", "object", "blink", "script")) return true;
  if (d.elements.some((e) => /animation|transition/i.test(e.attribs.style ?? ""))) return true;
  if ((d.signals?.css?.rules ?? []).some((r) => r.decls.animation !== undefined || r.decls.animationName !== undefined)) return true;
  return /\b(?:flash|flashing|strobe|blink|setInterval|requestAnimationFrame|classList\.(?:add|remove|replace|toggle))\b|animation(?:-name)?\s*:/i.test(
    d.source,
  );
}

/** Any control that takes user input, native or delegated. Over-inclusive on purpose. */
function hasFormControl(d: Doc): boolean {
  if (has(d, "input", "select", "textarea", "form", "fieldset", "output", "datalist")) return true;
  // A custom widget standing in for a field, and a submit control that implies one.
  return d.elements.some((e) => {
    const role = (e.attribs.role ?? "").toLowerCase();
    if (role && /^(textbox|combobox|listbox|checkbox|radio|radiogroup|slider|spinbutton|searchbox|switch|form)$/.test(role)) return true;
    return e.attribs.contenteditable !== undefined;
  });
}

// ---- WHY a criterion is still to assess, and WHERE its evidence would come from -----------
//
// One generic sentence per tier used to answer for all 52 undecided criteria: "needs a rendered
// DOM (contrast, focus visibility, zoom/reflow, target size)" was printed against 1.4.5 (images
// of text) as readily as against 1.4.3 (contrast), naming four measurements of which at most
// one was the criterion's. A reader could not tell what was missing, and neither could the next
// run — so « to assess » read as a shrug rather than as an instruction.
//
// Each entry names the measurement that decides the criterion and the command that produces it.
// Absent ⇒ the tier default below, which is still true, just unspecific.
const RESIDUAL_TRAIL: Record<string, string> = {
  // Rendering criteria the SNAPSHOT tier decides offline, from computed styles + stylesheets.
  "1.3.4":
    "Decided on a page's own stylesheets (an orientation media query that rotates the document) — record a snapshot with `scan --sample` (or an E2E capture), then re-audit.",
  "1.4.1": "Decided on computed colours (a link distinguished by colour alone) — record a snapshot with `scan --sample`, then re-audit.",
  "1.4.3":
    "Decided on computed text/background colours, with a screenshot fallback where the backdrop is an image — record a snapshot with `scan --sample`, then re-audit.",
  "1.4.11": "Decided on computed colours of UI components and graphics — record a snapshot with `scan --sample`, then re-audit.",
  "2.4.7":
    "Decided on the page's own stylesheets (a `:focus` rule that removes the indicator without restoring one), or by the live focus probe — record a snapshot with `scan --sample`, then re-audit.",
  // Rendering criteria that need a LIVE browser: they are measured by acting on the page.
  "1.4.4": "Needs a live browser: the page is re-measured at 200% zoom — `scan <url> --runtime local --merge <audit.json>`.",
  "1.4.10": "Needs a live browser: the page is re-measured in a 320px viewport (reflow) — `scan <url> --merge <audit.json>`.",
  "1.4.12": "Needs a live browser: text spacing overrides are injected and the layout re-measured — `scan <url> --runtime local --merge <audit.json>`.",
  "1.4.13":
    "Needs a live browser: hover/focus-triggered content is opened and probed for dismiss/hover/persist — `scan <url> --runtime local --merge <audit.json>`.",
  // axe's own `target-size` rule can FAIL this on a live page, but no tier certifies it, so a
  // clean scan leaves it open rather than conforming. Say both halves.
  "2.5.8":
    "A live scan can fail this (axe `target-size`) but never certify it — `scan <url> --runtime local --merge <audit.json>`, then adjudicate what is left.",
  "4.1.3":
    "Needs a live browser WITH interaction: a status message is triggered and the live region observed — `scan <url> --runtime local --merge <audit.json>` (interactions are on by default).",
  // Rendering criteria no automated tier measures — say so, rather than pointing at `scan` and
  // letting the reader discover it changes nothing.
  "1.4.5":
    "No automated tier decides this: whether text is presented as an image is a reading of each image's content. Adjudicate it (`verify --manual`) against the images the audit lists.",
  "2.1.2":
    "Needs a live browser: the tab ring is walked and every focusable is checked for one Tab cannot move off — `scan <url> --runtime local --merge <audit.json>`. A region only a pointer can open (a custom widget behind a click) still has to be attempted by hand.",
  "2.3.1": "No automated tier decides this: flashing has to be observed over time on the rendered page.",
  // 2.4.11 no longer has an entry here. It used to say "no automated tier decides this", which
  // was true and was the problem: the criterion harvested zero evidence, so no agent could rule
  // it C either — a cell nobody could ever fill. The focus-obscured probe measures it now, on
  // the same walk of the tab ring as 2.4.7, so its residual reason is the ordinary
  // needs-rendering one: run the scan.
};

function residualReason(automatability: string, sc?: string): string {
  const trail = sc ? RESIDUAL_TRAIL[sc] : undefined;
  if (trail) return trail;
  return automatability === "needs-rendering"
    ? "Needs a rendered DOM (contrast, focus visibility, zoom/reflow, target size) — decide via `scan`."
    : "Judgement criterion — adjudicated by the agent from source/context (`verify --manual`, gated).";
}

/** Why a non-static criterion is NA — the observation, so a reader can falsify it. Scope-bound
 *  by construction (`n` files audited), which is exactly the claim being made. */
/** What the harvest looked for and did not find — stated so a reader can falsify it, which is
 *  the whole contract of an NA. Names the criterion, the constructs searched for, and how wide
 *  the search was. */
const SUBJECT_NOUNS: Record<string, string> = {
  images: "no image element (<img>, <svg>, <picture>, <object>, <input type=image> or role=img)",
  tables: "no <table>, and no element with a table role",
  lists: "no list (<ul>, <ol>, <dl> or a list role)",
  links: "no link",
  controls: "no form control (native, ARIA or contenteditable)",
  autocomplete: "no field carrying user information that autocomplete applies to",
  errors: "no error message and no field marked invalid",
  nameVsAccName: "no control whose visible text and accessible name could differ",
  focusables: "no focusable element",
  focusOrder: "no element taking part in the focus order",
  pointerHandlers: "no pointer, touch, gesture or drag handler",
  shortcuts: "no keyboard shortcut and no accesskey",
  sensoryText: "no instruction relying on shape, position, size or sound",
  timers: "no time limit, timer or auto-refresh",
  motion: "no moving, blinking, auto-updating or media content",
  contextChange: "no control that changes context on its own",
  downloadDocs: "no downloadable document",
  stickies: "no fixed or sticky positioned element",
};

export function subjectAbsenceReason(criterionId: string, subjects: string[], files: number): string {
  const nouns = subjects.map((id) => SUBJECT_NOUNS[id] ?? `no element for "${id}"`);
  return `Nothing in scope is concerned by ${criterionId}: across the ${files} file(s) audited there is ${nouns.join(", and ")}. « Not applicable » is a verdict about the SUBJECT of the criterion — it never says the criterion is met, and one element of this kind anywhere in scope reopens it.`;
}

function subjectMatterReason(sc: string, files: number): string {
  const scope = `nothing in the ${files} file(s) audited is concerned`;
  if (sc.startsWith("1.2."))
    return `No time-based media in scope: ${scope} — no <audio>, <video>, <track> or <source> element, no <object>/<embed>, and no <iframe> pointing at media.`;
  if (sc === "2.5.4") return `No motion actuation in scope: ${scope} — no device-motion or device-orientation API is used.`;
  if (sc === "1.3.5" || sc.startsWith("3.3.")) return `No user input in scope: ${scope} — no form control (native, ARIA or contenteditable) was found.`;
  // Each of these names the construct that was searched for, and how wide the search was, so
  // the claim is falsifiable by whoever reads it — which is the whole contract of an NA.
  if (sc === "2.1.4")
    return `No single-character keyboard shortcut in scope: ${scope} — no single-printable-character key comparison and no accesskey attribute was found.`;
  if (sc === "2.2.1") return `No time limit in scope: ${scope} — no timer, no <meta http-equiv="refresh">, and no session-expiry configuration was found.`;
  if (sc === "2.2.2" || sc === "2.3.1")
    return `No moving, blinking or auto-updating content in scope: ${scope} — no <marquee>/<blink>, no media element, no CSS animation (inline or in a captured stylesheet), and no carousel/autoplay/rAF signal was found.`;
  if (sc === "2.5.1") return `No path-based or multipoint gesture in scope: ${scope} — no touch-move, pinch, swipe or gesture handler was found.`;
  if (sc === "2.5.2") return `No down-event action in scope: ${scope} — no mousedown/pointerdown/touchstart handler was found.`;
  if (sc === "2.5.7") return `No dragging interaction in scope: ${scope} — no draggable attribute and no drag-and-drop library or handler was found.`;
  return `No element in scope is concerned by this success criterion (${scope}).`;
}

// Streaming accumulator: parse → run rules → fold → DISCARD each Doc, so the
// engine never holds a whole repo in memory. The only cross-document state is
// (a) the flat findings list (bounded by finding count, not source size) and
// (b) per-criterion applicability, OR-folded across docs (NA only if NO doc made
// the criterion applicable — never because findings happened to be absent).
interface Accum {
  byCriterion: Map<string, Finding[]>;
  applicable: Map<string, boolean>; // static criteria only
  allFindings: Finding[];
  packFindings: Finding[]; // declarative pack-rule findings (namespaced pack:<key>:<id>)
  fileCount: number;
  opaqueLibs: Set<string>; // component-library specifiers rendered but not source-analysable
  opaqueFiles: number; // count of source files that render such components
  sfcFiles: number; // .vue/.svelte/.astro source templates audited (verdicts preliminary)
  sfcExts: Set<string>; // which SFC extensions were seen
  captures: { file: string; provenance: CaptureProvenance }[]; // rendered capture files audited
  langCounts: Map<string, number>; // <html lang> primary subtags seen, for repo-language detection
  // Success criteria the RENDERED tier measured, from the snapshots ingested in this run
  // (src/rules/rendered.ts renderedTestedScs). Stamped onto scope.scan.testedScs so the
  // partial-audit banner names what is genuinely missing instead of every rendering criterion.
  renderedScs: Set<string>;
  // PER-PAGE rendered coverage — the accounting `renderedScs` is not.
  //
  // `renderedScs` answers "was this measured anywhere?", which is the right claim for the
  // partial-audit banner and the WRONG one for concluding conformity: a criterion measured on
  // one page out of thirty-eight is not a criterion measured. Concluding `C` needs "measured
  // on EVERY page in scope, by every rule that carries it", so coverage is tracked per rule
  // and per page and folded with an AND at the end.
  pageIds: Set<string>;
  renderedRan: Map<string, Set<string>>; // rendered rule id → page ids where its signals were present
  // LIVE-PROBE coverage: success criterion → page ids where a probe actually measured it.
  // Separate from `renderedRan` because these come from a browser acting on the page (zoom,
  // 320px viewport, injected spacing, Tab, hover), not from a digest — and because a probe
  // that did not run must never be read as a probe that found nothing.
  probedScs: Map<string, Set<string>>;
  // Subject ids that harvested at least one anchor ANYWHERE in scope — the OR fold behind
  // « nothing of this kind exists here ». See EXISTENCE_SUBJECTS for what may be concluded
  // from a subject's silence, and what may not.
  subjectsSeen: Set<string>;
  // The same fold, PER PAGE. `subjectsSeen` answers "does anything of this kind exist in the
  // whole run?", which is the right question for the run's grid and the wrong one for a page:
  // a criterion whose subject lives on one route was open on all the others for ever, because
  // scope-wide presence can never conclude absence HERE. See pageView (src/pages.ts), which
  // narrows onto this, and EXISTENCE_SUBJECTS for the only subjects allowed to conclude at all.
  pageSubjects: Map<string, Set<string>>;
  // AXE coverage: page ids on which an axe pass actually RAN. Separate from `probedScs`
  // because axe covers a whole family of criteria at once rather than one per probe, and
  // because — the same rule as everywhere in this tier — a rule engine that did not run has
  // measured nothing, and its silence must never read as a clean page.
  axeRan: Set<string>;
}

// Precompute the static success criteria + their applicability predicates once.
const STATIC_PREDS: ReadonlyArray<readonly [string, (d: Doc) => boolean]> = allSC()
  .filter((c) => c.automatability === "static")
  .map((c) => [c.sc, APPLICABLE[c.sc] ?? isFullDocument] as const);

// The same fold, for the non-static criteria whose subject matter is source-visible. Kept as a
// separate list so the `static` contract above ("clean ⇒ C") is untouched: a criterion here can
// only ever gain `NA`, never `C`.
const SUBJECT_PREDS: ReadonlyArray<readonly [string, (d: Doc) => boolean]> = allSC()
  .filter((c) => c.automatability !== "static" && SUBJECT_MATTER[c.sc] !== undefined)
  .map((c) => [c.sc, SUBJECT_MATTER[c.sc]!] as const);

function newAccum(): Accum {
  return {
    byCriterion: new Map(),
    applicable: new Map(),
    allFindings: [],
    packFindings: [],
    fileCount: 0,
    opaqueLibs: new Set(),
    opaqueFiles: 0,
    sfcFiles: 0,
    sfcExts: new Set(),
    captures: [],
    langCounts: new Map(),
    renderedScs: new Set(),
    pageIds: new Set(),
    renderedRan: new Map(),
    probedScs: new Map(),
    axeRan: new Set(),
    subjectsSeen: new Set(),
    pageSubjects: new Map(),
  };
}

// Primary subtag of an `<html lang>`/`xml:lang` value: "fr-FR" → "fr", "en" → "en".
// Mirrors the BCP47 primary-subtag reading the html-lang-missing/lang-invalid rules use.
function primarySubtag(lang: string): string | undefined {
  const m = lang.trim().match(/^[a-z]{1,8}/i);
  return m ? m[0].toLowerCase() : undefined;
}

/** Fold one parsed document into the accumulator, then let it be GC'd. When a
 *  graph is supplied, cross-file findings are added and graph-proven false
 *  positives are suppressed (matched by ruleId + line on this same doc). */
export function foldDoc(acc: Accum, doc: Doc, graph?: DepGraph): void {
  // PAGE IDENTITY, SYNTHESIZED FROM THE PATH when the DOM does not carry it. Must happen BEFORE
  // any rule runs: every finding constructor reads `doc.capture` at construction time.
  //
  // `writeSnapshot` stamps the page id into `dom.html`'s capture comment, and that is how a
  // finding normally learns which page it is (src/rules/rule.ts). But the on-disk snapshot layout
  // is a PUBLISHED CONTRACT (skills/ultra11y/references/pages.md): a producer may legitimately
  // write `meta.json` plus a raw `dom.html` and never emit the comment. Without this, every
  // finding on such a page is unattributed, the page earns `C` by silence, and its sheet reports
  // 100% while the audit holds hundreds of findings.
  //
  // It lives in `foldDoc`, not beside `attachSignals`, because `buildAudit` folds already-parsed
  // docs and its contract is that it produces the same result as `runAudit` — a synthesis only the
  // streaming path performed would break that, and would make `scope.pagesAudited` (derived from
  // `acc.captures`) disagree between the two entry points.
  if (!doc.capture?.page) {
    const id = snapshotPageId(doc.file);
    if (id) doc.capture = { v: 1, ...(doc.capture ?? {}), page: id };
  }
  let findings = runRules(doc);
  if (graph) {
    const cross = runCrossRules(doc, graph);
    if (cross.suppress.length) {
      findings = findings.filter((f) => !cross.suppress.some((s) => s.ruleId === f.ruleId && s.line === f.line));
    }
    findings = findings.concat(cross.findings);
    // A cross finding is evidence its criterion is applicable here (the per-doc
    // static predicates only know native elements, not resolved components).
    for (const f of cross.findings) acc.applicable.set(f.criteriaId, true);
  }
  for (const f of findings) {
    acc.allFindings.push(f);
    const arr = acc.byCriterion.get(f.criteriaId) ?? [];
    arr.push(f);
    acc.byCriterion.set(f.criteriaId, arr);
  }
  // Declarative pack rules run AFTER the core rules over the same Doc. Their findings are
  // collected SEPARATELY (never into byCriterion/allFindings) so the core WCAG verdict is
  // untouched — they surface only when a pack projection is derived. A pack without rules
  // is an instant no-op.
  for (const pack of listPacks()) {
    if (pack.rules?.length) acc.packFindings.push(...runPackRules(doc, pack));
  }
  for (const [id, pred] of STATIC_PREDS) {
    if (!acc.applicable.get(id) && pred(doc)) acc.applicable.set(id, true);
  }
  // OR-folded across the whole scope: one document carrying the subject matter keeps the
  // criterion open for the entire audit (see SUBJECT_MATTER, rule 2).
  for (const [id, pred] of SUBJECT_PREDS) {
    if (!acc.applicable.get(id) && pred(doc)) acc.applicable.set(id, true);
  }
  // The same OR fold, one level down: which SUBJECTS this document carries an anchor for. The
  // adjudication harvest already declares, per criterion, exactly which elements decide it —
  // so a criterion whose every subject came back empty across the whole scope had nothing to
  // look at, which is « non applicable » and not « à évaluer ». Only subjects whose emptiness
  // PROVES absence take part (EXISTENCE_SUBJECTS); a subject already seen is never evaluated
  // again, so this costs almost nothing after the first few documents.
  for (const id of subjectsPresentIn(doc, acc.subjectsSeen)) acc.subjectsSeen.add(id);
  // A page snapshot just let the rendered tier MEASURE some criteria, offline and with no
  // browser. Record which, so the report stops claiming they were never tested.
  if (doc.signals) for (const sc of renderedTestedScs(doc.signals)) acc.renderedScs.add(sc);
  // Only a SNAPSHOT is a page. A source file carrying no signals must never count towards
  // "every page was measured" — that is the difference between a fold that can conclude and
  // one that merely looks like it can.
  const pageId = snapshotPageId(doc.file);
  if (pageId) {
    acc.pageIds.add(pageId);
    // The subject fold, scoped to THIS page. Its own `skip` set, never the run-wide one:
    // sharing that would record a subject on the first page that carried it and on no other.
    const own = acc.pageSubjects.get(pageId) ?? new Set<string>();
    for (const id of subjectsPresentIn(doc, own)) own.add(id);
    acc.pageSubjects.set(pageId, own);
    for (const ruleId of renderedRulesRan(doc.signals)) {
      const seen = acc.renderedRan.get(ruleId) ?? new Set<string>();
      seen.add(pageId);
      acc.renderedRan.set(ruleId, seen);
    }
    // A pack's DOCUMENT-level rules are signal-gated exactly like the rendered ones, so they
    // are credited the same way: on the pages whose capture carried the signal they read, and
    // on no others. Without this a criterion the pack decides from a doctype would be treated
    // as measured wherever a DOM was parsed — and cleared on the pages nobody captured.
    for (const pack of listPacks()) {
      for (const rule of pack.rules ?? []) {
        if (!docRuleRan(doc, rule)) continue;
        const id = `pack:${pack.key}:${rule.id}`;
        const seen = acc.renderedRan.get(id) ?? new Set<string>();
        seen.add(pageId);
        acc.renderedRan.set(id, seen);
      }
    }
    // What a browser MEASURED on this page, by acting on it. `probed` is what makes the
    // silence meaningful: a criterion with no hit is conforming only where the probe ran.
    const probes = doc.signals?.probes;
    if (probes) {
      for (const sc of probes.probed ?? []) {
        const seen = acc.probedScs.get(sc) ?? new Set<string>();
        seen.add(pageId);
        acc.probedScs.set(sc, seen);
        // A probe is COVERAGE, not merely a way to conclude. `renderedScs` is the stamp the
        // partial-audit banner reads (scope.scan.testedScs → untestedNeedsRendering), and it
        // was fed by the digest tier alone — so a sweep that measured zoom, reflow, spacing
        // and hover on every page still published « the needs-rendering criteria were not
        // tested ». Measured on egapro: five digest criteria stamped, and a report that told
        // its reader nothing had been tested. The two accountings stay separate on purpose:
        // this one answers "was it measured anywhere?", `probedScs` answers "on which pages?",
        // and only the second may conclude.
        acc.renderedScs.add(sc);
      }
      for (const f of probeFindings(probes, doc.file, pageId)) {
        const list = acc.byCriterion.get(f.criteriaId) ?? [];
        list.push(f);
        acc.byCriterion.set(f.criteriaId, list);
        acc.allFindings.push(f);
      }
    }
    // What AXE found on this page, when the producer ran it. Same treatment as the probes,
    // and deliberately the same mapping the Docker/local scan tiers use (src/axe-map.ts), so
    // a `color-contrast` hit is the same non-conformity whichever tier surfaced it.
    const axe = doc.signals?.axe;
    if (axe?.ran) {
      acc.axeRan.add(pageId);
      for (const sc of Object.keys(AXE_DECIDES)) acc.renderedScs.add(sc);
      for (const f of axeFindings(axe.violations ?? [], doc.file, pageId)) {
        const list = acc.byCriterion.get(f.criteriaId) ?? [];
        list.push(f);
        acc.byCriterion.set(f.criteriaId, list);
        acc.allFindings.push(f);
      }
    }
  }
  if (doc.opaqueComponents?.length) {
    for (const lib of doc.opaqueComponents) acc.opaqueLibs.add(lib);
    acc.opaqueFiles++;
  }
  if (doc.kind === "sfc") {
    acc.sfcFiles++;
    const e = doc.file.toLowerCase().match(/\.[a-z]+$/)?.[0];
    if (e) acc.sfcExts.add(e);
  }
  if (doc.capture) acc.captures.push({ file: doc.file, provenance: doc.capture });
  const html = elementsByTag(doc, "html")[0];
  const htmlLang = html ? (attr(html, "lang") ?? attr(html, "xml:lang") ?? "").trim() : "";
  const subtag = htmlLang ? primarySubtag(htmlLang) : undefined;
  if (subtag) acc.langCounts.set(subtag, (acc.langCounts.get(subtag) ?? 0) + 1);
  acc.fileCount++;
}

interface FinalizeExtra {
  truncated?: { limit: number; total: number; skipped: number };
  dedup?: { canonicalFiles: number; duplicateFiles: number };
}

/** Did the RENDERED tier measure this criterion on every page in scope, and find nothing?
 *
 *  This is the accounting src/rules/rendered.ts deferred when it landed: "letting a clean
 *  measurement conclude C … needs per-rule coverage accounting". Without it a measured
 *  criterion stayed « to assess » forever, so a page could be scanned thirty-eight times and
 *  still publish nothing — which is the same outcome as never scanning at all.
 *
 *  Four conditions, and every one of them is load-bearing:
 *
 *   1. at least one page is in scope. No page ⇒ no measurement ⇒ nothing to conclude;
 *   2. the criterion is carried by at least one rendered rule. A criterion NO rule measures
 *      (1.4.5, 2.3.1, 2.5.8 — 2.1.2 left this list when the keyboard-trap probe landed, 2.4.11
 *      when the focus-obscured probe joined the same walk of the tab ring) can never be
 *      concluded here — its silence is not a measurement, and treating it as one is exactly the
 *      failure this tier exists to avoid;
 *   3. EVERY such rule ran on EVERY page. One page whose collector truncated, whose style
 *      digest failed verification or whose stylesheet was cross-origin, and the criterion
 *      stays open for the whole scope. The fold is an AND, never an OR;
 *   4. no normative finding — guaranteed by the caller's branch order, stated here because
 *      the rule reads as incomplete without it.
 *
 *  What it deliberately does NOT do is conclude from a rule that DECLINED. A rule that read
 *  nothing measured nothing, and `SIGNALS_REQUIRED` is what tells the two apart. */
function renderedProves(sc: string, acc: Accum): boolean {
  return renderedProvesOn(sc, scopeCoverage(acc));
}

/** The coverage the WHOLE run may conclude from: the INTERSECTION across every page in scope.
 *
 *  One page whose collector truncated, whose style digest failed verification or whose
 *  stylesheet was cross-origin, and the rule drops out for the entire scope. The fold is an
 *  AND, never an OR — which is why this is an intersection and not a union.
 *
 *  Undefined with no page in scope. Returning an empty record there would report `axe: true`
 *  by the vacuous "axe ran on all zero pages", and every AXE_DECIDES criterion would come back
 *  conforming on a source-only audit. */
function scopeCoverage(acc: Accum): PageCoverage | undefined {
  if (acc.pageIds.size === 0) return undefined;
  const onEvery = <K>(m: Map<K, Set<string>>): K[] => [...m.entries()].filter(([, pages]) => pages.size === acc.pageIds.size).map(([k]) => k);
  return {
    dom: true,
    axe: acc.axeRan.size === acc.pageIds.size,
    rules: onEvery(acc.renderedRan),
    scs: onEvery(acc.probedScs),
  };
}

/** What each page in scope was measured by — the per-page half of `scopeCoverage`, persisted
 *  on the audit so a grid can be rebuilt from the JSON alone, offline and with no browser. */
function pageCoverageOf(acc: Accum): Record<string, PageCoverage> {
  const out: Record<string, PageCoverage> = {};
  const on = <K>(m: Map<K, Set<string>>, page: string): K[] =>
    [...m.entries()]
      .filter(([, pages]) => pages.has(page))
      .map(([k]) => k)
      .sort();
  for (const id of [...acc.pageIds].sort()) {
    const rules = on(acc.renderedRan, id);
    const scs = on(acc.probedScs, id);
    out[id] = {
      // Its DOM was parsed and folded, so the whole static rule set ran against it.
      dom: true,
      ...(acc.axeRan.has(id) ? { axe: true } : {}),
      ...(rules.length ? { rules } : {}),
      ...(scs.length ? { scs } : {}),
    };
  }
  return out;
}

/** Why a rendering criterion stayed open when a probe DID run — just not everywhere.
 *
 *  Without this the two cases read identically: a criterion nobody ever probed, and one probed
 *  on nineteen pages out of twenty. They call for opposite work — turn the probes on, versus
 *  find out why that one page was not swept — and the fold is an AND, so the second is the
 *  common one as soon as a repository drives its sweep from more than one spec. Returns
 *  undefined when there is nothing partial to report. */
function partialProbeReason(sc: string, acc: Accum): string | undefined {
  const probed = acc.probedScs.get(sc);
  if (!probed || probed.size === 0 || probed.size >= acc.pageIds.size) return undefined;
  const missing = [...acc.pageIds].filter((p) => !probed.has(p)).sort();
  const shown = missing.slice(0, 8);
  const rest = missing.length - shown.length;
  return `Probed on ${probed.size} of the ${acc.pageIds.size} pages in scope, so this criterion stays open: conformity here is measured on EVERY page or on none, and the page nobody probed is exactly where the failure would be. Not probed: ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}.`;
}

function renderedProvesReason(sc: string, acc: Accum): string {
  if (AXE_DECIDES[sc] && acc.axeRan.size === acc.pageIds.size) {
    return `Measured by axe-core on all ${acc.pageIds.size} page(s) in scope — ${AXE_DECIDES[sc]?.join(", ")} ran in the browser and reported nothing. A page axe had not run on would have kept this criterion open.`;
  }
  const probed = acc.probedScs.get(sc);
  if (probed && probed.size === acc.pageIds.size) {
    return `Measured in a real browser on all ${acc.pageIds.size} page(s) in scope — the probe acted on the page (zoom, 320px viewport, text-spacing override, Tab, hover) and observed nothing. A page the probe had not run on would have kept this criterion open.`;
  }
  const rules = renderedRulesFor(sc);
  return `Measured on the rendered pages: ${rules.join(", ")} ran on all ${acc.pageIds.size} page(s) in scope and raised nothing. Conformity here is a MEASUREMENT, not a judgement — a page whose signals were incomplete would have kept this criterion open.`;
}

/** Turn what a live probe OBSERVED into findings on the page it observed them.
 *
 *  Each hit is a definite failure the browser reproduced — text clipped at 200% zoom, a page
 *  that will not reflow at 320px, a focus that produces no visible change — so it is an NC on
 *  the criterion it evidences, not a residual risk. The mapping is the one `scan` already
 *  uses (src/axe-map.ts), so a probe hit means the same thing whichever runtime produced it.
 *
 *  Anchored at the snapshot's own file:line 1: the probe measured the RENDERED page, and
 *  pretending to know which source line produced it would be a citation nobody could check. */
function probeFindings(probes: NonNullable<RenderSignals["probes"]>, file: string, page: string): Finding[] {
  const out: Finding[] = [];
  const add = (criteriaId: string, ruleId: string, severity: Severity, selector: string, snippet: string, message: string): void => {
    out.push({
      ruleId,
      criteriaId,
      file,
      line: 1,
      col: 1,
      selectorHint: selector || "document",
      severity,
      message,
      remediation: "",
      snippet: snippet.slice(0, 200),
      page,
    });
  };
  const buckets: [keyof typeof probes, Exclude<DynamicEngine, "axe" | "reflow">][] = [
    ["focusVisible", "focus-visible"],
    ["hover", "hover"],
    ["reflowZoom", "reflow-zoom"],
    ["textSpacing", "text-spacing"],
  ];
  for (const [key, engine] of buckets) {
    const hits = probes[key] as { selector: string; html: string; detail: string }[] | undefined;
    if (!Array.isArray(hits)) continue;
    for (const h of hits) add(PROBE_WCAG[engine], `dyn-${engine}`, PROBE_SEVERITY[engine], h.selector, h.html, h.detail);
  }
  if (probes.reflow?.horizontalScroll) {
    add("1.4.10", "dyn-reflow", "majeur", "document", "", "Horizontal scrolling at 320px width — content does not reflow.");
  }
  return out;
}

/** Turn what AXE reported on a page into findings on that page.
 *
 *  The mapping is `scan`'s, unchanged (src/axe-map.ts `scForAxe` / `severityFromImpact` /
 *  `isAxeAdvisory`): the criterion an axe rule evidences, the severity its impact carries, and
 *  the best-practice rules that are a RECOMMENDATION rather than a non-conformity. One table,
 *  so a `color-contrast` hit means the same thing whether Docker, a local scan or somebody's
 *  own Playwright suite surfaced it.
 *
 *  Anchored at the snapshot's own file:line 1, like the probes and for the same reason: axe
 *  measured the rendered page, and naming a source line it never read would be a citation
 *  nobody could check. `Finding.page` carries the attribution that matters. */
function axeFindings(violations: NonNullable<NonNullable<RenderSignals["axe"]>["violations"]>, file: string, page: string): Finding[] {
  const out: Finding[] = [];
  for (const v of violations) {
    if (!v?.id) continue;
    const criteriaId = scForAxe(v.id, v.tags);
    const severity = severityFromImpact(v.impact);
    const advisory = isAxeAdvisory(v.id, v.tags);
    const nodes = v.nodes?.length ? v.nodes : [{ target: [] as string[], html: "" }];
    for (const n of nodes) {
      out.push({
        ruleId: `axe:${v.id}`,
        criteriaId,
        file,
        line: 1,
        col: 1,
        selectorHint: n.target?.join(" ") || "document",
        severity,
        message: `${v.help ?? v.id} (axe: ${v.id})`,
        remediation: "",
        snippet: (n.html ?? "").slice(0, 200),
        page,
        ...(advisory ? { advisory: true } : {}),
      });
    }
  }
  return out;
}

function finalize(acc: Accum, inputs: string[], extra: FinalizeExtra = {}): AuditResult {
  const criteria: CriterionResult[] = [];
  const residualRisks: ResidualRisk[] = [];

  for (const c of allSC()) {
    const fs = acc.byCriterion.get(c.sc) ?? [];
    // ONLY normative findings drive status + conformancePct. Advisory findings (non-normative
    // recommendations) stay attached to the criterion and in the flat list, but can never
    // flip it to NC — a criterion whose findings are ALL advisory keeps its automatability-
    // driven status (C/NA for static, manual for judgment/needs-rendering).
    const normativeFs = fs.filter((f) => !f.advisory);
    let status: Status;
    let justification: string | undefined;
    // Absent ⇒ the deterministic engine. `scan` marks a verdict the RENDERED tier measured,
    // kept distinct from an engine one so a reader can tell what was proved from source and
    // what was proved on a page — and distinct from `agent`, which is a judgement call.
    let decidedBy: CriterionResult["decidedBy"] | undefined;
    // Conforming for want of a subject, rather than because anything was checked.
    let inapplicable = false;

    if (c.automatability === "static") {
      const applicable = acc.applicable.get(c.sc) ?? false;
      if (!applicable) {
        status = INAPPLICABLE_STATUS;
        inapplicable = true;
        justification = "No element in scope is concerned by this success criterion — nothing contradicts it, and nothing of that kind exists here.";
      } else if (normativeFs.length > 0) {
        status = "NC";
      } else {
        status = "C";
      }
    } else if (normativeFs.length > 0) {
      // a rule on a needs-rendering / judgment SC raised a DEFINITE failure
      status = "NC";
    } else if (SUBJECT_MATTER[c.sc] !== undefined && !(acc.applicable.get(c.sc) ?? false)) {
      // The criterion's SUBJECT MATTER is absent from the entire scope, so there is nothing to
      // judge and nothing to render — and nothing to contradict it either. Reported as
      // conforming (INAPPLICABLE_STATUS), carrying the justification that names what was
      // looked for and how much was read, so the claim stays falsifiable.
      status = INAPPLICABLE_STATUS;
      inapplicable = true;
      justification = subjectMatterReason(c.sc, acc.fileCount);
    } else if (SUBJECT_MATTER[c.sc] === undefined && acc.fileCount > 0 && subjectsAbsent(subjectsForSc(c.sc), acc.subjectsSeen)) {
      // Every element this criterion is ABOUT is absent from the whole scope. Same verdict as
      // the branch above and the same three guardrails; what differs is where the question
      // came from — the adjudication harvest, which states per criterion what decides it,
      // rather than a predicate written per criterion here. `fileCount > 0` because a run that
      // read no file has proved nothing about anything.
      //
      // ONE CRITERION, ONE AUTHORITY. Where a hand-written predicate exists it wins outright,
      // even when it says "applicable" and the harvest says "absent" — it was written for that
      // criterion, it resolves uncertainty towards applicable on purpose, and it knows things a
      // generic subject does not: that a stray <track>, an <object> of unknown type or a
      // mention of `devicemotion` in a script all keep their family open. A harvest subject
      // aimed at collecting EVIDENCE is not the same instrument as a predicate aimed at
      // deciding APPLICABILITY, and letting the coarser one overrule the finer would trade a
      // careful "still applicable" for a careless close.
      status = INAPPLICABLE_STATUS;
      inapplicable = true;
      justification = subjectAbsenceReason(c.sc, subjectsForSc(c.sc), acc.fileCount);
    } else if (c.automatability === "needs-rendering" && renderedProves(c.sc, acc)) {
      // The rendered tier measured it, on every page, and found nothing. That is a verdict.
      status = "C";
      justification = renderedProvesReason(c.sc, acc);
      decidedBy = "scan";
    } else {
      // engine can't decide — leave it for the agent to adjudicate (`verify --manual`,
      // gated) or the `scan` tier (rendering criteria); never a silent conforming.
      status = "manual";
      justification = partialProbeReason(c.sc, acc);
      residualRisks.push({ criteriaId: c.sc, reason: residualReason(c.automatability, c.sc), automatability: c.automatability });
    }
    criteria.push({
      id: c.sc,
      guideline: c.guideline,
      status,
      findings: fs,
      ...(justification ? { justification } : {}),
      ...(decidedBy ? { decidedBy } : {}),
      ...(inapplicable ? { inapplicable: true } : {}),
    });
  }

  const guidelines: GuidelineTally[] = allGuidelines().map((g) => {
    const inG = criteria.filter((c) => c.guideline === g.number);
    return {
      key: g.number,
      title: g.title,
      c: inG.filter((c) => c.status === "C").length,
      nc: inG.filter((c) => c.status === "NC").length,
      // Always 0: no criterion carries `NA` any more (INAPPLICABLE_STATUS). The field stays
      // because the shape is published and consumers read it; counting the absence-closed
      // conformities here instead would break the one property a tally owes its reader —
      // that c + nc + na + manual is the number of criteria. Those are conformities, and
      // they are counted as such; `CriterionResult.inapplicable` is where the distinction is.
      na: inG.filter((c) => c.status === "NA").length,
      manual: inG.filter((c) => c.status === "manual").length,
    };
  });

  const decided = criteria.filter((c) => c.status === "C" || c.status === "NC");
  const conform = decided.filter((c) => c.status === "C").length;
  const conformancePct = decided.length === 0 ? 100 : Math.round((conform / decided.length) * 100);

  return {
    tool: "ultra11y",
    standard: "wcag",
    version: VERSION,
    schemaVersion: SCHEMA_VERSION,
    date: today(),
    scope: {
      inputs,
      files: acc.fileCount,
      ...(extra.truncated ? { truncated: extra.truncated } : {}),
      ...(extra.dedup ? { dedup: extra.dedup } : {}),
      ...(acc.opaqueLibs.size ? { rendered: { opaqueLibraries: [...acc.opaqueLibs].sort(), files: acc.opaqueFiles } } : {}),
      ...(acc.sfcFiles ? { sourceTemplate: { files: acc.sfcFiles, extensions: [...acc.sfcExts].sort() } } : {}),
      ...(acc.captures.length
        ? {
            captures: {
              files: acc.captures.length,
              components: [...new Set(acc.captures.map((c) => c.provenance.component).filter((x): x is string => !!x))].sort(),
            },
          }
        : {}),
      ...(acc.langCounts.size ? { langs: [...acc.langCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([lang]) => lang) } : {}),
      // Coverage the RENDERED tier earned from the snapshots this run ingested. Same field the
      // live-browser merge stamps (`mergeDynamic`), because it is the same claim: these criteria
      // were measured. Omitted when no snapshot carried usable signals, so a source-only audit
      // is byte-for-byte unchanged and still says the rendering criteria are untested.
      ...(acc.renderedScs.size ? { scan: { testedScs: [...acc.renderedScs].sort() } } : {}),
      // Stamped even when empty is NOT the same as absent: `[]` says the fold ran and found
      // nothing, `undefined` says this audit predates the fold. A pack derivation must be
      // able to tell those apart before concluding NA from silence.
      ...(acc.fileCount > 0 ? { subjectsSeen: [...acc.subjectsSeen].sort() } : {}),
      // Per page, and omitted when no page was read — same rule as above: absent means "this
      // audit predates the fold", never "nothing was found".
      ...(acc.pageSubjects.size ? { pageSubjects: Object.fromEntries([...acc.pageSubjects].map(([id, set]) => [id, [...set].sort()])) } : {}),
      // The pages this run genuinely read. Written UNCONDITIONALLY — `[]` is the whole point,
      // because "this audit read no page" is exactly the claim a source-only run needs to make,
      // and an omit-when-empty field would say nothing precisely then. See scope.pagesAudited.
      pagesAudited: [...new Set(acc.captures.map((c) => c.provenance.page).filter((x): x is string => !!x))].sort(),
      // What each page was MEASURED by. Omitted when no snapshot was folded, so a source-only
      // audit is byte-for-byte unchanged — and, per PageCoverage, absence closes nothing.
      ...(acc.pageIds.size ? { pageCoverage: pageCoverageOf(acc) } : {}),
    },
    guidelines,
    criteria,
    findings: acc.allFindings,
    ...(acc.packFindings.length ? { packFindings: acc.packFindings } : {}),
    residualRisks,
    conformancePct,
  };
}

/** Build an AuditResult from already-parsed docs (eager path; used by tests and
 *  any in-memory caller). The streaming runAudit produces an identical result. */
export function buildAudit(docs: Doc[], inputs: string[]): AuditResult {
  const acc = newAccum();
  for (const d of docs) foldDoc(acc, d);
  return finalize(acc, inputs);
}

function hashContent(content: string, mode: Exclude<DedupMode, "off">): string {
  const norm = mode === "normalized" ? content.replace(/>\s+</g, "><").trim() : content;
  return createHash("sha1").update(norm).digest("hex");
}

/** Resolve inputs and audit them in a single streaming pass: read → (dedup) →
 *  parse → fold → discard. Bounded memory, deterministic order. */
export function runAudit(opts: AuditInput): AuditResult {
  const acc = newAccum();
  // Content dedup is off in --changed/--staged mode: a changed file must always be
  // audited, and it could otherwise collapse against an unchanged file we never read.
  const dedupMode: DedupMode = opts.changed || opts.since || opts.staged ? "off" : (opts.dedup ?? "exact");
  const seen = new Set<string>();
  let duplicateFiles = 0;
  let truncated: FinalizeExtra["truncated"];

  // `--graph` expands the same inputs twice (markup, then markup + .ts/.js). The tree
  // walk is the identical, extension-agnostic part of both — share it.
  const walkCache = new Map<string, string[]>();

  const {
    files: discovered,
    gitUnavailable,
    stagedContent,
  } = discover(opts.inputs, {
    include: opts.include,
    exclude: opts.exclude,
    ext: opts.ext,
    changed: opts.changed,
    since: opts.since,
    staged: opts.staged,
    noDefaultExcludes: opts.noDefaultExcludes,
    onWarn: opts.onWarn,
    walkCache,
  });
  // In staged mode, read the index blob (from discovery) instead of the working tree.
  const useStaged = opts.staged === true && !gitUnavailable;

  // Diff-scoped mode (--changed/--since/--staged): a capture is rarely itself part of
  // the diff (the SOURCE changed; its already-committed capture usually didn't), so
  // pull in just the captures relevant to the diffed files (capturesForSources) — read
  // from the working tree/disk even in --staged mode (an unchanged capture's staged
  // blob and working-tree copy are identical). Extra files, never removed from the
  // diff's own scope; a full scan's capture ingestion is the CLI appending captureDir
  // as a top-level input instead (see cmdAudit's `useCaptures`).
  const diffMode = opts.changed || opts.since || opts.staged;
  const relevantCaptures =
    opts.captureDiff && diffMode && opts.captureDir ? capturesForSources(opts.captureDir, discovered).filter((c) => !discovered.includes(c)) : [];
  const files = relevantCaptures.length ? [...discovered, ...relevantCaptures] : discovered;

  // Cross-file pass: build the dependency graph over the FULL scope (so a changed
  // file's references resolve into unchanged definitions), then run cross rules in
  // the audit loop below. Off by default — a plain audit is byte-identical. The
  // graph's OWN discovery always widens to GRAPH_ONLY_EXT (.ts/.js/.mjs/.cjs) on top
  // of whatever --ext adds — a barrel/plain-JS module is never an audit target (see
  // `files` above), but it is real cross-file structure the graph resolves through.
  let graph: DepGraph | undefined;
  // Docs the graph pass already parsed, handed over so the audit loop below does not
  // read and parse the very same markup a second time. Never used in --staged mode:
  // there the audit must see the INDEX blob while the graph pass read the working
  // tree, so the two can legitimately differ. Nor under --jsx, which forces a parser
  // the graph pass does not apply.
  let carried: Map<string, Doc> | undefined;
  if (opts.graph || opts.captureCoverage) {
    const graphExt = [...GRAPH_ONLY_EXT, ...(opts.ext ?? [])];
    const graphFiles = discover(opts.inputs, {
      include: opts.include,
      exclude: opts.exclude,
      ext: graphExt,
      noDefaultExcludes: opts.noDefaultExcludes,
      walkCache,
    }).files;
    const built = buildGraphAndDocs(graphFiles, { carryDocs: !useStaged && !opts.forceJsx });
    graph = built.graph;
    if (built.docs.size) carried = built.docs;
  }

  for (let i = 0; i < files.length; i++) {
    if (opts.maxFiles && opts.maxFiles > 0 && acc.fileCount >= opts.maxFiles) {
      // skipped = candidates not audited (reconciles: audited + skipped == total),
      // counting both never-examined files and any read failures along the way.
      const skipped = files.length - acc.fileCount;
      truncated = { limit: opts.maxFiles, total: files.length, skipped };
      opts.onWarn?.(
        `ultra11y: --max-files=${opts.maxFiles} reached; audited ${acc.fileCount}/${files.length} files (highest-priority first). Skipped ${skipped}.`,
      );
      break;
    }
    const file = files[i]!;
    let content: string;
    const staged = useStaged ? stagedContent?.get(file) : undefined;
    // A carried Doc already holds the file's source, so a hit skips the read entirely.
    const reused = staged === undefined ? carried?.get(file) : undefined;
    if (staged !== undefined) {
      content = staged;
    } else if (reused) {
      content = reused.source;
    } else {
      try {
        content = readText(file);
      } catch {
        continue; // unreadable / vanished between discovery and read
      }
    }
    if (dedupMode !== "off") {
      const h = hashContent(content, dedupMode);
      if (seen.has(h)) {
        duplicateFiles++;
        continue; // identical to an already-audited file — cite the canonical one
      }
      seen.add(h);
    }
    // `--jsx` forces the JSX parser "for inputs of any extension" — meaning the user's OWN inputs.
    // Captures and page snapshots are appended to the input list by the CLI, not asked for, and
    // they are real serialized HTML. Forcing JSX on them costs the parse (a full document is not
    // an expression, so it falls to the lossy regex path and every finding is flagged
    // preliminary) AND their provenance: `parseSource` only reads the capture comment for
    // `kind === "html"`, so `doc.capture` — and with it page identity and the source component —
    // is silently dropped. `audit "src/**/*.tsx" --jsx --graph` over a repo with snapshots is
    // exactly how 700 findings reached a report with none of them attributed to a page.
    const ingested = isSnapshotDom(file) || isUnderDir(file, opts.captureDir ?? CAPTURES_DIR);
    const doc = reused ?? parseSource(content, file, { forceJsx: opts.forceJsx && !ingested });
    // A page snapshot carries browser-only signals beside its dom.html (computed styles,
    // boxes, a11y tree, screenshot). Attaching them here — after the parse, where file IO
    // already lives — is what lets the rendered rules decide criteria the source cannot,
    // OFFLINE and with no browser. A no-op for every other file.
    attachSignals(doc);
    foldDoc(acc, doc, graph);
  }

  const canonicalFiles = acc.fileCount;
  // Respect --max-files for stdin too (don't let the stdin doc push past the cap).
  if (opts.inputs.includes("-") && opts.stdin !== undefined && !(opts.maxFiles && opts.maxFiles > 0 && acc.fileCount >= opts.maxFiles)) {
    foldDoc(acc, parseSource(opts.stdin, "<stdin>", { forceJsx: opts.forceJsx }), graph);
  }

  const result = finalize(acc, opts.inputs, {
    ...(truncated ? { truncated } : {}),
    ...(duplicateFiles > 0 ? { dedup: { canonicalFiles, duplicateFiles } } : {}),
  });
  if (graph) {
    enrichCaptureOrigins(result.findings, graph); // anchor capture findings at the source component line
    // Coverage is a repo-wide property: read the FULL capture set from the captures dir,
    // not acc.captures (which is scoped to what THIS run audited — empty in --changed/--staged).
    if (opts.captureCoverage) result.scope.captureCoverage = computeCaptureCoverage(graph, readCaptureDir(opts.captureDir ?? CAPTURES_DIR));
  }
  return result;
}
