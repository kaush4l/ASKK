import { describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  armRules,
  BANNED,
  blindTranscript,
  DISCLOSURE,
  ENDING_LINES,
  ENDINGS,
  endingOf,
  findTerms,
  findTools,
  frame,
  kindOf,
  letterFor,
  mapTools,
  outcomeOf,
  REPLACEMENTS,
  RUBRIC,
  readTurn,
  renderPrompt,
  renderTurns,
  residue,
  scrub,
  separation,
  slotsFor,
  toolsOf,
} from '../../bench/blind.js'

/**
 * The blind set, held to what it claims: that it is ONE projection of two
 * loops — tool identifiers and reply grammar rendered the same way for both
 * arms, the assembled prompt rendered once under the same mapping, every ending
 * in one vocabulary — and that the gate exits 1 on anything that names an arm.
 *
 * P4, decided by the lead after two panels were spent on a set the gate
 * refused: the projection is not the artifact, so a tool name may be rendered
 * as a slot HERE while nothing in `src/` or either scaffold is renamed. A judge
 * scores what the loop did with its tools, not what the tools were called.
 */

const OURS_PROMPT = [
  'You are a careful, direct assistant running entirely inside the user’s browser.',
  '',
  '# TOOLS',
  '',
  '- read_file({"path": string})',
  '    Read a file from the workspace and return its whole contents.',
  '- write_file({"path": string, "content": string})',
  '    Create a file, or replace one entirely.',
  '- list_files({"path?": string})',
  '    List what is in a directory of the workspace, with sizes.',
  '- shell({"command": string})',
  '    Run a command in the workspace with /bin/sh.',
  '',
  '# RESPONSE FORMAT',
  '',
  '- think (list): Your private reasoning',
  "- act: Exactly 'tool' or exactly 'answer'.",
  '',
  '# CONVERSATION',
  '',
  '[USER]: do a thing',
  '',
  'The workspace is /Users/kaush/Downloads/Dev/ASKK/bench/work/probe/ours/1. Every path is relative to it.',
  '',
  '# CONTEXT',
  '',
  'now: Tuesday, 1 September 2026 at 15:36 (America/New_York)',
].join('\n')

const AZ_SYSTEM = [
  '# Agent Zero System Manual',
  '',
  '## your role',
  'agent zero autonomous json ai agent.',
  '',
  '## Environment',
  'your working directory is /Users/kaush/Downloads/Dev/ASKK/bench/work/probe/agent-zero/1 and every path you use is relative to it',
  'the shell is /bin/sh, one command per call',
  '',
  '### Response format (json fields names)',
  '- thoughts: array thoughts before execution in natural language',
  '- tool_name: use tool name',
  '',
  '## available tools',
  '',
  '### response:',
  'final response to user',
  '{"tool_name": "response", "tool_args": {"text": "..."}}',
  '',
  '### code_execution_tool',
  'execute code',
  '{"tool_name": "code_execution_tool", "tool_args": {"runtime": "terminal", "code": "ls"}}',
  '',
  '### text_editor',
  'read or write a file',
  '',
  '#### read',
  '{"tool_name": "text_editor", "tool_args": {"action": "read", "path": "x"}}',
].join('\n')

/** A recorded run in the shape `run.js` writes, in our arm's action shape. */
function oursRecord({ answer = 'the final answer', events = null, check = null } = {}) {
  return {
    task: 'probe',
    scaffold: 'ours',
    index: 1,
    check: check ?? { pass: true, checks: [{ name: 'a thing was done', ok: true }] },
    run: {
      answer,
      stop: 'answered',
      turns: 2,
      tokens: { prompt: 100, completion: 50, total: 150 },
      events: events ?? [
        { type: 'task', at: 0, text: 'do a thing' },
        { type: 'request', at: 1, messages: [{ role: 'user', content: OURS_PROMPT }] },
        {
          type: 'reply',
          at: 1,
          content:
            'think: [Need to look]\n\nplan: [List, then read]\n\nact: tool\n\nresult: list_files({})\nread_file({"path": "x.py"})',
          reasoning: 'Need output:\nthink: [...]\nplan: [...]\nact: tool\nresult: list_files({})',
          finish: 'stop',
          state: 'whole',
          notes: [],
          model: 'a-model',
          ms: 1000,
          usage: { completion_tokens: 7 },
        },
        {
          type: 'action',
          at: 1,
          action: {
            kind: 'tool',
            call: 'list_files({})\nread_file({"path": "x.py"})',
            raw: 'think: [Need to look]\n\nplan: [List, then read]\n\nact: tool\n\nresult: list_files({})\nread_file({"path": "x.py"})',
            parsed: {
              think: ['Need to look'],
              plan: ['List', 'then read'],
              act: 'tool',
              result: 'list_files({})\nread_file({"path": "x.py"})',
            },
          },
        },
        {
          type: 'observation',
          at: 1,
          observation: 'list_files -> x.py  12 bytes\nread_file -> print(1)\n',
          ran: [
            { name: 'list_files', args: '' },
            { name: 'read_file', args: '{"path": "x.py"}' },
          ],
        },
        {
          type: 'request',
          at: 2,
          messages: [
            {
              role: 'user',
              content: OURS_PROMPT.replace(
                '# CONTEXT',
                '# WORK SO FAR\n\naction: list_files({})\nobservation: list_files -> x.py  12 bytes\n\n# CONTEXT',
              ),
            },
          ],
        },
        {
          type: 'reply',
          at: 2,
          content: 'think: []\n\nplan: []\n\nact: answer\n\nresult: the final answer',
          reasoning: '',
          finish: 'stop',
          state: 'whole',
          notes: [],
          model: 'a-model',
          ms: 900,
          usage: { completion_tokens: 9 },
        },
        {
          type: 'action',
          at: 2,
          action: {
            kind: 'answer',
            text: 'the final answer',
            raw: 'think: []\n\nplan: []\n\nact: answer\n\nresult: the final answer',
            parsed: { think: [], plan: [], act: 'answer', result: 'the final answer' },
          },
        },
      ],
    },
  }
}

