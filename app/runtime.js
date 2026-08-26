/** The runtime — the one object the interface talks to.
 *
 *     const runtime = createRuntime()
 *     runtime.on("turn:end", ({ answer }) => …)
 *     await runtime.start()
 *     await runtime.send("hello")
 *
 * Every other file in `app/` imports from here and never from `core/`. That is
 * the seam that keeps the rule enforceable: a view that could reach into
 * `core/` would eventually compute something — a byte count, a hit ratio, a
 * status — and the screen would stop being a report of what happened.
 *
 * It emits rather than being polled. A view asking "what now?" on a timer
 * renders a state that was true a moment ago and misses every state shorter
 * than its interval. Three of the events are not observable from this thread
 * at all — the phase, the assembled prompt and the tool results all happen
 * inside a worker — so they arrive over the worker's own port. See TELEMETRY. */

import { Slot } from "../core/component-base.js";
import { loadAgents, MAIN_AGENT } from "../core/registry.js";
import { goalOf } from "../core/schedule.js";
import { State, Status } from "../core/state.js";
import { TELEMETRY } from "../core/telemetry.js";
import { why } from "../core/worker-host.js";
import { browserPorts, workerUrl } from "./ports-browser.js";
import { seed } from "./seed.js";

export { Slot, Status };

/** @typedef {import("./ports-browser.js").BrowserPorts} BrowserPorts */
/** @typedef {import("../core/registry.js").WorkerAgent} WorkerAgent */
/** @typedef {(payload: any) => void} Listener */

/** The message type a worker uses to report what only it can see, declared in
 * `core/telemetry.js` beside the observers that write it so both ends name it once.
 * `AgentWorker` correlates replies by `id` and drops a message it does not
 * recognise, so an extra type on the same port disturbs nothing. The worker
 * entry posts `{ type: TELEMETRY, event, payload }`, and only the three events
 * below are forwarded: a worker may report what it saw, never announce a turn
 * that this side is the one to know about. */
export { TELEMETRY };

/** @type {readonly string[]} */ export const WORKER_EVENTS = Object.freeze(["phase:enter", "prompt:assembled", "tool:results"]);

/** `prompt:assembled` — one entry per component that survived `applies()`, in
 * the order the assembler joined them. `memo` is whether this render came back
 * from the cache; `cacheable` is `false` for CONTEXT, which opts out because a
 * cached clock is a wrong clock. `hits` and `misses` are the assembler's own
 * running totals, carried whole rather than recounted.
 * @typedef {{ slot: number, name: string, key: string, bytes: number, memo: boolean, cacheable: boolean }} Band
 * @typedef {{ agent: string, phase: string, bytes: number, bands: Band[], hits: number, misses: number }} Assembled */

/** How much of a run is kept for a view that mounts after it, and why a replay
 * is asked for rather than given.
 *
 * A run is bounded by `turn:start`, and each one drops what the last one left.
 * Retaining since boot is a leak; the transcript already holds the conversation,
 * so what is kept is only what the *worker* reported — the part this thread
 * cannot recompute. Past the cap the oldest goes, which costs a late mount the
 * opening phases of a loop no bounded run reaches. And the replay is opt-in
 * because `converse.js` subscribes to these same events to narrate a run *as it
 * happens*: replaying into it would leave a finished turn showing a mid-run
 * activity line in place of its answer. */
const RETAINED = 200;

/** Notify on every write to the state table. `State` has no observer of its
 * own, so its two writers are wrapped here, on the instance this runtime owns:
 * polling would miss a `working` status that lasted 200ms.
 * @param {State} state @param {() => void} notify @returns {State} */
function observe(state, notify) {
  const set = state.set.bind(state);
  const register = state.register.bind(state);
  state.set = (name, status, detail) => { set(name, status, detail); notify(); };
  state.register = (name, thread, builtin) => { register(name, thread, builtin); notify(); };
  return state;
}

/** The registry, the agents and the state table, with an event for each change. */
export class Runtime {
  /** @param {object} [options] @param {BrowserPorts} [options.ports] @param {string} [options.workerUrl] @param {string} [options.main] */
  constructor(options = {}) {
    /** @type {BrowserPorts} */ this.ports = options.ports ?? browserPorts();
    /** @type {string} */ this.mainName = options.main ?? MAIN_AGENT;
    /** @type {string[]} what the first boot wrote; empty every boot after */ this.seeded = [];
    /** @type {"cold"|"starting"|"ready"|"failed"} */ this.status = "cold";
    this._workerUrl = options.workerUrl;
    /** @type {Map<string, Set<Listener>>} */ this._listeners = new Map();
    /** @type {{ type: string, payload: any }[]} this run's worker events, oldest first */ this._arrivals = [];
    /** @type {WorkerAgent | null} */ this._main = null;
    /** @type {(() => void) | null} */ this._stopCron = null;
    this._state = observe(new State(this.ports.clock), () => this.emit("state:change", { rows: this.rows() }));
  }

