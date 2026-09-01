import { describe, expect, test } from 'bun:test'
import { estimateTokens } from '../../../src/core/prompt/tokens.js'
import {
  ACT_ANSWER,
  ACT_TOOL,
  ACT_UNSAID,
  ReActResponse,
} from '../../../src/core/response/ReActResponse.js'
import { fixture } from '../../support/fixtures.js'

/**
 * `act` is the only field that steers control flow, so every way a model can
 * write it wrong is a way the loop can end early or never end.
 *
 * The failure these guard against is silent in both directions. A tool call
 * mis-read as an answer ends the run with the call text shown to the user as if
 * it were a reply; an answer mis-read as a tool call sends the loop round again
 * on text that contains no call. Neither raises anything — the transcript just
 * looks wrong to a human reading it later.
 *
 * `parse` is exercised alongside `normalize` because the engine never calls
 * `normalize` itself: it gets whatever `parse` builds, and the repair happens
 * inside the constructor. Testing the method alone would prove nothing about
 * the path the loop actually takes.
 */

describe('ReActResponse.normalize', () => {
  test('a decorated act is cleaned to the bare word', () => {
    expect(new ReActResponse({ act: '**Tool**' }).act).toBe(ACT_TOOL)
    expect(new ReActResponse({ act: ' "answer" ' }).act).toBe(ACT_ANSWER)
    expect(new ReActResponse({ act: '`ANSWER`' }).act).toBe(ACT_ANSWER)
  })

  test('a call written into act moves to result and the act becomes tool', () => {
    // The documented repair, and the one the engine depends on: models write
    // the call where the verb belongs more often than they get it right.
    const response = new ReActResponse({ act: 'shell({"command": "uname -a"})', result: '' })

    expect(response.act).toBe(ACT_TOOL)
    expect(response.result).toBe('shell({"command": "uname -a"})')
    expect(response.isToolCall).toBe(true)
  })

  test('a call in act does not overwrite a result that already has one', () => {
    const response = new ReActResponse({
      act: 'shell({"command": "ls"})',
      result: 'shell({"command": "cat /etc/os-release"})',
    })

    expect(response.act).toBe(ACT_TOOL)
    expect(response.result).toBe('shell({"command": "cat /etc/os-release"})')
  })

  test('a JSON object in act counts as a call too', () => {
    const response = new ReActResponse({ act: '{"tool": "shell"}', result: '' })

    expect(response.act).toBe(ACT_TOOL)
    expect(response.result).toBe('{"tool": "shell"}')
  })

  test('a bare tool name in act is a decision the loop cannot read', () => {
    // `act: shell` is the model naming a tool where a verb belongs, with no call
    // anywhere. This assertion ran the other way round until the fail-open was
    // priced: it USED TO END THE RUN and show `result` to the user as the final
    // reply, which is how a run terminated on a word nobody meant as a verb.
    const response = new ReActResponse({ act: 'shell', result: 'the file is empty' })

    expect(response.act).toBe(ACT_UNSAID)
    expect(response.isAnswer).toBe(false)
    expect(response.isToolCall).toBe(false)
    expect(response.isUnsaid).toBe(true)
    // WHICH way it was unsaid, kept because the two routes have opposite
    // remedies and `act` cannot carry it — it is a closed enum the loop
    // switches on, and the word the model wrote is gone by the next line.
    expect(response.unsaidBecause).toBe(
      "the model wrote act: shell, which is neither 'tool' nor 'answer'",
    )
  })

  test('a sentence written into act is quoted back bounded, not whole', () => {
    // `act` can hold anything. This string is rendered into the correction the
    // loop sends back and into the failure a user reads, so an unbounded one
    // would put a paragraph in both — and the correction stays in the
    // scratchpad for the rest of the run.
    const response = new ReActResponse({ think: ['a'], act: 'x'.repeat(400) })

    expect(response.isUnsaid).toBe(true)
    expect(response.unsaidBecause).toBe(
      `the model wrote act: ${'x'.repeat(57)}..., which is neither 'tool' nor 'answer'`,
    )
  })

  test('a JSON reply with a number in act is unsaid, not a thrown error', () => {
    // NOTHING IN `src/` THROWS, and this is the one line in this file that
    // could. `_parseJson` coerces only list fields, so a model writing
    // `"act": 4` or `"act": {"tool": "shell"}` delivers a non-string here and
    // `.trim()` on it would throw out of the core into an uncaught rejection in
    // the backend worker — where no `Outcome` and no page can report it. The
    // read goes through `String(...)`, and this is what pins that.
    expect(ReActResponse.parse('Here:\n{"think":["a"],"act":4,"result":"4"}').act).toBe(ACT_UNSAID)
    expect(new ReActResponse({ think: ['a'], act: 4, result: '4' }).act).toBe(ACT_UNSAID)
    // An OBJECT in `act` is unsaid too, and by a route worth knowing: it reads
    // as `[object Object]`, which carries no bracket, so the tool-call rescue
    // does not fire on it. That is the right answer — there is nothing runnable
    // in it — and the reason the model is told the word it wrote is the word we
    // could read.
    const asObject = ReActResponse.parse('{"think":["a"],"act":{"tool":"shell"},"result":""}')
    expect(asObject.act).toBe(ACT_UNSAID)
    expect(asObject.unsaidBecause).toContain('[object Object]')
  })

  test('an act missing from a reply that reached the contract is unsaid', () => {
    // The shape of a truncated reply: the model wrote `think` and stopped. There
    // is no fourth field to read and no decision anywhere, so the loop must not
    // treat the empty `result` as the answer.
    const response = new ReActResponse({ think: ['half a thought'] })

    expect(response.act).toBe(ACT_UNSAID)
    expect(response.isAnswer).toBe(false)
    // The other route's words, and they must not mention a word the model
    // wrote: it wrote none.
    expect(response.unsaidBecause).toBe('the reply stopped before it reached the act line')
  })

  test('an act missing from a reply that reached nothing still answers', () => {
    // The other side of the same rule, and the reason `normalize` is given the
    // values rather than only the object: a reply that supplied no field before
    // `act` is not a contract that stopped, it is prose. `parse`'s last resort
    // builds exactly this, and making it unsaid would spend a turn correcting a
    // reply that is already the answer.
    expect(new ReActResponse({}).act).toBe(ACT_ANSWER)
    expect(new ReActResponse({ result: 'hi' }).isAnswer).toBe(true)
    expect(new ReActResponse({ act: null, result: 'hi' }).isAnswer).toBe(true)
  })
})