/** The same run in the reference arm's action shape. */
function azRecord({ answer = 'the final answer', events = null } = {}) {
  const reply1 =
    '{"thoughts": ["I need to read x.py"], "headline": "Reading x.py", "tool_name": "text_editor", "tool_args": {"action": "read", "path": "x.py"}}'
  const reply2 =
    '{"thoughts": ["Done"], "headline": "Answering", "tool_name": "response", "tool_args": {"text": "the final answer"}}'
  return {
    task: 'probe',
    scaffold: 'agent-zero',
    index: 1,
    check: { pass: false, checks: [{ name: 'a thing was done', ok: false, detail: 'nope' }] },
    run: {
      answer,
      stop: 'answered',
      turns: 2,
      tokens: { prompt: 300, completion: 60, total: 360 },
      events: events ?? [
        { type: 'task', at: 0, text: 'do a thing' },
        {
          type: 'request',
          at: 1,
          messages: [
            { role: 'system', content: AZ_SYSTEM },
            { role: 'user', content: '{"user_message":"do a thing"}' },
          ],
        },
        {
          type: 'reply',
          at: 1,
          content: reply1,
          reasoning: 'Use text_editor to read. Output JSON with tool_name.',
          finish: 'stop',
          state: 'whole',
          notes: [],
          model: 'a-model',
          ms: 1000,
          usage: { completion_tokens: 7 },
        },
        {
          type: 'action',
          at: 1,
          action: {
            kind: 'tool',
            tool: 'text_editor',
            args: { action: 'read', path: 'x.py' },
            raw: reply1,
          },
        },
        {
          type: 'observation',
          at: 1,
          observation: 'print(1)\n',
          ran: [{ name: 'read_file', args: { path: 'x.py' } }],
        },
        {
          type: 'request',
          at: 2,
          messages: [
            { role: 'system', content: AZ_SYSTEM },
            { role: 'user', content: '{"user_message":"do a thing"}' },
            { role: 'assistant', content: reply1 },
            { role: 'user', content: '{"tool_name":"text_editor","result":"print(1)\\n"}' },
          ],
        },
        {
          type: 'reply',
          at: 2,
          content: reply2,
          reasoning: '',
          finish: 'stop',
          state: 'whole',
          notes: [],
          model: 'a-model',
          ms: 900,
          usage: { completion_tokens: 9 },
        },
        {
          type: 'action',
          at: 2,
          action: {
            kind: 'answer',
            tool: 'response',
            args: { text: 'the final answer' },
            text: 'the final answer',
            raw: reply2,
          },
        },
      ],
    },
  }
}

describe('readTurn: the four things both formats carry, read off either shape', () => {
  test('the reference arm’s envelope — thoughts, headline, tool, args', () => {
    const turn = readTurn(azRecord().run.events[3].action)
    expect(turn.reasoning).toEqual(['I need to read x.py', 'Reading x.py'])
    expect(turn.calls).toEqual([{ tool: 'text_editor', args: { action: 'read', path: 'x.py' } }])
    expect(turn.answer).toBeNull()
    expect(turn.malformed).toBeNull()
  })

  test('our arm’s call lines — think, plan, every call on its own row', () => {
    const turn = readTurn(oursRecord().run.events[3].action)
    expect(turn.reasoning).toEqual(['Need to look', 'List', 'then read'])
    expect(turn.calls).toEqual([
      { tool: 'list_files', args: {} },
      { tool: 'read_file', args: { path: 'x.py' } },
    ])
  })

  test('an answer is an answer in both shapes, with its reasoning kept', () => {
    const ours = readTurn(oursRecord().run.events[7].action)
    const az = readTurn(azRecord().run.events[7].action)
    expect(ours.answer).toBe('the final answer')
    expect(az.answer).toBe('the final answer')
    expect(az.reasoning).toEqual(['Done', 'Answering'])
    expect(ours.calls).toEqual([])
    expect(az.calls).toEqual([])
  })

  test('a reply that did not fit the contract is read as such, not as a call', () => {
    const turn = readTurn({
      kind: 'malformed',
      reason: 'misformat',
      note: 'You have misformatted your message.',
      raw: '{"thoughts": ["half a',
    })
    expect(turn.malformed).toEqual({
      reason: 'misformat',
      note: 'You have misformatted your message.',
    })
    expect(turn.calls).toEqual([])
    expect(turn.reasoning).toEqual([])
  })

  test('a reply cut inside its envelope still yields the thoughts that arrived whole', () => {
    // `median-bug/agent-zero/1` turn 2 in the recorded set: the model's whole
    // diagnosis of the bug sits in a reply the token ceiling cut at
    // `"tool_name": "text_edi`, the harness scored it a misformat, and the
    // projection rendered `reasoning: (none)` over it. A judge scoring the
    // loop's reasoning was shown nothing where the record holds the most.
    const turn = readTurn({
      kind: 'malformed',
      reason: 'misformat',
      note: 'You have misformatted your message.',
      raw: [
        '{',
        '    "thoughts": [',
        '        "The bug: E.g. [1,2,3,4] returns 3 instead of 2.5.",',
        '        "Fix: average ordered[middle-1] and ordered[middle].",',
        '        "I\'ll write the fixed file, then verify: te',
      ].join('\n'),
    })
    // Every string that closed is a thought; the one the ceiling cut is not
    // guessed at, and a `]` inside a thought does not end the list early.
    expect(turn.reasoning).toEqual([
      'The bug: E.g. [1,2,3,4] returns 3 instead of 2.5.',
      'Fix: average ordered[middle-1] and ordered[middle].',
    ])
    expect(turn.malformed?.reason).toBe('misformat')
    const withHeadline = readTurn({
      kind: 'malformed',
      reason: 'misformat',
      note: '',
      raw: '{"thoughts": ["a", "b"], "headline": "Writing it", "tool_name": "text_edi',
    })
    expect(withHeadline.reasoning).toEqual(['a', 'b', 'Writing it'])
  })

  test('an argument text that is not JSON is carried as text rather than dropped', () => {
    const turn = readTurn({ kind: 'tool', call: 'shell(ls -la)', raw: '', parsed: {} })
    expect(turn.calls).toEqual([{ tool: 'shell', args: 'ls -la' }])
  })
})

describe('the tool vocabulary is read off the run, per arm', () => {
  test('listed in the first prompt, in listing order, in both listing shapes', () => {
    expect(toolsOf(oursRecord())).toEqual(['read_file', 'write_file', 'list_files', 'shell'])
    expect(toolsOf(azRecord())).toEqual(['code_execution_tool', 'text_editor'])
  })

  test('a tool used as the ANSWER is not a tool the projection names', () => {
    // `response` is listed as a tool and rendered by this projection as an
    // ending. Mapping it would rewrite every English "response" in one arm's
    // files and make the word's absence a separator in the other's.
    expect(toolsOf(azRecord())).not.toContain('response')
  })

  test('a tool used but not listed is still vocabulary', () => {
    const record = oursRecord()
    record.run.events[3].action.call = 'search({"q": "x"})'
    expect(toolsOf(record)).toContain('search')
  })

  test('slots are assigned in order of first use across the arm’s whole set, then listing order', () => {
    const first = oursRecord()
    const second = oursRecord()
    second.run.events[3].action.call =
      'shell({"command": "ls"})\nwrite_file({"path": "a", "content": "b"})'
    const slots = slotsFor([first, second])
    expect([...slots.entries()]).toEqual([
      ['list_files', 'tool_1'],
      ['read_file', 'tool_2'],
      ['shell', 'tool_3'],
      ['write_file', 'tool_4'],
    ])
    // The same tool gets the same slot in every file of one arm.
    expect(slotsFor([second, first]).get('list_files')).toBe('tool_3')
  })

  test('longer names are mapped before the names inside them', () => {
    const slots = new Map([
      ['editor', 'tool_1'],
      ['text_editor', 'tool_2'],
    ])
    expect(mapTools('text_editor and editor', slots)).toBe('tool_2 and tool_1')
  })

  test('mapping is whole-word and case-sensitive, and sees through an escaped newline', () => {
    const slots = new Map([['read_file', 'tool_1']])
    expect(mapTools('call read_file now', slots)).toBe('call tool_1 now')
    expect(mapTools('read_files or my_read_file', slots)).toBe('read_files or my_read_file')
    expect(mapTools('Read_file', slots)).toBe('Read_file')
    // The nine leaks of the first panel: a `\b`-bounded rename left every
    // occurrence preceded by an escaped newline inside a JSON string.
    expect(mapTools('"result: \\nread_file({})"', slots)).toBe('"result: \\ntool_1({})"')
  })

  test('the verifier finds what the mapper would have mapped, and nothing else', () => {
    expect(findTools('call read_file now', ['read_file'], 'f').length).toBe(1)
    expect(findTools('"\\nread_file({})"', ['read_file'], 'f').length).toBe(1)
    expect(findTools('read_files', ['read_file'], 'f')).toEqual([])
    expect(findTools('the response was', ['response'], 'f').length).toBe(1)
  })
})

