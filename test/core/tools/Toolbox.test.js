import { describe, expect, test } from 'bun:test'
import { Outcome, Reason } from '../../../src/core/Outcome.js'
import { ReActResponse } from '../../../src/core/response/ReActResponse.js'
import { Tool } from '../../../src/core/tools/Tool.js'
import { Toolbox } from '../../../src/core/tools/Toolbox.js'
import { fixture, readSse } from '../../support/fixtures.js'

/**
 * The seam where a model's text becomes an action, and the one place in the
 * loop where being subtly wrong is invisible.
 *
 * The balanced-bracket scanner exists because a regex stopping at the first
 * `)` truncates `shell({"command": "echo (hi)"})` into something that still
 * parses as JSON and still runs — a wrong command, not an error. Nothing
 * downstream can tell. So the arguments here are checked by putting them
 * through `JSON.parse` and reading what the tool was actually handed, not by
 * comparing the substring the scanner cut.
 *
 * The other half is that `run` is the loop's only defence against a badly
 * behaved model: three different kinds of nonsense must all come back as
 * sentences the agent can read, and none of them may throw.
 */

/** A tool that records what it was handed and answers with what it was told to. */
class RecordingTool extends Tool {
  constructor({ name, answer = Outcome.ok('ok'), onCall }) {
    super({ name, description: `the ${name} tool`, parameters: { q: { type: 'string' } } })
    this.received = []
    this.answer = answer
    this.onCall = onCall
  }

  async call(args) {
    this.received.push(args)
    if (this.onCall) return this.onCall(args)
    return this.answer
  }
}

describe('Toolbox.parse', () => {
  test('parentheses and escaped quotes inside a JSON string survive the scan', async () => {
    const line = 'search({"q": "a (b) \\"c\\"", "n": 2})'
    const lines = Toolbox.parse(line)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(1)
    expect(lines[0][0].name).toBe('search')
    expect(lines[0][0].raw).toBe(line)
    // The point of the whole scanner: the arguments the tool receives are the
    // arguments the model wrote, brackets and quotes and all.
    expect(JSON.parse(lines[0][0].argText)).toEqual({ q: 'a (b) "c"', n: 2 })
  })

  test('an unescaped close bracket inside a string does not end the call', () => {
    const [[call]] = Toolbox.parse('shell({"command": "echo ) done"})')

    expect(JSON.parse(call.argText)).toEqual({ command: 'echo ) done' })
  })

  test('a close bracket after an escaped quote does not end the call either', () => {
    // The case that needs the escape tracking AND the string tracking at once:
    // read either wrongly and the scan stops at the `)` inside the quotes,
    // producing an argText that no longer parses — which the agent is then told
    // is bad JSON, for a call it wrote correctly.
    const line = 'shell({"command": "echo \\"a ) b\\" > /tmp/x"})'
    const [[call]] = Toolbox.parse(line)

    expect(call.raw).toBe(line)
    expect(JSON.parse(call.argText)).toEqual({ command: 'echo "a ) b" > /tmp/x' })
  })

  test('two calls on one line are one group of two', () => {
    const lines = Toolbox.parse('alpha({"a": 1}) beta({"b": ")"})')

    expect(lines).toHaveLength(1)
    expect(lines[0].map((c) => c.name)).toEqual(['alpha', 'beta'])
    expect(JSON.parse(lines[0][1].argText)).toEqual({ b: ')' })
  })

  test('calls on separate lines stay separate groups, in order', () => {
    const lines = Toolbox.parse('first({}) second({})\nthird({})')

    expect(lines.map((group) => group.map((c) => c.name))).toEqual([['first', 'second'], ['third']])
  })

  test('an unterminated bracket ends the line but keeps the call before it', () => {
    // A truncated reply is the common case, not the exotic one: the model hit
    // its token limit mid-call. What already parsed is still work that was
    // asked for.
    expect(Toolbox.parse('ok({"a": 1}) bad({"b"')).toEqual([
      [{ name: 'ok', argText: '{"a": 1}', raw: 'ok({"a": 1})' }],
    ])
    // Nothing complete at all on the line means the line contributes nothing.
    expect(Toolbox.parse('bad({"b"')).toEqual([])
  })

  test('a line with no call yields no group at all', () => {
    expect(Toolbox.parse('I will now search the web.')).toEqual([])
    expect(Toolbox.parse('')).toEqual([])
    expect(Toolbox.parse(null)).toEqual([])
  })

  test('prose containing brackets IS read as a call, and that is why run must be forgiving', () => {
    // This records a COST, not a promise. The scanner takes any identifier
    // before a bracket, so prose becomes a call to a tool nobody has — which is
    // survivable only because `runOne` answers an unknown name with a sentence
    // rather than failing. If the scanner is ever tightened to require an
    // argument that parses, this test is wrong and is rewritten with it; it is
    // not a behaviour anything downstream may rely on.
    const [[call]] = Toolbox.parse('let me think (aloud) about it')

    expect(call.name).toBe('think')
    expect(call.argText).toBe('aloud')
  })
})

