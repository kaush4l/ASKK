import { describe, expect, test } from "bun:test";
import { formatReply } from "./toon.js";
import {
  StructuredResponse,
  createResponseMethod,
  toonResponseMethod,
} from "./response.js";

describe("structured response base", () => {
  test("a dummy method added by configuration only generates in key order", () => {
    const method = createResponseMethod({
      id: "dummy",
      keys: [
        { key: "alpha", description: "first field" },
        { key: "beta", description: "second field" },
        { key: "gamma", description: "third field" },
      ],
    });
    // Values given out of order still render in configuration order.
    const out = method.generate({ gamma: "g", alpha: "a", beta: "b" });
    expect(out).toBe("alpha: a\nbeta: b\ngamma: g");
    expect(method.keyNames()).toEqual(["alpha", "beta", "gamma"]);
    expect(method.describe()).toContain("alpha: first field");
    expect(method.describe()).toContain("gamma: third field");
    // No engine change was needed: the method is only this object.
    expect(method).toBeInstanceOf(StructuredResponse);
  });

  test("parse reads configured keys back, multi-line values stay whole", () => {
    const method = createResponseMethod({
      id: "dummy",
      keys: [
        { key: "alpha", description: "first field" },
        { key: "beta", description: "second field" },
      ],
    });
    const parsed = method.parse("alpha: one\nline two\nbeta: three");
    expect(parsed).toEqual({ alpha: "one\nline two", beta: "three" });
  });

  test("configuration errors throw plainly", () => {
    expect(() => createResponseMethod({ id: "x", keys: [] })).toThrow(/at least one key/);
    expect(() =>
      createResponseMethod({ id: "x", keys: [{ key: "a", description: "" }] }),
    ).toThrow(/needs a description/);
    expect(() =>
      createResponseMethod({
        id: "x",
        keys: [
          { key: "a", description: "one" },
          { key: "a", description: "two" },
        ],
      }),
    ).toThrow(/two keys named "a"/);
  });

  test("toon is a configuration of the base, delegating to toon.js, not a copy", () => {
    const method = toonResponseMethod();
    expect(method.keyNames()).toEqual(["thought", "call", "answer"]);
    const values = {
      thought: "thinking",
      calls: [{ name: "tool-a", input: { x: 1 } }],
      answer: "done",
    };
    expect(method.generate(values)).toBe(formatReply(values));
    expect(method.parse(method.generate(values)).calls).toEqual(values.calls);
  });
});
