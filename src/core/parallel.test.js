import { describe, expect, test } from "bun:test";
import { renderElementsParallel } from "./parallel.js";

describe("parallel rendering", () => {
  test("cached elements are skipped, only changed elements re-render", async () => {
    let renders = 0;
    const cache = new Map();
    const make = (id, version, data) => ({
      id,
      kind: "test",
      version,
      data,
      render: async () => {
        renders += 1;
        return `rendered ${id} ${JSON.stringify(data)}`;
      },
      toString() {
        return `rendered ${id}`;
      },
      cacheKey() {
        return `${id}:v${version}:${JSON.stringify(data)}`;
      },
    });
    const first = await renderElementsParallel(
      [make("a", 1, { x: 1 }), make("b", 1, { x: 2 })],
      cache,
    );
    expect(first.renderedCount).toBe(2);
    expect(first.skippedCount).toBe(0);
    const second = await renderElementsParallel(
      [make("a", 1, { x: 1 }), make("b", 2, { x: 3 })],
      cache,
    );
    expect(second.skippedCount).toBe(1);
    expect(second.renderedCount).toBe(1);
    expect(renders).toBe(3);
    expect(second.rendered.find((r) => r.id === "a").cached).toBe(true);
  });
});
