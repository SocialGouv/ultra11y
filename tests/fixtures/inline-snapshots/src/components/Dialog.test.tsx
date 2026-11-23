// Inline snapshots: the runner wrote each render INTO this file. It is never run here — the
// fixture proves the defects are found from the literals alone, and that the rest of the test
// file (a hand-typed fixture, below) is not audited.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("renders the icon-only close button", () => {
    const { container } = render(<Dialog />);
    expect(container).toMatchInlineSnapshot(`
      <div>
        <div
          class="fr-modal"
          role="dialog"
        >
          <button
            class="fr-btn--close"
            type="button"
          />
        </div>
      </div>
    `);
  });

  it("keeps its state out of the markup", () => {
    expect({ open: false, title: "Fermer" }).toMatchInlineSnapshot(`
      {
        "open": false,
        "title": "Fermer",
      }
    `);
  });

  it("renders with a generated id", () => {
    const { asFragment } = render(<Dialog />);
    expect(asFragment()).toMatchInlineSnapshot({ id: expect.any(String) }, `
      <DocumentFragment>
        <img
          src="/close.svg"
        />
      </DocumentFragment>
    `);
  });

  it("is hand-typed markup the audit never reads", () => {
    // A deliberately broken fixture: audited only if the whole test file were.
    render(<input type="text" />);
  });
});
