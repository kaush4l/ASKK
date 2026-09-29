/** Shared authored and runtime bounds. Invalid settings fail; they never silently clamp. */
export const LOOP_BUDGET = Object.freeze({
  maxSteps: Object.freeze({ field: 'max_steps', min: 1, max: 1000, fallback: 10 }),
  repairs: Object.freeze({ field: 'repairs', min: 0, max: 3, fallback: 2 }),
  keep: Object.freeze({ field: 'keep', min: 1, max: 10000, fallback: 4 }),
})

export function loopBudgetValue(key, value, label = LOOP_BUDGET[key].field) {
  const rule = LOOP_BUDGET[key]
  if (value === undefined) return rule.fallback
  if (!Number.isSafeInteger(value) || value < rule.min || value > rule.max) {
    throw new RangeError(`${label} must be an integer from ${rule.min} to ${rule.max}`)
  }
  return value
}

export function validateLoopBudget(settings, { authored = false, prefix = '' } = {}) {
  for (const [key, rule] of Object.entries(LOOP_BUDGET)) {
    const field = authored ? rule.field : key
    loopBudgetValue(key, settings[field], `${prefix}${field}`)
  }
}
