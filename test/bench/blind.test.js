import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  armRules,
  BANNED,
  blindTranscript,
  DISCLOSURE,
  findTerms,
  frame,
  letterFor,
  REPLACEMENTS,
  RESIDUAL,
  RUBRIC,
  SEPARATION_TERMS,
  scrub,
  separation,
} from '../../bench/blind.js'

/**
 * The blind set, held to what it now claims: that it is a PROJECTION of the
 * loop, that everything else is structurally absent rather than scrubbed away,
 * and that what it cannot remove it declares.
 *
 * The panel this file was rewritten for reported nine surviving tool
 * identifiers, both arms recognisable from their opening line, and the key
 * inside the directory a judge is handed. A blind set that quietly leaks is
 * worse than no blind set, because a judge who recognises the harness stops
 * judging the work — and a blind set that LAUNDERS what it cannot remove is
 * worse still, because the lie is then in the artifact.
 */

/** A recorded run in the shape `run.js` writes and `blind.js` reads. */
function record({ answer = 'the final answer' } = {}) {
  return {
    run: {
      answer,
      events: [
        { type: 'task', at: 0, text: 'do a thing' },
        {
          type: 'request',
          at: 1,
          messages: [
            { role: 'system', content: '# Agent Zero System Manual\nyou live in /a0' },
            { role: 'user', content: 'You are a careful, direct assistant' },
          ],
        },
        {
          type: 'reply',
          at: 1,
          content: '{"tool_name":"code_execution_tool","tool_args":{"runtime":"terminal"}}',
          reasoning: '',
          finish: 'stop',
          state: 'whole',
          notes: [],
          model: 'a-model',
          ms: 1000,
          usage: { completion_tokens: 7 },
        },
        { type: 'action', at: 1, action: { kind: 'tool', call: 'read_file({"path":"x"})' } },
        { type: 'observation', at: 1, observation: 'a file', ran: [] },
      ],
    },
  }
}

describe('the projection: a judge is handed the loop and nothing else', () => {
  test('the request block — both system prompts — is structurally absent', () => {
    // The whole leak in one assertion. `5 of 5` files of each arm opened with
    // its own system prompt's first line, at every turn.
    const out = blindTranscript(record(), 'collatz', 'A')
    expect(out).not.toContain('— sent')
    expect(out).not.toContain('You are a careful, direct assistant')
    expect(out).not.toContain('System Manual')
    expect(out).not.toContain('you live in /app')
  })

  test('the header — the label, the verdict, the check list, the departures — never enters', () => {
    // Structural, not textual. `blind.js` reads the run's JSON and asks `run.js`
    // for the body; there is nothing to strip because nothing was rendered.
    // The old version cut the header off a rendered document with
    // `indexOf('\n## task')`, so a heading added above it would have travelled.
    const out = blindTranscript(record(), 'collatz', 'A')
    expect(out.startsWith('# collatz — transcript A')).toBe(true)
    expect(out).not.toContain('check: PASS')
    // The heading `renderTranscript` writes over the `cuts` table. It says
    // "changed, and … deliberately did not" because three of the seventeen rows
    // are `cut: 'nothing'`, and a heading that called those departures was the
    // one part of that table which was not true.
    expect(out).not.toContain('what this scaffold changed')
    expect(out).not.toContain('run 1')
  })

  test('the turn, the parse and the observation all survive — that is the rubric', () => {
    const out = blindTranscript(record(), 'collatz', 'A')
    expect(out).toContain('## task')
    expect(out).toContain('turn 1 — reply')
    expect(out).toContain('turn 1 — parsed as')
    expect(out).toContain('turn 1 — observation')
    expect(out).toContain('the final answer')
  })
})

describe('paths go first, and go whole', () => {
  test('a workspace path carrying the harness’s own name leaves nothing behind', () => {
    // The directory is <repo>/bench/work/<task>/<harness>/<n>, so the harness
    // name is INSIDE a path. A name-level rule running first would rewrite the
    // middle and leave the rest.
    // Pinned as an EQUALITY, not as four absences. Absences pass over a
    // half-rewritten path, because the name-level rules mop up whatever the
    // path rule left — measured: with the absolute-path rule deleted this test
    // stayed green on `not.toContain` assertions alone.
    const line = 'cd /Users/kaush/Downloads/Dev/ASKK/bench/work/collatz/agent-zero/1 && ls'
    expect(scrub(line)).toBe('cd /project && ls')
    expect(scrub('the file tree of /Users/kaush/Downloads/Dev/ASKK/bench/work/x/ours/1:')).toBe(
      'the file tree of /project',
    )
  })

  test('a scratch-harness temp path goes too', () => {
    const out = scrub('/private/tmp/claude-501/-Users-kaush-Downloads-Dev-ASKK/x/rig/work/a')
    expect(out).toBe('/workspace')
  })

  test('the run directory written as a bare relative path goes as well', () => {
    // What a model writes when it echoes its own workspace back with no
    // absolute prefix for the rule above to swallow. The harness id is in it.
    expect(scrub('I wrote it to bench/work/slugify-module/ours/1/src/x.js')).toBe(
      'I wrote it to workspace',
    )
  })
})