describe('one turn grammar for both arms', () => {
  test('a turn is reasoning, call, result — and never the reply as written', () => {
    for (const record of [oursRecord(), azRecord()]) {
      const out = renderTurns(record)
      expect(out).toContain('## turn 1')
      expect(out).toContain('reasoning:')
      expect(out).toContain('call: ')
      expect(out).toContain('result:')
      expect(out).toContain('## turn 2 — answered')
      expect(out).toContain('the final answer')
      // The reply grammar is the thing that separated 5 of 5 pairs on sight.
      expect(out).not.toContain('think:')
      expect(out).not.toContain('act: ')
      expect(out).not.toContain('"tool_name"')
      expect(out).not.toContain('"thoughts"')
      expect(out).not.toContain('headline')
      // The private reasoning channel is where the model rehearses its output
      // format verbatim, and no harness ever reads it.
      expect(out).not.toContain('reasoning channel')
      expect(out).not.toContain('Need output:')
      expect(out).not.toContain('Output JSON')
    }
  })

  test('arguments render as key: value, a multi-line value as an indented block', () => {
    const record = azRecord()
    record.run.events[3].action = {
      kind: 'tool',
      tool: 'text_editor',
      args: { action: 'write', path: 'x.py', content: 'a\nb\n' },
      raw: '',
    }
    const out = renderTurns(record)
    expect(out).toContain(
      'call: text_editor\n  action: write\n  path: x.py\n  content:\n    a\n    b\n',
    )
  })

  test('our arm’s several calls in one turn are several call rows', () => {
    const out = renderTurns(oursRecord())
    expect(out).toContain('call: list_files\n')
    expect(out).toContain('call: read_file\n  path: x.py\n')
  })

  test('a reply that did not fit the contract says so, and shows what the harness said back', () => {
    const record = azRecord()
    record.run.events[3].action = {
      kind: 'malformed',
      reason: 'misformat',
      note: 'You have misformatted your message.',
      raw: '{"thoughts": ["half',
    }
    record.run.events[4].observation = 'You have misformatted your message.'
    const out = renderTurns(record)
    expect(out).toContain('call: none — the reply did not fit the contract (misformat)')
    expect(out).toContain('You have misformatted your message.')
    expect(out).toContain('reasoning:\n- (none)')
    // The same reply cut one thought later: what closed is rendered.
    record.run.events[3].action.raw = '{"thoughts": ["The bug is on line 3", "half'
    expect(renderTurns(record)).toContain('reasoning:\n- The bug is on line 3\n')
  })

  test('every ending in the vocabulary is one a recorded run can reach', () => {
    // Derived, not restated: `endingOf` is asked for every stop the driver
    // records, and `renderTurns` for the one note it writes mid-run. A word in
    // `ENDINGS` that neither produces is a declared-and-never-emitted ending,
    // this tree's recurring defect.
    const refusal = (state) => ({
      stop: 'transport-refused',
      events: [{ type: 'transport-refusal', state }],
    })
    const stops = [
      { stop: 'answered', events: [] },
      refusal('thinking'),
      refusal('spent'),
      refusal('whole'),
      { stop: 'scaffold-stop', events: [] },
      { stop: 'cap', events: [] },
      { stop: 'endpoint-error', events: [] },
    ].map((run) => endingOf(run))
    const cut = azRecord()
    cut.run.events[2].state = 'cut'
    const noted = Object.values(ENDINGS).filter((ending) => renderTurns(cut).includes(ending))
    expect(new Set([...stops, ...noted])).toEqual(new Set(Object.values(ENDINGS)))
    // `cut` is the mid-run note and not a stop: a run that was cut went on.
    expect(stops).not.toContain(ENDINGS.cut)
    expect(noted).toContain(ENDINGS.cut)
  })

  test('no sentence this renderer writes beside an ending carries a string the scrub writes', () => {
    // "harness" is what `scaffold` scrubs to, and an ending sentence carrying
    // `this harness` sorted three pairs toward the arm that ran out of tokens.
    // `kindOf` classes a replacement before an ending, so such a sentence
    // would be fatal to the gate rather than merely wrong; this pins it at
    // the source.
    const sentences = [
      ...Object.values(ENDINGS),
      ENDING_LINES.refusal(1200),
      ENDING_LINES.own,
      ENDING_LINES.cap(12),
      ENDING_LINES.cut,
    ]
    for (const sentence of sentences) {
      for (const replacement of REPLACEMENTS) expect(sentence).not.toContain(replacement)
    }
    expect(kindOf(ENDINGS.scratchpad)).toBe('ending')
  })

  test('a reply that ran out of tokens in its scratchpad ends the run in those words', () => {
    for (const state of ['thinking', 'spent']) {
      const record = oursRecord()
      record.run.stop = 'transport-refused'
      record.run.events = [
        ...record.run.events.slice(0, 2),
        {
          type: 'reply',
          at: 1,
          content: '',
          reasoning: '',
          finish: 'length',
          state,
          notes: [],
          ms: 1,
          usage: { completion_tokens: 1200 },
        },
        {
          type: 'transport-refusal',
          at: 1,
          state,
          message:
            'openai-compatible: the reply ran out of tokens while the model was still thinking, so 4,808 characters of its private reasoning arrived on the answer channel',
          hint: 'Raise max tokens (currently 1,200)',
        },
      ]
      const out = renderTurns(record)
      expect(out).toContain('## turn 1 — ran out of tokens in its scratchpad')
      expect(out).toContain('1200 tokens')
      expect(out).not.toContain('openai-compatible')
      expect(out).not.toContain('private reasoning')
      expect(out).not.toContain('Raise max tokens')
      expect(endingOf(record.run)).toBe('ran out of tokens in its scratchpad')
    }
  })

  test('a cut reply is noted in those words and the turn goes on', () => {
    const record = azRecord()
    record.run.events[2].state = 'cut'
    record.run.events[2].notes = [
      'the reply was cut off at the 1,200-token limit after 416 characters, so it may stop mid-sentence',
    ]
    const out = renderTurns(record)
    expect(out).toContain('> cut mid-reply at the token ceiling; what arrived is read below')
    expect(out).not.toContain('1,200-token limit')
    expect(out).toContain('call: text_editor')
  })

  test('a refusal for any other reason is refused, and the transport’s own words stay out', () => {
    const record = oursRecord()
    record.run.stop = 'transport-refused'
    record.run.events = [
      ...record.run.events.slice(0, 2),
      { type: 'reply', at: 1, content: '', state: 'whole', notes: [], ms: 1, usage: {} },
      {
        type: 'transport-refusal',
        at: 1,
        state: 'whole',
        message: 'openai-compatible: no content',
        hint: '',
      },
    ]
    expect(renderTurns(record)).toContain('## turn 1 — refused')
    expect(renderTurns(record)).not.toContain('no content')
    expect(endingOf(record.run)).toBe('refused')
  })

  test('a ceiling — the harness’s own or the rig’s — is stopped at a ceiling', () => {
    const own = oursRecord()
    own.run.stop = 'scaffold-stop'
    own.run.events = [
      ...own.run.events.slice(0, 5),
      { type: 'scaffold-stop', at: 1, reason: 'the budget of 600 seconds is spent' },
    ]
    expect(renderTurns(own)).toContain('## turn 1 — stopped at a ceiling')
    expect(renderTurns(own)).toContain('the budget of 600 seconds is spent')
    expect(endingOf(own.run)).toBe('stopped at a ceiling')

    const rig = oursRecord()
    rig.run.stop = 'cap'
    rig.run.events = [...rig.run.events.slice(0, 5), { type: 'turn-cap', at: 12, limit: 12 }]
    expect(renderTurns(rig)).toContain('## stopped at a ceiling — the rig’s 12-turn cap')
    expect(endingOf(rig.run)).toBe('stopped at a ceiling')
  })

  test('an endpoint that served nothing is the endpoint’s failure', () => {
    const record = oursRecord()
    record.run.stop = 'endpoint-error'
    record.run.events = [
      ...record.run.events.slice(0, 2),
      { type: 'endpoint-error', at: 1, error: 'fetch failed', hint: '', ms: 3 },
    ]
    expect(renderTurns(record)).toContain('## turn 1 — the endpoint failed')
    expect(endingOf(record.run)).toBe('the endpoint failed')
  })
})

