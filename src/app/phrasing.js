/**
 * Machine facts, in the words a person would use.
 *
 * Everything here is presentation and nothing here is a parser. That
 * distinction is load-bearing: `core/tools/Toolbox.js` is the one thing in this
 * application that decides what a call IS, and `core/response/` is the one
 * thing that decides what a reply MEANS. A second decider in the page would
 * agree with them until the day it did not, and on that day the page would draw
 * a call that never ran.
 *
 * So these functions are allowed to read a tool's NAME and to find where a
 * field begins. They are not allowed to interpret an argument, decide whether a
 * call is well-formed, or change what is shown based on what they think a call
 * would do.
 *
 * There is no i18n here and no plan for one. These are English sentences
 * written by whoever wrote the feature, which is the same discipline every note
 * in `src/backend/` follows.
 */

/**
 * What each tool is doing, as a verb phrase.
 *
 * Keyed by the tool's name and by nothing else. An unknown tool — an MCP server
 * offers whatever it offers, and an agent file may name a peer that did not
 * exist when this was written — gets its own name back inside a neutral frame,
 * which is honest rather than wrong. That is why there is no default like
 * "did something": a reader who sees the real name can go and look it up.
 */
const VERBS = {
  shell: 'Ran a command on the Linux machine in this tab',
  search: 'Searched the web',
  fetch: 'Read a page',
  read_file: 'Read a file',
  write_file: 'Wrote a file',
  check_task: 'Read back work it had handed over',
}

/**
 * The tool a call names, taken from the text before its first bracket.
 *
 * Deliberately crude. `Toolbox.parse` owns the real grammar; all this needs is
 * the leading identifier, and anything that is not one is reported as no tool
 * at all rather than guessed at.
 */