describe('the arms’ own names, read off the run', () => {
  test('an arm name inside a bare relative path goes', () => {
    // Measured leak: `no-such-capability/ours/1` appeared six times in one
    // transcript, inside the model's own reasoning, with no absolute prefix for
    // the path rules to swallow. A previous review called `ours` "too common a
    // word to put in BANNED" and left it.
    const line = 'The workspace name no-such-capability/ours/1 suggests a benchmark'
    expect(scrub(line, ['agent-zero', 'ours'])).toBe(
      'The workspace name no-such-capability/this harness/1 suggests a benchmark',
    )
  })

  test('nothing is scrubbed when no arm names are supplied', () => {
    // The set is the directories that actually ran, so an empty set is a
    // no-op rather than a guess.
    expect(scrub('ours/1', [])).toBe('ours/1')
  })

  test('a prose word CONTAINING an arm name is left alone', () => {
    // `yourself` contains `ours`. The scrub is word-bounded and always was;
    // this pins it, because the fix below made the verifier agree.
    expect(scrub('Run the test yourself and make it pass.', ['ours'])).toBe(
      'Run the test yourself and make it pass.',
    )
  })

  test('the rule is built per id, so a third scaffold is covered by existing', () => {
    expect(armRules(['a', 'b']).length).toBe(2)
    expect(scrub('a and b ran', ['a', 'b'])).toBe('this harness and this harness ran')
  })
})

describe('the verifier matches arm names as words and BANNED as substrings', () => {
  test('a substring scan for an arm name reports the middle of a prose word', () => {
    // The mismatch that made `ours` look uncheckable: the scrub is
    // `\b`-anchored, the old verifier was `includes`, so it "found" four leaks
    // in the task prompt that the scrub had correctly left alone.
    const line = 'Run the test yourself'
    expect(findTerms(line, ['ours'], 'f').length).toBe(1)
    expect(findTerms(line, ['ours'], 'f', { wholeWord: true })).toEqual([])
  })

  test('but a whole-word scan still catches the real thing', () => {
    expect(findTerms('no-such-capability/ours/1', ['ours'], 'f', { wholeWord: true }).length).toBe(
      1,
    )
  })

  test('BANNED stays a substring scan, because two of its terms are fragments', () => {
    // `/a0` and `bench/work` are not words; a boundary check would miss them.
    expect(findTerms('cd bench/work/x', ['bench/work'], 'f').length).toBe(1)
    expect(findTerms('the path /a0/tmp', ['/a0'], 'f').length).toBe(1)
  })
})

describe('names', () => {
  test('every spelling of the reference project', () => {
    const out = scrub('Agent Zero System Manual / agent-zero / agent zero / Agent_Zero / frdel')
    for (const term of ['Agent Zero', 'agent-zero', 'agent zero', 'frdel']) {
      expect(out).not.toContain(term)
    }
  })

  test('our own project name, in either casing', () => {
    expect(scrub('ASKK and askk')).not.toMatch(/askk/i)
  })
})

describe('what deliberately survives, and why removing it would be worse', () => {
  test('tool names are NOT renamed — a tool’s name is part of what is judged', () => {
    // The previous version mapped `code_execution_tool` onto `exec` and
    // `read_file` onto `read_text` and called the result blind. A judge shown
    // `exec` cannot see that one harness routes four capabilities through one
    // tool with an `action` argument while the other offers four flat ones,
    // which is exactly the design question the rubric asks about.
    const az = scrub('{"tool_name":"code_execution_tool","tool_args":{"runtime":"terminal"}}')
    expect(az).toContain('code_execution_tool')
    expect(scrub('read_file write_file list_files text_editor')).toBe(
      'read_file write_file list_files text_editor',
    )
  })

  test('the response contract, which is the variable under test', () => {
    // Removing this would leave two transcripts of nothing. A judge who
    // recognises a contract is recognising a DESIGN, which is the judgement
    // being asked for.
    const toon = scrub('think: [a]\n\nplan: [b]\n\nact: tool\n\nresult: list_files({})')
    expect(toon).toContain('think:')
    expect(toon).toContain('act: tool')
    const json = scrub('{"thoughts":["a"],"headline":"h","tool_name":"text_editor"}')
    expect(json).toContain('"thoughts"')
    expect(json).toContain('"headline"')
  })
})

