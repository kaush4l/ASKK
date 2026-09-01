import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { drive } from '../../bench/driver.js'
import { median, renderBody, resultRow, summarise, tally } from '../../bench/run.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'support', 'fixtures')
const capture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

/**
 * The statistics the rig publishes, and the one renderer it publishes them
 * beside.
 *
 * A report of this rig's own numbers computed a "median" of our arm's 34
 * completion-token values as 1,083 — `sorted[n/2]`, the UPPER MIDDLE of an even
 * list. The median is 896. Nothing in the rig could catch that because the rig
 * printed rows and left the statistic to the reader. It prints the statistic
 * now, and this file is what makes the even case not a matter of luck.
 */

describe('median', () => {
  test('an even list is the mean of the two middles, not the upper one', () => {
    // The exact shape of the reported error, at n=4.
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([1, 2, 3, 4])).not.toBe(3)
  })

  test('the two values the rig’s own even list turns on', () => {
    // Our arm's sorted 34: the 17th is 709 and the 18th is 1,083.
    expect(median([709, 1083])).toBe(896)
  })

  test('an odd list is the middle value', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  test('it sorts what it is given, and does not mutate it', () => {
    const values = [9, 1, 5]
    expect(median(values)).toBe(5)
    expect(values).toEqual([9, 1, 5])
  })

  test('an empty list is zero rather than NaN', () => {
    expect(median([])).toBe(0)
  })
})

describe('summarise', () => {
  const run = (over) => ({
    pass: true,
    stop: 'answered',
    turns: 2,
    tokens: { prompt: 10, completion: 5, total: 15 },
    ms: 1000,
    replies: [{ state: 'whole', completion: 100, model: 'm1' }],
    ...over,
  })

  test('it reports the spread as well as the total', () => {
    const stats = summarise([
      run({ replies: [{ state: 'whole', completion: 10, model: 'm1' }] }),
      run({ replies: [{ state: 'cut', completion: 30, model: 'm1' }] }),
      run({ replies: [{ state: 'whole', completion: 20, model: 'm1' }] }),
      run({ replies: [{ state: 'whole', completion: 40, model: 'm1' }] }),
    ])
    expect(stats.completionTokens).toEqual({ n: 4, min: 10, median: 25, max: 40 })
  })

  test('runs the transport refused are counted, and are not the same as failures', () => {
    // Four of the ten our arm produced in `transcripts/` were scored PASS by a
    // rig that never asked the transport, so these two columns must be separate.
    const stats = summarise([
      run({ pass: true, stop: 'transport-refused' }),
      run({ pass: false, stop: 'answered' }),
      run({ pass: true, stop: 'answered' }),
    ])
    expect(stats.refused).toBe(1)
    expect(stats.passed).toBe(2)
    expect(stats.runs).toBe(3)
  })

  test('every model that answered is listed, once each', () => {
    const stats = summarise([
      run({ replies: [{ state: 'whole', completion: 1, model: 'qwen' }] }),
      run({
        replies: [
          { state: 'whole', completion: 1, model: 'gemma' },
          { state: 'whole', completion: 1, model: 'qwen' },
        ],
      }),
    ])
    expect(stats.models).toEqual(['qwen', 'gemma'])
  })

  test('reply states are tallied, so a refusal rate is never guessed at', () => {
    const stats = summarise([
      run({
        replies: [
          { state: 'whole', completion: 1, model: 'm' },
          { state: 'thinking', completion: 1, model: 'm' },
          { state: 'thinking', completion: 1, model: 'm' },
        ],
      }),
    ])
    expect(stats.replyStates).toEqual({ whole: 1, thinking: 2 })
  })

  test('a run recorded before there were reply rows is read, not crashed on', () => {
    // Measured against this repository's own `bench/results.json`: its thirty
    // rows predate the `replies` column, and `summarise(json.runs)` threw
    // `TypeError: undefined is not an object (evaluating 'reply of
    // run.replies')`. The instrument could not read its own record.
    const stats = summarise([
      { pass: true, stop: 'answered', turns: 4, tokens: { total: 9 }, ms: 5 },
      run({ replies: [{ state: 'whole', completion: 7, model: 'm' }] }),
    ])
    expect(stats.runs).toBe(2)
    expect(stats.tokens).toBe(24)
    expect(stats.completionTokens).toEqual({ n: 1, min: 7, median: 7, max: 7 })
  })

  test('a reply recorded before the transport classified anything says so', () => {
    // The transcripts in this repository predate the transport fix and carry no
    // `state`. They are counted as `unclassified` rather than silently as
    // `whole`, because that difference is the finding.
    const stats = summarise([run({ replies: [{ completion: 1, model: 'm' }] })])
    expect(stats.replyStates).toEqual({ unclassified: 1 })
  })
})

