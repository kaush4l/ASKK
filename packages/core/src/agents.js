/**
 * THE AGENTS MODULE — every agent this browser holds, and the three routes that
 * change that set.
 *
 * AGENTS ARE DATA, and the log is where an authored one lives. A file a person
 * writes in this browser is a FACT, so it survives a refresh, it is undoable
 * (I10), and boot rebuilds the roster by replaying it — rather than a second
 * store beside the log that a projection would have to be reconciled against.
 *
 * A FILE THAT WILL NOT PARSE COSTS THAT ONE AGENT. The rest still load and the
 * refusal comes back BESIDE them, one row each, keyed by path — which is why
 * `problem.id` exists: two agents missing from the manifest is two failures
 * with identical prose (docs/SEAM.md).
 * @module
 */

import { addressee, ok, problem } from '@harness/kernel'
import { loadAgents } from '@harness/agent'

/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */

export const AUTHORED = 'authored'

/** The fact that carries one authored agent file. Payload: `{name, path, text}`. */
export const AGENT_AUTHORED = 'core.agent_authored'

/** What `module_removed` says about an agent, so it cannot collide with a real module id. */
export const AGENT_MODULE = 'agent:'

/** @typedef {{name: string, path: string, text: string, at: number}} Authored */

/**
 * Every agent file written HERE, newest write winning. A rewrite is not a
 * second agent, and a delete removes it — the fold is the whole undo (I10).
 * @type {import('./log/reducers.js').Reducer}
 */
export const authoredReducer = {
  name: AUTHORED,
  version: 1,
  init: () => /** @type {Authored[]} */ ([]),
  fold: (/** @type {Authored[]} */ state, /** @type {Event} */ event) => {
    const fact = event.fact
    if (fact.type === 'module_removed' && fact.module.startsWith(AGENT_MODULE)) {
      const name = fact.module.slice(AGENT_MODULE.length)
      const at = state.findIndex((a) => a.name === name)
      if (at >= 0) state.splice(at, 1)
      return state
    }
    if (fact.type !== 'custom' || fact.kind !== AGENT_AUTHORED) return state
    const said = /** @type {Partial<Authored>} */ (fact.payload ?? {})
    if (typeof said.name !== 'string' || said.name === '' || typeof said.text !== 'string') return state
    const held = state.find((a) => a.name === said.name)
    const row = { name: said.name, path: said.path ?? '', text: said.text, at: event.at }
    if (held) Object.assign(held, row)
    else state.push(row)
    return state
  },
}

