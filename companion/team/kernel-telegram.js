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
// Conversation (2026-10-24 owner: "When I reply in telegram, both the desk seems to listening for the same input … when
// giving multiple options, when the user responds, we send in the context. This can be the last 5 conversations. The
// rest can be dropped"): every message a desk sends (an answer, a report, an audio file, an image, a question) is kept
// by id (state.sent ≤ SENT_KEEP), so the owner's reply to one goes to the desk that sent it — the listening desk hands
// it over — whichever desk listens. A desk's questions (its talk artifact's asks) come as messages with a button per
// option; a tap, or a reply in the owner's words, answers that question (the talk's reply, as on the dashboard), and
// the message then shows what was chosen. Every message to a lead carries the conversation before it — the last
// TALK_TURNS exchanges of this chat with that desk (state.talk), oldest dropped — and what the replied-to message said.
// A photo the owner sends is kept in the desk's images (saveImage) and named in the message.
//
// Topic: a bot can keep forum topics in its private chat (Bot API 9.3+) once its threaded mode is on
// in @BotFather (getMe has_topics_enabled). Then the desk gets one topic, created once and named after
// the desk, where notify() posts; otherwise everything goes to the plain chat.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { whyNotOwnerEvent } from "../shared/telegram-owner.js"
import { startLiveStatus } from "./kernel-live.js"
import { deskBriefs, isRunRequest, isRunWork } from "./kernel-status.js"

const INTEGRATION = "telegram"
const POLL_WAIT_MS = 25_000
const ANSWER_TIMEOUT_MS = 4 * 60 * 60 * 1000 // a run with no answer by then (it never started, or hangs) is given up
const PREVIEW_CHARS = 200
const SENT_KEEP = 300 // the desk's sent messages kept by id (replies route by them)
const TALK_TURNS = 5 // the owner's turns kept with what the desk said around them
const TALK_CHARS = 400 // per line of the conversation

const bridges = new Map() // desk name -> bridge: notify() from anywhere in this process
const early = new Map() // desk name -> sends recorded before its bridge started

// A message a desk sent outside the bridge (an audio file, an image: audiogen.js, imagegen.js): kept by id, so the
// owner's reply to it comes back to this desk, and in the conversation the next message carries.
export function recordSent(desk, { message, kind = "message", text = "", ref = null } = {}) {
  if (!message) return
  const bridge = bridges.get(desk)
  if (bridge) return bridge.record({ message, kind, text, ref })
  early.set(desk, [...(early.get(desk) ?? []), { message, kind, text, ref }].slice(-20))
}
const ownerOf = (message) => {
  for (const [desk, bridge] of bridges) {
    const sent = bridge.sentOf(message)
    if (sent) return { desk, bridge, sent }
  }
  return null
}

// The conversation kept: the last `turns` owner lines with the desk's lines between and after them (older ones dropped).
export function trimTalk(talk, turns = TALK_TURNS) {
  const owners = talk.map((t, i) => (t.who === "owner" ? i : -1)).filter((i) => i >= 0)
  if (owners.length <= turns) return talk.slice(-turns * 6)
  return talk.slice(owners[owners.length - turns - 1] + 1).slice(-turns * 6)
}
// The conversation as the lead reads it, oldest first.
export function talkText(talk, desk) {
  return talk.map((t) => `${t.who === "owner" ? "owner" : desk}: ${t.text}`).join("\n")
}

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

function stateFile(file, log = () => {}) {
  const state = { seen: {}, pending: [], thread: null, announced: [], sent: [], talk: [], asks: {} }
  try {
    Object.assign(state, JSON.parse(readFileSync(file, "utf8")))
  } catch (error) {
    // a file there that does not read: set aside and said, never silently reset (2026-10-23 audit)
    if (error.code !== "ENOENT") {
      const to = `${file}.unreadable-${Date.now()}`
      try {
        renameSync(file, to)
      } catch {}
      log(`telegram: its state did not read (${error.message}) — kept as ${to}; answers owed before the restart are not re-sent`)
    }
  }
  return {
    state,
    save() {
      writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 1))
      renameSync(`${file}.tmp`, file) // atomic: a crash never leaves half a cursor
    },
  }
}

