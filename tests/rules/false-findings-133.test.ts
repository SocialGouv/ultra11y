// #133 — the 7.1/7.3 evidence called egapro's Next <Link onClick> « not natively interactive »,
// but `next/link` renders an <a href>. A router link given a destination is a link; a
// component of unknown origin, or a Link without a destination, still is not proven one.
import { describe, it, expect } from "vitest";
import { harvestSubjects } from "../../src/adjudicate-subjects.js";
import { parseSource } from "../../src/parse/source.js";

const clickables = (src: string, file = "NavLink.tsx") =>
  harvestSubjects(["pointerHandlers"], [parseSource(src, file)])
    .filter((x) => x.cls.startsWith("clickable|"))
    .map((x) => x.cls.split("|")[1]);

describe("pointerHandlers — a router link is natively interactive (#133)", () => {
  it("does not call Next's <Link href onClick> non-interactive", () => {
    const src = `import Link from "next/link";
export function NavLink({ href, onClick, children }) {
  return <Link href={href} onClick={onClick} aria-current="page">{children}</Link>;
}`;
    expect(clickables(src)).toEqual([]);
  });
  it("knows React Router's Link/NavLink, renamed or not", () => {
    const src = `import { NavLink, Link as RLink } from "react-router-dom";
export const A = () => <><NavLink to="/a" onClick={f}>A</NavLink><RLink to="/b" onClick={f}>B</RLink></>;`;
    expect(clickables(src)).toEqual([]);
  });
  it("still harvests a Link of unknown origin, a Link without a destination, and a clickable <div>", () => {
    const src = `import Link from "./MyLink";
import NextLink from "next/link";
export const A = () => <><Link href="/a" onClick={f}>A</Link><NextLink onClick={f}>B</NextLink><div onClick={f}>C</div></>;`;
    expect(clickables(src)).toEqual(["Link", "NextLink", "div"]);
  });
});
