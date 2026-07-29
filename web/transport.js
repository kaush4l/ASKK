// The transport (ADR-002 Transport B, proven in Spike A): an htmx extension
// that cancels htmx's network request and answers it from the Wasm seam.
// Transport only — no application logic lives here (invariant I5).
import init, { WebApp } from "./pkg/adapters_web.js";

// Boot once; every request awaits the same booted app. When boot completes,
// fire the event the #root element's hx-trigger waits for.
const appReady = init()
  .then(() => WebApp.boot())
  .then((app) => {
    htmx.trigger(document.body, "harness:ready");
    return app;
  })
  .catch((e) => {
    // Boot failure is surfaced, not swallowed (error surfacing, not logic).
    const root = document.getElementById("root");
    if (root) root.textContent = "core failed to boot: " + e;
    throw e;
  });

function swapStyle(elt) {
  const src = elt.closest("[hx-swap]");
  return src ? src.getAttribute("hx-swap").split(" ")[0] : "innerHTML";
}

async function respond(detail) {
  const app = await appReady;
  const cfg = detail.requestConfig;
  const body = cfg.formData ? new URLSearchParams(cfg.formData).toString() : "";
  const request = {
    method: cfg.verb.toUpperCase(),
    path: cfg.path,
    headers: Object.entries(cfg.headers || {}).map(([k, v]) => [k, String(v)]),
    body,
  };
  const res = JSON.parse(app.handle_request(JSON.stringify(request)));
  const target = detail.target || detail.elt;
  const parent = target.parentElement;
  htmx.swap(target, res.body, { swapStyle: swapStyle(detail.elt) });
  // Re-process so hx-* attributes inside the new fragment (panel loaders,
  // the chat poll chain) are wired up. Idempotent for old nodes.
  htmx.process(parent || document.body);
  if (detail.elt && detail.elt.tagName === "FORM") detail.elt.reset();
}

htmx.defineExtension("wasm-seam", {
  onEvent: function (name, evt) {
    if (name !== "htmx:beforeRequest") return true;
    evt.preventDefault(); // cancel the real network request
    respond(evt.detail).catch((e) => console.error("wasm transport:", e));
    return true;
  },
});
