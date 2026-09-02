/**
 * Which of an agent's declared tools it may keep when it runs as a sub-agent.
 *
 * A sub-agent runs on its own thread, and a thread is not a smaller copy of the
 * app — it is a second realm with its own memory and its own connections. So
 * the question a delegated tool has to answer is not "is this useful" but "does
 * a SECOND instance of this, alive at the same time as the parent's, cost
 * something the parent did not agree to".
 *
 * Two answer yes and are refused here, each for a stated reason rather than a
 * cautious one:
 *
 * - `read_file` and `write_file` reach `Workspace`, whose every write is a
 *   whole-record `put` — there is no appending and no partial write, which is
 *   argued in that file. Two agents holding it at once is therefore
 *   last-write-wins over a whole file, in two realms, with nothing between them:
 *   a sub-agent saving `notes.md` while the parent saves `notes.md` silently
 *   discards one of the two, and neither agent is told. A thread cannot share
 *   the parent's instance either — an object does not survive `postMessage` —
 *   so a sub-agent with file tools is a second writer by construction. (This
 *   comment said "one write queue over one store" for one wave. There is no
 *   queue in `Workspace`: `grep -n 'queue' src/backend/files/Workspace.js`
 *   returns nothing, and a reason that cites a mechanism which does not exist
 *   is worse than no reason.)
 * - `shell` reaches `C2wSandbox`, whose guest is a 50.2 MiB download that
 *   inflates to 143 MB in the realm holding it. One per thread is one per
 *   thread: two agents delegating at once would hold three guests on a laptop.
 *   The parent already has one, and a sub-agent that needs a command run is a
 *   sign the parent should have run it.
 *
 * What is left is the pair whose whole cost is a request: `search` and `fetch`
 * reach the network, which every realm has, hold nothing between calls, and are
 * exactly the tools a delegated question is worth asking for — a sub-agent that
 * reads six pages and answers in a paragraph spends its own context window
 * rather than the parent's, which is the entire argument for delegation.
 *
 * Sub-agent tools are absent for a different reason, and it is enforced one
 * layer up in `agentWorker.js`: an agent that can call an agent can call itself,
 * and a cycle of threads that spawn threads is a fork bomb. That is a depth
 * limit, not a resource argument, so it does not belong in this table.
 */
export const DELEGABLE_TOOLS = Object.freeze(['search', 'fetch'])

/** Why a name was dropped, in the words the sub-agent's notes will carry. */
const WHY = Object.freeze({
  read_file: 'a sub-agent thread cannot hold a second writer over the file store',
  write_file: 'a sub-agent thread cannot hold a second writer over the file store',
  shell: 'a sub-agent thread would hold a second copy of the guest image',
  // Not a resource argument, and the third kind of reason this table has: a
  // sub-agent is given no peers, so it can hand no work over, so it can never
  // have a task to read back. Left in, it resolves to a tool that answers "you
  // have not handed any work over" on every call — a capability in the prompt
  // that cannot do anything, which costs tokens on every turn and invites the
  // model to try.
  check_task: 'a sub-agent has no peers to hand work to, so it has no tasks to read',
})

/**
 * Split a file's `tools:` list into what a delegated run may have, and a note
 * for each name it may not.
 *
 * Dropped with a note rather than silently, and rather than refused: an agent
 * file that names `shell` is still a usable agent without it, and its author is
 * entitled to know the line did not take effect. This is the same rule
 * `AgentSpec` applies to every other setting it cannot honour.
 *
 * @param {string[]} names the tool names the sub-agent's own file declared
 * @returns {{names: string[], notes: string[]}}
 */
export function delegableTools(names = []) {
  const kept = []
  const notes = []
  for (const name of names) {
    if (DELEGABLE_TOOLS.includes(name)) {
      kept.push(name)
      continue
    }
    // A name this table has no opinion about is left in: `resolveTools` is what
    // decides a name is unresolvable, and answering twice in two vocabularies
    // would tell the reader a tool was refused when it was never found.
    if (!Object.hasOwn(WHY, name)) {
      kept.push(name)
      continue
    }
    notes.push(`${name} is not available to a sub-agent: ${WHY[name]}`)
  }
  return { names: kept, notes }
}
