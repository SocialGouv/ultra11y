// Reads a browser-only API while rendering.
export function WindowWidth() {
  const wide = window.matchMedia("(min-width: 800px)").matches;
  return <p>{wide ? "wide" : "narrow"}</p>;
}
