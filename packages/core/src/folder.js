/**
 * WHAT THE WORKSPACE HELD, folded out of the tool calls that touched it — and
 * the one sentence an empty folder is owed.
 *
 * THE SENTENCE IS THE POINT (the FACE lane's round-2 request, ruled to this
 * lane). A folder that never held a file and a folder a reload emptied are
 * DIFFERENT facts, and the interface may compose neither of them (I5). Only the
 * log knows which happened: it holds the writes, it knows which of them landed
 * before this page load, and `durable()` says whether surviving one was ever
 * possible. The Rust said the same thing off the same three inputs
 * (`files/empty_states.rs`), and it is ported whole because the shape was the
 * problem's and not Rust's.
 * @module
 */

/** @typedef {import('@harness/kernel').Event} Event */

/** @typedef {{name: string, seq: number}} Written */
/** @typedef {{at: string, ok: boolean, output: string}} Listing */
/** @typedef {{written: Record<string, Written[]>, listing: Listing|null}} Folder */

export const FOLDER = 'folder'

/** The two tools this fold is about. Nothing else changes what a folder holds. */
const WRITE = 'write_file'
const LIST = 'list_files'

/** The mechanism, said ONCE, so the note and the Setup pane cannot word it differently. */
export const IN_MEMORY = 'This workspace is held in memory'

/** @type {import('./log/reducers.js').Reducer} */
export const folderReducer = {
  name: FOLDER,
  version: 1,
  init: () => /** @type {Folder} */ ({ written: {}, listing: null }),
  fold: (/** @type {Folder} */ state, /** @type {Event} */ event) => {
    const fact = event.fact
    if (fact.type !== 'tool_invoked' || !fact.ok) return state
    if (fact.tool === LIST) state.listing = { at: pathOf(fact.args), ok: fact.ok, output: fact.output }
    if (fact.tool === WRITE) remember(state, pathOf(fact.args), event.seq)
    return state
  },
}

/** One write, kept under its folder. Rewriting a file is not a second file. */
function remember(/** @type {Folder} */ state, /** @type {string} */ path, /** @type {number} */ seq) {
  if (path === '') return
  const held = state.written[parent(path)] ?? (state.written[parent(path)] = [])
  const name = base(path)
  if (!held.some((w) => w.name === name)) held.push({ name, seq })
}

/**
 * WHICH PATH A CALL WAS ABOUT. A call that named none is about none: answering
 * `.` for it would claim the workspace root was listed when nothing was.
 */
export function pathOf(/** @type {string} */ argsJson) {
  /** @type {unknown} */
  let said
  try {
    said = JSON.parse(argsJson)
  } catch {
    return ''
  }
  const path = /** @type {{path?: unknown}} */ (said ?? {}).path
  return typeof path === 'string' ? path.trim().replace(/\/+$/, '') : ''
}

/** The folder a path sits in. `.` is the root, which is what a bare name means. */
export function parent(/** @type {string} */ path) {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '.' : path.slice(0, cut)
}

/** The name at the end of a path. */
function base(/** @type {string} */ path) {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The folder as a person reads it, never as `ls` was called with it. */
export function named(/** @type {string} */ at) {
  const path = at.replace(/\/+$/, '')
  return path === '.' || path === '' ? 'the folder' : path
}

/**
 * WHY THIS FOLDER LOOKS EMPTY, in one sentence.
 *
 * The reload case wins because it is the only one that is a LOSS: the names are
 * what makes it a claim about this person's work rather than a note about how
 * storage works. `seq < bootedAt` is what makes it true — a file written and
 * deleted in THIS session is not one the reload took.
 * @param {Folder} folder
 * @param {{at: string, durable: boolean, bootedAt: number}} world
 * @returns {string}
 */
export function folderNote(folder, world) {
  const gone = world.durable ? [] : (folder.written[world.at] ?? []).filter((w) => w.seq < world.bootedAt)
  if (gone.length > 0) return lost(gone.map((w) => w.name), world.at)
  const listing = folder.listing
  if (!listing || listing.at !== world.at) {
    return `Nothing listed yet — this page is still asking for ${named(world.at)}. The agent's own listings appear here too.`
  }
  if (!listing.ok) return `${capital(named(world.at))} was not there when this listing ran.`
  return `Nothing was in ${named(world.at)} when this listing ran.`
}

/** @param {string[]} names @param {string} at @returns {string} */
function lost(names, at) {
  const [was, them] = names.length === 1 ? ['was', 'it'] : ['were', 'them']
  return `${listed(names)} ${was} written in ${named(at)}, and nothing is left of ${them}. ${IN_MEMORY}, so the reload that rebuilt it took ${them} with it.`
}

/** A run of names as a person would read it aloud. Spelling, not opinion. */
export function listed(/** @type {readonly string[]} */ names) {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** @param {string} text */
function capital(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
