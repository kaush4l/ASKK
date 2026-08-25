/**
 * THE VERDICT OF A SEPARATE AGENT, READ MECHANICALLY.
 *
 * `critique` is a STAGE: the working model, in its own window, asked to read
 * back the turn it just took. This file is the other thing — an agent holding
 * `role: critic`, with its own prompt, its own Worker, no sight of the caller's
 * conversation and no way to change anything — and the one rule that stops its
 * answer being decoration.
 *
 * BOTH SHIP, AND NEITHER REPLACES THE OTHER, because they are different jobs:
 *
 * - The STAGE is REFLECTION. Same model, same window, still holding every
 *   belief it held while doing the work. It produces prose for the person, it
 *   costs one call, and it improves the ANSWER. It cannot gate anything,
 *   because nothing mechanical reads it.
 * - The AGENT is a VERDICT. Its reply comes back as an ordinary tool result,
 *   `round.js` folds it like every other result, and [`passed`] reads its first
 *   line. It cannot improve the answer — it can only refuse to clear it.
 *
 * So a model marking its own homework is worth having and is not a gate, for
 * exactly the reason `passes.js` never asks a model whether it is finished.
 * `public/agents/critic/agent.md` is the shipped holder of the role and `main`
 * names it in its `tools:`, because a role nobody names is a role nobody calls:
 * invocation is NAMED, never automatic.
 *
 * IT FAILS TOWARDS THE FAULT. Only the exact word `PASS` on the first non-empty
 * line clears the work; a rambling verdict, a refusal, and a critic call that
 * failed outright are all "not passed". A false fault costs a word on a card a
 * person can read the reply and disagree with. A false pass is the thing this
 * file exists to prevent.
 * @module
 */

/** The turn was not cleared by the agent that reviewed it. Reported ahead of `answered` because a turn the critic faulted is not a turn that answered. */
export const CRITIC_FAULTED = 'critic faulted'

/** The two words the critic's prompt asks for. `FAULT` is never tested against — anything that is not `PASS` is not a pass — and it is named here because the shipped agent file and this file have to agree on the vocabulary. */
export const PASS = 'PASS'
export const FAULT = 'FAULT'

/**
 * Whether this verdict cleared the work. The first non-empty line must be the
 * word and NOTHING else: a prefix test would let "PASSING on the tests would be
 * nice" through, which is the opposite of what it says. Case is ignored and
 * nothing else is — `Pass` from a small local model is the same answer, while a
 * sentence containing the word is not an answer at all.
 * @param {string} verdict @returns {boolean}
 */
export function passed(verdict) {
  const first = verdict.split('\n').map((line) => line.trim()).find((line) => line !== '')
  return first !== undefined && first.toLowerCase() === PASS.toLowerCase()
}
