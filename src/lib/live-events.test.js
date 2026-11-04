// Tests for the live-event bus mapping: event -> face/glow/status.
// The bus itself is an EventTarget in the browser; in Bun the same
// mapping and emit/subscribe contract are exercised directly.
import { describe, expect, test } from "bun:test";
import {
  emitLiveEvent,
  LIVE_EVENT_TYPES,
  mapEventToState,
  subscribeLiveEvent,
} from "./live-events.js";

describe("mapEventToState", () => {
  test("every event maps to the shared colour system, no new colour", () => {
    const expected = {
      "llm:start": { phase: "llm", face: "llm", glow: "sky" },
      "llm:end": { phase: "idle", face: "idle", glow: "grey" },
      "llm:error": { phase: "error", face: "error", glow: "red" },
      "artifact:open": { phase: "tool", face: "tool", glow: "violet" },
      "artifact:expand": { phase: "tool", face: "tool", glow: "violet" },
      "run:success": { phase: "success", face: "success", glow: "emerald" },
      "run:error": { phase: "error", face: "error", glow: "red" },
      "run:waiting": { phase: "waiting", face: "waiting", glow: "amber" },
      "run:idle": { phase: "idle", face: "idle", glow: "grey" },
    };
    expect(LIVE_EVENT_TYPES).toHaveLength(9);
    for (const [type, want] of Object.entries(expected)) {
      const got = mapEventToState(type);
      expect(got.phase).toBe(want.phase);
      expect(got.face).toBe(want.face);
      expect(got.glow).toBe(want.glow);
      expect(typeof got.status).toBe("string");
      expect(got.status.length).toBeGreaterThan(0);
    }
    expect(() => mapEventToState("nope")).toThrow("unknown live event");
  });

  test("emit delivers detail to subscribers, unsubscribe stops it", () => {
    const seen = [];
    const off = subscribeLiveEvent("llm:start", (detail) => seen.push(detail));
    emitLiveEvent("llm:start", { detail: "hello" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ detail: "hello" });
    off();
    emitLiveEvent("llm:start", { detail: "again" });
    expect(seen).toHaveLength(1);
    expect(() => emitLiveEvent("nope")).toThrow("unknown live event");
  });

  test("a run progresses llm -> tool -> error -> waiting -> success -> idle", () => {
    const phases = [];
    const off = subscribeLiveEvent("llm:start", () =>
      phases.push(mapEventToState("llm:start").phase),
    );
    emitLiveEvent("llm:start", {});
    off();
    expect(phases).toEqual(["llm"]);
    expect(mapEventToState("artifact:open").phase).toBe("tool");
    expect(mapEventToState("run:error").phase).toBe("error");
    expect(mapEventToState("run:waiting").phase).toBe("waiting");
    expect(mapEventToState("run:success").phase).toBe("success");
    expect(mapEventToState("run:idle").phase).toBe("idle");
  });
});
