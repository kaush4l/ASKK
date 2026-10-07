// One team per local server, shared by every tab (capability `team`).
//
// The engines run in a Bun Worker (team-worker.js). This side keeps the
// latest state of everything (registry, each engine, the model layer) and
// serves it to every tab: GET team/stream sends a full snapshot, then each
// change as it happens (Server-Sent Events); POST team/call forwards an
// action (a message, an approval, stop, …) and answers with its result.
//
//   const team = createTeam({ root, readOnly, agentDirs, withPublic })
//   createHostApi({ …, team })   // adds team/stream, team/call, team/send, capability team
//
// The server is the team's home and runs until stopped: it wakes the team
// itself (state/wakes.jsonl, companion/wakes.js), and any outside source —
// cron, a script, another program — hands it work with team/send (fire and
// forget) instead of starting the application. One server per team folder,
// so several desks run side by side, each on its own port.

import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

import { deskOfRoot } from "./desk.js"
import { startWakes } from "./wakes.js"

const PING_MS = 20000
const CALL_TIMEOUT_MS = 30 * 60 * 1000 // `ask` waits for a whole answer (default)
const MAX_CALL_TIMEOUT_MS = 6 * 60 * 60 * 1000 // a call may ask for up to this (`timeout` ms)

// The runtime folder of a workspace: the team's memory, history and
// artifacts as real files (files/agents/<engine>/memory.md, …) and its
// settings (one file per localStorage key). Outside the workspace, so agents
// never see their own memory or model keys in FILESYSTEM:
//   custom/<team>/runtime/   when the workspace is a team's data/ folder
//   ~/.askk/team/<hash>/     any other workspace
// One runtime per workspace: the local server, every tab, and terminal runs.
// A desk (custom/<desk>/desk.js, companion/desk.js) splits it: host state in
// custom/<desk>/state/, engine files in custom/<desk>/memory/.
export function teamStorageDir(root) {
  const desk = deskOfRoot(root)
  if (desk) return join(desk, "state")
  const id = createHash("sha256").update(root).digest("hex").slice(0, 12)
  const legacy = join(process.env.ASKK_STATE_DIR ?? join(homedir(), ".askk"), "team", id)
  const team = dirname(root)
  if (basename(root) !== "data" || !existsSync(join(team, "agents"))) return legacy
  const dir = join(team, "runtime")
  if (!existsSync(dir) && existsSync(legacy)) cpSync(legacy, dir, { recursive: true }) // moved here 2026-10
  return dir
}

// Where the engine files (memory.md, history, artifacts.json) live.
export function teamMemoryDir(root) {
  const desk = deskOfRoot(root)
  return desk ? join(desk, "memory") : join(teamStorageDir(root), "files")
}

// The running server of a workspace's team, if any: { port, pid, root }.
// Headless runs (`askk ask`, cron, wake.js) hand their query to it, so the
// one team does the work and every tab shows it live.
export function findTeamServer(root) {
  try {
    const found = JSON.parse(readFileSync(join(teamStorageDir(root), "server.json"), "utf8"))
    if (found.root !== root) return null
    process.kill(found.pid, 0) // throws when that process is gone
    return found
  } catch {
    return null
  }
}

