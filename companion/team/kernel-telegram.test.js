import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildDesk } from "../../backend/kernel/index.js"
import { notify, runReport, startKernelTelegram } from "./kernel-telegram.js"
import { createKernelTeam } from "./kernel-team.js"
import { artifact } from "./kernel-status.fixtures.js"
import { ownerIdFrom, whyNotOwner, whyNotOwnerEvent } from "../shared/telegram-owner.js"

// The bridge against a fake listener queue and a fake team with the kernel team's surface
// (stream / send / work), plus one run through the real kernel team. No network.

const CHAT = "987654321" // must never show up in the state file or the log
const tmp = () => mkdtempSync(join(tmpdir(), "ktg-"))
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out")
    await Bun.sleep(5)
  }
}

// The listener's side (companion/capabilities/integrations.js): an event queue and send_message.
function fakeIntegrations({ topics = false, live = false } = {}) {
  const boot = "boot-1"
  const events = []
  const sent = []
  const created = []
  const status = [] // live.send / live.edit calls
  let statusId = 500
  let seq = 0
  let wake = null
  return {
    sent,
    created,
    status,
    listening: ["telegram"],
    // As the listener emits it: the owner's own message in their private chat.
    push(e) {
      events.push({ kind: "message", integration: "telegram", chat: CHAT, from: "Owner", owner: true, chatType: "private", fromId: CHAT, forwarded: false, seq: ++seq, ...e })
      wake?.()
    },
    async events({ after = 0, from = null, wait = 0 }) {
      const since = from === boot ? after : 0
      const pending = () => events.filter((e) => e.seq > since)
      if (!pending().length && wait) await new Promise((r) => ((wake = r), setTimeout(r, Math.min(wait, 20))))
      return { boot, next: seq, events: pending() }
    },
    async call(name, tool, args) {
      sent.push({ name, tool, args })
      return { text: "Sent.", isError: false }
    },
    get: (name) =>
      name === "telegram"
        ? {
            topics: { enabled: async () => topics, create: async (n) => (created.push(n), 77) },
            ...(live
              ? {
                  live: {
                    send: async ({ text, thread_id }) => (status.push({ op: "send", text, thread_id }), ++statusId),
                    edit: async (id, { text }) => void status.push({ op: "edit", id, text }),
                  },
                }
              : {}),
          }
        : null,
  }
}

// The kernel team's surface (companion/team/kernel-team.js): one run at a time, its messages streamed.
// guides: false — a `guide` call finds no run left to guide (it ended first): {delivered: false}.
function fakeTeam({ auto = true, guides = true } = {}) {
  const clients = new Set()
  const queue = []
  const sends = []
  let running = null
  let seq = 0
  const emit = (m) => {
    const event = { type: "state", id: "head", patch: { messages: { from: 0, items: [{ id: `k${++seq}`, ...m }] } } }
    for (const c of clients) c(event)
  }
  const next = () => {
    if (running || !queue.length) return
    running = queue.shift()
    emit({ role: "user", content: running.text, from: running.from })
    if (auto) finish(`head heard: ${running.text}`)
  }
  const finish = (answer, error = null) => {
    running = null
    emit(error ? { role: "assistant", action: "answer", content: `Error: ${error}`, error } : { role: "assistant", action: "answer", content: answer })
    next()
  }
  const calls = []
  return {
    sends,
    calls,
    finish,
    async call(request) {
      calls.push(request)
      if (request.method === "stop" && running) finish(null, "stopped")
      if (request.method === "guide") {
        // A guidance row joins the run in progress, as the kernel team streams it.
        const delivered = guides && !!running
        if (delivered) emit({ role: "user", kind: "guidance", from: request.args[1]?.from, content: request.args[0] })
        return { ok: true, value: { delivered } }
      }
      return { ok: true, value: null }
    },
    stream({ signal }) {
      const encoder = new TextEncoder()
      const body = new ReadableStream({
        start(controller) {
          const send = (e) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
          send({ type: "snapshot", registry: { requiredId: "head" }, states: { head: { messages: [] } } })
          clients.add(send)
          signal?.addEventListener("abort", () => (clients.delete(send), controller.close()))
        },
      })
      return new Response(body)
    },
    send({ agent, text, from }) {
      sends.push({ agent, text, from })
      queue.push({ text, from })
      queueMicrotask(next)
      return { ok: true, value: { agent, queued: true } }
    },
    work: () => (running ? [{ agent: "head", lead: true, run: running.text }] : []),
  }
}

