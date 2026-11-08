import { test, expect } from "bun:test";
import { formConfig, coerceConfig } from "./form.js";

test("edit form prefills from twin.config (not state.config)", () => {
  const twin = { id: "home/runs", kind: "counter", state: { value: 4 }, config: { step: 2 } };
  expect(formConfig(twin)).toEqual({ step: 2 });
  expect(formConfig(null)).toEqual({});
});

test("coerceConfig types fields and drops blanks", () => {
  expect(coerceConfig([["step", "number"], ["x", "text"]], { step: "3", x: "" })).toEqual({ step: 3 });
});

import { fieldBody, listText, textList } from "./form.js";
test("Field merges args into its body, its own value wins", () => {
  expect(fieldBody({ ask: "a1" }, "text", "yes", "text")).toEqual({ ask: "a1", text: "yes" });
  expect(fieldBody({ text: "x" }, "text", "y")).toEqual({ text: "y" });
  expect(fieldBody(undefined, "n", "3", "number")).toEqual({ n: 3 });
});
test("list config: comma text ↔ array, objects as JSON", () => {
  expect(textList("note.write, clock.now ,")).toEqual(["note.write", "clock.now"]);
  expect(textList('[{"id":"work","tools":["clock.now"]}]')).toEqual([{ id: "work", tools: ["clock.now"] }]);
  expect(listText(["a", "b"])).toBe("a, b");
  expect(listText([{ id: "work" }])).toBe('[{"id":"work"}]');
  expect(coerceConfig([["list", "list"]], { list: "a, b" })).toEqual({ list: ["a", "b"] });
  expect(formConfig({ config: { list: ["a", "b"], step: 1 } })).toEqual({ list: "a, b", step: 1 });
});