describe('Toolbox.run — nonsense comes back as something to read', () => {
  test('an unknown tool names what is available instead of failing', async () => {
    const box = new Toolbox([new RecordingTool({ name: 'shell' })])

    const { observation, count } = await box.run('lookup({"q": "x"})')

    expect(count).toBe(1)
    expect(observation).toContain('there is no tool called lookup')
    expect(observation).toContain('Available: shell')
    expect(observation).toContain('lookup({"q": "x"})')
  })

  test('an empty toolbox says so rather than listing nothing', async () => {
    const { observation } = await new Toolbox().run('lookup({})')

    expect(observation).toContain('Available: none')
  })

  test('unparseable arguments report the parse error and the shape wanted', async () => {
    const tool = new RecordingTool({ name: 'echo' })
    const box = new Toolbox([tool])

    const { observation, count } = await box.run("echo({q: 'x'})")

    expect(count).toBe(1)
    expect(observation).toContain('the arguments were not valid JSON')
    expect(observation).toContain('{"key": "value"}')
    // The tool was never reached, so nothing ran on arguments nobody could read.
    expect(tool.received).toEqual([])
  })

  test('a tool that fails is quoted with its message and hint, and the turn goes on', async () => {
    const box = new Toolbox([
      new RecordingTool({
        name: 'shell',
        answer: Outcome.failed(Reason.UNAVAILABLE, 'the sandbox is not built', {
          hint: 'Set SANDBOX_IMAGE.',
        }),
      }),
    ])

    const { observation } = await box.run('shell({"command": "ls"})')

    expect(observation).toBe('shell -> failed: the sandbox is not built (Set SANDBOX_IMAGE.)')
  })

  test.failing('a tool that throws should be an observation too, and is not', async () => {
    // The defect, written as the behaviour that is wanted rather than as the
    // behaviour that exists. `tool.call(args)` in `runOne` is the one fallible
    // call there that is not wrapped: every other kind of nonsense comes back
    // as a sentence, and this one takes the whole run with it.
    //
    // Marked `.failing` on purpose. Pinned green — asserting the throw — this
    // would go RED the day somebody wraps the call in `Outcome.attempt`, and
    // read as a regression for making the repair. This way the repair turns the
    // marker red instead, which says exactly the right thing: delete the
    // marker, the defect is gone.
    const box = new Toolbox([
      new RecordingTool({
        name: 'bad',
        onCall: () => {
          throw new Error('I am not written to the contract')
        },
      }),
    ])

    const { observation } = await box.run('bad({})')

    expect(observation).toContain('I am not written to the contract')
  })

  test('a note the tool carried up is printed, not binned one statement short of its reader', async () => {
    const box = new Toolbox([
      new RecordingTool({
        name: 'fetch',
        answer: Outcome.ok('the page said 0.15.2', [
          'the declared charset was unknown, so utf-8 was used',
        ]),
      }),
    ])

    const { observation } = await box.run('fetch({"q": "x"})')

    // `notes` is the only channel a tool has for "here is what I repaired or
    // lost on the way", and this was the end of it: every tool in the tree
    // threads them carefully and the last line before the agent dropped them.
    // A truncated body reported as `value` and its reason reported as a `note`
    // reached the model as "the response had no readable content".
    expect(observation).toContain('the page said 0.15.2')
    expect(observation).toContain('the declared charset was unknown')
  })

  test('a tool with nothing to add prints no empty note decoration', async () => {
    const box = new Toolbox([new RecordingTool({ name: 'shell', answer: Outcome.ok('linux') })])

    expect((await box.run('shell({"q": "x"})')).observation).toBe('shell -> linux')
  })

  test('no call at all tells the model how to write one', async () => {
    const { observation, count } = await new Toolbox([new RecordingTool({ name: 'shell' })]).run(
      'I think I should look it up.',
    )

    expect(count).toBe(0)
    expect(observation).toContain('no tool call was found')
    expect(observation).toContain('tool_name({"key": "value"})')
  })

  test('every call is counted, across lines', async () => {
    const box = new Toolbox([new RecordingTool({ name: 'a' }), new RecordingTool({ name: 'b' })])

    const { count, observation } = await box.run('a({}) b({})\na({})')

    expect(count).toBe(3)
    expect(observation.split('\n')).toHaveLength(3)
  })
})

