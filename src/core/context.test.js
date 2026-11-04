import { describe, expect, test } from "bun:test";
import { renderContext, selectContext } from "./context.js";

describe("context optimization", () => {
  test("implement-phase prompt contains implement tools, not review tools; others are left out, listed", () => {
    const state = {
      soul: "soul text",
      tools: [
        { name: "files.read", description: "read" },
        { name: "files.edit", description: "edit" },
        { name: "review.approve", description: "approve" },
      ],
      goal: {
        id: "goal",
        statement: "do the thing",
        status: "open",
        steps: [],
      },
      history: ["goal: started"],
    };
    const phase = {
      id: "implement",
      duty: "implement",
      allowedTools: ["files.read", "files.edit"],
    };
    const selection = selectContext(state, { phase, goal: state.goal });
    const { prompt, meter } = renderContext(selection);
    expect(prompt).toContain("files.read");
    expect(prompt).toContain("files.edit");
    expect(prompt).not.toContain("review.approve");
    expect(selection.leftOut.map((item) => item.id)).toContain(
      "review.approve",
    );
    expect(selection.leftOut.length).toBeGreaterThan(0);
  });

  test("meter segments sum exactly to the prompt length sent", () => {
    const selection = selectContext(
      {
        soul: "soul",
        tools: [{ name: "files.read", description: "read" }],
        goal: { id: "g", statement: "stmt", status: "open", steps: [] },
        history: [],
      },
      {
        phase: { id: "plan", duty: "plan", allowedTools: ["files.read"] },
        goal: { id: "g", statement: "stmt", status: "open", steps: [] },
      },
    );
    const { prompt, meter } = renderContext(selection);
    expect(meter.totalChars).toBe(prompt.length);
    expect(meter.segments.reduce((sum, seg) => sum + seg.chars, 0)).toBe(
      prompt.length,
    );
    expect(meter.segments.map((seg) => seg.id)).toContain("soul");
  });

  test("soul is always included, even with no phase", () => {
    const selection = selectContext(
      { soul: "always me", tools: [], history: [] },
      {},
    );
    const { prompt } = renderContext(selection);
    expect(prompt).toContain("always me");
  });
});
