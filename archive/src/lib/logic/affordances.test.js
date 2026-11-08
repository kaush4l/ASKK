import { test, expect } from "bun:test";
import { affordances, fromControl } from "./affordances.js";
import { moveTo, dashboardGrid } from "./layout.js";

const engine = { id: "home", elements: [], actions: [{ name: "element.add" }, { name: "element.edit" }, { name: "element.remove" }, { name: "engine.add" }] };
const keys = (a) => a.map((x) => x.key);

test("element affordances come from its engine's actions", () => {
  const a = affordances({ id: "home/runs", kind: "counter" }, engine);
  expect(keys(a)).toEqual(["edit", "icon", "remove"]);
  expect(a[0].target).toBe("home");
  expect(affordances({ id: "x" }, { id: "e", elements: [], actions: [] })).toEqual([]);
});

test("engine affordances: add element/engine; rename only when offered", () => {
  expect(keys(affordances(engine, null))).toEqual(["add-element", "add-engine"]);
  const named = { ...engine, actions: [...engine.actions, { name: "engine.rename" }] };
  expect(keys(affordances(named, null))).toContain("rename");
  expect(affordances(null)).toEqual([]);
});

test("fromControl walks up to the item", () => {
  const item = { tagName: "DIV", parentElement: null };
  const btn = { tagName: "BUTTON", parentElement: item };
  const span = { tagName: "SPAN", parentElement: btn };
  expect(fromControl(span, item)).toBe(true);
  expect(fromControl({ tagName: "SPAN", parentElement: item }, item)).toBe(false);
});

test("moveTo places an id at an index", () => {
  expect(moveTo(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
  expect(moveTo(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  expect(moveTo(["a", "b"], "z", 0)).toEqual(["a", "b"]);
  expect(moveTo(["a", "b"], "a", 99)).toEqual(["b", "a"]);
});

test("dashboardGrid: a lone engine is capped wider", () => {
  expect(dashboardGrid(1).lone).toBe("var(--width-wide)");
  expect(dashboardGrid(3).lone).toBeNull();
  expect(dashboardGrid(3).columns).toBe("repeat(auto-fit,minmax(min(var(--width-md),100%),1fr))");
});

test("engine rename/remove appear only when engine.edit / engine.remove are offered", () => {
  const full = { ...engine, actions: [...engine.actions, { name: "engine.edit" }, { name: "engine.remove" }] };
  const top = affordances(full, null);
  expect(keys(top)).toEqual(["add-element", "add-engine", "rename", "icon", "remove"]);
  expect(top.find((t) => t.key === "rename")).toMatchObject({ action: "engine.edit", target: "home" });
  expect(top.find((t) => t.key === "remove")).toMatchObject({ action: "engine.remove", target: "home" });
  const child = { ...full, id: "home/kid" };
  expect(affordances(child, full).find((t) => t.key === "remove").target).toBe("home");
  expect(keys(affordances(engine, null))).not.toContain("remove");
});
