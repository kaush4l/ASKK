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
  findTerms,
  letterFor,
  RESIDUAL,
  scrub,
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

  test('an arm that prints its own directory name is scrubbed, not leaked', async () => {
    // The measured leak, end to end: `no-such-capability/ours/1` in the model's
    // own prose. `main()` reads the arm ids off the transcript directories.
    const root = fixture('I looked in probe/ours/1 and found it')
    const { code, root: at } = await runBlind(root)
    expect(code).toBe(0)
    const written = readdirSync(join(at, 'out', 'probe')).sort()
    const bodies = written.map((name) => readFileSync(join(at, 'out', 'probe', name), 'utf8'))
    expect(bodies.join('\n')).toContain('probe/this harness/1')
    expect(bodies.join('\n')).not.toMatch(/\bours\b/)
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
})
