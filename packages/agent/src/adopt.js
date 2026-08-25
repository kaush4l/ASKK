/**
 * ADOPTING AN AGENT FILE: one `AgentSpec` written onto one `AgentState` —
 * which model it calls, what it may call, the loop it walks, and who reviews
 * it. `spec.js` reads the bytes; this decides what they mean to a live agent.
 *
 * IT IS EXPORTED AND `step` IS STILL THE ONLY WRITER OF A RUNNING TURN. This
 * builds an agent from a file BEFORE any turn exists — it touches no field a
 * turn counts (`task`, `turnId`, `awaiting`, `batch`) and returns a new state
 * rather than editing one, so there is no path by which it can rewrite an agent
 * mid-turn. Nothing about `main` is hardcoded on this path, which is what makes
 * the `public/agents/` loader real rather than decorative.
 * @module
 */

import { facultyTools, SPACE } from './faculty/index.js'
import { roleHolder } from './roster.js'
import { toolboxFor } from './toolbox.js'

/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('./spec.js').AgentSpec} AgentSpec */
/** @typedef {import('./state.js').AgentState} AgentState */
/** @typedef {import('./state.js').Space} Space */
/** @typedef {import('./tools.js').Tool} Tool */
/** @typedef {import('@harness/context').ModelCard} ModelCard */

/**
 * @param {AgentState} state a fresh state, from `newAgentState()`
 * @param {AgentSpec} spec
 * @param {{catalogue: readonly Tool[], offered: readonly CapabilityId[] | undefined, peers?: readonly AgentSpec[], card?: ModelCard | null}} env
 * @returns {{state: AgentState, unresolved: string[], notice: string}}
 */
export function adoptSpec(state, spec, env) {
  const peers = env.peers ?? []
  const space = spaceNamed(spec.space)
  // THE FACULTIES WIDEN WHAT MAY BE NAMED, and nothing else. Their tools join
  // the catalogue the allowlist picks from, so a file with a non-empty `tools:`
  // still picks; a file with none gets every built-in AND every tool its own
  // faculties brought. Naming a space is what puts `space` in that list, which
  // is what keeps the old key a way of naming a faculty rather than a second
  // mechanism beside them.
  const facultyNames = faculties(spec, space)
  const resolved = toolboxFor(spec, { ...env, catalogue: [...env.catalogue, ...facultyTools(facultyNames)] })
  /** @type {AgentState} */
  const adopted = {
    ...state,
    name: spec.name, description: spec.description,
    model: spec.model,
    prompt: spec.prompt,
    // THE CARD IS ADOPTED WITH THE MODEL NAME, from the catalogue the host
    // read. Every budget is derived from its window, so an agent whose file
    // names an entry that is not there carries null and says so at its first
    // call — rather than being asked against a number nobody chose.
    card: env.card ?? null,
    temperature: spec.temperature,
    space,
    faculties: facultyNames,
    toolbox: resolved.toolbox,
    compactAt: spec.compactAt,
    keepRecent: spec.keepRecent,
    maxRounds: spec.maxRounds,
    // THE LOOP THIS AGENT RUNS, from its own file and nowhere else — twice,
    // because the strategy stage REWRITES `stages` mid-turn and `declared` is
    // what the next turn is reset to. Without the copy, a greeting after a
    // project would still be planning.
    declared: [...spec.stages],
    stages: [...spec.stages],
    passes: spec.passes,
    critic: criticAmong(spec, peers),
  }
  return { state: adopted, unresolved: resolved.unresolved, notice: resolved.notice }
}

/**
 * The space this file named, or null. A name that could walk out of `spaces/`
 * attaches NOTHING rather than being sanitised into something adjacent: a space
 * silently renamed is two agents believing they share a folder they do not.
 * @param {string} name @returns {Space | null}
 */
export function spaceNamed(name) {
  const trimmed = name.trim()
  return trimmed !== '' && /^[A-Za-z0-9_-]+$/.test(trimmed)
    ? { name: trimmed, facts: [], notes: [] }
    : null
}

/** Every faculty this file declared, in the order it wrote them. @param {AgentSpec} spec @param {Space | null} space @returns {string[]} */
function faculties(spec, space) {
  const named = [...(space ? [SPACE] : []), ...spec.faculties].filter((n) => n !== '')
  return [...new Set(named)]
}

/**
 * WHO REVIEWS THIS AGENT'S WORK, by the job a file declares and not by the name
 * `critic`: a hardcoded name means renaming the folder silently unhooks the
 * machinery. It is recorded even where this agent cannot CALL the critic — the
 * field only decides whether a tool result is read as a verdict, and a result
 * can only arrive from a tool the allowlist already granted. An agent that is
 * itself the critic gets '': nothing here reviews itself.
 * @param {AgentSpec} spec @param {readonly AgentSpec[]} peers @returns {string}
 */
function criticAmong(spec, peers) {
  const holder = roleHolder(peers, 'critic')
  return holder && holder.name !== spec.name ? holder.name : ''
}