describe('the prompt comes back, once, under its own heading', () => {
  test('every message of the first request, by role, after the loop', () => {
    const out = renderPrompt(azRecord())
    expect(out).toContain('## the prompt, as assembled for turn 1')
    expect(out).toContain('### system')
    expect(out).toContain('### user')
    expect(out).toContain('## available tools')
    const single = renderPrompt(oursRecord())
    expect(single).toContain('### user')
    expect(single).not.toContain('### system')
    expect(single).toContain('# TOOLS')
  })

  test('and what the second request added, so the re-entry of an observation can be seen', () => {
    const ours = renderPrompt(oursRecord())
    expect(ours).toContain('## what the prompt for turn 2 added')
    expect(ours).toContain('# WORK SO FAR')
    expect(ours).toContain('observation: list_files -> x.py  12 bytes')
    const az = renderPrompt(azRecord())
    expect(az).toContain('### assistant')
    expect(az).toContain('"result":"print(1)\\n"')
  })

  test('a run with one request has nothing to add and says so', () => {
    const record = oursRecord()
    record.run.events = record.run.events.slice(0, 5)
    expect(renderPrompt(record)).toContain('(the run made one request)')
  })

  test('in the emitted file, the prompt carries the same slots and the same scrub as the turns', () => {
    const slots = slotsFor([azRecord()])
    const {
      text: out,
      turns,
      prompt,
    } = blindTranscript(azRecord(), 'probe', 'A', {
      armIds: ['agent-zero', 'ours'],
      slots,
    })
    expect(out).toBe(frame('probe', 'A', `${turns}\n${prompt}`))
    expect(out).toContain('### tool_1')
    expect(out).toContain('"tool_name": "tool_1"')
    expect(out).not.toContain('code_execution_tool')
    expect(out).not.toContain('text_editor')
    expect(out).not.toContain('Agent Zero')
    expect(out).not.toContain('/Users/')
    expect(out).toContain('/project')
    // The turns come before the prompt: the loop is what is judged, the
    // prompt is what it was judged under.
    expect(out.indexOf('## turn 1')).toBeLessThan(out.indexOf('## the prompt, as assembled'))
  })
})

describe('paths go first, and go whole, to ONE replacement', () => {
  test('a workspace path carrying the harness’s own name leaves nothing behind', () => {
    const line = 'cd /Users/kaush/Downloads/Dev/ASKK/bench/work/collatz/agent-zero/1 && ls'
    expect(scrub(line)).toBe('cd /project && ls')
  })

  test('a scratch-harness temp path goes to the same word, so a path cannot name an arm', () => {
    // `/private/tmp/…` used to become `/workspace` while `/Users/…` became
    // `/project`, and `/workspace` then sat in one arm's file and no other.
    expect(scrub('/private/tmp/claude-501/-Users-kaush-Downloads-Dev-ASKK/x/rig/work/a')).toBe(
      '/project',
    )
    expect(scrub('-Users-kaush-Downloads-Dev-ASKK')).toBe('-project')
  })

  test('the run directory as a bare relative path, with or without the rig’s prefix', () => {
    expect(scrub('I wrote it to bench/work/slugify-module/ours/1/src/x.js')).toBe(
      'I wrote it to /project',
    )
    // What the model reads back off its own cwd — `no-such-capability/ours/1`
    // appeared seven times in one run's reasoning. The arm name is inside a
    // fragment the arm rule would turn into `this harness`, which reached one
    // arm's file and no other; the fragment goes to the path word instead.
    expect(
      scrub('Directory name no-such-capability/ours/1 suggests a test', ['agent-zero', 'ours'], {
        tasks: ['no-such-capability'],
      }),
    ).toBe('Directory name /project suggests a test')
  })
})

describe('the arms’ own names, read off the run', () => {
  test('a bare arm name goes, and a prose word containing one is left alone', () => {
    expect(scrub('ours ran; yourself did not', ['ours'])).toBe('this harness ran; yourself did not')
    expect(scrub('ours/1', [])).toBe('ours/1')
  })

  test('the rule is built per id, so a third harness is covered by existing', () => {
    expect(armRules(['a', 'b']).length).toBe(2)
    expect(scrub('a and b ran', ['a', 'b'])).toBe('this harness and this harness ran')
  })
})

