// CONSENT STATE — what a headless capture shows when nobody clicked the cookie banner (#184).
//
// A capture is taken by a browser that never accepts cookies. On a page that embeds a video,
// a map or a social widget behind a consent manager, what gets serialized is therefore not the
// content but its PLACEHOLDER: DSFR's `div.fr-consent-placeholder > p.fr-h6` « Youtube est
// désactivé », tarteaucitron's « activer » box, a Didomi or Axeptio overlay. Judged as the
// page's content, that placeholder produced a 9.1 heading finding on a sentence that only
// exists because the capture refused cookies.
//
// So the markers live in ONE table, read on both sides:
//   • in the browser (CONSENT_STATE, evaluated by every snapshot producer through the shared
//     collector), to record `consent: "none"` and the markers seen in the page's meta.json;
//   • in Node (`consentContainerOf`), on the parsed dom.html, to tag every piece of evidence
//     harvested from inside such a container « état sans consentement » in the adjudication
//     brief, so the adjudicator judges it as what it is.
//
// Deliberately narrow. A generic class containing « consent » is a marker only with a word
// saying it is a placeholder or a banner (`consent-placeholder`, `cookie-consent-banner`): a
// form's own « I consent to the terms » checkbox is page content and must stay that way.
//
// Accepting or refusing consent before the capture (`sample.consent: accept|refuse`) is NOT
// done here: every consent manager names its buttons differently, and a click that misses
// would silently capture the wrong state under the right label. Recorded as a follow-up.

/** One consent-manager marker. `kind` says what the reader is looking at: a PLACEHOLDER stands
 *  in for third-party content blocked until consent, a BANNER asks for that consent. */
export interface ConsentMarker {
  vendor: string;
  kind: "placeholder" | "banner";
  /** Exact id, or id prefix when `idPrefix` is set. */
  id?: string;
  idPrefix?: boolean;
  /** Exact class token, or class-token prefix when `classPrefix` is set. */
  cls?: string;
  classPrefix?: boolean;
}

export const CONSENT_MARKERS: readonly ConsentMarker[] = [
  // DSFR (système de design de l'État): the consent placeholder and the consent banner.
  { vendor: "dsfr", kind: "placeholder", cls: "fr-consent-placeholder" },
  { vendor: "dsfr", kind: "banner", cls: "fr-consent-banner" },
  // EU Cookie Compliance (Drupal).
  { vendor: "eu-cookie-compliance", kind: "banner", id: "sliding-popup" },
  { vendor: "eu-cookie-compliance", kind: "banner", cls: "eu-cookie-compliance-banner" },
  // tarteaucitron: its root and the « activate » box it puts where a blocked service was.
  { vendor: "tarteaucitron", kind: "banner", id: "tarteaucitron", idPrefix: true },
  { vendor: "tarteaucitron", kind: "placeholder", cls: "tac_activate", classPrefix: true },
  // Didomi.
  { vendor: "didomi", kind: "banner", id: "didomi-host" },
  { vendor: "didomi", kind: "banner", id: "didomi-notice" },
  { vendor: "didomi", kind: "placeholder", cls: "didomi-content-placeholder", classPrefix: true },
  // Axeptio.
  { vendor: "axeptio", kind: "banner", id: "axeptio_overlay" },
  { vendor: "axeptio", kind: "banner", cls: "axeptio_mount" },
  { vendor: "axeptio", kind: "placeholder", cls: "axeptio-placeholder", classPrefix: true },
];

/** A generic class token naming a consent placeholder or banner. */
const GENERIC_PLACEHOLDER = /consent.*(?:placeholder|blocked|disabled|fallback)|(?:placeholder|blocked).*consent/i;
const GENERIC_BANNER = /(?:cookie|consent).*(?:banner|popup|notice|modal|overlay|bar)$|^(?:cookie-?)?consent-?(?:banner|popup|notice|modal|overlay|bar)/i;

