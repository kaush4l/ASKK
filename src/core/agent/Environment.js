/**
 * What is true right now, stated once, at the end of the prompt.
 *
 * ONE fact. A model knows what it was trained on and nothing about the moment
 * it is answering in — the clock is the only thing it cannot derive, guess, or
 * be told by the conversation itself.
 *
 * Everything else that was tried here has been removed. The locale is already
 * carried by the language the conversation is in; the agent's own name is
 * stated in its instructions; the platform and the realm are things it has no
 * decision to make about; whether storage persists is the app's problem and is
 * reported to the user directly, not to the model. Each of them was a line paid
 * for on every call in exchange for nothing.
 *
 * The bar a fact has to clear: it must change an answer.
 *
 * Read from `Intl`, which exists in the page and in a worker alike. That is what
 * keeps this file in `core/`.
 *
 * This block is also the ONLY clock the agent has — there is no `now` tool,
 * because a tool that returns something already written in the prompt costs a
 * call, a result and a second inference to learn what the model read a few
 * hundred characters earlier. Being the clock is what makes the block volatile,
 * and that is what decides where it is rendered: after the conversation, so a
 * value that ticks cannot push the transcript out of the reusable prefix.
 *
 * Seconds are left off. Nothing is decided by them, and they would make two
 * calls in the same turn differ for no reason.
 */

/** The moment, written out. Not parseable, and not meant to be — it is read. */
function moment(at) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
}

function timezone() {
  // A browser that hides its zone reports undefined rather than failing, and an
  // absent zone is better than a wrong one.
  return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
}

/**
 * The context block's contents, as ordered label/value pairs.
 *
 * A list of pairs for one fact is not over-engineering: it is the shape the
 * prompt block already renders, so the day a second fact clears the bar it is
 * one line here and nothing else changes.
 *
 * @param {{at?: Date}} facts
 * @returns {Array<[string, string]>}
 */
export function describeEnvironment({ at = new Date() } = {}) {
  return [['now', [moment(at), timezone() && `(${timezone()})`].filter(Boolean).join(' ')]]
}
