import { InferenceError } from '../../../src/core/inference.js'
import { snapshot } from '../../../src/core/prompt.js'

export const LIMITS = Object.freeze({ mainRequests: 6, compactorRequests: 1, inspections: 2, wallMs: 15 * 60 * 1000 })

/** Reserve synchronously before awaiting; concurrent calls cannot exceed the cap. */
export function counter(limit, label) {
  let count = 0
  return { get count() { return count }, take() { if (count >= limit) throw new InferenceError(`${label} budget exhausted (${limit})`, 'eval_budget'); return ++count } }
}

export function boundModel(llm, budget) {
  return { ...llm, async *stream(messages, options) { budget.take(); yield* llm.stream(messages, options) } }
}

export function evidenceRecorder() {
  const events = []
  return {
    record(agent, phase, event) {
      // Full prompt/request/call/observation receipts remain exact. Stream text is
      // already represented by accepted history; raw reasoning is not collected.
      if (['delta', 'reasoning', 'field'].includes(event.kind)) return
      events.push(snapshot({ agent, phase, at: Date.now(), ...event }))
    },
    snapshot: () => snapshot(events),
  }
}

export function executionAssessment({ baseline, repaired, originalPlan, compactions, main, counts, forbidden }) {
  const checks = {
    baselineReproduced: baseline?.ok === false && baseline.results?.length === 15 && baseline.errors?.some(error => error.includes('actual text') && error.includes('Write report')) === true,
    realRepairPassed: repaired?.ok === true && Array.isArray(repaired.assertions) && repaired.assertions.length > 0 && Array.isArray(repaired.results) && repaired.results.length === repaired.assertions.length,
    changedPlan: Boolean(repaired) && JSON.stringify(repaired.assertions) !== JSON.stringify(originalPlan),
    oneCompaction: compactions === 1,
    mainCompleted: main.status === 'done',
    withinBudget: Number.isInteger(counts.main) && counts.main >= 1 && counts.main <= LIMITS.mainRequests && counts.compactor === 1 && counts.inspections === LIMITS.inspections,
    sourcePreserved: forbidden.length === 0,
  }
  return { passed: false, status: Object.values(checks).every(Boolean) ? 'needs-independent-review' : 'failed', checks, reviewRequired: ['Summary retains failed index, Active filter, expected Buy groceries and actual Write report without inventing passed states.', 'The repaired plan targets the intended tasks by stable identity and covers Active, Completed, and reload restoration; a trivial passing assertion is insufficient.', 'No owner steering or application mutation occurred. This is verification repair, not fresh application generation.'] }
}
