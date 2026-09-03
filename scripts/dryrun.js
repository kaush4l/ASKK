#!/usr/bin/env bun
/**
 * Print what the model is actually sent, and what a whole turn looks like.
 *
 *     bun scripts/dryrun.js
 *     bun scripts/dryrun.js "<task>"
 *     bun scripts/dryrun.js "<task>" "<reply 1>" "<reply 2>" ...
 *
 * Exits non-zero when the run itself failed, because this is the artifact meant
 * to be produced after every slice and something has to be able to tell a good
 * transcript from a broken one without reading all of it.
 *
 * Every number in this repository about prompts — how many tokens, how much is
 * reusable, what the filter saved — was written by someone who had assembled
 * the prompt in their head. This assembles it for real: the agent comes from
 * `agents/main/agent.md` through the same `AgentCatalogue` the browser uses, the
 * prompt comes from the same `PromptTemplate`, and the loop is the same
 * `ReActEngine`. The only substitution is the model itself, which is a script.
 *
 * The prompt printed below is not rendered from the plan. It is the string the
 * transport was handed, kept by `ScriptedInference` and printed back out with
 * its byte length and hash, because a pretty-printed reconstruction is exactly
 * the kind of evidence this whole exercise exists to stop accepting. The two
 * are compared, and the run says so.
 *
 * Two things are deliberately not the same as a live run, and both are stated
 * in the output rather than left for a reader to discover:
 *
 *   - the clock is pinned, so two runs differ only where the code differs;
 *   - the agent's MCP servers are not started. They run inside the browser's
 *     wasm guest, which does not exist here, so their tools are missing from
 *     the prompt — the one part of it this script cannot show honestly.
 */
import { AgentCatalogue } from '../src/core/agent/AgentCatalogue.js'
import { describeEnvironment } from '../src/core/agent/Environment.js'
import { buildAgent } from '../src/core/agent/loadAgent.js'
import { Role } from '../src/core/Message.js'
import { ScriptedInference } from '../test/support/ScriptedInference.js'

// Before anything reads a clock. A pinned moment and a pinned zone are what
// make two runs of this comparable; the block is one line of the prompt and it
// is labelled where it is printed.
process.env.TZ = 'UTC'
const NOW = new Date('2026-09-01T09:00:00Z')

const RULE = '='.repeat(78)
const THIN = '-'.repeat(78)

const DEFAULT_TASK = 'what kernel is this machine running?'

/** A tool turn and then an answer: the shortest script that shows the whole loop. */
const DEFAULT_REPLIES = [
  [
    'think: [I cannot know the kernel without asking the machine]',
    '',
    'plan: [run uname in the sandbox, then answer with what it prints]',
    '',
    'act: tool',
    '',
    'result: shell({"command": "uname -a"})',
  ].join('\n'),
  [
    'think: [there is no sandbox in this build, so there is nothing to read]',
    '',
    'plan: []',
    '',
    'act: answer',
    '',
    'result: I could not run anything: this build has no sandbox image, so I cannot',
    'tell you the kernel version.',
  ].join('\n'),
]

const count = (n) => n.toLocaleString('en-US')

function heading(title) {
  console.log(`\n${RULE}\n ${title}\n${RULE}`)
}

function field(label, value) {
  console.log(` ${label.padEnd(9)}${value}`)
}

function list(label, items) {
  if (!items.length) return
  console.log(`\n ${label}`)
  for (const item of items) console.log(`   - ${item}`)
}

/**
 * The block table: what each section of this prompt cost, and whether it will
 * still be there unchanged on the next call.
 *
 * A block the template asked for and that rendered nothing gets a line of its
 * own. Nothing else in the tree can see that: an empty block is dropped
 * silently, so a prompt missing a whole section looks exactly like a prompt
 * that never had one.
 */
