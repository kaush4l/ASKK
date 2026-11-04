import { describe, expect, test } from "bun:test";
import { createGuidanceChannel, runLoop } from "./loop.js";
import { Tool } from "./tool.js";

describe("owner guidance channel: seen once at the next step", () => {
  test("guide/take/peek: held once, consumed once, never repeated", () => {
    const channel = createGuidanceChannel();
    expect(channel.peek()).toBeNull();
    expect(channel.take()).toBeNull();
    channel.guide("steer left");
    expect(channel.peek()).toBe("steer left");
    expect(channel.take()).toBe("steer left");
    expect(channel.peek()).toBeNull();
    expect(channel.take()).toBeNull();
    expect(() => channel.guide("  ")).toThrow(/guidance text/);
  });

  test("guidance sent mid-run is read exactly once at the next step", async () => {
    const channel = createGuidanceChannel();
    const seenPerCall = [];
    let calls = 0;
    const inference = {
      infer: async (messages) => {
        calls += 1;
        seenPerCall.push(
          messages.map((m) => String(m.content ?? "")).join("\n"),
        );
        if (calls === 1) {
          // Mid-run guidance: sent DURING step 1, so it must be
          // seen at step 2, not step 1, and never again.
          channel.guide("prefer approach B");
          return 'call: files.read {"path":"feature.txt"}';
        }
        return "answer: done with approach B";
      },
    };
    const tools = [
      new Tool({
        name: "files.read",
        description: "read a file",
        input: { path: "the file" },
        expectation: "immediate",
        run: async () => "file content",
      }),
    ];
    const result = await runLoop({
      registry: tools,
      inference,
      prompt: "Engine prompt.",
      guidance: channel,
    });
    expect(result.answer).toContain("done with approach B");
    // Step 1 did not see the guidance (it was sent during step 1).
    expect(seenPerCall[0]).not.toContain("prefer approach B");
    // Step 2 saw it exactly once.
    expect(seenPerCall[1]).toContain("prefer approach B");
    const occurrences = seenPerCall[1].split("prefer approach B").length - 1;
    expect(occurrences).toBe(1);
    // Recorded once in loop history, consumed afterwards.
    expect(
      result.history.filter((entry) => entry.includes("prefer approach B")),
    ).toHaveLength(1);
    expect(channel.peek()).toBeNull();
  });
});