const started = []
const start = async (opts) => {
  const logs = []
  const bridge = await startKernelTelegram({ desk: "desk-x", hello: null, pollWaitMs: 20, owner: CHAT, log: (l) => logs.push(l), ...opts })
  started.push(bridge)
  return Object.assign(bridge, { logs })
}
afterEach(() => started.splice(0).forEach((b) => b.stop()))
const saved = (stateDir) => {
  try {
    return JSON.parse(readFileSync(join(stateDir, "telegram.json"), "utf8"))
  } catch {
    return null
  }
}
const replies = (integrations) => integrations.sent.filter((s) => s.args.reply_to).map((s) => s.args)

test("an owner message goes to the lead and the answer comes back as a reply", async () => {
  const stateDir = tmp()
  const team = fakeTeam()
  const integrations = fakeIntegrations()
  const bridge = await start({ team, integrations, stateDir })
  expect(bridge.lead).toBe("head")
  expect(bridge.thread).toBe(null)
  integrations.push({ id: 5, text: "  How is ACME?  ", from: "Ana" })
  await until(() => replies(integrations).length === 1)
  expect(team.sends).toEqual([{ agent: "head", text: "How is ACME?", from: "telegram:Ana" }])
  expect(replies(integrations)[0]).toEqual({ chat_id: CHAT, reply_to: 5, text: "head heard: How is ACME?" })
  const saved = readFileSync(join(stateDir, "telegram.json"), "utf8")
  expect(JSON.parse(saved).pending).toEqual([])
  expect(Object.values(JSON.parse(saved).seen)).toEqual([5])
  expect(saved).not.toContain(CHAT) // hashed
  expect(bridge.logs.join("\n")).not.toContain(CHAT)
})

test("a restart never answers a message twice", async () => {
  const stateDir = tmp()
  const first = fakeIntegrations()
  const a = await start({ team: fakeTeam(), integrations: first, stateDir })
  first.push({ id: 5, text: "one" })
  await until(() => replies(first).length === 1)
  a.stop()
  // The new process's listener re-delivers #5 (an unconfirmed update) and then #6.
  const second = fakeIntegrations()
  const team = fakeTeam()
  await start({ team, integrations: second, stateDir })
  second.push({ id: 5, text: "one" })
  second.push({ id: 6, text: "two" })
  await until(() => replies(second).length === 1)
  await Bun.sleep(50)
  expect(team.sends.map((s) => s.text)).toEqual(["two"])
  expect(replies(second).map((r) => r.reply_to)).toEqual([6])
})

test("/queue while the lead works: queued at once, answered in order", async () => {
  const team = fakeTeam({ auto: false })
  const integrations = fakeIntegrations()
  await start({ team, integrations, stateDir: tmp() })
  integrations.push({ id: 1, text: "first" })
  await until(() => team.work().length === 1)
  integrations.push({ id: 2, text: "/queue@DeskBot  second\nwith detail " })
  await until(() => replies(integrations).length === 1)
  expect(replies(integrations)[0]).toMatchObject({ reply_to: 2, text: expect.stringContaining('Queued: the head is working on "first"') })
  expect(team.calls).toEqual([]) // not guidance
  expect(team.sends.map((s) => s.text)).toEqual(["first", "second\nwith detail"])
  team.finish("answer one")
  await until(() => team.work().length === 1 && replies(integrations).length === 2)
  team.finish("answer two")
  await until(() => replies(integrations).length === 3)
  expect(replies(integrations).slice(1).map((r) => [r.reply_to, r.text])).toEqual([
    [1, "answer one"],
    [2, "answer two"],
  ])
})

