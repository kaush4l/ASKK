/**
 * The rest of the doubles: network, delegation, and the workspace. Each is the
 * smallest thing that satisfies its contract and records what it was asked, so
 * a test asserts on the ASK rather than on a mock framework's ceremony.
 * @module
 */

import { DelegateError, NetError, WorkspaceError } from '@harness/kernel'

/** @typedef {import('@harness/kernel').NetPort} NetPort */
/** @typedef {import('@harness/kernel').AgentPort} AgentPort */
/** @typedef {import('@harness/kernel').WorkspacePort} WorkspacePort */

/**
 * A net port answering from a table keyed `"METHOD path"`. Anything unlisted is
 * REFUSED rather than empty — an allowlist that silently returns nothing is how
 * a missing route becomes a mysterious blank pane.
 * @param {Record<string, {status: number, body: string}>} routes
 * @returns {NetPort & {asked: Array<{endpoint: string, key: string}>}}
 */
export function fakeNet(routes = {}) {
  /** @type {Array<{endpoint: string, key: string}>} */
  const asked = []
  return {
    asked,
    async fetch(endpoint, req) {
      const key = `${req.method} ${req.path}`
      asked.push({ endpoint, key })
      const hit = routes[key]
      if (!hit) throw new NetError('not_allowed', `nothing is scripted for ${key} on "${endpoint}"`)
      return hit
    },
  }
}

/**
 * Delegation answered from a table of agent name -> answer (or a function of
 * the goal). An unknown name is `unknown_agent`, which is the real failure.
 * @param {Record<string, string|((goal: string) => Promise<string>|string)>} answers
 * @returns {AgentPort & {sent: Array<{agent: string, goal: string}>}}
 */
export function fakeAgents(answers = {}) {
  /** @type {Array<{agent: string, goal: string}>} */
  const sent = []
  return {
    sent,
    roster: () => Object.keys(answers),
    async delegate(agent, goal) {
      sent.push({ agent, goal })
      const answer = answers[agent]
      if (answer === undefined) throw new DelegateError('unknown_agent', `there is no agent called "${agent}"`)
      return typeof answer === 'function' ? await answer(goal) : answer
    },
  }
}

/**
 * A workspace backed by a Map of paths and a table of scripted commands.
 * `durable()` is false, and it says so: a test that assumes files survive a
 * reload should fail here rather than in a browser.
 * @param {{files?: Record<string, string>, commands?: Record<string, import('@harness/kernel').Execution>}} [opts]
 * @returns {WorkspacePort & {ran: string[], files: Map<string, string>}}
 */
export function fakeWorkspace(opts = {}) {
  const files = new Map(Object.entries(opts.files ?? {}))
  const commands = opts.commands ?? {}
  /** @type {string[]} */
  const ran = []
  return {
    ran,
    files,
    durable: () => false,
    interrupt: () => 'press Ctrl-C',
    async exec(command) {
      ran.push(command)
      return commands[command] ?? { code: 0, stdout: '', stderr: '', truncated: false, ms: 1 }
    },
    async read(path, readOpts = {}) {
      const text = files.get(path)
      if (text === undefined) throw new WorkspaceError('not_found', `there is no file at ${path}`)
      const lines = text.split('\n')
      const from = readOpts.offset ?? 0
      const slice = lines.slice(from, from + (readOpts.limit ?? lines.length))
      return { text: slice.join('\n'), truncated: from + slice.length < lines.length, lines: lines.length }
    },
    async write(path, text) {
      files.set(path, text)
    },
    async list(prefix) {
      return [...files.keys()]
        .filter((p) => p.startsWith(prefix))
        .map((name) => ({ name, dir: false, size: (files.get(name) ?? '').length }))
    },
  }
}
