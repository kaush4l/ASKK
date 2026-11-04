import { describe, expect, test } from "bun:test";
import {
  applyProviderAction,
  defaultsFor,
  getModelDetails,
  removeProvider,
  setDefaultProvider,
  updateProvider,
} from "./providers.js";

const entry = {
  id: "local",
  kind: "api-local",
  label: "Local",
  model: "qwen",
  endpoint: "http://localhost:11434/v1",
  ctx: 32768,
  timings: { ttftMs: 120 },
  counts: { tokens: 4096 },
};

describe("models with defaults (labelled, never invented as facts)", () => {
  test("getModelDetails returns the entry's own ctx/timings/counts", () => {
    const details = getModelDetails(entry);
    expect(details.ctx).toBe(32768);
    expect(details.ctxSource).toBe("model");
    expect(details.timings).toEqual({ ttftMs: 120 });
    expect(details.counts).toEqual({ tokens: 4096 });
    expect(getModelDetails({ id: "x", model: "m" }).ctx).toBeNull();
  });

  test("defaultsFor labels its ctx default as a default, not a model fact", () => {
    const defaults = defaultsFor("some-model");
    expect(defaults.ctx).toEqual({ value: 128000, label: "default" });
  });

  test("use/edit/delete actions work purely; unknown ids are refused", () => {
    const used = applyProviderAction(
      {
        providers: [entry, { ...entry, id: "other", model: "m2" }],
        defaultId: null,
      },
      { action: "use", id: "other" },
    );
    expect(used.state.defaultId).toBe("other");
    expect(used.state.providers.find((p) => p.id === "other").isDefault).toBe(
      true,
    );
    expect(() => setDefaultProvider([entry], "missing")).toThrow();
    const edited = updateProvider([entry], "local", { label: "Renamed" });
    expect(edited[0].label).toBe("Renamed");
    expect(edited[0].id).toBe("local");
    expect(removeProvider([entry], "local")).toEqual([]);
    expect(() => removeProvider([entry], "missing")).toThrow();
    const tested = applyProviderAction(
      { providers: [entry], defaultId: null },
      { action: "test", id: "local" },
    );
    expect(tested.result.mocked).toBe(true);
    expect(tested.result.ok).toBe(true);
  });
});
