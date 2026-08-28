/**
 * The react loop — think, act, observe, until the model answers.
 *
 *     const reply = await react(agent, "please echo hey")
 *
 * A step returns an **outcome name**, and the loop ends on the outcome declared
 * terminal below. There is no edge table here: one flow has nothing to decide,
 * and `FLOWS`, `validateFlow` and the driver arrive at 4.5 with the second flow
 * that earns them (ARCHITECTURE.md §5.6). What is here is the shape they plug
 * into — an outcome, and a declared terminal.
 *
 * The repeat guard lives here and it is the **only** brake on the loop. Its
 * three tiers, in order:
 *
 *   1. the first time a call is asked for, it runs;
 *   2. the second and every time after, it does **not** run — the model is told
 *      so and gets the turn back, because re-running a call whose answer cannot
 *      have changed is how a session burns a context window on one mistake;
 *   3. past `repeatLimit`, an answer is synthesised in the model's own response
 *      class, so the loop ends **with a reply rather than an exception**.
 *
 * Tier 3 is the property worth stating out loud: a caller of this function
 * cannot be handed a runaway loop, and cannot be handed a thrown error either.
 */

import type { Agent, Reply } from '@/core/agent/agent'
import type { Session } from '@/core/agent/session'

/** The one phase this flow has. 4.5 is where a run visits more than one. */
export const PHASE = 'react'

/** Every outcome a react step can have. A fourth is a line here, not a new branch. */
export const OUTCOMES = { ANSWER: 'answer', TOOL: 'tool' } as const

export type Outcome = (typeof OUTCOMES)[keyof typeof OUTCOMES]

/** The declared terminal. The loop ends here and nowhere else. */
export const TERMINAL: Outcome = OUTCOMES.ANSWER

/**
 * The observation when the model calls a tool and the agent has no tool runner.
 *
 * The bytes are the toolbox's, for the case where it holds nothing:
 * `Toolbox.call` answers an unknown name with `Tool not found. Available: none`.
 * What is missing is the `<tool>: ` prefix its `ToolResult` renders, because
 * naming the tool means parsing the call and the parser is 4.2's. When the
 * toolbox lands this constant goes with it.
 */
export const NO_TOOLS = 'Tool not found. Available: none'

export function outcomeOf(reply: Reply): Outcome {
  return reply.isAnswer ? OUTCOMES.ANSWER : OUTCOMES.TOOL
}

/** Record the user's turn and run the loop to an answer. */
export async function react(agent: Agent, query: string): Promise<Reply> {
  const session = agent.open(query)
  session.phase = PHASE
  session.transcript.add('user', query)
  return await loop(agent, session)
}

/**
 * Think → act → observe until the outcome is the terminal one.
 *
 * `entered` is posted on every pass and not only the first: on a react agent
 * the round is the only thing that moves, so an observer given one arrival has
 * nothing to show after the first millisecond of a run.
 */
async function loop(agent: Agent, session: Session): Promise<Reply> {
  agent.observer.entered?.({ turnId: session.id, phase: session.phase, round: session.round })
  let parsed = await step(agent, session)
  while (outcomeOf(parsed) !== TERMINAL) {
    session.round += 1
    agent.observer.entered?.({ turnId: session.id, phase: session.phase, round: session.round })
    parsed = await step(agent, session)
  }
  agent.observer.done?.({ turnId: session.id, answer: parsed.answer, rounds: session.round })
  return parsed
}

async function step(agent: Agent, session: Session): Promise<Reply> {
  const parsed = await agent.turn(session)
  if (outcomeOf(parsed) === TERMINAL) return parsed
  return await callTools(agent, session, parsed)
}

/**
 * Run the calls the model wrote; record what came back. Never raises.
 *
 * The give-up is built here and never passes through `turn`, so it is not a
 * further exchange with the model: the observation the model was handed on the
 * way out stays the last line of the transcript.
 */
async function callTools(agent: Agent, session: Session, parsed: Reply): Promise<Reply> {
  const call = parsed.answer.trim()
  const seen = (session.seen.get(call) ?? 0) + 1
  session.seen.set(call, seen)

  if (seen > agent.repeatLimit) {
    agent.observer.retry?.({ turnId: session.id, call, seen, gaveUp: true })
    session.transcript.add('user', `Result: Stopping — ${call} was tried ${seen} times without progress.`)
    return agent.model.answerOf(`I could not complete this. ${call} failed every time I tried it.`)
  }

  const observation = await observe(agent, session, call, seen)
  session.transcript.add('user', `Result: ${observation}`)
  return parsed
}

/** The scolding, or the tools. A repeat gets the first and never the second. */
async function observe(agent: Agent, session: Session, call: string, seen: number): Promise<string> {
  if (seen > 1) {
    agent.observer.retry?.({ turnId: session.id, call, seen, gaveUp: false })
    return (
      `You already made this exact call ${seen - 1} time(s) and the outcome will not change. ` +
      'Do something different: a different tool, different arguments, or answer with what you have.'
    )
  }
  const observation = agent.tools === null ? NO_TOOLS : await agent.tools(call)
  agent.observer.results?.({ turnId: session.id, call, observation })
  return observation
}
