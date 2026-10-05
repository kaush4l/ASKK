// The server's team: every engine of the team, in-process, in one Bun Worker
// beside the local server (companion/team.js starts it). The same registry
// and engines as the app (backend/runtime/registry.js), with browser shims
// (companion/shims.js): its own host API instance answers in-process, and
// localStorage (memory, agent edits, model choice) is kept on disk.
//
// main → worker
//   { type: "init", root, readOnly, agentDirs, withPublic, storageDir, embedded }
//   { type: "call", callId, target: "registry" | <engine id>, method, args }
// worker → main
//   { type: "registry", registry }       the registry's public state
//   { type: "state", id, patch }         changed engine state (messages as { from, items })
//   { type: "models", models }           the catalogue's browser layer (JSON text)
//   { type: "result", callId, ok, value | error }

import { createHostApi } from "./host-api.js"
import { SHIM_PORT, installBrowserShims } from "./shims.js"

const REGISTRY_CALLS = new Set(["updateAgent", "resetAgent", "create", "dispose", "setModels", "setAutopilot"])
const ENGINE_CALLS = new Set(["deposit", "send", "ask", "clearMemory", "summarizeMemory", "preview", "stop", "resolveApproval"])
const FLUSH_MS = 33

let registry = null
const pending = [] // calls that arrived before the team started

// Engine state → main, batched (as engine-worker.js does per engine).
function watch(engine) {
  let sent = {}
  let timer = null
  const flush = () => {
    timer = null
    const state = engine.getSnapshot()
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
    sent = state
    if (Object.keys(patch).length) postMessage({ type: "state", id: engine.id, patch })
  }
  engine.subscribe(() => {
    timer ??= setTimeout(flush, FLUSH_MS)
  })
  flush()
}

async function call({ callId, target, method, args = [] }) {
  try {
    let value
    if (target === "registry") {
      if (!REGISTRY_CALLS.has(method)) throw new Error(`Unknown registry call ${method}`)
      value = await registry[method](...args)
      if (method === "create") value = value?.id ?? null
      else if (method === "updateAgent") value = null
    } else {
      if (!ENGINE_CALLS.has(method)) throw new Error(`Unknown engine call ${method}`)
      const engine = registry.getSnapshot().engines.find((e) => e.id === target)
      if (!engine) throw new Error("That agent is not running.")
      value = await engine[method](...args)
    }
    postMessage({ type: "result", callId, ok: true, value: value ?? null })
  } catch (error) {
    postMessage({ type: "result", callId, ok: false, error: { name: error.name, message: error.message } })
  }
}

async function start({ root, readOnly, agentDirs, withPublic, storageDir, embedded = null }) {
  // Listeners (Telegram, …) run here: the team answers them.
  const api = await createHostApi({ root, readOnly, port: SHIM_PORT, agentDirs, withPublic, listen: true })
  installBrowserShims({ api, embedded, storageDir })

  const { engineRegistry } = await import("@/backend/runtime/registry")
  const { createEngine } = await import("@/backend/engines")
  const { models } = await import("@/backend/models/catalog")
  registry = engineRegistry

  let count = 0
  engineRegistry.runOnServer(({ agent, name, host }) => {
    const box = {}
    const directory = {
      describe: (other) => host.descriptions()[other],
      send: async (to, letter) => host.send(box.engine, to, letter),
    }
    const engine = createEngine({ agent, id: `engine-${++count}`, name, directory })
    box.engine = engine
    engine.init()
    watch(engine)
    return engine
  })

  let last = null
  const publish = () => {
    const state = engineRegistry.publicState()
    const text = JSON.stringify(state)
    if (text !== last) {
      last = text
      postMessage({ type: "registry", registry: state })
    }
  }
  engineRegistry.subscribe(publish)
  models.subscribe(() => postMessage({ type: "models", models: models.savedJson() }))
  await engineRegistry.start()
  publish()
  postMessage({ type: "models", models: models.savedJson() })
  for (const data of pending.splice(0)) call(data)
}

self.onmessage = ({ data }) => {
  if (data.type === "init") start(data).catch((error) => postMessage({ type: "registry", registry: { agents: [], edited: [], status: "error", error: error.message, requiredId: null, engines: [] } }))
  else if (data.type === "call") registry?.getSnapshot().status === "ready" ? call(data) : pending.push(data)
}
