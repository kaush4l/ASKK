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

import { addressee, ok, problem } from '@harness/kernel'
import { STOP_REQUESTED } from '@harness/agent'

import { readAttachments, refusedBy, attach } from './attachments.js'
import { CLEARED } from './reducers.js'
import { projected } from './transcript.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */

/** @type {Manifest} */
export const chatManifest = {
  id: 'chat',
  version: '1',
  title: 'Chat',
  summary: "One agent's conversation: the transcript and the turn trigger.",
  // `workspace` is asked for so a dropped file can be KEPT, not so the chat
  // module can reach the substrate: the write goes out as the same `write_file`
  // chore the files pane queues, through the same gate.
  capabilities: ['emit', 'workspace'],
  view: 'chat',
  routes: [
    { method: 'GET', path: '/chat' },
    { method: 'POST', path: '/chat' },
    { method: 'POST', path: '/chat/stop' },
    { method: 'GET', path: '/chat/halt' },
    { method: 'GET', path: '/chat/clear' },
  ],
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function chat(request, ctx) {
  const who = addressee(request) || ctx.me
  if (request.path === '/chat/stop') return stop(ctx, who)
  if (request.path === '/chat/halt') return halt(ctx, who)
  if (request.path === '/chat/clear') return clear(request, ctx, who)
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
  const dropped = readAttachments(request.body.attachments ?? '')
  if ('problem' in dropped) {
    return problem(400, `Those attachments could not be read: ${dropped.problem}.`, {
      id: who, kind: 'unreadable_attachment', repair: 'Send the message again without them, or attach the files afresh.',
    })
  }
  const refusal = dropped.parts.map((p) => refusedBy(ctx, p)).find((why) => why !== '')
  if (refusal) {
    return problem(400, refusal, { id: who, kind: 'card_cannot_read', repair: 'Nothing was recorded, so nothing is lost.' })
  }
  if (!ctx.emit) return ungranted(who)
  // THE ATTACHMENTS GO FIRST. A part recorded after the message would be a part
  // the turn the message started could not see: the driver takes the message
  // off the queue and steps on it, and the fold behind it is already fixed.
  const notes = dropped.parts.map((part) => {
    const made = attach(ctx, part)
    ctx.emit?.(made.fact)
    return made.note
  })
  // Empty means "this process's own agent": every log written before per-agent
  // chat says exactly that, and still reads correctly.
  ctx.emit({ type: 'user_message', text: message, agent: who === ctx.me ? '' : who, from: '' })
  return ok('chat', { ...projected(ctx, who), attachedLabel: notes.join(' ') })
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

/**
 * A HARD HALT. Stop asks the loop to end at its next boundary; this declares
 * the turn over now, because the boundary never came — a driver that died with
 * the tab, a turn the log says is open with nothing behind it. It is a
 * DIFFERENT act from Stop and so it is a different route: conflating them is
 * how a person pressing Stop twice loses the answer that was one round away.
 * @param {Ctx} ctx @param {string} who @returns {Response}
 */
function halt(ctx, who) {
  if (who !== ctx.me) {
    return problem(409, `${who} runs in its own Worker, which this page cannot halt.`, {
      id: who, kind: 'not_ours', repair: `Halt ${who} from the page that is running it.`,
    })
  }
  if (!ctx.emit) return ungranted(who)
  ctx.emit({ type: 'agent_status', agent: who, status: 'idle', detail: 'This turn was halted from the page.' })
  return ok('chat', projected(ctx, who))
}

/**
 * EMPTY THE TRANSCRIPT, ON THE SECOND PRESS. Two clicks because there is no
 * undo button in front of a person mid-conversation, and one because the fact
 * is reversible in the log even when the screen is not (I10). `x-confirm` is a
 * header for the same reason `x-agent` is: `/chat/clear` stays one route.
 * @param {Request} request @param {Ctx} ctx @param {string} who @returns {Response}
 */
function clear(request, ctx, who) {
  if ((request.headers['x-confirm'] ?? '') !== 'yes') {
    return ok('chat', { ...projected(ctx, who), armedLabel: `Press again to empty ${who}'s transcript. The facts stay in the log; the conversation starts over.` })
  }
  if (!ctx.emit) return ungranted(who)
  ctx.emit({ type: 'custom', kind: CLEARED, payload: { agent: who === ctx.me ? '' : who } })
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
