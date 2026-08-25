/**
 * THE TOOLS MODULE — every tool this agent may name, what it needs, and whether
 * it would actually run.
 *
 * THREE DIFFERENT WAYS TO BE UNAVAILABLE, and the pane says which. A tool whose
 * capability this build never offered, a tool whose descriptor resolved but has
 * no runner behind it, and a tool the agent's file simply did not ask for are
 * three sentences and not one greyed-out row. The predecessor had a single
 * `available: bool`, which is how a model was told about `exec` in a build with
 * no substrate and learned the difference by being refused.
 * @module
 */

import { CAPABILITY_SENTENCE, ok } from '@harness/kernel'
import { available, usage } from '@harness/agent'

/** @typedef {import('@harness/kernel').Manifest} Manifest */
/** @typedef {import('@harness/kernel').Request} Request */
/** @typedef {import('@harness/kernel').Response} Response */
/** @typedef {import('@harness/agent').Tool} Tool */
/** @typedef {import('./ctx.js').Ctx} Ctx */

/** @type {Manifest} */
export const toolsManifest = {
  id: 'tools',
  version: '1',
  title: 'Tools',
  summary: 'Every tool this agent may call, its capability, and whether it resolves.',
  capabilities: [],
  view: 'tools',
  routes: [{ method: 'GET', path: '/tools' }],
}

/** @param {Request} _request @param {Ctx} ctx @returns {Response} */
export function tools(_request, ctx) {
  const rows = ctx.agent.toolbox.map((t) => row(t, ctx))
  return ok('tools', {
    rows,
    emptyNote: rows.length === 0
      ? "This agent's file resolved no tools, so every reply it gives is one reply and nothing else."
      : '',
    resolvedLabel: resolved(rows),
  })
}

/** @param {Tool} t @param {Ctx} ctx @returns {Record<string, unknown>} */
function row(t, ctx) {
  const granted = available(t, ctx.available)
  const runnable = ctx.tools.includes(t.name)
  return {
    id: t.name,
    name: t.name,
    usage: usage(t),
    description: t.description,
    needs: t.needs,
    needsLabel: t.needs === '' ? 'Needs nothing but this browser.' : `Needs the right to ${sentenceFor(t.needs)}.`,
    resolves: granted && runnable,
    // WHY IT WOULD NOT RUN, in the order that decides it: a capability this
    // build withheld is the build's answer and outranks a missing runner,
    // because granting the capability is what would bring the runner with it.
    resolvesLabel: !granted
      ? `This build cannot ${sentenceFor(t.needs)}, so this tool is not offered to the model.`
      : runnable
        ? 'Resolved: this build has something behind it.'
        : 'Named but not resolved: nothing in this build answers to it, so a call would come back refused.',
    mutates: t.mutates,
    evidence: t.evidence,
  }
}

/**
 * WHAT A CAPABILITY BUYS, in the kernel's own words. A tool declaring a name
 * this kernel does not know is not a crash and not a blank: `available()`
 * already fails it safe to unavailable, and this says why in the same breath.
 * @param {string} needs @returns {string}
 */
function sentenceFor(needs) {
  const sentence = /** @type {Record<string, string>} */ (CAPABILITY_SENTENCE)[needs]
  return sentence ?? `do what "${needs}" asks for, which is not a capability this build knows`
}

/** @param {Array<Record<string, unknown>>} rows */
function resolved(rows) {
  const yes = rows.filter((r) => r.resolves === true).length
  if (rows.length === 0) return ''
  return `${yes} of ${rows.length} resolve in this build.`
}
