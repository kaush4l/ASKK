/**
 * State — what every agent is doing, right now.
 *
 *     state.snapshot()   ->  one AgentState per loaded agent
 *     state.report()     ->  the same thing as a line per agent, for a human
 *
 * Every agent runs on its own worker, so nothing in the page can see the whole
 * picture by reading a local variable. This is that view: one table, written by
 * whichever caller changed something and read by any other.
 *
 * Statuses are about who the agent is waiting on, not about the model:
 *
 *     starting   its worker exists, its engine is still being built
 *     idle       loaded and doing nothing — nobody has called it
 *     working    inside a turn: inferring, or running a tool, or summarising
 *     waiting    it answered, and the next move is the user's
 *     failed     it did not load, or its last turn raised
 *     closed     its worker is stopped
 *
 * ``idle`` and ``waiting`` are both "not busy"; the difference is whether anyone
 * is expected to speak next. A sub-agent goes back to idle after it answers,
 * because its caller already has what it asked for.
 *
 * The Python held a threading.Lock here because its writers were on different
 * loops. There is no lock in this port and none is needed: one JS thread per
 * worker means every read-modify-write below is already serialized, and a mutex
 * that guards nothing is a lie about the danger.
 */

/**
 * @typedef {"starting"|"idle"|"working"|"waiting"|"failed"|"closed"} StatusValue
 */

/** @type {{ STARTING: StatusValue, IDLE: StatusValue, WORKING: StatusValue, WAITING: StatusValue, FAILED: StatusValue, CLOSED: StatusValue }} */
export const Status = Object.freeze({
  STARTING: "starting",
  IDLE: "idle",
  WORKING: "working",
  WAITING: "waiting",
  FAILED: "failed",
  CLOSED: "closed",
});

/**
 * The clock half of the ports object (S9). `since` is wall-clock time a human
 * reads off a report line, so it is the environment's to supply, never this
 * module's.
 * @typedef {{ now: () => Date | number }} Clock
 */

/**
 * @param {Date} at
 * @returns {string} the Python's `%H:%M:%S`
 */
function hms(at) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

/** One agent's row. Frozen, so a snapshot cannot change under its reader. */
export class AgentState {
  /**
   * @param {object} row
   * @param {string} row.name
   * @param {Date} row.since when this status was entered
   * @param {string} [row.thread] keeps its Python name: whatever owns the
   *   agent's turn — a thread there, a worker here
   * @param {boolean} [row.builtin]
   * @param {StatusValue} [row.status]
   * @param {number} [row.turns]
   * @param {string} [row.detail]
   */
  constructor({
    name,
    since,
    thread = "",
    builtin = false,
    status = Status.STARTING,
    turns = 0,
    detail = "",
  }) {
    /** @type {string} */
    this.name = name;
    /** @type {string} */
    this.thread = thread;
    /** @type {boolean} */
    this.builtin = builtin;
    /** @type {StatusValue} */
    this.status = status;
    /** @type {number} */
    this.turns = turns;
    /** @type {Date} */
    this.since = since;
    /** @type {string} */
    this.detail = detail;
    Object.freeze(this);
  }

  /** @returns {string} */
  toString() {
    const origin = this.builtin ? "builtin" : "agents";
    const line = `${this.name} [${origin}]: ${this.status} (${this.turns} turns, since ${hms(this.since)})`;
    return this.detail ? `${line} — ${this.detail}` : line;
  }
}

/** The one table. */
export class State {
  /** @param {Clock} clock */
  constructor(clock) {
    /** @type {Clock} */
    this._clock = clock;
    /** @type {Map<string, AgentState>} */
    this._agents = new Map();
  }

  /** @returns {Date} */
  _now() {
    const at = this._clock.now();
    return at instanceof Date ? at : new Date(at);
  }

  /**
   * @param {string} name
   * @param {string} [thread]
   * @param {boolean} [builtin]
   * @returns {void}
   */
  register(name, thread = "", builtin = false) {
    this._agents.set(name, new AgentState({ name, thread, builtin, since: this._now() }));
  }

  /**
   * Move an agent to a status. Counts a turn each time it starts working.
   * @param {string} name
   * @param {StatusValue} status
   * @param {string} [detail]
   * @returns {void}
   */
  set(name, status, detail = "") {
    const since = this._now();
    const current = this._agents.get(name) ?? new AgentState({ name, since });
    this._agents.set(
      name,
      new AgentState({
        name: current.name,
        thread: current.thread,
        builtin: current.builtin,
        status,
        detail,
        since,
        turns: current.turns + (status === Status.WORKING ? 1 : 0),
      }),
    );
  }

  /**
   * @param {string} name
   * @returns {AgentState | null}
   */
  get(name) {
    return this._agents.get(name) ?? null;
  }

  /** @returns {AgentState[]} */
  snapshot() {
    return [...this._agents.values()].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
  }

  /** @returns {string} */
  report() {
    return this.snapshot().map((agent) => agent.toString()).join("\n") || "no agents loaded";
  }

  /** @returns {void} */
  clear() {
    this._agents.clear();
  }
}