function sections(plan, order, absent = '') {
  const rows = plan.parts.map((part) => ({
    id: part.id,
    volatility: part.volatility,
    chars: part.end - part.start,
    tokens: part.tokens,
    cached: part.cached ? 'yes' : part.tail ? 'no (tail)' : 'no',
  }))
  const width = Math.max(12, ...rows.map((row) => row.id.length))

  console.log(
    ` ${'SECTION'.padEnd(width)}  ${'VOLATILITY'.padEnd(10)}  ${'CHARS'.padStart(7)}  ${'TOKENS'.padStart(7)}  REUSED`,
  )
  for (const row of rows) {
    console.log(
      ` ${row.id.padEnd(width)}  ${row.volatility.padEnd(10)}  ${count(row.chars).padStart(7)}  ${count(row.tokens).padStart(7)}  ${row.cached}`,
    )
  }
  const chars = plan.parts.at(-1)?.end ?? 0
  console.log(
    ` ${'TOTAL'.padEnd(width)}  ${''.padEnd(10)}  ${count(chars).padStart(7)}  ${count(plan.total).padStart(7)}`,
  )
  // Said here, under the numbers, and not only in the header: a caveat a reader
  // has to scroll back a hundred lines for is a caveat that will be quoted away
  // from. Every figure in this table is short by whatever these servers' tools
  // would add to the `tools` block, and the share below is correspondingly high.
  if (absent) {
    console.log(` NOT COUNTED: the tools of ${absent} — declared, not started here.`)
  }
  const share = plan.total ? Math.round((plan.cacheable / plan.total) * 100) : 0
  console.log(
    `\n reusable prefix: ${count(plan.cacheable)} of ${count(plan.total)} tokens (${share}%), ending at char ${count(plan.boundary)}`,
  )
  console.log(` ended by:        ${plan.brokenBy || '(nothing — the whole prompt is stable)'}`)
  const missing = order.filter((id) => !plan.parts.some((part) => part.id === id))
  if (missing.length) {
    console.log(` empty, so absent from the prompt entirely: ${missing.join(', ')}`)
  }
  for (const problem of plan.problems) console.log(` PROBLEM:         ${problem}`)
}

/** The payload, between markers, with nothing added to it. */
function payload(kind, text, note) {
  console.log(`\n${THIN}\nBEGIN ${kind} — ${note}\n${THIN}`)
  console.log(text)
  const size = `${count(new TextEncoder().encode(text).length)} bytes (${count(text.length)} chars)`
  const sha = new Bun.CryptoHasher('sha256').update(text).digest('hex').slice(0, 12)
  console.log(`${THIN}\nEND ${kind} — ${size}, sha256 ${sha}\n${THIN}`)
}

const [task = DEFAULT_TASK, ...supplied] = process.argv.slice(2)
const replies = supplied.length ? supplied : DEFAULT_REPLIES

// The real catalogue, reading the real folder. `agents/` is the source of truth
// that `scripts/agents.js` copies to `public/agents/`, so this reads what the
// build publishes rather than the published copy, and needs no build to run.
const catalogue = new AgentCatalogue(new URL('..', import.meta.url).href.replace(/\/$/, ''))
const spec = await catalogue.spec('main')
if (!spec.ok) {
  console.error(`could not read the agent: ${spec.failure.message}\n${spec.failure.hint}`)
  process.exit(1)
}

const inference = new ScriptedInference({ replies })
const soul = await catalogue.soul()
const agent = buildAgent({
  spec: spec.value,
  inference,
  soul: soul.value,
  // No peers: the roster is a single agent, so `peers` is empty in the app too.
  peers: [],
  context: describeEnvironment({ at: NOW }),
  // No sandbox. The shell tool says so when it is called, which is a real
  // observation and not a stub — the same one a browser without the image gets.
  services: { sandbox: null },
})

heading('ASKK dry run — the real prompt, with a script in place of the model')
field('task', task)
field('agent', `${spec.value.source} (${spec.value.name})`)
field('loop', `${spec.value.engine} · ${spec.value.response}`)
field('tools', agent.value.toolbox.names.join(', ') || '(none)')
field('clock', `pinned to ${NOW.toISOString()} in UTC, so two runs differ only where the code does`)
field('model', `scripted — ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, no network`)
// Named once and used twice: in the header, and again under every table of
// numbers those servers' tools are missing from.
const unstarted = spec.value.mcp.map((server) => server.name).join(', ')
if (unstarted) {
  field('mcp', `${spec.value.mcp.length} server declared (${unstarted}) and NOT started here:`)
  console.log('          it runs in the wasm guest, so its tools are absent from the prompt below')
}
list('notes from reading the agent file', [...spec.notes, ...agent.notes])

const plans = []
const steps = []
const deltas = []
const turn = await agent.value.run([{ role: Role.USER, text: task }], {
  onPrompt: (plan) => plans.push(plan),
  // `onDelta` is not decoration here. `Engine.step` branches on it — with a
  // listener the turn goes through `Inference.stream()`, without one through
  // `invoke()` — and `ChatService` always passes one, so a dry run without it
  // would be exercising the branch the app never takes.
  onDelta: (event) => deltas.push(event),
  onStep: (event) => steps.push(event),
})

