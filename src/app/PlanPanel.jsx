'use client'

/**
 * WHERE THE WORK HAS GOT TO — the goal, broken into the parts it is made of.
 *
 * Under the goal field and above the run, because that is the order the three
 * things stand in: what this is for, what that was broken into, what happened
 * in the last turn. A reader looking for "is it nearly done" is looking for
 * this, and it is the one question the step trace above it cannot answer.
 *
 * Read-only, and that is a decision rather than a missing feature. The agent
 * composes the plan and the agent ticks it off, so a box the user could edit
 * would make two authors of one record — and the interesting half of what a
 * person wants to do to a plan is not "retype step three" but "no, do this
 * instead", which is a sentence to the agent and reaches here through the turn
 * it starts. A control that let the user move a step behind the agent's back
 * would be the plan and the model's belief about the plan disagreeing, which is
 * the defect this tree has shipped twice under other names.
 *
 * Live during a turn: `EventName.PLAN` arrives whenever the agent revises it,
 * so a long run is watchable rather than reported at the end.
 *
 * The test ids are `goal-plan-…` and not `plan-…` because `SchedulePanel`
 * already owns the second: it calls a recurring question a "plan", and its
 * field, button and list are `plan-text`, `plan-add` and `plan-list` in
 * `scripts/smoke.js`. Two unrelated things under one name in one drawer is how
 * a check ends up asserting against the wrong panel and passing.
 *
 * @param {{plan: {steps: {text: string, state: string}[]}|null, goal: string}} props
 */

/** The word for a state, in the order the eye needs it: what it IS, not a code. */
const SAYS = {
  pending: 'to do',
  active: 'doing',
  done: 'done',
  dropped: 'dropped',
}

export function PlanPanel({ plan, goal = '' }) {
  const steps = plan?.steps ?? []

  if (!steps.length) {
    // Two sentences and they are different sentences, because the two states
    // are different: a conversation with no goal has nothing to decompose, and
    // a conversation with a goal and no plan is one the agent has not broken
    // down yet. Saying "no plan yet" to somebody who has not set a goal would
    // leave them waiting for something that is never coming.
    return (
      <p className="hint" data-testid="goal-plan-empty">
        {goal.trim()
          ? 'No plan yet. Ask the agent how it would do this and it writes one here, then ticks the parts off as it works.'
          : 'A goal broken into parts appears here. Set one above to give the agent something to break down.'}
      </p>
    )
  }

  const left = steps.filter((step) => step.state === 'pending' || step.state === 'active').length

  return (
    <section className="plan" data-testid="goal-plan">
      <h3>
        the plan{' '}
        <span className="measured" data-testid="goal-plan-left">
          {left} of {steps.length} left
        </span>
      </h3>
      <ol className="planlist">
        {steps.map((step, index) => (
          <li
            // The words, which `Plan.compose` has already made unique within a
            // plan — it keeps a repeated step once and says so. The ordinal
            // would be the wrong key for the reason it is the right ADDRESS: a
            // revision renumbers the list, so keying on position would let a
            // step that merely moved be redrawn as a different step.
            key={step.text}
            data-state={step.state}
            data-testid={`goal-plan-step-${index + 1}`}
          >
            <span className="planstate" aria-hidden="true" />
            <span className="plantext">{step.text}</span>
            <span className="measured">{SAYS[step.state] ?? step.state}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
