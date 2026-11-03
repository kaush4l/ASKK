// Tests for live activity: the old phases and their human text,
// and the engine tone dots. Tool / tools / waiting are defined
// here but never fire in this skeleton (no tools yet) — these
// tests cover their text, not a fake tool call.
import { describe, expect, test } from "bun:test";
import { describeActivity, engineTone } from "./activity.js";

describe("describeActivity", () => {
  test("idle is Idle (no working)", () => {
    expect(describeActivity({ phase: "idle" })).toBe("Idle");
    expect(describeActivity(undefined)).toBe("Idle");
  });
  test("llm with and without a step number", () => {
    expect(describeActivity({ phase: "llm" })).toBe("Calling LLM…");
    expect(describeActivity({ phase: "llm", n: 2 })).toBe(
      "Calling LLM… (step 2)",
    );
  });
  test("tool, tools, waiting", () => {
    expect(describeActivity({ phase: "tool", name: "files.read" })).toBe(
      "Calling tool files.read…",
    );
    expect(describeActivity({ phase: "tools", names: ["a", "b"] })).toBe(
      "Running 2 calls in parallel: a, b…",
    );
    expect(describeActivity({ phase: "waiting", names: ["lead"] })).toBe(
      "Waiting for lead",
    );
  });
  test("connecting, no-model, error", () => {
    expect(describeActivity({ phase: "connecting" })).toBe("Connecting…");
    expect(describeActivity({ phase: "no-model" })).toBe("No model configured");
    expect(describeActivity({ phase: "error", error: "boom" })).toBe(
      "Error: boom",
    );
  });
});

describe("engineTone", () => {
  test("dots match the old UI: idle grey, running emerald pulse, waiting amber, error red", () => {
    expect(engineTone({ phase: "idle" }).dot).toBe("bg-muted-foreground/40");
    expect(engineTone({ phase: "llm" }).dot).toBe(
      "bg-emerald-500 animate-pulse",
    );
    expect(engineTone({ phase: "tool", name: "x" }).dot).toBe(
      "bg-emerald-500 animate-pulse",
    );
    expect(engineTone({ phase: "waiting", names: ["x"] }).dot).toBe(
      "bg-amber-500",
    );
    expect(engineTone({ phase: "error", error: "boom" }).dot).toBe(
      "bg-destructive",
    );
    expect(engineTone(null).tone).toBe("starting");
  });
  test("accepts a state wrapper with activity", () => {
    expect(engineTone({ activity: { phase: "llm" } }).word).toBe(
      "Calling LLM…",
    );
  });
});
