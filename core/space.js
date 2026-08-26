/** Spaces — a folder agents build in, and the state they share while doing it.
 *
 *     const space = await getSpace("research", { ports })   // one object for everyone who names it
 *     space.context()                                       // what goes into the prompt, as of right now
 *
 * The physical half is `spaces/<name>/`, a folder an agent is told the path of and can build a project
 * in. The virtual half is what the group knows: `facts`, a small key/value area for things that have
 * been settled, and `notes`, an append-only board members leave each other messages on. Both reach the
 * model through `Agent.context()`, rebuilt on every render — the reason the clock is not cached applies
 * here twice over, since a peer may have written something since the last turn. None of it is a
 * conversation turn, so compaction never touches it and an agent never has to ask a peer to repeat
 * itself.
 *
 * The Python took every mutation under a `threading.Lock`, because agents ran on their own event loops
 * on their own threads and two writes could interleave mid-object. Here a space is owned by one context
 * — one JS thread, every mutation complete before the first `await` — so there is nothing for a mutex
 * to guard and it is dropped rather than transliterated. `context()` still copies both halves out: the
 * copy is what the lock actually bought, and it costs nothing to keep.
 */

import { tool } from "./tool-call.js";

/** @typedef {import("./ports.js").Ports} Ports */

/** Where `logging.getLogger` went: a pure core owns no logger, so one arrives at construction and
 * defaults to silence — any subset may be supplied.
 * @typedef {{ info?: (m: string) => void, warning?: (m: string) => void, error?: (m: string) => void }} SpaceLog
 * @typedef {object} SpaceOptions
 * @property {Pick<Ports, "fs">} [ports] only `fs` is reached for; a full Ports fits
 * @property {SpaceLog} [log] */

/** @type {Required<SpaceLog>} */ const SILENT = { info() {}, warning() {}, error() {} };

/** Relative to the workspace the fs port is rooted at — the port has no notion of a package directory,
 * and OPFS has no absolute path to give the model. */
export const SPACES_DIR = "spaces";
export const SPACE_FILE = "space.json";

// A space name becomes a directory name, so it may only be a name — no slashes, no dots, nothing that
// could walk out of spaces/ and write somewhere else.
export const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const NOTE_LIMIT = 20; // newest kept; older notes fall off rather than grow the prompt forever

/** One shared space: a folder, some settled facts, and a noticeboard. */
export class Space {
  /** @param {string} name @param {Map<string, string> | null} [facts] @param {string[] | null} [notes]
   * @param {SpaceOptions} [options] */
  constructor(name, facts = null, notes = null, options = {}) {
    /** @type {string} */ this.name = name;
    /** @type {string} */ this.path = `${SPACES_DIR}/${name}`;
    // A Map, not an object: fact keys come from the model, and a JS object hoists integer-like keys
    // to the front — which would silently rewrite the order the prompt renders them in.
    /** @type {Map<string, string>} */ this.facts = new Map(facts ?? []);
    /** @type {string[]} */ this.notes = [...(notes ?? [])];
    /** @type {Pick<Ports, "fs"> | undefined} */ this.ports = options.ports;
    /** @type {Required<SpaceLog>} */ this.log = { ...SILENT, ...(options.log ?? {}) };
  }

  /** @returns {string} */ toString() { return `Space('${this.name}', facts=${this.facts.size}, notes=${this.notes.length})`; }

  /** The space as prompt facts; empty areas render nothing at all. Copied out first: a render must
   * never see half of a write. @returns {Record<string, string>} */
  context() {
    const facts = [...this.facts];
    const notes = [...this.notes];
    /** @type {Record<string, string>} */
    const block = { space: this.name, workspace: this.path };
    if (facts.length) block["shared facts"] = "\n" + facts.map(([k, v]) => `  ${k}: ${v}`).join("\n");
    if (notes.length) block["recent notes"] = "\n" + notes.map((note) => `  ${note}`).join("\n");
    return block;
  }

  /** Settle a fact; writing the same key again replaces it.
   * @param {string} author @param {string} key @param {string} value @returns {Promise<string>} */
  async remember(author, key, value) {
    const k = String(key).trim();
    const v = String(value).trim();
    if (!k) return "Nothing recorded: a fact needs a key.";
    this.facts.set(k, v);
    await this.save();
    this.log.info(`space ${this.name}: ${author} recorded '${k}'`);
    return `Recorded in the ${this.name} space: ${k} = ${v}`;
  }

  /** Remove a fact that is no longer true. @param {string} author @param {string} key @returns {Promise<string>} */
  async forget(author, key) {
    const k = String(key).trim();
    if (!this.facts.has(k)) {
      const known = [...this.facts.keys()].join(", ") || "nothing";
      return `No fact called '${k}'. The space holds: ${known}`;
    }
    this.facts.delete(k);
    await this.save();
    this.log.info(`space ${this.name}: ${author} removed '${k}'`);
    return `Removed '${k}' from the ${this.name} space.`;
  }

