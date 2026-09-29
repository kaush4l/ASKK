import { expect, test } from 'bun:test'
import { createEvaluationWorkspace, ranDeclaredTests } from '../scripts/evals/workspace-evidence.js'
const owner = { id: 'run', trace: 'task' }
function fixture() {
  let revision = 'a', runtimeId = 'runtime'
  const execution = {
    describeCapabilities: () => ({ runtimeId, root: '/project' }),
    snapshot: async () => ({ revision }),
    write: async () => { revision = 'b'; return { ok: true } },
    startJob: async () => ({ code: 0, runtimeId: 'runtime' }),
  }
  return { execution, workspace: createEvaluationWorkspace(execution), change: value => { revision = value }, rebind: () => { runtimeId = 'other' } }
}
test('completion belongs to a task and records exact checked source', async () => {
  const f = fixture()
  await f.workspace.run('bun run test', owner)
  const result = await f.workspace.check({}, owner)
  expect(result).toMatchObject({ ok: true, sourceRevision: 'a', evidence: { command: 'bun run test', runId: 'run', trace: 'task', inputRevision: 'a', completedRevision: 'a', sourceUnchanged: true, matchesAtCompletion: true } })
  expect((await f.workspace.check({}, { id: 'other', trace: 'foreign' })).ok).toBe(false)
  expect((await f.workspace.check({}, { id: 'child', trace: 'task' })).ok).toBe(true)
  expect(ranDeclaredTests(f.workspace.commands, owner, 'a')).toBe(true)
  expect(ranDeclaredTests(f.workspace.commands, owner, 'b')).toBe(false)
})
test('later source mutation or write-and-revert invalidates successful commands', async () => {
  const f = fixture(); await f.workspace.run('check', owner)
  f.change('b'); expect((await f.workspace.check({}, owner)).ok).toBe(false)
  f.change('a'); await f.workspace.write({}); f.change('a')
  expect((await f.workspace.check({}, owner)).ok).toBe(false)
  await f.workspace.run('check again', owner)
  expect((await f.workspace.check({}, owner)).ok).toBe(true)
})
test('a source-changing command is not verification of its resulting files', async () => {
  const f = fixture()
  f.execution.startJob = async () => { f.change('b'); return { code: 0, runtimeId: 'runtime' } }
  const receipt = await f.workspace.run('write and check', owner)
  expect(receipt.sourceUnchanged).toBe(false)
  expect((await f.workspace.check({}, owner)).ok).toBe(false)
})
test('latest failed, cancelled, timed out or throwing job cannot reuse earlier success', async () => {
  for (const result of [{ code: 1 }, { code: 0, cancelled: true }, { code: 0, timedOut: true }, new Error('disconnected')]) {
    const f = fixture(); await f.workspace.run('first', owner)
    f.execution.startJob = async () => { if (result instanceof Error) throw result; return { ...result, runtimeId: 'runtime' } }
    await f.workspace.run('latest', owner).catch(() => {})
    expect((await f.workspace.check({}, owner)).ok).toBe(false)
    expect(f.workspace.commands.at(-1).command).toBe('latest')
  }
})
test('pending operations and snapshot/runtime failures cannot certify completion', async () => {
  const f = fixture(); await f.workspace.run('first', owner)
  let release
  f.execution.startJob = () => new Promise(resolve => { release = resolve })
  const pending = f.workspace.run('next', owner)
  expect((await f.workspace.check({}, owner)).ok).toBe(false)
  await new Promise(resolve => setTimeout(resolve, 0))
  release({ code: 0, runtimeId: 'runtime' }); await pending
  f.execution.snapshot = async () => { throw Error('snapshot conflict') }
  await expect(f.workspace.check({}, owner)).rejects.toThrow('snapshot conflict')
  f.rebind(); await expect(f.workspace.check({}, owner)).rejects.toThrow('binding changed')
})
test('echoed pass text and shell-wrapped commands do not prove declared test execution', async () => {
  for (const command of ['echo pass', 'echo bun run test', 'bun run test || true', 'bun test', 'bun run test; echo pass']) {
    const f = fixture(); await f.workspace.run(command, owner)
    expect(ranDeclaredTests(f.workspace.commands, owner, 'a')).toBe(false)
  }
})

test('real Local Bun receipts reject a command that writes source until a subsequent check', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createCompanion } = await import('../host/companion.js')
  const { LocalExecution } = await import('../src/execution/local.js')
  const root = await mkdtemp(join(tmpdir(), 'askk-eval-receipts-'))
  let companion, execution
  try {
    companion = await createCompanion({ root, port: 0, capabilities: ['fs', 'exec'] })
    execution = new LocalExecution({ url: companion.url, token: companion.token })
    await execution.prepare()
    const workspace = createEvaluationWorkspace(execution)
    await workspace.run('printf original > source.txt', owner)
    expect((await workspace.check({}, owner)).ok).toBe(false)
    await workspace.run('test -s source.txt', owner)
    expect((await workspace.check({}, owner)).ok).toBe(true)
    await workspace.write({ path: 'extra.txt', content: 'new file', expectedRevision: 0 })
    expect((await workspace.check({}, owner)).ok).toBe(false)
    await workspace.run('test -s extra.txt', owner)
    expect((await workspace.check({}, owner)).ok).toBe(true)
    expect(workspace.commands.every(row => row.stage === 'complete' && row.runtimeId && row.inputRevision && row.completedRevision)).toBe(true)
  } finally { await execution?.dispose(); await companion?.close(); await rm(root, { recursive: true, force: true }) }
})

test('a newer command completed during snapshot collection supersedes the old receipt', async () => {
  const f = fixture(); await f.workspace.run('first', owner)
  let release, first = true
  f.execution.snapshot = async () => {
    if (first) { first = false; return new Promise(resolve => { release = resolve }) }
    return { revision: 'a' }
  }
  const checking = f.workspace.check({}, owner)
  f.execution.startJob = async () => ({ code: 1, runtimeId: 'runtime' })
  await f.workspace.run('new failed command', owner)
  release({ revision: 'a' })
  expect((await checking).ok).toBe(false)
})

test('Bun report requires executed non-skipped tests, independently of exit code', async () => {
  const { bunTestReport } = await import('../scripts/evals/workspace-evidence.js')
  for (const xml of ['', '<testsuites tests="0" skipped="0" failures="0"></testsuites>', '<testsuites tests="1" skipped="1" failures="0"></testsuites>', '<testsuites tests="1" skipped="0" failures="1"></testsuites>']) expect(bunTestReport(xml).passed).toBe(false)
  expect(bunTestReport('<testsuites tests="2" skipped="1" failures="0"></testsuites>')).toMatchObject({ executed: 1, passed: true })
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path')
  const root = await mkdtemp(join(tmpdir(), 'askk-test-discovery-'))
  try {
    for (const [source, passed] of [['export const x = 1', false], ['import {test,expect} from "bun:test";test("works",()=>expect(1).toBe(1))', true]]) {
      await writeFile(join(root, 'example.test.js'), source)
      const process = Bun.spawn([Bun.which('bun'), 'test', '--reporter=junit', `--reporter-outfile=${join(root, 'tests.xml')}`], { cwd: root, stdout: 'ignore', stderr: 'ignore' })
      expect(await process.exited).toBe(0)
      expect(bunTestReport(await readFile(join(root, 'tests.xml'), 'utf8').catch(() => '')).passed).toBe(passed)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
