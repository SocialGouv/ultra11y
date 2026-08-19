// THE DOCTYPE MUST SURVIVE THE TRIP FROM THE BROWSER TO THE DISK.
//
// `documentElement.outerHTML` starts at `<html>`, so a capture that records only the DOM drops
// the doctype — and RGAA 8.1 (« chaque page web est-elle définie par un type de document ? »)
// then has nothing at all to look at. The collector knew this and captured it separately;
// `buildPayload` did not carry it into `meta`, so it was thrown away one step later.
//
// Measured on a real audit: 105 of 106 RGAA criteria decided, and the one left was 8.1, whose
// brief read « this capture predates doctype recording, so the declaration was NOT captured ».
// The subject was right to refuse — absence of a record is not a record of absence — and no
// amount of adjudication could have fixed it.
import { describe, expect, it } from "vitest";
import { buildPayload } from "../src/integrations/payload.js";

const collected = (over: Record<string, unknown> = {}) => ({
  dom: '<html lang="fr"><head><title>t</title></head><body></body></html>',
  title: "Accueil",
  url: "https://x/",
  ...over,
});

describe("buildPayload carries what the collector captured", () => {
  it("stamps the doctype the page declared", () => {
    const p = buildPayload(collected({ doctype: "<!DOCTYPE html>" }), "https://x/", "playwright", { as: "accueil" });
    expect(p.meta.doctype).toBe("<!DOCTYPE html>");
  });

  it("stamps an EMPTY doctype as empty, which is a fact and not a gap", () => {
    // The three states are not interchangeable: present is the declaration, empty is a page
    // that genuinely has none — a real non-conformity — and absent means nobody recorded it.
    // Collapsing the second into the third would hide a failing page behind « to assess ».
    const p = buildPayload(collected({ doctype: "" }), "https://x/", "playwright", { as: "accueil" });
    expect(p.meta.doctype).toBe("");
  });

  it("leaves it absent when the collector did not report one", () => {
    const p = buildPayload(collected(), "https://x/", "playwright", { as: "accueil" });
    expect(p.meta.doctype).toBeUndefined();
  });
});
