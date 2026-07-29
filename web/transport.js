// Spike A transport (PROMPT.md §5 Option B): an htmx extension that cancels
// htmx's network request and answers it from the Wasm seam instead.
// Transport only — no application logic lives here (invariant I5).
import init, { wasm_handle } from "../spikes/seam/pkg/spike_seam.js";

const ready = init(); // start loading the Wasm module immediately

function swapStyle(elt) {
  const src = elt.closest("[hx-swap]");
  return src ? src.getAttribute("hx-swap").split(" ")[0] : "innerHTML";
}

async function respond(detail) {
  await ready;
  const cfg = detail.requestConfig;
  const headers = Object.entries(cfg.headers || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const res = wasm_handle(cfg.verb.toUpperCase(), cfg.path, headers, "");
  const target = detail.target || detail.elt;
  const parent = target.parentElement;
  htmx.swap(target, res.body, { swapStyle: swapStyle(detail.elt) });
  // Re-process so hx-* attributes inside the new fragment (the stream chain's
  // hx-trigger="load" placeholders) are wired up. Idempotent for old nodes.
  htmx.process(parent || document.body);
}

htmx.defineExtension("wasm-seam", {
  onEvent: function (name, evt) {
    if (name !== "htmx:beforeRequest") return true;
    evt.preventDefault(); // cancel the real network request
    respond(evt.detail).catch((e) => console.error("wasm transport:", e));
    return true;
  },
});
