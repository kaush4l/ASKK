import { Outcome } from '../Outcome.js'
import { Tool } from './Tool.js'

/**
 * Another agent, offered as a tool.
 *
 * The two fields an agent file already declares are exactly the two a tool
 * needs: `name` becomes the callable name and the name of the thread it runs
 * on, and `description` becomes the line telling the calling model when this
 * agent is the right one to ask. That is why an agent file needs no separate
 * "as a tool" section — a good description is already the whole interface.
 *
 * Holds no Worker. It is given a `dispatch` function, so the same tool works
 * whether the agent behind it is a thread, a tab, or a machine — and `core/`
 * stays free of the wiring that decides which.
 */
export class SubAgentTool extends Tool {
  /**
   * @param {{spec: object,
   *   dispatch: (name: string, prompt: string, signal: AbortSignal|null)
   *     => Promise<Outcome>}} options
   */
  constructor({ spec, dispatch }) {
    super({
      name: spec.name,
      description: spec.description || `Ask the ${spec.name} agent.`,
      parameters: {
        task: {
          type: 'string',
          description:
            'What you want done, written as a complete instruction. The agent cannot see this conversation, so include everything it needs.',
        },
      },
    })
    this.spec = spec
    this.dispatch = dispatch
  }

  async call({ task } = {}, signal = null) {
    const instruction = typeof task === 'string' ? task.trim() : ''
    if (!instruction) {
      return Outcome.ok(
        `${this.name} was given no task. Call it again with {"task": "..."} describing what you need.`,
      )
    }
    // The signal goes on. A delegated run is a whole second agent burning a
    // whole second budget on its own thread; before this it could not be
    // stopped at all, so pressing stop on a delegating agent ended the parent
    // and left the child running to completion.
    return this.dispatch(this.name, instruction, signal)
  }
}
