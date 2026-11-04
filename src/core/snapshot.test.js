// Tests for the simulate agent: snapshot capture, deep copy,
// round-trip through storage, replay honesty labels, and
// not-captured labelling. Run with: bun test src/core/snapshot.test.js
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSnapshot,
  honestyLabel,
  notCapturedLabels,
  snapshotTwin,
  toolsVersion,
} from "./snapshot.js";
import {
  captureFromDesk,
  listSnapshots,
  loadSnapshot,
  saveSnapshot,
} from "./snapshot-store.js";

function twoStepSnapshot() {
  return createSnapshot({
    id: "snap-test",
    at: "2026-11-03T21:30:00.000Z",
    deskTwin: {
      model: "test-model",
      provider: "test",
      endpoint: "http://localhost:1234",
      status: "ready",
      inferenceCount: 2,
    },
    messages: [
      { role: "user", content: "Open the plan." },
      { role: "assistant", content: "Opened." },
    ],
    steps: [
      {
        thought: "Plan first, then open.",
        calls: [
          {
            id: "call-1",
            name: "files.open",
            inputs: "src/core/tool.js",
            result: "Opened, 120 lines.",
            expectation: "live-state",
          },
        ],
        context: {
          soulVersion: "soul:public",
          toolsVersion: "tools-v1",
          artifactState: {
            open: ["src/core/tool.js"],
            focus: "src/core/tool.js",
            modified: [],
          },
        },
        activity: "tool",
        counts: { llm: 1, tool: 1, ok: 0, err: 0 },
      },
      {
        thought: null,
        calls: [],
        context: {
          soulVersion: "soul:public",
          toolsVersion: "tools-v1",
          artifactState: {
            open: ["src/core/tool.js"],
            focus: "src/core/tool.js",
            modified: ["src/core/tool.js"],
          },
        },
        activity: "waiting",
        counts: { llm: 1, tool: 1, ok: 0, err: 0 },
      },
    ],
  });
}

describe("snapshot capture", () => {
  test("deep copy: later live changes do not rewrite a snapshot", () => {
    const live = {
      deskTwin: { model: "m", provider: "p", endpoint: "", status: "ready" },
      messages: [{ role: "user", content: "hi" }],
      steps: [
        {
          thought: "t",
          calls: [],
          context: {
            artifactState: { open: ["a.js"], focus: null, modified: [] },
          },
          activity: "llm",
        },
      ],
    };
    const snap = createSnapshot(live);
    live.messages[0].content = "changed";
    live.steps[0].context.artifactState.open.push("b.js");
    live.steps[0].thought = "changed";
    expect(snap.messages[0].content).toBe("hi");
    expect(snap.steps[0].context.artifactState.open).toEqual(["a.js"]);
    expect(snap.steps[0].thought).toBe("t");
  });

  test("thought stays null when no thought field was recorded", () => {
    const snap = createSnapshot({
      messages: [{ role: "assistant", content: "plain reply" }],
    });
    expect(snap.steps).toHaveLength(1);
    expect(snap.steps[0].thought).toBeNull();
    expect(snap.steps[0].calls).toEqual([]);
  });

  test("terminal stream and model state are always not captured", () => {
    const snap = twoStepSnapshot();
    for (const step of snap.steps) {
      expect(step.context.terminalStream).toBe("not captured");
      expect(step.context.modelInternalState).toBe("not captured");
    }
  });

  test("tools version changes when the registry changes", () => {
    const before = toolsVersion([
      { name: "files.open", expectation: "live-state" },
    ]);
    const after = toolsVersion([
      { name: "files.open", expectation: "live-state" },
      { name: "files.edit", expectation: "immediate" },
    ]);
    expect(before).not.toBe(after);
  });

  test("snapshot twin leaks no keys or paths", () => {
    const twin = snapshotTwin(twoStepSnapshot());
    expect(JSON.stringify(twin)).not.toContain("apiKey");
    expect(JSON.stringify(twin)).not.toContain("src/core/tool.js");
    expect(twin.messageCount).toBe(2);
    expect(twin.stepCount).toBe(2);
  });

  test("bad snapshot ids are refused (no path traversal)", () => {
    expect(() => createSnapshot({ id: "../escape" })).toThrow();
    expect(() => createSnapshot({ id: "a/b" })).toThrow();
  });
});

