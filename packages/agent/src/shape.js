/**
 * WHAT A STORED AGENT STATE MUST LOOK LIKE, field by field and inside the
 * compound ones.
 *
 * Separate from `state.js` because the vocabulary and the check that a record
 * matches it are two things a reader holds separately — and because the check
 * is where a stored record's mistakes actually live.
 *
 * ONE TYPEOF IS NOT A CHECK. A record holding `standing: {}` passes `typeof`
 * and then `goal.js` reads `standing.goal.check` off `undefined` at a call site
 * that had no way to know. So the compound fields are checked THROUGH: the
 * tables below name every member this build reads, and a mismatch is reported
 * at its PATH — `standing.goal`, `toolbox[2].name` — not at its outermost key.
 * @module
 */

/** Arrays and objects are one `typeof`, and confusing them is the mistake a stored record actually makes. */
export function shapeOf(/** @type {unknown} */ value) {
  if (value === null) return 'null'
  return Array.isArray(value) ? 'array' : typeof value
}

/** Where a record disagrees with this build, worded for the sentence that reports it. @typedef {{key: string, found: string, want: string}} Mismatch */

/**
 * Fields a fresh state leaves null and a live one fills. Shape checking needs
 * both halves of the union, and there is no other way to know that a `task` of
 * `null` and a `task` of `'summarise this'` are the same field.
 * @type {Record<string, string>}
 */
const NULLABLE = { task: 'string', temperature: 'number', reviewed: 'boolean', space: 'object' }

/**
 * The compound fields, by path. A member absent from a stored compound is a
 * mismatch and not a default: the whole compound is replaced on restore, so a
 * missing member is a field the reader would hand on as `undefined`.
 * @type {Record<string, Record<string, string[]>>}
 */
const MEMBERS = {
  standing: { goal: ['object'], checking: ['boolean'], met: ['boolean', 'null'] },
  'standing.goal': { outcome: ['string'], check: ['string'], doneWhen: ['string'] },
  space: { name: ['string'], facts: ['array'], notes: ['array'] },
}

/** Lists whose elements are all one shape. @type {Record<string, string>} */
const ELEMENTS = { stages: 'string', declared: 'string', faculties: 'string' }

/** @param {string} key @param {unknown} value @param {readonly string[]} want @returns {Mismatch | null} */
function fits(key, value, want) {
  const found = shapeOf(value)
  return want.includes(found) ? null : { key, found, want: want.join(' or ') }
}

/**
 * One stored field against the shape this build reads, outer type first and
 * then inside it.
 * @param {string} key @param {unknown} value @param {unknown} fresh  the default this field takes
 * @returns {Mismatch | null}
 */
export function checkField(key, value, fresh) {
  const want = [shapeOf(fresh)]
  const other = Object.hasOwn(NULLABLE, key) ? NULLABLE[key] : undefined
  if (other) want.push(other)
  return fits(key, value, want) ?? checkInside(key, value)
}

/** @param {string} key @param {unknown} value @returns {Mismatch | null} */
function checkInside(key, value) {
  if (value === null) return null
  if (Object.hasOwn(MEMBERS, key)) return checkMembers(key, value)
  const element = Object.hasOwn(ELEMENTS, key) ? ELEMENTS[key] : undefined
  if (element) return checkEvery(key, value, [element])
  if (key === 'toolbox') return checkToolbox(value)
  if (key === 'senses') return checkSenses(value)
  return null
}

/** @param {string} path @param {unknown} value @returns {Mismatch | null} */
function checkMembers(path, value) {
  const record = /** @type {Record<string, unknown>} */ (value)
  const table = MEMBERS[path] ?? {}
  for (const [member, want] of Object.entries(table)) {
    const at = `${path}.${member}`
    const held = Object.hasOwn(record, member) ? record[member] : undefined
    const bad = fits(at, held, want) ?? (Object.hasOwn(MEMBERS, at) && held !== null ? checkMembers(at, held) : null)
    if (bad) return bad
  }
  return null
}

/** @param {string} path @param {unknown} value @param {readonly string[]} want @returns {Mismatch | null} */
function checkEvery(path, value, want) {
  const list = /** @type {unknown[]} */ (value)
  for (const [index, item] of list.entries()) {
    const bad = fits(`${path}[${index}]`, item, want)
    if (bad) return bad
  }
  return null
}

/** The loop reads only the name; a descriptor missing one is a tool it cannot grant or refuse. @param {unknown} value @returns {Mismatch | null} */
function checkToolbox(value) {
  const list = /** @type {unknown[]} */ (value)
  for (const [index, item] of list.entries()) {
    const bad = fits(`toolbox[${index}]`, item, ['object'])
    if (bad) return bad
    const held = /** @type {Record<string, unknown>} */ (item)
    const name = Object.hasOwn(held, 'name') ? held.name : undefined
    const badName = fits(`toolbox[${index}].name`, name, ['string'])
    if (badName) return badName
  }
  return null
}

/** @param {unknown} value @returns {Mismatch | null} */
function checkSenses(value) {
  for (const [id, parts] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
    const bad = fits(`senses.${id}`, parts, ['array'])
    if (bad) return bad
  }
  return null
}
