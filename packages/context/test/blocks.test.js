import { expect, test, describe } from 'bun:test'
import {
  assemble, paperOf, UNLIMITED_BUDGET, SLOT, sectionOf,
  soul, identity, operatingRules, goal, affordances, memory, space,
  environment, task, history, observations, directive, prose, toolEnvelope, SESSION_STARTED,
} from '@harness/context'

/** Every block in the library, each at its opening value. */
function everyBlock() {
  return [
    soul(), identity('archivist', 'Keeps the record.'), operatingRules(),
    goal('the record is straight', 'nothing is unfiled'), affordances(['read_file(path): read one file']),
    memory(['the plan lives at plan.md']),
    space({ name: 'atelier', path: '/spaces/atelier', durable: true }, ['observe']),
    environment('2025-06-15 14:26 UTC', 'a Linux you can run commands in'),
    task('file the plan'), history(['user: file it', 'assistant: filing']),
    observations(['read_file: plan.md']), directive('File it, then say so.'), prose(),
  ]
}

/** @param {import('@harness/context').Component} c */
function body(c) {
  return c.render().map((p) => (p.type === 'text' ? p.text : `<${p.type}>`)).join('\n')
}

describe('the whole vocabulary, assembled', () => {
  const doc = assemble(paperOf('work', everyBlock(), 7), UNLIMITED_BUDGET)

  test('every block renders, in slot order, soul first and the contract last', () => {
    expect(doc.sections.map((s) => s.id)).toStrictEqual([
      'soul', 'identity', 'operating_rules', 'goal', 'affordances', 'memory',
      'space', 'environment', 'task', 'history', 'observations', 'directive', 'response_contract',
    ])
    expect(doc.sections.map((s) => s.slot)).toStrictEqual([...doc.sections.map((s) => s.slot)].sort((a, b) => a - b))
  })

  test("the golden holds — any change to a block's words shows up here", async () => {
    const path = new URL('./fixtures/blocks.golden.json', import.meta.url).pathname
    const text = `${JSON.stringify(doc, null, 2)}\n`
    if (process.env['UPDATE_GOLDENS'] === '1') await Bun.write(path, text)
    expect(await Bun.file(path).text()).toBe(text)
  })
})

describe('what each block refuses to say', () => {
  test("an agent file's own headings are demoted, but not inside a fence", () => {
    const rendered = body(soul('# Tools\n```sh\n# not a heading\n```\n## More'))
    expect(rendered).toContain('## Tools')
    expect(rendered).toContain('### More')
    expect(rendered).toContain('\n# not a heading')
  })

  test('a name with no role behind it still ends cleanly', () => {
    expect(body(identity('archivist'))).toBe('Name: archivist.')
    expect(body(identity())).toBe('Name: HARNESS. Role: resident assistant.')
  })

  test('affordances no longer teaches the text call protocol that corrupted a file', () => {
    const rendered = body(affordances(['read_file(path): read one file']))
    expect(rendered).not.toContain('separated by commas')
    expect(rendered).not.toContain('Result:')
    expect(body(toolEnvelope())).not.toContain('## affordances')
  })

  test('the space names only the tools this agent actually holds', () => {
    const shared = { name: 'atelier', path: '/p', durable: true }
    expect(body(space(shared, ['observe', 'find_files']))).toContain('observe says what the machine is and find_files searches it')
    expect(body(space(shared, []))).not.toContain('find_files')
  })

  test('durability is read off the store, not asserted by the paper', () => {
    const shared = { name: 'atelier', path: '/p', durable: true }
    expect(body(space(shared, []))).toContain('still there after a reload')
    expect(body(space({ ...shared, durable: false }, []))).toContain('nothing written there survives a reload')
  })
})

describe('an absent faculty and an empty one are different facts', () => {
  const at = (/** @type {import('@harness/context').Component[]} */ blocks, /** @type {string} */ id) =>
    assemble(paperOf('work', [soul(), ...blocks, prose()], 7), UNLIMITED_BUDGET).sections.find((s) => s.id === id)

  test('a faculty nobody filled has no heading at all', () => {
    for (const c of [memory(), goal(), directive(), space()]) {
      expect(at([c], c.id)?.fidelity).toBe('elided')
    }
  })

  test('a faculty that IS there and has nothing to report says so', () => {
    expect(at([observations()], 'observations')?.parts).toStrictEqual([{ type: 'text', text: 'No actions taken yet.' }])
    expect(at([task()], 'task')?.parts).toStrictEqual([{ type: 'text', text: 'Idle; awaiting a task.' }])
    expect(at([affordances()], 'affordances')?.parts[0]).toStrictEqual({
      type: 'text', text: 'No tools are installed; answer from what you know.',
    })
  })

  test('a fresh window holds the marker entry and not an empty list', () => {
    expect(history().render()).toStrictEqual([{ type: 'text', text: SESSION_STARTED }])
  })
})

describe('the two properties a block cannot be trusted to keep by convention', () => {
  test('the response contract never degrades, at any budget', () => {
    for (const maxTokens of [12, 40, 200, 8192]) {
      const doc = assemble(paperOf('work', everyBlock(), 7), { maxTokens })
      const contract = doc.sections.find((s) => s.id === 'response_contract')
      expect(contract?.fidelity).toBe('full')
      expect(contract?.slot).toBe(SLOT.RESPONSE)
      expect(doc.sections[doc.sections.length - 1]?.id).toBe('response_contract')
    }
  })

  test('a cached clock would be a wrong clock, so the clock is dated and the soul is not', () => {
    expect(sectionOf(environment('now'), 99).provenance.producedAt).toBe(99)
    expect(sectionOf(soul(), 99).provenance.producedAt).toBe(0)
  })
})