export function toolOf(call) {
  const found = /^\s*([A-Za-z_][\w-]*)\s*\(/.exec(String(call ?? ''))
  return found ? found[1] : ''
}

/**
 * One line saying what this step did.
 *
 * A sub-agent is any tool that is not one of the built-ins: an agent file's
 * `tools:` list names peers by their own names, so `researcher(...)` is a call
 * to another agent and reads as one.
 */
export function verbFor(call) {
  const tool = toolOf(call)
  if (!tool) return 'Worked on it'
  if (VERBS[tool]) return VERBS[tool]
  return `Asked ${tool}`
}

/**
 * What a tool is doing, as a present participle, for a line about a sub-agent.
 *
 * The same names as `VERBS` and a different tense, because the sentence is a
 * different one: `VERBS` finishes a step that has happened, this reports one
 * that is still going. The fallback is the tool's own name for the same reason
 * — an agent may call a peer or a connected program that did not exist when
 * this was written.
 */
const DOING = {
  shell: 'running a command',
  search: 'searching the web',
  fetch: 'reading a page',
  read_file: 'reading a file',
  write_file: 'writing a file',
  check_task: 'reading back an answer',
}

/** How a sub-agent's current work reads in a sentence about it. */
export function doingWord(tools = []) {
  const first = (Array.isArray(tools) ? tools : [tools]).filter(Boolean)[0]
  if (!first) return 'thinking'
  return DOING[first] ?? `using ${first}`
}

/** The four field names of the ReAct contract, in the order they are written. */
const FIELDS = ['think', 'plan', 'act', 'result']
const FIELD_LINE = new RegExp(`(?:^|\\n)\\s*(${FIELDS.join('|')})\\s*:`, 'i')

/**
 * What a reader should SEE of a reply that is still arriving.
 *
 * The measured defect this exists for: a person who asked "what is 17 times 4"
 * watched `think: [answerable now]`, `plan: []` and `act: answer` stream into
 * the transcript for the whole time they were paying most attention, and then
 * watched all three vanish. Showing an application's own serialisation format
 * to the person waiting on an answer does not reduce their uncertainty about
 * what is happening; it is the reason they cannot tell a working app from a
 * broken one.
 *
 * This is NOT the parser. It answers one question — where does the answer
 * begin — and it answers "nowhere yet" whenever it cannot tell. A reply that
 * carries no field line at all is prose from an agent whose contract is the
 * plain one, and it is shown whole: hiding it would be this function deciding
 * that a reply is malformed, which is exactly the decision it may not make.
 *
 * @returns {{thinking: string, answer: string, waiting: boolean}}
 */
export function visibleStream(raw) {
  const text = String(raw ?? '')
  if (!text) return { thinking: '', answer: '', waiting: false }
  // No field anywhere: this agent is not writing the ReAct contract, so every
  // character of it is the reply.
  if (!FIELD_LINE.test(text)) return { thinking: '', answer: text, waiting: false }

  const think = section(text, 'think')
  const result = section(text, 'result')
  return {
    // The scratchpad the contract asks for, which is worth showing while a
    // reply is being written and is not the reply. Brackets are how the
    // contract writes it and not something a reader needs.
    thinking: think.replace(/^\[|\]$/g, '').trim(),
    answer: result,
    // Everything before `result:` has arrived and the answer has not. The
    // caller draws its own waiting state; what must not happen is the
    // scaffolding standing in for one.
    waiting: !result,
  }
}

/**
 * The text of one field, from its colon to the next field or the end.
 *
 * The lookahead is what makes this safe on a partial stream: a `result:` that
 * has arrived with nothing after it yet returns the empty string, and the
 * caller reads that as "not here yet" rather than as an empty answer.
 */
function section(text, field) {
  const start = new RegExp(`(?:^|\\n)\\s*${field}\\s*:`, 'i').exec(text)
  if (!start) return ''
  const from = start.index + start[0].length
  const rest = text.slice(from)
  const next = new RegExp(`(?:^|\\n)\\s*(?:${FIELDS.join('|')})\\s*:`, 'i').exec(rest)
  return (next ? rest.slice(0, next.index) : rest).trim()
}

/**
 * A duration, in the two units a person actually asks in.
 *
 * "Is it moving" is the question, and `4m 07s` past a minute with `47s` under
 * one says that more plainly than one padded format does for both.
 */
export function duration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

/** A byte count at the scale it is worth reading. */
export function bytes(n) {
  const value = Number(n)
  if (!Number.isFinite(value) || value <= 0) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The ONE line at the top of the screen.
 *
 * One, chosen by urgency, and this is the whole argument for the function
 * existing. The rail it replaces rendered up to nine chips at once — an agent
 * name, a model name, a schedule count, a delegate, a thread count, a clock —
 * and a reader could not tell which of them was the thing they were waiting
 * for. Everything not chosen here is in the drawer, which is where facts live.
 *
 * The order is what a person is most likely to be waiting on, and the last
 * entry is deliberately not a fact about the app at all: when nothing is
 * happening, the line says who is listening, because that is the only fact on
 * this list that changes what the next thing they type will do.
 */
export function statusLine({
  ready = false,
  busy = false,
  stopping = false,
  elapsed = 0,
  listening = false,
  speaking = false,
  download = null,
  delegates = [],
  tasks = [],
  agent = '',
} = {}) {
  if (!ready) return { text: 'starting', live: true }
  if (download?.percent > 0 && download.percent < 100)
    return { text: `${download.file || 'a model'} ${download.percent}%`, live: true }
  if (stopping) return { text: 'stopping', live: true }
  if (listening) return { text: 'listening', live: true }
  const working = delegates.find((one) => one && !one.answered)
  // Named, and saying what it is doing. The rail this replaces said
  // `researcher: fetch (3)` — a name, a function and a number, which is three
  // pieces of machine vocabulary for one fact a person can read in five words.
  if (working) return { text: `${working.agent} is ${doingWord(working.doing)}`, live: true }
  if (busy) return { text: `working · ${duration(elapsed * 1000)}`, live: true }
  const handed = tasks.find((one) => one?.state === 'running')
  if (handed) return { text: `${handed.agent} is working in the background`, live: true }
  const answered = tasks.find((one) => one?.state !== 'running' && !one?.read)
  if (answered)
    return {
      text:
        answered.state === 'failed'
          ? `${answered.agent} could not finish`
          : `${answered.agent} has an answer for you`,
      live: true,
    }
  if (speaking) return { text: 'reading it aloud', live: true }
  return { text: agent ? `talking to ${agent}` : 'ready', live: false }
}
