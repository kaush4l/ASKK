/**
 * THE CHAT MODULE — one agent's conversation, and the one route that starts a
 * turn. The FIRST real projection: everything above it is machinery, and this
 * is the machinery answering a person.
 *
 * NOTHING OUTSIDE THE NAMED AGENT IS PROJECTED. `x-agent` says whose
 * conversation this is and the fold is already keyed by agent, so a message to
 * `scout` cannot appear in `main`'s transcript — not because a filter drops it
 * but because it was never in that bucket. It is a HEADER and not a path
 * segment because `/chat` must stay one route however many conversations it
 * projects (docs/SEAM.md).
 *
 * WHAT THE PANE IS TOLD IS ALREADY WORDED (I5). A projection carries the
 * sentence beside the machine field, because two panes wording one fact for
 * themselves is how a person learns the system does not know what it thinks.
 * @module
 */

import { addressee, ok, problem, statusSentence } from '@harness/kernel'
import { STOP_REQUESTED } from '@harness/agent'

import { CONVERSATION } from './reducers.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./reducers.js').Conversation} Conversation */

/** @type {Manifest} */
export const chatManifest = {
  id: 'chat',
  version: '1',
  title: 'Chat',
  summary: "One agent's conversation: the transcript and the turn trigger.",
  capabilities: ['emit'],
  view: 'chat',
  routes: [
    { method: 'GET', path: '/chat' },
    { method: 'POST', path: '/chat' },
    { method: 'POST', path: '/chat/stop' },
  ],
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function chat(request, ctx) {
  const who = addressee(request) || ctx.me
  if (request.path === '/chat/stop') return stop(ctx, who)
  if (request.method === 'POST') return submit(request, ctx, who)
  return ok('chat', projected(ctx, who))
}

/**
 * Start a turn. The utterance becomes a fact ADDRESSED TO ONE AGENT and the
 * answer to this request is that agent's transcript with it already in it —
 * `emit` appends, so the projection below reads a log that already holds it.
 * @param {Request} request @param {Ctx} ctx @param {string} who @returns {Response}
 */
function submit(request, ctx, who) {
  const message = (request.body.message ?? '').trim()
  if (message === '') {
    return problem(400, 'That message was empty, so no turn was started.', {
      id: who, kind: 'empty_message', repair: 'Type something and send it again.',
    })
  }
  if (!ctx.emit) return ungranted(who)
  // Empty means "this process's own agent": every log written before per-agent
  // chat says exactly that, and still reads correctly.
  ctx.emit({ type: 'user_message', text: message, agent: who === ctx.me ? '' : who, from: '' })
  return ok('chat', projected(ctx, who))
}

/**
 * STOP THE AGENT, not the watching. It records the press and nothing more:
 * `step` reads the fact, arms the turn and ends it at the next boundary, so
 * what stops a run is the pure function on the log and not a side channel into
 * a loop in flight.
 *
 * ONLY THIS PAGE'S OWN AGENT. Another agent's turn runs in its own Worker with
 * its own state, which no fact written here reaches; offering the control there
 * would be the same lie in a new place.
 * @param {Ctx} ctx @param {string} who @returns {Response}
 */
function stop(ctx, who) {
  if (who !== ctx.me) {
    return problem(409, `${who} runs in its own Worker, which this page cannot stop.`, {
      id: who, kind: 'not_ours', repair: `Stop ${who} from the page that is running it.`,
    })
  }
  if (!ctx.emit) return ungranted(who)
  ctx.emit({ type: 'custom', kind: STOP_REQUESTED, payload: null })
  return ok('chat', projected(ctx, who))
}

/** @param {string} who @returns {Response} */
function ungranted(who) {
  return problem(500, 'This build did not grant the chat module the right to record facts.', {
    id: who, kind: 'not_granted',
    detail: 'The `emit` capability is not in this build\'s available list, so nothing could be written.',
    repair: 'This is a build assembled wrong, not something the message did.',
  })
}

/**
 * ONE AGENT'S TRANSCRIPT, ITS STAGE, AND WHAT IT IS WAITING ON. Read straight
 * off the registered fold — no walk, no clone, no array crossing the seam.
 * @param {Ctx} ctx @param {string} who @returns {Record<string, unknown>}
 */
function projected(ctx, who) {
  const held = /** @type {Record<string, Conversation>} */ (ctx.project(CONVERSATION))[who] ?? EMPTY
  const wait = waiting(held, ctx.driving(who))
  return {
    agent: who,
    stageLabel: held.stage === '' ? `${who} · ${statusSentence(status(held))}` : `${who} · ${held.stage} stage`,
    messages: held.rows,
    emptyNote: `Nothing has been said to ${who} yet. What you type starts a turn.`,
    waitingLabel: wait.label,
    waitingStatus: wait.status,
  }
}

/** @type {Conversation} */
const EMPTY = { rows: [], open: false, tools: 0, status: 'idle', detail: '', stage: '' }

/** The status as the kernel's closed vocabulary, so an older record cannot widen it. */
function status(/** @type {Conversation} */ held) {
  return /** @type {import('@harness/kernel').Status} */ (held.status)
}

/**
 * WHAT THE TURN IS WAITING ON, AND WHY.
 *
 * The third case is the one that matters: the log says a turn is open and
 * NOTHING IN THIS PROCESS IS DRIVING IT. That is a reload landing on a turn
 * that was in flight — the shape of the log survives, the fetch behind it does
 * not — and the pane used to render it as "thinking…" with a frozen clock and a
 * disabled composer, recoverable only by wiping storage.
 * @param {Conversation} held @param {boolean} driven
 * @returns {{label: string, status: string}}
 */
function waiting(held, driven) {
  if (!held.open) return { label: '', status: 'idle' }
  if (driven) return { label: `Working — ${held.detail || 'this turn is running'}`, status: status(held) === 'idle' ? 'thinking' : held.status }
  return {
    label: 'That turn is not running any more — the page was reloaded while it was in flight, so nothing is driving it. Nothing was lost; ask again.',
    status: 'stopped',
  }
}
