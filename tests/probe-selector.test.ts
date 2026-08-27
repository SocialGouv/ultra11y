import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

import { PRELUDE } from "../src/probes.js";

interface TestElement {
  textContent: string | null;
}

interface TestDocument {
  querySelector(query: string): TestElement | null;
  querySelectorAll(query: string): ArrayLike<TestElement>;
}

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (markup: string) => { window: { document: TestDocument } };
};

function selectorFor(markup: string, query: string, withCssEscape = true): string {
  const dom = new JSDOM(markup);
  const make = new Function("document", "CSS", `${PRELUDE}; return __sel;`) as (
    document: unknown,
    css: { escape: (value: string) => string },
  ) => (element: unknown) => string;
  const css = { escape: (value: string) => value.replace(/([^a-zA-Z0-9_-])/g, "\\$1") };
  return make(dom.window.document, withCssEscape ? css : (undefined as unknown as typeof css))(dom.window.document.querySelector(query)!);
}

describe("live-probe evidence selectors", () => {
  it("keeps the short selector when it uniquely identifies the measured element", () => {
    expect(selectorFor(`<main><button class="save">Save</button></main>`, "button")).toBe("button.save");
  });

  it("adds a stable structural path when a tag or class is ambiguous", () => {
    const markup = `<main><nav><a class="item">One</a><a class="item">Two</a></nav><footer><a class="item">Three</a></footer></main>`;
    const selector = selectorFor(markup, "nav a:nth-of-type(2)");
    const dom = new JSDOM(markup);
    expect(dom.window.document.querySelectorAll(selector)).toHaveLength(1);
    expect(dom.window.document.querySelector(selector)?.textContent).toBe("Two");
    expect(selector).toContain(":nth-of-type(2)");
  });

  it("escapes special selector characters when CSS.escape is unavailable", () => {
    const markup = `<main><button id="save:now">Save</button></main>`;
    const selector = selectorFor(markup, "button", false);
    const dom = new JSDOM(markup);
    expect(dom.window.document.querySelector(selector)?.textContent).toBe("Save");
    expect(selector).toBe("button#save\\:now");
  });
});
