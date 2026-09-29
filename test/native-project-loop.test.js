import { test, expect } from 'bun:test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evaluateProjectLoop } from '../scripts/evals/project-loop.js'

test('native provider proposals cross the production worker and guarded dispatcher into verified real files and commands', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-native-loop-'))
  const requests = []
  const source = 'const values=process.argv.slice(2).map(Number);if(values.some(n=>!Number.isFinite(n)))process.exit(1);console.log(values.reduce((a,b)=>a+b,0));\n'
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    const body = await request.json(); requests.push(body)
    const call = requests.length === 1 ? { id: 'write-1', name: 'workspace_write', args: { path: 'total.js', content: source, expect: 0 } }
      : requests.length === 2 ? { id: 'run-1', name: 'workspace_run', args: { command: 'bun total.js 1 2 3' } }
      : requests.length === 4 ? { id: 'run-2', name: 'workspace_run', args: { command: 'bun total.js' } } : null
    const chunks = call ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
      : [{ choices: [{ delta: { content: 'Created and ran the script.' }, finish_reason: 'stop' }] }]
    return new Response(chunks.map(x => `data: ${JSON.stringify(x)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const result = await evaluateProjectLoop({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'native-fixture', directory: join(root, 'attempt'), caseName: 'script', contractVersion: 3, historyFormat: 'messages', responseProtocol: 'native', instructions: 'Use the saved receipt before continuing.', completion: { checks: [{ capability: 'workspace.commands', options: { commands: ['bun total.js 1 2 3', 'bun total.js'] } }] } })
    const evidence = JSON.parse(await readFile(result.evidence, 'utf8'))
    expect(result.passed).toBe(true)
    expect(evidence.instructionsOverride).toBe('Use the saved receipt before continuing.')
    expect(requests[0].messages.some(message => message.content?.includes('Use the saved receipt before continuing.'))).toBe(true)
    const agentSource = await readFile(join(root, 'attempt/site/packages/starter/agents/builder/agent.md'), 'utf8')
    expect(agentSource).toContain('contract_version: 3')
    expect(agentSource).toContain('history_format: "messages"')
    expect(agentSource).toContain('\n---\nUse the saved receipt before continuing.\n')
    expect(evidence.responseProtocol).toBe('native')
    expect(requests).toHaveLength(5)
    expect(requests[3].messages.some(message => message.content?.includes('no receipt for required command'))).toBe(true)
    expect(evidence.completionReceipts.map(receipt => receipt.ok)).toEqual([false, true])
    expect(requests[0].parallel_tool_calls).toBe(false)
    expect(requests[0].tools.map(t => t.function.name)).toContain('workspace_write')
    expect(requests[1].messages.find(m => m.tool_calls)?.tool_calls[0].id).toBe('write-1')
    expect(requests[1].messages.find(m => m.role === 'tool')?.tool_call_id).toBe('write-1')
    expect(evidence.tools.filter(e => e.kind === 'call').map(e => e.providerCallId)).toEqual(['write-1', 'run-1', 'run-2'])
    expect(evidence.prompts[0].snapshot.nativeTools).toEqual(requests[0].tools)
    expect(evidence.prompts[0].snapshot.responseProtocol).toBe('native')
    expect(evidence.commands[0].sourceUnchanged).toBe(true)
    expect(evidence.commands[0].code).toBe(0)
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 20000)

test('native required-check references execute exact configured commands through the production worker', async () => {
  const root = await mkdtemp(join(tmpdir(), 'askk-native-ref-'))
  const requests = []
  const completion = JSON.parse(await readFile(join(import.meta.dir, '../docs/rewrite/evidence/script-prefix-required-checks.json'), 'utf8'))
  const commands = completion.checks[0].options.commands
  const source = 'const values=process.argv.slice(2).map(Number);if(values.some(n=>!Number.isFinite(n)))process.exit(1);console.log(values.reduce((a,b)=>a+b,0));\n'
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(request) {
    requests.push(await request.json())
    const step = requests.length
    const call = step === 1 ? { name: 'workspace_write', args: { path: 'total.js', content: source, expect: 0 } }
      : step <= commands.length + 1 ? { name: 'workspace_run', args: { requiredCheck: step - 2 } } : null
    const delta = call ? { tool_calls: [{ index: 0, id: `ref-${step}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: 'Configured checks completed.' }
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: call ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  } })
  try {
    const result = await evaluateProjectLoop({ baseUrl: `http://127.0.0.1:${server.port}/v1`, model: 'native-fixture', directory: join(root, 'attempt'), completion, responseProtocol: 'native', contractVersion: 3, historyFormat: 'messages' })
    const e = JSON.parse(await readFile(result.evidence, 'utf8'))
    expect(result.passed).toBe(true)
    expect(e.commands.map(c => c.command)).toEqual(commands)
    expect(e.commands.every(c => c.code === 0 && c.sourceUnchanged)).toBe(true)
    const calls = e.tools.filter(t => t.kind === 'call' && t.name === 'workspace_run')
    expect(calls.map(c => c.args)).toEqual(commands.map((_, requiredCheck) => ({ requiredCheck })))
    for (const [requiredCheck, call] of calls.entries()) {
      const outcome = e.tools.find(t => t.kind === 'observation' && t.callId === call.callId)
      expect(outcome.resolvedArgs).toEqual({ command: commands[requiredCheck], requiredCheck })
      expect(outcome.activity.commandId).toBe(e.commands[requiredCheck].id)
    }
    expect(requests[0].tools.find(t => t.function.name === 'workspace_run').function.parameters.properties.requiredCheck.type).toBe('integer')
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 20000)