describe('renderBody is one renderer with two projections', () => {
  const events = [
    { type: 'task', at: 0, text: 'do a thing' },
    { type: 'request', at: 1, messages: [{ role: 'system', content: 'SECRET PROMPT' }] },
    {
      type: 'reply',
      at: 1,
      content: 'a reply',
      reasoning: '',
      finish: 'stop',
      state: 'whole',
      notes: [],
      ms: 10,
      usage: { completion_tokens: 3 },
    },
  ]

  test('by default the request is rendered, because a named transcript shows it', () => {
    const out = renderBody({ events, answer: 'done' })
    expect(out).toContain('SECRET PROMPT')
    expect(out).toContain('turn 1 — sent')
  })

  test('`requests: false` drops it, and drops nothing else', () => {
    const out = renderBody({ events, answer: 'done', requests: false })
    expect(out).not.toContain('SECRET PROMPT')
    expect(out).not.toContain('— sent')
    expect(out).toContain('a reply')
    expect(out).toContain('done')
  })

  test('a refused reply is in the transcript, and the text it refused is not', () => {
    const refused = [
      { type: 'task', at: 0, text: 'do a thing' },
      {
        type: 'reply',
        at: 1,
        content: '',
        reasoning: '',
        finish: 'length',
        state: 'thinking',
        notes: [],
        ms: 10,
        usage: { completion_tokens: 1200 },
      },
      {
        type: 'transport-refusal',
        at: 1,
        state: 'thinking',
        message:
          'openai-compatible: the reply ran out of tokens while the model was still thinking',
        hint: 'That text is not an answer and was not passed on',
      },
    ]
    const out = renderBody({ events: refused, answer: '', requests: false })
    expect(out).toContain('the transport refused this reply (thinking)')
    expect(out).toContain('still thinking')
    expect(out).toContain('(the run produced no final answer)')
  })
})

