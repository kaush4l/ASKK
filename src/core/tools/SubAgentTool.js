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
  constructor({ spec, dispatch, start = null }) {
    super({
      name: spec.name,
      description: spec.description || `Ask the ${spec.name} agent.`,
      parameters: {
        task: {
          type: 'string',
          description:
            'What you want done, written as a complete instruction. The agent cannot see this conversation, so include everything it needs.',
        },
        wait: {
          type: 'boolean',
          description:
            'true (the default) to wait for the answer now. false to hand it over and carry on — you get a task id back, the context block says when it is done, and check_task reads it.',
        },
      },
    })
    this.spec = spec
    this.dispatch = dispatch
    // How to hand work over without waiting, when the caller can. Absent in a
    // realm that has nowhere to keep a running task — a sub-agent's own thread,
    // for instance — and the tool says so rather than quietly waiting instead.
    this.start = start
  }

  async call({ task, wait } = {}, signal = null) {
    const instruction = typeof task === 'string' ? task.trim() : ''
    if (!instruction) {
      return Outcome.ok(
        `${this.name} was given no task. Call it again with {"task": "..."} describing what you need.`,
      )
    }

    // Handed over rather than awaited. `wait: false` is the difference between
    // a tool that costs the parent the child's whole runtime and one that costs
    // a round trip: the receipt comes straight back, the run carries on in its
    // own realm, and the context block reports it from the next turn onward.
    //
    // Read strictly — `false` and `"false"`, not "anything falsy" — because a
    // model writing nothing at all must still get the waiting behaviour it did
    // not ask to change.
    // A model writes what it writes, and this argument's whole job is to be
    // read the way it was meant. `false`, `"false"`, `"no"`, `0` and
    // `"async"` all mean hand it over; anything else waits, which is the
    // behaviour nobody has to ask for. Before this, `wait: 0` and `wait: "no"`
    // silently waited — the parameter said boolean and the model was not wrong
    // to write either.
    const written = String(wait ?? '')
      .trim()
      .toLowerCase()
    const handOver =
      wait === false || wait === 0 || ['false', 'no', '0', 'async', 'background'].includes(written)
    if (handOver) {
      if (!this.start) {
        return Outcome.ok(
          `${this.name} cannot be handed work here — nothing in this build can hold a task that outlives the turn. Call it again without wait: false.`,
        )
      }
      const receipt = this.start(this.name, instruction)
      return Outcome.ok(
        `handed to ${this.name} as ${receipt.id}. Carry on; the context block will say when it is done, and check_task({"id": "${receipt.id}"}) reads the answer.`,
      )
    }
    // The signal goes on. A delegated run is a whole second agent burning a
    // whole second budget on its own thread; before this it could not be
    // stopped at all, so pressing stop on a delegating agent ended the parent
    // and left the child running to completion.
    return this.dispatch(this.name, instruction, signal)
  }
}
