import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderPrompt } from "./elements.js";
import {
  askEngine,
  createEngineObject,
  getEngineObject,
} from "./engine-object.js";
import { getServerDesk } from "./server-desk.js";
import { agentCardData, liveStatusData } from "./ui-data.js";

// A desk-like object, not a real createDesk() result, so these
// tests never touch the repo's personal/ folder or network.
function fakeDesk(location) {
  const toolSpecs = [
    {
      name: "files.read",
      description: "read a file",
      input: { path: "the file" },
      expectation: "immediate",
    },
    {
      name: "files.edit",
      description: "edit a file",
      input: { path: "the file", old: "old", new: "new" },
      expectation: "done",
    },
    {
      name: "terminal.run",
      description: "run a command",
      input: { command: "the command" },
      expectation: "done",
    },
  ];
  return {
    location,
    soul: "Engine soul.",
    engine: { instructions: "YOU ARE the engine.", inference: null },
    tools: toolSpecs.map((spec) => ({ ...spec, spec: () => spec })),
    listTools: () => toolSpecs,
    artifacts: [],
    agent: { name: "default", id: "default" },
    defaultInference: null,
    inferences: [],
  };
}

function tempDeskDir() {
  const dir = mkdtempSync(join(tmpdir(), "askk-engine-"));
  mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(dir, "memory", "soul.md"), "Temp soul.", "utf8");
  writeFileSync(join(dir, "instructions.md"), "Temp instructions.", "utf8");
  return dir;
}

describe("engine object: one live object per location", () => {
  test("two getEngineObject calls return the SAME reference, mutation visible in both", () => {
    const dir = tempDeskDir();
    const first = getEngineObject(dir);
    const second = getEngineObject(dir);
    expect(second).toBe(first);
    expect(second.state).toBe(first.state);
    // server-desk.js is a redirect, not a second singleton.
    expect(getServerDesk(dir)).toBe(first);
    first.setAgent("developer", {
      name: "developer",
      status: "running",
      currentPhase: "execute",
    });
    expect(second.snapshot().agents.developer.status).toBe("running");
    expect(second.snapshot().agents.developer.currentPhase).toBe("execute");
  });

  test("createEngineObject holds agent, state, elements, tools, artifacts, goal, history, skills", () => {
    const engine = createEngineObject(fakeDesk("engine-shape"));
    expect(engine.agent.name).toBe("default");
    expect(engine.state).toBe(engine.live);
    expect(engine.elementsList().map((el) => el.id)).toContain("tools");
    expect(engine.tools.map((t) => t.name)).toEqual([
      "files.read",
      "files.edit",
      "terminal.run",
    ]);
    expect(engine.artifacts).toEqual([]);
    expect(engine.goal).toBeNull();
    expect(engine.history).toBe(engine.state.history);
    expect(engine.skills).toEqual([]);
    expect(engine.templateOrder()[0]).toBe("soul");
  });
});

describe("engine signal: mutate state -> signal fires -> UI data shows exactly the new state", () => {
  test("engine methods fire the signal; identical snapshot does not re-notify", () => {
    const engine = createEngineObject(fakeDesk("engine-signal"));
    const seen = [];
    const off = engine.subscribe((snapshot) => seen.push(snapshot));
    engine.setActivity("llm");
    expect(seen.at(-1).activity).toBe("llm");
    engine.mutate((state) => {
      state.activity = "idle";
    });
    expect(seen.at(-1).activity).toBe("idle");
    const count = seen.length;
    engine.signal.set(engine.snapshot());
    expect(seen.length).toBe(count);
    off();
    engine.setActivity("llm");
    expect(seen.length).toBe(count);
  });

  test("UI data from engine.state shows a mutation with no refetch or sync step", () => {
    const engine = createEngineObject(fakeDesk("engine-ui"));
    engine.setAgent("developer", {
      name: "developer",
      status: "running",
      currentPhase: "execute",
    });
    engine.addCall({
      id: "call-1",
      name: "files.edit",
      status: "running",
      parallelGroup: "stage-1",
      partial: true,
    });
    engine.addCall({
      id: "call-2",
      name: "files.read",
      status: "failed",
      parallelGroup: "stage-1",
    });
    // No sync step here: the card/status data functions read
    // engine.state directly, so they show exactly the new state.
    const card = agentCardData(engine.state.snapshot());
    const callsSection = card.sections.find((s) => s.kind === "calls");
    expect(callsSection.groups[0].calls.map((c) => c.id)).toEqual([
      "call-1",
      "call-2",
    ]);
    expect(
      callsSection.groups[0].calls.find((c) => c.id === "call-2").status,
    ).toBe("failed");
    const status = liveStatusData(engine.state.snapshot());
    expect(status.running).toBe(true);
    expect(status.word).toBe("tool call");
    expect(status.currentStep).toBe("files.edit");
    expect(status.steps.find((s) => s.id === "call-1").partial).toBe(true);
  });
});

describe("prompt from the engine object: the 'what tools do you have' bug", () => {
  test("captured prompt equals renderPrompt(engine.elements) and contains the engine's tools", async () => {
    const engine = createEngineObject(fakeDesk("engine-prompt"));
    const captured = [];
    const inference = {
      infer: async (messages) => {
        captured.push(messages);
        const prompt = messages.map((m) => String(m.content ?? "")).join("\n");
        // The mocked model answers FROM the prompt it received:
        // only if the prompt lists real tools does it name them.
        if (prompt.includes("files.read") && prompt.includes("terminal.run")) {
          return "I have files.read, files.edit, and terminal.run connected.";
        }
        return "I don't have connected tools.";
      },
    };
    const { reply, prompt } = await askEngine(engine, {
      inference,
      messages: [{ role: "user", content: "What tools do you have?" }],
    });
    expect(prompt).toBe(renderPrompt(engine.elementsList()));
    expect(captured[0][0].role).toBe("system");
    expect(captured[0][0].content).toBe(prompt);
    expect(prompt).toContain("files.read");
    expect(prompt).toContain("terminal.run");
    expect(reply).toContain("files.read");
    expect(reply).not.toContain("don't have connected tools");
  });

  test("the old prompt shape (instructions + history only) does NOT carry the tools", async () => {
    const engine = createEngineObject(fakeDesk("engine-old-prompt"));
    const oldPrompt = `YOU ARE the engine.\n\nuser: What tools do you have?`;
    expect(oldPrompt).not.toContain("files.read");
    expect(engine.renderPrompt()).toContain("files.read");
    expect(engine.renderPrompt()).not.toBe(oldPrompt);
  });
});

describe("UI state and engine state cannot disagree (d)", () => {
  test("the UI data source IS the engine object: same reference, no independent copy", () => {
    const dir = tempDeskDir();
    const engine = getEngineObject(dir);
    const again = getEngineObject(dir);
    expect(again).toBe(engine);
    expect(again.state).toBe(engine.state);
    expect(again.signal).toBe(engine.signal);
    // A snapshot is a view, not a second live object: mutating
    // the view never moves the engine.
    const view = engine.snapshot();
    view.activity = "diverged";
    expect(engine.snapshot().activity).not.toBe("diverged");
    // And the engine is the only writer the UI reads: a mutation
    // through the engine is what the UI data shows, immediately.
    engine.setActivity("llm");
    expect(agentCardData(engine.state.snapshot()).activity).toBe("llm");
    expect(liveStatusData(engine.state.snapshot()).word).toBe("thinking");
  });
});
