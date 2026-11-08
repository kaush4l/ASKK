import { test, expect } from "bun:test";
import { SIZES, sizeForWidth, forDevice, sizeForZoom, stepSize, pickSize, autoSize, rememberSize, viewAt } from "./sizes.js";

test("four sizes, smallest first (a full view may follow later)", () => {
  expect(SIZES).toEqual(["icon", "small", "medium", "large"]);
});
test("size from the card's own width", () => {
  expect(sizeForWidth(100)).toBe("icon");
  expect(sizeForWidth(279)).toBe("small");
  expect(sizeForWidth(280)).toBe("medium");
  expect(sizeForWidth(559)).toBe("medium");
  expect(sizeForWidth(560)).toBe("large");
  expect(sizeForWidth(0)).toBe("medium"); // not measured yet
});
test("phones default smaller", () => {
  expect(forDevice("large", 390)).toBe("medium");
  expect(forDevice("large", 1440)).toBe("large");
  expect(autoSize({ width: 900, viewport: 390 })).toBe("medium");
  expect(autoSize({ width: 900, viewport: 1440 })).toBe("large");
});
test("a fixed base and the canvas zoom win over the width", () => {
  expect(autoSize({ base: "small", width: 900, viewport: 1440 })).toBe("small");
  expect(autoSize({ base: "auto", width: 900, zoom: 0.4 })).toBe("small");
  expect(sizeForZoom(0.5, { icon: 0.6, small: 0.8, medium: 1 })).toBe("icon");
});
test("stepping is clamped; the owner's choice wins; a step back to auto forgets", () => {
  expect(stepSize("icon", -1)).toBe("icon");
  expect(stepSize("small", 1)).toBe("medium");
  expect(stepSize("large", 1)).toBe("large");
  expect(pickSize({ auto: "medium", chosen: "large" })).toBe("large");
  expect(pickSize({ auto: "medium", chosen: "row" })).toBe("medium");
  expect(rememberSize({}, "a", "large", "medium")).toEqual({ a: "large" });
  expect(rememberSize({ a: "large" }, "a", "medium", "medium")).toEqual({});
});
test("a missing size falls back to the nearest present one", () => {
  expect(viewAt({ small: 1, large: 3 }, "medium")).toBe(1);
  expect(viewAt({ large: 3 }, "icon")).toBe(3);
  expect(viewAt(null, "small")).toBe(null);
});

import { cascadeSize, resolveSize } from "./sizes.js";
test("the cascade: nearest per-kind > nearest default > parent chain; user step wins; auto last", () => {
  const engine = { size: "icon", kinds: { loop: { size: "large" } } }, page = { size: "small" };
  expect(cascadeSize([engine, page], "loop")).toBe("large");
  expect(cascadeSize([engine, page], "note")).toBe("icon");
  expect(cascadeSize([{ kinds: { loop: { size: "medium" } } }, page], "note")).toBe("small");
  expect(cascadeSize([{ size: "huge" }, null, {}], "note")).toBe(null);
  expect(resolveSize({ chosen: "medium", chain: [engine], kind: "loop", auto: "small" })).toBe("medium");
  expect(resolveSize({ chain: [engine], kind: "loop", base: "small", auto: "icon" })).toBe("large");
  expect(resolveSize({ chain: [], kind: "x", base: "small", auto: "icon" })).toBe("small");
  expect(resolveSize({ chain: [], kind: "x", base: "auto", auto: "icon" })).toBe("icon");
  expect(resolveSize({})).toBe("medium");
});

test("a cap (the canvas legibility limit) overrides the cascade and the owner's step, never enlarging", async () => {
  const { resolveSize } = await import("./sizes.js");
  const chain = [{ kinds: { timer: { size: "large" } } }];
  expect(resolveSize({ chain, kind: "timer", auto: "icon" })).toBe("large");
  expect(resolveSize({ chain, kind: "timer", auto: "icon", cap: "icon" })).toBe("icon");
  expect(resolveSize({ chosen: "medium", auto: "icon", cap: "small" })).toBe("small");
  expect(resolveSize({ chosen: "small", auto: "icon", cap: "large" })).toBe("small");
  expect(resolveSize({ auto: "medium", cap: null })).toBe("medium");
});