describe('BANNED fails the run; RESIDUAL is declared and reported', () => {
  test('BANNED names both projects, the user and the workspace', () => {
    for (const term of ['agent-zero', 'frdel', 'ASKK', 'kaush', 'bench/work']) {
      expect(BANNED).toContain(term)
    }
  })

  test('every banned term is actually removed by the scrub it guards', () => {
    // The check that would have caught a term added to BANNED with no rule
    // behind it — a verifier that can never pass.
    for (const term of BANNED) {
      const out = scrub(`prefix ${term} suffix`)
      expect(`${term} -> ${out.includes(term)}`).toBe(`${term} -> false`)
    }
  })

  test('every residual term SURVIVES the scrub, or it is not a residual', () => {
    // The inverse rule, and the one that keeps this file honest: a term listed
    // as a declared cost that the scrub quietly removes would make the "NOT
    // BLIND" report a lie in the other direction.
    for (const term of RESIDUAL) {
      const out = scrub(`prefix ${term} suffix`)
      expect(`${term} -> ${out.includes(term)}`).toBe(`${term} -> true`)
    }
  })

  test('the two lists are disjoint', () => {
    // A term in both would be simultaneously fatal and expected.
    for (const term of RESIDUAL) expect(BANNED).not.toContain(term)
  })

  test('a system prompt the MODEL quoted back is declared, not silently kept', () => {
    // Dropping the request block removes both openings AS SENT. It does not
    // remove them as speech: `blind/no-such-capability/B.md` carries `You are a
    // careful, direct assistant` five times, in the reasoning channel and in
    // the reply, because the model rehearsed its own instructions. The gate
    // exited 0 over that file and the NOT BLIND report listed only tool names —
    // one `grep -l` separating that pair, in the artifact whose whole purpose is
    // that it cannot be separated.
    const quoted = record()
    quoted.run.events.push({
      type: 'reply',
      at: 2,
      content: 'Let’s reason from prompt: "You are a careful, direct assistant running…"',
      reasoning: 'The manual (# System Manual) says otherwise',
      finish: 'stop',
      state: 'whole',
      notes: [],
      ms: 1,
      usage: { completion_tokens: 1 },
    })
    const out = blindTranscript(quoted, 'collatz', 'A')
    // Still there — a model's own sentence may not be rewritten…
    expect(out).toContain('You are a careful, direct assistant')
    // …so the report is what has to carry it.
    const found = findTerms(out, RESIDUAL, 'A.md').map((hit) => hit.term)
    expect(found).toContain('You are a careful, direct assistant')
    expect(found).toContain('System Manual')
  })

  test('our transport signs its refusals, and that signature is fatal', () => {
    // `OpenAICompatible._dumped`'s message opens with the class's own label, and
    // the refusal block IS the run's ending, so it is rendered. Measured over
    // `transcripts/`: 12 of one arm's 34 replies are refused and 0 of the
    // other's 79 — one probe, every pair. The block stays; the signature goes.
    const refused = record()
    refused.run.events.push({
      type: 'transport-refusal',
      at: 2,
      state: 'thinking',
      message:
        'openai-compatible: the reply ran out of tokens while the model was still thinking, so 3,940 characters of its private reasoning arrived on the answer channel',
      hint: 'That text is not an answer and was not passed on',
    })
    const out = blindTranscript(refused, 'collatz', 'A')
    expect(out).toContain('the transport refused this reply (thinking)')
    expect(out).toContain('the transport: the reply ran out of tokens')
    expect(out).not.toContain('openai-compatible')
    expect(BANNED).toContain('openai-compatible')
    expect(findTerms(out, BANNED, 'A.md')).toEqual([])
  })

  test('the residual report counts what a judge can see', () => {
    // `blind.js` prints these per file and writes them into the key. The count
    // is what tells a reader of any verdict what it is worth.
    const out = blindTranscript(record(), 'collatz', 'A')
    const found = findTerms(out, RESIDUAL, 'A.md')
    expect(found.map((hit) => hit.term).sort()).toEqual(['code_execution_tool', 'read_file'])
    expect(findTerms(out, BANNED, 'A.md')).toEqual([])
  })
})

describe('A/B assignment', () => {
  test('deterministic for one task, and not the same order for every task', () => {
    const tasks = ['collatz', 'median-bug', 'pointer-chase', 'no-such-capability', 'slugify-module']
    for (const task of tasks) {
      expect(letterFor(task, 0)).toBe(letterFor(task, 0))
      expect(letterFor(task, 0)).not.toBe(letterFor(task, 1))
    }
    // If A were always the same arm the blinding would be decorative.
    const firsts = new Set(tasks.map((task) => letterFor(task, 0)))
    expect(firsts.size).toBe(2)
  })
})

