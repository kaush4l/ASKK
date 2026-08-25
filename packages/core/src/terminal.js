/**
 * THE TERMINAL MODULE — what has been run here, and the one door a person's
 * command goes through.
 *
 * A PERSON'S COMMAND TAKES THE AGENT'S PATH, exactly. It becomes an
 * `InvokeTool` effect for `exec` and the driver runs it through the same tool
 * gate, under the same capability, with the same deadline, producing the same
 * `tool_invoked` fact — so this pane is a projection of that fact and not a
 * second history. The predecessor had a `gesture.rs` that reached the substrate
 * on its own, which meant a build that refused the agent `workspace` still ran
 * whatever a person typed.
 * @module
 */

import { ok, problem } from '@harness/kernel'
import { invokeTool } from '@harness/agent'

/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('./ctx.js').Ctx} Ctx */

export const TERMINAL = 'terminal'

/** The tool this pane is a projection of. Nothing else puts a line in it. */
const EXEC = 'exec'

/** How many commands the pane keeps. A scrollback, bounded like every other fold (I20). */
const KEPT = 100

/** @typedef {{id: string, command: string, ok: boolean, output: string, at: number, byLabel: string}} Ran */

/** @type {import('./log/reducers.js').Reducer} */
export const terminalReducer = {
  name: TERMINAL,
  version: 1,
  init: () => /** @type {Ran[]} */ ([]),
  fold: (/** @type {Ran[]} */ state, /** @type {Event} */ event) => {
    const fact = event.fact
    if (fact.type !== 'tool_invoked' || fact.tool !== EXEC) return state
    state.push({
      id: `e${event.seq}`,
      command: commandIn(fact.args),
      ok: fact.ok,
      output: fact.output,
      at: event.at,
      // WHO RAN IT. A turn-less call is a person at the keyboard: the driver
      // stamps every model-driven effect with its turn (I21), and a chore has
      // none to stamp — so this reads the envelope rather than guessing.
      byLabel: event.turnId === '' ? 'You ran' : `${fact.agent || 'the agent'} ran`,
    })
    if (state.length > KEPT) state.splice(0, state.length - KEPT)
    return state
  },
}

/** @type {Manifest} */
export const terminalManifest = {
  id: 'terminal',
  version: '1',
  title: 'Terminal',
  summary: 'Commands run in the workspace, and the one place a person runs one.',
  capabilities: ['workspace'],
  view: 'terminal',
  routes: [
    { method: 'GET', path: '/terminal' },
    { method: 'POST', path: '/terminal' },
    { method: 'GET', path: '/terminal/stop' },
  ],
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
export function terminal(request, ctx) {
  if (request.path === '/terminal/stop') return interrupt(ctx)
  if (request.method === 'POST') return run(request, ctx)
  return ok('terminal', projected(ctx, ''))
}

/** @param {Request} request @param {Ctx} ctx @returns {Response} */
function run(request, ctx) {
  const command = (request.body.command ?? '').trim()
  if (command === '') {
    return problem(400, 'That was an empty command, so nothing ran.', {
      kind: 'empty_command', repair: 'Type a command and send it again.',
    })
  }
  if (!ctx.chore) return withheld()
  // No turn and no call id: nothing is waiting on this result, and stamping it
  // with the live turn would file a person's command against the model's round.
  ctx.chore(invokeTool('', '', EXEC, JSON.stringify({ command })))
  return ok('terminal', projected(ctx, command))
}

/** @param {Ctx} ctx @returns {Response} */
function interrupt(ctx) {
  if (!ctx.interrupt) return withheld()
  return ok('terminal', { ...projected(ctx, ''), interruptedLabel: ctx.interrupt() })
}

/** @param {Ctx} ctx @param {string} queued @returns {Record<string, unknown>} */
function projected(ctx, queued) {
  const rows = /** @type {Ran[]} */ (ctx.project(TERMINAL))
  return {
    rows,
    queued,
    queuedLabel: queued === '' ? '' : `${queued} — queued; its output lands here when it finishes.`,
    emptyNote: rows.length === 0
      ? 'Nothing has been run here yet. What you type runs in the workspace, and so does what the agent runs.'
      : '',
    interruptedLabel: '',
  }
}

/** @returns {Response} */
function withheld() {
  return problem(501, 'This build has nowhere to run a command.', {
    kind: 'not_granted',
    detail: 'the `workspace` capability is not in this build\'s available list, so the terminal has no substrate',
    repair: 'Nothing you typed was wrong. A build with a workspace substrate runs it unchanged.',
  })
}

/** The command out of an `exec` call's arguments, or '' where the record predates the field. */
function commandIn(/** @type {string} */ argsJson) {
  try {
    const said = /** @type {{command?: unknown}} */ (JSON.parse(argsJson) ?? {})
    return typeof said.command === 'string' ? said.command : ''
  } catch {
    return ''
  }
}
