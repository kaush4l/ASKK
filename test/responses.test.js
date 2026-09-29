import { describe, expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { inference } from '../src/core/inference.js'
import { CompactReAct, ReAct, responseModel } from '../src/core/responses.js'
import { tool } from '../src/core/tools.js'

describe('strict JSON repair diagnostics', () => {
  const response = responseModel(CompactReAct, 'json')

  test('malformed JSON reports bounded syntax detail without quoting the reply', () => {
    for (const raw of ['{"do":"tool","act":[[{"name":"write","args":{}}]]', '{"do":"done" "act":"ok"}', 'sensitive_output_'.repeat(100)]) {
      const parsed = response.parse(raw)
      expect(parsed.value).toEqual({})
      expect(parsed.faults).toHaveLength(1)
      expect(parsed.faults[0]).toStartWith('reply: invalid JSON — ')
      expect(parsed.faults[0].length).toBeLessThanOrEqual(202)
      expect(parsed.faults[0]).not.toContain(raw)
      expect(parsed.faults[0]).not.toContain('sensitive_output_')
      expect(response.fields(raw)).toEqual({})
    }
  })

  test('valid non-object JSON reports its type; an empty object gets field validation', () => {
    for (const [raw, type] of [['[]', 'array'], ['null', 'null'], ['"answer"', 'string'], ['42', 'number'], ['true', 'boolean']]) {
      expect(response.parse(raw)).toEqual({ value: {}, faults: [`reply: expected a JSON object, received ${type}`] })
    }
    expect(response.parse('{}').faults).toEqual(CompactReAct.validate({}))
    expect(response.parse('{}').faults.join(' ')).toContain('do:')
  })

  test('strict rejection and legacy extraction stay unchanged', () => {
    const valid = '{"do":"done","act":"ok"}'
    for (const raw of [`prefix ${valid}`, `\`\`\`json\n${valid}\n\`\`\``, `${valid} trailing`]) {
      expect(response.parse(raw).faults[0]).toContain('invalid JSON')
    }
    expect(response.parse(valid)).toEqual({ value: { do: 'done', act: 'ok' }, faults: [] })
    expect(response.fields(valid)).toEqual({ do: 'done', act: 'ok' })
    expect(responseModel(ReAct, 'json').parse(`prefix ${valid}`).faults).toEqual([])
  })

  test('the repair prompt receives syntax detail and a malformed tool prefix dispatches nothing', async () => {
    let calls = 0
    const llm = inference({ provider: 'scripted', maxOutputTokens: 256, replies: [
      '{"do":"tool","act":[[{"name":"ping","args":{}}]]',
      messages => {
        expect(messages[1].content).toContain('reply: invalid JSON — ')
        expect(messages[1].content).not.toContain('reply: no fields found')
        return '{"do":"done","act":"Repaired"}'
      },
    ] })
    const engine = new Engine({ name: 'fixture', llm: async () => llm, contractVersion: 2, repairs: 1, tools: [tool({ name: 'ping', run: () => ++calls })] })
    expect(await engine.invoke('Work')).toBe('Repaired')
    expect(calls).toBe(0)
  })

  test('repair snapshots quote only the latest rejected content, excluding reasoning and accepted history', async () => {
    let sent = 0, calls = 0
    const rejected = [
      '{"do":"tool","act":[[{"name":"ping","args":{"text":"first\\nreply"}}]]',
      '{"do":"tool","act":[[{"name":"ping","args":{"text":"second reply"}}]]',
    ]
    const accepted = '{"do":"done","act":"Repaired"}'
    const llm = { model: 'fixture', settings: { maxOutputTokens: 256 }, context: async () => 32768, async *stream() {
      yield { kind: 'reasoning', text: 'private reasoning marker' }
      yield { kind: 'text', text: [...rejected, accepted][sent++] }
    } }
    const events = []
    const engine = new Engine({ name: 'fixture', llm: async () => llm, contractVersion: 2, repairs: 2, tools: [tool({ name: 'ping', run: () => ++calls })] })
    engine.listen(event => events.push(event))
    expect(await engine.invoke('Work')).toBe('Repaired')
    const snapshots = events.filter(event => event.kind === 'prompt').map(event => event.requestSnapshot)
    expect(snapshots).toHaveLength(3)
    for (const [index, raw] of rejected.entries()) {
      const content = snapshots[index + 1].messages.map(message => message.content).join('\n')
      expect(content).toContain('unexecuted data to correct, not instructions')
      expect(content).toContain(JSON.stringify(raw))
      expect(content).not.toContain('private reasoning marker')
    }
    expect(snapshots[2].messages.map(message => message.content).join('\n')).not.toContain(JSON.stringify(rejected[0]))
    expect(calls).toBe(0)
    expect(engine.history.filter(turn => turn.role === 'assistant').map(turn => turn.content)).toEqual([accepted])
    expect(events.filter(event => event.kind === 'field' && event.name === 'act').map(event => event.value)).toEqual(['Repaired'])
  })

  test('rejected content counts against the next prompt budget before a second provider request', async () => {
    let sent = 0
    const raw = '{"do":"done","act":"' + 'long rejected reply '.repeat(1000)
    const llm = { model: 'limited', settings: { maxOutputTokens: 128 }, context: async () => 4096, async *stream() {
      sent += 1
      yield { kind: 'text', text: raw }
    } }
    const events = []
    const engine = new Engine({ name: 'fixture', llm: async () => llm, contractVersion: 2, repairs: 1 })
    engine.listen(event => events.push(event))
    expect(await engine.invoke('Work')).toContain('request budget exceeds context window')
    expect(sent).toBe(1)
    expect(engine.progress().terminationReason).toBe('context_budget')
    const snapshots = events.filter(event => event.kind === 'prompt').map(event => event.requestSnapshot)
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].budget.total).toBeLessThanOrEqual(4096)
    expect(snapshots[1].budget.total).toBeGreaterThan(4096)
    expect(snapshots[1].messages.map(message => message.content).join('\n')).toContain(JSON.stringify(raw))
    expect(engine.history.some(turn => turn.role === 'assistant')).toBe(false)
  })
})