describe("replay honesty", () => {
  test("step 1 shows later-change label, last step shows context at this step", () => {
    const snap = twoStepSnapshot();
    expect(honestyLabel(snap, 0)).toContain("later call");
    expect(honestyLabel(snap, 1)).toBe("Context at this step");
  });

  test("identical artifact state in all steps means context at this step", () => {
    const snap = createSnapshot({
      steps: [
        { activity: "llm", context: { artifactState: { open: [], focus: null, modified: [] } } },
        { activity: "llm", context: { artifactState: { open: [], focus: null, modified: [] } } },
      ],
    });
    expect(honestyLabel(snap, 0)).toBe("Context at this step");
  });

  test("not-captured labels name thinking, stream, and model state", () => {
    const snap = twoStepSnapshot();
    const labels = notCapturedLabels(snap.steps[1]);
    expect(labels.join(" ")).toContain("Thinking: not captured");
    expect(labels.join(" ")).toContain("Terminal stream: not captured");
    expect(labels.join(" ")).toContain("Model internal state: not captured");
    // Step 1 has a thought, so it is not labelled missing thinking.
    expect(notCapturedLabels(snap.steps[0]).join(" ")).not.toContain(
      "Thinking: not captured",
    );
  });
});

describe("snapshot storage round-trip", () => {
  test("save, list, and load return the same snapshot, and replay writes nothing else", () => {
    const dir = mkdtempSync(join(tmpdir(), "askk-snap-"));
    try {
      const snap = twoStepSnapshot();
      const saved = saveSnapshot(dir, snap, "default");
      expect(saved.id).toBe("snap-test");
      const listed = listSnapshots(dir, "default");
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe("snap-test");
      const loaded = loadSnapshot(dir, "snap-test", "default");
      expect(loaded).toEqual(saved);
      // Only snapshot files were written: no state.md/history.md.
      const agentDir = join(dir, "memory", "agent", "default");
      expect(() => readFileSync(join(agentDir, "state.md"))).toThrow();
      expect(() => readFileSync(join(agentDir, "history.md"))).toThrow();
      // Mutating the loaded copy does not rewrite the stored file.
      loaded.steps[0].thought = "rewritten";
      expect(loadSnapshot(dir, "snap-test", "default").steps[0].thought).toBe(
        "Plan first, then open.",
      );
      expect(loadSnapshot(dir, "no-such-snap", "default")).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("captureFromDesk derives twin, versions, and artifact state from the desk", () => {
    const desk = {
      defaultInference: {
        model: "desk-model",
        provider: "desk-provider",
        endpoint: "http://localhost:9",
      },
      inferences: [{ id: "one" }],
      engine: { model: "desk-model", metadata: { source: "personal" } },
      listTools: () => [{ name: "files.open", expectation: "live-state" }],
      liveArtifact: {
        twin: () => ({
          open: ["a.js"],
          focus: { path: "a.js" },
          modified: [{ path: "b.js", op: "write" }],
        }),
      },
    };
    const snap = captureFromDesk(desk, {
      messages: [{ role: "user", content: "hi" }],
    });
    expect(snap.deskTwin.model).toBe("desk-model");
    expect(snap.deskTwin.provider).toBe("desk-provider");
    expect(snap.deskTwin.status).toBe("ready");
    expect(snap.contextless).toBeUndefined();
    expect(snap.steps[0].context.soulVersion).toBe("soul:personal");
    expect(snap.steps[0].context.toolsVersion).toMatch(/^tools-v[0-9a-f]+$/);
    expect(snap.steps[0].context.artifactState.open).toEqual(["a.js"]);
    expect(snap.steps[0].context.artifactState.modified).toEqual(["b.js"]);
    // No keys leak through the desk twin.
    expect(JSON.stringify(snap)).not.toContain("apiKey");
  });
});
