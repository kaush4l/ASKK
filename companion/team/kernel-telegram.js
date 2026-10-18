// Telegram for a desk, server-side: the owner's messages go to the desk's lead and its answers come
// back with no tab open. companion/server/desks.js starts it for a desk whose main.js lists
// "telegram" in `integrations`, once the server listens.
//
//   const bridge = await startKernelTelegram({ team, integrations, stateDir, desk, log })
//   bridge.notify(text)        → Promise<boolean>  a run report to the owner (the desk's topic, if any)
//   notify(text, { desk? })    the same from anywhere in this process (e.g. the desk's kernel.js)
//
// Owner only: the integration's listener emits only the owner's own messages in their private chat
// (companion/shared/telegram-owner.js), and every event is checked again here against `owner` (the
// owner's user id; dev.js passes TELEGRAM_OWNER_ID, else TELEGRAM_CHAT_ID): anything else is dropped and
// logged once per reason, without ids. Everything is sent to the owner's chat only.
//
// Commands: "/status" sends a fresh live status message now (or a snapshot of the last run);
// "/stop" stops the lead's run; "/queue <text>" is new work for the lead after its current run.
// Anything else goes to the lead: new work when it is idle, guidance for its run while it works.
//
// Live status (companion/team/kernel-live.js, text from kernel-status.js): when the lead starts a run,
// from any source, one message is sent and edited in place while the agents work, then marked done.
// Needs the integration's host-only `live` ({ send, edit }); without it the bridge runs without one.
//
// Routing: an owner message to an idle lead is a new run, team.send({ from: "telegram:<sender>" }); the
// lead's answer to that run, read from team.stream (the surface every tab mirrors), is sent back as a
// reply to the message, in its chat and topic. While the lead works, a message is owner guidance for the
// run in progress (team call `guide`): its next step reads it, the owner is told so at once, and the
// run's answer goes wherever that run's answer goes. A run that ends before the note lands takes it as
// new work instead. "/queue <text>" is always new work: the lead runs one request at a time, so it waits
// in the lead's queue, the owner is told "queued" at once, and the answer follows when that run ends.
//
// Restarts: <stateDir>/telegram.json keeps, per chat (hashed: chat ids are never written or
// logged), the last message id handed to the lead, written before the hand-off, so a message is
// never answered twice; the messages still waiting for an answer (their run died with the old
// process: the owner is told to resend them); and the desk's topic.
//
// Topic: a bot can keep forum topics in its private chat (Bot API 9.3+) once its threaded mode is on
// in @BotFather (getMe has_topics_enabled). Then the desk gets one topic, created once and named after
// the desk, where notify() posts; otherwise everything goes to the plain chat.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { whyNotOwnerEvent } from "../shared/telegram-owner.js"
import { startLiveStatus } from "./kernel-live.js"
import { deskBriefs } from "./kernel-status.js"

const INTEGRATION = "telegram"
const POLL_WAIT_MS = 25_000
const ANSWER_TIMEOUT_MS = 4 * 60 * 60 * 1000 // a run with no answer by then (it never started, or hangs) is given up
const PREVIEW_CHARS = 200

const bridges = new Map() // desk name -> bridge: notify() from anywhere in this process

// A run report to the owner. desk: which desk's bridge (default: the only one). False when none runs.
export async function notify(text, { desk = null } = {}) {
  const bridge = desk ? bridges.get(desk) : bridges.size === 1 ? [...bridges.values()][0] : null
  return bridge ? bridge.notify(text) : false
}

// The owner's report of a run that did not start in Telegram (a scheduled run, the UI's Run):
// the lead's REPORT, one line per desk-level artifact ("title: brief", deskBriefs in kernel-status.js),
// and any gate it ran past. artifacts: the kernel's artifacts (by id or a list; optional); deskTeam:
// the desk's own team (tree.team) whose artifacts are desk-level (none: every owner's).
export function runReport({ desk, request, answer, flags = [], artifacts = null, deskTeam = null }) {
  const briefs = deskBriefs(artifacts, deskTeam).map((a) => `${oneLine(a.title, 40)}: ${oneLine(a.brief, 300)}`)
  const gates = flags ?? []
  return [`${desk} · ${request?.from ?? "run"}: ${oneLine(request?.text, 120)}`, "", String(answer ?? "").trim(), briefs.length ? `\n${briefs.join("\n")}` : null, gates.length ? `\n(gates open: ${gates.join("; ")})` : null].filter((x) => x != null).join("\n")
}

