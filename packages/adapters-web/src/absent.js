/**
 * THE TWO SUBSTRATES THIS BUILD DOES NOT HAVE, STATED RATHER THAN MISSING.
 *
 * A port that is absent still has to answer, and what it answers is the whole
 * of I15: a name, a reason, and no pretence. The alternative — a capability
 * descriptor answering on behalf of an adapter nobody has written — is how
 * `durable()` came to return `true` while the only shipping implementation
 * returned `false`.
 * @module
 */

import { DelegateError, WorkspaceError } from '@harness/kernel'

/**
 * Delegation, ABSENT AND SAYING SO — for a context that cannot start a Worker
 * at all. The real port is `workers.js`; this is what a build gets where
 * `Worker` is undefined, and it is reached whenever `agents` is not on the
 * offered list. An empty roster and a refusal that names what is missing beat a
 * port hanging on a message nobody will read.
 * @returns {import('@harness/kernel').AgentPort}
 */
export function noAgents() {
  return {
    roster: () => [],
    async delegate(agent) {
      throw new DelegateError('unknown_agent', `There is no agent called "${agent}" here.`, {
        detail: 'delegation is one Worker per agent, and this context cannot start one',
      })
    },
  }
}

/**
 * The workspace a browser without OPFS has: none, stated. `durable()` is FALSE
 * here and true in the real one, and that difference is the whole of the empty
 * folder note — "nothing has been written here" and "a reload emptied this" are
 * different sentences and only the log plus this flag can tell them apart.
 * @returns {import('@harness/kernel').WorkspacePort}
 */
export function noWorkspace() {
  const missing = () => new WorkspaceError('unavailable', 'This browser has no file storage this build can use.', {
    detail: 'the Origin Private File System is absent here, so nothing written would survive the tab',
  })
  return {
    durable: () => false,
    interrupt: () => 'There is nothing running to interrupt.',
    async exec() {
      throw missing()
    },
    async read() {
      throw missing()
    },
    async write() {
      throw missing()
    },
    async list() {
      throw missing()
    },
  }
}
