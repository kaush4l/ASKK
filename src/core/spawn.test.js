import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgent,
  createChildrenRegistry,
  critiqueFailed,
  developerPersona,
  loadAgent,
} from "./spawn.js";

const caller = {
  name: "harness",
  tools: ["files.read", "files.edit", "terminal.run"],
  reads: ["src/**"],
  writes: ["src/**"],
};

describe("spawn: explicit subset, soul immutable, report/ask channels", () => {
  test("absent tools are refused, wider tools are refused, soul is refused", () => {
    expect(() => createAgent({ name: "dev", goal: "g" }, caller)).toThrow(
      /explicit tools subset/,
    );
    expect(() =>
      createAgent(
        { name: "dev", goal: "g", tools: ["files.read", "web.search"] },
        caller,
      ),
    ).toThrow(/not held by caller/);
    expect(() =>
      createAgent(
        { name: "dev", goal: "g", tools: ["files.read"], soul: "new soul" },
        caller,
      ),
    ).toThrow(/soul is immutable/);
    expect(() =>
      createAgent({ name: "dev", tools: ["files.read"] }, caller),
    ).toThrow(/task-level goal/);
  });

  test("report and ask are labelled separately; ask takes exactly one question", () => {
    const agent = createAgent(
      { name: "dev", goal: "g", tools: ["files.read"] },
      caller,
    );
    agent.report("finished the feature", "report");
    agent.ask("Should I use approach A?");
    expect(agent.history.map((entry) => entry.channel)).toEqual([
      "report",
      "ask",
    ]);
    expect(() => agent.ask("First? Second?")).toThrow(/exactly one/);
    expect(() => agent.report("x", "shout")).toThrow(/report.*ask/);
  });

  test("dismiss removes run agents, persists desk-kept agents as <name>.agent.md", () => {
    const registry = createChildrenRegistry();
    const run = createAgent(
      { name: "runner", goal: "g", tools: ["files.read"], keep: "run" },
      caller,
    );
    const deskDir = mkdtempSync(join(tmpdir(), "askk-spawn-"));
    const kept = createAgent(
      { name: "keeper", goal: "g", tools: ["files.read"], keep: "desk" },
      caller,
    );
    registry.add(run);
    registry.add(kept);
    expect(registry.dismiss("runner")).toMatchObject({ removed: true });
    expect(registry.get("runner")).toBeNull();
    expect(registry.dismiss("keeper", { baseDir: deskDir })).toMatchObject({
      kept: true,
    });
    const restored = loadAgent(deskDir, "keeper");
    expect(restored.keep).toBe("desk");
    expect(restored.goal).toBe("g");
  });

  test("developer internal phases: plan->execute->critique->done, critique cannot write", () => {
    const persona = developerPersona();
    expect(persona.internalPhases.map((p) => p.id)).toEqual([
      "plan",
      "execute",
      "critique",
      "done",
    ]);
    expect("phases" in persona).toBe(false);
    const critique = persona.internalPhases.find((p) => p.id === "critique");
    expect(critique.allowedTools).not.toContain("files.edit");
    expect(critique.allowedTools).not.toContain("files.write");
    expect(critiqueFailed("critique: fail — needs work")).toBe(true);
    expect(critiqueFailed("critique: pass — looks good")).toBe(false);
  });
});