// port / desk: the server this team runs in (its host API answers the
// terminal, so runs and background processes are one set every tab streams).
export function createTeam({ root, readOnly = false, agentDirs = [], withPublic = false, embedded = null, port = null, desk = null, log = () => {} }) {
  const storageDir = teamStorageDir(root)
  const filesDir = teamMemoryDir(root)
  const worker = new Worker(new URL("./team-worker.js", import.meta.url).href)
  const cache = { registry: { agents: [], edited: [], status: "loading", error: null, requiredId: null, engines: [] }, states: {}, models: null }
  const clients = new Set() // (event) => void
  const calls = new Map() // callId -> { resolve, timer }
  let callCount = 0

  const broadcast = (event) => {
    for (const send of clients) send(event)
  }

  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case "registry":
        cache.registry = data.registry
        for (const id of Object.keys(cache.states)) {
          if (!data.registry.engines.some((e) => e.id === id)) delete cache.states[id]
        }
        if (data.registry.status === "error") log(`team: ${data.registry.error}`)
        broadcast(data)
        break
      case "state": {
        const { messages, ...rest } = data.patch
        // A closed engine (an ended sub-agent) is gone from the registry;
        // its last patch must not bring a partial state back to the cache.
        if (rest.status === "disposed") {
          delete cache.states[data.id]
          break
        }
        const state ={ ...(cache.states[data.id] ?? {}), ...rest }
        if (messages) state.messages = [...(cache.states[data.id]?.messages ?? []).slice(0, messages.from), ...messages.items]
        cache.states[data.id] = state
        broadcast(data)
        break
      }
      case "models":
        cache.models = data.models
        broadcast(data)
        break
      case "result": {
        const call = calls.get(data.callId)
        calls.delete(data.callId)
        if (call) {
          clearTimeout(call.timer)
          call.resolve(data.ok ? { ok: true, value: data.value } : { ok: false, error: data.error })
        }
        break
      }
    }
  }
  worker.onerror = (event) => log(`team: worker failed: ${event.message}`)
  // embedded: the compiled binary's public files (URL path -> embedded file path)
  worker.postMessage({ type: "init", root, readOnly, agentDirs, withPublic, storageDir, filesDir, embedded, hostPort: port, desk })

  function stream(request) {
    const encoder = new TextEncoder()
    let send = null
    let ping = null
    const body = new ReadableStream({
      start(controller) {
        send = (event) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
          } catch {
            clients.delete(send)
          }
        }
        send({ type: "snapshot", registry: cache.registry, states: cache.states, models: cache.models })
        clients.add(send)
        ping = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"))
          } catch {
            clearInterval(ping)
          }
        }, PING_MS)
        request.signal?.addEventListener("abort", () => {
          clients.delete(send)
          clearInterval(ping)
          try {
            controller.close()
          } catch {
            // already closed
          }
        })
      },
      cancel() {
        clients.delete(send)
        clearInterval(ping)
      },
    })
    return new Response(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" },
    })
  }

  function call({ target, method, args = [], timeout }) {
    if (typeof target !== "string" || typeof method !== "string" || !Array.isArray(args)) {
      return Promise.resolve({ ok: false, error: { message: 'Expected { "target", "method", "args": [] }.' } })
    }
    return new Promise((resolve) => {
      const callId = ++callCount
      const timer = setTimeout(() => {
        calls.delete(callId)
        resolve({ ok: false, error: { message: "The team did not answer in time." } })
      }, Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, MAX_CALL_TIMEOUT_MS) : CALL_TIMEOUT_MS)
      calls.set(callId, { resolve, timer })
      worker.postMessage({ type: "call", callId, target, method, args })
    })
  }

  // Tell headless runs on this workspace where the team is (server.json in
  // the team's state folder); removed on exit.
  // desk: this team's desk name when one server hosts several (scripts send
  // it as the x-askk-desk header so their request reaches this team).
  function announce(port, desk = null) {
    const file = join(storageDir, "server.json")
    mkdirSync(storageDir, { recursive: true })
    writeFileSync(file, JSON.stringify({ port, pid: process.pid, root, ...(desk ? { desk } : {}) }))
    const remove = () => {
      try {
        if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) rmSync(file)
      } catch {
        // already gone
      }
    }
    process.on("exit", remove)
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => (remove(), process.exit(0)))
  }

  // Hand an agent work without waiting for its answer: the letter is queued
  // in its inbox (worked after what it is doing now) and the reply is shown
  // in every tab. agent = an agent name; default: the team's lead.
  function send({ agent = null, text, from = null } = {}) {
    if (typeof text !== "string" || !text.trim()) return { ok: false, error: { message: "text: what the agent should do." } }
    const { engines, requiredId, status } = cache.registry
    if (status !== "ready") return { ok: false, error: { message: `The team is ${status}; try again shortly.` } }
    const nameOf = (e) => e.agent?.name ?? e.name
    const engine = agent ? engines.find((e) => nameOf(e) === agent || e.name === agent) : engines.find((e) => e.id === requiredId)
    if (!engine) return { ok: false, error: { message: `No agent "${agent}" in this team.` } }
    const letter = { kind: "request", text: text.trim(), from: typeof from === "string" && from.trim() ? from.trim().slice(0, 80) : null }
    // A call whose result nobody waits for: the worker's answer finds no entry and is dropped.
    worker.postMessage({ type: "call", callId: ++callCount, target: engine.id, method: "deposit", args: [letter] })
    log(`team: ${letter.from ?? "send"} → ${nameOf(engine)}: ${letter.text.slice(0, 80)}`)
    return { ok: true, value: { engine: engine.id, agent: nameOf(engine), queued: true } }
  }

  // The wake book: due wakes go to their agent's inbox (read-only servers never write it).
  const stopWakes = readOnly ? () => {} : startWakes({ root, deliver: send, log })

  return { storageDir, stream, call, send, announce, terminate: () => (stopWakes(), worker.terminate()) }
}
