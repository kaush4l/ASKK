import { describe, expect, test } from "bun:test";
import { createInferRegistry } from "./inference.js";

describe("infer registry", () => {
  test("a dummy infer method registered by identifier is retrievable by it", async () => {
    const registry = createInferRegistry();
    registry.register("dummy-method", async (messages) => `got ${messages.length}`);
    expect(registry.has("dummy-method")).toBe(true);
    expect(registry.list()).toEqual(["dummy-method"]);
    expect(typeof registry.get("dummy-method")).toBe("function");
    expect(await registry.infer("dummy-method", [{ role: "user", content: "hi" }])).toBe(
      "got 1",
    );
  });

  test("unknown identifier throws plainly, and an empty registry has no default", async () => {
    const registry = createInferRegistry();
    expect(() => registry.get("missing")).toThrow(/no infer method named "missing"/);
    await expect(registry.infer("missing", [])).rejects.toThrow(
      /no infer method named "missing"/,
    );
    expect(registry.list()).toEqual([]);
  });

  test("no hardcoded model, no silent default: initial methods only, duplicates refused", () => {
    const registry = createInferRegistry([
      { id: "seeded", infer: async () => "seeded reply" },
    ]);
    expect(registry.list()).toEqual(["seeded"]);
    expect(() => registry.register("seeded", async () => "again")).toThrow(/already has/);
    expect(() => registry.register("", async () => "")).toThrow(/non-empty/);
    expect(() => registry.register("bad", "not-a-function")).toThrow(/needs a function/);
  });
});
