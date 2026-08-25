/**
 * FINDING A FILE IN THE WORKSPACE — `find_files`, and the search that had to be
 * rebuilt rather than translated.
 *
 * THE SHELL SCRIPT DID NOT SURVIVE. The Rust ran one line — `find . -name … -exec
 * grep -IHns -m1 …` — and every subtlety in it was a subtlety about shells: the
 * `-exec … +` was there because a pipe into xargs splits a file name with a
 * space in it, and the quoting was there because a model's search string reaches
 * a command line. There is no shell here (`opfs.js` refuses `exec` by name), so
 * the walk below is the search, and none of that applies. What DOES survive is
 * the output contract, because it is about the model reading the result: a
 * search that found nothing SAYS what it looked for, matches are capped, and a
 * long line is clipped rather than spent.
 * @module
 */

/** How many matches a result may carry. Past this the answer is "narrow the search", because sixty paths is already more than a model will read. */
const CAP = 60

/** How much of one matching line survives. A minified file is one line and would otherwise be the whole result. */
const LINE = 160

/** How deep the walk goes. A workspace is a person's project, not a filesystem; a cycle is impossible in OPFS but a runaway depth still costs a browser. */
const DEPTH = 12

/** Our own records are pruned: a search for `*` that answers with a hundred process log lines has answered the wrong question. */
const OURS = '.harness'

/**
 * WHAT THE SEARCH LOOKED FOR, in its own words — used whether or not it found
 * anything, because "no matches" over an unstated query is a result nobody can
 * act on.
 * @param {string} name @param {string} text
 */
export function asked(name, text) {
  if (name !== '' && text !== '') return `files named ${name} with a line containing '${text}'`
  if (name !== '') return `files named ${name}`
  return `files with a line containing '${text}'`
}

/**
 * A glob as the model writes one — `*`, `*.md`, `notes*` — against ONE path
 * segment. Only `*` is honoured: a model that writes `?` or a character class
 * is writing a shell's language at a tool that never had one, and matching it
 * loosely would be this build guessing.
 * @param {string} pattern @param {string} name
 */
export function matches(pattern, name) {
  const parts = pattern.split('*')
  if (parts.length === 1) return name === pattern
  if (!name.startsWith(parts[0] ?? '')) return false
  const last = parts[parts.length - 1] ?? ''
  if (!name.endsWith(last) || name.length < (parts[0] ?? '').length + last.length) return false
  let at = (parts[0] ?? '').length
  for (const middle of parts.slice(1, -1)) {
    const found = name.indexOf(middle, at)
    if (found < 0) return false
    at = found + middle.length
  }
  return true
}

/**
 * Every file under `at` whose name matches, depth first, bounded.
 * @param {import('@harness/kernel').Ports['workspace']} workspace
 * @param {string} at @param {string} pattern @param {number} depth
 * @returns {Promise<string[]>}
 */
async function walk(workspace, at, pattern, depth) {
  if (depth > DEPTH) return []
  /** @type {string[]} */
  const found = []
  for (const entry of await workspace.list(at)) {
    if (entry.name === OURS) continue
    const path = at === '.' ? entry.name : `${at}/${entry.name}`
    if (entry.dir) found.push(...await walk(workspace, path, pattern, depth + 1))
    else if (matches(pattern, entry.name)) found.push(path)
    if (found.length >= CAP) break
  }
  return found
}

/**
 * The first line of `path` containing `text`, as `path:line:content`, or null.
 * A file the port will not read is SKIPPED rather than reported: it was not
 * asked about, and a search that answers with read errors buries its own hits.
 * @param {import('@harness/kernel').Ports['workspace']} workspace
 * @param {string} path @param {string} text
 */
async function hit(workspace, path, text) {
  /** @type {string} */
  let body
  try {
    body = (await workspace.read(path)).text
  } catch {
    return null
  }
  const lines = body.split('\n')
  const at = lines.findIndex((line) => line.includes(text))
  return at < 0 ? null : clipped(`${path}:${at + 1}:${(lines[at] ?? '').trim()}`)
}

/** @param {string} line */
function clipped(line) {
  return line.length <= LINE ? line : `${line.slice(0, LINE)}…`
}

/**
 * Run one search. An empty `name` means every file — a content search still has
 * to name something, and both empty is a question with no subject.
 * @param {import('@harness/kernel').Ports['workspace']} workspace
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ok: boolean, output: string}>}
 */
export async function runFind(workspace, args) {
  const name = String(args.name ?? '').trim()
  const text = String(args.text ?? '')
  if (name === '' && text === '') {
    return { ok: false, output: 'find_files needs a name or some text. Call it as find_files({"name": "*.md"}) or find_files({"text": "TODO"}).' }
  }
  const paths = await walk(workspace, String(args.path ?? '.') || '.', name === '' ? '*' : name, 0)
  const hits = text === ''
    ? paths.map(clipped)
    : (await Promise.all(paths.map((path) => hit(workspace, path, text)))).filter((one) => one !== null)
  const question = asked(name, text)
  if (hits.length === 0) return { ok: true, output: `Nothing in this folder matches: ${question}.` }
  const capped = hits.length >= CAP ? ` (capped at ${CAP} — narrow the search)` : ''
  return { ok: true, output: `${hits.length} match(es) for ${question}${capped}:\n${hits.join('\n')}` }
}
