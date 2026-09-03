import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_ORDER,
  PromptBlock,
  PromptTemplate,
  Volatility,
} from '../../../src/core/prompt/PromptTemplate.js'
import { estimateTokens } from '../../../src/core/prompt/tokens.js'

/**
 * The assembled string is the entire input to the model, so it is the thing to
 * assert on — not that assembly produced something, or that the block count is
 * right.
 *
 * Three claims are checked here that nothing else in the tree can see. The
 * template, not the caller, decides the order, so the blocks go in scrambled.
 * The `parts` offsets are handed to a transport as a cache breakpoint, so they
 * have to index the real string exactly — an offset that is off by the two
 * newlines between blocks splits an Anthropic request mid-word and the only
 * symptom is a cache that never hits. And `cacheable` is a number a human reads
 * as a percentage, so it is checked against the tokens of the actual prefix
 * rather than against itself.
 */

const block = (id, body, volatility = Volatility.STATIC, extra = {}) =>
  new PromptBlock({ id, body, volatility, ...extra })

/** The default arrangement, with a body per block that is easy to find again. */
function sampleBlocks() {
  return [
    // Deliberately out of order: the template decides, not this list.
    block('cue', '[ASSISTANT]:', Volatility.STATIC, { tail: true }),
    block('contract', 'reply with fields'),
    block('conversation', '[USER]: hello', Volatility.APPEND, { heading: 'CONVERSATION' }),
    block('instructions', 'answer briefly'),
    block('context', 'now: Tuesday', Volatility.VOLATILE, { heading: 'CONTEXT' }),
    // Whitespace only. A block with nothing to say must not leave a heading
    // promising something behind.
    block('tools', '   \n  '),
  ]
}

describe('PromptTemplate.assemble — the text', () => {
  test('the assembled string is exactly the blocks, in template order, as markdown sections', () => {
    const { text } = new PromptTemplate().assemble(sampleBlocks())

    expect(text).toBe(
      [
        'answer briefly',
        'reply with fields',
        '# CONVERSATION\n\n[USER]: hello',
        '# CONTEXT\n\nnow: Tuesday',
        '[ASSISTANT]:',
      ].join('\n\n'),
    )
  })

  test('a different order produces a different string, with no code changing', () => {
    const stateless = new PromptTemplate(['instructions', 'context', 'conversation', 'cue'])

    const { text } = stateless.assemble(sampleBlocks())

    expect(text).toBe(
      [
        'answer briefly',
        '# CONTEXT\n\nnow: Tuesday',
        '# CONVERSATION\n\n[USER]: hello',
        '[ASSISTANT]:',
      ].join('\n\n'),
    )
    // contract was left out of the order, so it is genuinely left out.
    expect(text).not.toContain('reply with fields')
  })

  test('a block the caller never supplied is simply absent', () => {
    const { text, parts } = new PromptTemplate().assemble([block('instructions', 'alone')])

    expect(text).toBe('alone')
    expect(parts.map((part) => part.id)).toEqual(['instructions'])
  })
})

