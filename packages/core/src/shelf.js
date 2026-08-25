/**
 * THE SHELF: where a tool result too big to say goes, and how it is said
 * instead.
 *
 * A 200KB listing crossed the predecessor's tool boundary FOUR TIMES — into the
 * result fact, into the assembled document, back out as the model re-emitted a
 * chunk of it, and into the next document — and the person paid for three of
 * those. Here it crosses once: the bytes go to the blob store under a handle,
 * the fact carries a RECEIPT, and the model reads what it needs back through
 * `read_result`. The model never sees the bytes it did not ask for.
 *
 * THE NAME IS `read_result` AND NOT `read_artifact`. The artifacts faculty
 * already ships a `read_artifact` over the SPACE SHELF, addressed by name and
 * offset in bytes; this one is addressed by handle and offset in characters,
 * and the two were both in the assembled catalogue with core's winning the
 * first-name-match lookup. A model told the faculty's contract was being run
 * against this one's — which is the exact drift I13 forbids. What this reads
 * back is a tool RESULT that was too long to say, so it is named that.
 *
 * THE RECEIPT SHOWS BOTH ENDS. Head-only truncation is banned in this build
 * because it kept the greeting and lost the message (RULINGS); for a tool result
 * the head carries the shape and the tail carries the verdict — an exit line, a
 * summary row — so the excerpt keeps both and NAMES the gap between them.
 * @module
 */

import { StoreError } from '@harness/kernel'
import { arg, tool } from '@harness/agent'

/** @typedef {import('@harness/kernel').Event} Event */
/** @typedef {import('@harness/kernel').Ports} Ports */
/** @typedef {import('./app.js').ToolRun} ToolRun */

export const SHELF = 'shelf'

/** The fact that says a result was kept rather than said. Payload: `{handle, tool, bytes, summary}`. */
export const ARTIFACT_KEPT = 'core.artifact_kept'

/**
 * Over this many characters a result is shelved. Chosen against what a result
 * COSTS rather than what it looks like: 8 KB is roughly two thousand tokens, and
 * two thousand tokens of listing re-sent on every subsequent round is the bill
 * this mechanism exists to stop.
 */
export const SPILL_CHARS = 8192

/** How much of each end the receipt quotes. */
const EXCERPT = 600

/** @typedef {{handle: string, tool: string, bytes: number, summary: string, at: number}} Kept */

/** Every artifact this session shelved, newest last. The `/space` pane IS this list. */
/** @type {import('./log/reducers.js').Reducer} */
export const shelfReducer = {
  name: SHELF,
  version: 1,
  init: () => /** @type {Kept[]} */ ([]),
  fold: (/** @type {Kept[]} */ state, /** @type {Event} */ event) => {
    const fact = event.fact
    if (fact.type !== 'custom' || fact.kind !== ARTIFACT_KEPT) return state
    const said = /** @type {Partial<Kept>} */ (fact.payload ?? {})
    if (typeof said.handle !== 'string' || said.handle === '') return state
    state.push({
      handle: said.handle,
      tool: typeof said.tool === 'string' ? said.tool : '',
      bytes: typeof said.bytes === 'number' ? said.bytes : 0,
      summary: typeof said.summary === 'string' ? said.summary : '',
      at: event.at,
    })
    return state
  },
}

/** Where one handle's bytes live. A prefix, so `listPrefix` is the whole index. */
export function artifactPath(/** @type {string} */ handle) {
  return `artifacts/${handle}`
}

/**
 * PUT THE BYTES DOWN AND HAND BACK WHAT TO SAY INSTEAD. The write is awaited:
 * a receipt naming a handle whose bytes never landed is worse than a long
 * result, because the model would then spend a round reading nothing.
 * @param {Ports} ports @param {string} handle @param {string} tool @param {string} output
 * @returns {Promise<string>} the receipt the fact and the model both carry
 */
export async function shelve(ports, handle, tool, output) {
  await ports.store.blob.write(artifactPath(handle), new TextEncoder().encode(output))
  return receipt(handle, tool, output)
}

/** @param {string} handle @param {string} tool @param {string} output @returns {string} */
export function receipt(handle, tool, output) {
  const lines = output.split('\n').length
  return [
    `${tool} produced ${output.length} characters over ${lines} lines, which is too much to put in this conversation.`,
    `It is kept whole as artifact ${handle}. Read any part of it with read_result({"handle": "${handle}", "offset": 0, "limit": 4000}).`,
    '',
    `--- first ${EXCERPT} characters ---`,
    output.slice(0, EXCERPT),
    `--- ${output.length - EXCERPT * 2} characters not shown ---`,
    output.slice(-EXCERPT),
  ].join('\n')
}

/** The one line the shelf pane and the fact both carry about what was kept. */
export function summarise(/** @type {string} */ tool, /** @type {string} */ output) {
  const first = output.split('\n').find((line) => line.trim() !== '') ?? ''
  return `${tool} · ${output.length} characters · ${first.trim().slice(0, 80)}`
}

/**
 * READING ONE BACK. The re-splice half of the mechanism, and a core tool rather
 * than an adapter's: the thing that shelved the bytes has to be the thing that
 * can produce them again, or a build could ship the spill without the door out
 * of it.
 * The return type NAMES the tool rather than being a bag, so a caller reaching
 * for `read_result` gets a function and not a `possibly undefined` — the map
 * shape belongs at the App, which merges several of these.
 * @param {Ports} ports @returns {{read_result: ToolRun}}
 */
export function artifactTools(ports) {
  return {
    read_result: async (args) => {
      /** @type {{handle?: unknown, offset?: unknown, limit?: unknown}} */
      let asked = {}
      try {
        asked = JSON.parse(args)
      } catch {
        return { ok: false, output: 'read_result needs JSON arguments, and that was not JSON.' }
      }
      return await sliceOf(ports, String(asked.handle ?? ''), Number(asked.offset ?? 0), Number(asked.limit ?? 4000))
    },
  }
}

/** @param {Ports} ports @param {string} handle @param {number} offset @param {number} limit */
async function sliceOf(ports, handle, offset, limit) {
  if (handle === '') return { ok: false, output: 'read_result needs a handle — the one the receipt named.' }
  const bytes = await ports.store.blob.read(artifactPath(handle))
  if (bytes === null) {
    throw new StoreError('unavailable', `There is no artifact called "${handle}" here.`, {
      key: artifactPath(handle),
      detail: 'nothing was ever shelved under that handle, or this browser has since been cleared',
    })
  }
  const whole = new TextDecoder().decode(bytes)
  const from = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0
  const take = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 4000
  const slice = whole.slice(from, from + take)
  const left = whole.length - (from + slice.length)
  const note = left > 0 ? `\n--- ${left} characters remain; ask again with "offset": ${from + slice.length} ---` : ''
  return { ok: true, output: slice + note }
}

/** The descriptors, so a model that may read artifacts is TOLD how. */
export const ARTIFACT_TOOLS = [
  tool({
    name: 'read_result',
    description: 'read part of a result that was too long to be quoted in full',
    args: [
      arg('handle', 'string', 'the handle the receipt named'),
      arg('offset', 'number', 'how many characters in to start', { required: false }),
      arg('limit', 'number', 'how many characters to read', { required: false }),
    ],
    needs: 'blob',
  }),
]
