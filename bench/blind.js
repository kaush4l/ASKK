#!/usr/bin/env bun
/**
 * Build the artifact a panel is handed, and be the gate that says whether it is
 * blind. It is not, today, and the exit code says so.
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
 *      named in the DECLARED RESIDUE report, and fatal where they separate.
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
 * ── so the set is not blind, and the EXIT CODE says so ─────────────────────
 *
 * The version of this file that argued all of the above then printed
 *
 *     NOT BLIND: 137 line(s) carrying one of 7 declared identifying term(s)
 *     remain, in 10 of 10 file(s)
 *
 * and exited 0. `docs/LEDGER.md` row S39: an instrument built to enforce
 * blindness passed an artifact that was not blind, and its own last-but-one line
 * said so. Either the exit code or the sentence had to give. THE EXIT CODE
 * GIVES, because the sentence was true.
 *
 * What makes a set not blind is not that identifying terms remain — it is that
 * they SEPARATE. `separation` below asks the only question that matters and
 * asks it of the set rather than of a reader: does any declared term appear in
 * one arm's files and in no other arm's? If it does, it names that arm, and a
 * judge who notices it can sort ten files into two piles WITH NO PRIOR KNOWLEDGE
 * OF EITHER PROJECT. Measured on the set in `blind/`: `code_execution_tool` and
 * `text_editor` in five of five reference files and nowhere else, `read_file` /
 * `write_file` / `list_files` in the other five and nowhere else. Five of five
 * pairs, by inspection, for free.
 *
 * That is worse than a judge recognising a project, because it is available to
 * every judge and because it links the pairs: one opinion formed on one file
 * propagates to all five, and five independent verdicts collapse into one.
 *
 * The residue cannot be scrubbed — see TOOL NAMES above; renaming replaces a
 * leak with a lie. So the honest conclusion is the one this file now enforces:
 * THIS COMPARISON CANNOT BE BLIND, AND CALLING IT BLIND WAS THE ERROR. What it
 * can be is DISCLOSED. Three things follow, and all three are code here rather
 * than prose somewhere else:
 *
 *   1. A separating term is a FAILURE. Exit 1, naming the term, the arm it
 *      names, and in how many of the pairs. There is no flag to turn this off:
 *      `bun run check` never runs this script, so nothing needs a green here,
 *      and a suppressible gate is the defect this row was filed for.
 *   2. THE PANEL IS TOLD, in the only channel that reaches it — the file it is
 *      handed. `DISCLOSURE` is prepended to every transcript. It is byte
 *      identical in all of them, so it cannot itself separate anything, and
 *      `test/bench/blind.test.js` asserts it carries no banned or residual term,
 *      because a disclosure naming `read_file` would put that term in all ten
 *      files and turn this gate green by making the leak universal.
 *   3. One pair is the unit of judgement. Within a pair the tool vocabulary
 *      tells a judge that the two transcripts came from two different harnesses,
 *      which they were already told; ACROSS pairs it tells them which is which.
 *      `DISCLOSURE` asks for the pair to be scored alone, and for a judge who
 *      recognises a project to say so instead of pretending.
 *
 * The green state is reachable and this file will not pretend otherwise: it
 * arrives when no scanned term appears in one arm's files and in no other's —
 * when both harnesses spell a capability the same way, and when the
 * replacements this file writes reach both arms alike. REDUCING THE SET TO ONE
 * PAIR DOES NOT REACH IT, and this comment said it did: `separation` has no
 * pair-count floor, deliberately, because a gate a smaller run walks past is
 * the defect row S39 was filed for. Measured on `transcripts/collatz` alone:
 * `!! NOT BLIND — 1 of 1 pair(s)`, exit 1. `test/bench/blind.test.js` says the
 * same sentence, and said the correct half of it while this one was false.
 *
 * ── criterion 1, and why the RUBRIC gives rather than this file ─────────────
 *
 * `docs/REFERENCE-PROMPTS.md`'s criterion 1 is "working context vs ceremony":
 * do whole prompt blocks go unreferenced, would deleting a third of the prompt
 * change a reply. This projection drops the prompt. So criterion 1 was scored 1
 * for both arms no matter what either harness did — `docs/LEDGER.md` row P5.
 *
 * Putting the request block back is the wrong repair. It is the largest single
 * identity carrier in the record — the two system prompts' opening lines are the
 * exact strings that separated 5 of 5 pairs for the last panel — so it buys one
 * scorable criterion at the cost of every other. And criterion 1's own poles are
 * textual ("a persona restated three times", "a paragraph introducing a
 * heading"); no token-count projection answers them, so there is no half
 * measure to take.
 *
 * The rubric gives instead. `RUBRIC` is this file's half of that
 * agreement, `DISCLOSURE` carries it to the panel, and
 * `test/bench/blind.test.js` reads `docs/REFERENCE-PROMPTS.md` and fails if the
 * two stop saying the same thing.
 *
 * ── the gate ───────────────────────────────────────────────────────────────
 *
 * `BANNED` is the list of terms that must NOT survive, and every emitted file is
 * scanned against it line by line. One hit and this script exits non-zero,
 * naming the file, the term and the line; the files are still written so the
 * leak can be read. `RESIDUAL` terms are the declared cost — counted per file,
 * reported, and fatal only where they SEPARATE, which is the whole of the
 * change above. `test/bench/blind.test.js` holds the rule that makes `BANNED`
 * honest: every banned term must have a scrub rule behind it, or it is a
 * verifier that can never pass.
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
const ARM_REPLACEMENT = 'this harness'

export function armRules(ids) {
  return ids.map((id) => [
    new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
    ARM_REPLACEMENT,
  ])
}

/**
 * Every string this file WRITES INTO the artifact, deduplicated.
 *
 * `separation` scans these beside `RESIDUAL`, and until it did, this gate could
 * not see the leaks its own scrub creates. A replacement only reaches a file
 * where the identifying token it replaces was present, so a token that appeared
 * in one arm becomes a REPLACEMENT that appears in one arm — the leak moves, it
 * does not go. Measured on the set in `blind/` at the moment this was added:
 * `this harness` in one `ours` file and no other, `/workspace` in one
 * `agent-zero` file and no other; two separated pairs the verdict block was
 * silent about while reporting six terms it had been handed by hand.
 *
 * The near miss is the argument. `openai-compatible` → `the transport` was
 * added one slice ago against a leak the comment beside it measures at 5 of 5
 * pairs; the replacement it writes has identical separating power, and reads 0
 * today only because `transcripts/` predates the transport. The first
 * regenerated set would have shipped a five-pair separator through a gate that
 * scanned only the two hand-typed lists.
 */