describe('names', () => {
  test('every spelling of the reference project', () => {
    const out = scrub('Agent Zero System Manual / agent-zero / agent zero / Agent_Zero / frdel')
    for (const term of ['Agent Zero', 'agent-zero', 'agent zero', 'frdel']) {
      expect(out).not.toContain(term)
    }
  })

  test('our own project name, in either casing', () => {
    expect(scrub('ASKK and askk')).not.toMatch(/askk/i)
  })

  test('every banned term is actually removed by the scrub it guards', () => {
    for (const term of BANNED) {
      const out = scrub(`prefix ${term} suffix`)
      expect(`${term} -> ${out.includes(term)}`).toBe(`${term} -> false`)
    }
  })

  test('BANNED names both projects, the user, the workspace and the rig', () => {
    for (const term of ['agent-zero', 'frdel', 'ASKK', 'kaush', 'bench/work', 'scaffold']) {
      expect(BANNED).toContain(term)
    }
  })
})

describe('A/B assignment', () => {
  test('deterministic, never the same order for every task, and — S59 — not one map for every index', () => {
    const tasks = ['collatz', 'median-bug', 'pointer-chase', 'no-such-capability', 'slugify-module']
    for (const task of tasks) {
      expect(letterFor(task, '1', 0)).toBe(letterFor(task, '1', 0))
      expect(letterFor(task, '1', 0)).not.toBe(letterFor(task, '1', 1))
    }
    expect(new Set(tasks.map((task) => letterFor(task, '1', 0))).size).toBe(2)
    // Three indices used to share one map, character for character, so a
    // judge who guessed once had guessed all three.
    const maps = ['1', '2', '3'].map((index) =>
      tasks.map((task) => letterFor(task, index, 0)).join(''),
    )
    expect(new Set(maps).size).toBe(3)
    // Indices 1 and 3 in particular: the first fix for S59 was `h * 31 + c`,
    // whose parity is the parity of the character SUM (31 is odd), and the
    // codes of '1' and '3' are both odd — so those two indices stayed one map
    // and only index 2 got its own. The hash is now a standard one, and a
    // standard's output is pinned by the standard rather than by this file.
    expect(maps[0]).not.toBe(maps[2])
  })
})

/**
 * S60: `separation` used to drop any term present in both arms anywhere in the
 * set, so a block present in 11 of one arm's runs and 4 of the other's was
 * invisible. A separator is anything a grep can sort pairs by; the unit is the
 * pair, and the count is how many pairs a term sorts one way against the other.
 */
describe('separation counts per pair, not set-wide', () => {
  const file = (arm, task, terms = [], handed = []) => ({
    arm,
    task,
    terms: new Set(terms),
    handed: new Set(handed),
  })

  test('a term in both arms set-wide still sorts the pairs where it is one-sided', () => {
    const split = separation([
      file('ours', 'a', ['the transport']),
      file('agent-zero', 'a'),
      file('ours', 'b', ['the transport']),
      file('agent-zero', 'b'),
      file('ours', 'c', ['the transport']),
      file('agent-zero', 'c', ['the transport']),
      file('ours', 'd'),
      file('agent-zero', 'd', ['the transport']),
    ])
    expect(split.entries).toEqual([
      {
        term: 'the transport',
        kind: 'replacement',
        arm: 'ours',
        sorted: 2,
        against: 1,
        tasks: ['a', 'b'],
      },
    ])
    expect(split).toMatchObject({ pairs: 4, separated: 2 })
  })

  test('a term handed to both arms in a pair’s prompts is vocabulary there, not identity', () => {
    // `/project` is what both workspace paths scrub to, and both prompts carry
    // the path. One arm's model echoing its cwd into a command is behaviour.
    const split = separation([
      file('ours', 'a', [], ['/project']),
      file('agent-zero', 'a', ['/project'], ['/project']),
    ])
    expect(split.entries).toEqual([])
    expect(split.separated).toBe(0)
  })

  test('but a replacement handed to one arm alone is that arm’s name in all but spelling', () => {
    const split = separation([
      file('ours', 'a', ['this harness']),
      file('agent-zero', 'a', [], ['this harness']),
    ])
    expect(split.entries).toEqual([
      {
        term: 'this harness',
        kind: 'replacement',
        arm: 'ours',
        sorted: 1,
        against: 0,
        tasks: ['a'],
      },
    ])
    expect(split.separated).toBe(1)
  })

  test('a slot beyond the other arm’s count and an ending are reported and not fatal', () => {
    const split = separation([
      file('ours', 'a', ['tool_1', 'tool_4', ENDINGS.scratchpad]),
      file('agent-zero', 'a', ['tool_1']),
      file('ours', 'b', [ENDINGS.scratchpad]),
      file('agent-zero', 'b', []),
    ])
    expect(split.entries.map((entry) => [entry.term, entry.kind, entry.sorted])).toEqual([
      [ENDINGS.scratchpad, 'ending', 2],
      ['tool_4', 'slot', 1],
    ])
    expect(split.separated).toBe(0)
  })

  test('the same term the same number of pairs each way sorts nothing', () => {
    const split = separation([
      file('ours', 'a', ['the transport']),
      file('agent-zero', 'a'),
      file('ours', 'b'),
      file('agent-zero', 'b', ['the transport']),
    ])
    expect(split.entries).toEqual([])
  })

  test('every replacement the scrub can write is a replacement to the verdict', () => {
    for (const replacement of REPLACEMENTS) {
      const split = separation([file('ours', 'a', [replacement]), file('agent-zero', 'a')])
      expect(split.entries.map((entry) => entry.kind)).toEqual(['replacement'])
    }
  })
})

describe('one classifier for a scanned term', () => {
  test('a replacement is a replacement before it is anything else, and a word is a word', () => {
    for (const replacement of REPLACEMENTS) expect(kindOf(replacement)).toBe('replacement')
    expect(kindOf('tool_4')).toBe('slot')
    expect(kindOf(ENDINGS.ceiling)).toBe('ending')
    // A word of an ending sentence, on its own, as the fresh grep sees it.
    expect(kindOf('scratchpad')).toBe('ending')
    // Anything else is the model's, or the prompt's, and is not fatal.
    expect(kindOf('Verifying')).toBe('word')
    expect(kindOf('runtime')).toBe('word')
  })
})

/**
 * The fresh grep. Its inventory is printed so a reader of a verdict knows what
 * a judge could have sorted on, and an inventory that files the strongest
 * sorter under "prompt prose" is one nobody should trust: `runtime` sorted
 * 5 of 5 pairs from the TURNS — the reference contract's argument on every call
 * row — and was counted among the prompt words because the manual mentions it.
 */
