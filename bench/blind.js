#!/usr/bin/env bun
/**
 * Build the directory a panel is handed, and be the gate that says whether it
 * is blind.
 *
 *   bun blind.js                     all tasks, run 1 of each scaffold
 *   bun blind.js --index 2           run 2, with its own A/B map
 *   bun blind.js --transcripts D --out P --key K
 *
 * `P` is the panel directory: `<task>/A.md`, `<task>/B.md`, and one
 * `outcomes.json` keyed by task and letter. NOTHING ELSE GOES IN IT, and the
 * panel is handed `P` and not its parent. The key goes to `K`, which defaults
 * to `P-key.json` — one directory up, so that copying `P` cannot carry it.
 * The last panel was unblinded twice over: the key sat beside the set inside
 * the run directory that was handed over whole, and the lead's own prompt
 * carried the map. Neither is something this file can stop; what it can do is
 * emit a directory that is complete on its own, so there is no reason to hand
 * over anything wider.
 *
 * ── the projection ─────────────────────────────────────────────────────────
 *
 * P4, decided by the lead after two panels were spent on sets this gate
 * refused: TOOL IDENTIFIERS AND REPLY GRAMMAR GET A COMMON RENDERING HERE.
 * Nothing in `src/` or in either scaffold is renamed. The ledger's standing
 * argument — that renaming a tool puts the lie in the artifact — is about the
 * artifact, and this projection is not the artifact. A judge scores what the
 * loop DID with its tools, not what the tools were called.
 *
 * What a judge sees, per file:
 *
 *   the task
 *   per turn        reasoning / call / result — the four things both reply
 *                   formats carry, read off the recorded action rather than the
 *                   reply text. `thoughts` + `headline` and `think` + `plan`
 *                   are both "reasoning:"; a JSON envelope and a call line are
 *                   both "call: <slot>" with its arguments beneath it; the
 *                   observation is "result:". The reply as the model wrote it
 *                   is NOT rendered: its grammar separated 5 of 5 pairs on
 *                   sight, and the grammar is in the prompt below for a judge
 *                   who wants to score it.
 *   tool names      per-arm slots, `tool_1`, `tool_2`, …, assigned in order of
 *                   first use across the arm's whole set so the same tool has
 *                   the same slot in every file of that arm. A judge can follow
 *                   a tool across turns without learning its name. `slotsFor`.
 *   every ending    one vocabulary, `ENDINGS`: answered, ran out of tokens in
 *                   its scratchpad, cut mid-reply, refused, stopped at a
 *                   ceiling, the endpoint failed. The transport's own refusal
 *                   text signs itself and names its levers; the state is what
 *                   happened and the state is what is rendered.
 *   the prompt      P5 — the assembled request for turn 1, once, under its own
 *                   heading after the turns, with the same slots and the same
 *                   scrub; then the lines the turn-2 request added, so how an
 *                   observation re-enters the context can be seen once per
 *                   file. Criterion 1 is about prompt composition and zero of
 *                   eight judges across two panels could score it on a
 *                   projection that dropped the prompt. Its PROSE identifies
 *                   its author to anyone who has read that author, and that is
 *                   residue honest stripping cannot remove: it is declared, in
 *                   the disclosure and in the inventory this script prints,
 *                   rather than hidden.
 *
 * DROPPED — the private reasoning channel (`reasoning_content`). No harness
 * ever reads it; it is where the model rehearses its output format verbatim
 * (`think: [...] plan: [...] act: tool` on one side, `"tool_name"` on the
 * other), and it is where one run read its own workspace path back seven
 * times. The reasoning a judge sees is the reasoning the harness asked for and
 * received.
 *
 * DROPPED — the header: the arm's label, the verdict, the check list, the
 * departures. The check travels separately as `outcomes.json`, by letter,
 * because a judge scoring grounding needs to know whether the thing the run
 * said it did was done.
 *
 * SCRUBBED — filesystem paths, the two project names, the user's name, the
 * rig's own vocabulary, the arms' own directory names. Paths are rewritten
 * WHOLE and FIRST, and every path goes to the SAME word: an earlier version sent
 * temp paths to `/workspace` and home paths to `/project`, and `/workspace` then
 * sat in one arm's file and no other.
 *
 * ── the gate ───────────────────────────────────────────────────────────────
 *
 * Exit 1 on any of:
 *
 *   1. a `BANNED` term surviving anywhere in an emitted file;
 *   2. an arm's own directory name surviving as a word;
 *   3. a tool name of either arm surviving anywhere in an emitted file — the
 *      whole of P4 rests on the mapping being total, and `findTools` scans the
 *      emitted bytes with the mapper's own boundary rule so a name the mapper
 *      missed is a name the verifier finds;
 *   4. a string this file WROTE (`REPLACEMENTS`) sorting the TURNS of more
 *      pairs one way than the other, unless both arms were handed it in that
 *      pair's prompts. A replacement reaches only the files whose identifying
 *      token it replaced, so a token that named an arm becomes a replacement
 *      that names it.
 *
 * S60: the old `separation` dropped any term present in both arms anywhere in
 * the set, so a block present in 11 of one arm's runs and 4 of the other's was
 * invisible to it while `grep -l` sorted three pairs by it. A separator is
 * anything a grep can sort pairs by. The unit is now the PAIR: a term sorts a
 * pair when it is in exactly one arm's turns, and it is reported with how many
 * pairs it sorts each way.
 *
 * Reported and NOT fatal — because they are what happened rather than who:
 *
 *   slots     `tool_4` in an arm that used four tools and not in an arm that
 *             used two. The number of tools is the design under judgment.
 *   endings   a run that ran out of tokens in its scratchpad did; the other
 *             arm's did not. That is the finding, not a leak.
 *   residue   every token that sorts three or more pairs one way, counted from
 *             the emitted files themselves — the fresh grep — and filed by
 *             where it SORTS: what the prompt sorts is a count, what the turns
 *             sort is listed by name, argument names and observation frames
 *             included, because they are the design under judgment rendered
 *             as recorded and a reader of a verdict needs to know they were
 *             sortable.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { Toolbox } from '../src/core/tools/Toolbox.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Where to read from and write to, READ INSIDE `main` AND NOT AT IMPORT TIME —
 * `test/bench/blind.test.js` imports this file, and a module that reads the
 * process's arguments as a side effect of being loaded breaks whatever imports
 * it. `strict` matters: `--idnex 2` used to blind run 1 and say nothing.
 */
