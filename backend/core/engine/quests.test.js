// agent.md quest_minutes: a quest with no report by its deadline is called back in code (reports back failed, so the
// batch still joins); a report in time clears the timer. Supervisor: a target waiting on its own quests is busy.
// Run: bun test ./backend/core/engine

import { describe, expect, test } from "bun:test"
import { QuestsPart } from "./quests"
import { createSupervisor } from "@/backend/runtime/supervisor"

function lead(agent = {}) {
  const sent = []
  const queued = []
  const e = Object.create(QuestsPart.prototype)
  Object.assign(e, {
    id: "lead",
    name: "lead",
    agent,
    maxRounds: Infinity,
    _quests: new Map(),
    _questCount: 0,
    _dispatched: 0,
    _work: { letter: { id: "L1" }, origin: { id: "O1", rounds: 0 } },
    directory: { send: async (to, letter) => (sent.push({ to, letter }), `${to.name ?? to.id}-id`) },
    _publishQuests() {},
    _enqueue: (letter) => queued.push(letter),
    _nextLetterId: () => `L${queued.length + 2}`,
  })
  return { e, sent, queued }
}

describe("quest_minutes", () => {
  test("no report by the deadline → called back, batch joins with a failed report", async () => {
    const { e, sent, queued } = lead({ quest_minutes: 0.001 }) // 60 ms
    await e.dispatchQuest("regime", "read the regime")
    await e.dispatchQuest("news", "sweep")
    e._receiveReport({ quest: "lead-q2", from: "news", ok: true, text: "VETO: none" })
    await Bun.sleep(120)
    expect(sent.some((s) => s.letter.kind === "cancel" && s.letter.quest === "lead-q1")).toBe(true)
    expect(queued).toHaveLength(1)
    const reports = queued[0].reports.map((r) => [r.quest.to, r.report.ok, r.report.text])
    expect(reports).toContainEqual(["regime", false, "Called back by you: deadline: no report within quest_minutes 0.001"])
    expect(reports).toContainEqual(["news", true, "VETO: none"])
  })

  test("a report in time clears the timer; no quest_minutes = no timer", async () => {
    const { e, sent } = lead({ quest_minutes: 0.001 })
    await e.dispatchQuest("regime", "x")
    e._receiveReport({ quest: "lead-q1", from: "regime", ok: true, text: "ok" })
    await Bun.sleep(120)
    expect(sent.filter((s) => s.letter.kind === "cancel")).toHaveLength(0)
    const plain = lead({})
    await plain.e.dispatchQuest("regime", "x")
    expect(plain.e._quests.get("lead-q1").timer).toBeUndefined()
  })
})

describe("supervisor stall check", () => {
  const engine = (id, snap, agent = {}) => ({ id, name: id, agent, status: snap.status, getSnapshot: () => ({ messages: [], quests: [], ...snap }) })

  test("a team lead waiting on its members is busy, not STALLED; an idle one with no quests is", () => {
    let t = Date.parse("2026-10-13T14:00:00Z")
    const delivered = []
    const quest = { id: "lead-q1", to: "researcher", at: new Date(t).toISOString() }
    const lead = engine("lead", { status: "idle", quests: [quest] }, { stall_minutes: 10 })
    let researcher = engine("researcher", { status: "idle", quests: [{ id: "researcher-q1", to: "reader", at: new Date(t).toISOString() }] })
    const sup = createSupervisor({ engines: () => [lead, researcher], deliver: (id, l) => delivered.push([id, l]), tickMs: 1e9, now: () => t })
    t += 11 * 60000
    sup.tick()
    expect(delivered.filter(([id, l]) => id === "lead" && l.stalled)).toHaveLength(0)
    researcher = engine("researcher", { status: "idle", quests: [] })
    sup.tick()
    expect(delivered.filter(([id, l]) => id === "lead" && l.stalled)).toHaveLength(1)
    sup.stop()
  })
})
