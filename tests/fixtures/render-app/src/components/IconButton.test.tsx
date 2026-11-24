// A unit test: ultra11y never loads, reads or audits it.
throw new Error("ultra11y must never load a test file");
export function BadFixture() {
  return <img src="broken-on-purpose.png" />;
}
