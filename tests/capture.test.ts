import { describe, it, expect } from "vitest";
import { escapeCommentValue, parseCaptureProvenance, unescapeCommentValue } from "../src/capture.js";
import { parseSource } from "../src/parse/source.js";
import { runAudit } from "../src/audit.js";
import { INAPPLICABLE_STATUS } from "../src/types.js";

const FIX = new URL("./fixtures/", import.meta.url).pathname;

describe("capture provenance — comment escaping", () => {
  it('round-trips values with the HTML-comment hazards (" and --)', () => {
    for (const raw of ['renders "OK" button', "a--b-->c", "a & b < c > d", "kebab-case-name", 'mix "q" -- <t>']) {
      expect(unescapeCommentValue(escapeCommentValue(raw))).toBe(raw);
    }
  });

  it('escaped values contain no literal " or -- (would break the comment)', () => {
    const e = escapeCommentValue('a "quote" and -- dashes');
    expect(e).not.toContain('"');
    expect(e).not.toContain("--");
  });

  it("preserves single hyphens for readable kebab paths", () => {
    expect(escapeCommentValue("src/icon-button.tsx")).toBe("src/icon-button.tsx");
  });
});

describe("parseCaptureProvenance", () => {
  it("parses all fields from a well-formed marker", () => {
    const p = parseCaptureProvenance(
      '<!-- ultra11y:capture v="1" source="src/Button.tsx" component="Button" test="src/Button.test.tsx" name="renders icon" -->\n<button></button>',
    );
    expect(p).toEqual({ v: 1, sourceFile: "src/Button.tsx", component: "Button", test: "src/Button.test.tsx", name: "renders icon" });
  });

  it("returns undefined when no marker is present (agnostic ingest)", () => {
    expect(parseCaptureProvenance("<button>hi</button>")).toBeUndefined();
    expect(parseCaptureProvenance("<!-- some other comment --><div></div>")).toBeUndefined();
  });

  it("defaults the version to 1 and tolerates missing optional fields", () => {
    const p = parseCaptureProvenance('<!-- ultra11y:capture source="src/X.tsx" -->');
    expect(p).toEqual({ v: 1, sourceFile: "src/X.tsx" });
  });

  it("decodes escaped values (quotes and -- digraphs)", () => {
    const name = escapeCommentValue('renders "a--b"');
    const p = parseCaptureProvenance(`<!-- ultra11y:capture v="1" name="${name}" -->`);
    expect(p?.name).toBe('renders "a--b"');
  });

  it("ignores a marker buried past the scan window", () => {
    const p = parseCaptureProvenance(`${" ".repeat(5000)}<!-- ultra11y:capture source="late" -->`);
    expect(p).toBeUndefined();
  });
});

describe("parseSource — capture attachment", () => {
  it("attaches provenance to an HTML capture", () => {
    const doc = parseSource('<!-- ultra11y:capture v="1" source="src/Button.tsx" component="Button" -->\n<button></button>', "cap.html");
    expect(doc.capture?.sourceFile).toBe("src/Button.tsx");
    expect(doc.capture?.component).toBe("Button");
  });

  it("does not treat a JSX source as a capture even if it holds the marker text", () => {
    const doc = parseSource('const x = () => <button>{/* ultra11y:capture source="x" */}</button>;', "Comp.tsx");
    expect(doc.capture).toBeUndefined();
  });

  it("does not treat an SFC template as a capture", () => {
    const doc = parseSource('<template>\n<!-- ultra11y:capture source="x" -->\n<Button/>\n</template>', "Comp.vue");
    expect(doc.capture).toBeUndefined();
  });
});

describe("runAudit — capture ingestion & attribution", () => {
  const r = runAudit({
    inputs: [`${FIX}captures/button-icon.html`, `${FIX}captures/button-named.html`, `${FIX}captures/storybook-dump.html`],
  });

  it("re-attributes a finding on a provenance-tagged capture to its source component", () => {
    const f = r.findings.find((x) => x.file.endsWith("button-icon.html"));
    expect(f, "expected a finding on button-icon.html").toBeTruthy();
    expect(f?.origin?.sourceFile).toBe("src/Button.tsx");
    expect(f?.origin?.component).toBe("Button");
    expect(f?.origin?.capture).toContain("button-icon.html");
  });

  it("marks capture findings as ground truth (never preliminary)", () => {
    const f = r.findings.find((x) => x.file.endsWith("button-icon.html"));
    expect(f?.preliminary).toBeFalsy();
  });

  it("audits a no-provenance dump as plain HTML (origin undefined)", () => {
    const f = r.findings.find((x) => x.file.endsWith("storybook-dump.html"));
    expect(f, "expected a finding on storybook-dump.html").toBeTruthy();
    expect(f?.origin).toBeUndefined();
  });

  it("counts only provenance-tagged files in scope.captures and dedupes components", () => {
    expect(r.scope.captures?.files).toBe(2); // button-icon + button-named; the dump is not credited
    expect(r.scope.captures?.components).toEqual(["Button"]);
  });

  it("serializes captures as fragments, so page-scoped SCs stay NA (no false page NCs)", () => {
    const statusOf = (id: string) => r.criteria.find((c) => c.id === id)?.status;
    expect(statusOf("2.4.2")).toBe(INAPPLICABLE_STATUS); // Page Titled — no <html>/<title> in a fragment
    expect(statusOf("3.1.1")).toBe(INAPPLICABLE_STATUS); // Language of Page — idem
    expect(statusOf("4.1.2")).toBe("NC"); // the icon button IS caught
  });
});