export const REPLACEMENTS = [
  ...new Set([...SCRUBS.map(([, replacement]) => replacement), ARM_REPLACEMENT]),
]

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
  // 5 of 5 pairs for the last panel, and still separating one pair now.
  // Rewriting a model's own sentence would put the lie in the artifact, which is
  // the trade this file refuses everywhere else, so the cost is declared
  // instead: counted, named per file, in the key — and, since it names an arm,
  // fatal. `separation` reports it at 1 of 5 pairs beside the tool names.
  'You are a careful, direct assistant',
  'System Manual',
]

/**
 * The rubric this projection is built for, and which of it this projection can
 * carry.
 *
 * `withheld` is criterion 1: it is about the assembled prompt and the assembled
 * prompt is not here. The header argues why the prompt does not come back rather
 * than the criterion going away.
 *
 * The distinction the rubric draws, and the reason this is not simply "score it
 * 1": a criterion a TRANSCRIPT cannot answer is scored 1, because an
 * unanswerable question about a run is a fact about that run. A criterion the
 * PROJECTION withholds from both arms equally is a fact about the instrument.
 * Scoring it 1 twice adds a constant to both sums, which can change no winner,
 * and dresses a hole in the instrument up as a measurement of the work.
 *
 * `criteria` and `disqualifying` are here so that `DISCLOSURE` can DERIVE the
 * two counts it gives a judge — how many to score, how many to sum — instead of
 * spelling them out. Three numbers typed into a paragraph is three numbers that
 * go stale the first time the rubric gains a row, silently, in the artifact a
 * panel reads. `test/bench/blind.test.js` parses `source` and fails if the shape
 * declared here stops matching the page.
 */
