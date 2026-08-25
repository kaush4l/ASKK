/**
 * THE TWO MESSAGES THAT CROSS BETWEEN A LEAD AND A SUB-AGENT, and nothing else
 * ever does.
 *
 * A sub-agent is not a function this process calls. It is the same loop running
 * in its own Worker, with its own store and its own log, and the ONLY thing the
 * two halves share is this pair of records: a goal going out, an ending coming
 * back. That is what the caller "never holds the callee's loop" means once it
 * is a mechanism rather than a sentence — there is no channel here wide enough
 * to pass an `AgentState`, a step function or a port through, so no future
 * edit can quietly start sharing one.
 *
 * THE ENDING IS THE CALLEE'S OWN WORDS. The predecessor inferred one from an
 * `agent_status` record the CALLER wrote after its own await returned, which is
 * why a sub-agent that hit its round ceiling and a sub-agent that answered were
 * one outcome upstream. `why` is the ending this errand's own reducer recorded,
 * quoted verbatim.
 * @module
 */

/** The envelope version (I18). A message from a newer build is refused BY NAME rather than read half-way: the two halves are separate bundles and a stale Worker can outlive a deploy. */
export const ERRAND_PROTOCOL = 1

/** `from` is the ASKING agent's own name, carried rather than invented: the callee stamps it on the fact that opens its turn, and `core`'s transcript reads that field as "who asked" — a name minted at the far end would name an agent nobody runs. @typedef {{v: number, type: 'begin', errandId: string, goal: string, from: string}} Begin */

/** @typedef {{v: number, type: 'ended', errandId: string, ok: boolean, text: string, why: string}} Ended */

/** @typedef {Begin | Ended} ErrandMessage */

/** @param {string} errandId @param {string} goal @param {string} from  the asking agent's name @returns {Begin} */
export function beginMessage(errandId, goal, from) {
  return { v: ERRAND_PROTOCOL, type: 'begin', errandId, goal, from }
}

/**
 * @param {string} errandId @param {{ok: boolean, text: string, why: string}} of
 * @returns {Ended}
 */
export function endedMessage(errandId, of) {
  return { v: ERRAND_PROTOCOL, type: 'ended', errandId, ...of }
}

/**
 * ONE ARRIVING MESSAGE, OR THE SENTENCE SAYING WHY IT COULD NOT BE READ.
 *
 * Anything crossing a Worker boundary arrives as `unknown` — a stale bundle, a
 * message meant for something else, a structured clone of the wrong shape — and
 * a reader that guesses at one starts a turn nobody asked for. Refusing in
 * words is what lets both halves say which message they could not read.
 * @param {unknown} message @returns {ErrandMessage | {unreadable: string}}
 */
export function readMessage(message) {
  if (typeof message !== 'object' || message === null) return { unreadable: `an errand message arrived as ${message === null ? 'null' : typeof message}` }
  const said = /** @type {Record<string, unknown>} */ (message)
  if (said['v'] !== ERRAND_PROTOCOL) return { unreadable: `this errand speaks protocol ${ERRAND_PROTOCOL} and the message says ${JSON.stringify(said['v'])}` }
  if (typeof said['errandId'] !== 'string' || said['errandId'] === '') return { unreadable: 'an errand message arrived naming no errand' }
  if (said['type'] === 'begin' && typeof said['goal'] === 'string' && typeof said['from'] === 'string') return /** @type {Begin} */ (message)
  if (said['type'] === 'ended' && typeof said['text'] === 'string' && typeof said['why'] === 'string' && typeof said['ok'] === 'boolean') {
    return /** @type {Ended} */ (message)
  }
  return { unreadable: `an errand message of type ${JSON.stringify(said['type'])} is not one this build sends` }
}
