import { describe, expect, test } from 'bun:test'
import {
  BaseResponse,
  DEFAULT_FORMAT,
  JSON_FORMAT,
  TOON,
} from '@/core/response/base'
import {
  ANSWER,
  CritiqueResponse,
  PlanResponse,
  ReActResponse,
  RESPONSE_MODELS,
  SimpleResponse,
  SkillSelectResponse,
  TOOL,
  UnderstandResponse,
  VerifyResponse,
  getResponseModel,
} from '@/core/response/responses'
import { Agent } from '@/core/agent/agent'
import { react } from '@/core/agent/react'
import { ScriptedInference } from '@/core/inference/scripted'
import type { InferenceConfig } from '@/core/inference/base'
import { stubPorts } from '@/core/ports'

/**
 * The response contract, checked the way the port checked it — plus the two
 * things 2.5's acceptance names: the golden case parses **exactly**, and a
 * malformed reply degrades and never throws.
 *
 * `tests/golden/react-loop.json` is the oracle and it is not editable. Its md5
 * is asserted below against the value recorded in `docs/PROGRESS.md`, which is
 * the same value `git show pre-workbench:tests/golden/react-loop.json | md5`
 * prints: a byte that differs means the port is wrong, never the fixture.
 */

const CONFIG: InferenceConfig = {
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:8873/v1',
  apiKey: 'none',
  temperature: 0.7,
  maxTokens: 4096,
}

describe('the field table is the contract', () => {
  test('instructions list the fields in declaration order, with (list) markers', () => {
    const text = ReActResponse.instructions(TOON)
    expect(text).toContain('Reply with exactly these fields, in this order: think, plan, act, result.')
    expect(text).toContain('- think (list): Your private reasoning, one thought per item.')
    expect(text).toContain("- act: Exactly 'tool' to call a tool")
    expect(text).toContain('think: [<your first think>, <your second think>]')
    expect(text).toContain('act: <your act here>')
  })

  test('JSON instructions carry the same field docs and a JSON example', () => {
    const text = UnderstandResponse.instructions(JSON_FORMAT)
    expect(text).toContain('Reply with a single JSON object containing exactly these keys:')
    expect(text).toContain('Output only the JSON object — no markdown fences, no text around it.')
    expect(text).toContain('Example:\n{\n  "think": "<think>",\n  "complexity": "<complexity>",')
    // format notes only exist on the react contract
    expect(text).not.toContain('WRONG (never do this)')
  })

  test('the react format notes are the bytes the model reads', () => {
    const notes = ReActResponse.formatNotes()
    expect(notes.startsWith(
      "The 'act' field is a single word — 'tool' or 'answer' — never a tool name and never a call.",
    )).toBe(true)
    expect(notes).toContain('WRONG (never do this):\n```\nact: echo({"text": "hello"})\n\nresult:\n```')
    expect(notes).toContain(
      'CORRECT (two calls that do not need each other — one line, run together):\n```\nact: tool\n\n' +
        'result: get_weather({"city": "Paris"}), get_weather({"city": "Tokyo"})\n```',
    )
    expect(notes.endsWith("result: The heading says 'Example Domain'.\n```")).toBe(true)
    expect(ReActResponse.instructions(TOON)).toContain(notes)
  })

  test('one declaration is the prompt order, the parse target and the routing input', () => {
    // The same array, read three ways: change the table and all three move.
    const names = ReActResponse.FIELDS.map((f) => f.name)
    expect(names).toEqual(['think', 'plan', 'act', 'result'])
    expect(ReActResponse.instructions(TOON)).toContain(names.join(', '))
    expect(Object.keys(JSON.parse(new ReActResponse().toString(JSON_FORMAT)))).toEqual(names)
    expect(ReActResponse.answerField()).toBe('result')
  })
})

describe('object -> string', () => {
  test('toString writes TOON blocks and JSON objects', () => {
    const parsed = new ReActResponse({ think: ['a', 'b'], act: 'tool', result: 'echo({})' })
    expect(parsed.toString(TOON)).toBe('think: [a, b]\n\nplan: []\n\nact: tool\n\nresult: echo({})')
    expect(JSON.parse(parsed.toString(JSON_FORMAT))).toEqual({
      think: ['a', 'b'],
      plan: [],
      act: 'tool',
      result: 'echo({})',
    })
    expect(DEFAULT_FORMAT).toBe(TOON)
  })
})