describe('ReActResponse.parse', () => {
  test('a TOON reply with the call in act is repaired end to end', () => {
    const parsed = ReActResponse.parse(
      [
        'think: [i need the kernel version]',
        '',
        'plan: []',
        '',
        'act: shell({"command": "uname -a"})',
        '',
        'result:',
      ].join('\n'),
    )

    expect(parsed.think).toEqual(['i need the kernel version'])
    expect(parsed.plan).toEqual([])
    expect(parsed.isToolCall).toBe(true)
    // `answer` is what the engine hands the toolbox — the call text itself.
    expect(parsed.answer).toBe('shell({"command": "uname -a"})')
  })

  test('a well-formed tool turn parses without repair', () => {
    const parsed = ReActResponse.parse(
      [
        'think: []',
        '',
        'plan: [check the file]',
        '',
        'act: tool',
        '',
        'result: shell({"command": "ls /"})',
      ].join('\n'),
    )

    expect(parsed.isToolCall).toBe(true)
    expect(parsed.answer).toBe('shell({"command": "ls /"})')
  })

  test('a REAL reply cut off before the act line does not end the run', () => {
    // Captured off `http://127.0.0.1:8873/v1` with `max_tokens: 1135` on this
    // tree's own step-1 prompt: `finish_reason: length`, `reasoning_content`
    // present and correctly routed, and `content` stopping inside `plan:`.
    //
    // Before the fix this parsed to `act: answer` with an EMPTY `result`, so the
    // loop ended and `ChatService` wrote "(the model returned nothing)" into the
    // transcript as the assistant's reply. Nothing raised anywhere.
    const captured = JSON.parse(fixture('truncated-mid-contract.json'))
    const text = captured.choices[0].message.content

    expect(text).not.toContain('act:')
    const parsed = ReActResponse.parse(text)

    expect(parsed.think).toHaveLength(2)
    expect(parsed.result).toBe('')
    expect(parsed.act).toBe(ACT_UNSAID)
    expect(parsed.isAnswer).toBe(false)
  })

  test('a reply with no fields at all becomes the answer instead of an error', () => {
    // The whole point of parse never failing: the model said something, and
    // showing it beats showing a parse error.
    const parsed = ReActResponse.parse('Sorry, I have no idea what fields are.')

    expect(parsed.isAnswer).toBe(true)
    expect(parsed.answer).toBe('Sorry, I have no idea what fields are.')
    expect(parsed.think).toEqual([])
  })

  test('a JSON reply is read even when TOON was asked for', () => {
    const parsed = ReActResponse.parse(
      'Here you go:\n```json\n{"think": "one thought", "plan": [], "act": "answer", "result": "42"}\n```',
    )

    expect(parsed.answer).toBe('42')
    // A list field written as a string is coerced rather than dropped.
    expect(parsed.think).toEqual(['one thought'])
  })

  test('a multi-line result keeps its line breaks and stops at the next field', () => {
    const parsed = ReActResponse.parse(
      ['act: answer', '', 'result: line one', 'line two', '', 'line three'].join('\n'),
    )

    expect(parsed.result).toBe('line one\nline two\n\nline three')
  })

  test('a list item containing a comma inside brackets is one item', () => {
    const parsed = ReActResponse.parse(
      'plan: [call shell({"a": 1, "b": 2}), then answer]\n\nact: answer\n\nresult: done',
    )

    expect(parsed.plan).toEqual(['call shell({"a": 1, "b": 2})', 'then answer'])
  })

  test('markdown decoration on the field names does not hide them', () => {
    const parsed = ReActResponse.parse(
      ['**think:** [none]', '', '**act:** answer', '', '**result:** the answer'].join('\n'),
    )

    expect(parsed.act).toBe(ACT_ANSWER)
    expect(parsed.result).toBe('the answer')
  })
})

