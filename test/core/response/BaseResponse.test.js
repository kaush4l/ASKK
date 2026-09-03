import { describe, expect, test } from 'bun:test'
import { BaseResponse } from '../../../src/core/response/BaseResponse.js'
import { SimpleResponse } from '../../../src/core/response/SimpleResponse.js'

/**
 * The contract and the parser are two halves of one thing, and the audit that
 * shrank the contract by 220 tokens per call did it by checking every rule
 * against the code that already enforced it. These tests hold that pairing in
 * place from the parser's side: a rule that came out of the prompt because the
 * parser repairs the failure is only safe while the parser still does.
 *
 * That claim was false when it was first written here. Deleting `.toLowerCase()`
 * from `_fieldKey`, and the unknown-key skip from `_parseToon`, each left the
 * whole suite green — two of the five traded rules were being enforced nowhere
 * at all. Every test in this file is now checked by mutating the one line it
 * claims to cover and confirming it goes red, which is also how two of these
 * tests were found to be passing on inputs that never reached the guard they
 * named.
 */

class Probe extends BaseResponse {
  static FIELDS = {
    items: { list: true, description: 'a list' },
    note: { description: 'some prose' },
    verb: { default: 'go', example: 'go', description: 'one of two words' },
  }
}

describe('a repeated field name', () => {
  test('concatenates instead of silently overwriting the earlier value', () => {
    // The one contract rule the parser did not repair, and the only one whose
    // failure mode was silent data loss: `data[name] = value` meant the second
    // `note:` line erased the first with nothing raised anywhere. Repairing it
    // is what let "do not repeat the field name" come out of the prompt.
    const parsed = Probe.parse(['note: first half', '', 'note: second half'].join('\n'))

    expect(parsed.note).toBe('first half\nsecond half')
  })

  test('a repeated list field keeps both sets of items, in order', () => {
    const parsed = Probe.parse(['items: [a, b]', '', 'items: [c]'].join('\n'))

    expect(parsed.items).toEqual(['a', 'b', 'c'])
  })

  test('a repeat with nothing after it does not blank the value it repeats', () => {
    // The shape that used to be worst: a trailing bare `note:` overwrote the
    // real answer with the empty string, and the user saw nothing.
    const parsed = Probe.parse(['note: the real answer', '', 'note:'].join('\n'))

    expect(parsed.note).toBe('the real answer')
  })
})

describe('a whole reply written on one line', () => {
  test('is broken back into fields instead of vanishing into the first one', () => {
    // The only unusable reply in the 64-call re-measurement of this slice's
    // contract cut: the model wrote `think: [...], note: ..., verb: tool` on one
    // line, and a line-oriented read swallowed every field after the first.
    const parsed = Probe.parse('items: [a, b], note: the prose, verb: tool')

    expect(parsed.items).toEqual(['a', 'b'])
    expect(parsed.note).toBe('the prose')
    expect(parsed.verb).toBe('tool')
  })

  test('a field name inside brackets or a call is not a split point', () => {
    // The bracket-depth guard, and reaching it needs a candidate that could
    // otherwise legally split — a later-ranked field name, after a comma, inside
    // the brackets. Written with a quoted key instead, the split regex never
    // matches and the test passes with the guard deleted. Without `depth === 0`
    // this parses to `items: ['[a']` and dumps the rest of the list into `note`:
    // silent loss on the field the user reads.
    const parsed = Probe.parse('items: [a, note: b, c]\n\nnote: real')

    expect(parsed.items).toEqual(['a', 'note: b', 'c'])
    expect(parsed.note).toBe('real')
  })

  test('the last field is never split, so prose that names a field survives', () => {
    // `verb` is declared last, so nothing can rank after it. That is what makes
    // the free-prose field — the one the user actually reads — safe.
    const parsed = Probe.parse('verb: answer, items: are listed above, note: see below')

    expect(parsed.verb).toBe('answer, items: are listed above, note: see below')
  })

  test('a field name in prose without a separator is left alone', () => {
    // The name in the prose has to rank LATER than the field being read, or the
    // rank guard alone carries the test and the separator guard is never
    // exercised — which is how this one used to pass with the separator relaxed
    // from `,;` to whitespace. `verb` ranks after `note`, so only the separator
    // stands between this and `note: see the`.
    const parsed = Probe.parse('items: [x]\n\nnote: see the verb: field above')

    expect(parsed.note).toBe('see the verb: field above')
  })
})

