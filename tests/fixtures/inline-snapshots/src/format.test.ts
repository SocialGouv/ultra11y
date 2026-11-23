// Inline snapshots holding no markup: the file contributes nothing to the audit.
import { expect, it } from "vitest";

it("formats a date", () => {
  expect(new Date(0).toISOString()).toMatchInlineSnapshot(`"1970-01-01T00:00:00.000Z"`);
});
