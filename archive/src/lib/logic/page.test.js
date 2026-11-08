import { test, expect } from "bun:test";
import { DEFAULT_UI, PAGE_PRIMITIVES, isTree, pageTree, primitiveFor, findNode, withProps, colorOf, fieldsCss, imageUrl } from "./page.js";
import fixture from "../fixtures/world.json";

test("default pages are trees of page primitives", () => {
  for (const v of ["dashboard", "canvas"]) {
    expect(isTree(DEFAULT_UI[v])).toBe(true);
    expect(DEFAULT_UI[v].c).toBe("Page");
    expect(DEFAULT_UI[v].children.map((c) => c.c).every((c) => PAGE_PRIMITIVES.includes(c))).toBe(true);
  }
  expect(isTree(fixture.ui.dashboard)).toBe(true);
});
test("a route renders the world's tree, else the default", () => {
  const t = { c: "Page", children: [{ c: "CardGrid" }] };
  expect(pageTree({ ui: { dashboard: t } }, "dashboard")).toBe(t);
  expect(pageTree({ ui: { dashboard: { nope: 1 } } }, "dashboard")).toBe(DEFAULT_UI.dashboard);
  expect(pageTree(null, "canvas")).toBe(DEFAULT_UI.canvas);
  expect(isTree({ c: "Page", children: {} })).toBe(false);
  expect(isTree({ c: "Page", props: [] })).toBe(false);
});
test("an unknown primitive renders the Unknown box, never a crash", () => {
  const reg = { Page: "P", Unknown: "U" };
  expect(primitiveFor(reg, "Page")).toBe("P");
  expect(primitiveFor(reg, "Mystery")).toBe("U");
  expect(primitiveFor(reg, "toString")).toBe("U");
  expect(primitiveFor(reg, undefined)).toBe("U");
});
test("page properties are edited by path", () => {
  const f = findNode(DEFAULT_UI.dashboard, "CardGrid");
  expect(f.path).toEqual([1]);
  const t = withProps(DEFAULT_UI.dashboard, f.path, { min: "lg" });
  expect(t.children[1].props.min).toBe("lg");
  expect(DEFAULT_UI.dashboard.children[1].props.min).toBe("md"); // a copy
});
test("background fields use tokens; images and colours are sanitised", () => {
  expect(colorOf("wall-a")).toBe("var(--wall-a)");
  expect(colorOf("#abc")).toBe(null); // raw colours never reach the page
  expect(colorOf("red;}body{")).toBe(null);
  const css = fieldsCss(DEFAULT_UI.dashboard.props.background.fields, true);
  expect(css.match(/radial-gradient/g).length).toBe(5);
  expect(css).toContain("var(--wall-d)");
  expect(imageUrl("/ui/assets/a.png")).toBe("/ui/assets/a.png");
  expect(imageUrl("https://x.y/a.jpg")).toBe("https://x.y/a.jpg");
  expect(imageUrl("javascript:alert(1)")).toBe(null);
  expect(imageUrl("/a.png) , url(x")).toBe(null);
  expect(imageUrl("//evil/a.png")).toBe(null);
});

test("the page trees name the default engine and carry the footer Composer", () => {
  for (const v of ["dashboard", "canvas"]) {
    expect(DEFAULT_UI[v].props.default).toBe("askk");
    const c = findNode(DEFAULT_UI[v], "Composer");
    expect(c.path).toEqual([2]);
    expect(c.node.props.phases).toBe(true);
  }
});
