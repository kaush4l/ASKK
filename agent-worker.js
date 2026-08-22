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
//
// Every answer also carries what the agent HOLDS, what it WROTE and what it
// DID, whether the turn succeeded or failed — see `side` below.

let ready = null;

const reason = (e) => String(e && e.message ? e.message : e);

async function boot(m) {
  const bundle = await import(m.glue);
  await bundle.default({ module_or_path: m.wasm });
  return await bundle.AgentWorker.boot(m.name, m.agents, m.briefs, m.models, m.profile);
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
  // The three things a turn says about itself alongside its text, on EITHER
  // outcome. They were on the success path only, so a delegated turn that
  // failed reported nothing it had done — and a failed run is the one whose
  // trace is worth reading. Same envelope, same fields, one place: this is
  // the shape of the message, not a decision about it (I5).
  //
  // It cannot throw. `ready` may itself be what rejected — a Worker that
  // never built its agent has nothing to report — and a side channel that
  // raised while reporting a failure would swallow the reason for it.
  const side = async () => {
    try {
      const agent = await ready;
      return { memory: agent.memory(), authored: agent.authored(), activity: agent.activity() };
    } catch {
      return {};
    }
  };
  ready
    .then((agent) => agent.run(m.goal))
    .then(async (text) => self.postMessage({ kind: "answer", ok: true, text, ...(await side()) }))
    .catch(async (e) =>
      self.postMessage({ kind: "answer", ok: false, text: reason(e), ...(await side()) }),
    );
};