describe('string -> object', () => {
  test('TOON parses field blocks, multi-line values and bracket lists', () => {
    const parsed = SimpleResponse.parse('thinking: one\ntwo\n\nresponse: hello')
    expect(parsed.value('thinking')).toBe('one\ntwo')
    expect(parsed.value('response')).toBe('hello')

    const plan = PlanResponse.parse('think: [a, b(c, d)]\n\nsteps: [one, two]')
    expect(plan.value('think')).toEqual(['a', 'b(c, d)'])
    expect(plan.value('steps')).toEqual(['one', 'two'])
  })

  test('a decorated key is still the field, and its closing marker is not the value', () => {
    const parsed = SimpleResponse.parse('**Thinking:** quietly\n\n- response: out loud')
    expect(parsed.value('thinking')).toBe('quietly')
    expect(parsed.value('response')).toBe('out loud')
  })

  test('a list written as lines becomes one item per line, bullets stripped', () => {
    const parsed = SkillSelectResponse.parse('skills:\n- one\n2. two\n\nthink: []')
    expect(parsed.value('skills')).toEqual(['one', 'two'])
    expect(parsed.value('think')).toEqual([])
  })

  test('JSON is found inside surrounding prose, and a string list field is coerced', () => {
    const parsed = PlanResponse.parse('here you go: {"think": ["t"], "steps": "[a, b]"} — done', JSON_FORMAT)
    expect(parsed.value('steps')).toEqual(['a', 'b'])
  })

  test('the other format is tried when the requested one finds nothing', () => {
    const parsed = ReActResponse.parse('{"act": "answer", "result": "hi"}', TOON)
    expect(parsed.value('result')).toBe('hi')
    const toon = ReActResponse.parse('act: answer\n\nresult: hi', JSON_FORMAT)
    expect(toon.value('result')).toBe('hi')
  })
})

describe('a malformed reply degrades, never throws', () => {
  test('an unparseable reply becomes the answer rather than an exception', () => {
    const parsed = SimpleResponse.parse('just some prose with no fields at all')
    expect(parsed.answer).toBe('just some prose with no fields at all')
    expect(parsed.value('thinking')).toBe('')
  })

  test('a truncated reply in either format still yields a usable object', () => {
    const cut = ReActResponse.parse('{"act": "tool", "result": "echo({\\"text\\": \\"he')
    expect(cut.answer).toBe('{"act": "tool", "result": "echo({\\"text\\": \\"he')
    expect(cut.isAnswer).toBe(true)

    const halfToon = ReActResponse.parse('think: [one\n\nact: to')
    expect(halfToon.value('act')).toBe(ANSWER)
  })

  test('every shape a model can hand back parses without throwing', () => {
    const shapes = [
      '',
      '   \n\n  ',
      'act:',
      '{',
      '}{',
      '{"act": }',
      '[1, 2, 3]',
      'null',
      '{"unrelated": "keys only"}',
      '```json\n{"act": "answer", "result": "fenced"}\n```',
      'act: answer\n\nresult:',
      'think: not a list at all\n\nact: answer',
      'a'.repeat(20_000),
    ]
    for (const raw of shapes) {
      for (const fmt of [TOON, JSON_FORMAT] as const) {
        for (const model of Object.values(RESPONSE_MODELS)) {
          expect(() => model.parse(raw, fmt)).not.toThrow()
        }
      }
    }
    // and the one that mattered: a fenced object is still read
    expect(ReActResponse.parse('```json\n{"act": "answer", "result": "fenced"}\n```').answer).toBe('fenced')
  })

  test('an unparseable reply to a list-answer contract stays empty, not one long item', () => {
    const parsed = CritiqueResponse.parse('no fields here')
    expect(parsed.value('findings')).toEqual([])
    expect(parsed.value('verdict')).toBe('revise')
  })
})

describe('normalize fails toward the careful branch', () => {
  test('an act that is a call is rescued into result, and act becomes tool', () => {
    const parsed = ReActResponse.parse('act: echo({"text": "hi"})')
    expect(parsed.value('act')).toBe(TOOL)
    expect(parsed.value('result')).toBe('echo({"text": "hi"})')
    expect(parsed.isToolCall).toBe(true)
  })

  test('an act that is neither word and not a call becomes answer', () => {
    expect(new ReActResponse({ act: 'finish' }).value('act')).toBe(ANSWER)
    expect(new ReActResponse({ act: "**'Tool'**" }).value('act')).toBe(TOOL)
    expect(new ReActResponse().isAnswer).toBe(true)
  })

  test('a rescue never overwrites a result the model already wrote', () => {
    const parsed = new ReActResponse({ act: 'echo({})', result: 'kept' })
    expect(parsed.value('result')).toBe('kept')
    expect(parsed.value('act')).toBe(TOOL)
  })

  test('unknown complexity is complex, unknown verdicts are fail and revise', () => {
    expect(new UnderstandResponse({ complexity: 'medium' }).value('complexity')).toBe('complex')
    expect(new UnderstandResponse({ complexity: "'Simple'" }).value('complexity')).toBe('simple')
    expect(new VerifyResponse({ verdict: 'mostly' }).value('verdict')).toBe('fail')
    expect(new VerifyResponse({ verdict: 'PASS' }).value('verdict')).toBe('pass')
    expect(new CritiqueResponse({ verdict: 'looks fine' }).value('verdict')).toBe('revise')
    expect(new CritiqueResponse({ verdict: 'approve' }).value('verdict')).toBe('approve')
  })

  test('defaults are the Python’s, and a response is frozen', () => {
    const verify = new VerifyResponse()
    expect(verify.value('verdict')).toBe('fail')
    expect(verify.value('checks')).toEqual([])
    expect(Object.isFrozen(verify)).toBe(true)
  })
})

