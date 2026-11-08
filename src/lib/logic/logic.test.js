import { test, expect } from "bun:test";
import { findObject, replaceTwin, parentEngine, walk } from "./world.js";
import { phaseTone, toneOf, toneVar } from "./tones.js";
import { orderEngines, moveId } from "./layout.js";
import { zoomAt, clampZoom } from "./canvas.js";
import { sizeForZoom } from "./sizes.js";
import { renderMarkdown } from "./markdown.js";
import { themeCss, splitTokens, withDefaults } from "./theme.js";
import fixture from "../fixtures/world.json";

const w = () => JSON.parse(JSON.stringify(fixture));

test("fixture covers the contract", () => {
  const all = [...walk(w().engines)];
  expect(new Set(all.map((o) => o.kind))).toEqual(new Set(["engine", "note", "counter", "status", "meter"]));
  for (const o of all) for (const v of ["icon", "small", "medium", "large"]) { expect(o.views[v].c).toBe("Card"); expect(o.views[v].props.status.now).toBeString(); }
});

test("fixture has the backend's shapes (contract Backend notes 1-3)", () => {
  const f = w();
  expect(f.theme.tokens).toBeUndefined();
  expect(Object.keys(f.theme.dark)).toContain("bg");
  expect(f.layouts.dashboard.order).toBeArray();
  expect(f.layouts.canvas.positions).toBeObject();
  for (const o of walk(f.engines)) expect(o.config).toBeObject();
});

test("replaceTwin at depth (child engine element)", () => {
  const world = w();
  expect(replaceTwin(world, "lab/probe/load", { id: "lab/probe/load", title: "New" })).toBe(true);
  expect(findObject(world, "lab/probe/load").title).toBe("New");
  expect(parentEngine(world, "lab/probe/load").id).toBe("lab/probe");
});

test("replaceTwin of an engine keeps elements and children when absent", () => {
  const world = w();
  replaceTwin(world, "lab", { id: "lab", title: "Lab 2", phase: "running" });
  const lab = findObject(world, "lab");
  expect(lab.title).toBe("Lab 2");
  expect(lab.elements.length).toBe(2);
  expect(lab.children[0].id).toBe("lab/probe");
  replaceTwin(world, "lab/probe", { id: "lab/probe", title: "P", elements: [] });
  expect(findObject(world, "lab/probe").elements).toEqual([]);
});

test("replaceTwin unknown id", () => { expect(replaceTwin(w(), "nope", {})).toBe(false); });

test("tones", () => {
  expect(phaseTone("running")).toBe("busy");
  expect(phaseTone("interrupted")).toBe("warn");
  expect(phaseTone("failed")).toBe("error");
  expect(phaseTone("waiting")).toBe("accent");
  expect(phaseTone("x")).toBe("neutral");
  expect(toneOf("ok", "failed")).toBe("ok");
  expect(toneOf("#f00", "failed")).toBe("error");
  expect(toneVar("weird")).toBe("var(--neutral)");
});

test("layout order", () => {
  const es = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(orderEngines(es, { order: ["c", "a"] }).map((e) => e.id)).toEqual(["c", "a", "b"]);
  expect(orderEngines(es, undefined).map((e) => e.id)).toEqual(["a", "b", "c"]);
  expect(moveId(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
  expect(moveId(["a", "b"], "a", -1)).toEqual(["a", "b"]);
});

test("zoom → viewpoint", () => {
  expect(sizeForZoom(0.3)).toBe("icon");
  expect(sizeForZoom(0.5)).toBe("small");
  expect(sizeForZoom(0.7)).toBe("medium");
  expect(sizeForZoom(1)).toBe("medium");
  expect(sizeForZoom(1.3)).toBe("large");
  expect(clampZoom(100)).toBe(2.5);
  const c = zoomAt({ x: 0, y: 0, z: 1 }, 2, 100, 100);
  expect(c).toEqual({ x: -100, y: -100, z: 2 });
});

test("markdown is escaped", () => {
  const h = renderMarkdown("# Hi\n<script>x</script> **b**\n- a");
  expect(h).not.toContain("<script>");
  expect(h).toContain("<strong>b</strong>");
  expect(h).toContain("<li>a</li>");
});

test("theme css", () => {
  const css = themeCss(withDefaults(fixture.theme));
  expect(css).toContain("--radius-md:10px");
  expect(css).toContain("--space-1:4px");
  expect(css).toContain(':root[data-theme="dark"]{');
  expect(splitTokens({ bg: "#fff", dark: { bg: "#000" } }).dark.bg).toBe("#000");
  expect(themeCss({ x: "red;}body{" })).not.toContain("}body{");
});

import { renderInline, mdInline, plainText } from "./markdown.js";
test("inline markdown renders one line without raw markup", () => {
  expect(renderInline("Hello from **Askk**.")).toBe("Hello from <strong>Askk</strong>.");
  expect(renderInline("<b>x</b> *y*")).toBe("&lt;b&gt;x&lt;/b&gt; <em>y</em>");
  expect(renderInline("\n# Title\nmore")).toBe("Title");
  expect(mdInline("one line")).toBe(true);
  expect(mdInline("two\nlines")).toBe(false);
  expect(plainText("a **b** `c` [d](https://x)")).toBe("a b c d");
});
