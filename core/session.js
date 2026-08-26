/**
 * The session — the one mutable object the phases share.
 *
 * Every phase reads and writes this blackboard; components render slices of it.
 * There is one conversation history for the whole run — phases swap which
 * components are active, never the transcript itself.
 *
 * Nothing here talks to a model or renders a prompt. The session is data.
 */

/** @typedef {"simple" | "complex"} Complexity */
/** @typedef {"blocking" | "minor"} Severity */

/**
 * One conversation turn.
 *
 * Declared here rather than imported from `core/inference.js`, because the
 * session must not depend on any other core module — the blackboard is the one
 * thing every layer may hold.
 *
 * @typedef {{ role: "system" | "user" | "assistant", content: string }} Message
 */

export const PENDING = "pending"
export const DONE = "done"

/** One planned unit of work. */
export class Step {
  /** @param {{ description: string, status?: string, notes?: string }} data */
  constructor(data) {
    /** @type {string} */
    this.description = data.description
    /** @type {string} */
    this.status = data.status ?? PENDING
    /** @type {string} */
    this.notes = data.notes ?? ""
  }
}

/** What actually happened when a step was worked. */
export class StepResult {
  /** @param {{ step: string, outcome?: string, ok?: boolean }} data */
  constructor(data) {
    /** @type {string} */
    this.step = data.step
    /** @type {string} */
    this.outcome = data.outcome ?? ""
    /** @type {boolean} */
    this.ok = data.ok ?? true
  }
}

/** One finding from the critic. Blocking findings send the plan back. */
export class Critique {
  /** @param {{ finding: string, severity?: Severity, resolved?: boolean }} data */
  constructor(data) {
    /** @type {string} */
    this.finding = data.finding
    /** @type {Severity} */
    this.severity = data.severity ?? "minor"
    /** @type {boolean} */
    this.resolved = data.resolved ?? false
  }
}

/**
 * @typedef {object} SessionData
 * @property {string} [query]
 * @property {string} [enhanced]
 * @property {Complexity} [complexity]
 * @property {unknown[]} [skills]
 * @property {Step[]} [plan]
 * @property {StepResult[]} [stepResults]
 * @property {Critique[]} [critiques]
 * @property {Message[]} [messages]
 * @property {number} [round]
 * @property {string} [verifyReport]
 */

/** The blackboard. Owned by one Agent; passed to every phase it runs. */
export class Session {
  /** @param {SessionData} [data] */
  constructor(data = {}) {
    /** @type {string} */
    this.query = data.query ?? ""
    /** @type {string} */
    this.enhanced = data.enhanced ?? ""
    /** @type {Complexity} */
    this.complexity = data.complexity ?? "simple"
    /**
     * loaded Skill objects (skills.js)
     * @type {unknown[]}
     */
    this.skills = data.skills ?? []
    /** @type {Step[]} */
    this.plan = data.plan ?? []
    /** @type {StepResult[]} */
    this.stepResults = data.stepResults ?? []
    /** @type {Critique[]} */
    this.critiques = data.critiques ?? []
    /**
     * Held by reference, not copied: the transcript owns this array and the
     * session is a view onto it, so an appended turn is visible to every phase.
     * @type {Message[]}
     */
    this.messages = data.messages ?? []
    /**
     * plan → critique revision rounds taken
     * @type {number}
     */
    this.round = data.round ?? 0
    /**
     * the verifier's last report, shown to the critic
     * @type {string}
     */
    this.verifyReport = data.verifyReport ?? ""
  }

  /** What the work is actually about — the enhanced query once one exists.
   * @returns {string}
   */
  get goal() {
    return this.enhanced || this.query
  }

  /** @returns {Critique[]} */
  get unresolved() {
    return this.critiques.filter((c) => c.severity === "blocking" && !c.resolved)
  }

  /** A new user turn: new goal, fresh working state, same conversation.
   * @param {string} query
   * @returns {void}
   */
  resetFor(query) {
    this.query = query
    this.enhanced = ""
    this.complexity = "simple"
    // Emptied in place rather than rebound, because anything already holding
    // one of these lists must see the clear.
    this.plan.length = 0
    this.stepResults.length = 0
    this.critiques.length = 0
    this.round = 0
    this.verifyReport = ""
  }
}