// The lead's runs from the team's stream. A run starts with its request row (isRunRequest: request + sender) and
// ends with an answer (or an error) before the next one starts, so the answer after our request's
// start is ours. wait(from, text) → { answer: Promise<{answer, error}>, cancel }. 2026-10-17 critic: an owner chat's
// question (kind "chat") or guidance is no run's start — a web Ask during a Telegram-started run lost that run's reply.
function followLead(team, signal, log = () => {}, onArtifact = () => {}) {
  let eventWarned = false
  const waiting = [] // in hand-off order
  let lead = null
  let current = null
  let last = 0 // kernel message ids are k<boot>-<n> (n increasing in this process): a trimmed or reset list repeats old ones
  let found
  const snapshot = new Promise((resolve) => (found = resolve))
  const seq = (id) => Number(String(id ?? "").match(/(\d+)$/)?.[1]) || 0

  function take(m) {
    if (isRunRequest(m)) {
      // a new run (guidance joins the run in progress; a chat is beside the runs)
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
      for (const a of Object.values(e.kernel?.artifacts ?? {})) onArtifact(a)
    } else if (e.type === "kernel" && e.artifact) {
      onArtifact(e.artifact)
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
          } catch (error) {
            if (!eventWarned) log(`telegram: an event from the desk could not be followed (${error.message})`)
            eventWarned = true
          }
        }
      }
    }
  })()
    .catch((error) => {
      // the desk's stream ended under it: what waits on an answer hears so now, not at its timeout (2026-10-23 audit)
      if (!signal.aborted) log(`telegram: the desk's stream ended (${error?.message ?? error}) — the owner's waiting messages get no answer`)
      for (const w of [...waiting, ...(current ? [current] : [])]) w.resolve({ answer: null, error: "the desk's stream ended" })
      waiting.length = 0
      current = null
    })
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
  saveImage = null, // async (bytes, note) → the image's id in the desk's images: a photo the owner sends is kept
  answerTimeoutMs = ANSWER_TIMEOUT_MS,
  pollWaitMs = POLL_WAIT_MS,
  // 2026-10-23 owner ("I want to make that live preview for every desk"): inbound false = this desk does not take the
  // bot's messages (one desk listens per bot) but still posts its runs' live status and reports in its own topic
  inbound = true,
  via = null, // inbound false: the desk that takes the bot's messages (said in the greeting)
}) {
  const telegram = integrations?.get?.(INTEGRATION)
  if (!telegram || telegram.error) throw new Error(`the telegram integration is not here${telegram?.error ? ` (${telegram.error})` : ""}`)
  if (inbound && !integrations.listening?.includes(INTEGRATION)) throw new Error("the telegram listener does not run here")
  mkdirSync(stateDir, { recursive: true })
  const { state, save } = stateFile(join(stateDir, "telegram.json"), log)
  const controller = new AbortController()
  let talkReady = null // the talk questions wait until the bridge is set up (topic, state)
  const talkQueue = []
  const follow = followLead(team, controller.signal, log, (a) => {
    if (a?.view !== "talk") return
    if (talkReady) talkReady = talkReady.then(() => onTalk(a)).catch((error) => log(`telegram: questions: ${redact(error.message)}`))
    else talkQueue.push(a)
  })
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

  // → the sent message ids (the integration's host-only messages.post; the send_message tool tells none).
  async function sendMessage(args) {
    if (telegram.messages?.post) return (await telegram.messages.post(args)).ids ?? []
    const result = await integrations.call(INTEGRATION, "send_message", args)
    if (result.isError) throw new Error(result.text)
    return []
  }
  function record({ message, kind, text, ref = null }) {
    if (!message) return
    state.sent = [...state.sent.filter((x) => x.id !== Number(message)), { id: Number(message), kind, text: oneLine(text, 300), ...(ref ? { ref } : {}), at: new Date().toISOString() }].slice(-SENT_KEEP)
    if (!["status", "greeting", "note"].includes(kind)) remember("desk", kind === "audio" ? `[audio sent: ${text}]` : kind === "image" ? `[image sent: ${text}]` : text)
    save()
  }
  function remember(who, text) {
    const line = oneLine(text, TALK_CHARS)
    if (!line) return
    state.talk = trimTalk([...state.talk, { who, text: line, at: new Date().toISOString() }])
  }
  const sentOf = (message) => state.sent.find((x) => x.id === Number(message)) ?? null
  // kind: what it is, kept with its ids (null: not kept — a greeting)
  async function post(args, kind = "message", ref = null) {
    const ids = await send(args)
    for (const id of ids) record({ message: id, kind, text: args.text, ref })
    return ids
  }
  async function send(args) {
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
  async function notify(text, kind = "report") {
    if (typeof text !== "string" || !text.trim()) return false
    try {
      await post({ text, ...(thread ? { thread_id: thread } : {}) }, kind) // no chat_id: the owner's chat
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
  const greeting = hello === undefined ? (inbound ? `${desk} connected: message me here and the ${lead} answers.` : `${desk}: the live status of its runs shows here${via ? ` (messages to the bot go to ${via})` : ""}.`) : hello
  if (greeting && !state.announced.includes(place)) {
    state.announced.push(place)
    save()
    await notify(greeting, "greeting")
  }
  for (const r of early.get(desk) ?? []) record(r)
  early.delete(desk)

  // The lead's run in progress or waiting to start (team.work()): an owner chat in flight is listed there too (stoppable
  // by /stop) but is no run — a message meanwhile is new work that starts at once, never guidance or "queued".
  const leadRunning = () => team.work?.().find((w) => w.agent === lead && isRunWork(w))

  // One owner message: to the lead, its answer back as a reply. The synchronous part (cursor, hand-off)
  // runs in arrival order, so the lead's queue keeps the owner's order.
  async function handle(event, routed = false) {
    // A button tap: the question it answers is this desk's, else the desk that sent that message takes it.
    if (event.kind === "choice") {
      const owner = sentOf(event.message) ? null : ownerOf(event.message)
      if (owner) return owner.bridge.take(event)
      return choose(event)
    }
    const key = keyOf(event.chat)
    const id = Number(event.id)
    if (!(id > (state.seen[key] ?? 0))) return // handed over before (a re-delivered update after a restart)
    // A reply to another desk's message: that desk takes it (its cursor, its lead, its conversation).
    if (!routed && event.reply_to && !sentOf(event.reply_to)) {
      const owner = ownerOf(event.reply_to)
      if (owner && owner.bridge !== bridge) {
        state.seen[key] = id
        save()
        log(`telegram: message #${id} replies to ${owner.desk}'s message → ${owner.desk}`)
        return owner.bridge.take(event)
      }
    }
    let raw = String(event.text ?? "").trim()
    if (event.image) raw = `${raw}${raw ? "\n" : ""}${await keepImage(event)}`
    if (!raw) return
    const reply = (body, kind = "answer") => post({ chat_id: event.chat, reply_to: id, ...(event.thread ? { thread_id: event.thread } : {}), text: body }, kind)
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
    // A reply to one of this desk's questions answers it (the talk's reply, as on the dashboard).
    const asked = event.reply_to ? sentOf(event.reply_to) : null
    if (asked?.kind === "ask" && !queue) {
      save()
      if (await answerAsk(asked, text, reply)) return
    }
    // new work carries the conversation before it; guidance joins a run that has it already (only what it replies to)
    const work = withContext(text, event)
    const note = withContext(text, event, { conversation: false })
    remember("owner", text)
    const busy = leadRunning()
    if (busy && !queue) {
      save()
      if (await guide(note, from, busy, reply, id)) return
      // The run ended before the note landed: new work, as when the lead is idle.
    }
    return ask(work, from, key, id, reply)
  }

  // The owner's words with the conversation before them and what they reply to, for the lead.
  function withContext(text, event, { conversation = true } = {}) {
    const re = event.reply_to ? sentOf(event.reply_to) : null
    const replied = re ? `${re.kind === "audio" ? "the audio " : re.kind === "image" ? "the image " : ""}"${re.text}"` : event.reply_text ? `"${oneLine(event.reply_text, 300)}"` : null
    const before = conversation ? talkText(state.talk, desk) : ""
    if (!before && !replied) return text
    return [
      before ? `[Telegram — the conversation before this message, oldest first (the last ${TALK_TURNS} exchanges):\n${before}]` : null,
      replied ? `[The owner replies to ${replied}]` : null,
      text,
    ]
      .filter(Boolean)
      .join("\n")
  }

  // A photo the owner sent: kept in the desk's images, named in the message.
  async function keepImage(event) {
    if (!saveImage || !telegram.files?.get) return "[the owner sent a photo — not kept: this desk keeps no images]"
    try {
      const imageId = await saveImage(await telegram.files.get(event.image), oneLine(event.text, 200) || "sent on Telegram")
      log(`telegram: the owner's photo kept as ${imageId}`)
      return `[the owner sent a photo on Telegram, kept as image ${imageId} — a reference for studio.generate {references: ["${imageId}"]} or a start for {from: "${imageId}"}]`
    } catch (error) {
      log(`telegram: the owner's photo was not kept: ${redact(error.message)}`)
      return `[the owner sent a photo — not kept: ${redact(error.message)}]`
    }
  }

  // ---- the desk's questions (talk.ask) with a button per option ----
  // A tap → the option's text as the owner's reply; a typed reply to the question → its words.
  async function choose(event) {
    const asked = sentOf(event.message)
    const option = /^t:(\d+)$/.exec(event.data)?.[1]
    const text = asked?.kind === "ask" && option != null ? asked.ref?.options?.[Number(option)] : null
    if (!text) return log("telegram: a tap on a message that is no open question here")
    await answerAsk(asked, text, (body) => post({ chat_id: event.chat, reply_to: event.message, ...(event.thread ? { thread_id: event.thread } : {}), text: body }, "answer"))
  }
  async function answerAsk(asked, text, reply) {
    const { artifact, ask: q } = asked.ref ?? {}
    remember("owner", `(to ${q}) ${text}`)
    const conversation = talkText(state.talk.slice(0, -1), desk)
    try {
      const result = await team.call({ target: "artifact", method: "reply", args: [{ id: artifact, ask: q, text, via: "Telegram", conversation }] })
      if (result && result.ok === false) throw new Error(result.error?.message ?? "reply refused")
      log(`telegram: the owner answered ${artifact} ${q} → ${result?.value?.keeper ?? "its asker"} (${result?.value?.delivered ?? "?"})`)
      save()
      await closeAsk(asked, `✓ ${text}`)
      return true
    } catch (error) {
      log(`telegram: the answer to ${q} did not land (${redact(error.message)}); sent as a message instead`)
      await reply(`That question is closed (${error.message}) — your words go to the ${lead} as a message.`).catch(() => {})
      return false
    }
  }
  async function closeAsk(asked, line) {
    const key = asked.ref?.key
    if (key && state.asks[key]?.closed) return
    if (key) (state.asks[key] = { ...(state.asks[key] ?? {}), message: asked.id, closed: true }), save()
    await telegram.messages?.close?.(asked.id, `${asked.ref?.full ?? asked.text}\n\n${line}`).catch((error) => log(`telegram: could not close the question's buttons: ${redact(error.message)}`))
  }
  // The talk artifacts' questions, as they change: a new open one is sent with its buttons; one answered or dropped
  // elsewhere (the dashboard) has its buttons closed with what happened.
  async function onTalk(twin) {
    const messages = twin?.state?.messages ?? []
    for (const q of messages.filter((m) => m.kind === "ask")) {
      const key = `${twin.id}:${q.id}:${q.at}`
      const known = state.asks[key]
      if (!known && q.status === "open") {
        state.asks[key] = { message: null, closed: false }
        save()
        const options = (Array.isArray(q.options) ? q.options : String(q.options ?? "").split("|")).map((o) => String(o).trim()).filter(Boolean).slice(0, 4)
        const full = `❓ ${desk} · ${q.from} asks:\n${q.text}${options.length ? "\n\nTap an answer, or reply to this message in your own words." : "\n\nReply to this message to answer."}`
        try {
          const ids = await post({ text: full, ...(thread ? { thread_id: thread } : {}), buttons: options.map((o, i) => [{ text: o, data: `t:${i}` }]) }, "ask", { artifact: twin.id, ask: q.id, key, options, full })
          state.asks[key].message = ids.at(-1) ?? null
          save()
          log(`telegram: ${q.from}'s question ${q.id} sent${options.length ? ` with ${options.length} buttons` : ""}`)
        } catch (error) {
          log(`telegram: ${q.from}'s question ${q.id} not sent: ${redact(error.message)}`)
        }
      } else if (known && !known.closed && known.message && q.status !== "open") {
        const r = messages.find((m) => m.kind === "reply" && m.re === q.id)
        const asked = sentOf(known.message)
        if (asked) await closeAsk(asked, q.status === "answered" ? `✓ answered${r ? `: ${oneLine(r.text, 200)}` : ""}` : `— dropped${q.reason ? `: ${oneLine(q.reason, 200)}` : ""}`)
      }
    }
    // keys of questions no longer in the artifact go (≤ 200 kept)
    const keys = Object.keys(state.asks)
    if (keys.length > 200) {
      for (const k of keys.slice(0, keys.length - 200)) delete state.asks[k]
      save()
    }
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
    await reply(`Guidance for the ${lead}'s run "${oneLine(busy.run, 60)}": it reads this at its next step. To run it as new work after this run instead, send /queue <text>.`, "note").catch((error) => log(`telegram: guidance note failed: ${redact(error.message)}`))
    return true
  }

  // New work for the lead (a new run, queued behind the current one): its answer back as a reply.
  async function ask(text, from, key, id, reply) {
    const entry = { key, id, text: oneLine(text, PREVIEW_CHARS), at: new Date().toISOString() }
    state.pending.push(entry)
    save()
    const busy = leadRunning()
    const waiter = follow.wait(from, text)
    let timer
    let body
    try {
      const sent = team.send({ agent: lead, text, from })
      if (!sent?.ok) throw new Error(sent?.error?.message ?? `the ${lead} did not take it`)
      log(`telegram: message #${id} → ${lead}${busy ? " (queued)" : ""}`)
      if (busy) reply(`Queued: the ${lead} is working on "${oneLine(busy.run, 60)}". The answer comes here when it is done.`, "note").catch((error) => log(`telegram: queued note failed: ${redact(error.message)}`))
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

  // The listener's queue (companion/capabilities/integrations.js), read in-process: no HTTP, no tab. A desk that only
  // posts (inbound false) reads none.
  ;(async () => {
    if (!inbound) return
    let cursor = { after: 0, from: null }
    let failures = 0
    while (!controller.signal.aborted) {
      try {
        const { boot, next, events } = await integrations.events({ ...cursor, wait: pollWaitMs })
        cursor = { after: next, from: boot }
        failures = 0
        for (const event of events) {
          if (!["message", "choice"].includes(event.kind) || event.integration !== INTEGRATION || controller.signal.aborted) continue
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

  talkReady = Promise.resolve()
  for (const a of talkQueue.splice(0)) talkReady = talkReady.then(() => onTalk(a)).catch((error) => log(`telegram: questions: ${redact(error.message)}`))

  log(inbound ? `telegram: bridge on, owner messages → ${lead}, ${thread ? `topic "${desk}"` : "plain chat"}` : `telegram: live status on (${thread ? `topic "${desk}"` : "plain chat"}); messages go to ${via ?? "the desk that listens"}`)
  const bridge = {
    lead,
    get thread() {
      return thread // the topic's id, or null: the plain chat
    },
    notify,
    live,
    record,
    sentOf,
    // An owner event the listening desk hands over (a reply to, or a tap under, this desk's message).
    take: (event) => (fromOwner(event) ? handle(event, true).catch((error) => log(`telegram: message failed: ${redact(error.message)}`)) : undefined),
    stop() {
      controller.abort()
      live?.stop()
      if (bridges.get(desk) === bridge) bridges.delete(desk)
    },
  }
  bridges.set(desk, bridge)
  return bridge
}
