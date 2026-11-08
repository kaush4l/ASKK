import { test, expect } from "bun:test";
import { nextSize, gridSize, openMode, focusHref, focusId, openFocus, closeFocus, focusKey, activityRows, focusLine, chipOf, expandBox } from "./focus.js";

test("the size control cycles icon → small → medium → large → icon", () => {
  expect(["icon", "small", "medium", "large"].map(nextSize)).toEqual(["small", "medium", "large", "icon"]);
  expect(nextSize("nope")).toBe("small");
});

test("in the grid only icon and small take a place; medium and large open out of it", () => {
  expect(["icon", "small", "medium", "large", undefined].map(gridSize)).toEqual(["icon", "small", "small", "small", "small"]);
  expect(["icon", "small", "medium", "large"].map(openMode)).toEqual([null, null, "expand", "immersive"]);
});

test("/focus?id= addresses the immersive view", () => {
  expect(focusHref("askk/loop")).toBe("/focus?id=askk%2Floop");
  expect(focusId(new URL("http://x/focus?id=askk%2Floop"))).toBe("askk/loop");
  expect(focusId(new URL("http://x/focus"))).toBe(null);
});

test("open and close: medium expands in place from the card's rect, Escape returns", () => {
  const from = { x: 10, y: 20, w: 300, h: 200 };
  let s = openFocus(null, { id: "a/x", size: "medium", from });
  expect(s).toEqual({ id: "a/x", mode: "expand", from });
  expect(openFocus(s, { id: "a/x", size: "small" })).toBe(null);
  expect(focusKey(s, "Escape")).toBe(null);
  expect(focusKey(s, "a")).toBe(s);
  expect(closeFocus(s)).toBe(null);
  expect(openFocus(null, { id: "a/x", size: "large" }).mode).toBe("immersive");
});

test("the expanded box takes the content area: right of the panel, above the composer", () => {
  const b = expandBox({ vw: 1440, vh: 900, shell: 280, composer: 130, gap: 16 });
  expect(b).toEqual({ x: 296, y: 16, w: 1440 - 296 - 16, h: 900 - 16 - 130 - 16 });
  const p = expandBox({ vw: 390, vh: 844, shell: 0, composer: 120, gap: 8, top: 56 });
  expect(p.x).toBe(8); expect(p.y).toBe(56); expect(p.y + p.h).toBe(844 - 120 - 8);
});

test("activity rows: newest first as sent, time + action + text + ok, capped", () => {
  const twin = { activity: Array.from({ length: 30 }, (_, i) => ({ at: 1700000000 + 60 * (30 - i), action: "run", by: "owner", text: `t${i}`, ok: i !== 1 })) };
  const rows = activityRows(twin, 20);
  expect(rows.length).toBe(20);
  expect(rows[0]).toMatchObject({ action: "run", text: "t0", ok: true, by: "owner" });
  expect(rows[0].time).toMatch(/^\d\d:\d\d$/);
  expect(rows[1].ok).toBe(false);
  expect(activityRows({}, 5)).toEqual([]);
});

test("focus line and chip from the status, falling back to now", () => {
  expect(focusLine({ status: { now: "idle", focus: "working on: x" } })).toBe("working on: x");
  expect(focusLine({ status: { now: "step 2" } })).toBe("step 2");
  expect(chipOf({ status: { chip: "💬 Chat" } })).toBe("💬 Chat");
  expect(chipOf({ status: {} })).toBe(null);
});
