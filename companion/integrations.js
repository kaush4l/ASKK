// Integrations: connections to outside services (Telegram, …) that run beside
// ASKK on this machine. Each lives in its own folder, kept out of git:
//
//   integrations/<name>/index.js    export default function createIntegration({ env, log })
//
// createIntegration returns null when the service is not configured (its
// .env values are missing), else:
//
//   { name, description,
//     approval: "auto" | "always" | "never",       as for MCP servers
//     tools: [{ name, description, inputSchema, annotations: { readOnlyHint }, run(args) -> text }],
//     listen?({ emit, signal })                    optional: receive messages
//   }
//
// Tools are offered to agents exactly like MCP tools (`<integration>.<tool>`,
// agent.md `mcp:`), through the host API's mcp/tools and mcp/call. A
// listener runs only when ASKK runs continuously (bun run dev, askk — not
// askk ask); what it emits waits in a queue the app reads with a long poll
// (GET integrations/events): { kind: "message", text, from, chat, reply }.
// `reply` names the tool and arguments that answer it, e.g.
// { tool: "send_message", args: { chat_id } }.

import { readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const SAFE = /^[a-z][a-z0-9_-]*$/i
const KEEP = 200 // events kept for the app
const MAX_WAIT = 25_000 // ms a long poll may wait

export async function loadIntegrations({ dir = resolve(process.cwd(), "integrations"), env = process.env, listen = false, log = console.error } = {}) {
  let folders = []
  try {
    folders = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory() && SAFE.test(d.name)).map((d) => d.name)
  } catch {
    return null // no integrations folder
  }

  const integrations = new Map() // name -> integration (or { error })
  for (const folder of folders.sort()) {
    const file = join(dir, folder, "index.js")
    if (!(await Bun.file(file).exists())) continue
    try {
      const create = (await import(pathToFileURL(file).href)).default
      const integration = await create({ env, log: (...args) => log(`${folder}:`, ...args) })
      if (!integration) {
        integrations.set(folder, { name: folder, error: "not configured (see its .env values)", tools: [] })
        continue
      }
      if (integration.name !== folder) throw new Error(`name "${integration.name}" must match its folder`)
      integrations.set(folder, integration)
    } catch (error) {
      integrations.set(folder, { name: folder, error: error.message, tools: [] })
    }
  }
  if (!integrations.size) return null

  // ── events from listeners ──────────────────────────────────────────────
  const boot = crypto.randomUUID() // a restart resets the sequence; the app notices
  const events = []
  let seq = 0
  let waiters = []
  const emitFor = (name) => (event) => {
    events.push({ ...event, integration: name, seq: ++seq, at: new Date().toISOString() })
    if (events.length > KEEP) events.splice(0, events.length - KEEP)
    for (const wake of waiters) wake()
    waiters = []
  }

  const controller = new AbortController()
  const listening = []
  if (listen) {
    for (const integration of integrations.values()) {
      if (integration.error || typeof integration.listen !== "function") continue
      listening.push(integration.name)
      Promise.resolve(integration.listen({ emit: emitFor(integration.name), signal: controller.signal })).catch((error) =>
        log(`${integration.name}: listener stopped: ${error.message}`)
      )
    }
    process.on("exit", () => controller.abort())
  }

  return {
    names: [...integrations.keys()],
    listening,
    has: (name) => integrations.has(name),

    // The same shape as the MCP client's tools() entries.
    servers() {
      return [...integrations.values()].map((integration) => ({
        name: integration.name,
        ok: !integration.error,
        ...(integration.error ? { error: integration.error } : {}),
        approval: ["always", "never"].includes(integration.approval) ? integration.approval : "auto",
        tools: (integration.tools ?? []).map(({ name, description, inputSchema, annotations }) => ({
          name,
          title: null,
          description: description ?? "",
          inputSchema: inputSchema ?? { type: "object" },
          annotations: annotations ?? {},
        })),
      }))
    },

    async call(name, tool, args = {}) {
      const integration = integrations.get(name)
      if (!integration) throw Object.assign(new Error(`Unknown integration "${name}".`), { status: 404 })
      if (integration.error) throw Object.assign(new Error(`${name}: ${integration.error}`), { status: 503 })
      const found = integration.tools.find((t) => t.name === tool)
      if (!found) throw Object.assign(new Error(`${name} has no tool "${tool}".`), { status: 404 })
      try {
        return { text: String((await found.run(args ?? {})) ?? "Done."), isError: false }
      } catch (error) {
        return { text: error.message, isError: true }
      }
    },

    // Events after `after` (a seq from the same boot), waiting up to `wait` ms
    // for the first one.
    async events({ after = 0, from = null, wait = 0 } = {}) {
      const since = from === boot ? Number(after) || 0 : 0
      const pending = () => events.filter((e) => e.seq > since)
      if (!pending().length && wait > 0) {
        await new Promise((done) => {
          const timer = setTimeout(done, Math.min(wait, MAX_WAIT))
          waiters.push(() => (clearTimeout(timer), done()))
        })
      }
      return { boot, next: seq, events: pending() }
    },
  }
}