/** Which marker an element with this id and these class tokens carries, if any. Shared by the
 *  Node matcher and — through its source — by the browser expression, so the two cannot drift. */
export function consentMarkerFor(id: string, classes: readonly string[]): { vendor: string; kind: "placeholder" | "banner" } | undefined {
  for (const m of CONSENT_MARKERS) {
    if (m.id !== undefined && id && (m.idPrefix ? id.startsWith(m.id) : id === m.id)) return { vendor: m.vendor, kind: m.kind };
    if (m.cls !== undefined && classes.some((c) => (m.classPrefix ? c.startsWith(m.cls!) : c === m.cls))) return { vendor: m.vendor, kind: m.kind };
  }
  for (const c of classes) {
    if (!/consent/i.test(c)) continue;
    if (GENERIC_PLACEHOLDER.test(c)) return { vendor: "generic", kind: "placeholder" };
    if (GENERIC_BANNER.test(c)) return { vendor: "generic", kind: "banner" };
  }
  return undefined;
}

/** The nearest element (itself included) that is a consent container. Structural, so it works
 *  on the parsed-HTML `El` without importing the parser here. */
export function consentContainerOf<E extends { attribs: Record<string, string>; parent: E | null }>(
  el: E,
): { el: E; vendor: string; kind: "placeholder" | "banner" } | undefined {
  for (let n: E | null = el; n; n = n.parent) {
    const m = consentMarkerFor(n.attribs.id ?? "", (n.attribs.class ?? "").split(/\s+/).filter(Boolean));
    if (m) return { el: n, ...m };
  }
  return undefined;
}

/** The note an adjudication brief adds to evidence harvested inside a consent container. */
export function consentNote(kind: "placeholder" | "banner", vendor: string): string {
  return kind === "placeholder"
    ? `[état sans consentement — consent placeholder (${vendor}): the capture refused cookies, so this stands in for blocked third-party content; it is not the page's own content and is not to be judged as such (e.g. not a heading)]`
    : `[état sans consentement — consent banner (${vendor}) shown because the capture gave no consent]`;
}

// The browser side: the same table and the same matcher, serialized into the page. Evaluated as
// a STRING by the shared collector (the engine ships no DOM lib). Returns the markers present,
// as « kind vendor selector » strings, at most 10; empty when the page shows none.
export const CONSENT_STATE = `(() => {
  const MARKERS = ${JSON.stringify(CONSENT_MARKERS)};
  const GP = ${GENERIC_PLACEHOLDER.toString()};
  const GB = ${GENERIC_BANNER.toString()};
  const match = (id, classes) => {
    for (const m of MARKERS) {
      if (m.id !== undefined && id && (m.idPrefix ? id.indexOf(m.id) === 0 : id === m.id)) return m;
      if (m.cls !== undefined && classes.some((c) => (m.classPrefix ? c.indexOf(m.cls) === 0 : c === m.cls))) return m;
    }
    for (const c of classes) {
      if (!/consent/i.test(c)) continue;
      if (GP.test(c)) return { vendor: 'generic', kind: 'placeholder' };
      if (GB.test(c)) return { vendor: 'generic', kind: 'banner' };
    }
    return null;
  };
  const out = [];
  const seen = new Set();
  for (const e of Array.from(document.querySelectorAll('[id],[class]'))) {
    const classes = typeof e.className === 'string' ? e.className.split(/\\s+/).filter(Boolean) : Array.from(e.classList || []);
    const m = match(e.id || '', classes);
    if (!m) continue;
    // The outermost container only: the children of a banner are the banner.
    let inner = false;
    for (let p = e.parentElement; p; p = p.parentElement) if (seen.has(p)) { inner = true; break; }
    seen.add(e);
    if (inner) continue;
    const sel = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (classes[0] ? '.' + classes[0] : '');
    out.push(m.kind + ' ' + m.vendor + ' ' + sel);
    if (out.length >= 10) break;
  }
  return out;
})()`;
