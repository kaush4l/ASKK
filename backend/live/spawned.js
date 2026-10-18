// A helper made at run time (kernel Desk.spawn, tool agent.spawn) in one line — the view of its twin's `spawned
// {by, goal, at, keep}` (2026-10-17 critic: the field had no view but the helper's place in the tree). Pure, tested
// (spawned.test.js); the agent page's header and the canvas card at near zoom only draw what it returns.
//
//   spawnedLine(agent, {now}) → "helper · spawned by lead · count the corpus · keep run · 14:05", or null for an
//   agent of the desk. agent: a definition (the registry's), an AgentView (its `.agent`) or a desk-tree node.
//   The time is local: HH:MM on the day it was spawned, else YYYY-MM-DD HH:MM.
//   2026-10-17: a spawned team (`spawned.team`, kernel Desk.spawn {members}): its lead reads "team · spawned by …", a
//   member "member of <team> · spawned by <its lead> · …".

const GOAL_CHARS = 120

const pad = (n) => String(n).padStart(2, "0")
const day = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function when(at, now) {
  const ms = typeof at === "number" ? at : Date.parse(at ?? "")
  if (!Number.isFinite(ms)) return null
  const d = new Date(ms)
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return day(d) === day(new Date(now)) ? clock : `${day(d)} ${clock}`
}

export function spawnedLine(agent, { now = Date.now() } = {}) {
  const s = [agent?.spawned, agent?.agent?.spawned].find((x) => x && typeof x === "object")
  if (!s?.by) return null
  const first = String(s.goal ?? "").split("\n")[0].trim()
  const goal = first.length > GOAL_CHARS ? `${first.slice(0, GOAL_CHARS - 1)}…` : first
  const name = agent?.name ?? agent?.agent?.name
  const what = !s.team ? "helper" : s.team === name ? "team" : `member of ${s.team}`
  return [what, `spawned by ${s.by}`, goal, `keep ${s.keep === "desk" ? "desk" : "run"}`, when(s.at, now)].filter(Boolean).join(" · ")
}