test("while the lead works: a message is guidance for its run, read at its next step; the run's answer still comes", async () => {
  const stateDir = tmp()
  const team = fakeTeam({ auto: false })
  const integrations = fakeIntegrations()
  const bridge = await start({ team, integrations, stateDir })
  integrations.push({ id: 1, text: "plan the day", from: "Ana" })
  await until(() => team.work().length === 1)
  integrations.push({ id: 2, text: "  skip DELTA today ", from: "Ana" })
  await until(() => replies(integrations).length === 1)
  expect(team.calls).toEqual([{ target: "head", method: "guide", args: ["skip DELTA today", { from: "telegram:Ana" }] }])
  expect(team.sends.map((s) => s.text)).toEqual(["plan the day"]) // no new run
  expect(replies(integrations)[0].reply_to).toBe(2)
  expect(replies(integrations)[0].text).toBe('Guidance for the head\'s run "plan the day": it reads this at its next step. To run it as new work after this run instead, send /queue <text>.')
  expect(bridge.logs).toContain("telegram: message #2 → head (guidance)")
  // Guidance is not awaited and never resent after a restart; the guidance row is not a new run, so the
  // run's answer still goes to the message that started it.
  expect(saved(stateDir).pending.map((p) => p.id)).toEqual([1])
  expect(Object.values(saved(stateDir).seen)).toEqual([2])
  team.finish("answer one, without DELTA")
  await until(() => replies(integrations).length === 2)
  expect(replies(integrations)[1]).toMatchObject({ reply_to: 1, text: "answer one, without DELTA" })
  expect(saved(stateDir).pending).toEqual([])
})

test("a run that ends before the note lands: the message becomes new work", async () => {
  const team = fakeTeam({ auto: false, guides: false })
  const integrations = fakeIntegrations()
  await start({ team, integrations, stateDir: tmp() })
  integrations.push({ id: 1, text: "first" })
  await until(() => team.work().length === 1)
  integrations.push({ id: 2, text: "then this" })
  await until(() => team.sends.length === 2)
  expect(team.calls.map((c) => c.method)).toEqual(["guide"])
  expect(team.sends.map((s) => s.text)).toEqual(["first", "then this"])
  team.finish("one")
  await until(() => replies(integrations).some((r) => r.reply_to === 1) && team.work().length === 1)
  team.finish("two")
  await until(() => replies(integrations).some((r) => r.reply_to === 2 && r.text === "two"))
})

test("/queue when idle is a new run; /queue with no text says how, and nothing goes to the lead", async () => {
  const team = fakeTeam()
  const integrations = fakeIntegrations()
  await start({ team, integrations, stateDir: tmp() })
  integrations.push({ id: 1, text: "/queue" })
  await until(() => replies(integrations).length === 1)
  expect(replies(integrations)[0].text).toBe("/queue needs the work after it: /queue <what the head should do after its run>.")
  expect(team.sends).toEqual([])
  integrations.push({ id: 2, text: "/queue check the book" })
  await until(() => replies(integrations).length === 2)
  expect(team.sends.map((s) => s.text)).toEqual(["check the book"])
  expect(replies(integrations)[1]).toMatchObject({ reply_to: 2, text: "head heard: check the book" })
  expect(team.calls).toEqual([])
})

test("a failed run is reported, not left hanging", async () => {
  const team = fakeTeam({ auto: false })
  const integrations = fakeIntegrations()
  await start({ team, integrations, stateDir: tmp() })
  integrations.push({ id: 3, text: "go" })
  await until(() => team.work().length === 1)
  team.finish(null, "model down")
  await until(() => replies(integrations).length === 1)
  expect(replies(integrations)[0].text).toBe("The head stopped with an error: model down")
})

test("a message cut off by a restart: the owner is told to resend it", async () => {
  const stateDir = tmp()
  const first = fakeIntegrations()
  const a = await start({ team: fakeTeam({ auto: false }), integrations: first, stateDir })
  first.push({ id: 9, text: "long research" })
  await until(() => saved(stateDir)?.pending.length === 1)
  a.stop()
  const second = fakeIntegrations()
  await start({ team: fakeTeam(), integrations: second, stateDir })
  await until(() => second.sent.length === 1)
  expect(second.sent[0].args.text).toContain("restarted before the head answered")
  expect(second.sent[0].args.text).toContain("long research")
  expect(second.sent[0].args.chat_id).toBeUndefined() // the owner's chat
  expect(JSON.parse(readFileSync(join(stateDir, "telegram.json"), "utf8")).pending).toEqual([])
})

test("topics on: one topic, made once; hello once; notify posts there", async () => {
  const stateDir = tmp()
  const one = fakeIntegrations({ topics: true })
  const a = await start({ team: fakeTeam(), integrations: one, stateDir, hello: undefined })
  expect(a.thread).toBe(77)
  expect(one.created).toEqual(["desk-x"])
  expect(one.sent.map((s) => s.args)).toEqual([{ text: "desk-x connected: message me here and the head answers.", thread_id: 77 }])
  a.stop()
  const two = fakeIntegrations({ topics: true })
  const b = await start({ team: fakeTeam(), integrations: two, stateDir, hello: undefined })
  expect(two.created).toEqual([]) // the saved topic
  expect(two.sent).toEqual([]) // already greeted there
  expect(await b.notify("run report")).toBe(true)
  expect(await notify("from kernel.js")).toBe(true) // the module-level notify finds the one bridge
  expect(two.sent.map((s) => s.args)).toEqual([
    { text: "run report", thread_id: 77 },
    { text: "from kernel.js", thread_id: 77 },
  ])
  // A message asked in the topic is answered in the topic.
  two.push({ id: 4, text: "status?", thread: 77 })
  await until(() => replies(two).length === 1)
  expect(replies(two)[0]).toMatchObject({ reply_to: 4, thread_id: 77 })
})