describe('the script itself is the gate', () => {
  /**
   * Driven as a subprocess, because the exit code IS the claim and no unit test
   * can see it — and because `main()` is where the arm ids are read off the
   * directory names and handed to the scrub. Mutating that one argument away
   * left every other test in this file green.
   *
   * No model is asked anything: this runs `bun bench/blind.js` over two
   * transcripts written here.
   */
  const HERE = dirname(fileURLToPath(import.meta.url))
  const REPO = resolve(HERE, '..', '..')

  function fixture(text, arms = ['agent-zero', 'ours']) {
    const root = mkdtempSync(join(tmpdir(), 'askk-blind-'))
    for (const arm of arms) {
      mkdirSync(join(root, 'in', 'probe', arm), { recursive: true })
      writeFileSync(
        join(root, 'in', 'probe', arm, '1.json'),
        JSON.stringify({
          run: {
            answer: arm === arms[1] ? text : 'nothing to see',
            events: [{ type: 'task', at: 0, text: 'do a thing' }],
          },
        }),
        'utf8',
      )
    }
    return root
  }

  async function runBlind(root, extra = []) {
    const proc = Bun.spawn(
      [
        'bun',
        join(REPO, 'bench', 'blind.js'),
        '--transcripts',
        join(root, 'in'),
        '--out',
        join(root, 'out'),
        ...extra,
      ],
      { cwd: REPO, stdout: 'pipe', stderr: 'pipe' },
    )
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { out, err, code, root }
  }

  test('an arm that prints its own directory name is scrubbed — and the scrub’s own token is then reported', async () => {
    // The measured leak, end to end: `no-such-capability/ours/1` in the model's
    // own prose. `main()` reads the arm ids off the transcript directories.
    //
    // This test asserted exit 0 and was wrong to. The arm name is gone, but the
    // string that replaced it reaches only the arm whose name it replaced, so
    // one file now carries `this harness` and no other does — the leak moved a
    // spelling to the left and the gate, which scanned two hand-typed lists,
    // reported nothing. It is a `[replacement]`, distinguished from a
    // `[declared]` cost because it is this file's defect and is fixable.
    const root = fixture('I looked in probe/ours/1 and found it')
    const { code, err, root: at } = await runBlind(root)
    const written = readdirSync(join(at, 'out', 'probe')).sort()
    const bodies = written.map((name) => readFileSync(join(at, 'out', 'probe', name), 'utf8'))
    expect(bodies.join('\n')).toContain('probe/this harness/1')
    expect(bodies.join('\n')).not.toMatch(/\bours\b/)
    expect(code).toBe(1)
    expect(err).toContain('"this harness" [replacement] appears only in ours, in 1 of 1 pair(s)')
    expect(err).toContain("THIS FILE'S OWN LEAK")
  })

  test('an identifier that survives the scrub exits NON-ZERO and names it', async () => {
    // The verifier reads the FINAL text, so a substitution that writes the term
    // back in fails the gate rather than passing it. An arm literally named
    // `harness` is the reachable case: `armRules` rewrites it to `this
    // harness`, which still contains the word.
    //
    // This is the whole gate claim — that a leak exits non-zero — and no unit
    // test can see an exit code. Measured separately by deleting the `kaush`
    // rule from `SCRUBS` and running the script over `bench/transcripts/`:
    // exit 1, `blind/no-such-capability/A.md:18 "kaush"`. Restored: exit 0.
    const root = fixture('I looked in probe/harness/1', ['a-harness', 'harness'])
    const { code, err } = await runBlind(root)
    expect(code).toBe(1)
    expect(err).toContain('identifying string(s) survived the scrub')
    expect(err).toContain('"harness"')
  })

  test('and every emitted file is written anyway, so the leak can be read', async () => {
    const root = fixture('I looked in probe/harness/1', ['a-harness', 'harness'])
    const { root: at } = await runBlind(root)
    expect(readdirSync(join(at, 'out', 'probe')).sort()).toEqual(['A.md', 'B.md'])
  })

  test('a run index that blinds NOTHING exits non-zero instead of verifying', async () => {
    // `existsSync(source)` is a bare `return` per file, so `--index 9` used to
    // write zero files, print "verified: no banned term survives in any emitted
    // file" and exit 0. That is the direct successor of the bug this script's
    // `strict` was added for — `--idnex 2` blinding run 1 and saying nothing —
    // and a gate that passes over zero files is not a gate.
    const root = fixture('nothing')
    const { code, err } = await runBlind(root, ['--index', '9'])
    expect(code).toBe(1)
    expect(err).toContain('nothing was blinded, so nothing is verified')
  })

  test('the key is written OUTSIDE the directory a judge is handed', async () => {
    const root = fixture('nothing')
    const { at } = { at: (await runBlind(root)).root }
    expect(existsSync(join(at, 'out-key.json'))).toBe(true)
    expect(existsSync(join(at, 'out', 'key.json'))).toBe(false)
    // And it carries the map the judge must not see.
    const key = JSON.parse(readFileSync(join(at, 'out-key.json'), 'utf8'))
    expect(Object.values(key.map.probe).sort()).toEqual(['agent-zero', 'ours'])
  })

  test('and the declared cost is counted into the key, per file', async () => {
    // The key and the "NOT BLIND" line are the same `tally` call on the same
    // array, so they cannot disagree — but nothing asserted the key half, and
    // emptying it left every test green. A reader of a verdict from this set
    // needs the count to know what the verdict is worth.
    const root = fixture('I ran read_file\nthen read_file again\nthen list_files')
    const { root: at, out } = await runBlind(root)
    const key = JSON.parse(readFileSync(join(at, 'out-key.json'), 'utf8'))
    const counts = Object.values(key.residual).find((per) => per.read_file)
    expect(counts).toEqual({ read_file: 2, list_files: 1 })
    expect(out).toContain('read_file×2')
    // Counted by LINE, not by occurrence — twice on one line is one hit, because
    // a hit is a place to look and the leak report names line numbers.
    const oneLine = fixture('read_file and read_file again')
    const key2 = JSON.parse(
      readFileSync(join((await runBlind(oneLine)).root, 'out-key.json'), 'utf8'),
    )
    expect(Object.values(key2.residual).find((per) => per.read_file)).toEqual({ read_file: 1 })
  })

  test('a residual term in ONE arm exits non-zero, naming the term and the arm', async () => {
    // Row S39, end to end. Before this change the same fixture printed
    // `NOT BLIND: … 1 of 2 file(s)` and exited 0. No unit test can see an exit
    // code, and `separation` returning `{terms: []}` unconditionally left every
    // assertion in the block above green — measured.
    const root = fixture('I called read_file and then write_file')
    const { code, err } = await runBlind(root)
    expect(code).toBe(1)
    expect(err).toContain('NOT BLIND — 1 of 1 pair(s)')
    expect(err).toContain('"read_file" [declared] appears only in ours, in 1 of 1 pair(s)')
  })

  test('the same term in BOTH arms is vocabulary, and the gate goes green', async () => {
    // The reachable pass. `fixture` gives the text to one arm only, so this
    // writes the second copy by hand — the point being that the gate is not
    // stuck red by construction, it is red because of what the arms are called.
    const root = fixture('I called read_file')
    writeFileSync(
      join(root, 'in', 'probe', 'agent-zero', '1.json'),
      JSON.stringify({
        run: { answer: 'I called read_file', events: [{ type: 'task', at: 0, text: 'a thing' }] },
      }),
      'utf8',
    )
    const { code, out } = await runBlind(root)
    expect(code).toBe(0)
    expect(out).toContain('blind: no declared term appears in')
  })

  test('the key records the separation, so a verdict cannot be read without it', async () => {
    const root = fixture('I called read_file')
    const { root: at } = await runBlind(root)
    const key = JSON.parse(readFileSync(join(at, 'out-key.json'), 'utf8'))
    expect(key.separation).toMatchObject({ pairs: 1, separated: 1 })
    expect(key.separation.terms).toEqual([
      { term: 'read_file', kind: 'declared', arm: 'ours', tasks: ['probe'] },
    ])
    expect(key.rubric.withheld).toEqual(RUBRIC.withheld)
  })

  test('and the files are written anyway, each carrying the disclosure', async () => {
    // A gate that deletes the evidence of its own failure cannot be audited,
    // and the panel that gets handed this set anyway must still be told.
    const root = fixture('I called read_file')
    const { root: at } = await runBlind(root)
    for (const name of readdirSync(join(at, 'out', 'probe'))) {
      expect(readFileSync(join(at, 'out', 'probe', name), 'utf8')).toContain(DISCLOSURE)
    }
  })
})