describe('residue: where a token SORTS, not where it appears', () => {
  const file = (arm, task, turnsText, promptText = '') => ({ arm, task, turnsText, promptText })
  const pairs = (turnsOf, promptOf = () => '') =>
    ['a', 'b', 'c'].flatMap((task) => [
      file('ours', task, turnsOf('ours', task), promptOf('ours', task)),
      file('agent-zero', task, turnsOf('agent-zero', task), promptOf('agent-zero', task)),
    ])
  const words = (found) => found.map((entry) => entry.word)

  test('a word in one arm’s turns across three pairs is turn residue', () => {
    const found = residue(pairs((arm) => (arm === 'agent-zero' ? 'Verifying done' : 'done')))
    expect(found.turns).toEqual([
      {
        word: 'Verifying',
        kind: 'word',
        arm: 'agent-zero',
        sorted: 3,
        against: 0,
        tasks: ['a', 'b', 'c'],
      },
    ])
    expect(found.prompt).toEqual([])
  })

  test('a word that sorts by the turns alone is turn residue even when a prompt mentions it', () => {
    // `runtime` is in the reference manual AND on every reference call row;
    // the manual is handed to that arm only, so the turns sort every pair.
    const found = residue(
      pairs(
        (arm) => (arm === 'agent-zero' ? '  runtime: terminal' : '  command: terminal'),
        (arm) =>
          arm === 'agent-zero' ? 'the runtime field picks a shell' : 'the field picks a shell',
      ),
    )
    expect(found.turns.map((entry) => [entry.word, entry.arm, entry.sorted])).toEqual([
      ['command', 'ours', 3],
      ['runtime', 'agent-zero', 3],
    ])
    expect(words(found.prompt)).not.toContain('runtime')
  })

  test('a word only the prompts sort by is prompt residue, counted and not listed by the turns', () => {
    const found = residue(
      pairs(
        () => 'same',
        (arm) => (arm === 'ours' ? 'careful' : 'manual'),
      ),
    )
    expect(found.prompt.map((entry) => [entry.word, entry.arm]).sort()).toEqual([
      ['careful', 'ours'],
      ['manual', 'agent-zero'],
    ])
    expect(found.turns).toEqual([])
  })

  test('a run of punctuation sorts a pair as surely as a word does', () => {
    // `tool_1 -> …` is our observation frame and `[exit code 0]` is theirs;
    // a tokeniser that only sees `[A-Za-z_]` words is blind to both.
    const found = residue(pairs((arm) => (arm === 'ours' ? 'tool_1 -> x' : '[exit code 0]')))
    expect(words(found.turns)).toContain('->')
    expect(words(found.turns)).toContain('[')
  })

  test('a word both arms were handed in a pair’s prompts is vocabulary in that pair', () => {
    const found = residue(
      pairs(
        (arm) => (arm === 'ours' ? '/project' : ''),
        () => 'cwd /project',
      ),
    )
    expect(found.turns).toEqual([])
    expect(found.prompt).toEqual([])
  })

  test('the floor is three pairs, and the count is the rule separation uses', () => {
    const files = pairs((arm, task) => (arm === 'ours' && task !== 'c' ? 'twice' : ''))
    expect(residue(files).turns).toEqual([])
    expect(residue(files, 2).turns.map((entry) => [entry.word, entry.sorted])).toEqual([
      ['twice', 2],
    ])
    const split = separation(
      files.map((entry) => ({
        ...entry,
        terms: new Set(entry.turnsText ? ['twice'] : []),
        handed: new Set(),
      })),
    )
    expect(split.entries.map((entry) => [entry.term, entry.sorted, entry.against])).toEqual([
      ['twice', 2, 0],
    ])
  })
})

describe('the outcome a judge is handed beside the transcripts', () => {
  test('is the machine check and the cost, keyed by nothing that names an arm', () => {
    const outcome = outcomeOf(azRecord())
    expect(outcome).toEqual({
      pass: false,
      checks: [{ name: 'a thing was done', ok: false }],
      turns: 2,
      ending: 'answered',
      tokens: 360,
    })
    expect(JSON.stringify(outcome)).not.toContain('agent-zero')
    expect(JSON.stringify(outcome)).not.toContain('nope')
  })
})

