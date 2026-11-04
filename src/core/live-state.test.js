import { describe, expect, test } from "bun:test";
import { clearLiveStates, createLiveState } from "./live-state.js";

describe("one single live state", () => {
  test("singleton per location+id, different id is a different object", () => {
    clearLiveStates();
    const a = createLiveState({ location: "desk-a", id: "main" });
    const b = createLiveState({ location: "desk-a", id: "main" });
    const c = createLiveState({ location: "desk-a", id: "other" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    a.setActivity("working");
    expect(b.activity).toBe("working");
    expect(c.activity).toBe("idle");
  });

  test("snapshot is a deep copy of the exact object shape; later changes do not rewrite it", () => {
    clearLiveStates();
    const live = createLiveState({ location: "desk-b", id: "main" });
    live.setAgent("developer", { name: "developer", status: "running" });
    live.addCall({ id: "call-1", name: "files.read", status: "running" });
    const snap = live.snapshot();
    expect(snap.agents.developer.status).toBe("running");
    expect(snap.calls).toHaveLength(1);
    live.updateCall("call-1", { status: "done" });
    expect(snap.calls[0].status).toBe("running");
    expect(live.snapshot().calls[0].status).toBe("done");
  });

  test("events: goal:phase and agent:spawn emit and subscribe; unknown type refused", () => {
    clearLiveStates();
    const live = createLiveState({ location: "desk-c", id: "main" });
    const seen = [];
    live.subscribe("agent:spawn", (detail) => seen.push(detail.agent));
    live.emit("agent:spawn", { agent: "developer" });
    live.recordPhaseTransition({ goal: "goal", from: "plan", to: "execute" });
    expect(seen).toEqual(["developer"]);
    expect(live.phaseTransitions).toHaveLength(1);
    expect(() => live.emit("nope", {})).toThrow(/unknown live event/);
  });
});
