/**
 * THE BOARD — one card per agent: what it is, what it is doing, how far through
 * its loop, and HOW ITS LAST TURN ENDED.
 *
 * The ending comes from `turns.js` and nowhere else. This is the surface the
 * predecessor got wrong: the card read `task == null` and printed `main
 * finished` over a transcript whose last line was a malformed tool call, because
 * three places decided independently what a finished turn was. One fold, one
 * sentence, three readers.
 * @module
 */

import { ok, statusSentence } from '@harness/kernel'

import { CONVERSATION } from './reducers.js'
import { NO_TURNS, TURNS } from './turns.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./reducers.js').Conversation} Conversation */
/** @typedef {import('./turns.js').Turns} Turns */

/** @type {Manifest} */
export const boardManifest = {
  id: 'board',
  version: '1',
  title: 'Board',
  summary: 'Every agent: its status, the loop it walks, and how its last turn ended.',
  capabilities: [],
  view: 'board',
  routes: [{ method: 'GET', path: '/board' }],
}

/** @param {Request} _request @param {Ctx} ctx @returns {Response} */
export function board(_request, ctx) {
  return ok('board', { rows: rows(ctx), emptyNote: '' })
}

/**
 * EVERY AGENT THIS BUILD KNOWS, in one list. The roster is what the files
 * declared; the conversation fold is what has actually been talked to — and an
 * agent can be in the second and not the first, because a person may author one
 * in this browser after boot.
 * @param {Ctx} ctx
 * @returns {Array<Record<string, unknown>>}
 */
export function rows(ctx) {
  const talk = /** @type {Record<string, Conversation>} */ (ctx.project(CONVERSATION))
  const ended = /** @type {Record<string, Turns>} */ (ctx.project(TURNS))
  const names = [...new Set([ctx.me, ...ctx.roster.specs.map((s) => s.name), ...Object.keys(talk)])]
  return names.map((name) => card(ctx, name, talk[name], ended[name] ?? NO_TURNS))
}

/**
 * @param {Ctx} ctx @param {string} name @param {Conversation|undefined} held @param {Turns} turns
 * @returns {Record<string, unknown>}
 */
function card(ctx, name, held, turns) {
  const spec = ctx.roster.specs.find((s) => s.name === name)
  const status = /** @type {import('@harness/kernel').Status} */ (held?.status ?? 'idle')
  const live = ctx.driving(name)
  return {
    id: name,
    name,
    isMe: name === ctx.me,
    status,
    statusLabel: statusSentence(status),
    detail: held?.detail ?? '',
    modelLabel: spec ? modelOf(spec.model) : 'This agent has no file here, so nothing declares its model.',
    ...walk(ctx, name),
    lastEndingTone: turns.last?.tone ?? '',
    lastEndingLabel: turns.last?.label ?? '',
    turnsLabel: turnsSentence(turns),
    // WHETHER ANYTHING IS DRIVING IT RIGHT NOW, which is not what the log's
    // shape says: a reload replays an open turn with no fetch behind it.
    live,
    liveLabel: live ? 'Running now' : 'Not running',
  }
}

/**
 * HOW FAR THROUGH ITS LOOP THIS AGENT IS. Only for the agent this process runs:
 * another agent's stage walk lives in that agent's own Worker, and answering
 * for it here would be the card inventing a lap it cannot see.
 * @param {Ctx} ctx @param {string} name
 */
function walk(ctx, name) {
  if (name !== ctx.me) {
    return { stageLabel: '', lapLabel: '', routeLabel: 'This agent runs elsewhere, so its loop is not visible from here.' }
  }
  const state = ctx.agent
  const stages = state.stages
  const at = Math.min(state.stage, Math.max(stages.length - 1, 0))
  return {
    stageLabel: stages.length === 0 ? 'react' : `${stages[at] ?? stages[0]} (${at + 1} of ${stages.length})`,
    lapLabel: state.passes <= 1 ? '' : `lap ${state.pass + 1} of ${state.passes}`,
    routeLabel: stages.length === 0 ? 'One reply, then tools if it asked for any.' : stages.join(' → '),
  }
}

/** @param {Turns} turns */
function turnsSentence(turns) {
  if (turns.ended === 0) return 'No turn has ended here yet.'
  if (turns.unanswered === 0) return `${turns.ended === 1 ? '1 turn' : `${turns.ended} turns`}, all answered.`
  return `${turns.ended === 1 ? '1 turn' : `${turns.ended} turns`}, ${turns.unanswered} of them without an answer.`
}

/** @param {string} model */
function modelOf(model) {
  return model.trim() === '' ? 'Whatever the catalogue has as its default.' : model
}
