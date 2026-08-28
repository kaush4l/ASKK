import { describe, expect, test } from 'bun:test'
import { Session } from '@/core/agent/session'
import { Transcript } from '@/core/agent/transcript'
import { AssemblyError, PromptAssembler, utf8Bytes } from '@/core/prompt/assembler'
import { Component } from '@/core/prompt/component'
import {
  ContextBlock,
  History,
  ResponseContract,
  Soul,
  SystemInstructions,
  ToolboxComponent,
} from '@/core/prompt/components'
import { promptFor } from '@/core/prompt/recipe'
import type { Recipe } from '@/core/prompt/recipe'
import { CORE_MARK, Slot } from '@/core/prompt/slots'
import { ReActResponse } from '@/core/response/responses'

/**
 * 2.6's acceptance is that the rendered prompt is byte-stable and printable for
 * inspection, and `tests/golden/render-*.prompt` is the oracle that decides it.
 * The three fixtures are copied byte-for-byte out of `pre-workbench` and their
 * md5s are asserted below against what
 * `git show pre-workbench:tests/golden/<name> | md5` prints. **A byte that
 * differs is the port being wrong, never the fixture.**
 *
 * The trap, which is the reason `Recipe.context` is a function and not a clock:
 * all three fixtures carry `current time: 2026-08-16 12:00:00 PDT` beside
 * `day: Saturday`, and 2026-08-16 is a **Sunday**. That is asserted separately
 * below so the next reader does not rediscover it by "fixing" the fixture.
 */

const GOLDEN = new URL('./golden/', import.meta.url)

const golden = (name: string): Promise<string> => Bun.file(new URL(name, GOLDEN)).text()

/** The first differing character, with enough either side to recognise it. */
function diff(actual: string, expected: string): string {
  if (actual === expected) return ''
  let i = 0
  while (i < actual.length && i < expected.length && actual[i] === expected[i]) i++
  const show = (s: string): string => JSON.stringify(s.slice(Math.max(0, i - 40), i + 40))
  return [
    `first difference at character ${i}`,
    `  expected: ${show(expected)}`,
    `  actual:   ${show(actual)}`,
    `  expected codepoint: ${expected.codePointAt(i)}, actual: ${actual.codePointAt(i)}`,
  ].join('\n')
}

/** The recorded instant and the recorded weekday, which do not agree with each other. */
const FIXED_CONTEXT = { 'current time': '2026-08-16 12:00:00 PDT', day: 'Saturday' }

const USAGES = ['echo({"text": "<text>"}): Echo the text back.', 'weather({"city": "<city>"}): Report the weather for a city.']

/** The real caller path: a recipe, a real session, a real transcript. */
function render(recipe: Recipe, messages: readonly { role: 'user' | 'assistant'; content: string }[] = []): string {
  const transcript = new Transcript(messages)
  const session = new Session({ id: 'turn-1', query: 'q', transcript })
  return promptFor(recipe)(session)
}

describe('the oracle', () => {
  test('2026-08-16 is a Sunday, and the fixtures say Saturday on purpose', () => {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'long',
    }).format(new Date('2026-08-16T12:00:00-07:00'))
    expect(weekday).toBe('Sunday')
    expect(FIXED_CONTEXT.day).toBe('Saturday')
  })

  const fixtures: [string, string][] = [
    // `git show pre-workbench:tests/golden/<name> | md5`
    ['render-bare.prompt', '85a6ed70916df610ea9db80c513ce335'],
    ['render-full.prompt', '76d49f369b33d058b29f68adbc89cd7b'],
    ['render-plain-text.prompt', '5c5f1a0c81b17fdc8dfdac3b7a9a87d1'],
  ]

  for (const [name, digest] of fixtures) {
    test(`${name} is the recorded fixture, byte for byte`, async () => {
      const bytes = await Bun.file(new URL(name, GOLDEN)).arrayBuffer()
      expect(new Bun.CryptoHasher('md5').update(bytes).digest('hex')).toBe(digest)
    })
  }
})

describe('render parity', () => {
  test('bare: a system block, the context, the react contract', async () => {
    const expected = await golden('render-bare.prompt')
    const actual = render({ system: 'Sys.', context: () => ({ ...FIXED_CONTEXT }), model: ReActResponse })
    expect(diff(actual, expected)).toBe('')
    expect(actual).toBe(expected)
  })

  test('plain-text: no response class, so the cue closes the prompt alone', async () => {
    const expected = await golden('render-plain-text.prompt')
    const actual = render({ system: 'Sys.', context: () => ({ ...FIXED_CONTEXT }), model: null })
    expect(diff(actual, expected)).toBe('')
    expect(actual).toBe(expected)
  })

  test('full: system, context, history, tools, contract — in slot order', async () => {
    const expected = await golden('render-full.prompt')
    const actual = render(
      {
        system: 'You are helpful.\nBe brief.',
        context: () => ({ ...FIXED_CONTEXT }),
        usages: USAGES,
        model: ReActResponse,
      },
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello there' },
      ],
    )
    expect(diff(actual, expected)).toBe('')
    expect(actual).toBe(expected)
  })
})

