import { expect, test, describe } from 'bun:test'
import { Glob } from 'bun'
import { requestFor, paperOf, modelCard } from '@harness/context'
import { HarnessError } from '@harness/kernel'
import { blocksFor, cardFor, replayFor, TOOLS, AT, cell } from './matrix.js'

/**
 * THE ENTRY POINT, AND WHETHER THE GOLDENS ARE THE REAL BYTES.
 *
 * Two separate claims, and this project has already been burned by proving the
 * first and asserting the second. `requestFor` is the one call that turns a
 * paper into a request — that is checkable here. Whether the prompt on the wire
 * is built from THESE blocks is a fact about another package, and last round it
 * was false: the loop carried a second vocabulary of its own and the goldens
 * pinned bytes nothing sent. So the second claim is executed by reading that
 * package's source, which is the only instrument this lane has for it.
 */

/** @param {string} provider @param {string} kind */
function ask(provider, kind) {
  return requestFor({
    state: paperOf('work', blocksFor(kind), AT),
    card: cardFor(provider, kind),
    tools: kind === 'tools' || kind === 'thinking' ? TOOLS : [],
    replay: replayFor(provider, kind),
  })
}

describe('one adapter decides the arithmetic and the serialisation, or neither', () => {
  test('the paper is costed by the same provider that writes the body', () => {
    const { document, body, provider } = ask('anthropic', 'image')
    expect(provider).toBe('anthropic')
    expect(document.report.imageRule).toBe('anthropic')
    expect(Object.keys(body)).toContain('max_tokens')
  })

  test('the same paper reaches gemini in gemini shape, counted by gemini', () => {
    const { document, body } = ask('gemini', 'image')
    expect(document.report.imageRule).toBe('gemini')
    expect(Object.keys(body)).toContain('systemInstruction')
  })

  test('an image is billed differently by each, from one identical paper', () => {
    const spends = ['openai', 'anthropic', 'gemini'].map((p) => ask(p, 'image').document.report.spent)
    expect(new Set(spends).size).toBe(3)
  })

  test('a catalogue entry naming a protocol nobody speaks is refused before assembly', () => {
    const card = { ...cardFor('openai', 'text'), kind: 'cohere' }
    try {
      requestFor({ state: paperOf('work', blocksFor('text'), AT), card })
      throw new Error('built')
    } catch (e) {
      expect(e instanceof HarnessError ? e.kind : e).toBe('unknown_provider')
    }
  })
})

describe('the budget is derived from the card, never declared', () => {
  test('two windows, one paper, two different bodies', () => {
    const state = paperOf('work', blocksFor('text'), AT)
    const wide = requestFor({ state, card: modelCard('wide', { model: 'm', kind: 'openai', context_tokens: 200_000 }) })
    const narrow = requestFor({ state, card: modelCard('narrow', { model: 'm', kind: 'openai', context_tokens: 600 }) })
    expect(JSON.stringify(narrow.body)).not.toBe(JSON.stringify(wide.body))
    expect(narrow.document.report.steps.length).toBeGreaterThan(0)
    expect(wide.document.report.steps.length).toBe(0)
  })

  test('a window with no room left for a paper says so by name', () => {
    try {
      requestFor({
        state: paperOf('work', blocksFor('text'), AT),
        card: modelCard('slit', { model: 'm', kind: 'openai', context_tokens: 300 }),
      })
      throw new Error('built')
    } catch (e) {
      expect(e instanceof HarnessError ? e.kind : e).toBe('window_too_small')
    }
  })
})

describe("a history that changed provider mid-session keeps its words and loses the other vendor's signature", () => {
  test('a foreign assistant turn is sieved, not thrown over', () => {
    const state = paperOf('work', blocksFor('tools'), AT)
    const foreign = replayFor('anthropic', 'tools')
    const { body } = requestFor({ state, card: cardFor('openai', 'tools'), tools: TOOLS, replay: foreign })
    expect(JSON.stringify(body)).not.toContain('sig-fixture')
  })

  test("this provider's own turn is replayed", () => {
    const { body } = ask('openai', 'tools')
    expect(JSON.stringify(body)).toContain('read_file')
    expect(JSON.stringify(body)).toContain('reasoning_content')
  })
})

describe('the goldens are the bytes the product sends', () => {
  test('the golden on disk is what the entry point produced', async () => {
    const path = new URL('./fixtures/matrix/anthropic-tight-tools.json', import.meta.url).pathname
    expect(await Bun.file(path).text()).toBe(`${JSON.stringify(cell('anthropic', 'tight', 'tools').body, null, 2)}\n`)
  })

  test('the loop holds no second vocabulary — every block it fills is imported from here', async () => {
    const dir = new URL('../../agent/src/', import.meta.url).pathname
    const owned = /export function (soul|affordances|observations|directive|task|taskBlock|contract|identity|operatingRules|goal|memory|space|environment|history)\b/
    for await (const file of new Glob('**/*.js').scan({ cwd: dir })) {
      expect(await Bun.file(`${dir}${file}`).text()).not.toMatch(owned)
    }
  })

  test('the retired text call protocol reaches no model — read off the bytes, not the source', async () => {
    // The phrases survive in `contract.js`'s prose, where they name what was
    // retired and why; erasing the reason is how the same machine gets rebuilt.
    // What must not survive is a PROMPT carrying them, so this reads the 48
    // recorded bodies and reports rather than the files that wrote them.
    const dir = new URL('./fixtures/matrix/', import.meta.url).pathname
    let read = 0
    for await (const file of new Glob('*.json').scan({ cwd: dir })) {
      const bytes = await Bun.file(`${dir}${file}`).text()
      expect(bytes).not.toContain('separated by commas')
      expect(bytes).not.toContain('lines beginning')
      read += 1
    }
    expect(read).toBe(48)
  })
})
