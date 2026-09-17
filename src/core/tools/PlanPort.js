import { Plan } from '../Plan.js'

/**
 * Where the conversation's plan is kept, as a capability handed in from
 * outside.
 *
 * A port rather than a reference to the conversation store, for the reason
 * every other port here exists: `core/` may not know that IndexedDB is how a
 * conversation persists. What is behind this could be a record, a file or a
 * server, and all this layer needs is to read the plan and say that a revised
 * one should be kept.
 *
 * The contract:
 *
 *     port.read()      -> Plan          the live plan, the same object the
 *                                       prompt block renders
 *     port.write(plan) -> Promise<bool> true when it was persisted
 *
 * `read` returns the LIVE object rather than a copy on purpose. The engine
 * renders the plan into every step of a turn, so a step that revises the plan
 * must change what the next step of the same turn reads — a copy would leave
 * the agent re-reading the list it had already replaced and ticking off steps
 * that no longer exist. Whether that revision outlives the tab is the separate,
 * slower question `write` answers.
 */

/**
 * The port used when nobody supplied one.
 *
 * Answers rather than fails, like `NO_TASKS` and `NO_FILES` beside it: a tool
 * built without its collaborator should be able to say what it cannot do
 * rather than throw on a user's machine. The plan it hands back is real and
 * usable for the length of the turn; what it cannot do is outlive it, and
 * `write` returning false is how the tool learns to say so.
 */
export const NO_PLAN = Object.freeze({
  read: () => new Plan(),
  write: async () => false,
})

export const planOr = (port) => port ?? NO_PLAN
