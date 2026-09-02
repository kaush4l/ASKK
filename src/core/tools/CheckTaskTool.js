import { Outcome } from '../Outcome.js'
import { describeTask, tasksOr } from './TasksPort.js'
import { Tool } from './Tool.js'

/**
 * Read back a question this agent handed over and did not wait for.
 *
 * The counterpart to calling a sub-agent with `wait: false`, and it earns its
 * round trip on exactly the rule `tools/index.js` sets: WHICH tasks exist and
 * whether they have finished is a fact, so the context block says it every
 * turn; what a finished one actually SAID is a paragraph of someone else's
 * research, so it costs a call rather than sitting in every prompt for the rest
 * of the conversation. That split is the whole reason handing work over saves
 * anything — a delegated answer rendered into every later turn would cost more
 * than never delegating at all.
 *
 * A task that is still running is not an error and not a wait. The agent is
 * told how long it has been going and what it is doing, and gets on with
 * something else; a tool that blocked here would undo the handing over.
 */
export class CheckTaskTool extends Tool {
  constructor({ tasks = null } = {}) {
    super({
      name: 'check_task',
      description:
        'Read back a task you handed to another agent without waiting. The context block lists which ones exist and whether they are done.',
      // The one tool in this tree that means something different every time it
      // is asked: it reports whether another agent has finished YET. The loop's
      // repeat guard would otherwise answer the second poll with "the result
      // would be identical", which is exactly wrong here.
      repeatable: true,
      parameters: {
        id: {
          type: 'string',
          required: true,
          description: 'The task id, as the context block gives it.',
        },
      },
    })
    this.tasks = tasksOr(tasks)
  }

  async call({ id } = {}) {
    const wanted = String(id ?? '').trim()
    if (!wanted) {
      return Outcome.ok('check_task needs an id. The context block lists the ones you have.')
    }

    const found = this.tasks.get(wanted)
    if (!found) {
      // An observation, not a failure, like every other tool here: the agent's
      // next move is a decision it can still make, and the ids it does have are
      // the useful half of the answer.
      const known = this.tasks.list().map((task) => task.id)
      return Outcome.ok(
        known.length
          ? `there is no task ${wanted}. You have: ${known.join(', ')}.`
          : `there is no task ${wanted}, and you have not handed any work over.`,
      )
    }
    return Outcome.ok(describeTask(found, { withAnswer: true }))
  }
}
