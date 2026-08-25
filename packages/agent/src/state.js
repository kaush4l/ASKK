/**
 * AGENTSTATE — the whole agent between events, as plain data.
 *
 * THIS FILE IS THE VOCABULARY: every field the agent has, with the argument for
 * why it exists beside it. Everything `step` may consult is here; anything not
 * here does not exist to the agent (I7). Data and not a class, because a state
 * that can be written down is a state a refresh can resume (I11) — which is
 * also why no field holds a function, a promise or a port.
 *
 * FOUR FIELDS DID NOT SURVIVE THE PORT, MEASURED ON THE RUST TREE: `plan`,
 * `cursor` and `replans` had zero readers and zero writers outside the
 * constructor, and `retries` had two writers that both set it to 0 and no
 * reader — a counter that could only ever hold zero. They were the residue of
 * the phase machine the stage machine replaced. `phase` went with them: it had
 * no assignment outside the constructor and the table it indexed had one row
 * (see `stages.js`).
 * @module
 */

import { StoreError } from '@harness/kernel'
import { NATIVE } from './calls.js'
import { checkField, shapeOf } from './shape.js'

/** @typedef {import('@harness/kernel').TurnId} TurnId */
/** @typedef {import('@harness/context').ModelCard} ModelCard */
/** @typedef {import('./calls.js').CallStyle} CallStyle */
/** @typedef {import('./round.js').Asked} Asked */
/** @typedef {import('./tools.js').Tool} Tool */
/** @typedef {import('./turn.js').Awaiting} Awaiting */

/** The agent's paper — `packages/context`'s assembly input; A-PAPER owns its shape. @typedef {{sources: unknown[]}} Paper */

/** What an agent's file declares it is FOR. `goal.js` (B18) reads it; the shape lives here because it is state. @typedef {{outcome: string, check: string, doneWhen: string}} Goal */

/**
 * The declaration plus what the harness OBSERVED about it on this lap.
 * `checking` says the next tool result is the harness's own question and not
 * the model's; `met` is that check's exit code, null where this lap has not
 * read it. Both are lap-scoped: evidence about a lap that is over says nothing
 * about the one starting.
 * @typedef {{goal: Goal, checking: boolean, met: boolean | null}} Standing
 */

/** The shared folder an agent works in, as of the last read. `space.js` (B27) mutates it. @typedef {{name: string, facts: Array<[string, string]>, notes: string[]}} Space */

