// Supervisor — keeps long-running quests on track. Steps and rounds are
// unlimited, so an agent working on a quest could drift, loop, or stall
// without anyone noticing. The supervisor watches every engine's state and,
// while one works on a quest, sends the quest's owner a status letter with
// a digest of the latest work: every `check_minutes` (default 5) or
// `check_steps` (default 10) new steps, whichever comes first, and only when
// there are new steps. The owner reviews it in a side turn and lets it run,
// steers it (quest.steer) or calls it back (quest.recall).
//
//   const supervisor = createSupervisor({ engines: () => [...], deliver: (engineId, letter) => … })
//   supervisor.stop()
//
// Reads only state snapshots (getSnapshot), so it works the same over
// EngineProxy objects on the main thread (registry.js) and over in-process
// engines (companion/ask.js). The owner's agent.md sets the cadence.

import { digest } from "@/backend/core/log"

const DEFAULT_MINUTES = 5
const DEFAULT_STEPS = 10

const isStep = (m) => m.role === "assistant" && (m.structured || m.error || m.stopped)
// Finished messages only: a reply still streaming is reported next time.
const isDone = (m) => m.role !== "assistant" || !!(m.structured || m.error || m.stopped || m.final)

export function createSupervisor({ engines, deliver, tickMs = 15000, now = () => Date.now() }) {
  const tracks = new Map() // quest id -> { lastId, lastAt }

  function tick() {
    const live = engines().filter((e) => e.status !== "disposed")
    const active = new Set()
    for (const engine of live) {
      const { status, working, messages } = engine.getSnapshot()
      if (status !== "running" || !working?.quest || !working.replyTo) continue
      const owner = live.find((e) => e.id === working.replyTo)
      if (!owner) continue
      active.add(working.quest)

      const start = messages.findIndex((m) => m.id === working.request)
      if (start < 0) continue
      const work = messages.slice(start + 1)
      const track = tracks.get(working.quest) ?? { lastId: null, lastAt: Date.parse(working.at) || now() }
      tracks.set(working.quest, track)

      const after = track.lastId ? work.findIndex((m) => m.id === track.lastId) + 1 : 0
      const fresh = []
      for (const m of work.slice(after)) {
        if (!isDone(m)) break
        fresh.push(m)
      }
      const newSteps = fresh.filter(isStep).length
      if (!newSteps) continue

      const everyMs = (Number(owner.agent?.check_minutes) || DEFAULT_MINUTES) * 60000
      const everySteps = Number(owner.agent?.check_steps) || DEFAULT_STEPS
      if (newSteps < everySteps && now() - track.lastAt < everyMs) continue

      deliver(owner.id, {
        kind: "status",
        quest: working.quest,
        from: engine.name,
        steps: work.filter(isStep).length,
        text: digest(fresh),
      })
      track.lastId = fresh.at(-1).id
      track.lastAt = now()
    }
    for (const quest of tracks.keys()) if (!active.has(quest)) tracks.delete(quest)
  }

  const timer = setInterval(tick, tickMs)
  return {
    tick,
    stop: () => clearInterval(timer),
  }
}
