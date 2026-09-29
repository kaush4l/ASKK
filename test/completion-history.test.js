import { expect, test } from 'bun:test'
import { Engine } from '../src/core/engine.js'
import { inference } from '../src/core/inference.js'
import { nativeHistoryMessages } from '../src/core/native-protocol.js'
import { tool } from '../src/core/tools.js'

const unsupported = 'Unsupported completion: all checks passed without running them.'
const accepted = 'Verified after the required check.'

function fixture(protocol, policy, options = {}) {
  const requests = [], events = [], candidates = [], histories = []
  let executions = 0
  const native = protocol === 'native'
  const replies = native ? [
    { content: unsupported },
    { tool_calls: [{ index: 0, id: 'required-check', type: 'function', function: { name: 'check', arguments: '{}' } }] },
    { content: accepted },
  ] : [
    { content: JSON.stringify({ do: 'done', act: unsupported }) },
    { content: JSON.stringify({ do: 'tool', act: { name: 'check', args: {} } }) },
    { content: JSON.stringify({ do: 'done', act: accepted }) },
  ]
  const llm = inference({ provider: 'openai', model: 'fixture', contextLength: 32768, maxOutputTokens: 512, retries: 1 }, { fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body))
    const delta = replies.shift()
    if (!delta) throw new Error('Unexpected provider request')
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`)
  } })
  const engine = new Engine({
    name: 'fixture', contractVersion: 3, responseProtocol: protocol, historyFormat: 'messages', observationFormat: 'compact',
    llm: async () => llm, tools: [tool({ name: 'check', run() { executions++; return 'Required check passed.' } })],
    ...(policy === undefined ? {} : { rejectedCompletionHistory: policy }),
    onHistory: turns => histories.push(structuredClone(turns)),
    verifyCompletion: input => { candidates.push(structuredClone(input)); return { ok: executions === 1, reason: executions ? 'Check verified.' : 'Run the required check.' } },
    ...options,
  })
  engine.listen(event => events.push(event))
  return { engine, requests, events, candidates, histories }
}

for (const protocol of ['native', 'envelope']) {
  for (const policy of [undefined, 'retain', 'omit']) {
    test(`${protocol} ${policy ?? 'default'} completion history preserves feedback and verified actions`, async () => {
      const { engine, requests, candidates, histories, events } = fixture(protocol, policy)
      expect(await engine.invoke('Run the required check.')).toBe(accepted)
      const retained = policy !== 'omit'
      expect(JSON.stringify(requests[1].messages).includes(unsupported)).toBe(retained)
      expect(JSON.stringify(engine.history).includes(unsupported)).toBe(retained)
      expect(JSON.stringify(histories).includes(unsupported)).toBe(retained)
      expect(JSON.stringify(requests[1].messages)).toContain('Completion was rejected')
      expect(JSON.stringify(requests[1].messages)).toContain('Run the required check.')
      expect(candidates).toHaveLength(2)
      expect(candidates[0].answer).toBe(unsupported)
      expect(candidates[0].candidate.content).toBe(protocol === 'native' ? unsupported : JSON.stringify({ do: 'done', act: unsupported }))
      expect(candidates[0].candidate.attemptId).toBe(events.find(event => event.kind === 'prompt').attemptId)
      expect(candidates[1].candidate.attemptId).not.toBe(candidates[0].candidate.attemptId)
      expect(engine.history.filter(turn => turn.role === 'assistant' && turn.content.includes(accepted))).toHaveLength(1)
      expect(events.filter(event => event.kind === 'call')).toHaveLength(1)
      if (protocol === 'native') {
        const messages = nativeHistoryMessages(engine.history)
        expect(messages.find(turn => turn.tool_calls)?.tool_calls[0].id).toBe('required-check')
        expect(messages.find(turn => turn.role === 'tool')?.tool_call_id).toBe('required-check')
      }
    })
  }

  test(`${protocol} omitted completion cannot enter a later compaction summary`, async () => {
    const { engine } = fixture(protocol, 'omit')
    await engine.invoke('Run the required check. '.repeat(100))
    let summaryInput = ''
    engine.compactAt = 0
    engine.keep = 1
    engine.summarise = async input => { summaryInput = input; return 'Required check ran successfully.' }
    await engine.compress()
    expect(summaryInput).not.toContain(unsupported)
    expect(summaryInput).toContain('Completion was rejected')
    expect(summaryInput).toContain('Required check passed.')
    expect(engine.history[0].role).toBe('summary')
    expect(JSON.stringify(engine.history)).not.toContain(unsupported)
  })
}

test('unsupported completion history policy fails explicitly', () => {
  expect(() => fixture('native', 'automatic')).toThrow()
})
