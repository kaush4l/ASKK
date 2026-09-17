/**
 * Work another agent is doing right now, as a capability handed in from
 * outside.
 *
 * A port rather than a reference to the worker pool, for the reason every other
 * port here exists: `core/` may not know that a thread is how delegation
 * happens. The thing behind this could be a thread, a tab or a machine, and all
 * this layer needs is to ask what is running and what came back.
 *
 * The contract:
 *
 *     port.list()   -> Task[]
 *     port.get(id)  -> Task | null
 *
 * where a Task is `{id, agent, task, state, startedAt, endedAt, progress,
 * result, resumes, resumedAt}`, `state` is one of the five below, and `result`
 * is the sub-agent's whole outcome as JSON — null until the run ends.
 *
 * **Nothing here starts a task.** Starting one is `SubAgentTool` asking its
 * dispatcher not to wait, which means an agent can only start the agents its
 * own file already names in `tools:`. A separate "spawn" tool that took an
 * agent name would be a way around that list, and the list is the whole of how
 * this tree decides what an agent may do.
 */

/** The three states a task can be in, spelled once. */
export const TaskState = Object.freeze({
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  /**
   * Ended because someone ended it.
   *
   * A fourth state rather than a flavour of FAILED, because the two answer
   * different questions and only one of them is a bug. A run that failed is
   * news about the agent; a run that was stopped is news about the person, and
   * a panel that reports "researcher failed" for a thread the user killed on
   * purpose is lying to the only party who knows better.
   */
  STOPPED: 'stopped',
  /**
   * The tab closed while it was working.
   *
   * A fifth state, and it earns its place the way `STOPPED` did: it answers a
   * question neither of the others answers. `FAILED` is news about the agent —
   * it tried and could not. `STOPPED` is news about the person — they ended it.
   * This is news about the MACHINE: nobody decided anything, the thread simply
   * stopped existing when the page did, and the work is neither done nor
   * refused.
   *
   * It is also the one state that can be acted on by restarting, which is why
   * it must not be flattened into `FAILED`. A sub-agent keeps no transcript and
   * is built fresh per call, so running the same instruction again IS resuming
   * it — there is no partial state to lose. That equivalence is what makes
   * `AgentWorkerPool.resume` honest rather than a second-guess.
   */
  INTERRUPTED: 'interrupted',
})

/**
 * The port used when nobody supplied one.
 *
 * Answers rather than fails, like `NO_FILES` and `NO_HTTP` beside it: a tool
 * built without its collaborator should be able to say what it cannot do,
 * rather than throw on a user's machine.
 */
export const NO_TASKS = Object.freeze({
  list: () => [],
  get: () => null,
})

export const tasksOr = (port) => port ?? NO_TASKS

/**
 * One task, in the words the model reads.
 *
 * Written once, here, because both readers render it: the context block that
 * tells an agent what is outstanding, and `check_task` when it is asked. Two
 * spellings of one fact is how a field ends up meaning different things to the
 * two things that show it — this tree's own recurring defect.
 */
export function describeTask(task, { withAnswer = false } = {}) {
  if (!task) return 'no such task'
  const seconds = Math.round(((task.endedAt || Date.now()) - task.startedAt) / 1000)
  const doing = task.progress?.doing?.length ? task.progress.doing.join(', ') : ''

  if (task.state === TaskState.RUNNING) {
    // A restarted task SAYS it was restarted. Without this the elapsed time is
    // a lie of exactly the kind this file exists to avoid: the record has been
    // alive since the question was asked, the WORK has been running since the
    // page was reopened, and an agent told "still working (2h so far)" about a
    // thread that started ninety seconds ago will draw the wrong conclusion
    // about whether it is stuck.
    const again = task.resumes
      ? ` — restarted ${task.resumes === 1 ? 'once' : `${task.resumes} times`} after the tab closed, working again for ${Math.round((Date.now() - (task.resumedAt || task.startedAt)) / 1000)}s`
      : ''
    return `${task.id}: ${task.agent} is still working${doing ? ` — ${doing}` : ''} (${seconds}s so far)${again}`
  }
  if (task.state === TaskState.INTERRUPTED) {
    // What it was doing is the useful half: an instruction the caller can hand
    // over again, which is the only way to continue work whose thread is gone.
    return `${task.id}: ${task.agent} was still working when the tab closed, after ${seconds}s, and did not answer. Ask it again if you still want it: ${JSON.stringify(String(task.task ?? '').slice(0, 120))}`
  }
  if (task.state === TaskState.STOPPED) {
    // No hint to read it back and no invitation to retry: the agent did not
    // decide this and has nothing to learn from it. It is told so that it stops
    // waiting, which is the whole of what it needs.
    return `${task.id}: ${task.agent} was stopped after ${seconds}s`
  }
  if (task.state === TaskState.FAILED) {
    const why = task.result?.failure?.message ?? 'it did not say why'
    return `${task.id}: ${task.agent} failed after ${seconds}s — ${why}`
  }
  const answer = String(task.result?.value ?? '')
  // The ANSWER is the point of a finished task, and it is withheld from the
  // context block on purpose: a paragraph of someone else's research rendered
  // into every prompt is the whole cost delegation exists to avoid. The context
  // says it is ready; `check_task` is what spends the tokens to read it.
  return withAnswer
    ? `${task.id}: ${task.agent} finished after ${seconds}s and said:\n\n${answer}`
    : `${task.id}: ${task.agent} finished after ${seconds}s — read it with check_task({"id": "${task.id}"})`
}