/**
 * @typedef {object} AgentState
 * @property {string} name  how this agent is addressed — the `identity` block's own words, and the name a peer delegates to. On the state because a running agent that cannot say what it is called is one the person cannot address either.
 * @property {string} description  its one-line role, as its file declares it; the second half of `identity`
 * @property {string[]} conversation  the window, oldest first, one already-tagged line per turn — what the `history` block renders. It is the thing `compactAt` counts and `keepRecent` spares, and until it was here the assembled prompt carried NO conversation at all: the paper's sources were the only channel and nothing in this build ever wrote one.
 * @property {string} model  this agent's `model:` key — a CATALOGUE key, never a URL; empty means the catalogue's default
 * @property {number | null} temperature  its `temperature:` key, null where the file named none
 * @property {string | null} task  what is being attempted; null is idle
 * @property {TurnId} turnId  WHICH attempt it is, or '' when idle. Every effect is stamped with it and the reducer drops any fact that names another (I21) — the predecessor had no such name, which is how a result from an abandoned turn billed a fresh model call.
 * @property {Awaiting} awaiting  what this turn has outstanding: the model, the tools, or nothing. Explicit because "nothing is outstanding" and "one tool is outstanding" were both `pending_tools == 0`, and a result arriving against nothing awaited must be an anomaly rather than a new request.
 * @property {Tool[]} toolbox  what THIS agent may call, resolved from its `tools:` list, as DESCRIPTORS (`tools.js`) and not names. The loop needs the schema to refuse a call and the two declared properties to fold what a result proved; a list of names is what made both live somewhere else.
 * @property {CallStyle} calling  how this model's calls arrive: its own API, or read out of the text by the declared fallback. A property of the model card, adopted onto the state — never guessed from what a reply happens to look like.
 * @property {Asked[]} batch  the round the model just wrote, each call with its own id, in the order written. Results are filed against it BY ID; the model sees none of them until every entry is done — that is what makes one round of calls one observation. It replaced a count, because "nothing is outstanding" and "this result answers nothing" were both `pending_tools == 0`.
 * @property {string[]} observations  this round's results, in arrival order. An ARRAY, because the Rust upserted a one-line component by id and three calls on one line therefore produced three overwrites the model saw one of. Replaced when the next round of calls is written.
 * @property {number} toolRounds  how many times this turn has gone round the tool loop; a looping model terminates on this counter, never on prose
 * @property {number} maxRounds  the ceiling that counter terminates on. Per-agent because the right number is a property of the WORK: a summarizer calling two tools and a coding agent editing nine files cannot share one constant, and the constant this replaced was four.
 * @property {boolean} steered  a sentence typed into a running turn, not yet answered. A FLAG and not a queue: the sentence is already in the history, and this only records that nothing has replied to it.
 * @property {boolean} stopping  the person pressed Stop mid-turn. A flag for the same reason; consumed at the next step boundary, cleared by a new turn.
 * @property {number} compactAt  compact once the window reaches this many entries; 0 never compacts
 * @property {number} keepRecent  how many of the newest entries survive a compaction verbatim
 * @property {boolean} compacting  the reply in flight is the SUMMARIZER's, not this agent's answer — assembly is pure and cannot author a summary (I14)
 * @property {number} compactions  how many times this window has been compacted; the log mirrors the window, and this is what tells the mirror a REWRITE is due rather than another append
 * @property {boolean} mutated  this turn wrote something (turn-scoped evidence, folded left to right over the tool results)
 * @property {boolean} green  something ran after that write and said so
 * @property {number} nudges  how many times the verify gate has already asked
 * @property {string[]} stages  the loop this turn is walking, in order. Empty is the react loop alone — every agent written before the key existed.
 * @property {string[]} declared  the list the agent's FILE declares, which `stages` is reset to each turn. Separate because the strategy stage REWRITES `stages` mid-turn: without the copy, a greeting after a project would still be planning.
 * @property {number} stage  how far this turn has walked that list
 * @property {number} passes  how many times one turn may walk the list
 * @property {number} pass  laps spent
 * @property {boolean} acted  whether THIS lap changed or ran anything — the continue condition, mechanical and never the model's verdict
 * @property {string} critic  the agent holding `role: critic`, so its answer is recognised as a verdict rather than by a hardcoded name
 * @property {boolean | null} reviewed  what that verdict said; null where it was never asked, or a write since made it stale
 * @property {Standing} standing  the standing goal and this lap's observation of it
 * @property {Space | null} space  null means the file named no space, so the agent works alone
 * @property {string[]} faculties  the faculties the file declared, in order; the host refreshes `senses` for each before every pass
 * @property {Record<string, unknown[]>} senses  BLOCK ID -> the parts a host wrote for it, most recently. The slot where an impure host leaves fresh data for a pure component to render. Parts and not strings so a screenshot needs no second mechanism.
 * @property {Record<string, string>} briefs  what each stage is TOLD, loaded from `public/stages/`. Here and not in the spec because a brief is a property of the STAGE, whose meaning belongs to the machine.
 * @property {Paper} paper  the assembly inputs, refreshed before each step. Inside the state so one snapshot restores the whole thinking context.
 * @property {string} prompt  this agent's file's own markdown body — the words the soul block is written in. On the state and not fetched per call: the paper is derived every turn and the agent's own words are an input to it, not a lookup.
 * @property {ModelCard | null} card  what this agent's `model:` key resolved to in the catalogue — the window every budget is derived from. Null is a file naming a model this build has no entry for, and the turn ends saying so rather than assembling against a number somebody invented.
 * @property {number} attempts  how many times THIS turn's model call has failed and been asked again. Turn-scoped: a provider that failed twice yesterday says nothing about the call going out now.
 * @property {string} lastEmpty  the `model|finish` pair of the previous zero-output completion, '' when the last reply carried something. Two identical ones in a row stop the retry — a model answering deterministically will answer the same nothing again.
 */

/** Sixty-four, not four: four rounds cannot finish real work — read, build, read the errors, edit, build is already five — and the ceiling exists to stop a model LOOPING, not to stop an agent working. */
export const DEFAULT_MAX_ROUNDS = 64
export const DEFAULT_COMPACT_AT = 75
export const DEFAULT_KEEP_RECENT = 24
/** ONE, and one is not a placeholder: one pass is byte-for-byte the turn this build has always taken. A file that wants the loop asks for it. */
export const DEFAULT_PASSES = 1

