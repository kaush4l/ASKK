#!/usr/bin/env bun
/**
 * Run every scaffold over every task N times.
 *
 *   bun run.js                         both scaffolds, all five tasks, once
 *   bun run.js --scaffold agent-zero   one scaffold
 *   bun run.js --task collatz -n 3     one task, three times
 *
 * Writes:
 *   transcripts/<task>/<scaffold>/<n>.md   what happened, readable
 *   transcripts/<task>/<scaffold>/<n>.json the same, machine-readable
 *   results.json                           pass/fail, turns, tokens, wall time
 *
 * Every run gets its own temp directory, seeded with the task's fixtures. No
 * run can see another's files, so the machine check is always looking at the
 * work of exactly one run. The directory is a NUMBER — `workspaceName` — and
 * `results.json` carries which run it belonged to; see that function for why
 * it stopped being `<task>/<scaffold>/<n>`.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { DEFAULTS, drive, MAX_TURNS } from './driver.js'
import { TASKS } from './tasks.js'
import { makeTools } from './tools.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The scaffolds. Adding one is adding a line here and a file in scaffolds/ —
 * nothing in driver.js, tools.js, tasks.js or blind.js knows how many there are.
 */
const SCAFFOLD_MODULES = [
  { id: 'agent-zero', path: './scaffolds/agent-zero.js' },
  { id: 'ours', path: './scaffolds/ours.js' },
]

/**
 * The command line, READ INSIDE `main` AND NOT AT IMPORT TIME.
 *
 * `blind.js` imports `renderBody` from this file so that one renderer writes
 * both the named transcript and the blind one. That import used to run this
 * parser against `blind.js`'s OWN argv, and `strict: true` then rejected
 * `--index` — `bun bench/blind.js --index 2` died in a file it never called.
 * A module that anything else imports may not read the process's arguments as
 * a side effect of being loaded.
 *
 * `short: 'n'` is the point of the options themselves. The README documents
 * `bun bench/run.js -n 3` and the hand-rolled reader it replaced only ever
 * looked for `--n`, so every three-run request silently ran once — a
 * wrong-number generator in a rig whose output is per-pairing statistics.
 * `strict` is the second half: a mistyped flag is an error instead of a silent
 * run of the whole matrix with the filter ignored.
 */
function options() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      n: { type: 'string', short: 'n', default: '1' },
      scaffold: { type: 'string' },
      task: { type: 'string' },
      workdir: { type: 'string' },
      out: { type: 'string' },
    },
  })
  return {
    repeats: Number(values.n),
    onlyScaffold: values.scaffold ?? null,
    onlyTask: values.task ?? null,
    runRoot: resolve(values.workdir ?? join(HERE, 'work')),
    outRoot: resolve(values.out ?? join(HERE, 'transcripts')),
    // `--out` moves the results file with the transcripts it summarises. It used
    // to move only the transcripts, so a run redirected to a scratch directory
    // still overwrote the repository's `results.json` — the evidence file — with
    // runs whose transcripts were somewhere that was about to be deleted.
    results: values.out ? join(resolve(values.out), 'results.json') : join(HERE, 'results.json'),
  }
}

/** Load the scaffolds, tolerating one that does not import yet. */
async function loadScaffolds(onlyScaffold) {
  const loaded = []
  for (const entry of SCAFFOLD_MODULES) {
    if (onlyScaffold && entry.id !== onlyScaffold) continue
    try {
      const module = await import(entry.path)
      const scaffold = module.scaffold ?? module.default
      if (!scaffold?.id) throw new Error('module exported no scaffold')
      loaded.push({ ok: true, scaffold })
    } catch (error) {
      // Reported, not fatal. A scaffold that cannot be imported is a fact worth
      // printing; it is not a reason to lose the other scaffold's numbers.
      loaded.push({ ok: false, id: entry.id, error: String(error?.stack ?? error) })
    }
  }
  return loaded
}

/**
 * The name of one run's workspace under `--workdir`: its ordinal in this
 * invocation, and nothing else.
 *
 * It was `<task>/<scaffold>/<n>`, and both arms are handed the absolute path
 * in their prompt. `docs/LEDGER.md` row S35: on `no-such-capability` our arm
 * read `no-such-capability/ours/1` back off its own cwd and quoted it as an
 * answer key seven, six and ten times across three runs, so any task whose id
 * names its expected answer was contaminated for whichever arm reads the path
 * aloud — and the arm name in the same string was the one identity leak
 * `blind.js` had to scrub out of a model's own sentences (P7). A number tells
 * the model nothing; `results.json` keeps `workdir` per row, so a reader can
 * still open the files a run left behind.
 *
 * It takes the ordinal and NOTHING ELSE. It took the task and the arm too and
 * read neither, and a parameter that is passed and ignored is the one a later
 * writer re-threads into the name without touching the signature.
 */
