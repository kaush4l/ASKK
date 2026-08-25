import { expect, test, describe } from 'bun:test'
import { sectionOf, keyOf, text, SLOT } from '@harness/context'
import { comp } from './paper.js'

describe('a component renders its body; the frame is inherited', () => {
  test('an empty body is NO parts, which is what elides the whole block', () => {
    expect(text('')).toStrictEqual([])
    expect(text('a')).toStrictEqual([{ type: 'text', text: 'a' }])
  })

  test('the defaults are applied in one place, so eleven components cannot disagree', () => {
    const s = sectionOf(comp({ id: 'memory', slot: SLOT.MEMORY, render: () => text('remembers') }), 1700)
    expect(s).toMatchObject({ stability: 'dynamic', floor: 'summarized', priority: 5, trust: 'authored', fidelity: 'full' })
  })
})

describe('the key is a claim about bytes', () => {
  const one = comp({ id: 'soul', slot: SLOT.SOUL, render: () => text('same words') })
  const two = comp({ id: 'user', slot: SLOT.USER, render: () => text('same words') })

  test('identical rendered bytes give an identical key', () => {
    expect(keyOf(one)).toBe(keyOf(comp({ id: 'soul', slot: SLOT.SOUL, render: () => text('same words') })))
  })

  test('two components saying the same thing are still two components', () => {
    expect(keyOf(one)).not.toBe(keyOf(two))
  })

  test('a changed body changes the key', () => {
    expect(keyOf(one)).not.toBe(keyOf(comp({ id: 'soul', slot: SLOT.SOUL, render: () => text('other words') })))
  })
})

describe('a cacheable component is dated zero, and that is the cache property', () => {
  test('cacheable bytes stay identical across turns', () => {
    const c = comp({ id: 'soul', slot: SLOT.SOUL, render: () => text('who I am') })
    expect(sectionOf(c, 1).provenance.producedAt).toBe(0)
    expect(sectionOf(c, 999_999)).toStrictEqual(sectionOf(c, 1))
  })

  test('anything derived from the clock is dated honestly instead', () => {
    const c = comp({ id: 'environment', slot: SLOT.ENVIRONMENT, cacheable: false, render: () => text('it is Tuesday') })
    expect(sectionOf(c, 1700).provenance.producedAt).toBe(1700)
  })
})
