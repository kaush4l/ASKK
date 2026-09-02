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
 * result}`, `state` is one of the three below, and `result` is the sub-agent's
 * whole outcome as JSON — null until the run ends.
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
    return `${task.id}: ${task.agent} is still working${doing ? ` — ${doing}` : ''} (${seconds}s so far)`
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
