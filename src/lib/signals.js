// UI re-export of the core signal system (src/core/signals.js).
// Components import from here; the implementation lives in core
// so bun tests can run it without a DOM.
export * from "../core/signals.js";