/**
 * The gate `docs/LEDGER.md` row S39 was filed for: the script printed
 * `NOT BLIND: 137 line(s) …` and exited 0.
 *
 * The claim under test is not "identifying terms are gone" — they are not, on
 * purpose. It is that a term which NAMES AN ARM is fatal, that the arithmetic
 * saying so is derived from the set rather than typed in, and that the panel is
 * told in the one channel that reaches it.
 */
describe('separation is what makes a set not blind', () => {
  const file = (arm, task, ...terms) => ({ arm, task, terms: new Set(terms) })

  test('a term in one arm and no other names that arm, and the pair is separated', () => {
    const split = separation([
      file('ours', 'a', 'read_file'),
      file('agent-zero', 'a'),
      file('ours', 'b', 'read_file'),
      file('agent-zero', 'b'),
    ])
    expect(split.terms).toEqual([
      { term: 'read_file', kind: 'declared', arm: 'ours', tasks: ['a', 'b'] },
    ])
    expect(split).toMatchObject({ pairs: 2, separated: 2 })
  })

  test('one pair does NOT reach the green state, and the header said it did', () => {
    // There is no pair-count floor, deliberately: a gate a smaller run walks
    // past is row S39 again. Measured over `transcripts/collatz` alone:
    // `!! NOT BLIND — 1 of 1 pair(s)`, exit 1.
    const split = separation([file('ours', 'a', 'read_file'), file('agent-zero', 'a')])
    expect(split).toMatchObject({ pairs: 1, separated: 1 })
  })

  test('a string the SCRUB wrote separates too, and is reported as this file’s own leak', () => {
    // The defect the two hand-typed lists could not see. A replacement reaches
    // only the files whose identifying token it replaced, so a token that named
    // an arm becomes a replacement that names it — same separating power, new
    // spelling, invisible to a scan of `RESIDUAL`. Measured on the set in
    // `blind/` when this landed: `this harness` in one `ours` file and
    // `/workspace` in one `agent-zero` file, two pairs the verdict was silent
    // about. The near miss is `openai-compatible` → `the transport`, added
    // against a leak measured at 5 of 5 pairs.
    expect(REPLACEMENTS).toContain('this harness')
    expect(REPLACEMENTS).toContain('the transport')
    const split = separation([
      file('ours', 'a', 'this harness'),
      file('agent-zero', 'a', 'the transport'),
    ])
    expect(split.terms).toEqual([
      { term: 'the transport', kind: 'replacement', arm: 'agent-zero', tasks: ['a'] },
      { term: 'this harness', kind: 'replacement', arm: 'ours', tasks: ['a'] },
    ])
    expect(split.separated).toBe(1)
  })

  test('a shorter replacement wholly inside a longer one is one leak, not two', () => {
    // `scaffolds?` scrubs to `harness` and an arm id scrubs to `this harness`;
    // the scan is a substring scan, so every `harness` in the current set is
    // inside a `this harness`. Reported separately it read as two independent
    // leaks over one occurrence, and the verdict's own argument is that its
    // numbers are what a reader of a panel result acts on.
    const split = separation([
      file('ours', 'a', 'harness', 'this harness'),
      file('agent-zero', 'a'),
    ])
    expect(split.terms.map((entry) => entry.term)).toEqual(['this harness'])
  })

  test('but the same short term somewhere the long one is not still stands alone', () => {
    // The fold is per file set, not per spelling: `harness` in a pair where
    // `this harness` never appears is its own leak and must survive.
    const split = separation([
      file('ours', 'a', 'harness', 'this harness'),
      file('agent-zero', 'a'),
      file('ours', 'b', 'harness'),
      file('agent-zero', 'b'),
    ])
    expect(split.terms.map((entry) => entry.term).sort()).toEqual(['harness', 'this harness'])
  })

  test('every replacement the scrub can write is in the scanned set', () => {
    // The rule that keeps the two from drifting: adding a `SCRUBS` row adds a
    // string to the artifact, and a string in the artifact this gate does not
    // scan is a leak it cannot report.
    for (const replacement of REPLACEMENTS) expect(SEPARATION_TERMS).toContain(replacement)
    for (const term of RESIDUAL) expect(SEPARATION_TERMS).toContain(term)
  })

  test('a term BOTH arms use separates nothing — it is vocabulary, not identity', () => {
    // The green state, and the only one reachable without changing what a
    // harness calls its own tools: two arms that spell a capability the same
    // way. A gate whose pass is unreachable teaches readers to ignore it.
    const split = separation([file('ours', 'a', 'read_file'), file('agent-zero', 'a', 'read_file')])
    expect(split.terms).toEqual([])
    expect(split.separated).toBe(0)
  })

  test('a declared term nobody wrote is not a leak', () => {
    // `System Manual` is in RESIDUAL and appears in zero files of the current
    // set — the model never quoted that opening back. Counting a cost nobody
    // paid would make the gate red for a term with no occurrence anywhere.
    const split = separation([file('ours', 'a'), file('agent-zero', 'a')])
    expect(split.terms).toEqual([])
    expect(RESIDUAL).toContain('System Manual')
  })

  test('the separated count is PAIRS, not terms — five terms over one pair is one pair', () => {
    // The number a reader of a verdict needs is how many of the panel's
    // independent judgements were actually independent. Summing terms would
    // report six where one pair was compromised.
    const split = separation([
      file('ours', 'a', 'read_file', 'write_file', 'list_files'),
      file('agent-zero', 'a', 'text_editor'),
      file('ours', 'b'),
      file('agent-zero', 'b'),
    ])
    expect(split.terms).toHaveLength(4)
    expect(split.separated).toBe(1)
    expect(split.pairs).toBe(2)
  })
})

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('the disclosure the panel is handed', () => {
  test('carries no banned and no residual term', () => {
    // The trap this test was written for: the disclosure is prepended to EVERY
    // file, so a disclosure naming `read_file` put that term in both arms'
    // files and turned the gate green over a set nothing had changed. That is
    // now closed in the code as well — `main` hands `separation` the BODY, not
    // the framed file, so the preamble cannot make a term universal. The
    // assertion stays because the two halves it guards are different: a BANNED
    // term here is a leak in ten files, and a RESIDUAL term here inflates the
    // declared-residue inventory in every one of them.
    expect(findTerms(DISCLOSURE, BANNED, 'disclosure')).toEqual([])
    expect(findTerms(DISCLOSURE, RESIDUAL, 'disclosure')).toEqual([])
  })

  test('and a term inside it can no longer launder that term in every file', () => {
    // The structural half. The disclosure says "harness" four times, which is
    // exactly what `scaffolds?` scrubs to; if `separation` read the framed file
    // that replacement could never be reported again, in any set, forever.
    const body = 'a body naming this harness and nothing else'
    expect(frame('probe', 'A', body)).toContain('harness')
    expect(findTerms(body, SEPARATION_TERMS, 'body').map((hit) => hit.term)).toContain(
      'this harness',
    )
  })

  test('it names the rubric it hands a judge three criterion numbers of', () => {
    // A judge reached only through this block had the numbers and no document.
    // Interpolated, so a moved page moves the citation; and the page really has
    // that heading, checked against the page rather than against this string.
    expect(DISCLOSURE).toContain(`\`${RUBRIC.source}\`, section "${RUBRIC.section}"`)
    expect(readFileSync(join(REPO, RUBRIC.source), 'utf8')).toContain(`## ${RUBRIC.section}`)
  })

  test('names no arm, so it cannot itself be the label', () => {
    // Checked with the gate's own whole-word matcher against the arm ids read
    // off the recorded runs, not against a typed pair: `agent harnesses` is
    // English and `agent-zero` is a name, and a substring scan cannot tell them
    // apart. That is the same mistake `findTerms`' `wholeWord` was added for.
    const arms = readdirSync(join(REPO, 'bench', 'transcripts', 'collatz')).sort()
    expect(arms.length).toBeGreaterThan(1)
    expect(findTerms(DISCLOSURE, arms, 'disclosure', { wholeWord: true })).toEqual([])
  })

  test('the two counts it gives a judge are DERIVED from the rubric, not typed', () => {
    // Three numbers typed into a paragraph go stale the first time the rubric
    // gains a row, silently, in the artifact a panel reads.
    const scored = RUBRIC.criteria - RUBRIC.withheld.length
    const summed = scored - RUBRIC.disqualifying.length
    expect(DISCLOSURE).toContain(`Score the other ${scored}`)
    expect(DISCLOSURE).toContain(`sum the ${summed} that are neither withheld`)
    expect(scored).toBe(7)
    expect(summed).toBe(5)
  })

  test('it reaches the transcript, above the run and below nothing but the title', () => {
    const text = blindTranscript(record(), 'probe', 'A')
    expect(text.indexOf(DISCLOSURE)).toBeGreaterThan(-1)
    expect(text.indexOf(DISCLOSURE)).toBeLessThan(text.indexOf('## task'))
  })
})

