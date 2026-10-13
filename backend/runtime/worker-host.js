// Engine state → main thread, as patches: the keys that changed since the
// last state sent, and messages as { from, items } (only from the first one
// that changed, usually the last). Used per engine by engine-worker.js and
// by the server's team worker (companion/team/team-worker.js).

export function statePatch(sent, state) {
  const patch = {}
  for (const [key, value] of Object.entries(state)) {
    if (key !== "messages" && value !== sent[key]) patch[key] = value
  }
  if (state.messages !== sent.messages) {
    const before = sent.messages ?? []
    let from = 0
    while (from < before.length && from < state.messages.length && before[from] === state.messages[from]) from++
    patch.messages = { from, items: state.messages.slice(from) }
  }
  return patch
}
