// One team per local server, shared by every tab (capability `team`).
//
// The engines run in a Bun Worker (team-worker.js). This side keeps the
// latest state of everything (registry, each engine, the model layer) and
// serves it to every tab: GET team/stream sends a full snapshot, then each
// change as it happens (Server-Sent Events); POST team/call forwards an
// action (a message, an approval, stop, …) and answers with its result.
//
//   const team = createTeam({ root, readOnly, agentDirs, withPublic })
//   createHostApi({ …, team })   // adds team/stream, team/call, capability team

import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join } from "node:path"

const PING_MS = 20000
const CALL_TIMEOUT_MS = 30 * 60 * 1000 // `ask` waits for a whole answer

// The runtime folder of a workspace: the team's memory, history and
// artifacts as real files (files/agents/<engine>/memory.md, …) and its
// settings (one file per localStorage key). Outside the workspace, so agents
// never see their own memory or model keys in FILESYSTEM:
//   custom/<team>/runtime/   when the workspace is a team's data/ folder
//   ~/.askk/team/<hash>/     any other workspace
// One runtime per workspace: the local server, every tab, and terminal runs.
export function teamStorageDir(root) {
  const id = createHash("sha256").update(root).digest("hex").slice(0, 12)
  const legacy = join(process.env.ASKK_STATE_DIR ?? join(homedir(), ".askk"), "team", id)
  const team = dirname(root)
  if (basename(root) !== "data" || !existsSync(join(team, "agents"))) return legacy
  const dir = join(team, "runtime")
  if (!existsSync(dir) && existsSync(legacy)) cpSync(legacy, dir, { recursive: true }) // moved here 2026-10
  return dir
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

export function createTeam({ root, readOnly = false, agentDirs = [], withPublic = false, embedded = null, log = () => {} }) {
  const storageDir = teamStorageDir(root)
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
        const state = { ...(cache.states[data.id] ?? {}), ...rest }
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
  worker.postMessage({ type: "init", root, readOnly, agentDirs, withPublic, storageDir, embedded })

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

  function call({ target, method, args = [] }) {
    if (typeof target !== "string" || typeof method !== "string" || !Array.isArray(args)) {
      return Promise.resolve({ ok: false, error: { message: 'Expected { "target", "method", "args": [] }.' } })
    }
    return new Promise((resolve) => {
      const callId = ++callCount
      const timer = setTimeout(() => {
        calls.delete(callId)
        resolve({ ok: false, error: { message: "The team did not answer in time." } })
      }, CALL_TIMEOUT_MS)
      calls.set(callId, { resolve, timer })
      worker.postMessage({ type: "call", callId, target, method, args })
    })
  }

  // Tell headless runs on this workspace where the team is (server.json in
  // the team's state folder); removed on exit.
  function announce(port) {
    const file = join(storageDir, "server.json")
    mkdirSync(storageDir, { recursive: true })
    writeFileSync(file, JSON.stringify({ port, pid: process.pid, root }))
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

  return { storageDir, stream, call, announce, terminate: () => worker.terminate() }
}