describe('the slot order is the prompt order', () => {
  test('the integers are the load-bearing constant', () => {
    expect(Slot).toEqual({
      SOUL: 0,
      SYSTEM: 10,
      CONTEXT: 20,
      SKILLS: 30,
      PHASE: 40,
      HISTORY: 50,
      TOOLS: 60,
      RESPONSE: 99,
    })
  })

  test('components sort into slot order however they were declared', () => {
    const { breakdown } = new PromptAssembler().detail([
      ResponseContract.of(null),
      new History({ lines: ['[USER]: hi'] }),
      new Soul({ text: 'who' }),
      new ContextBlock({ facts: { day: 'Saturday' } }),
    ])
    expect(breakdown.bands.map((b) => b.name)).toEqual(['Soul', 'ContextBlock', 'History', 'ResponseContract'])
    expect(breakdown.bands.map((b) => b.slot)).toEqual([0, 20, 50, 99])
  })

  test('a tie within a slot breaks on priority', () => {
    const { breakdown } = new PromptAssembler().detail([
      new SystemInstructions({ text: 'second', priority: 1 }),
      new SystemInstructions({ text: 'first', priority: 0 }),
      ResponseContract.of(null),
    ])
    expect(breakdown.bands.map((b) => b.bytes)).toEqual([7, 8, 12])
  })

  test('detail carries the bundle sentinel out as a value', () => {
    const { breakdown } = new PromptAssembler().detail([new Soul({ text: 'who' }), ResponseContract.of(null)])
    expect(breakdown.build).toBe(CORE_MARK)
  })
})

describe('a component with nothing to say vanishes', () => {
  test('an empty Soul is absent from the prompt and from the breakdown', () => {
    const empty = new Soul({ text: '   ' })
    expect(empty.applies()).toBe(false)
    const { prompt, breakdown } = new PromptAssembler().detail([
      empty,
      new SystemInstructions({ text: 'Sys.' }),
      ResponseContract.of(null),
    ])
    expect(breakdown.bands.map((b) => b.name)).toEqual(['SystemInstructions', 'ResponseContract'])
    expect(prompt).toBe('Sys.\n\n[ASSISTANT]:')
  })

  test('an empty toolbox renders no AVAILABLE TOOLS heading at all', () => {
    const prompt = render({ system: 'Sys.', context: () => ({}), usages: [], model: null })
    expect(prompt).not.toContain('AVAILABLE TOOLS')
    expect(prompt).not.toContain('## CONTEXT')
    expect(prompt).toBe('Sys.\n\n[ASSISTANT]:')
  })
})

describe('the three invariants raise rather than repair', () => {
  test('exactly one RESPONSE component — two is an error naming both', () => {
    const two = (): unknown =>
      new PromptAssembler().assemble([new Soul({ text: 'who' }), ResponseContract.of(null), ResponseContract.of(null)])
    expect(two).toThrow(AssemblyError)
    expect(two).toThrow(
      "A prompt needs exactly one RESPONSE component, got 2: ['ResponseContract', 'ResponseContract']",
    )
  })

  test('exactly one RESPONSE component — none is an error too', () => {
    expect(() => new PromptAssembler().assemble([new Soul({ text: 'who' })])).toThrow(
      'A prompt needs exactly one RESPONSE component, got 0: none',
    )
  })

  test('an agent must be someone', () => {
    expect(() => new PromptAssembler().assemble([new History({ lines: ['[USER]: hi'] }), ResponseContract.of(null)])).toThrow(
      'A prompt needs a SOUL or SYSTEM component — an agent must be someone.',
    )
  })

  test('RESPONSE sorts last — a component past slot 99 is named', () => {
    class Trailing extends Component {
      static override SLOT = 100
      static override TEMPLATE = 'trailing'
      static override NAME = 'Trailing'
    }
    expect(() =>
      new PromptAssembler().assemble([new Soul({ text: 'who' }), ResponseContract.of(null), new Trailing()]),
    ).toThrow('Trailing sorts after the RESPONSE component.')
  })
})

/**
 * Counts what the memo is supposed to prevent: a second call to `render()`.
 *
 * The tally lives outside the instance because every component freezes itself
 * at the end of its own constructor — a counter field on the subclass throws
 * `Attempting to define property on object that is not extensible`, which is
 * the immutability `key()` rests on, proved by the shape of this double.
 */
function countedSoul(text: string): { component: Soul; count: () => number } {
  let renders = 0
  class Counted extends Soul {
    static override NAME = 'Counted'
    override render(): string {
      renders += 1
      return super.render()
    }
  }
  return { component: new Counted({ text }), count: () => renders }
}

function countedContext(facts: Record<string, string>): { component: ContextBlock; count: () => number } {
  let renders = 0
  class CountedContext extends ContextBlock {
    static override NAME = 'CountedContext'
    override render(): string {
      renders += 1
      return super.render()
    }
  }
  return { component: new CountedContext({ facts }), count: () => renders }
}

