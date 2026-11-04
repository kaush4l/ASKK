// useLiveState — subscribe a component to a signal.
// The component re-renders when the signal's value changes, and
// only then: no polling, no refresh re-render. Used by the live
// status component (src/components/live-status.jsx) for the
// live-agent section of the home page.
"use client";

import { useEffect, useState } from "react";

export function useLiveState(signal, initial = null) {
  const [value, setValue] = useState(() => (signal ? signal.peek() : initial));
  useEffect(() => {
    if (!signal || typeof signal.subscribe !== "function") {
      return undefined;
    }
    setValue(signal.peek());
    return signal.subscribe(setValue);
  }, [signal]);
  return value;
}