const keyOf = (chat) => new Bun.CryptoHasher("sha256").update(String(chat)).digest("hex").slice(0, 16)
const oneLine = (text, n) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim()
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
// Telegram's errors may quote a chat id; the log never shows one.
const redact = (text) => String(text).replace(/-?\d{6,}/g, "<id>")

function stateFile(file) {
  const state = { seen: {}, pending: [], thread: null, announced: [] }
  try {
    Object.assign(state, JSON.parse(readFileSync(file, "utf8")))
  } catch {}
  return {
    state,
    save() {
      writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 1))
      renameSync(`${file}.tmp`, file) // atomic: a crash never leaves half a cursor
    },
  }
}

// The lead's runs from the team's stream. A run starts with a user message (request + sender) and
// ends with an answer (or an error) before the next one starts, so the answer after our request's
// start is ours. wait(from, text) → { answer: Promise<{answer, error}>, cancel }.
function followLead(team, signal) {
  const waiting = [] // in hand-off order
  let lead = null
  let current = null
  let last = 0 // kernel message ids are k<n>, increasing: a trimmed or reset list repeats old ones
  let found
  const snapshot = new Promise((resolve) => (found = resolve))
  const seq = (id) => Number(String(id ?? "").replace(/^\D+/, "")) || 0

  function take(m) {
    if (m.role === "user" && m.kind !== "guidance") {
      // a new run (guidance joins the run in progress)
      const i = waiting.findIndex((w) => w.from === (m.from ?? "owner") && w.text === m.content)
      current = i >= 0 ? waiting.splice(i, 1)[0] : null
    } else if (m.role === "assistant" && m.action === "answer" && current) {
      current.resolve({ answer: m.error ? null : m.content, error: m.error ?? null })
      current = null
    }
  }
  function onEvent(e) {
    if (e.type === "snapshot") {
      lead = e.registry?.requiredId ?? null
      for (const m of e.states?.[lead]?.messages ?? []) last = Math.max(last, seq(m.id))
      found(lead)
    } else if (e.type === "state" && e.id === lead) {
      for (const m of e.patch?.messages?.items ?? []) {
        if (seq(m.id) <= last) continue
        last = seq(m.id)
        take(m)
      }
    }
  }

  ;(async () => {
    const reader = team.stream({ signal }).body.getReader()
    signal.addEventListener("abort", () => reader.cancel().catch(() => {}))
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (let cut; (cut = buffer.indexOf("\n\n")) >= 0; ) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue
          try {
            onEvent(JSON.parse(line.slice(6)))
          } catch {}
        }
      }
    }
  })()
    .catch(() => {})
    .finally(() => found(null))

  return {
    lead: () => snapshot,
    wait(from, text) {
      let resolve
      const answer = new Promise((r) => (resolve = r))
      const entry = { from, text, resolve }
      waiting.push(entry)
      const cancel = () => {
        const i = waiting.indexOf(entry)
        if (i >= 0) waiting.splice(i, 1)
        if (current === entry) current = null
      }
      return { answer, cancel }
    },
  }
}

