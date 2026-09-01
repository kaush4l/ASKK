#!/usr/bin/env bun
/**
 * Build the artifact a blind judge is handed, and be the gate that says whether
 * it is blind.
 *
 *   bun blind.js            all tasks, run 1 of each scaffold
 *   bun blind.js --index 2  use run 2
 *
 * Writes `blind/<task>/A.md` and `blind/<task>/B.md`. THE KEY DOES NOT GO
 * THERE: it is written to `blind-key.json`, one directory up, because a judge is
 * handed `blind/<task>/` and a key sitting inside the directory being handed
 * over is not a key, it is a label. It used to be `blind/key.json` — inside —
 * while `.gitignore` beside it said in prose that it "must not travel beside
 * them".
 *
 * ── this file exists because the last panel was not blind ──────────────────
 *
 * Five judges were handed five task pairs and every one of them could separate
 * every pair from the first two lines:
 *
 *     5 of 5 "ours" files opened   `You are a careful, direct assistant`
 *     5 of 5 "agent-zero" files    `# System Manual`
 *
 * plus nine surviving tool identifiers, and the key in the directory. Their
 * verdict on the work is worth what their blindness was worth, which was
 * nothing. So this file is no longer a scrubber that also checks; it is the
 * definition of what a judge sees, and it fails when that definition is broken.
 *
 * ── what a judge sees, and the argument for it ─────────────────────────────
 *
 * The rubric is: HOW THE AGENT CODE DRIVES THE WHOLE LOOP ON TOOLS. So the
 * projection is the loop and nothing else — per turn, the model's reply, how the
 * harness parsed it, what the tools answered; then how the run ended and what it
 * finally said.
 *
 * DROPPED — the `## turn N — sent` blocks, i.e. the system prompt and the
 * assembled request. Two reasons, in order:
 *
 *   1. It is not needed for the rubric. Every tool a harness offers, every
 *      contract it imposes and every observation it feeds back is visible in
 *      what the loop DOES with them. A prompt can promise anything; the turns
 *      show what was delivered. Judging the loop from the transcript of the loop
 *      is a stricter test, not a weaker one.
 *   2. It is the LARGEST identity leak — it is not the whole of it, and this
 *      file used to say it was. Dropping the request block removes the system
 *      prompt AS SENT, at every turn, in every file. It does not remove the
 *      system prompt AS QUOTED BY THE MODEL: `blind/no-such-capability/B.md`
 *      carries `You are a careful, direct assistant…` five times, in the
 *      reasoning channel and in the reply, because the model rehearsed its own
 *      instructions back to itself. That text is the model's speech and may not
 *      be rewritten, so both openings are declared in `RESIDUAL` — counted,
 *      named in the NOT BLIND line, and never quietly gone.
 *
 * DROPPED — the header block: the title (`# collatz — ours (ASKK ReAct engine)
 * — run 1`), the stop/turns/tokens line, the PASS/FAIL verdict, the check list,
 * and the `## what this scaffold changed` section. The verdict is the answer; handing it to the
 * judge is not blinding, it is prompting. This is structural rather than
 * textual: `blind.js` reads `<n>.json` and asks `run.js` `renderBody` for the
 * run alone, so a heading added to the header can never travel here.
 *
 * SCRUBBED — filesystem paths, the two project names, the user's name, the
 * rig's own vocabulary (`scaffold`), and THE ARMS' OWN DIRECTORY NAMES. A
 * workspace path is `<repo>/bench/work/<task>/<arm>/<n>`, so it carries the
 * machine, the repository AND the harness name in one string, and it appears in
 * shell output and in the model's own sentences. None of that is design; all of
 * it is identity. Paths are rewritten WHOLE and FIRST, before any name-level
 * rule, which is the ordering the first version of this file got wrong.
 *
 * The arm names are read off the run rather than typed in — see `armRules`.
 * `no-such-capability/ours/1` appeared six times inside one model's reasoning
 * with no absolute prefix for the path rules to take, and a previous review
 * concluded `ours` was "too common a word to put in BANNED". It is not a word
 * problem: the scrub was always `\b`-anchored and left `yourself` alone; the
 * VERIFIER was a substring scan and disagreed with it. Both halves are fixed.
 *
 * NOT TOUCHED, and this is the change that matters most:
 *
 *   TOOL NAMES. `code_execution_tool`, `text_editor`, `read_file`,
 *   `write_file`, `list_files` are kept exactly as each harness spells them.
 *   An earlier version mapped them onto a neutral vocabulary and called the
 *   result blind. It was not: A TOOL'S NAME IS PART OF THE THING BEING JUDGED.
 *   The rubric is about how the code drives the loop on tools, and a judge who
 *   is shown `exec` cannot tell that one harness routes four capabilities
 *   through one tool with an `action` argument while the other offers four flat
 *   ones — which is precisely the design question. Renaming replaced a leak with
 *   a lie, and the lie was in the artifact rather than in the write-up, which
 *   makes it worse. (It also did not work: the rename was word-bounded, so every
 *   occurrence preceded by an escaped newline inside a JSON string — `\nread_file`
 *   — survived it. That is where the nine leaks came from.)
 *
 *   REPLY SHAPES. One JSON object with `thoughts` / `headline` / `tool_name` /
 *   `tool_args` on one side; `think` / `plan` / `act` / `result` lines on the
 *   other. That is the variable under test. Removing it would leave two
 *   transcripts of nothing.
 *
 * ── so the set is not blind, and this file says so ─────────────────────────
 *
 * Keeping the tool names means a judge who has read either project recognises
 * both arms on sight. That is a cost, it is paid deliberately, and it is
 * REPORTED rather than hidden: every run prints, per file, which declared
 * identifying terms remain and on how many lines. `RESIDUAL` is that list. The
 * unit is the LINE and not the occurrence, because a hit is a place to look and
 * the leak report beside it names line numbers; a term twice on one line is one
 * place. A reader of
 * any verdict from this set needs that report to know what the verdict is worth,
 * and it goes to stdout and into the key file — never into `blind/`, where the
 * judge would read it.
 *
 * ── the gate ───────────────────────────────────────────────────────────────
 *
 * `BANNED` is the list of terms that must NOT survive, and every emitted file is
 * scanned against it line by line. One hit and this script exits non-zero,
 * naming the file, the term and the line; the files are still written so the
 * leak can be read. `RESIDUAL` terms are counted and never fail the run — a
 * declared cost is not a defect. `test/bench/blind.test.js` holds the rule that
 * makes `BANNED` honest: every banned term must have a scrub rule behind it, or
 * it is a verifier that can never pass.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { renderBody, tally } from './run.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Where to read from and write to, READ INSIDE `main` AND NOT AT IMPORT TIME —
 * `test/bench/blind.test.js` imports this file, and a module that reads the
 * process's arguments as a side effect of being loaded breaks whatever imports
 * it. `run.js` had exactly that bug and it killed `bun bench/blind.js --index 2`
 * in a file it never called.
 *
 * `--transcripts` and `--out` exist so a run redirected with `run.js --out` can
 * be blinded without touching the repository's evidence — and so this script's
 * own failure path can be exercised against a fixture rather than only against
 * whatever `transcripts/` happens to hold.
 *
 * `strict` matters here more than anywhere: `--idnex 2` used to blind run 1 and
 * say nothing, which is a blind set built from the wrong run.
 */
