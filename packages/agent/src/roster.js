/**
 * MANY AGENT FILES AT ONCE: which one wins when two share a name, what a file
 * that will not parse costs, and who holds a declared job. `spec.js` reads one
 * file; nothing here reads one.
 * @module
 */

import { ROLES } from './frontmatter.js'
import { parseAgentFile } from './spec.js'

/** @typedef {import('./spec.js').AgentSpec} AgentSpec */
/** @typedef {import('./frontmatter.js').Refusal} Refusal */

/**
 * Every agent, from files given built-ins FIRST and a person's second, so a
 * file of the same name REPLACES the built-in. A file that will not parse costs
 * that one agent and the rest still load — and its refusal comes back beside
 * them, because skipping is correct and silence is what is not.
 *
 * Sorted by name so the roster, and every lookup that walks it, is the same on
 * every boot rather than in fetch order.
 * @param {Iterable<{path: string, text: string}>} files
 * @returns {{specs: AgentSpec[], refusals: Refusal[]}}
 */
export function loadAgents(files) {
  /** @type {AgentSpec[]} */
  const specs = []
  /** @type {Refusal[]} */
  const refusals = []
  for (const file of files) {
    const read = parseAgentFile(file.path, file.text)
    if ('refusal' in read) { refusals.push(read.refusal); continue }
    const at = specs.findIndex((s) => s.name === read.spec.name)
    if (at < 0) specs.push(read.spec)
    else specs[at] = read.spec
  }
  specs.sort((a, b) => (a.name < b.name ? -1 : 1))
  return { specs, refusals: [...refusals, ...settleRoles(specs)] }
}

/**
 * TWO FILES CLAIMING ONE JOB. Copying `main/agent.md` is how a person writes a
 * new agent, and that file carries `role: entry` — so the copy held the role
 * too and the page talked to whichever name sorted first, silently.
 *
 * The loser is reported AND STRIPPED, not merely reported: `role` is read in
 * more places than the lookup below, so a loser keeping the word is a file
 * saying it holds a job it does not hold. It costs that agent its role and
 * nothing else — it still loads, still answers, still has its tools.
 * @param {AgentSpec[]} specs mutated: the losers lose the word
 * @returns {Refusal[]}
 */
function settleRoles(specs) {
  /** @type {Refusal[]} */
  const contested = []
  for (const role of ROLES) {
    const claimants = specs.filter((s) => s.role === role)
    const [winner, ...losers] = claimants
    if (!winner || losers.length === 0) continue
    for (const loser of losers) loser.role = ''
    contested.push({
      // No path: the contest is between files and belongs to none of them,
      // the way an empty `id` on a seam problem means the whole response.
      path: '',
      key: 'role',
      message: `${claimants.length} agents declare "role: ${role}" (${claimants.map((s) => s.name).join(', ')}); ${winner.name} holds it because it sorts first, and the rest now hold no role. Delete the line from all but one.`,
    })
  }
  return contested
}

/**
 * WHO HOLDS A JOB. `main` and `summarizer` were string literals in the core, so
 * renaming the entry agent's folder changed nothing and deleting the
 * summarizer's stopped compaction with no word anywhere. `null` is a real
 * answer: the caller falls back to the name it has always used.
 * @param {readonly AgentSpec[]} specs @param {string} role @returns {AgentSpec | null}
 */
export function roleHolder(specs, role) {
  return specs.find((s) => s.role === role) ?? null
}