describe('the rubric and the instrument say the same thing', () => {
  /**
   * P5: `blind.js` drops the assembled prompt, criterion 1 is about the prompt,
   * so this tree scored 1 on criterion 1 no matter what it did. The repair is
   * in the rubric — the argument is in `blind.js`'s header — and a repair that
   * lives in two files is a repair that comes apart. This reads the page.
   */
  const rubric = () => readFileSync(join(REPO, RUBRIC.source), 'utf8')

  test('the page exists where the instrument says it does', () => {
    expect(existsSync(join(REPO, RUBRIC.source))).toBe(true)
  })

  test('the page has exactly the number of criteria the instrument counts', () => {
    const rows = [...rubric().matchAll(/^\| (\d) \| \*\*/gm)].map((m) => Number(m[1]))
    expect(rows).toEqual(Array.from({ length: RUBRIC.criteria }, (_, at) => at + 1))
  })

  test('the page declares the same disqualifiers', () => {
    expect(rubric()).toContain(
      `Criteria **${RUBRIC.disqualifying.join('** and **')}** are disqualifying at 1`,
    )
  })

  test('the page withholds what the instrument withholds, and says not to sum it', () => {
    for (const at of RUBRIC.withheld) {
      expect(rubric()).toContain(`criterion ${at} is WITHHELD: not\nscored, and not summed`)
    }
    expect(rubric()).toContain('minus any criterion the projection **withheld**')
  })

  test('and it no longer says the withheld criterion is scored 1', () => {
    // The sentence that made criterion 1 unanswerable-by-construction rather
    // than withheld. It survives, narrowed to the TRANSCRIPT, beside a second
    // rule for the PROJECTION — the two are the same rule read from different
    // ends, and the test pins both halves because deleting either restores P5.
    expect(rubric()).toContain('A criterion the **transcript** cannot answer is scored 1')
    expect(rubric()).toContain('A criterion the **projection** withholds from both arms equally')
    expect(rubric()).not.toContain('criterion 1 cannot be scored at\nall')
  })
})

