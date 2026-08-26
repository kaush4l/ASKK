/** The react loop — think, act, observe, until the model answers.
 *
 * Split out of `agent.js` for the 200-line rule, and it is the natural seam:
 * this is the one part of the agent that decides what to do with a reply rather
 * than how to ask for it.
 *
 * The repeat guard lives here. It is independent of phases and it is the only
 * brake on the loop — the only thing that stops a caller looping forever.
 */

import { isAnswer } from "./agent-config.js"
import { reportPhase } from "./agent-flow.js"
// Imported for the cast in `callTools`: a give-up answer is built from the
// response class the model already replied in, whatever that class was.
import { BaseResponse } from "./response-base.js"

/** @typedef {import("./agent.js").Agent} Agent */
/** @typedef {import("./component-base.js").Component} Component */

/**
 * Think → act → observe until the model answers. The Engine's loop, kept.
 * @param {Agent} agent @param {Component[] | null} [phaseComponents] @returns {Promise<any>}
 */
export async function reactLoop(agent, phaseComponents = null) {
  agent.seen.clear()
  let parsed = await reactStep(agent, phaseComponents)
  while (!isAnswer(parsed)) {
    // The flow driver reported one arrival at this phase and then handed the
    // loop the turn. Every pass from here is another arrival at it, and it is
    // the only thing that moves on a react-flow agent — which is every agent
    // this build ships by default. Without this the Flow view's one job, showing
    // a live phase, has nothing to show after the first millisecond of a run.
    reportPhase(agent)
    parsed = await reactStep(agent, phaseComponents)
  }
  // The loop's outcome is the reply — including a repeat-guard give-up, which
  // was synthesized in callTools and never went through turn().
  agent.last = parsed
  return parsed
}

/** @param {Agent} agent @param {Component[] | null} phaseComponents @returns {Promise<any>} */
async function reactStep(agent, phaseComponents) {
  const parsed = await agent.turn(phaseComponents, null, true, true)
  if (typeof parsed === "string" || isAnswer(parsed)) return parsed
  return await callTools(agent, parsed)
}

/**
 * Run the calls the model wrote; record what came back. Never raises.
 *
 * Past `repeatLimit` the agent synthesizes an answer saying it could not do it,
 * so the loop above ends with a reply rather than a raised error — that give-up
 * is built here and never passes through `turn`, which is why `reactLoop` sets
 * `last` itself.
 *
 * @param {Agent} agent @param {BaseResponse} parsed @returns {Promise<BaseResponse>}
 */
async function callTools(agent, parsed) {
  const call = String(parsed.answer).trim()
  const seen = (agent.seen.get(call) ?? 0) + 1
  agent.seen.set(call, seen)

  if (seen > agent.repeatLimit) {
    agent.log.warning(`${agent.name}: giving up, repeated call ${seen} times: ${call.slice(0, 80)}`)
    agent.transcript.add("user", `Result: Stopping — ${call} was tried ${seen} times without progress.`)
    const model = /** @type {typeof BaseResponse & (new (d?: any) => BaseResponse)} */ (
      /** @type {unknown} */ (parsed.constructor)
    )
    return new model({
      [model.answerField()]: `I could not complete this. ${call} failed every time I tried it.`,
    })
  }

  const observation =
    seen > 1
      ? `You already made this exact call ${seen - 1} time(s) and the outcome will not change. ` +
        "Do something different: a different tool, different arguments, or answer with what you have."
      : await agent.toolbox.invoke(call, (results) => report(agent, call, results))

  agent.transcript.add("user", `Result: ${observation}`)
  return parsed
}

/** One batch, the moment it lands — to the log, and to whoever is watching.
 *
 * Per batch and not per call, because that ordering is the schedule the model
 * wrote: a batch is what ran together, and the next batch has not started yet.
 * Coalescing them into one report at the end would throw away the only thing
 * this says.
 *
 * `call` is the whole text the model wrote, which is what the repeat guard above
 * keys on — so a reader tallying these counts the same calls the guard counts.
 * A multi-batch call reports that text once per batch; that is the guard's key
 * seen more than once, not a different key, and the single-batch case that is
 * nearly all of them agrees exactly.
 *
 * @param {Agent} agent @param {string} call
 * @param {import("./tool-call.js").ToolResult[]} results @returns {void} */
function report(agent, call, results) {
  const landed = results.map((r) => `${r.tool}${r.ok ? "" : " (failed)"}`).join(", ")
  agent.log.info(`${agent.name}: ${results.length} tool result(s) back: ${landed}`)
  agent.observer?.results?.({ call, results })
}