export const workspaceName = (sequence) => String(sequence)

function seedWorkspace(dir, fixtures) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [path, body] of Object.entries(fixtures ?? {})) {
    const full = join(dir, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body, 'utf8')
  }
}

/**
 * How big the first request was, measured from the run's own first `request`.
 *
 * The README used to carry three of these as typed-in constants. All three were
 * wrong against the transcripts beside them, and they could not have been right
 * for any reader: the workspace path is inside both prompts, so every figure
 * moves with the length of the checkout directory. A number a reader is asked
 * to carry into the results has to come out of the run that produced them.
 */
function promptSize(run) {
  const first = run.events.find((event) => event.type === 'request')
  if (!first) return { messages: 0, chars: 0, systemChars: 0 }
  const system = first.messages.find((message) => message.role === 'system')
  return {
    messages: first.messages.length,
    chars: first.messages.reduce((sum, message) => sum + message.content.length, 0),
    systemChars: system ? system.content.length : 0,
  }
}

/**
 * The middle of a sorted list, with the even case done properly.
 *
 * Written down and exported because a reported number got this wrong on this
 * rig's own data and nothing could catch it: our arm's 34 completion-token
 * values were reported with a "median" of 1,083, which is `sorted[n/2]` — the
 * UPPER MIDDLE of an even list. The median is 896, the mean of 709 and 1,083.
 * A rig that prints only raw rows invites a reader to roll their own; the fix
 * is for the instrument to publish the statistic, and for a test to pin the
 * even case. `test/bench/run.test.js`.
 */
export function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * How many items fall under each key.
 *
 * ONE counting rule for the whole rig, which is why it is exported: `blind.js`
 * built the same per-file term counts twice from one array — once for the key
 * file, once for the "NOT BLIND" line — so the honest half of the output and the
 * key could be made to disagree by editing one loop and not the other. Three
 * hand-rolled count-by-key loops are now one call in three places.
 */
export const tally = (items, key) =>
  Object.fromEntries(
    Object.entries(Object.groupBy(items, key)).map(([name, of]) => [name, of.length]),
  )

/**
 * What a run cost per reply, and what happened to each reply.
 *
 * Totals alone hid the finding this rig exists to report: an arm whose replies
 * are twice as long can still total fewer tokens by taking a quarter of the
 * turns, and the two facts point in opposite directions. The spread is here
 * because `README.md` says no number from this rig may be quoted without one.
 */
export function summarise(runs) {
  // `?? []` because the rows in this repository's own `results.json` predate the
  // `replies` column: `summarise(JSON.parse(results.json).runs)` threw
  // `undefined is not an object`, so the instrument could not read its own
  // record. A run with no reply rows reports `completionTokens.n = 0`.
  const replies = runs.flatMap((run) => run.replies ?? [])
  const models = [...new Set(replies.map((reply) => reply.model).filter(Boolean))]
  const states = tally(replies, (reply) => reply.state || 'unclassified')
  const sorted = replies.map((reply) => reply.completion).sort((a, b) => a - b)
  return {
    runs: runs.length,
    passed: runs.filter((run) => run.pass).length,
    // Runs the tree's transport refused a reply in. Not the same as runs that
    // FAILED: four of the ten our arm produced in `transcripts/` were scored
    // PASS by a rig that never asked the transport.
    refused: runs.filter((run) => run.stop === 'transport-refused').length,
    tokens: runs.reduce((sum, run) => sum + run.tokens.total, 0),
    ms: runs.reduce((sum, run) => sum + run.ms, 0),
    turns: runs.reduce((sum, run) => sum + run.turns, 0),
    completionTokens: {
      n: sorted.length,
      min: sorted[0] ?? 0,
      median: median(sorted),
      max: sorted.at(-1) ?? 0,
    },
    replyStates: states,
    models,
  }
}

/**
 * One row of `results.json`, projected from one recorded run.
 *
 * Extracted from `main` because it was the only writer of the evidence file and
 * NOTHING COULD SEE IT. Five separate falsifications of the object literal that
 * used to sit inline — `pass: true`, `stop: 'answered'`, `models: []`,
 * `replies: []`, and `state: 'whole'` on every reply — each left the whole suite
 * green. The last of those deletes the entire finding this rig was built to
 * publish: `summarise().replyStates` then reports `{whole: N}` for both arms and
 * every refusal disappears from the record with the gate still green.
 * `test/bench/run.test.js` drives a real run through it and pins the row.
 */