export const RUBRIC = {
  source: 'docs/REFERENCE-PROMPTS.md',
  // The heading inside it, because `DISCLOSURE` is the only channel that
  // certainly reaches a judge and a 646-line page is not a citation.
  section: 'The blind comparison rubric',
  criteria: 8,
  disqualifying: [4, 8],
  withheld: [1],
}

/** Scored: everything the projection did not withhold. */
const scored = RUBRIC.criteria - RUBRIC.withheld.length
/** Summed: scored, minus the disqualifiers, which are pass/fail rather than points. */
const summed = scored - RUBRIC.disqualifying.length

/**
 * What every judge is told, in the file they are handed, before they read a
 * line of either transcript.
 *
 * This is the only channel that reaches a panel. A key file, a README section
 * and a line of stdout can all be dropped between this script and the judge;
 * the transcript cannot, because it is the thing being judged.
 *
 * It names NO tool and NO project. That is not tact, it is the gate's
 * correctness: this text is prepended to all ten files, so any residual term
 * inside it would appear in every arm's files, stop separating, and turn the
 * gate green by making the leak universal. `test/bench/blind.test.js` asserts
 * it is clean of both lists.
 */
export const DISCLOSURE = [
  '> **Before you score.** These two transcripts are one task, run by two',
  '> different agent harnesses. Which letter is which is randomised per task and',
  '> is not recorded here.',
  '>',
  '> **This pair is not blind.** Each harness names its own tools, those names',
  '> are part of what you are being asked to judge, and they are not the same on',
  '> both sides — so they identify the harness, and to a reader who knows either',
  '> project they identify the project. Score THIS PAIR ALONE: do not try to',
  '> match it against another pair, and if you recognise a harness, say so in the',
  '> verdict rather than scoring around it. A verdict is worth what the judge’s',
  '> blindness was worth, and the honest way to price it is to be told.',
  '>',
  `> **Criterion ${RUBRIC.withheld.join(', ')} of the rubric is withheld on this projection** and must`,
  '> not be scored. It asks about the assembled prompt, and the assembled prompt',
  '> is not here — it is the single largest thing that would tell you which',
  `> project wrote this. Score the other ${scored}; sum the ${summed} that are neither withheld`,
  `> nor disqualifiers (${RUBRIC.disqualifying.join(' and ')}).`,
  '>',
  // The block gave a judge three criterion numbers and no document. This is the
  // only channel that certainly reaches them, so the rubric they are numbers in
  // has to travel in it — interpolated from `RUBRIC.source`, so a moved page
  // moves the citation. It names no arm and no tool, so it cannot separate.
  `> The rubric is \`${RUBRIC.source}\`, section "${RUBRIC.section}".`,
].join('\n')

/**
 * What `separation` scans: what this file could not remove, plus what it wrote.
 *
 * The two halves are not the same kind of thing and the verdict says which is
 * which. A declared term that separates is a cost — a tool's name is part of
 * what is being judged and renaming it would put the lie in the artifact. A
 * replacement that separates is this file's own defect, and it is fixable: give
 * both arms the same replacement.
 */
export const SEPARATION_TERMS = [...new Set([...RESIDUAL, ...REPLACEMENTS])]

/** Which half of `SEPARATION_TERMS` a term came from, for the verdict block. */
const kindOf = (term) => (RESIDUAL.includes(term) ? 'declared' : 'replacement')

