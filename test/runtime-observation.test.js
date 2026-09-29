import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { listing } from '../scripts/listing.js'
import { Hub } from './helpers/trusted-fixture-hub.js'

test('real workers report policy and owner denial as failed compact observations without running the tool', async () => {
  const site = await mkdtemp(join(tmpdir(), 'askk-observation-policy-')); let hub
  try {
    for (const mode of ['deny', 'ask']) {
      const folder = join(site, 'agents', mode); await mkdir(folder, { recursive: true })
      await writeFile(join(folder, 'agent.md'), `---\nname: ${mode}\ncontract_version: 2\nresponse_format: json\nobservation_format: compact\ntools: [workspace]\npermissions:\n  workspace_write: ${mode}\nmax_steps: 2\n---\nRespect the recorded tool outcome.`)
    }
    const replies = ['{"do":"tool","act":[[{"name":"workspace_write","args":{"path":"private.txt","content":"not permitted","expect":0}}]]}', '{"do":"done","act":"The denied write was not performed."}']
    await writeFile(join(site, 'models.json'), JSON.stringify({ default: 'fixture', models: { fixture: { provider: 'scripted', max_output_tokens: 256, script: { deny: replies, ask: replies } } } }))
    await writeFile(join(site, 'agents', 'index.json'), JSON.stringify(await listing(site)))
    hub = new Hub({ base: `${pathToFileURL(site).href}/`, storeName: `observation-policy-${crypto.randomUUID()}` })
    let executions = 0; let approvals = 0
    hub.externalOps = { 'workspace.write': () => { executions++; return { revision: 'should-not-exist' } } }
    hub.subscribe(event => {
      if (event.type === 'approval') { approvals++; hub.approvalsApi.answer(event.approval.id, { approved: false, note: 'Keep the workspace unchanged' }) }
    })
    await hub.start()
    for (const mode of ['deny', 'ask']) {
      const run = hub.startRun(mode, 'Try the configured write once, then report the observed denial.')
      expect(await run.answer).toBe('The denied write was not performed.')
      const observation = run.toolEvents.find(event => event.kind === 'observation')
      expect(observation.ok).toBe(false)
      expect(observation.value).toContain(mode === 'deny' ? 'refused by policy' : 'the owner refused this call: Keep the workspace unchanged')
      const model = JSON.parse(run.turns.find(turn => turn.role === 'observation').content)
      expect(model.stages[0][0]).toMatchObject({ callId: observation.callId, name: 'workspace_write', ok: false })
      expect(run.prompts.at(-1).snapshot.observationFormat).toBe('compact')
      const call = run.toolEvents.find(event => event.kind === 'call')
      expect(call.args).toEqual({ path: 'private.txt', content: 'not permitted', expect: 0 })
    }
    expect(executions).toBe(0); expect(approvals).toBe(1)
  } finally { hub?.stop(); await rm(site, { recursive: true, force: true }) }
}, 15000)
