import { describe, expect, test } from "bun:test";
import { createAgent, Tool } from "./engine.js";

// A fake model: first reply calls the echo tool, second reply answers.
function cannedReplies(replies) {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)];
}

describe("core agent loop", () => {
  test("calls a tool, then answers from its result", async () => {
    const seen = [];
    const agent = createAgent(
      { name: "echo-agent", role: "Echo what the tool returns." },
      {
        infer: cannedReplies([
          JSON.stringify({
            thought: "call the tool",
            calls: [{ tool: "echo", input: { text: "hello" } }],
            answer: null,
          }),
          JSON.stringify({ thought: "done", calls: [], answer: "hello" }),
        ]),
        tools: [
          new Tool({
            name: "echo",
            description: "Return the input text.",
            input: { text: "the text to return" },
            run: (input) => input.text,
          }),
        ],
      },
    );
    agent.on("step", (event) => seen.push(event));
    const answer = await agent.ask("say hello");
    expect(answer).toBe("hello");
    expect(agent.history).toHaveLength(1);
    expect(seen).toHaveLength(2);
    expect(seen[0].calls[0].tool).toBe("echo");
  });

  test("an unknown tool becomes an error result, not a crash", async () => {
    const agent = createAgent(
      { name: "lost-agent" },
      {
        infer: cannedReplies([
          JSON.stringify({
            thought: "call a missing tool",
            calls: [{ tool: "nope", input: {} }],
            answer: null,
          }),
          JSON.stringify({
            thought: "giving up",
            calls: [],
            answer: "no tool",
          }),
        ]),
      },
    );
    const answer = await agent.ask("do the missing thing");
    expect(answer).toBe("no tool");
  });

  test("an artifact gate refuses an answer once, then it goes through", async () => {
    let refused = false;
    const agent = createAgent(
      { name: "gated-agent" },
      {
        infer: cannedReplies([
          JSON.stringify({ thought: "answer", calls: [], answer: "final" }),
          JSON.stringify({
            thought: "answer again",
            calls: [],
            answer: "final",
          }),
        ]),
        artifacts: [
          {
            id: "checklist",
            render: () => "checklist: one item open",
            gate: () => {
              if (!refused) {
                refused = true;
                return "checklist has an open item";
              }
              return null;
            },
          },
        ],
      },
    );
    const answer = await agent.ask("finish");
    expect(answer).toBe("final");
    expect(refused).toBe(true);
  });
});
