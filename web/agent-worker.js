// One agent's Worker (increment 06). This is TRANSPORT, not logic (I5): a
// Worker can only be started from JavaScript, and its wasm module can only be
// imported by JavaScript, so this file does exactly those two things and hands
// every decision to the same Rust build the page runs.
//
// The page sends { kind: "boot", ... } once with the fingerprinted bundle URLs
// (Trunk hashes them, so nothing here may hardcode a name), then
// { kind: "run", goal } per turn. A run that arrives while the boot is still
// in flight waits for it — that is what `ready` is, and it is why the boot
// needs no acknowledgement.

let ready = null;

async function boot(m) {
  const bundle = await import(m.glue);
  await bundle.default({ module_or_path: m.wasm });
  return await bundle.AgentWorker.boot(m.name, m.agents, m.models, m.profile);
}

self.onmessage = (event) => {
  const m = event.data;
  if (m.kind === "boot") {
    ready = boot(m);
    ready.catch((e) => console.error("agent worker failed to boot:", e));
    return;
  }
  if (!ready) {
    self.postMessage({ ok: false, text: "this agent was never booted" });
    return;
  }
  ready
    .then((agent) => agent.run(m.goal))
    .then((text) => self.postMessage({ ok: true, text }))
    .catch((e) => self.postMessage({ ok: false, text: String(e && e.message ? e.message : e) }));
};