test("topics off: the plain chat; notify without a bridge is false", async () => {
  expect(await notify("nobody")).toBe(false)
  const integrations = fakeIntegrations()
  const bridge = await start({ team: fakeTeam(), integrations, stateDir: tmp(), hello: undefined })
  expect(bridge.thread).toBe(null)
  expect(integrations.created).toEqual([])
  expect(integrations.sent.map((s) => s.args)).toEqual([{ text: "desk-x connected: message me here and the head answers." }])
})

test("not started without a telegram listener", async () => {
  const integrations = { ...fakeIntegrations(), listening: [] }
  await expect(startKernelTelegram({ team: fakeTeam(), integrations, stateDir: tmp() })).rejects.toThrow("does not run here")
})

// The real kernel team (companion/team/kernel-team.js) on a two-agent fixture desk with a scripted model:
// a lead "head" holding one helper, free-form answers (report: false).
const fixtureDesk = (dir, infer) => ({
  state: join(dir, "state"),
  workspace: dir,
  start: async () => ({ desk: buildDesk({ name: "head", role: "lead", team: "fx", report: false, tools: [{ type: "agent", name: "helper", role: "help", report: false }] }, { infer }) }),
})

test("through the real kernel team: the lead answers the Telegram sender", async () => {
  const dir = tmp()
  const infer = async (prompt) => {
    // the # REQUEST section alone: history, tools and the response format follow it (2026-10-17 prompt order)
    const request = prompt.slice(prompt.indexOf("# REQUEST")).split("\n\n# ")[0]
    return JSON.stringify({ thought: "t", calls: [], answer: "head: " + request.split("\n")[0] + " / " + request.split("\n").slice(1).join(" ") })
  }
  const team = await createKernelTeam({ desk: fixtureDesk(dir, infer), port: 0, live: false })
  const integrations = fakeIntegrations()
  await start({ team, integrations, stateDir: join(dir, "state") })
  integrations.push({ id: 11, text: "What is the plan today?", from: "Ana" })
  await until(() => replies(integrations).length === 1)
  expect(replies(integrations)[0]).toEqual({ chat_id: CHAT, reply_to: 11, text: "head: # REQUEST (from telegram:Ana) / What is the plan today?" })
  team.terminate()
})

test("through the real kernel team: a message during the run is owner guidance its next step reads", async () => {
  const dir = tmp()
  let release
  const hold = new Promise((r) => (release = r))
  const prompts = []
  const infer = async (prompt) => {
    prompts.push(prompt)
    if (prompts.length === 1) await hold // the first step is still thinking when the note arrives
    const note = prompt.includes("# OWNER GUIDANCE") ? prompt.split("\n").find((l) => l.startsWith("> ")) : "none"
    return JSON.stringify({ thought: "t", calls: [], answer: `guided by ${note}` })
  }
  const team = await createKernelTeam({ desk: fixtureDesk(dir, infer), port: 0, live: false })
  const integrations = fakeIntegrations()
  await start({ team, integrations, stateDir: join(dir, "state") })
  integrations.push({ id: 11, text: "Plan the day", from: "Ana" })
  await until(() => team.work().length === 1 && prompts.length === 1)
  integrations.push({ id: 12, text: "Skip DELTA", from: "Ana" })
  await until(() => replies(integrations).length === 1)
  expect(replies(integrations)[0]).toMatchObject({ reply_to: 12, text: expect.stringContaining("it reads this at its next step") })
  release()
  await until(() => replies(integrations).length === 2)
  // The answer written before the note was held; the next step read the note, once, and its answer is the run's.
  expect(replies(integrations)[1]).toEqual({ chat_id: CHAT, reply_to: 11, text: "guided by > telegram:Ana: Skip DELTA" })
  expect(prompts.length).toBe(2)
  team.terminate()
})

// ---- owner only -------------------------------------------------------------------------------