describe('the answer field', () => {
  test('the answer is the last field unless ANSWER_FIELD names another', () => {
    expect(ReActResponse.answerField()).toBe('result')
    expect(SimpleResponse.answerField()).toBe('response')
    expect(VerifyResponse.answerField()).toBe('evidence')
    expect(CritiqueResponse.answerField()).toBe('findings')
    expect(new VerifyResponse({ evidence: 'I saw it' }).answer).toBe('I saw it')
  })

  test('a list answer field is Python’s repr, so an apostrophe stays well formed', () => {
    // `['it's broken', 'b']` is not even parseable as a list; Python's repr
    // switches quote character per item, and findings are what a planner reads.
    const c = new CritiqueResponse({ findings: ["it's broken", 'b'], verdict: 'revise' })
    expect(c.answer).toBe(`["it's broken", 'b']`)
    expect(new CritiqueResponse({ findings: ['say "hi"'] }).answer).toBe(`['say "hi"']`)
    expect(new CritiqueResponse({ findings: ['both \' and "'] }).answer).toBe(`['both \\' and "']`)
    expect(new CritiqueResponse({ findings: ['line\nbreak'] }).answer).toBe("['line\\nbreak']")
    expect(new CritiqueResponse({ findings: [] }).answer).toBe('[]')
  })

  test('answerOf builds a give-up in the same class, list answer field or not', () => {
    expect(ReActResponse.answerOf('could not').value('result')).toBe('could not')
    expect(ReActResponse.answerOf('could not').isAnswer).toBe(true)
    expect(CritiqueResponse.answerOf('could not').value('findings')).toEqual(['could not'])
  })
})

describe('the registry', () => {
  test('every response model resolves by its frontmatter name', () => {
    expect(Object.keys(RESPONSE_MODELS)).toEqual([
      'simple',
      'react',
      'understand',
      'skill_select',
      'plan',
      'verify',
      'critique',
    ])
    expect(getResponseModel('react')).toBe(ReActResponse)
    expect(() => getResponseModel('nope')).toThrow(
      "Unknown response model 'nope'. Known: simple, react, understand, skill_select, plan, verify, critique",
    )
  })

  test('a subclass declares a table and inherits everything else', () => {
    class Counted extends BaseResponse {
      static override FIELDS = [{ name: 'reply', description: 'd' }]
    }
    expect(Counted.instructions(TOON)).toContain('- reply: d')
    expect(Counted.parse('reply: hi').answer).toBe('hi')
  })
})

describe('the oracle', () => {
  const GOLDEN = new URL('./golden/react-loop.json', import.meta.url)

  test('the fixture is the recorded one, byte for byte', async () => {
    const bytes = await Bun.file(GOLDEN).arrayBuffer()
    const md5 = new Bun.CryptoHasher('md5').update(bytes).digest('hex')
    // `git show pre-workbench:tests/golden/react-loop.json | md5`
    expect(md5).toBe('dad3bec80ba2878f53262aa44d78caf0')
  })

  test('the react contract drives the 2.4 loop to the recorded answer and turns', async () => {
    const expected = (await Bun.file(GOLDEN).json()) as { answer: string; history: [string, string][] }
    const script = ['act: tool\n\nresult: echo({"text": "hey"})', 'act: answer\n\nresult: done: hey']
    const agent = new Agent({
      inference: new ScriptedInference(
        CONFIG,
        stubPorts().fetch,
        script.map((text) => ({ chunks: [text], stopReason: 'stop', usage: null })),
      ),
      ports: { ...stubPorts(), newId: () => 'turn-1' },
      // The prompt is 2.6's; what this proves is the reply path, so the seam
      // renders something stable and nothing here pretends to be a prompt.
      prompt: (session) => `PROMPT ${session.query}`,
      model: ReActResponse,
      tools: async () => 'echo: hey',
    })

    const reply = await react(agent, 'please echo hey')

    expect(reply.answer).toBe(expected.answer)
    expect(agent.transcript.messages.map((m) => [m.role, m.content])).toEqual(expected.history)
  })
})
