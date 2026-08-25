/**
 * L0 identifiers. Branded string aliases, not classes: an id is a value, and a
 * class here would buy nothing but a constructor call at every boundary.
 * @module
 */

/** @typedef {string} AgentId    name of an agent, e.g. "main" */
/** @typedef {string} ModuleId   name of a module/pane, e.g. "chat" */
/** @typedef {string} ToolId     name of a tool, e.g. "search" */
/** @typedef {string} SectionId  name of a context section, e.g. "observations" */
/** @typedef {string} EndpointName symbolic endpoint; the adapter resolves it and attaches the key (I6) */
/** @typedef {number} EventId    log position of a fact */
/** @typedef {string} TurnId    one attempt at answering one message; see below */
/** @typedef {number} Timestamp  epoch milliseconds, always injected (I7) */
/** @typedef {string} Version    semver-ish module version */

/** The model endpoint every agent call is brokered through. @type {EndpointName} */
export const MODEL_ENDPOINT = 'model'

/** The search endpoint web reads are brokered through. @type {EndpointName} */
export const SEARCH_ENDPOINT = 'search'

/** The agent a PERSON talks to. Every other agent answers to another agent. */
export const ENTRY_AGENT = 'main'

/**
 * A TURN is one attempt at answering one message, and naming it is what makes
 * I21 enforceable: every effect carries the turn it was queued under and the
 * reducer drops any fact whose turn is no longer live. The predecessor had no
 * such name, which is why a tool result arriving after its turn was abandoned
 * decremented a counter and billed a fresh model call.
 *
 * The alias lives here rather than in `packages/agent` because two packages
 * touch it — the loop stamps effects, the spine mints one per accepted message
 * — and an id spelled in two places is an id that will differ once.
 */

/**
 * The STAGES a turn can walk. A stage is `{brief, toolAllowlist, responseSchema}`
 * — what the model is told this pass, what it may call, and the shape the reply
 * must take.
 *
 * **This replaces `PhaseId`, and the difference is not cosmetic.** A phase was
 * a state in a machine with exits, retries and a plan cursor; that machine was
 * assigned nowhere in 67,476 lines of the tree it was written for, its exit
 * table had zero readers, and it is retired (`docs/RULINGS.md`). A stage is a
 * BRIEF, and an agent file declares the list it walks. `strategy` is here
 * because the roster's entry agent declares exactly it: one cheap call that
 * reads the message and chooses the list for the rest of the turn.
 * @typedef {'strategy'|'plan'|'work'|'verify'|'critique'} StageId
 */

/** @type {readonly StageId[]} */
export const STAGES = /** @type {const} */ (['strategy', 'plan', 'work', 'verify', 'critique'])