export async function startKernelTelegram({
  team,
  integrations,
  stateDir,
  desk = "desk",
  owner = null, // the owner's user id: only their own private-chat messages are taken
  live: liveOptions = {}, // startLiveStatus options (throttle, grace); false: no live status message
  log = () => {},
  hello = undefined, // the first message in a new place (chat or topic); default "<desk> connected: …"; null: none
  answerTimeoutMs = ANSWER_TIMEOUT_MS,
  pollWaitMs = POLL_WAIT_MS,
}) {
  const telegram = integrations?.get?.(INTEGRATION)
  if (!telegram || !integrations.listening?.includes(INTEGRATION)) throw new Error("the telegram listener does not run here")
  mkdirSync(stateDir, { recursive: true })
  const { state, save } = stateFile(join(stateDir, "telegram.json"))
  const controller = new AbortController()
  const follow = followLead(team, controller.signal)
  const lead = await follow.lead()
  if (!lead) throw new Error("the team has no lead")

  // The desk's topic when the bot's threaded mode is on; else the plain chat.
  let thread = null
  try {
    if (await telegram.topics?.enabled()) {
      if (state.thread?.name !== desk || !state.thread?.id) {
        state.thread = { name: desk, id: await telegram.topics.create(desk) }
        save()
        log(`telegram: created the topic "${desk}"`)
      }
      thread = state.thread.id
    }
  } catch (error) {
    log(`telegram: no topic, using the plain chat (${redact(error.message)})`)
  }

  async function sendMessage(args) {
    const result = await integrations.call(INTEGRATION, "send_message", args)
    if (result.isError) throw new Error(result.text)
  }
  async function post(args) {
    try {
      return await sendMessage(args)
    } catch (error) {
      // The topic was deleted in Telegram: forget it (the next start makes a new one), use the plain chat.
      if (!args.thread_id || !/thread/i.test(error.message)) throw error
      if (state.thread?.id === args.thread_id) (state.thread = null), save()
      if (thread === args.thread_id) thread = null
      return sendMessage({ ...args, thread_id: undefined })
    }
  }
  async function notify(text) {
    if (typeof text !== "string" || !text.trim()) return false
    try {
      await post({ text, ...(thread ? { thread_id: thread } : {}) }) // no chat_id: the owner's chat
      return true
    } catch (error) {
      log(`telegram: notify failed: ${redact(error.message)}`)
      return false
    }
  }

  // Messages whose run died with the previous process: the owner decides whether to ask again.
  if (state.pending.length) {
    const lost = state.pending.splice(0)
    save()
    notify(`The server restarted before the ${lead} answered:\n${lost.map((p) => `• ${p.text}`).join("\n")}\nSend again if you still need an answer.`)
  }
  // The live status message of every run (none if the integration cannot edit messages).
  const live =
    liveOptions !== false && telegram.live
      ? startLiveStatus({
          team,
          desk,
          log,
          transport: {
            send: (text) => telegram.live.send({ text, ...(thread ? { thread_id: thread } : {}) }),
            edit: (id, text) => telegram.live.edit(id, { text }),
          },
          ...liveOptions,
        })
      : null
  if (liveOptions !== false && !telegram.live) log("telegram: no live status (the integration has no live.send/edit)")

  // Once per place (marked before sending: never twice, even if the send fails).
  const place = thread ? `topic:${thread}` : "chat"
  const greeting = hello === undefined ? `${desk} connected: message me here and the ${lead} answers.` : hello
  if (greeting && !state.announced.includes(place)) {
    state.announced.push(place)
    save()
    await notify(greeting)
  }

  // One owner message: to the lead, its answer back as a reply. The synchronous part (cursor, hand-off)
  // runs in arrival order, so the lead's queue keeps the owner's order.
  async function handle(event) {
    const key = keyOf(event.chat)
    const id = Number(event.id)
    if (!(id > (state.seen[key] ?? 0))) return // handed over before (a re-delivered update after a restart)
    const raw = String(event.text ?? "").trim()
    if (!raw) return
    const reply = (body) => post({ chat_id: event.chat, reply_to: id, ...(event.thread ? { thread_id: event.thread } : {}), text: body })
    const command = /^\/(status|stop)(?:@\w+)?\s*$/i.exec(raw)?.[1]?.toLowerCase()
    state.seen[key] = id
    if (command) {
      save()
      return runCommand(command, reply, id)
    }
    // "/queue <text>": new work after the current run, never guidance.
    const queue = /^\/queue(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(raw)
    const text = queue ? (queue[1] ?? "").trim() : raw
    if (!text) {
      save()
      return void (await reply(`/queue needs the work after it: /queue <what the ${lead} should do after its run>.`).catch((error) => log(`telegram: /queue note failed: ${redact(error.message)}`)))
    }
    const from = `telegram:${event.from || "owner"}`
    const busy = team.work?.().find((w) => w.agent === lead)
    if (busy && !queue) {
      save()
      if (await guide(text, from, busy, reply, id)) return
      // The run ended before the note landed: new work, as when the lead is idle.
    }
    return ask(text, from, key, id, reply)
  }

  // While the lead works, a message is guidance for its run in progress (team call `guide`): its next step
  // reads it. False when there was no run left to guide (it ended first) or the call failed.
  async function guide(text, from, busy, reply, id) {
    let delivered = false
    try {
      const result = await team.call({ target: lead, method: "guide", args: [text, { from }] })
      if (result && result.ok === false) throw new Error(result.error?.message ?? "guide refused")
      delivered = result?.value?.delivered === true
    } catch (error) {
      log(`telegram: guidance #${id} failed, sent as new work: ${redact(error.message)}`)
      return false
    }
    if (!delivered) return false
    log(`telegram: message #${id} → ${lead} (guidance)`)
    await reply(`Guidance for the ${lead}'s run "${oneLine(busy.run, 60)}": it reads this at its next step. To run it as new work after this run instead, send /queue <text>.`).catch((error) => log(`telegram: guidance note failed: ${redact(error.message)}`))
    return true
  }

  // New work for the lead (a new run, queued behind the current one): its answer back as a reply.
  async function ask(text, from, key, id, reply) {
    const entry = { key, id, text: oneLine(text, PREVIEW_CHARS), at: new Date().toISOString() }
    state.pending.push(entry)
    save()
    const busy = team.work?.().find((w) => w.agent === lead)
    const waiter = follow.wait(from, text)
    let timer
    let body
    try {
      const sent = team.send({ agent: lead, text, from })
      if (!sent?.ok) throw new Error(sent?.error?.message ?? `the ${lead} did not take it`)
      log(`telegram: message #${id} → ${lead}${busy ? " (queued)" : ""}`)
      if (busy) reply(`Queued: the ${lead} is working on "${oneLine(busy.run, 60)}". The answer comes here when it is done.`).catch((error) => log(`telegram: queued note failed: ${redact(error.message)}`))
      const timeout = new Promise((resolve) => (timer = setTimeout(resolve, answerTimeoutMs, null)))
      const result = await Promise.race([waiter.answer, timeout])
      body = !result
        ? `No answer from the ${lead} after ${Math.round(answerTimeoutMs / 60000)} min. Send it again if you still need one.`
        : result.error
          ? `The ${lead} stopped with an error: ${result.error}`
          : result.answer || "(no answer)"
    } catch (error) {
      body = `Sorry, that failed: ${error.message}`
    } finally {
      clearTimeout(timer)
      waiter.cancel()
    }
    try {
      await reply(body)
      log(`telegram: answered #${id}`)
    } catch (error) {
      log(`telegram: reply to #${id} failed: ${redact(error.message)}`)
    }
    state.pending = state.pending.filter((p) => p !== entry && !(p.key === key && p.id === id))
    save()
  }

  // "/status": a fresh live status message; "/stop": the lead's run stops (its quests are called back).
  async function runCommand(command, reply, id) {
    try {
      if (command === "status") {
        if (!live) return void (await reply("No live status here (the Telegram integration cannot edit messages)."))
        await live.refresh()
        log(`telegram: /status #${id}`)
      } else if (command === "stop") {
        const busy = team.work?.().find((w) => w.agent === lead)
        if (!busy) return void (await reply(`Nothing to stop: the ${lead} is idle.`))
        const result = await team.call({ target: lead, method: "stop" })
        if (result && result.ok === false) throw new Error(result.error?.message ?? "stop refused")
        log(`telegram: /stop #${id}`)
        await reply(`Stopping the ${lead}'s run: "${oneLine(busy.run, 80)}".`)
      }
    } catch (error) {
      log(`telegram: /${command} failed: ${redact(error.message)}`)
      await reply(`/${command} failed: ${error.message}`).catch(() => {})
    }
  }

  // Owner only, checked again here (the listener checks first): dropped events are logged once per reason.
  const dropped = new Set()
  const fromOwner = (event) => {
    const why = whyNotOwnerEvent(event, owner)
    if (!why) return true
    if (!dropped.has(why)) {
      dropped.add(why)
      log(`telegram: dropped a message that is not the owner's (${why}); further ones for this reason are not logged`)
    }
    return false
  }

  // The listener's queue (companion/capabilities/integrations.js), read in-process: no HTTP, no tab.
  ;(async () => {
    let cursor = { after: 0, from: null }
    let failures = 0
    while (!controller.signal.aborted) {
      try {
        const { boot, next, events } = await integrations.events({ ...cursor, wait: pollWaitMs })
        cursor = { after: next, from: boot }
        failures = 0
        for (const event of events) {
          if (event.kind !== "message" || event.integration !== INTEGRATION || controller.signal.aborted) continue
          if (!fromOwner(event)) continue
          handle(event).catch((error) => log(`telegram: message failed: ${redact(error.message)}`))
        }
      } catch (error) {
        failures++
        log(`telegram: event poll failed: ${redact(error.message)}`)
        await Bun.sleep(Math.min(60_000, 1000 * 2 ** Math.min(failures, 6)))
      }
    }
  })()

  log(`telegram: bridge on, owner messages → ${lead}, ${thread ? `topic "${desk}"` : "plain chat"}`)
  const bridge = {
    lead,
    get thread() {
      return thread // the topic's id, or null: the plain chat
    },
    notify,
    live,
    stop() {
      controller.abort()
      live?.stop()
      if (bridges.get(desk) === bridge) bridges.delete(desk)
    },
  }
  bridges.set(desk, bridge)
  return bridge
}
