/**
 * THE FAR SIDE OF THE CHANNEL, on the host: a sub-agent's whole desk as an
 * object no lead can reach. Shared by both errand suites so the two cannot
 * drift into testing two different Workers.
 */
import { agentsOver, errandBegun, errandHeard, newAgentState, readMessage, step } from '@harness/agent'
import { CARD } from './card.js'

/** @typedef {import('@harness/agent').AgentState} AgentState */
/** @typedef {import('@harness/agent').Errand} Errand */
/** @typedef {import('@harness/agent').Incoming} Incoming */

export const AT = 1_700_000_000_000

/**
 * ONE SUB-AGENT'S DESK: its own `AgentState`, its own open errand, and the way
 * home. The lead has no path to any of it — the test reads it directly, which
 * is the point: if the port could reach a sub-agent's loop, this is the object
 * it would have to reach through.
 * @typedef {{name: string, state: AgentState, errand: Errand | null, opened: Incoming | null, home: (message: unknown) => void, closed: number}} Desk
 */

/** @param {string} name @param {Partial<AgentState>} [desk] @returns {Desk} */
function deskFor(name, desk = {}) {
  return {
    name,
    state: { ...newAgentState(), card: CARD, model: 'local', prompt: `You are ${name}.`, ...desk },
    errand: null,
    opened: null,
    home: () => { throw new Error(`${name} answered before anyone was listening`) },
    closed: 0,
  }
}

/** One turn of the sub-agent's OWN loop, and the ending it posts home if this fact ended it. @param {Desk} desk @param {Incoming} incoming */
function ran(desk, incoming) {
  const stepped = step(desk.state, incoming)
  desk.state = stepped.state
  if (!desk.errand) throw new Error(`${desk.name} took a turn with no errand open`)
  const heard = errandHeard(desk.errand, incoming, stepped.effects)
  desk.errand = heard.errand
  if (heard.ended) desk.home(heard.ended)
}

/** @param {Desk} desk @param {unknown} message */
function began(desk, message) {
  const said = readMessage(message)
  if ('unreadable' in said || said.type !== 'begin') throw new Error(`${desk.name} could not read that`)
  const begun = errandBegun(said, `${desk.name}-t1`, AT)
  desk.errand = begun.errand
  desk.opened = begun.incoming
  ran(desk, begun.incoming)
}

/** @param {Desk} desk @param {string} text @param {string} finish @returns {Incoming} */
const replied = (desk, text, finish) => ({
  at: AT,
  turnId: `${desk.name}-t1`,
  fact: { type: 'model_replied', agent: desk.name, text, reasoning: '', finish },
  reply: { calls: [], finish: /** @type {import('@harness/agent').FinishReason} */ (finish) },
})

/** A sub-agent in its own Worker, reachable only through `channel`. @param {string} name @param {Partial<AgentState>} [was] */
export function workerFor(name, was = {}) {
  const desk = deskFor(name, was)
  return {
    channel: {
      /** @param {unknown} message */
      post: (message) => began(desk, message),
      /** @param {(message: unknown) => void} handler */
      onMessage: (handler) => { desk.home = handler },
      close: () => { desk.closed += 1 },
    },
    state: () => desk.state,
    closed: () => desk.closed,
    /** The fact that opened this Worker's turn — the one a person's message would have made. */
    opened: () => desk.opened,
    /** @param {unknown} message  something a confused or stale Worker posts home */
    says: (message) => desk.home(message),
    /** @param {string} text @param {string} [finish] */
    answer: (text, finish = 'stop') => ran(desk, replied(desk, text, finish)),
    /** A reply that says something AND calls one tool. @param {string} text @param {string} toolName */
    works: (text, toolName) => ran(desk, {
      at: AT,
      turnId: `${name}-t1`,
      fact: { type: 'model_replied', agent: name, text, reasoning: '', finish: 'tool_calls' },
      reply: { calls: [{ id: 'c1', tool: toolName, args: '{}' }], finish: /** @type {import('@harness/agent').FinishReason} */ ('tool_calls') },
    }),
    /** @param {string} toolName @param {string} output */
    ranTool: (toolName, output) => ran(desk, {
      at: AT,
      turnId: `${name}-t1`,
      callId: 'c1',
      fact: { type: 'tool_invoked', agent: name, tool: toolName, args: '{}', onBehalfOf: '', ok: true, output },
    }),
  }
}

/** @param {Record<string, ReturnType<typeof workerFor>>} workers */
export function portOver(workers) {
  /** @type {unknown[]} */
  const crossed = []
  const port = agentsOver({
    me: 'main',
    names: Object.keys(workers),
    open: (agent) => {
      const worker = workers[agent]
      if (!worker) throw new Error(`no worker for ${agent}`)
      return {
        ...worker.channel,
        onMessage: (handler) => worker.channel.onMessage((message) => { crossed.push(message); handler(message) }),
      }
    },
  })
  return { port, crossed }
}