export function resultRow({ task, scaffold, index, run, check, toolCalls, workdir, transcript }) {
  return {
    task: task.id,
    scaffold: scaffold.id,
    index,
    pass: check.pass,
    checks: check.checks.map((c) => ({ name: c.name, ok: c.ok })),
    turns: run.turns,
    stop: run.stop,
    tokens: run.tokens,
    promptSize: promptSize(run),
    ms: run.ms,
    toolCalls,
    // What answered, not what was asked for. This endpoint serves four models
    // and the rig used to record only the one it requested, so "the same model
    // for both arms" was an assumption about a server made by code that
    // discarded the server's answer.
    models: run.models,
    // One row per reply, so the spread is re-derivable from results.json
    // without opening a transcript. `state` is `OpenAICompatible._state`'s
    // verdict on that reply.
    replies: run.events
      .filter((event) => event.type === 'reply')
      .map((event) => ({
        at: event.at,
        state: event.state,
        finish: event.finish,
        model: event.model,
        prompt: Number(event.usage?.prompt_tokens ?? 0),
        completion: Number(event.usage?.completion_tokens ?? 0),
        ms: event.ms,
      })),
    workdir,
    transcript,
  }
}

/**
 * A named transcript, as markdown: the header, then the run.
 *
 * The header is everything a judge must not see — the scaffold's label, the
 * verdict, the check list, the departures — which is why the run itself is
 * `renderBody` and lives on its own below. This comment used to say "blind.js
 * reads the JSON, not this"; it did not, it read this file's markdown and cut
 * the header off with a string search. It reads the JSON now, through
 * `renderBody`, and the sentence is true.
 */
