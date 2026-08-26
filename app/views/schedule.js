/** The schedule panel — the one thing on the Bench that is not editable here.
 *
 * A job is written by the agent's own cron tools, so this reads the same cron
 * port they write to and shows what is there. It lives beside `bench.js`
 * rather than inside it because it shares nothing with the three editors: no
 * picker, no validator, no save.
 */

import { el } from "../dom.js"
import { managed } from "../../core/schedule.js"

const ONLY_OPEN = "These jobs run only while this page is open. There is no background service — close the tab and nothing fires. A job whose time passed while the page was shut is reported as missed and never replayed: eleven runs delivered at once would do the wrong work eleven hours late."

/** What the runtime reported missed. The cron adapter reports it once, at boot, and nothing
 * retains it, so this view listens rather than asks. @type {{ name: string, runs: number, since: string }[]} */
export const MISSED = []
/** @param {string[]} cells @returns {HTMLElement} */
const job = (cells) => el("div", { class: "job" }, cells.map((cell, i) => el("span", { class: i < 2 ? "bytes" : "goal" }, [cell])))
/** The schedule, read through the same cron port the agent's tools write to. @param {any} runtime @returns {{ element: HTMLElement, refresh: () => Promise<void> }} */
export function schedulePanel(runtime) {
  const running = el("div", { class: "jobs" })
  const missed = el("div", { class: "jobs" })
  const element = el("div", { class: "editor" }, [el("p", { class: "note note-warn" }, [ONLY_OPEN]),
    el("h3", {}, ["Scheduled"]), running, el("h3", {}, ["Missed"]), missed])
  const refresh = async () => {
    /** @type {string[]} */ let lines = []
    try { lines = await runtime.ports.cron.readLines() } catch (error) {
      running.replaceChildren(el("p", { class: "problem" }, [`Could not read the schedule: ${error instanceof Error ? error.message : String(error)}`]))
      return
    }
    const found = lines.map(managed).filter((one) => one !== null)
    running.replaceChildren(...(found.length ? found.map((one) => job([one.name, one.schedule, one.goal || one.command]))
      : [el("p", { class: "empty" }, ["Nothing is scheduled. The agent writes its own jobs with create_cron_job."])]))
    missed.replaceChildren(...(MISSED.length ? MISSED.map((one) => job([one.name, `${one.runs} run(s)`, `first due ${one.since}`]))
      : [el("p", { class: "empty" }, ["Nothing has been reported missed since this page opened."])]))
  }
  return { element, refresh }
}