describe('resultRow — the only writer of results.json, driven by a real run', () => {
  /**
   * `results.json` IS the finding. Its row used to be an object literal inside
   * `main`, which no test could reach: five separate falsifications of it —
   * `pass: true`, `stop: 'answered'`, `models: []`, `replies: []`, and
   * `state: 'whole'` on every reply — each left all 129 tests in this directory
   * green. The last one is the whole slice: `summarise().replyStates` then
   * reports `{whole: N}` for both arms and every refusal vanishes from the
   * record.
   *
   * Driven through `drive` against the repository's own recorded reply bodies
   * rather than a hand-built run, for the reason `transport.test.js` gives: a
   * hand-built run is a second opinion about what the endpoint does.
   */
  let realFetch
  let served

  beforeEach(() => {
    realFetch = globalThis.fetch
    served = 0
    // A whole reply, then one the transport refuses — and answered by a
    // DIFFERENT model, which is the case the rig used to discard.
    const bodies = [capture('complete'), capture('spent-in-think')]
    globalThis.fetch = async () =>
      new Response(JSON.stringify(bodies[Math.min(served++, bodies.length - 1)]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  const scaffold = {
    id: 'ours',
    label: 'ours',
    init: () => ({}),
    request: () => ({ messages: [{ role: 'user', content: 'a prompt' }] }),
    parse: () => ({ kind: 'tool' }),
    act: () => ({ observation: 'an observation', ran: [] }),
    observe: () => {},
  }
  const task = { id: 'median-bug', prompt: 'do a thing' }
  const check = {
    pass: false,
    checks: [
      { name: 'the answer is right', ok: false, detail: 'no answer' },
      { name: 'the file was written', ok: true },
    ],
  }

  const row = async () =>
    resultRow({
      task,
      scaffold,
      index: 2,
      run: await drive({ scaffold, task, tools: { calls: [] } }),
      check,
      toolCalls: 3,
      workdir: '/w',
      transcript: '/t/2.md',
    })

  test('the verdict is the check’s, and the ending is the run’s', async () => {
    const written = await row()
    expect(written.pass).toBe(false)
    expect(written.stop).toBe('transport-refused')
    expect(written.turns).toBe(2)
    expect(written.checks).toEqual([
      { name: 'the answer is right', ok: false },
      { name: 'the file was written', ok: true },
    ])
  })

  test('every reply is a row, and each carries the transport’s verdict on it', async () => {
    // The falsification that deletes the finding: with `state` hardcoded, this
    // reads ['whole', 'whole'] and every refusal in the rig's own record is
    // gone with the gate green.
    const written = await row()
    expect(written.replies.map((reply) => reply.state)).toEqual(['whole', 'spent'])
    expect(written.replies.map((reply) => reply.finish)).toEqual(['stop', 'length'])
    expect(written.replies.map((reply) => reply.completion)).toEqual([302, 120])
    expect(written.replies.map((reply) => reply.prompt)).toEqual([84, 23])
    expect(summarise([written]).replyStates).toEqual({ whole: 1, spent: 1 })
  })

  test('what actually answered is recorded, both of them', async () => {
    const written = await row()
    expect(written.models).toEqual([
      'Qwen3.8-27B-Uncensored-oQ4e-fp16-mtp',
      'gemma-4-12B-it-qat-mxfp8',
    ])
  })

  test('the rest of the row is the run and the caller’s, unaltered', async () => {
    const written = await row()
    expect(written.task).toBe('median-bug')
    expect(written.scaffold).toBe('ours')
    expect(written.index).toBe(2)
    expect(written.toolCalls).toBe(3)
    expect(written.workdir).toBe('/w')
    expect(written.transcript).toBe('/t/2.md')
    expect(written.tokens).toEqual({ prompt: 107, completion: 422, total: 529 })
    expect(written.promptSize).toEqual({ messages: 1, chars: 8, systemChars: 0 })
  })
})

describe('tally, the rig’s one counting rule', () => {
  test('it counts by whatever key it is given', () => {
    expect(tally([{ s: 'a' }, { s: 'b' }, { s: 'a' }], (hit) => hit.s)).toEqual({ a: 2, b: 1 })
  })

  test('nothing counts to nothing, rather than to a crash', () => {
    expect(tally([], (hit) => hit.s)).toEqual({})
  })
})

describe('the evidence file survives the ways a run can produce nothing', () => {
  /**
   * Both measured on this repository's own `bench/results.json`, which is 26,499
   * bytes: `bun bench/run.js --task no-such-task-id` replaced it with 334 bytes
   * of `{"runs": []}` and exited 0, and so did `-n 0`. The post-loop write that
   * did it was duplication on the happy path — the write inside the loop runs
   * after every completed run — and destruction on every path where the loops
   * did not run. It is deleted, and `--task` now has the guard `--scaffold` has
   * had all along.
   *
   * A subprocess, because the exit code and the file on disk ARE the claim. No
   * model is asked anything: both paths end before the first call.
   */
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  async function runBench(args, out) {
    const proc = Bun.spawn(['bun', join(REPO, 'bench', 'run.js'), '--out', out, ...args], {
      cwd: REPO,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited])
    return { stderr, code }
  }

  /** A scratch `--out` holding an evidence file this run must not touch. */
  function evidence() {
    const dir = mkdtempSync(join(tmpdir(), 'askk-bench-'))
    writeFileSync(join(dir, 'results.json'), '{"runs":[{"real":true}]}', 'utf8')
    return dir
  }

  test('a mistyped task id is an error, and the results file is untouched', async () => {
    const dir = evidence()
    const { code, stderr } = await runBench(['--task', 'no-such-task-id'], dir)
    expect(code).toBe(1)
    expect(stderr).toContain('no task matches --task no-such-task-id')
    // It names what it would have accepted, because the whole failure mode was
    // a filter that silently matched nothing.
    expect(stderr).toContain('median-bug')
    expect(readFileSync(join(dir, 'results.json'), 'utf8')).toBe('{"runs":[{"real":true}]}')
  })

  test('a run of zero repeats writes nothing at all', async () => {
    const dir = evidence()
    const { code } = await runBench(['-n', '0'], dir)
    expect(code).toBe(0)
    expect(readFileSync(join(dir, 'results.json'), 'utf8')).toBe('{"runs":[{"real":true}]}')
  })
})