function renderTranscript({ scaffold, task, index, run, check }) {
  const lines = []
  const size = promptSize(run)
  lines.push(`# ${task.id} — ${scaffold.label} — run ${index}`)
  lines.push('')
  lines.push(
    `stop: ${run.stop} · turns: ${run.turns}/${MAX_TURNS} · tokens: ${run.tokens.total} · ${(run.ms / 1000).toFixed(1)}s · check: ${check.pass ? 'PASS' : 'FAIL'}`,
  )
  lines.push('')
  lines.push(
    `first request: ${size.chars} characters in ${size.messages} message(s)${size.systemChars ? `, of which ${size.systemChars} are the system message` : ''}`,
  )
  lines.push('')
  for (const c of check.checks) {
    lines.push(
      `- [${c.ok ? 'x' : ' '}] ${c.name}${c.detail ? ` — \`${String(c.detail).replace(/\n/g, ' ⏎ ').slice(0, 160)}\`` : ''}`,
    )
  }
  lines.push('')

  // What this scaffold changed from what it would really send, in the artifact
  // a reader judges. Both scaffold files and the README said `cuts` was
  // "stamped into the transcript"; nothing wrote it, and its only reader was a
  // shape assertion in a test. A number from this rig now arrives with the
  // departures that produced it.
  //
  // The heading names both kinds because three of the seventeen rows are `cut:
  // 'nothing'` or `where: 'no cut — recorded because it looks like one'` — a
  // capability deliberately left alone, recorded so a reader does not have to
  // wonder. Under a heading that said "departures", those three rows were the
  // one part of the table that was not true.
  if (scaffold.cuts?.length) {
    lines.push('## what this scaffold changed, and what it deliberately did not')
    lines.push('')
    for (const entry of scaffold.cuts) {
      lines.push(`- **${entry.where}** — cut: ${entry.cut}`)
      lines.push(`  - why: ${entry.why}`)
    }
    lines.push('')
  }

  lines.push(renderBody({ events: run.events, answer: run.answer }))
  return lines.join('\n')
}

/**
 * The part of a transcript that is the RUN: the task, every turn, the final
 * answer. Everything above it — the title, the verdict, the check list, the
 * departures — is the header, and belongs to whoever is reading a named
 * transcript rather than judging a blind one.
 *
 * ONE renderer, two projections. `blind.js` used to regex the rendered markdown
 * and cut its header off with `indexOf('\n## task')`, which is a second reader
 * of a format only this function writes: a heading added here would have
 * travelled into a blind set silently. It now asks for the projection it wants.
 *
 * `requests: false` drops the `## turn N — sent` blocks. The argument for that
 * is `blind.js`'s, not this function's; this one only makes it expressible.
 */
export function renderBody({ events, answer, requests = true }) {
  const lines = []
  for (const event of events) {
    if (event.type === 'task') {
      lines.push('## task')
      lines.push('')
      lines.push('```')
      lines.push(event.text)
      lines.push('```')
      lines.push('')
      continue
    }
    if (event.type === 'request') {
      if (!requests) continue
      lines.push(`## turn ${event.at} — sent`)
      lines.push('')
      for (const message of event.messages) {
        lines.push(`### ${message.role}`)
        lines.push('')
        lines.push('```')
        lines.push(message.content)
        lines.push('```')
        lines.push('')
      }
      continue
    }
    if (event.type === 'reply') {
      lines.push(
        `## turn ${event.at} — reply (${event.usage?.completion_tokens ?? '?'} tokens, ${(event.ms / 1000).toFixed(1)}s, ${event.state || 'unclassified'})`,
      )
      lines.push('')
      for (const note of event.notes ?? []) {
        lines.push(`> ${note}`)
        lines.push('')
      }
      if (event.reasoning) {
        lines.push('<details><summary>reasoning channel</summary>')
        lines.push('')
        lines.push('```')
        lines.push(event.reasoning)
        lines.push('```')
        lines.push('')
        lines.push('</details>')
        lines.push('')
      }
      lines.push('```')
      lines.push(event.content)
      lines.push('```')
      lines.push('')
      continue
    }
    if (event.type === 'action') {
      lines.push(`## turn ${event.at} — parsed as`)
      lines.push('')
      lines.push('```json')
      lines.push(JSON.stringify(event.action, null, 2))
      lines.push('```')
      lines.push('')
      continue
    }
    if (event.type === 'observation') {
      lines.push(`## turn ${event.at} — observation`)
      lines.push('')
      lines.push('```')
      lines.push(event.observation)
      lines.push('```')
      lines.push('')
      continue
    }
    if (event.type === 'scaffold-stop') {
      lines.push(`## turn ${event.at} — the harness stopped itself: ${event.reason}`)
      lines.push('')
      continue
    }
    if (event.type === 'turn-cap') {
      lines.push(
        `## turn cap reached (${event.limit} turns) — the run was stopped by the rig, not by the agent`,
      )
      lines.push('')
      continue
    }
    if (event.type === 'transport-refusal') {
      // In the transcript a judge reads, because it is the run's ending. What
      // is NOT here is the text that was refused: the refusal exists to stop
      // several thousand characters of the model's private rehearsal being read
      // as speech, and printing it under a heading would undo that.
      lines.push(`## turn ${event.at} — the transport refused this reply (${event.state})`)
      lines.push('')
      lines.push('```')
      lines.push(event.message)
      if (event.hint) lines.push(event.hint)
      lines.push('```')
      lines.push('')
      continue
    }
    if (event.type === 'endpoint-error') {
      lines.push(`## turn ${event.at} — the endpoint failed`)
      lines.push('')
      lines.push('```')
      lines.push(event.error)
      lines.push('```')
      lines.push('')
    }
  }

  lines.push('## final answer')
  lines.push('')
  lines.push('```')
  lines.push(answer || '(the run produced no final answer)')
  lines.push('```')
  return lines.join('\n')
}

async function main() {
  const { repeats, onlyScaffold, onlyTask, runRoot, outRoot, results: RESULTS } = options()
  const loaded = await loadScaffolds(onlyScaffold)
  const broken = loaded.filter((entry) => !entry.ok)
  const scaffolds = loaded.filter((entry) => entry.ok).map((entry) => entry.scaffold)

  for (const entry of broken) {
    console.error(
      `\n!! scaffold ${entry.id} does not import; it is skipped, not faked.\n${entry.error}\n`,
    )
  }
  if (!scaffolds.length) {
    console.error('no scaffold could be loaded')
    process.exit(1)
  }

  const tasks = TASKS.filter((task) => !onlyTask || task.id === onlyTask)
  // The guard `--scaffold` has had eight lines above, given to its twin. A
  // mistyped task id used to filter every task away, run nothing, print an empty
  // table and exit 0 — which is what `strict: true` was added to this parser to
  // stop for flags, applied here to values.
  if (!tasks.length) {
    console.error(
      `no task matches --task ${onlyTask}. Known: ${TASKS.map((task) => task.id).join(', ')}`,
    )
    process.exit(1)
  }
  const config = { ...DEFAULTS }
  const results = {
    at: new Date().toISOString(),
    config: { ...config, maxTurns: MAX_TURNS },
    skipped: broken.map((entry) => ({ scaffold: entry.id, error: entry.error.split('\n')[0] })),
    runs: [],
  }

  let sequence = 0
  for (const task of tasks) {
    for (const scaffold of scaffolds) {
      for (let index = 1; index <= repeats; index++) {
        sequence += 1
        const workdir = join(runRoot, workspaceName(sequence))
        seedWorkspace(workdir, task.fixtures)
        const tools = makeTools(workdir)

        process.stderr.write(`· ${task.id} / ${scaffold.id} / ${index} `)
        const run = await drive({ scaffold, task, tools, config })
        const check = await task.check(workdir, run)
        process.stderr.write(
          `${check.pass ? 'PASS' : 'FAIL'} (${run.turns} turns, ${run.stop}, ${(run.ms / 1000).toFixed(0)}s)\n`,
        )

        const outDir = join(outRoot, task.id, scaffold.id)
        mkdirSync(outDir, { recursive: true })
        writeFileSync(
          join(outDir, `${index}.md`),
          renderTranscript({ scaffold, task, index, run, check }),
          'utf8',
        )
        writeFileSync(
          join(outDir, `${index}.json`),
          JSON.stringify(
            {
              task: task.id,
              scaffold: scaffold.id,
              index,
              cuts: scaffold.cuts ?? [],
              promptSize: promptSize(run),
              run,
              check,
            },
            null,
            2,
          ),
          'utf8',
        )

        results.runs.push(
          resultRow({
            task,
            scaffold,
            index,
            run,
            check,
            toolCalls: tools.calls.length,
            workdir,
            transcript: join(outDir, `${index}.md`),
          }),
        )
        results.summary = summaries(results)
        writeFileSync(RESULTS, JSON.stringify(results, null, 2), 'utf8')
      }
    }
  }

  // NOTHING IS WRITTEN HERE. The write above runs after every completed run, so
  // a post-loop write is duplication on the happy path and destruction on every
  // path where the loops did not run: `bun bench/run.js --task no-such-task`
  // wrote `{runs: []}` over `results.json` — 26,499 bytes of evidence replaced
  // by 334, exit 0, no error — and so did `-n 0`. That is the same defect
  // `options()` records for `--out`, in a second spelling. The guard on
  // `--task` above turns the typo into an error; deleting this write is what
  // makes the whole class impossible.
  console.log(table(results, scaffolds))
}

/** `summarise` per scaffold id, keyed. */
function summaries(results) {
  return Object.fromEntries(
    Object.entries(Object.groupBy(results.runs, (run) => run.scaffold)).map(([id, runs]) => [
      id,
      summarise(runs),
    ]),
  )
}

/** The results table, printed. Same numbers as results.json. */
function table(results, scaffolds) {
  const ids = scaffolds.map((s) => s.id)
  const lines = []
  lines.push('')
  lines.push('| task | scaffold | pass | turns | stop | tokens | wall |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const row of results.runs) {
    lines.push(
      `| ${row.task} | ${row.scaffold} | ${row.pass ? 'PASS' : 'FAIL'} | ${row.turns} | ${row.stop} | ${row.tokens.total} | ${(row.ms / 1000).toFixed(0)}s |`,
    )
  }
  lines.push('')
  for (const id of ids) {
    const mine = results.runs.filter((r) => r.scaffold === id)
    if (!mine.length) continue
    const stats = summarise(mine)
    lines.push(
      `${id}: ${stats.passed}/${stats.runs} passed · ${stats.tokens} tokens · ${(stats.ms / 1000).toFixed(0)}s total`,
    )
    // The spread, computed here so nobody has to. A reported "median" of this
    // rig's own numbers was `sorted[n/2]` on an even list; the instrument that
    // owns the data owns the statistic. See `median` above.
    const c = stats.completionTokens
    lines.push(
      `${id}: completion tokens per reply — n ${c.n}, min ${c.min}, median ${c.median}, max ${c.max}`,
    )
    lines.push(
      `${id}: reply states ${JSON.stringify(stats.replyStates)}${stats.refused ? ` · ${stats.refused}/${stats.runs} run(s) ended on a refused reply` : ''}`,
    )
    // Printed rather than written down: these move with the length of the
    // checkout path, because the workspace directory is inside both prompts.
    const sizes = mine.map((r) => r.promptSize.chars)
    lines.push(
      `${id}: first request ${Math.min(...sizes)}–${Math.max(...sizes)} characters in ${mine[0].promptSize.messages} message(s)${mine[0].promptSize.systemChars ? `, system message ${mine[0].promptSize.systemChars}` : ''}`,
    )
    // The one line that says the experiment was the experiment. Anything but a
    // single expected id here means the endpoint answered from somewhere else.
    lines.push(
      `${id}: answered by ${stats.models.length ? stats.models.join(', ') : '(unreported)'}`,
    )
  }
  return lines.join('\n')
}

if (import.meta.main) await main()
