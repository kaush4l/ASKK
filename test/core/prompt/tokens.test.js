import { describe, expect, test } from 'bun:test'
import { estimateTokens } from '../../../src/core/prompt/tokens.js'

/**
 * The estimator makes four claims, and every number the panel shows rests on
 * them: words are the unit, each symbol is its own token, a long word splits
 * once per five characters past the first eight, and newlines count.
 *
 * The claim worth testing hardest is the one the module opens with — that the
 * same number of characters costs far more as JSON than as prose. That is the
 * whole justification for not counting characters, and it is checked here on
 * two strings of exactly equal length rather than restated.
 */

describe('estimateTokens', () => {
  test('nothing is nothing', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
    expect(estimateTokens('   ')).toBe(0)
  })

  test('a short word is one token, whatever alphabet it is in', () => {
    expect(estimateTokens('hello')).toBe(1)
    // Accented and non-Latin letters are letters, not symbols. Charging them as
    // symbols would inflate every non-English prompt by several times.
    expect(estimateTokens('héllo')).toBe(1)
    expect(estimateTokens('こんにちは')).toBe(1)
  })

  test('words are the unit and whitespace between them is free', () => {
    expect(estimateTokens('a b c')).toBe(3)
    expect(estimateTokens('a    b')).toBe(2)
  })

  test('a long word splits once per five characters past the first eight', () => {
    expect(estimateTokens('a'.repeat(8))).toBe(1)
    expect(estimateTokens('a'.repeat(12))).toBe(1)
    expect(estimateTokens('a'.repeat(13))).toBe(2)
    expect(estimateTokens('a'.repeat(18))).toBe(3)
  })

  test('every symbol is its own token', () => {
    // 'x,' is one word piece plus one comma; 'y' is one more.
    expect(estimateTokens('x, y')).toBe(3)
    expect(estimateTokens('{}')).toBe(2)
    expect(estimateTokens('"a"')).toBe(3)
  })

  test('newlines are counted, because a structured prompt is mostly newlines', () => {
    expect(estimateTokens('a\nb')).toBe(3)
    expect(estimateTokens('a\n\nb')).toBe(4)
    expect(estimateTokens('\n')).toBe(1)
  })

  test('the same character count costs several times more as JSON than as prose', () => {
    const prose = 'the quick brown fox jumps over the lazy dog and then it sleepszz'
    const json = '{"a":1,"b":[2,3],"c":{"d":"e"},"f":true,"g":null,"h":9,"i":"jk"}'

    expect(prose.length).toBe(json.length)
    expect(estimateTokens(prose)).toBe(13)
    expect(estimateTokens(json)).toBe(45)
    expect(estimateTokens(json)).toBeGreaterThan(estimateTokens(prose) * 3)
  })
})
