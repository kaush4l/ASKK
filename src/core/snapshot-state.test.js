import { describe, expect, test } from "bun:test";
import { soulElement, toolsElement, watchersElement } from "./elements.js";
import {
  createDeskSnapshotState,
  createRestartState,
} from "./snapshot-state.js";

describe("snapshot state", () => {
  test("includes watchers running, scripts, tools, artifact, phase, activity, counts, and element strings", () => {
    const els = [
      soulElement("Soul."),
      toolsElement([{ name: "files.read", description: "r", input: {} }]),
      watchersElement([{ name: "build" }]),
    ];
    const snap = createDeskSnapshotState({
      id: "snap-1",
      elements: els,
      watchersRunning: [{ name: "build" }],
      scripts: [{ name: "test-all" }],
      tools: ["files.read"],
      artifact: { open: ["a.js"], focus: "a.js" },
      phase: { id: "implement" },
      activity: "tool",
      counts: { llm: 1 },
    });
    expect(snap.elementStrings.soul).toBe("Soul.");
    expect(snap.watchersRunning).toEqual([{ name: "build" }]);
    expect(snap.scripts).toEqual([{ name: "test-all" }]);
    expect(snap.phase.id).toBe("implement");
    // Deep-copy isolation: later live changes do not rewrite the snapshot.
    els[0].data.text = "Changed.";
    expect(snap.elementStrings.soul).toBe("Soul.");
  });

  test("restart state restarts kept items only, not run-only items", () => {
    const rs = createRestartState({
      runningWatchers: [
        { name: "build", keep: "desk" },
        { name: "tmp", keep: "run" },
      ],
      runningScripts: [{ name: "test", keep: "desk" }],
      runningSubagents: [
        { name: "helper", keep: "run" },
        { name: "watcher-agent", keep: "desk" },
      ],
      phase: { id: "build" },
      artifact: { open: ["a.js"], focus: "a.js" },
    });
    expect(rs.restartList.map((r) => r.name).sort()).toEqual([
      "build",
      "test",
      "watcher-agent",
    ]);
    expect(rs.runOnlyNotRestarted).toContain("tmp");
    expect(rs.runOnlyNotRestarted).toContain("helper");
    expect(rs.artifact.open).toEqual(["a.js"]);
  });
});