/**
 * Which scanned terms name an arm, computed from the set this run just wrote.
 *
 * `files` is one entry per emitted file: `{ arm, task, terms }`, where `terms`
 * is the set of `SEPARATION_TERMS` found in it. A term SEPARATES when every file
 * carrying it belongs to one arm and at least one file carries it — at which
 * point the term is that arm's name in all but spelling, and any judge can sort
 * the set without knowing a thing about either project.
 *
 * Reported per term as "names <arm> in n of m pairs", and summarised as the
 * number of pairs at least one term separates, because that last number is the
 * one a reader of a verdict needs: it is how many of the panel's independent
 * judgements were actually independent.
 *
 * A term with zero occurrences does not separate. `System Manual` is declared in
 * `RESIDUAL` and appears nowhere in the current set — the model never quoted
 * that opening back — and a list that counted it as a leak would be reporting a
 * cost nobody paid.
 */
export function separation(files) {
  const pairs = new Set(files.map((file) => file.task))
  const found = []
  for (const term of SEPARATION_TERMS) {
    const carrying = files.filter((file) => file.terms.has(term))
    if (!carrying.length) continue
    const arms = new Set(carrying.map((file) => file.arm))
    if (arms.size !== 1) continue
    found.push({
      term,
      kind: kindOf(term),
      arm: [...arms][0],
      tasks: [...new Set(carrying.map((file) => file.task))].sort(),
      at: new Set(carrying.map((file) => `${file.task}/${file.arm}`)),
    })
  }
  // `harness` and `this harness` are both `SCRUBS` replacements, the scan is a
  // substring scan, and every `harness` in the current set is inside a
  // `this harness`. Two rows for one occurrence reads as two independent leaks
  // and inflates a number the verdict asks a reader to act on, so a term wholly
  // inside a longer separating term over the SAME files is folded into it. A
  // shorter term appearing anywhere the longer one does not still stands alone.
  const covered = (entry) =>
    found.some(
      (other) =>
        other.term.length > entry.term.length &&
        other.term.includes(entry.term) &&
        [...entry.at].every((at) => other.at.has(at)),
    )
  const terms = found
    .filter((entry) => !covered(entry))
    .map(({ term, kind, arm, tasks }) => ({ term, kind, arm, tasks }))
  const separated = new Set(terms.flatMap((entry) => entry.tasks))
  return { terms, pairs: pairs.size, separated: separated.size }
}

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
 *
 * `DISCLOSURE` is spliced in AFTER the scrub rather than before it, so that it
 * reaches every file byte for byte. A scrub rule that happened to match a word
 * in it would make one file's disclosure differ from another's, and a
 * disclosure that differs between arms is one more thing that separates them.
 */
export function blindBody(record, armIds = []) {
  const body = renderBody({
    events: record.run.events,
    answer: record.run.answer,
    requests: false,
  })
  return scrub(`${body}\n`, armIds)
}

/**
 * Title, disclosure, body — split out so `main` can hand `separation` the BODY
 * ALONE. The disclosure is byte-identical in all ten files, so a term inside it
 * appears in both arms and stops separating; scanning it would let a word in
 * this file's own preamble launder that word in every transcript. It already
 * says "harness" four times, which is exactly what `scaffolds?` scrubs to.
 */
export function frame(task, letter, body) {
  return `# ${task} — transcript ${letter}\n\n${DISCLOSURE}\n\n${body}`
}

