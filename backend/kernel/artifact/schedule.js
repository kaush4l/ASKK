import { Artifact } from "./artifact.js"
import { Tool } from "../tool/tool.js"

// Schedule: the desk's next run — when, and the goal it will be given. The lead books it with a
// tool; the owner can set it from the UI; the host's timer runs it when due (kernel-team).
//   state: { next: {at ISO, goal, why, by} | null, defaultGoal, history: [{at, goal, why, by, ran}] }
// `why` is the reason for that time (what activity is expected then), shown wherever the next run is.
export class Schedule extends Artifact {
  constructor({ id = "desk.schedule", title = "Next run", defaultGoal = "", clock = () => new Date(), parseTime = (s) => new Date(s) } = {}) {
    super({ name: id, title })
    this.kind = "schedule"
    this.view = "schedule"
    this.keep = "always"
    this.clock = clock
    this.parseTime = parseTime
    this.state = { next: null, defaultGoal, history: [] }
  }

  book({ at, in_minutes, goal, why }, by = "owner") {
    const when = in_minutes != null ? new Date(this.clock().getTime() + Number(in_minutes) * 60000) : this.parseTime(String(at))
    if (!(when instanceof Date) || Number.isNaN(when.getTime())) throw new Error(`bad time ${at ?? in_minutes}: give at "HH:MM" (ET), an ISO time, or in_minutes`)
    if (when.getTime() < this.clock().getTime() - 60000) throw new Error(`${when.toISOString()} is in the past`)
    const text = String(goal ?? "").trim() || this.state.defaultGoal
    if (!text) throw new Error("goal is required")
    this.state = { ...this.state, next: { at: when.toISOString(), goal: text.slice(0, 2000), ...(why ? { why: String(why).slice(0, 300) } : {}), by } }
    this.changed()
    return this.state.next
  }

  clear() {
    this.state = { ...this.state, next: null }
    this.changed()
  }

  setDefaultGoal(goal) {
    this.state = { ...this.state, defaultGoal: String(goal ?? "").slice(0, 2000) }
    this.changed()
  }

  // The due run, taken off the book (the caller runs it).
  takeDue(now = this.clock()) {
    const next = this.state.next
    if (!next || new Date(next.at).getTime() > now.getTime()) return null
    this.state = { ...this.state, next: null, history: [...this.state.history, { ...next, ran: now.toISOString() }].slice(-20) }
    this.changed()
    return next
  }

  render() {
    const n = this.state.next
    return n ? `next run ${n.at} (booked by ${n.by}${n.why ? `, because ${n.why}` : ""}): ${n.goal}` : "no next run booked"
  }

  brief() {
    const n = this.state.next
    if (!n) return "no next run booked"
    const t = new Date(n.at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false })
    return `next ${t} ET${n.why ? ` (${n.why.slice(0, 80)})` : ""}: ${n.goal.split("\n")[0].slice(0, 80)}`
  }

  commands() {
    return [
      new Tool({
        name: `${this.name}.next`,
        description: "book the desk's next run and the goal it starts with (replaces any booked run)",
        input: { at: `"HH:MM" ET today/tomorrow, or ISO time`, in_minutes: "or minutes from now", why: "what activity you expect then (a print, the open/close, momentum, a level)", goal: "the goal statement for that run" },
        run: (input, { agent }) => {
          const n = this.book(input, agent?.name ?? "agent")
          return `booked ${n.at}${n.why ? ` (${n.why.slice(0, 60)})` : ""}: ${n.goal.slice(0, 80)}`
        },
      }),
    ]
  }
}
