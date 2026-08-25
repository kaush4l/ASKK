/**
 * The budget is DERIVED, never declared (`docs/RULINGS.md` Attack 4).
 *
 * The window belongs to the model, the reply has to fit inside it, and the
 * estimator is not a tokenizer — so what the paper may spend is what is left
 * after those two are taken out. Every subtraction is NAMED in the returned
 * object, because a ceiling nobody can check is how 8192 survived as the one
 * budget for every model: a number with no arithmetic attached cannot be
 * argued with, and the debug view had nothing to show but the number.
 *
 * There is no branch on a model NAME anywhere in this file, and that is the
 * property the tests hold: a 4k model and a 200k model differ only in what
 * their card says.
 * @module
 */

import { HarnessError } from '@harness/kernel'

/** @typedef {import('./card.js').ModelCard} ModelCard */
/** @typedef {import('./types.js').Budget} Budget */

/**
 * What this particular turn wants back. An object and not a number for the
 * reason `Budget` is one: the arithmetic will grow a term — a stage's declared
 * reply schema, an attachment already accepted — and growing it must not touch
 * every call site.
 * @typedef {{replyTokens?: number}} Turn
 */

/** One named term of the subtraction, in the order it is taken. */
/** @typedef {{name: string, tokens: number, why: string}} Subtraction */

/**
 * A `Budget` that can show its work. `maxTokens` is the only field assembly
 * reads; the rest is for the person who asks why a section was dropped.
 * @typedef {Budget & {window: number, subtractions: Subtraction[]}} DerivedBudget
 */

/**
 * The share of the window reserved for the reply when nothing states it. An
 * eighth: the reply to a full window is an answer, not a second window.
 */
const REPLY_SHARE = 1 / 8

/** Below this the model cannot finish a sentence, whatever the share works out to. */
const REPLY_FLOOR = 256

/**
 * Above this the reservation stops growing with the window. A turn produces
 * ONE message against a response contract; reserving 25,000 tokens out of a
 * 200k window because the window is large buys nothing and costs history.
 */
const REPLY_CEILING = 4096

/**
 * The estimator's slack, as a share of the window. Proportional and not flat
 * because the error is proportional: `estimate` is characters-per-token
 * arithmetic over the rendered artifact, and a longer artifact carries more of
 * it. A flat reserve is right for a 4k window and invisible at 200k.
 */
const RESERVE_SHARE = 0.05

/** The smallest slack worth reserving at all. */
const RESERVE_FLOOR = 128

/**
 * What to hold back for the reply: what the turn asked for, else a share of
 * the window, never more than the model says it will emit.
 * @param {ModelCard} card
 * @param {Turn} turn
 */
function replyReservation(card, turn) {
  // Read ONCE: a `replyTokens` of 0 is a number that is not an ask, and spelling
  // "did the turn ask?" twice let a 0 take the derived eighth past the ceiling.
  const asked = typeof turn.replyTokens === 'number' && turn.replyTokens > 0 ? Math.floor(turn.replyTokens) : null
  const derived = Math.round(card.contextTokens * REPLY_SHARE)
  let tokens = asked ?? derived
  let why =
    asked === null
      ? `an eighth of the ${card.contextTokens}-token window, clamped to ${REPLY_FLOOR}..${REPLY_CEILING}`
      : 'this turn asked for that many output tokens'
  if (asked === null && tokens > REPLY_CEILING) tokens = REPLY_CEILING
  if (tokens < REPLY_FLOOR) tokens = REPLY_FLOOR
  if (card.maxOutputTokens !== null && tokens > card.maxOutputTokens) {
    tokens = card.maxOutputTokens
    why = `"${card.name}" says it emits at most ${card.maxOutputTokens} tokens`
  } else if (card.maxOutputTokens === null) {
    why += '; the catalogue entry does not state a maximum output'
  }
  return { name: 'reply', tokens, why }
}

/**
 * The budget for assembling one turn's paper against one model.
 *
 * @param {ModelCard} card
 * @param {Turn} [turn]
 * @returns {DerivedBudget}
 * @throws {HarnessError} `window_too_small` when nothing is left for the paper
 */
export function budgetFor(card, turn = {}) {
  const window = card.contextTokens
  const reply = replyReservation(card, turn)
  const reserve = {
    name: 'estimator reserve',
    tokens: Math.max(RESERVE_FLOOR, Math.round(window * RESERVE_SHARE)),
    why: `${RESERVE_SHARE * 100}% of the window: the estimate is arithmetic, not a tokenizer`,
  }
  const maxTokens = window - reply.tokens - reserve.tokens
  if (maxTokens <= 0) {
    throw new HarnessError(
      'window_too_small',
      `"${card.name}" has a ${window}-token window, and the reply and the estimator reserve need ${reply.tokens + reserve.tokens} of it`,
      { detail: `${reply.name} ${reply.tokens} (${reply.why}); ${reserve.name} ${reserve.tokens}` },
    )
  }
  return { maxTokens, window, subtractions: [reply, reserve] }
}

/**
 * The arithmetic as one line a person reads, in the debug view and in a
 * failure. It exists here and not in the interface because I5 says the core
 * owes the UI the worded fact — two panes wording this for themselves would
 * word it differently.
 * @param {DerivedBudget} budget
 */
export function budgetSentence(budget) {
  const terms = budget.subtractions.map((s) => `${s.tokens} for the ${s.name}`).join(', minus ')
  return `${budget.maxTokens} tokens for the paper: a ${budget.window}-token window, minus ${terms}.`
}
