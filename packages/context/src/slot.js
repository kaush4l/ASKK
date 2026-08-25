/**
 * Where a component belongs in the prompt. The numbers ARE the prompt order:
 * assembly sorts by slot ascending and does nothing else, so ordering is
 * structural rather than conventional.
 *
 * THIS IS THE TYPE THAT ENDED AN ACCIDENT. Order used to be a sort by
 * stability, which made a CACHING property do an ORDERING job: the response
 * contract is static, so the instruction telling the model what shape to reply
 * in rendered fourth, near the top, behind everything it was supposed to be
 * read after. A slot says WHERE a thing goes and nothing about how often it
 * changes; `Stability` says how often it changes and nothing about where it
 * goes. Two questions, two types.
 *
 * The gaps of ten are the headroom, and they are the reason this is an open
 * number and not a closed union. A component does not have to live in this
 * package — a browser faculty, a shared-space block, an artifact shelf — and
 * each must be able to say where it sits by naming a number, without a patch
 * here. Slot 92 lands between OBSERVATIONS and DIRECTIVE and renumbers
 * nothing, which matters because renumbering rewrites every golden.
 *
 * In Rust this was a newtype over `u8` to get a distinct type and a derived
 * `Ord`. In JavaScript a slot is a number; the vocabulary below is what makes
 * it legible, and the two predicates are what make the pinned ends checkable.
 * @module
 */

/**
 * The prompt's sections, in the order the model reads them.
 *
 * Two ends are pinned on purpose and everything between them is arrangement:
 * SOUL is first because an agent must be someone before it is told anything,
 * and RESPONSE is last because the shape of the reply is the instruction the
 * model should be holding when it starts writing.
 */
export const SLOT = /** @type {const} */ ({
  /** Who this agent is. Always first. */
  SOUL: 0,
  /** Name, role, presentation. */
  IDENTITY: 10,
  /** How to behave; the response discipline. */
  OPERATING_RULES: 20,
  /**
   * WHAT THIS AGENT IS FOR — the standing goal its own file declares. In the
   * stable head and not beside TASK on purpose: a task is what the person
   * typed this turn and changes with every message; a standing goal comes from
   * the same file the soul does and outlives every turn.
   */
  GOAL: 25,
  /**
   * What exists and how to call it. Stable, so the toolbox stays inside the
   * cacheable head rather than landing after the transcript.
   */
  AFFORDANCES: 30,
  /** Durable facts about the person. */
  USER: 40,
  /** Retained knowledge across sessions. */
  MEMORY: 50,
  /** The shared space: its workspace folder, its settled facts, its notes. */
  SPACE: 55,
  /**
   * Time, locale, device — what is true of this moment and no other. Never
   * cached: a cached clock is a wrong clock. The shared space is NOT here; it
   * is its own slot five up, because what a group has agreed is not a property
   * of the current instant.
   */
  ENVIRONMENT: 60,
  /** What is being attempted right now. */
  TASK: 70,
  /** The conversation so far. */
  HISTORY: 80,
  /** Results of the last actions. */
  OBSERVATIONS: 90,
  /**
   * What this turn is being asked to do. Last of the content, because it is
   * the instruction the reply must satisfy.
   */
  DIRECTIVE: 95,
  /** The exact shape of the expected reply. Always last. */
  RESPONSE: 99,
})

/**
 * The pinned head. `validate` requires one of these to exist: a prompt without
 * it is an agent that was never told who it is.
 * @param {number} slot
 */
export function isHead(slot) {
  return slot === SLOT.SOUL || slot === SLOT.IDENTITY
}

/**
 * The system region: everything the model reads as ITS OWN standing
 * instructions — who it is, how to behave, what it may call — plus the
 * response contract at the pinned tail.
 *
 * The boundary is HISTORY, because a conversation is the first thing in the
 * prompt that somebody other than this build wrote. Untrusted content may not
 * sit before it (`assemble` refuses), which is the structural half of the
 * trust boundary; the other half is the provider adapter, which carries an
 * untrusted section to the user role rather than the system one.
 * @param {number} slot
 */
export function isSystemSlot(slot) {
  return slot < SLOT.HISTORY || isTail(slot)
}

/**
 * The pinned tail. Exactly one component may claim it, and it sorts last.
 *
 * This is also the one place the stability order is allowed to break. Prefix
 * caching only ever caches a PREFIX: once the environment and the history have
 * changed, nothing after them was going to be cached wherever it sat, so
 * pinning static contract text behind them costs no cache that was reachable
 * and buys recency for the output format.
 * @param {number} slot
 */
export function isTail(slot) {
  return slot === SLOT.RESPONSE
}