describe('the generated example', () => {
  test('a declared example is shown instead of a placeholder', () => {
    // `verb: <your verb here>` reads as an invitation to write anything. A field
    // whose values are an enum says one of them, generated from the same table
    // the description comes from so the two cannot drift apart.
    const instructions = Probe.instructions()

    expect(instructions).toContain('\nverb: go')
    expect(instructions).not.toContain('<your verb here>')
  })

  test('a field without one still gets its placeholder, list or scalar', () => {
    const instructions = Probe.instructions()

    expect(instructions).toContain('items: [<your first items>, <your second items>]')
    expect(instructions).toContain('note: <your note here>')
  })
})

describe('the repairs the deleted rules now rest on', () => {
  // Five contract rules came out of the prompt because the parser repairs the
  // failure, and a repair with no test is a rule that has stopped existing in
  // both places at once. Two of these five were measured surviving deletion
  // with the whole suite green; each test below goes red under a mutation of
  // the single line it names.

  test('an uppercased field name still reads as that field', () => {
    // "lowercase name" rests entirely on `_fieldKey` lowercasing the key.
    // Without it `Note:` is unknown, every field is skipped, and the reply falls
    // through to the last-resort branch — which on a ReAct turn means `act`
    // defaults to answer and the run ends holding the raw text.
    const parsed = Probe.parse(['Items: [a, b]', '', 'Note: hello', '', 'Verb: go'].join('\n'))

    expect(parsed.items).toEqual(['a', 'b'])
    expect(parsed.note).toBe('hello')
    expect(parsed.verb).toBe('go')
  })

  test('a field-shaped line that is not a field does not sink the reply', () => {
    // "no fields but these" rests on `_parseToon` skipping an unknown key.
    // Without the skip the parser reaches `FIELDS[undefined].list` and throws,
    // and one stray `reasoning:` line costs the whole turn the same way.
    const parsed = Probe.parse(
      ['reasoning: an aside', '', 'items: [a, b]', '', 'note: real', '', 'verb: go'].join('\n'),
    )

    expect(parsed.items).toEqual(['a', 'b'])
    expect(parsed.note).toBe('real')
    expect(parsed.verb).toBe('go')
  })
})

describe('what the contract no longer says', () => {
  test('a non-ReAct model gets the same generated field table', () => {
    // `instructions` builds from `FIELDS` and nothing else. `formatNotes` — the
    // per-subclass hook the deleted rules block came through — is asserted GONE
    // rather than merely unused, because the 300-token ratchet below only
    // weighs `ReActResponse` and a rules block re-entering through a sibling
    // would weigh nothing at all.
    const instructions = SimpleResponse.instructions()

    expect(instructions).toContain('- thinking:')
    expect(instructions).toContain('- response:')
    expect(BaseResponse.formatNotes).toBeUndefined()
  })

  test('the header still carries the two rules worth a handful of tokens', () => {
    // Field order and one-field-per-line are the two things the parser cannot
    // recover from a free-form paragraph, so they stay — in the header, where
    // they cost about eight tokens instead of twenty-nine as numbered rules.
    const instructions = SimpleResponse.instructions()

    expect(instructions).toContain('in this order, one per line as `name: value`')
  })
})

describe('the format a contract is written in', () => {
  class ToonKind extends BaseResponse {
    static FIELDS = { thinking: { description: 'a' }, response: { description: 'b' } }
  }
  class JsonKind extends BaseResponse {
    static FORMAT = 'json'
    static FIELDS = { thinking: { description: 'a' }, response: { description: 'b' } }
  }

  test('TOON is the default and asks for one field per line', () => {
    expect(ToonKind.instructions()).toContain('one per line as `name: value`')
    expect(ToonKind.instructions()).toContain('thinking: <your thinking here>')
  })

  test('a JSON contract asks for one object and shows one', () => {
    const said = JsonKind.instructions()
    expect(said).toContain('a single JSON object')
    expect(said).toContain('"thinking"')
    expect(said).not.toContain('one per line as `name: value`')
  })

  test('a JSON contract still reads a TOON reply, as a repair', () => {
    expect(JsonKind.parse('thinking: quickly\n\nresponse: done').response).toBe('done')
  })

  test('a TOON contract still reads a JSON reply, as a repair', () => {
    expect(ToonKind.parse('{"thinking": "quickly", "response": "done"}').response).toBe('done')
  })
})