test("intake is the owner's own account only: other chats, users, forwards are dropped, logged once, no ids", async () => {
  const team = fakeTeam()
  const integrations = fakeIntegrations()
  const bridge = await start({ team, integrations, stateDir: tmp() })
  const OTHER = "123123123"
  integrations.push({ id: 1, text: "group", chat: "-100777000111", chatType: "group", fromId: CHAT })
  integrations.push({ id: 2, text: "someone else", chat: OTHER, fromId: OTHER })
  integrations.push({ id: 3, text: "someone else again", chat: OTHER, fromId: OTHER })
  integrations.push({ id: 4, text: "forwarded", forwarded: true })
  integrations.push({ id: 5, text: "unmarked", owner: undefined })
  integrations.push({ id: 6, text: "not the owner in my chat", fromId: OTHER })
  integrations.push({ id: 7, text: "mine" })
  await until(() => replies(integrations).length === 1)
  expect(team.sends.map((s) => s.text)).toEqual(["mine"])
  expect(replies(integrations)[0]).toMatchObject({ reply_to: 7, chat_id: CHAT })
  const dropped = bridge.logs.filter((l) => l.includes("dropped"))
  expect(dropped.length).toBe(4) // one per reason (group, another user ×3, forwarded, unmarked)
  const log = bridge.logs.join("\n")
  for (const id of [CHAT, OTHER, "-100777000111"]) expect(log).not.toContain(id)
})

test("the listener's check on raw Telegram messages", () => {
  const OWNER = 4242424242
  const msg = (extra = {}) => ({ message_id: 1, date: 1, text: "hi", chat: { id: OWNER, type: "private" }, from: { id: OWNER, is_bot: false }, ...extra })
  expect(whyNotOwner(msg(), String(OWNER))).toBeNull()
  expect(whyNotOwner(msg({ chat: { id: -1001, type: "supergroup" } }), OWNER)).toBe("a supergroup chat")
  expect(whyNotOwner(msg({ chat: { id: -1002, type: "channel" } }), OWNER)).toBe("a channel chat")
  expect(whyNotOwner(msg({ from: { id: 7 }, chat: { id: 7, type: "private" } }), OWNER)).toBe("another user")
  expect(whyNotOwner(msg({ from: { id: 7 } }), OWNER)).toBe("another user")
  expect(whyNotOwner(msg({ forward_origin: { type: "user", sender_user: { id: 7 } } }), OWNER)).toBe("forwarded from someone else")
  expect(whyNotOwner(msg({ forward_origin: { type: "hidden_user", sender_user_name: "x" } }), OWNER)).toBe("forwarded from someone else")
  expect(whyNotOwner(msg({ forward_origin: { type: "user", sender_user: { id: OWNER } } }), OWNER)).toBeNull() // the owner's own, forwarded
  expect(whyNotOwner(msg({ edit_date: 2 }), OWNER)).toBe("an edited message")
  expect(whyNotOwner(msg({ sender_chat: { id: -1003 } }), OWNER)).toBe("sent on behalf of a chat or business")
  expect(whyNotOwner(msg(), null)).toBe("no owner configured")
  expect(whyNotOwnerEvent({ owner: true, chatType: "private", chat: "5", fromId: "5" })).toBeNull()
  expect(whyNotOwnerEvent({ owner: true, chatType: "private", chat: "5", fromId: "6" })).toBe("another chat")
  expect(ownerIdFrom({ TELEGRAM_CHAT_ID: " 11 " })).toBe("11")
  expect(ownerIdFrom({ TELEGRAM_CHAT_ID: "11", TELEGRAM_OWNER_ID: "12" })).toBe("12")
  expect(ownerIdFrom({})).toBeNull()
})

// ---- commands and the live status ------------------------------------------------------------

test("/stop stops the lead's run; /stop when idle says so; neither goes to the lead", async () => {
  const team = fakeTeam({ auto: false })
  const integrations = fakeIntegrations()
  await start({ team, integrations, stateDir: tmp() })
  integrations.push({ id: 1, text: "/stop" })
  await until(() => replies(integrations).length === 1)
  expect(replies(integrations)[0].text).toBe("Nothing to stop: the head is idle.")
  integrations.push({ id: 2, text: "long run" })
  await until(() => team.work().length === 1)
  integrations.push({ id: 3, text: "/stop@DeskBot" })
  await until(() => replies(integrations).length === 3)
  expect(team.calls).toEqual([{ target: "head", method: "stop" }])
  expect(team.sends.map((s) => s.text)).toEqual(["long run"])
  const texts = replies(integrations).map((r) => [r.reply_to, r.text])
  expect(texts).toContainEqual([3, 'Stopping the head\'s run: "long run".'])
  expect(texts).toContainEqual([2, "The head stopped with an error: stopped"])
})

