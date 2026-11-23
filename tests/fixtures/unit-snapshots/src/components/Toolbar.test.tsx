// The test that wrote __snapshots__/Toolbar.test.tsx.snap. It is never run here: the fixture
// proves the defects are found from the `.snap` alone, with no test run and no React.
import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { Toolbar, ToolbarLogo } from "./Toolbar";

it("renders the icon-only close button", () => {
  const { container } = render(<Toolbar />);
  expect(container).toMatchSnapshot();
});

it("renders the logo", () => {
  const { asFragment } = render(<ToolbarLogo />);
  expect(asFragment()).toMatchSnapshot();
});