function options() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: {
      index: { type: 'string', default: '1' },
      transcripts: { type: 'string' },
      out: { type: 'string' },
    },
  })
  const out = resolve(values.out ?? join(HERE, 'blind'))
  return {
    index: values.index,
    transcripts: resolve(values.transcripts ?? join(HERE, 'transcripts')),
    out,
    // Outside the directory a judge is handed, which is the whole point: a key
    // inside it is not a key, it is a label. See the header.
    key: `${out}-key.json`,
  }
}

/**
 * Every identifying string that CAN be removed, and the neutral text that
 * replaces it. Order matters: longer, more specific forms come first so a
 * shorter one cannot eat half of them.
 */
const SCRUBS = [
  // Paths FIRST. A run's workspace is `<repo>/bench/work/<task>/<scaffold>/<n>`,
  // which carries the machine name, the repo name AND the harness name in one
  // string. A name-level scrub run before this one would rewrite the middle of a
  // path and leave the rest, which is how the first version of this file leaked.
  [/\/private\/tmp\/[^\s"'`)\],;\\]+/g, '/workspace'],
  [/\/Users\/[^\s"'`)\],;\\]+/g, '/project'],
  [/-Users-[A-Za-z0-9-]+/g, '-workspace'],
  // A bare `Downloads/Dev/ASKK`, with no leading `/Users/…` to be swallowed by
  // the rule above. It is in BANNED and had NO rule of its own, so a relative
  // spelling — a git remote line, `find` output, an error message — would have
  // made blind.js exit 1 naming a term nothing could remove.
  // `test/bench/blind.test.js` asserts every banned term has a rule.
  [/\bDownloads\/Dev(\/[A-Za-z0-9_.-]+)?/g, 'project'],
  // The run directory as a bare relative path, which is what a model writes when
  // it echoes its own workspace back: `bench/work/<task>/<harness>/<n>`. The
  // harness id is inside it, so this must go even where no absolute prefix did.
  [/\bbench\/work(\/[A-Za-z0-9_./-]*)?/g, 'workspace'],
  // Then names.
  [/Agent Zero System Manual/g, 'System Manual'],
  [/agent zero autonomous json ai agent/gi, 'autonomous json ai agent'],
  [/agent[-\s_]?zero/gi, 'the agent'],
  [/frdel/gi, 'upstream'],
  [/\bASKK\b/gi, 'the project'],
  [/\bkaush\b/gi, 'user'],
  [/\/a0\b/g, '/app'],
  [/\bscaffolds?\b/gi, 'harness'],
  // The tree's own transport SIGNS every refusal it writes —
  // `OpenAICompatible.LABEL` is the first word of `_dumped`'s message — and the
  // refusal block IS the ending of a run, so the block stays and the signature
  // goes. Measured over the runs in `transcripts/`: the classifier refuses 12 of
  // one arm's 34 replies and 0 of the other's 79, so once those runs are
  // rendered, `grep -l openai-compatible blind/*/*.md` names the arm in every
  // pair — one probe, all five pairs, which is exactly what made the last
  // panel's verdict worth nothing.
  [/\bopenai-compatible\b/gi, 'the transport'],
]

/**
 * The arms' own names, DERIVED FROM THE RUN rather than typed here.
 *
 * `bench/work/<task>/<arm>/<n>` is the workspace, and the model writes that
 * fragment into its own reasoning — `no-such-capability/ours/1` appeared six
 * times in one transcript, in prose, with no absolute prefix for the path rules
 * to swallow. A previous review found it and concluded that `ours` is "too
 * common a word to put in BANNED". That is true of a hand-typed denylist and
 * false of this: the arm names are the directory names under
 * `transcripts/<task>/`, so the set is exactly the arms that ran, a third
 * scaffold is covered the day it is added, and nothing is guessed at.
 *
 * The cost is real and small: an English "ours" in a model's sentence becomes
 * "this harness". A mangled pronoun is a better trade than the arm's own
 * directory name in the artifact.
 */
export function armRules(ids) {
  return ids.map((id) => [
    new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
    'this harness',
  ])
}

/** Paths whole, THEN every name-level rule, THEN the arms' own names. */
export function scrub(text, armIds = []) {
  let out = text
  for (const [pattern, replacement] of SCRUBS) out = out.replace(pattern, replacement)
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
  // Our transport's own class label, which the refusal message opens with. Not
  // reachable in the sets built before the transport landed — the runs in
  // `transcripts/` predate every refusal block — so it is banned NOW, before the
  // first regenerated set carries it to a judge.
  'openai-compatible',
]

/**
 * Terms that DO survive, on purpose, and identify the arm to anyone who knows
 * either project. Counted and reported; never a failure.
 *
 * Each is an identifier a harness chose, and the choosing is the thing under
 * test. Removing them would make the set look blind and make the judgement
 * meaningless, which is a worse trade than admitting the set is not blind.
 */
export const RESIDUAL = [
  'code_execution_tool',
  'text_editor',
  'read_file',
  'write_file',
  'list_files',
  // The two system prompts' opening lines, WHERE THE MODEL QUOTED THEM BACK.
  // Dropping the request block removes both as sent; it does not remove them as
  // speech. Measured on the set in `blind/`: five occurrences of the first, in
  // `no-such-capability/B.md`, in the reasoning channel and in the reply — the
  // exact string this file names as one of the two openings that separated
  // 5 of 5 pairs for the last panel, still separating one pair, while
  // `bun bench/blind.js` exited 0 and the NOT BLIND report listed only tool
  // names. Rewriting a model's own sentence would put the lie in the artifact,
  // which is the trade this file refuses everywhere else, so the cost is
  // declared instead: counted, named per file, and in the key.
  'You are a careful, direct assistant',
  'System Manual',
]

/**
 * A/B assignment. Deterministic from the task id so a rerun is reproducible,
 * but not the same order for every task — otherwise A is always one harness and
 * the blinding is decorative.
 */
export function letterFor(taskId, scaffoldIndex) {
  let hash = 0
  for (const char of taskId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const flip = hash % 2 === 1
  const order = flip ? ['B', 'A'] : ['A', 'B']
  return order[scaffoldIndex]
}

/**
 * The judge's projection of one recorded run, from its JSON.
 *
 * `renderBody` is `run.js`'s only renderer, asked for the run without the
 * `sent` blocks. There is no second markdown writer here, and no string surgery
 * on a rendered document.
 */
export function blindTranscript(record, task, letter, armIds = []) {
  const body = renderBody({
    events: record.run.events,
    answer: record.run.answer,
    requests: false,
  })
  return scrub(`# ${task} — transcript ${letter}\n\n${body}\n`, armIds)
}

/**
 * Every occurrence of every term in `terms`, by line.
 *
 * `wholeWord` is not a nicety, it is what makes an ARM NAME checkable at all.
 * A substring scan for the arm id `ours` matches the middle of "yourself", so
 * the verifier reported four leaks in the task prompt itself while the scrub —
 * which is `\b`-anchored — had correctly left the word alone. A previous review
 * read that mismatch as "`ours` is too common a word to put in BANNED" and gave
 * up on it. The word is not the problem; a substring scan of it is.
 *
 * The static `BANNED` list stays a substring scan, because `/a0` and
 * `bench/work` are fragments rather than words and a boundary check would miss
 * them.
 */
export function findTerms(text, terms, file, { wholeWord = false } = {}) {
  const found = []
  const matches = wholeWord
    ? (line, term) =>
        new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(line)
    : (line, term) => line.includes(term)
  text.split('\n').forEach((line, at) => {
    for (const term of terms) {
      if (matches(line, term)) found.push({ file, line: at + 1, term, text: line.slice(0, 160) })
    }
  })
  return found
}

function main() {
  const { index: INDEX, transcripts: TRANSCRIPTS, out: OUT, key: KEY } = options()
  if (!existsSync(TRANSCRIPTS)) {
    console.error(`no transcripts at ${TRANSCRIPTS} — run \`bun run.js\` first`)
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })

  const key = { index: INDEX, at: new Date().toISOString(), map: {}, residual: {} }
  const leaks = []
  const residual = []
  let written = 0

  for (const task of readdirSync(TRANSCRIPTS).sort()) {
    const taskDir = join(TRANSCRIPTS, task)
    const scaffoldIds = readdirSync(taskDir).sort()
    key.map[task] = {}

    scaffoldIds.forEach((scaffoldId, position) => {
      const source = join(taskDir, scaffoldId, `${INDEX}.json`)
      if (!existsSync(source)) return
      const letter = letterFor(task, position)
      const blinded = blindTranscript(
        JSON.parse(readFileSync(source, 'utf8')),
        task,
        letter,
        scaffoldIds,
      )

      const outDir = join(OUT, task)
      mkdirSync(outDir, { recursive: true })
      const target = join(outDir, `${letter}.md`)
      writeFileSync(target, blinded, 'utf8')
      key.map[task][letter] = scaffoldId
      written += 1

      leaks.push(...findTerms(blinded, BANNED, target))
      // The arms' own names are fatal too. They are not in the static list
      // because they are read off the run (`armRules`), and they are matched as
      // WORDS because that is the only way a name like `ours` can be checked.
      leaks.push(...findTerms(blinded, scaffoldIds, target, { wholeWord: true }))
      const mine = findTerms(blinded, RESIDUAL, target)
      residual.push(...mine)
      key.residual[`${task}/${letter}`] = tally(mine, (hit) => hit.term)
    })
  }

  // A gate that passes over zero files is not a gate. `existsSync(source)` is a
  // bare `return` per file, so `--index 9` blinded nothing, printed "verified"
  // and exited 0 — the direct successor of the bug this file's `strict` was
  // added for, where `--idnex 2` blinded run 1 and said nothing.
  if (!written) {
    console.error(
      `no run ${INDEX} under ${TRANSCRIPTS} — nothing was blinded, so nothing is verified`,
    )
    process.exit(1)
  }

  writeFileSync(KEY, JSON.stringify(key, null, 2), 'utf8')
  console.log(`wrote ${written} blinded transcripts to ${OUT}`)
  console.log(`key written to ${KEY} — OUTSIDE ${OUT}, and the judging step must not read it`)

  // The honest half of the output. A set with residuals is not blind, and a
  // verdict from it must be read knowing by how much.
  console.log('')
  if (residual.length) {
    // The same `tally` the key file is written from, so the honest half of the
    // output and the key cannot be made to disagree by editing one of them.
    const perFile = Object.entries(Object.groupBy(residual, (hit) => hit.file))
    console.log(
      `NOT BLIND: ${residual.length} line(s) carrying one of ${RESIDUAL.length} declared identifying term(s) remain, in ${perFile.length} of ${written} file(s).`,
    )
    console.log(
      'These are tool names, and the two system prompts’ opening lines where a model quoted its own instructions back. They are kept because a tool name is part of what is being judged and a model’s own sentence may not be rewritten; see the header of this file. A judge who knows either project can separate the arms.',
    )
    for (const [file, hits] of perFile) {
      console.log(
        `   ${file}  ${Object.entries(tally(hits, (hit) => hit.term))
          .map(([term, n]) => `${term}×${n}`)
          .join(' ')}`,
      )
    }
  } else {
    console.log(
      'No declared identifying term appears in any emitted file. That is unusual — check that the transcripts are not empty before believing it.',
    )
  }

  if (leaks.length) {
    console.error(`\n!! ${leaks.length} identifying string(s) survived the scrub:`)
    for (const leak of leaks.slice(0, 40)) {
      console.error(`   ${leak.file}:${leak.line}  ${JSON.stringify(leak.term)}  ${leak.text}`)
    }
    process.exit(1)
  }
  console.log('\nverified: no banned term survives in any emitted file')
}

if (import.meta.main) main()
