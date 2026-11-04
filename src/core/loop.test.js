import { describe, expect, test } from "bun:test";
import { createStopSignal, runLoop } from "./loop.js";
import { Tool } from "./tool.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mockModel(replies) {
  let i = 0;
  return {
    infer: async () => replies[Math.min(i++, replies.length - 1)],
  };
}

describe("loop: parallel stages, dependencies, stop, compaction, checks gate", () => {
  test("two independent calls in one stage run in parallel (overlapping timestamps)", async () => {
    const intervals = {};
    const tools = [
      new Tool({
        name: "slow.a",
        description: "a",
        input: {},
        run: async () => {
          intervals.a = { start: Date.now() };
          await sleep(40);
          intervals.a.end = Date.now();
          return "a-done";
        },
      }),
      new Tool({
        name: "slow.b",
        description: "b",
        input: {},
        run: async () => {
          intervals.b = { start: Date.now() };
          await sleep(40);
          intervals.b.end = Date.now();
          return "b-done";
        },
      }),
    ];
    const result = await runLoop({
      registry: tools,
      inference: mockModel(["call: slow.a {}\ncall: slow.b {}", "both done"]),
      prompt: "test",
    });
    expect(result.answer).toBe("both done");
    // Parallel proof: the second call started before the first ended.
    expect(intervals.b.start).toBeLessThan(intervals.a.end);
    expect(intervals.a.start).toBeLessThan(intervals.b.end);
  });

  test("a call depending on another call in the same stage waits for it", async () => {
    const order = [];
    const tools = [
      new Tool({
        name: "first",
        description: "first",
        input: {},
        run: async () => {
          order.push("first");
          return "FIRST-VALUE";
        },
      }),
      new Tool({
        name: "second",
        description: "second",
        input: {},
        run: async (input) => {
          order.push(`second:${input?.value}`);
          return "second-done";
        },
      }),
    ];
    const result = await runLoop({
      registry: tools,
      inference: mockModel([
        'call: first {}\ncall: second {"value":"$result.first"}',
        "all done",
      ]),
      prompt: "test",
    });
    expect(order[0]).toBe("first");
    expect(order[1]).toBe("second:FIRST-VALUE");
    expect(result.answer).toBe("all done");
  });

  test("stop() halts at the next step boundary", async () => {
    const signal = createStopSignal();
    const tools = [
      new Tool({
        name: "step.tool",
        description: "step",
        input: {},
        run: async () => {
          signal.stop();
          return "ok";
        },
      }),
    ];
    const result = await runLoop({
      registry: tools,
      inference: mockModel(["call: step.tool {}", "never reached"]),
      prompt: "test",
      signal,
    });
    expect(result.stopped).toBe(true);
    expect(result.answer).toBeNull();
  });

  test("compaction at 90% ctx folds older steps, keeps last 2, records it", async () => {
    const tools = [
      new Tool({
        name: "noop",
        description: "noop",
        input: {},
        run: async () => "ok",
      }),
    ];
    // Each tool turn adds a long message; ctx is tiny so the
    // threshold trips quickly. The model keeps calling, then answers.
    const replies = Array.from({ length: 6 }, () => "call: noop {}");
    replies.push("final answer");
    const result = await runLoop({
      registry: tools,
      inference: mockModel(replies),
      prompt: "x".repeat(50),
      ctxLength: 100,
    });
    expect(result.compactions).toBeGreaterThan(0);
    expect(
      result.history.some((entry) => entry.startsWith("compaction:")),
    ).toBe(true);
    expect(result.answer).toBe("final answer");
  });

  test("checks gate: modified files with no passing test run refuse the final answer", async () => {
    const tools = [
      new Tool({
        name: "files.edit",
        description: "edit",
        input: {},
        run: async () => ({ replaced: 1 }),
      }),
    ];
    const result = await runLoop({
      registry: tools,
      inference: mockModel(['call: files.edit {"path":"a.txt"}', "ship it"]),
      prompt: "test",
      requireChecks: true,
    });
    expect(result.refused).toBe(true);
    expect(result.answer).toBeNull();
    expect(result.failedCheck.modified).toContain("a.txt");
  });

  test("checks gate passes when a test terminal.run succeeds in the same run", async () => {
    const tools = [
      new Tool({
        name: "files.edit",
        description: "edit",
        input: {},
        run: async () => ({ replaced: 1 }),
      }),
      new Tool({
        name: "terminal.run",
        description: "run",
        input: {},
        run: async () => ({ exit: 0, output: "ok" }),
      }),
    ];
    const result = await runLoop({
      registry: tools,
      inference: mockModel([
        'call: files.edit {"path":"a.txt"}',
        'call: terminal.run {"command":"bun test src/core"}',
        "ship it",
      ]),
      prompt: "test",
      requireChecks: true,
    });
    expect(result.refused).toBe(false);
    expect(result.answer).toBe("ship it");
  });

  test("maxSteps 12 default: a model that never answers stops, it does not loop forever", async () => {
    const tools = [
      new Tool({
        name: "noop",
        description: "noop",
        input: {},
        run: async () => "ok",
      }),
    ];
    const result = await runLoop({
      registry: tools,
      inference: mockModel(["call: noop {}"]),
      prompt: "test",
    });
    expect(result.steps).toBe(12);
    expect(result.maxStepsReached).toBe(true);
  });
});
