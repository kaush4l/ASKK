/**
 * ONE AGENT FILE, READ — `agent.md` → `AgentSpec`: YAML frontmatter for what
 * the machine reads, the markdown body for what the model reads.
 *
 * Pure: the bytes arrive from wherever the host got them (I3). `frontmatter.js`
 * reads one key at a time; what is here is the record, what an absent key
 * means, and the rules that need the WHOLE FILE in hand — two keys that each
 * parse and together ask for two incompatible things.
 *
 * A BROKEN FILE IS A VALUE, not a throw. Skipping it is correct — the other
 * agents still load — and every refusal names the KEY and the PATH the way
 * `shape.js` names a stored record's, because "one agent did not load" with no
 * word about which line is the failure this codebase keeps finding.
 * @module
 */

import { readFrontmatter, refuse } from './frontmatter.js'
import { DEFAULT_COMPACT_AT, DEFAULT_KEEP_RECENT, DEFAULT_MAX_ROUNDS, DEFAULT_PASSES } from './state.js'

/** @typedef {import('./frontmatter.js').Refusal} Refusal */
/** @typedef {import('@harness/kernel').StageId} StageId */

/**
 * @typedef {object} AgentSpec
 * @property {string} name  how this agent is addressed, everywhere
 * @property {string} description  one line; a peer that names this agent in its `tools:` gets THIS sentence as the tool's description
 * @property {string} model  a CATALOGUE key, never a URL
 * @property {number | null} temperature  null where the file named none
 * @property {string} engine  `react` — the tool loop — or `base`, one reply with no tools
 * @property {string} role  which job this file holds, or '' for the ordinary case of none
 * @property {StageId[]} stages  the loop this agent walks, in order. Empty is the bare react loop — every agent written before the key existed.
 * @property {string[]} tools  the whole allowlist. EMPTY MEANS EVERY BUILT-IN, which is why a malformed `tools:` line is refused rather than dropped.
 * @property {string[]} faculties  named bundles of tools and prompt blocks; naming one is the whole grant
 * @property {string} space  the shared space this agent works in, or ''
 * @property {number} compactAt  compact once the window holds this many entries; 0 never compacts
 * @property {number} keepRecent  how many of the newest survive a compaction verbatim
 * @property {number} maxRounds  the tool-loop ceiling for one turn
 * @property {number} passes  how many times one turn may walk the stage list
 * @property {string} prompt  the markdown body: this agent's system prompt
 */

/**
 * The spec a file that declared nothing would produce. Everything an absent key
 * means is here, once, so "what happens when the line is missing?" is one place
 * to read rather than fourteen scattered literals.
 *
 * `engine` defaults to REACT and not `base`: the default has to be the loop
 * that actually runs, and now that `base` means no tools at all, defaulting to
 * it would disarm every file that simply omits the line.
 * @param {string} prompt @returns {AgentSpec}
 */
export function unwritten(prompt) {
  return {
    name: '', description: '', model: '', temperature: null, engine: 'react', role: '',
    stages: [], tools: [], faculties: [], space: '',
    compactAt: DEFAULT_COMPACT_AT, keepRecent: DEFAULT_KEEP_RECENT,
    maxRounds: DEFAULT_MAX_ROUNDS, passes: DEFAULT_PASSES, prompt,
  }
}

/**
 * ONE AGENT FILE. `path` is where the bytes came from and it is in every
 * refusal: a person fixing a file needs to be told which file.
 * @param {string} path @param {string} text @returns {{spec: AgentSpec} | {refusal: Refusal}}
 */
export function parseAgentFile(path, text) {
  const rest = text.startsWith('---') ? text.slice(3) : null
  if (rest === null) return refuse(path, '', `${path} does not start with "---", so it has no frontmatter and nothing in it can be read.`)
  const close = rest.indexOf('\n---')
  if (close < 0) return refuse(path, '', `${path} opens its frontmatter with "---" and never closes it, so where the settings end and the prompt begins is unknowable.`)
  const read = readFrontmatter(path, rest.slice(0, close))
  if ('refusal' in read) return read
  // Every value in `read` was typed by the reader that produced it; tsc cannot
  // follow a proof that walks a table, so the cast carries it — the same
  // bargain `restoreAgentState` makes one field-check earlier.
  const spec = /** @type {AgentSpec} */ ({ ...unwritten(rest.slice(close + 4).trim()), ...read.values })
  return contradiction(path, spec) ?? { spec }
}

/**
 * TWO KEYS THAT EACH PARSE AND TOGETHER MEAN NOTHING. Every rule here needs the
 * whole file, which is why none of them is in the line reader, and every one is
 * a refusal rather than a dropped line: the file asks for two incompatible
 * things and only its author knows which was meant.
 * @param {string} path @param {AgentSpec} spec @returns {{refusal: Refusal} | null}
 */
function contradiction(path, spec) {
  if (spec.name === '') {
    // THE ONE DIVERGENCE FROM THE RUST, WHICH DEFAULTED THIS TO THE FOLDER. A
    // spec that names itself after where it was fetched from has an identity
    // that changes when the host changes URL, and the roster keys agents by
    // this name.
    return refuse(path, 'name', `${path} declares no "name", and an agent with no name cannot be addressed, delegated to, or told apart from another file that also declared none.`)
  }
  if (spec.engine === 'base' && spec.tools.length > 0) {
    return refuse(path, 'tools', `${path} sets "engine: base", which answers in one reply and calls nothing, so the "tools:" list under it would never be granted — use engine: react, or drop the list.`)
  }
  if (spec.engine === 'base' && spec.stages.length > 0) {
    return refuse(path, 'stages', `${path} sets "engine: base", which is ONE reply, so the "stages:" list under it would never be walked — use engine: react, or drop the list.`)
  }
  if (spec.stages.length > 0 && !spec.stages.some(acts)) {
    return refuse(path, 'stages', `${path} declares a "stages:" list that can never act — it needs work, the stage that acts, or strategy, which chooses a list that does.`)
  }
  if (spec.passes > 1 && spec.stages.length === 0) {
    return refuse(path, 'passes', `${path} sets "passes: ${spec.passes}", which counts laps of the "stages:" list, and there is no list to lap — add stages: [plan, work, verify], or drop the passes: line.`)
  }
  return null
}

/**
 * Whether a declared stage can reach one that acts. `strategy` counts: it
 * contains no `work` because it does not yet know whether the turn needs one,
 * and the list it votes for does — so the guarantee this defends, that a turn
 * can always reach a stage that acts, still holds.
 * @param {StageId} stage @returns {boolean}
 */
function acts(stage) {
  return stage === 'work' || stage === 'strategy'
}
