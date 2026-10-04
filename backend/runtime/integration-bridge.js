// Messages from integrations (Telegram, …) to the lead, and its answers back.
//
// The local host runs each integration's listener (companion/integrations.js)
// and queues what arrives; this bridge long-polls GET /__askk/integrations/
// events, gives each message to the default agent as a request (from
// "<integration>:<sender>", so it shows in that agent's chat), and sends the
// final answer back with the reply tool the event names (e.g.
// telegram.send_message to the same chat). Replying needs no approval: the
// owner started the conversation from an allowed chat.
//
// One tab handles messages (a Web Lock); the cursor (boot id + last seq) is
// kept in localStorage so a reload does not answer a message twice.

import { withBase } from "@/backend/platform/base-path"
import { detectHost, hasCapability } from "@/backend/platform/host"

const CURSOR = "askk.integrations.cursor"
const WAIT = 25_000

const readCursor = () => {
  try {
    return JSON.parse(localStorage.getItem(CURSOR) ?? "{}")
  } catch {
    return {}
  }
}
const writeCursor = (cursor) => {
  try {
    localStorage.setItem(CURSOR, JSON.stringify(cursor))
  } catch {}
}

async function api(endpoint, { params, body } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : ""
  const response = await fetch(withBase(`/__askk/${endpoint}${query}`), {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) throw new Error(data?.error ?? `Request failed (${response.status}).`)
  return data
}

// The request the agent sees.
const requestText = (event) =>
  `Message from ${event.from} on ${event.integration[0].toUpperCase()}${event.integration.slice(1)}` +
  ` (your answer is sent back to them there):\n\n${event.text}`

async function handle(event, engineFor) {
  const engine = engineFor()
  let answer
  try {
    if (!engine) throw new Error("No agent is running.")
    answer = await engine.ask(requestText(event), { from: `${event.integration}:${event.from}` })
  } catch (error) {
    answer = `Sorry, that failed: ${error.message}`
  }
  if (!event.reply?.tool) return
  try {
    const result = await api("mcp/call", {
      body: { server: event.integration, tool: event.reply.tool, arguments: { ...event.reply.args, text: answer || "(no answer)" } },
    })
    if (result.isError) console.warn(`${event.integration}: reply failed: ${result.text}`)
  } catch (error) {
    console.warn(`${event.integration}: reply failed: ${error.message}`)
  }
}

async function poll(engineFor) {
  let failures = 0
  while (true) {
    const cursor = readCursor()
    try {
      const { boot, next, events } = await api("integrations/events", {
        params: { after: cursor.next ?? 0, from: cursor.boot ?? "", wait: WAIT },
      })
      failures = 0
      writeCursor({ boot, next }) // before handling: a reload never answers twice
      for (const event of events) if (event.kind === "message") handle(event, engineFor) // the inbox orders them
    } catch {
      failures++
      await new Promise((r) => setTimeout(r, Math.min(60_000, 2000 * 2 ** Math.min(failures, 5))))
    }
  }
}

// Start once the registry is ready; `engineFor()` returns the default agent's engine.
export async function startIntegrationBridge(engineFor) {
  const host = await detectHost()
  if (!hasCapability(host, "integrations.events")) return
  if (globalThis.navigator?.locks) navigator.locks.request("askk-integrations", () => poll(engineFor))
  else poll(engineFor)
}