/**
 * A fresh idle agent. Nothing else may build an AgentState from parts, so
 * "what an absent host has left behind" is written once: no spec adopted, so
 * no tools — the honest default is that nothing is attached an agent did not
 * ask for. No briefs either: seeding them here would be the compiled-in
 * fallback that makes a missing `public/stages/` file invisible.
 *
 * NO ARGUMENTS. A seeded paper was a parameter every caller passed the same
 * value for; the code that would have a real one to give does not exist yet,
 * and when it does it adopts one through `ask.js`, which
 * derives the whole paper per call, rather than through an optional argument
 * here.
 * @returns {AgentState}
 */
export function newAgentState() {
  return {
    name: '', description: '', conversation: [],
    model: '', temperature: null, task: null, turnId: '', awaiting: null, toolbox: [],
    calling: NATIVE, batch: [], observations: [], toolRounds: 0, maxRounds: DEFAULT_MAX_ROUNDS,
    steered: false, stopping: false,
    compactAt: DEFAULT_COMPACT_AT, keepRecent: DEFAULT_KEEP_RECENT,
    compacting: false, compactions: 0,
    mutated: false, green: false, nudges: 0,
    stages: [], declared: [], stage: 0,
    passes: DEFAULT_PASSES, pass: 0, acted: false,
    critic: '', reviewed: null,
    standing: { goal: { outcome: '', check: '', doneWhen: '' }, checking: false, met: null },
    space: null, faculties: [], senses: {}, briefs: {}, paper: { sources: [] },
    prompt: '', card: null, attempts: 0, lastEmpty: '',
  }
}

/**
 * The state as bytes, canonically. Keys are sorted at every depth so two
 * identical agents write identical records — the Rust used a `BTreeMap` for
 * `senses` and `briefs` for exactly this reason, and a JS object's insertion
 * order would otherwise make byte-identity depend on the order a host happened
 * to write its blocks in.
 * @param {AgentState} state @returns {string}
 */
export function serializeAgentState(state) {
  return JSON.stringify(state, (_key, value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1))
    return Object.fromEntries(entries)
  })
}

/**
 * One stored state, read back. Absent keys take the fresh default, which is how
 * a record written before a field existed still loads.
 *
 * Everything else REFUSES, by name (I18). A key this build has no field for
 * means a record from a newer build, and a key of the wrong shape means a
 * record this reader cannot understand; guessing at either would put an agent
 * on the page in a state no code was written for. `shape.js` decides the second
 * half, and it checks THROUGH the compound fields.
 *
 * `Object.hasOwn` and not `in`: `in` walks the prototype chain, so a record
 * carrying `__proto__` or `toString` would answer "this build has that field",
 * be waved past, and then be silently dropped by the spread below — which is
 * the one thing I18 says a reader may never do.
 * @param {string} text @returns {AgentState}
 */
export function restoreAgentState(text) {
  const raw = readRecord(text)
  const fresh = newAgentState()
  for (const key of Object.keys(raw)) {
    if (Object.hasOwn(fresh, key)) continue
    throw new StoreError('corrupt', `This agent state was written by a newer build: it carries "${key}", which this one has no field for.`, { key })
  }
  for (const [key, value] of Object.entries(raw)) {
    const bad = checkField(key, value, /** @type {Record<string, unknown>} */ (fresh)[key])
    if (!bad) continue
    throw new StoreError('corrupt', `This agent state holds "${bad.key}" as ${bad.found}, and this build reads it as ${bad.want}.`, { key: bad.key })
  }
  // Every key was proved present in `fresh` and every shape was proved above;
  // tsc cannot follow a proof that walks a table, so the cast carries it.
  return /** @type {AgentState} */ ({ ...fresh, ...raw })
}

/** @param {string} text @returns {Record<string, unknown>} */
function readRecord(text) {
  /** @type {unknown} */
  let value
  try {
    value = JSON.parse(text)
  } catch (cause) {
    throw new StoreError('corrupt', 'This agent state is not JSON, so nothing in it can be read.', { cause })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new StoreError('corrupt', `This agent state is ${shapeOf(value)} where a record was expected.`)
  }
  return /** @type {Record<string, unknown>} */ (value)
}
