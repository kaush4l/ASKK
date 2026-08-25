/**
 * WHAT A HANDLER IS HANDED: its effective grant, and exactly what that grant
 * buys. Ungranted is ABSENT — `null`, not present-but-refused — so a handler
 * cannot reach a capability it was denied even by mistake (I6).
 *
 * Rust handed over twenty pre-computed projections here (the board, the
 * roster, the window, every resolved model) because a handler could not borrow
 * `App` while `App` was borrowed mutably to run it. That is a borrow-checker
 * shape, not a problem shape: it made every request clone the whole log, which
 * made each poll dearer than the last. The projections that survive are the
 * ones a view actually asks for.
 *
 * NO HANDLER RECEIVES THE EVENT ARRAY (RULINGS, attack 2). Handing over
 * `log.events` would have been a second authority on history — `push` and
 * `splice` are writes the append-only log itself refuses to offer, and a
 * `readonly` JSDoc annotation cannot stop either. History arrives as `project`,
 * a read of a registered reducer's folded state: the fold ran once, at append,
 * and there is no array here to walk even if a handler wanted to (I20).
 * @module
 */

import { effectiveGrant, grants } from '@harness/kernel'

import { driving } from './drive.js'

/** @typedef {import('@harness/kernel').CapabilityGrant} CapabilityGrant */
/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Timestamp} Timestamp */
/** @typedef {import('./app.js').App} App */

/**
 * @typedef {{
 *   grant: CapabilityGrant,
 *   clock: Timestamp|null,
 *   emit: ((fact: Fact) => void)|null,
 *   project: (name: string) => unknown,
 *   me: string,
 *   driving: (agent: string) => boolean,
 *   durable: boolean,
 *   bootedAt: number,
 * }} Ctx
 */

/**
 * RECORD A FACT AND HAND IT TO THE LOOP. Both, together: a fact the log holds
 * that the loop never sees is a message a person watches land and an agent
 * never answers — the seam is synchronous by construction, so the QUEUE is how
 * a press becomes work the driver picks up after `handle` has returned.
 * @param {App} app @param {Fact} fact
 */
function queue(app, fact) {
  const event = app.log.append(fact, app.ports.clock.now())
  app.pending.push({ at: event.at, turnId: null, fact })
}

/**
 * Build the context for ONE invocation. Never stored: a grant is a fact about
 * this request, and a handler that kept one would outlive the narrowing.
 * @param {App} app
 * @param {Manifest} manifest
 * @returns {Ctx}
 */
export function contextFor(app, manifest) {
  const grant = effectiveGrant(manifest.id, manifest.capabilities, app.available)
  return {
    grant,
    clock: grants(grant, 'clock') ? app.ports.clock.now() : null,
    // The module never sees the timestamp it is stamped with, granted `clock`
    // or not: the LOG stamps a fact, because a fact whose time its author
    // chose is a fact a person cannot trust.
    emit: grants(grant, 'emit') ? (fact) => queue(app, fact) : null,
    // Ungated, unlike `emit`: reading a projection is what answering a GET IS,
    // and a capability that every module must hold to do its job is a line of
    // configuration rather than a boundary.
    project: (name) => app.log.read(name),
    // WHOSE LOOP THIS PROCESS RUNS. A handler that guessed it would answer
    // `/chat` with no agent header for whichever agent it liked.
    me: app.me,
    // Live state a RELOAD DOES NOT HAVE, which is exactly why it is here: the
    // shape of the log survives a refresh and the fetch behind it does not, so
    // "a turn is open" and "a turn is running" are two different questions.
    driving: (agent) => driving(app, agent),
    // Whether anything written to the workspace survives a refresh, asked of
    // the port rather than assumed — `durable()` returning `true` on behalf of
    // an adapter that returned `false` is the defect this build refuses.
    durable: app.ports.workspace.durable(),
    bootedAt: app.bootedAt,
  }
}
