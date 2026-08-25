/**
 * A CHECKED EDIT — `edit_file`, and the one rule that makes it safe to give a
 * model at all: the text it says it is replacing must be in the file EXACTLY
 * ONCE, or nothing is written and the refusal says what was actually there.
 *
 * WHY IT EXISTS. `write_file` REPLACES, so an agent altering one line of a
 * 900-line file has to reproduce the other 899 out of its own context, and a
 * model that misremembers one of them destroys work nothing can get back.
 *
 * WHY IT REFUSES RATHER THAN REWRITES. A silently clamped edit lands somewhere
 * the agent did not mean and it has no way to find out, while a refusal that
 * quotes the mismatch back is the thing that lets it correct itself. Two
 * occurrences is not a tie to break — it is the model not having said which one.
 *
 * THE READ-MODIFY-WRITE IS NOT A RACE HERE, and for a different reason than in
 * the Rust: that build serialised every command through one shell, and this one
 * has no shell at all — OPFS `read` and `write` are two calls on one port with
 * only this page's own driver between them, and the driver runs one tool at a
 * time. Written down because the day a second thread writes this workspace it
 * stops being true, and nothing else would say so.
 * @module
 */

/** The call this tool wants, in its own vocabulary — every refusal ends in the line the model should have written. */
const SHAPE = 'Call it as edit_file({"path": "notes/today.md", "find": "the exact text to replace", "replace": "the new text"}).'

/**
 * `text` with the one occurrence of `find` replaced — or the CLAUSE that says
 * why not, worded here beside the count that produced it so a refusal can state
 * the true number rather than "not found or ambiguous". Pure, so the rule is
 * testable without a workspace (I3).
 * @param {string} text @param {string} find @param {string} replace
 * @returns {{after: string}|{why: string}}
 */
export function replaced(text, find, replace) {
  if (find === '') return { why: "'find' was empty, and an empty string is in every file" }
  const at = text.indexOf(find)
  if (at < 0) return { why: 'that text is not there' }
  if (text.indexOf(find, at + find.length) < 0) {
    return { after: text.slice(0, at) + replace + text.slice(at + find.length) }
  }
  return { why: `that text is there ${count(text, find)} times, so it does not name one place — include more of the surrounding lines until it does` }
}

/** How many times, counted only once a second occurrence is known to exist. @param {string} text @param {string} find */
function count(text, find) {
  let n = 0
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + find.length)) n += 1
  return n
}

/** Which line the occurrence starts on, counting from one — the number a model can act on, and the only part of a successful edit worth saying. @param {string} text @param {string} find */
export function lineOf(text, find) {
  const at = text.indexOf(find)
  return at < 0 ? 1 : text.slice(0, at).split('\n').length
}

/**
 * THE REFUSAL, AND IT ALWAYS ENDS THE SAME WAY: the file is unchanged. That
 * sentence is the whole reason this tool can be granted — a model unsure
 * whether its edit landed will write the file wholesale to be sure, which is
 * the destruction this tool replaces.
 * @param {string} path @param {string} find @param {string} why
 */
export function refusal(path, find, why) {
  return `nothing was edited and ${path} is unchanged: ${why}. You asked to replace:\n${quoted(find)}\n${SHAPE}`
}

/** What was searched for, quoted back and BOUNDED. The mismatch is the whole value of the refusal, but a `find` the size of a file would spend the window twice over. @param {string} find */
function quoted(find) {
  if (find.length <= 400) return `---\n${find}\n---`
  return `---\n${find.slice(0, 400)}\n--- (the first 400 characters of what you sent)`
}

/**
 * Run one edit against the workspace, or refuse it in the model's own words.
 *
 * A TRUNCATED READ IS A REFUSAL AND NOT AN EDIT. The port may hand back part of
 * a large file; writing the result of editing that part would delete everything
 * past the cut, which is exactly the destruction this tool exists to prevent —
 * a case the Rust never had, because its port read whole files.
 * @param {import('@harness/kernel').Ports['workspace']} workspace
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ok: boolean, output: string}>}
 */
export async function runEdit(workspace, args) {
  const path = String(args.path ?? '')
  if (path === '') return { ok: false, output: `edit_file needs a path. ${SHAPE}` }
  // `find` and `replace` are TEXT and not names: the whitespace in them is the
  // argument, so neither is trimmed.
  const find = typeof args.find === 'string' ? args.find : ''
  const replace = typeof args.replace === 'string' ? args.replace : ''
  const before = await workspace.read(path)
  if (before.truncated) {
    return { ok: false, output: `nothing was edited and ${path} is unchanged: it is too large to read whole here, and editing a part of it would delete the rest.` }
  }
  const tried = replaced(before.text, find, replace)
  if ('why' in tried) return { ok: false, output: refusal(path, find, tried.why) }
  await workspace.write(path, tried.after)
  return { ok: true, output: `edited ${path}: replaced one occurrence, at line ${lineOf(before.text, find)}.` }
}
