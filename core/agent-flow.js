/** The flow driver — walking the declared table from the entry to a terminal.
 *
 * Split out of `agent.js` for the 200-line rule, and it is the same seam
 * `agent-react.js` was cut on: the react loop decides what to do with one
 * *reply*, and this decides what to do with one *outcome*. Neither is about how
 * to ask the model for anything, which is what `agent.js` is left holding.
 *
 * The split was forced by one line — the `entered` report. That line is why the
 * Flow view can highlight a live phase at all, and it belongs here because here
 * is the only place that knows a phase was entered. `agent.js` logged the same
 * fact and threw it away; the log is prose no view can read.
 */

import { MAX_TRANSITIONS, getFlow } from "./flows.js"
import { PHASES } from "./phases.js"

/** @typedef {import("./agent.js").Agent} Agent */

/**
 * Store the user turn and run the configured flow to an answer.
 *
 * The flow is a declared table: its entry says where to start and
 * `(phase, outcome)` says what comes next. The react flow's table is one phase
 * and one terminal edge, so it still reaches `ReActPhase` in a single lookup —
 * the graph costs it nothing.
 *
 * @param {Agent} agent @param {string} userInput @returns {Promise<any>}
 */
export async function runFlow(agent, userInput) {
  if (agent.stateless) agent.transcript.clear()
  agent.session.resetFor(userInput)
  agent.transcript.add("user", userInput)
  agent.last = null

  const flow = getFlow(agent.flow)
  let current = flow.entry
  for (let step = 0; step < MAX_TRANSITIONS; step++) {
    const phase = PHASES[current]
    if (!phase) return stop(agent, `no phase called '${current}'`)
    enterPhase(agent, current)
    const outcome = await phase.run(agent, agent.session)
    const next = flow.edges[current]?.[outcome]
    if (next === undefined) return stop(agent, `phase '${current}' returned '${outcome}', no edge for it`)
    if (next === null) return agent.last
    current = next
  }
  return stop(agent, `phase graph exceeded ${MAX_TRANSITIONS} transitions`)
}

/** Name the phase now running, and report the arrival.
 *
 * Reported at entry rather than at exit, and that is what keeps `retry` and
 * `exhausted` apart on the wire without naming either: the reader sees the
 * phase it came *from* and the phase it arrived *at*, so `verify → plan` and
 * `verify → respond` are two different arrivals rather than one "verify
 * finished". The session rides along because the blackboard is what a reader is
 * comparing the arrival against — the round count, the plan, the findings — and
 * at entry those are exactly what the phase about to run was handed.
 *
 * @param {Agent} agent @param {string} current @returns {void}
 */
function enterPhase(agent, current) {
  agent.phase = current
  agent.log.info(`${agent.name}: phase ${current}`)
  reportPhase(agent)
}

/** The arrival on its own, for the one caller that arrives somewhere this driver
 * already sent it: the react loop, whose every pass after the first re-enters
 * the same phase. The driver runs once and cannot see them, and a screen showing
 * one arrival for a twelve-pass loop is a still picture of a live thing. It does
 * not log — the log already said which phase this is, and saying it again per
 * pass is noise in the one channel a person reads by eye.
 * @param {Agent} agent @returns {void} */
export function reportPhase(agent) {
  agent.observer?.entered?.({
    phase: agent.phase,
    flow: agent.flow,
    maxRounds: agent.maxRounds,
    session: agent.session,
  })
}

/** The run ended on a broken graph, not an answer. Whatever was recorded still
 * goes back — a partial reply beats none.
 * @param {Agent} agent @param {string} why @returns {any} */
function stop(agent, why) {
  agent.log.error(`${agent.name}: ${why} — stopping`)
  return agent.last
}
