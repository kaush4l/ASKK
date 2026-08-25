/**
 * THE LOOP CHOOSES ITSELF — one cheap call that decides how much turn this
 * message deserves.
 *
 * `stages:` used to be a fixed list every turn walked in full, so `[plan, work,
 * verify]` paid for a brief and a check to answer "hello" and `[work]` had no
 * plan for a project. Neither is a property of the AGENT; both are properties
 * of the MESSAGE, and the only thing that has read the message by then is the
 * model. So the first stage asks it, and the list it names REPLACES the
 * declared one for the rest of the turn.
 *
 * WHAT DISTINGUISHES THE THREE ROUTES IS NOT WRITTEN HERE. It is in
 * `public/stages/strategy.md`, the file a person edits to tune routing without
 * a rebuild; restating it here would be the second copy that drifts. [`STAGES_OF`]
 * says what each route COSTS, which is this file's half of the answer.
 *
 * IT FAILS TOWARDS THE MIDDLE. An unreadable vote, a missing line, a model that
 * answered the question instead of voting — all become `react`, the one route
 * that can still reach either outcome. Failing to `answer` would strand a
 * request that needed a tool; failing to `project` would bill four calls for a
 * greeting.
 * @module
 */

/** @typedef {import('@harness/kernel').Fact} Fact */
/** @typedef {import('@harness/kernel').StageId} StageId */

/**
 * WORK WITH THE TOOLS TAKEN AWAY, which is what the `answer` route is. It is
 * not a name an agent file may declare — `frontmatter.js` refuses it, because
 * the vote is the only thing that knows a turn needs no tool — and it is not in
 * `kernel`'s `StageId` for the same reason. A stage name the machine mints.
 * @typedef {StageId | 'answer'} StageName
 */
export const ANSWER = 'answer'

/** The stage that votes. Named because two files read the cursor for it — `walk.js` to know the reply rewrites the list, and `stages.js` to refuse it a tool — and a stage name spelled twice is a stage name that will differ once. */
export const STRATEGY = 'strategy'

/** @typedef {'answer' | 'react' | 'project'} Route */

/** @type {readonly Route[]} */
export const ROUTES = /** @type {const} */ (['answer', 'react', 'project'])

/**
 * The stages each route walks. `work` is in all three — it is the turn that
 * talks to the person — and what changes around it is the route.
 * @type {Record<Route, readonly StageName[]>}
 */
export const STAGES_OF = Object.freeze({
  answer: [ANSWER],
  react: /** @type {StageId[]} */ (['work']),
  project: /** @type {StageId[]} */ (['plan', 'work', 'verify', 'critique']),
})

/** The label the vote is written under, and the one its reason is. Both are read through one function, so a model that decorates one label does not lose the other. */
export const ROUTE = 'ROUTE'
export const WHY = 'WHY'

/**
 * The reply shape the strategy stage demands — THE SHAPE, AND NOT THE CRITERIA.
 * The criteria are in the brief; a stage cannot be entered unbriefed, so this
 * never renders alone.
 *
 * WHY IT ALSO ASKS FOR `WHY`. A single-token reply from a small model is a
 * guess as often as a decision; one clause of justification is the cheapest
 * form of "think before answering" and costs about six tokens. It is also what
 * makes a wrong route debuggable — the vote says the machine chose, the line
 * says what it chose on.
 * @type {{about: string, fields: Array<{name: string, about: string}>}}
 */
export const STRATEGY_SCHEMA = Object.freeze({
  about: 'Decide how much work this message needs before anything is done about it. '
    + 'The routes, and how to choose between them, are in the directive block above.',
  fields: [
    { name: ROUTE, about: 'one word — answer, react, or project' },
    { name: WHY, about: 'one short clause saying what decided it' },
  ],
})

/** The vote, or '' when the reply did not contain one. The '' is the point: `routeOf` turns it into `react`, and a fallback indistinguishable from a vote FOR react made this stage's one decision unauditable. @param {string} reply @returns {Route | ''} */
export function voteIn(reply) {
  const word = (labelled(reply, ROUTE) ?? '').toLowerCase()
  return (/** @type {readonly string[]} */ (ROUTES)).includes(word) ? /** @type {Route} */ (word) : ''
}

/** The vote, failing towards the middle route for this module's reason. @param {string} reply @returns {Route} */
export function routeOf(reply) {
  return voteIn(reply) || 'react'
}

/**
 * WHAT THE VOTE COST AND WHAT IT DECIDED, as a fact. The strategy stage spends
 * a call on a decision the person otherwise never sees, and a turn that
 * silently became four calls instead of one is the sort of thing a bill
 * explains and nothing else does.
 *
 * `how` is why this is not two payloads: `react` is reached two ways — the
 * model asked for it, or nothing readable was written — and emitting those
 * identically made a run that routed everything to react because the model
 * started bolding its labels look exactly like a run whose messages all wanted
 * react.
 * @param {string} reply @returns {Fact}
 */
export function routeChosen(reply) {
  const voted = voteIn(reply)
  return {
    type: 'custom',
    kind: 'core.route_chosen',
    payload: { route: voted || 'react', why: labelled(reply, WHY) ?? '', how: voted ? 'voted' : 'fallback' },
  }
}

/**
 * The value written on the line labelled `label`, or null if no line is.
 *
 * THE LABEL IS CLEANED EXACTLY AS THE VALUE IS, which is the whole of this
 * function: a small model writes the two named lines as markdown about as often
 * as it writes them bare, and `**ROUTE:** project` was unreadable while only
 * the value was being trimmed. The label still has to OPEN its line — finding
 * it anywhere would make a sentence ABOUT routing into a vote, and the model is
 * asked to explain itself on the line below.
 * @param {string} reply @param {string} label @returns {string | null}
 */
export function labelled(reply, label) {
  for (const line of reply.split('\n')) {
    const bare = unmarked(line)
    const at = bare.indexOf(':')
    if (at < 0) continue
    if (plain(bare.slice(0, at)).toLowerCase() === label.toLowerCase()) return plain(bare.slice(at + 1))
  }
  return null
}

/**
 * A line with every MARKDOWN BLOCK PREFIX taken off it, so what remains either
 * opens with the label or is not a vote.
 *
 * THE GRAMMAR IS STATED AND CLOSED: the prefixes CommonMark defines and no
 * others — a bullet, an ordered marker, an ATX heading, a blockquote, and the
 * indentation `trim` already ate. They NEST, so they come off in written order.
 * The closed set is the whole point: a list that grows one character per
 * surprise never finishes, because the failure is SILENT — an unreadable vote
 * is a `react` indistinguishable from a vote for one.
 * @param {string} line @returns {string}
 */
function unmarked(line) {
  let rest = line.trim()
  for (;;) {
    const at = rest.search(/\s/)
    if (at < 0 || !isMarker(rest.slice(0, at))) return rest
    rest = rest.slice(at).trimStart()
  }
}

/** One markdown block prefix. A marker is only a marker when whitespace follows, which is what stops `**ROUTE**` being a bullet and `#tag` a heading. @param {string} head @returns {boolean} */
function isMarker(head) {
  return ['-', '*', '+', '>'].includes(head) || /^\d+[.)]$/.test(head) || /^#{1,6}$/.test(head)
}

/** Whitespace and the INLINE decoration a model puts round a field: emphasis, code spans, quotes, and the full stop it ends a sentence with. @param {string} text @returns {string} */
function plain(text) {
  return text.replace(/^[\s*`_"'.]+/, '').replace(/[\s*`_"'.]+$/, '')
}
