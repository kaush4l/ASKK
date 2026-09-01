import { describe, expect, test } from 'bun:test'
import { Format } from '../../../src/core/response/BaseResponse.js'
import { ACT_ANSWER, ACT_TOOL, ReActResponse } from '../../../src/core/response/ReActResponse.js'

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

  test('a bare tool name in act becomes answer, not a call', () => {
    // `act: shell` is the model naming a tool where a verb belongs, with no
    // call anywhere. There is nothing to run, so the turn ends rather than
    // looping on text that contains no call — this is what stops a run that
    // could otherwise never terminate.
    const response = new ReActResponse({ act: 'shell', result: 'the file is empty' })

    expect(response.act).toBe(ACT_ANSWER)
    expect(response.isAnswer).toBe(true)
  })

  test('an absent act defaults to answer, so a stripped reply ends the run', () => {
    expect(new ReActResponse({}).act).toBe(ACT_ANSWER)
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
  test('the instructions name every field, in declaration order, with the wrong-act example', () => {
    const instructions = ReActResponse.instructions(Format.TOON)

    expect(instructions.startsWith('# RESPONSE FORMAT')).toBe(true)
    expect(instructions).toContain('in this order: think, plan, act, result')
    expect(instructions).toContain('- think (list):')
    expect(instructions).toContain('- act:')
    // The one mistake worth spending prompt tokens on, because it is the one
    // `normalize` exists to repair.
    expect(instructions).toContain('act: echo({"text": "hello"})')
    expect(instructions).toContain('WRONG (never do this):')
  })

  test('the reminder is one line naming the fields and nothing else', () => {
    const reminder = ReActResponse.reminder(Format.TOON)

    expect(reminder).toBe(
      'Reply with these fields, in this order, one per line: think, plan, act, result.',
    )
    expect(reminder).not.toContain('\n')
  })

  test('a response round-trips through its own written form', () => {
    const original = new ReActResponse({ think: ['a', 'b'], plan: [], act: 'answer', result: 'hi' })

    const reparsed = ReActResponse.parse(original.toString(Format.TOON))

    expect(reparsed.toJSON()).toEqual(original.toJSON())
  })
})
