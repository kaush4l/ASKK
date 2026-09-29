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