export function blindTranscript(record, task, letter, armIds = []) {
  return frame(task, letter, blindBody(record, armIds))
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

  const key = {
    index: INDEX,
    at: new Date().toISOString(),
    map: {},
    residual: {},
    rubric: RUBRIC,
  }
  const leaks = []
  const residual = []
  // One row per emitted file, for `separation`. Built here rather than derived
  // from `residual` later because the arm a file belongs to is known only at the
  // moment it is written, and re-reading it out of `key.map` would make the gate
  // depend on the key file it is supposed to be independent of.
  const files = []
  let written = 0

  for (const task of readdirSync(TRANSCRIPTS).sort()) {
    const taskDir = join(TRANSCRIPTS, task)
    const scaffoldIds = readdirSync(taskDir).sort()
    key.map[task] = {}

    scaffoldIds.forEach((scaffoldId, position) => {
      const source = join(taskDir, scaffoldId, `${INDEX}.json`)
      if (!existsSync(source)) return
      const letter = letterFor(task, position)
      const body = blindBody(JSON.parse(readFileSync(source, 'utf8')), scaffoldIds)
      const blinded = frame(task, letter, body)

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
      // The inventory above is `RESIDUAL` over the whole file — declared costs,
      // and a judge reads the disclosure too. The set below is wider by
      // everything the scrub WRITES (see `SEPARATION_TERMS`) and narrower by the
      // disclosure (see `frame`): a replacement reaches only the files whose
      // identifying token it replaced, and a word in the preamble reaches all
      // ten, so scanning the preamble would launder it.
      files.push({
        arm: scaffoldId,
        task,
        terms: new Set(findTerms(body, SEPARATION_TERMS, target).map((hit) => hit.term)),
      })
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

  const split = separation(files)
  key.separation = split
  writeFileSync(KEY, JSON.stringify(key, null, 2), 'utf8')
  console.log(`wrote ${written} transcripts to ${OUT}`)
  console.log(`key written to ${KEY} — OUTSIDE ${OUT}, and the judging step must not read it`)
  console.log(
    `criterion ${RUBRIC.withheld.join(', ')} withheld — declared to the panel in every file`,
  )

  // The honest half of the output. A set with residuals is not blind, and a
  // verdict from it must be read knowing by how much.
  console.log('')
  if (residual.length) {
    // The same `tally` the key file is written from, so the honest half of the
    // output and the key cannot be made to disagree by editing one of them.
    const perFile = Object.entries(Object.groupBy(residual, (hit) => hit.file))
    console.log(
      `DECLARED RESIDUE: ${residual.length} line(s) carrying one of ${RESIDUAL.length} declared identifying term(s), in ${perFile.length} of ${written} file(s).`,
    )
    console.log(
      'These are tool names, and the two system prompts’ opening lines where a model quoted its own instructions back. They are kept because a tool name is part of what is being judged and a model’s own sentence may not be rewritten; see the header of this file. This is the inventory; whether it is FATAL is the last block below, and the answer is whether any of it separates the arms.',
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

  // The gate. Row S39: the version of this that printed NOT BLIND and exited 0
  // was an instrument passing an artifact it had just called broken.
  if (split.terms.length) {
    console.error(
      `\n!! NOT BLIND — ${split.separated} of ${split.pairs} pair(s) can be sorted into arms by a judge who knows nothing about either project:`,
    )
    for (const entry of split.terms) {
      console.error(
        `   ${JSON.stringify(entry.term)} [${entry.kind}] appears only in ${entry.arm}, in ${entry.tasks.length} of ${split.pairs} pair(s)`,
      )
    }
    console.error(
      `   [declared] cannot be scrubbed — a tool's name is part of what is being judged, and renaming it would put the lie in the artifact. So the set is DISCLOSED, not blind: every file carries that statement, and any verdict taken from this set must be recorded with it.`,
    )
    if (split.terms.some((entry) => entry.kind === 'replacement')) {
      console.error(
        `   [replacement] is THIS FILE'S OWN LEAK and is fixable: it is a string the scrub wrote, and it reached one arm because the token it replaced was in one arm. Give both arms the same replacement, or scrub the surviving spelling too. See the header of ${fileURLToPath(import.meta.url)}.`,
      )
    }
    process.exit(1)
  }
  console.log(
    `blind: no declared term appears in one arm's files and no other's, across ${split.pairs} pair(s)`,
  )
}

if (import.meta.main) main()
