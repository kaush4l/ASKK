import { describe, expect, test } from "bun:test";
import { agentCardData, canvasData } from "./ui-data.js";

describe("no-hardcoding proof: card and canvas follow the snapshot, nothing else", () => {
  const base = {
    id: "desk",
    activity: "idle",
    agents: { developer: { name: "developer", status: "working" } },
    calls: [
      {
        id: "c1",
        name: "files.read",
        status: "done",
        parallelGroup: "stage-1",
      },
    ],
    goals: { goal: { id: "goal", statement: "do it", status: "open" } },
    tools: ["files.read"],
  };

  test("adding a tool/phase/agent to the snapshot makes it appear, with no UI-code change", () => {
    const withMore = {
      ...base,
      tools: ["files.read", "files.edit"],
      phases: [{ id: "plan", duty: "plan it", status: "active" }],
      agents: {
        developer: { name: "developer", status: "working" },
        reviewer: { name: "reviewer", status: "idle" },
      },
    };
    const card = agentCardData(withMore);
    const kinds = card.sections.map((section) => section.kind);
    expect(kinds).toContain("phases");
    expect(card.sections.find((s) => s.kind === "tools").tools).toContain(
      "files.edit",
    );
    expect(
      card.sections.find((s) => s.kind === "agents").agents.map((a) => a.name),
    ).toContain("reviewer");
    const canvas = canvasData(withMore);
    expect(canvas.nodes.map((n) => n.id)).toContain("agent:reviewer");
  });

  test("removing it removes it: no cycles panel when there are no cycles, no tools section without tools", () => {
    const minimal = { id: "desk", activity: "idle", agents: {} };
    const card = agentCardData(minimal);
    expect(card.sections).toEqual([]);
    const canvas = canvasData(minimal);
    expect(canvas.nodes).toEqual([]);
    expect(canvas.edges).toEqual([]);
  });

  test("card and canvas render from the same snapshot: same agents, same calls", () => {
    const card = agentCardData(base);
    const canvas = canvasData(base);
    expect(
      card.sections.find((s) => s.kind === "calls").groups[0].calls[0].name,
    ).toBe("files.read");
    expect(canvas.nodes.find((n) => n.kind === "tool-call").label).toBe(
      "files.read",
    );
    expect(canvas.nodes.find((n) => n.kind === "goal").label).toBe("do it");
  });

  test("parallel grouping and partial/failed calls are first-class in the card", () => {
    const snap = {
      ...base,
      calls: [
        {
          id: "c1",
          name: "files.read",
          status: "partial",
          partial: true,
          parallelGroup: "stage-1",
        },
        {
          id: "c2",
          name: "files.edit",
          status: "failed",
          parallelGroup: "stage-1",
        },
      ],
    };
    const groups = agentCardData(snap).sections.find(
      (s) => s.kind === "calls",
    ).groups;
    expect(groups).toHaveLength(1);
    expect(groups[0].calls.map((c) => c.status)).toEqual(["partial", "failed"]);
    expect(groups[0].calls[0].partial).toBe(true);
  });
});