  /** Subscribe; the return value unsubscribes. With `replay`, the listener first
   * hears this run's arrivals — see RETAINED for what that is and why it is asked for.
   * @param {string} type @param {Listener} listener @param {{ replay?: boolean }} [options] @returns {() => void} */
  on(type, listener, options = {}) {
    const set = this._listeners.get(type) ?? new Set();
    this._listeners.set(type, set.add(listener));
    for (const past of options.replay ? [...this._arrivals] : []) if (past.type === type) this.emit(type, past.payload, listener);
    return () => void set.delete(listener);
  }

  /** A listener that throws must not take the turn down with it. `only` sends to
   * one listener and retains nothing: a replay is a delivery, not a new arrival.
   * @param {string} type @param {any} payload @param {Listener} [only] @returns {void} */
  emit(type, payload, only) {
    if (type === "turn:start") this._arrivals.length = 0;
    else if (!only && WORKER_EVENTS.includes(type) && this._arrivals.push({ type, payload }) > RETAINED) this._arrivals.shift();
    for (const listener of only ? [only] : this._listeners.get(type) ?? []) {
      try { listener(payload); }
      catch (error) { if (type !== "error") this.emit("error", { kind: "listener", message: why(error) }); }
    }
  }

  /** One row per loaded agent. @returns {import("../core/state.js").AgentState[]} */
  rows() { return this._state.snapshot(); }

  /** The transcript as of the entry agent's last turn. @returns {{ role: string, content: string }[]} */
  messages() { return this._main?.messages ?? []; }

  /** Seed the workspace, then load every agent on its own worker.
   * @returns {Promise<string[]>} the agent names that came up */
  async start() {
    if (this._main) return this.rows().map((row) => row.name);
    this.status = "starting";
    try {
      this.seeded = await seed(this.ports.fs);
      const settings = { ports: this.ports, state: this._state, main: this.mainName, log: this.log() };
      this._main = await loadAgents({ ...settings, workerUrl: this._workerUrl ?? workerUrl() });
      for (const agent of [this._main, ...this._main.peers]) this.listen(agent);
      await this.startCron();
      this.status = "ready";
      return this.rows().map((row) => row.name);
    } catch (error) {
      this.status = "failed";
      this.emit("error", { kind: "start", message: why(error) });
      throw error;
    }
  }

  /** One turn on the entry agent. @param {string} input @returns {Promise<any>} */
  async send(input) {
    const agent = this._main;
    if (!agent) throw new Error("runtime not started");
    const started = this.ports.clock.now();
    this.emit("turn:start", { agent: agent.name, input, at: started });
    try {
      const answer = await agent.invoke(input);
      const ended = this.ports.clock.now();
      const ms = ended.getTime() - started.getTime();
      this.emit("turn:end", { agent: agent.name, input, answer, at: ended, ms, messages: agent.messages });
      return answer;
    } catch (error) {
      this.emit("error", { kind: "turn", agent: agent.name, message: why(error) });
      throw error;
    }
  }

  /** Stop every worker and the ticker. @returns {Promise<void>} */
  async close() {
    this._stopCron?.(), (this._stopCron = null);
    await this._main?.close(this.log());
    this._main = null;
    this.status = "cold";
  }

  /** Forward the three events only the worker can see. @param {WorkerAgent} agent @returns {void} */
  listen(agent) {
    agent.worker.worker.addEventListener("message", (event) => {
      const message = event?.data;
      if (!message || message.type !== TELEMETRY) return;
      if (!WORKER_EVENTS.includes(String(message.event))) return;
      this.emit(String(message.event), { agent: agent.name, ...message.payload });
    });
  }

  /** Jobs fire while the page is open; a job whose time passed while it was
   * closed is reported and never replayed. @returns {Promise<void>} */
  async startCron() {
    this._stopCron = await this.ports.cron.start({
      run: (job) => void this.send(goalOf(job.command)).catch(() => {}),
      onMissed: (missed) => { for (const one of missed) this.emit("error", { kind: "missed-job", name: one.job.name, runs: one.runs, since: one.since }); },
    });
  }

  /** The registry's log, as events. Its warnings say why an agent vanished.
   * @returns {import("../core/worker-host.js").Log} */
  log() {
    return {
      info: (message) => this.emit("log", { level: "info", message }),
      warning: (message) => this.emit("error", { kind: "warning", message }),
      error: (message) => this.emit("error", { kind: "core", message }) };
  }
}

/** @param {ConstructorParameters<typeof Runtime>[0]} [options] @returns {Runtime} */
export function createRuntime(options) {
  return new Runtime(options);
}
