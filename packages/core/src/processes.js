/**
 * THE PROCESSES MODULE — what is running right now, and for how long.
 *
 * "RUNNING" IS NOT A FOLD OF THE LOG, and that is the whole reason this pane
 * exists separately from the board. The log's shape survives a refresh and the
 * fetch behind it does not: a reload replays an open turn with nothing driving
 * it, and the predecessor rendered that as a process running since a timestamp
 * that could no longer tick. What is live is state THIS PROCESS holds —
 * `driving`, the outstanding batch, the errands — and the duration comes off
 * the same `openedAt` the board and the header read (`turns.js`), so no two
 * panes can disagree about when a turn started.
 * @module
 */

import { ok, problem } from '@harness/kernel'
import { STOP_REQUESTED } from '@harness/agent'

import { NO_TURNS, TURNS } from './turns.js'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */
/** @typedef {import('./turns.js').Turns} Turns */

/** @type {Manifest} */
export const processesManifest = {
  id: 'processes',
  version: '1',
  title: 'Processes',
  // `clock` is asked for HERE and nowhere else in the panes: an elapsed time is
  // the one projection whose value changes with no fact behind it.
  capabilities: ['clock', 'emit', 'workspace'],
  summary: 'What is running in this page right now, and for how long.',
  view: 'processes',
  routes: [
    { method: 'GET', path: '/processes' },
    { method: 'POST', path: '/processes' },
  ],
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function processes(request, ctx) {
  if (request.method === 'POST') return stop(ctx)
  return ok('processes', projected(ctx, ''))
}

/**
 * STOP EVERYTHING THIS PAGE IS DRIVING. Two halves, because there are two kinds
 * of running: the turn ends at the next boundary because `step` reads the fact,
 * and a command already in flight is interrupted in the substrate. Neither can
 * do the other's job, and a button that did only one would leave the person
 * watching the half it missed.
 * @param {Ctx} ctx @returns {Response}
 */
function stop(ctx) {
  if (!ctx.emit) {
    return problem(500, 'This build did not grant the processes module the right to record facts.', {
      kind: 'not_granted',
      detail: 'the `emit` capability is not in this build\'s available list, so a stop could not be recorded',
      repair: 'This is a build assembled wrong, not something the press did.',
    })
  }
  ctx.emit({ type: 'custom', kind: STOP_REQUESTED, payload: null })
  const interrupted = ctx.interrupt ? ctx.interrupt() : 'There is no workspace here, so no command was interrupted.'
  return ok('processes', projected(ctx, interrupted))
}

/** @param {Ctx} ctx @param {string} interruptedLabel @returns {Record<string, unknown>} */
function projected(ctx, interruptedLabel) {
  const turns = /** @type {Record<string, Turns>} */ (ctx.project(TURNS))[ctx.me] ?? NO_TURNS
  const live = ctx.driving(ctx.me)
  const rows = live ? [turnRow(ctx, turns), ...callRows(ctx)] : []
  return {
    rows,
    interruptedLabel,
    emptyNote: live ? '' : 'Nothing is running in this page.',
    stoppable: live,
  }
}

/** @param {Ctx} ctx @param {Turns} turns @returns {Record<string, unknown>} */
function turnRow(ctx, turns) {
  const elapsed = since(ctx, turns.openedAt)
  return {
    id: `turn:${ctx.agent.turnId || turns.openTurnId}`,
    kind: 'turn',
    name: `${ctx.me}'s turn`,
    detail: awaiting(ctx),
    elapsedSecs: elapsed,
    elapsedLabel: elapsedSentence(elapsed),
  }
}

/** One row per tool call the round is still waiting on. The correlation is `round.js`'s; this only reads it. */
function callRows(/** @type {Ctx} */ ctx) {
  const elapsed = since(ctx, /** @type {Record<string, Turns>} */ (ctx.project(TURNS))[ctx.me]?.openedAt ?? 0)
  return ctx.agent.batch.filter((asked) => !asked.done).map((asked) => ({
    id: `call:${asked.id}`,
    kind: 'tool',
    name: asked.tool,
    detail: 'Waiting on this call to come back.',
    elapsedSecs: elapsed,
    elapsedLabel: elapsedSentence(elapsed),
  }))
}

/** @param {Ctx} ctx */
function awaiting(ctx) {
  if (ctx.agent.awaiting === 'model') return 'Waiting on the model.'
  if (ctx.agent.awaiting === 'tools') return 'Waiting on the tools it called.'
  return 'Between steps.'
}

/**
 * HOW LONG, IN WHOLE SECONDS. Zero where the clock was not granted or the turn
 * never opened — and `elapsedLabel` then says so rather than printing `0s`,
 * which reads as "just started" for something that may have been running for a
 * minute.
 * @param {Ctx} ctx @param {number} openedAt
 */
function since(ctx, openedAt) {
  if (ctx.clock === null || openedAt === 0) return 0
  return Math.max(0, Math.round((ctx.clock - openedAt) / 1000))
}

/** @param {number} secs */
function elapsedSentence(secs) {
  if (secs === 0) return 'Just started.'
  if (secs < 60) return `${secs}s so far.`
  const mins = Math.floor(secs / 60)
  return `${mins}m ${secs % 60}s so far.`
}