describe('Toolbox.run — the scheduling model', () => {
  test('calls on one line overlap; the next line waits for the whole line above', async () => {
    const order = []
    const slow = (name) => async () => {
      order.push(`start ${name}`)
      // Two ticks, so a sequential implementation could not interleave by luck.
      await Promise.resolve()
      await Promise.resolve()
      order.push(`end ${name}`)
      return Outcome.ok(name)
    }
    const box = new Toolbox([
      new RecordingTool({ name: 'a', onCall: slow('a') }),
      new RecordingTool({ name: 'b', onCall: slow('b') }),
      new RecordingTool({ name: 'c', onCall: slow('c') }),
    ])

    const { observation } = await box.run('a({}) b({})\nc({})')

    expect(order).toEqual(['start a', 'start b', 'end a', 'end b', 'start c', 'end c'])
    // Observations stay in written order even though two of them raced.
    expect(observation).toBe('a -> a\nb -> b\nc -> c')
  })

  test('arguments reach the tool decoded, not as text', async () => {
    const tool = new RecordingTool({ name: 'shell' })
    await new Toolbox([tool]).run('shell({"command": "echo \\"a (b)\\"", "timeout": 30})')

    expect(tool.received).toEqual([{ command: 'echo "a (b)"', timeout: 30 }])
  })

  test('a call with no arguments at all is run with an empty object', async () => {
    const tool = new RecordingTool({ name: 'ping' })
    await new Toolbox([tool]).run('ping()')

    expect(tool.received).toEqual([{}])
  })
})

describe('Toolbox.render', () => {
  test('empty renders nothing, so the prompt gets no empty TOOLS heading', () => {
    expect(new Toolbox().render()).toBe('')
  })

  test('the block names every tool and states the scheduling rule', () => {
    const box = new Toolbox([new RecordingTool({ name: 'shell' })])

    const rendered = box.render()

    expect(rendered.startsWith('# TOOLS')).toBe(true)
    expect(rendered).toContain('- shell({"q": string})')
    expect(rendered).toContain('the shell tool')
    expect(rendered).toContain('Calls on one line run at the same time')
  })

  test('a tool with no name is not registered, so it can never be called', () => {
    const box = new Toolbox([{ description: 'nameless' }, new RecordingTool({ name: 'real' })])

    expect(box.names).toEqual(['real'])
  })
})

/**
 * The incident, driven end to end from the bytes that caused it.
 *
 * Nothing in this block is written by hand. The text comes off
 * `test/support/fixtures/truncated-in-think.sse` — a real streamed reply from
 * the testbed model that ran out of tokens inside its think block — and it goes
 * through the real `ReActResponse.parse` and the real `Toolbox.parse` to the
 * call that would have been executed.
 *
 * What the model was doing when it wrote that call is the whole point. It was
 * rehearsing the response format to itself:
 *
 *     Could format:
 *     think: ...
 *     plan: ...
 *     act: shell({"command": "uname -a"})
 *
 * `...` is literally what it wrote. This is not a decision, it is a worked
 * example of what a decision would look like — and the agent ran it.
 */
