// A unit test with a snapshot. The audit must never read it: it holds what a test author wrote.
import { render } from "@testing-library/react";
import { Button } from "./Button";

test("renders", () => {
  expect(render(<Button />).container).toMatchSnapshot();
});
