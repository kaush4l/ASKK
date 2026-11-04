import { describe, expect, test } from "bun:test";
import { createLiveState } from "./live-state.js";
import { computed, createSignal, subscribeToLiveState } from "./signals.js";

describe("signals: stable reference, notify on change only", () => {
  test("subscribe -> change -> notified; same value -> not; unsubscribe -> not", () => {
    const signal = createSignal("idle");
    const seen = [];
    const off = signal.subscribe((value) => seen.push(value));
    signal.set("working");
    expect(seen).toEqual(["working"]);
    signal.set("working");
    expect(seen).toEqual(["working"]);
    signal.set((prev) => `${prev}!`);
    expect(seen).toEqual(["working", "working!"]);
    off();
    signal.set("done");
    expect(seen).toEqual(["working", "working!"]);
    expect(signal.get()).toBe("done");
    expect(signal.peek()).toBe("done");
  });

  test("computed recomputes only when a dependency changes", () => {
    const base = createSignal(2);
    const other = createSignal(10);
    const doubled = computed(() => base.get() * 2, [base]);
    expect(doubled.get()).toBe(4);
    other.set(20);
    expect(doubled.get()).toBe(4);
    base.set(3);
    expect(doubled.get()).toBe(6);
    doubled.dispose();
    base.set(4);
    expect(doubled.get()).toBe(6);
  });

  test("subscribeToLiveState: live mutation -> signal fires with new snapshot", () => {
    const live = createLiveState({ location: "signals-test", id: "main" });
    const signal = subscribeToLiveState(live);
    const seen = [];
    signal.subscribe((value) => seen.push(value.activity));
    live.setActivity("llm");
    // setActivity does not emit, so the adapter alone does not
    // fire — the engine object syncs on its own methods (see
    // engine-object.test.js). An emitting change does fire:
    live.emit("tool:start", { id: "call-1", name: "files.read" });
    expect(seen).toContain("llm");
    expect(signal.get().events.at(-1).type).toBe("tool:start");
  });
});