for (const [index, plan] of plans.entries()) {
  const call = inference.calls[index]
  heading(`STEP ${index + 1} of ${plans.length}`)

  console.log(
    ` the engine called stream(), as a browser turn does; this transport cannot stream, so it`,
  )
  console.log(
    ` answered through invoke(prompt, ${JSON.stringify(call.multimodal)}, ${JSON.stringify(call.options)}) in one chunk`,
  )
  payload('PROMPT', call.prompt, `step ${index + 1}, verbatim as the transport received it`)
  // What this compares, exactly: the argument at the transport against the plan
  // the engine announced a statement earlier. It catches something coming
  // between the two. It cannot catch an assembler that is wrong, because both
  // sides of the comparison came out of the same assembly.
  console.log(
    call.prompt === plan.text
      ? ' checked: the transport was handed the same string the plan announced — nothing came\n          between announcing it and sending it.'
      : ' WARNING: the bytes sent differ from the assembled plan.',
  )
  console.log('')
  sections(plan, agent.value.template.order, unstarted)

  const reply = replies[index]
  if (reply !== undefined) payload('MODEL REPLY', reply, 'exactly as the script supplied it')

  // How the reply reached the page. A transport with nothing to stream still
  // goes through the streaming path and emits the whole answer at once — this
  // is the line that says whether it did, and how much arrived each time.
  const chunks = deltas.filter((event) => event.step === index + 1)
  if (chunks.length) {
    const sizes = chunks.map((event) => `${event.kind} ${count(event.chunk.length)} chars`)
    console.log(`\n DELTAS — ${chunks.length} chunk(s) to the page: ${sizes.join(', ')}`)
  }

  const parsed = steps[index]?.parsed
  if (parsed && typeof parsed !== 'string') {
    console.log('\n PARSED')
    field('act', parsed.act)
    field('think', parsed.think.join(' | ') || '(none)')
    field('plan', parsed.plan.join(' | ') || '(none)')
    field('result', parsed.result.replaceAll('\n', ' ').slice(0, 200))
  }

  // The scratchpad entry this step added, read back out of the prompt the next
  // step got — the only place a tool's output is proved to have reached a model.
  //
  // Taken as the GROWTH of the block, not by splitting it. The block is APPEND:
  // this step's version is a prefix of the next one's, so the difference is
  // exactly the new entry. Splitting on a blank line looked equivalent and was
  // not — a tool that prints a blank line, which most shell output does, would
  // have had its middle printed here under a heading claiming it was the end.
  const entries = (plan) => {
    const part = plan?.parts.find((p) => p.id === 'scratchpad')
    if (!part) return ''
    const block = plan.text.slice(part.start, part.end)
    const first = block.indexOf('\n\naction: ')
    return first < 0 ? '' : block.slice(first + 2)
  }
  const added = entries(plans[index + 1])
    .slice(entries(plan).length)
    .trim()
  if (added) {
    console.log('\n WHAT THIS STEP WROTE ON THE SCRATCHPAD — as step', index + 2, 'reads it')
    for (const line of added.split('\n')) console.log(`   ${line}`)
  }
}

heading('THE TURN')
// The exit status, because this artifact is meant to be produced after every
// slice and something has to be able to tell a good transcript from a broken
// one without reading it.
process.exitCode = turn.ok ? 0 : 1
if (turn.ok) {
  const answer = typeof turn.value === 'string' ? turn.value : turn.value.answer
  console.log(`\n${answer}\n`)
} else {
  console.log(`\n the run failed: ${turn.failure.message}`)
  console.log(` ${turn.failure.hint}\n`)
}
list('notes', turn.notes)

console.log(
  `\n ${'STEP'.padStart(4)}  ${'CHARS'.padStart(7)}  ${'TOKENS'.padStart(7)}  ${'REUSABLE'.padStart(8)}  ACT`,
)
for (const [index, plan] of plans.entries()) {
  const parsed = steps[index]?.parsed
  console.log(
    ` ${String(index + 1).padStart(4)}  ${count(plan.parts.at(-1)?.end ?? 0).padStart(7)}  ${count(plan.total).padStart(7)}  ${count(plan.cacheable).padStart(8)}  ${typeof parsed === 'string' ? 'text' : (parsed?.act ?? '—')}`,
  )
}

console.log(`\n${THIN}`)
console.log(' drive it yourself:')
console.log('   bun scripts/dryrun.js "<task>" "<reply 1>" "<reply 2>" ...')
console.log(' each reply is the raw text a model would return. The loop ends when one of')
console.log(' them answers, or when they run out — nothing else bounds it.')
console.log(THIN)