function options() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      index: { type: 'string', default: '1' },
      transcripts: { type: 'string' },
      out: { type: 'string' },
      key: { type: 'string' },
    },
  })
  const out = resolve(values.out ?? join(HERE, 'blind'))
  return {
    index: values.index,
    transcripts: resolve(values.transcripts ?? join(HERE, 'transcripts')),
    out,
    key: resolve(values.key ?? `${out}-key.json`),
  }
}

/** The one word every filesystem path becomes. */
const PATH = '/project'

/**
 * Every identifying string that CAN be removed, and the neutral text that
 * replaces it. Order matters: paths first and whole, then names.
 */
const SCRUBS = [
  [/\/private\/tmp\/[^\s"'`)\],;\\]+/g, PATH],
  // A path ending a sentence keeps its full stop: "The workspace is /project."
  [/\/Users\/[^\s"'`)\],;\\]+/g, (path) => (path.endsWith('.') ? `${PATH}.` : PATH)],
  [/-Users-[A-Za-z0-9-]+/g, '-project'],
  // A bare `Downloads/Dev/ASKK` with no `/Users/…` for the rule above to eat —
  // a git remote line, `find` output, an error message.
  [/\bDownloads\/Dev(\/[A-Za-z0-9_.-]+)?/g, 'project'],
  // The run directory as a bare relative path: `bench/work/<task>/<harness>/<n>`
  // in the recorded sets, `bench/work/<n>` from now on (`run.js` `workspaceName`).
  [/\bbench\/work(\/[A-Za-z0-9_./-]*)?/g, PATH],
  [/agent[-\s_]?zero/gi, 'the agent'],
  [/frdel/gi, 'upstream'],
  [/\bASKK\b/gi, 'the project'],
  [/\bkaush\b/gi, 'user'],
  [/\/a0\b/g, '/app'],
  [/\bscaffolds?\b/gi, 'harness'],
  // The tree's transport signs every refusal it writes with its class label.
  // The refusal text is no longer rendered — `ENDINGS` is — but a model can
  // quote an observation, so the rule stays and the term stays banned.
  [/\bopenai-compatible\b/gi, 'the transport'],
]

/**
 * The arms' own names, DERIVED FROM THE RUN rather than typed here: the
 * directory names under `transcripts/<task>/`, so a third scaffold is covered
 * the day it is added. An English "ours" in a model's sentence becomes "this
 * harness"; a mangled pronoun is a better trade than an arm's name.
 */
const ARM_REPLACEMENT = 'this harness'

export function armRules(ids) {
  return ids.map((id) => [new RegExp(`\\b${literal(id)}\\b`, 'gi'), ARM_REPLACEMENT])
}

/**
 * `<task>/<arm>/<n>` as a bare fragment — what a model reads back off its own
 * cwd — goes to the path word BEFORE the arm rule can turn it into
 * `<task>/this harness/<n>`, which reached one arm's file and no other.
 */
function fragmentRules(armIds, tasks) {
  if (!armIds.length || !tasks.length) return []
  const arm = armIds.map(literal).join('|')
  const task = tasks.map(literal).join('|')
  return [[new RegExp(`\\b(?:${task})\\/(?:${arm})\\/\\d+\\b`, 'g'), PATH]]
}

const literal = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Every string this file writes into the artifact, deduplicated. */
export const REPLACEMENTS = [
  ...new Set([
    ...SCRUBS.map(([, replacement]) => (typeof replacement === 'string' ? replacement : PATH)),
    ARM_REPLACEMENT,
  ]),
]

/** Paths whole, THEN every name-level rule, THEN the arms' own names. */
export function scrub(text, armIds = [], { tasks = [] } = {}) {
  let out = text
  for (const [pattern, replacement] of SCRUBS) out = out.replace(pattern, replacement)
  for (const [pattern, replacement] of fragmentRules(armIds, tasks)) {
    out = out.replace(pattern, replacement)
  }
  for (const [pattern, replacement] of armRules(armIds)) out = out.replace(pattern, replacement)
  return out
}

/** Terms that must not survive. One hit fails the run. */
export const BANNED = [
  'agent-zero',
  'agent zero',
  'agentzero',
  'Agent Zero',
  'frdel',
  'ASKK',
  'askk',
  'kaush',
  '/a0',
  'scaffold',
  'Downloads/Dev',
  'bench/work',
  'openai-compatible',
]

/**
 * How a run can end, in the words a judge reads — and one mid-run note, `cut`:
 * a reply the token ceiling cut is read on and the run goes on, so `endingOf`
 * never returns it and `outcomes.json` never carries it. ONE list: `renderTurns`
 * writes from it, `outcomeOf` records from it, and the inventory classifies a
 * term as an ending by membership in it. `test/bench/blind.test.js` derives
 * every word here from a stop the driver records or the note the renderer
 * writes, so a word nothing emits cannot sit in this list.
 */
export const ENDINGS = Object.freeze({
  answered: 'answered',
  scratchpad: 'ran out of tokens in its scratchpad',
  cut: 'cut mid-reply',
  refused: 'refused',
  ceiling: 'stopped at a ceiling',
  endpoint: 'the endpoint failed',
})

/**
 * The transport's state on a refused reply, in `ENDINGS`. `thinking` and
 * `spent` are the same accident from the loop's side — the tokens went on the
 * scratchpad and nothing reached the harness — and `OpenAICompatible._state`'s
 * own comment says the two differ only in where the scratchpad landed.
 */
function refusalEnding(state) {
  return state === 'thinking' || state === 'spent' ? ENDINGS.scratchpad : ENDINGS.refused
}

export function endingOf(run) {
  if (run.stop === 'answered') return ENDINGS.answered
  if (run.stop === 'transport-refused') {
    const refusal = run.events.find((event) => event.type === 'transport-refusal')
    return refusalEnding(refusal?.state)
  }
  if (run.stop === 'scaffold-stop' || run.stop === 'cap') return ENDINGS.ceiling
  if (run.stop === 'endpoint-error') return ENDINGS.endpoint
  return ENDINGS.refused
}

/**
 * The rubric this projection is built for. Nothing is withheld any more: the
 * prompt is rendered, so criterion 1 is scorable, and `DISCLOSURE` derives its
 * two counts from here rather than spelling them out.
 */
export const RUBRIC = {
  source: 'docs/REFERENCE-PROMPTS.md',
  section: 'The blind comparison rubric',
  criteria: 8,
  disqualifying: [4, 8],
  withheld: [],
}

const scored = RUBRIC.criteria - RUBRIC.withheld.length
const summed = scored - RUBRIC.disqualifying.length

/**
 * What every judge is told, in the file they are handed. It is byte identical
 * in every file, names no tool, no arm and no project, and
 * `test/bench/blind.test.js` asserts all three against the recorded arms.
 */
export const DISCLOSURE = [
  '> **Before you score.** These two transcripts are one task, run by two',
  '> different agent harnesses. Which letter is which is randomised per task and',
  '> per run, and is not recorded here.',
  '>',
  '> **What you are reading is one projection of both.** Each harness names its',
  '> own tools; here every tool is a slot — `tool_1`, `tool_2`, … — numbered in',
  '> the order that harness first used it, the same slot for the same tool in',
  '> every file of one harness. Each harness has its own reply format; here',
  '> every turn is rendered in one grammar — reasoning, call, result — read off',
  '> what the harness parsed, not off the reply as written. Every ending is in',
  '> one vocabulary. The model’s private reasoning channel, which no harness',
  '> reads, is left out.',
  '>',
  '> **The prompt is rendered after the turns**, once, as assembled for the',
  '> first turn, with the same slots applied — and then the lines the second',
  '> request added, so you can see how an observation re-enters the context.',
  '> Its prose is the harness’s own and cannot be neutralised without lying; if',
  '> you recognise a harness from it, say so in the verdict rather than scoring',
  '> around it. Score THIS PAIR ALONE and do not try to match it against another',
  '> pair.',
  '>',
  `> **Score all ${scored} criteria**; sum the ${summed} that are not disqualifiers`,
  `> (${RUBRIC.disqualifying.join(' and ')}). The machine check for each letter is in \`outcomes.json\``,
  '> beside these files: use it for grounding, not as the verdict.',
  '>',
  `> The rubric is \`${RUBRIC.source}\`, section "${RUBRIC.section}".`,
].join('\n')

/* ── reading a recorded run ─────────────────────────────────────────────── */

/** Parse JSON if it is JSON; otherwise the text itself. */
function json(text) {
  if (typeof text !== 'string') return text
  const trimmed = text.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

/**
 * The strings of a JSON array of strings that CLOSED, read from `text` at
 * `from` (just past the `[`), stopping at the first thing that is not another
 * string. A reply the token ceiling cut mid-list yields every thought that
 * arrived whole and never the fragment; a `]` inside a thought — `[1,2,3,4]`
 * in the recorded set — is inside a string and does not end the list.
 */
function closedStrings(text, from) {
  const items = []
  let at = from
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at += 1
    if (text[at] !== '"') return items
    let end = at + 1
    while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
    if (end >= text.length) return items
    const item = json(text.slice(at, end + 1))
    if (typeof item !== 'string') return items
    items.push(item)
    at = end + 1
    while (at < text.length && /\s/.test(text[at])) at += 1
    if (text[at] !== ',') return items
    at += 1
  }
}

/**
 * The JSON envelope inside a reply, fenced or not — or, when the reply was cut
 * before the object closed, whatever `thoughts` and `headline` can be read
 * out of the fragment. A cut reply's reasoning is real reasoning the judge
 * should see even though the harness scored the reply a misformat: the one
 * such turn in the recorded set holds the model's whole diagnosis of the bug,
 * and rendered `reasoning: (none)` over it until `readTurn` asked for this.
 */
function envelope(raw) {
  const text = String(raw ?? '')
  const direct = json(text)
  if (direct && typeof direct === 'object') return direct
  const open = text.indexOf('{')
  const close = text.lastIndexOf('}')
  if (open >= 0 && close > open) {
    const inner = json(text.slice(open, close + 1))
    if (inner && typeof inner === 'object') return inner
  }
  const thoughts = text.match(/"thoughts"\s*:\s*\[/)
  const headline = text.match(/"headline"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!thoughts && !headline) return null
  const salvaged = {}
  if (thoughts) salvaged.thoughts = closedStrings(text, thoughts.index + thoughts[0].length)
  if (headline) salvaged.headline = json(`"${headline[1]}"`)
  return salvaged
}

const list = (value) => (Array.isArray(value) ? value.map(String) : value ? [String(value)] : [])

/**
 * One recorded action, in the four things both formats carry.
 *
 * Two shapes exist in the record and both are read here rather than in the
 * scaffolds, because the record is what a panel is built from and a scaffold
 * module describes today's shape, not the shape of a run recorded last month.
 *
 *   `{ tool, args, raw }`         the reference arm: one tool per turn, an
 *                                 envelope carrying `thoughts` and `headline`
 *   `{ call, parsed }`            our arm: call lines the tree's own
 *                                 `Toolbox.parse` reads, `think` and `plan`
 *   `{ kind: 'malformed' }`       either arm: the reply did not fit the contract
 */
export function readTurn(action) {
  const turn = { reasoning: [], calls: [], answer: null, malformed: null }
  if (!action) return turn
  if (action.kind === 'malformed') {
    turn.malformed = { reason: String(action.reason ?? ''), note: String(action.note ?? '') }
    const inside = envelope(action.raw)
    if (inside) turn.reasoning = [...list(inside.thoughts), ...list(inside.headline)]
    return turn
  }
  if ('call' in action || 'parsed' in action) {
    turn.reasoning = [...list(action.parsed?.think), ...list(action.parsed?.plan)]
    if (action.kind === 'answer') {
      turn.answer = String(action.text ?? '')
      return turn
    }
    turn.calls = Toolbox.parse(action.call)
      .flat()
      .map((call) => ({ tool: call.name, args: json(call.argText) }))
    return turn
  }
  const inside = envelope(action.raw)
  if (inside) turn.reasoning = [...list(inside.thoughts), ...list(inside.headline)]
  if (action.kind === 'answer') {
    turn.answer = String(action.text ?? '')
    return turn
  }
  if (action.tool) turn.calls = [{ tool: String(action.tool), args: action.args ?? {} }]
  return turn
}

const actions = (record) => record.run.events.filter((event) => event.type === 'action')
const firstRequest = (record) => record.run.events.find((event) => event.type === 'request')
const requestAt = (record, at) =>
  record.run.events.find((event) => event.type === 'request' && event.at === at)

/**
 * The tools a record's prompt lists, in listing order, in either listing
 * shape: our `Toolbox.render` writes `- name({…})`, the reference manual writes
 * `### name` under `## available tools`. Pinned against the tree's real render
 * in `test/bench/oursScaffold.test.js`.
 */
function listedTools(record) {
  const text = (firstRequest(record)?.messages ?? []).map((m) => m.content).join('\n')
  const found = []
  for (const match of text.matchAll(/^- ([A-Za-z_][\w-]*)\(\{/gm)) found.push(match[1])
  const manual = text.indexOf('## available tools')
  const listing = manual < 0 ? text : text.slice(manual)
  for (const match of listing.matchAll(/^###\s+([A-Za-z_][\w-]*):?\s*$/gm)) found.push(match[1])
  return found
}

/**
 * One arm's tool vocabulary, read off one record: what its prompt listed and
 * what its actions called, minus any name it used as its ANSWER. The answer is
 * rendered as an ending, so its name never appears as an identifier; mapping
 * it would rewrite every English "response" in one arm's files and make the
 * word's absence a separator in the other's.
 */
export function toolsOf(record) {
  const answers = new Set()
  const used = []
  for (const { action } of actions(record)) {
    const turn = readTurn(action)
    if (action.kind === 'answer' && action.tool) answers.add(String(action.tool))
    for (const call of turn.calls) used.push(call.tool)
  }
  const names = []
  for (const name of [...listedTools(record), ...used]) {
    if (!answers.has(name) && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * Slot per tool for ONE arm across its whole set: in order of first use, then
 * the listed-but-unused in listing order. The same tool gets the same slot in
 * every file of that arm.
 */
export function slotsFor(records) {
  // The answer tool is excluded across the SET: a run that was refused before
  // it answered still lists the tool in its prompt, and `toolsOf` on that one
  // record cannot know the name is an answer.
  const answers = new Set()
  for (const record of records) {
    for (const { action } of actions(record)) {
      if (action.kind === 'answer' && action.tool) answers.add(String(action.tool))
    }
  }
  const order = []
  const seen = new Set(answers)
  const take = (name) => {
    if (seen.has(name)) return
    seen.add(name)
    order.push(name)
  }
  for (const record of records) {
    for (const { action } of actions(record))
      for (const call of readTurn(action).calls) take(call.tool)
  }
  for (const record of records) for (const name of toolsOf(record)) take(name)
  return new Map(order.map((name, at) => [name, `tool_${at + 1}`]))
}

/**
 * A tool name as an identifier: bounded by non-word characters, OR preceded
 * by an escaped newline, tab or quote inside a JSON string. The first panel's
 * nine leaks were every `\nread_file` a `\b`-bounded rename had left behind.
 */
const identifier = (name) => `(?:(?<![A-Za-z0-9_])|(?<=\\\\[nrt"]))${literal(name)}(?![A-Za-z0-9_])`

export function mapTools(text, slots) {
  let out = text
  const names = [...slots.keys()].sort((a, b) => b.length - a.length)
  for (const name of names) out = out.replace(new RegExp(identifier(name), 'g'), slots.get(name))
  return out
}

/** The verifier's scan for tool names, with the mapper's own boundary rule. */
export function findTools(text, names, file) {
  const found = []
  const patterns = names.map((name) => [name, new RegExp(identifier(name))])
  text.split('\n').forEach((line, at) => {
    for (const [name, pattern] of patterns) {
      if (pattern.test(line))
        found.push({ file, line: at + 1, term: name, text: line.slice(0, 160) })
    }
  })
  return found
}

/* ── rendering ──────────────────────────────────────────────────────────── */

const fence = (text) => ['```', String(text ?? '').replace(/\n$/, ''), '```']

/** `key: value`, a multi-line string as an indented block, anything else as JSON. */
function renderArgs(args, lines) {
  if (typeof args === 'string') {
    lines.push(`  ${args}`)
    return
  }
  for (const [key, value] of Object.entries(args ?? {})) {
    if (typeof value === 'string' && value.includes('\n')) {
      lines.push(`  ${key}:`)
      for (const row of value.replace(/\n$/, '').split('\n')) lines.push(`    ${row}`)
      continue
    }
    lines.push(`  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  }
}

/**
 * The sentences this renderer writes beside an ending, kept in one place so
 * the residue inventory can tell a word of its own from a word of the model's.
 * None of them may contain a `REPLACEMENTS` string: "harness" is what
 * `scaffold` scrubs to, and an ending sentence carrying it sorted three pairs
 * toward the arm that ran out of tokens before this list existed. `kindOf`
 * classes a replacement before an ending, so such a sentence would be fatal to
 * the gate; `test/bench/blind.test.js` pins it at the source.
 */
export const ENDING_LINES = Object.freeze({
  refusal: (spent) =>
    `${spent} tokens were generated and none of them reached the loop; the run ended here.`,
  own: 'the loop ended its own run, saying:',
  cap: (limit) => `the rig’s ${limit}-turn cap, not the loop’s`,
  cut: `${ENDINGS.cut} at the token ceiling; what arrived is read below`,
})

/**
 * The loop, in one grammar. Tool names are rendered as recorded here and
 * mapped to slots by `blindBody`, so that the observation text, the reasoning
 * and the call row all go through the one mapper.
 */
export function renderTurns(record) {
  const lines = []
  let cut = false
  for (const event of record.run.events) {
    if (event.type === 'task') {
      lines.push('## task', '', ...fence(event.text), '')
      continue
    }
    if (event.type === 'reply') {
      cut = event.state === 'cut'
      continue
    }
    if (event.type === 'observation') {
      lines.push('result:', ...fence(event.observation), '')
      continue
    }
    if (event.type === 'action') {
      const turn = readTurn(event.action)
      lines.push(
        turn.answer === null ? `## turn ${event.at}` : `## turn ${event.at} — ${ENDINGS.answered}`,
      )
      lines.push('')
      if (cut) lines.push(`> ${ENDING_LINES.cut}`, '')
      cut = false
      lines.push('reasoning:')
      if (turn.reasoning.length) for (const item of turn.reasoning) lines.push(`- ${item}`)
      else lines.push('- (none)')
      lines.push('')
      if (turn.answer !== null) {
        lines.push('answer:', ...fence(turn.answer), '')
        continue
      }
      if (turn.malformed) {
        lines.push(`call: none — the reply did not fit the contract (${turn.malformed.reason})`, '')
      }
      for (const call of turn.calls) {
        lines.push(`call: ${call.tool}`)
        renderArgs(call.args, lines)
        lines.push('')
      }
      continue
    }
    if (event.type === 'transport-refusal') {
      const reply = record.run.events.find((e) => e.type === 'reply' && e.at === event.at)
      const spent = Number(reply?.usage?.completion_tokens ?? 0)
      lines.push(`## turn ${event.at} — ${refusalEnding(event.state)}`, '')
      lines.push(ENDING_LINES.refusal(spent), '')
      continue
    }
    if (event.type === 'scaffold-stop') {
      lines.push(`## turn ${event.at} — ${ENDINGS.ceiling}`, '')
      lines.push(ENDING_LINES.own, ...fence(event.reason), '')
      continue
    }
    if (event.type === 'turn-cap') {
      lines.push(`## ${ENDINGS.ceiling} — ${ENDING_LINES.cap(event.limit)}`, '')
      continue
    }
    if (event.type === 'endpoint-error') {
      lines.push(`## turn ${event.at} — ${ENDINGS.endpoint}`, '', ...fence(event.error), '')
    }
  }
  return lines.join('\n')
}

/** Lines in `next` that `previous` does not have, as a multiset. */
function addedLines(previous, next) {
  const pool = new Map()
  for (const line of previous.split('\n')) pool.set(line, (pool.get(line) ?? 0) + 1)
  const added = []
  for (const line of next.split('\n')) {
    const left = pool.get(line) ?? 0
    if (left > 0) pool.set(line, left - 1)
    else added.push(line)
  }
  return added
}

/**
 * The prompt, once: every message of the first request by role, then what the
 * second request added over the first. Both are read off the record with no
 * knowledge of either arm; the diff is by line as a multiset, because one arm
 * re-assembles a single message and the other appends to a list, and a prefix
 * diff would show the first as wholly new every turn.
 */
export function renderPrompt(record) {
  const lines = ['## the prompt, as assembled for turn 1', '']
  const first = firstRequest(record)
  for (const message of first?.messages ?? []) {
    lines.push(`### ${message.role}`, '', ...fence(message.content), '')
  }
  lines.push('## what the prompt for turn 2 added', '')
  const second = requestAt(record, 2)
  if (!second) {
    lines.push('(the run made one request)', '')
    return lines.join('\n')
  }
  const before = (first?.messages ?? []).map((m) => m.content)
  const after = second.messages.map((m) => m.content)
  for (let at = 0; at < after.length; at++) {
    const added = addedLines(before[at] ?? '', after[at])
    if (!added.length) continue
    lines.push(`### ${second.messages[at].role}`, '', ...fence(added.join('\n')), '')
  }
  return lines.join('\n')
}

/**
 * The body a judge reads: turns, then the prompt, then slots and scrub over
 * the whole of it in one pass each. `prompt` is returned separately because the
 * gate scans the two differently — the turns are held to the blindness
 * standard, the prompt is declared.
 */
export function blindBody(record, { armIds = [], slots = new Map(), tasks = [] } = {}) {
  const project = (text) => scrub(mapTools(text, slots), armIds, { tasks })
  return {
    turns: project(`${renderTurns(record)}\n`),
    prompt: project(`${renderPrompt(record)}\n`),
  }
}

export function frame(task, letter, body) {
  return `# ${task} — transcript ${letter}\n\n${DISCLOSURE}\n\n${body}`
}

/** The file a panel reads, and its two halves for the gate to scan apart. */
export function blindTranscript(record, task, letter, options = {}) {
  const { turns, prompt } = blindBody(record, options)
  return { text: frame(task, letter, `${turns}\n${prompt}`), turns, prompt }
}

/** What a judge is handed beside the transcripts: the machine check and the cost. */
export function outcomeOf(record) {
  return {
    pass: Boolean(record.check?.pass),
    checks: (record.check?.checks ?? []).map((check) => ({
      name: check.name,
      ok: Boolean(check.ok),
    })),
    turns: Number(record.run.turns ?? 0),
    ending: endingOf(record.run),
    tokens: Number(record.run.tokens?.total ?? 0),
  }
}

/* ── the gate ───────────────────────────────────────────────────────────── */

/**
 * A/B assignment, deterministic from the task AND the index. S59: it hashed
 * the task alone, so three indices were one map three times over and a judge
 * who guessed once had guessed all three. The hash is a standard one, so its
 * output is pinned by the standard and not by this file: the first fix was a
 * hand-rolled `h * 31 + c`, whose parity is the parity of the character sum,
 * and `<task>/1` and `<task>/3` — both odd — stayed one map.
 */
export function letterFor(taskId, index, position) {
  const odd = createHash('sha1').update(`${taskId}/${index}`).digest()[0] % 2
  return (odd ? ['B', 'A'] : ['A', 'B'])[position]
}

/** Every word this renderer writes beside an ending, for the residue inventory. */
const ENDING_WORDS = new Set(
  [
    ...Object.values(ENDINGS),
    ENDING_LINES.refusal(0),
    ENDING_LINES.own,
    ENDING_LINES.cap(0),
    ENDING_LINES.cut,
  ]
    .join(' ')
    .match(/[A-Za-z_][A-Za-z0-9_]{2,}/g),
)

/**
 * Which class of thing a scanned term is — ONE classifier for the gate's scan
 * list and the fresh grep's tokens. A replacement is a replacement before it
 * is anything else, so an ending sentence that ever carried one would be
 * fatal rather than merely wrong. It used to answer "replacement" for anything
 * that was not a slot or an ending, which was true only of the list `main`
 * happened to hand it.
 */
export function kindOf(term) {
  if (REPLACEMENTS.includes(term)) return 'replacement'
  if (/^tool_\d+$/.test(term)) return 'slot'
  if (Object.values(ENDINGS).includes(term) || ENDING_WORDS.has(term)) return 'ending'
  return 'word'
}

/**
 * ONE definition of "a term sorts a pair", for the gate and for the inventory.
 * The two used to carry their own copy and the copies disagreed.
 *
 * For one term: the arm its one-sided pairs lean toward, and by how much. A
 * pair where both arms were handed the term in their prompts is vocabulary
 * there and is skipped; a pair where exactly one file `carries` it is sorted
 * toward that arm. `null` when no arm leads. `byTask` groups files by task;
 * every file has `arm`, `task` and `handed` — the terms in its PROMPT.
 */
function leaning(byTask, term, carries) {
  const toward = new Map()
  for (const [task, group] of Object.entries(byTask)) {
    if (group.length > 1 && group.every((file) => file.handed.has(term))) continue
    const carrying = group.filter((file) => carries(file, term))
    if (carrying.length !== 1) continue
    toward.set(carrying[0].arm, [...(toward.get(carrying[0].arm) ?? []), task])
  }
  const [first, ...rest] = [...toward.entries()].sort((a, b) => b[1].length - a[1].length)
  if (!first) return null
  const [arm, tasks] = first
  const against = rest.reduce((sum, [, list]) => sum + list.length, 0)
  return tasks.length > against ? { arm, sorted: tasks.length, against, tasks: tasks.sort() } : null
}

/**
 * Which terms sort pairs, counted PER PAIR.
 *
 * `files` is one entry per emitted file: `{ arm, task, terms, handed }` —
 * `terms` the scanned terms found in its TURNS, `handed` those found in its
 * PROMPT. A term whose sorted pairs lean one way is reported with both
 * counts. Only a `replacement` is fatal.
 */
export function separation(files) {
  const byTask = Object.groupBy(files, (file) => file.task)
  const pairs = Object.keys(byTask).sort()
  const entries = []
  for (const term of [...new Set(files.flatMap((file) => [...file.terms]))].sort()) {
    const lean = leaning(byTask, term, (file) => file.terms.has(term))
    if (lean) entries.push({ term, kind: kindOf(term), ...lean })
  }
  const fatal = entries.filter((entry) => entry.kind === 'replacement')
  return {
    entries,
    pairs: pairs.length,
    separated: new Set(fatal.flatMap((entry) => entry.tasks)).size,
  }
}

/**
 * Every occurrence of every term in `terms`, by line. `wholeWord` is what makes
 * an ARM NAME checkable at all: a substring scan for `ours` matches the middle
 * of "yourself". `BANNED` stays a substring scan because `/a0` and `bench/work`
 * are fragments, not words.
 */
export function findTerms(text, terms, file, { wholeWord = false } = {}) {
  const found = []
  const matches = wholeWord
    ? (line, term) => new RegExp(`\\b${literal(term)}\\b`, 'i').test(line)
    : (line, term) => line.includes(term)
  text.split('\n').forEach((line, at) => {
    for (const term of terms) {
      if (matches(line, term)) found.push({ file, line: at + 1, term, text: line.slice(0, 160) })
    }
  })
  return found
}

/**
 * A token of the fresh grep: a word, or a run of punctuation. `->` (our
 * observation frame) and `[` (the reference arm's `[exit code 0]`) sort pairs
 * as surely as `runtime` does, and a tokeniser that only saw words was blind
 * to both. A single punctuation mark is a token because `[` is one.
 */
const TOKEN = /[A-Za-z_][A-Za-z0-9_]{2,}|[^\sA-Za-z0-9_]+/g

/**
 * The fresh grep: every token that sorts three or more pairs one way, from the
 * emitted files themselves, filed by where it SORTS and not by where it
 * appears. `turns`: tokens that sort at least `floor` pairs by the turns alone
 * — model habits, this file's own ending sentences, and each contract's
 * argument names on its call rows, which are what a reader of a verdict
 * should know were sortable, so they are listed by name. `prompt`: tokens that
 * reach the floor only once the prompt is counted — the prose residue; a judge
 * who can sort by it can sort by the prompt, which is declared, so it is
 * counted and not listed. It used to file any token that appeared in ANY
 * prompt as prose, and `runtime`, which sorted 5 of 5 pairs from the turns,
 * was in the count nobody reads.
 */
export function residue(files, floor = 3) {
  const tokens = (text) => new Set(text.match(TOKEN) ?? [])
  const scanned = files.map((file) => ({
    ...file,
    terms: tokens(file.turnsText),
    handed: tokens(file.promptText),
  }))
  const byTask = Object.groupBy(scanned, (file) => file.task)
  const prompt = []
  const turns = []
  for (const word of new Set(scanned.flatMap((file) => [...file.terms, ...file.handed]))) {
    const byTurns = leaning(byTask, word, (file) => file.terms.has(word))
    if (byTurns && byTurns.sorted >= floor) {
      turns.push({ word, kind: kindOf(word), ...byTurns })
      continue
    }
    const byAll = leaning(byTask, word, (file) => file.terms.has(word) || file.handed.has(word))
    if (byAll && byAll.sorted >= floor) prompt.push({ word, kind: kindOf(word), ...byAll })
  }
  turns.sort((a, b) => b.sorted - a.sorted || a.word.localeCompare(b.word))
  return { prompt, turns }
}

function main() {
  const { index: INDEX, transcripts: TRANSCRIPTS, out: OUT, key: KEY } = options()
  if (!existsSync(TRANSCRIPTS)) {
    console.error(`no transcripts at ${TRANSCRIPTS} — run \`bun run.js\` first`)
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })

  // Every record of this index, by arm, BEFORE anything is rendered: slots are
  // assigned across an arm's whole set, and the task ids feed the fragment rule.
  const tasks = readdirSync(TRANSCRIPTS)
    .filter((name) => statSync(join(TRANSCRIPTS, name)).isDirectory())
    .sort()
  const records = new Map()
  for (const task of tasks) {
    for (const arm of readdirSync(join(TRANSCRIPTS, task)).sort()) {
      const source = join(TRANSCRIPTS, task, arm, `${INDEX}.json`)
      if (!existsSync(source)) continue
      const record = JSON.parse(readFileSync(source, 'utf8'))
      records.set(arm, [...(records.get(arm) ?? []), { task, record }])
    }
  }
  const armIds = [...records.keys()].sort()
  const slots = new Map(armIds.map((arm) => [arm, slotsFor(records.get(arm).map((r) => r.record))]))
  // What the verifier scans each arm's files for: the arm's own vocabulary in
  // full, plus every other arm's — minus a name this arm's own prompt uses as
  // an ordinary word. `shell` is our tool and the reference manual's "the shell
  // is /bin/sh"; `response` would be theirs and every "response" of ours. A
  // word the harness itself wrote into the prompt is English to that arm.
  const vocabulary = new Map(
    armIds.map((arm) => {
      const prompt = records
        .get(arm)
        .flatMap((r) => (firstRequest(r.record)?.messages ?? []).map((m) => m.content))
        .join('\n')
      const mine = [...slots.get(arm).keys()]
      const foreign = armIds
        .filter((other) => other !== arm)
        .flatMap((other) => [...slots.get(other).keys()])
        .filter((name) => !mine.includes(name) && !findTools(prompt, [name], '').length)
      return [arm, [...mine, ...foreign]]
    }),
  )

  const key = {
    index: INDEX,
    at: new Date().toISOString(),
    map: {},
    slots: Object.fromEntries(armIds.map((arm) => [arm, Object.fromEntries(slots.get(arm))])),
    rubric: RUBRIC,
  }
  const outcomes = {}
  const leaks = []
  const files = []
  let written = 0

  for (const task of tasks) {
    const here = armIds.filter((arm) => records.get(arm).some((r) => r.task === task))
    if (!here.length) continue
    key.map[task] = {}
    outcomes[task] = {}
    here.forEach((arm, position) => {
      const { record } = records.get(arm).find((r) => r.task === task)
      const letter = letterFor(task, INDEX, position)
      const {
        text: blinded,
        turns,
        prompt,
      } = blindTranscript(record, task, letter, { armIds, slots: slots.get(arm), tasks })

      mkdirSync(join(OUT, task), { recursive: true })
      const target = join(OUT, task, `${letter}.md`)
      writeFileSync(target, blinded, 'utf8')
      key.map[task][letter] = arm
      outcomes[task][letter] = outcomeOf(record)
      written += 1

      leaks.push(...findTerms(blinded, BANNED, target))
      leaks.push(...findTerms(blinded, armIds, target, { wholeWord: true }))
      // The whole of P4 rests on this: a tool name of EITHER arm, anywhere in
      // the emitted bytes, is the control that must exit 1.
      leaks.push(...findTools(blinded, vocabulary.get(arm), target))
      const scan = [...REPLACEMENTS, ...Object.values(ENDINGS), ...new Set(slots.get(arm).values())]
      files.push({
        arm,
        task,
        terms: new Set(findTerms(turns, scan, target).map((hit) => hit.term)),
        handed: new Set(findTerms(prompt, scan, target).map((hit) => hit.term)),
        turnsText: turns,
        promptText: prompt,
      })
    })
  }

  // A gate that passes over zero files is not a gate: `--index 9` used to
  // blind nothing, print "verified" and exit 0.
  if (!written) {
    console.error(
      `no run ${INDEX} under ${TRANSCRIPTS} — nothing was blinded, so nothing is verified`,
    )
    process.exit(1)
  }

  // Letters in LETTER order under every task. They were written in arm order,
  // so the first key under every task was the same arm and the panel directory
  // carried the whole A/B map in the order of its keys.
  for (const task of Object.keys(outcomes)) {
    outcomes[task] = Object.fromEntries(Object.entries(outcomes[task]).sort())
  }
  writeFileSync(join(OUT, 'outcomes.json'), JSON.stringify(outcomes, null, 2), 'utf8')
  const split = separation(files)
  key.separation = split
  writeFileSync(KEY, JSON.stringify(key, null, 2), 'utf8')
  console.log(
    `wrote ${written} transcripts and outcomes.json to ${OUT} — hand over THAT directory and nothing else`,
  )
  console.log(`key written to ${KEY} — outside it, and the judging step must not read it`)
  for (const arm of armIds) {
    console.log(
      `slots for ${arm}: ${[...slots.get(arm)].map(([name, slot]) => `${slot}=${name}`).join(' ')}`,
    )
  }

  // The inventory: what a fresh grep sorts three or more pairs by, filed by
  // where it sorts. The prompt's prose is declared rather than hidden and is
  // a count; what sorts pairs from the turns is listed by name, because a
  // reader of a verdict needs to know what a judge could have sorted on.
  const found = residue(files)
  console.log('')
  console.log(
    `RESIDUE: ${found.prompt.length} token(s) sort three or more of ${split.pairs} pair(s) by the prompt — its own prose, declared in every file and not listed. ${found.turns.length} token(s) sort three or more pairs from the turns alone:`,
  )
  for (const entry of found.turns) {
    console.log(
      `   ${JSON.stringify(entry.word)} [${entry.kind}] in ${entry.arm}'s turns, ${entry.sorted} of ${split.pairs} pair(s)${entry.against ? ` (${entry.against} the other way)` : ''}`,
    )
  }

  if (leaks.length) {
    console.error(`\n!! ${leaks.length} identifying string(s) survived the scrub:`)
    for (const leak of leaks.slice(0, 40)) {
      console.error(`   ${leak.file}:${leak.line}  ${JSON.stringify(leak.term)}  ${leak.text}`)
    }
    process.exit(1)
  }
  console.log('\nverified: no banned term, arm name or tool name survives in any emitted file')

  // What sorts pairs, per pair. Slots and endings are what happened; a
  // replacement is this file's own string reaching one arm, and is fatal.
  const behaviour = split.entries.filter((entry) => entry.kind !== 'replacement')
  for (const entry of behaviour) {
    console.log(
      `   ${JSON.stringify(entry.term)} [${entry.kind}] sorts ${entry.sorted} of ${split.pairs} pair(s) toward ${entry.arm}${entry.against ? ` (${entry.against} the other way)` : ''} — what happened, not who`,
    )
  }
  const fatal = split.entries.filter((entry) => entry.kind === 'replacement')
  if (fatal.length) {
    console.error(
      `\n!! NOT BLIND — ${split.separated} of ${split.pairs} pair(s) can be sorted into arms by a string this file wrote:`,
    )
    for (const entry of fatal) {
      console.error(
        `   ${JSON.stringify(entry.term)} [${entry.kind}] sorts ${entry.sorted} of ${split.pairs} pair(s) toward ${entry.arm}${entry.against ? ` (${entry.against} the other way)` : ''}`,
      )
    }
    console.error(
      `   A replacement reaches only the files whose identifying token it replaced, so the token named an arm and the replacement still does. Give both arms the same replacement, or scrub the surviving spelling too. See the header of ${fileURLToPath(import.meta.url)}.`,
    )
    process.exit(1)
  }
  console.log(
    `blind: no string this file wrote sorts one arm's turns from the other's, across ${split.pairs} pair(s)`,
  )
}

if (import.meta.main) main()
