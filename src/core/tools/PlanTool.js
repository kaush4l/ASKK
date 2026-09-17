import { Outcome } from '../Outcome.js'
import { StepState } from '../Plan.js'
import { planOr } from './PlanPort.js'
import { Tool } from './Tool.js'

/**
 * Write the list of steps the goal is made of, and say which one is finished.
 *
 * This is the half of "take a goal and compose it into tasks" that the goal
 * block alone cannot do. A goal in the prompt keeps a long run pointed at the
 * right thing; it does not tell the run where it has got to, so turn forty
 * re-derives the decomposition every time and quietly re-does work.
 *
 * It earns its round trip on the rule `tools/index.js` sets — a fact belongs in
 * the context block, a capability belongs in a tool — because this does not
 * REPORT the plan, it CHANGES it. The reading is free and already in the
 * prompt: the plan block is rendered every turn beside the goal, so an agent
 * never spends a call to find out what the plan is.
 *
 * One tool and not three (`plan`, `start_step`, `finish_step`) because they
 * would share every argument and differ in one word, and three tool renderings
 * cost their bytes in every prompt of the conversation. The verbs are the
 * arguments.
 */
export class PlanTool extends Tool {
  constructor({ plan = null } = {}) {
    super({
      name: 'plan',
      description:
        'Write or revise the list of steps this goal is made of, and mark where you have got to. The current list is in the PLAN block of your prompt every turn, so you never need to call this to read it.',
      parameters: {
        steps: {
          type: 'string[]',
          required: false,
          description:
            'The whole list, in order, replacing whatever is there. One short line per step. Revising keeps what is known about any step whose wording you leave unchanged.',
        },
        doing: {
          type: 'number',
          required: false,
          description: 'The number of the step you are starting now.',
        },
        done: {
          type: 'number',
          required: false,
          description: 'The number of the step you have just finished.',
        },
        drop: {
          type: 'number',
          required: false,
          description: 'The number of a step that turned out not to be needed.',
        },
      },
    })
    this.plan = planOr(plan)
  }

  /**
   * Compose, mark, persist, and hand back the list as it now stands.
   *
   * The whole rendered list comes back rather than an acknowledgement, and that
   * is the point of the return: the agent has just renumbered its own work, so
   * the one thing it needs before its next call is the new numbering. "step 2
   * marked done" would be true and useless.
   */
  async call({ steps, doing, done, drop } = {}) {
    const plan = this.plan.read()
    const said = []
    let changed = false

    if (steps !== undefined) {
      if (!Array.isArray(steps)) {
        // An observation, not a failure, like every other tool here. The agent's
        // next move is a decision it can still make.
        return Outcome.ok(
          'plan expects steps to be a list of short lines, like ["read the spec", "write the test"]. Nothing was changed.',
        )
      }
      said.push(...plan.compose(steps))
      changed = true
    }

    // Ordinals are applied AFTER any composition in the same call, because a
    // call that does both means "here is the new list, and I have finished the
    // first of it" — numbering against the old list would mark whatever used to
    // be there.
    for (const [ordinal, state, verb] of [
      [doing, StepState.ACTIVE, 'doing'],
      [done, StepState.DONE, 'done'],
      [drop, StepState.DROPPED, 'drop'],
    ]) {
      if (ordinal === undefined || ordinal === null || ordinal === '') continue
      const moved = plan.mark(ordinal, state)
      if (moved) {
        changed = true
        continue
      }
      said.push(
        plan.isEmpty
          ? `there is no step ${ordinal} to ${verb}: the plan is empty, so write one with steps first`
          : `there is no step ${ordinal} to ${verb}; the plan has ${plan.steps.length}`,
      )
    }

    if (!changed && !said.length) {
      return Outcome.ok(
        `${this.describe(plan)}\n\nNothing was changed — plan takes steps, doing, done or drop.`,
      )
    }

    if (changed && !(await this.plan.write(plan))) {
      // Said rather than swallowed: a plan that is right for this turn and gone
      // on the next reload is a different thing from a plan that was kept, and
      // the agent is the party that can act on the difference.
      said.push('this plan is held for now but was not stored, so a reload would lose it')
    }

    return Outcome.ok([this.describe(plan), ...said].join('\n\n'))
  }

  /** The list as it now stands, or the sentence for a plan with nothing in it. */
  describe(plan) {
    if (plan.isEmpty) return 'the plan is empty'
    const left = plan.outstanding.length
    return `${plan.render()}\n\n${left} step${left === 1 ? '' : 's'} left of ${plan.steps.length}.`
  }
}
