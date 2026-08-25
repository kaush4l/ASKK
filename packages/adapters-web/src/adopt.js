/**
 * WHAT THIS BUILD READ OFF DISK, AND WHICH OF IT IS THIS PROCESS'S OWN AGENT.
 *
 * All three sets — agent files, stage briefs, skills — are FETCHED and not
 * compiled in, because a person may author one in this browser and because a
 * file edited and redeployed must reach a running page on a refresh rather than
 * on a rebuild.
 *
 * ADOPTION IS HANDED TO `boot` AND NOT DONE BEFORE IT. The roster read off disk
 * is only half the roster: an agent authored in this browser lives in the LOG,
 * and nothing outside `boot` has read the log yet. A Worker started for an
 * agent a model wrote a moment ago booted blank while this ran early — which is
 * the whole of "write it, then spawn it".
 * @module
 */

import { adoptSpec, newAgentState } from '@harness/agent'
import { AUTHORED } from '@harness/core'

import { fetchRoster, fetchBriefs, fetchSkills } from './files.js'
import { CATALOGUE } from './toolset.js'

/** @typedef {import('@harness/core').App} App */
/** @typedef {import('@harness/core').Roster} Roster */
/** @typedef {import('@harness/kernel').CapabilityId} CapabilityId */
/** @typedef {import('./endpoint.js').Endpoint} Endpoint */

/**
 * A skill that would not load is a refusal BESIDE the agent files, because it
 * is the same failure — the manifest named a folder and the folder did not
 * answer — and the roster pane is where a person meets both.
 * @param {string} basePath @param {string} me
 * @param {CapabilityId[]} available @param {Endpoint} endpoint
 */
export async function authored(basePath, me, available, endpoint) {
  const roster = await fetchRoster(basePath)
  const briefed = await fetchBriefs(basePath)
  const skilled = await fetchSkills(basePath)
  return {
    adopt: (/** @type {Roster} */ known) => adopted(known, me, available, endpoint),
    briefs: briefed.briefs,
    skills: skilled.skills,
    roster: { ...roster, refusals: [...roster.refusals, ...briefed.refusals, ...skilled.refusals] },
  }
}

/**
 * THE AGENT THIS PROCESS RUNS, BUILT FROM ITS OWN FILE, AND THE ROSTER THAT
 * SAYS WHAT ITS FILE ASKED FOR IN VAIN. A state adopted from no file is the
 * defect this replaces: the predecessor hardcoded `main`, so an agent file a
 * person edited changed the prompt and nothing else. `agent` is `undefined`
 * when no file defines this name — `createApp` then starts a blank agent, and
 * the roster pane says by name which file was missing rather than the page
 * looking merely empty.
 *
 * A NAME NOTHING ANSWERS TO BECOMES A REFUSAL AND NOT A DROPPED ARRAY: an
 * unresolved name reaches no toolbox, so `/tools` cannot show it, and the seven
 * the shipped file names were absent with nobody told (I15, I16).
 * @param {Roster} roster @param {string} me
 * @param {CapabilityId[]} available @param {Endpoint} endpoint
 * @returns {{agent: import('@harness/agent').AgentState|undefined, roster: Roster}}
 */
export function adopted(roster, me, available, endpoint) {
  const spec = roster.specs.find((s) => s.name === me)
  if (!spec) return { agent: undefined, roster }
  const env = { catalogue: CATALOGUE, offered: available, peers: roster.specs, card: endpoint.card(spec.model) }
  const { state, unresolved } = adoptSpec(newAgentState(), spec, env)
  if (unresolved.length === 0) return { agent: state, roster }
  const refusal = {
    path: roster.paths[me] ?? `agents/${me}/agent.md`,
    key: 'tools',
    message: `${me}/agent.md names ${unresolved.join(', ')}, and nothing in this build answers to ${unresolved.length === 1 ? 'that name' : 'those names'} — a call would come back refused.`,
  }
  return { agent: state, roster: { ...roster, refusals: [...roster.refusals, refusal] } }
}

/**
 * EVERY AGENT THIS BUILD COULD START, shipped and authored together — the list
 * a delegation is checked against.
 *
 * It reads the LOG and not only `app.roster`, and the difference is one turn:
 * the roster was folded at boot, and an agent `write_agent` recorded this turn
 * is in the log now. The Rust deferred exactly that by a turn because
 * `reconcile` had to swap a running agent's prompt; a sub-agent boots fresh in
 * its own Worker, so there is nothing here to swap.
 * @param {App|null} app @returns {string[]}
 */
export function rosterNames(app) {
  if (!app) return []
  const written = /** @type {Array<{name: string}>} */ (app.log.read(AUTHORED))
  return [...new Set([...app.roster.specs.map((s) => s.name), ...written.map((a) => a.name)])]
}