/**
 * `docs/LEDGER.md` row S38: `.gitignore` said `bench/blind/<task>/{A,B}.md` "ARE
 * committed" and exempted `bench/transcripts/` and `bench/results.json` from the
 * ignore list on the argument that evidence outside the repository is not
 * evidence — and then `git ls-files bench` returned 0. Not being ignored is not
 * the same as being tracked, and the file stated the confusion as its opposite.
 *
 * The rows are tracked as of `25c8750`. This is what stops them going back:
 * a prose claim in `.gitignore` with nothing that can fail is how it got there.
 */
describe('the artifact and the evidence are in the repository, not on one machine', () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const tracked = (path) =>
    Bun.spawnSync(['git', 'ls-files', '-z', path], { cwd: REPO })
      .stdout.toString()
      .split('\0')
      .filter(Boolean)

  test('every blinded transcript a panel is handed is tracked', () => {
    const emitted = readdirSync(join(REPO, 'bench', 'blind'))
      .flatMap((task) =>
        readdirSync(join(REPO, 'bench', 'blind', task)).map(
          (name) => `bench/blind/${task}/${name}`,
        ),
      )
      .sort()
    expect(emitted.length).toBeGreaterThan(0)
    expect(tracked('bench/blind').sort()).toEqual(emitted)
  })

  test('so is the evidence the runs produced', () => {
    expect(tracked('bench/transcripts').length).toBeGreaterThan(0)
    expect(tracked('bench/results.json')).toEqual(['bench/results.json'])
  })

  test('and the key, which decodes them, is NOT', () => {
    // The one file whose absence from the repository is the point.
    expect(tracked('bench/blind-key.json')).toEqual([])
    expect(existsSync(join(REPO, 'bench', 'blind-key.json'))).toBe(true)
  })

  /**
   * The ten files a panel is handed are TRACKED and GENERATED, and nothing tied
   * the two together: every other test in this file drives `blind.js` over a
   * fixture in `tmpdir()`, and the artifact in the repository is whatever the
   * last process to touch that directory left there — a mutation run, an
   * `--index 2` run, a run from a branch.
   *
   * Observed in this tree: a mutation run left `bench/blind/collatz/A.md`
   * carrying a disclosure that named all five tool names and both prompt
   * openings — the laundering the disclosure's own test exists to prevent —
   * while `blind.js` on disk was clean and the whole suite was green. The gate
   * cannot see it either: it overwrites each file before it scans it, so it only
   * ever checks bytes it just wrote, never bytes in the repository.
   */
  test('the tracked set is what today’s script emits from the tracked transcripts', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'askk-regen-')), 'out')
    // Exit 1 is the expected verdict on this set today; the files are written
    // anyway, which is what makes them comparable.
    await Bun.spawn(
      [
        'bun',
        join(REPO, 'bench', 'blind.js'),
        '--transcripts',
        join(REPO, 'bench', 'transcripts'),
        '--out',
        out,
      ],
      { cwd: REPO, stdout: 'ignore', stderr: 'ignore' },
    ).exited
    const here = join(REPO, 'bench', 'blind')
    for (const task of readdirSync(here).sort()) {
      for (const name of readdirSync(join(here, task)).sort()) {
        // The tuple is so a failure names the file instead of printing two 12 KB
        // blobs at a reader who then has to diff them by eye.
        expect([`${task}/${name}`, readFileSync(join(out, task, name), 'utf8')]).toEqual([
          `${task}/${name}`,
          readFileSync(join(here, task, name), 'utf8'),
        ])
      }
    }
  })
})
