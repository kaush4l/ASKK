import { test, expect } from "bun:test";
import { engineTree, readCollapsed, saveCollapsed, isMobile, isRail, engineTarget, PANEL_KEY } from "./panel.js";
import { affordances } from "./affordances.js";

const world = [{ id: "a", title: "A", phase: "running", children: [{ id: "a/c", title: "C", phase: "failed", children: [] }] }, { id: "b", title: "", children: [] }];
test("tree is flat with depth, from the world", () => {
  const t = engineTree(world);
  expect(t.map((x) => [x.id, x.depth, x.top])).toEqual([["a", 0, true], ["a/c", 1, false], ["b", 0, true]]);
  expect(t[1].failed).toBe(true);
  expect(t[2].title).toBe("b");
  expect(t[2].phase).toBe("idle");
  expect(engineTree(undefined)).toEqual([]);
  expect(engineTree([{ id: "o", elements: [{ phase: "failed" }] }])[0].failed).toBe(true);
});
test("collapsed state survives broken storage", () => {
  const m = new Map(); const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  expect(readCollapsed(s)).toBe(false);
  expect(saveCollapsed(s, true)).toBe(true);
  expect(m.get(PANEL_KEY)).toBe("collapsed");
  expect(readCollapsed(s)).toBe(true);
  const bad = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); } };
  expect(readCollapsed(bad)).toBe(false);
  expect(saveCollapsed(bad, true)).toBe(false);
  expect(readCollapsed(null)).toBe(false);
});
test("drawer only on phones (600 and below)", () => { expect(isMobile(390)).toBe(true); expect(isMobile(600)).toBe(true); expect(isMobile(601)).toBe(false); expect(isMobile(768)).toBe(false); });
test("mid widths always show the rail; wide follows the saved choice; phones never", () => {
  expect(isRail(390, true)).toBe(false); expect(isRail(700, false)).toBe(true); expect(isRail(1024, false)).toBe(true);
  expect(isRail(1280, false)).toBe(false); expect(isRail(1280, true)).toBe(true);
});
test("tree click: top engine on dashboard scrolls, else opens full view", () => {
  expect(engineTarget({ id: "a", top: true }, "/")).toEqual({ scroll: "a" });
  expect(engineTarget({ id: "a", top: true }, "/canvas")).toEqual({ sheet: "a" });
  expect(engineTarget({ id: "a/c", top: false }, "/")).toEqual({ sheet: "a/c" });
});
test("failed element offers Remove but not Edit", () => {
  const parent = { id: "e", elements: [], actions: [{ name: "element.edit" }, { name: "element.remove" }] };
  expect(affordances({ id: "e/x", phase: "failed" }, parent).map((t) => t.key)).toEqual(["remove"]);
  expect(affordances({ id: "e/y", phase: "idle" }, parent).map((t) => t.key)).toEqual(["edit", "icon", "remove"]);
});
import { withDefaults, themeCss, DEFAULT_TOKENS } from "./theme.js";
test("theme defaults fill only what is missing; an older flat theme migrates to the token shape", () => {
  const t = withDefaults({ radius: 10, light: { bg: "#fff", tint: "#eee" }, dark: { bg: "#000" }, nope: { x: 1 } });
  expect(t.light.tint).toBe("#eee");
  expect(t.dark.tint).toBe(DEFAULT_TOKENS.dark.tint);
  expect(t.font.face).toBe("Amarante");
  expect(t.radius.md).toBe("10px");
  expect(t.nope).toBeUndefined();
  expect(withDefaults({ face: "Georgia" }).font.face).toBe("Georgia");
  expect(themeCss(withDefaults({ space: { 1: "5px" } }))).toContain("--space-1:5px;");
  expect(themeCss(DEFAULT_TOKENS)).toContain("--motion-calm:260ms;");
});
import { nextScheme, readScheme } from "./panel.js";
test("scheme cycles and survives bad storage", () => {
  expect(nextScheme("system")).toBe("light"); expect(nextScheme("dark")).toBe("system"); expect(nextScheme("x")).toBe("system");
  expect(readScheme({ getItem() { throw 1; } })).toBe("system");
  expect(readScheme({ getItem: () => "dark" })).toBe("dark");
});

import { summaryOf, summaryLine } from "./panel.js";
test("engine summary: backend's when given, else counted below (never the engine itself)", () => {
  expect(summaryOf({ phase: "running", summary: { running: 2, failed: 1 } })).toEqual({ running: 2, failed: 1 });
  const e = { phase: "idle", elements: [{ phase: "running" }, { phase: "failed" }, { phase: "idle" }],
    children: [{ phase: "waiting", elements: [{ phase: "running" }], children: [] }] };
  expect(summaryOf(e)).toEqual({ running: 3, failed: 1 });
  const [it] = engineTree([e]);
  expect([it.phase, it.failed, it.busy]).toEqual(["idle", true, true]);
  expect(summaryLine(it.summary)).toBe("3 running · 1 failed");
  expect(summaryLine({ running: 0, failed: 0 })).toBe("");
});

import { openAsks } from "./panel.js";
test("the tree counts an engine's open asks", () => {
  const e = { id: "home", state: { asks: [{ id: "a1", status: "open" }, { id: "a2", status: "answered" }] }, elements: [], children: [] };
  expect(openAsks(e)).toBe(1);
  expect(engineTree([e])[0].asks).toBe(1);
  expect(openAsks({ state: {} })).toBe(0);
});
