/**
 * THE YAML SUBSET AN AGENT FILE IS WRITTEN IN — ours, and deliberately not a
 * YAML library.
 *
 * `Bun.YAML` exists and it is a BUILD-TIME api: `bun build --target=browser`
 * emits the call verbatim and the page has no `Bun`. A person may author an
 * agent in this browser, so the file that decides what that agent may call has
 * to be readable AT RUNTIME, by us, or authoring is a feature that works until
 * somebody uses it.
 *
 * The subset is every shape the shipped files use and nothing else: `key:
 * value`, a bare `key:` opening a block of `- item` lines, and the inline
 * `[a, b]` form. WHAT IT CANNOT READ IT REFUSES BY NAME. A key nothing reads
 * is a setting that looks applied — `engine: reakt` parsed clean for eighteen
 * rounds while selecting nothing — so an unknown key is a refusal, and so is a
 * value of a shape this cannot honour. Silence must never fail towards more
 * capability: a dropped `tools:` line leaves the list empty, and an empty list
 * means EVERY built-in.
 * @module
 */

import { STAGES } from '@harness/kernel'

/** The two engines. `react` is the tool loop; `base` is one reply with no tools, enforced by `toolbox.js` rather than described in prose. */
export const ENGINES = /** @type {const} */ (['react', 'base'])

/** The jobs the core used to hardcode as the string literals `main` and `summarizer`, so renaming a folder silently unhooked the machinery. A file DECLARES its job and the core looks the holder up. */
export const ROLES = /** @type {const} */ (['entry', 'critic'])

/** One file this build will not read, as a value: WHERE, WHICH KEY, and the sentence a person acts on. A value and not a throw because skipping a broken agent is correct — staying silent about it is what is not — so the roster projects this beside the agents that did load. @typedef {{path: string, key: string, message: string}} Refusal */

/** How one key's value is read, and the spec field it lands on. The file spells keys in snake_case; the spec is JavaScript. @typedef {{field: string, kind: 'text'|'closed'|'list'|'whole'|'number', legal?: readonly string[]}} Slot */

/** @type {Record<string, Slot>} */
const FIELDS = {
  name: { field: 'name', kind: 'text' },
  description: { field: 'description', kind: 'text' },
  model: { field: 'model', kind: 'text' },
  space: { field: 'space', kind: 'text' },
  engine: { field: 'engine', kind: 'closed', legal: ENGINES },
  role: { field: 'role', kind: 'closed', legal: ROLES },
  stages: { field: 'stages', kind: 'list' },
  tools: { field: 'tools', kind: 'list' },
  faculties: { field: 'faculties', kind: 'list' },
  compact_at: { field: 'compactAt', kind: 'whole' },
  keep_recent: { field: 'keepRecent', kind: 'whole' },
  max_rounds: { field: 'maxRounds', kind: 'whole' },
  passes: { field: 'passes', kind: 'whole' },
  temperature: { field: 'temperature', kind: 'number' },
}

/** @param {string} path @param {string} key @param {string} message @returns {{refusal: Refusal}} */
export function refuse(path, key, message) {
  return { refusal: { path, key, message } }
}

/**
 * The frontmatter block, read into the fields it names. The values are typed by
 * construction — a `whole` key holds a number here or nothing does — so the
 * caller merges them over the defaults without re-checking their shapes.
 * @param {string} path @param {string} block the text between the two `---` lines
 * @returns {{values: Record<string, unknown>} | {refusal: Refusal}}
 */
export function readFrontmatter(path, block) {
  /** @type {Record<string, unknown>} */
  const values = {}
  let open = ''
  for (const raw of block.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    if (line.startsWith('- ')) {
      // A `- item` under no open list is dropped and NOT fed to `tools:`,
      // which is what the Rust's catch-all did: silence towards capability.
      if (open !== '') push(values, open, unquote(line.slice(2)))
      continue
    }
    const at = line.indexOf(':')
    // The one shape this reader cannot read at all, and the only line that used
    // to be dropped in silence — `exec` on its own, or a shell command a person
    // pasted a line early, would leave the file parsing clean while carrying an
    // instruction nothing here ever reads.
    if (at < 0) return refuse(path, '', `${path} holds the line "${line}", which is neither a "key: value" nor a "- item" under an open key, so nothing in this build reads it.`)
    const set = setField(path, values, line.slice(0, at).trim(), unquote(line.slice(at + 1)))
    if ('refusal' in set) return set
    open = set.open
  }
  return knownStages(path, values) ?? { values }
}