  /** Leave the group a note. @param {string} author @param {string} note @returns {Promise<string>} */
  async post(author, note) {
    const line = String(note).trim().replace(/\s+/g, " "); // one line: the board is read inside a prompt
    if (!line) return "Nothing posted: the note was empty.";
    this.notes.push(`[${author}] ${line}`);
    if (this.notes.length > NOTE_LIMIT) this.notes.splice(0, this.notes.length - NOTE_LIMIT);
    await this.save();
    this.log.info(`space ${this.name}: ${author} posted a note`);
    return `Posted to the ${this.name} space. Everyone working here will see it.`;
  }

  /** Write the space into its own folder through the port's atomic `replace`: a later turn, or the
   * next run, sees the old file or the new one and never half of either. A failure costs the record,
   * not the conversation — what the group knows is still in memory, and the next write tries again.
   * @returns {Promise<void>} */
  async save() {
    const payload = JSON.stringify({ facts: Object.fromEntries(this.facts), notes: this.notes }, null, 2);
    try {
      await this.ports?.fs.replace(`${this.path}/${SPACE_FILE}`, payload);
    } catch (error) {
      this.log.warning(`space ${this.name}: could not be saved: ${message(error)}`);
    }
  }

  /** Read a space back, or start an empty one. An unreadable file costs what the group knew, not the
   * run — the agents still share the folder, and can fill the space again.
   * @param {string} name @param {SpaceOptions} [options] @returns {Promise<Space>} */
  static async load(name, options = {}) {
    const empty = new Space(name, null, null, options);
    let stored;
    try {
      // A miss is `null` from the port, not a throw: a fresh project has no space.json, and that is
      // a normal state rather than a failure.
      const raw = await empty.ports?.fs.read(`${empty.path}/${SPACE_FILE}`);
      if (raw === null || raw === undefined) return empty;
      stored = JSON.parse(raw);
    } catch (error) {
      empty.log.error(`space ${name}: could not be read (${message(error)}) — starting empty`);
      return empty;
    }
    if (!isRecord(stored)) {
      empty.log.error(`space ${name}: ${SPACE_FILE} must hold a JSON object — starting empty`);
      return empty;
    }
    const facts = new Map(entriesOf(stored.facts).map(([k, v]) => [String(k), String(v)]));
    const notes = (Array.isArray(stored.notes) ? stored.notes : []).map(String).slice(-NOTE_LIMIT);
    empty.log.info(`space ${name}: loaded ${facts.size} fact(s) and ${notes.length} note(s)`);
    return new Space(name, facts, notes, options);
  }

  /** This space's tools, with `agent` baked in as the author. A tool is called with the arguments the
   * model wrote and nothing else, so there is no asking who is calling at call time; binding the name
   * here is what lets a note say who left it. Python read each function's parameter names off its
   * signature to build the usage line; JavaScript cannot (PORT-MAP R6), so the three shapes are
   * declared. An absent argument becomes `""` and not the string `"undefined"`, so a malformed call
   * gets one of the two refusals above — text the model can act on.
   * @param {string} agent @returns {any[]} */
  toolsFor(agent) {
    /** @type {[string, string, string, (a: any) => Promise<string>][]} */
    const declared = [
      ["remember", "Record a fact in the shared space, for every agent working here to see.",
        '{"key": "<key>", "value": "<value>"}', (a) => this.remember(agent, a?.key ?? "", a?.value ?? "")],
      ["forget", "Remove a fact from the shared space once it is no longer true.",
        '{"key": "<key>"}', (a) => this.forget(agent, a?.key ?? "")],
      ["post_note", "Leave a note for the other agents working in this space.",
        '{"note": "<note>"}', (a) => this.post(agent, a?.note ?? "")],
    ];
    return declared.map(([name, description, usage, fn]) => tool(name, description, usage, fn));
  }
}

/** @param {unknown} e @returns {string} */ const message = (e) => (e instanceof Error ? e.message : String(e));

/** A JSON object, which an array and `null` are not — `typeof null` is where JavaScript disagrees
 * with `isinstance(stored, dict)`. @param {unknown} v @returns {v is Record<string, unknown>} */
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** The pairs of a stored map, or none. The Python called `.items()` straight on whatever `facts` held,
 * so `{"facts": "x"}` raised an AttributeError outside the guarded block and cost the whole agent load;
 * here it costs the facts. @param {unknown} v @returns {[string, unknown][]} */
const entriesOf = (v) => (isRecord(v) ? Object.entries(v) : []);

/** The *promise* of each space, not the space, which is what the Python's registry lock bought: two
 * agents starting together both await the one load instead of each building a copy nobody can see.
 * @type {Map<string, Promise<Space>>} */ const spaces = new Map();

/** The space called `name` — the same object for every caller. The first caller's ports and log are
 * the ones it keeps; a later caller naming that space is asking for it, not for a differently wired one.
 * @param {string} name @param {SpaceOptions} [options] @returns {Promise<Space>} */
export function getSpace(name, options = {}) {
  const key = String(name).trim();
  if (!NAME_PATTERN.test(key)) {
    throw new Error(`'${key}' is not a usable space name — letters, digits, dashes and underscores only`);
  }
  const existing = spaces.get(key);
  if (existing) return existing;
  const loading = Space.load(key, options);
  spaces.set(key, loading);
  return loading;
}

/** Forget every loaded space. For tests; the files on disk are untouched. @returns {void} */
export function clearSpaces() { spaces.clear(); }