test("/status sends a status message (a snapshot when idle); without live editing it says so", async () => {
  const integrations = fakeIntegrations({ live: true })
  const team = fakeTeam()
  await start({ team, integrations, stateDir: tmp() })
  integrations.push({ id: 1, text: "/status" })
  await until(() => integrations.status.length === 1)
  expect(integrations.status[0]).toMatchObject({ op: "send", text: "<b>desk-x</b> · IDLE · no run yet" })
  expect(team.sends).toEqual([])
  const plain = fakeIntegrations()
  await start({ team: fakeTeam(), integrations: plain, stateDir: tmp() })
  plain.push({ id: 1, text: "/status" })
  await until(() => replies(plain).length === 1)
  expect(replies(plain)[0].text).toContain("No live status here")
})

test("through the real kernel team: a live status message for the run, final edit DONE, reply as before", async () => {
  const dir = tmp()
  const infer = async () => (await Bun.sleep(120), JSON.stringify({ thought: "t", calls: [], answer: "VERDICT: all quiet\nCONFIDENCE: 0.4" }))
  const team = await createKernelTeam({ desk: fixtureDesk(dir, infer), port: 0, live: false })
  const integrations = fakeIntegrations({ live: true })
  await start({ team, integrations, stateDir: join(dir, "state"), live: { graceMs: 0, minIntervalMs: 20 } })
  integrations.push({ id: 11, text: "Anything new?", from: "Ana" })
  await until(() => replies(integrations).length === 1)
  await until(() => integrations.status.some((c) => c.text.includes("DONE")))
  const [first, ...rest] = integrations.status
  expect(first).toMatchObject({ op: "send" })
  expect(first.text).toContain("<b>desk-x</b> · LIVE &lt;1m · via telegram")
  expect(rest.every((c) => c.op === "edit" && c.id === 501)).toBe(true)
  expect(rest.at(-1).text).toContain("✅ <b>head</b> — all quiet")
  expect(replies(integrations)[0]).toMatchObject({ reply_to: 11, text: "VERDICT: all quiet\nCONFIDENCE: 0.4" })
  team.terminate()
})

// ---- run reports ------------------------------------------------------------------------------

test("runReport: the lead's report, one line per desk-level artifact, open gates; artifacts optional", () => {
  const artifacts = {
    "desk.top5": artifact("desk.top5", "list", "desk", "Top 5", "DELTA ↑ 0.92 · AMD ↑ 0.81"),
    "desk.book": artifact("desk.book", "book", "desk", "Book", "equity $10,000\n · flat"),
    "desk.calibration": artifact("desk.calibration", "calibration", "desk", "Calibration", ""),
    "desk.board": artifact("desk.board", "board", "desk", "Desk board", "3 entries"),
    "head.checklist": artifact("head.checklist", "checklist", "desk", "Run checklist", "7/7 done"),
    "news.notes": artifact("news.notes", "notes", "news", "News notes", "a team's own"),
  }
  const request = { from: "schedule (booked by head)", text: "Read the market\n and plan" }
  expect(runReport({ desk: "demo-desk", request, answer: " VERDICT: wait \n", flags: ["report missing GAPS"], artifacts, deskTeam: "desk" })).toBe(
    ["demo-desk · schedule (booked by head): Read the market and plan", "", "VERDICT: wait", "", "Book: equity $10,000 · flat", "Top 5: DELTA ↑ 0.92 · AMD ↑ 0.81", "", "(gates open: report missing GAPS)"].join("\n"),
  )
  // As a list, or with no desk team (every owner's); without artifacts or flags: the report alone.
  expect(runReport({ desk: "d", request, answer: "ok", flags: null, artifacts: Object.values(artifacts), deskTeam: "desk" })).toEndWith("Book: equity $10,000 · flat\nTop 5: DELTA ↑ 0.92 · AMD ↑ 0.81")
  expect(runReport({ desk: "d", request, answer: "ok", artifacts })).toContain("News notes: a team's own")
  expect(runReport({ desk: "d", request: { text: "go" }, answer: "ok" })).toBe("d · run: go\n\nok")
})