describe('the script itself is the gate', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const REPO = resolve(HERE, '..', '..')

  /** Two arms, both shapes, over one or more tasks, at one or more indices. */
  function fixture({
    ours = oursRecord(),
    az = azRecord(),
    indices = [1],
    tasks = ['probe'],
  } = {}) {
    const root = mkdtempSync(join(tmpdir(), 'askk-blind-'))
    for (const task of tasks) {
      for (const index of indices) {
        for (const [arm, record] of [
          ['agent-zero', az],
          ['ours', ours],
        ]) {
          mkdirSync(join(root, 'in', task, arm), { recursive: true })
          writeFileSync(
            join(root, 'in', task, arm, `${index}.json`),
            JSON.stringify({ ...record, task, scaffold: arm, index }),
            'utf8',
          )
        }
      }
    }
    return root
  }

  async function runBlind(root, extra = []) {
    const proc = Bun.spawn(
      [
        'bun',
        join(REPO, 'bench', 'blind.js'),
        '--transcripts',
        join(root, 'in'),
        '--out',
        join(root, 'out'),
        ...extra,
      ],
      { cwd: REPO, stdout: 'pipe', stderr: 'pipe' },
    )
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { out, err, code, root }
  }

  const emitted = (at, task = 'probe') =>
    readdirSync(join(at, 'out', task))
      .sort()
      .map((name) => readFileSync(join(at, 'out', task, name), 'utf8'))

  test('two arms in two shapes come out in one grammar with no tool name left, and the gate is green', async () => {
    const { code, out, root } = await runBlind(fixture())
    expect(code).toBe(0)
    expect(out).toContain('blind:')
    const [a, b] = emitted(root)
    for (const text of [a, b]) {
      expect(text).toContain('call: tool_1')
      expect(text).toContain('## turn 2 — answered')
      expect(text).toContain('## the prompt, as assembled for turn 1')
      for (const name of ['read_file', 'list_files', 'text_editor', 'code_execution_tool']) {
        expect(findTools(text, [name], 'f')).toEqual([])
      }
    }
  })

  test('the file a panel reads is blindTranscript, byte for byte', async () => {
    const { root } = await runBlind(fixture())
    const key = JSON.parse(readFileSync(join(root, 'out-key.json'), 'utf8'))
    const armIds = Object.values(key.map.probe).sort()
    for (const [letter, arm] of Object.entries(key.map.probe)) {
      const record = arm === 'ours' ? oursRecord() : azRecord()
      const slots = new Map(Object.entries(key.slots[arm]))
      const { text } = blindTranscript(record, 'probe', letter, { armIds, slots, tasks: ['probe'] })
      expect(readFileSync(join(root, 'out', 'probe', `${letter}.md`), 'utf8')).toBe(text)
    }
  })

  test('the directory a panel is handed holds the transcripts and one outcomes.json, and nothing else', async () => {
    const { root } = await runBlind(fixture())
    expect(readdirSync(join(root, 'out')).sort()).toEqual(['outcomes.json', 'probe'])
    expect(readdirSync(join(root, 'out', 'probe')).sort()).toEqual(['A.md', 'B.md'])
    const outcomes = JSON.parse(readFileSync(join(root, 'out', 'outcomes.json'), 'utf8'))
    expect(Object.keys(outcomes)).toEqual(['probe'])
    expect(Object.keys(outcomes.probe)).toEqual(['A', 'B'])
    const text = JSON.stringify(outcomes)
    expect(text).not.toContain('ours')
    expect(text).not.toContain('agent-zero')
    expect(text).not.toContain('workdir')
    expect(
      Object.values(outcomes.probe)
        .map((o) => o.pass)
        .sort(),
    ).toEqual([false, true])
  })

  test('the key is written OUTSIDE that directory, and decodes it', async () => {
    const { root } = await runBlind(fixture())
    const key = JSON.parse(readFileSync(join(root, 'out-key.json'), 'utf8'))
    expect(Object.values(key.map.probe).sort()).toEqual(['agent-zero', 'ours'])
    expect(key.slots.ours.list_files).toBe('tool_1')
    expect(key.slots['agent-zero'].text_editor).toBe('tool_1')
  })

  test('S59: two indices of one set get two maps, not one map twice', async () => {
    const tasks = ['probe', 'probe-two', 'probe-three', 'probe-four']
    const root = fixture({ indices: [1, 2], tasks })
    const first = JSON.parse(readFileSync(`${(await runBlind(root)).root}/out-key.json`, 'utf8'))
    const second = JSON.parse(
      readFileSync(`${(await runBlind(root, ['--index', '2'])).root}/out-key.json`, 'utf8'),
    )
    expect(first.index).toBe('1')
    expect(second.index).toBe('2')
    expect(Object.keys(first.map).sort()).toEqual([...tasks].sort())
    expect(first.map).not.toEqual(second.map)
  })

  test('outcomes.json lists the letters in letter order under every task, whatever the map', async () => {
    // It listed them in ARM order: the first letter under every task was the
    // same arm, so the panel directory carried the whole A/B map in its key
    // order and one recognised prompt unblinded every pair.
    const tasks = ['probe', 'probe-two', 'probe-three', 'probe-four', 'probe-five']
    const { root } = await runBlind(fixture({ tasks }))
    const key = JSON.parse(readFileSync(join(root, 'out-key.json'), 'utf8'))
    const outcomes = JSON.parse(readFileSync(join(root, 'out', 'outcomes.json'), 'utf8'))
    // The map must vary across these tasks for the order to be able to leak.
    expect(new Set(tasks.map((task) => key.map[task].A)).size).toBe(2)
    for (const task of tasks) expect(Object.keys(outcomes[task])).toEqual(['A', 'B'])
  })

  test('a tool name of the OTHER arm in a model’s sentence reaches no file: the gate exits 1 and names it', async () => {
    // The leak the mapper cannot map: an arm's slots cover its own vocabulary,
    // and a model naming the other harness's tool in prose is the plausible
    // way a name reaches a file. The verifier scans each arm's files for
    // BOTH vocabularies. This is the control the whole of P4 rests on.
    const ours = oursRecord()
    ours.run.events[3].action.parsed.think = ['I have no text_editor here']
    const { code, err } = await runBlind(fixture({ ours }))
    expect(code).toBe(1)
    expect(err).toContain('identifying string(s) survived the scrub')
    expect(err).toContain('"text_editor"')
    expect(err).toMatch(/probe\/[AB]\.md:\d+/)

    const az = azRecord()
    az.run.events[3].action.raw =
      '{"thoughts": ["unlike read_file this reads a range"], "headline": "Reading", "tool_name": "text_editor", "tool_args": {"action": "read", "path": "x.py"}}'
    const mirror = await runBlind(fixture({ az }))
    expect(mirror.code).toBe(1)
    expect(mirror.err).toContain('"read_file"')
  })

  test('an arm’s own directory name in a model’s sentence is scrubbed, and the whole set is still green', async () => {
    const ours = oursRecord()
    ours.run.events[3].action.parsed.think = ['The path probe/ours/1 suggests a benchmark']
    const { code, root } = await runBlind(fixture({ ours }))
    expect(emitted(root).join('\n')).toContain('The path /project suggests a benchmark')
    expect(emitted(root).join('\n')).not.toMatch(/\bours\b/)
    expect(code).toBe(0)
  })

  test('a replacement string that reaches one arm’s turns and not the other’s exits 1, naming it', async () => {
    const ours = oursRecord()
    ours.run.events[3].action.parsed.think = ['as agent-zero would say']
    const { code, err } = await runBlind(fixture({ ours }))
    expect(code).toBe(1)
    expect(err).toContain('NOT BLIND')
    expect(err).toContain('"the agent" [replacement] sorts 1 of 1 pair(s) toward ours')
  })

  test('a banned term that survives exits 1 and names the file and line', async () => {
    // An arm literally named `harness` is the reachable case: `armRules`
    // rewrites it to `this harness`, which still contains the word.
    const root = mkdtempSync(join(tmpdir(), 'askk-blind-'))
    for (const arm of ['a-harness', 'harness']) {
      mkdirSync(join(root, 'in', 'probe', arm), { recursive: true })
      writeFileSync(
        join(root, 'in', 'probe', arm, '1.json'),
        JSON.stringify({
          ...oursRecord({ answer: arm === 'harness' ? 'I looked in probe/harness/1' : 'nothing' }),
          scaffold: arm,
        }),
        'utf8',
      )
    }
    const { code, err } = await runBlind(root)
    expect(code).toBe(1)
    expect(err).toContain('identifying string(s) survived the scrub')
    expect(err).toContain('"harness"')
    expect(readdirSync(join(root, 'out', 'probe')).sort()).toEqual(['A.md', 'B.md'])
  })

  test('a run index that blinds NOTHING exits non-zero instead of verifying', async () => {
    const { code, err } = await runBlind(fixture(), ['--index', '9'])
    expect(code).toBe(1)
    expect(err).toContain('nothing was blinded, so nothing is verified')
  })

  test('the residue inventory is printed: what sorts three or more pairs, and where it lives', async () => {
    // Three pairs, so the floor is reachable; the reference arm's `runtime`
    // argument sits on every one of its call rows and in its manual, and the
    // inventory must file it where it SORTS — the turns — by name.
    const tasks = ['probe', 'probe-two', 'probe-three']
    const az = azRecord()
    az.run.events[3].action = {
      kind: 'tool',
      tool: 'code_execution_tool',
      args: { runtime: 'terminal', code: 'ls' },
      raw: '',
    }
    const { out } = await runBlind(fixture({ az, tasks }))
    expect(out).toMatch(/RESIDUE: \d+ token\(s\) sort three or more of 3 pair\(s\) by the prompt/)
    expect(out).toMatch(/"runtime" \[word\] in agent-zero's turns, 3 of 3 pair\(s\)/)
  })
})