describe('the memo', () => {
  test('a second render of the same fields does not call render() again', () => {
    const assembler = new PromptAssembler()
    const soul = countedSoul('who')
    const parts = [soul.component, ResponseContract.of(null)]

    const first = assembler.detail(parts)
    expect(first.breakdown.bands[0]?.memo).toBe(false)
    expect(assembler.hits).toBe(0)

    const second = assembler.detail(parts)
    expect(second.breakdown.bands[0]?.memo).toBe(true)
    expect(assembler.hits).toBe(2)
    // The causal half: the counter says the work was skipped, not merely that a
    // flag was set. Two assembles, one render.
    expect(soul.count()).toBe(1)
    expect(second.prompt).toBe(first.prompt)
  })

  test('a component whose fields changed misses, and renders again', () => {
    const assembler = new PromptAssembler()
    assembler.detail([new Soul({ text: 'who' }), ResponseContract.of(null)])
    assembler.detail([new Soul({ text: 'someone else' }), ResponseContract.of(null)])
    expect(assembler.hits).toBe(1) // the contract hit; the soul did not
    expect(assembler.misses).toBe(3)
  })

  test('the CONTEXT block is skipped by the memo, and says so in its band', () => {
    const assembler = new PromptAssembler()
    const context = countedContext({ day: 'Saturday' })
    const parts = [new Soul({ text: 'who' }), context.component, ResponseContract.of(null)]

    assembler.detail(parts)
    const { breakdown } = assembler.detail(parts)
    const band = breakdown.bands.find((b) => b.name === 'CountedContext')
    expect(band?.cacheable).toBe(false)
    expect(band?.memo).toBe(false)
    // A cached clock is a wrong clock: it really re-rendered.
    expect(context.count()).toBe(2)
  })
})

describe('key()', () => {
  /**
   * Two components carrying the same values, whose constructors assign them in
   * opposite orders. Object key order is not to be trusted across a rebuild, so
   * the key walks `FIELDS` — and these two are what makes that falsifiable: a
   * `key()` reading the instance's own property order gives them two keys, and
   * the memo then renders the same bytes twice forever.
   */
  class Alphabetic extends Component {
    static override SLOT = Slot.SOUL
    static override TEMPLATE = '{{ alpha }}{{ beta }}\n\n'
    static override FIELDS: readonly string[] = ['priority', 'alpha', 'beta']
    static override NAME = 'Pair'
    readonly alpha = 'a'
    readonly beta = 'b'
  }
  class Reversed extends Component {
    static override SLOT = Slot.SOUL
    static override TEMPLATE = '{{ alpha }}{{ beta }}\n\n'
    static override FIELDS: readonly string[] = ['priority', 'alpha', 'beta']
    static override NAME = 'Pair'
    readonly beta = 'b'
    readonly alpha = 'a'
  }

  test('walks the declared FIELDS array, not the object key order', () => {
    expect(Object.keys(new Alphabetic())).not.toEqual(Object.keys(new Reversed()))
    expect(new Alphabetic().key()).toBe(new Reversed().key())
  })

  test('a field the table declares still moves the key', () => {
    expect(new Soul({ text: 'who' }).key()).toBe(new Soul({ text: 'who', priority: 0 }).key())
    expect(new Soul({ text: 'who' }).key()).not.toBe(new Soul({ text: 'who', priority: 1 }).key())
  })

  test('NAME is the declared static, never constructor.name — the build minifies', () => {
    class Whatever extends Soul {
      static override NAME = 'Declared'
    }
    expect(Whatever.name).toBe('Whatever')
    expect(new Whatever({ text: 'x' }).key()).toStartWith('Declared:')
    expect(new Soul({ text: 'x' }).key()).not.toBe(new SystemInstructions({ text: 'x' }).key())
  })

  test('History separates its lines with a NUL, so two splits of the same words differ', () => {
    expect(new History({ lines: ['a b', 'c'] }).key()).not.toBe(new History({ lines: ['a', 'b c'] }).key())
  })
})

describe('the breakdown is printable for inspection', () => {
  test('every band names its slot, its key and its byte share, and the shares total', () => {
    const { prompt, breakdown } = new PromptAssembler().detail([
      new SystemInstructions({ text: 'Sys.' }),
      new ContextBlock({ facts: FIXED_CONTEXT }),
      new ToolboxComponent({ usages: USAGES }),
      ResponseContract.of(ReActResponse),
    ])
    expect(breakdown.bytes).toBe(utf8Bytes(prompt))
    expect(breakdown.bands.reduce((n, b) => n + b.bytes, 0)).toBe(breakdown.bytes)
    for (const b of breakdown.bands) expect(b.key).toMatch(/^[A-Za-z]+:/)
  })

  test('bytes are UTF-8, not UTF-16 code units — the em dash in the tool block is three', () => {
    expect(utf8Bytes('—')).toBe(3)
    expect('—'.length).toBe(1)
  })
})