describe('the contract the model is shown', () => {
  test('the instructions name every field, in declaration order, with a real act example', () => {
    const instructions = ReActResponse.instructions()

    expect(instructions.startsWith('# RESPONSE FORMAT')).toBe(true)
    expect(instructions).toContain('- think (list):')
    expect(instructions).toContain('- act:')
    expect(instructions.indexOf('- think')).toBeLessThan(instructions.indexOf('- plan'))
    expect(instructions.indexOf('- plan')).toBeLessThan(instructions.indexOf('- act'))
    expect(instructions.indexOf('- act')).toBeLessThan(instructions.indexOf('- result'))
    // The example shows the word the model has to write. `act: <your act here>`
    // was a placeholder that read as an invitation to write a tool name there.
    expect(instructions).toContain('\nact: answer\n')
  })

  test('the counter-example is gone, and this test no longer pins it in place', () => {
    // This assertion used to run the other way round: it required
    // `act: echo({"text": "hello"})` to be PRESENT because `normalize` exists to
    // repair it — which is backwards. A repair existing is a reason to spend
    // fewer prompt tokens on the case, not more, and docs/PROMPT-AUDIT.md
    // measured both arms at 0/16 on the mistake the block exists to prevent.
    const instructions = ReActResponse.instructions()

    expect(instructions).not.toContain('WRONG (never do this)')
    expect(instructions).not.toContain('echo({"text": "hello"})')
    expect(instructions).not.toContain('CORRECT (final reply)')
  })

  test('rules the parser repairs are not also charged for on every call', () => {
    // Each of these was a numbered rule with a measured 0/48 violation rate —
    // including in the arm that never stated it — sitting in front of a repair
    // in `BaseResponse._parseToon` that runs whether the rule is stated or not.
    const instructions = ReActResponse.instructions()

    expect(instructions).not.toContain('Rules:')
    expect(instructions).not.toContain('lowercase name')
    expect(instructions).not.toContain('No markdown decoration')
    expect(instructions).not.toContain('do not repeat the field name')
  })

  test('bracket notation survives, folded into the two list field descriptions', () => {
    // The one rule the experiment refused to give up. Deleting it outright
    // produced four bulleted `think:` blocks in sixteen replies — the exact
    // failure it names. Stating it inside the field description, at about six
    // tokens, produced none. Folded, not deleted.
    const instructions = ReActResponse.instructions()

    expect(instructions).toContain('- think (list): Your private reasoning')
    expect(instructions).toContain('- plan (list): The concrete next steps')
    expect(instructions.match(/`\[a, b\]`/g)).toHaveLength(2)
  })

  test('the contract stays under a third of the prompt it used to be', () => {
    // A ratchet, not a vanity number. This block was 463 tokens — 42% of
    // everything sent, more than the system text and the whole tool table
    // combined. If it climbs back past 300 someone is adding rules again, and
    // the finding it would have to argue against is 192 calls in which the
    // 463-token contract and this one both scored 86% strict-clean, p = 1.00.
    //
    // It only weighs ReActResponse, which is why the sibling test asserts that
    // `formatNotes` is gone rather than merely unused: a rules block returning
    // through a per-subclass hook would never be weighed here at all.
    expect(estimateTokens(ReActResponse.instructions())).toBeLessThan(300)
  })

  test('the reminder is one line naming the fields and nothing else', () => {
    const reminder = ReActResponse.reminder()

    expect(reminder).toBe(
      'Reply with these fields, in this order, one per line: think, plan, act, result.',
    )
  })
})
