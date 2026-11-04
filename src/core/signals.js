// Signals — a small, no-dependency, state-based reactivity
// system. A signal is a STABLE reference: createSignal(initial)
// returns one object, and subscribers are notified only when the
// value actually changes — never on poll, never on refresh.
//
//   const signal = createSignal(0);
//   const off = signal.subscribe((value) => ...); // off() unsubscribes
//   signal.set(1);        // subscribers called with 1
//   signal.set(1);        // same value: NOT called (Object.is)
//   signal.set((v) => v + 1); // updater form
//   signal.get(); signal.peek(); // same read, no subscription
//
// computed(compute, deps) derives a signal from other signals
// and recomputes only when a dependency changes. Equality is
// configurable: the engine object uses a JSON equality so a
// re-set with an identical snapshot does not double-notify
// (see engine-object.js).
//
// subscribeToLiveState(live) adapts a live-state object
// (live-state.js) into a signal: the signal's value is
// live.snapshot(), refreshed on every live event. UI components
// subscribe to that signal (see src/lib/use-live-state.js) and
// re-render on state change only — no polling, no full
// re-render on refresh.

import { LIVE_STATE_EVENT_TYPES } from "./live-state.js";

export function createSignal(initial, { equals = Object.is } = {}) {
  let value = initial;
  const listeners = new Set();
  const signal = {
    get: () => value,
    peek: () => value,
    set: (next) => {
      const resolved = typeof next === "function" ? next(value) : next;
      if (equals(resolved, value)) {
        return value;
      }
      value = resolved;
      for (const fn of [...listeners]) {
        fn(value);
      }
      return value;
    },
    subscribe: (fn) => {
      if (typeof fn !== "function") {
        throw new Error("signal subscribe needs a function");
      }
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return signal;
}

export function computed(compute, deps = []) {
  if (typeof compute !== "function") {
    throw new Error("computed needs a compute function");
  }
  const signal = createSignal(compute());
  const offs = (Array.isArray(deps) ? deps : []).map((dep) =>
    dep.subscribe(() => signal.set(compute())),
  );
  signal.dispose = () => {
    for (const off of offs) {
      off();
    }
  };
  return signal;
}

export function subscribeToLiveState(live) {
  if (
    !live ||
    typeof live.snapshot !== "function" ||
    typeof live.subscribe !== "function"
  ) {
    throw new Error("subscribeToLiveState needs a live-state object");
  }
  const signal = createSignal(live.snapshot(), {
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  });
  for (const type of LIVE_STATE_EVENT_TYPES) {
    live.subscribe(type, () => signal.set(live.snapshot()));
  }
  return signal;
}