/** One `key: value`, onto the field it names. The return says which key's block list the lines below now belong to. @param {string} path @param {Record<string, unknown>} values @param {string} key @param {string} value @returns {{open: string} | {refusal: Refusal}} */
function setField(path, values, key, value) {
  const slot = Object.hasOwn(FIELDS, key) ? FIELDS[key] : undefined
  if (!slot) {
    return refuse(path, key, `${path} declares "${key}:", and no agent file key is called that — the keys are: ${Object.keys(FIELDS).join(', ')}.`)
  }
  // Last-wins is a silent choice made on the author's behalf. The `- item`
  // lines below an open key are exempt by construction: they go through
  // `push`, which appends, which is what a list under a key means.
  if (Object.hasOwn(values, slot.field)) {
    return refuse(path, key, `${path} declares "${key}:" twice, and only its author knows which was meant.`)
  }
  if (slot.kind === 'list') {
    const inline = value.startsWith('[') && value.endsWith(']')
    if (inline) values[slot.field] = split(value.slice(1, -1))
    else if (value === '') { values[slot.field] = []; return { open: slot.field } }
    else return refuse(path, key, `${path} holds "${key}: ${value}", and this build reads it as a list — write ${key}: [a, b], or a bare "${key}:" with "- name" lines under it.`)
    return { open: '' }
  }
  const read = scalar(path, key, value, slot)
  if ('refusal' in read) return read
  values[slot.field] = read.value
  return { open: '' }
}

/** @param {string} path @param {string} key @param {string} value @param {Slot} slot @returns {{value: unknown} | {refusal: Refusal}} */
function scalar(path, key, value, slot) {
  if (slot.kind === 'text') return { value }
  // A KEY WRITTEN WITH NOTHING AFTER IT IS A KEY NOBODY DECIDED. `whole` caught
  // it and `Number('')` did not, so `temperature:` alone ran an agent fully
  // deterministic at 0 — the default nobody chose, arrived at by arithmetic.
  // `role:` is the one blank that means something: a file holding no job.
  if (value === '' && key !== 'role') {
    return refuse(path, key, `${path} holds "${key}:" with nothing after it, and a value that parses to nothing would run as a default nobody chose.`)
  }
  if (slot.kind === 'closed') {
    if (value === '') return { value: '' }
    const legal = slot.legal ?? []
    return legal.includes(value)
      ? { value }
      : refuse(path, key, `${path} holds "${key}: ${value}", and the ${key} is one of: ${legal.join(', ')}.`)
  }
  const number = slot.kind === 'whole' ? whole(value) : Number(value)
  return Number.isFinite(number)
    ? { value: number }
    : refuse(path, key, `${path} holds "${key}: ${value}", and this build reads it as ${slot.kind === 'whole' ? 'a whole number' : 'a number'} — a value that parses to nothing would run as a default nobody chose.`)
}

/** A non-negative integer, or NaN. `parseInt` is not used: it reads "8 turns" as 8. @param {string} value @returns {number} */
function whole(value) {
  return /^\d+$/.test(value.trim()) ? Number(value) : Number.NaN
}

/** @param {Record<string, unknown>} values @param {string} field @param {string} item */
function push(values, field, item) {
  const held = values[field]
  if (Array.isArray(held) && item !== '') held.push(item)
}

/** The inside of an inline `[a, b]`. Empty items are dropped, so a trailing comma costs nothing; an empty LIST stays empty and means something. @param {string} inline @returns {string[]} */
function split(inline) {
  return inline.split(',').map(unquote).filter((s) => s !== '')
}

/** Quotes are a YAML nicety and never part of a value: `name: "shopper"` and `name: shopper` are one agent. @param {string} value @returns {string} */
export function unquote(value) {
  const v = value.trim()
  for (const q of ['"', "'"]) {
    if (v.length >= 2 && v.startsWith(q) && v.endsWith(q)) return v.slice(1, -1)
  }
  return v
}

/** Every stage name, from either list form, checked in one place — `engine`'s rule for the key that decides the whole loop. @param {string} path @param {Record<string, unknown>} values @returns {{refusal: Refusal} | null} */
function knownStages(path, values) {
  const named = Array.isArray(values['stages']) ? values['stages'] : []
  const bad = named.find((s) => !(/** @type {readonly unknown[]} */ (STAGES)).includes(s))
  return bad === undefined
    ? null
    : refuse(path, 'stages', `${path} names the stage "${bad}", and the stages are: ${STAGES.join(', ')}.`)
}
