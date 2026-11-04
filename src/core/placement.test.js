import { describe, expect, test } from "bun:test";
import {
  laneCovers,
  mergePlacement,
  placeCreatedItem,
  validateLanesSubset,
  validateScript,
  validateSpawn,
  validateToolsSubset,
} from "./placement.js";

describe("runtime placement", () => {
  test("shared first, agent-specific wins, no duplicates", () => {
    const merged = mergePlacement(
      [{ name: "build", scope: "shared" }, { name: "test" }],
      [{ name: "build", scope: "agent" }],
    );
    expect(merged.map((m) => m.name)).toEqual(["build", "test"]);
    expect(merged.find((m) => m.name === "build").scope).toBe("agent");
  });

  test("tools subset and lanes narrowed, soul immutable", () => {
    const caller = {
      name: "desk",
      tools: ["files.read"],
      writes: ["projects/**"],
      model: "m",
      maxSteps: 10,
    };
    expect(() => validateToolsSubset(["terminal.run"], caller.tools)).toThrow();
    expect(() => validateLanesSubset(["other/**"], caller.writes)).toThrow();
    expect(laneCovers("projects/**", "projects/a/b")).toBe(true);
    expect(() =>
      validateSpawn({ name: "helper", goal: "do", soul: "New soul." }, caller),
    ).toThrow(/immutable/);
    const spawn = validateSpawn(
      {
        name: "helper",
        goal: "do it",
        tools: ["files.read"],
        writes: ["projects/a/**"],
        keep: "desk",
      },
      caller,
    );
    expect(spawn.agentFile).toBe("memory/helper.agent.md");
    expect(spawn.memoryDir).toBe("memory/agent/helper");
    expect(spawn.keep).toBe("desk");
  });

  test("created items go to shared only if explicitly chosen, else agent folder", () => {
    expect(
      placeCreatedItem({
        agent: "developer",
        shared: false,
        name: "test-all",
        kind: "script",
      }),
    ).toBe("memory/scripts/developer/test-all.script.md");
    expect(
      placeCreatedItem({
        agent: "developer",
        shared: true,
        name: "build",
        kind: "watcher",
      }),
    ).toBe("memory/watchers/shared/build.watcher.md");
  });

  test("notify and shortcut script standards validated separately", () => {
    expect(() => validateScript({ kind: "notify" })).toThrow(/watch/);
    expect(() => validateScript({ kind: "shortcut", commands: [] })).toThrow();
    expect(
      validateScript({ kind: "notify", watch: "build", notify: "feed" }).kind,
    ).toBe("notify");
    expect(
      validateScript({ kind: "shortcut", commands: ["bun test"] }).kind,
    ).toBe("shortcut");
  });
});