/** @type {Manifest} */
export const agentsManifest = {
  id: 'agents',
  version: '1',
  title: 'Agents',
  summary: 'Every agent, its file, its model, and what failed to load.',
  capabilities: ['emit'],
  view: 'agents',
  routes: [
    { method: 'GET', path: '/agents' },
    { method: 'POST', path: '/agents' },
    { method: 'POST', path: '/agents/file' },
    { method: 'GET', path: '/agents/delete' },
  ],
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function agents(request, ctx) {
  if (request.path === '/agents/delete') return remove(request, ctx)
  if (request.method === 'POST') return author(request, ctx)
  return ok('agents', projected(ctx))
}

/**
 * WRITE ONE AGENT FILE INTO THIS BROWSER. Both POST routes land here because
 * they are one act with two addresses: `/agents` names the agent, `/agents/file`
 * names the path it was written at, and the parser decides the name either way.
 * @param {Request} request @param {Ctx} ctx @returns {Response}
 */
function author(request, ctx) {
  const path = (request.body.path ?? `${request.body.name ?? ''}/agent.md`).trim()
  const text = request.body.text ?? ''
  const read = loadAgents([{ path, text }])
  const refusal = read.refusals[0]
  if (refusal) {
    return problem(400, `That agent file would not load: ${refusal.message}`, {
      id: refusal.path, kind: 'unreadable_agent', detail: refusal.message,
      repair: 'Fix the line it names and send it again. Nothing was written.',
    })
  }
  const spec = read.specs[0]
  if (!spec) {
    return problem(400, 'That agent file named no agent.', {
      id: path, kind: 'unreadable_agent',
      detail: 'the file parsed but declared no name, so nothing could be installed under it',
      repair: 'Give the file a `name:` and send it again.',
    })
  }
  if (!ctx.emit) return ungranted(spec.name)
  ctx.emit({ type: 'custom', kind: AGENT_AUTHORED, payload: { name: spec.name, path, text } })
  ctx.emit({ type: 'module_installed', module: `${AGENT_MODULE}${spec.name}`, version: '1' })
  return ok('agents', projected(ctx))
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
function remove(request, ctx) {
  const name = addressee(request)
  const held = /** @type {Authored[]} */ (ctx.project(AUTHORED)).find((a) => a.name === name)
  if (!held) {
    return problem(404, `There is no agent called "${name}" written in this browser.`, {
      id: name, kind: 'not_authored',
      detail: 'only an agent authored here can be removed here; the ones this deploy ships are files on the server',
      repair: 'Check the name, or edit the shipped file and redeploy it.',
    })
  }
  if (!ctx.emit) return ungranted(name)
  ctx.emit({ type: 'module_removed', module: `${AGENT_MODULE}${name}`, version: '1' })
  return ok('agents', projected(ctx))
}

/**
 * EVERY AGENT, FROM BOTH SOURCES, AND EVERY FILE THAT WOULD NOT LOAD. The
 * authored set wins on a name collision, for the same reason `loadAgents` gives
 * a person's file precedence over a built-in: copying a shipped agent and
 * editing it is how a person makes their own.
 * @param {Ctx} ctx @returns {Record<string, unknown>}
 */
function projected(ctx) {
  const authored = /** @type {Authored[]} */ (ctx.project(AUTHORED))
  const here = new Set(authored.map((a) => a.name))
  // The authored files are re-read HERE and not taken from the roster: boot
  // adopts them, so within the session a file just written would otherwise
  // render as "not loaded yet" — true of the roster and useless to the person
  // who has this second pressed Save.
  const live = loadAgents(authored).specs
  const rows = [
    ...authored.map((a) => row(a.name, a.path, 'written here', ctx, live)),
    ...ctx.roster.specs.filter((s) => !here.has(s.name)).map((s) => row(s.name, ctx.roster.paths[s.name] ?? '', 'shipped with this build', ctx, live)),
  ]
  return {
    rows,
    refusals: ctx.roster.refusals.map((r) => ({ id: r.path, kind: 'unreadable_agent', message: r.message, detail: r.message, repair: '' })),
    emptyNote: rows.length === 0 ? 'No agent file loaded, so this build has nobody to talk to.' : '',
  }
}

/** @param {string} name @param {string} path @param {string} origin @param {Ctx} ctx @param {import('@harness/agent').AgentSpec[]} live */
function row(name, path, origin, ctx, live) {
  const spec = live.find((s) => s.name === name) ?? ctx.roster.specs.find((s) => s.name === name)
  return {
    id: name,
    name,
    path,
    // I9 IS NOT VIOLATED BY SAYING WHERE A FILE CAME FROM. The invariant is that
    // no manifest field records origin and nothing DISPATCHES on it; this is a
    // person being told which file to edit, which is the opposite of a system
    // treating the two differently.
    originLabel: origin,
    modelLabel: spec && spec.model.trim() !== '' ? spec.model : "the catalogue's default",
    toolsLabel: spec ? toolsSentence(spec.tools) : 'Its toolbox is only known once it is loaded.',
    removable: origin === 'written here',
    isMe: name === ctx.me,
  }
}

/** @param {readonly string[]} tools */
function toolsSentence(tools) {
  if (tools.length === 0) return 'Every tool this build offers.'
  return tools.join(', ')
}

/** @param {string} id @returns {Response} */
function ungranted(id) {
  return problem(500, 'This build did not grant the agents module the right to record facts.', {
    id, kind: 'not_granted',
    detail: 'the `emit` capability is not in this build\'s available list, so nothing could be written',
    repair: 'This is a build assembled wrong, not something the file did.',
  })
}