describe('the reasoning dump that ran a command', () => {
  /** The content channel of the captured stream: 960 characters of scratchpad. */
  const dump = readSse(fixture('truncated-in-think.sse')).content

  /**
   * The same reply, cut where a smaller `max_tokens` would have cut it — at the
   * end of the rehearsed `act:` line, 676 characters in instead of 960. Nothing
   * is added and nothing is reordered; only the tail is missing, which is what
   * a token limit does.
   */
  const REHEARSED = 'act: shell({"command": "uname -a"})'
  const earlier = dump.slice(0, dump.indexOf(REHEARSED) + REHEARSED.length)

  test('the response layer promotes the rehearsal to a decision', () => {
    const parsed = ReActResponse.parse(earlier)

    // `act` came from a line inside a paragraph of first-person reasoning, and
    // `ReActResponse.normalize` saw a `(` in it, moved it to `result` and set
    // the act to 'tool'. That promotion is what turns a mention into an action.
    //
    // The symbol, not a line number. This comment used to cite
    // `response/ReActResponse.js:309-312`; that file is 102 lines long and has
    // never had a line 309, because it was rewritten by its owner while this
    // test was being written. A line citation into a file you do not own goes
    // stale in silence, and this one did so within the hour.
    //
    // IF THIS TEST FAILS, read it before changing it: an `act` of 'answer' here
    // means the response layer stopped promoting a mention, which is the second
    // half of this fix landing. Assert 'answer' instead and keep the toolbox
    // test below, which is about the toolbox and not about who fed it.
    expect(parsed.act).toBe('tool')
    expect(parsed.isToolCall).toBe(true)
    expect(parsed.result).toBe('shell({"command": "uname -a"})')
  })

  test('and the toolbox then runs it — the observed defect, reproduced', async () => {
    const tool = new RecordingTool({ name: 'shell', answer: Outcome.ok('Linux 6.1.0') })
    const parsed = ReActResponse.parse(earlier)

    const { count } = await new Toolbox([tool]).run(String(parsed.answer))

    // A command executed on the user's behalf that the user did not ask for and
    // the model did not decide on. This test is the record that it happens, and
    // `OpenAICompatible._state` is what stops the text ever reaching here.
    expect(count).toBe(1)
    expect(tool.received).toEqual([{ command: 'uname -a' }])
  })

  test('the UNCUT dump mines FOUR calls out of one paragraph of thinking', async () => {
    // Not one. The reply mentions the tool four times while reasoning about
    // whether to use it — twice as the signature `shell(command)` copied out of
    // the TOOLS block, twice as the rehearsed call — and every one of them is a
    // `name(` followed by balanced brackets, so every one of them runs.
    const tool = new RecordingTool({ name: 'shell', answer: Outcome.ok('Linux 6.1.0') })
    const { observation, count } = await new Toolbox([tool]).run(dump)

    expect(count).toBe(4)
    // Two of the four reached the tool. The other two were the bare signature
    // `shell(command)`, whose arguments are not JSON, so they came back to the
    // agent as a complaint about its own reasoning. Two ran.
    expect(tool.received).toEqual([{ command: 'uname -a' }, { command: 'uname -a' }])
    expect(observation).toContain('were not valid JSON')
    // 88 characters of call in 960 characters of text — 9%. The toolbox does not
    // refuse it, because guessing about English is not its job, but it stops
    // being silent about the ratio. Asserted through the observation the agent
    // actually reads, rather than by recomputing the share with the arithmetic
    // that produced it.
    expect(observation).toContain('most of that result was prose rather than calls')
  })

  test('a call wrapped in one sentence of explanation is NOT called prose', async () => {
    // The line that keeps the measure from being a nuisance: a model that says
    // what it is about to do, and then does it, passes silently.
    const tool = new RecordingTool({ name: 'shell' })
    const { observation } = await new Toolbox([tool]).run(
      'Checking the kernel: shell({"command": "uname -a"})',
    )

    expect(observation).toBe('shell -> ok')
  })
})
