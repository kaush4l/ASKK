/**
 * THE THREE TOOLS THAT NEED NOTHING BUT THIS PAGE: the clock, and the roster.
 *
 * They are core's rather than the composition root's for the reason
 * `read_result` is: the thing that HOLDS the answer owns the way to it. The
 * roster is on the App and it changes during a session — an agent a person
 * authors in this browser installs at the turn boundary — so these close over
 * the App and never over a snapshot of it, which is how `list_agents` came to
 * report a fleet one write out of date.
 *
 * NO CAPABILITY. `needs: ''` is the honest answer: nothing here leaves the tab,
 * writes anything, or reaches a port a build could be assembled without. A tool
 * that declared `clock` would be withheld from every agent in a build that had
 * simply not listed it, for a reading of a number the App already holds.
 * @module
 */

import { arg, tool } from '@harness/agent'

import { answered, nameArg } from './runner.js'

/** @typedef {import('@harness/agent').AgentSpec} AgentSpec */
/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').ToolRun} ToolRun */

/** The descriptors, so a model that may call these is TOLD how. */
export const LOCAL_TOOLS = [
  tool({
    name: 'now',
    description: 'read the current time, as milliseconds since the Unix epoch and as an ISO timestamp',
    args: [],
  }),
  tool({
    name: 'list_agents',
    description: 'list every agent loaded in this browser, each with the line its own file describes it by',
    args: [],
  }),
  tool({
    name: 'read_agent',
    description: "read one agent's whole definition: its model, the tools it may call, and its prompt",
    args: [arg('name', 'string', 'the agent, as list_agents spells it')],
  }),
]

/**
 * The runners, over the App that holds the answers.
 * @param {App} app @returns {Record<string, ToolRun>}
 */
export function localTools(app) {
  return {
    // The time is READ FROM THE PORT and never from the host clock (I7), so a
    // replayed test answers the same twice.
    now: answered('now', async () => {
      const at = app.ports.clock.now()
      return { ok: true, output: `${at} ms since the Unix epoch — ${new Date(at).toISOString()}` }
    }),
    list_agents: answered('list_agents', async () => ({ ok: true, output: listed(app.roster.specs) })),
    read_agent: answered('read_agent', async (args) => definition(app.roster.specs, nameArg(args, 'name'))),
  }
}

/** @param {readonly AgentSpec[]} specs @returns {string} */
function listed(specs) {
  if (specs.length === 0) return 'No agents are loaded in this browser.'
  return specs.map((s) => `${s.name}: ${s.description}`).join('\n')
}

/**
 * One agent's definition, or a REFUSAL that names what is here. A name that is
 * not loaded is a result the model can act on — the turn carries on and spends
 * one round, where a thrown error would end it having taught the model nothing.
 * @param {readonly AgentSpec[]} specs @param {string} asked
 */
function definition(specs, asked) {
  if (asked === '') {
    return { ok: false, output: 'read_agent needs a name. Call it as read_agent({"name": "<agent>"}).' }
  }
  const found = specs.find((s) => s.name === asked)
  if (!found) {
    return { ok: false, output: `No agent called "${asked}". ${listed(specs) === '' ? '' : `Loaded: ${specs.map((s) => s.name).join(', ')}`}`.trim() }
  }
  const may = found.tools.length === 0 ? 'every built-in tool' : found.tools.join(', ')
  return { ok: true, output: `${found.name} — ${found.description}\nmodel: ${found.model}\ntools: ${may}\n\n${found.prompt}` }
}
