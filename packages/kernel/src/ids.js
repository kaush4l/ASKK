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
/** @typedef {number} Timestamp  epoch milliseconds, always injected (I7) */
/** @typedef {string} Version    semver-ish module version */

/** The model endpoint every agent call is brokered through. @type {EndpointName} */
export const MODEL_ENDPOINT = 'model'

/** The search endpoint web reads are brokered through. @type {EndpointName} */
export const SEARCH_ENDPOINT = 'search'

/** The agent a PERSON talks to. Every other agent answers to another agent. */
export const ENTRY_AGENT = 'main'

/**
 * The phases a turn can be in. Closed on purpose: a phase the machine cannot
 * name is a phase no test can reach.
 * @typedef {'plan'|'work'|'verify'|'critique'} PhaseId
 */

/** @type {readonly PhaseId[]} */
export const PHASES = /** @type {const} */ (['plan', 'work', 'verify', 'critique'])