describe('the disclosure the panel is handed', () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

  test('carries no banned term, no arm name, and no tool name of either recorded arm', () => {
    expect(findTerms(DISCLOSURE, BANNED, 'disclosure')).toEqual([])
    const arms = readdirSync(join(REPO, 'bench', 'transcripts', 'collatz')).sort()
    expect(arms.length).toBeGreaterThan(1)
    expect(findTerms(DISCLOSURE, arms, 'disclosure', { wholeWord: true })).toEqual([])
    const tools = arms.flatMap((arm) =>
      toolsOf(
        JSON.parse(
          readFileSync(join(REPO, 'bench', 'transcripts', 'collatz', arm, '1.json'), 'utf8'),
        ),
      ),
    )
    expect(tools.length).toBeGreaterThan(3)
    expect(findTools(DISCLOSURE, tools, 'disclosure')).toEqual([])
  })

  test('tells the judge what the projection did to the tools, the grammar and the prompt', () => {
    expect(DISCLOSURE).toContain('tool_1')
    expect(DISCLOSURE).toContain('one grammar')
    expect(DISCLOSURE).toContain('prompt is rendered after the turns')
    expect(DISCLOSURE).toContain('outcomes.json')
  })

  test('names the rubric, and no longer withholds any criterion', () => {
    expect(RUBRIC.withheld).toEqual([])
    expect(DISCLOSURE).toContain(`\`${RUBRIC.source}\`, section "${RUBRIC.section}"`)
    expect(readFileSync(join(REPO, RUBRIC.source), 'utf8')).toContain(`## ${RUBRIC.section}`)
    expect(DISCLOSURE).toContain('Score all 8')
    expect(DISCLOSURE).toContain('sum the 6')
    expect(DISCLOSURE).not.toContain('withheld')
  })

  test('it reaches the transcript, above the run and below nothing but the title', () => {
    const { text } = blindTranscript(oursRecord(), 'probe', 'A')
    expect(text.startsWith('# probe — transcript A')).toBe(true)
    expect(text.indexOf(DISCLOSURE)).toBeGreaterThan(-1)
    expect(text.indexOf(DISCLOSURE)).toBeLessThan(text.indexOf('## task'))
    expect(frame('probe', 'B', 'body')).toContain(DISCLOSURE)
  })
})

describe('the rubric and the instrument say the same thing', () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const rubric = () => readFileSync(join(REPO, RUBRIC.source), 'utf8')

  test('the page has exactly the number of criteria the instrument counts', () => {
    const rows = [...rubric().matchAll(/^\| (\d) \| \*\*/gm)].map((m) => Number(m[1]))
    expect(rows).toEqual(Array.from({ length: RUBRIC.criteria }, (_, at) => at + 1))
  })

  test('the page declares the same disqualifiers', () => {
    expect(rubric()).toContain(
      `Criteria **${RUBRIC.disqualifying.join('** and **')}** are disqualifying at 1`,
    )
  })

  /**
   * The page still says criterion 1 is WITHHELD and that the prompt "does not
   * come back"; the instrument withholds nothing and renders the prompt. The
   * page is `docs/REFERENCE-PROMPTS.md`, outside the slice that changed the
   * instrument, so the disagreement is carried here as a test that is
   * EXPECTED TO FAIL: the day the page is fixed this test passes, `failing`
   * turns that pass into a failure, and whoever fixed the page removes the
   * marker in the same change. The disagreement is in the tree either way.
   */
  test.failing('the page withholds exactly what the instrument withholds', () => {
    for (let at = 1; at <= RUBRIC.criteria; at++) {
      const says = rubric().includes(`criterion ${at} is WITHHELD`)
      expect(`criterion ${at} withheld: ${says}`).toBe(
        `criterion ${at} withheld: ${RUBRIC.withheld.includes(at)}`,
      )
    }
    expect(rubric()).not.toContain('The prompt does not come back')
  })
})

/**
 * `docs/LEDGER.md` row S38: `.gitignore` said the blind set "ARE committed" and
 * `git ls-files bench` returned 0. The rows are tracked as of `25c8750`; this is
 * what stops them going back.
 */
describe('the artifact and the evidence are in the repository, not on one machine', () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const tracked = (path) =>
    Bun.spawnSync(['git', 'ls-files', '-z', path], { cwd: REPO })
      .stdout.toString()
      .split('\0')
      .filter(Boolean)

  test('every file a panel is handed is tracked', () => {
    const here = join(REPO, 'bench', 'blind')
    const emitted = readdirSync(here)
      .flatMap((entry) =>
        entry.endsWith('.json')
          ? [`bench/blind/${entry}`]
          : readdirSync(join(here, entry)).map((name) => `bench/blind/${entry}/${name}`),
      )
      .sort()
    expect(emitted.length).toBeGreaterThan(0)
    expect(tracked('bench/blind').sort()).toEqual(emitted)
  })

  test('so is the evidence the runs produced', () => {
    expect(tracked('bench/transcripts').length).toBeGreaterThan(0)
    expect(tracked('bench/results.json')).toEqual(['bench/results.json'])
  })

  test('and the key, which decodes them, is NOT', () => {
    expect(tracked('bench/blind-key.json')).toEqual([])
    expect(existsSync(join(REPO, 'bench', 'blind-key.json'))).toBe(true)
  })

  /**
   * The files a panel is handed are TRACKED and GENERATED, and nothing tied the
   * two together: a mutation run once left `bench/blind/collatz/A.md` carrying
   * a laundering disclosure while `blind.js` on disk was clean and the suite was
   * green. The gate cannot see it either — it overwrites each file before it
   * scans it, so it only ever checks bytes it just wrote.
   */
  test('the tracked set is what today’s script emits from the tracked transcripts', async () => {
    const out = join(mkdtempSync(join(tmpdir(), 'askk-regen-')), 'out')
    await Bun.spawn(
      [
        'bun',
        join(REPO, 'bench', 'blind.js'),
        '--transcripts',
        join(REPO, 'bench', 'transcripts'),
        '--out',
        out,
      ],
      { cwd: REPO, stdout: 'ignore', stderr: 'ignore' },
    ).exited
    const here = join(REPO, 'bench', 'blind')
    for (const task of readdirSync(here).sort()) {
      if (task.endsWith('.json')) {
        expect(readFileSync(join(out, task), 'utf8')).toBe(readFileSync(join(here, task), 'utf8'))
        continue
      }
      for (const name of readdirSync(join(here, task)).sort()) {
        expect([`${task}/${name}`, readFileSync(join(out, task, name), 'utf8')]).toEqual([
          `${task}/${name}`,
          readFileSync(join(here, task, name), 'utf8'),
        ])
      }
    }
  })
})