describe('PromptTemplate.assemble — the accounting', () => {
  test('every part indexes the assembled text exactly, with no gap or overlap', () => {
    const { text, parts } = new PromptTemplate().assemble(sampleBlocks())

    expect(parts[0].start).toBe(0)
    expect(parts.at(-1).end).toBe(text.length)
    expect(parts.map((part) => text.slice(part.start, part.end)).join('')).toBe(text)
    for (const [index, part] of parts.entries()) {
      if (index === 0) continue
      expect(part.start).toBe(parts[index - 1].end)
      // The separator belongs to the block that follows it, so a breakpoint at
      // a part's end never lands inside the blank line.
      expect(text.slice(part.start, part.start + 2)).toBe('\n\n')
    }
    expect(text.slice(parts[2].start, parts[2].end)).toBe('\n\n# CONVERSATION\n\n[USER]: hello')
  })

  test('the boundary is the last byte of the reusable prefix', () => {
    const { text, boundary, brokenBy } = new PromptTemplate().assemble(sampleBlocks())

    expect(text.slice(0, boundary)).toBe('answer briefly\n\nreply with fields')
    // The conversation is what ends the prefix — it grows, so its bytes are not
    // known to repeat.
    expect(brokenBy).toBe('conversation')
    expect(text.slice(boundary)).toStartWith('\n\n# CONVERSATION')
  })

  test('cacheable and total are the tokens of the real strings, not a running guess', () => {
    const { text, boundary, cacheable, total } = new PromptTemplate().assemble(sampleBlocks())

    expect(total).toBe(estimateTokens(text))
    expect(cacheable).toBe(estimateTokens(text.slice(0, boundary)))
    expect(cacheable).toBeGreaterThan(0)
    expect(cacheable).toBeLessThan(total)
  })

  test('only the leading static run is marked cached — the tail blocks are not', () => {
    const { parts } = new PromptTemplate().assemble(sampleBlocks())

    expect(parts.map((part) => [part.id, part.cached])).toEqual([
      ['instructions', true],
      ['contract', true],
      ['conversation', false],
      ['context', false],
      // Static, but after the break: it is re-read on every call, and saying so
      // is the whole reason this field is here.
      ['cue', false],
    ])
  })

  test('nothing stable at all leaves the boundary at zero rather than pointing anywhere', () => {
    const { boundary, cacheable, brokenBy } = new PromptTemplate(['context', 'cue']).assemble([
      block('context', 'now: Tuesday', Volatility.VOLATILE),
      block('cue', '[ASSISTANT]:', Volatility.STATIC, { tail: true }),
    ])

    expect(boundary).toBe(0)
    expect(cacheable).toBe(0)
    expect(brokenBy).toBe('context')
  })

  test('an empty assembly is empty rather than a lone newline', () => {
    const assembled = new PromptTemplate().assemble([block('instructions', ''), block('cue', '  ')])

    expect(assembled.text).toBe('')
    expect(assembled.parts).toEqual([])
    expect(assembled.total).toBe(0)
    expect(assembled.boundary).toBe(0)
  })
})

describe('PromptTemplate.audit', () => {
  test('a stable block stranded after volatile material is reported with its cost', () => {
    const { problems, parts } = new PromptTemplate(['context', 'instructions']).assemble([
      block('context', 'now: Tuesday', Volatility.VOLATILE),
      block('instructions', 'answer briefly and never guess'),
    ])

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('instructions is static but sits after less stable blocks')
    expect(problems[0]).toContain(`${parts[1].tokens} tokens are re-read on every call`)
  })

  test('a block that declares itself the tail is not reported', () => {
    const { problems } = new PromptTemplate().assemble(sampleBlocks())

    // `cue` is static and last on purpose; the audit has to tell design from
    // accident or nobody will read it.
    expect(problems).toEqual([])
  })

  test('the default order is itself clean', () => {
    const blocks = DEFAULT_ORDER.map((id) =>
      block(
        id,
        `body of ${id}`,
        // Mirrors `Engine.blocks`, which is the only place these are declared.
        // A block whose volatility is wrong here passes an audit the real
        // prompt would fail, so the two lists have to be read together.
        id === 'context' || id === 'budget'
          ? Volatility.VOLATILE
          : id === 'conversation' || id === 'scratchpad'
            ? Volatility.APPEND
            : Volatility.STATIC,
        { tail: id === 'reminder' || id === 'cue' },
      ),
    )

    expect(new PromptTemplate().assemble(blocks).problems).toEqual([])
  })
})

describe('PromptTemplate.of', () => {
  test('an unknown id costs that line and nothing else', () => {
    const { template, notes } = PromptTemplate.of(['instructions', 'nonsense', 'cue'], {
      source: 'agents/main/agent.md',
    })

    expect(template.order).toEqual(['instructions', 'cue'])
    expect(notes).toContain('agents/main/agent.md: prompt block "nonsense" is not a block; ignored')
  })

  test('a repeated id is kept once and reported', () => {
    const { template, notes } = PromptTemplate.of(['instructions', 'instructions'])

    expect(template.order).toEqual(['instructions'])
    expect(notes.some((note) => note.includes('was listed twice'))).toBe(true)
  })

  test('omitting a block is an override, not a mistake — but it is stated', () => {
    const { template, notes } = PromptTemplate.of(['instructions', 'cue'])

    expect(template.order).toEqual(['instructions', 'cue'])
    expect(notes.some((note) => note.includes('prompt omits soul, tools, contract'))).toBe(true)
  })

  test('no list at all is the default arrangement, silently', () => {
    for (const empty of [undefined, [], null, 'nonsense']) {
      const { template, notes } = PromptTemplate.of(empty)
      expect(template.order).toEqual([...DEFAULT_ORDER])
      expect(notes).toEqual([])
    }
  })

  test('a list of nothing but unknown ids falls back rather than rendering an empty prompt', () => {
    const { template } = PromptTemplate.of(['nope', 'also-nope'])

    expect(template.order).toEqual([...DEFAULT_ORDER])
  })
})
