// One agent's Worker (increment 06). This is TRANSPORT, not logic (I5): a
// Worker can only be started from JavaScript, and its wasm module can only be
// imported by JavaScript, so this file does exactly those two things and hands
// every decision to the same Rust build the page runs.
//
// The page sends { kind: "boot", ... } once with the fingerprinted bundle URLs
// (Trunk hashes them, so nothing here may hardcode a name), then
// { kind: "run", goal } per turn. A run that arrives while the boot is still
// in flight waits for it — that is what `ready` is.
//
// Every message back is TAGGED: "ready" is a lifecycle fact the page turns
// into a row on the board, "answer" settles the turn in flight. Untagged, a
// boot report arriving mid-turn would be read as that turn's answer.

let ready = null;

const reason = (e) => String(e && e.message ? e.message : e);

async function boot(m) {
  const bundle = await import(m.glue);
  await bundle.default({ module_or_path: m.wasm });
  return await bundle.AgentWorker.boot(m.name, m.agents, m.models, m.profile);
}

self.onmessage = (event) => {
  const m = event.data;
  if (m.kind === "boot") {
    ready = boot(m);
    ready.then(
      // The window it came up holding, so the page can show a sub-agent's
      // memory before it has answered anything (increment 09).
      (agent) => self.postMessage({ kind: "ready", ok: true, text: "", memory: agent.memory(), authored: agent.authored(), activity: agent.activity() }),
      // A Worker that cannot build its agent is FAILED with its reason, not a
      // console line: this is the one row that must say the agent is unusable.
      (e) => self.postMessage({ kind: "ready", ok: false, text: reason(e) }),
    );
    return;
  }
  if (!ready) {
    self.postMessage({ kind: "answer", ok: false, text: "this agent was never booted" });
    return;
  }
  ready
    .then((agent) => agent.run(m.goal))
    .then(async (text) =>
      self.postMessage({
        kind: "answer",
        ok: true,
        text,
        memory: (await ready).memory(),
        // Agents this one WROTE (increment 11): its log is its own, so the
        // page has to be told, exactly as it is told about the window.
        authored: (await ready).authored(),
        // What it DID, not only what it said: its tool calls and its spend,
        // cursored so each one crosses once (worker.rs `activity`).
        activity: (await ready).activity(),
      }),
    )
    .catch((e) => self.postMessage({ kind: "answer", ok: false, text: reason(e) }));
};
