/**
 * THE TWO TOOLS THAT ACT ON THE ROSTER: one writes an agent into this browser,
 * the other sets one working. Each hands capability to something that is not
 * this turn, which is why their descriptions are the longest in the build.
 *
 * `write_agent` IS AN ORDINARY TOOL (I9). It appends exactly the facts the
 * `/agents` route appends, so an agent a model wrote and one a person wrote are
 * the same record, boot the same way, and are told apart on screen only by who
 * wrote them.
 *
 * WHAT THE RUST DEFERRED AND THIS DOES NOT. There, an authored agent was
 * unreachable until the turn ended, because `reconcile` swapped the RUNNING
 * agent's prompt and could not do that mid-turn. Here a sub-agent boots FRESH
 * in its own Worker and reads the log for its file, so there is nothing to swap
 * and a `spawn_agent` naming an agent written this turn simply works. The
 * ordering rule went with the mechanism that needed it.
 *
 * THE `space` SENTENCE IS THE ONE THE RUST GOT WRONG TWICE — it claimed naming
 * a space also granted the workspace tools, and then its hand-kept list of them
 * went stale. In this build a space grants the space faculty and nothing else;
 * the workspace tools are in the catalogue for every agent to name. There is no
 * list here to go stale.
 * @module
 */

import { arg, loadAgents, tool } from '@harness/agent'

import { AGENT_AUTHORED, AGENT_MODULE } from './agents.js'
import { answered, nameArg } from './runner.js'

/** @typedef {import('./app.js').App} App */
/** @typedef {import('./app.js').ToolRun} ToolRun */

/** The descriptors, so a model that may call these is TOLD how. */
export const ROSTER_TOOLS = [
  tool({
    name: 'write_agent',
    description: 'create or replace an agent in this browser. It gets its own Worker, its own conversation and its own tools, and it is listed beside the shipped agents. "tools" is a comma-separated list of tool names, and empty means every tool this build offers',
    args: [
      arg('name', 'string', 'what it is called: letters, digits, - and _ only'),
      arg('description', 'string', 'one line saying what it is for — this is the line other agents read'),
      arg('prompt', 'string', 'the whole system prompt, as the agent will be told it'),
      arg('tools', 'string', 'the tools it may call, comma-separated; empty means all of them', { required: false }),
      arg('space', 'string', 'the shared space it works in, if any', { required: false }),
    ],
    mutates: true,
    needs: 'emit',
  }),
  tool({
    name: 'spawn_agent',
    description: 'hand a goal to an agent that already exists: it works on it in its own Worker, with its own tools and its own conversation, and its answer comes back as this call\'s result. It creates nothing and can lend nothing — list_agents says which agents exist, and write_agent is what authors one',
    args: [
      arg('agent', 'string', 'the agent to set working, as list_agents spells it'),
      arg('goal', 'string', 'the whole task, in one string — it cannot see this conversation'),
    ],
    needs: 'agents',
  }),
]

/**
 * The runners, over the App that holds the log and the port.
 * @param {App} app @returns {Record<string, ToolRun>}
 */
export function rosterTools(app) {
  return {
    write_agent: answered('write_agent', async (args) => wrote(app, args)),
    spawn_agent: answered('spawn_agent', async (args, opts) => sent(app, args, opts.signal)),
  }
}

/** Letters, digits, `-` and `_`. The name keys the roster, addresses a message and names a segment stream, so anything else is a name three subsystems would spell differently. */
const USABLE = /^[A-Za-z0-9_-]+$/

/**
 * WRITE ONE AGENT FILE, AS THE FACTS THE ROSTER IS FOLDED FROM.
 *
 * The file is rendered and then READ BACK before anything is recorded: a spec
 * this build would refuse must be refused HERE, where the model can fix it,
 * rather than at the next boot where it becomes a row in the agents pane.
 * @param {App} app @param {Record<string, unknown>} args
 */
function wrote(app, args) {
  const name = nameArg(args, 'name')
  const prompt = unescaped(String(args['prompt'] ?? ''))
  if (!USABLE.test(name)) {
    return { ok: false, output: `"${name}" cannot be an agent name — letters, digits, - and _ only. Call it as write_agent({"name": "<name>", "description": "<one line>", "prompt": "<the system prompt>"}).` }
  }
  if (prompt.trim() === '') {
    return { ok: false, output: 'No prompt given, and an agent with no system prompt has no instructions at all. Write the whole prompt as the "prompt" argument.' }
  }
  const path = `${name}/agent.md`
  const text = agentFile(name, args, prompt)
  const refusal = loadAgents([{ path, text }]).refusals[0]
  if (refusal) return { ok: false, output: `That would not load: ${refusal.message}` }
  const at = app.ports.clock.now()
  app.log.append({ type: 'custom', kind: AGENT_AUTHORED, payload: { name, path, text } }, at)
  app.log.append({ type: 'module_installed', module: `${AGENT_MODULE}${name}`, version: '1' }, at)
  return { ok: true, output: `Wrote ${name}. It is installed in this browser now — spawn_agent can reach it, it is listed beside the shipped agents, and it survives a reload. Tell the person it exists and what to ask it.` }
}

/**
 * THE FILE ITSELF: frontmatter for what the machine reads, the body for what
 * the model reads. Rendered rather than assembled from a template string
 * elsewhere, because `parseAgentFile` is the only reader and the two have to
 * agree about one format.
 * @param {string} name @param {Record<string, unknown>} args @param {string} prompt
 */
function agentFile(name, args, prompt) {
  const listed = nameArg(args, 'tools').split(',').map((t) => t.trim()).filter((t) => t !== '')
  const space = nameArg(args, 'space')
  const lines = [
    '---',
    `name: ${name}`,
    `description: ${String(args['description'] ?? '').replace(/\n/g, ' ').trim()}`,
    ...(listed.length > 0 ? ['tools:', ...listed.map((t) => `  - ${t}`)] : []),
    ...(space === '' ? [] : [`space: ${space}`]),
    '---',
    '',
  ]
  return `${lines.join('\n')}${prompt.trim()}\n`
}

/**
 * A prompt a model wrote with its newlines still escaped. Small local models
 * double-escape a multi-line string inside a one-line call often enough that
 * the agents they write arrive as one 400-character paragraph. Only where there
 * is no real newline to lose: a prompt that already has line breaks is passed
 * through untouched, so this can only fix a prompt that has none.
 * @param {string} prompt @returns {string}
 */
function unescaped(prompt) {
  return prompt.includes('\n') ? prompt : prompt.replace(/\\n/g, '\n').replace(/\\t/g, '\t')
}

/**
 * HAND A GOAL TO AN AGENT THAT EXISTS. An empty goal is refused here and never
 * delivered: a sub-agent handed one answers it regardless, which costs a whole
 * turn of somebody else's loop to learn nothing.
 *
 * The port's own refusal is the result on the way back — it names which agents
 * this build can run, and a model that reads it can pick another (I15).
 * @param {App} app @param {Record<string, unknown>} args @param {AbortSignal} signal
 */
async function sent(app, args, signal) {
  const agent = nameArg(args, 'agent')
  const goal = String(args['goal'] ?? '').trim()
  if (agent === '' || goal === '') {
    const missing = agent === '' ? 'No agent named — list_agents says which exist' : 'No goal given, and an agent handed an empty goal answers it anyway'
    return { ok: false, output: `${missing}. Call it as spawn_agent({"agent": "<one that already exists>", "goal": "<the whole task, in one string>"}).` }
  }
  return { ok: true, output: await app.ports.agents.delegate(agent, goal, { signal }) }
}
